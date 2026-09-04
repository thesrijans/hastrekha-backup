/**
 * Classical ridge (crease) detection on the rectified palm crop.
 *
 * Three stages, each classical and parameter-light:
 *
 *  1. **CLAHE** — contrast-limited adaptive histogram equalisation over an 8×8 tile grid, so a
 *     dim palm and a blown-out palm both arrive at the next stage with comparable local contrast.
 *  2. **Black-hat** — morphological closing minus the input, with disc structuring elements of
 *     diameter 5/9/13 px, max across scales. Closing fills dark gaps narrower than the disc, so the
 *     difference lifts exactly the dark creases and nothing else: a *bright* line produces zero.
 *  3. **Oriented Gabor bank** — 8 orientations × 2 scales of zero-mean, even-symmetric Gabor
 *     kernels; per-pixel max response. This turns "dark and thin" into "dark, thin and *elongated*",
 *     which is what separates a crease from a pore or a shadow blob. A closed-form steered
 *     alternative was built and measured against it in STEP 15 and did not replace it; the
 *     side-by-side is on {@link gaborBank}.
 *
 * The result is normalised to a 0–1 ridge probability. Pure typed-array maths with no dependencies
 * and no DOM, so all of it runs in the worker and unit-tests in node.
 *
 * This is the zero-ML path: when the UNet model file is absent, this field alone drives the
 * pipeline (see `combineProbabilities` in segmenter.ts).
 *
 * Performance notes, because this runs on mid-range phones:
 *  - the disc morphology is decomposed into per-row chord maxima instead of a naive 2-D kernel;
 *  - the Gabor bank is evaluated **sparsely**: black-hat output is near-zero almost everywhere on a
 *    palm, so convolution is skipped outside a dilated support mask of `blackhat > SUPPORT_FLOOR`.
 *    Outside that mask every kernel tap sees ≈ 0, so the skipped response is ≈ 0 by construction.
 */

/* --------------------------------- Tunables -------------------------------- */

export const CLAHE_TILES = 8;
export const CLAHE_CLIP_FACTOR = 2.5;
const CLAHE_BINS = 256;

/** Disc radii for the black-hat scales — diameters 5, 9 and 13 px. */
export const BLACKHAT_RADII: readonly number[] = [2, 4, 6];

export const GABOR_ORIENTATIONS = 8;
/** Two scales: fine (~2 px creases) and coarse (~4 px folds). */
export const GABOR_SCALES: ReadonlyArray<{ readonly size: number; readonly sigma: number; readonly lambda: number }> = [
  { size: 7, sigma: 1.6, lambda: 4 },
  { size: 11, sigma: 2.8, lambda: 7 },
];
/** Envelope aspect: < 1 elongates the kernel along the bar it is looking for. */
const GABOR_GAMMA = 0.5;

/** Black-hat level below which a pixel carries no crease evidence and Gabor is skipped there. */
const SUPPORT_FLOOR = 0.02;
/**
 * Support dilation half-width. The Gabor kernels read a SQUARE neighbourhood (Chebyshev reach =
 * half the kernel size), so the support must be dilated with a square of at least that half-width —
 * a Euclidean disc of the same radius misses the square's corners: with a radius-6 disc, evidence
 * sitting at offsets like (±5,±5) from a pixel was outside the disc but inside the 11×11 kernel,
 * and that pixel's genuine response was wrongly zeroed. Adversarial review reproduced this
 * empirically; the square dilation makes sparse-vs-dense agreement exact.
 */
const SUPPORT_DILATE_HALF = 5;

/** Responses are scaled by this percentile of the positive responses… */
const NORM_PERCENTILE = 0.99;
/** …but never by less than this, so an empty palm does not have its noise amplified to full scale. */
const NORM_FLOOR = 0.05;

/* ---------------------------------- Types ---------------------------------- */

export interface RidgeTimings {
  readonly claheMs: number;
  readonly blackhatMs: number;
  readonly gaborMs: number;
  readonly totalMs: number;
  /** Cost of the optional pre-CLAHE raw-depth pass (H9 contract). Absent when not requested. */
  readonly contractMs?: number;
}

export interface RidgeResult {
  /** 0–1 ridge probability, row-major, size×size. A fresh buffer on every call. */
  readonly probability: Float32Array;
  readonly timings: RidgeTimings;
}

