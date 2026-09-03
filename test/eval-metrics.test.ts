/* ============================================================================
 * EVAL METRICS — synthetic checks on the distance scoring (Phase 0d)
 *
 * metrics.ts only: no pipeline, no fixtures, no I/O. Constructed polylines
 * whose right answers are known in closed form, so the metric itself is what
 * gets tested — the eval harness's numbers are only as honest as these.
 * ========================================================================== */
import assert from "node:assert/strict";
import {
  EVAL_SIZE,
  EVAL_TOL_PX_AT_512,
  aggregate,
  lineMetrics,
  resamplePolyline,
  type LineRow,
} from "./eval/metrics";

let assertions = 0;
const ok = (condition: boolean, message: string): void => {
  assert.ok(condition, message);
  assertions += 1;
};

const SIZE = EVAL_SIZE;
const frac = (px: number): number => px / SIZE;

/* ----------------------------- 1. Resampling ----------------------------- */

{
  const horizontal = [
    [frac(10), frac(100)],
    [frac(210), frac(100)],
  ];
  const samples = resamplePolyline(horizontal, SIZE, 1);
  ok(Math.abs(samples.length / 2 - 201) <= 1, `1px step over 200px yields ~201 samples (got ${samples.length / 2})`);
  const coarse = resamplePolyline(horizontal, SIZE, 10);
  ok(Math.abs(coarse.length / 2 - 21) <= 1, `10px step honoured (got ${coarse.length / 2})`);
  ok(samples[0] === 10 && samples[samples.length - 2] === 210, "endpoints preserved exactly");
  ok(resamplePolyline([[0.5, 0.5]], SIZE).length === 0, "a single point is not a polyline");
}

/* ----------------------- 2. Identical → perfect score ----------------------- */

{
  const line = [
    [frac(50), frac(60)],
    [frac(150), frac(90)],
    [frac(250), frac(80)],
  ];
  const m = lineMetrics(line, line, SIZE, EVAL_TOL_PX_AT_512);
  ok(m.verdict === "pair", "identical lines are a pair");
  ok(m.precision === 1 && m.recall === 1 && m.f1 === 1, "identical → P = R = F1 = 1");
  ok(m.medianDistPx < 1e-6 && m.p95DistPx < 1e-6, "identical → zero distance");
  ok(m.coverage === m.recall, "coverage aliases recall");
}

/* ----------------------- 3. 4px parallel offset ----------------------- */

{
  const gt = [
    [frac(50), frac(100)],
    [frac(250), frac(100)],
  ];
  const shifted = [
    [frac(50), frac(104)],
    [frac(250), frac(104)],
  ];
  const at6 = lineMetrics(shifted, gt, SIZE, 6);
  ok(at6.precision === 1 && at6.recall === 1, "4px offset is a full match at tol 6");
  const at3 = lineMetrics(shifted, gt, SIZE, 3);
  ok(at3.precision === 0 && at3.recall === 0, "…and a total miss at tol 3");
  ok(Math.abs(at6.medianDistPx - 4) < 0.2, `median distance reads the offset (got ${at6.medianDistPx.toFixed(2)})`);
}

/* ----------------------- 4. Half-length detection ----------------------- */

{
  const gt = [
    [frac(50), frac(100)],
    [frac(250), frac(100)],
  ];
  const half = [
    [frac(50), frac(100)],
    [frac(150), frac(100)],
  ];
  const m = lineMetrics(half, gt, SIZE, EVAL_TOL_PX_AT_512);
  ok(m.precision === 1, "every detected sample lies on the GT — P = 1");
  ok(Math.abs(m.recall - 0.5) < 0.05, `half the GT is covered — R ≈ 0.5 (got ${m.recall.toFixed(3)})`);
  ok(m.f1 > 0.6 && m.f1 < 0.7, "F1 sits at the harmonic mean");
}

/* ----------------------- 5. Absence semantics ----------------------- */

{
  ok(lineMetrics(null, null, SIZE, 6).verdict === "trueNegative", "absent/absent → trueNegative");
  const line = [
    [frac(50), frac(100)],
    [frac(250), frac(100)],
  ];
  ok(lineMetrics(line, null, SIZE, 6).verdict === "falseLine", "gt absent + detected → falseLine");
  ok(lineMetrics(null, line, SIZE, 6).verdict === "missedLine", "gt present + not detected → missedLine");
  ok(lineMetrics([[0.5, 0.5]], line, SIZE, 6).verdict === "missedLine", "a 1-point detection is not a line");
}

/* ----------------------- 6. Aggregation ----------------------- */

{
  const pair = lineMetrics(
    [
      [frac(50), frac(104)],
      [frac(250), frac(104)],
    ],
    [
      [frac(50), frac(100)],
      [frac(250), frac(100)],
    ],
    SIZE,
    6,
  );
  const missed = lineMetrics(null, [[frac(10), frac(10)], [frac(60), frac(60)]], SIZE, 6);
  const falseLine = lineMetrics([[frac(10), frac(10)], [frac(60), frac(60)]], null, SIZE, 6);
  const rows: LineRow[] = [
    { caseId: "a", source: "legacy", hand: "unknown", lineId: "heart", byTol: { 6: pair } },
    { caseId: "a", source: "legacy", hand: "unknown", lineId: "head", byTol: { 6: missed } },
    { caseId: "b", source: "session", hand: "left", lineId: "fate", byTol: { 6: falseLine } },
  ];
  const agg = aggregate(rows, 6);
  ok(agg.overall.n === 2, "n counts GT-present lines (pair + missed)");
  ok(Math.abs(agg.overall.detectRate - 0.5) < 1e-9, "detect rate = pairs / present");
  ok(agg.overall.falseLineRate === 1, "false-line rate over GT-absent lines");
  ok(agg.perLine.heart.n === 1 && agg.perLine.head.detectRate === 0, "per-line buckets split correctly");
  ok(agg.bySource.session.falseLineRate === 1 && agg.byHand.left.falseLineRate === 1, "source/hand breakdowns populated");
}

console.log(`EVAL METRICS ASSERTIONS PASSED (${assertions})`);
