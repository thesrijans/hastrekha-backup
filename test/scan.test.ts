import assert from "node:assert/strict";
import { LM } from "../lib/scan/landmark-index";
import { applyHomography, canonicalQuad, palmQuad, solveHomography } from "../lib/scan/rectify";
import { gradeFrame, landmarkJitter, palmFacing, palmSpan } from "../lib/scan/quality";
import { featuresFromLandmarks, measure } from "../lib/scan/features";
import { emptyLatch, standingOf, updateLatch } from "../lib/scan/latch";
import { createNoopSegmenter, imageDataToNchw, sigmoidInPlace } from "../lib/scan/segmenter";
import { ACTIVE_LINE_IDS, RESERVED_LINE_IDS, type Landmark3, type Point2 } from "../lib/scan/types";

/* ------------------------------- Homography ------------------------------- */

const unitSquare: Point2[] = [
  { x: 0, y: 0 },
  { x: 1, y: 0 },
  { x: 1, y: 1 },
  { x: 0, y: 1 },
];

/* Identity: a square onto itself must round-trip every corner. */
{
  const h = solveHomography(unitSquare, unitSquare);
  assert.ok(h !== null, "identity homography solvable");
  for (const p of unitSquare) {
    const out = applyHomography(h, p);
    assert.ok(out !== null);
    assert.ok(Math.abs(out.x - p.x) < 1e-9 && Math.abs(out.y - p.y) < 1e-9, "identity maps corners to themselves");
  }
}

/* A genuine perspective warp: every source corner must land on its target. */
{
  const skewed: Point2[] = [
    { x: 12, y: 30 },
    { x: 190, y: 8 },
    { x: 240, y: 210 },
    { x: 40, y: 250 },
  ];
  const target = canonicalQuad(256);
  const h = solveHomography(skewed, target);
  assert.ok(h !== null, "perspective homography solvable");
  for (let i = 0; i < 4; i += 1) {
    const out = applyHomography(h, skewed[i]);
    assert.ok(out !== null);
    assert.ok(
      Math.abs(out.x - target[i].x) < 1e-6 && Math.abs(out.y - target[i].y) < 1e-6,
      `anchor ${i} maps onto its canonical target`,
    );
  }

  /* Solving in reverse must undo it — this is exactly how rectifyPalm builds its inverse warp. */
  const back = solveHomography(target, skewed);
  assert.ok(back !== null);
  const roundTrip = applyHomography(back, applyHomography(h, { x: 100, y: 100 })!);
  assert.ok(roundTrip !== null);
  assert.ok(
    Math.abs(roundTrip.x - 100) < 1e-6 && Math.abs(roundTrip.y - 100) < 1e-6,
    "forward then reverse returns the original point",
  );
}

/* Degenerate input must return null rather than NaN — the hand turning edge-on hits this for real. */
{
  const collinear: Point2[] = [
    { x: 0, y: 0 },
    { x: 1, y: 1 },
    { x: 2, y: 2 },
    { x: 3, y: 3 },
  ];
  assert.equal(solveHomography(collinear, canonicalQuad(256)), null, "collinear quad is rejected");
  assert.equal(solveHomography(unitSquare.slice(0, 3), unitSquare), null, "wrong point count is rejected");
}

/* -------------------------------- Fixtures -------------------------------- */

/**
 * A synthetic open right hand, palm toward the camera. Image coords are normalised 0–1; world coords
 * are metres with the wrist at the origin and +z toward the viewer, so the palm normal points at it.
 */
