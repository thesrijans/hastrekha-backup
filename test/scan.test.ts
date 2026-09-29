import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { applyHomography, canonicalQuad, palmAnchors, palmQuad, solveHomography } from "../lib/scan/rectify";
import {
  CAPTURE_POSES,
  fingerExtension,
  MIN_FINGER_EXTENSION,
  PALM_FRAME_MARGIN,
  PALM_QUAD_MAX_WIDTH,
  gradeFrame,
  landmarkJitter,
  palmFacing,
  palmFrameMargins,
  palmFramePoints,
  palmJitter,
  palmQuadSpan,
  palmQuadWidth,
  palmSpan,
  spanVariation,
  type QualityInput,
} from "../lib/scan/quality";
import { featuresFromLandmarks, landmarksInFrame, measure } from "../lib/scan/features";
import { LM } from "../lib/scan/landmark-index";
import { derivePalmEdge } from "../lib/scan/landmarks";
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
import { ACTIVE_LINE_IDS, MASK_SIZE, RECTIFIED_SIZE, RESERVED_LINE_IDS, type Landmark3, type LineMask, type Point2 } from "../lib/scan/types";
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
    /* The fixture's palm, carrying the label that pairs with its winding in the gate's convention —
       the same through either camera (lib/scan/quality.ts, PIPELINE_FEEDS_MIRRORED_INPUT). */
    handedness: "Left",
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

  /* Back of hand: the same geometry under the OTHER hand's label is a dorsum, and must be rejected no
     matter how good everything else is — through either camera, since the preview's mirror no longer
     enters the facing test (M1.1). */
  const backOfHand = gradeFrame(baseInput({ handedness: "Right" }));
  assert.ok(!backOfHand.ok && backOfHand.checks.not_palm_up === false, "reversed winding is rejected");
  const backOfHandFront = gradeFrame(baseInput({ handedness: "Right", mirrored: true }));
  assert.ok(!backOfHandFront.ok && backOfHandFront.checks.not_palm_up === false, "and rejected on the front camera's mirrored preview too");
  assert.ok(gradeFrame(baseInput({ mirrored: true })).ok, "while the palm itself passes through the front camera exactly as through the back");

  const dark = gradeFrame(baseInput({ stats: { luma: 0.05, clipped: 0 } }));
  assert.ok(!dark.ok && dark.checks.too_dark === false, "a dark frame is rejected");

  /* A failing frame can never look confident, whatever the individual measurements say. */
  assert.ok(dark.score <= 0.45, "a failing frame's score is capped");

  /* OTHER_HAND wants the opposite hand to the one the session started with. */
  const otherHandPose = CAPTURE_POSES.find((pose) => pose.pose === "OTHER_HAND")!;
  const sameHand = gradeFrame(baseInput({ pose: otherHandPose, baselineHandedness: "Left" }));
  assert.ok(sameHand.checks.wrong_hand === false, "showing the same hand fails the OTHER_HAND step");
  const swapped = gradeFrame(baseInput({ pose: otherHandPose, baselineHandedness: "Right" }));
  assert.ok(swapped.checks.wrong_hand === true, "showing the other hand passes it");
}

/* ----------------- G1 (scan-complete): the frame gate measures the palm ----------------- */

