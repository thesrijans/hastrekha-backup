/**
 * Corridor minimal-path search over the H9 contract field (flag `corridorSearch`).
 *
 * The Dijkstra core — MinHeap, 8-connected relaxation with √2 diagonals, lazy deletion, the
 * parent-walk pathTo, Douglas-Peucker — is ported VERBATIM from the labeler's
 * lib/scan/dev/livewire.ts. This is a production module: it imports nothing from lib/scan/dev and
 * lib/scan/dev imports nothing from it, so both sides of the import wall stand (the boundary test
 * enforces prod→dev; the labeler keeps its own copy so its D1 cost story is untouched).
 *
 * What changed against the dev original:
 *  - the cost comes from the CONTRACT field (`COST_FLOOR + (1 − field)`), never from the
 *    labeler's LoG valley operator;
 *  - relaxation is restricted to a {@link CorridorMask} built from a completion.ts-shaped
 *    Corridor (knots + halfWidths in 0–1 fractions), not a seed-centred square window;
 *  - the search is end-to-end (first knot → last knot, each end refined within a small disc)
 *    rather than interactive seed-to-cursor.
 *
 * The search is only as honest as the field under it: on a contract field, "bright" MEANS
 * P(crease), so the acceptance floors below are probability statements, calibrated against the
 * absent-hand corridor distribution — not tuned to make lines appear.
 */
import { CORRIDOR_SAMPLES, type Corridor } from "./completion";
import type { Point2 } from "./types";

/**
 * The geometry half of a completion.ts Corridor. The search never reads `id` — minor corridors
 * (corridors-minor.ts) have no ActiveLineId to put there, and forcing one would be a lie.
 */
export type CorridorShape = Pick<Corridor, "knots" | "halfWidths">;

/** Additive cost floor — the price of *any* step, even along a perfect crease. (dev-verbatim) */
export const COST_FLOOR = 0.04;

/** Radius (0–1 crop fraction) each corridor END may roam to find its best seed pixel. */
export const CORRIDOR_END_SEARCH_R = 0.04;

/**
 * Mean contract field the accepted path must reach. UNCALIBRATED placeholder — written by
 * `--calibrate-contract` as the fate-corridor p95 across fate-ABSENT hands plus a stated margin,
 * so a path has to be brighter than anything an absent hand offers.
 */
export const CORRIDOR_ACCEPT_MEAN = 0.159;

/**
 * p10 of the field along the path — the DIM end of the line must still look like crease, or the
 * path is a bright-bead chain strung through gaps.
 */
export const CORRIDOR_ACCEPT_P10 = 0.12;

/** Fraction of path points that must lie inside the corridor mask. With relaxation restricted to
 * the mask this is 1.0 by construction; the gate stays as defence-in-depth against end-refinement
 * drift, exactly because a constraint that is load-bearing should also be asserted. */
export const CORRIDOR_MIN_INSIDE_FRACTION = 0.9;

/**
 * Longest contiguous run of path points below {@link CORRIDOR_ACCEPT_P10}, as a fraction of path
 * length. A real line may fade briefly; a chained phantom is mostly gap. (There is deliberately
 * NO length gate — with knot-pinned endpoints the path length is always ~the corridor's and would
 * gate nothing.)
 */
export const CORRIDOR_MAX_GAP_FRACTION = 0.15;

/** Douglas-Peucker tolerance in px — matches skeleton-trace point density (lines.ts simplify). */
export const CORRIDOR_SIMPLIFY_EPSILON_PX = 1.6;

const SQRT2 = Math.SQRT2;

/** cost = COST_FLOOR + (1 − field): on a contract field, cheap IS probable-crease. */
export function buildCostMap(field: Float32Array, size: number): Float32Array {
  const out = new Float32Array(size * size);
  for (let i = 0; i < out.length; i += 1) out[i] = COST_FLOOR + (1 - field[i]);
  return out;
}

