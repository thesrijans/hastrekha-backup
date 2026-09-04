/**
 * Corridors for the minor classes the corridor search may fill in (flag `corridorSearch`).
 *
 * completion.ts's CORRIDORS covers the four majors and is NOT edited (fate is imported from it at
 * the call sites). These three are authored the same way completion's were: endpoints taken from
 * classify.ts's zone pairs verbatim, interior knots on the straight chord (all three run
 * near-straight — none of them has the heart's sagitta anatomy), half-widths from the zone radii
 * tapered linearly between the ends. A corridor narrower than its classifier zones would decide
 * the class in advance; these are exactly as wide.
 */
import type { CorridorShape } from "./corridor-path";

/** Interior knots: straight chord interpolation — minor lines carry no bow prior. */
const chord = (
  from: { x: number; y: number },
  to: { x: number; y: number },
): { x: number; y: number }[] =>
  [0, 0.25, 0.5, 0.75, 1].map((t) => ({
    x: Number((from.x + (to.x - from.x) * t).toFixed(3)),
    y: Number((from.y + (to.y - from.y) * t).toFixed(3)),
  }));

const taper = (a: number, b: number): number[] =>
  [0, 0.25, 0.5, 0.75, 1].map((t) => Number((a + (b - a) * t).toFixed(4)));

/**
 * Sun: classify.ts sun zones — start `(0.65, 0.46, r 0.23)` (the authored centroid between the
 * head line, the heart line, the fate line and Luna), end = the sun mount `(0.66, 0.23, r 0.10)`.
 * Wide at the roaming origin, narrow under the mount, mirroring fate's one-sided taper logic.
 */
export const SUN_CORRIDOR: CorridorShape = {
  knots: chord({ x: 0.65, y: 0.46 }, { x: 0.66, y: 0.23 }),
  halfWidths: taper(0.115, 0.05),
};

/**
 * Health: classify.ts health zones — start `(0.4, 0.85, r 0.16)` above the wrist on the life-line
 * side, end = the Mercury mount `(0.82, 0.30, r 0.09)`. The longest and widest of the three: the
 * health line's course varies more than any other minor (which is exactly why classify gives it
 * big zones).
 */
export const HEALTH_CORRIDOR: CorridorShape = {
  knots: chord({ x: 0.4, y: 0.85 }, { x: 0.82, y: 0.3 }),
  halfWidths: taper(0.08, 0.045),
};

/**
 * Marriage: classify.ts marriage zones — the short percussion-edge stroke from `(0.955, 0.267,
 * r 0.055)` to `(0.865, 0.27, r 0.075)`. Narrow throughout; at 128 the corridor is ~12px of palm
 * edge, and widening it would swallow the heart line's origin.
 */
export const MARRIAGE_CORRIDOR: CorridorShape = {
  knots: chord({ x: 0.955, y: 0.267 }, { x: 0.865, y: 0.27 }),
  halfWidths: taper(0.055, 0.075),
};

/** The searchable minor classes, keyed by their classifier class name. */
export const MINOR_CORRIDORS = {
  sun: SUN_CORRIDOR,
  health: HEALTH_CORRIDOR,
  marriage: MARRIAGE_CORRIDOR,
} as const;
