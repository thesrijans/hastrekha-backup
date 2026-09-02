/**
 * Display-only enhancement for the labeler stage (0a-ii). Never writes back to a stored crop —
 * every output is a fresh ImageData for the canvas, and the label file records which view a line
 * was committed under (`viewAtCommit`) precisely because enhanced views bias what a human sees.
 *
 * CREASE is **continuous tone only**: the valley response tinted gold over a darkened base. No
 * thresholding, no thinning, no polylines — the moment this view draws a line, it is proposing
 * labels, and proposals are what the blank-slate rule exists to keep out of the eval set.
 *
 * CLAHE is re-implemented here on purpose: ridge.ts has one, and ridge.ts is banned for the
 * labeler (D1). Do NOT refactor ridge.ts to share it.
 */
import { toGray } from "./valley";
import type { GrayChannel, ViewMode } from "./session-types";

export type { ViewMode } from "./session-types";

export const CLAHE_TILES = 8;
export const CLAHE_CLIP = 2.5;
/** Mild gamma after CLAHE — lifts mid-tones without crushing the parchment-bright palm. */
export const CONTRAST_GAMMA = 0.9;

/** How dark the desaturated base sits under the CREASE overlay. */
export const CREASE_BASE_LEVEL = 0.45;
/** Gamma on the valley response before tinting — lifts faint creases into visibility. */
export const CREASE_GAMMA = 0.7;
/** Peak overlay opacity; the blend alpha is `valley × CREASE_ALPHA`, so it never exceeds this. */
export const CREASE_ALPHA = 0.85;
/** Antique gold, from the brand references (gold on near-black). */
export const CREASE_TINT: readonly [number, number, number] = [0xc9, 0xa2, 0x4b];

/* ---------------------------------- CLAHE ---------------------------------- */

const HIST_BINS = 256;

/**
 * Contrast-limited adaptive histogram equalisation on a [0,1] gray plane.
 *
 * Standard construction: per-tile clipped histograms → CDF lookup tables → bilinear interpolation
 * between the four surrounding tile LUTs per pixel. Clip limit is expressed as a multiple of the
 * uniform bin height, matching the convention ridge.ts uses so the constants read the same.
 */
export function clahe(
  gray: Float32Array,
  size: number,
  tiles: number = CLAHE_TILES,
  clip: number = CLAHE_CLIP,
): Float32Array {
  const tileSize = size / tiles;
  const luts = new Float32Array(tiles * tiles * HIST_BINS);
  const hist = new Float32Array(HIST_BINS);

  for (let ty = 0; ty < tiles; ty += 1) {
    for (let tx = 0; tx < tiles; tx += 1) {
      hist.fill(0);
      const x0 = Math.floor(tx * tileSize);
      const x1 = Math.floor((tx + 1) * tileSize);
      const y0 = Math.floor(ty * tileSize);
      const y1 = Math.floor((ty + 1) * tileSize);
      let count = 0;
      for (let y = y0; y < y1; y += 1) {
        const row = y * size;
        for (let x = x0; x < x1; x += 1) {
          const bin = Math.min(HIST_BINS - 1, Math.max(0, Math.floor(gray[row + x] * (HIST_BINS - 1))));
          hist[bin] += 1;
          count += 1;
        }
      }
      // Clip and redistribute the excess uniformly.
      const limit = (clip * count) / HIST_BINS;
      let excess = 0;
      for (let b = 0; b < HIST_BINS; b += 1) {
        if (hist[b] > limit) {
          excess += hist[b] - limit;
          hist[b] = limit;
        }
      }
      const share = excess / HIST_BINS;
      for (let b = 0; b < HIST_BINS; b += 1) hist[b] += share;
      // CDF → LUT.
      const base = (ty * tiles + tx) * HIST_BINS;
      let cdf = 0;
      for (let b = 0; b < HIST_BINS; b += 1) {
        cdf += hist[b];
        luts[base + b] = count > 0 ? cdf / count : b / (HIST_BINS - 1);
      }
    }
  }

  // Bilinear interpolation between tile LUTs.
  const out = new Float32Array(size * size);
  for (let y = 0; y < size; y += 1) {
    const fy = (y + 0.5) / tileSize - 0.5;
    const ty0 = Math.min(tiles - 1, Math.max(0, Math.floor(fy)));
    const ty1 = Math.min(tiles - 1, ty0 + 1);
    const wy = Math.min(1, Math.max(0, fy - ty0));
    const row = y * size;
    for (let x = 0; x < size; x += 1) {
      const fx = (x + 0.5) / tileSize - 0.5;
      const tx0 = Math.min(tiles - 1, Math.max(0, Math.floor(fx)));
      const tx1 = Math.min(tiles - 1, tx0 + 1);
      const wx = Math.min(1, Math.max(0, fx - tx0));
      const bin = Math.min(HIST_BINS - 1, Math.max(0, Math.floor(gray[row + x] * (HIST_BINS - 1))));
      const v00 = luts[(ty0 * tiles + tx0) * HIST_BINS + bin];
      const v01 = luts[(ty0 * tiles + tx1) * HIST_BINS + bin];
      const v10 = luts[(ty1 * tiles + tx0) * HIST_BINS + bin];
      const v11 = luts[(ty1 * tiles + tx1) * HIST_BINS + bin];
      out[row + x] = (v00 * (1 - wx) + v01 * wx) * (1 - wy) + (v10 * (1 - wx) + v11 * wx) * wy;
    }
  }
  return out;
}

