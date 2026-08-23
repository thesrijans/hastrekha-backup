"use client";

import Link from "next/link";
import { useCallback, useMemo, useState } from "react";
import kbDocument from "@/data/kb/hastrekha_kb.json";
import { evaluateRules, loadKnowledgeBase, type FeatureBag, type FiredRule, type KnowledgeBase } from "@/lib/hastrekha";
import { emptyLatch, updateLatch, type LatchState } from "@/lib/scan/latch";
import type { LandmarkFeatureResult } from "@/lib/scan/features";
import { NOT_DERIVABLE_FROM_LANDMARKS } from "@/lib/scan/features";
import { RESERVED_LINE_IDS } from "@/lib/scan/types";
import { DebugPanel } from "@/components/scan/debug-panel";
import { LiveTicker } from "@/components/scan/live-ticker";
import { ScanHud } from "@/components/scan/scan-hud";
import { useHandScan } from "@/components/scan/use-hand-scan";

/**
 * Parsed once per browser session. 78 KB gzipped, and it buys evaluating all 377 rules on-device —
 * which is what lets the ticker run without a round trip per frame.
 */
const KB: KnowledgeBase = loadKnowledgeBase(kbDocument);

export function ScanClient() {
  const [latch, setLatch] = useState<LatchState>(emptyLatch);
  const [fired, setFired] = useState<readonly FiredRule[]>([]);

  /**
   * Fires from the scan loop, not from an effect, so folding the latch costs no extra render pass.
   * Free tier, so sensitive rules stay suppressed exactly as they are on the server.
   */
  const onFeatures = useCallback((result: LandmarkFeatureResult) => {
    const evaluation = evaluateRules(KB, result.features as FeatureBag, {
      includeSensitive: false,
      relaxMissingMounts: true,
    });
    setFired(evaluation.fired);
    setLatch((previous) => updateLatch(previous, evaluation.fired.map((item) => item.rule.rule_id)));
  }, []);

  const scan = useHandScan({ onFeatures });
  const { status, error, quality, observation, features, rectified, stats, fps, segmenterId, mirrored, setVideoElement } = scan;

  const running = status === "running";
  const notDerivable = useMemo(() => Object.entries(NOT_DERIVABLE_FROM_LANDMARKS), []);

  return (
    <div className="flex flex-col gap-8">
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
        {/* --------------------------------- Camera -------------------------------- */}
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

            {running ? <ScanHud observation={observation} quality={quality} mirrored={mirrored} /> : null}

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
          </div>

          {error !== null ? (
            <p role="alert" className="rounded-lg border border-line-glow/40 bg-line-glow/10 px-4 py-3 text-sm leading-6 text-ink">
              {error}
            </p>
          ) : null}

          {running ? (
            <button
              type="button"
              onClick={scan.stop}
              className="self-start rounded-full border border-hairline px-5 py-2 font-display text-sm font-medium text-muted transition-colors hover:text-ink"
            >
              Camera band karo
            </button>
          ) : null}
        </div>

        {/* --------------------------------- Ticker -------------------------------- */}
        <LiveTicker fired={fired} latch={latch} />
      </div>

      <DebugPanel
        rectified={rectified}
        metrics={features?.metrics ?? null}
        quality={quality}
        stats={stats}
        fps={fps}
        segmenterId={segmenterId}
      />

      {/* What this stage cannot do. Stated plainly rather than left for someone to discover. */}
      <section aria-labelledby="limits-heading" className="flex flex-col gap-3 rounded-xl border border-hairline p-5">
        <h2 id="limits-heading" className="font-display text-xs uppercase tracking-[0.22em] text-muted">
          Is stage mein kya nahi hota
        </h2>
        <p className="text-sm leading-6 text-muted">
          Abhi sirf landmarks se features nikalte hain — haath ki shape, ungliyon ki lambai, angootha. Lines
          (heart/head/life/fate) aur mounts abhi nahi padhe jaate; unke liye segmentation model chahiye, jo agle
          stage mein aayega. Reserved lines:{" "}
          <span className="text-ink">{RESERVED_LINE_IDS.join(", ")}</span>.
        </p>
        <ul className="flex flex-col gap-1.5 border-t border-hairline pt-3 text-xs leading-6 text-muted">
          {notDerivable.map(([feature, reason]) => (
            <li key={feature}>
              <span className="text-ink">{feature}</span> — {reason}
            </li>
          ))}
        </ul>
        <Link href="/read" className="self-start text-sm text-mount-glow underline underline-offset-4">
          Poori reading banao →
        </Link>
      </section>
    </div>
  );
}
