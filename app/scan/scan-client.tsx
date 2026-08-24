"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import kbDocument from "@/data/kb/hastrekha_kb.json";
import { evaluateRules, loadKnowledgeBase, type FeatureBag, type FiredRule, type KnowledgeBase } from "@/lib/hastrekha";
import { emptyLatch, markGateFail, updateLatch, type LatchState } from "@/lib/scan/latch";
import type { LandmarkFeatureResult } from "@/lib/scan/features";
import { extractLines, projectLines } from "@/lib/scan/lines";
import { mergedMask, type CaptureState } from "@/lib/scan/capture";
import { HOLO_PALM_ANCHORS } from "@/components/palm-geometry";
import { PALM_EDGE_PEAK } from "@/lib/scan/landmarks";
import { DebugPanel } from "@/components/scan/debug-panel";
import { LiveTicker } from "@/components/scan/live-ticker";
import { PalmOverlay } from "@/components/scan/palm-overlay";
import { ScanHud } from "@/components/scan/scan-hud";
import { useHandScan } from "@/components/scan/use-hand-scan";
import { ReadingView } from "@/app/read/reading-view";
import type { FeedbackState, ReadingResponse, Verdict } from "@/app/read/reading-types";

/**
 * Parsed once per browser session. 78 KB gzipped, and it buys evaluating all 377 rules on-device —
 * which is what lets the ticker run without a round trip per frame.
 */
const KB: KnowledgeBase = loadKnowledgeBase(kbDocument);

/**
 * The scan does not read mounts — prominence is fleshy relief, which the line model cannot see, so
 * no mount feature is ever fabricated into the reading.
 */
const SCAN_MOUNTS: Record<string, number> = {};

type Outcome =
  | { readonly status: "scanning" }
  | { readonly status: "building" }
  | { readonly status: "failed"; readonly message: string }
  | { readonly status: "ready"; readonly reading: ReadingResponse };

/** Deep-merges the landmark bag and the line bag; both write disjoint groups except `reading`. */
function mergeBags(...bags: ReadonlyArray<Record<string, unknown> | undefined>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const bag of bags) {
    if (bag === undefined) continue;
    for (const [group, value] of Object.entries(bag)) {
      if (typeof value === "object" && value !== null && !Array.isArray(value) && typeof out[group] === "object") {
        out[group] = { ...(out[group] as Record<string, unknown>), ...(value as Record<string, unknown>) };
      } else {
        out[group] = value;
      }
    }
  }
  return out;
}