/* --------------------------------- Views --------------------------------- */

const clamp255 = (v: number): number => (v < 0 ? 0 : v > 255 ? 255 : v);

/**
 * Render one still under a view mode. `valley` is required for CREASE (the caller computes it
 * once per still and reuses it for the cost map — same image by construction).
 *
 * `createImageData` mirrors the factory `rectifyPalm` takes, and for the same reason: node has no
 * ImageData constructor, and the tests exercise these views headlessly.
 */
export function renderView(
  rgba: Uint8ClampedArray,
  size: number,
  mode: ViewMode,
  channel: GrayChannel,
  valley?: Float32Array,
  createImageData: (w: number, h: number) => ImageData = (w, h) => new ImageData(w, h),
): ImageData {
  const image = createImageData(size, size);
  const out = image.data;

  if (mode === "NATURAL") {
    out.set(rgba.subarray(0, size * size * 4));
    return image;
  }

  const gray = toGray(rgba, size, channel);

  if (mode === "CONTRAST") {
    const equalised = clahe(gray, size);
    for (let i = 0; i < size * size; i += 1) {
      const v = clamp255(Math.round(Math.pow(equalised[i], CONTRAST_GAMMA) * 255));
      const at = i * 4;
      out[at] = v;
      out[at + 1] = v;
      out[at + 2] = v;
      out[at + 3] = 255;
    }
    return image;
  }

  // CREASE — darkened desaturated base + gold-tinted valley overlay, continuous tone only.
  const response = valley ?? new Float32Array(size * size);
  for (let i = 0; i < size * size; i += 1) {
    const base = gray[i] * CREASE_BASE_LEVEL * 255;
    const v = response[i];
    const lifted = Math.pow(v, CREASE_GAMMA);
    const alpha = v * CREASE_ALPHA;
    const at = i * 4;
    out[at] = clamp255(Math.round(base * (1 - alpha) + CREASE_TINT[0] * lifted * alpha));
    out[at + 1] = clamp255(Math.round(base * (1 - alpha) + CREASE_TINT[1] * lifted * alpha));
    out[at + 2] = clamp255(Math.round(base * (1 - alpha) + CREASE_TINT[2] * lifted * alpha));
    out[at + 3] = 255;
  }
  return image;
}