/* ------------------------------- Binary heap ------------------------------- */
/* Verbatim from lib/scan/dev/livewire.ts. */

class MinHeap {
  private readonly heap: Int32Array;
  private size = 0;
  constructor(
    capacity: number,
    private readonly key: Float64Array,
  ) {
    this.heap = new Int32Array(capacity);
  }
  get length(): number {
    return this.size;
  }
  push(node: number): void {
    let i = this.size;
    this.heap[this.size] = node;
    this.size += 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.key[this.heap[parent]] <= this.key[this.heap[i]]) break;
      const tmp = this.heap[parent];
      this.heap[parent] = this.heap[i];
      this.heap[i] = tmp;
      i = parent;
    }
  }
  pop(): number {
    const top = this.heap[0];
    this.size -= 1;
    if (this.size > 0) {
      this.heap[0] = this.heap[this.size];
      let i = 0;
      for (;;) {
        const left = 2 * i + 1;
        const right = left + 1;
        let smallest = i;
        if (left < this.size && this.key[this.heap[left]] < this.key[this.heap[smallest]]) smallest = left;
        if (right < this.size && this.key[this.heap[right]] < this.key[this.heap[smallest]]) smallest = right;
        if (smallest === i) break;
        const tmp = this.heap[smallest];
        this.heap[smallest] = this.heap[i];
        this.heap[i] = tmp;
        i = smallest;
      }
    }
    return top;
  }
}

/* ------------------------------ Corridor mask ------------------------------ */

export interface CorridorMask {
  /** 1 where the pixel lies inside the corridor, row-major size×size. */
  readonly inside: Uint8Array;
  /** Centreline samples in px, {@link CORRIDOR_SAMPLES} of them — end refinement reuses them. */
  readonly centreline: readonly Point2[];
}

/**
 * Rasterise a completion.ts Corridor at `size`: sample the knot polyline at
 * {@link CORRIDOR_SAMPLES} arc-length steps with linearly interpolated half-widths, and stamp the
 * union of discs. Same sampling density completion itself uses, so the two agree on what "inside
 * the corridor" means.
 */
export function buildCorridorMask(corridor: CorridorShape, size: number): CorridorMask {
  const knots = corridor.knots.map((k) => ({ x: k.x * size, y: k.y * size }));
  const widths = corridor.halfWidths.map((w) => w * size);
  const cumulative: number[] = [0];
  for (let i = 1; i < knots.length; i += 1) {
    cumulative.push(cumulative[i - 1] + Math.hypot(knots[i].x - knots[i - 1].x, knots[i].y - knots[i - 1].y));
  }
  const total = cumulative[cumulative.length - 1];
  const inside = new Uint8Array(size * size);
  const centreline: Point2[] = [];
  for (let sIndex = 0; sIndex < CORRIDOR_SAMPLES; sIndex += 1) {
    const target = (sIndex / (CORRIDOR_SAMPLES - 1)) * total;
    let seg = 1;
    while (seg < knots.length - 1 && cumulative[seg] < target) seg += 1;
    const span = cumulative[seg] - cumulative[seg - 1];
    const t = span === 0 ? 0 : (target - cumulative[seg - 1]) / span;
    const cx = knots[seg - 1].x + (knots[seg].x - knots[seg - 1].x) * t;
    const cy = knots[seg - 1].y + (knots[seg].y - knots[seg - 1].y) * t;
    const radius = widths[seg - 1] + (widths[seg] - widths[seg - 1]) * t;
    centreline.push({ x: cx, y: cy });
    const r = Math.ceil(radius);
    for (let dy = -r; dy <= r; dy += 1) {
      const py = Math.round(cy) + dy;
      if (py < 0 || py >= size) continue;
      for (let dx = -r; dx <= r; dx += 1) {
        const px = Math.round(cx) + dx;
        if (px < 0 || px >= size) continue;
        if (dx * dx + dy * dy <= radius * radius) inside[py * size + px] = 1;
      }
    }
  }
  return { inside, centreline };
}

