/* ============================================================================
 * FULL-HAND WARP — the UNet's training-framing path (flag unetFullHand)
 *
 * Synthetic-hand construction: CANONICAL_FULLHAND_21 × 256 is taken as truth,
 * a KNOWN homography K maps canonical → source frame, and the "landmarks" are
 * K's outputs divided by the frame size. Every solve is then checked against
 * ground truth that is exact by construction — including a reflection case,
 * because left hands must fold into canonical chirality through the solve.
 * ========================================================================== */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { applyHomography, canonicalAnchors, compose, solveHomography, type Matrix3 } from "../lib/scan/rectify";
import { CANONICAL_FULLHAND_21, FULLHAND_CONTRACT } from "../lib/scan/models/canonical-fullhand-21";
import {
  FULLHAND_FIXED_SUBSET,
  RANSAC_THRESHOLD_FRAC,
  UNET_INPUT_SIZE,
  fullHandToPalmQuad,
  matrixFromBuffer,
  matrixToBuffer,
  palmQuadToFullHand,
  remapProbabilitiesInto,
  solveFullHandHomography,
  warpFullHand,
} from "../lib/scan/fullhand-warp";
import { DEFAULT_SCAN_FLAGS } from "../lib/scan/flags";
import { RECTIFIED_SIZE, type Landmark3 } from "../lib/scan/types";

let assertions = 0;
const ok = (condition: boolean, message: string): void => {
  assert.ok(condition, message);
  assertions += 1;
};

const SIZE = UNET_INPUT_SIZE;
const W = 1280;
const H = 720;

const makeImageData = (w: number, h: number): ImageData =>
  ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4), colorSpace: "srgb" }) as ImageData;

/** 3×3 determinant of a row-major Matrix3. */
function det3(m: Matrix3): number {
  return (
    m[0] * (m[4] * m[8] - m[5] * m[7]) - m[1] * (m[3] * m[8] - m[5] * m[6]) + m[2] * (m[3] * m[7] - m[4] * m[6])
  );
}

/** Synthetic landmarks: canonical truth pushed through K (canonical px → source px). */
function landmarksThrough(k: Matrix3): Landmark3[] {
  return CANONICAL_FULLHAND_21.map(([x, y]) => {
    const p = applyHomography(k, { x: x * SIZE, y: y * SIZE });
    assert.ok(p !== null, "synthetic projection failed");
    return { x: p.x / W, y: p.y / H, z: 0 };
  });
}

/* -------------------- 1. Constants match the docs JSON -------------------- */

{
  const doc = JSON.parse(readFileSync("docs/specs/canonical-fullhand-21.json", "utf8")) as Record<string, unknown>;
  assert.deepEqual(
    CANONICAL_FULLHAND_21.map((p) => [p[0], p[1]]),
    doc.points,
    "TS canonical points deepEqual the docs reference JSON",
  );
  assertions += 1;
  for (const key of ["source", "fitSource", "ransacReprojThresholdPx", "ransacMaxIters", "ransacConfidence", "warpBorderMode", "upstreamFlipUnconditional"] as const) {
    assert.deepEqual(FULLHAND_CONTRACT[key], doc[key], `FULLHAND_CONTRACT.${key} matches the docs JSON`);
    assertions += 1;
  }
  ok(CANONICAL_FULLHAND_21.length === 21, "21 canonical points");
  ok(CANONICAL_FULLHAND_21.every(([x, y]) => x >= 0 && x <= 1 && y >= 0 && y <= 1), "all points in [0,1]");
  ok(FULLHAND_FIXED_SUBSET.length === 7 && FULLHAND_FIXED_SUBSET[0] === 0, "fixed subset is the 7 palmar landmarks");
}

/* --------------- 2. Fixed solve recovers truth, both chiralities --------------- */

/** Case A: rotation + scale + translation + mild projectivity, det > 0. */
const K_A: Matrix3 = [2.1, 0.35, 240, -0.3, 2.4, 90, 0.0002, 0.0001, 1];
/** Case B: the same, mirrored in x — a left hand. det < 0. */
const K_B: Matrix3 = [-2.1, 0.35, 1040, 0.3, 2.4, 60, -0.0002, 0.0001, 1];

