/**
 * Polyline distance metrics for the eval harness (sprint Phase 0d) — pure, no I/O.
 *
 * This is the replacement for snapshot deepEqual: detected polylines are scored against
 * hand-traced ground truth with symmetric sample-coverage metrics, so a core change moves a
 * NUMBER instead of flipping a snapshot. All geometry enters as 0–1 canonical-crop fractions and
 * is evaluated in one fixed metric space ({@link EVAL_SIZE}), so cases labeled at 256 and at 512
 * score on the same scale.
 */
import type { LabelableLineId } from "../../lib/scan/dev/session-types";

/** The common metric space every case is scored in, regardless of its native label resolution. */
export const EVAL_SIZE = 512;

/** Match tolerance at the 512 metric space — ≈1.2% of size. */
export const EVAL_TOL_PX_AT_512 = 6;

/** The tolerance curve reported alongside the headline number. */
export const EVAL_TOLS: readonly number[] = [3, EVAL_TOL_PX_AT_512, 10];

/* --------------------------------- Types --------------------------------- */

export type LineVerdict = "pair" | "trueNegative" | "falseLine" | "missedLine";

export interface LineMetrics {
  readonly verdict: LineVerdict;
  /** Fraction of detected samples within tol of any GT sample. NaN unless verdict === "pair". */
  readonly precision: number;
  /** Fraction of GT samples within tol of any detected sample. NaN unless verdict === "pair". */
  readonly recall: number;
  readonly f1: number;
  /** Median detected→GT sample distance, px in the {@link EVAL_SIZE} space. */
  readonly medianDistPx: number;
  readonly p95DistPx: number;
  /** Alias of recall — how much of the GT line the detection covers. */
  readonly coverage: number;
}

export interface LineRow {
  readonly caseId: string;
  readonly source: "legacy" | "session";
  readonly hand: "left" | "right" | "unknown";
  readonly lineId: LabelableLineId;
  /** Metrics per tolerance, keyed by the tol value. */
  readonly byTol: Readonly<Record<number, LineMetrics>>;
}

/* -------------------------------- Resample -------------------------------- */

/**
 * Resample a fraction-space polyline to evenly spaced px samples in `size` space.
 * Returns interleaved xy pairs. A polyline with < 2 points yields an empty array.
 */
export function resamplePolyline(
  points01: readonly (readonly number[])[],
  size: number,
  stepPx = 1,
): Float32Array {
  if (points01.length < 2) return new Float32Array(0);
  const pts = points01.map((p) => [p[0] * size, p[1] * size] as const);
  let total = 0;
  for (let i = 1; i < pts.length; i += 1) total += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  if (total === 0) return new Float32Array([pts[0][0], pts[0][1]]);
  const count = Math.max(2, Math.floor(total / stepPx) + 1);
  const out = new Float32Array(count * 2);
  let segment = 1;
  let travelled = 0;
  let segStart = 0;
  let segLen = Math.hypot(pts[1][0] - pts[0][0], pts[1][1] - pts[0][1]);
  for (let s = 0; s < count; s += 1) {
    const target = (s / (count - 1)) * total;
    while (segStart + segLen < target && segment < pts.length - 1) {
      segStart += segLen;
      segment += 1;
      segLen = Math.hypot(pts[segment][0] - pts[segment - 1][0], pts[segment][1] - pts[segment - 1][1]);
    }
    const t = segLen === 0 ? 0 : Math.min(1, Math.max(0, (target - segStart) / segLen));
    out[s * 2] = pts[segment - 1][0] + (pts[segment][0] - pts[segment - 1][0]) * t;
    out[s * 2 + 1] = pts[segment - 1][1] + (pts[segment][1] - pts[segment - 1][1]) * t;
    travelled = target;
  }
  void travelled;
  return out;
}

/* --------------------------------- Metrics --------------------------------- */

function nearestDistances(from: Float32Array, to: Float32Array): Float32Array {
  const n = from.length / 2;
  const m = to.length / 2;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i += 1) {
    const x = from[i * 2];
    const y = from[i * 2 + 1];
    let best = Number.POSITIVE_INFINITY;
    for (let j = 0; j < m; j += 1) {
      const dx = to[j * 2] - x;
      const dy = to[j * 2 + 1] - y;
      const d = dx * dx + dy * dy;
      if (d < best) best = d;
    }
    out[i] = Math.sqrt(best);
  }
  return out;
}

const quantile = (sorted: Float32Array, q: number): number =>
  sorted.length === 0 ? NaN : sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];

const NO_PAIR: Omit<LineMetrics, "verdict"> = {
  precision: NaN,
  recall: NaN,
  f1: NaN,
  medianDistPx: NaN,
  p95DistPx: NaN,
  coverage: NaN,
};

