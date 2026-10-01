/**
 * @file Tracer-led discovery (flag `rekhaDiscover`, S3).
 *
 * S2 proved the valley tracer lands on a crease wherever it is seeded. What lost the rest was SEED PLACEMENT —
 * extractLines handing a line the wrong crease (tilt-03's head seeded 81 px off) — and creases it never assigned at
 * all. S3 takes extractLines out of the geometry entirely: the tracer FINDS the lines. extractLines still runs, for
 * the features only.
 *
 *  1. DISCOVERY per band, on S2's local valley cost at 256 (trace-valley.ts: the black-hat depth as a ratio to the
 *     band's own median, cost = 0.04 + (1 − valley)). A super-source at the band's START and a super-sink at its END,
 *     one Dijkstra between them: the strongest continuous valley path across the band. Its endpoints are FREE — the
 *     zones are soft: the source enters the band at any pixel for {@link SKIP_COST} per px of corridor arc it skips
 *     to get there, and the sink takes the path from any pixel for the same per px of arc left. Skipping costs what
 *     S2's STOP_COST allows a crease to cost, so the path walks every stretch of crease that clears it and skips the
 *     skin before and after: a line starts where its crease starts, not at the corridor's knot. Both ends are then
 *     trimmed with S2's STOP_COST ({@link trimToCrease}).
 *  2. EXCLUSIVITY, in reliability order heart → head → life → fate ({@link DISCOVER_ORDER}): an accepted (or held)
 *     path, dilated {@link EXCLUSION_DILATE_PX}, is taken out of every other band's cost — its pixels cost as plain
 *     skin, so a later line may CROSS it (the fate line crosses the head line) but never run ALONG it. Two refinements
 *     the golden stills demanded: lines may share an ORIGIN ({@link ORIGIN_SHARE_PX} — the head and life lines rise
 *     together from the thumb web), and a line that runs in another's SHADOW ({@link SHADOW_PX}) for most of its
 *     length is that line's flank, not a line — the fate line cannot trace onto the life line, nor beside it.
 *  3. ACCEPTANCE: score = mean valley strength × covered length (px at 256). Strength is measured against the PALM
 *     ({@link palmReference}), one scale for all four bands — the search's band-local valley makes a flat band's noise
 *     a "full valley" (the fate band's median is a tenth of the heart band's). Below a band's floor
 *     ({@link DISCOVER_FLOORS}) no line is drawn: the ledger shows "—", the pothi seals the chapter.
 *  4. The DRAWN geometry is the smoothed path (smooth-path.ts): spikes out, a curvature-limited fit in a ±2 px tube.
 *  5. HOLD: a line persistence holds is never re-discovered from scratch. Along its held span the search is confined
 *     to a {@link HELD_TUBE_PX} tube around it (it may still grow past its ends); the hold refines it by EMA
 *     (rekha-persist.ts refineHeldLine), only from a path scoring at least as well.
 *
 * Pure. Imports nothing from lib/scan/dev; the frozen core (completion.ts) is CALLED, never edited.
 */
import { CORRIDORS, corridorFor, projectToCorridor } from "./completion";
import { buildCorridorMask } from "./corridor-path";
import { distanceToPolyline, kinkIndices, polylineLengthPx, removeSpikes, resamplePolyline, smoothPath, type PathPoint } from "./smooth-path";
import { lumaFromRgba, palmMask, select, valleyDepth, valleyScratch, STOP_COST, STOP_WINDOW_PX, TRACE_COST_FLOOR, TRACE_SIZE, VALLEY_RATIO_FULL, type ValleyScratch } from "./trace-valley";
import { MASK_SIZE, type ActiveLineId, type TracedLine } from "./types";

export { lumaFromRgba };

/** Reliability order: each band is discovered after the ones before it have claimed their creases. */
export const DISCOVER_ORDER: readonly ActiveLineId[] = ["heart", "head", "life", "fate"];

/**
 * The black-hat element's radius for discovery's valley (px at 256). S2 traces at 12 (a 25 px square), which fills a
 * broad shading trough as readily as a crease: on lines-current-02 the life band followed the thumb ball's shadow.
 * At 8 the legacy medians were heart 3.7 / head 8.4 px against 5.6 / 13.9 at 12 (S3 iteration 4, radii 4/6/8/12).
 */
export const DISCOVER_BLACKHAT_RADIUS = 8;

/**
 * Each band's half-widths over completion's corridor prior. The prior is where a line USUALLY runs; discovery must
 * reach where it DOES. The life line bulges past its corridor into the palm on the golden stills (still 00: 0.02 at
 * y 0.35–0.5; still 10: 0.06 where it leaves the head line), and a band that excludes it hands its crease to fate.
 */
export const DISCOVER_BAND_SCALE: Readonly<Record<ActiveLineId, number>> = { heart: 1, head: 1, life: 1.5, fate: 1 };

/**
 * What the soft zones charge per px of corridor arc a path skips at either end (S3.1): S2's STOP_COST, the most a
 * pixel of crease may cost. Walking a stretch that clears it is cheaper than skipping it; skin (1.04) is not.
 */
export const SKIP_COST = STOP_COST;

/** An accepted path is dilated by this (px at 256) before it is taken out of the other bands' cost. */
export const EXCLUSION_DILATE_PX = 6;

