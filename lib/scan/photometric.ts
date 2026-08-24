/**
 * Multi-pose photometric evidence — a crease is a groove, and a groove changes shade when the light does.
 *
 * The guided sequence walks the user through poses that tilt the palm. A crease is a physical valley,
 * so rotating the palm rotates the illumination direction relative to its walls and its shading
 * swings; flat skin, having no walls, does not. Per-pixel **variance** across pose-aligned crops is
 * therefore evidence of a crease that is independent of anything the ridge or vesselness detectors
 * measure — they read one frame's intensity, this reads how intensity *changed*.
 *
 * Being independent is the point: on a frame where the live detectors dip, a photometrically
 * confirmed pixel is still confirmed, because this channel does not depend on the current frame at all.
 *
 * **It is built as a corroborating prior, never a detector**, and three separate constraints enforce
 * that. It is masked to a static eroded palm interior, so it cannot speak about the silhouette, the
 * finger creases or anywhere background shows through — all of which have enormous variance and none
 * of which are palm lines. It is *gated* to pixels near existing ridge evidence, so it can promote a
 * faint crease across a shadow but cannot originate a line. And it is blended additively
 * (`merged + w·photo·(1 − merged)`), so it can only ever raise a probability, never suppress a line
 * that the real detectors already found.
 *
 * **Known limitation, stated rather than hidden.** Rectification fits a *plane* through the palm's
 * rim, and a real palm is cupped, so a tilted pose leaves a residual misalignment of several crop
 * pixels — more than a crease is wide. A per-block displacement search would remove most of it; this
 * implementation corrects the mean displacement globally and absorbs the rest with a deliberate blur
 * wider than the residual. The consequence is that the channel is *weaker* than it could be, not that
 * it is wrong: a ghost from residual misalignment lands as a broad low haze rather than a sharp false
 * line, and the ridge gate then refuses to promote it anyway.
 */
import { ILLUM_PEDESTAL } from "./illumination";
import { RECTIFIED_SIZE } from "./types";

/**
 * Blur applied before differencing, in pixels.
 *
 * Chosen to exceed the residual misalignment rather than to preserve detail: blurring by more than
 * the registration error is what turns a ghost — the same crease seen twice, a few pixels apart —
 * from two sharp false edges into one broad smear that the variance statistic barely notices.
 */
export const PHOTO_BLUR_SIGMA = 2.5;
const PHOTO_BLUR_RADIUS = 6;
/** Half-width of the global translation search, in crop pixels. Covers the derived tilt parallax. */
const ALIGN_RADIUS = 12;
/** Every second pixel is enough to align on: the blur has already removed everything finer. */
const ALIGN_SUBSAMPLE = 2;

/** A variance needs two observations. Beneath this the channel contributes exactly nothing. */
export const PHOTO_MIN_SAMPLES = 2;
/**
 * Tilt span below which the channel earns no weight at all.
 *
 * Equal to `MIN_TILT` in quality.ts — the smallest tilt the gate accepts for a tilt pose, and hence
 * the smallest change of illumination geometry the sequence guarantees. A user who completed the
 * poses without ever actually tilting has given this channel nothing to measure, and it must say so
 * rather than report the variance of their camera's noise.
 */
export const PHOTO_TILT_MIN = 0.25;
/** A left tilt plus a right tilt of the magnitude the sequence asks for — the full illumination sweep. */
export const PHOTO_TILT_FULL = 0.7;
/** The blend ceiling. At this weight a 0.40 field pixel reaches 0.50, just over LINE_THRESHOLD. */
export const PHOTO_MAX_WEIGHT = 0.3;
/**
 * Half-saturation of the variance response. A crease's shading swings appreciably more than skin
 * texture does between extreme tilts; this is where that swing maps to half strength.
 */
export const PHOTO_VAR_HALF = 0.35;
/** Erosion of the palm interior mask, in pixels. Exceeds the pre-alignment misregistration. */
export const PHOTO_MASK_ERODE_PX = 8;
/** Dilation of the ridge gate — the longest gap this channel may bridge, well under the line spacing. */
export const PHOTO_GATE_DILATE = 3;
/** Ridge evidence at which the gate opens fully: above the noise pedestal, far below LINE_THRESHOLD. */
export const PHOTO_GATE_KNEE = 0.15;
/** A local blowout. A moving highlight is the one high-variance artefact the interior mask cannot catch. */
export const PHOTO_SPECULAR_LUMA = 0.94;

