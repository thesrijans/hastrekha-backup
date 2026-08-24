/**
 * Motion-compensated persistence: evidence must survive a moving hand.
 *
 * The headline assertion is the one that overturned the plan. The brief specified warping the fused
 * mask forward each frame by `H_curr ∘ H_prev⁻¹`. That composition does not compensate for hand
 * motion — it *re-injects* it, because rectified space has already removed it. The first block below
 * measures both claims on a synthetic 3-D palm, and the numbers are why `alignFusion` does nothing on
 * an ordinary moving frame.
 */
import assert from "node:assert/strict";
import {
  alignFusion,
  emptyFusion,
  fuse,
  markHandSeen,
  resetFusion,
  shouldReset,
  warpCounts,
  warpField,
  CONFIDENCE_DECAY,
  HAND_LOSS_RESET_MS,
} from "../lib/scan/fusion";
import {
  applyHomography,
  canonicalAnchors,
  canonicalQuad,
  compose,
  conventionRemap,
  invertHomography,
  solveHomography,
  transformDisplacement,
  type Matrix3,
} from "../lib/scan/rectify";
import { emptyStabiliser, smoothingFactor, stabiliseAnchors, PERCUSSION_HYSTERESIS_FRAMES } from "../lib/scan/stabilise";
import { RECTIFIED_SIZE, type LineMask, type Point2 } from "../lib/scan/types";

const SIZE = 64;
const maskOf = (all: Float32Array, size = SIZE): LineMask => ({
  width: size,
  height: size,
  all,
  resolves: [],
  inferenceMs: 0,
});

/* ----------------- Rectified space is already motion-compensated ----------- */

{
  /* A planar palm in 3-D under a pinhole camera. Anchors and skin move together, as they must. */
  const f = 700;
  const project = (p: { x: number; y: number; z: number }): Point2 => ({ x: (f * p.x) / p.z + 320, y: (f * p.y) / p.z + 240 });
  const local = [
    { x: 0, y: 0 },
    { x: -0.035, y: 0.022 },
    { x: -0.032, y: 0.093 },
    { x: 0.058, y: 0.084 }, // the four anchors
    { x: 0.01, y: 0.05 },
    { x: -0.02, y: 0.07 },
    { x: 0.03, y: 0.03 }, // skin
  ];
  const pose = (tx: number, ty: number, tz: number, yaw: number, pitch: number, roll: number): Point2[] =>
    local.map((q) => {
      let x = q.x;
      let y = q.y;
      let z = 0;
      [x, z] = [x * Math.cos(yaw) + z * Math.sin(yaw), -x * Math.sin(yaw) + z * Math.cos(yaw)];
      [y, z] = [y * Math.cos(pitch) - z * Math.sin(pitch), y * Math.sin(pitch) + z * Math.cos(pitch)];
      [x, y] = [x * Math.cos(roll) - y * Math.sin(roll), x * Math.sin(roll) + y * Math.cos(roll)];
      return project({ x: x + tx, y: y + ty, z: z + tz });
    });

  const quad = canonicalQuad(RECTIFIED_SIZE);
  const before = pose(0, 0, 0.45, 0.1, -0.05, 0.02);
  const after = pose(0.04, -0.03, 0.5, 0.35, 0.18, 0.14); // a large hand movement
  const hBefore = solveHomography(before.slice(0, 4), quad);
  const hAfter = solveHomography(after.slice(0, 4), quad);
  assert.ok(hBefore !== null && hAfter !== null, "both frames rectify");

  let worstSkin = 0;
  for (let i = 4; i < local.length; i += 1) {
    const inBefore = applyHomography(hBefore, before[i]);
    const inAfter = applyHomography(hAfter, after[i]);
    assert.ok(inBefore !== null && inAfter !== null);
    worstSkin = Math.max(worstSkin, Math.hypot(inBefore.x - inAfter.x, inBefore.y - inAfter.y));
  }
  assert.ok(
    worstSkin < 1e-9,
    `the same skin lands on the same crop pixel through a large motion (${worstSkin.toExponential(2)} px)`,
  );

  /* And the transform the brief asked for is the hand motion, not its removal. */
  const briefTransform = compose(hBefore, invertHomography(hAfter) as Matrix3);
  const bogus = transformDisplacement(briefTransform, RECTIFIED_SIZE);
  assert.ok(
    bogus > 50,
    `composing two frames' fits re-injects the motion instead of removing it (${bogus.toFixed(0)} px)`,
  );

  /*
   * The one composition that IS exact: two conventions on ONE frame. This is what a percussion point
   * entering or leaving the frame does to the crop, and the only thing `alignFusion` ever resamples.
   */
  const percussion: Point2 = project({ x: 0.075, y: 0.06, z: 0.45 });
  const h4 = solveHomography(before.slice(0, 4), canonicalAnchors(4, RECTIFIED_SIZE) as Point2[]);
  const fiveAnchors: Point2[] = [...before.slice(0, 4), percussion];
  const h5 = solveHomography(fiveAnchors, canonicalAnchors(5, RECTIFIED_SIZE) as Point2[]);
  assert.ok(h4 !== null && h5 !== null, "both conventions solve on the same frame");
  const remap = conventionRemap(h4, h5);
  assert.ok(remap !== null, "and compose");

  let worstRemap = 0;
  for (let i = 4; i < local.length; i += 1) {
    const in4 = applyHomography(h4, before[i]);
    const in5 = applyHomography(h5, before[i]);
    assert.ok(in5 !== null);
    const via = applyHomography(remap, in5);
    assert.ok(in4 !== null && via !== null);
    worstRemap = Math.max(worstRemap, Math.hypot(via.x - in4.x, via.y - in4.y));
  }
  assert.ok(worstRemap < 1e-6, `the convention remap is exact (${worstRemap.toExponential(2)} px)`);
  assert.ok(
    transformDisplacement(remap, RECTIFIED_SIZE) > 1,
    "and it is a real displacement, so leaving it uncompensated would misregister the mask",
  );
}