/**
 * Lines may share an ORIGIN, never a body. The first this-many px (at 256) of an accepted line are its origin; another
 * band may walk that stretch at its own cost within the first {@link ORIGIN_SHARE_S} of its arc — its own start. The
 * head and life lines commonly rise together from the thumb web: on still 00, with the head's origin claimed, the
 * life line paid skin to reach its own crease and a fainter one inside the thumb ball won (iteration 3).
 */
export const ORIGIN_SHARE_PX = 40;
export const ORIGIN_SHARE_S = 0.25;

/**
 * A candidate that runs within this of an accepted line (px at 256, twice the exclusion) for at least
 * {@link SHADOW_FRACTION} of its length is that line's flank: a crease's valley is wider than the 6 px claimed around
 * its centre, and on stills 00 and 07 the fate path ran 8–12 px beside the life line, on the life crease's own side.
 */
export const SHADOW_PX = 2 * EXCLUSION_DILATE_PX;
export const SHADOW_FRACTION = 0.5;

/** A held line is refined inside this tube around itself (px at 256) — never re-discovered from scratch. */
export const HELD_TUBE_PX = 6;

/** An END stretch of crease shorter than this (px at 256), or than the gap it is bridged across, is not the line's. */
export const MIN_END_ISLAND_PX = 10;

/**
 * The acceptance floor per band, in score units (mean palm-referenced strength × px at 256). Calibrated (S3.3) from
 * the measured distributions — scripts/scan/discover-diagnose.ts prints them: the fate floor sits above every fate
 * candidate on the two fate-ABSENT legacy cases (false-line rate 0).
 */
export const DISCOVER_FLOORS: Readonly<Record<ActiveLineId, number>> = { heart: 60, head: 60, life: 60, fate: 85 };

/** A band as discovery searches it: completion's corridor with its half-widths scaled by {@link DISCOVER_BAND_SCALE}. */
export function discoveryBand(id: ActiveLineId, size: number = TRACE_SIZE, bandScale: Readonly<Record<ActiveLineId, number>> = DISCOVER_BAND_SCALE): Uint8Array {
  const corridor = CORRIDORS[id];
  return buildCorridorMask({ ...corridor, halfWidths: corridor.halfWidths.map((w) => w * bandScale[id]) }, size).inside;
}

/**
 * The S3.7a "GT suspect" measure: the median discovery-valley depth along a 0–1 polyline (1 px steps at `size`,
 * nearest pixel) over the median depth in the line's discovery band. Under 1.0, the ground truth does not lie on a
 * valley at all — it is reported apart, never in the median bar.
 */
export function valleyRatioAlong(luma: Float32Array, id: ActiveLineId, points01: readonly (readonly number[])[], size: number = TRACE_SIZE): number {
  const depth = valleyDepth(luma, size, DISCOVER_BLACKHAT_RADIUS);
  const band = discoveryBand(id, size);
  const inBand: number[] = [];
  for (let i = 0; i < band.length; i += 1) if (band[i]) inBand.push(depth[i]!);
  inBand.sort((a, b) => a - b);
  const median = inBand[inBand.length >> 1] ?? 0;
  const along = resamplePolyline(points01.map(([x = 0, y = 0]) => ({ x: x * size, y: y * size })), 1)
    .map((p) => depth[Math.min(size - 1, Math.max(0, Math.round(p.y))) * size + Math.min(size - 1, Math.max(0, Math.round(p.x)))]!)
    .sort((a, b) => a - b);
  return (along[along.length >> 1] ?? 0) / Math.max(1e-6, median);
}

/** Plain skin: what another line's crease costs a band. */
const SKIN_COST = TRACE_COST_FLOOR + 1;

/** The search's integer cost unit: S2's costs × 64 (the floor 0.04 is 3 units, skin 67) — finer than any tie. */
const COST_QUANTUM = 64;
/** Keys in the bucket queue span at most a diagonal skin step plus a source's entry above the smallest — 256 holds them. */
const QUEUE_SPAN = 256;
const QUEUE_MASK = QUEUE_SPAN - 1;

/**
 * The palm's own valley reference: the 90th percentile of the black-hat depth over the palm — a crease reaches it,
 * flat skin and texture sit near the median, a fifth of it (golden stills: p90 = 5.4–6.5 × the median) — but never
 * under {@link PALM_REFERENCE_MEDIANS} × the median: on a palm with few creases the 90th percentile is texture, and
 * texture measured against itself would score like a crease. Strength = min(1, depth / reference).
 */
export const PALM_REFERENCE_MEDIANS = 5;

export function palmReference(depth: Float32Array, palm: Uint8Array | null, scratch: Float32Array = new Float32Array(depth.length)): number {
  // Every 4th pixel of the palm: ~9 000 samples place two percentiles as well as 35 000 do, at a quarter of the select.
  let count = 0;
  for (let i = 0; i < depth.length; i += 4) if (palm === null || palm[i]) scratch[count++] = depth[i]!;
  if (count === 0) return 1e-6;
  const values = scratch.subarray(0, count);
  const p90 = select(values, Math.floor(0.9 * (count - 1)));
  const median = select(values, Math.floor(0.5 * (count - 1)));
  return Math.max(1e-6, p90, PALM_REFERENCE_MEDIANS * median);
}

