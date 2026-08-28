"use client";

/**
 * How much signal an area has — never how good it is.
 *
 * The label is fixed at "Sanket ki prabalta" (strength of the signs) and the fill is deliberately
 * NEUTRAL: ink fading to muted, no green, no red, nothing that reads as a grade. Direction lives in
 * a separate chip that owns the colour. That separation is the whole point — a coloured bar at 90%
 * would render as "your marriage scores 90", which is a fixed-fate claim, and the scoring layer went
 * to some trouble to keep `strength` direction-free so the UI could avoid making one.
 *
 * For the same reason there is no "score", "rating" or "out of 100" anywhere in the copy.
 */

/** The one label this bar is allowed to carry. */
export const STRENGTH_LABEL = "Sanket ki prabalta";

export function StrengthBar({
  strength,
  compact = false,
}: {
  /** 0–100, or null when the band is INSUFFICIENT and no strength was computed. */
  readonly strength: number | null;
  readonly compact?: boolean;
}) {
  if (strength === null) return null;
  const value = Math.min(100, Math.max(0, Math.round(strength)));

  return (
    <div className="flex w-full flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <span className={`font-display uppercase tracking-[0.18em] text-muted ${compact ? "text-[0.6rem]" : "text-xs"}`}>
          {STRENGTH_LABEL}
        </span>
        <span className={`font-display tabular-nums font-semibold text-ink ${compact ? "text-sm" : "text-base"}`}>
          {value}
        </span>
      </div>
      <div
        role="progressbar"
        aria-valuenow={value}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={STRENGTH_LABEL}
        className={`relative w-full overflow-hidden rounded-full bg-hairline ${compact ? "h-1" : "h-1.5"}`}
      >
        {/* Neutral by design — the direction chip carries the colour, this bar carries only the amount. */}
        <div
          className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-muted to-ink"
          style={{ width: `${value}%` }}
        />
      </div>
    </div>
  );
}