{
  const { image } = syntheticHand();
  const QUAD = [LM.WRIST, LM.THUMB_CMC, LM.INDEX_MCP, LM.PINKY_MCP];
  const centre = {
    x: (Math.min(...QUAD.map((i) => image[i].x)) + Math.max(...QUAD.map((i) => image[i].x))) / 2,
    y: (Math.min(...QUAD.map((i) => image[i].y)) + Math.max(...QUAD.map((i) => image[i].y))) / 2,
  };
  /** The fixture brought closer: scaled about its palm quad's centre (`sx`, `sy`), then shifted. */
  const framed = (sx: number, sy: number, dx = 0, dy = 0): Landmark3[] =>
    image.map((p) => ({ x: centre.x + (p.x - centre.x) * sx + dx, y: centre.y + (p.y - centre.y) * sy + dy, z: p.z }));
  const grade = (landmarks: Landmark3[], extra: Partial<QualityInput> = {}) => gradeFrame(baseInput({ landmarks, ...extra }));

  /* The recordings' framing (docs/specs/phone-scan-2026-09-29-findings.md): the fingertips off the top,
     the thumb tip off the side, the palm itself in plain view. */
  const close = framed(1.6, 1.6, 0, -0.08);
  const outside = close.flatMap((p, i) => (p.x < 0 || p.x > 1 || p.y < 0 || p.y > 1 ? [i] : []));
  assert.ok(outside.includes(LM.MIDDLE_TIP) && outside.includes(LM.THUMB_TIP), `the close palm's fingertips are out of frame (landmarks ${outside.join(",")})`);
  assert.ok(palmSpan(close) > 1, `…its span, fingertips included, is past the whole frame (${palmSpan(close).toFixed(2)})`);
  const closeVerdict = grade(close);
  assert.ok(closeVerdict.checks.out_of_frame, "the close palm passes out_of_frame — every palm anchor is inside");
  assert.ok(closeVerdict.checks.too_close, `…and too_close: its quad is ${palmQuadWidth(palmFramePoints(close)!).toFixed(2)} of the width, under ${PALM_QUAD_MAX_WIDTH}`);
  assert.ok(closeVerdict.ok, `…and the whole gate (issues: ${closeVerdict.issues.join(",") || "none"})`);
  assert.ok(closeVerdict.score >= gradeFrame(baseInput()).score, `…and scores no lower than the whole hand in view (${closeVerdict.score.toFixed(3)})`);

  /* A palm that is NOT in frame is still rejected: the wrist off the bottom, a thumb root in the margin. */
  const wristCut = framed(1, 1, 0, 0.1);
  assert.ok(wristCut[LM.WRIST].y >= 1 && grade(wristCut).issues[0] === "out_of_frame", "a wrist cut off the bottom is rejected, first, as out_of_frame");
  const thumbRoot = framed(1, 1, 0.02 - image[LM.THUMB_CMC].x, 0);
  assert.ok(!grade(thumbRoot).checks.out_of_frame, `a thumb root 2% from the edge is rejected — the margin is ${PALM_FRAME_MARGIN * 100}%`);

  /* The margin is 3% of the SHORT side: the same pixels on every edge of a portrait frame. */
  const portrait = { width: 720, height: 1280 };
  const margins = palmFrameMargins(portrait);
  assert.ok(Math.abs(margins.x - 0.03) < 1e-12 && Math.abs(margins.y - (0.03 * 720) / 1280) < 1e-12, `21.6 px on each edge of 720×1280 (x ${margins.x}, y ${margins.y.toFixed(5)})`);
  const lowWrist = framed(1, 1, 0, 0.975 - image[LM.WRIST].y);
  assert.ok(grade(lowWrist, { frame: portrait }).checks.out_of_frame, "a wrist 32 px above the bottom of a 720×1280 frame is inside its 21.6 px margin");
  assert.ok(!grade(lowWrist).checks.out_of_frame, "…and outside a square frame's 3%");

  /* The percussion point counts exactly when the rectifier uses it. */
  const percussion0 = derivePalmEdge(image)!.percussionTop.x;
  const nearEdge = framed(1, 1, 0.98 - percussion0, 0);
  assert.ok(palmAnchors(nearEdge, 1, 1)!.usedPercussion && palmFramePoints(nearEdge)!.length === 5, "a percussion point 2% from the edge is one the rectifier uses — so it is a palm point");
  assert.ok(!grade(nearEdge).checks.out_of_frame, "…held to the margin, and rejected");
  const pastEdge = framed(1, 1, 0.995 - percussion0, 0);
  assert.ok(!palmAnchors(pastEdge, 1, 1)!.usedPercussion && palmFramePoints(pastEdge)!.length === 4, "past the rectifier's 1% it takes the four-anchor solve, and the gate measures those four");

  /* too_close is the palm quad's width (G1); too_far is still the whole hand's span. */
  const underCeiling = framed(2.1, 1, -0.02, 0);
  const overCeiling = framed(2.2, 1, -0.02, 0);
  const underWidth = palmQuadWidth(palmFramePoints(underCeiling)!);
  const overWidth = palmQuadWidth(palmFramePoints(overCeiling)!);
  assert.ok(underWidth < PALM_QUAD_MAX_WIDTH && grade(underCeiling).checks.too_close, `a quad ${underWidth.toFixed(3)} of the width is not too close`);
  assert.ok(overWidth > PALM_QUAD_MAX_WIDTH && !grade(overCeiling).checks.too_close && grade(overCeiling).checks.out_of_frame, `a quad ${overWidth.toFixed(3)} of the width is too close — while still inside the frame`);
  assert.ok(!grade(framed(0.35, 0.35)).checks.too_far, "a small, far hand is too_far, on the whole hand's span as before");

  /* The standing rule (G1): the palm's motion and size, not the fingertips'. The landmarker's
     extrapolated fingertips wobble on a hand that is perfectly still (tight-02: half the frames over
     the jitter limit on all 21 points, none on the palm quad); a palm that moves still reads as moving. */
  const wobble = close.map((p, i) => (outside.includes(i) ? { ...p, x: p.x + 0.06, y: p.y - 0.04 } : p));
  assert.ok(landmarkJitter(close, wobble) > 0.012, `the fingertips' wobble alone is past the jitter limit on all 21 points (${landmarkJitter(close, wobble).toFixed(4)})`);
  assert.equal(palmJitter(close, wobble), 0, "…and nothing on the palm quad");
  assert.ok(grade(wobble, { jitter: palmJitter(close, wobble) }).checks.unsteady, "a still palm with wobbling fingertips is steady");
  const moved = close.map((p) => ({ ...p, x: p.x + 0.02 }));
  assert.ok(palmJitter(close, moved) > 0.012 && !grade(moved, { jitter: palmJitter(close, moved) }).checks.unsteady, "a palm that moves 2% of the frame is unsteady, threshold unchanged");
  assert.ok(Math.abs(palmQuadSpan(wobble) - palmQuadSpan(close)) < 1e-12 && palmSpan(wobble) !== palmSpan(close), "the palm quad's span ignores the fingertips; the whole hand's does not");
  assert.ok(Math.abs(palmQuadSpan(image) - 0.45) < 1e-9, `the fixture's palm quad spans 0.45 of the frame (${palmQuadSpan(image)})`);
  const quadHistory = [close, wobble, close, wobble, close].map(palmQuadSpan);
  assert.ok(grade(wobble, { spanHistory: quadHistory }).checks.inconsistent, "a palm-quad span history is not thrown by the fingertips — inconsistent passes");
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

/* ------------- G1.2 (scan-complete): no feature from a fingertip the camera did not see ------------- */

{
  const { image, world } = syntheticHand();
  const whole = featuresFromLandmarks(world, { quality: 0.8 })!;
  const wholeSeen = featuresFromLandmarks(world, { quality: 0.8, inFrame: landmarksInFrame(image) })!;
  assert.ok(landmarksInFrame(image).every(Boolean), "the fixture's whole hand is in frame");
  assert.equal(JSON.stringify(wholeSeen.features), JSON.stringify(whole.features), "whole hand in view: the feature bag is byte-identical, keys and order");

  /* The close palm's frame: every fingertip and the thumb tip out, extrapolated by the landmarker. */
  const cut = new Set<number>([LM.THUMB_TIP, LM.INDEX_TIP, LM.MIDDLE_TIP, LM.RING_TIP, LM.PINKY_TIP]);
  const close = featuresFromLandmarks(world, { quality: 0.8, inFrame: image.map((_, i) => !cut.has(i)) })!;
  const fingers = close.features.fingers as Record<string, unknown>;
  const thumb = close.features.thumb as Record<string, unknown>;
  for (const key of ["length_vs_palm", "jupiter", "saturn", "sun", "jupiter_vs_apollo", "spacing"]) {
    assert.ok(!(key in fingers), `fingers.${key} is not emitted with the fingertips out of frame`);
  }
  assert.ok(!("mercury" in fingers) || !("length" in (fingers.mercury as Record<string, unknown>)), "nor the little finger's length");
  assert.ok(!("straight_full" in thumb) && !("nail_phalange_long" in thumb), "nor the thumb's tip features");
  assert.equal(thumb.present, true, "the thumb is still reported present");
  assert.ok(close.shapeSuggestion === null && !("shape" in ((close.features.hand ?? {}) as Record<string, unknown>)), "no hand shape: it reads the middle finger and the tips");
  assert.equal((close.features.hand as Record<string, unknown> | undefined)?.overall_quality, 0.8, "the frame's quality still is");
  assert.ok(Number.isFinite(close.metrics.middleOverPalm), "the raw metrics are still measured for the HUD — never thrown on");

  /* One finger out is one finger's features: the index gone takes jupiter and jupiter_vs_apollo, not saturn. */
  const indexOut = featuresFromLandmarks(world, { quality: 0.8, inFrame: image.map((_, i) => i !== LM.INDEX_TIP) })!;
  const indexFingers = indexOut.features.fingers as Record<string, unknown>;
  assert.ok(!("jupiter" in indexFingers) && !("jupiter_vs_apollo" in indexFingers) && !("spacing" in indexFingers), "the index tip out drops what the index is measured in");
  assert.deepEqual(indexFingers.saturn, (whole.features.fingers as Record<string, unknown>).saturn, "…and keeps what it is not");
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

/* ------------------- projectLines: the source size is not optional ------------------- */

/*
 * REGRESSION. `extractLines(field, size)` writes its polylines in `size` space unscaled, so a scan
 * that extracts at MASK_SIZE hands projectLines 128-space points. projectLines solves its
 * homography from `canonicalQuad(size)` and DEFAULTS that size to RECTIFIED_SIZE (256) — so
 * omitting the argument reads 128-space points against a 256-space quad and collapses every line
 * into the quarter of the target nearest the origin corner.
 *
 * app/scan/scan-client.tsx shipped that omission: the user's own traced lines were drawn on the
 * replica palm at roughly a quarter of their true span. Both spans are pinned here, so a
 * reintroduction fails on the number rather than on somebody noticing the picture looks wrong.
 */
{
  const HOLO_ANCHORS = [
    { x: 150, y: 350 },
    { x: 86, y: 250 },
    { x: 104, y: 180 },
    { x: 232, y: 196 },
  ] as const;

  /** A heart line as extractLines emits one at MASK_SIZE: percussion edge to the Jupiter mount. */
  const heartAt128 = [
    [0.9 * MASK_SIZE, 0.3 * MASK_SIZE],
    [0.55 * MASK_SIZE, 0.24 * MASK_SIZE],
    [0.22 * MASK_SIZE, 0.22 * MASK_SIZE],
  ] as const;
  const lines = { heart: { id: "heart" as const, points: heartAt128, confidence: 0.8 } };

  const spanOf = (points: ReadonlyArray<readonly [number, number]>): number =>
    Math.max(...points.map((p) => p[0])) - Math.min(...points.map((p) => p[0]));

  const correct = projectLines(lines, HOLO_ANCHORS, MASK_SIZE).heart;
  const defaulted = projectLines(lines, HOLO_ANCHORS).heart;
  assert.ok(correct !== undefined && defaulted !== undefined, "both projections produce the line");

  /*
   * The replica hand's own anchors span 86 (thumb CMC) to 232 (little MCP) = 146px. A heart line
   * running most of the palm's width must cover a comparable distance; anything far below that is
   * the collapsed projection.
   */
  const correctSpan = spanOf(correct);
  assert.ok(
    correctSpan > 120,
    `size-matched projection spans the palm (${correctSpan.toFixed(1)}px across a 146px anchor width)`,
  );
  const defaultedSpan = spanOf(defaulted);
  assert.ok(
    defaultedSpan < 60,
    `and the 256-space default collapses it (${defaultedSpan.toFixed(1)}px) — this is the bug being pinned`,
  );
  assert.ok(
    correctSpan > defaultedSpan * 3,
    `the defect shrinks the line more than threefold (${(correctSpan / defaultedSpan).toFixed(1)}x)`,
  );

  /*
   * And the call site itself: a maths test cannot see an omitted argument, so the one place that
   * projects a scan onto the replica palm is read and pinned directly.
   */
  const scanClient = readFileSync("app/scan/scan-client.tsx", "utf8");
  const call = /projectLines\(\s*found\.lines\s*,\s*HOLO_PALM_ANCHORS\s*,\s*MASK_SIZE\s*\)/.test(scanClient);
  assert.ok(call, "scan-client projects with MASK_SIZE, the space its extraction produced");
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
