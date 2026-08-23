/**
 * Canonical landmarks inside the rectified crop.
 *
 * Rectification maps four palm anchors onto fixed positions (see `rectify.ts`), which means every
 * other palm feature also lands in a predictable place. That is the whole payoff of rectifying: the
 * line classifier can ask "does this polyline start under the index finger" as a coordinate test
 * rather than a learned one.
 *
 * All coordinates are 0–1 fractions of the crop, so they survive a change of `RECTIFIED_SIZE`.
 */
import type { Point2 } from "./types";

export interface Zone {
  readonly id: string;
  readonly label: string;
  readonly cx: number;
  readonly cy: number;
  readonly r: number;
}

/**
 * Mount centres in crop space, derived from where the canonical anchors put the knuckles and wrist.
 * Doubles as the overlay's cyan dot-cluster layout.
 */
export const MOUNT_ZONES: readonly Zone[] = [
  { id: "jupiter", label: "Jupiter", cx: 0.27, cy: 0.24, r: 0.1 },
  { id: "saturn", label: "Saturn", cx: 0.47, cy: 0.2, r: 0.1 },
  { id: "sun", label: "Sun", cx: 0.66, cy: 0.23, r: 0.1 },
  { id: "mercury", label: "Mercury", cx: 0.82, cy: 0.3, r: 0.09 },
  { id: "mars_inner", label: "Mars", cx: 0.3, cy: 0.46, r: 0.09 },
  { id: "venus", label: "Venus", cx: 0.22, cy: 0.7, r: 0.16 },
  { id: "moon", label: "Luna", cx: 0.76, cy: 0.66, r: 0.15 },
];

/** Coarse regions the line classifier reasons about, beyond the mounts. */
export const EDGE_ZONES = {
  /** Little-finger side of the palm — where the heart line starts. */
  percussion: { cx: 0.9, cy: 0.32, r: 0.14 },
  /** Between thumb and index — where life and head both begin. */
  webThumbIndex: { cx: 0.2, cy: 0.3, r: 0.12 },
  wrist: { cx: 0.5, cy: 0.95, r: 0.16 },
  plainOfMars: { cx: 0.5, cy: 0.5, r: 0.16 },
} as const;

/** Upper-mount bands the heart line's terminal end is graded against, left to right. */
export const HEART_END_ZONES: ReadonlyArray<{ readonly value: string; readonly cx: number; readonly cy: number }> = [
  { value: "mount_jupiter_outer", cx: 0.16, cy: 0.2 },
  { value: "mount_jupiter_center", cx: 0.27, cy: 0.21 },
  { value: "between_jupiter_saturn", cx: 0.37, cy: 0.19 },
  { value: "mount_saturn_face", cx: 0.47, cy: 0.18 },
  { value: "under_saturn_base", cx: 0.47, cy: 0.3 },
];

export function zoneCentre(zone: { readonly cx: number; readonly cy: number }, size: number): Point2 {
  return { x: zone.cx * size, y: zone.cy * size };
}

export function distanceTo(zone: { readonly cx: number; readonly cy: number }, point: Point2, size: number): number {
  return Math.hypot(point.x - zone.cx * size, point.y - zone.cy * size);
}

/** True when `point` (crop pixels) falls inside `zone`. */
export function inZone(zone: Zone | { readonly cx: number; readonly cy: number; readonly r: number }, point: Point2, size: number): boolean {
  return distanceTo(zone, point, size) <= zone.r * size;
}

/** Nearest entry by centre distance. Used to turn a line endpoint into a KB enum value. */
export function nearestZone<T extends { readonly cx: number; readonly cy: number }>(
  zones: readonly T[],
  point: Point2,
  size: number,
): T {
  let best = zones[0];
  let bestDistance = Infinity;
  for (const zone of zones) {
    const d = distanceTo(zone, point, size);
    if (d < bestDistance) {
      bestDistance = d;
      best = zone;
    }
  }
  return best;
}
