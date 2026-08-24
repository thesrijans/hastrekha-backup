import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { applyHomography, canonicalQuad, palmQuad, solveHomography } from "../lib/scan/rectify";
import {
  CAPTURE_POSES,
  fingerExtension,
  MIN_FINGER_EXTENSION,
  gradeFrame,
  landmarkJitter,
  palmFacing,
  palmSpan,
  spanVariation,
  type QualityInput,
} from "../lib/scan/quality";
import { featuresFromLandmarks, measure } from "../lib/scan/features";
import { emptyLatch, markGateFail, standingOf, updateLatch, type LatchOptions } from "../lib/scan/latch";
import { createNoopSegmenter, imageDataToNchw, sigmoidInPlace } from "../lib/scan/segmenter";
import { confidenceOf, emptyFusion, fuse, markHandSeen, mergeMax, resetFusion, shouldReset } from "../lib/scan/fusion";
import { binarize, extractLines, FEATURE_MAPPING, projectLines, simplify, thin, tracePolylines } from "../lib/scan/lines";
import {
  commitCapture,
  currentPose,
  emptyCapture,
  poseProgressOf,
  readyToCapture,
  tickCapture,
  AUTO_CAPTURE_HOLD_MS,
} from "../lib/scan/capture";
import { ACTIVE_LINE_IDS, RECTIFIED_SIZE, RESERVED_LINE_IDS, type LineMask, type Point2 } from "../lib/scan/types";
import { curledHand, syntheticHand } from "./hand-fixture";

const LATCH: LatchOptions = { confirmAfter: 3, decayAfterMs: 2000 };

/* ------------------------------- Homography ------------------------------- */

const unitSquare: Point2[] = [
  { x: 0, y: 0 },
  { x: 1, y: 0 },
  { x: 1, y: 1 },
  { x: 0, y: 1 },
];

{
  const h = solveHomography(unitSquare, unitSquare);
  assert.ok(h !== null, "identity homography solvable");
  for (const p of unitSquare) {
    const out = applyHomography(h, p);
    assert.ok(out !== null && Math.abs(out.x - p.x) < 1e-9 && Math.abs(out.y - p.y) < 1e-9);
  }
}

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
    assert.ok(out !== null && Math.abs(out.x - target[i].x) < 1e-6 && Math.abs(out.y - target[i].y) < 1e-6);
  }
  const back = solveHomography(target, skewed);
  assert.ok(back !== null);
  const roundTrip = applyHomography(back, applyHomography(h, { x: 100, y: 100 })!);
  assert.ok(roundTrip !== null && Math.abs(roundTrip.x - 100) < 1e-6 && Math.abs(roundTrip.y - 100) < 1e-6);
}

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

function baseInput(overrides: Partial<QualityInput> = {}): QualityInput {
  const { image, world } = syntheticHand();
  return {
    landmarks: image,
    world,
    handedness: "Right",
    mirrored: false,
    stats: { luma: 0.5, clipped: 0 },
    jitter: 0,
    score: 0.95,
    spanHistory: [0.6, 0.6, 0.6, 0.6, 0.6],
    ...overrides,
  };
}

/* --------------------------------- Quality -------------------------------- */

