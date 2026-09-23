/**
 * @file Trace, don't fit (flag `rekhaTrace`, S2).
 *
 * THE FAULT THIS ANSWERS. extractLines finds a line from skeleton fragments,
 * then completion.ts FITS a curve through its corridor — and the drawn line is
 * the fit. On a real palm that put the heart line above its crease and drew the
 * life line straight down the palm centre instead of round the thenar
 * (docs/reference/scan-video-15s-heart-life-offset.png): the corridor prior
 * shaped the curve wherever the fragments were sparse. This module keeps
 * extraction's DECISION (which line, from which fragments) and replaces its
 * GEOMETRY with the crease itself:
 *
 *  1. VALLEY. The pre-CLAHE black-hat depth of the rectified luma at 256 (the
 *     contract's depth plane, radii scaled to the resolution), normalised
 *     LOCALLY per line: each pixel's depth as a ratio to the median depth inside
 *     that line's corridor band — never a per-frame global percentile, so a pale
 *     palm and a dark one, a well-lit heart line and a shadowed life line, are
 *     each measured against their own skin. cost = 0.04 + (1 − valley).
 *  2. SEEDS. The line's OBSERVED skeleton fragments — the ones completion's own
 *     selectSeeds assigned to it, not the fitted curve — ordered along its
 *     corridor.
 *  3. PATH. A minimal path (corridor-path's Dijkstra, ported) through each
 *     fragment and from fragment to fragment, then EXTENDED from both ends along
 *     the valley until the mean cost over the last STOP_WINDOW_PX exceeds
 *     STOP_COST or the corridor band is left. The ends are where the crease
 *     fades, not where the corridor's knots are.
 *
 * The result is drawn; the fitted curve is kept only for features. Stretches
 * seeded by observation are marked observed; pure valley extension is not, and
 * the caller draws it dimmer. Nothing is drawn beyond where the tracer stopped.
 *
 * Layer: lib/scan (production). Pure. Imports nothing from lib/scan/dev. The
 * frozen core (ridge, completion, …) is CALLED, never edited.
 */
import { CORRIDORS, corridorFor, projectToCorridor, selectSeeds, type Poly } from "./completion";
import { buildCorridorMask } from "./corridor-path";
import type { LineExtraction } from "./lines";
import { MASK_SIZE, RECTIFIED_SIZE, type ActiveLineId, type Point2, type TracedLine } from "./types";

/* ------------------------------------------------------------------------ */
/* Constants                                                                  */
/* ------------------------------------------------------------------------ */

/** The tracer works at the rectified crop's own resolution. */
export const TRACE_SIZE = RECTIFIED_SIZE;

/** ridge.ts BLACKHAT_RADII ([2, 4, 6] at the 128 working grid), scaled to 256: the same creases. */
export const TRACE_BLACKHAT_RADII: readonly number[] = [4, 8, 12];

/**
 * With SQUARE elements the multi-radius max is exactly the largest radius alone: a 25 px square is a
 * 9 px square dilated by a 17 px one, so closing by it fills at least as much everywhere, and the max
 * over [4, 8, 12] IS the black-hat at 12 (verified: max |difference| 0 over five session stills).
 * One pass instead of three — 10.8 ms became about a third of it.
 */
const TRACE_BLACKHAT_RADIUS = Math.max(...TRACE_BLACKHAT_RADII);

/** cost = COST_FLOOR + (1 − valley), corridor-path's floor. */
export const TRACE_COST_FLOOR = 0.04;

/**
 * valley = clamp((depth / bandMedian − 1) / (VALLEY_RATIO_FULL − 1), 0, 1): skin at or below its
 * band's median depth is not a valley at all; a pixel VALLEY_RATIO_FULL times as deep is fully one.
 */
export const VALLEY_RATIO_FULL = 3;

/** Extension stops when the mean cost over the last STOP_WINDOW_PX px exceeds this. */
export const STOP_COST = 0.8;
export const STOP_WINDOW_PX = 6;

/**
 * A fragment's own path is kept within this of its observed skeleton (256 px). 2, not 3: at 3 the
 * valley pulled the seeded path 2–3 px further from ground truth than the seeds themselves (heart on
 * lines-current-02: seeds 6.6 px at 512, seeded path 9.0, iteration 5).
 */
export const FRAGMENT_TUBE_PX = 2;

/**
 * A seed's END is trimmed while its local direction turns more than this from the corridor's
 * (cosine 0.5 = 60 degrees): tracePolylines ends a fragment wherever the skeleton branched, and
 * a fragment that followed a branch up toward a finger ends in a hook the path would then follow
 * (iteration 2: the heart line spiked to (210, 90) at 512 on lines-current-02).
 */
