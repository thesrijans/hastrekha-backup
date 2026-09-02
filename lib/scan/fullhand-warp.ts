/**
 * Full-hand canonical warp for the UNet input path (flag `unetFullHand`, default off).
 *
 * H2/H2b evidence: the palm-lines UNet was trained on full-hand canonical warps; on the hard
 * golden frame the palm-quad crop elicited a near-black probability map while full-hand framing
 * drew continuous crease strokes (6× activated area). This module rebuilds that framing from the
 * 21 live landmarks, and maps the model's answer BACK into palm-quad canonical space so every
 * classical stage, the fusion accumulator and the extractor stay untouched.
 *
 * Pure: no DOM beyond ImageData, no imports from lib/scan/dev, no state. `rectifyPalm` is frozen
 * and deliberately not called — `warpFullHand` reimplements the same inverse-map loop shape with
 * two documented differences (edge replication, no validity plane).
 */
import { applyHomography, compose, invertHomography, solveHomography, type Matrix3 } from "./rectify";
import { CANONICAL_FULLHAND_21 } from "./models/canonical-fullhand-21";
import type { Landmark3 } from "./types";

/** The UNet's native input size — the full-hand canonical frame is built at exactly this. */
export const UNET_INPUT_SIZE = 256;

/**
 * @remarks wrist, thumb CMC/MCP, four finger MCPs: the near-coplanar palmar set. Upstream's
 * RANSAC kept ~10/21 varying per photo (H2b measured inliers [1,4,5,6,7,8,9,10,11,19] on one
 * frame and would keep a different set on the next); a fixed palmar set gives a temporally stable
 * warp and palm-plane alignment, which is what the crease model needs. 'all' mode exists for eval
 * comparison only.
 */
export const FULLHAND_FIXED_SUBSET = [0, 1, 2, 5, 9, 13, 17] as const;

/**
 * @remarks upstream's 5 px threshold was in native-resolution target space; expressed as a
 * fraction of frame height so it scales — ≈1.8 px at 256.
 */
export const RANSAC_THRESHOLD_FRAC = 5 / 720;
export const RANSAC_ITERS = 200;
export const RANSAC_SEED = 0x5eed;

export type FullHandFitMode = "fixed" | "all";

/* ------------------------------- RANSAC bits ------------------------------- */

/** Deterministic PRNG — same seed, same inlier set, every run on every machine. */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Correspondence {
  readonly src: { readonly x: number; readonly y: number };
  readonly dst: { readonly x: number; readonly y: number };
}

function reprojectionError(h: Matrix3, c: Correspondence): number {
  const p = applyHomography(h, c.src);
  return p === null ? Number.POSITIVE_INFINITY : Math.hypot(p.x - c.dst.x, p.y - c.dst.y);
}

/* --------------------------------- Solve --------------------------------- */

/**
 * Fit the source-frame → full-hand-canonical homography from the live landmarks.
 *
 * `'fixed'` (the runtime mode): direct DLT on {@link FULLHAND_FIXED_SUBSET}. `'all'` (eval only):
 * deterministic RANSAC over all 21 — 4-point samples from {@link mulberry32}({@link RANSAC_SEED}),
 * inlier when reprojection error ≤ RANSAC_THRESHOLD_FRAC·size, best inlier set refit with the
 * over-determined solve; null when fewer than 4 inliers survive.
 *
 * A negative determinant is ACCEPTED: a left hand folds into canonical chirality by reflection,
 * the same rule `rectifyPalm`'s anchor solve already relies on.
 */
export function solveFullHandHomography(
  landmarks: readonly Landmark3[],
  width: number,
  height: number,
  mode: FullHandFitMode = "fixed",
  size: number = UNET_INPUT_SIZE,
): Matrix3 | null {
  if (landmarks.length < 21 || width <= 0 || height <= 0) return null;
  const all: Correspondence[] = CANONICAL_FULLHAND_21.map((target, i) => ({
    src: { x: landmarks[i].x * width, y: landmarks[i].y * height },
    dst: { x: target[0] * size, y: target[1] * size },
  }));

  if (mode === "fixed") {
    const subset = FULLHAND_FIXED_SUBSET.map((i) => all[i]);
    return solveHomography(
      subset.map((c) => c.src),
      subset.map((c) => c.dst),
    );
  }

  const random = mulberry32(RANSAC_SEED);
  const threshold = RANSAC_THRESHOLD_FRAC * size;
  let bestInliers: number[] = [];
  for (let iteration = 0; iteration < RANSAC_ITERS; iteration += 1) {
    const picked = new Set<number>();
    while (picked.size < 4) picked.add(Math.floor(random() * all.length));
    const sample = [...picked].map((i) => all[i]);
    const candidate = solveHomography(
      sample.map((c) => c.src),
      sample.map((c) => c.dst),
    );
    if (candidate === null) continue;
    const inliers: number[] = [];
    for (let i = 0; i < all.length; i += 1) {
      if (reprojectionError(candidate, all[i]) <= threshold) inliers.push(i);
    }
    if (inliers.length > bestInliers.length) bestInliers = inliers;
  }
  if (bestInliers.length < 4) return null;
  const kept = bestInliers.map((i) => all[i]);
  return solveHomography(
    kept.map((c) => c.src),
    kept.map((c) => c.dst),
  );
}

/* ---------------------------------- Warp ---------------------------------- */

/**
 * Warp the source frame into the full-hand canonical square.
 *
 * Same inverse-map loop shape as `rectifyPalm` (destination centres `dx + 0.5`, pull through the
 * inverse, bilinear) with TWO deliberate differences: (a) source coordinates outside the image
 * are CLAMPED to the edge — upstream warped with BORDER_REPLICATE and the model was trained on
 * replicated borders, not black; (b) no validity plane is produced — nothing downstream of the
 * UNet consumes one on this path. `rectifyPalm` itself is frozen and not called.
 */