function syntheticHand(): { image: Landmark3[]; world: Landmark3[] } {
  const image: Landmark3[] = new Array(21).fill(null).map(() => ({ x: 0.5, y: 0.5, z: 0 }));
  const world: Landmark3[] = new Array(21).fill(null).map(() => ({ x: 0, y: 0, z: 0 }));

  const put = (index: number, ix: number, iy: number, wx: number, wy: number) => {
    image[index] = { x: ix, y: iy, z: 0 };
    world[index] = { x: wx, y: wy, z: 0 };
  };

  put(LM.WRIST, 0.5, 0.9, 0, 0);
  put(LM.THUMB_CMC, 0.34, 0.78, -0.035, 0.022);
  put(LM.THUMB_MCP, 0.27, 0.68, -0.055, 0.042);
  put(LM.THUMB_IP, 0.22, 0.6, -0.07, 0.058);
  put(LM.THUMB_TIP, 0.18, 0.54, -0.082, 0.07);

  put(LM.INDEX_MCP, 0.38, 0.45, -0.032, 0.093);
  put(LM.INDEX_PIP, 0.36, 0.33, -0.034, 0.126);
  put(LM.INDEX_DIP, 0.35, 0.26, -0.036, 0.146);
  put(LM.INDEX_TIP, 0.345, 0.2, -0.037, 0.163);

  put(LM.MIDDLE_MCP, 0.5, 0.44, 0, 0.096);
  put(LM.MIDDLE_PIP, 0.5, 0.31, 0, 0.133);
  put(LM.MIDDLE_DIP, 0.5, 0.23, 0, 0.156);
  put(LM.MIDDLE_TIP, 0.5, 0.16, 0, 0.176);

  put(LM.RING_MCP, 0.61, 0.45, 0.03, 0.093);
  put(LM.RING_PIP, 0.62, 0.33, 0.032, 0.128);
  put(LM.RING_DIP, 0.625, 0.26, 0.033, 0.148);
  put(LM.RING_TIP, 0.63, 0.2, 0.034, 0.166);

  put(LM.PINKY_MCP, 0.71, 0.49, 0.058, 0.084);
  put(LM.PINKY_PIP, 0.73, 0.39, 0.062, 0.112);
  put(LM.PINKY_DIP, 0.74, 0.33, 0.064, 0.128);
  put(LM.PINKY_TIP, 0.75, 0.28, 0.066, 0.142);

  return { image, world };
}

/* --------------------------------- Quality -------------------------------- */

{
  const { image, world } = syntheticHand();

  assert.ok(palmFacing(world) > 0.9, "a flat palm in the z=0 plane reads as square-on");
  assert.ok(palmSpan(image) > 0.3 && palmSpan(image) < 0.86, "synthetic hand sits inside the distance band");
  assert.equal(landmarkJitter(null, image), 0, "no previous frame means no jitter");
  assert.equal(landmarkJitter(image, image), 0, "an unchanged hand has zero jitter");

  const moved = image.map((p) => ({ ...p, x: p.x + 0.05 }));
  assert.ok(landmarkJitter(image, moved) > 0.04, "a shifted hand registers jitter");

  const good = gradeFrame({
    landmarks: image,
    world,
    handedness: "Right",
    mirrored: false,
    stats: { luma: 0.5, clipped: 0 },
    jitter: 0,
  });
  assert.ok(good.ok, `clean frame passes the gate (issues: ${good.issues.join(",")})`);
  assert.ok(good.score > 0.6, "clean frame scores well");

  assert.deepEqual(gradeFrame(null).issues, ["no_hand"], "no hand is reported as no_hand");

  const dark = gradeFrame({
    landmarks: image,
    world,
    handedness: "Right",
    mirrored: false,
    stats: { luma: 0.05, clipped: 0 },
    jitter: 0,
  });
  assert.ok(dark.issues.includes("too_dark") && !dark.ok, "a dark frame is rejected");
  assert.ok(dark.hint.length > 0, "a rejected frame always carries a hint");

  const far = image.map((p) => ({ ...p, x: 0.5 + (p.x - 0.5) * 0.2, y: 0.5 + (p.y - 0.5) * 0.2 }));
  const tooFar = gradeFrame({
    landmarks: far,
    world,
    handedness: "Right",
    mirrored: false,
    stats: { luma: 0.5, clipped: 0 },
    jitter: 0,
  });
  assert.ok(tooFar.issues.includes("too_far"), "a small hand reads as too far");

  /* Only one instruction is surfaced even when several things are wrong. */
  const messy = gradeFrame({
    landmarks: far,
    world,
    handedness: "Right",
    mirrored: false,
    stats: { luma: 0.02, clipped: 0 },
    jitter: 0.5,
  });
  assert.ok(messy.issues.length >= 3, "multiple issues are all collected");
  assert.equal(typeof messy.hint, "string", "but exactly one hint is produced");
}

/* -------------------------------- Rectify --------------------------------- */

{
  const { image } = syntheticHand();
  const quad = palmQuad(image, 1280, 720);
  assert.ok(quad !== null && quad.length === 4, "palm quad extracts four anchors");
  const h = solveHomography(quad, canonicalQuad(256));
  assert.ok(h !== null, "a real palm quad yields a solvable homography");
  assert.equal(palmQuad([], 1280, 720), null, "too few landmarks yields no quad");
}

/* -------------------------------- Features -------------------------------- */