/**
 * The palm interior in canonical crop coordinates.
 *
 * Each `CANONICAL_ANCHORS` / `CANONICAL_PERCUSSION` vertex pulled inward, so no pixel whose
 * neighbourhood could have sampled background in any pose is ever inside. Static because canonical
 * space is static — that is the whole benefit of rectifying.
 */
export const PALM_INTERIOR: ReadonlyArray<{ readonly x: number; readonly y: number }> = [
  { x: 0.26, y: 0.16 },
  { x: 0.83, y: 0.26 },
  { x: 0.92, y: 0.34 },
  { x: 0.88, y: 0.6 },
  { x: 0.62, y: 0.9 },
  { x: 0.4, y: 0.92 },
  { x: 0.17, y: 0.72 },
  { x: 0.22, y: 0.34 },
];

export interface PhotometricState {
  readonly size: number;
  /** The first pose's blurred crop, which every later pose is aligned and compared against. */
  readonly reference: Float32Array;
  /** Welford accumulators over the aligned, high-passed samples. */
  readonly mean: Float32Array;
  readonly m2: Float32Array;
  readonly count: Uint16Array;
  /** The published 0–1 channel. */
  readonly field: Float32Array;
  /** Interior mask, built once. */
  readonly interior: Uint8Array;
  readonly scratch: Float32Array;
  readonly scratchB: Float32Array;
  samples: number;
  /** Smallest and largest signed tilt seen, which is what the channel's weight is earned from. */
  minTilt: number;
  maxTilt: number;
}

/** Even-odd point-in-polygon over the canonical interior, then an erosion by a square of the given radius. */
function buildInterior(size: number): Uint8Array {
  const raw = new Uint8Array(size * size);
  const n = PALM_INTERIOR.length;
  for (let y = 0; y < size; y += 1) {
    const py = (y + 0.5) / size;
    for (let x = 0; x < size; x += 1) {
      const px = (x + 0.5) / size;
      let inside = false;
      for (let i = 0, j = n - 1; i < n; j = i, i += 1) {
        const a = PALM_INTERIOR[i];
        const b = PALM_INTERIOR[j];
        if (a.y > py !== b.y > py && px < ((b.x - a.x) * (py - a.y)) / (b.y - a.y) + a.x) inside = !inside;
      }
      if (inside) raw[y * size + x] = 1;
    }
  }

  const eroded = new Uint8Array(size * size);
  const r = PHOTO_MASK_ERODE_PX;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      if (x < r || y < r || x >= size - r || y >= size - r) continue;
      let all = 1;
      for (let dy = -r; dy <= r && all === 1; dy += 1) {
        for (let dx = -r; dx <= r; dx += 1) {
          if (raw[(y + dy) * size + x + dx] === 0) {
            all = 0;
            break;
          }
        }
      }
      eroded[y * size + x] = all;
    }
  }
  return eroded;
}

export function emptyPhotometric(size: number = RECTIFIED_SIZE): PhotometricState {
  const plane = size * size;
  return {
    size,
    reference: new Float32Array(plane),
    mean: new Float32Array(plane),
    m2: new Float32Array(plane),
    count: new Uint16Array(plane),
    field: new Float32Array(plane),
    interior: buildInterior(size),
    scratch: new Float32Array(plane),
    scratchB: new Float32Array(plane),
    samples: 0,
    minTilt: 0,
    maxTilt: 0,
  };
}

export function resetPhotometric(state: PhotometricState): PhotometricState {
  state.mean.fill(0);
  state.m2.fill(0);
  state.count.fill(0);
  state.field.fill(0);
  state.reference.fill(0);
  state.samples = 0;
  state.minTilt = 0;
  state.maxTilt = 0;
  return state;
}