export const SEED_HOOK_COS = 0.7;

/**
 * Tracing never leaves the palm: the rectified crop's `inside` mask, eroded by this (256 px). At
 * the palm's own silhouette the dark background beside bright skin is, to a black-hat, the deepest
 * "valley" in the crop — iteration 2's life line ran up it on session still 12.
 */
export const PALM_MARGIN_PX = 4;

/**
 * The palm in the rectified crop's canonical frame: the on-curve points of the Pothi's registered
 * neutral palm (public/plates/hand-plate, the mesh baked onto rectify.ts's
 * CANONICAL_ANCHORS), closed along the top edge where the fingers leave the crop. The crop's own
 * `inside` mask only says where the camera frame exists; this says where the PALM is, so a trace
 * cannot walk the silhouette — whose black-hat depth (p90 0.33) overlaps a crease's (p95 0.30) too
 * far for any depth ceiling to separate them.
 */
export const CANONICAL_PALM: readonly Point2[] = [
  { x: 0.165, y: 0 },
  { x: 0.154, y: 0.145 },
  { x: 0.13, y: 0.74 },
  { x: 0.22, y: 0.94 },
  { x: 0.5, y: 0.97 },
  { x: 0.82, y: 0.82 },
  { x: 0.95, y: 0.46 },
  { x: 0.96, y: 0.26 },
  { x: 0.928, y: 0.16 },
  { x: 0.925, y: 0 },
];

/**
 * A bridge joins two seeds only if it runs ALONG the corridor: its lateral displacement may not
 * exceed its advance (45 degrees) by more than this slack (256 px). Fragments of one crease are
 * collinear; a sideways jump means completion handed this line a piece of a neighbouring crease
 * (iteration 3: heart jumped 28 px down onto the head line's start at the thumb web).
 */
export const BRIDGE_LATERAL_SLACK_PX = 6;

/**
 * Extension direction: how far back the initial tangent is read, how much a turn costs, and how
 * much of the heading each step keeps. A crease does not turn quickly; with a light penalty and a
 * short memory (0.25, 0.7 — iteration 5) the life line's extension on lines-current-02 swung onto a
 * stronger neighbouring valley and ended 24.8 px from ground truth.
 */
const TANGENT_BACK_PX = 8;
const TURN_PENALTY = 0.6;
const HEADING_MEMORY = 0.85;
/** Hard cap on one end's extension, 256 px — half the crop. */
const MAX_EXTEND_PX = 128;

/* ------------------------------------------------------------------------ */
/* Valley                                                                     */
/* ------------------------------------------------------------------------ */

/** Rectified RGBA → 0–1 luma. */
export function lumaFromRgba(rgba: Uint8ClampedArray, size: number): Float32Array {
  const out = new Float32Array(size * size);
  for (let i = 0; i < out.length; i += 1) {
    const at = i * 4;
    out[i] = (0.2126 * rgba[at]! + 0.7152 * rgba[at + 1]! + 0.0722 * rgba[at + 2]!) / 255;
  }
  return out;
}

/**
 * Running max (or min) over a window of half-width `half` along rows or columns — van Herk /
 * Gil-Werman: a forward and a backward block scan, then one comparison per pixel, O(1) per pixel
 * whatever the window.
 */
function runningExtreme(src: Float32Array, dst: Float32Array, size: number, half: number, isMax: boolean, alongColumns: boolean): void {
  const w = 2 * half + 1;
  const n = size + 2 * half;
  const g = new Float32Array(n);
  const h = new Float32Array(n);
  const line = new Float32Array(n);
  const fill = isMax ? -Infinity : Infinity;
  for (let l = 0; l < size; l += 1) {
    for (let i = 0; i < n; i += 1) {
      const k = i - half;
      line[i] = k < 0 || k >= size ? fill : src[alongColumns ? k * size + l : l * size + k]!;
    }
    for (let i = 0; i < n; i += 1) {
      const v = line[i]!;
      g[i] = i % w === 0 ? v : isMax ? Math.max(g[i - 1]!, v) : Math.min(g[i - 1]!, v);
    }
    for (let i = n - 1; i >= 0; i -= 1) {
      const v = line[i]!;
      h[i] = i === n - 1 || (i + 1) % w === 0 ? v : isMax ? Math.max(h[i + 1]!, v) : Math.min(h[i + 1]!, v);
    }
    for (let k = 0; k < size; k += 1) {
      const a = h[k]!;
      const b = g[k + 2 * half]!;
      dst[alongColumns ? k * size + l : l * size + k] = isMax ? (a > b ? a : b) : a < b ? a : b;
    }
  }
}

