/**
 * THE CHAKRA (scan-complete G4b, docs/specs/chakra-scan-g4.txt): the ring as the scan's progress, the three ways a
 * scan completes, the one best frame the photograph is taken from, and how long a hand may be gone.
 *
 * THE ARCS (§1). The inner ring is the four majors — हृदय, मस्तिष्क, जीवन, शनि — {@link CHAKRA_ARC_DEG}° each, in the
 * ledger's order clockwise from twelve o'clock, with a {@link CHAKRA_GAP_DEG}° gap at each of the wheel's four
 * finials. An arc fills clockwise with its line's detection progress (lib/scan/detection-progress.ts: the
 * accumulator's own measure toward CONFIRMED, a high-water mark that never moves back — the number G3's rings
 * show). Confirmed, the arc is whole and its ✓ stands at its end, in the gap; marked unclear by the budget, the
 * arc is a dimmed hairline and "—" stands there instead. The outer ring is the minors — सूर्य, बुध, विवाह, मणिबंध,
 * शुक्र मेखला — hairlines with a quiet "अभी नहीं" until S3 extends discovery to them: honest, not hidden.
 *
 * COMPLETION (§2), on any of: (a) every major a result, confirmed or marked unclear (G3's `complete`); (b) the
 * shutter, which wakes once {@link SHUTTER_MIN_HELD} majors are held; (c) the palm gone for more than
 * {@link PALM_LEFT_COMPLETE_MS} with {@link PALM_LEFT_MIN_HELD} majors held — a reader cannot always keep a palm up,
 * and three lines are a reading. The pose choreography blocks none of them, and the minors never do.
 *
 * THE BEST FRAME (§3). One frame is kept across the whole scan, scored sharpness × in the band × lines held
 * ({@link bestFrameScore}) and replaced only by a better one ({@link bestFrameReplaces}); the photograph is that
 * frame, and the held lines are drawn through its own homography.
 *
 * THE HOLD (§5). Progress, held lines, ✓ and the best frame survive a hand gone for up to five seconds; the
 * evidence is reset only by a longer absence ({@link CHAMBER_HAND_HOLD_MS}) or by a CLEARLY different hand —
 * the other handedness for {@link CHAMBER_HAND_SWITCH_FRAMES} frames running, not one flickering label
 * ({@link chamberHoldResets}). A hand that returns is re-anchored from its own landmarks: the canonical crop is
 * the palm's homography, so the evidence and the held lines are in the returning palm's space already.
 *
 * "Held" is the ledger's ✓: a line the detection has marked confirmed (sticky — the hold's hysteresis keeps its
 * flicker to one return per 20 s, and the result draws it from its last confirmed geometry if the hold has since
 * let it go). What the reader counts on the ring is what the rules count.
 *
 * Pure, and outside the frozen core.
 */
import { DETECTION_LINE_IDS, type DetectionState, type LineDetectionStatus } from "./detection-progress";
import type { ActiveLineId } from "./types";

/* ----------------------------------- The arcs ----------------------------------- */

/** A major line's arc: ~84° of the inner ring. */
export const CHAKRA_ARC_DEG = 84;
/** The gap between two majors, centred on a finial (12, 3, 6 and 9 o'clock). */
export const CHAKRA_GAP_DEG = 6;

/** The majors' names on the ring — the ledger's, one word each. */
export const CHAKRA_MAJOR_NAMES: Readonly<Record<ActiveLineId, string>> = { heart: "हृदय", head: "मस्तिष्क", life: "जीवन", fate: "शनि" };

/** An arc: where it starts and how far it runs, in degrees clockwise from twelve o'clock. */
export interface ChakraArc {
  readonly startDeg: number;
  readonly sweepDeg: number;
}

/** The inner ring: one arc per major, in the ledger's order, each starting just after its quarter's finial. */
export const CHAKRA_MAJOR_ARCS: Readonly<Record<ActiveLineId, ChakraArc>> = Object.fromEntries(
  DETECTION_LINE_IDS.map((id, index) => [id, { startDeg: index * 90 + CHAKRA_GAP_DEG / 2, sweepDeg: CHAKRA_ARC_DEG }]),
) as Record<ActiveLineId, ChakraArc>;

/** The minors the outer ring stands for — the chamber's named minor classes. */
export type ChakraMinorId = "sun" | "health" | "marriage" | "bracelets" | "girdle_of_venus";

export const CHAKRA_MINORS: readonly { readonly id: ChakraMinorId; readonly name: string }[] = [
  { id: "sun", name: "सूर्य" },
  { id: "health", name: "बुध" },
  { id: "marriage", name: "विवाह" },
  { id: "bracelets", name: "मणिबंध" },
  { id: "girdle_of_venus", name: "शुक्र मेखला" },
];

