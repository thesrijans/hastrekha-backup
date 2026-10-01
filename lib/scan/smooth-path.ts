/**
 * @file The jagged-line fix (S3.4): a discovered crease, smoothed inside a tube around itself.
 *
 * A minimal-cost path through a valley follows the valley's pixel noise: at 8-connected steps it zig-zags a pixel
 * either side of the crease, and where the valley is weak it can dart sideways onto a stronger pixel and back — the
 * spikes on the phone capture (docs/reference/phone-chamber-no-flip-jagged-2026-09-23.webp). A crease does not do
 * that. So the drawn — and held — geometry is not the raw path but:
 *
 *   1. the raw path resampled at 1 px of arc;
 *   2. SPIKES removed: wherever the heading turns more than {@link SPIKE_TURN_DEG} within {@link SPIKE_WINDOW_PX}, the
 *      points between are replaced by the chord across the window (repeated until none is left) — then again across
 *      {@link SPIKE_WIDE_WINDOW_PX}, for the notches a path makes where it skirts another line's claim or a speck of
 *      texture (64–97° over 10 px on the golden stills, iteration 6);
 *   3. a curvature-limited fit: the spike-free path Gaussian-smoothed along its arc ({@link SMOOTH_SIGMA_PX}) — a
 *      crease's own bends are gentler than σ, a pixel staircase and a corner are not — with the TUBE as a hard
 *      constraint: every point projected back to within {@link SMOOTH_TUBE_PX} of the raw point it came from, and
 *      the projection's own correction re-smoothed ({@link SMOOTH_ITERATIONS} rounds) so the tube's wall leaves no
 *      corner of its own. A membrane in the tube (iteration 1) is a taut string that turns sharply wherever it
 *      touches the wall; iterating the Gaussian itself compounds σ until the curve lies on the wall (iteration 5:
 *      smooth→raw median 1.51 px). Only the correction is re-smoothed, never the fit: the fit stays a fit.
 *
 * The bars it is measured by ({@link turningBar}, {@link medianDistance}): the turning angle over any 10 px of the
 * drawn line at most {@link TURN_BAR_DEG}, and the smooth path's median distance to the raw path at most 1.5 px.
 *
 * Coordinates are in the 256 tracing grid. Pure; imports nothing.
 */

/** A point in the tracing grid. Structural, so this module stays out of the scan graph. */
export interface PathPoint {
  readonly x: number;
  readonly y: number;
}

/** A turn sharper than this… */
export const SPIKE_TURN_DEG = 35;
/** …within this much arc (px at 256) is a spike, not a crease. */
export const SPIKE_WINDOW_PX = 6;
/** The second pass's window: a notch out and back within this is not the crease's either. */
export const SPIKE_WIDE_WINDOW_PX = 12;
/** The smooth fit stays within this of the raw path (px at 256). */
export const SMOOTH_TUBE_PX = 2;
/** The Gaussian's σ along the arc (px at 256): a crease's own bends are gentler than this, a corner is not. */
export const SMOOTH_SIGMA_PX = 8;
/** Project-then-resmooth rounds: the tube's wall is met, then its corner rounded; three settle it. */
export const SMOOTH_ITERATIONS = 3;
/** The jaggedness bar: at most this many degrees of turn over any {@link TURN_SPAN_PX} of drawn line. */
export const TURN_BAR_DEG = 25;
export const TURN_SPAN_PX = 10;
/** The drawn line keeps a point every this many px of arc (256). */
export const DRAWN_STEP_PX = 3;

/** Arc length of a polyline. */
export function polylineLengthPx(points: readonly PathPoint[]): number {
  let length = 0;
  for (let i = 1; i < points.length; i += 1) length += Math.hypot(points[i]!.x - points[i - 1]!.x, points[i]!.y - points[i - 1]!.y);
  return length;
}

