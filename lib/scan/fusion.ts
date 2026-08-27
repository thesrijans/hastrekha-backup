/**
 * Temporal mask fusion, motion-compensated.
 *
 * A single inference on a single frame is noisy: faint lines flicker in and out, and a line that
 * appears in one frame and not the next would make the overlay strobe. Fusing an exponential moving
 * average in *rectified* space fixes both — rectification has already removed most of the hand's
 * motion, so the same skin lands on roughly the same pixel every frame and averaging is meaningful
 * rather than a smear.
 *
 * The old code threw the accumulator away whenever anything moved, which is why the overlay blinked
 * out every time the user's hand shifted: evidence, traces and confidence all went to zero together,
 * and several seconds of accumulation had to start over. **Movement no longer resets anything.**
 *
 * The reason that is safe is worth stating precisely, because the intuitive fix is the wrong one.
 * Rectification is not an approximate alignment that motion degrades — it is *exact*, because both
 * frames send the hand's own anchors to the same canonical targets. A patch of skin lands on the
 * same crop pixel however the hand has moved; measured against a synthetic 3-D palm under a large
 * pose change, the same skin point landed within 1.9e-13 of a pixel in both crops. So the correct
 * frame-to-frame compensation is to do nothing at all. Composing the two frames' homographies to
 * "warp the accumulator forward" would put the hand motion *back*: on that same test it displaced
 * the crop by 176px and landed skin 90–109px from the truth, which is far worse than the reset it
 * would have replaced. See {@link alignFusion}.
 *
 * What does move the crop is a change of anchor *convention* — `palmAnchors` switching between four
 * and five correspondences as the percussion point enters and leaves frame. That is remapped exactly,
 * from a single frame, and it is the only resampling this module ever performs.
 *
 * Reset is reserved for the two events that genuinely invalidate evidence: the hand being gone long
 * enough that nothing is being tracked, and the hand being replaced by the *other* hand, whose
 * creases are a different palm entirely.
 *
 * Pure and allocation-conscious — the accumulators and the warp scratch are reused across frames.
 */
import { conventionRemap, transformDisplacement, type Matrix3 } from "./rectify";
import { RECTIFIED_SIZE, type Handedness, type LineMask } from "./types";

/** How much a new frame moves the average. Low enough to smooth, high enough to track a real change. */
export const DEFAULT_ALPHA = 0.3;
/**
 * Hand gone for longer than this and the accumulated mask no longer describes anything.
 *
 * Raised from 1s: a dropped detection or two is routine, and the whole point of persistence is that
 * a brief loss must not cost the user the several seconds of evidence behind their overlay.
 */
export const HAND_LOSS_RESET_MS = 1500;
/**
 * Crop-pixel displacement below which the warp is skipped entirely.
 *
 * Every warp resamples, and every bilinear resample low-passes slightly. Warping through sub-pixel
 * landmark jitter would slowly blur accumulated evidence for no alignment gain, so a hand being held
 * still costs nothing. Half a pixel is far below the ~2.5px reprojection error the anchor fit itself
 * carries, so skipping under it cannot be the dominant misalignment.
 */
export const WARP_MIN_DISPLACEMENT = 0.5;
/**
 * Displacement above which the previous field is dropped rather than warped.
 *
 * A jump this large is not the hand moving, it is the fit changing its mind — a landmark
 * mis-detection, or the hand leaving and a different pose arriving between two rectify ticks.
 * Warping across it would drag a whole palm's worth of evidence onto the wrong skin.
 */
export const WARP_MAX_DISPLACEMENT = 96;
/**
 * Per-fused-frame floor on confidence decay: a half-life of about 23 fused frames, ~4.6s at the
 * fusion cadence. Slower than any transient dip, faster than a user would call a stale number wrong.
 */
