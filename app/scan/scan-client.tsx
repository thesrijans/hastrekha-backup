"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import kbDocument from "@/data/kb/hastrekha_kb.json";
import { evaluateRules, loadKnowledgeBase, type FiredRule, type KnowledgeBase } from "@/lib/hastrekha";
import { emptyLatch, markGateFail, updateLatch, type LatchState } from "@/lib/scan/latch";
import type { LandmarkFeatureResult } from "@/lib/scan/features";
import { extractLines, projectLines, type LineExtraction } from "@/lib/scan/lines";
import {
  emptySession,
  observe,
  observeLines,
  sessionBag,
  LINE_LOCKED_COPY,
  type ReadingSession,
} from "@/lib/scan/reading-session";
import { mergedMask, type CaptureState } from "@/lib/scan/capture";
import { MASK_SIZE } from "@/lib/scan/types";
import { HOLO_PALM_ANCHORS } from "@/components/palm-geometry";
import { PALM_EDGE_PEAK } from "@/lib/scan/landmarks";
import { DebugPanel } from "@/components/scan/debug-panel";
import { LiveTicker } from "@/components/scan/live-ticker";
import { EnhanceToasts, type EnhanceToast } from "@/components/scan/enhance-toast";
import { DeepScanButton, DeepScanFlash } from "@/components/scan/deep-scan-flash";
import { scanFlags } from "@/lib/scan/flags";
import { PalmOverlay } from "@/components/scan/palm-overlay";
import { ScanHud } from "@/components/scan/scan-hud";
import { useHandScan } from "@/components/scan/use-hand-scan";
import { ReadingView } from "@/app/read/reading-view";
import type { FeedbackState, ReadingResponse, Verdict } from "@/app/read/reading-types";

/**
 * Parsed once per browser session. 106 KB gzipped, and it buys evaluating all 548 rules on-device —
 * which is what lets the ticker run without a round trip per frame.
 */
const KB: KnowledgeBase = loadKnowledgeBase(kbDocument);

/**
 * How often the whole KB is re-evaluated against the session bag.
 *
 * Matched to the line-extraction cadence rather than the landmark one: landmark features settle
 * within the first second and then barely move, so re-deriving rules at 160ms spends most of its
 * effort confirming what it already knew, on the one page in the app that is also decoding video.
 */