export function ScanClient() {
  const [latch, setLatch] = useState<LatchState>(emptyLatch);
  const [fired, setFired] = useState<readonly FiredRule[]>([]);
  const [outcome, setOutcome] = useState<Outcome>({ status: "scanning" });
  const [feedback, setFeedback] = useState<Record<number, FeedbackState>>({});
  const [birthDate, setBirthDate] = useState<string | null>(null);
  const [holoLines, setHoloLines] = useState<Record<string, ReadonlyArray<readonly [number, number]>>>({});
  /** Live override for the palm-edge bulge, driven by the debug panel's tuning slider. */
  const [edgePeak, setEdgePeak] = useState(PALM_EDGE_PEAK);

  const isMountedRef = useRef(true);
  const landmarkBagRef = useRef<Record<string, unknown>>({});

  useEffect(() => {
    isMountedRef.current = true;
    const controller = new AbortController();
    // Seeds user.birth_date from the session so a signed-in user is not asked twice.
    void (async () => {
      try {
        const response = await fetch("/api/auth/me", { signal: controller.signal, cache: "no-store" });
        if (!response.ok || !isMountedRef.current) return;
        const payload = (await response.json()) as { user?: { birthDate?: string | null } };
        if (isMountedRef.current) setBirthDate(payload.user?.birthDate ?? null);
      } catch {
        /* Not signed in, or offline — the scan works without a birth date. */
      }
    })();
    return () => {
      isMountedRef.current = false;
      controller.abort();
    };
  }, []);

  /** Fires only for gate-passing frames — enforced in the hook, not here. */
  const onFeatures = useCallback((result: LandmarkFeatureResult) => {
    landmarkBagRef.current = result.features as Record<string, unknown>;
    const evaluation = evaluateRules(KB, result.features as FeatureBag, {
      includeSensitive: false,
      relaxMissingMounts: true,
    });
    setFired(evaluation.fired);
    setLatch((previous) => updateLatch(previous, evaluation.fired.map((item) => item.rule.rule_id)));
  }, []);

  /** Every failing frame. After 2s of these the latch decays and confirmations become "captured". */
  const onGateFail = useCallback((nowMs: number) => {
    setLatch((previous) => markGateFail(previous, nowMs));
  }, []);

  const buildReading = useCallback(
    async (capture: CaptureState) => {
      setOutcome({ status: "building" });
      try {
        const merged = mergedMask(capture);
        const found = extractLines(merged);
        setHoloLines(projectLines(found.lines, HOLO_PALM_ANCHORS));

        const features = mergeBags(
          landmarkBagRef.current,
          found.features as Record<string, unknown>,
          birthDate === null ? undefined : { user: { birth_date: birthDate } },
        );

        const response = await fetch("/api/reading", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ tier: "free", source: "CAMERA_SCAN", features }),
        });
        if (!isMountedRef.current) return;
        if (!response.ok) {
          const detail = (await response.json().catch(() => null)) as { error?: string } | null;
          setOutcome({ status: "failed", message: detail?.error ?? `Reading nahi ban payi (${response.status}).` });
          return;
        }
        const reading = (await response.json()) as ReadingResponse;
        if (isMountedRef.current) setOutcome({ status: "ready", reading });
      } catch {
        if (isMountedRef.current) setOutcome({ status: "failed", message: "Network thoda dagmaga gaya." });
      }
    },
    [birthDate],
  );

  /** The hook object is stable across renders, so the completion callback can reach stop(). */
  const scanRef = useRef<ReturnType<typeof useHandScan> | null>(null);

  const onCaptureComplete = useCallback(
    (capture: CaptureState) => {
      // The scan is over — release the camera immediately. Holding it open behind the reading
      // would betray the page's own promise about what happens on this device.
      scanRef.current?.stop();
      void buildReading(capture);
    },
    [buildReading],
  );

  const scan = useHandScan({ onFeatures, onGateFail, onCaptureComplete });
  // Synced in an effect, not during render — a render React discards must not mutate the ref.
  useEffect(() => {
    scanRef.current = scan;
  }, [scan]);
  const {
    status,
    error,
    quality,
    observation,
    features,
    rectified,
    stats,
    fps,
    backend,
    diagnostics,
    inferenceMs,
    timeToFirstTraceMs,
    traceEvidenceAtMs,
    alignment,
    photometric,
    fusedConfidence,
    fusedField,
    stageMasks,
    stageTimings,
    videoSize,
    polys,
    polySegments,
    extraction,
    capture,
    pose,
    poseProgress,
    poseCount,
    mirrored,
    setVideoElement,
  } = scan;

  const running = status === "running";

  const sendFeedback = useCallback(
    async (readingId: string, sectionIndex: number, ruleIds: readonly string[], verdict: Verdict) => {
      setFeedback((previous) => ({ ...previous, [sectionIndex]: { status: "saving" } }));
      try {
        const response = await fetch("/api/reading/feedback", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ readingId, ruleIds, verdict }),
        });
        if (!isMountedRef.current) return;
        setFeedback((previous) => ({
          ...previous,
          [sectionIndex]: response.ok ? { status: "done", verdict } : { status: "error" },
        }));
      } catch {
        if (isMountedRef.current) setFeedback((previous) => ({ ...previous, [sectionIndex]: { status: "error" } }));
      }
    },
    [],
  );

  const restart = useCallback(() => {
    setOutcome({ status: "scanning" });
    setFeedback({});
    setHoloLines({});
    setLatch(emptyLatch());
    scan.restartCapture();
  }, [scan]);

  if (outcome.status === "ready") {
    return (
      <ReadingView
        reading={outcome.reading}
        mounts={SCAN_MOUNTS}
        lines={holoLines}
        feedback={feedback}
        onFeedback={sendFeedback}
        onRestart={restart}
      />
    );
  }

  return (
    <div className="flex flex-col gap-8">
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
        <div className="flex flex-col gap-4">
          <div className="relative aspect-[3/4] w-full overflow-hidden rounded-2xl border border-hairline bg-surface sm:aspect-square">
            {/* Always mounted: the hook needs the element before the stream exists. */}
            <video
              ref={setVideoElement}
              playsInline
              muted
              aria-label="Palm camera preview"
              className="h-full w-full object-cover"
              style={mirrored ? { transform: "scaleX(-1)" } : undefined}
            />

            {running ? (
              <>
                <PalmOverlay
                  landmarks={observation?.landmarks ?? null}
                  videoSize={videoSize}
                  polys={polys}
                  confidence={fusedConfidence}
                  segments={polySegments}
                  evidenceAtMs={traceEvidenceAtMs}
                  mirrored={mirrored}
                  edgePeak={edgePeak}
                />
                <ScanHud quality={quality} />
                {pose !== null ? (
                  <PoseBadge
                    label={pose.label}
                    instruction={pose.instruction}
                    index={capture.records.length}
                    total={poseCount}
                    progress={poseProgress}
                  />
                ) : null}
              </>
            ) : null}

            {!running ? (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 p-6 text-center">
                <p className="max-w-xs text-sm leading-6 text-muted">
                  {status === "starting"
                    ? "Camera shuru ho raha hai…"
                    : "Hatheli camera ke saamne rakho. Tasveer kabhi upload nahi hoti — sab kuch isi device par."}
                </p>
                {status !== "starting" ? (
                  <button
                    type="button"
                    onClick={() => void scan.start()}
                    className="rounded-full bg-mount-glow px-6 py-2.5 font-display text-sm font-semibold text-night transition-opacity hover:opacity-90"
                  >
                    Camera chalu karo
                  </button>
                ) : null}
              </div>
            ) : null}

            {outcome.status === "building" ? (
              <div className="absolute inset-0 flex items-center justify-center bg-night/80 backdrop-blur-sm">
                <p className="font-display text-sm uppercase tracking-[0.22em] text-mount-glow">Reading ban rahi hai…</p>
              </div>
            ) : null}
          </div>

          {error !== null ? (
            <p role="alert" className="rounded-lg border border-line-glow/40 bg-line-glow/10 px-4 py-3 text-sm leading-6 text-ink">
              {error}
            </p>
          ) : null}

          {outcome.status === "failed" ? (
            <div role="alert" className="flex flex-wrap items-center gap-3 rounded-lg border border-line-glow/40 bg-line-glow/10 px-4 py-3 text-sm text-ink">
              {outcome.message}
              <button
                type="button"
                onClick={restart}
                className="rounded-full border border-hairline px-4 py-1.5 font-display text-xs font-medium text-ink"
              >
                Dobara scan karo
              </button>
            </div>
          ) : null}

          {running ? (
            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                onClick={scan.stop}
                className="rounded-full border border-hairline px-5 py-2 font-display text-sm font-medium text-muted transition-colors hover:text-ink"
              >
                Camera band karo
              </button>
              {capture.records.length > 0 ? (
                <button
                  type="button"
                  onClick={restart}
                  className="rounded-full border border-hairline px-5 py-2 font-display text-sm font-medium text-muted transition-colors hover:text-ink"
                >
                  Shuru se
                </button>
              ) : null}
            </div>
          ) : null}
        </div>

        <LiveTicker fired={fired} latch={latch} gatePassing={quality.ok} hint={quality.hint} />
      </div>

      <DebugPanel
        rectified={rectified}
        fused={fusedField}
        stageMasks={stageMasks}
        stageTimings={stageTimings}
        metrics={features?.metrics ?? null}
        quality={quality}
        stats={stats}
        fps={fps}
        backend={backend}
        timeToFirstTraceMs={timeToFirstTraceMs}
        traceEvidenceAtMs={traceEvidenceAtMs}
        alignment={alignment}
        photometric={photometric}
        completion={extraction?.completion ?? null}
        diagnostics={diagnostics}
        inferenceMs={inferenceMs}
        fusedConfidence={fusedConfidence}
        traceCount={polys.length}
        branchPoints={extraction?.branchPoints ?? 0}
        onExportFrame={scan.exportFrame}
        edgePeak={edgePeak}
        onEdgePeak={setEdgePeak}
      />

      <p className="text-xs leading-6 text-muted">
        Mounts abhi bhi khud batane padte hain — unke liye fleshy relief chahiye, jo lines ka model nahi dekhta.{" "}
        <Link href="/read" className="text-mount-glow underline underline-offset-4">
          Mounts bharo
        </Link>
      </p>
    </div>
  );
}