/**
 * Optional out-param for the field contract (H9): when passed to {@link detectRidges}, `depth` is
 * filled with a black-hat response computed on the PRE-CLAHE input — raw luma units, the one
 * plane whose absolute scale CLAHE has not equalised away. Requested only under the contract
 * flags; when absent, detectRidges is byte-identical in behaviour and output.
 */
export interface RawDepthOut {
  readonly depth: Float32Array;
}

const now = (): number => performance.now();

/* -------------------------------- Grayscale -------------------------------- */

/** RGBA bytes → 0–1 luma. Works on the raw buffer so the worker never needs an ImageData. */
export function grayFromRgba(rgba: Uint8ClampedArray | Uint8Array, width: number, height: number): Float32Array {
  const out = new Float32Array(width * height);
  for (let i = 0; i < out.length; i += 1) {
    const at = i * 4;
    out[i] = (0.2126 * rgba[at] + 0.7152 * rgba[at + 1] + 0.0722 * rgba[at + 2]) / 255;
  }
  return out;
}

/* ---------------------------------- CLAHE ----------------------------------- */

/**
 * Contrast-limited adaptive histogram equalisation.
 *
 * Per tile: clipped histogram → CDF → intensity mapping. Per pixel: bilinear interpolation between
 * the four surrounding tile mappings, which is what removes the block seams plain AHE produces.
 * The clip limit is what stops a near-flat tile from amplifying its noise to full contrast.
 */
export function clahe(
  gray: Float32Array,
  size: number,
  tiles: number = CLAHE_TILES,
  clipFactor: number = CLAHE_CLIP_FACTOR,
): Float32Array {
  const tileSize = size / tiles;
  const maps = new Float32Array(tiles * tiles * CLAHE_BINS);
  const histogram = new Uint32Array(CLAHE_BINS);

  for (let ty = 0; ty < tiles; ty += 1) {
    const y0 = Math.floor(ty * tileSize);
    const y1 = ty === tiles - 1 ? size : Math.floor((ty + 1) * tileSize);
    for (let tx = 0; tx < tiles; tx += 1) {
      const x0 = Math.floor(tx * tileSize);
      const x1 = tx === tiles - 1 ? size : Math.floor((tx + 1) * tileSize);
      const tilePixels = (y1 - y0) * (x1 - x0);

      histogram.fill(0);
      for (let y = y0; y < y1; y += 1) {
        for (let x = x0; x < x1; x += 1) {
          const bin = Math.min(CLAHE_BINS - 1, Math.max(0, (gray[y * size + x] * CLAHE_BINS) | 0));
          histogram[bin] += 1;
        }
      }

      // Clip and redistribute the excess evenly — the "contrast-limited" part.
      const clipLimit = Math.max(1, Math.floor((clipFactor * tilePixels) / CLAHE_BINS));
      let excess = 0;
      for (let bin = 0; bin < CLAHE_BINS; bin += 1) {
        if (histogram[bin] > clipLimit) {
          excess += histogram[bin] - clipLimit;
          histogram[bin] = clipLimit;
        }
      }
      const share = excess / CLAHE_BINS;
      // CDF and mapping in one pass. cdfMin anchors the darkest occupied bin at 0.
      let cdf = 0;
      let cdfMin = -1;
      const base = (ty * tiles + tx) * CLAHE_BINS;
      for (let bin = 0; bin < CLAHE_BINS; bin += 1) {
        cdf += histogram[bin] + share;
        if (cdfMin < 0 && histogram[bin] > 0) cdfMin = cdf;
        maps[base + bin] = cdf;
      }
      if (cdfMin < 0) cdfMin = 0;
      // The cdf already contains the redistributed excess (it accumulates histogram + share), so
      // the total mass is exactly tilePixels — adding excess again would compress the output range.
      const denominator = Math.max(1e-6, tilePixels - cdfMin);
      for (let bin = 0; bin < CLAHE_BINS; bin += 1) {
        maps[base + bin] = Math.min(1, Math.max(0, (maps[base + bin] - cdfMin) / denominator));
      }
    }
  }

  const out = new Float32Array(size * size);
  const last = tiles - 1;
  for (let y = 0; y < size; y += 1) {
    // Position among tile *centres*, clamped to the border tiles.
    const gy = Math.min(last, Math.max(0, (y + 0.5) / tileSize - 0.5));
    const ty0 = Math.floor(gy);
    const ty1 = Math.min(last, ty0 + 1);
    const fy = gy - ty0;
    for (let x = 0; x < size; x += 1) {
      const gx = Math.min(last, Math.max(0, (x + 0.5) / tileSize - 0.5));
      const tx0 = Math.floor(gx);
      const tx1 = Math.min(last, tx0 + 1);
      const fx = gx - tx0;

      const bin = Math.min(CLAHE_BINS - 1, Math.max(0, (gray[y * size + x] * CLAHE_BINS) | 0));
      const m00 = maps[(ty0 * tiles + tx0) * CLAHE_BINS + bin];
      const m10 = maps[(ty0 * tiles + tx1) * CLAHE_BINS + bin];
      const m01 = maps[(ty1 * tiles + tx0) * CLAHE_BINS + bin];
      const m11 = maps[(ty1 * tiles + tx1) * CLAHE_BINS + bin];
      const top = m00 + (m10 - m00) * fx;
      const bottom = m01 + (m11 - m01) * fx;
      out[y * size + x] = top + (bottom - top) * fy;
    }
  }
  return out;
}