export const CONFIDENCE_DECAY = 0.97;
/** Confidence is the mean of the strongest pixels — a line is sparse, so a plain mean would be noise. */
export const CONFIDENCE_TOP_FRACTION = 0.2;
/** Below this a pixel carries no signal and is excluded from the confidence population entirely. */
export const CONFIDENCE_FLOOR = 0.05;
/** Below this a pixel is background and does not count as a hit. */
export const HIT_THRESHOLD = 0.5;
/**
 * The faint tier: what a MINOR line is worth.
 *
 * Minor creases are genuinely shallower than the principal four — that is what makes them minor —
 * so a single threshold either loses them or floods the strong tier with noise. This is 0.55 of the
 * strong threshold, and the price of admitting it is paid in STABILITY rather than in strength: a
 * faint pixel has to persist, which noise cannot do and a real crease does effortlessly.
 */
export const FAINT_THRESHOLD = 0.55 * HIT_THRESHOLD;
/** Fused frames a faint pixel must survive before it may be traced. Noise cannot promote itself. */
export const FAINT_STABILITY_FRAMES = 4;

export interface FusionState {
  readonly size: number;
  /** Exponential moving average of line probability, row-major. */
  readonly ema: Float32Array;
  /** How many frames each pixel has exceeded {@link HIT_THRESHOLD}. */
  readonly hits: Uint16Array;
  /** …and {@link FAINT_THRESHOLD}. This is what admits a minor line without admitting noise. */
  readonly faintHits: Uint16Array;
  readonly frames: number;
  /** Mean of the top {@link CONFIDENCE_TOP_FRACTION} of `ema`, 0–1. */
  readonly confidence: number;
  readonly lastUpdateMs: number;
  readonly lastInferenceMs: number;
  /**
   * The frame→crop fit that `ema` is currently expressed in. Null before the first observation.
   * This is what makes the accumulator addressable across frames rather than merely assumed aligned.
   */
  readonly toCrop: Matrix3 | null;
  /** Wall clock of the last frame that carried a hand at all — drives the loss timer, not `lastUpdateMs`. */
  readonly lastHandMs: number;
  /** Which hand this evidence belongs to. The other hand is a different palm, not more of the same one. */
  readonly handedness: Handedness | null;
  /**
   * How many anchor correspondences the stored field was rectified with, 4 or 5. This — not the
   * matrix — is what identifies the crop space, because two frames solved under the same convention
   * put the same skin on the same pixel however the hand moved.
   */
  readonly convention: number | null;
  /** Motion-compensating warps applied since the last reset. Surfaced in the debug HUD. */
  readonly warps: number;
  /** Warp destination buffers, reused. Not state — scratch that must not be allocated per frame. */
  readonly scratch: Float32Array;
  readonly scratchHits: Uint16Array;
  /** Pixels a remap brought in from outside the old crop; the next observation seeds them outright. */
  readonly fresh: Uint8Array;
}

export function emptyFusion(size: number = RECTIFIED_SIZE): FusionState {
  const plane = size * size;
  return {
    size,
    ema: new Float32Array(plane),
    hits: new Uint16Array(plane),
    faintHits: new Uint16Array(plane),
    frames: 0,
    confidence: 0,
    lastUpdateMs: 0,
    lastInferenceMs: 0,
    toCrop: null,
    lastHandMs: 0,
    handedness: null,
    convention: null,
    warps: 0,
    scratch: new Float32Array(plane),
    scratchHits: new Uint16Array(plane),
    fresh: new Uint8Array(plane),
  };
}

/**
 * Resamples a probability field under a homography, bilinearly, into `dst`.
 *
 * Inverse mapping: `m` takes a **destination** pixel to its source coordinate, so every destination
 * pixel is written exactly once and no holes appear. Destination pixels whose source falls outside
 * the field are written as zero — deliberately, not as a clamped edge value. Skin newly rotated into
 * view genuinely has no accumulated history, and replicating the border instead would smear the
 * outermost row of evidence across the whole newly-revealed region and then keep re-smearing it
 * every frame. Zero says "nothing known yet", which the next observation immediately corrects.
 */