for (const [label, k] of [
  ["A (det > 0)", K_A],
  ["B (reflection)", K_B],
] as const) {
  const landmarks = landmarksThrough(k);
  const solved = solveFullHandHomography(landmarks, W, H, "fixed");
  ok(solved !== null, `fixed solve succeeds on case ${label}`);
  if (solved === null) continue;
  let worst = 0;
  for (let i = 0; i < 21; i += 1) {
    const p = applyHomography(solved, { x: landmarks[i].x * W, y: landmarks[i].y * H });
    assert.ok(p !== null);
    worst = Math.max(
      worst,
      Math.hypot(p.x - CANONICAL_FULLHAND_21[i][0] * SIZE, p.y - CANONICAL_FULLHAND_21[i][1] * SIZE),
    );
  }
  ok(worst < 1e-3, `case ${label}: all 21 canonical positions recovered (worst ${worst.toExponential(2)} px)`);
  if (label.startsWith("B")) {
    ok(det3(solved) < 0, "reflection case: det(H) < 0 — the left hand folds into canonical chirality");
  }
}

/* ------------------------------ 3. warpFullHand ------------------------------ */

{
  const landmarks = landmarksThrough(K_A);
  const toCanonical = solveFullHandHomography(landmarks, W, H, "fixed");
  assert.ok(toCanonical !== null);
  assertions += 1;

  const source = makeImageData(W, H);
  // Mid-grey field, distinctive left-edge column, bright 3×3 marker at landmark 9's source px.
  for (let i = 0; i < W * H; i += 1) {
    source.data[i * 4] = 100;
    source.data[i * 4 + 1] = 100;
    source.data[i * 4 + 2] = 100;
    source.data[i * 4 + 3] = 255;
  }
  for (let y = 0; y < H; y += 1) {
    source.data[y * W * 4] = 217; // left edge — what BORDER_REPLICATE must smear outward
  }
  const lm9 = { x: landmarks[9].x * W, y: landmarks[9].y * H };
  for (let dy = -1; dy <= 1; dy += 1) {
    for (let dx = -1; dx <= 1; dx += 1) {
      const at = ((Math.round(lm9.y) + dy) * W + Math.round(lm9.x) + dx) * 4;
      source.data[at] = 255;
      source.data[at + 1] = 255;
      source.data[at + 2] = 255;
    }
  }

  const warpedImage = warpFullHand(source, toCanonical, SIZE, makeImageData);
  ok(warpedImage !== null, "warpFullHand produces an image");
  if (warpedImage !== null) {
    // The marker lands at the canonical position of landmark 9, ±1 px.
    let bestValue = 0;
    let bestX = -1;
    let bestY = -1;
    for (let y = 0; y < SIZE; y += 1) {
      for (let x = 0; x < SIZE; x += 1) {
        const v = warpedImage.data[(y * SIZE + x) * 4];
        if (v > bestValue) {
          bestValue = v;
          bestX = x;
          bestY = y;
        }
      }
    }
    const expectedX = CANONICAL_FULLHAND_21[9][0] * SIZE;
    const expectedY = CANONICAL_FULLHAND_21[9][1] * SIZE;
    ok(
      Math.hypot(bestX + 0.5 - expectedX, bestY + 0.5 - expectedY) <= 1.5,
      `marker at landmark 9 lands at its canonical position (off by ${Math.hypot(bestX + 0.5 - expectedX, bestY + 0.5 - expectedY).toFixed(2)} px)`,
    );

    // Replicated border: K_A keeps the whole canonical square inside the source, so replication
    // needs its own warp — an affine that maps canonical x=0 to source x=−120, forcing the left
    // band of the warp to read off-image. Those pixels must carry the left edge's 217, not black.
    const K_EDGE: Matrix3 = [2.1, 0, -120, 0, 2.4, 90, 0, 0, 1];
    const edgeLandmarks = landmarksThrough(K_EDGE);
    const edgeSolve = solveFullHandHomography(edgeLandmarks, W, H, "fixed");
    assert.ok(edgeSolve !== null);
    assertions += 1;
    const edgeWarp = warpFullHand(source, edgeSolve, SIZE, makeImageData);
    assert.ok(edgeWarp !== null);
    assertions += 1;
    // Destination x=0 maps to source x ≈ −119.5 < 0 → clamped to the edge column.
    ok(edgeWarp.data[(128 * SIZE + 0) * 4] === 217, "out-of-image destinations replicate the edge (217), not black");
    ok(edgeWarp.data[(128 * SIZE + 0) * 4] !== 0, "…and are definitely not black");
  }
}