/** The polyline resampled at `step` px of arc; the last point always kept. */
export function resamplePolyline(points: readonly PathPoint[], step: number): PathPoint[] {
  if (points.length < 2) return points.map((p) => ({ x: p.x, y: p.y }));
  const out: PathPoint[] = [{ x: points[0]!.x, y: points[0]!.y }];
  let carried = 0;
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1]!;
    const b = points[i]!;
    const segment = Math.hypot(b.x - a.x, b.y - a.y);
    if (segment < 1e-9) continue;
    let at = step - carried;
    while (at <= segment + 1e-9) {
      const u = at / segment;
      out.push({ x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u });
      at += step;
    }
    carried = segment - (at - step);
  }
  const last = points[points.length - 1]!;
  const tail = out[out.length - 1]!;
  if (Math.hypot(last.x - tail.x, last.y - tail.y) > 1e-6) out.push({ x: last.x, y: last.y });
  return out;
}

/** The cosine of the turn between the headings into and out of `points[i]` over `span` points either side (1 = straight). */
function turnCos(points: readonly PathPoint[], i: number, span: number): number {
  const a = points[i - span]!;
  const b = points[i]!;
  const c = points[i + span]!;
  const ux = b.x - a.x;
  const uy = b.y - a.y;
  const vx = c.x - b.x;
  const vy = c.y - b.y;
  const nu = Math.hypot(ux, uy);
  const nv = Math.hypot(vx, vy);
  if (nu < 1e-9 || nv < 1e-9) return 1;
  return Math.min(1, Math.max(-1, (ux * vx + uy * vy) / (nu * nv)));
}

const cosOf = (degrees: number): number => Math.cos((degrees * Math.PI) / 180);

/**
 * Spikes out: on a 1 px resampling, wherever the heading turns more than {@link SPIKE_TURN_DEG} across
 * {@link SPIKE_WINDOW_PX}, the points strictly inside the window are replaced by the chord across it. Repeated until
 * no spike is left (or `maxPasses`). Returns the 1 px resampled, spike-free path.
 */
export function removeSpikes(points: readonly PathPoint[], windowPx: number = SPIKE_WINDOW_PX, maxTurnDeg: number = SPIKE_TURN_DEG, maxPasses = 12): PathPoint[] {
  let path = resamplePolyline(points, 1);
  const half = Math.max(1, Math.round(windowPx / 2));
  const limit = cosOf(maxTurnDeg);
  for (let pass = 0; pass < maxPasses; pass += 1) {
    let changed = false;
    for (let i = half; i + half < path.length; i += 1) {
      if (turnCos(path, i, half) >= limit) continue;
      const a = path[i - half]!;
      const b = path[i + half]!;
      for (let k = 1; k < 2 * half; k += 1) {
        const u = k / (2 * half);
        path[i - half + k] = { x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u };
      }
      changed = true;
      i += half;
    }
    if (!changed) break;
    path = resamplePolyline(path, 1);
  }
  return path;
}

/** Gaussian smoothing of a 1 px-spaced polyline along its arc, the ends point-reflected (a straight end stays straight). */
function gaussianAlong(xs: Float64Array, ys: Float64Array, weights: Float64Array, radius: number, outX: Float64Array, outY: Float64Array): void {
  const n = xs.length;
  const last = n - 1;
  for (let i = 0; i < n; i += 1) {
    if (i >= radius && i + radius <= last) {
      // Interior: the whole kernel lands on the path — no reflection to test.
      let sx = 0;
      let sy = 0;
      const from = i - radius;
      for (let k = 0; k < weights.length; k += 1) {
        const w = weights[k]!;
        sx += w * xs[from + k]!;
        sy += w * ys[from + k]!;
      }
      outX[i] = sx;
      outY[i] = sy;
      continue;
    }
    let sx = 0;
    let sy = 0;
    for (let k = -radius; k <= radius; k += 1) {
      let j = i + k;
      let px: number;
      let py: number;
      if (j < 0) {
        j = Math.min(last, -j);
        px = 2 * xs[0]! - xs[j]!;
        py = 2 * ys[0]! - ys[j]!;
      } else if (j > last) {
        j = Math.max(0, 2 * last - j);
        px = 2 * xs[last]! - xs[j]!;
        py = 2 * ys[last]! - ys[j]!;
      } else {
        px = xs[j]!;
        py = ys[j]!;
      }
      const w = weights[k + radius]!;
      sx += w * px;
      sy += w * py;
    }
    outX[i] = sx;
    outY[i] = sy;
  }
}