/** Separable Gaussian blur, replicate borders. Small radius, so a direct convolution is fine. */
function blur(src: Float32Array, dst: Float32Array, tmp: Float32Array, size: number): void {
  const r = PHOTO_BLUR_RADIUS;
  const kernel = new Float32Array(2 * r + 1);
  let sum = 0;
  for (let t = -r; t <= r; t += 1) {
    kernel[t + r] = Math.exp(-(t * t) / (2 * PHOTO_BLUR_SIGMA * PHOTO_BLUR_SIGMA));
    sum += kernel[t + r];
  }
  for (let i = 0; i < kernel.length; i += 1) kernel[i] /= sum;

  const last = size - 1;
  for (let y = 0; y < size; y += 1) {
    const base = y * size;
    for (let x = 0; x < size; x += 1) {
      let acc = 0;
      for (let t = -r; t <= r; t += 1) {
        const xx = x + t < 0 ? 0 : x + t > last ? last : x + t;
        acc += src[base + xx] * kernel[t + r];
      }
      tmp[base + x] = acc;
    }
  }
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let acc = 0;
      for (let t = -r; t <= r; t += 1) {
        const yy = y + t < 0 ? 0 : y + t > last ? last : y + t;
        acc += tmp[yy * size + x] * kernel[t + r];
      }
      dst[y * size + x] = acc;
    }
  }
}

/**
 * Best integer translation of `sample` onto `reference`, by sum of absolute differences.
 *
 * A global translation, not a displacement field: it removes the *mean* parallax a tilt introduces,
 * which is the largest single component. See the limitation note at the top of this file.
 */
function bestShift(
  reference: Float32Array,
  sample: Float32Array,
  interior: Uint8Array,
  size: number,
): { dx: number; dy: number } {
  let bestDx = 0;
  let bestDy = 0;
  let bestCost = Infinity;
  for (let dy = -ALIGN_RADIUS; dy <= ALIGN_RADIUS; dy += 1) {
    for (let dx = -ALIGN_RADIUS; dx <= ALIGN_RADIUS; dx += 1) {
      let cost = 0;
      let taps = 0;
      for (let y = ALIGN_RADIUS; y < size - ALIGN_RADIUS; y += ALIGN_SUBSAMPLE) {
        for (let x = ALIGN_RADIUS; x < size - ALIGN_RADIUS; x += ALIGN_SUBSAMPLE) {
          const at = y * size + x;
          if (interior[at] === 0) continue;
          cost += Math.abs(reference[at] - sample[(y + dy) * size + x + dx]);
          taps += 1;
        }
      }
      if (taps === 0) continue;
      const mean = cost / taps;
      if (mean < bestCost) {
        bestCost = mean;
        bestDx = dx;
        bestDy = dy;
      }
    }
  }
  return { dx: bestDx, dy: bestDy };
}

/**
 * Folds one captured pose into the accumulator.
 *
 * The first sample becomes the reference and contributes no variance — with one observation there is
 * nothing to compare. Later samples are aligned to it, high-passed by subtracting the reference (so
 * what remains is *how the shading changed*, not what the palm looks like), and folded in by Welford.
 *
 * Welford with the Bessel denominator rather than a two-pass computation, because the scale of the
 * result must not shift as poses accumulate: the blend weight is a fixed ceiling, and an estimator
 * whose magnitude drifted with sample count would mean something different at pose two and pose five.
 *
 * @param tilt the signed palm tilt of the pose this crop came from. The channel's weight is earned
 * from the *span* of these, so a user who never tilted gets a weight of zero.
 * @param normalised an illumination-normalised crop. A raw crop would make this measure exposure.
 */
export function addPose(
  state: PhotometricState,
  normalised: Float32Array,
  tilt: number,
): PhotometricState {
  const { size, scratch, scratchB, interior, reference, mean, m2, count } = state;
  if (normalised.length !== size * size) return state;

  blur(normalised, scratch, scratchB, size);

  if (state.samples === 0) {
    reference.set(scratch);
    state.samples = 1;
    state.minTilt = tilt;
    state.maxTilt = tilt;
    return state;
  }

  const { dx, dy } = bestShift(reference, scratch, interior, size);
  state.minTilt = Math.min(state.minTilt, tilt);
  state.maxTilt = Math.max(state.maxTilt, tilt);

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const at = y * size + x;
      if (interior[at] === 0) continue;
      const sy = y + dy;
      const sx = x + dx;
      if (sx < 0 || sy < 0 || sx >= size || sy >= size) continue;
      const value = scratch[sy * size + sx];
      // A local blowout is not a shading change, it is a lost measurement.
      if (value > PHOTO_SPECULAR_LUMA) continue;

      // High-pass against the reference: what is left is the CHANGE, not the palm.
      const delta = value - reference[at];
      const n = count[at] + 1;
      count[at] = n;
      const d = delta - mean[at];
      mean[at] += d / n;
      m2[at] += d * (delta - mean[at]);
    }
  }
  state.samples += 1;
  return state;
}