/** The outer ring is open at six o'clock this wide, and its one caption — "अभी नहीं" — sits in the opening. */
export const CHAKRA_MINOR_OPENING_DEG = 44;
/** Between two minor arcs. */
export const CHAKRA_MINOR_GAP_DEG = 4;
/** Each minor's arc: what is left of the circle, shared five ways. */
export const CHAKRA_MINOR_ARC_DEG = (360 - CHAKRA_MINOR_OPENING_DEG - (CHAKRA_MINORS.length - 1) * CHAKRA_MINOR_GAP_DEG) / CHAKRA_MINORS.length;

/** The outer ring: one arc per minor, clockwise from just past the opening at six o'clock. */
export const CHAKRA_MINOR_ARCS: Readonly<Record<ChakraMinorId, ChakraArc>> = Object.fromEntries(
  CHAKRA_MINORS.map((minor, index) => [
    minor.id,
    { startDeg: 180 + CHAKRA_MINOR_OPENING_DEG / 2 + index * (CHAKRA_MINOR_ARC_DEG + CHAKRA_MINOR_GAP_DEG), sweepDeg: CHAKRA_MINOR_ARC_DEG },
  ]),
) as Record<ChakraMinorId, ChakraArc>;

/** The chakra's words, exactly as the spec prints them. */
export const CHAKRA_WORDS = {
  overall: "पहचान",
  complete: "पहचान पूरी",
  completeEn: "Scan complete",
  notYet: "अभी नहीं",
  /** The outer ring's caption: the minors, not yet. */
  minors: "गौण रेखाएँ · अभी नहीं",
  shutter: "अभी खींचें",
  shutterEn: "Take it now",
} as const;

/** One major's arc as the ring draws it. */
export interface ChakraMajor {
  readonly id: ActiveLineId;
  readonly name: string;
  readonly status: LineDetectionStatus;
  /** 0–1 of the arc filled: the line's progress while gathering, whole once confirmed, none once unclear (a hairline). */
  readonly fill: number;
}

/** The ring's whole state: the four majors, the five minors (not yet), and the centre's words. */
export interface ChakraState {
  readonly majors: readonly ChakraMajor[];
  readonly minors: readonly { readonly id: ChakraMinorId; readonly name: string; readonly status: "not-yet" }[];
  /** Majors held (✓). */
  readonly held: number;
  /** "पहचान N%". */
  readonly centre: string;
}

/** 0–1 as a whole percentage, never rounding an unfinished detection up to 100 (the ledger's rule). */
export function chakraPercent(fraction: number): number {
  const percent = Math.round(Math.min(1, Math.max(0, Number.isFinite(fraction) ? fraction : 0)) * 100);
  return percent === 100 && fraction < 1 ? 99 : percent;
}

/** Majors held: the ledger's ✓. */
export function heldMajors(detection: DetectionState): number {
  return DETECTION_LINE_IDS.filter((id) => detection.lines[id].status === "confirmed").length;
}

/** The ring for a detection state. */
export function chakraState(detection: DetectionState): ChakraState {
  const majors = DETECTION_LINE_IDS.map((id): ChakraMajor => {
    const line = detection.lines[id];
    const fill = line.status === "confirmed" ? 1 : line.status === "unclear" ? 0 : Math.min(1, Math.max(0, line.progress));
    return { id, name: CHAKRA_MAJOR_NAMES[id], status: line.status, fill };
  });
  return {
    majors,
    minors: CHAKRA_MINORS.map((minor) => ({ ...minor, status: "not-yet" as const })),
    held: majors.filter((major) => major.status === "confirmed").length,
    centre: `${CHAKRA_WORDS.overall} ${chakraPercent(detection.overall)}%`,
  };
}

/* ---------------------------------- Completion ---------------------------------- */

/** The shutter wakes with this many majors held (§3). */
export const SHUTTER_MIN_HELD = 2;
/** A palm gone completes the scan only with this many majors held (§2c). */
export const PALM_LEFT_MIN_HELD = 3;
/** …and only once it has been gone longer than this (§2c). */
export const PALM_LEFT_COMPLETE_MS = 5000;

/**
 * THE HOLD (§5): the chamber's evidence survives a hand gone this long — past {@link PALM_LEFT_COMPLETE_MS}, so a
 * palm gone five seconds with three majors held completes the scan (2c) before a reset could take its lines;
 * with fewer, the evidence is reset only after this. The hook's default for /scan stays HAND_LOSS_RESET_MS.
 */
export const CHAMBER_HAND_HOLD_MS = 5500;
/**
 * The other hand, CLEARLY: the landmarker's handedness this many frames running — a label that flickers for a
 * frame or two on a tilted palm is not a different hand (§5). One frame, the hook's default, is /scan's rule.
 */
export const CHAMBER_HAND_SWITCH_FRAMES = 8;

/**
 * THE CHAMBER'S RESET RULE (§5), in place of fusion.ts shouldReset — which is the frozen core's, and /scan's rule,
 * and stays exactly as it is. The same two reasons, held longer: the hand gone more than
 * {@link CHAMBER_HAND_HOLD_MS}, or the other hand for {@link CHAMBER_HAND_SWITCH_FRAMES} frames running
 * (`otherHandFrames`, counted by the caller). Nothing is ever reset before a palm has been read.
 */
