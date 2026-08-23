"use client";

import { useEffect, useRef, useState } from "react";
import type { LandmarkMetrics } from "@/lib/scan/features";
import type { RectifyResult } from "@/lib/scan/rectify";
import { ALL_CHECKS } from "@/lib/scan/quality";
import { RECTIFIED_SIZE, type FrameStats, type QualityVerdict } from "@/lib/scan/types";

export interface DebugPanelProps {
  readonly rectified: RectifyResult | null;
  /** Fused probability field, for the raw-mask view. */
  readonly fused: Float32Array | null;
  readonly metrics: LandmarkMetrics | null;
  readonly quality: QualityVerdict;
  readonly stats: FrameStats;
  readonly fps: number;
  readonly backend: string;
  readonly inferenceMs: number;
  readonly fusedConfidence: number;
  readonly traceCount: number;
  readonly branchPoints: number;
}

/**
 * Scan debug view.
 *
 * Two things here cannot be judged from code and can only be judged on a real hand: whether the
 * rectified crop lands the palm square, and which gate check is rejecting a frame that looks fine.
 * Both are shown live — the crop at 1:1 with a toggle to the raw 256² mask over it, and every gate
 * check as its own pass/fail row. The check breakdown exists because the first version only surfaced
 * one hint at a time, which made a mis-signed palm-facing test look like a distance problem.
 */
export function DebugPanel({
  rectified,
  fused,
  metrics,
  quality,
  stats,
  fps,
  backend,
  inferenceMs,
  fusedConfidence,
  traceCount,
  branchPoints,
}: DebugPanelProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [showMask, setShowMask] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return;
    const context = canvas.getContext("2d");
    if (context === null) return;

    if (showMask) {
      if (fused === null) {
        context.clearRect(0, 0, RECTIFIED_SIZE, RECTIFIED_SIZE);
        return;
      }
      // Probability → warm ramp on black, so a faint line is still visible against the background.
      const image = context.createImageData(RECTIFIED_SIZE, RECTIFIED_SIZE);
      for (let i = 0; i < fused.length; i += 1) {
        const value = Math.max(0, Math.min(1, fused[i]));
        const at = i * 4;
        image.data[at] = Math.round(255 * value);
        image.data[at + 1] = Math.round(154 * value);
        image.data[at + 2] = Math.round(60 * value);
        image.data[at + 3] = 255;
      }
      context.putImageData(image, 0, 0);
      return;
    }

    if (rectified === null) {
      context.clearRect(0, 0, RECTIFIED_SIZE, RECTIFIED_SIZE);
      return;
    }
    context.putImageData(rectified.image, 0, 0);
    // `fused` is mutated in place, so its identity never changes — confidence is the change signal.
  }, [rectified, fused, fusedConfidence, showMask]);

  const rows: ReadonlyArray<readonly [string, string]> =
    metrics === null
      ? []
      : [
          ["palm aspect (w/l)", metrics.palmAspect.toFixed(3)],
          ["middle / palm", metrics.middleOverPalm.toFixed(3)],
          ["index / middle", metrics.indexOverMiddle.toFixed(3)],
          ["ring / middle", metrics.ringOverMiddle.toFixed(3)],
          ["pinky reach on ring", metrics.pinkyReachOnRing.toFixed(3)],
          ["thumb abduction", `${metrics.thumbAbductionDeg.toFixed(1)}°`],
          ["finger spacing", metrics.fingerSpacing.toFixed(3)],
        ];

  return (
    <details className="rounded-xl border border-hairline bg-surface/60">
      <summary className="cursor-pointer px-4 py-3 font-display text-xs uppercase tracking-[0.22em] text-muted">
        Debug — pipeline &amp; gate
      </summary>

      <div className="grid gap-6 border-t border-hairline p-4 lg:grid-cols-[auto_1fr]">
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-3">
            <span className="font-display text-[0.7rem] uppercase tracking-[0.18em] text-mount-glow">
              {showMask ? `Fused mask ${RECTIFIED_SIZE}²` : `Rectified ${RECTIFIED_SIZE}²`}
            </span>
            <button
              type="button"
              onClick={() => setShowMask((value) => !value)}
              aria-pressed={showMask}
              className="rounded-full border border-hairline px-2.5 py-1 text-[0.7rem] text-muted transition-colors hover:border-mount-glow hover:text-ink"
            >
              {showMask ? "Show crop" : "Show mask"}
            </button>
          </div>
          {/* Fixed box whether or not there is anything to draw, so toggling never shifts the page. */}
          <div className="relative h-[256px] w-[256px] overflow-hidden rounded-lg border border-hairline bg-night">
            <canvas ref={canvasRef} width={RECTIFIED_SIZE} height={RECTIFIED_SIZE} className="h-full w-full" />
            {(showMask ? fused === null : rectified === null) ? (
              <p className="absolute inset-0 flex items-center justify-center px-4 text-center text-xs text-muted">
                {showMask ? "Mask abhi nahi bana." : "Gate pass hote hi crop yahan aayega."}
              </p>
            ) : null}
          </div>
          {rectified !== null && !showMask ? (
            <span className="font-display text-xs tabular-nums text-muted">
              coverage {(rectified.coverage * 100).toFixed(1)}%
            </span>
          ) : null}
        </div>

        <div className="flex flex-col gap-4">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
            <dt className="text-muted">backend</dt>
            <dd className="text-ink">{backend}</dd>
            <dt className="text-muted">inference</dt>
            <dd className="tabular-nums text-ink">{inferenceMs.toFixed(1)} ms</dd>
            <dt className="text-muted">camera fps</dt>
            <dd className="tabular-nums text-ink">{fps.toFixed(1)}</dd>
            <dt className="text-muted">fused confidence</dt>
            <dd className="tabular-nums text-ink">{fusedConfidence.toFixed(3)}</dd>
            <dt className="text-muted">traces / branches</dt>
            <dd className="tabular-nums text-ink">
              {traceCount} / {branchPoints}
            </dd>
            <dt className="text-muted">gate score</dt>
            <dd className="tabular-nums text-ink">{quality.score.toFixed(3)}</dd>
            <dt className="text-muted">luma / clipped</dt>
            <dd className="tabular-nums text-ink">
              {stats.luma.toFixed(3)} / {stats.clipped.toFixed(3)}
            </dd>
          </dl>

          <div className="flex flex-col gap-2 border-t border-hairline pt-4">
            <span className="font-display text-[0.7rem] uppercase tracking-[0.18em] text-muted">Gate checks</span>
            <ul className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-3">
              {ALL_CHECKS.map((check) => {
                const passed = quality.checks[check] ?? true;
                return (
                  <li key={check} className="flex items-center gap-1.5">
                    <span
                      aria-hidden="true"
                      className={`h-1.5 w-1.5 shrink-0 rounded-full ${passed ? "bg-mount-glow" : "bg-line-glow"}`}
                    />
                    <span className={passed ? "text-muted" : "text-line-glow"}>{check}</span>
                  </li>
                );
              })}
            </ul>
          </div>

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