export function warpField(src: Float32Array, dst: Float32Array, size: number, m: Matrix3): void {
  const [a, b, c, d, e, f, g, h, i] = m;
  for (let y = 0; y < size; y += 1) {
    const py = y + 0.5;
    for (let x = 0; x < size; x += 1) {
      const px = x + 0.5;
      const w = g * px + h * py + i;
      const at = y * size + x;
      if (Math.abs(w) < 1e-12) {
        dst[at] = 0;
        continue;
      }
      const sx = (a * px + b * py + c) / w - 0.5;
      const sy = (d * px + e * py + f) / w - 0.5;
      if (sx < 0 || sy < 0 || sx > size - 1 || sy > size - 1) {
        dst[at] = 0;
        continue;
      }
      const x0 = sx | 0;
      const y0 = sy | 0;
      const x1 = x0 + 1 > size - 1 ? size - 1 : x0 + 1;
      const y1 = y0 + 1 > size - 1 ? size - 1 : y0 + 1;
      const fx = sx - x0;
      const fy = sy - y0;
      const top = src[y0 * size + x0] + (src[y0 * size + x1] - src[y0 * size + x0]) * fx;
      const bottom = src[y1 * size + x0] + (src[y1 * size + x1] - src[y1 * size + x0]) * fx;
      dst[at] = top + (bottom - top) * fy;
    }
  }
}

/**
 * The same warp for the hit counter, nearest-neighbour rather than bilinear.
 *
 * `hits` is a count of frames, not an intensity. Interpolating it would invent fractional evidence
 * and — because it is the one buffer that accumulates without decay — that invention would compound
 * warp after warp instead of being forgotten. Nearest-neighbour keeps every value a real count.
 */
export function warpCounts(src: Uint16Array, dst: Uint16Array, size: number, m: Matrix3): void {
  const [a, b, c, d, e, f, g, h, i] = m;
  for (let y = 0; y < size; y += 1) {
    const py = y + 0.5;
    for (let x = 0; x < size; x += 1) {
      const px = x + 0.5;
      const w = g * px + h * py + i;
      const at = y * size + x;
      if (Math.abs(w) < 1e-12) {
        dst[at] = 0;
        continue;
      }
      const sx = Math.round((a * px + b * py + c) / w - 0.5);
      const sy = Math.round((d * px + e * py + f) / w - 0.5);
      dst[at] = sx < 0 || sy < 0 || sx >= size || sy >= size ? 0 : src[sy * size + sx];
    }
  }
}

/** Why {@link alignFusion} did what it did. Surfaced in the debug HUD, and asserted in tests. */
export type AlignOutcome = "first" | "aligned" | "remapped" | "dropped";

export interface AlignResult {
  readonly state: FusionState;
  readonly outcome: AlignOutcome;
  /** Crop-pixel displacement the convention change would have caused. Zero when nothing moved. */
  readonly displacement: number;
}

/**
 * Brings the accumulator into the current frame's crop space, ahead of blending a new observation.
 *
 * The surprise here — and the thing that makes the persistence fix correct rather than actively
 * harmful — is how little work this normally has to do. Rectified space is **already**
 * motion-compensated: both frames' fits send the hand's own anchors to the same canonical targets,
 * so a patch of skin lands on the same crop pixel however the hand moved. The frame-to-frame remap
 * for hand motion is the identity, verified to 1.9e-13 px against a synthetic 3-D palm under a large
 * pose change. Composing the two frames' homographies to "compensate" would *re-inject* the motion:
 * on that same test it displaced the crop by 176px and put skin 90–109px out of place. So the
 * outcome on an ordinary moving frame is `aligned`, and nothing is resampled at all.
 *
 * The one thing that genuinely moves the crop is a change of anchor **convention**. `palmAnchors`
 * uses five correspondences when the percussion point is in frame and four when it is not, and the
 * two solves place the same skin differently. Both matrices for that remap come from the same frame,
 * which is exactly the case {@link conventionRemap} is exact for.
 *
 * @param toCropCurrent the fit `rectifyPalm` actually used this frame.
 * @param toCropUnderPrevious the same frame solved under the *previous* convention, or null when the
 * convention did not change. Supplying a matrix from a different frame would be the error above.
 */