/**
 * The black-hat depth at 256: at each radius, what a CLOSING had to add to fill the dark creases
 * narrower than the element, kept as the per-pixel max over the radii. This is ridge.ts's
 * blackHatMulti (the contract's depth plane) with one change: a SQUARE element by running extrema
 * instead of ridge.ts's disc. The disc is O(r) per pixel and at 256 with radii 4/8/12 took 80 ms a
 * frame against the S2 cost bar of 15; the square is O(1) per pixel. What "depth" means is
 * unchanged (how far a crease sits below the skin around it), and the per-line ratio
 * normalisation below divides out the square's slightly larger fill.
 */
export function valleyDepth(luma: Float32Array, size: number = TRACE_SIZE): Float32Array {
  const out = new Float32Array(size * size);
  const a = new Float32Array(size * size);
  const b = new Float32Array(size * size);
  for (const radius of [TRACE_BLACKHAT_RADIUS]) {
    runningExtreme(luma, a, size, radius, true, false);
    runningExtreme(a, b, size, radius, true, true);
    runningExtreme(b, a, size, radius, false, false);
    runningExtreme(a, b, size, radius, false, true);
    for (let i = 0; i < out.length; i += 1) {
      const d = b[i]! - luma[i]!;
      if (d > out[i]!) out[i] = d;
    }
  }
  return out;
}


export interface LineCost {
  readonly cost: Float32Array;
  /** The line's corridor band at TRACE_SIZE (1 inside). */
  readonly band: Uint8Array;
  /** The band's median depth — the local normaliser. */
  readonly median: number;
}

/** k-th smallest of `values`, in place (quickselect). */
function select(values: Float32Array, k: number): number {
  let lo = 0;
  let hi = values.length - 1;
  while (lo < hi) {
    const pivot = values[(lo + hi) >> 1]!;
    let i = lo;
    let j = hi;
    while (i <= j) {
      while (values[i]! < pivot) i += 1;
      while (values[j]! > pivot) j -= 1;
      if (i <= j) {
        const t = values[i]!;
        values[i] = values[j]!;
        values[j] = t;
        i += 1;
        j -= 1;
      }
    }
    if (k <= j) hi = j;
    else if (k >= i) lo = i;
    else return values[k]!;
  }
  return values[k]!;
}

/** A line's corridor band at `size`: the mask and its member indices. */
export interface Band {
  readonly mask: Uint8Array;
  readonly members: Int32Array;
}

export function bandFor(id: ActiveLineId, size: number = TRACE_SIZE): Band {
  const mask = buildCorridorMask(CORRIDORS[id], size).inside;
  const members: number[] = [];
  for (let i = 0; i < mask.length; i += 1) if (mask[i]) members.push(i);
  return { mask, members: Int32Array.from(members) };
}

/** One line's cost map: depth as a ratio to the median depth inside that line's own band. */
export function lineCost(depth: Float32Array, id: ActiveLineId, size: number = TRACE_SIZE, bandIn?: Band): LineCost {
  const { mask: bandShared, members } = bandIn ?? bandFor(id, size);
  const band = Uint8Array.from(bandShared);
  const values = new Float32Array(members.length);
  for (let k = 0; k < members.length; k += 1) values[k] = depth[members[k]!]!;
  const median = values.length > 0 ? select(values, values.length >> 1) : 0;
  const cost = new Float32Array(size * size);
  const denominator = median > 1e-6 ? median : 1e-6;
  for (let i = 0; i < cost.length; i += 1) {
    const ratio = depth[i]! / denominator;
    let valley = (ratio - 1) / (VALLEY_RATIO_FULL - 1);
    if (valley < 0) valley = 0;
    else if (valley > 1) valley = 1;
    cost[i] = TRACE_COST_FLOOR + (1 - valley);
  }
  return { cost, band, median };
}