{
  const { image, world } = syntheticHand();

  assert.ok(palmFacing(world) > 0.9, "a flat palm in the z=0 plane reads as square-on");
  assert.ok(palmSpan(image) > 0.3 && palmSpan(image) < 0.86, "synthetic hand sits inside the distance band");
  assert.equal(landmarkJitter(null, image), 0, "no previous frame means no jitter");
  assert.ok(landmarkJitter(image, image.map((p) => ({ ...p, x: p.x + 0.05 }))) > 0.04, "a shifted hand registers jitter");

  const good = gradeFrame(baseInput());
  assert.ok(good.ok, `clean frame passes the gate (issues: ${good.issues.join(",")})`);
  assert.ok(good.score > 0.6, "clean frame scores well");
  assert.ok(Object.values(good.checks).every(Boolean), "every check passes on a clean frame");

  assert.deepEqual(gradeFrame(null).issues, ["no_hand"], "no hand is reported as no_hand");

  /* A2 — detector confidence floor. */
  const unsure = gradeFrame(baseInput({ score: 0.4 }));
  assert.ok(!unsure.ok && unsure.checks.low_confidence === false, "a low-confidence detection is rejected");

  /* A2 — open-palm pose. A curled hand must not pass, however well lit and framed. */
  assert.ok(fingerExtension(world) > MIN_FINGER_EXTENSION, "the open synthetic hand reads as extended");
  const curled = curledHand();
  assert.ok(fingerExtension(curled.world) < MIN_FINGER_EXTENSION, "the curled hand reads as not extended");
  const curledVerdict = gradeFrame(baseInput({ world: curled.world, landmarks: curled.image }));
  assert.ok(!curledVerdict.ok && curledVerdict.checks.fingers_curled === false, "a curled hand is rejected");

  /* A2 — cross-frame self-consistency. */
  assert.equal(spanVariation([0.5, 0.5]), 0, "an unfilled window does not block the gate");
  assert.ok(spanVariation([0.5, 0.5, 0.5, 0.5, 0.5]) < 1e-9, "a held pose has no variation");
  assert.ok(spanVariation([0.4, 0.5, 0.6, 0.7, 0.8]) > 0.06, "a drifting hand registers variation");
  const drifting = gradeFrame(baseInput({ spanHistory: [0.4, 0.5, 0.6, 0.7, 0.8] }));
  assert.ok(!drifting.ok && drifting.checks.inconsistent === false, "a drifting hand is rejected");

  /* Back of hand: winding flips sign and must be rejected no matter how good everything else is. */
  const backOfHand = gradeFrame(baseInput({ mirrored: true }));
  assert.ok(!backOfHand.ok && backOfHand.checks.not_palm_up === false, "reversed winding is rejected");

  const dark = gradeFrame(baseInput({ stats: { luma: 0.05, clipped: 0 } }));
  assert.ok(!dark.ok && dark.checks.too_dark === false, "a dark frame is rejected");

  /* A failing frame can never look confident, whatever the individual measurements say. */
  assert.ok(dark.score <= 0.45, "a failing frame's score is capped");

  /* OTHER_HAND wants the opposite hand to the one the session started with. */
  const otherHandPose = CAPTURE_POSES.find((pose) => pose.pose === "OTHER_HAND")!;
  const sameHand = gradeFrame(baseInput({ pose: otherHandPose, baselineHandedness: "Right" }));
  assert.ok(sameHand.checks.wrong_hand === false, "showing the same hand fails the OTHER_HAND step");
  const swapped = gradeFrame(baseInput({ pose: otherHandPose, baselineHandedness: "Left" }));
  assert.ok(swapped.checks.wrong_hand === true, "showing the other hand passes it");
}

/* -------------------------------- Rectify --------------------------------- */

{
  const { image } = syntheticHand();
  const quad = palmQuad(image, 1280, 720);
  assert.ok(quad !== null && quad.length === 4, "palm quad extracts four anchors");
  assert.ok(solveHomography(quad, canonicalQuad(256)) !== null, "a real palm quad is solvable");
  assert.equal(palmQuad([], 1280, 720), null, "too few landmarks yields no quad");
}

/* -------------------------------- Features -------------------------------- */

{
  const { world } = syntheticHand();
  const metrics = measure(world);
  assert.ok(metrics.palmLength > 0 && metrics.palmWidth > 0, "palm dimensions are positive");

  const result = featuresFromLandmarks(world, { quality: 0.8 });
  assert.ok(result !== null, "features derive from a full landmark set");
  const bag = result.features as Record<string, Record<string, unknown>>;
  assert.equal(bag.thumb.present, true, "thumb presence is reported");
  assert.equal(bag.hand?.overall_quality, 0.8, "gate score becomes hand.overall_quality");

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

  state = updateLatch(state, [rule], LATCH);
  assert.equal(standingOf(state, rule), "provisional", "one hit is provisional");
  state = updateLatch(state, [rule], LATCH);
  state = updateLatch(state, [rule], LATCH);
  assert.equal(standingOf(state, rule), "confirmed", "three consecutive hits confirm");

  state = updateLatch(state, [], LATCH);
  assert.equal(standingOf(state, rule), "confirmed", "a confirmed rule is never withdrawn mid-stretch");

  /* A1 — a brief gate failure must NOT throw away a good scan. */
  state = markGateFail(state, 1000, LATCH);
  assert.equal(standingOf(state, rule), "confirmed", "a momentary gate failure changes nothing");

  /* A1 — but 2s of continuous failure decays streaks and demotes confirmations to captured. */
  state = markGateFail(state, 1000 + LATCH.decayAfterMs + 1, LATCH);
  assert.equal(standingOf(state, rule), "captured", "sustained gate failure demotes to captured");
  assert.equal(state.confirmed.size, 0, "nothing remains confirmed after decay");
  assert.equal(state.streaks.size, 0, "streaks are wiped after decay");

  /* A3 — captured rules stay visible and can be re-confirmed only by passing frames. */
  state = updateLatch(state, [rule], LATCH);
  assert.equal(standingOf(state, rule), "captured", "one good frame does not instantly re-confirm");
  state = updateLatch(state, [rule], LATCH);
  state = updateLatch(state, [rule], LATCH);
  assert.equal(standingOf(state, rule), "confirmed", "three good frames re-confirm it");

  let flaky = emptyLatch();
  flaky = updateLatch(flaky, ["X"], LATCH);
  flaky = updateLatch(flaky, [], LATCH);
  assert.equal(standingOf(flaky, "X"), "absent", "an interrupted streak resets");
  assert.equal(standingOf(emptyLatch(), "nope"), "absent", "unknown rules are absent");
}

