/* ============================================================================
 * scan-complete G2 — THE DISTANCE, TOLD VISIBLY, AND THE ONE SPECIFIC REASON
 *
 * What is asserted:
 *  1. The meter's three states carry the spec's words exactly, over a named band
 *     (0.45–0.85 of the frame's short side), with hysteresis only on the far edge.
 *  2. The meter and the gate never disagree about "too close": swept across the
 *     ceiling on a portrait AND a landscape frame, "बहुत पास" appears exactly when
 *     too_close fails.
 *  3. The litany's reason is the gate's first failing check, made specific:
 *     too_close before out_of_frame, the edge the palm leaves by (in the reader's
 *     own left and right, mirrored preview or not), the tilt the pose wants.
 *  4. The reason shown is the top of the last second, with a noise floor, and it
 *     never says "poora haath".
 *  5. All of it is cheap enough to run on every frame, always.
 * ========================================================================== */
import assert from "node:assert/strict";
import {
  BAND_TICK_MIN_INTERVAL_MS,
  DISTANCE_FAR_HYSTERESIS,
  DISTANCE_WORDS,
  GAUGE_MAX_FILL,
  GAUGE_MIN_FILL,
  PALM_QUAD_MIN_FILL,
  PALM_QUAD_TARGET_FILL,
  LOST_NEAR_FILL,
  bandTickDue,
  gaugePosition,
  nextDistanceState,
  type DistanceState,
} from "../lib/scan/distance";
import {
  LOST_REASON_MS,
  palmNearEdge,
  REASON_MIN_SHARE,
  REASON_WINDOW_MS,
  REASON_WORDS,
  ReasonWindow,
  frameReason,
  palmExitEdge,
  type ReasonKey,
} from "../lib/scan/scan-reason";
import { ALL_CHECKS, CAPTURE_POSES, PALM_QUAD_MAX_FILL, gradeFrame, palmFramePoints, palmQuadFill, type QualityInput } from "../lib/scan/quality";
import { LM } from "../lib/scan/landmark-index";
import type { Landmark3 } from "../lib/scan/types";
import { syntheticHand } from "./hand-fixture";

let assertions = 0;
const ok = (condition: boolean, message: string): void => {
  assert.ok(condition, message);
  assertions += 1;
};

const { image, world } = syntheticHand();
const QUAD = [LM.WRIST, LM.THUMB_CMC, LM.INDEX_MCP, LM.PINKY_MCP];
const centre = {
  x: (Math.min(...QUAD.map((i) => image[i]!.x)) + Math.max(...QUAD.map((i) => image[i]!.x))) / 2,
  y: (Math.min(...QUAD.map((i) => image[i]!.y)) + Math.max(...QUAD.map((i) => image[i]!.y))) / 2,
};
const framed = (sx: number, sy: number, dx = 0, dy = 0): Landmark3[] =>
  image.map((p) => ({ x: centre.x + (p.x - centre.x) * sx + dx, y: centre.y + (p.y - centre.y) * sy + dy, z: p.z }));
const input = (landmarks: Landmark3[], over: Partial<QualityInput> = {}): QualityInput => ({
  landmarks,
  world,
  handedness: "Left",
  mirrored: false,
  stats: { luma: 0.5, clipped: 0 },
  jitter: 0,
  score: 0.95,
  spanHistory: [0.45, 0.45, 0.45, 0.45, 0.45],
  ...over,
});

/* ------------------------------ 1. the meter ------------------------------ */

{
  ok(PALM_QUAD_MIN_FILL === 0.45 && PALM_QUAD_MAX_FILL === 0.85, "the band is a named constant, 0.45–0.85 of the short side");
  ok(
    PALM_QUAD_TARGET_FILL === 0.5 && PALM_QUAD_TARGET_FILL >= PALM_QUAD_MIN_FILL && PALM_QUAD_TARGET_FILL < PALM_QUAD_MAX_FILL,
    "the guide's target is 0.5 — MEASURED (the reader's own tracked framing, under the landmarker's emulation ceiling), inside the band",
  );
  ok(LOST_NEAR_FILL > PALM_QUAD_TARGET_FILL && LOST_NEAR_FILL < PALM_QUAD_MAX_FILL, "a palm lost past the target reads as too close");
  ok(DISTANCE_WORDS.near.hi === "बहुत पास · फोन थोड़ा पीछे करें", "the near words are the spec's, exactly");
  ok(DISTANCE_WORDS.ok.hi === "सही दूरी ✓", "the right-distance words are the spec's, exactly");
  ok(DISTANCE_WORDS.far.hi === "बहुत दूर · पास लाएँ", "the far words are the spec's, exactly");

  ok(nextDistanceState(0.3, null) === "far" && nextDistanceState(0.5, null) === "ok" && nextDistanceState(0.9, null) === "near", "far / ok / near across the band");
  ok(nextDistanceState(0.85, "ok") === "ok" && nextDistanceState(0.8501, "ok") === "near", "the near edge is the gate's own threshold, with no hysteresis");
  ok(nextDistanceState(0.44, "ok") === "ok" && nextDistanceState(PALM_QUAD_MIN_FILL - DISTANCE_FAR_HYSTERESIS - 0.001, "ok") === "far", "the far edge holds an in-band palm until it drops past the hysteresis");
  ok(nextDistanceState(0.44, "far") === "far" && nextDistanceState(0.45, "far") === "ok", "…and a far palm enters the band at the edge itself");
  ok(nextDistanceState(Number.NaN, "ok") === "ok", "a reading that is not a number leaves the state as it was");

  ok(gaugePosition(GAUGE_MIN_FILL) === 0 && gaugePosition(GAUGE_MAX_FILL) === 1 && gaugePosition(0) === 0 && gaugePosition(2) === 1, "the gauge maps its scale to 0–1 and clamps");

  const t0 = 10_000;
  ok(bandTickDue("far", "ok", null, t0) && bandTickDue("near", "ok", null, t0) && bandTickDue(null, "ok", null, t0), "entering the band from anywhere earns the tick");
  ok(!bandTickDue("ok", "ok", null, t0) && !bandTickDue("ok", "far", null, t0), "staying in it, or leaving it, does not");
  ok(!bandTickDue("far", "ok", t0, t0 + BAND_TICK_MIN_INTERVAL_MS - 1) && bandTickDue("far", "ok", t0, t0 + BAND_TICK_MIN_INTERVAL_MS), "and a palm hovering at the edge gets one tick per interval, not one per crossing");
}