/* ---------------------- 4. Compose round trip + buffers ---------------------- */

{
  const landmarks = landmarksThrough(K_A);
  const toCropFullHand = solveFullHandHomography(landmarks, W, H, "fixed");
  const quadPx = ([0, 1, 5, 17] as const).map((i) => ({ x: landmarks[i].x * W, y: landmarks[i].y * H }));
  const quadTargets = canonicalAnchors(4, RECTIFIED_SIZE);
  assert.ok(toCropFullHand !== null && quadTargets !== null);
  assertions += 1;
  const toCropQuad = solveHomography(quadPx, quadTargets);
  assert.ok(toCropQuad !== null);
  assertions += 1;

  const forward = palmQuadToFullHand(toCropQuad, toCropFullHand);
  const backward = fullHandToPalmQuad(toCropQuad, toCropFullHand);
  assert.ok(forward !== null && backward !== null);
  assertions += 1;
  const identity = compose(forward, backward);
  const scale = identity[8];
  const worst = Math.max(
    ...[0, 1, 2, 3, 4, 5, 6, 7, 8].map((i) => Math.abs(identity[i] / scale - [1, 0, 0, 0, 1, 0, 0, 0, 1][i])),
  );
  ok(worst < 1e-9, `palmQuadToFullHand ∘ fullHandToPalmQuad ≈ identity (worst ${worst.toExponential(2)})`);

  const roundTrip = matrixFromBuffer(matrixToBuffer(forward));
  assert.deepEqual([...roundTrip], [...forward], "matrixToBuffer/matrixFromBuffer round-trips exactly");
  assertions += 1;

  /* ------------------------- 5. remapProbabilitiesInto ------------------------- */

  // Gaussian blob at canonical landmark 5 in the full-hand plane.
  const full = new Float32Array(SIZE * SIZE);
  const blobX = CANONICAL_FULLHAND_21[5][0] * SIZE;
  const blobY = CANONICAL_FULLHAND_21[5][1] * SIZE;
  for (let y = 0; y < SIZE; y += 1) {
    for (let x = 0; x < SIZE; x += 1) {
      const d2 = (x + 0.5 - blobX) ** 2 + (y + 0.5 - blobY) ** 2;
      full[y * SIZE + x] = Math.exp(-d2 / (2 * 3 * 3));
    }
  }
  const out = new Float32Array(128 * 128);
  remapProbabilitiesInto(full, SIZE, forward, out, 128, RECTIFIED_SIZE);

  // Expected peak: landmark 5's source px through the QUAD solve, ÷2 to 128, centre convention.
  const inCrop = applyHomography(toCropQuad, { x: landmarks[5].x * W, y: landmarks[5].y * H });
  assert.ok(inCrop !== null);
  assertions += 1;
  let peak = 0;
  let peakX = -1;
  let peakY = -1;
  for (let y = 0; y < 128; y += 1) {
    for (let x = 0; x < 128; x += 1) {
      if (out[y * 128 + x] > peak) {
        peak = out[y * 128 + x];
        peakX = x;
        peakY = y;
      }
    }
  }
  const expected = { x: inCrop.x / 2 - 0.5, y: inCrop.y / 2 - 0.5 };
  ok(
    Math.hypot(peakX - expected.x, peakY - expected.y) <= 1,
    `remapped blob peaks at the quad-projected position (off by ${Math.hypot(peakX - expected.x, peakY - expected.y).toFixed(2)} px @128)`,
  );
  // The quad sits INSIDE the hand, so this geometry maps every pixel in-frame; the outside→0
  // branch is exercised with a translation that pushes every sample off the plane.
  const offPlane = new Float32Array(128 * 128).fill(0.5);
  remapProbabilitiesInto(full, SIZE, [1, 0, 10_000, 0, 1, 0, 0, 0, 1], offPlane, 128, RECTIFIED_SIZE);
  ok(offPlane.every((v) => v === 0), "palm-quad pixels that fall outside the full-hand frame read 0");

  const again = new Float32Array(128 * 128);
  remapProbabilitiesInto(full, SIZE, forward, again, 128, RECTIFIED_SIZE);
  assert.deepEqual([...again], [...out], "same inputs, same out buffer contents — remap is pure");
  assertions += 1;
}

