/**
 * Guided multi-capture.
 *
 * One view of a palm foreshortens whatever lies at an angle to the camera: a life line hugging the
 * thumb is nearly edge-on in a flat shot, and the percussion side vanishes. Five prescribed poses
 * each expose something the others hide, and their masks merge by per-pixel maximum — a line seen
 * clearly in exactly one view survives at full strength.
 *
 * Capture is automatic after {@link AUTO_CAPTURE_HOLD_MS} of *continuous* gate-pass. Any failing
 * frame resets the hold to zero, so the progress ring can only fill while the frame is genuinely
 * good — the same rule that stopped rules latching off the back of a hand.
 *
 * Pure and unit-tested; the component only feeds it clock ticks.
 */
import { CAPTURE_POSES, type CapturePose, type PoseProfile } from "./quality";
import { mergeMax } from "./fusion";
import { RECTIFIED_SIZE } from "./types";

/** Continuous good frames required before a pose is captured. */
export const AUTO_CAPTURE_HOLD_MS = 1500;

export interface CaptureRecord {
  readonly pose: CapturePose;
  readonly confidence: number;
  readonly mask: Float32Array;
  readonly capturedAtMs: number;
}

export interface CaptureState {
  /** Index into {@link CAPTURE_POSES}; equals length once every pose is done. */
  readonly index: number;
  /** Continuous gate-passing milliseconds accumulated for the current pose. */
  readonly holdMs: number;
  readonly records: readonly CaptureRecord[];
  readonly done: boolean;
}

export function emptyCapture(): CaptureState {
  return { index: 0, holdMs: 0, records: [], done: false };
}

export function currentPose(state: CaptureState): PoseProfile | null {
  return state.done ? null : (CAPTURE_POSES[state.index] ?? null);
}

/**
 * Advances (or resets) the hold clock.
 *
 * `deltaMs` rather than absolute time so a backgrounded tab that resumes with a huge gap cannot
 * instantly satisfy the hold — the caller clamps the delta to a sane frame interval.
 */
export function tickCapture(state: CaptureState, gatePassed: boolean, deltaMs: number): CaptureState {
  if (state.done) return state;
  if (!gatePassed) return state.holdMs === 0 ? state : { ...state, holdMs: 0 };
  return { ...state, holdMs: Math.min(AUTO_CAPTURE_HOLD_MS, state.holdMs + Math.max(0, deltaMs)) };
}

export function readyToCapture(state: CaptureState): boolean {
  return !state.done && state.holdMs >= AUTO_CAPTURE_HOLD_MS;
}

/** Records the pose's mask and moves to the next one. The mask is copied — the caller reuses theirs. */
export function commitCapture(state: CaptureState, mask: Float32Array, confidence: number, nowMs: number): CaptureState {
  const pose = currentPose(state);
  if (pose === null) return state;
  const index = state.index + 1;
  return {
    index,
    holdMs: 0,
    records: [...state.records, { pose: pose.pose, confidence, mask: Float32Array.from(mask), capturedAtMs: nowMs }],
    done: index >= CAPTURE_POSES.length,
  };
}

/** 0–1 across the whole sequence, including partial progress on the pose in hand. */
export function progressOf(state: CaptureState): number {
  const total = CAPTURE_POSES.length;
  const partial = state.done ? 0 : state.holdMs / AUTO_CAPTURE_HOLD_MS;
  return Math.min(1, (state.records.length + partial) / total);
}

/** 0–1 for the current pose alone — what the progress ring animates. */
export function poseProgressOf(state: CaptureState): number {
  return state.done ? 1 : Math.min(1, state.holdMs / AUTO_CAPTURE_HOLD_MS);
}

/**
 * Per-pixel maximum across every captured pose **of the same hand**.
 *
 * Max, not mean: averaging would punish a line for being invisible in the four views that could not
 * see it, which is precisely backwards.
 *
 * OTHER_HAND is excluded, and that is not an optimisation. The guided sequence deliberately asks for
 * the second hand, but its creases are a different palm's — merging them into the same rectified crop
 * produces a mask that is a union of two people's-worth of lines, and every measurement taken from it
 * afterwards describes neither hand. The second hand is worth capturing; it is not worth pretending
 * it is more views of the first.
 */
export function mergedMask(state: CaptureState, size: number = RECTIFIED_SIZE): Float32Array {
  const out = new Float32Array(size * size);
  for (const record of state.records) {
    if (record.pose === "OTHER_HAND") continue;
    mergeMax(out, record.mask);
  }
  return out;
}

/** The second hand's own mask, kept apart from {@link mergedMask} for the reason stated there. */
export function otherHandMask(state: CaptureState): Float32Array | null {
  return state.records.find((record) => record.pose === "OTHER_HAND")?.mask ?? null;
}

/** Best single-pose confidence — a floor on how much the merged mask can be trusted. */
export function bestConfidence(state: CaptureState): number {
  return state.records.reduce((best, record) => Math.max(best, record.confidence), 0);
}