export interface DiscoveredLine {
  readonly id: ActiveLineId;
  /** The trimmed minimal path at 256, pixel centres in order along the corridor. */
  readonly raw: readonly PathPoint[];
  /** The drawn geometry at 256: the smoothed path. */
  readonly smooth: readonly PathPoint[];
  /** Per smoothed point: over the crease (the local valley clears STOP_COST) or bridged across a gap. */
  readonly observed: readonly boolean[];
  /** Mean palm-referenced strength × length: the acceptance score. */
  readonly score: number;
  readonly strength: number;
  /** Mean band-local valley (S2's, what the search walked). */
  readonly meanValley: number;
  readonly lengthPx: number;
  /** The jaggedness bars, measured on the drawn geometry (smooth-path.ts) — NaN unless the Discoverer measures. */
  readonly maxTurnDeg: number;
  readonly medianToRaw: number;
  /** Fraction of the drawn line within {@link SHADOW_PX} of an earlier accepted line. */
  readonly shadow: number;
  /** Found inside a held line's tube (S3.5). */
  readonly held: boolean;
}

/** Why a band drew no line — the S3.8 diagnostic: no valley in band, floor rejects, or exclusivity (shadow). */
export type DiscoveryOutcome = "accepted" | "floor" | "shadow" | "no-path";

export interface DiscoveryVerdict {
  readonly id: ActiveLineId;
  readonly outcome: DiscoveryOutcome;
  readonly score: number;
  /** The candidate, accepted or not (for diagnostics). */
  readonly line: DiscoveredLine | null;
}

export interface DiscoveryResult {
  /** The accepted lines, as the pipeline draws them: MASK_SIZE grid, smoothed, observed/bridged segments, `score`. */
  readonly lines: Partial<Record<ActiveLineId, TracedLine>>;
  readonly verdicts: Readonly<Record<ActiveLineId, DiscoveryVerdict>>;
  readonly ms: number;
  /** Where the milliseconds went: the valley and palm, and per band its cost map and its search + finish. */
  readonly timings: {
    readonly valley: number;
    /** Per band: its cost map, its Dijkstra, and everything after (trim, split, centre, smooth, measure). */
    readonly bands: Readonly<Record<ActiveLineId, { readonly cost: number; readonly search: number; readonly finish: number }>>;
  };
}

interface BandGeometry {
  readonly mask: Uint8Array;
  readonly members: Int32Array;
  /** Members ordered by corridor arc position — the soft start zone's injection order. */
  readonly byArc: Int32Array;
  /** Corridor arc position (0–1) of every pixel, meaningful on members. */
  readonly s: Float32Array;
  /** The corridor centreline's length, px at the band's size: arc position → px skipped. */
  readonly arcPx: number;
}

/**
 * Dijkstra's queue as buckets (Dial): keys are integers (costs in 1/{@link COST_QUANTUM} units), every key in the queue
 * lies within {@link QUEUE_SPAN} of the smallest, so a circular array of lists gives O(1) push and pop where a binary
 * heap paid ~14 levels a step — the discovery's search was half its time in the browser (S3.7d). Stale entries (a
 * node pushed again at a lower key) are skipped by the caller.
 */
class BucketQueue {
  private readonly heads: Int32Array;
  private readonly entryNode: Int32Array;
  private readonly entryNext: Int32Array;
  private used = 0;
  private count = 0;
  private current = 0;
  /** The key of the entry the last pop returned. */
  lastKey = 0;
  constructor(capacity: number) {
    this.heads = new Int32Array(QUEUE_SPAN).fill(-1);
    this.entryNode = new Int32Array(capacity);
    this.entryNext = new Int32Array(capacity);
  }
  get size(): number {
    return this.count;
  }
  clear(): void {
    this.heads.fill(-1);
    this.used = 0;
    this.count = 0;
    this.current = 0;
  }
  push(node: number, key: number): void {
    if (this.used >= this.entryNode.length) return;
    // Below the scan position only ever lands on buckets the scan already found empty: move back to it.
    if (this.count === 0 || key < this.current) this.current = key;
    const bucket = key & QUEUE_MASK;
    this.entryNode[this.used] = node;
    this.entryNext[this.used] = this.heads[bucket]!;
    this.heads[bucket] = this.used;
    this.used += 1;
    this.count += 1;
  }
  /** The smallest key in the queue (Infinity when empty); advances the scan to it. */
  get minKey(): number {
    if (this.count === 0) return Number.POSITIVE_INFINITY;
    while (this.heads[this.current & QUEUE_MASK] === -1) this.current += 1;
    return this.current;
  }
  pop(): number {
    const key = this.minKey;
    const bucket = key & QUEUE_MASK;
    const entry = this.heads[bucket]!;
    this.heads[bucket] = this.entryNext[entry]!;
    this.count -= 1;
    this.lastKey = key;
    return this.entryNode[entry]!;
  }
}

/**
 * Stamp a disc of `radius` around every point of `points` into `into` (px grid `size`), writing `value` — only where
 * `into` is still 0 when `onlyEmpty`; `marked`, when given, gets a 1 wherever this stamp wrote.
 */