/* ------------------------------- Segmenter -------------------------------- */

{
  const image = { width: 2, height: 1, data: new Uint8ClampedArray([255, 0, 0, 255, 0, 128, 255, 255]) } as ImageData;
  const tensor = imageDataToNchw(image);
  assert.equal(tensor.length, 3 * 2 * 1, "tensor is 3 planes of width×height");
  assert.equal(tensor[0], 1, "R plane, pixel 0");
  assert.equal(tensor[2], 0, "G plane, pixel 0");
  assert.equal(tensor[5], 1, "B plane, pixel 1");

  const probs = sigmoidInPlace(new Float32Array([0, 100, -100]));
  assert.ok(Math.abs(probs[0] - 0.5) < 1e-9 && probs[1] > 0.999 && probs[2] < 0.001, "sigmoid behaves");

  const noop = createNoopSegmenter();
  assert.equal(noop.ready, false, "the no-op segmenter reports itself unready");
  assert.equal(noop.backend, "none");
  noop.dispose();
}

{
  assert.deepEqual([...ACTIVE_LINE_IDS], ["heart", "head", "life", "fate"], "four active lines");
  assert.equal(RESERVED_LINE_IDS.length, 6, "six reserved lines");
  const overlap = ACTIVE_LINE_IDS.filter((id) => (RESERVED_LINE_IDS as readonly string[]).includes(id));
  assert.equal(overlap.length, 0, "active and reserved never overlap");
}

/* --------------------------------- Fusion --------------------------------- */

function maskOf(field: Float32Array): LineMask {
  return { width: RECTIFIED_SIZE, height: RECTIFIED_SIZE, all: field, resolves: [], inferenceMs: 12 };
}

{
  const plane = RECTIFIED_SIZE * RECTIFIED_SIZE;
  let state = emptyFusion();

  const bright = new Float32Array(plane).fill(0.8);
  state = fuse(state, maskOf(bright), 100);
  assert.equal(state.frames, 1, "first fuse counts a frame");
  assert.ok(Math.abs(state.ema[0] - 0.8) < 1e-6, "the first frame seeds the average outright");
  assert.ok(state.hits[0] === 1, "pixels above threshold count a hit");
  assert.equal(state.lastInferenceMs, 12, "inference timing carries through");

  /* Alpha 0.3: one dark frame moves 0.8 toward 0 by 30%. */
  state = fuse(state, maskOf(new Float32Array(plane)), 200);
  assert.ok(Math.abs(state.ema[0] - 0.56) < 1e-5, "EMA blends at alpha 0.3");
  assert.equal(state.hits[0], 1, "a below-threshold frame adds no hit");

  /* Confidence is the top 20%, so a sparse line is not drowned by background. */
  const sparse = new Float32Array(plane);
  for (let i = 0; i < plane * 0.05; i += 1) sparse[i] = 0.9;
  assert.ok(confidenceOf(sparse) > 0.5, "a sparse bright line still reads as confident");
  assert.ok(confidenceOf(new Float32Array(plane)) < 1e-6, "an empty field has no confidence");

  /*
   * Reset rules. Movement is deliberately NOT one of them any more — see `alignFusion`, which maps
   * accumulated evidence onto the moving palm instead of discarding it.
   */
  const seen = markHandSeen(state, 200, "Right");
  assert.equal(shouldReset(emptyFusion(), { handPresent: false, handedness: null, nowMs: 9999 }), false, "nothing to reset");
  assert.equal(shouldReset(seen, { handPresent: true, handedness: "Right", nowMs: 5000 }), false, "movement never resets");
  assert.equal(shouldReset(seen, { handPresent: true, handedness: "Left", nowMs: 300 }), true, "the other hand resets immediately");
  assert.equal(shouldReset(seen, { handPresent: false, handedness: null, nowMs: 500 }), false, "a brief dropout is tolerated");
  assert.equal(shouldReset(seen, { handPresent: false, handedness: null, nowMs: 2500 }), true, "a long dropout resets");

  const cleared = resetFusion(state);
  assert.equal(cleared.frames, 0, "reset clears the frame count");
  assert.equal(cleared.ema[0], 0, "reset clears the accumulator");

  /* Merge takes the maximum, so a line seen in one pose survives four that missed it. */
  const a = new Float32Array([0.9, 0.1, 0.4]);
  const b = new Float32Array([0.2, 0.8, 0.4]);
  assert.deepEqual([...mergeMax(a, b)], [0.9, 0.8, 0.4].map((v) => Math.fround(v)), "mergeMax keeps the stronger evidence");
}

