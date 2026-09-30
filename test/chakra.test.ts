/* ============================================================================
 * G4b — THE CHAKRA (docs/specs/chakra-scan-g4.txt), the pure model
 *
 *  1. the arcs: four majors of ~84° in the ledger's order, five minors that say
 *     "अभी नहीं"; each arc's fill is its line's own progress, monotone;
 *  2. completion on ANY of (a) detection, (b) the shutter at ≥ 2 held,
 *     (c) the palm gone > 5 s with ≥ 3 held — and never on the pose;
 *  3. the best frame: sharpness × in-band × lines held, replaced only by better;
 *  4. the hold: a hand gone up to 5 s, or a label flickering for a frame or
 *     two, resets nothing; /scan's rule (the frozen core's shouldReset) is
 *     untouched;
 *  5. the seal's timing; and the hook and the chamber wired to all of it.
 * ========================================================================== */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  BEST_FRAME_NO_LINES,
  BEST_FRAME_OUT_OF_BAND,
  CHAKRA_ARC_DEG,
  CHAKRA_GAP_DEG,
  CHAKRA_MAJOR_ARCS,
  CHAKRA_MAJOR_NAMES,
  CHAKRA_MINOR_ARCS,
  CHAKRA_MINOR_GAP_DEG,
  CHAKRA_MINOR_OPENING_DEG,
  CHAKRA_MINORS,
  CHAKRA_PULSE_MS,
  CHAKRA_RESULT_AT_MS,
  CHAKRA_SEAL_MS,
  CHAKRA_WORDS,
  CHAMBER_HAND_HOLD_MS,
  CHAMBER_HAND_SWITCH_FRAMES,
  CHAMBER_REANCHOR_GAP_MS,
  PALM_LEFT_COMPLETE_MS,
  PALM_LEFT_MIN_HELD,
  SHUTTER_MIN_HELD,
  bestFrameReplaces,
  bestFrameScore,
  chakraPercent,
  chakraState,
  chamberHoldResets,
  completionReason,
  heldMajors,
  sealPulse,
  sealSweep,
  shutterReady,
} from "../lib/scan/chakra";
import { DETECTION_IDLE, nextDetection, type DetectionState, type LineDetection } from "../lib/scan/detection-progress";
import { HAND_LOSS_RESET_MS, emptyFusion, markHandSeen, shouldReset } from "../lib/scan/fusion";
import type { RekhaLine, RekhaSnapshot } from "../lib/scan/rekha-persist";
import type { ActiveLineId } from "../lib/scan/types";

let assertions = 0;
const ok = (condition: boolean, message: string): void => {
  assert.ok(condition, message);
  assertions += 1;
};

/** A detection state with the given lines (the rest gathering at 0). */
function detection(lines: Partial<Record<ActiveLineId, LineDetection>>, complete = false): DetectionState {
  const all = { ...DETECTION_IDLE.lines, ...lines };
  const overall = (Object.values(all) as LineDetection[]).reduce((sum, line) => sum + (line.status === "gathering" ? line.progress : 1), 0) / 4;
  return { ...DETECTION_IDLE, lines: all, overall, complete };
}
const confirmed: LineDetection = { status: "confirmed", progress: 1 };
const unclear: LineDetection = { status: "unclear", progress: 0.3 };
const gathering = (progress: number): LineDetection => ({ status: "gathering", progress });

/* ------------------------------------ 1. the arcs ------------------------------------ */

