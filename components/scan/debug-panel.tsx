"use client";

import { useEffect, useRef } from "react";
import type { LandmarkMetrics } from "@/lib/scan/features";
import type { RectifyResult } from "@/lib/scan/rectify";
import { RECTIFIED_SIZE, type FrameStats, type QualityVerdict } from "@/lib/scan/types";

/**
 * Rectification debug view.
 *
 * The rectified crop is the one thing in this pipeline that cannot be judged from code: whether the
 * canonical anchors in `rectify.ts` actually land the palm square is a question only a real hand can
 * answer. So the crop is painted here at 1:1, next to the ratios the feature extractor derived, and
 * both are meant to be watched while tuning.
 */
export function DebugPanel({
  rectified,
  metrics,
  quality,
  stats,
  fps,
  segmenterId,
}: {
  readonly rectified: RectifyResult | null;
  readonly metrics: LandmarkMetrics | null;
  readonly quality: QualityVerdict;
  readonly stats: FrameStats;
  readonly fps: number;
  readonly segmenterId: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null || rectified === null) return;
    const context = canvas.getContext("2d");
    context?.putImageData(rectified.image, 0, 0);
  }, [rectified]);

  const rows: ReadonlyArray<readonly [string, string]> =
    metrics === null
      ? []
      : [
          ["palm aspect (w/l)", metrics.palmAspect.toFixed(3)],
          ["middle / palm", metrics.middleOverPalm.toFixed(3)],
          ["index / middle", metrics.indexOverMiddle.toFixed(3)],
          ["ring / middle", metrics.ringOverMiddle.toFixed(3)],
          ["index / ring", metrics.indexOverRing.toFixed(3)],
          ["pinky reach on ring", metrics.pinkyReachOnRing.toFixed(3)],
          ["thumb abduction", `${metrics.thumbAbductionDeg.toFixed(1)}°`],
          ["thumb IP angle", `${metrics.thumbIpAngleDeg.toFixed(1)}°`],
          ["finger spacing", metrics.fingerSpacing.toFixed(3)],
        ];

  return (
    <details className="rounded-xl border border-hairline bg-surface/60">
      <summary className="cursor-pointer px-4 py-3 font-display text-xs uppercase tracking-[0.22em] text-muted">
        Debug — rectification &amp; metrics
      </summary>

      <div className="grid gap-6 border-t border-hairline p-4 sm:grid-cols-[auto_1fr]">
        <div className="flex flex-col gap-2">
          <span className="font-display text-[0.7rem] uppercase tracking-[0.18em] text-mount-glow">
            Rectified {RECTIFIED_SIZE}²
          </span>
          {/* Fixed box whether or not a crop exists, so opening the panel never shifts the page. */}
          <div className="relative h-[256px] w-[256px] overflow-hidden rounded-lg border border-hairline bg-night">
            <canvas ref={canvasRef} width={RECTIFIED_SIZE} height={RECTIFIED_SIZE} className="h-full w-full" />
            {rectified === null ? (
              <p className="absolute inset-0 flex items-center justify-center px-4 text-center text-xs text-muted">
                Gate pass hote hi crop yahan aayega.
              </p>
            ) : null}
          </div>
          {rectified !== null ? (
            <span className="font-display text-xs tabular-nums text-muted">
              coverage {(rectified.coverage * 100).toFixed(1)}%
            </span>
          ) : null}
        </div>

        <div className="flex flex-col gap-4">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
            <dt className="text-muted">fps</dt>
            <dd className="tabular-nums text-ink">{fps.toFixed(1)}</dd>
            <dt className="text-muted">gate score</dt>
            <dd className="tabular-nums text-ink">{quality.score.toFixed(3)}</dd>
            <dt className="text-muted">luma / clipped</dt>
            <dd className="tabular-nums text-ink">
              {stats.luma.toFixed(3)} / {stats.clipped.toFixed(3)}
            </dd>
            <dt className="text-muted">segmenter</dt>
            <dd className="text-ink">{segmenterId}</dd>
            <dt className="text-muted">issues</dt>
            <dd className="text-ink">{quality.issues.length === 0 ? "none" : quality.issues.join(", ")}</dd>
          </dl>

          {rows.length > 0 ? (
            <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 border-t border-hairline pt-4 text-xs">
              {rows.map(([label, value]) => (
                <div key={label} className="contents">
                  <dt className="text-muted">{label}</dt>
                  <dd className="tabular-nums text-ink">{value}</dd>
                </div>
              ))}
            </dl>
          ) : null}
        </div>
      </div>
    </details>
  );
}
