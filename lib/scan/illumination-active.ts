/**
 * Active illumination: screen-as-flash, and exposure bracketing.
 *
 * Both of these attack the same limit from different sides. A single exposure of a palm records one
 * number per pixel, and a crease is only distinguishable from a smudge, a shadow or a skin-tone
 * variation by how it *behaves* — a groove has walls, so its shading changes when the light moves,
 * and it holds detail at exposures where flat skin has clipped. Neither fact is available from one
 * frame however good that frame is.
 *
 * **Photometric stereo, cheaply.** Lighting the screen white in one quadrant at a time moves the
 * dominant light source by a few centimetres between frames. That is a small baseline — far smaller
 * than a photometric-stereo rig — so this does not attempt to recover surface normals. It measures
 * the two things a small baseline does support: how much a pixel's value *ranged* across the
 * sequence, and whether the direction of its change was *consistent* with a groove rather than with
 * noise. A crease scores on both; a printed mark or a stain scores on neither.
 *
 * **Bracketing.** Three exposures merged by picking, per pixel, the frame where that pixel is
 * furthest from both clipping and the noise floor. On a palm this matters at the fingers, which blow
 * out several stops before the heel does.
 *
 * All of it is pure array maths, so the claim "this improves crease contrast" is measured rather
 * than asserted. Everything here runs only behind a flag — see `flags.ts`.
 */

/** Quadrant order for the flash sequence: the four corners of the screen, clockwise from top-left. */
export const FLASH_QUADRANTS = ["tl", "tr", "br", "bl"] as const;
export type FlashQuadrant = (typeof FLASH_QUADRANTS)[number];

/** How long each quadrant stays lit. Long enough for one camera frame at 30fps plus panel latency. */
export const FLASH_DWELL_MS = 180;
/**
 * Weight the photometric channel carries into the merged field, and only for the window it was
 * captured in. Half: it is genuinely independent evidence, which is worth a lot, but it is captured
 * over ~0.7s during which the hand moved somewhat, so it is not worth more than the live detectors.
 */
export const PHOTOMETRIC_WEIGHT = 0.5;
/**
 * Range below which a pixel's variation across the sequence is sensor noise.
 *
 * About two code values out of 255. Below this the "direction of change" is undefined and the
 * consistency term would be scoring randomness.
 */
export const MIN_RANGE = 0.008;

export interface FlashFrame {
  readonly quadrant: FlashQuadrant;
  /** Luma, 0–1, in canonical crop space — already rectified, so the frames are mutually aligned. */
  readonly luma: Float32Array;
}

export interface PhotometricResult {
  /** 0–1 evidence field: high where the surface behaved like a groove under moving light. */
  readonly field: Float32Array;
  /** Mean range across the sequence — how much the light actually moved anything. Diagnostic. */
  readonly meanRange: number;
  /** Frames that contributed. Below two the result is all zeros and the caller must not use it. */
  readonly frames: number;
}

/**
 * Per-pixel range and gradient consistency across the flash sequence.
 *
 * The **range** term (max − min) is the raw signal: a groove's walls face different directions, so
 * one of them is lit and the other shadowed in every quadrant, and which is which swaps as the light
 * crosses. Flat skin changes by the overall falloff only.
 *
 * The **consistency** term is what stops the range term from scoring every moving shadow and every
 * pixel the hand wobbled across. A real groove's brightest and darkest quadrants are *opposite* each
 * other — lit from the left, the left wall is bright and the right dark; lit from the right, they
 * swap. A pixel whose extremes are adjacent quadrants is responding to something other than relief.
 * With four quadrants the test is cheap: are the argmax and argmin two apart in the cycle?
 *
 * @returns an all-zero field for fewer than two frames, so a cancelled sequence contributes nothing.
 */