/* ------------------------------ Masked Dijkstra ------------------------------ */

/**
 * Dijkstra core, dev-verbatim except that relaxation is restricted to `mask` nodes instead of a
 * square window. Lazy deletion: nodes may enter the heap more than once, stale entries are
 * skipped on pop; edge weight is the cost of ENTERING the neighbour, ×√2 on diagonals so path
 * length is metric.
 */
function solve(
  cost: Float32Array,
  mask: Uint8Array,
  size: number,
  seed: number,
  dist: Float64Array,
  parent: Int32Array,
): void {
  dist.fill(Number.POSITIVE_INFINITY);
  parent.fill(-1);
  dist[seed] = 0;
  const heap = new MinHeap(dist.length * 2, dist);
  heap.push(seed);
  const visited = new Uint8Array(dist.length);
  while (heap.length > 0) {
    const node = heap.pop();
    if (visited[node] === 1) continue;
    visited[node] = 1;
    const nodeX = node % size;
    const nodeY = (node / size) | 0;
    const base = dist[node];
    for (let dy = -1; dy <= 1; dy += 1) {
      const ny = nodeY + dy;
      if (ny < 0 || ny >= size) continue;
      for (let dx = -1; dx <= 1; dx += 1) {
        if (dx === 0 && dy === 0) continue;
        const nx = nodeX + dx;
        if (nx < 0 || nx >= size) continue;
        const neighbour = ny * size + nx;
        if (mask[neighbour] === 0 || visited[neighbour] === 1) continue;
        const step = dx !== 0 && dy !== 0 ? SQRT2 : 1;
        const candidate = base + cost[neighbour] * step;
        if (candidate < dist[neighbour]) {
          dist[neighbour] = candidate;
          parent[neighbour] = node;
          heap.push(neighbour);
        }
      }
    }
  }
}

/** Parent-walk, dev-verbatim: flat x,y pairs, seed→target order; 0 when unreachable. */
function pathTo(target: number, size: number, dist: Float64Array, parent: Int32Array, out: number[]): number {
  out.length = 0;
  if (!Number.isFinite(dist[target])) return 0;
  let node = target;
  while (node >= 0) {
    out.push(node % size, (node / size) | 0);
    node = parent[node];
  }
  for (let i = 0, j = out.length - 2; i < j; i += 2, j -= 2) {
    const px = out[i];
    const py = out[i + 1];
    out[i] = out[j];
    out[i + 1] = out[j + 1];
    out[j] = px;
    out[j + 1] = py;
  }
  return out.length / 2;
}

/* ----------------------------- Douglas-Peucker ----------------------------- */
/* Verbatim from lib/scan/dev/livewire.ts. */

function perpendicularDistance(p: readonly number[], a: readonly number[], b: readonly number[]): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const lengthSq = dx * dx + dy * dy;
  if (lengthSq === 0) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / lengthSq));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

export function simplifyPolyline(
  points: readonly (readonly number[])[],
  epsilon: number = CORRIDOR_SIMPLIFY_EPSILON_PX,
): number[][] {
  if (points.length <= 2) return points.map((p) => [p[0], p[1]]);
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const stack: Array<readonly [number, number]> = [[0, points.length - 1]];
  while (stack.length > 0) {
    const [from, to] = stack.pop() as readonly [number, number];
    let worst = 0;
    let worstAt = -1;
    for (let i = from + 1; i < to; i += 1) {
      const d = perpendicularDistance(points[i], points[from], points[to]);
      if (d > worst) {
        worst = d;
        worstAt = i;
      }
    }
    if (worst > epsilon && worstAt > 0) {
      keep[worstAt] = 1;
      stack.push([from, worstAt], [worstAt, to]);
    }
  }
  const out: number[][] = [];
  for (let i = 0; i < points.length; i += 1) {
    if (keep[i] === 1) out.push([points[i][0], points[i][1]]);
  }
  return out;
}

