/**
 * Temporal composite stack — the same skin, seen several times, at its least contaminated.
 *
 * After illumination normalisation a crease is a dark local excursion present in *every* frame the
 * skin is in view. Almost everything that makes a crease disappear from a single frame is a
 * **brightening** event: a specular highlight rolling across oily skin as the hand tilts, defocus,
 * motion blur, a landmark wobble smearing it by a pixel. All of them raise the value at the crease.
 * So a low order statistic across a short window picks, for each pixel independently, the frame in
 * which that pixel was least spoiled — which is exactly the frame in which the crease was best seen.
 *
 * A mean would average the good frames with the washed-out ones and attenuate the crease. A median
 * sits above half the contamination by construction. The low end of the distribution is where the
 * information is.
 *
 * **Not quite the minimum, though.** The brief says MIN, and MIN is implemented and tested — but the
 * default is the *second* smallest of eight, and the reasoning is worth stating because the
 * difference is one array index. A true minimum is a one-of-eight order statistic, so a single
 * contaminated frame determines the output for the whole window: one dark hair, one mis-registered
 * frame, one auto-exposure dip and that pixel is wrong until the frame ages out. The second-smallest
 * needs the artefact in two frames out of eight, which rejects precisely the dominant failure mode.
 * The cost is small and quantifiable: for independent noise of scale σ, the expected minimum of
 * eight sits 1.424σ below the mean and the second 0.852σ, so a crease genuinely present in all eight
 * frames comes out about 0.57σ shallower — under one code value in eight-bit terms.
 *
 * **Alignment is free here.** Slots do not carry their own homographies, because canonical crop
 * space is already common to every frame (see `fusion.ts`): the same skin lands on the same crop
 * pixel however the hand moved. The one thing that does move the crop is a change of anchor
 * convention, and the stack is simply invalidated then rather than resampled — a window that refills
 * in eight frames is not worth the compounding blur of eight bilinear warps to preserve.
 */

/** Frames in the window. Eight at the fusion cadence is roughly a second and a half of evidence. */
export const STACK_DEPTH = 8;
/**
 * Which order statistic to composite with, zero-based. 0 is a true minimum; 1 — the default — is the
 * second smallest, which needs two contaminated frames rather than one to be fooled.
 */
export const COMPOSITE_ORDER = 1;
/**
 * How much the composite contributes against the live frame.
 *
 * The live frame has to keep the majority: it is the only input that describes the palm *now*, and a
 * composite weighted too heavily would let a stale window hold a line in place after the hand has
 * genuinely moved on. At 0.4 the composite deepens creases that the current frame happens to have
 * lost to a highlight without being able to invent one on its own.
 */
export const COMPOSITE_WEIGHT = 0.4;

export interface FrameStack {
  readonly size: number;
  /** Ring of normalised crops, slot-major. Allocated once. */
  readonly slots: Float32Array;
  /** How many slots hold real data, up to {@link STACK_DEPTH}. */
  filled: number;
  /** Next slot to overwrite. */
  cursor: number;
  /** Anchor convention the stored slots were rectified under; a change invalidates them all. */
  convention: number | null;
  /** Scratch for the per-pixel selection, sized to the depth rather than the plane. */
  readonly sample: Float32Array;
  readonly composite: Float32Array;
}

export function emptyStack(size: number): FrameStack {
  return {
    size,
    slots: new Float32Array(size * size * STACK_DEPTH),
    filled: 0,
    cursor: 0,
    convention: null,
    sample: new Float32Array(STACK_DEPTH),
    composite: new Float32Array(size * size),
  };
}

/** Drops every stored frame. Called on a convention change, a lost hand, or the other hand. */
export function resetStack(stack: FrameStack): FrameStack {
  stack.filled = 0;
  stack.cursor = 0;
  stack.convention = null;
  return stack;
}

/**
 * Adds one normalised crop to the ring.
 *
 * @param convention the anchor count this crop was rectified with. A change clears the window: the
 * older slots describe a differently-placed crop, and compositing across that would take the minimum
 * of two different pieces of skin — which manufactures dark structure that was never on the palm.
 * @param bypassed true when illumination normalisation gave up on a too-dark frame. Such a frame is
 * on a different photometric scale, so it must not enter a comparison of values across frames.
 */
export function pushFrame(
  stack: FrameStack,
  normalised: Float32Array,
  convention: number,
  bypassed = false,
): FrameStack {
  const plane = stack.size * stack.size;
  if (normalised.length !== plane || bypassed) return stack;
  if (stack.convention !== null && stack.convention !== convention) resetStack(stack);
  stack.convention = convention;

  stack.slots.set(normalised, stack.cursor * plane);
  stack.cursor = (stack.cursor + 1) % STACK_DEPTH;
  if (stack.filled < STACK_DEPTH) stack.filled += 1;
  return stack;
}

/**
 * Per-pixel low order statistic across the filled slots.
 *
 * Partial selection rather than a full sort: with at most eight values, walking the array `order + 1`
 * times to pull out successive minima beats any general sort and allocates nothing. Below
 * `order + 1` filled slots the statistic is not yet defined, so the composite falls back to the
 * smallest available — which for a single frame is that frame, i.e. the stack contributes nothing
 * until it has something to contribute.
 *
 * @returns null when the stack is empty, so callers can skip the blend entirely.
 */
export function compositeStack(stack: FrameStack, order: number = COMPOSITE_ORDER): Float32Array | null {
  if (stack.filled === 0) return null;
  const plane = stack.size * stack.size;
  const { slots, sample, composite, filled } = stack;
  const wanted = Math.min(order, filled - 1);

  for (let i = 0; i < plane; i += 1) {
    for (let s = 0; s < filled; s += 1) sample[s] = slots[s * plane + i];

    // Selection of the (wanted)-th smallest, in place, over at most eight values.
    for (let pick = 0; pick <= wanted; pick += 1) {
      let best = pick;
      for (let s = pick + 1; s < filled; s += 1) {
        if (sample[s] < sample[best]) best = s;
      }
      if (best !== pick) {
        const swap = sample[pick];
        sample[pick] = sample[best];
        sample[best] = swap;
      }
    }
    composite[i] = sample[wanted];
  }
  return composite;
}

/**
 * Blends the composite into the live frame, in place on `live`.
 *
 * Weighted rather than replacing: the composite is the better *evidence* but the live frame is the
 * only thing that is current, and a detector fed purely on history would keep drawing a line after
 * the palm it belonged to had gone.
 */
export function blendComposite(
  live: Float32Array,
  composite: Float32Array | null,
  weight: number = COMPOSITE_WEIGHT,
): Float32Array {
  if (composite === null) return live;
  for (let i = 0; i < live.length; i += 1) {
    live[i] = live[i] * (1 - weight) + composite[i] * weight;
  }
  return live;
}