/**
 * Current pose, its instruction, and a ring that fills only while the gate is passing.
 *
 * The ring emptying the moment a frame fails is the point: it makes the gate's verdict something the
 * user can feel, rather than a message they have to read.
 */
function PoseBadge({
  label,
  instruction,
  index,
  total,
  progress,
}: {
  readonly label: string;
  readonly instruction: string;
  readonly index: number;
  readonly total: number;
  readonly progress: number;
}) {
  return (
    <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between gap-3 p-4">
      <div className="rounded-xl border border-hairline bg-night/70 px-3 py-2 backdrop-blur-md">
        <p className="font-display text-[0.7rem] uppercase tracking-[0.22em] text-mount-glow">
          {index + 1} / {total} · {label}
        </p>
        <p className="mt-0.5 text-xs text-ink">{instruction}</p>
      </div>

      <svg viewBox="0 0 40 40" className="hr-glow-chrome h-11 w-11 shrink-0 -rotate-90" role="img" aria-label={`Capture ${Math.round(progress * 100)} percent`}>
        <circle cx="20" cy="20" r="17" fill="rgba(6,9,13,0.6)" stroke="var(--color-hairline)" strokeWidth="3" />
        <circle
          cx="20"
          cy="20"
          r="17"
          fill="none"
          stroke="var(--color-mount-glow)"
          strokeWidth="3"
          strokeLinecap="round"
          pathLength={1}
          strokeDasharray={`${Math.max(0, Math.min(1, progress))} 1`}
        />
      </svg>
    </div>
  );
}