export function alignFusion(
  state: FusionState,
  toCropCurrent: Matrix3,
  convention: number,
  toCropUnderPrevious: Matrix3 | null = null,
): AlignResult {
  if (state.frames === 0 || state.convention === null) {
    return { state: { ...state, toCrop: toCropCurrent, convention }, outcome: "first", displacement: 0 };
  }
  if (state.convention === convention) {
    return { state: { ...state, toCrop: toCropCurrent }, outcome: "aligned", displacement: 0 };
  }
  if (toCropUnderPrevious === null) {
    /*
     * The convention changed but the remap could not be solved — the caller's re-solve under the old
     * convention returned null, which degenerate or extrapolated anchors do produce. The evidence is
     * now addressed to a crop nothing can map, so it is dropped rather than kept.
     *
     * Adopting the new convention here is the part that matters. Returning "aligned" while leaving
     * `state.convention` on the old value stalled the accumulator permanently: `maskApplies` then
     * rejected every subsequent mask, since none of them would ever again be fired under a convention
     * the accumulator had silently kept.
     */
    return {
      state: { ...resetFusion(state), toCrop: toCropCurrent, convention },
      outcome: "dropped",
      displacement: Infinity,
    };
  }

  const remap = conventionRemap(toCropUnderPrevious, toCropCurrent);
  if (remap === null) {
    return {
      state: { ...resetFusion(state), toCrop: toCropCurrent, convention },
      outcome: "dropped",
      displacement: Infinity,
    };
  }

  const displacement = transformDisplacement(remap, state.size);
  /*
   * A remap claiming a large fraction of the crop came from a bad solve — an extrapolated percussion
   * point, or a palm turning edge-on. Refusing leaves the evidence slightly misregistered, which the
   * EMA recovers from within a few frames; accepting would drag a whole palm of evidence onto the
   * wrong skin, which it never recovers from.
   */
  if (displacement > WARP_MAX_DISPLACEMENT) {
    return {
      state: { ...resetFusion(state), toCrop: toCropCurrent, convention },
      outcome: "dropped",
      displacement,
    };
  }
  // Below a pixel a resample cannot move a line into a different pixel, so it buys no registration
  // and still pays the full bilinear low-pass.
  if (displacement < WARP_MIN_DISPLACEMENT) {
    return { state: { ...state, toCrop: toCropCurrent, convention }, outcome: "aligned", displacement };
  }

  warpField(state.ema, state.scratch, state.size, remap);
  state.ema.set(state.scratch);
  warpCounts(state.hits, state.scratchHits, state.size, remap);
  state.hits.set(state.scratchHits);
  warpCounts(state.faintHits, state.scratchHits, state.size, remap);
  state.faintHits.set(state.scratchHits);
  markFresh(state, remap);

  return {
    state: {
      ...state,
      toCrop: toCropCurrent,
      convention,
      warps: state.warps + 1,
      confidence: confidenceOf(state.ema),
    },
    outcome: "remapped",
    displacement,
  };
}

/**
 * Whether a mask fired some frames ago may still be blended into `state`.
 *
 * This guard exists because inference is asynchronous and the accumulator can move underneath an
 * in-flight request. What it must compare is **which crop space the mask is addressed to**, and that
 * is the anchor convention — not the particular homography the frame was rectified with. Two frames
 * solved under the same convention put the same skin on the same pixel however the hand moved (see
 * {@link alignFusion}), so a mask from three frames ago is still perfectly registered.
 *
 * Comparing the *matrix* instead was a real and total regression: `alignFusion` mints a fresh
 * `toCrop` on every rectify tick, so any inference slower than the rectify interval was stale by the
 * time it answered and was thrown away — every single time, not occasionally. Simulated against the
 * real fusion code at a 300ms inference and a 200ms tick, the matrix guard fused 0 masks and
 * discarded 13; this one fuses all 13. The overlay stayed blank on exactly the devices where
 * inference was slowest, which is the opposite of the intended behaviour.
 */
export function maskApplies(state: FusionState, conventionAtFire: number): boolean {
  return state.convention === null || state.convention === conventionAtFire;
}

/**
 * Flags destination pixels whose source lay outside the old crop.
 *
 * Those pixels have no prior to average against, so {@link fuse} seeds them outright from the next
 * observation rather than blending them up from zero — the same reasoning it already applies to the
 * very first frame. Without this, a convention change leaves a dark band of under-weighted evidence
 * along whichever edge rotated into view, and `thin()` turns that band's inner boundary into a
 * spurious trace.
 */