/**
 * Score one line. `null` means "not detected" / "labeled absent" respectively; a polyline with
 * < 2 points counts as absent on either side.
 */
export function lineMetrics(
  detected01: readonly (readonly number[])[] | null,
  gt01: readonly (readonly number[])[] | null,
  size: number,
  tolPx: number,
): LineMetrics {
  const det = detected01 !== null && detected01.length >= 2 ? detected01 : null;
  const gt = gt01 !== null && gt01.length >= 2 ? gt01 : null;
  if (gt === null && det === null) return { verdict: "trueNegative", ...NO_PAIR };
  if (gt === null) return { verdict: "falseLine", ...NO_PAIR };
  if (det === null) return { verdict: "missedLine", ...NO_PAIR };

  const detSamples = resamplePolyline(det, size);
  const gtSamples = resamplePolyline(gt, size);
  const detToGt = nearestDistances(detSamples, gtSamples);
  const gtToDet = nearestDistances(gtSamples, detSamples);

  let hitDet = 0;
  for (let i = 0; i < detToGt.length; i += 1) if (detToGt[i] <= tolPx) hitDet += 1;
  let hitGt = 0;
  for (let i = 0; i < gtToDet.length; i += 1) if (gtToDet[i] <= tolPx) hitGt += 1;

  const precision = detToGt.length === 0 ? 0 : hitDet / detToGt.length;
  const recall = gtToDet.length === 0 ? 0 : hitGt / gtToDet.length;
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
  const sorted = Float32Array.from(detToGt).sort();
  return {
    verdict: "pair",
    precision,
    recall,
    f1,
    medianDistPx: quantile(sorted, 0.5),
    p95DistPx: quantile(sorted, 0.95),
    coverage: recall,
  };
}

/* -------------------------------- Aggregate -------------------------------- */

export interface AggregateBucket {
  /** Present-in-GT lines (pair + missedLine). */
  readonly n: number;
  /** pairs / n — how often a present line was detected at all. */
  readonly detectRate: number;
  /** falseLine / (falseLine + trueNegative) — how often an absent line was invented. */
  readonly falseLineRate: number;
  readonly meanPrecision: number;
  readonly meanRecall: number;
  readonly meanF1: number;
  readonly meanMedianDistPx: number;
  readonly meanP95DistPx: number;
}

export interface AggregateResult {
  readonly perLine: Readonly<Record<string, AggregateBucket>>;
  readonly overall: AggregateBucket;
  readonly bySource: Readonly<Record<string, AggregateBucket>>;
  readonly byHand: Readonly<Record<string, AggregateBucket>>;
}

function bucket(rows: readonly LineRow[], tol: number): AggregateBucket {
  let pairs = 0;
  let missed = 0;
  let falseLines = 0;
  let trueNegatives = 0;
  let sumP = 0;
  let sumR = 0;
  let sumF1 = 0;
  let sumMedian = 0;
  let sumP95 = 0;
  for (const row of rows) {
    const m = row.byTol[tol];
    if (m === undefined) continue;
    if (m.verdict === "pair") {
      pairs += 1;
      sumP += m.precision;
      sumR += m.recall;
      sumF1 += m.f1;
      sumMedian += m.medianDistPx;
      sumP95 += m.p95DistPx;
    } else if (m.verdict === "missedLine") missed += 1;
    else if (m.verdict === "falseLine") falseLines += 1;
    else trueNegatives += 1;
  }
  const present = pairs + missed;
  const absent = falseLines + trueNegatives;
  return {
    n: present,
    detectRate: present === 0 ? NaN : pairs / present,
    falseLineRate: absent === 0 ? NaN : falseLines / absent,
    meanPrecision: pairs === 0 ? NaN : sumP / pairs,
    meanRecall: pairs === 0 ? NaN : sumR / pairs,
    meanF1: pairs === 0 ? NaN : sumF1 / pairs,
    meanMedianDistPx: pairs === 0 ? NaN : sumMedian / pairs,
    meanP95DistPx: pairs === 0 ? NaN : sumP95 / pairs,
  };
}

/** Aggregate scored rows at one tolerance, with per-line / per-source / per-hand breakdowns. */
export function aggregate(rows: readonly LineRow[], tol: number): AggregateResult {
  const by = <K extends string>(key: (row: LineRow) => K): Record<string, AggregateBucket> => {
    const groups = new Map<string, LineRow[]>();
    for (const row of rows) {
      const k = key(row);
      const list = groups.get(k);
      if (list === undefined) groups.set(k, [row]);
      else list.push(row);
    }
    const out: Record<string, AggregateBucket> = {};
    for (const [k, list] of groups) out[k] = bucket(list, tol);
    return out;
  };
  return {
    perLine: by((row) => row.lineId),
    overall: bucket(rows, tol),
    bySource: by((row) => row.source),
    byHand: by((row) => row.hand),
  };
}
