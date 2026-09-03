/**
 * @file Numeric helpers for the rekha enhancement stack: separable Gaussian
 * blur and bilinear sampling on square Float32 images.
 *
 * Layer: lib/scan/enhance (production). Pure. Imports nothing.
 * Every function writes into caller-supplied buffers; nothing here allocates
 * per frame. Kernel construction is the only allocating call and is cold.
 */

/** Gaussian kernels are truncated at this many sigmas per side. */
export const GAUSSIAN_TRUNCATION_SIGMAS = 3;

/**
 * Build a normalised 1-D Gaussian kernel.
 * @param sigma Standard deviation in pixels. Must be > 0.
 * @returns Odd-length kernel summing to 1.
 */
export function gaussianKernel(sigma: number): Float32Array {
  const radius = Math.max(1, Math.ceil(sigma * GAUSSIAN_TRUNCATION_SIGMAS));
  const kernel = new Float32Array(2 * radius + 1);
  const twoSigmaSq = 2 * sigma * sigma;
  let sum = 0;
  for (let i = -radius; i <= radius; i += 1) {
    const value = Math.exp(-(i * i) / twoSigmaSq);
    kernel[i + radius] = value;
    sum += value;
  }
  for (let i = 0; i < kernel.length; i += 1) {
    kernel[i] = (kernel[i] ?? 0) / sum;
  }
  return kernel;
}

/** Reflect an out-of-range coordinate back into [0, size). */
function reflect(index: number, size: number): number {
  if (index < 0) return Math.min(-index, size - 1);
  if (index >= size) return Math.max(2 * size - index - 2, 0);
  return index;
}

/**
 * Separable Gaussian blur of a square image with reflected borders.
 * `src` and `dst` may be the same buffer. `tmp` must be distinct from both.
 * @param src Source image, size×size row-major.
 * @param dst Destination image.
 * @param tmp Scratch buffer of the same length.
 * @param size Image side length.
 * @param kernel Kernel from {@link gaussianKernel}.
 */
export function gaussianBlurInto(
  src: Float32Array,
  dst: Float32Array,
  tmp: Float32Array,
  size: number,
  kernel: Float32Array,
): void {
  const radius = (kernel.length - 1) >> 1;

  for (let y = 0; y < size; y += 1) {
    const row = y * size;
    for (let x = 0; x < size; x += 1) {
      let acc = 0;
      for (let k = -radius; k <= radius; k += 1) {
        const xx = reflect(x + k, size);
        acc += (src[row + xx] ?? 0) * (kernel[k + radius] ?? 0);
      }
      tmp[row + x] = acc;
    }
  }

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let acc = 0;
      for (let k = -radius; k <= radius; k += 1) {
        const yy = reflect(y + k, size);
        acc += (tmp[yy * size + x] ?? 0) * (kernel[k + radius] ?? 0);
      }
      dst[y * size + x] = acc;
    }
  }
}

/**
 * Bilinear sample of a square image. Coordinates outside the image return 0.
 * @param img Image, size×size row-major.
 * @param size Image side length.
 * @param x Sample x in pixel units.
 * @param y Sample y in pixel units.
 */
export function sampleBilinear(img: Float32Array, size: number, x: number, y: number): number {
  const max = size - 1;
  if (x < 0 || y < 0 || x > max || y > max) return 0;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = x0 < max ? x0 + 1 : x0;
  const y1 = y0 < max ? y0 + 1 : y0;
  const fx = x - x0;
  const fy = y - y0;
  const r0 = y0 * size;
  const r1 = y1 * size;
  const v00 = img[r0 + x0] ?? 0;
  const v10 = img[r0 + x1] ?? 0;
  const v01 = img[r1 + x0] ?? 0;
  const v11 = img[r1 + x1] ?? 0;
  const top = v00 + (v10 - v00) * fx;
  const bottom = v01 + (v11 - v01) * fx;
  return top + (bottom - top) * fy;
}