/* ------------------- 2. the meter and the gate never disagree ------------------- */

{
  let checked = 0;
  let near = 0;
  for (const frame of [{ width: 720, height: 1280 }, { width: 1280, height: 720 }]) {
    const landscape = frame.width > frame.height;
    for (let s = 1.6; s <= 2.6; s += 0.01) {
      const landmarks = landscape ? framed(1, s * 0.82, 0, 0) : framed(s, 1, -0.02, 0);
      const fill = palmQuadFill(palmFramePoints(landmarks) ?? [], frame);
      const state: DistanceState = nextDistanceState(fill, null);
      const verdict = gradeFrame(input(landmarks, { frame }));
      assert.equal(state === "near", !verdict.checks.too_close, `${frame.width}×${frame.height} fill ${fill.toFixed(4)}: meter ${state}, too_close ${verdict.checks.too_close}`);
      checked += 1;
      if (state === "near") near += 1;
    }
  }
  ok(near > 0 && near < checked, `swept ${checked} frames across the ceiling on both orientations (${near} too close): the meter says "near" exactly when the gate says too_close`);

  /* The short side: on a landscape frame the palm quad's HEIGHT is the fill; on a portrait one its width. */
  const tall = framed(1, 2.2);
  ok(palmQuadFill(palmFramePoints(tall)!, { width: 1280, height: 720 }) > palmQuadFill(palmFramePoints(tall)!, { width: 720, height: 1280 }), "a palm stretched tall fills a landscape frame's short side more than a portrait one's");
}

/* ---------------------------- 3. the specific reason ---------------------------- */

{
  const grade = (landmarks: Landmark3[], over: Partial<QualityInput> = {}) => gradeFrame(input(landmarks, over));
  const reason = (landmarks: Landmark3[] | null, over: Partial<QualityInput> = {}, pose = CAPTURE_POSES[0]!): ReasonKey | null =>
    frameReason({ verdict: landmarks === null ? gradeFrame(null) : grade(landmarks, over), landmarks, mirrored: over.mirrored ?? false, pose, frame: over.frame });

  ok(reason(null) === "no_hand", "no hand: bring the palm in front of the camera");
  ok(reason(image) === null, "every gate passing: no reason — the leaf then carries the meter's words");

  const iTooClose = ALL_CHECKS.indexOf("too_close");
  const iOut = ALL_CHECKS.indexOf("out_of_frame");
  ok(iTooClose >= 0 && iTooClose < iOut, "too_close is reported before out_of_frame: moving back fixes both");
  const huge = framed(2.5, 1, 0, 0);
  const hugeVerdict = grade(huge);
  ok(!hugeVerdict.checks.too_close && !hugeVerdict.checks.out_of_frame && reason(huge) === "too_close", "a palm too big for the frame (and in its margin) is told it is too close, not to fit itself in");

  const wristCut = framed(1, 1, 0, 0.1);
  ok(reason(wristCut) === "out_of_frame_bottom", "a wrist off the bottom: the palm leaves by the bottom — bring it up");
  const offLeft = framed(1, 1, 0.02 - image[LM.THUMB_CMC]!.x, 0);
  ok(palmExitEdge(offLeft, undefined, false) === "left" && reason(offLeft) === "out_of_frame_left", "a thumb root in the left margin, on the back camera: out by the left");
  ok(palmExitEdge(offLeft, undefined, true) === "right" && reason(offLeft, { mirrored: true }) === "out_of_frame_right", "the same frame under a mirrored preview is the reader's right");

  const tiltLeft = CAPTURE_POSES.find((p) => p.pose === "TILT_LEFT")!;
  const tiltRight = CAPTURE_POSES.find((p) => p.pose === "TILT_RIGHT")!;
  const flat = image;
  ok(reason(flat, { pose: tiltLeft }, tiltLeft) === "tilt_left", "the TILT_LEFT pose, untilted: tilt it left");
  ok(reason(flat, { pose: tiltRight }, tiltRight) === "tilt_right", "the TILT_RIGHT pose, untilted: tilt it right");
  ok(reason(flat, { stats: { luma: 0.05, clipped: 0 } }) === "too_dark", "every other gate reads as itself");

  /* A palm that has just gone (G2): its last whereabouts name the reason, for LOST_REASON_MS, then plainly no hand. */
  const lost = (seen: { fill: number; edge: "top" | "bottom" | "left" | "right" | null }, ago: number): ReasonKey | null =>
    frameReason({ verdict: gradeFrame(null), landmarks: null, mirrored: false, pose: CAPTURE_POSES[0]!, lastSeen: { atMs: 10_000, ...seen }, nowMs: 10_000 + ago });
  ok(lost({ fill: 0.6, edge: null }, 300) === "too_close", "lost centred and close: too close — move back, not 'bring your palm'");
  ok(lost({ fill: 0.6, edge: "bottom" }, 300) === "out_of_frame_bottom", "lost at an edge: it left by that edge");
  ok(lost({ fill: 0.4, edge: null }, 300) === "no_hand", "lost centred and far: no hand");
  ok(lost({ fill: 0.6, edge: null }, LOST_REASON_MS + 1) === "no_hand", `after ${LOST_REASON_MS} ms the last whereabouts no longer speak`);
  ok(palmNearEdge(framed(1, 1, 0, 0.05), false) === "bottom" && palmNearEdge(image, false) === null, "a palm within 8% of the bottom is 'at' it; the fixture's centred palm is at none");
}

