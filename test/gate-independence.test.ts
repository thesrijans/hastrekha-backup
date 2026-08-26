/**
 * Detection must not depend on the rule gate — and the rule gate must not depend on detection.
 *
 * These are two separate promises that keep getting entangled. Evidence accumulates on any frame with
 * a hand in it, because a tilted or drifting palm still shows the same creases; but nothing that makes
 * a *claim* to the user — a latched rule, a captured pose — may advance on a frame that failed the
 * checks. Every time the loop has been refactored, one of the two has quietly broken, so both are
 * asserted here against the real functions rather than trusted to a comment.
 *
 * The last regression is reproduced directly below: a staleness guard that compared the rectifying
 * *matrix* instead of the crop *convention* discarded every mask on any device where inference outran
 * the rectify tick. That is why a tilt pose showed no lines at all.
 */
import assert from "node:assert/strict";
import {
  alignFusion,
  emptyFusion,
  fuse,
  markHandSeen,
  maskApplies,
  shouldReset,
  type FusionState,
} from "../lib/scan/fusion";
import { canonicalQuad, solveHomography, type Matrix3 } from "../lib/scan/rectify";
import {
  CAPTURE_POSES,
  gradeFrame,
  palmSpan,
  segmentationEligible,
  FUSION_MIN_COVERAGE,
  FUSION_MIN_SCORE,
} from "../lib/scan/quality";
import { emptyCapture, readyToCapture, tickCapture, AUTO_CAPTURE_HOLD_MS } from "../lib/scan/capture";
import { emptyLatch, markGateFail, standingOf, updateLatch, DEFAULT_LATCH_OPTIONS } from "../lib/scan/latch";
import { type LineMask, type Point2 } from "../lib/scan/types";
import { syntheticHand } from "./hand-fixture";

const SIZE = 32;
const maskOf = (value: number): LineMask => ({
  width: SIZE,
  height: SIZE,
  all: new Float32Array(SIZE * SIZE).fill(value),
  resolves: [],
  inferenceMs: 0,
});

/* ------------- A gate-failing frame still carries a real palm --------------- */

{
  /*
   * The concrete frame from the bug report: pose 3 of 5 asks for a right tilt, the user has not
   * tilted (or tilted the other way), so the gate fails — but the hand is right there, well detected
   * and fully in frame.
   */
  const { image, world } = syntheticHand();
  const tiltRight = CAPTURE_POSES.find((p) => p.pose === "TILT_RIGHT");
  assert.ok(tiltRight !== undefined, "the guided sequence has a right-tilt pose");

  const span = palmSpan(image);
  const verdict = gradeFrame({
    landmarks: image,
    world,
    handedness: "Right",
    mirrored: false,
    stats: { luma: 0.5, clipped: 0 },
    jitter: 0,
    score: 0.95,
    spanHistory: [span, span, span, span, span],
    pose: tiltRight,
  });

  assert.equal(verdict.ok, false, "an untilted palm fails the tilt pose's gate");
  assert.equal(verdict.checks.tilt_direction, false, "and fails it specifically on tilt direction");
  assert.equal(verdict.hint, "Doosri taraf jhukao", "with the hint the user actually saw");

  /* Yet the very same frame is eligible for segmentation. This is the invariant that broke. */
  assert.ok(
    segmentationEligible(0.95, 0.9),
    "a well-detected hand feeds the detector regardless of the gate verdict",
  );
  assert.equal(verdict.checks.no_hand, true, "there is nothing wrong with the DETECTION, only the pose");
}

/* -------- The frame must advance fusion and must NOT advance claims -------- */