export function photometricEvidence(frames: readonly FlashFrame[], size: number): PhotometricResult {
  const plane = size * size;
  const field = new Float32Array(plane);
  if (frames.length < 2 || frames.some((frame) => frame.luma.length !== plane)) {
    return { field, meanRange: 0, frames: frames.length };
  }

  const count = frames.length;
  const order = frames.map((frame) => FLASH_QUADRANTS.indexOf(frame.quadrant));
  let rangeSum = 0;

  for (let i = 0; i < plane; i += 1) {
    let min = Infinity;
    let max = -Infinity;
    let argMin = 0;
    let argMax = 0;
    for (let f = 0; f < count; f += 1) {
      const value = frames[f].luma[i];
      if (value < min) {
        min = value;
        argMin = f;
      }
      if (value > max) {
        max = value;
        argMax = f;
      }
    }
    const range = max - min;
    rangeSum += range;
    if (range < MIN_RANGE) continue;

    /*
     * Opposite quadrants score 1, adjacent score 0.5, same scores 0. With four positions the cycle
     * distance is 0, 1 or 2 — so this is a three-valued test, not a continuous one, and pretending
     * otherwise would be inventing precision the geometry does not have.
     */
    const separation = Math.abs(order[argMax] - order[argMin]);
    const cyclic = Math.min(separation, FLASH_QUADRANTS.length - separation);
    const consistency = cyclic / (FLASH_QUADRANTS.length / 2);

    // Saturating in range so a specular flare does not outscore every real crease in the crop.
    field[i] = Math.min(1, range / (range + 0.05)) * consistency;
  }

  return { field, meanRange: rangeSum / plane, frames: count };
}

/**
 * Blends the photometric channel into a merged probability field, in place.
 *
 * Additive and gated exactly as the multi-pose channel is: it may only ever RAISE a probability, and
 * only in proportion to how much the real detectors already saw nearby. A channel captured over most
 * of a second, during which the hand moved, has no business originating a line on its own — it is
 * corroboration, and the form of the blend is what enforces that rather than a promise in a comment.
 */
export function applyPhotometricEvidence(
  merged: Float32Array,
  photometric: Float32Array,
  detector: Float32Array,
  weight: number = PHOTOMETRIC_WEIGHT,
): Float32Array {
  if (weight <= 0 || photometric.length !== merged.length) return merged;
  for (let i = 0; i < merged.length; i += 1) {
    const value = photometric[i];
    if (value <= 0) continue;
    // Gate on the detector's own belief at this pixel: no support, no boost.
    const support = Math.min(1, detector[i] / 0.15);
    if (support <= 0) continue;
    merged[i] += weight * value * support * (1 - merged[i]);
  }
  return merged;
}

/* --------------------------------- HDR ------------------------------------- */

/**
 * Exposure-bracket merge: per pixel, take the frame that recorded it best.
 *
 * "Best" is furthest from both ends of the range, because both ends destroy information — a clipped
 * pixel has lost how much brighter than white it was, a crushed one has lost the crease inside the
 * shadow. A weighted average across frames would be the textbook answer, but it needs the frames to
 * be radiometrically related by known exposure ratios, and `exposureCompensation` reports a bias in
 * units the browser does not promise to make linear. Choosing per pixel needs no such promise.
 *
 * @param frames luma planes in canonical crop space, ordered dark to bright. Fewer than two returns
 * the first unchanged, which is the honest answer when there was no bracket.
 */
export function mergeBracket(frames: readonly Float32Array[], size: number): Float32Array {
  const plane = size * size;
  const out = new Float32Array(plane);
  if (frames.length === 0) return out;
  if (frames.length === 1 || frames.some((frame) => frame.length !== plane)) {
    out.set(frames[0].subarray(0, plane));
    return out;
  }

  for (let i = 0; i < plane; i += 1) {
    let best = frames[0][i];
    let bestScore = -1;
    for (let f = 0; f < frames.length; f += 1) {
      const value = frames[f][i];
      // Triangular weight peaking at mid-grey: 0 at both extremes, 1 at 0.5.
      const score = 1 - Math.abs(value - 0.5) * 2;
      if (score > bestScore) {
        bestScore = score;
        best = value;
      }
    }
    out[i] = best;
  }
  return out;
}

/** Exposure biases for the bracket, dark to bright, relative to the settled control bias. */
export const BRACKET_OFFSETS: readonly number[] = [-0.5, 0, 0.5];