/* ------------------------------------------------------------------------ */
/* Dijkstra — ported from corridor-path.ts (itself ported from livewire.ts)   */
/* ------------------------------------------------------------------------ */

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
  clear(): void {
    this.size = 0;
  }
  push(node: number): void {
    if (this.size >= this.heap.length) return; // 8 entries per pixel: not reached in practice
    let i = this.size;
    this.heap[this.size] = node;
    this.size += 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.key[this.heap[parent]!]! <= this.key[this.heap[i]!]!) break;
      const tmp = this.heap[parent]!;
      this.heap[parent] = this.heap[i]!;
      this.heap[i] = tmp;
      i = parent;
    }
  }
  pop(): number {
    const top = this.heap[0]!;
    this.size -= 1;
    if (this.size > 0) {
      this.heap[0] = this.heap[this.size]!;
      let i = 0;
      for (;;) {
        const left = 2 * i + 1;
        const right = left + 1;
        let smallest = i;
        if (left < this.size && this.key[this.heap[left]!]! < this.key[this.heap[smallest]!]!) smallest = left;
        if (right < this.size && this.key[this.heap[right]!]! < this.key[this.heap[smallest]!]!) smallest = right;
        if (smallest === i) break;
        const tmp = this.heap[smallest]!;
        this.heap[smallest] = this.heap[i]!;
        this.heap[i] = tmp;
        i = smallest;
      }
    }
    return top;
  }
}

/** Scratch buffers for one size, reused across solves. */
class Solver {
  readonly dist: Float64Array;
  readonly parent: Int32Array;
  readonly visited: Uint8Array;
  private readonly heap: MinHeap;
  constructor(readonly size: number) {
    this.dist = new Float64Array(size * size);
    this.parent = new Int32Array(size * size);
    this.visited = new Uint8Array(size * size);
    this.heap = new MinHeap(size * size * 8, this.dist);
  }

  /**
   * Masked 8-connected Dijkstra from `source` until `target` is settled (early exit), √2 on
   * diagonals, entering cost per pixel. Returns the source→target pixel path, or null.
   */
  path(cost: Float32Array, mask: Uint8Array, source: number, target: number): number[] | null {
    const { size, dist, parent, visited } = this;
    dist.fill(Number.POSITIVE_INFINITY);
    parent.fill(-1);
    visited.fill(0);
    dist[source] = 0;
    const heap = this.heap;
    heap.clear();
    heap.push(source);
    while (heap.length > 0) {
      const node = heap.pop();
      if (visited[node] === 1) continue;
      visited[node] = 1;
      if (node === target) break;
      const nx0 = node % size;
      const ny0 = (node / size) | 0;
      const base = dist[node]!;
      for (let dy = -1; dy <= 1; dy += 1) {
        const ny = ny0 + dy;
        if (ny < 0 || ny >= size) continue;
        for (let dx = -1; dx <= 1; dx += 1) {
          if (dx === 0 && dy === 0) continue;
          const nx = nx0 + dx;
          if (nx < 0 || nx >= size) continue;
          const next = ny * size + nx;
          if (mask[next] === 0 || visited[next] === 1) continue;
          const candidate = base + cost[next]! * (dx !== 0 && dy !== 0 ? Math.SQRT2 : 1);
          if (candidate < dist[next]!) {
            dist[next] = candidate;
            parent[next] = node;
            heap.push(next);
          }
        }
      }
    }
    if (!Number.isFinite(dist[target]!)) return null;
    const out: number[] = [];
    for (let node = target; node >= 0; node = parent[node]!) out.push(node);
    return out.reverse();
  }
}

/* ------------------------------------------------------------------------ */
/* The tracer                                                                 */
/* ------------------------------------------------------------------------ */

/** How a traced pixel came to be drawn. */
export type TraceKind = "observed" | "bridge" | "extension";

export interface TracedPath {
  readonly id: ActiveLineId;
  /** Pixel path at TRACE_SIZE, in order along the corridor. */
  readonly pixels: readonly number[];
  readonly kinds: readonly TraceKind[];
  /** Why each end stopped — the S2.6 diagnostic. */
  readonly stops: readonly [TraceStop, TraceStop];
  /** Seeds used, at TRACE_SIZE, ordered along the corridor. */
  readonly seeds: readonly Poly[];
  /** The band median the cost was normalised by. */
  readonly bandMedian: number;
}

export type TraceStop = "faded" | "left-band" | "blocked" | "cap";

const clampIndex = (x: number, y: number, size: number): number =>
  Math.min(size - 1, Math.max(0, Math.round(y))) * size + Math.min(size - 1, Math.max(0, Math.round(x)));

/** A disc-union tube around a polyline, for keeping a fragment's own path on its skeleton. */
function tubeMask(poly: Poly, size: number, radius: number, into: Uint8Array): Uint8Array {
  into.fill(0);
  const r2 = radius * radius;
  const stamp = (cx: number, cy: number): void => {
    for (let dy = -radius; dy <= radius; dy += 1) {
      const y = Math.round(cy) + dy;
      if (y < 0 || y >= size) continue;
      for (let dx = -radius; dx <= radius; dx += 1) {
        if (dx * dx + dy * dy > r2) continue;
        const x = Math.round(cx) + dx;
        if (x >= 0 && x < size) into[y * size + x] = 1;
      }
    }
  };
  for (let k = 0; k < poly.length; k += 1) {
    const a = poly[k]!;
    const b = poly[k + 1];
    if (b === undefined) {
      stamp(a.x, a.y);
      break;
    }
    const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y)));
    for (let s = 0; s <= steps; s += 1) stamp(a.x + ((b.x - a.x) * s) / steps, a.y + ((b.y - a.y) * s) / steps);
  }
  return into;
}