/* ------------------------------ Matrix algebra ----------------------------- */

{
  const h = solveHomography(
    [
      { x: 100, y: 400 },
      { x: 60, y: 300 },
      { x: 120, y: 120 },
      { x: 300, y: 140 },
    ],
    canonicalQuad(128),
  );
  assert.ok(h !== null);
  const inverse = invertHomography(h);
  assert.ok(inverse !== null, "a well-conditioned homography inverts");

  const identity = compose(h, inverse);
  for (let i = 0; i < 9; i += 1) {
    const expected = i % 4 === 0 ? 1 : 0;
    assert.ok(Math.abs(identity[i] - expected) < 1e-9, `H·H⁻¹ entry ${i} is ${expected}`);
  }
  assert.equal(identity[8], 1, "and stays normalised on h33");

  assert.equal(invertHomography([1, 2, 3, 2, 4, 6, 3, 6, 9] as Matrix3), null, "a singular matrix returns null");
  assert.equal(transformDisplacement(compose(h, inverse), 128) < 1e-6, true, "the identity displaces nothing");
}

/* -------------------------------- Warping ---------------------------------- */

{
  const identity: Matrix3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];
  const source = new Float32Array(SIZE * SIZE);
  for (let i = 0; i < source.length; i += 1) source[i] = (i % 17) / 17;
  const destination = new Float32Array(SIZE * SIZE);
  warpField(source, destination, SIZE, identity);
  let drift = 0;
  for (let i = 0; i < source.length; i += 1) drift = Math.max(drift, Math.abs(source[i] - destination[i]));
  assert.ok(drift < 1e-6, `an identity warp is a copy — no half-pixel drift (${drift.toExponential(2)})`);

  /* A translation moves content by exactly that much, and writes zero where nothing came from. */
  const shift: Matrix3 = [1, 0, -8, 0, 1, 0, 0, 0, 1];
  const marked = new Float32Array(SIZE * SIZE);
  marked[20 * SIZE + 30] = 1;
  warpField(marked, destination, SIZE, shift);
  assert.ok(destination[20 * SIZE + 38] > 0.9, "the sample moved by the translation");
  assert.equal(destination[20 * SIZE + 2], 0, "and pixels with no source read zero, not a clamped edge");

  /* Counts move too, but never interpolate — a hit count must stay a whole number of frames. */
  const counts = new Uint16Array(SIZE * SIZE);
  counts[20 * SIZE + 30] = 7;
  const movedCounts = new Uint16Array(SIZE * SIZE);
  warpCounts(counts, movedCounts, SIZE, shift);
  assert.equal(movedCounts[20 * SIZE + 38], 7, "the count moved intact");
  const fractional = [...movedCounts].filter((v) => v !== 0 && v !== 7);
  assert.equal(fractional.length, 0, "and nothing fractional was invented along the way");
}

/* --------------------------- alignFusion outcomes -------------------------- */