/**
 * The curvature-limited fit: `center` Gaussian-smoothed along its arc (σ `sigma` points on a 1 px resampling), each
 * point projected into the disc of `tube` px around its own point of `center` (the hard constraint); then, for
 * `iterations` − 1 more rounds, the projection's correction (projected − fit) is itself smoothed, added back to the
 * fit and re-projected, so the tube's wall bends the curve smoothly instead of at a corner. `center` and the result
 * have the same length.
 */
export function tubeSmooth(center: readonly PathPoint[], tube: number = SMOOTH_TUBE_PX, iterations: number = SMOOTH_ITERATIONS, sigma: number = SMOOTH_SIGMA_PX): PathPoint[] {
  const n = center.length;
  if (n < 3) return center.map((p) => ({ x: p.x, y: p.y }));
  const radius = Math.max(1, Math.ceil(3 * sigma));
  const weights = new Float64Array(2 * radius + 1);
  let total = 0;
  for (let k = -radius; k <= radius; k += 1) total += weights[k + radius] = Math.exp(-(k * k) / (2 * sigma * sigma));
  for (let k = 0; k < weights.length; k += 1) weights[k]! /= total;
  const cx = Float64Array.from(center, (p) => p.x);
  const cy = Float64Array.from(center, (p) => p.y);
  const fitX = new Float64Array(n);
  const fitY = new Float64Array(n);
  gaussianAlong(cx, cy, weights, radius, fitX, fitY);
  const xs = Float64Array.from(fitX);
  const ys = Float64Array.from(fitY);
  const project = (): void => {
    for (let i = 0; i < n; i += 1) {
      const dx = xs[i]! - cx[i]!;
      const dy = ys[i]! - cy[i]!;
      const d = Math.hypot(dx, dy);
      if (d > tube) {
        xs[i] = cx[i]! + (dx / d) * tube;
        ys[i] = cy[i]! + (dy / d) * tube;
      }
    }
  };
  project();
  const ex = new Float64Array(n);
  const ey = new Float64Array(n);
  const sx = new Float64Array(n);
  const sy = new Float64Array(n);
  for (let round = 1; round < iterations; round += 1) {
    for (let i = 0; i < n; i += 1) {
      ex[i] = xs[i]! - fitX[i]!;
      ey[i] = ys[i]! - fitY[i]!;
    }
    // The correction, smoothed the same way as the fit.
    gaussianAlong(ex, ey, weights, radius, sx, sy);
    for (let i = 0; i < n; i += 1) {
      xs[i] = fitX[i]! + sx[i]!;
      ys[i] = fitY[i]! + sy[i]!;
    }
    project();
  }
  return Array.from(xs, (x, i) => ({ x, y: ys[i]! }));
}

/**
 * Where a path turns a CORNER (S3.4): indices of a 1 px resampling whose heading over `spanPx` before differs from its
 * heading over `spanPx` after by more than `maxTurnDeg` — a sustained change of direction, which no ±2 px tube can
 * round and a crease does not make: the path has left its crease for another there. A notch (out and back) leaves the
 * heading where it was and is not a corner; the spike passes take those.
 */
export const KINK_TURN_DEG = 45;
export const KINK_SPAN_PX = 6;

export function kinkIndices(path1px: readonly PathPoint[], maxTurnDeg: number = KINK_TURN_DEG, spanPx: number = KINK_SPAN_PX): number[] {
  const out: number[] = [];
  const limit = cosOf(maxTurnDeg);
  for (let i = spanPx; i + spanPx < path1px.length; i += 1) {
    if (turnCos(path1px, i, spanPx) >= limit) continue;
    // One corner, one split: the sharpest point (smallest cosine) of a run of over-turning points.
    let peak = i;
    let peakCos = turnCos(path1px, i, spanPx);
    while (i + 1 + spanPx < path1px.length && turnCos(path1px, i + 1, spanPx) < limit) {
      i += 1;
      const c = turnCos(path1px, i, spanPx);
      if (c < peakCos) {
        peakCos = c;
        peak = i;
      }
    }
    out.push(peak);
  }
  return out;
}

/**
 * The jaggedness measure: the largest turn, in degrees, over any {@link TURN_SPAN_PX} of the line (its headings
 * across the first and second halves of each 10 px window, on a 1 px resampling). 0 for a line shorter than 10 px.
 */