function markFresh(state: FusionState, m: Matrix3): void {
  const { size, fresh } = state;
  fresh.fill(0);
  const [a, b, c, d, e, f, g, h, i] = m;
  for (let y = 0; y < size; y += 1) {
    const py = y + 0.5;
    for (let x = 0; x < size; x += 1) {
      const px = x + 0.5;
      const w = g * px + h * py + i;
      if (Math.abs(w) < 1e-12) {
        fresh[y * size + x] = 1;
        continue;
      }
      const sx = (a * px + b * py + c) / w - 0.5;
      const sy = (d * px + e * py + f) / w - 0.5;
      if (sx < 0 || sy < 0 || sx > size - 1 || sy > size - 1) fresh[y * size + x] = 1;
    }
  }
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

  const { ema, hits, faintHits, fresh } = state;
  const source = mask.all;
  // First frame seeds the average outright; blending it against zeros would just cost frames.
  const blend = state.frames === 0 ? 1 : alpha;
  const seedFresh = blend !== 1;

  for (let i = 0; i < ema.length; i += 1) {
    const value = source[i];
    // A pixel a remap brought in from outside has no history to average against, so it is seeded
    // rather than blended up from a zero it was never actually observed to hold.
    ema[i] += (value - ema[i]) * (seedFresh && fresh[i] === 1 ? 1 : blend);
    if (value >= HIT_THRESHOLD && hits[i] < 0xffff) hits[i] += 1;
    if (value >= FAINT_THRESHOLD && faintHits[i] < 0xffff) faintHits[i] += 1;
  }
  if (seedFresh) fresh.fill(0);

  /*
   * Confidence may sag but never crash. It drives the overlay's warm-up sweep, and a single frame
   * where the detector happened to see less would otherwise pull the whole overlay back into its
   * "still warming up" state — the strobing this step exists to remove. Decaying the previous value
   * and taking the larger can only ever hold confidence UP, so a genuine recovery is never masked
   * and a genuine collapse still arrives, just over a few seconds instead of one frame.
   */
  const measured = confidenceOf(ema);

  return {
    ...state,
    frames: state.frames + 1,
    confidence: Math.max(measured, state.confidence * CONFIDENCE_DECAY),
    lastUpdateMs: nowMs,
    lastInferenceMs: mask.inferenceMs ?? state.lastInferenceMs,
  };
}

/** Clears the accumulators in place and returns a fresh state. */
export function resetFusion(state: FusionState): FusionState {
  state.ema.fill(0);
  state.hits.fill(0);
  state.faintHits.fill(0);
  return {
    ...state,
    frames: 0,
    confidence: 0,
    lastUpdateMs: 0,
    lastInferenceMs: 0,
    toCrop: null,
    convention: null,
    warps: 0,
  };
}

export interface ResetReasonInput {
  readonly handPresent: boolean;
  readonly handedness: Handedness | null;
  readonly nowMs: number;
}

/**
 * Whether accumulated evidence still applies. Two reasons only, and movement is not one of them.
 *
 * A **pose change no longer resets**. It used to, on the reasoning that a tilted palm rectifies to
 * different pixels — true, but the conclusion was wrong: those pixels are still the same palm, and
 * `alignFusion` now maps between them. Resetting there was the single largest cause of the overlay
 * blinking out, because the guided sequence changes pose precisely when the user has finally held
 * still long enough to accumulate something worth showing.
 *
 * What does still invalidate: the hand being gone long enough that nothing is being tracked, and the
 * hand being replaced by the other one. The second is not a nicety — the guided sequence explicitly
 * asks for the other hand, and a left palm's creases are not more evidence about a right palm.
 */
export function shouldReset(state: FusionState, input: ResetReasonInput): boolean {
  if (state.frames === 0) return false;
  if (input.handedness !== null && state.handedness !== null && input.handedness !== state.handedness) return true;
  if (!input.handPresent && state.lastHandMs > 0 && input.nowMs - state.lastHandMs > HAND_LOSS_RESET_MS) return true;
  return false;
}

/** Records that a hand was seen this frame, so the loss timer measures detection rather than inference. */
export function markHandSeen(state: FusionState, nowMs: number, handedness: Handedness | null): FusionState {
  return {
    ...state,
    lastHandMs: nowMs,
    handedness: state.handedness ?? handedness,
  };
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
