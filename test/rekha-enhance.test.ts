/**
 * ============================================================================
 * REKHA ENHANCE — orientation field, coherence enhancement, oriented NMS,
 * temporal evidence with motion compensation.
 * Synthetic scenes only: a bright palm with one dark crease and a detector
 * response that is peaked on the crease, noisy elsewhere, and optionally
 * dropped over a gap. Deterministic via mulberry32.
 * ============================================================================
 */
import assert from "node:assert/strict";
import { CoherenceEnhancer } from "../lib/scan/enhance/coherence-enhance";
import { EvidenceAccumulator, PIXEL_CONFIRMED } from "../lib/scan/enhance/evidence";
import { OrientationEstimator } from "../lib/scan/enhance/orientation";
import { orientedNonMaxSuppressionInto } from "../lib/scan/enhance/oriented-nms";
import { RekhaEnhancer, frameWeightFromSharpness } from "../lib/scan/enhance/rekha-enhancer";

let passed = 0;
function ok(condition: boolean, message: string): void {
  assert.ok(condition, message);
  passed += 1;
}

const SIZE = 256;
const ROW_START = 30;
const ROW_END = 226;

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gaussianNoise(rand: () => number): number {
  const u = Math.max(rand(), 1e-9);
  const v = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

interface SceneOptions {
  readonly curveX: (y: number) => number;
  readonly seed: number;
  readonly grayNoise?: number;
  readonly responseNoise?: number;
  readonly responseGap?: readonly [number, number];
  readonly responseLine?: boolean;
}

function makeScene(options: SceneOptions): { gray: Float32Array; response: Float32Array } {
  const rand = mulberry32(options.seed);
  const grayNoise = options.grayNoise ?? 0.03;
  const responseNoise = options.responseNoise ?? 0.05;
  const gray = new Float32Array(SIZE * SIZE);
  const response = new Float32Array(SIZE * SIZE);
  const drawLine = options.responseLine ?? true;
  for (let y = 0; y < SIZE; y += 1) {
    const xc = options.curveX(y);
    const inGap = options.responseGap !== undefined && y >= options.responseGap[0] && y < options.responseGap[1];
    for (let x = 0; x < SIZE; x += 1) {
      const i = y * SIZE + x;
      const d = x - xc;
      const crease = 0.5 * Math.exp(-(d * d) / (2 * 1.0));
      gray[i] = 0.8 - crease + grayNoise * gaussianNoise(rand);
      let r = Math.abs(responseNoise * gaussianNoise(rand));
      if (drawLine && !inGap) r = Math.max(r, Math.exp(-(d * d) / (2 * 0.36)));
      response[i] = r > 1 ? 1 : r;
    }
  }
  return { gray, response };
}

function meanOver(arr: Float32Array | Uint8Array, predicate: (x: number, y: number) => boolean, map: (v: number) => number = (v) => v): number {
  let sum = 0;
  let n = 0;
  for (let y = 0; y < SIZE; y += 1) {
    for (let x = 0; x < SIZE; x += 1) {
      if (predicate(x, y)) {
        sum += map(arr[y * SIZE + x] ?? 0);
        n += 1;
      }
    }
  }
  return n > 0 ? sum / n : 0;
}

const onRows = (y: number): boolean => y >= ROW_START && y < ROW_END;

// ---------------------------------------------------------------------------
// Orientation
// ---------------------------------------------------------------------------
{
  const vertical = makeScene({ curveX: () => 128, seed: 1 });
  const est = new OrientationEstimator(SIZE);
  const field = est.estimate(vertical.gray);

  const alongY = meanOver(field.theta, (x, y) => x === 128 && onRows(y), (t) => Math.abs(Math.sin(t)));
  ok(alongY >= 0.95, `vertical crease: mean |sin θ| on the line = ${alongY.toFixed(3)} (≥ 0.95)`);

  const cohOn = meanOver(field.coherence, (x, y) => x === 128 && onRows(y));
  ok(cohOn >= 0.6, `vertical crease: mean coherence on the line = ${cohOn.toFixed(3)} (≥ 0.6)`);

  const cohOff = meanOver(field.coherence, (x, y) => x >= 20 && x < 80 && onRows(y));
  ok(cohOff <= 0.35, `isotropic noise: mean coherence = ${cohOff.toFixed(3)} (≤ 0.35)`);

  const diagonal = makeScene({ curveX: (y) => y, seed: 2 });
  const fieldD = est.estimate(diagonal.gray);
  const alongDiag = meanOver(fieldD.theta, (x, y) => x === y && onRows(y), (t) => Math.abs(Math.cos(t - Math.PI / 4)));
  ok(alongDiag >= 0.95, `diagonal crease: mean |cos(θ − π/4)| = ${alongDiag.toFixed(3)} (≥ 0.95)`);

  ok(est.estimate(vertical.gray) === field, "estimate() returns the same field object (no allocation)");
}

// ---------------------------------------------------------------------------
// Coherence enhancement
// ---------------------------------------------------------------------------
{
  const scene = makeScene({ curveX: () => 128, seed: 3, responseGap: [100, 105] });
  const est = new OrientationEstimator(SIZE);
  const field = est.estimate(scene.gray);
  const enhancer = new CoherenceEnhancer(SIZE);
  const out = new Float32Array(SIZE * SIZE);
  enhancer.enhanceInto(scene.response, field, out);

  const gapBefore = scene.response[102 * SIZE + 128] ?? 0;
  const gapAfter = out[102 * SIZE + 128] ?? 0;
  ok(gapBefore < 0.2, `gap centre before enhancement = ${gapBefore.toFixed(3)} (< 0.2)`);
  ok(gapAfter >= 0.35, `gap centre after enhancement = ${gapAfter.toFixed(3)} (≥ 0.35, dropout bridged)`);

  const onLine = meanOver(out, (x, y) => x === 128 && onRows(y) && (y < 100 || y >= 105));
  ok(onLine >= 0.75, `on-line enhanced mean = ${onLine.toFixed(3)} (≥ 0.75)`);

  const offBefore = meanOver(scene.response, (x, y) => x >= 40 && x < 60 && onRows(y));
  const offAfter = meanOver(out, (x, y) => x >= 40 && x < 60 && onRows(y));
  ok(offAfter <= 0.05, `off-line enhanced mean = ${offAfter.toFixed(4)} (≤ 0.05)`);
  ok(offAfter < offBefore, `off-line mean fell ${offBefore.toFixed(4)} → ${offAfter.toFixed(4)}`);

  let inRange = true;
  for (let i = 0; i < out.length; i += 1) {
    const v = out[i] ?? -1;
    if (!(v >= 0 && v <= 1)) inRange = false;
  }
  ok(inRange, "enhanced output stays in [0, 1]");
}

// ---------------------------------------------------------------------------
// Oriented NMS
// ---------------------------------------------------------------------------
{
  const scene = makeScene({ curveX: (y) => 128 + 20 * Math.sin(y / 40), seed: 4 });
  const est = new OrientationEstimator(SIZE);
  const field = est.estimate(scene.gray);
  const enhancer = new CoherenceEnhancer(SIZE);
  const enhanced = new Float32Array(SIZE * SIZE);
  enhancer.enhanceInto(scene.response, field, enhanced);
  const ridge = new Float32Array(SIZE * SIZE);
  orientedNonMaxSuppressionInto(enhanced, field, SIZE, ridge, 0.12);

  let rows = 0;
  let thinRows = 0;
  let emptyRows = 0;
  for (let y = ROW_START; y < ROW_END; y += 1) {
    const xc = Math.round(128 + 20 * Math.sin(y / 40));
    let count = 0;
    for (let x = xc - 8; x <= xc + 8; x += 1) {
      if ((ridge[y * SIZE + x] ?? 0) > 0) count += 1;
    }
    rows += 1;
    if (count >= 1 && count <= 2) thinRows += 1;
    if (count === 0) emptyRows += 1;
  }
  ok(thinRows / rows >= 0.95, `curved crease: ${thinRows}/${rows} rows have a 1–2 px ridge (≥ 95%)`);
  ok(emptyRows === 0, `curved crease: no row lost its ridge (${emptyRows} empty)`);

  const offFraction = meanOver(ridge, (x, y) => x >= 20 && x < 80 && onRows(y), (v) => (v > 0 ? 1 : 0));
  ok(offFraction <= 0.02, `off-line ridge fraction = ${(offFraction * 100).toFixed(2)}% (≤ 2%)`);
}

// ---------------------------------------------------------------------------
// Temporal evidence: confirm, hold, drop
// ---------------------------------------------------------------------------
{
  const enhancer = new RekhaEnhancer(SIZE);
  const confirmedOnLine = (state: Uint8Array): number =>
    meanOver(state, (x, y) => x === 128 && onRows(y), (v) => (v === PIXEL_CONFIRMED ? 1 : 0));
  const confirmedOff = (state: Uint8Array): number =>
    meanOver(state, (x, y) => x >= 20 && x < 80 && onRows(y), (v) => (v === PIXEL_CONFIRMED ? 1 : 0));

  let result = enhancer.process(new Float32Array(SIZE * SIZE), new Float32Array(SIZE * SIZE), 0);
  for (let f = 0; f < 6; f += 1) {
    const scene = makeScene({ curveX: () => 128, seed: 100 + f });
    result = enhancer.process(scene.gray, scene.response, 1);
  }
  ok(enhancer.frameCount === 6, `zero-weight frame skipped; frameCount = ${enhancer.frameCount}`);
  const c6 = confirmedOnLine(result.state);
  ok(c6 >= 0.9, `after 6 frames: ${(c6 * 100).toFixed(1)}% of the crease is CONFIRMED (≥ 90%)`);
  const off6 = confirmedOff(result.state);
  ok(off6 === 0, `after 6 frames: ${(off6 * 100).toFixed(2)}% of noise region CONFIRMED (= 0)`);
  ok(result.shiftX === 0 && result.shiftY === 0, "static scene: no shift applied");

  const probOn = meanOver(result.probability, (x, y) => x === 128 && onRows(y));
  ok(probOn >= 0.95, `on-line probability = ${probOn.toFixed(3)} (≥ 0.95)`);

  for (let f = 0; f < 8; f += 1) {
    const scene = makeScene({ curveX: () => 128, seed: 200 + f, responseLine: false });
    result = enhancer.process(scene.gray, scene.response, 1);
  }
  const cDrop = confirmedOnLine(result.state);
  ok(cDrop <= 0.05, `after 8 frames of detector dropout: ${(cDrop * 100).toFixed(1)}% still CONFIRMED (≤ 5%)`);

  const same = enhancer.process(new Float32Array(SIZE * SIZE), new Float32Array(SIZE * SIZE), 1);
  ok(same === result, "process() returns the same result object (no allocation)");
}

// ---------------------------------------------------------------------------
// Motion compensation
// ---------------------------------------------------------------------------
{
  const enhancer = new RekhaEnhancer(SIZE);
  const confirmedAt = (state: Uint8Array, xc: number): number =>
    meanOver(state, (x, y) => x === xc && onRows(y), (v) => (v === PIXEL_CONFIRMED ? 1 : 0));

  let result = enhancer.process(new Float32Array(SIZE * SIZE), new Float32Array(SIZE * SIZE), 1);
  for (let f = 0; f < 4; f += 1) {
    const scene = makeScene({ curveX: () => 120, seed: 300 + f, grayNoise: 0.02 });
    result = enhancer.process(scene.gray, scene.response, 1);
  }
  ok(confirmedAt(result.state, 120) >= 0.9, "before motion: crease at x=120 CONFIRMED");

  const moved = makeScene({ curveX: () => 123, seed: 310, grayNoise: 0.02 });
  result = enhancer.process(moved.gray, moved.response, 1);
  ok(result.shiftX === 3 && result.shiftY === 0, `3 px jitter estimated as (${result.shiftX}, ${result.shiftY})`);
  const c123 = confirmedAt(result.state, 123);
  ok(c123 >= 0.9, `immediately after the shift: ${(c123 * 100).toFixed(1)}% CONFIRMED at x=123 (≥ 90%, evidence moved with the hand)`);
  const c120 = confirmedAt(result.state, 120);
  ok(c120 <= 0.1, `old position x=120: ${(c120 * 100).toFixed(1)}% CONFIRMED (≤ 10%)`);

  const acc = new EvidenceAccumulator(SIZE, { motionEnabled: false });
  acc.update(moved.response, moved.gray, 1);
  acc.update(moved.response, moved.gray, 1);
  ok(acc.lastShiftX === 0 && acc.lastShiftY === 0, "motionEnabled=false never shifts");
}

// ---------------------------------------------------------------------------
// Frame weight
// ---------------------------------------------------------------------------
{
  ok(frameWeightFromSharpness(40) === 0, "VoL 40 → weight 0");
  ok(frameWeightFromSharpness(60) === 0, "VoL 60 (floor) → weight 0");
  ok(Math.abs(frameWeightFromSharpness(140) - 0.5) < 1e-9, "VoL 140 → weight 0.5");
  ok(frameWeightFromSharpness(300) === 1, "VoL 300 → weight 1");
  ok(frameWeightFromSharpness(Number.NaN) === 0, "VoL NaN → weight 0");
}

console.log(`REKHA ENHANCE ASSERTIONS PASSED (${passed})`);