/* ------------------------------ Corridor search ------------------------------ */

export interface CorridorResult {
  /** Simplified path, px points at `size`. */
  readonly points: readonly Point2[];
  readonly meanField: number;
  readonly p10Field: number;
  readonly insideFraction: number;
  readonly maxGapFraction: number;
}

/** Best of 5 candidate seeds (centre + 4 compass offsets at the search radius) by field value. */
function refineEnd(field: Float32Array, mask: Uint8Array, size: number, at: Point2): number {
  const radius = CORRIDOR_END_SEARCH_R * size;
  const candidates: Point2[] = [
    at,
    { x: at.x + radius, y: at.y },
    { x: at.x - radius, y: at.y },
    { x: at.x, y: at.y + radius },
    { x: at.x, y: at.y - radius },
  ];
  let best = -1;
  let bestValue = -1;
  for (const c of candidates) {
    const px = Math.min(size - 1, Math.max(0, Math.round(c.x)));
    const py = Math.min(size - 1, Math.max(0, Math.round(c.y)));
    const node = py * size + px;
    if (mask[node] === 0) continue;
    if (field[node] > bestValue) {
      bestValue = field[node];
      best = node;
    }
  }
  return best;
}

/**
 * End-to-end minimal path down one corridor, or null. Null means: an endpoint had no in-mask
 * seed, the ends were mutually unreachable inside the mask, or the path failed an acceptance
 * gate. The gates make the null honest — a corridor search that always returns SOMETHING is a
 * phantom-line machine (measured pre-contract: fate-corridor p90 ≈ 0.8 on fate-ABSENT hands).
 */
export function searchCorridor(field: Float32Array, size: number, corridor: CorridorShape): CorridorResult | null {
  const { inside, centreline } = buildCorridorMask(corridor, size);
  const seedA = refineEnd(field, inside, size, centreline[0]);
  const seedB = refineEnd(field, inside, size, centreline[centreline.length - 1]);
  if (seedA < 0 || seedB < 0) return null;

  const cost = buildCostMap(field, size);
  const dist = new Float64Array(size * size);
  const parent = new Int32Array(size * size);
  solve(cost, inside, size, seedA, dist, parent);
  const flat: number[] = [];
  const count = pathTo(seedB, size, dist, parent, flat);
  if (count < 2) return null;

  let sum = 0;
  let insideCount = 0;
  const values = new Float32Array(count);
  let gapRun = 0;
  let worstGap = 0;
  for (let i = 0; i < count; i += 1) {
    const node = flat[i * 2 + 1] * size + flat[i * 2];
    const value = field[node];
    values[i] = value;
    sum += value;
    if (inside[node] === 1) insideCount += 1;
    if (value < CORRIDOR_ACCEPT_P10) {
      gapRun += 1;
      if (gapRun > worstGap) worstGap = gapRun;
    } else {
      gapRun = 0;
    }
  }
  const sorted = Float32Array.from(values).sort();
  const result: CorridorResult = {
    points: simplifyPolyline(Array.from({ length: count }, (_, i) => [flat[i * 2], flat[i * 2 + 1]])).map(
      (p) => ({ x: p[0], y: p[1] }),
    ),
    meanField: sum / count,
    p10Field: sorted[Math.floor(0.1 * count)],
    insideFraction: insideCount / count,
    maxGapFraction: worstGap / count,
  };
  if (result.meanField < CORRIDOR_ACCEPT_MEAN) return null;
  if (result.p10Field < CORRIDOR_ACCEPT_P10) return null;
  if (result.insideFraction < CORRIDOR_MIN_INSIDE_FRACTION) return null;
  if (result.maxGapFraction >= CORRIDOR_MAX_GAP_FRACTION) return null;
  return result;
}