{
  ok(CHAKRA_ARC_DEG === 84 && CHAKRA_GAP_DEG === 6 && 4 * (CHAKRA_ARC_DEG + CHAKRA_GAP_DEG) === 360, "four arcs of ~84° with small gaps close the inner ring exactly");
  const ids = Object.keys(CHAKRA_MAJOR_ARCS);
  ok(ids.join() === "heart,head,life,fate" && ids.map((id) => CHAKRA_MAJOR_NAMES[id as ActiveLineId]).join(" ") === "हृदय मस्तिष्क जीवन शनि", "the majors, in the ledger's order, by their Devanagari names");
  ok(CHAKRA_MINORS.map((minor) => minor.name).join(" · ") === "सूर्य · बुध · विवाह · मणिबंध · शुक्र मेखला", "the outer ring's five: सूर्य, बुध, विवाह, मणिबंध, शुक्र मेखला");
  const minorArcs = CHAKRA_MINORS.map((minor) => CHAKRA_MINOR_ARCS[minor.id]);
  const span = minorArcs.reduce((sum, arc) => sum + arc.sweepDeg, 0) + (minorArcs.length - 1) * CHAKRA_MINOR_GAP_DEG + CHAKRA_MINOR_OPENING_DEG;
  ok(Math.abs(span - 360) < 1e-9, "the minors' arcs, their gaps and the opening at six o'clock close the outer ring");
  ok(Math.abs(minorArcs[0]!.startDeg - (180 + CHAKRA_MINOR_OPENING_DEG / 2)) < 1e-9, "…the opening centred at six o'clock, where the one caption sits");
  ok(CHAKRA_WORDS.minors.includes("अभी नहीं") && CHAKRA_WORDS.shutter === "अभी खींचें" && CHAKRA_WORDS.complete === "पहचान पूरी" && CHAKRA_WORDS.completeEn === "Scan complete", "the spec's words, exactly");

  const state = chakraState(detection({ heart: confirmed, head: gathering(0.42), life: unclear }));
  const by = Object.fromEntries(state.majors.map((major) => [major.id, major]));
  ok(by.heart!.fill === 1 && by.heart!.status === "confirmed", "confirmed: the arc completes");
  ok(by.head!.fill === 0.42, "gathering: the arc fills with THAT line's own progress — the number G3's rings show");
  ok(by.life!.fill === 0 && by.life!.status === "unclear", "not found within the budget: the arc stays a hairline");
  ok(by.fate!.fill === 0 && state.held === 1 && heldMajors(detection({ heart: confirmed })) === 1, "a line not yet seen is an empty track; one held");
  ok(state.minors.length === 5 && state.minors.every((minor) => minor.status === "not-yet"), "every minor: not yet (until S3)");
  ok(state.centre === "पहचान 61%", `the centre says "पहचान N%" (${state.centre})`);
  ok(chakraPercent(0.996) === 99 && chakraPercent(1) === 100 && chakraPercent(Number.NaN) === 0, "never 100% before it is done");

  /* Monotone: the arc follows the detection's high-water mark, which a lower fresh measure never lowers. */
  const line = (progress: number): RekhaLine => ({ id: "head", state: "tracking", points: [[1, 1], [9, 9]], progress, held: false });
  const snap = (frames: number, progress: number): RekhaSnapshot => ({
    lines: { head: line(progress) },
    anyConfirmed: false,
    flicker: { heart: 0, head: 0, life: 0, fate: 0 },
    firstConfirmedMs: { heart: null, head: null, life: null, fate: null },
    frames,
    costMs: 0,
  });
  const high = nextDetection(DETECTION_IDLE, snap(10, 0.6), 1000);
  const after = nextDetection(high, snap(11, 0.35), 1200);
  ok(chakraState(after).majors[1]!.fill === 0.6, "monotone: a fresh extraction measuring lower never moves an arc back");
}

/* --------------------------------- 2. completion --------------------------------- */

{
  const two = detection({ heart: confirmed, head: confirmed, life: gathering(0.5) });
  const three = detection({ heart: confirmed, head: confirmed, life: confirmed });
  const one = detection({ heart: confirmed, head: gathering(0.9) });

  ok(completionReason(detection({ heart: confirmed, head: confirmed, life: confirmed, fate: unclear }, true), { shutter: false, palmGoneMs: null }) === "detected", "(a) every major a result — confirmed or marked unclear — completes");
  ok(SHUTTER_MIN_HELD === 2 && !shutterReady(one) && shutterReady(two), "(b) the shutter sleeps below two majors held, and wakes at two");
  ok(completionReason(one, { shutter: true, palmGoneMs: null }) === null && completionReason(two, { shutter: true, palmGoneMs: null }) === "shutter", "…pressed asleep it does nothing; awake it completes the scan");
  ok(PALM_LEFT_MIN_HELD === 3 && PALM_LEFT_COMPLETE_MS === 5000, "(c) three majors held, and the palm gone more than five seconds");
  ok(completionReason(three, { shutter: false, palmGoneMs: 5001 }) === "palm-left", "…completes with what there is");
  ok(completionReason(three, { shutter: false, palmGoneMs: 5000 }) === null && completionReason(three, { shutter: false, palmGoneMs: 2000 }) === null, "…but a palm gone two seconds, or exactly five, is only a pause");
  ok(completionReason(two, { shutter: false, palmGoneMs: 8000 }) === null, "…and with two held a palm gone is not a completed scan");
  ok(completionReason(three, { shutter: false, palmGoneMs: null }) === null, "a palm in view completes nothing by itself");
  const signature = completionReason.toString();
  ok(!/pose|TILT|capture/i.test(signature), "the pose choreography is not even an input: the flow never waits on TILT_LEFT");
}