export function stampTube(points: readonly PathPoint[], radius: number, size: number, into: Uint8Array, value = 1, onlyEmpty = false, marked?: Uint8Array): void {
  const r2 = radius * radius;
  const stamp = (cx: number, cy: number): void => {
    const x0 = Math.round(cx);
    const y0 = Math.round(cy);
    for (let dy = -radius; dy <= radius; dy += 1) {
      const y = y0 + dy;
      if (y < 0 || y >= size) continue;
      for (let dx = -radius; dx <= radius; dx += 1) {
        if (dx * dx + dy * dy > r2) continue;
        const x = x0 + dx;
        if (x < 0 || x >= size) continue;
        const at = y * size + x;
        if (!onlyEmpty || into[at] === 0) {
          into[at] = value;
          if (marked !== undefined) marked[at] = 1;
        }
      }
    }
  };
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i]!;
    const b = points[i + 1];
    if (b === undefined) {
      stamp(a.x, a.y);
      break;
    }
    const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y)));
    for (let k = 0; k < steps; k += 1) stamp(a.x + ((b.x - a.x) * k) / steps, a.y + ((b.y - a.y) * k) / steps);
  }
}

/** Per pixel of a path: is the crease under it — the centred STOP_WINDOW_PX mean cost at most STOP_COST. */
export function onCrease(costs: readonly number[]): boolean[] {
  const half = Math.max(1, Math.round(STOP_WINDOW_PX / 2));
  return costs.map((_, i) => {
    let sum = 0;
    let count = 0;
    for (let k = Math.max(0, i - half); k <= Math.min(costs.length - 1, i + half); k += 1) {
      sum += costs[k]!;
      count += 1;
    }
    return sum / count <= STOP_COST;
  });
}

/**
 * Trim a path to its crease (S2's STOP_COST, both ends): the runs of pixels on the crease ({@link onCrease}); an END
 * run is dropped while it is shorter than {@link MIN_END_ISLAND_PX} or than the gap that bridges it to the next run
 * (a speck of noise near a zone is not where the line starts); then a pixel dearer than STOP_COST is never the first or
 * last. Returns [from, to] inclusive, or null when no stretch is a crease.
 */
export function trimToCrease(costs: readonly number[]): readonly [number, number] | null {
  const on = onCrease(costs);
  const runs: [number, number][] = [];
  for (let i = 0; i < on.length; i += 1) {
    if (!on[i]) continue;
    const start = i;
    while (i + 1 < on.length && on[i + 1]) i += 1;
    runs.push([start, i]);
  }
  if (runs.length === 0) return null;
  const length = (run: readonly [number, number]): number => run[1] - run[0] + 1;
  while (runs.length > 1) {
    const first = runs[0]!;
    const gap = runs[1]![0] - first[1] - 1;
    if (length(first) >= MIN_END_ISLAND_PX && length(first) >= gap) break;
    runs.shift();
  }
  while (runs.length > 1) {
    const last = runs[runs.length - 1]!;
    const gap = last[0] - runs[runs.length - 2]![1] - 1;
    if (length(last) >= MIN_END_ISLAND_PX && length(last) >= gap) break;
    runs.pop();
  }
  let from = runs[0]![0];
  let to = runs[runs.length - 1]![1];
  while (from < to && costs[from]! > STOP_COST) from += 1;
  while (to > from && costs[to]! > STOP_COST) to -= 1;
  return to > from ? [from, to] : null;
}

/** A discovered line as the pipeline's TracedLine: the smoothed geometry in the MASK_SIZE grid, with its score. */
export function discoveredToLine(line: DiscoveredLine, size: number = TRACE_SIZE): TracedLine {
  const scale = MASK_SIZE / size;
  const round2 = (v: number): number => Math.round(v * 100) / 100;
  const points = line.smooth.map((p) => [round2((p.x + 0.5) * scale - 0.5), round2((p.y + 0.5) * scale - 0.5)] as const);
  // Half-open `to`, as tracedToLine: drawers slice to `to + 1` to join neighbours.
  const segments: { from: number; to: number; observed: boolean }[] = [];
  let from = 0;
  for (let i = 1; i <= points.length; i += 1) {
    if (i === points.length || line.observed[i] !== line.observed[from]) {
      segments.push({ from, to: i, observed: line.observed[from] ?? true });
      from = i;
    }
  }
  const observedCount = line.observed.filter(Boolean).length;
  return {
    id: line.id,
    points,
    confidence: Math.round(line.strength * 1000) / 1000,
    segments,
    observedFraction: points.length === 0 ? 0 : observedCount / points.length,
    traced: true,
    score: Math.round(line.score * 100) / 100,
  };
}

/** Held lines (MASK_SIZE grid, as persistence holds them) in the discovery grid. */
export function heldInGrid(lines: Partial<Record<ActiveLineId, TracedLine>>, size: number = TRACE_SIZE): Partial<Record<ActiveLineId, PathPoint[]>> {
  const scale = size / MASK_SIZE;
  const out: Partial<Record<ActiveLineId, PathPoint[]>> = {};
  for (const id of DISCOVER_ORDER) {
    const line = lines[id];
    if (line !== undefined && line.points.length >= 2) out[id] = line.points.map(([x, y]) => ({ x: (x + 0.5) * scale - 0.5, y: (y + 0.5) * scale - 0.5 }));
  }
  return out;
}

/** Fraction of `line`'s arc (3 px steps) within `tol` px of any of `others` — each other line's bounding box first. */
function shadowFraction(line: readonly PathPoint[], others: readonly (readonly PathPoint[])[], tol: number): number {
  if (others.length === 0) return 0;
  const dense = resamplePolyline(line, 3);
  if (dense.length === 0) return 0;
  const boxes = others.map((other) => {
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const p of other) {
      if (p.x < x0) x0 = p.x;
      if (p.y < y0) y0 = p.y;
      if (p.x > x1) x1 = p.x;
      if (p.y > y1) y1 = p.y;
    }
    return { x0: x0 - tol, y0: y0 - tol, x1: x1 + tol, y1: y1 + tol };
  });
  let near = 0;
  for (const p of dense) {
    for (let k = 0; k < others.length; k += 1) {
      const box = boxes[k]!;
      if (p.x < box.x0 || p.x > box.x1 || p.y < box.y0 || p.y > box.y1) continue;
      if (distanceToPolyline(p, others[k]!) <= tol) {
        near += 1;
        break;
      }
    }
  }
  return near / dense.length;
}