{
  const quad = canonicalQuad(SIZE);
  const h = solveHomography(
    [
      { x: 100, y: 400 },
      { x: 60, y: 300 },
      { x: 120, y: 120 },
      { x: 300, y: 140 },
    ],
    quad,
  ) as Matrix3;

  /* Fusion: a gate-failing frame contributes evidence. */
  let fusion: FusionState = emptyFusion(SIZE);
  fusion = markHandSeen(fusion, 100, "Right");
  fusion = alignFusion(fusion, h, 4).state;
  fusion = fuse(fusion, maskOf(0.85), 100);
  assert.equal(fusion.frames, 1, "a gate-failing frame advances fusion");
  assert.ok(fusion.confidence > 0.5, "and its confidence");

  /* Capture: the same frame contributes no hold time, however long it goes on. */
  let capture = emptyCapture();
  for (let i = 0; i < 60; i += 1) capture = tickCapture(capture, false, 100);
  assert.equal(capture.holdMs, 0, "a gate-failing frame contributes no capture hold");
  assert.equal(capture.index, 0, "and never advances the pose");
  assert.equal(readyToCapture(capture), false, "so it can never trigger a capture");

  /* Latch: the same frame decays rules rather than confirming them. */
  let latch = emptyLatch();
  for (let i = 0; i < 8; i += 1) latch = updateLatch(latch, ["PALM-HEAD-001"]);
  assert.equal(standingOf(latch, "PALM-HEAD-001"), "confirmed", "a good stretch confirms a rule");
  /* One failing frame changes nothing — a momentary wobble must not cost a good scan. */
  latch = markGateFail(latch, 5000);
  assert.equal(standingOf(latch, "PALM-HEAD-001"), "confirmed", "a single gate failure decays nothing");

  /* Sustained failure demotes to "captured": still shown, no longer being re-confirmed. */
  latch = markGateFail(latch, 5000 + DEFAULT_LATCH_OPTIONS.decayAfterMs + 1);
  assert.equal(
    standingOf(latch, "PALM-HEAD-001"),
    "captured",
    "a sustained gate-failing stretch demotes rather than confirming more",
  );

  /* And the control, so none of the above is vacuous: a passing frame does advance capture. */
  let passing = emptyCapture();
  for (let i = 0; i * 100 <= AUTO_CAPTURE_HOLD_MS; i += 1) passing = tickCapture(passing, true, 100);
  assert.ok(readyToCapture(passing), "a gate-passing frame does advance capture");
}

/* --------------- Eligibility floors are about detection only --------------- */

{
  assert.equal(segmentationEligible(FUSION_MIN_SCORE, 0.9), true, "the score floor is inclusive");
  assert.equal(segmentationEligible(FUSION_MIN_SCORE - 0.01, 0.9), false, "a weak detection is skipped");
  assert.equal(segmentationEligible(0.9, FUSION_MIN_COVERAGE - 0.01), false, "a clipped crop is skipped");
  assert.ok(
    FUSION_MIN_SCORE < 0.7,
    "and the detection floor sits BELOW the gate's own confidence floor, so the gate is strictly stricter",
  );
}

/* ------------------ Pose transitions must not reset fusion ----------------- */

{
  let fusion: FusionState = emptyFusion(SIZE);
  fusion = fuse(fusion, maskOf(0.9), 100);
  fusion = markHandSeen(fusion, 100, "Right");
  const before = fusion.frames;

  /*
   * `shouldReset` takes no pose argument at all, and that is the point: there is no way for a pose
   * change to reach it. The guided sequence advances precisely when the user has finally held still
   * long enough to accumulate something worth showing, and resetting there was what blanked the
   * overlay every time the prompt changed.
   */
  for (const pose of CAPTURE_POSES) {
    assert.equal(
      shouldReset(fusion, { handPresent: true, handedness: "Right", nowMs: 5000 }),
      false,
      `advancing to ${pose.pose} does not reset accumulated evidence`,
    );
  }
  assert.equal(fusion.frames, before, "and nothing was cleared along the way");

  /* Only the two honest invalidations still fire. */
  assert.equal(shouldReset(fusion, { handPresent: true, handedness: "Left", nowMs: 200 }), true,
    "the other hand resets — it is a different palm");
  assert.equal(shouldReset(fusion, { handPresent: false, handedness: null, nowMs: 100 + 1600 }), true,
    "and so does a hand gone longer than the grace period");
}