/* --------------------------------- 3. the best frame --------------------------------- */

{
  const sharp = { vol: 200, inBand: true, held: 2, eligible: true };
  ok(bestFrameScore(sharp) === 400, "sharpness × in-band × lines held");
  ok(bestFrameScore({ ...sharp, inBand: false }) === 400 * BEST_FRAME_OUT_OF_BAND, "out of the band it counts for less");
  ok(bestFrameScore({ ...sharp, held: 0 }) === 200 * BEST_FRAME_NO_LINES && bestFrameScore({ ...sharp, held: 1 }) > bestFrameScore({ ...sharp, held: 0 }), "before any line is held a frame still counts — less than any with a line");
  ok(bestFrameScore({ ...sharp, eligible: false }) === 0 && bestFrameScore({ ...sharp, vol: 0 }) === 0 && bestFrameScore({ ...sharp, vol: Number.NaN }) === 0, "a palm not facing, not in frame, or unmeasured is never the photograph");
  ok(bestFrameReplaces(null, { score: 10, convention: 4 }) && !bestFrameReplaces(null, { score: 0, convention: 4 }), "the first eligible frame is kept; a worthless one never");
  ok(bestFrameReplaces({ score: 300, convention: 4 }, { score: 301, convention: 4 }) && !bestFrameReplaces({ score: 300, convention: 4 }, { score: 300, convention: 4 }), "replaced ONLY when the score improves");
  ok(bestFrameReplaces({ score: 900, convention: 5 }, { score: 20, convention: 4 }), "…or when the kept frame is in the other anchor convention — another canonical space");
  /* Over a scan: the held count climbs, so a later frame at the same sharpness wins; a soft one never does. */
  let kept: { score: number; convention: number } | null = null;
  const log: number[] = [];
  for (const [vol, held] of [[80, 0], [120, 1], [60, 2], [150, 2], [140, 3], [40, 4]] as const) {
    const score = bestFrameScore({ vol, inBand: true, held, eligible: true });
    if (bestFrameReplaces(kept, { score, convention: 4 })) {
      kept = { score, convention: 4 };
      log.push(vol);
    }
  }
  ok(log.join() === "80,120,150,140", `across the scan: kept ${log.join(" → ")} — never the soft frame at 40 VoL with every line held`);
}

/* ----------------------------------- 4. the hold ----------------------------------- */

{
  const seen = markHandSeen({ ...emptyFusion(), frames: 12 }, 1000, "Right");
  ok(CHAMBER_HAND_HOLD_MS > PALM_LEFT_COMPLETE_MS, "the hold outlasts rule 2c, so a palm gone five seconds with three held completes before any reset could take its lines");
  ok(!chamberHoldResets(seen, { handPresent: false, nowMs: 1000 + 2000, otherHandFrames: 0 }), "a hand gone 2 s: nothing reset (the 12 s reset in the video must not happen)");
  ok(!chamberHoldResets(seen, { handPresent: false, nowMs: 1000 + 5000, otherHandFrames: 0 }), "…nor at 5 s");
  ok(chamberHoldResets(seen, { handPresent: false, nowMs: 1000 + CHAMBER_HAND_HOLD_MS + 1, otherHandFrames: 0 }), "a longer loss resets");
  ok(!chamberHoldResets(seen, { handPresent: true, nowMs: 1100, otherHandFrames: CHAMBER_HAND_SWITCH_FRAMES - 1 }), "a handedness label flickering for a few frames is not a different hand");
  ok(chamberHoldResets(seen, { handPresent: true, nowMs: 1100, otherHandFrames: CHAMBER_HAND_SWITCH_FRAMES }), "the other hand, CLEARLY — frames running — resets");
  ok(!chamberHoldResets({ frames: 0, lastHandMs: 1000 }, { handPresent: false, nowMs: 99_000, otherHandFrames: 99 }), "nothing is ever reset before a palm has been read");
  ok(CHAMBER_REANCHOR_GAP_MS > 0 && CHAMBER_REANCHOR_GAP_MS < 1000, "a hand back after a gap is re-anchored from its own landmarks");

  /* /scan's rule is the frozen core's, and it is untouched. */
  ok(HAND_LOSS_RESET_MS === 1500 && shouldReset(seen, { handPresent: false, handedness: null, nowMs: 1000 + 1501 }), "/scan keeps HAND_LOSS_RESET_MS: fusion.ts is the frozen core, and the chamber's hold lives outside it");
  ok(shouldReset(seen, { handPresent: true, handedness: "Left", nowMs: 1100 }), "…and its immediate other-hand reset");
}