const RULE_EVAL_INTERVAL_MS = 700;

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
  /**
   * The monotonic session. Held in a ref as well as state because the frame callbacks fire from the
   * rAF loop and must fold into the LATEST session, not whichever one their closure captured.
   */
  const sessionRef = useRef<ReadingSession>(emptySession());
  const lastEvaluatedAtRef = useRef(0);
  /** Every rule that has ever fired, by id. A card's text must outlive the evidence that raised it. */
  const retainedRulesRef = useRef<Map<string, FiredRule>>(new Map());
  /** Ids the CURRENT bag supports. A held rule outside this set is shown, but marked as revised. */
  const currentRuleIdsRef = useRef<ReadonlySet<string>>(new Set());
  const [currentRuleIds, setCurrentRuleIds] = useState<ReadonlySet<string>>(new Set());
  const [session, setSession] = useState<ReadingSession>(emptySession);
  /** One-time enhance beats, queued rather than derived, so a lock fires its toast exactly once. */
  const [toasts, setToasts] = useState<readonly EnhanceToast[]>([]);
  /** Reported by the overlay from inside its draw — the only count that proves pixels were painted. */
  const [polylinesDrawn, setPolylinesDrawn] = useState(0);
  /** A "Gehri scan" is running. Never automatic — see components/scan/deep-scan-flash.tsx. */
  const [flashing, setFlashing] = useState(false);
  /**
   * A standing refusal, separate from the feature flag.
   *
   * The flag says whether the capability exists; this says whether this person wants their screen
   * flashing white at them. Someone can reasonably want the feature available and still never want it
   * to fire, so one switch could not express both.
   */
  const [noFlash, setNoFlash] = useState(false);
  const dismissToast = useCallback((id: string) => {
    setToasts((previous) => previous.filter((toast) => toast.id !== id));
  }, []);

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

  /**
   * Re-evaluates the rules from the SESSION's bag rather than this frame's.
   *
   * That single indirection is what stops the ticker thrashing: the session only ever improves, so
   * rules accumulate instead of flickering in and out with whatever the newest frame happened to
   * measure. It also means the reading the user watches assemble is the one that will be posted.
   */
  /**
   * Folds an observation into the session, and — separately — decides whether it may advance a claim.
   *
   * Three cadences meet here and each has to keep its own, which is the whole reason this is one
   * function with two flags rather than three call sites:
   *
   *  - **Folding** happens on every observation. Evidence is a measurement, and measurements are not
   *    gated on pose quality.
   *  - **Rule evaluation** is throttled. The bag grows across the whole scan, so re-walking the KB
   *    against it is not cheap, and this page is simultaneously decoding video — a long main-thread
   *    block here is a dropped frame the user can see.
   *  - **Latching** ticks once per gate-passing frame, at the frame's own rate, using whatever the
   *    last evaluation found. It has to: `updateLatch` promotes by COUNTING consecutive passes, not
   *    by elapsed time, so pacing it with the evaluation would have quietly stretched `confirmAfter`
   *    from about two thirds of a second to nearly three.
   */
  const foldSession = useCallback(
    (next: ReadingSession, options: { readonly latch: boolean; readonly force?: boolean }) => {
      sessionRef.current = next;
      setSession(next);

      const at = performance.now();
      if (options.force === true || at - lastEvaluatedAtRef.current >= RULE_EVAL_INTERVAL_MS) {
        lastEvaluatedAtRef.current = at;
        const evaluation = evaluateRules(KB, sessionBag(next), {
          includeSensitive: false,
          relaxMissingMounts: true,
        });

        /*
         * Rule BODIES are retained forever, even for rules the current bag no longer supports.
         *
         * The ticker looks a rule's text up by id; without this, a rule that stopped firing — which
         * a monotonic bag still permits, when better evidence replaces a value — would have its card
         * silently disappear. "Once latched, never withdrawn" has to mean the card survives, not
         * merely that the id stays in a set nothing can render.
         */
        for (const item of evaluation.fired) retainedRulesRef.current.set(item.rule.rule_id, item);
        currentRuleIdsRef.current = new Set(evaluation.fired.map((item) => item.rule.rule_id));
        setFired([...retainedRulesRef.current.values()]);
        setCurrentRuleIds(currentRuleIdsRef.current);
      }

      // The gate governs claims, never evidence. Latching is a claim.
      if (options.latch) {
        setLatch((previous) => updateLatch(previous, [...currentRuleIdsRef.current]));
      }
    },
    [],
  );

  /** Fires only for gate-passing frames — enforced in the hook, not here. */
  const onFeatures = useCallback(
    (result: LandmarkFeatureResult, quality: number) => {
      landmarkBagRef.current = result.features as Record<string, unknown>;
      // The gate score IS this observation's confidence: it is exactly how much the frame is trusted.
      const { session: next } = observe(sessionRef.current, result.features as Record<string, unknown>, {
        source: "landmark",
        nowMs: performance.now(),
        confidence: quality,
      });
      // Gate-passing by construction — the hook only calls this for frames that passed.
      foldSession(next, { latch: true });
    },
    [foldSession],
  );

  /**
   * Line evidence, on any frame with a hand — gate or no gate.
   *
   * A locked line is a one-time premium beat, so the toast is queued here rather than derived from
   * state during render: a line locks once, and re-deriving "is it locked" every render would fire
   * the toast again on every unrelated update.
   */
  const onLineFeatures = useCallback(
    (extraction: LineExtraction, nowMs: number) => {
      const { session: next, delta } = observeLines(
        sessionRef.current,
        extraction.features as Record<string, unknown>,
        extraction.completion,
        "line",
        nowMs,
      );
      if (delta.locked.length > 0) {
        setToasts((previous) => [
          ...previous,
          ...delta.locked.map((id) => ({ id: `${id}-${nowMs}`, text: LINE_LOCKED_COPY[id] })),
        ]);
      }
      /*
       * `latch: false`, and this is the seam the whole design turns on. Line evidence is
       * deliberately gate-independent — a tilted palm shows the same creases — so it must reach the
       * session. But a frame that failed the gate has not earned the right to advance a rule toward
       * "confirmed", which is a claim made to the user. Evidence in, claims out.
       */
      foldSession(next, { latch: false });
    },
    [foldSession],
  );

  /** Every failing frame. After 2s of these the latch decays and confirmations become "captured". */
  const onGateFail = useCallback((nowMs: number) => {
    setLatch((previous) => markGateFail(previous, nowMs));
  }, []);

  const buildReading = useCallback(
    async (capture: CaptureState) => {
      setOutcome({ status: "building" });
      try {
        // MASK_SIZE, not the default: every stored pose mask is at the worker's working resolution.
        const merged = mergedMask(capture, MASK_SIZE);
        const found = extractLines(merged, MASK_SIZE);
        setHoloLines(projectLines(found.lines, HOLO_PALM_ANCHORS));

        /*
         * The merged-mask extraction is the best-evidenced observation of the whole scan — every
         * pose's mask at once — but it enters the session on exactly the same terms as every other
         * observation rather than overwriting it. It wins where it is genuinely more confident, which
         * on merged evidence is most places, and loses where it is not. What posts is therefore the
         * bag the user watched build, with the strongest available evidence folded in last.
         */
        const { session: finalSession } = observeLines(
          sessionRef.current,
          found.features as Record<string, unknown>,
          found.completion,
          "capture",
          performance.now(),
        );
        foldSession(finalSession, { latch: false, force: true });

        const features = mergeBags(
          sessionBag(finalSession) as Record<string, unknown>,
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
    [birthDate, foldSession],
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

  const scan = useHandScan({ onFeatures, onGateFail, onLineFeatures, onCaptureComplete });
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
    tracesNamed,
    traces,
    telemetry,
    camera,
    contrast,
    projection,
    liveProjectionRef,
    degraded,
    flashProgress,
    bracketFrames,
    requestFlashFrame,
    beginFlashSequence,
    completeFlashSequence,
    clearFlashEvidence,
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

  /*
   * Subscribed rather than read once: the flag is toggled live from the debug HUD, and the button
   * has to appear and disappear with it.
   */
  const photometricEnabled = useSyncExternalStore(
    scanFlags.subscribe,
    () => scanFlags.snapshot().photometric,
    () => false,
  );

  const startFlash = useCallback(() => {
    if (noFlash) return;
    beginFlashSequence();
    setFlashing(true);
  }, [beginFlashSequence, noFlash]);

  const handleFlashComplete = useCallback(() => {
    setFlashing(false);
    const result = completeFlashSequence();
    console.debug("[scan] gehri scan:", result.frames, "frames, meanRange", result.meanRange.toFixed(4));
  }, [completeFlashSequence]);

  /*
   * Minor traces are everything NOT already drawn as a named line. Memoised on the trace array so
   * the overlay prop is stable between extractions — it re-renders a canvas that is redrawing at
   * frame rate, and a new array identity every render would restart nothing but would churn.
   */
  const minorTraces = useMemo(
    () => traces.filter((t) => t.class === "minor_unclassified").map((t) => ({ points: t.points, depth: t.depth })),
    [traces],
  );

  const restart = useCallback(() => {
    setOutcome({ status: "scanning" });
    setFeedback({});
    setHoloLines({});
    setLatch(emptyLatch());
    /*
     * A restart is a new reading, so the session goes with it. Without this the accumulator carried
     * the previous attempt's evidence and depth into the new scan — and because the bag is monotonic
     * that stale evidence could never be displaced by anything the new scan measured more faintly.
     */
    sessionRef.current = emptySession();
    setSession(emptySession());
    retainedRulesRef.current = new Map();
    currentRuleIdsRef.current = new Set();
    setCurrentRuleIds(new Set());
    setFired([]);
    setToasts([]);
    lastEvaluatedAtRef.current = 0;
    clearFlashEvidence();
    setFlashing(false);
    scan.restartCapture();
  }, [clearFlashEvidence, scan]);

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
                <EnhanceToasts toasts={toasts} onDismiss={dismissToast} />
                <DeepScanFlash
                  active={flashing}
                  disabled={noFlash}
                  onQuadrant={requestFlashFrame}
                  onComplete={handleFlashComplete}
                />
                <PalmOverlay
                  landmarks={observation?.landmarks ?? null}
                  videoSize={videoSize}
                  polys={polys}
                  confidence={fusedConfidence}
                  segments={polySegments}
                  gatePassing={quality.ok}
                  tracesNamed={tracesNamed}
                  projection={projection}
                  liveProjection={liveProjectionRef}
                  minorTraces={minorTraces}
                  onDrawn={setPolylinesDrawn}
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
              {/* Only offered when the capability is switched on — see lib/scan/flags.ts. */}
              {photometricEnabled ? (
                <>
                  <DeepScanButton onPress={startFlash} running={flashing} disabled={noFlash} progress={flashProgress} />
                  <button
                    type="button"
                    aria-pressed={noFlash}
                    onClick={() => {
                      setNoFlash((previous) => !previous);
                      if (!noFlash) {
                        setFlashing(false);
                        clearFlashEvidence();
                      }
                    }}
                    className={`rounded-full border px-5 py-2 font-display text-sm font-medium transition-colors ${
                      noFlash ? "border-mount-glow/60 text-mount-glow" : "border-hairline text-muted hover:text-ink"
                    }`}
                  >
                    {noFlash ? "Flash band hai" : "Flash band karo"}
                  </button>
                </>
              ) : null}
            </div>
          ) : null}
        </div>

        <LiveTicker fired={fired} latch={latch} gatePassing={quality.ok} hint={quality.hint} depth={session.depth} currentRuleIds={currentRuleIds} />
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
        telemetry={telemetry}
        polylinesDrawn={polylinesDrawn}
        camera={camera}
        contrast={contrast}
        bracketFrames={bracketFrames}
        degraded={degraded}
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