/* ----------- THE REGRESSION: staleness must key on crop SPACE -------------- */

{
  /*
   * Reproduces the shipped bug end to end. `alignFusion` mints a fresh `toCrop` on every rectify
   * tick, so a guard comparing matrix identity rejects any mask whose inference outlasted one tick.
   * Simulated at a 300ms inference against a 200ms tick, that discarded EVERY mask.
   */
  const quad = canonicalQuad(SIZE);
  const anchorsAt = (t: number): Point2[] => [
    { x: 100 + Math.sin(t / 300) * 3, y: 400 },
    { x: 60, y: 300 + Math.cos(t / 250) * 3 },
    { x: 120, y: 120 },
    { x: 300, y: 140 },
  ];

  const run = (inferenceMs: number, guard: "matrix" | "convention") => {
    let state: FusionState = emptyFusion(SIZE);
    let inFlight = false;
    let lastRectifyAt = -1e9;
    let fused = 0;
    let discarded = 0;
    const pending: Array<{ at: number; crop: Matrix3 | null; convention: number }> = [];

    for (let t = 0; t <= 4000; t += 33) {
      for (let i = pending.length - 1; i >= 0; i -= 1) {
        if (t < pending[i].at + inferenceMs) continue;
        const job = pending.splice(i, 1)[0];
        inFlight = false;
        const stale =
          guard === "matrix" ? state.toCrop !== job.crop : !maskApplies(state, job.convention);
        if (stale) {
          discarded += 1;
          continue;
        }
        state = fuse(state, maskOf(0.9), t);
        fused += 1;
      }
      if (t - lastRectifyAt <= 200) continue;
      lastRectifyAt = t;
      const h = solveHomography(anchorsAt(t), quad) as Matrix3;
      state = alignFusion(state, h, 4, null).state;
      if (inFlight) continue; // the segmenter drops rather than queues
      inFlight = true;
      pending.push({ at: t, crop: state.toCrop, convention: 4 });
    }
    return { fused, discarded, confidence: state.confidence };
  };

  /* Fast inference: both guards behave, which is why this shipped looking fine. */
  const fastMatrix = run(120, "matrix");
  assert.ok(fastMatrix.fused > 5, "with fast inference the old guard looked correct");

  /* Slow inference: the old guard is a total blackout, not a degradation. */
  const slowMatrix = run(300, "matrix");
  assert.equal(slowMatrix.fused, 0, "the matrix guard discarded EVERY mask once inference outran a tick");
  assert.ok(slowMatrix.discarded > 5, "and it discarded a lot of them");
  assert.equal(slowMatrix.confidence, 0, "leaving confidence at zero and the overlay blank");

  const slowConvention = run(300, "convention");
  assert.ok(
    slowConvention.fused > 5,
    `the convention guard fuses the same masks (${slowConvention.fused} fused, ${slowConvention.discarded} discarded)`,
  );
  assert.equal(slowConvention.discarded, 0, "and discards none of them — a slow mask is late, not wrong");
  assert.ok(slowConvention.confidence > 0.5, "so evidence accumulates as intended");

  /* Even a very slow device keeps working, just more slowly. */
  const verySlow = run(700, "convention");
  assert.ok(verySlow.fused > 2, `a 700ms inference still accumulates (${verySlow.fused} frames)`);
}