{
  const line = new Float32Array(SIZE * SIZE);
  for (let x = 8; x < SIZE - 8; x += 1) line[(SIZE / 2) * SIZE + x] = 0.9;

  const quad = canonicalQuad(SIZE);
  const frameAnchors = [
    { x: 100, y: 400 },
    { x: 60, y: 300 },
    { x: 120, y: 120 },
    { x: 300, y: 140 },
  ];
  const h = solveHomography(frameAnchors, quad) as Matrix3;

  let state = emptyFusion(SIZE);
  assert.equal(alignFusion(state, h, 4).outcome, "first", "nothing stored yet");
  state = alignFusion(state, h, 4).state;
  state = fuse(state, maskOf(line), 100);
  assert.equal(state.frames, 1, "the first observation seeds the average");
  assert.equal(state.convention, 4, "and records the convention it was taken under");

  /*
   * A DIFFERENT frame under the SAME convention: nothing is resampled, because rectified space
   * already put the same skin on the same pixel. This is the ordinary case on every moving frame.
   */
  const moved = solveHomography(
    frameAnchors.map((p) => ({ x: p.x + 25, y: p.y - 14 })),
    quad,
  ) as Matrix3;
  const same = alignFusion(state, moved, 4);
  assert.equal(same.outcome, "aligned", "a moving hand needs no warp at all");
  assert.equal(same.displacement, 0, "and reports no displacement to compensate");
  let unchanged = 0;
  for (let i = 0; i < line.length; i += 1) unchanged = Math.max(unchanged, Math.abs(same.state.ema[i] - state.ema[i]));
  assert.equal(unchanged, 0, "the accumulator is untouched — evidence survives motion for free");

  /* A convention change with a real displacement DOES resample. */
  const shifted: Matrix3 = [1, 0, -6, 0, 1, 0, 0, 0, 1];
  const before = Float32Array.from(state.ema);
  const remapped = alignFusion(state, h, 5, compose(shifted, h));
  assert.equal(remapped.outcome, "remapped", "a convention change is remapped");
  assert.equal(remapped.state.convention, 5, "and the new convention is recorded");
  assert.equal(remapped.state.warps, 1, "and counted");
  let changed = 0;
  for (let i = 0; i < before.length; i += 1) changed = Math.max(changed, Math.abs(before[i] - remapped.state.ema[i]));
  assert.ok(changed > 0.1, "the field actually moved");

  /* An absurd jump is dropped rather than dragging a whole palm of evidence onto the wrong skin. */
  const wild: Matrix3 = [1, 0, -400, 0, 1, 0, 0, 0, 1];
  const dropped = alignFusion(remapped.state, h, 4, compose(wild, h));
  assert.equal(dropped.outcome, "dropped", "an implausible remap is refused");
  assert.equal(dropped.state.frames, 0, "and clears rather than corrupts");
}

/* --------------------------- Reset policy ---------------------------------- */

{
  let state = emptyFusion(SIZE);
  state = fuse(state, maskOf(new Float32Array(SIZE * SIZE).fill(0.8)), 100);
  state = markHandSeen(state, 100, "Right");

  assert.equal(shouldReset(state, { handPresent: true, handedness: "Right", nowMs: 99_999 }), false,
    "movement never resets, however long it goes on");
  assert.equal(shouldReset(state, { handPresent: false, handedness: null, nowMs: 100 + HAND_LOSS_RESET_MS - 1 }), false,
    "a brief dropout is tolerated");
  assert.equal(shouldReset(state, { handPresent: false, handedness: null, nowMs: 100 + HAND_LOSS_RESET_MS + 1 }), true,
    "a long dropout resets");
  assert.equal(shouldReset(state, { handPresent: true, handedness: "Left", nowMs: 200 }), true,
    "the other hand resets immediately — it is a different palm, not more of the same one");

  const cleared = resetFusion(state);
  assert.equal(cleared.convention, null, "reset forgets which crop space it was in");
  assert.equal(cleared.warps, 0, "and its remap count");
}

/* -------------------- Fresh pixels and confidence holding ------------------ */

