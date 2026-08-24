import assert from "node:assert/strict";
import {
  blackHat,
  blackHatMulti,
  buildSupport,
  clahe,
  detectRidges,
  gaborBank,
  gaborKernels,
  grayFromRgba,
  normalizeResponses,
} from "../lib/scan/ridge";
import {
  combineProbabilities,
  RIDGE_BLEND_WEIGHT,
  RIDGE_FLOOR_WEIGHT,
  UNET_WEIGHT,
} from "../lib/scan/segmenter";

/* -------------------------------- Grayscale -------------------------------- */

{
  const rgba = new Uint8ClampedArray([255, 255, 255, 255, 0, 0, 0, 255, 255, 0, 0, 255]);
  const gray = grayFromRgba(rgba, 3, 1);
  assert.ok(Math.abs(gray[0] - 1) < 1e-6, "white maps to 1");
  assert.ok(Math.abs(gray[1]) < 1e-6, "black maps to 0");
  assert.ok(Math.abs(gray[2] - 0.2126) < 1e-4, "pure red maps to its luma coefficient");
}

/* ---------------------------------- CLAHE ----------------------------------- */

{
  const size = 64;

  /* Constant input: nothing to equalise. Must stay constant, bounded, and NaN-free. */
  const flat = new Float32Array(size * size).fill(0.5);
  const flatOut = clahe(flat, size);
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < flatOut.length; i += 1) {
    assert.ok(Number.isFinite(flatOut[i]), "CLAHE of a constant image is finite everywhere");
    if (flatOut[i] < min) min = flatOut[i];
    if (flatOut[i] > max) max = flatOut[i];
  }
  assert.ok(max - min < 1e-6, "CLAHE of a constant image is constant");
  assert.ok(min >= 0 && max <= 1, "and bounded to [0,1]");

  /*
   * Low-contrast gradient, at the production crop size. Global stddev is deliberately NOT the
   * metric: CLAHE flattens global illumination gradients while amplifying local structure — that is
   * its job. The property the pipeline relies on is local-contrast amplification, so measure the
   * mean absolute neighbour difference instead.
   */
  const big = 256;
  const gradient = new Float32Array(big * big);
  for (let y = 0; y < big; y += 1) {
    for (let x = 0; x < big; x += 1) gradient[y * big + x] = 0.45 + 0.1 * (x / big);
  }
  const stretched = clahe(gradient, big);
  const localContrast = (field: Float32Array): number => {
    let total = 0;
    let count = 0;
    for (let y = 0; y < big; y += 1) {
      for (let x = 1; x < big; x += 1) {
        total += Math.abs(field[y * big + x] - field[y * big + x - 1]);
        count += 1;
      }
    }
    return total / count;
  };
  assert.ok(
    localContrast(stretched) > localContrast(gradient) * 2,
    `CLAHE amplifies local contrast (${(localContrast(stretched) / localContrast(gradient)).toFixed(1)}x)`,
  );
  for (let i = 0; i < stretched.length; i += 1) {
    assert.ok(stretched[i] >= 0 && stretched[i] <= 1, "stretched output stays in [0,1]");
  }
}

/* --------------------------------- Black-hat -------------------------------- */

{
  const size = 64;

  /* A dark horizontal line on a flat background: black-hat must lift the line and nothing else. */
  const darkLine = new Float32Array(size * size).fill(0.6);
  for (let x = 4; x < 60; x += 1) darkLine[32 * size + x] = 0.15;
  const lifted = blackHat(darkLine, size, 2);
  let onLine = 0;
  let offLine = 0;
  let offCount = 0;
  for (let x = 8; x < 56; x += 1) onLine += lifted[32 * size + x];
  onLine /= 48;
  for (let y = 0; y < size; y += 1) {
    if (Math.abs(y - 32) <= 4) continue;
    for (let x = 0; x < size; x += 1) {
      offLine += lifted[y * size + x];
      offCount += 1;
    }
  }
  offLine /= offCount;
  assert.ok(onLine > 0.3, `black-hat lifts the dark line (${onLine.toFixed(3)})`);
  assert.ok(offLine < 0.01, `and leaves the background flat (${offLine.toFixed(4)})`);

  /* A BRIGHT line must produce nothing — black-hat is a dark-crease detector by construction. */
  const brightLine = new Float32Array(size * size).fill(0.3);
  for (let x = 4; x < 60; x += 1) brightLine[32 * size + x] = 0.9;
  const brightOut = blackHatMulti(brightLine, size);
  let brightMax = 0;
  for (let i = 0; i < brightOut.length; i += 1) {
    if (brightOut[i] > brightMax) brightMax = brightOut[i];
  }
  assert.ok(brightMax < 0.05, `a bright line yields ~zero black-hat (${brightMax.toFixed(4)})`);
}

/* ---------------------------------- Gabor ----------------------------------- */

{
  const kernels = gaborKernels();
  assert.equal(kernels.length, 16, "8 orientations × 2 scales");
  for (const kernel of kernels) {
    let sum = 0;
    let norm = 0;
    for (let i = 0; i < kernel.taps.length; i += 1) {
      sum += kernel.taps[i];
      norm += kernel.taps[i] * kernel.taps[i];
    }
    assert.ok(Math.abs(sum) < 1e-4, "every kernel is zero-mean (flat input → zero response)");
    assert.ok(Math.abs(Math.sqrt(norm) - 1) < 1e-4, "every kernel is L2-normalised");
  }
}

/* --------------------------- Sparse support exactness ----------------------- */