/* --------------------------------- Lines ---------------------------------- */

/** Draws a thick straight segment into a probability field, in 0–1 crop coordinates. */
function drawLine(field: Float32Array, size: number, from: Point2, to: Point2, width = 2): void {
  const steps = Math.ceil(Math.hypot((to.x - from.x) * size, (to.y - from.y) * size)) * 2;
  for (let step = 0; step <= steps; step += 1) {
    const t = step / steps;
    const cx = (from.x + (to.x - from.x) * t) * size;
    const cy = (from.y + (to.y - from.y) * t) * size;
    for (let dy = -width; dy <= width; dy += 1) {
      for (let dx = -width; dx <= width; dx += 1) {
        const x = Math.round(cx + dx);
        const y = Math.round(cy + dy);
        if (x < 0 || y < 0 || x >= size || y >= size) continue;
        field[y * size + x] = 0.95;
      }
    }
  }
}

{
  /* Thinning: a solid 5px-wide bar must reduce to a single-pixel spine. */
  const size = 40;
  const bar = new Uint8Array(size * size);
  for (let y = 18; y <= 22; y += 1) for (let x = 5; x < 35; x += 1) bar[y * size + x] = 1;
  const skeleton = thin(bar, size);
  const before = bar.reduce((sum, v) => sum + v, 0);
  const after = skeleton.reduce((sum: number, v: number) => sum + v, 0);
  assert.ok(after < before / 3, `thinning removes bulk (${before} → ${after})`);
  assert.ok(after > 20, "but keeps the spine intact end to end");

  const { polys } = tracePolylines(skeleton, size);
  assert.ok(polys.length >= 1, "the spine traces to at least one polyline");

  assert.equal(binarize(new Float32Array([0.9, 0.1]), 0.5).join(","), "1,0", "binarize thresholds");
  assert.equal(simplify([{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 10, y: 0 }]).length, 2, "collinear points collapse");
}

{
  /* A synthetic palm with all four lines where the classifier expects them. */
  const size = RECTIFIED_SIZE;
  const field = new Float32Array(size * size);
  drawLine(field, size, { x: 0.9, y: 0.3 }, { x: 0.22, y: 0.22 }); // heart
  drawLine(field, size, { x: 0.2, y: 0.32 }, { x: 0.78, y: 0.5 }); // head
  drawLine(field, size, { x: 0.22, y: 0.26 }, { x: 0.44, y: 0.92 }); // life
  drawLine(field, size, { x: 0.5, y: 0.93 }, { x: 0.47, y: 0.3 }); // fate

  const found = extractLines(field, size);
  const named = Object.keys(found.lines).sort();
  assert.ok(named.length >= 3, `at least three of four lines identified (got ${named.join(",") || "none"})`);
  assert.ok(named.includes("heart") || named.includes("head"), "a horizontal line is identified");
  assert.ok(named.includes("life") || named.includes("fate"), "a vertical line is identified");

  for (const line of Object.values(found.lines)) {
    assert.ok(line !== undefined && line.points.length >= 2, "every named line carries a polyline");
    assert.ok(line.confidence > 0, "and a confidence from the mask beneath it");
  }

  /* An empty field must produce nothing at all rather than defaults. */
  const empty = extractLines(new Float32Array(size * size), size);
  assert.equal(Object.keys(empty.lines).length, 0, "no mask means no lines");
  const emptyBag = empty.features as Record<string, unknown>;
  assert.ok(!("reading" in emptyBag), "and reading.lines_available is not claimed");

  /* Projection onto the replica hand keeps the traces and moves them into the target space. */
  const projected = projectLines(found.lines, [
    { x: 150, y: 350 },
    { x: 86, y: 250 },
    { x: 104, y: 180 },
    { x: 232, y: 196 },
  ]);
  assert.equal(Object.keys(projected).length, named.length, "every named line projects");
  for (const points of Object.values(projected)) {
    assert.ok(points.length > 1, "projected lines keep their points");
    for (const [x, y] of points) assert.ok(Number.isFinite(x) && Number.isFinite(y), "and stay finite");
  }
}