export function chamberHoldResets(
  state: { readonly frames: number; readonly lastHandMs: number },
  input: { readonly handPresent: boolean; readonly nowMs: number; readonly otherHandFrames: number },
): boolean {
  if (state.frames === 0) return false;
  if (input.otherHandFrames >= CHAMBER_HAND_SWITCH_FRAMES) return true;
  return !input.handPresent && state.lastHandMs > 0 && input.nowMs - state.lastHandMs > CHAMBER_HAND_HOLD_MS;
}

/**
 * A hand back after a gap this long is re-anchored from its own landmarks: the anchor filter's history (the
 * stabiliser) is dropped, so the first crops after the gap are not lerped from where the palm used to be.
 */
export const CHAMBER_REANCHOR_GAP_MS = 250;

/** Why the scan completed: detection (2a), the shutter (2b), or the palm gone with three lines held (2c). */
export type CompletionReason = "detected" | "shutter" | "palm-left";

/** Whether the shutter is live: at least {@link SHUTTER_MIN_HELD} majors held. */
export function shutterReady(detection: DetectionState): boolean {
  return heldMajors(detection) >= SHUTTER_MIN_HELD;
}

/**
 * Whether — and why — the scan is complete now. `palmGoneMs`: how long no palm has been seen (null while one
 * is, or before any was). The pose choreography is not an input: it blocks nothing.
 */
export function completionReason(detection: DetectionState, input: { readonly shutter: boolean; readonly palmGoneMs: number | null }): CompletionReason | null {
  if (detection.complete) return "detected";
  if (input.shutter && shutterReady(detection)) return "shutter";
  if (input.palmGoneMs !== null && input.palmGoneMs > PALM_LEFT_COMPLETE_MS && heldMajors(detection) >= PALM_LEFT_MIN_HELD) return "palm-left";
  return null;
}

/* ---------------------------------- The sealing ---------------------------------- */

/** The gold sweep that closes the ring on completion (§2). */
export const CHAKRA_SEAL_MS = 600;
/** Every arc pulses once, at the sweep's start. */
export const CHAKRA_PULSE_MS = 320;
/** The result screen comes in once the ring is closed and has been seen closed: this long after its first sealing frame. */
export const CHAKRA_RESULT_AT_MS = 900;
/** …or this long after the completion, whatever the canvas managed — a hidden tab draws no frames at all. */
export const CHAKRA_RESULT_LATEST_MS = 2500;

/**
 * The sweep, 0–1, eased in and out: it gathers from twelve o'clock, runs, and settles as it closes — seen travelling
 * round the ring, not arriving (an eased-out sweep had done 42% of the circle by its first frame, the first G4b
 * capture).
 */
export function sealSweep(elapsedMs: number): number {
  const t = Math.min(1, Math.max(0, elapsedMs / CHAKRA_SEAL_MS));
  return t * t * (3 - 2 * t);
}

/** The pulse, 0 → 1 → 0 once. */
export function sealPulse(elapsedMs: number): number {
  const t = Math.min(1, Math.max(0, elapsedMs / CHAKRA_PULSE_MS));
  return Math.sin(Math.PI * t);
}

/* --------------------------------- The best frame --------------------------------- */

/** A frame outside the distance band scores this share of one in it (§3 "palm-in-band"). */
export const BEST_FRAME_OUT_OF_BAND = 0.25;
/**
 * A frame before any line is held scores as half a line: the spec's product would make every such frame worth
 * nothing, and a scan the budget ends with no line confirmed still needs a photograph. Any frame with a line
 * held outranks it at the same sharpness.
 */
export const BEST_FRAME_NO_LINES = 0.5;

/** What a frame is scored on. `eligible`: the palm faces the camera, sits in the frame, and was found with confidence. */
export interface BestFrameInput {
  /** The palm box's variance of Laplacian at camera resolution (rekha-persist palmBoxVol, the accumulator's weight). */
  readonly vol: number;
  readonly inBand: boolean;
  /** Majors held at that moment. */
  readonly held: number;
  readonly eligible: boolean;
}

/** §3: sharpness × palm-in-band × lines held. Zero for a frame not eligible, or with no measured sharpness. */
export function bestFrameScore(input: BestFrameInput): number {
  if (!input.eligible || !(input.vol > 0)) return 0;
  return input.vol * (input.inBand ? 1 : BEST_FRAME_OUT_OF_BAND) * (input.held > 0 ? input.held : BEST_FRAME_NO_LINES);
}

/**
 * Whether `offer` takes the kept frame's place: only a better score — or a kept frame in the other anchor
 * convention, which is another canonical space the lines can no longer be carried into exactly.
 */
export function bestFrameReplaces(kept: { readonly score: number; readonly convention: number } | null, offer: { readonly score: number; readonly convention: number }): boolean {
  if (!(offer.score > 0)) return false;
  if (kept === null || kept.convention !== offer.convention) return true;
  return offer.score > kept.score;
}