/** The cheapest pixel within `radius` of (x, y) — snaps a 128-grid skeleton point onto the 256 valley. */
function snap(cost: Float32Array, size: number, x: number, y: number, radius: number): number {
  let best = clampIndex(x, y, size);
  let bestCost = cost[best]!;
  for (let dy = -radius; dy <= radius; dy += 1) {
    for (let dx = -radius; dx <= radius; dx += 1) {
      if (dx * dx + dy * dy > radius * radius) continue;
      const at = clampIndex(x + dx, y + dy, size);
      if (cost[at]! < bestCost) {
        bestCost = cost[at]!;
        best = at;
      }
    }
  }
  return best;
}

/** Extend from the END of `pixels` along the valley; returns the added pixels and why it stopped. */
function extend(
  pixels: readonly number[],
  cost: Float32Array,
  band: Uint8Array,
  size: number,
): { added: number[]; stop: TraceStop } {
  const on = new Set(pixels);
  const tail = pixels[pixels.length - 1]!;
  const back = pixels[Math.max(0, pixels.length - 1 - TANGENT_BACK_PX)]!;
  let dirX = (tail % size) - (back % size);
  let dirY = ((tail / size) | 0) - ((back / size) | 0);
  let norm = Math.hypot(dirX, dirY);
  if (norm < 1e-9) return { added: [], stop: "blocked" };
  dirX /= norm;
  dirY /= norm;

  const added: number[] = [];
  const window: number[] = [];
  let at = tail;
  let stop: TraceStop = "cap";
  for (let step = 0; step < MAX_EXTEND_PX; step += 1) {
    const x0 = at % size;
    const y0 = (at / size) | 0;
    let best = -1;
    let bestScore = Infinity;
    let bestDx = 0;
    let bestDy = 0;
    for (let dy = -1; dy <= 1; dy += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        if (dx === 0 && dy === 0) continue;
        const len = Math.hypot(dx, dy);
        const dot = (dx * dirX + dy * dirY) / len;
        if (dot < 0.35) continue; // forward only — within ~70° of the heading
        const x = x0 + dx;
        const y = y0 + dy;
        if (x < 0 || y < 0 || x >= size || y >= size) continue;
        const next = y * size + x;
        if (on.has(next)) continue;
        const score = cost[next]! + TURN_PENALTY * (1 - dot);
        if (score < bestScore) {
          bestScore = score;
          best = next;
          bestDx = dx / len;
          bestDy = dy / len;
        }
      }
    }
    if (best < 0) {
      stop = "blocked";
      break;
    }
    if (band[best] === 0) {
      stop = "left-band";
      break;
    }
    added.push(best);
    on.add(best);
    window.push(cost[best]!);
    if (window.length > STOP_WINDOW_PX) window.shift();
    if (window.length === STOP_WINDOW_PX && window.reduce((a, b) => a + b, 0) / STOP_WINDOW_PX > STOP_COST) {
      stop = "faded";
      break;
    }
    dirX = HEADING_MEMORY * dirX + (1 - HEADING_MEMORY) * bestDx;
    dirY = HEADING_MEMORY * dirY + (1 - HEADING_MEMORY) * bestDy;
    norm = Math.hypot(dirX, dirY);
    dirX /= norm;
    dirY /= norm;
    at = best;
  }
  // The crease ended where the cost rose: drop the trailing pixels past STOP_COST.
  while (added.length > 0 && cost[added[added.length - 1]!]! > STOP_COST) added.pop();
  return { added, stop };
}

/**
 * Resample a polyline at ≤ 1 px steps. tracePolylines' fragments are simplified to a few vertices,
 * so a hook can be ONE long segment; direction tests over "±3 points" then span half the fragment
 * and average the hook away (iteration 3). At 1 px spacing ±3 points means ±3 px.
 */