/** How far across its path a point may move to the crease's centre (px at 256), and the sampling step. */
export const CENTRE_REACH_PX = 3;
const CENTRE_STEP_PX = 0.5;

/** Bilinear sample of a `size`² plane. */
function bilinear(plane: Float32Array, size: number, x: number, y: number): number {
  const x0 = Math.max(0, Math.min(size - 2, Math.floor(x)));
  const y0 = Math.max(0, Math.min(size - 2, Math.floor(y)));
  const fx = Math.max(0, Math.min(1, x - x0));
  const fy = Math.max(0, Math.min(1, y - y0));
  const at = y0 * size + x0;
  return (plane[at]! * (1 - fx) + plane[at + 1]! * fx) * (1 - fy) + (plane[at + size]! * (1 - fx) + plane[at + size + 1]! * fx) * fy;
}

/**
 * Centre a pixel path on its crease. S2's cost saturates — every pixel deeper than VALLEY_RATIO_FULL × the band median
 * costs the floor — so a crease is a flat-bottomed plateau a few px wide and the cheapest path runs anywhere inside it
 * (2 px off-centre on planted creases, S3 iteration 6). Each point moves along its normal to the black-hat depth's own
 * maximum within {@link CENTRE_REACH_PX} (a parabola through the peak for the sub-pixel place); the moves are
 * median-filtered along the path, so one noisy sample cannot kink it. A point whose profile has no interior peak stays.
 */
export function centreOnValley(points: readonly PathPoint[], depth: Float32Array, size: number): PathPoint[] {
  const n = points.length;
  if (n < 3) return points.map((p) => ({ x: p.x, y: p.y }));
  const steps = Math.round(CENTRE_REACH_PX / CENTRE_STEP_PX);
  const shifts = new Float64Array(n);
  const normals: { x: number; y: number }[] = [];
  for (let i = 0; i < n; i += 1) {
    const a = points[Math.max(0, i - 3)]!;
    const b = points[Math.min(n - 1, i + 3)]!;
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const normal = { x: -(b.y - a.y) / len, y: (b.x - a.x) / len };
    normals.push(normal);
    let best = -Infinity;
    let bestK = 0;
    const profile: number[] = [];
    for (let k = -steps; k <= steps; k += 1) {
      const v = bilinear(depth, size, points[i]!.x + normal.x * k * CENTRE_STEP_PX, points[i]!.y + normal.y * k * CENTRE_STEP_PX);
      profile.push(v);
      if (v > best) {
        best = v;
        bestK = k;
      }
    }
    if (bestK === -steps || bestK === steps) continue; // no peak inside the reach: leave the point
    const left = profile[bestK + steps - 1]!;
    const right = profile[bestK + steps + 1]!;
    const curvature = left - 2 * best + right;
    const offset = curvature < 0 ? (0.5 * (left - right)) / curvature : 0;
    shifts[i] = (bestK + Math.max(-0.5, Math.min(0.5, offset))) * CENTRE_STEP_PX;
  }
  return points.map((p, i) => {
    const window: number[] = [];
    for (let k = Math.max(0, i - 2); k <= Math.min(n - 1, i + 2); k += 1) window.push(shifts[k]!);
    window.sort((a, b) => a - b);
    const shift = window[window.length >> 1]!;
    return { x: p.x + normals[i]!.x * shift, y: p.y + normals[i]!.y * shift };
  });
}

/**
 * Split a pixel path (indices into a `size` grid) at its corners ({@link kinkIndices} on the spike-free 1 px path),
 * each corner mapped back to the pixel at the same fraction of arc. One piece when there is no corner.
 */
export function splitAtKinks(pixels: readonly number[], size: number): number[][] {
  const points = pixels.map((p) => ({ x: p % size, y: (p / size) | 0 }));
  const spikeFree = removeSpikes(points);
  const kinks = kinkIndices(spikeFree);
  if (kinks.length === 0) return [pixels.slice()];
  const cumulative = [0];
  for (let k = 1; k < points.length; k += 1) cumulative.push(cumulative[k - 1]! + Math.hypot(points[k]!.x - points[k - 1]!.x, points[k]!.y - points[k - 1]!.y));
  const total = cumulative[cumulative.length - 1]!;
  const spikeFreeLength = Math.max(1, spikeFree.length - 1);
  const cuts = kinks.map((index) => {
    const arc = (index / spikeFreeLength) * total;
    let k = 0;
    while (k + 1 < cumulative.length && cumulative[k]! < arc) k += 1;
    return k;
  });
  const out: number[][] = [];
  let from = 0;
  for (const cut of cuts) {
    if (cut - from >= 2) out.push(pixels.slice(from, cut + 1));
    from = cut;
  }
  if (pixels.length - from >= 2) out.push(pixels.slice(from));
  return out;
}

