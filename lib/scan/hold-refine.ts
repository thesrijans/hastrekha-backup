/**
 * @file The hold's refinement (S3.5): a held line is refined, never replaced.
 *
 * Persistence holds the SMOOTHED discovered path (lib/scan/discover.ts). A later frame's discovery — searched inside
 * the held line's own tube, never from scratch — may only NUDGE it: where the fresh path runs alongside the held one,
 * each held point moves {@link HOLD_REFINE_ALPHA} of the way to it (an EMA per point, so the held shape settles on
 * the crease instead of following one frame's noise), and only when the fresh path scores at least as well as the
 * held one. Beyond the held line's ends the fresh path is new crease, and the line GROWS by it, joined without a step;
 * it never shrinks. The score follows the same EMA.
 *
 * With the fresh path confined to the discovery's HELD_TUBE_PX (6 px at 256), a held point moves at most 0.9 px at 256
 * per extraction — the S3.5 jitter bar is 2.
 *
 * Pure; MASK_SIZE-grid TracedLines in and out. Imports nothing but types.
 */
import { turningBar, TURN_BAR_DEG } from "./smooth-path";
import type { TracedLine } from "./types";

/** How far a held point moves toward the fresh path per refining extraction. */
export const HOLD_REFINE_ALPHA = 0.15;

/**
 * A grown stretch leaves the held end exactly — in position AND direction — and eases onto the fresh path over this
 * much of its own arc (MASK_SIZE px), a cubic Hermite blend. Matching the position alone left the turn between the
 * held end's heading and the fresh path's at the join: 36° on the normal feed's heart the extraction it grew (live).
 */
const JOIN_FADE_PX = 15;
/**
 * A held point past the END of the fresh path moves less the further past it is: fully alongside, not at all this far
 * beyond (MASK_SIZE px). Holding the end point still while its neighbours moved grew a hook at every refinement —
 * 28° → 52° over 20 s on tight-00's head line (S3, live).
 */
const END_TAPER_PX = 4;
/** How much of the held line's end a grown stretch is checked against (points, ~1.5 px apart at MASK_SIZE). */
const JOIN_CHECK_POINTS = 12;
/** A fresh point counts as past a held end only this far beyond it along the line (MASK_SIZE px). */
const GROW_MIN_PX = 0.5;

type Point = readonly [number, number];

interface Projection {
  /** Arc position of the nearest point, 0 … length. */
  readonly t: number;
  readonly x: number;
  readonly y: number;
}

function cumulativeArc(points: readonly Point[]): number[] {
  const out = [0];
  for (let i = 1; i < points.length; i += 1) out.push(out[i - 1]! + Math.hypot(points[i]![0] - points[i - 1]![0], points[i]![1] - points[i - 1]![1]));
  return out;
}

/** The nearest point of `line` to `p`, with its arc position. */
function project(p: Point, line: readonly Point[], arc: readonly number[]): Projection {
  let best: Projection = { t: 0, x: line[0]![0], y: line[0]![1] };
  let bestD = Infinity;
  for (let i = 0; i + 1 < line.length; i += 1) {
    const [ax, ay] = line[i]!;
    const [bx, by] = line[i + 1]!;
    const vx = bx - ax;
    const vy = by - ay;
    const l2 = vx * vx + vy * vy;
    const u = l2 === 0 ? 0 : Math.min(1, Math.max(0, ((p[0] - ax) * vx + (p[1] - ay) * vy) / l2));
    const x = ax + u * vx;
    const y = ay + u * vy;
    const d = (p[0] - x) ** 2 + (p[1] - y) ** 2;
    if (d < bestD) {
      bestD = d;
      best = { t: arc[i]! + u * Math.sqrt(l2), x, y };
    }
  }
  return best;
}

/** Per point: observed (true) or bridged, from a line's half-open segments; all observed when it has none. */
function observedFlags(line: TracedLine): boolean[] {
  const flags = line.points.map(() => true);
  for (const segment of line.segments ?? []) for (let i = segment.from; i < Math.min(segment.to, flags.length); i += 1) flags[i] = segment.observed;
  return flags;
}