{
  const full = new Float32Array(SIZE * SIZE).fill(0.9);
  let state = emptyFusion(SIZE);
  state = alignFusion(state, canonicalQuad(SIZE) && ([1, 0, 0, 0, 1, 0, 0, 0, 1] as Matrix3), 4).state;
  state = fuse(state, maskOf(full), 100);
  const seeded = state.confidence;
  assert.ok(seeded > 0.8, "a strong first frame is confident");

  /*
   * Confidence sags but never crashes. It gates the overlay's warm-up sweep, so one frame where the
   * detector happened to see less must not pull the whole overlay back to "still warming up".
   */
  state = fuse(state, maskOf(new Float32Array(SIZE * SIZE)), 200);
  assert.ok(
    state.confidence >= seeded * CONFIDENCE_DECAY - 1e-6,
    `one empty frame cannot collapse confidence (${state.confidence.toFixed(3)} from ${seeded.toFixed(3)})`,
  );

  /* But sustained emptiness still gets there, so a stale number cannot persist indefinitely. */
  for (let i = 0; i < 200; i += 1) state = fuse(state, maskOf(new Float32Array(SIZE * SIZE)), 300 + i);
  assert.ok(state.confidence < 0.05, `sustained emptiness does drive it down (${state.confidence.toExponential(2)})`);
}

/* ---------------------------- Anchor stabilisation ------------------------- */

{
  /* The filter's own contract: a higher cutoff or a longer timestep means less smoothing. */
  assert.ok(smoothingFactor(2, 1 / 30) > smoothingFactor(0.5, 1 / 30), "a higher cutoff passes more through");
  assert.ok(smoothingFactor(1, 1 / 15) > smoothingFactor(1, 1 / 60), "a longer step passes more through");

  const truth = [
    { x: 320, y: 400 },
    { x: 250, y: 340 },
    { x: 230, y: 180 },
    { x: 400, y: 190 },
  ];
  /* Deterministic pseudo-noise, so this measurement is a regression test rather than a coin flip. */
  let seed = 12345;
  const noise = (): number => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return (seed / 0x7fffffff - 0.5) * 4;
  };

  const stabiliser = emptyStabiliser();
  let rawSpread = 0;
  let filteredSpread = 0;
  let previousRaw: Point2[] | null = null;
  let previousFiltered: readonly Point2[] | null = null;
  for (let frame = 0; frame < 120; frame += 1) {
    const observed = truth.map((p) => ({ x: p.x + noise(), y: p.y + noise() }));
    const filtered = stabiliseAnchors(stabiliser, observed, frame * (1000 / 30)).points;
    if (previousRaw !== null && previousFiltered !== null) {
      for (let i = 0; i < 4; i += 1) {
        rawSpread += Math.hypot(observed[i].x - previousRaw[i].x, observed[i].y - previousRaw[i].y);
        filteredSpread += Math.hypot(filtered[i].x - previousFiltered[i].x, filtered[i].y - previousFiltered[i].y);
      }
    }
    previousRaw = observed;
    previousFiltered = filtered;
  }
  assert.ok(
    filteredSpread < rawSpread * 0.4,
    `a still hand's anchor jitter is largely removed (${filteredSpread.toFixed(0)} vs ${rawSpread.toFixed(0)})`,
  );

  /* And a genuinely moving hand is followed, not lagged into uselessness. */
  const tracker = emptyStabiliser();
  let last: readonly Point2[] = truth;
  for (let frame = 0; frame < 60; frame += 1) {
    const moving = truth.map((p) => ({ x: p.x + frame * 8, y: p.y }));
    last = stabiliseAnchors(tracker, moving, frame * (1000 / 30)).points;
  }
  const lag = truth[0].x + 59 * 8 - last[0].x;
  assert.ok(lag < 40, `a fast sweep is tracked rather than lagged (${lag.toFixed(1)} px behind)`);
}

{
  /* Convention hysteresis: a percussion point dithering at the frame edge must not flip the crop. */
  const stabiliser = emptyStabiliser();
  const four = [
    { x: 320, y: 400 },
    { x: 250, y: 340 },
    { x: 230, y: 180 },
    { x: 400, y: 190 },
  ];
  const five = [...four, { x: 430, y: 200 }];

  let flips = 0;
  for (let frame = 0; frame < 20; frame += 1) {
    // Alternating opinions — exactly what a point sitting on the margin produces.
    const result = stabiliseAnchors(stabiliser, frame % 2 === 0 ? five : four, frame * 33);
    if (result.conventionChanged) flips += 1;
  }
  assert.equal(flips, 0, "chatter never switches the convention");

  const settled = emptyStabiliser();
  let changed = false;
  for (let frame = 0; frame <= PERCUSSION_HYSTERESIS_FRAMES; frame += 1) {
    if (stabiliseAnchors(settled, five, frame * 33).conventionChanged) changed = true;
  }
  assert.ok(changed, "but a consistent observation does, once it has held long enough");
}

console.log("PERSISTENCE ASSERTIONS PASSED");
