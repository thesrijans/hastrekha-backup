/* ============================================================================
 * VALLEY + ENHANCE — the labeler's shared operator and display-only views
 *
 * The valley response is what the livewire snaps to AND what the CREASE view
 * tints — one operator, so these tests cover both consumers at once. Synthetic
 * imagery only: a drawn dark quadratic curve on a bright noisy field, built
 * with a seeded LCG so every run sees identical pixels.
 * ========================================================================== */
import assert from "node:assert/strict";
import { toGray, valleyResponse } from "../lib/scan/dev/valley";
import {
  CREASE_ALPHA,
  CREASE_BASE_LEVEL,
  CREASE_TINT,
  clahe,
  renderView,
} from "../lib/scan/dev/enhance";

let assertions = 0;
const ok = (condition: boolean, message: string): void => {
  assert.ok(condition, message);
  assertions += 1;
};

const SIZE = 512;

/** Deterministic LCG — same noise on every run. */
function makeRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0xffffffff;
  };
}

/** The synthetic curve: a gentle parabola, y as a function of column x. */
const curveY = (x: number): number => 180 + 0.0009 * (x - 256) * (x - 256);

/**
 * Bright field (200/255) + noise (±7/255 ≈ σ4) + a dark (60/255) curve of width 3.
 * Returned as a [0,1] gray plane.
 */
function syntheticCurveField(noise: boolean): Float32Array {
  const random = makeRandom(20260902);
  const gray = new Float32Array(SIZE * SIZE);
  for (let i = 0; i < gray.length; i += 1) {
    gray[i] = (200 + (noise ? (random() * 14 - 7) : 0)) / 255;
  }
  for (let x = 0; x < SIZE; x += 1) {
    const centre = Math.round(curveY(x));
    for (let dy = -1; dy <= 1; dy += 1) {
      gray[(centre + dy) * SIZE + x] = 60 / 255;
    }
  }
  return gray;
}

/* ------------------------ 1. Valley localises the curve ------------------------ */

{
  const gray = syntheticCurveField(true);
  const valley = valleyResponse(gray, SIZE);

  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (let i = 0; i < valley.length; i += 1) {
    if (valley[i] < min) min = valley[i];
    if (valley[i] > max) max = valley[i];
  }
  ok(min >= 0 && max <= 1, "valley response stays in [0,1]");
  ok(max > 0.5, "the drawn crease actually registers");

  // Per sampled column, the strongest response sits on the curve centre (±1 px).
  let worstMiss = 0;
  for (let x = 16; x < SIZE - 16; x += 8) {
    let best = -1;
    let bestY = -1;
    for (let y = 8; y < SIZE - 8; y += 1) {
      const v = valley[y * SIZE + x];
      if (v > best) {
        best = v;
        bestY = y;
      }
    }
    // Reference is the DRAWN centre row — the curve exists at Math.round(curveY), not at the
    // analytic fraction, and ±1 px is measured against what is actually in the image.
    worstMiss = Math.max(worstMiss, Math.abs(bestY - Math.round(curveY(x))));
  }
  ok(worstMiss <= 1, `per-column argmax within ±1 px of the drawn curve (worst ${worstMiss.toFixed(2)})`);

  // Away from the curve the response is essentially zero — noise does not light up.
  let farSum = 0;
  let farCount = 0;
  for (let x = 16; x < SIZE - 16; x += 4) {
    for (let y = 16; y < SIZE - 16; y += 4) {
      if (Math.abs(y - curveY(x)) > 12) {
        farSum += valley[y * SIZE + x];
        farCount += 1;
      }
    }
  }
  ok(farSum / farCount < 0.02, `far-field mean ≈ 0 (got ${(farSum / farCount).toFixed(4)})`);
}

/* ------------------------------- 2. toGray ------------------------------- */

{
  const rgba = new Uint8ClampedArray(4 * 4);
  rgba.set([255, 0, 0, 255], 0);
  rgba.set([0, 255, 0, 255], 4);
  const gray = toGray(rgba, 2, "LUMA");
  ok(Math.abs(gray[0] - 0.2126) < 1e-4 && Math.abs(gray[1] - 0.7152) < 1e-4, "LUMA uses Rec. 709 weights");
  ok(toGray(rgba, 2, "R")[0] === 1 && toGray(rgba, 2, "R")[1] === 0, "R channel isolates red");
}

/* -------------------------------- 3. CLAHE -------------------------------- */

