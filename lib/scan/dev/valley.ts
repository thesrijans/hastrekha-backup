/**
 * Valley response for the labeler (0a-ii) — the SHARED operator behind both the livewire cost map
 * and the CREASE view, so what the human sees highlighted and what the path snaps to are the same
 * image by construction.
 *
 * Decision D1 + addendum A6: this is deliberately NOT the detector's ridge stack. A palm crease is
 * a dark valley in luma; a scale-normalised Laplacian-of-Gaussian peaks at the **valley centre**
 * (a gradient-magnitude cost would peak at the two EDGES and snap the path off-centre — rejected).
 * The whole file is self-contained: own Gaussian kernels, no import resolving into
 * lib/scan/{segmenter*,ridge,frangi,fusion,stack,completion,lines,quality} — enforced by
 * test/import-boundary.test.ts.
 */
import type { GrayChannel } from "./session-types";

export type { GrayChannel } from "./session-types";

/**
 * LoG scales in pixels at the 512 label resolution — crease widths, not magic. The smallest
 * catches fine lines, the largest bridges broken segments.
 */
export const VALLEY_SIGMAS: readonly number[] = [1.5, 2.2, 3.0];

/** Percentile used to normalise the pooled response; robust to a few specular outliers. */
export const VALLEY_PCTL = 99.5;

/* --------------------------------- Grayscale --------------------------------- */

/** RGBA bytes → grayscale [0,1] by the chosen channel (Rec. 709 luma or a single plane). */
export function toGray(rgba: Uint8ClampedArray, size: number, channel: GrayChannel): Float32Array {
  const out = new Float32Array(size * size);
  for (let i = 0; i < out.length; i += 1) {
    const at = i * 4;
    if (channel === "R") out[i] = rgba[at] / 255;
    else if (channel === "G") out[i] = rgba[at + 1] / 255;
    else if (channel === "B") out[i] = rgba[at + 2] / 255;
    else out[i] = (0.2126 * rgba[at] + 0.7152 * rgba[at + 1] + 0.0722 * rgba[at + 2]) / 255;
  }
  return out;
}

/* ------------------------------ Gaussian blur ------------------------------ */

function gaussianKernel(sigma: number): Float32Array {
  const radius = Math.max(1, Math.ceil(3 * sigma));
  const kernel = new Float32Array(2 * radius + 1);
  let sum = 0;
  for (let i = -radius; i <= radius; i += 1) {
    const w = Math.exp(-(i * i) / (2 * sigma * sigma));
    kernel[i + radius] = w;
    sum += w;
  }
  for (let i = 0; i < kernel.length; i += 1) kernel[i] /= sum;
  return kernel;
}

/** Separable Gaussian with clamped edges. `src` and `dst` must be distinct planes. */
function blurSeparable(src: Float32Array, dst: Float32Array, scratch: Float32Array, size: number, kernel: Float32Array): void {
  const radius = (kernel.length - 1) / 2;
  // Horizontal pass into scratch.
  for (let y = 0; y < size; y += 1) {
    const row = y * size;
    for (let x = 0; x < size; x += 1) {
      let acc = 0;
      for (let k = -radius; k <= radius; k += 1) {
        const sx = Math.min(size - 1, Math.max(0, x + k));
        acc += src[row + sx] * kernel[k + radius];
      }
      scratch[row + x] = acc;
    }
  }
  // Vertical pass into dst.
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let acc = 0;
      for (let k = -radius; k <= radius; k += 1) {
        const sy = Math.min(size - 1, Math.max(0, y + k));
        acc += scratch[sy * size + x] * kernel[k + radius];
      }
      dst[y * size + x] = acc;
    }
  }
}

/* ------------------------------ Valley response ------------------------------ */

/**
 * Scale-normalised positive LoG, max-pooled across {@link VALLEY_SIGMAS}, percentile-normalised.
 *
 * Per σ: Gaussian blur → discrete 4-neighbour Laplacian → ×σ² (scale normalisation, so a wide
 * soft crease competes fairly with a narrow sharp one) → positive part only, because a dark
 * crease is a luma **minimum** and the Laplacian of a minimum is positive; the negative lobes are
 * the bright flanks and must not count. Pooling is per-pixel max; the result is divided by its
 * {@link VALLEY_PCTL} percentile and clamped to [0,1].
 */
export function valleyResponse(
  gray: Float32Array,
  size: number,
  sigmas: readonly number[] = VALLEY_SIGMAS,
  out?: Float32Array,
): Float32Array {
  const plane = size * size;
  const pooled = out ?? new Float32Array(plane);
  pooled.fill(0);
  const blurred = new Float32Array(plane);
  const scratch = new Float32Array(plane);

  for (const sigma of sigmas) {
    blurSeparable(gray, blurred, scratch, size, gaussianKernel(sigma));
    const norm = sigma * sigma;
    for (let y = 0; y < size; y += 1) {
      const row = y * size;
      const up = Math.max(0, y - 1) * size;
      const down = Math.min(size - 1, y + 1) * size;
      for (let x = 0; x < size; x += 1) {
        const left = row + Math.max(0, x - 1);
        const right = row + Math.min(size - 1, x + 1);
        const log = norm * (blurred[up + x] + blurred[down + x] + blurred[left] + blurred[right] - 4 * blurred[row + x]);
        if (log > pooled[row + x]) pooled[row + x] = log;
      }
    }
  }

  // Percentile normalisation — a rank selection, not a sort of the whole plane.
  const rank = Math.min(plane - 1, Math.floor((VALLEY_PCTL / 100) * plane));
  const copy = Float32Array.from(pooled).sort();
  const scale = copy[rank];
  if (scale > 0) {
    for (let i = 0; i < plane; i += 1) {
      const v = pooled[i] / scale;
      pooled[i] = v > 1 ? 1 : v < 0 ? 0 : v;
    }
  }
  return pooled;
}