/* ------------------------------- Morphology --------------------------------- */

/** Horizontal running extreme with replicate borders. halfwidth 0 returns a copy. */
function horizontalExtreme(src: Float32Array, size: number, halfwidth: number, isMax: boolean): Float32Array {
  const out = new Float32Array(src.length);
  if (halfwidth === 0) {
    out.set(src);
    return out;
  }
  for (let y = 0; y < size; y += 1) {
    const row = y * size;
    for (let x = 0; x < size; x += 1) {
      const from = Math.max(0, x - halfwidth);
      const to = Math.min(size - 1, x + halfwidth);
      let extreme = src[row + from];
      for (let k = from + 1; k <= to; k += 1) {
        const value = src[row + k];
        if (isMax ? value > extreme : value < extreme) extreme = value;
      }
      out[row + x] = extreme;
    }
  }
  return out;
}

/**
 * Grayscale dilation/erosion by a disc, decomposed into per-row chords.
 *
 * A disc of radius r is the union of horizontal segments whose halfwidth varies with the row
 * offset: hw(dy) = ⌊√(r²−dy²)⌋. Dilation by the disc is then the vertical max over dy of rows
 * horizontally dilated by hw(dy) — O(size²·r) instead of O(size²·r²) for the naive kernel.
 */
export function discExtreme(src: Float32Array, size: number, radius: number, isMax: boolean): Float32Array {
  const halfwidths: number[] = [];
  for (let dy = -radius; dy <= radius; dy += 1) {
    halfwidths.push(Math.floor(Math.sqrt(radius * radius - dy * dy)));
  }
  const rows = new Map<number, Float32Array>();
  for (const hw of new Set(halfwidths)) rows.set(hw, horizontalExtreme(src, size, hw, isMax));

  const out = new Float32Array(src.length);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let extreme = isMax ? -Infinity : Infinity;
      for (let d = 0; d < halfwidths.length; d += 1) {
        const yy = Math.min(size - 1, Math.max(0, y + d - radius));
        const value = rows.get(halfwidths[d])![yy * size + x];
        if (isMax ? value > extreme : value < extreme) extreme = value;
      }
      out[y * size + x] = extreme;
    }
  }
  return out;
}

/** Grayscale dilation/erosion by a SQUARE of half-width `half` — separable: rows, then columns. */
export function squareExtreme(src: Float32Array, size: number, half: number, isMax: boolean): Float32Array {
  const rows = horizontalExtreme(src, size, half, isMax);
  const out = new Float32Array(src.length);
  for (let x = 0; x < size; x += 1) {
    for (let y = 0; y < size; y += 1) {
      const from = Math.max(0, y - half);
      const to = Math.min(size - 1, y + half);
      let extreme = rows[from * size + x];
      for (let k = from + 1; k <= to; k += 1) {
        const value = rows[k * size + x];
        if (isMax ? value > extreme : value < extreme) extreme = value;
      }
      out[y * size + x] = extreme;
    }
  }
  return out;
}

/** Morphological closing: dilate, then erode, same disc. Extensive — closing(f) ≥ f everywhere. */
export function discClose(src: Float32Array, size: number, radius: number): Float32Array {
  return discExtreme(discExtreme(src, size, radius, true), size, radius, false);
}