/** A reusable discoverer: its bands and its Dijkstra scratch are allocated once per size. */
export class Discoverer {
  private readonly bands: Readonly<Record<ActiveLineId, BandGeometry>>;
  private readonly dist: Float64Array;
  private readonly parent: Int32Array;
  private readonly settled: Uint8Array;
  private readonly allowed: Uint8Array;
  private readonly cost: Float32Array;
  /** Which line claimed a pixel: 0 none, else 1 + its DISCOVER_ORDER index. */
  private readonly owner: Uint8Array;
  /** 1 where the claim is its line's ORIGIN ({@link ORIGIN_SHARE_PX}) — shareable at another band's own start. */
  private readonly origin: Uint8Array;
  private readonly tube: Uint8Array;
  private readonly queue: BucketQueue;
  /** Integer step costs per pixel (×{@link COST_QUANTUM}), straight and diagonal, for the band being searched. */
  private readonly qStraight: Int32Array;
  private readonly qDiagonal: Int32Array;
  private readonly scratch: Float32Array;
  private readonly valley: ValleyScratch;
  /** The 8 neighbours as index offsets, and which of them are diagonal steps. */
  private readonly offsets: Int32Array;
  private readonly diagonal: Uint8Array;
  /** The last solve's Dijkstra alone, for the timing breakdown. */
  private lastSearchMs = 0;

  constructor(
    readonly size: number = TRACE_SIZE,
    bandScale: Readonly<Record<ActiveLineId, number>> = DISCOVER_BAND_SCALE,
    private readonly blackHatRadius: number = DISCOVER_BLACKHAT_RADIUS,
    /** Measure each line's jaggedness bars (diagnostics, tests); live, the rig measures what was drawn instead. */
    private readonly measure = false,
  ) {
    const n = size * size;
    this.dist = new Float64Array(n);
    this.parent = new Int32Array(n);
    this.settled = new Uint8Array(n);
    this.allowed = new Uint8Array(n);
    this.cost = new Float32Array(n);
    this.owner = new Uint8Array(n);
    this.origin = new Uint8Array(n);
    this.tube = new Uint8Array(n);
    this.queue = new BucketQueue(n * 8);
    this.qStraight = new Int32Array(n);
    this.qDiagonal = new Int32Array(n);
    this.scratch = new Float32Array(n);
    this.valley = valleyScratch(size, blackHatRadius);
    this.offsets = Int32Array.from([-size - 1, -size, -size + 1, -1, 1, size - 1, size, size + 1]);
    this.diagonal = Uint8Array.from([1, 0, 1, 0, 0, 1, 0, 1]);
    const geometry = (id: ActiveLineId): BandGeometry => {
      const mask = discoveryBand(id, size, bandScale);
      const list: number[] = [];
      for (let i = 0; i < mask.length; i += 1) if (mask[i]) list.push(i);
      const members = Int32Array.from(list);
      const samples = corridorFor(id);
      const s = new Float32Array(n);
      for (const i of members) s[i] = projectToCorridor(samples, { x: i % size, y: (i / size) | 0 }, size).s;
      const byArc = Int32Array.from(list).sort((a, b) => s[a]! - s[b]!);
      let arcPx = 0;
      for (let k = 1; k < samples.length; k += 1) arcPx += Math.hypot(samples[k]!.x - samples[k - 1]!.x, samples[k]!.y - samples[k - 1]!.y) * size;
      return { mask, members, byArc, s, arcPx };
    };
    this.bands = { heart: geometry("heart"), head: geometry("head"), life: geometry("life"), fate: geometry("fate") };
  }

  /**
   * Discover the four majors on one rectified crop.
   * @param luma the crop's luma at `size`, 0–1.
   * @param inside the crop's inside mask (where the camera frame exists); absent, the whole crop.
   * @param held lines the persistence holds, at `size` ({@link heldInGrid}) — refined in their tube, never
   *   re-discovered, and their creases claimed for every other band even on a frame that does not re-find them.
   */
  discover(luma: Float32Array, inside?: Uint8Array, held: Partial<Record<ActiveLineId, readonly PathPoint[]>> = {}): DiscoveryResult {
    const t0 = performance.now();
    const { size, owner, origin } = this;
    const depth = valleyDepth(luma, size, this.blackHatRadius, this.valley);
    const bandTimes = {} as Record<ActiveLineId, { cost: number; search: number; finish: number }>;
    const palm = inside === undefined ? null : palmMask(inside, size);
    const reference = palmReference(depth, palm, this.scratch);
    const valleyMs = performance.now() - t0;
    owner.fill(0);
    origin.fill(0);
    DISCOVER_ORDER.forEach((id, index) => {
      const path = held[id];
      if (path !== undefined && path.length >= 2) this.claim(path, index + 1);
    });
    const lines: Partial<Record<ActiveLineId, TracedLine>> = {};
    const accepted: PathPoint[][] = [];
    const verdicts = {} as Record<ActiveLineId, DiscoveryVerdict>;
    DISCOVER_ORDER.forEach((id, index) => {
      const band = this.bands[id];
      const mine = index + 1;
      const tc = performance.now();
      this.bandCost(depth, band, mine);
      const ts = performance.now();
      const candidate = this.solve(id, band, depth, reference, palm, held[id], accepted);
      const total = performance.now() - ts;
      bandTimes[id] = { cost: ts - tc, search: this.lastSearchMs, finish: total - this.lastSearchMs };
      if (candidate === null) {
        verdicts[id] = { id, outcome: "no-path", score: 0, line: null };
        return;
      }
      const outcome: DiscoveryOutcome = candidate.shadow >= SHADOW_FRACTION ? "shadow" : candidate.score < DISCOVER_FLOORS[id] ? "floor" : "accepted";
      verdicts[id] = { id, outcome, score: candidate.score, line: candidate };
      if (outcome !== "accepted") return;
      lines[id] = discoveredToLine(candidate, size);
      accepted.push([...candidate.smooth]);
      this.claim(candidate.raw, mine);
    });
    return { lines, verdicts, ms: performance.now() - t0, timings: { valley: valleyMs, bands: bandTimes } };
  }

