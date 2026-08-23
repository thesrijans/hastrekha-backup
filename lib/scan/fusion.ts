/**
 * Temporal mask fusion.
 *
 * A single inference on a single frame is noisy: faint lines flicker in and out, and a line that
 * appears in one frame and not the next would make the overlay strobe. Fusing an exponential moving
 * average in *rectified* space fixes both — rectification already removed the hand's motion, so the
 * same skin lands on the same pixel every frame and averaging is meaningful rather than a smear.
 *
 * Confidence rises as evidence accumulates, and resets honestly when the evidence stops applying:
 * the hand leaving frame, or the pose changing, both invalidate everything gathered so far.
 *
 * Pure and allocation-conscious — the accumulators are reused across frames.
 */
import { RECTIFIED_SIZE, type LineMask } from "./types";

/** How much a new frame moves the average. Low enough to smooth, high enough to track a real change. */
export const DEFAULT_ALPHA = 0.3;
/** Hand gone for longer than this and the accumulated mask no longer describes anything. */
export const HAND_LOSS_RESET_MS = 1000;
/** Confidence is the mean of the strongest pixels — a line is sparse, so a plain mean would be noise. */
export const CONFIDENCE_TOP_FRACTION = 0.2;
/** Below this a pixel carries no signal and is excluded from the confidence population entirely. */
export const CONFIDENCE_FLOOR = 0.05;
/** Below this a pixel is background and does not count as a hit. */
export const HIT_THRESHOLD = 0.5;

export interface FusionState {
  readonly size: number;
  /** Exponential moving average of line probability, row-major. */
  readonly ema: Float32Array;
  /** How many frames each pixel has exceeded {@link HIT_THRESHOLD}. */
  readonly hits: Uint16Array;
  readonly frames: number;
  /** Mean of the top {@link CONFIDENCE_TOP_FRACTION} of `ema`, 0–1. */
  readonly confidence: number;
  readonly lastUpdateMs: number;
  readonly lastInferenceMs: number;
}

export function emptyFusion(size: number = RECTIFIED_SIZE): FusionState {
  const plane = size * size;
  return {
    size,
    ema: new Float32Array(plane),
    hits: new Uint16Array(plane),
    frames: 0,
    confidence: 0,
    lastUpdateMs: 0,
    lastInferenceMs: 0,
  };
}

/**
 * Mean of the strongest `topFraction` of the pixels that carry any signal.
 *
 * Note the deviation from a plain "top 20% of pixels": palm lines occupy roughly 2–5% of the crop,
 * so the top 20% of *all* pixels is three-quarters background. That measure can never climb out of
 * the warm-up band however good the segmentation is — the overlay would sit in its sweep animation
 * forever. Restricting the population to pixels above {@link CONFIDENCE_FLOOR} measures what was
 * actually intended: how strongly the model believes the pixels it does believe in.
 *
 * Uses a histogram rather than a sort — 65k floats sorted per frame is real time on a mid-range phone.
 */
export function confidenceOf(ema: Float32Array, topFraction: number = CONFIDENCE_TOP_FRACTION): number {
  const total = ema.length;
  if (total === 0) return 0;

  const BUCKETS = 256;
  const histogram = new Uint32Array(BUCKETS);
  let signal = 0;
  for (let i = 0; i < total; i += 1) {
    const value = ema[i];
    if (value <= CONFIDENCE_FLOOR) continue;
    const bucket = value >= 1 ? BUCKETS - 1 : (value * (BUCKETS - 1)) | 0;
    histogram[bucket] += 1;
    signal += 1;
  }
  if (signal === 0) return 0;

  const wanted = Math.max(1, Math.floor(signal * topFraction));

  // Walk down from the brightest bucket until `wanted` signal pixels are accounted for.
  let counted = 0;
  let cutoff = 0;
  for (let bucket = BUCKETS - 1; bucket >= 0; bucket -= 1) {
    counted += histogram[bucket];
    if (counted >= wanted) {
      cutoff = bucket;
      break;
    }
  }
  const threshold = cutoff / (BUCKETS - 1);

  let sum = 0;
  let n = 0;
  for (let i = 0; i < total; i += 1) {
    if (ema[i] > CONFIDENCE_FLOOR && ema[i] >= threshold) {
      sum += ema[i];
      n += 1;
    }
  }
  return n === 0 ? 0 : sum / n;
}

/**
 * Folds one inference into the running average.
 *
 * Mutates the accumulators in place and returns a new state object — React sees a changed reference,
 * but nothing allocates a 65k-element array per frame.
 */
export function fuse(
  state: FusionState,
  mask: LineMask,
  nowMs: number,
  alpha: number = DEFAULT_ALPHA,
): FusionState {
  if (mask.width * mask.height !== state.ema.length) return state;

  const { ema, hits } = state;
  const source = mask.all;
  // First frame seeds the average outright; blending it against zeros would just cost frames.
  const blend = state.frames === 0 ? 1 : alpha;

  for (let i = 0; i < ema.length; i += 1) {
    const value = source[i];
    ema[i] += (value - ema[i]) * blend;
    if (value >= HIT_THRESHOLD && hits[i] < 0xffff) hits[i] += 1;
  }

  return {
    ...state,
    frames: state.frames + 1,
    confidence: confidenceOf(ema),
    lastUpdateMs: nowMs,
    lastInferenceMs: mask.inferenceMs ?? state.lastInferenceMs,
  };
}

/** Clears the accumulators in place and returns a fresh state. */
export function resetFusion(state: FusionState): FusionState {
  state.ema.fill(0);
  state.hits.fill(0);
  return { ...state, frames: 0, confidence: 0, lastUpdateMs: 0, lastInferenceMs: 0 };
}

export interface ResetReasonInput {
  readonly handPresent: boolean;
  readonly poseChanged: boolean;
  readonly nowMs: number;
}

/**
 * Whether accumulated evidence still applies.
 *
 * A pose change invalidates immediately — a tilted palm rectifies to different pixels, so averaging
 * across the change would blend two different views of the hand. Hand loss is given a grace period,
 * because a single dropped detection is normal and throwing away a good fusion for it would make the
 * scan feel like it keeps starting over.
 */
export function shouldReset(state: FusionState, input: ResetReasonInput): boolean {
  if (state.frames === 0) return false;
  if (input.poseChanged) return true;
  if (!input.handPresent && state.lastUpdateMs > 0 && input.nowMs - state.lastUpdateMs > HAND_LOSS_RESET_MS) return true;
  return false;
}

/**
 * Merges a captured pose's mask into a cumulative one, per pixel by maximum.
 *
 * Max, not mean: each guided pose is chosen to reveal lines the others foreshorten, so a line seen
 * clearly in exactly one view should survive at full strength rather than be averaged into obscurity
 * by the four views that missed it.
 */
export function mergeMax(target: Float32Array, source: Float32Array): Float32Array {
  const n = Math.min(target.length, source.length);
  for (let i = 0; i < n; i += 1) {
    if (source[i] > target[i]) target[i] = source[i];
  }
  return target;
}