/** Black-hat at one scale: what closing had to add to fill the dark creases. Always ≥ 0. */
export function blackHat(src: Float32Array, size: number, radius: number): Float32Array {
  const closed = discClose(src, size, radius);
  const out = new Float32Array(src.length);
  for (let i = 0; i < src.length; i += 1) out[i] = Math.max(0, closed[i] - src[i]);
  return out;
}

/** Per-pixel max of black-hat across the three scales — thin and broad creases both survive. */
export function blackHatMulti(src: Float32Array, size: number, radii: readonly number[] = BLACKHAT_RADII): Float32Array {
  const out = new Float32Array(src.length);
  for (const radius of radii) {
    const single = blackHat(src, size, radius);
    for (let i = 0; i < out.length; i += 1) {
      if (single[i] > out[i]) out[i] = single[i];
    }
  }
  return out;
}

/* --------------------------------- Gabor ------------------------------------ */

interface GaborKernel {
  readonly size: number;
  readonly taps: Float32Array;
}

/** Built once per worker; 16 small kernels, zero-mean and L2-normalised so scales are comparable. */
let kernelCache: GaborKernel[] | null = null;

function buildKernels(): GaborKernel[] {
  const kernels: GaborKernel[] = [];
  for (const scale of GABOR_SCALES) {
    const half = (scale.size - 1) / 2;
    for (let o = 0; o < GABOR_ORIENTATIONS; o += 1) {
      const theta = (o * Math.PI) / GABOR_ORIENTATIONS;
      const cos = Math.cos(theta);
      const sin = Math.sin(theta);
      const taps = new Float32Array(scale.size * scale.size);
      let mean = 0;
      for (let dy = -half; dy <= half; dy += 1) {
        for (let dx = -half; dx <= half; dx += 1) {
          const xr = dx * cos + dy * sin;
          const yr = -dx * sin + dy * cos;
          const envelope = Math.exp(-(xr * xr + GABOR_GAMMA * GABOR_GAMMA * yr * yr) / (2 * scale.sigma * scale.sigma));
          const value = envelope * Math.cos((2 * Math.PI * xr) / scale.lambda);
          taps[(dy + half) * scale.size + (dx + half)] = value;
          mean += value;
        }
      }
      mean /= taps.length;
      let norm = 0;
      for (let i = 0; i < taps.length; i += 1) {
        taps[i] -= mean; // zero-DC: a flat region must respond exactly 0
        norm += taps[i] * taps[i];
      }
      norm = Math.sqrt(norm);
      if (norm > 1e-12) {
        for (let i = 0; i < taps.length; i += 1) taps[i] /= norm;
      }
      kernels.push({ size: scale.size, taps });
    }
  }
  return kernels;
}

export function gaborKernels(): readonly GaborKernel[] {
  if (kernelCache === null) kernelCache = buildKernels();
  return kernelCache;
}

/**
 * Support mask for sparse Gabor evaluation: pixels within kernel reach of any crease evidence.
 * Reuses the disc dilation on a 0/1 field.
 */
export function buildSupport(blackhatField: Float32Array, size: number): Uint8Array {
  const binary = new Float32Array(blackhatField.length);
  for (let i = 0; i < binary.length; i += 1) binary[i] = blackhatField[i] > SUPPORT_FLOOR ? 1 : 0;
  // Square dilation, matching the kernels' square footprint exactly — see SUPPORT_DILATE_HALF.
  const dilated = squareExtreme(binary, size, SUPPORT_DILATE_HALF, true);
  const out = new Uint8Array(blackhatField.length);
  for (let i = 0; i < out.length; i += 1) out[i] = dilated[i] > 0.5 ? 1 : 0;
  return out;
}

/**
 * Per-pixel maximum response over the kernel bank, negatives clamped (we only want bright bars — the black-hat stage
 * already made creases bright). Replicate borders.
 *
 * With `support`, pixels outside the mask are skipped and left at 0; outside the mask every tap
 * sees ≈ 0 input, so the skipped value is what the convolution would have produced anyway.
 *
 * **Why this is still here after STEP 15.** {@link detectVessels}' `bars` output computes the same
 * per-orientation maximum in closed form — continuously rather than at sixteen 22.5° samples, from
 * derivatives Frangi already had in hand — for 8.4ms against this function's 41.2ms on a 128² crop.
 * It was wired in and measured on both ground-truth frames, and it did not win. Sweeping its
 * normalisation percentile to trace out an operating curve, at the point where precision against the
 * hand-traced creases is *identical* to this bank's:
 *
 * ```text
 *                bank              steered, matched precision
 *   current-02   P 28.1  R 32.0    P 28.1  R 38.2     better
 *   tilt-03      P 10.7  R 12.1    P 10.7  R  7.0     worse
 * ```
 *
 * Better on the bright frame, worse on the tilted one, and end-to-end it took tilt-03 from three
 * accepted lines to one. The configurations that looked like wins raised recall and litter together
 * — a gain change, not a better detector. So the bank stays, the steered response stays available
 * and unwired, and neither is the reason head-line recall is where it is. See §3 of
 * docs/DETECTOR_AUDIT.md.
 */