/**
 * How much this channel has earned, 0–1.
 *
 * Driven by the observed tilt *span*, not the number of poses captured. Five poses held perfectly
 * flat produce no illumination change and therefore no evidence, however diligently they were
 * captured — reporting a weight for them would be reporting the camera's noise as anatomy.
 */
export function photometricWeight(state: PhotometricState): number {
  if (state.samples < PHOTO_MIN_SAMPLES) return 0;
  const span = state.maxTilt - state.minTilt;
  if (span <= PHOTO_TILT_MIN) return 0;
  const ramp = Math.min(1, (span - PHOTO_TILT_MIN) / (PHOTO_TILT_FULL - PHOTO_TILT_MIN));
  return ramp * PHOTO_MAX_WEIGHT;
}

/**
 * Publishes the 0–1 variance channel.
 *
 * The pedestal — the variance flat skin produces from sensor noise and residual misregistration — is
 * subtracted before saturation, so the channel reports how much *more* a pixel varied than its
 * neighbours rather than how much it varied in absolute terms, which would be a measure of the
 * camera as much as the palm.
 */
export function photometricField(state: PhotometricState): Float32Array {
  const { size, m2, count, field, interior } = state;
  field.fill(0);
  if (state.samples < PHOTO_MIN_SAMPLES) return field;

  const plane = size * size;
  const variances: number[] = [];
  for (let i = 0; i < plane; i += 1) {
    if (interior[i] === 0 || count[i] < 2) continue;
    variances.push(m2[i] / (count[i] - 1));
  }
  if (variances.length === 0) return field;
  variances.sort((a, b) => a - b);
  const pedestal = variances[Math.floor(variances.length * 0.5)];

  for (let i = 0; i < plane; i += 1) {
    if (interior[i] === 0 || count[i] < 2) continue;
    const excess = m2[i] / (count[i] - 1) - pedestal;
    if (excess <= 0) continue;
    // Saturating rather than linear: past a point, more variance is not more confidence.
    field[i] = excess / (excess + PHOTO_VAR_HALF);
  }
  return field;
}

/**
 * Blends the channel into a merged probability field, in place.
 *
 * Two safeguards, both structural rather than tuned. The **gate**: a pixel is only boosted in
 * proportion to how much ridge evidence already sits within a few pixels of it, so the channel
 * promotes a faint crease across a shadow and cannot originate a line in bare skin. The **form**:
 * `merged + w·photo·(1 − merged)` only ever adds, and adds least where the field is already
 * confident — so this channel can never take away a line the real detectors found.
 */
export function applyPhotometric(
  merged: Float32Array,
  photo: Float32Array,
  ridge: Float32Array,
  size: number,
  weight: number,
): Float32Array {
  if (weight <= 0) return merged;
  const r = PHOTO_GATE_DILATE;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const at = y * size + x;
      const value = photo[at];
      if (value <= 0) continue;

      // Strongest ridge evidence within the gate window: how much company this pixel keeps.
      let support = 0;
      const y0 = Math.max(0, y - r);
      const y1 = Math.min(size - 1, y + r);
      const x0 = Math.max(0, x - r);
      const x1 = Math.min(size - 1, x + r);
      for (let yy = y0; yy <= y1; yy += 1) {
        for (let xx = x0; xx <= x1; xx += 1) {
          const v = ridge[yy * size + xx];
          if (v > support) support = v;
        }
      }
      const gate = Math.min(1, support / PHOTO_GATE_KNEE);
      if (gate <= 0) continue;
      merged[at] += weight * value * gate * (1 - merged[at]);
    }
  }
  return merged;
}

/** Re-exported so callers can see what a flat-skin pixel normalises to without importing illumination. */
export { ILLUM_PEDESTAL };