  /**
   * S2's local valley cost over one band's members (trace-valley lineCost's formula, only where the band is): depth
   * as a ratio to the band's median. Another line's crease is skin — except its origin, at this band's own start.
   */
  private bandCost(depth: Float32Array, band: BandGeometry, mine: number): void {
    const { cost, owner, origin } = this;
    const values = this.scratch.subarray(0, band.members.length);
    for (let k = 0; k < band.members.length; k += 1) values[k] = depth[band.members[k]!]!;
    const median = values.length > 0 ? select(values, values.length >> 1) : 0;
    const denominator = median > 1e-6 ? median : 1e-6;
    const { qStraight, qDiagonal } = this;
    for (const i of band.members) {
      let c: number;
      if (owner[i] !== 0 && owner[i] !== mine && !(origin[i] && band.s[i]! < ORIGIN_SHARE_S)) {
        c = SKIN_COST;
      } else {
        let valley = (depth[i]! / denominator - 1) / (VALLEY_RATIO_FULL - 1);
        if (valley < 0) valley = 0;
        else if (valley > 1) valley = 1;
        c = TRACE_COST_FLOOR + (1 - valley);
      }
      cost[i] = c;
      qStraight[i] = Math.round(c * COST_QUANTUM);
      qDiagonal[i] = Math.round(c * Math.SQRT2 * COST_QUANTUM);
    }
  }

  /** Claim a path's crease for line `mine`: dilated EXCLUSION_DILATE_PX, its first ORIGIN_SHARE_PX marked as origin. */
  private claim(path: readonly PathPoint[], mine: number): void {
    const { size, owner, origin } = this;
    let arc = 0;
    let cut = path.length;
    for (let k = 1; k < path.length; k += 1) {
      arc += Math.hypot(path[k]!.x - path[k - 1]!.x, path[k]!.y - path[k - 1]!.y);
      if (arc > ORIGIN_SHARE_PX) {
        cut = k;
        break;
      }
    }
    // The origin first, marking each pixel it newly claims; then the rest of the line around it.
    stampTube(path.slice(0, cut), EXCLUSION_DILATE_PX, size, owner, mine, true, origin);
    stampTube(path, EXCLUSION_DILATE_PX, size, owner, mine, true);
  }

