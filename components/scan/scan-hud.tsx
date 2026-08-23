"use client";

import { LM } from "@/lib/scan/landmark-index";
import { PALM_ANCHORS } from "@/lib/scan/rectify";
import type { HandObservation, QualityVerdict } from "@/lib/scan/types";

/** MediaPipe's finger chains, for the skeleton overlay. */
const BONES: ReadonlyArray<readonly [number, number]> = [
  [LM.WRIST, LM.THUMB_CMC], [LM.THUMB_CMC, LM.THUMB_MCP], [LM.THUMB_MCP, LM.THUMB_IP], [LM.THUMB_IP, LM.THUMB_TIP],
  [LM.WRIST, LM.INDEX_MCP], [LM.INDEX_MCP, LM.INDEX_PIP], [LM.INDEX_PIP, LM.INDEX_DIP], [LM.INDEX_DIP, LM.INDEX_TIP],
  [LM.INDEX_MCP, LM.MIDDLE_MCP], [LM.MIDDLE_MCP, LM.MIDDLE_PIP], [LM.MIDDLE_PIP, LM.MIDDLE_DIP], [LM.MIDDLE_DIP, LM.MIDDLE_TIP],
  [LM.MIDDLE_MCP, LM.RING_MCP], [LM.RING_MCP, LM.RING_PIP], [LM.RING_PIP, LM.RING_DIP], [LM.RING_DIP, LM.RING_TIP],
  [LM.RING_MCP, LM.PINKY_MCP], [LM.PINKY_MCP, LM.PINKY_PIP], [LM.PINKY_PIP, LM.PINKY_DIP], [LM.PINKY_DIP, LM.PINKY_TIP],
  [LM.WRIST, LM.PINKY_MCP],
];

const ANCHOR_SET = new Set<number>(PALM_ANCHORS);

/**
 * Camera overlay: scan brackets, the tracked skeleton, and one instruction at a time.
 *
 * Drawn in a 0–100 viewBox with `preserveAspectRatio="none"` so it stretches to whatever the video
 * box is, exactly like the normalised landmark coordinates it renders.
 */
export function ScanHud({
  observation,
  quality,
  mirrored,
}: {
  readonly observation: HandObservation | null;
  readonly quality: QualityVerdict;
  readonly mirrored: boolean;
}) {
  const points = observation?.landmarks ?? [];
  const locked = quality.ok;

  return (
    <>
      <svg
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        className="pointer-events-none absolute inset-0 h-full w-full"
        aria-hidden="true"
        style={mirrored ? { transform: "scaleX(-1)" } : undefined}
      >
        <g
          fill="none"
          stroke={locked ? "var(--color-mount-glow)" : "var(--color-hairline)"}
          strokeWidth={0.6}
          className="hr-glow-chrome transition-colors"
        >
          <path d="M 4 14 L 4 4 L 14 4" />
          <path d="M 86 4 L 96 4 L 96 14" />
          <path d="M 96 86 L 96 96 L 86 96" />
          <path d="M 14 96 L 4 96 L 4 86" />
        </g>

        {points.length >= 21 ? (
          <g className="hr-glow-mount">
            <g stroke="var(--color-mount-glow)" strokeOpacity={0.5} strokeWidth={0.4} fill="none">
              {BONES.map(([from, to]) => (
                <line
                  key={`${from}-${to}`}
                  x1={points[from].x * 100}
                  y1={points[from].y * 100}
                  x2={points[to].x * 100}
                  y2={points[to].y * 100}
                />
              ))}
            </g>
            {points.map((point, index) => (
              <circle
                key={index}
                cx={point.x * 100}
                cy={point.y * 100}
                // The four rectification anchors are drawn larger: if the crop looks wrong, these are why.
                r={ANCHOR_SET.has(index) ? 1.1 : 0.55}
                fill={ANCHOR_SET.has(index) ? "var(--color-line-glow)" : "var(--color-mount-glow)"}
              />
            ))}
          </g>
        ) : null}
      </svg>

      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-center p-4">
        <p
          aria-live="polite"
          className={`rounded-full border px-4 py-2 font-display text-sm font-medium backdrop-blur-md transition-colors ${
            locked
              ? "border-mount-glow/60 bg-mount-glow/15 text-mount-glow"
              : "border-hairline bg-night/70 text-ink"
          }`}
        >
          {quality.hint}
        </p>
      </div>
    </>
  );
}