export function warpFullHand(
  source: ImageData,
  toCanonical: Matrix3,
  size: number = UNET_INPUT_SIZE,
  createImageData: (w: number, h: number) => ImageData = (w, h) => new ImageData(w, h),
): ImageData | null {
  const toSource = invertHomography(toCanonical);
  if (toSource === null) return null;
  const image = createImageData(size, size);
  const out = image.data;
  const maxX = source.width - 1;
  const maxY = source.height - 1;
  for (let dy = 0; dy < size; dy += 1) {
    for (let dx = 0; dx < size; dx += 1) {
      const at = (dy * size + dx) * 4;
      const p = applyHomography(toSource, { x: dx + 0.5, y: dy + 0.5 });
      if (p === null) {
        out[at + 3] = 255;
        continue;
      }
      // BORDER_REPLICATE: clamp, never blacken — the training distribution's border behaviour.
      const sx = p.x < 0 ? 0 : p.x > maxX ? maxX : p.x;
      const sy = p.y < 0 ? 0 : p.y > maxY ? maxY : p.y;
      const x0 = Math.min(maxX - 1, Math.max(0, Math.floor(sx)));
      const y0 = Math.min(maxY - 1, Math.max(0, Math.floor(sy)));
      const fx = sx - x0;
      const fy = sy - y0;
      const rowA = (y0 * source.width + x0) * 4;
      const rowB = ((y0 + 1) * source.width + x0) * 4;
      for (let channel = 0; channel < 3; channel += 1) {
        const a = source.data[rowA + channel];
        const b = source.data[rowA + 4 + channel];
        const c = source.data[rowB + channel];
        const d = source.data[rowB + 4 + channel];
        out[at + channel] = a * (1 - fx) * (1 - fy) + b * fx * (1 - fy) + c * (1 - fx) * fy + d * fx * fy;
      }
      out[at + 3] = 255;
    }
  }
  return image;
}

/* -------------------------------- Remapping -------------------------------- */

/**
 * Palm-quad canonical px → full-hand canonical px.
 *
 * Reads right-to-left, as `compose` documents: the palm-quad point is lifted back to the source
 * frame through the INVERSE of the quad solve, then dropped into the full-hand canonical through
 * the full-hand solve.
 */
export function palmQuadToFullHand(toCropQuad: Matrix3, toCropFullHand: Matrix3): Matrix3 | null {
  const quadToFrame = invertHomography(toCropQuad);
  return quadToFrame === null ? null : compose(toCropFullHand, quadToFrame);
}

/** Full-hand canonical px → palm-quad canonical px — the inverse direction, for tests. */
export function fullHandToPalmQuad(toCropQuad: Matrix3, toCropFullHand: Matrix3): Matrix3 | null {
  const fullToFrame = invertHomography(toCropFullHand);
  return fullToFrame === null ? null : compose(toCropQuad, fullToFrame);
}

/**
 * Pull the full-hand probability plane into palm-quad working space — one warp, no intermediate
 * 256 plane, no box downsample. Zero allocation: writes into `out`.
 *
 * For each out pixel (i, j) at `outSize`: the palm-quad CANONICAL coordinate is
 * `((i + 0.5)·pqSize/outSize, (j + 0.5)·pqSize/outSize)` — centre convention at the crop scale —
 * mapped through `pqToFullHand`, then bilinearly sampled from `full`. Outside the full-hand frame
 * → 0 (a probability plane has no replicate rule; absence of evidence is 0, not the edge's value).
 */
export function remapProbabilitiesInto(
  full: Float32Array,
  fullSize: number,
  pqToFullHand: Matrix3,
  out: Float32Array,
  outSize: number,
  pqSize: number,
): void {
  const scale = pqSize / outSize;
  const limit = fullSize - 1;
  for (let j = 0; j < outSize; j += 1) {
    for (let i = 0; i < outSize; i += 1) {
      const p = applyHomography(pqToFullHand, { x: (i + 0.5) * scale, y: (j + 0.5) * scale });
      const at = j * outSize + i;
      if (p === null || p.x < 0 || p.y < 0 || p.x > limit || p.y > limit) {
        out[at] = 0;
        continue;
      }
      const x0 = Math.min(limit - 1, Math.max(0, Math.floor(p.x)));
      const y0 = Math.min(limit - 1, Math.max(0, Math.floor(p.y)));
      const fx = p.x - x0;
      const fy = p.y - y0;
      const a = full[y0 * fullSize + x0];
      const b = full[y0 * fullSize + x0 + 1];
      const c = full[(y0 + 1) * fullSize + x0];
      const d = full[(y0 + 1) * fullSize + x0 + 1];
      out[at] = a * (1 - fx) * (1 - fy) + b * fx * (1 - fy) + c * (1 - fx) * fy + d * fx * fy;
    }
  }
}

/* ------------------------------ Wire transfer ------------------------------ */

/**
 * Matrix3 ↔ transferable buffer. Matrix3's storage layout, quoted from rectify.ts:21:
 * `readonly [number × 9]` — row-major with `h[8] === 1` by construction of the solve. The buffer
 * is a Float64Array(9) in the same order.
 */
export function matrixToBuffer(m: Matrix3): ArrayBuffer {
  return Float64Array.from(m).buffer;
}

export function matrixFromBuffer(buffer: ArrayBuffer): Matrix3 {
  const values = new Float64Array(buffer);
  return [values[0], values[1], values[2], values[3], values[4], values[5], values[6], values[7], values[8]];
}