/* Every emitted key must exist in the KB's feature index — the contract this module promises. */
{
  const index = JSON.parse(readFileSync("data/kb/hastrekha_kb.features.json", "utf8")) as {
    features: Record<string, unknown>;
  };

  for (const key of Object.keys(FEATURE_MAPPING)) {
    assert.ok(key in index.features, `FEATURE_MAPPING key ${key} exists in hastrekha_kb.features.json`);
  }

  const size = RECTIFIED_SIZE;
  const field = new Float32Array(size * size);
  drawLine(field, size, { x: 0.9, y: 0.3 }, { x: 0.22, y: 0.22 });
  drawLine(field, size, { x: 0.2, y: 0.32 }, { x: 0.78, y: 0.5 });
  drawLine(field, size, { x: 0.22, y: 0.26 }, { x: 0.44, y: 0.92 });
  drawLine(field, size, { x: 0.5, y: 0.93 }, { x: 0.47, y: 0.3 });

  const emitted: string[] = [];
  const walk = (value: unknown, path: string): void => {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      emitted.push(path);
      return;
    }
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      walk(child, path === "" ? key : `${path}.${key}`);
    }
  };
  walk(extractLines(field, size).features, "");

  assert.ok(emitted.length > 0, "the synthetic palm emits features");
  for (const key of emitted) {
    assert.ok(key in index.features, `emitted feature ${key} exists in hastrekha_kb.features.json`);
  }
}

/* --------------------------------- Capture -------------------------------- */

{
  let state = emptyCapture();
  assert.equal(currentPose(state)?.pose, "FLAT", "the sequence starts flat");
  assert.equal(poseProgressOf(state), 0, "and with no progress");

  /* The ring only fills on gate-passing frames. */
  state = tickCapture(state, true, 500);
  assert.ok(poseProgressOf(state) > 0.3 && poseProgressOf(state) < 0.4, "good frames advance the hold");

  /* A1 — a single failing frame empties it. */
  state = tickCapture(state, false, 33);
  assert.equal(poseProgressOf(state), 0, "one failing frame resets the hold to zero");

  state = tickCapture(state, true, AUTO_CAPTURE_HOLD_MS);
  assert.ok(readyToCapture(state), "a full continuous hold arms the capture");

  const mask = new Float32Array(RECTIFIED_SIZE * RECTIFIED_SIZE).fill(0.7);
  state = commitCapture(state, mask, 0.7, 1000);
  assert.equal(state.records.length, 1, "the pose is recorded");
  assert.equal(state.holdMs, 0, "and the hold resets for the next pose");
  assert.equal(currentPose(state)?.pose, "TILT_LEFT", "the sequence advances");

  /* The record must be a copy — the caller keeps reusing their buffer. */
  mask.fill(0);
  assert.ok(state.records[0].mask[0] > 0.6, "the captured mask is a snapshot, not a reference");

  for (let i = state.records.length; i < CAPTURE_POSES.length; i += 1) {
    state = tickCapture(state, true, AUTO_CAPTURE_HOLD_MS);
    state = commitCapture(state, new Float32Array(RECTIFIED_SIZE * RECTIFIED_SIZE).fill(0.5), 0.5, 2000 + i);
  }
  assert.ok(state.done, "the sequence completes after every pose");
  assert.equal(currentPose(state), null, "and offers no further pose");
  assert.equal(tickCapture(state, true, 999), state, "a completed sequence ignores further ticks");
}

console.log("SCAN PIPELINE ASSERTIONS PASSED");