  /** One band: the open region, the soft-zone Dijkstra, the trimmed path, its score, shadow and smoothing. */
  private solve(
    id: ActiveLineId,
    band: BandGeometry,
    depth: Float32Array,
    reference: number,
    palm: Uint8Array | null,
    heldPath: readonly PathPoint[] | undefined,
    accepted: readonly (readonly PathPoint[])[],
  ): DiscoveredLine | null {
    const { size, allowed, dist, parent, settled, queue, cost, owner, offsets, diagonal, qStraight, qDiagonal } = this;
    const isHeld = heldPath !== undefined && heldPath.length >= 2;
    let heldLo = Infinity;
    let heldHi = -Infinity;
    if (isHeld) {
      const samples = corridorFor(id);
      this.tube.fill(0);
      stampTube(heldPath, HELD_TUBE_PX, size, this.tube);
      for (const p of heldPath) {
        const s = projectToCorridor(samples, p, size).s;
        heldLo = Math.min(heldLo, s);
        heldHi = Math.max(heldHi, s);
      }
    }
    allowed.fill(0);
    let count = 0;
    for (const i of band.members) {
      dist[i] = Number.POSITIVE_INFINITY;
      parent[i] = -1;
      settled[i] = 0;
      if (palm !== null && !palm[i]) continue;
      // Held: along its held span only its tube is open — it may grow past its ends, never jump to another crease.
      if (isHeld && band.s[i]! >= heldLo && band.s[i]! <= heldHi && !this.tube[i]) continue;
      allowed[i] = 1;
      count += 1;
    }
    if (count === 0) return null;
    /*
     * The soft zones. Every open pixel is a source, entered for SKIP_COST per px of arc before it, and a way out to the
     * sink for SKIP_COST per px of arc after it. Sources are injected in arc order as the frontier reaches their
     * lower bound (a source's entry is at least its skip), so the heap never holds the whole band. The sink is
     * settled — the search stops — once nothing left can beat the best way out found (every way out costs ≥ 0).
     */
    const skipPerS = SKIP_COST * band.arcPx * COST_QUANTUM;
    const skipBefore = (i: number): number => Math.round(skipPerS * band.s[i]!);
    const skipAfter = (i: number): number => Math.round(skipPerS * (1 - band.s[i]!));
    const searchStart = performance.now();
    queue.clear();
    let next = 0;
    let best = Number.POSITIVE_INFINITY;
    let target = -1;
    const sources = band.byArc;
    for (;;) {
      // The smallest key that can be popped next: the queue's, or — with nothing in flight — the next source's bound.
      let bound = queue.minKey;
      if (queue.size === 0) {
        while (next < sources.length && !allowed[sources[next]!]) next += 1;
        if (next >= sources.length) break;
        bound = skipBefore(sources[next]!);
        if (bound >= best) break;
      }
      // Every source whose entry could undercut that bound (its entry is at least its skip) joins now.
      while (next < sources.length && skipBefore(sources[next]!) <= bound) {
        const i = sources[next]!;
        next += 1;
        if (!allowed[i] || settled[i]) continue;
        const entry = skipBefore(i) + qStraight[i]!;
        if (entry < dist[i]!) {
          dist[i] = entry;
          parent[i] = -1;
          queue.push(i, entry);
        }
      }
      if (queue.size === 0) continue;
      const node = queue.pop();
      const base = queue.lastKey;
      if (settled[node] || base !== dist[node]) continue; // stale: reached again more cheaply
      settled[node] = 1;
      if (base >= best) break;
      const out = base + skipAfter(node);
      if (out < best) {
        best = out;
        target = node;
      }
      const x0 = node % size;
      const y0 = (node / size) | 0;
      if (x0 > 0 && y0 > 0 && x0 < size - 1 && y0 < size - 1) {
        for (let k = 0; k < 8; k += 1) {
          const at = node + offsets[k]!;
          if (!allowed[at] || settled[at]) continue;
          const reach = base + (diagonal[k] ? qDiagonal[at]! : qStraight[at]!);
          if (reach < dist[at]!) {
            dist[at] = reach;
            parent[at] = node;
            queue.push(at, reach);
          }
        }
      } else {
        for (let dy = -1; dy <= 1; dy += 1) {
          const y = y0 + dy;
          if (y < 0 || y >= size) continue;
          for (let dx = -1; dx <= 1; dx += 1) {
            if (dx === 0 && dy === 0) continue;
            const x = x0 + dx;
            if (x < 0 || x >= size) continue;
            const at = y * size + x;
            if (!allowed[at] || settled[at]) continue;
            const reach = base + (dx !== 0 && dy !== 0 ? qDiagonal[at]! : qStraight[at]!);
            if (reach < dist[at]!) {
              dist[at] = reach;
              parent[at] = node;
              queue.push(at, reach);
            }
          }
        }
      }
    }
    this.lastSearchMs = performance.now() - searchStart;
    if (target < 0) return null;
    const pixels: number[] = [];
    for (let node = target; node >= 0; node = parent[node]!) pixels.push(node);
    pixels.reverse();

    const mine = DISCOVER_ORDER.indexOf(id) + 1;
    // Per pixel, the palm-referenced strength: crossing another line's crease earns nothing — its depth is that line's.
    const strengthAt = (p: number): number => (owner[p] === 0 || owner[p] === mine || cost[p]! < SKIN_COST ? Math.min(1, depth[p]! / reference) : 0);
    const trimmed = (from: readonly number[]): number[] | null => {
      const span = trimToCrease(from.map((p) => cost[p]!));
      return span === null ? null : from.slice(span[0], span[1] + 1);
    };
    let kept = trimmed(pixels);
    if (kept === null) return null;
    /*
     * A corner no ±2 px tube can round is where the path left its crease for another (still 07's heart turned off the
     * heart crease, which curves up to the fingers, onto a faint valley running on to the band's end). Split there and
     * keep the stretch that scores best.
     */
    const pieces = splitAtKinks(kept, size);
    if (pieces.length > 1) {
      let bestPiece: number[] | null = null;
      let bestScore = -1;
      for (const piece of pieces) {
        const t = trimmed(piece);
        if (t === null || t.length < 2) continue;
        let sum = 0;
        for (const p of t) sum += strengthAt(p);
        const score = (sum / t.length) * polylineLengthPx(t.map((p) => ({ x: p % size, y: (p / size) | 0 })));
        if (score > bestScore) {
          bestScore = score;
          bestPiece = t;
        }
      }
      if (bestPiece === null) return null;
      kept = bestPiece;
    }
    const keptCosts = kept.map((p) => cost[p]!);
    const raw = centreOnValley(
      kept.map((p) => ({ x: p % size, y: (p / size) | 0 })),
      depth,
      size,
    );
    const lengthPx = polylineLengthPx(raw);
    if (lengthPx < 2) return null;
    let valleySum = 0;
    let strengthSum = 0;
    for (let k = 0; k < kept.length; k += 1) {
      valleySum += Math.min(1, Math.max(0, SKIN_COST - keptCosts[k]!));
      strengthSum += strengthAt(kept[k]!);
    }
    const meanValley = valleySum / kept.length;
    const strength = strengthSum / kept.length;
    const { smooth, maxTurnDeg, medianToRaw } = smoothPath(raw, this.measure);
    // Observed or bridged, per drawn point: the raw pixel at the same fraction of the arc (both run the same way).
    const on = onCrease(keptCosts);
    const observed = smooth.map((_, k) => on[Math.min(on.length - 1, Math.round((k / Math.max(1, smooth.length - 1)) * (on.length - 1)))]!);
    return {
      id,
      raw,
      smooth,
      observed,
      score: strength * lengthPx,
      strength,
      meanValley,
      lengthPx,
      maxTurnDeg,
      medianToRaw,
      shadow: shadowFraction(smooth, accepted, SHADOW_PX),
      held: isHeld,
    };
  }
}