/* ------------------------------------ 5. the seal ------------------------------------ */

{
  ok(CHAKRA_SEAL_MS === 600, "the gold sweep closes the ring in 600 ms");
  ok(sealSweep(0) === 0 && sealSweep(CHAKRA_SEAL_MS) === 1 && sealSweep(-50) === 0 && sealSweep(10_000) === 1, "…from nothing to the whole ring, and no further");
  ok(Math.abs(sealSweep(CHAKRA_SEAL_MS / 2) - 0.5) < 1e-12 && sealSweep(CHAKRA_SEAL_MS / 6) < 0.1, "…travelling round the ring: gathering from twelve o'clock, halfway at halfway, settling as it closes");
  ok(sealPulse(0) === 0 && Math.abs(sealPulse(CHAKRA_PULSE_MS / 2) - 1) < 1e-9 && Math.abs(sealPulse(CHAKRA_PULSE_MS)) < 1e-9 && sealPulse(2000) < 1e-9, "every arc pulses once — up, and back");
  ok(CHAKRA_RESULT_AT_MS > CHAKRA_SEAL_MS, "the result comes in once the ring has been seen closed");
}

/* ------------------------------ 6. wired: the hook, the chamber ------------------------------ */

{
  const hook = readFileSync("components/scan/use-hand-scan.ts", "utf8");
  ok(/const resetNow = holdThroughLossRef\.current\s*\?\s*chamberHoldResets\(/.test(hook) && /:\s*shouldReset\(fusionRef\.current, \{ handPresent: next !== null, handedness: next\?\.handedness \?\? null, nowMs: now \}\);/.test(hook), "the hook holds through a loss only for the chamber; /scan's reset decides exactly as before");
  ok(/else if \(holdThroughLossRef\.current && next !== null && handLastSeenMs > 0 && now - handLastSeenMs > CHAMBER_REANCHOR_GAP_MS\) \{[\s\S]*?resetStabiliser\(stabiliserRef\.current\);/.test(hook), "a hand back within the hold is re-anchored: the anchor filter's stale history is dropped, the evidence kept");
  ok(/bestFrameScore\(\{ vol: frameWeight\.vol, inBand, held, eligible \}\)/.test(hook) && /bestFrameReplaces\(kept, \{ score, convention \}\)/.test(hook), "the best frame is scored per rectify tick and replaced only by a better one");
  ok(/verdict\.checks\.not_palm_up && verdict\.checks\.out_of_frame && verdict\.checks\.low_confidence/.test(hook), "…eligible only facing the camera, inside the frame, found with confidence");
  ok((hook.match(/bestRef\.current = null;/g) ?? []).length >= 4, "…and dropped with the evidence: a new palm, a restart, a stop, a take");
  ok(!/freezeReplaces|FREEZE_WAIT_MS/.test(hook), "G4's recent-sharpest candidate is gone: one frame, the whole scan's best");

  const client = readFileSync("app/scan/chamber/chamber-client.tsx", "utf8");
  ok(/holdThroughLoss: true, bestFrame: true/.test(client), "the chamber asks the hook for both");
  ok(/completeScan\("detected"\)/.test(client) && /completeScan\("palm-left"\)/.test(client) && /completeScan\("shutter"\)/.test(client), "the three ways a scan completes all reach the one completion");
  ok(/const best = takeBestFrame\(\);[\s\S]*?stop\(\);\s*haptic\("detectionComplete"\);\s*soundRef\.current\?\.play\("shutter"\);/.test(client), "completion: the best frame taken, the camera stopped, the double tick, the soft shutter sound if sound is on");
  ok(!/FREEZE_WAIT_MS|freezeReady|peekFreeze/.test(client), "…at once: no wait for a sharper frame");
  ok(/disabled=\{!shutterLive\}/.test(client) && /data-snc-control="shutter"/.test(client), "the shutter button is disabled until it is live");
}

console.log(`CHAKRA ASSERTIONS PASSED (${assertions})`);