function densify(poly: Poly): Poly {
  const out: Point2[] = [];
  for (let k = 0; k < poly.length; k += 1) {
    const a = poly[k]!;
    const b = poly[k + 1];
    if (b === undefined) {
      out.push(a);
      break;
    }
    const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y)));
    for (let s = 0; s < steps; s += 1) out.push({ x: a.x + ((b.x - a.x) * s) / steps, y: a.y + ((b.y - a.y) * s) / steps });
  }
  return out;
}

/**
 * The longest run of a seed that lies inside `mask` (the line's band, palm-clipped). Extraction's
 * fragments are not confined to the palm — a skeleton traced along the thumb web's silhouette was
 * handed to life and head on session still 12 — and a seed outside the palm is no crease at all.
 */
function clipToMask(poly: Poly, mask: Uint8Array, size: number): Poly {
  let best: Point2[] = [];
  let run: Point2[] = [];
  for (const p of poly) {
    if (mask[clampIndex(p.x, p.y, size)]) run.push(p);
    else {
      if (run.length > best.length) best = run;
      run = [];
    }
  }
  return run.length > best.length ? run : best;
}

/** Local direction of `poly` at i (over ±3 points) against the corridor tangent there: |cos|. */
function corridorAgreement(poly: Poly, i: number, samples: ReturnType<typeof corridorFor>, size: number): number {
  const a = poly[Math.max(0, i - 3)]!;
  const b = poly[Math.min(poly.length - 1, i + 3)]!;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (len < 1e-9) return 1;
  const sample = samples[projectToCorridor(samples, poly[i]!, size).index]!;
  return Math.abs((dx / len) * sample.tx + (dy / len) * sample.ty);
}

/** Drop points from each end of a seed while it runs across the corridor rather than along it. */
function trimHooks(poly: Poly, samples: ReturnType<typeof corridorFor>, size: number): Poly {
  let start = 0;
  let end = poly.length - 1;
  while (start < end && corridorAgreement(poly, start, samples, size) < SEED_HOOK_COS) start += 1;
  while (end > start && corridorAgreement(poly, end, samples, size) < SEED_HOOK_COS) end -= 1;
  return poly.slice(start, end + 1);
}

/** Scanline fill of a polygon given in 0–1 fractions, at `size`. */
export function rasterPolygon(poly: readonly Point2[], size: number): Uint8Array {
  const out = new Uint8Array(size * size);
  for (let y = 0; y < size; y += 1) {
    const cy = (y + 0.5) / size;
    const xs: number[] = [];
    for (let i = 0; i < poly.length; i += 1) {
      const a = poly[i]!;
      const b = poly[(i + 1) % poly.length]!;
      if ((a.y <= cy && b.y > cy) || (b.y <= cy && a.y > cy)) xs.push(a.x + ((cy - a.y) / (b.y - a.y)) * (b.x - a.x));
    }
    xs.sort((m, n) => m - n);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const x0 = Math.max(0, Math.ceil(xs[k]! * size - 0.5));
      const x1 = Math.min(size - 1, Math.floor(xs[k + 1]! * size - 0.5));
      for (let x = x0; x <= x1; x += 1) out[y * size + x] = 1;
    }
  }
  return out;
}

/** Where tracing may go: the crop's `inside` AND the canonical palm, eroded by `margin` px (square). */
export function palmMask(inside: Uint8Array, size: number, margin: number = PALM_MARGIN_PX): Uint8Array {
  const out = new Uint8Array(size * size);
  const rowOk = new Uint8Array(size * size);
  const palm = rasterPolygon(CANONICAL_PALM, size);
  for (let y = 0; y < size; y += 1) {
    let run = 0;
    for (let x = 0; x < size; x += 1) {
      run = inside[y * size + x] && palm[y * size + x] ? run + 1 : 0;
      if (run > 2 * margin) rowOk[y * size + x - margin] = 1;
    }
  }
  for (let x = 0; x < size; x += 1) {
    let run = 0;
    for (let y = 0; y < size; y += 1) {
      run = rowOk[y * size + x] ? run + 1 : 0;
      if (run > 2 * margin) out[(y - margin) * size + x] = 1;
    }
  }
  return out;
}

/**
 * Trace one line through the valley from its observed fragments.
 * @param seeds128 the line's observed fragments in the MASK_SIZE grid (completion's selectSeeds).
 */