function segmentsOf(flags: readonly boolean[]): { from: number; to: number; observed: boolean }[] {
  const out: { from: number; to: number; observed: boolean }[] = [];
  let from = 0;
  for (let i = 1; i <= flags.length; i += 1) {
    if (i === flags.length || flags[i] !== flags[from]) {
      out.push({ from, to: i, observed: flags[from] ?? true });
      from = i;
    }
  }
  return out;
}

const round2 = (v: number): number => Math.round(v * 100) / 100;

/**
 * Refine `held` by `fresh` (both MASK_SIZE grid, ordered the same way along their corridor — discovery's order):
 * each held point moves `alpha` toward its nearest point on `fresh` — tapering to nothing {@link END_TAPER_PX} past
 * the fresh path's ends, so a shorter fresh path moves only what it reaches; fresh points beyond either held end
 * extend the line, offset to meet it; `score` and `confidence` follow the EMA. The caller decides WHETHER to refine
 * (S3.5: only from a fresh path scoring at least as well).
 */
export function refineHeldLine(held: TracedLine, fresh: TracedLine, alpha: number = HOLD_REFINE_ALPHA): TracedLine {
  if (held.points.length < 2 || fresh.points.length < 2) return held;
  const freshArc = cumulativeArc(fresh.points);
  const freshLength = freshArc[freshArc.length - 1]!;
  const heldFlags = observedFlags(held);
  const freshFlags = observedFlags(fresh);

  // How far past the fresh path's start (or end) a point lies, along the fresh path's own direction there.
  const f0 = fresh.points[0]!;
  const f1 = fresh.points[1]!;
  const fN = fresh.points[fresh.points.length - 1]!;
  const fM = fresh.points[fresh.points.length - 2]!;
  const freshStartLen = Math.hypot(f1[0] - f0[0], f1[1] - f0[1]) || 1;
  const freshEndLen = Math.hypot(fN[0] - fM[0], fN[1] - fM[1]) || 1;
  const beyondFresh = (p: Point, t: number): number =>
    t <= 1e-6
      ? -((p[0] - f0[0]) * (f1[0] - f0[0]) + (p[1] - f0[1]) * (f1[1] - f0[1])) / freshStartLen
      : t >= freshLength - 1e-6
        ? ((p[0] - fN[0]) * (fN[0] - fM[0]) + (p[1] - fN[1]) * (fN[1] - fM[1])) / freshEndLen
        : 0;
  const body: Point[] = held.points.map((p) => {
    const q = project(p, fresh.points, freshArc);
    const weight = Math.max(0, Math.min(1, 1 - beyondFresh(p, q.t) / END_TAPER_PX));
    return [p[0] + alpha * weight * (q.x - p[0]), p[1] + alpha * weight * (q.y - p[1])] as const;
  });

  // Growth: the fresh points that lie PAST the held line's start (or end) along its own direction there — a fresh end
  // merely alongside the held end (its nearest point, but not beyond it) is not new crease.
  const first = held.points[0]!;
  const second = held.points[1]!;
  const last = held.points[held.points.length - 1]!;
  const beforeLast = held.points[held.points.length - 2]!;
  const startLen = Math.hypot(second[0] - first[0], second[1] - first[1]) || 1;
  const endLen = Math.hypot(last[0] - beforeLast[0], last[1] - beforeLast[1]) || 1;
  const pastStart = (p: Point): boolean => ((p[0] - first[0]) * (second[0] - first[0]) + (p[1] - first[1]) * (second[1] - first[1])) / startLen < -GROW_MIN_PX;
  const pastEnd = (p: Point): boolean => ((p[0] - last[0]) * (last[0] - beforeLast[0]) + (p[1] - last[1]) * (last[1] - beforeLast[1])) / endLen > GROW_MIN_PX;
  let lead = 0;
  while (lead < fresh.points.length && pastStart(fresh.points[lead]!)) lead += 1;
  let tail = fresh.points.length;
  while (tail > lead && pastEnd(fresh.points[tail - 1]!)) tail -= 1;
  const unit = (from: Point, to: Point): Point => {
    const len = Math.hypot(to[0] - from[0], to[1] - from[1]) || 1;
    return [(to[0] - from[0]) / len, (to[1] - from[1]) / len] as const;
  };
  /**
   * The grown stretch (fresh points walking away from the junction), Hermite-blended onto the held end: at the join it
   * sits on `anchor` heading `anchorTangent` (outward), by JOIN_FADE_PX it is the fresh path itself.
   */
  const grow = (indices: readonly number[], anchor: Point, anchorTangent: Point, junction: Point, junctionTangent: Point): Point[] => {
    const dx = anchor[0] - junction[0];
    const dy = anchor[1] - junction[1];
    const tx = (anchorTangent[0] - junctionTangent[0]) * JOIN_FADE_PX;
    const ty = (anchorTangent[1] - junctionTangent[1]) * JOIN_FADE_PX;
    let along = 0;
    let previous = junction;
    return indices.map((i) => {
      const p = fresh.points[i]!;
      along += Math.hypot(p[0] - previous[0], p[1] - previous[1]);
      previous = p;
      const v = Math.min(1, along / JOIN_FADE_PX);
      const h1 = 2 * v * v * v - 3 * v * v + 1;
      const h2 = v * v * v - 2 * v * v + v;
      return [p[0] + dx * h1 + tx * h2, p[1] + dy * h1 + ty * h2] as const;
    });
  };
  const beforeIdx: number[] = [];
  for (let i = lead - 1; i >= 0; i -= 1) beforeIdx.push(i); // walking away from the held start
  const afterIdx: number[] = [];
  for (let i = tail; i < fresh.points.length; i += 1) afterIdx.push(i);
  const back = (points: readonly Point[], i: number): Point => points[Math.max(0, Math.min(points.length - 1, i))]!;
  let before: Point[] = [];
  if (beforeIdx.length > 0) {
    const junction = fresh.points[lead] ?? fresh.points[lead - 1]!;
    // Outward at the start: from inside the line toward its start, for the held end and for the fresh path alike.
    before = grow(beforeIdx, body[0]!, unit(back(body, 3), body[0]!), junction, unit(back(fresh.points, lead + 3), junction)).reverse();
  }
  let after: Point[] = [];
  if (afterIdx.length > 0) {
    const junction = fresh.points[tail - 1] ?? fresh.points[tail]!;
    after = grow(afterIdx, body[body.length - 1]!, unit(back(body, body.length - 4), body[body.length - 1]!), junction, unit(back(fresh.points, tail - 4), junction));
  }

  /*
   * Growth only where the join is a crease's own bend: the grown stretch with the held line's last JOIN_CHECK_POINTS
   * must meet the drawn-line bar (≤ TURN_BAR_DEG per 10 px at 256). A fresh path that leaves the held end at a corner
   * has found a different crease beyond it — tight-11's heart curled up at its end while the fresh path ran on level,
   * 50° apart (live); the line keeps its extent this extraction.
   */
  const smoothJoin = (joined: readonly Point[]): boolean => turningBar(joined.map(([x, y]) => ({ x: x * 2, y: y * 2 }))) <= TURN_BAR_DEG;
  if (before.length > 0 && !smoothJoin([...before, ...body.slice(0, JOIN_CHECK_POINTS)])) {
    before = [];
    beforeIdx.length = 0;
  }
  if (after.length > 0 && !smoothJoin([...body.slice(-JOIN_CHECK_POINTS), ...after])) {
    after = [];
    afterIdx.length = 0;
  }
  const points = [...before, ...body, ...after].map(([x, y]) => [round2(x), round2(y)] as const);
  const flags = [...beforeIdx.map((i) => freshFlags[i]!).reverse(), ...heldFlags, ...afterIdx.map((i) => freshFlags[i]!)];
  const ema = (a: number | undefined, b: number | undefined): number | undefined => (a === undefined ? b : b === undefined ? a : a + alpha * (b - a));
  const observed = flags.filter(Boolean).length;
  return {
    ...held,
    points,
    segments: segmentsOf(flags),
    observedFraction: points.length === 0 ? 0 : observed / points.length,
    confidence: Number((ema(held.confidence, fresh.confidence) ?? held.confidence).toFixed(3)),
    score: (() => {
      const s = ema(held.score, fresh.score);
      return s === undefined ? undefined : Number(s.toFixed(2));
    })(),
    traced: true,
  };
}