export function gaborBank(src: Float32Array, size: number, support: Uint8Array | null = null): Float32Array {
  const kernels = gaborKernels();
  const out = new Float32Array(src.length);

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const index = y * size + x;
      if (support !== null && support[index] === 0) continue;

      let best = 0;
      for (const kernel of kernels) {
        const half = (kernel.size - 1) / 2;
        let response = 0;
        let tap = 0;
        for (let dy = -half; dy <= half; dy += 1) {
          const yy = Math.min(size - 1, Math.max(0, y + dy));
          const rowBase = yy * size;
          for (let dx = -half; dx <= half; dx += 1) {
            const xx = Math.min(size - 1, Math.max(0, x + dx));
            response += src[rowBase + xx] * kernel.taps[tap];
            tap += 1;
          }
        }
        if (response > best) best = response;
      }
      out[index] = best;
    }
  }
  return out;
}

/* ------------------------------ Normalisation ------------------------------- */

/**
 * Scales responses into 0–1 by the {@link NORM_PERCENTILE} of the positive responses, floored at
 * {@link NORM_FLOOR}. The percentile makes the strongest creases land near 1 regardless of camera
 * or skin; the floor stops an empty palm from having its noise stretched to full confidence.
 */
export function normalizeResponses(resp: Float32Array): Float32Array {
  let max = 0;
  let positives = 0;
  for (let i = 0; i < resp.length; i += 1) {
    if (resp[i] > 0) {
      positives += 1;
      if (resp[i] > max) max = resp[i];
    }
  }
  if (positives === 0 || max < 1e-9) {
    resp.fill(0);
    return resp;
  }

  const BUCKETS = 512;
  const histogram = new Uint32Array(BUCKETS);
  for (let i = 0; i < resp.length; i += 1) {
    if (resp[i] <= 0) continue;
    histogram[Math.min(BUCKETS - 1, ((resp[i] / max) * BUCKETS) | 0)] += 1;
  }
  const wanted = Math.max(1, Math.floor(positives * (1 - NORM_PERCENTILE)));
  let counted = 0;
  let cutoff = BUCKETS - 1;
  for (let bucket = BUCKETS - 1; bucket >= 0; bucket -= 1) {
    counted += histogram[bucket];
    if (counted >= wanted) {
      cutoff = bucket;
      break;
    }
  }
  const scale = Math.max((cutoff / BUCKETS) * max, NORM_FLOOR);
  for (let i = 0; i < resp.length; i += 1) {
    resp[i] = resp[i] <= 0 ? 0 : Math.min(1, resp[i] / scale);
  }
  return resp;
}

/* -------------------------------- Pipeline ---------------------------------- */

/** The full chain: CLAHE → multi-scale black-hat → sparse Gabor bank → 0–1 probability. */
export function detectRidges(gray: Float32Array, size: number, raw?: RawDepthOut): RidgeResult {
  const t0 = now();
  const equalised = clahe(gray, size);
  const t1 = now();
  const creases = blackHatMulti(equalised, size);
  const t2 = now();
  const support = buildSupport(creases, size);
  const probability = normalizeResponses(gaborBank(creases, size, support));
  const t3 = now();

  if (raw !== undefined) {
    // H9 contract anchor: black-hat on the PRE-CLAHE input — same operator, un-equalised units.
    raw.depth.set(blackHatMulti(gray, size));
    const t4 = now();
    return {
      probability,
      timings: { claheMs: t1 - t0, blackhatMs: t2 - t1, gaborMs: t3 - t2, totalMs: t4 - t0, contractMs: t4 - t3 },
    };
  }

  return {
    probability,
    timings: { claheMs: t1 - t0, blackhatMs: t2 - t1, gaborMs: t3 - t2, totalMs: t3 - t0 },
  };
}
