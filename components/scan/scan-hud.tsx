"use client";

import type { QualityVerdict } from "@/lib/scan/types";

/**
 * Screen-space scan chrome: the four corner brackets and one instruction at a time.
 *
 * Everything video-anchored — skeleton, boundary, anchors — moved to the canvas overlay in step 6,
 * where it renders through the shared cover transform. This SVG is deliberately container-relative
 * (`preserveAspectRatio="none"` is fine here) because brackets frame the *box*, not the video, and
 * a mirrored preview does not change where a corner is.
 */
export function ScanHud({ quality }: { readonly quality: QualityVerdict }) {
  const locked = quality.ok;

  return (
    <>
      <svg
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        className="pointer-events-none absolute inset-0 h-full w-full"
        aria-hidden="true"
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