/* ------------------- 4. the top of the last second, in plain words ------------------- */

{
  const w = new ReasonWindow();
  for (let t = 0; t < 1000; t += 50) w.record(t, t % 200 === 0 ? "unsteady" : null);
  ok(w.top(1000) === "unsteady", `a quarter of the frames failing one gate is worth naming (floor ${REASON_MIN_SHARE})`);

  const quiet = new ReasonWindow();
  for (let t = 0; t < 1000; t += 50) quiet.record(t, t === 500 ? "unsteady" : null);
  ok(quiet.top(1000) === null, "one frame in twenty is below the floor: the leaf shows the meter, not a flicker");

  const mixed = new ReasonWindow();
  for (let t = 0; t < 1000; t += 50) mixed.record(t, t < 600 ? "too_close" : "fingers_curled");
  ok(mixed.top(1000) === "too_close", "the most frequent reason wins");
  const tie = new ReasonWindow();
  for (let t = 0; t < 400; t += 50) tie.record(t, t < 200 ? "too_close" : "unsteady");
  ok(tie.top(400) === "unsteady", "…ties go to the more recent");

  const stale = new ReasonWindow();
  stale.record(0, "too_dark");
  ok(stale.top(REASON_WINDOW_MS + 1) === null, `a reason older than ${REASON_WINDOW_MS} ms no longer counts`);
  stale.record(2000, "too_dark");
  stale.reset();
  ok(stale.top(2000) === null, "and a reset empties the window");

  for (const [key, words] of Object.entries(REASON_WORDS)) {
    ok(!/poora|haath|hatheli/i.test(words.hi) && /[ऀ-ॿ]/.test(words.hi), `${key}: plain Devanagari, never "poora haath" (${words.hi})`);
    ok([...words.hi].length <= 38 && words.en.length > 0, `${key}: short enough for the leaf's two lines, and named in English (${[...words.hi].length} chars)`);
  }
  ok(REASON_WORDS.too_close === DISTANCE_WORDS.near && REASON_WORDS.too_far === DISTANCE_WORDS.far, "the distance reasons ARE the meter's words — one voice");
}

/* ------------------------- 5. cheap enough for every frame ------------------------- */

{
  const w = new ReasonWindow();
  const landmarks = framed(1.3, 1.3);
  const verdict = gradeFrame(input(landmarks, { frame: { width: 720, height: 1280 } }));
  let state: DistanceState | null = null;
  const started = performance.now();
  for (let i = 0; i < 10_000; i += 1) {
    const fill = palmQuadFill(palmFramePoints(landmarks) ?? [], { width: 720, height: 1280 });
    state = nextDistanceState(fill, state);
    w.record(i * 16.7, frameReason({ verdict, landmarks, mirrored: false, pose: CAPTURE_POSES[0]!, frame: { width: 720, height: 1280 } }));
    w.top(i * 16.7);
  }
  const perFrameUs = ((performance.now() - started) / 10_000) * 1000;
  ok(perFrameUs < 60, `the meter and the reason cost ${perFrameUs.toFixed(1)} µs a frame — under 60 µs, a fiftieth of the chamber's 3 ms`);
}

console.log(`SCAN DISTANCE ASSERTIONS PASSED (${assertions})`);