/* ------------------------- 6. RANSAC 'all' mode ------------------------- */

{
  const landmarks = landmarksThrough(K_A);
  // Perturb the five fingertips by 25 px — the out-of-plane points RANSAC exists to reject.
  const noisy = landmarks.map((l, i) =>
    [4, 8, 12, 16, 20].includes(i) ? { x: l.x + 25 / W, y: l.y - 25 / H, z: 0 } : l,
  );
  const solved = solveFullHandHomography(noisy, W, H, "all");
  ok(solved !== null, "RANSAC solve succeeds with 5 perturbed fingertips");
  if (solved !== null) {
    const threshold = RANSAC_THRESHOLD_FRAC * SIZE;
    let inliers = 0;
    for (let i = 0; i < 21; i += 1) {
      const p = applyHomography(solved, { x: noisy[i].x * W, y: noisy[i].y * H });
      if (p !== null && Math.hypot(p.x - CANONICAL_FULLHAND_21[i][0] * SIZE, p.y - CANONICAL_FULLHAND_21[i][1] * SIZE) <= threshold) {
        inliers += 1;
      }
    }
    ok(inliers >= 14, `≥14 effective inliers (got ${inliers})`);
    const kInverse = solveFullHandHomography(landmarks, W, H, "fixed");
    assert.ok(kInverse !== null);
    assertions += 1;
    const worst = Math.max(...solved.map((v, i) => Math.abs(v - kInverse[i]) / Math.max(1, Math.abs(kInverse[i]))));
    ok(worst <= 1e-2, `RANSAC H within 1e-2 of the clean solve (worst rel ${worst.toExponential(2)})`);
    const secondRun = solveFullHandHomography(noisy, W, H, "all");
    assert.deepEqual(secondRun, solved, "deterministic: two RANSAC runs are identical");
    assertions += 1;
  }
}

/* ------------------------------- 7. Flag + perf ------------------------------- */

ok(DEFAULT_SCAN_FLAGS.unetFullHand === false, "unetFullHand defaults OFF");

{
  const landmarks = landmarksThrough(K_A);
  const toCanonical = solveFullHandHomography(landmarks, W, H, "fixed");
  assert.ok(toCanonical !== null);
  assertions += 1;
  const source = makeImageData(W, H);
  for (let warm = 0; warm < 5; warm += 1) warpFullHand(source, toCanonical, SIZE, makeImageData);
  const t0 = performance.now();
  const N = 50;
  for (let i = 0; i < N; i += 1) warpFullHand(source, toCanonical, SIZE, makeImageData);
  const perCall = (performance.now() - t0) / N;
  console.log(`  warpFullHand@256 on 1280×720: ${perCall.toFixed(2)} ms/call (${N} warm iterations)`);
  ok(perCall <= 6, `within the 6 ms budget (got ${perCall.toFixed(2)} ms)`);
}

console.log(`FULLHAND WARP ASSERTIONS PASSED (${assertions})`);