{
  /*
   * Regression for a bug adversarial review reproduced: the support mask was dilated with a
   * Euclidean disc while the Gabor kernels read a square neighbourhood, so evidence at diagonal
   * offsets like (±5,±5) fell inside the kernel but outside the mask, and genuine responses were
   * zeroed. With square dilation, sparse and dense evaluation must agree EXACTLY — a lone impulse
   * is the worst case, because every pixel's response comes from a single evidence point.
   */
  const size = 64;
  const field = new Float32Array(size * size);
  field[32 * size + 32] = 1;

  const support = buildSupport(field, size);
  const sparse = gaborBank(field, size, support);
  const dense = gaborBank(field, size, null);
  for (let i = 0; i < field.length; i += 1) {
    assert.ok(
      Math.abs(sparse[i] - dense[i]) < 1e-9,
      `sparse and dense Gabor agree at pixel ${i} (${sparse[i]} vs ${dense[i]})`,
    );
  }
}

/* ------------------------------ Normalisation ------------------------------- */

{
  const empty = normalizeResponses(new Float32Array(64));
  for (let i = 0; i < empty.length; i += 1) assert.equal(empty[i], 0, "no positives → all zeros");

  const weak = new Float32Array(100);
  weak[0] = 0.01; // far below the floor
  const weakOut = normalizeResponses(weak);
  assert.ok(weakOut[0] < 0.3, "a lone weak response is not amplified to full confidence");
}

/* ------------------------------ The full chain ------------------------------ */

{
  const size = 256;
  const background = 0.6;
  const lineValue = 0.15;

  /* A dark sine curve — the shape of a real palm crease, neither straight nor axis-aligned. */
  const gray = new Float32Array(size * size).fill(background);
  const curveY = (x: number): number => 128 + 40 * Math.sin(x / 40);
  for (let x = 0; x < size; x += 1) {
    const yc = Math.round(curveY(x));
    for (let dy = -1; dy <= 1; dy += 1) {
      const y = yc + dy;
      if (y >= 0 && y < size) gray[y * size + x] = lineValue;
    }
  }

  const result = detectRidges(gray, size);
  const { probability, timings } = result;
  assert.equal(probability.length, size * size, "probability field matches the crop");

  let onSum = 0;
  let onCount = 0;
  let offSum = 0;
  let offCount = 0;
  for (let x = 8; x < size - 8; x += 1) {
    const yc = curveY(x);
    for (let y = 0; y < size; y += 1) {
      const distance = Math.abs(y - yc);
      const value = probability[y * size + x];
      if (distance <= 1) {
        onSum += value;
        onCount += 1;
      } else if (distance > 8) {
        offSum += value;
        offCount += 1;
      }
    }
  }
  const onMean = onSum / onCount;
  const offMean = offSum / offCount;

  assert.ok(onMean > 0.3, `ridge probability is high along the dark curve (${onMean.toFixed(3)})`);
  assert.ok(offMean < 0.05, `and low away from it (${offMean.toFixed(4)})`);
  assert.ok(onMean > 5 * offMean, `on/off separation is strong (${(onMean / offMean).toFixed(1)}x)`);

  /* A flat image produces exactly nothing — no floor noise, no phantom lines. */
  const flatResult = detectRidges(new Float32Array(size * size).fill(background), size);
  let flatMax = 0;
  for (let i = 0; i < flatResult.probability.length; i += 1) {
    if (flatResult.probability[i] > flatMax) flatMax = flatResult.probability[i];
  }
  assert.ok(flatMax < 1e-6, "a flat palm-less image yields zero everywhere");

  /* Deterministic: the same input twice produces bit-identical output. */
  const again = detectRidges(gray, size);
  assert.deepEqual(Array.from(again.probability), Array.from(probability), "detection is deterministic");

  assert.ok(
    timings.claheMs >= 0 && timings.blackhatMs >= 0 && timings.gaborMs >= 0 && timings.totalMs > 0,
    "per-stage timings are reported",
  );
  console.log(
    `ridge timings (256², node): clahe ${timings.claheMs.toFixed(1)} · blackhat ${timings.blackhatMs.toFixed(1)}` +
      ` · gabor ${timings.gaborMs.toFixed(1)} · total ${timings.totalMs.toFixed(1)} ms`,
  );
}

/* ------------------------------- Model fusion ------------------------------- */

{
  const unet = new Float32Array([0.9, 0.0, 0.5]);
  const ridge = new Float32Array([0.1, 1.0, 0.5]);
  const fused = combineProbabilities(unet, ridge);

  /* Pixel 0: the blend wins — the model is confident, ridge is quiet. */
  assert.ok(Math.abs(fused[0] - (0.9 * UNET_WEIGHT + 0.1 * RIDGE_BLEND_WEIGHT)) < 1e-6, "blend term wins");
  /* Pixel 1: the floor wins — the model missed a crease the classical path sees clearly. */
  assert.ok(Math.abs(fused[1] - 1.0 * RIDGE_FLOOR_WEIGHT) < 1e-6, "ridge floor rescues a model miss");
  /* Pixel 2: agreement. max(0.35+0.15, 0.275) = 0.5. */
  assert.ok(Math.abs(fused[2] - 0.5) < 1e-6, "agreement passes through");

  /* No model at all: the zero-ML path is ridge scaled by the floor weight. */
  const ridgeOnly = combineProbabilities(null, ridge);
  for (let i = 0; i < ridge.length; i += 1) {
    assert.ok(Math.abs(ridgeOnly[i] - ridge[i] * RIDGE_FLOOR_WEIGHT) < 1e-6, "ridge-only path scales by the floor");
  }

  assert.throws(() => combineProbabilities(new Float32Array(2), new Float32Array(3)), "size mismatch throws");
}

console.log("RIDGE + FUSION ASSERTIONS PASSED");