{
  /* And the guard still does its actual job: a mask from a different crop space IS refused. */
  let state: FusionState = emptyFusion(SIZE);
  const h = solveHomography(
    [
      { x: 100, y: 400 },
      { x: 60, y: 300 },
      { x: 120, y: 120 },
      { x: 300, y: 140 },
    ],
    canonicalQuad(SIZE),
  ) as Matrix3;
  state = alignFusion(state, h, 4).state;
  state = fuse(state, maskOf(0.9), 100);

  assert.equal(maskApplies(state, 4), true, "a mask from the same convention applies");
  assert.equal(maskApplies(state, 5), false, "a mask from the other convention does not");
  assert.equal(maskApplies(emptyFusion(SIZE), 5), true, "an empty accumulator accepts anything");
}

/* ------- Latch cadence: confirmation counts FRAMES, not evaluations ---------- */

{
  /*
   * `updateLatch` promotes by counting consecutive calls, so whatever paces those calls sets how
   * long "confirmed" takes. Throttling rule evaluation to the extraction cadence and latching from
   * inside it quietly stretched confirmation from about two thirds of a second to nearly three —
   * invisible in every unit test, obvious to a user waiting for a card to firm up.
   *
   * The contract this pins: latching is driven by gate-passing FRAMES at the frame cadence, using
   * whatever the last evaluation found. Evidence folding and rule evaluation may be paced
   * independently; the latch may not.
   */
  const FRAME_MS = 160;
  const EVAL_MS = 700;

  const framesToConfirm = (latchEveryFrame: boolean): number => {
    let latch = emptyLatch();
    let lastEvaluatedAt = -1e9;
    let lastFired: readonly string[] = [];
    for (let frame = 1; frame <= 200; frame += 1) {
      const t = frame * FRAME_MS;
      if (t - lastEvaluatedAt >= EVAL_MS) {
        lastEvaluatedAt = t;
        lastFired = ["PALM-HEAD-001"];
        if (!latchEveryFrame) latch = updateLatch(latch, lastFired);
      }
      if (latchEveryFrame) latch = updateLatch(latch, lastFired);
      if (standingOf(latch, "PALM-HEAD-001") === "confirmed") return frame;
    }
    return Infinity;
  };

  const perFrame = framesToConfirm(true);
  const perEvaluation = framesToConfirm(false);
  assert.equal(perFrame, DEFAULT_LATCH_OPTIONS.confirmAfter, "latching per frame confirms in confirmAfter frames");
  assert.ok(
    perEvaluation > perFrame * 3,
    `latching per throttled evaluation is far slower (${perEvaluation} frames vs ${perFrame})`,
  );
  assert.ok(perFrame * FRAME_MS < 800, `and the correct cadence confirms under a second (${perFrame * FRAME_MS}ms)`);
}

/* ------- A gate-failing observation feeds evidence but never the latch ------- */

{
  /*
   * The seam the whole design turns on, asserted as a pair. Line evidence is published above the
   * gate on purpose — a tilted palm shows the same creases — so it MUST reach the accumulator. But a
   * frame that failed the gate has not earned the right to advance a rule toward "confirmed", which
   * is a claim made to the user.
   */
  let latch = emptyLatch();
  let fusion: FusionState = emptyFusion(SIZE);

  // Twenty gate-failing observations: evidence accrues, the latch does not move.
  for (let i = 0; i < 20; i += 1) {
    fusion = fuse(fusion, maskOf(0.8), 100 + i);
    latch = markGateFail(latch, 100 + i * 10);
  }
  assert.equal(fusion.frames, 20, "every gate-failing frame contributed evidence");
  assert.ok(fusion.confidence > 0.5, "and the accumulator believes it");
  assert.equal(standingOf(latch, "PALM-HEAD-001"), "absent", "while no rule advanced a single step");

  // One good stretch, and the same rule confirms at the normal rate.
  for (let i = 0; i < DEFAULT_LATCH_OPTIONS.confirmAfter; i += 1) latch = updateLatch(latch, ["PALM-HEAD-001"]);
  assert.equal(standingOf(latch, "PALM-HEAD-001"), "confirmed", "and gate-passing frames still confirm normally");
}

console.log("GATE INDEPENDENCE ASSERTIONS PASSED");