export function turningBar(points: readonly PathPoint[], spanPx: number = TURN_SPAN_PX): number {
  const path = resamplePolyline(points, 1);
  const half = Math.max(1, Math.round(spanPx / 2));
  let worstCos = 1;
  for (let i = half; i + half < path.length; i += 1) worstCos = Math.min(worstCos, turnCos(path, i, half));
  return (Math.acos(worstCos) * 180) / Math.PI;
}

/** The distance from `p` to the polyline. */
export function distanceToPolyline(p: PathPoint, line: readonly PathPoint[]): number {
  if (line.length === 1) return Math.hypot(p.x - line[0]!.x, p.y - line[0]!.y);
  let best = Infinity;
  for (let i = 0; i + 1 < line.length; i += 1) {
    const a = line[i]!;
    const b = line[i + 1]!;
    const vx = b.x - a.x;
    const vy = b.y - a.y;
    const l2 = vx * vx + vy * vy;
    const t = l2 === 0 ? 0 : Math.min(1, Math.max(0, ((p.x - a.x) * vx + (p.y - a.y) * vy) / l2));
    best = Math.min(best, Math.hypot(p.x - (a.x + t * vx), p.y - (a.y + t * vy)));
  }
  return best;
}

/** Distance from `p` to segment `i` of `line`. */
function segmentDistance(p: PathPoint, line: readonly PathPoint[], i: number): number {
  const a = line[i]!;
  const b = line[i + 1] ?? a;
  const vx = b.x - a.x;
  const vy = b.y - a.y;
  const l2 = vx * vx + vy * vy;
  const t = l2 === 0 ? 0 : Math.min(1, Math.max(0, ((p.x - a.x) * vx + (p.y - a.y) * vy) / l2));
  return Math.hypot(p.x - (a.x + t * vx), p.y - (a.y + t * vy));
}

/**
 * The median distance from `from`'s points (1 px resampling) to the polyline `to`, both running the same way along the
 * same curve (a fit and its raw path): each point searches `to` near where the last one matched — ±`window` segments
 * — rather than all of it, so the bar costs O(n) and can be measured on every extraction.
 */
export function medianDistance(from: readonly PathPoint[], to: readonly PathPoint[], window = 12): number {
  const points = resamplePolyline(from, 1);
  if (points.length === 0 || to.length === 0) return 0;
  const segments = Math.max(1, to.length - 1);
  const distances = new Float64Array(points.length);
  let at = 0;
  for (let k = 0; k < points.length; k += 1) {
    let best = Infinity;
    let bestAt = at;
    const lo = Math.max(0, at - window);
    const hi = Math.min(segments - 1, at + window);
    for (let i = lo; i <= hi; i += 1) {
      const d = segmentDistance(points[k]!, to, i);
      if (d < best) {
        best = d;
        bestAt = i;
      }
    }
    distances[k] = best;
    at = bestAt;
  }
  distances.sort();
  return distances[distances.length >> 1]!;
}

export interface SmoothResult {
  /** The drawn geometry: the smooth fit, a point every {@link DRAWN_STEP_PX}. */
  readonly smooth: readonly PathPoint[];
  /** The bars, measured on it: the largest turn over any 10 px, and its median distance to the raw path. */
  readonly maxTurnDeg: number;
  readonly medianToRaw: number;
}

/**
 * Raw path → drawn geometry: spikes out, the tube-constrained fit, resampled for drawing — and, with `measure`, its two
 * bars (NaN without: a live extraction draws the line, the rig measures what was drawn — a third of this function's
 * time was the measuring, S3.7d).
 */
export function smoothPath(raw: readonly PathPoint[], measure = true): SmoothResult {
  if (raw.length < 2) return { smooth: raw.map((p) => ({ x: p.x, y: p.y })), maxTurnDeg: 0, medianToRaw: 0 };
  const spikeFree = removeSpikes(removeSpikes(raw), SPIKE_WIDE_WINDOW_PX);
  const fitted = tubeSmooth(spikeFree);
  const smooth = resamplePolyline(fitted, DRAWN_STEP_PX);
  return measure ? { smooth, maxTurnDeg: turningBar(smooth), medianToRaw: medianDistance(smooth, raw) } : { smooth, maxTurnDeg: Number.NaN, medianToRaw: Number.NaN };
}