{
  const { world } = syntheticHand();
  const metrics = measure(world);

  assert.ok(metrics.palmLength > 0 && metrics.palmWidth > 0, "palm dimensions are positive");
  assert.ok(metrics.middleOverPalm > 0.5 && metrics.middleOverPalm < 3, "middle/palm ratio is sane");
  assert.ok(metrics.thumbAbductionDeg > 0 && metrics.thumbAbductionDeg < 180, "thumb abduction is an angle");

  const result = featuresFromLandmarks(world, { quality: 0.8 });
  assert.ok(result !== null, "features derive from a full landmark set");

  const bag = result.features as Record<string, Record<string, unknown>>;
  assert.equal(bag.thumb.present, true, "thumb presence is reported");
  assert.equal(typeof bag.fingers.spacing, "number", "finger spacing is numeric");
  assert.equal(bag.hand?.overall_quality, 0.8, "gate score becomes hand.overall_quality");

  /* Nothing the KB lists as un-derivable may ever appear in the bag. */
  const flat = JSON.stringify(result.features);
  for (const forbidden of ["joint_top", "clubbed", "waist_like", "will_phalange", "base_phalange_long", "conic_firmness"]) {
    assert.ok(!flat.includes(forbidden), `${forbidden} is never emitted from landmarks`);
  }
  assert.ok(!("mounts" in bag), "mounts are never derived from landmarks");

  assert.equal(featuresFromLandmarks([], {}), null, "too few landmarks yields nothing");
}

/* ---------------------------------- Latch --------------------------------- */

{
  let state = emptyLatch();
  const rule = "PALM-MJUP-001";
  const options = { confirmAfter: 3 };

  state = updateLatch(state, [rule], options);
  assert.equal(standingOf(state, rule), "provisional", "one hit is provisional");
  state = updateLatch(state, [rule], options);
  assert.equal(standingOf(state, rule), "provisional", "two hits are still provisional");
  state = updateLatch(state, [rule], options);
  assert.equal(standingOf(state, rule), "confirmed", "three consecutive hits confirm");

  /* The ratchet: once confirmed, dropping out must never retract it. */
  state = updateLatch(state, [], options);
  assert.equal(standingOf(state, rule), "confirmed", "a confirmed rule is never withdrawn");

  /* A rule that flickers before confirming resets its streak. */
  let flaky = emptyLatch();
  flaky = updateLatch(flaky, ["X"], options);
  flaky = updateLatch(flaky, ["X"], options);
  flaky = updateLatch(flaky, [], options);
  assert.equal(standingOf(flaky, "X"), "absent", "an interrupted streak resets");
  flaky = updateLatch(flaky, ["X"], options);
  assert.equal(standingOf(flaky, "X"), "provisional", "and starts again from one");

  assert.equal(standingOf(emptyLatch(), "nope"), "absent", "unknown rules are absent");
}

/* ------------------------------- Segmenter -------------------------------- */

{
  /* Tensor packing: planar RGB in [0,1], alpha dropped. Getting this transposed is a silent failure. */
  const image = { width: 2, height: 1, data: new Uint8ClampedArray([255, 0, 0, 255, 0, 128, 255, 255]) } as ImageData;
  const tensor = imageDataToNchw(image);
  assert.equal(tensor.length, 3 * 2 * 1, "tensor is 3 planes of width×height");
  assert.equal(tensor[0], 1, "R plane, pixel 0");
  assert.equal(tensor[1], 0, "R plane, pixel 1");
  assert.equal(tensor[2], 0, "G plane, pixel 0");
  assert.ok(Math.abs(tensor[3] - 128 / 255) < 1e-6, "G plane, pixel 1");
  assert.equal(tensor[4], 0, "B plane, pixel 0");
  assert.equal(tensor[5], 1, "B plane, pixel 1");

  const probs = sigmoidInPlace(new Float32Array([0, 100, -100]));
  assert.ok(Math.abs(probs[0] - 0.5) < 1e-9, "sigmoid(0) = 0.5");
  assert.ok(probs[1] > 0.999 && probs[2] < 0.001, "sigmoid saturates both ways");

  const noop = createNoopSegmenter();
  assert.equal(noop.ready, false, "the stage-1 segmenter reports itself unready");
  assert.deepEqual(noop.resolves, [], "and resolves no lines");
  noop.dispose();
}

/* Vocabulary is fixed now so adding a class later never changes the feature contract. */
{
  assert.deepEqual([...ACTIVE_LINE_IDS], ["heart", "head", "life", "fate"], "four active lines");
  assert.equal(RESERVED_LINE_IDS.length, 6, "six reserved lines");
  const overlap = ACTIVE_LINE_IDS.filter((id) => (RESERVED_LINE_IDS as readonly string[]).includes(id));
  assert.equal(overlap.length, 0, "active and reserved never overlap");
}

console.log("SCAN PIPELINE ASSERTIONS PASSED");