{
  // Low-contrast horizontal gradient: equalisation must STRETCH it.
  const gradient = new Float32Array(SIZE * SIZE);
  for (let y = 0; y < SIZE; y += 1) {
    for (let x = 0; x < SIZE; x += 1) gradient[y * SIZE + x] = 0.45 + 0.1 * (x / (SIZE - 1));
  }
  /**
   * TILE std, not global: CLAHE is contrast-LIMITED, so the global gradient is preserved almost
   * unchanged (that is the clip doing its job); what must rise is the local, within-tile contrast,
   * whose mapping slope the clip factor caps at ~2.5×.
   */
  const tileStd = (plane: Float32Array): number => {
    let sum = 0;
    let count = 0;
    for (let y = 192; y < 256; y += 1) {
      for (let x = 192; x < 256; x += 1) {
        sum += plane[y * SIZE + x];
        count += 1;
      }
    }
    const mean = sum / count;
    let sq = 0;
    for (let y = 192; y < 256; y += 1) {
      for (let x = 192; x < 256; x += 1) {
        sq += (plane[y * SIZE + x] - mean) * (plane[y * SIZE + x] - mean);
      }
    }
    return Math.sqrt(sq / count);
  };
  const equalised = clahe(gradient, SIZE);
  let inRange = true;
  for (let i = 0; i < equalised.length; i += 1) {
    if (equalised[i] < 0 || equalised[i] > 1) inRange = false;
  }
  ok(inRange, "clahe output stays in [0,1]");
  ok(
    tileStd(equalised) > tileStd(gradient) * 1.5,
    `clahe raises within-tile contrast on a low-contrast gradient (tile std ${tileStd(gradient).toFixed(4)} → ${tileStd(equalised).toFixed(4)})`,
  );

  // A constant image must come out spatially constant — no tile seams invented.
  const flat = new Float32Array(SIZE * SIZE).fill(0.6);
  const flatOut = clahe(flat, SIZE);
  let flatMin = 1;
  let flatMax = 0;
  for (let i = 0; i < flatOut.length; i += 1) {
    if (flatOut[i] < flatMin) flatMin = flatOut[i];
    if (flatOut[i] > flatMax) flatMax = flatOut[i];
  }
  ok(flatMax - flatMin < 1e-6, "constant image stays spatially constant through clahe");
}

/* ------------------------------ 4. renderView ------------------------------ */

const makeImageData = (w: number, h: number): ImageData =>
  ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4), colorSpace: "srgb" }) as ImageData;

{
  const S = 64;
  const rgba = new Uint8ClampedArray(S * S * 4);
  for (let i = 0; i < S * S; i += 1) {
    rgba[i * 4] = 120;
    rgba[i * 4 + 1] = 120;
    rgba[i * 4 + 2] = 120;
    rgba[i * 4 + 3] = 255;
  }
  const valley = new Float32Array(S * S);
  valley[(10 * S + 10)] = 1; // one saturated crease pixel

  const natural = renderView(rgba, S, "NATURAL", "LUMA", undefined, makeImageData);
  ok(natural.data.length === S * S * 4 && natural.data[0] === 120, "NATURAL is a passthrough");

  const crease = renderView(rgba, S, "CREASE", "LUMA", valley, makeImageData);
  ok(crease.data.length === S * S * 4, "CREASE stays inside the crop bounds");
  // valley = 0 → pure darkened base, zero tint: R = G = B = gray × base level.
  const baseAt = 0;
  const expectedBase = Math.round((120 / 255) * CREASE_BASE_LEVEL * 255);
  ok(
    crease.data[baseAt] === expectedBase && crease.data[baseAt] === crease.data[baseAt + 1] && crease.data[baseAt + 1] === crease.data[baseAt + 2],
    "zero-valley pixels are untinted darkened base",
  );
  // valley = 1 → blend alpha is exactly CREASE_ALPHA, never more.
  const hotAt = (10 * S + 10) * 4;
  const expectedHotR = Math.round(expectedBase * (1 - CREASE_ALPHA) + CREASE_TINT[0] * CREASE_ALPHA);
  ok(Math.abs(crease.data[hotAt] - expectedHotR) <= 1, "full-valley pixel blends at exactly CREASE_ALPHA");
  ok(crease.data[hotAt] > crease.data[hotAt + 2], "the tint is gold — red above blue");
  let finite = true;
  for (let i = 0; i < crease.data.length; i += 1) {
    if (!Number.isFinite(crease.data[i])) finite = false;
  }
  ok(finite, "no NaN anywhere in the composite");

  const contrast = renderView(rgba, S, "CONTRAST", "LUMA", undefined, makeImageData);
  ok(contrast.data[0] === contrast.data[1] && contrast.data[1] === contrast.data[2], "CONTRAST renders grey");
}

console.log(`VALLEY + ENHANCE ASSERTIONS PASSED (${assertions})`);
