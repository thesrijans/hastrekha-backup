/* ============================================================================
 * CORRIDOR PATH — masked Dijkstra over synthetic contract fields
 *
 * Fields are built in P(crease) units (that is the contract), with the fate
 * corridor's OWN rasterised centreline as the drawing guide, so the tests and
 * the search agree pixel-for-pixel on where the corridor is.
 * ========================================================================== */
import assert from "node:assert/strict";
import {
  buildCorridorMask,
  searchCorridor,
  CORRIDOR_ACCEPT_MEAN,
  CORRIDOR_ACCEPT_P10,
  CORRIDOR_MAX_GAP_FRACTION,
} from "../lib/scan/corridor-path";
import { CORRIDORS } from "../lib/scan/completion";

let assertions = 0;
const ok = (condition: boolean, message: string): void => {
  assert.ok(condition, message);
  assertions += 1;
};

const S = 128;
const PLANE = S * S;
const FATE = CORRIDORS.fate;

/** Stamp `value` in a small disc at each corridor-centreline sample between two s-fractions. */
function drawCentreline(field: Float32Array, from: number, to: number, value: number): void {
  const { centreline } = buildCorridorMask(FATE, S);
  const a = Math.floor(from * (centreline.length - 1));
  const b = Math.ceil(to * (centreline.length - 1));
  for (let i = a; i <= b; i += 1) {
    const cx = Math.round(centreline[i].x);
    const cy = Math.round(centreline[i].y);
    for (let dy = -1; dy <= 1; dy += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        const px = cx + dx;
        const py = cy + dy;
        if (px >= 0 && px < S && py >= 0 && py < S) field[py * S + px] = value;
      }
    }
  }
}

const noiseField = (amplitude: number): Float32Array => {
  let seed = 7;
  const random = (): number => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  const field = new Float32Array(PLANE);
  for (let i = 0; i < PLANE; i += 1) field[i] = random() * amplitude;
  return field;
};

/* ----------------------- 1. A faint line is found ----------------------- */

{
  const field = new Float32Array(PLANE).fill(0.02);
  drawCentreline(field, 0, 1, 0.5);
  const result = searchCorridor(field, S, FATE);
  ok(result !== null, "a continuous faint (0.5) line down the corridor is FOUND");
  if (result !== null) {
    ok(result.insideFraction >= 0.9, `insideFraction ${result.insideFraction.toFixed(2)} >= 0.9`);
    ok(Math.abs(result.meanField - 0.5) < 0.12, `meanField ${result.meanField.toFixed(3)} ~ the drawn 0.5`);
    ok(result.maxGapFraction < CORRIDOR_MAX_GAP_FRACTION, "no gap on a continuous line");
    // Simplified, bounded, deterministic.
    ok(result.points.length >= 2 && result.points.length <= 40, `simplified point count bounded (${result.points.length})`);
    const again = searchCorridor(field, S, FATE);
    assert.deepEqual(again?.points, result.points, "deterministic across two runs");
    assertions += 1;
  }
}

/* ----------------------- 2. Pure noise is rejected ----------------------- */

{
  const field = noiseField(0.1);
  ok(searchCorridor(field, S, FATE) === null, "a pure-noise corridor is rejected — no phantom fate");
}

/* ------------------ 3. A bright line OUTSIDE stays outside ------------------ */

{
  const field = new Float32Array(PLANE).fill(0.02);
  // A blazing vertical line at x = 12 — far outside the fate corridor (x ≈ 60 of 128).
  for (let y = 5; y < S - 5; y += 1) field[y * S + 12] = 1;
  ok(searchCorridor(field, S, FATE) === null, "a bright line outside the corridor cannot be claimed — the mask holds");
}

/* --------------------- 4. A long dead stretch rejects --------------------- */

{
  const field = new Float32Array(PLANE).fill(0.02);
  drawCentreline(field, 0, 0.35, 0.5);
  drawCentreline(field, 0.75, 1, 0.5);
  // The 0.35–0.75 stretch stays at 0.02 — a 40% hole. Finding: the p10 gate mathematically
  // DOMINATES the maxGap gate as authored (p10 >= CORRIDOR_ACCEPT_P10 caps below-threshold
  // samples at 10%, and a contiguous 10% can never reach the 15% gap limit), so this path is
  // rejected by p10 first; maxGap stands as defence-in-depth should calibration ever relax p10.
  ok(searchCorridor(field, S, FATE) === null, "a mostly-gap path is rejected — a chained phantom does not pass");
}

/* -------------------------- 5. Constants sanity -------------------------- */

ok(CORRIDOR_ACCEPT_MEAN > CORRIDOR_ACCEPT_P10, "the mean floor sits above the p10 floor");

console.log(`CORRIDOR PATH ASSERTIONS PASSED (${assertions})`);