export function traceLine(
  id: ActiveLineId,
  seeds128: readonly Poly[],
  lc: LineCost,
  solver: Solver,
  size: number = TRACE_SIZE,
): TracedPath | null {
  if (seeds128.length === 0) return null;
  const scale = size / MASK_SIZE;
  const samples = corridorFor(id);
  // Seeds at 256, each oriented and ordered along the corridor by arc position.
  // Order by arc position along the corridor, orient each seed forward, then TRIM overlap: a seed
  // point at or behind the arc position already covered is dropped, so a bridge can never run back
  // up the corridor (iteration 1 drew an "N" doing exactly that). A seed wholly behind is skipped.
  const oriented = seeds128
    .map((poly) => clipToMask(densify(poly.map((p) => ({ x: (p.x + 0.5) * scale - 0.5, y: (p.y + 0.5) * scale - 0.5 }))), lc.band, size))
    .filter((poly) => poly.length >= 2)
    .map((poly) => {
      const arc = poly.map((p) => projectToCorridor(samples, p, size).s);
      const forward = arc[0]! <= arc[arc.length - 1]!;
      return { poly: forward ? poly : [...poly].reverse(), arc: forward ? arc : [...arc].reverse() };
    })
    .sort((a, b) => a.arc[0]! - b.arc[0]!);
  const seeds: Poly[] = [];
  let covered = -Infinity;
  for (const entry of oriented) {
    const kept: Point2[] = [];
    for (let i = 0; i < entry.poly.length; i += 1) if (entry.arc[i]! > covered) kept.push(entry.poly[i]!);
    const trimmed = trimHooks(kept, samples, size);
    if (trimmed.length < 2) continue;
    seeds.push(trimmed);
    covered = Math.max(covered, ...entry.arc);
  }
  if (seeds.length === 0) return null;

  const tube = new Uint8Array(size * size);
  const pixels: number[] = [];
  const kinds: TraceKind[] = [];
  const append = (path: readonly number[], kind: TraceKind): void => {
    for (const p of path) {
      if (pixels.length > 0 && pixels[pixels.length - 1] === p) continue;
      pixels.push(p);
      kinds.push(kind);
    }
  };

  const used: Poly[] = [];
  for (let k = 0; k < seeds.length; k += 1) {
    const poly = seeds[k]!;
    const start = snap(lc.cost, size, poly[0]!.x, poly[0]!.y, 2);
    const end = snap(lc.cost, size, poly[poly.length - 1]!.x, poly[poly.length - 1]!.y, 2);
    if (pixels.length > 0) {
      // Would the join run along the corridor, or sideways onto another crease?
      const from = pixels[pixels.length - 1]!;
      const a = projectToCorridor(samples, { x: from % size, y: (from / size) | 0 }, size);
      const b = projectToCorridor(samples, { x: start % size, y: (start / size) | 0 }, size);
      const tangent = samples[a.index]!;
      const dx = (start % size) - (from % size);
      const dy = ((start / size) | 0) - ((from / size) | 0);
      const along = Math.abs(dx * tangent.tx + dy * tangent.ty);
      const lateral = Math.abs(b.offset - a.offset);
      if (lateral > along + BRIDGE_LATERAL_SLACK_PX) continue;
      // Bridge from the previous fragment's end through the valley, inside the band.
      const bridge = solver.path(lc.cost, lc.band, pixels[pixels.length - 1]!, start);
      if (bridge !== null) append(bridge, "bridge");
    }
    tubeMask(poly, size, FRAGMENT_TUBE_PX, tube);
    tube[start] = 1;
    tube[end] = 1;
    const own = solver.path(lc.cost, tube, start, end);
    append(own ?? [start, end], "observed");
    used.push(poly);
  }
  if (pixels.length < 2) return null;

  const forward = extend(pixels, lc.cost, lc.band, size);
  const backward = extend([...pixels].reverse(), lc.cost, lc.band, size);
  const all = [...[...backward.added].reverse(), ...pixels, ...forward.added];
  const allKinds: TraceKind[] = [
    ...backward.added.map((): TraceKind => "extension"),
    ...kinds,
    ...forward.added.map((): TraceKind => "extension"),
  ];
  return { id, pixels: all, kinds: allKinds, stops: [backward.stop, forward.stop], seeds: used, bandMedian: lc.median };
}

/* ------------------------------------------------------------------------ */
/* Extraction output → traced lines                                           */
/* ------------------------------------------------------------------------ */

/** Douglas–Peucker keep-flags over pixel points, never dropping a kind boundary. */
function simplifyKeep(points: readonly Point2[], kinds: readonly TraceKind[], epsilon: number): boolean[] {
  const keep = points.map(() => false);
  keep[0] = true;
  keep[points.length - 1] = true;
  for (let i = 1; i < points.length; i += 1) if (kinds[i] !== kinds[i - 1]) keep[i - 1] = keep[i] = true;
  const stack: [number, number][] = [];
  let lastKept = 0;
  for (let i = 1; i < points.length; i += 1) {
    if (keep[i]) {
      stack.push([lastKept, i]);
      lastKept = i;
    }
  }
  while (stack.length > 0) {
    const [a, b] = stack.pop()!;
    const pa = points[a]!;
    const pb = points[b]!;
    const len = Math.hypot(pb.x - pa.x, pb.y - pa.y);
    let worst = -1;
    let worstDist = epsilon;
    for (let i = a + 1; i < b; i += 1) {
      const p = points[i]!;
      const d = len < 1e-9 ? Math.hypot(p.x - pa.x, p.y - pa.y) : Math.abs((pb.x - pa.x) * (pa.y - p.y) - (pa.x - p.x) * (pb.y - pa.y)) / len;
      if (d > worstDist) {
        worstDist = d;
        worst = i;
      }
    }
    if (worst >= 0) {
      keep[worst] = true;
      stack.push([a, worst], [worst, b]);
    }
  }
  return keep;
}

/**
 * A traced path as the pipeline's TracedLine, in the MASK_SIZE grid everything downstream draws in.
 * Observed and bridge stretches are `observed: true`; extension is `observed: false`.
 */
export function tracedToLine(path: TracedPath, size: number = TRACE_SIZE): TracedLine {
  const scale = MASK_SIZE / size;
  const pts = path.pixels.map((p) => ({ x: p % size, y: (p / size) | 0 }));
  const keep = simplifyKeep(pts, path.kinds, 0.9);
  const points: (readonly [number, number])[] = [];
  const pointKinds: TraceKind[] = [];
  for (let i = 0; i < pts.length; i += 1) {
    if (!keep[i]) continue;
    points.push([(pts[i]!.x + 0.5) * scale - 0.5, (pts[i]!.y + 0.5) * scale - 0.5]);
    pointKinds.push(path.kinds[i]!);
  }
  // Half-open `to`, as LineSegment documents; drawers slice to `to + 1` to join neighbours.
  const segments: { from: number; to: number; observed: boolean }[] = [];
  let from = 0;
  for (let i = 1; i <= points.length; i += 1) {
    const observed = pointKinds[from] !== "extension";
    if (i === points.length || (pointKinds[i] !== "extension") !== observed) {
      segments.push({ from, to: i, observed });
      from = i;
    }
  }
  const observedCount = pointKinds.filter((k) => k !== "extension").length;
  return {
    id: path.id,
    points,
    confidence: 1,
    segments,
    observedFraction: points.length === 0 ? 0 : observedCount / points.length,
    traced: true,
  };
}

export interface TraceResult {
  /** Traced lines, MASK_SIZE grid, for every line extractLines accepted and the tracer could follow. */
  readonly lines: Partial<Record<ActiveLineId, TracedLine>>;
  /** The raw paths at TRACE_SIZE, for diagnostics and the eval. */
  readonly paths: Partial<Record<ActiveLineId, TracedPath>>;
  readonly ms: number;
}

/** A reusable tracer: allocates its Dijkstra scratch once. */
export class ValleyTracer {
  private readonly solver: Solver;
  private readonly bands: Readonly<Record<ActiveLineId, Band>>;
  constructor(readonly size: number = TRACE_SIZE) {
    this.solver = new Solver(size);
    this.bands = { heart: bandFor("heart", size), head: bandFor("head", size), life: bandFor("life", size), fate: bandFor("fate", size) };
  }

  /**
   * Trace every line extractLines accepted, from the rectified crop's luma.
   * @param luma the rectified crop at `size`, 0–1.
   */
  trace(extraction: LineExtraction, luma: Float32Array, inside?: Uint8Array): TraceResult {
    const t0 = performance.now();
    const depth = valleyDepth(luma, this.size);
    const palm = inside === undefined ? null : palmMask(inside, this.size);
    const seeds = selectSeeds(extraction.fragments, MASK_SIZE);
    const lines: Partial<Record<ActiveLineId, TracedLine>> = {};
    const paths: Partial<Record<ActiveLineId, TracedPath>> = {};
    for (const id of Object.keys(extraction.completion.lines) as ActiveLineId[]) {
      if (extraction.completion.lines[id] === undefined) continue;
      const lc = lineCost(depth, id, this.size, this.bands[id]);
      if (palm !== null) for (let i = 0; i < lc.band.length; i += 1) if (!palm[i]) lc.band[i] = 0;
      const path = traceLine(id, seeds[id], lc, this.solver, this.size);
      if (path === null) continue;
      paths[id] = path;
      lines[id] = tracedToLine(path, this.size);
    }
    return { lines, paths, ms: performance.now() - t0 };
  }
}
