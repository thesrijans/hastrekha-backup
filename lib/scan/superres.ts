/**
 * Multi-frame super-resolution of the palm-quad crop (flag `superRes`).
 *
 * **Resolution from real frames, never invented.** Several rectified crops of the same pose are
 * registered to one reference at sub-pixel accuracy and splatted onto a 2× grid. Each frame's
 * landmark jitter lands its samples at a different sub-pixel phase, so together they sample the
 * skin more densely than any one of them could; the per-pixel robust mean then averages the sensor
 * noise down and throws away the specular flash that spoils one frame in twelve. No single-image
 * upscaling model is used anywhere on this path — a learned upscaler hallucinates creases, which
 * is the one failure this pipeline cannot afford.
 *
 * What is REUSED from the temporal evidence accumulator (`lib/scan/enhance/evidence.ts`), ported
 * here verbatim because those helpers are module-private there and this module must not touch a
 * frozen file:
 *
 *   - `downsample`: the box-by-`motionDownsample` reduction the coarse search runs on;
 *   - `meanAbsDiff`: the SAD over the overlap of two planes at an integer shift — here extended
 *     with a validity mask and a rectangular region so it can score one block;
 *   - the search structure of `EvidenceAccumulator.alignToFrame`: coarse ±`motionSearch` at the
 *     downsampled size with the `motionShiftPenalty` regulariser toward zero, adopted only when it
 *     beats `motionMinGain` × the zero-shift SAD, then a ±`motionRefine` refinement at full size.
 *
 * What is EXTENDED: (1) sub-pixel — a parabola through the full-size SAD at the integer minimum
 * and its two neighbours on each axis gives the fractional offset (peak interpolation), and the
 * refinement always runs, even when the coarse stage kept zero, because sub-pixel accuracy is the
 * whole point rather than a nicety; (2) affine — the same search runs per block on a grid, and a
 * least-squares affine is fitted to the block displacements, falling back to the global
 * translation when the fit is degenerate or implausibly far from identity.
 *
 * What is DEVIATED from, deliberately: the `motionMinGain` acceptance gate is not applied when
 * adopting the coarse shift — see `estimateGlobalShift` for the measurement behind that.
 *
 * Layer: lib/scan (production). Pure. Imports nothing from lib/scan/dev.
 */
import { ILLUM_BOX_WIDTHS, ILLUM_DARK_BYPASS, ILLUM_FLOOR, ILLUM_GAIN, ILLUM_PEDESTAL, illuminationBlur } from "./illumination";
import { findPoseDuplicate, poseSignature, type PoseSignature } from "./pose-signature";
import { varianceOfLaplacian } from "./quality";
import type { Matrix3 } from "./rectify";
import { MASK_SIZE, type Point2 } from "./types";

/* --------------------------------- Constants --------------------------------- */

/** Frames the keep-ring holds: the K sharpest recent same-pose crops. */
export const SUPERRES_RING_SIZE = 12;
/** Side of the canonical crop the ring stores. Twice the detector's crop: this is where the pixels are. */
export const SUPERRES_CROP_SIZE = 512;
/** Grid magnification of the fusion. */
export const SUPERRES_SCALE = 2;
/**
 * Variance-of-Laplacian floor for a crop to enter the ring, on the 0–255 luma scale — the same
 * number as the still regrade's STILL_VOL_FLOOR, measured the same way (the centre
 * {@link SUPERRES_VOL_CENTRE_FRACTION} of the crop). A soft frame adds blur to the fusion, not
 * information.
 */
export const SUPERRES_VOL_FLOOR = 100;
export const SUPERRES_VOL_CENTRE_FRACTION = 0.6;
/** Fewer contributing frames than this and the fusion is not returned at all — never fabricated. */
export const SUPERRES_MIN_FRAMES = 4;
/** Robust mean: this fraction is dropped from EACH end of a pixel's samples… */
export const SUPERRES_TRIM_FRACTION = 0.15;
/** …once the pixel has at least this many samples. Below it, a plain weighted mean. */
export const SUPERRES_TRIM_MIN_SAMPLES = 6;
/** A ring frame older than this is the first to be replaced, sharpness notwithstanding. */
export const SUPERRES_RING_MAX_AGE_MS = 6000;
/** A frame must cover at least this fraction of the reference's valid area to count as contributing. */
export const SUPERRES_MIN_OVERLAP = 0.5;
/** Affine terms further than this from identity are not landmark jitter; the fit is rejected. */
export const SUPERRES_AFFINE_MAX_DEVIATION = 0.02;

/* ---------------------------------- Types ---------------------------------- */

/** One crop in the keep-ring. `luma` is 0–1, row-major `size²`; `valid` is 1 where it sampled real frame content. */
export interface SuperResFrame {
  readonly luma: Float32Array;
  readonly valid: Uint8Array | null;
  /** Rectification anchors in video px — the median-anchor reference is chosen from these. */
  readonly anchors?: readonly Point2[];
  /** Frame → crop homography the crop was rectified through. Provenance; fusion measures the residual. */
  readonly toCrop?: Matrix3 | null;
  readonly timestampMs?: number;
  /** Variance of Laplacian on the palm quad, 0–255 scale. */
  readonly vol?: number;
}

/** Row-major 2×3: p' = [a b; c d]·p + [tx ty]. */
export interface Affine {
  readonly a: number;
  readonly b: number;
  readonly c: number;
  readonly d: number;
  readonly tx: number;
  readonly ty: number;
}

export const IDENTITY_AFFINE: Affine = { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 };

export interface RegistrationOptions {
  /** Box-downsample factor for the coarse search (evidence.ts `motionDownsample`). */
  readonly downsample: number;
  /** Coarse search radius in downsampled px (`motionSearch`). */
  readonly search: number;
  /** Full-size refinement radius around the coarse estimate (`motionRefine`). */
  readonly refine: number;
  /**
   * Relative SAD penalty per pixel of displacement from the search centre (`motionShiftPenalty`,
   * re-sized: see {@link DEFAULT_REGISTRATION}). Breaks ties on a flat surface toward "no motion".
   */
  readonly shiftPenalty: number;
  /** Blocks per side for the affine stage. */
  readonly blockGrid: number;
  /** Full-size search radius per block around the global shift. */
  readonly blockSearch: number;
  /** A block needs at least this fraction of valid pixels to vote. */
  readonly minBlockValid: number;
  /** A block needs at least this luma standard deviation to vote — flat skin cannot be registered. */
  readonly minBlockContrast: number;
}

/**
 * The accumulator's `motionDownsample` / `motionSearch` / `motionRefine` unchanged. `shiftPenalty`
 * is a twentieth of its 0.02: that value was sized to hold a crease-RESPONSE plane still under the
 * aperture problem, where a basin is either deep or absent. On luma frames the SAD sits on the
 * sensor's noise floor; along a crease a 2-px shift deepens it by ~7%, but ACROSS the texture that
 * has to fix the other axis (pores, fine ridges) the basin between two integer candidates is
 * under 1% — measured on the synthetic sequence, where 0.02 pinned every frame to zero and 0.005
 * still pulled three of twelve to the wrong integer in y. A tenth of a percent per pixel is a tie
 * breaker on a flat surface and nothing more. `motionMinGain` has no counterpart here — see
 * `estimateGlobalShift`.
 */
export const DEFAULT_REGISTRATION: RegistrationOptions = {
  downsample: 2,
  search: 4,
  refine: 1,
  shiftPenalty: 0.001,
  blockGrid: 4,
  blockSearch: 2,
  minBlockValid: 0.5,
  minBlockContrast: 0.01,
};

export interface Registration {
  /** Frame → reference mapping in crop px. Identity for the reference itself. */
  readonly affine: Affine;
  /** Global sub-pixel displacement of content from the reference to this frame (crop px). */
  readonly shiftX: number;
  readonly shiftY: number;
  /** Blocks whose displacement entered the affine fit; 0 means the global translation was used. */
  readonly blocksUsed: number;
  /** Fraction of the reference's valid area this frame also covers. */
  readonly overlap: number;
  /** Photometric gain that matches this frame's valid-region mean to the reference's. */
  readonly gain: number;
  /** False when the frame could not be registered and was left out of the fusion. */
  readonly accepted: boolean;
}

export interface SuperResFusion {
  /** Illumination-normalised fused luma on the `(size·scale)²` grid, pedestal-centred like the worker's plane. */
  readonly texture: Float32Array;
  /** Fused luma BEFORE normalisation, 0–1 — what the detector is fed, so its own stage runs exactly once. */
  readonly luma: Float32Array;
  /** Accumulated splat weight per output pixel; 0 where no frame contributed. */
  readonly weight: Float32Array;
  /** Frames that actually contributed (registered and overlapping), the reference included. */
  readonly effectiveFrames: number;
  readonly referenceIndex: number;
  readonly registrations: readonly Registration[];
  readonly size: number;
  readonly scale: number;
}

export interface FuseOptions {
  /** Pin the reference instead of choosing the median-anchor frame (the eval pins the labelled still). */
  readonly referenceIndex?: number;
  readonly minFrames?: number;
  readonly registration?: Partial<RegistrationOptions>;
}

/* ------------------------------- Ported helpers ------------------------------- */

/**
 * Box-downsample by an integer factor — the accumulator's `downsample`, with the factor and the
 * output size explicit. `dst` is `(size/d)²`.
 */
export function boxDownsample(src: Float32Array, size: number, d: number, dst: Float32Array): void {
  const low = Math.floor(size / d);
  const inv = 1 / (d * d);
  for (let ly = 0; ly < low; ly += 1) {
    for (let lx = 0; lx < low; lx += 1) {
      let sum = 0;
      const y0 = ly * d;
      const x0 = lx * d;
      for (let yy = 0; yy < d; yy += 1) {
        const row = (y0 + yy) * size;
        for (let xx = 0; xx < d; xx += 1) sum += src[row + x0 + xx];
      }
      dst[ly * low + lx] = sum * inv;
    }
  }
}

/** Validity under a box downsample: a destination pixel is valid only if every source was (the worker's rule). */
export function boxDownsampleValidity(src: Uint8Array, size: number, d: number, dst: Uint8Array): void {
  const low = Math.floor(size / d);
  for (let ly = 0; ly < low; ly += 1) {
    for (let lx = 0; lx < low; lx += 1) {
      let all = 1;
      const y0 = ly * d;
      const x0 = lx * d;
      for (let yy = 0; yy < d && all === 1; yy += 1) {
        const row = (y0 + yy) * size;
        for (let xx = 0; xx < d; xx += 1) {
          if (src[row + x0 + xx] === 0) {
            all = 0;
            break;
          }
        }
      }
      dst[ly * low + lx] = all;
    }
  }
}

/**
 * Mean absolute difference between `cur` and `ref` shifted by (dx, dy), over the region
 * [x0, x1)×[y0, y1) of `cur` and only where both planes are valid — the accumulator's
 * `meanAbsDiff` (`cur[y][x]` against `ref[y − dy][x − dx]`), with the mask and the region added.
 * Returns +∞ when fewer than `minCount` pixels overlap, so an empty overlap can never win.
 */
export function maskedMeanAbsDiff(
  cur: Float32Array,
  ref: Float32Array,
  curValid: Uint8Array | null,
  refValid: Uint8Array | null,
  size: number,
  dx: number,
  dy: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  minCount: number,
): number {
  let sum = 0;
  let count = 0;
  const ya = Math.max(y0, dy);
  const yb = Math.min(y1, size + dy);
  const xa = Math.max(x0, dx);
  const xb = Math.min(x1, size + dx);
  for (let y = ya; y < yb; y += 1) {
    const row = y * size;
    const rrow = (y - dy) * size;
    for (let x = xa; x < xb; x += 1) {
      const i = row + x;
      const j = rrow + x - dx;
      if (curValid !== null && curValid[i] === 0) continue;
      if (refValid !== null && refValid[j] === 0) continue;
      const diff = cur[i] - ref[j];
      sum += diff < 0 ? -diff : diff;
      count += 1;
    }
  }
  return count >= minCount ? sum / count : Number.POSITIVE_INFINITY;
}

/* ------------------------------- Sub-pixel search ------------------------------- */

/**
 * Parabolic peak interpolation: the fractional offset of the minimum of a parabola through
 * (−1, sM), (0, s0), (+1, sP), clamped to ±½. Zero when the three points do not bow upward —
 * a flat or concave SAD carries no sub-pixel information and must not be read as if it did.
 */
export function parabolicOffset(sM: number, s0: number, sP: number): number {
  if (!Number.isFinite(sM) || !Number.isFinite(sP) || !Number.isFinite(s0)) return 0;
  const denominator = sM - 2 * s0 + sP;
  if (denominator <= 1e-12) return 0;
  const offset = (0.5 * (sM - sP)) / denominator;
  return offset < -0.5 ? -0.5 : offset > 0.5 ? 0.5 : offset;
}

export interface ShiftEstimate {
  readonly dx: number;
  readonly dy: number;
  /** Integer part the parabola was fitted around. */
  readonly ix: number;
  readonly iy: number;
  /** SAD at the integer minimum; +∞ when nothing overlapped. */
  readonly sad: number;
  /** Zero-shift SAD, for the gain test. */
  readonly zeroSad: number;
  /** True when the integer minimum sat on the search boundary — the estimate may be truncated. */
  readonly atBoundary: boolean;
  /** True when both axes had a convex SAD around the minimum — the sub-pixel part is trustworthy. */
  readonly convex: boolean;
}

interface Region {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
}

/**
 * Integer search over ±`radius` around (cx, cy) in the region, then parabolic refinement on each
 * axis. The penalty pulls toward the search CENTRE — zero for the coarse stage, the coarse
 * estimate for the refinement, the global estimate for a block — so a block's prior is the frame's
 * motion, not "no motion". Memoised SAD so the neighbours the parabola needs cost nothing when the
 * window already visited them.
 */
function searchShift(
  cur: Float32Array,
  ref: Float32Array,
  curValid: Uint8Array | null,
  refValid: Uint8Array | null,
  size: number,
  region: Region,
  cx: number,
  cy: number,
  radius: number,
  penalty: number,
  minCount: number,
): ShiftEstimate {
  const cache = new Map<number, number>();
  const sadAt = (dx: number, dy: number): number => {
    const key = (dy + 4096) * 8192 + (dx + 4096);
    const hit = cache.get(key);
    if (hit !== undefined) return hit;
    const value = maskedMeanAbsDiff(cur, ref, curValid, refValid, size, dx, dy, region.x0, region.y0, region.x1, region.y1, minCount);
    cache.set(key, value);
    return value;
  };
  let best = Number.POSITIVE_INFINITY;
  let bestRaw = Number.POSITIVE_INFINITY;
  let ix = cx;
  let iy = cy;
  for (let dy = -radius; dy <= radius; dy += 1) {
    for (let dx = -radius; dx <= radius; dx += 1) {
      const fx = cx + dx;
      const fy = cy + dy;
      const sad = sadAt(fx, fy);
      const score = sad * (1 + penalty * (Math.abs(dx) + Math.abs(dy)));
      if (score < best) {
        best = score;
        bestRaw = sad;
        ix = fx;
        iy = fy;
      }
    }
  }
  const zeroSad = sadAt(0, 0);
  if (!Number.isFinite(bestRaw)) {
    return { dx: 0, dy: 0, ix: 0, iy: 0, sad: bestRaw, zeroSad, atBoundary: false, convex: false };
  }
  const sM = sadAt(ix - 1, iy);
  const sP = sadAt(ix + 1, iy);
  const tM = sadAt(ix, iy - 1);
  const tP = sadAt(ix, iy + 1);
  const convexX = Number.isFinite(sM) && Number.isFinite(sP) && sM - 2 * bestRaw + sP > 1e-12;
  const convexY = Number.isFinite(tM) && Number.isFinite(tP) && tM - 2 * bestRaw + tP > 1e-12;
  return {
    dx: ix + parabolicOffset(sM, bestRaw, sP),
    dy: iy + parabolicOffset(tM, bestRaw, tP),
    ix,
    iy,
    sad: bestRaw,
    zeroSad,
    atBoundary: Math.abs(ix - cx) === radius || Math.abs(iy - cy) === radius,
    convex: convexX && convexY,
  };
}

/**
 * Global sub-pixel displacement of `cur`'s content relative to `ref` — the accumulator's coarse →
 * refine search with the parabolic extension. `lowCur`/`lowRef`/`lowValid*` are the caller's
 * downsampled scratch planes (allocated once per fusion, not per frame).
 */
export function estimateGlobalShift(
  cur: Float32Array,
  ref: Float32Array,
  curValid: Uint8Array | null,
  refValid: Uint8Array | null,
  size: number,
  scratch: {
    readonly lowCur: Float32Array;
    readonly lowRef: Float32Array;
    readonly lowCurValid: Uint8Array | null;
    readonly lowRefValid: Uint8Array | null;
    readonly refIsDownsampled: boolean;
  },
  options: RegistrationOptions,
): ShiftEstimate {
  const d = options.downsample;
  const low = Math.floor(size / d);
  boxDownsample(cur, size, d, scratch.lowCur);
  if (curValid !== null && scratch.lowCurValid !== null) boxDownsampleValidity(curValid, size, d, scratch.lowCurValid);
  if (!scratch.refIsDownsampled) {
    boxDownsample(ref, size, d, scratch.lowRef);
    if (refValid !== null && scratch.lowRefValid !== null) boxDownsampleValidity(refValid, size, d, scratch.lowRefValid);
  }
  const full: Region = { x0: 0, y0: 0, x1: low, y1: low };
  const minLow = Math.max(16, Math.floor(low * low * 0.1));
  // Coarse: the accumulator's ±search window on the downsampled planes, penalised toward zero.
  const coarse = searchShift(
    scratch.lowCur,
    scratch.lowRef,
    curValid === null ? null : scratch.lowCurValid,
    refValid === null ? null : scratch.lowRefValid,
    low,
    full,
    0,
    0,
    options.search,
    options.shiftPenalty * d,
    minLow,
  );
  /*
   * DEVIATION from the accumulator: the coarse minimum is adopted whenever it exists, not only when
   * it beats `motionMinGain` × the zero-shift SAD. That gate protects a log-odds accumulator from
   * drifting on noise; on luma frames the SAD is noise-floor-dominated and a genuine 2-px shift
   * clears it by a few percent at best — measured: with the gate, every frame shifted beyond a
   * pixel refined against a ±1 window centred on zero and came back truncated at ±1.5. The
   * `shiftPenalty` regulariser toward zero still decides a flat surface, and a frame with no basin
   * at all is caught downstream by the convexity test and the block votes. The zero-shift SAD is
   * still reported (`zeroSad`) so the gain the accumulator would have tested remains inspectable.
   */
  const adopt = Number.isFinite(coarse.sad) && (coarse.ix !== 0 || coarse.iy !== 0);
  const cx = adopt ? coarse.ix * d : 0;
  const cy = adopt ? coarse.iy * d : 0;
  // Refine at full size around it — and, unlike the accumulator, ALWAYS, for the sub-pixel part.
  const fullRegion: Region = { x0: 0, y0: 0, x1: size, y1: size };
  const minFull = Math.max(64, Math.floor(size * size * 0.1));
  return searchShift(cur, ref, curValid, refValid, size, fullRegion, cx, cy, options.refine, options.shiftPenalty, minFull);
}

/* --------------------------------- Affine fit --------------------------------- */

/** Solve a symmetric 3×3 system by Cramer's rule; null when singular. */
function solve3(m: readonly number[], r: readonly number[]): [number, number, number] | null {
  const [a, b, c, d, e, f, g, h, i] = m;
  const det = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
  if (Math.abs(det) < 1e-9) return null;
  const x = (r[0] * (e * i - f * h) - b * (r[1] * i - f * r[2]) + c * (r[1] * h - e * r[2])) / det;
  const y = (a * (r[1] * i - f * r[2]) - r[0] * (d * i - f * g) + c * (d * r[2] - r[1] * g)) / det;
  const z = (a * (e * r[2] - r[1] * h) - b * (d * r[2] - r[1] * g) + r[0] * (d * h - e * g)) / det;
  return [x, y, z];
}

/**
 * Least-squares affine through point pairs (from → to). Null with fewer than three pairs or a
 * degenerate (collinear) layout. Coordinates are centred first so the normal equations stay
 * well-conditioned at crop scale.
 */
export function fitAffine(from: readonly Point2[], to: readonly Point2[]): Affine | null {
  const n = Math.min(from.length, to.length);
  if (n < 3) return null;
  let mx = 0;
  let my = 0;
  for (let k = 0; k < n; k += 1) {
    mx += from[k].x;
    my += from[k].y;
  }
  mx /= n;
  my /= n;
  let sxx = 0;
  let sxy = 0;
  let syy = 0;
  let sx = 0;
  let sy = 0;
  const rx = [0, 0, 0];
  const ry = [0, 0, 0];
  for (let k = 0; k < n; k += 1) {
    const x = from[k].x - mx;
    const y = from[k].y - my;
    sxx += x * x;
    sxy += x * y;
    syy += y * y;
    sx += x;
    sy += y;
    const u = to[k].x - mx;
    const v = to[k].y - my;
    rx[0] += x * u;
    rx[1] += y * u;
    rx[2] += u;
    ry[0] += x * v;
    ry[1] += y * v;
    ry[2] += v;
  }
  const gram = [sxx, sxy, sx, sxy, syy, sy, sx, sy, n];
  const px = solve3(gram, rx);
  const py = solve3(gram, ry);
  if (px === null || py === null) return null;
  // Un-centre: p' − m = A(p − m) + t' ⇒ p' = A p + (m + t' − A m).
  const [a, b, txc] = px;
  const [c, d, tyc] = py;
  return { a, b, c, d, tx: mx + txc - (a * mx + b * my), ty: my + tyc - (c * mx + d * my) };
}

function affineDeviation(m: Affine): number {
  return Math.max(Math.abs(m.a - 1), Math.abs(m.b), Math.abs(m.c), Math.abs(m.d - 1));
}

/* --------------------------------- Registration --------------------------------- */

/**
 * Register one frame to the reference: global translation, then per-block refinement and an
 * affine fit over the blocks that could vote. The mapping returned sends FRAME px to REFERENCE
 * px — content displaced by `shift` from the reference means a frame pixel at p sits at p − shift
 * in the reference.
 */
export function registerFrame(
  frame: SuperResFrame,
  reference: SuperResFrame,
  size: number,
  scratch: Parameters<typeof estimateGlobalShift>[5],
  options: RegistrationOptions = DEFAULT_REGISTRATION,
): Registration {
  const cur = frame.luma;
  const ref = reference.luma;
  const curValid = frame.valid;
  const refValid = reference.valid;

  // Overlap + photometric gain, at zero shift: the residual is a few px, which moves neither number.
  let refCount = 0;
  let both = 0;
  let sumRef = 0;
  let sumCur = 0;
  for (let i = 0; i < size * size; i += 1) {
    const rv = refValid === null || refValid[i] !== 0;
    const cv = curValid === null || curValid[i] !== 0;
    if (rv) refCount += 1;
    if (rv && cv) {
      both += 1;
      sumRef += ref[i];
      sumCur += cur[i];
    }
  }
  const overlap = refCount === 0 ? 0 : both / refCount;
  const rejected = (gain: number): Registration => ({
    affine: IDENTITY_AFFINE,
    shiftX: 0,
    shiftY: 0,
    blocksUsed: 0,
    overlap,
    gain,
    accepted: false,
  });
  if (both === 0 || overlap < SUPERRES_MIN_OVERLAP) return rejected(1);
  let gain = sumCur > 1e-6 ? sumRef / sumCur : 1;
  if (gain < 0.5) gain = 0.5;
  else if (gain > 2) gain = 2;

  const global = estimateGlobalShift(cur, ref, curValid, refValid, size, scratch, options);
  if (!Number.isFinite(global.sad)) return rejected(gain);

  // Per-block refinement around the global integer shift.
  const grid = options.blockGrid;
  const block = Math.floor(size / grid);
  const from: Point2[] = [];
  const to: Point2[] = [];
  for (let by = 0; by < grid; by += 1) {
    for (let bx = 0; bx < grid; bx += 1) {
      const region: Region = { x0: bx * block, y0: by * block, x1: (bx + 1) * block, y1: (by + 1) * block };
      // Vote only with enough valid, textured pixels — flat skin has nothing to lock onto.
      let count = 0;
      let sum = 0;
      let sumSq = 0;
      for (let y = region.y0; y < region.y1; y += 1) {
        const row = y * size;
        for (let x = region.x0; x < region.x1; x += 1) {
          if (curValid !== null && curValid[row + x] === 0) continue;
          const v = cur[row + x];
          count += 1;
          sum += v;
          sumSq += v * v;
        }
      }
      const area = block * block;
      if (count < options.minBlockValid * area) continue;
      const mean = sum / count;
      const std = Math.sqrt(Math.max(0, sumSq / count - mean * mean));
      if (std < options.minBlockContrast) continue;
      const local = searchShift(
        cur,
        ref,
        curValid,
        refValid,
        size,
        region,
        global.ix,
        global.iy,
        options.blockSearch,
        options.shiftPenalty,
        Math.floor(options.minBlockValid * area),
      );
      if (!Number.isFinite(local.sad) || local.atBoundary || !local.convex) continue;
      const cxp = (region.x0 + region.x1) / 2;
      const cyp = (region.y0 + region.y1) / 2;
      from.push({ x: cxp, y: cyp });
      to.push({ x: cxp - local.dx, y: cyp - local.dy });
    }
  }

  const translation: Affine = { a: 1, b: 0, c: 0, d: 1, tx: -global.dx, ty: -global.dy };
  let affine = translation;
  let blocksUsed = 0;
  if (from.length >= 3) {
    const fitted = fitAffine(from, to);
    if (fitted !== null && affineDeviation(fitted) <= SUPERRES_AFFINE_MAX_DEVIATION) {
      affine = fitted;
      blocksUsed = from.length;
    }
  }
  return { affine, shiftX: global.dx, shiftY: global.dy, blocksUsed, overlap, gain, accepted: true };
}

/* ------------------------------ Reference choice ------------------------------ */

/**
 * The median-anchor frame: the one whose rectification anchors sit closest (L1) to the
 * per-coordinate median of all frames' anchors — the frame in the middle of the jitter cloud, so
 * every other frame's residual is small and roughly balanced. Falls back to the sharpest frame
 * when anchors are missing or inconsistent.
 */
export function medianAnchorReference(frames: readonly SuperResFrame[]): number {
  const count = frames[0]?.anchors?.length ?? 0;
  const consistent = count > 0 && frames.every((f) => f.anchors !== undefined && f.anchors.length === count);
  if (!consistent) {
    let best = 0;
    for (let k = 1; k < frames.length; k += 1) if ((frames[k].vol ?? 0) > (frames[best].vol ?? 0)) best = k;
    return best;
  }
  const medians: Point2[] = [];
  for (let a = 0; a < count; a += 1) {
    const xs = frames.map((f) => f.anchors![a].x).sort((p, q) => p - q);
    const ys = frames.map((f) => f.anchors![a].y).sort((p, q) => p - q);
    medians.push({ x: xs[xs.length >> 1], y: ys[ys.length >> 1] });
  }
  let best = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let k = 0; k < frames.length; k += 1) {
    let distance = 0;
    for (let a = 0; a < count; a += 1) {
      distance += Math.abs(frames[k].anchors![a].x - medians[a].x) + Math.abs(frames[k].anchors![a].y - medians[a].y);
    }
    // Ties go to the sharper frame — it will carry the most weight in the average anyway.
    if (distance < bestDistance - 1e-9 || (Math.abs(distance - bestDistance) <= 1e-9 && (frames[k].vol ?? 0) > (frames[best].vol ?? 0))) {
      bestDistance = distance;
      best = k;
    }
  }
  return best;
}

/* -------------------------------- Robust mean -------------------------------- */

/**
 * Weighted mean of `n` samples with the top and bottom {@link SUPERRES_TRIM_FRACTION} (rounded)
 * dropped by VALUE once `n ≥` {@link SUPERRES_TRIM_MIN_SAMPLES}. Fewer samples than that and
 * nothing is trimmed — dropping one of five is a coin toss, not robustness. Writes `[value,
 * weight]` into `out`; sorts `order` in place (an index scratch of length ≥ n). Allocation-free.
 */
export function trimmedWeightedMean(
  values: Float32Array,
  weights: Float32Array,
  n: number,
  order: Int32Array,
  out: Float64Array,
  trimFraction: number = SUPERRES_TRIM_FRACTION,
  minSamples: number = SUPERRES_TRIM_MIN_SAMPLES,
): void {
  if (n === 0) {
    out[0] = 0;
    out[1] = 0;
    return;
  }
  for (let i = 0; i < n; i += 1) order[i] = i;
  // Insertion sort by value: n is at most the ring size, and the input is nearly sorted after the first pixel.
  for (let i = 1; i < n; i += 1) {
    const key = order[i];
    const v = values[key];
    let j = i - 1;
    while (j >= 0 && values[order[j]] > v) {
      order[j + 1] = order[j];
      j -= 1;
    }
    order[j + 1] = key;
  }
  const trim = n >= minSamples ? Math.round(trimFraction * n) : 0;
  let sum = 0;
  let weight = 0;
  for (let i = trim; i < n - trim; i += 1) {
    const k = order[i];
    sum += values[k] * weights[k];
    weight += weights[k];
  }
  out[0] = weight > 0 ? sum / weight : 0;
  out[1] = weight;
}

/* ------------------------------ Illumination port ------------------------------ */

/**
 * The worker's illumination box widths scaled to a texture of side `size`. The kernel is defined
 * in pixels at the 128 working grid (σ 5 ≈ 1/25 of the crop); applied unscaled at 1024 it would
 * be a 15-pixel neighbourhood on a 20-pixel-wide crease and divide the crease straight out — the
 * one failure the stage's own notes call worse than doing nothing. Radii scale by `size/128`,
 * widths stay odd.
 */
export function illuminationWidthsFor(size: number): number[] {
  const factor = size / MASK_SIZE;
  return ILLUM_BOX_WIDTHS.map((w) => 2 * Math.max(1, Math.round(((w - 1) / 2) * factor)) + 1);
}

/**
 * `normaliseIllumination`, ported for the fused texture: the same model (`I = R·L`, divide out a
 * large-radius blur of `I`), the same floor / pedestal / gain / dark-bypass constants, the blur
 * imported from the stage itself — only the kernel is scaled to the texture's resolution and the
 * validity comes from the splat weight. Pixels no frame reached read as the pedestal, exactly as
 * the worker writes pixels outside the crop.
 */
export function normaliseTexture(luma: Float32Array, size: number, weight: Float32Array | null, out: Float32Array): boolean {
  const plane = size * size;
  let sum = 0;
  let count = 0;
  for (let i = 0; i < plane; i += 1) {
    if (weight !== null && weight[i] <= 0) continue;
    sum += luma[i];
    count += 1;
  }
  const meanLuma = count === 0 ? 0 : sum / count;
  if (meanLuma < ILLUM_DARK_BYPASS) {
    out.set(luma);
    return true;
  }
  // The blur lands in `out`, which is then divided in place: no third plane at texture size.
  illuminationBlur(luma, out, size, illuminationWidthsFor(size));
  for (let i = 0; i < plane; i += 1) {
    if (weight !== null && weight[i] <= 0) {
      out[i] = ILLUM_PEDESTAL;
      continue;
    }
    const reflectance = luma[i] / Math.max(out[i], ILLUM_FLOOR);
    const value = ILLUM_PEDESTAL + (reflectance - 1) * ILLUM_GAIN;
    out[i] = value < 0 ? 0 : value > 1 ? 1 : value;
  }
  return false;
}

/* ---------------------------------- Fusion ---------------------------------- */

/** Rows of the output grid processed per band; bounds the per-frame splat scratch, not the result. */
const BAND_ROWS = 32;

/**
 * Fuse registered frames onto the `scale`× grid.
 *
 * 1. Reference: the median-anchor frame (or `options.referenceIndex`).
 * 2. Registration: each frame → reference, translation + affine, sub-pixel (see the module notes).
 * 3. Splat: every valid source pixel of every accepted frame is deposited at its registered
 *    position on the output grid with bilinear weights to the four surrounding grid points;
 *    value and weight accumulate PER FRAME so the per-pixel robust mean can see each frame as one
 *    sample. Done in row bands so the per-frame accumulators stay a few megabytes.
 * 4. Robust mean per pixel: the trimmed weighted mean over frames — a specular flash present in
 *    one frame is the top sample and is dropped; a dropped-out frame the bottom one.
 * 5. Illumination-normalise the fused luma with the worker's stage (kernel scaled).
 *
 * Returns null when fewer than `minFrames` frames contributed — the caller falls back to the
 * single best frame. A fusion of two frames is not a fusion, and it is never fabricated up.
 */
export function fuseFrames(
  frames: readonly SuperResFrame[],
  size: number = SUPERRES_CROP_SIZE,
  scale: number = SUPERRES_SCALE,
  options: FuseOptions = {},
): SuperResFusion | null {
  const minFrames = options.minFrames ?? SUPERRES_MIN_FRAMES;
  if (frames.length < minFrames) return null;
  const registrationOptions: RegistrationOptions = { ...DEFAULT_REGISTRATION, ...options.registration };
  for (const frame of frames) {
    if (frame.luma.length !== size * size) throw new Error(`superres: frame luma must be ${size}² (got ${frame.luma.length})`);
    if (frame.valid !== null && frame.valid.length !== size * size) throw new Error("superres: frame validity must match the luma plane");
  }

  const referenceIndex =
    options.referenceIndex !== undefined && options.referenceIndex >= 0 && options.referenceIndex < frames.length
      ? options.referenceIndex
      : medianAnchorReference(frames);
  const reference = frames[referenceIndex];

  // Registration scratch: the reference is downsampled once, every other frame once each.
  const d = registrationOptions.downsample;
  const low = Math.floor(size / d);
  const scratch = {
    lowCur: new Float32Array(low * low),
    lowRef: new Float32Array(low * low),
    lowCurValid: new Uint8Array(low * low),
    lowRefValid: new Uint8Array(low * low),
    refIsDownsampled: false,
  };
  const registrations: Registration[] = new Array<Registration>(frames.length);
  let effectiveFrames = 0;
  for (let k = 0; k < frames.length; k += 1) {
    if (k === referenceIndex) {
      registrations[k] = { affine: IDENTITY_AFFINE, shiftX: 0, shiftY: 0, blocksUsed: 0, overlap: 1, gain: 1, accepted: true };
      effectiveFrames += 1;
      continue;
    }
    registrations[k] = registerFrame(frames[k], reference, size, scratch, registrationOptions);
    scratch.refIsDownsampled = true;
    if (registrations[k].accepted) effectiveFrames += 1;
  }
  if (effectiveFrames < minFrames) return null;

  const outSize = size * scale;
  const outPlane = outSize * outSize;
  const luma = new Float32Array(outPlane);
  const weight = new Float32Array(outPlane);
  const K = frames.length;
  const bandPlane = BAND_ROWS * outSize;
  const bandValue = new Float32Array(K * bandPlane);
  const bandWeight = new Float32Array(K * bandPlane);
  const sampleValues = new Float32Array(K);
  const sampleWeights = new Float32Array(K);
  const order = new Int32Array(K);
  const meanOut = new Float64Array(2);

  for (let bandY0 = 0; bandY0 < outSize; bandY0 += BAND_ROWS) {
    const bandY1 = Math.min(outSize, bandY0 + BAND_ROWS);
    bandValue.fill(0);
    bandWeight.fill(0);

    for (let k = 0; k < K; k += 1) {
      const registration = registrations[k];
      if (!registration.accepted) continue;
      const { a, b, c, d: dd, tx, ty } = registration.affine;
      const gain = registration.gain;
      const source = frames[k].luma;
      const valid = frames[k].valid;
      const base = k * bandPlane;
      for (let sy = 0; sy < size; sy += 1) {
        const syc = sy + 0.5;
        // Output rows this source row can touch: its footprint is floor(oy) and floor(oy)+1.
        const yLeft = scale * (c * 0.5 + dd * syc + ty) - 0.5;
        const yRight = scale * (c * (size - 0.5) + dd * syc + ty) - 0.5;
        const yMin = Math.floor(Math.min(yLeft, yRight));
        const yMax = Math.floor(Math.max(yLeft, yRight)) + 1;
        if (yMax < bandY0 || yMin >= bandY1) continue;
        const row = sy * size;
        for (let sx = 0; sx < size; sx += 1) {
          if (valid !== null && valid[row + sx] === 0) continue;
          const sxc = sx + 0.5;
          const ox = scale * (a * sxc + b * syc + tx) - 0.5;
          const oy = scale * (c * sxc + dd * syc + ty) - 0.5;
          const x0 = Math.floor(ox);
          const y0 = Math.floor(oy);
          const fx = ox - x0;
          const fy = oy - y0;
          const v = source[row + sx] * gain;
          // Four taps, each deposited only inside the grid and inside this band.
          for (let t = 0; t < 4; t += 1) {
            const px = t & 1 ? x0 + 1 : x0;
            const py = t & 2 ? y0 + 1 : y0;
            if (px < 0 || px >= outSize || py < bandY0 || py >= bandY1) continue;
            const w = (t & 1 ? fx : 1 - fx) * (t & 2 ? fy : 1 - fy);
            if (w <= 0) continue;
            const at = base + (py - bandY0) * outSize + px;
            bandValue[at] += v * w;
            bandWeight[at] += w;
          }
        }
      }
    }

    // Gather: each frame is one sample per pixel (its splat mean), weighted by how much of it landed there.
    for (let py = bandY0; py < bandY1; py += 1) {
      const localRow = (py - bandY0) * outSize;
      const outRow = py * outSize;
      for (let px = 0; px < outSize; px += 1) {
        let n = 0;
        for (let k = 0; k < K; k += 1) {
          const w = bandWeight[k * bandPlane + localRow + px];
          if (w <= 1e-4) continue;
          sampleValues[n] = bandValue[k * bandPlane + localRow + px] / w;
          sampleWeights[n] = w;
          n += 1;
        }
        trimmedWeightedMean(sampleValues, sampleWeights, n, order, meanOut);
        luma[outRow + px] = meanOut[0];
        weight[outRow + px] = meanOut[1];
      }
    }
  }

  const texture = new Float32Array(outPlane);
  normaliseTexture(luma, outSize, weight, texture);
  return { texture, luma, weight, effectiveFrames, referenceIndex, registrations, size, scale };
}

/* --------------------------------- Sharpness --------------------------------- */

let volScratch: { side: number; plane: Float32Array } | null = null;

/**
 * Variance of Laplacian over the centre {@link SUPERRES_VOL_CENTRE_FRACTION} of a 0–1 luma crop,
 * reported on the 0–255 scale — the still regrade's operator on the still regrade's subject, so
 * {@link SUPERRES_VOL_FLOOR} means the same thing here as STILL_VOL_FLOOR does there.
 */
export function palmQuadVol(luma: Float32Array, size: number): number {
  const margin = Math.floor((size * (1 - SUPERRES_VOL_CENTRE_FRACTION)) / 2);
  const side = size - 2 * margin;
  if (side < 3) return 0;
  if (volScratch === null || volScratch.side !== side) volScratch = { side, plane: new Float32Array(side * side) };
  const plane = volScratch.plane;
  for (let y = 0; y < side; y += 1) {
    const row = (y + margin) * size + margin;
    for (let x = 0; x < side; x += 1) plane[y * side + x] = luma[row + x] * 255;
  }
  return varianceOfLaplacian(plane, side, side);
}

/* --------------------------------- Keep-ring --------------------------------- */

export interface RingOffer {
  readonly accepted: boolean;
  readonly reason: "kept" | "soft" | "not-sharper" | "new-pose" | "new-convention";
  readonly vol: number;
}

interface RingSlot {
  anchors: readonly Point2[];
  toCrop: Matrix3 | null;
  timestampMs: number;
  vol: number;
  signature: PoseSignature;
}

/**
 * The keep-ring: the K sharpest recent crops of ONE pose, preallocated.
 *
 * Admission: the crop must clear {@link SUPERRES_VOL_FLOOR}, and it must be the same pose as the
 * newest kept frame by the capture guard's own rule (`findPoseDuplicate`) — a frame from a new
 * pose does not join the ring, it REPLACES it, because fusing across a real tilt blurs a palm
 * that is not a plane. A change of anchor convention likewise starts over: four- and five-anchor
 * crops are different canonical spaces.
 *
 * Eviction, when full: the oldest frame if it is older than {@link SUPERRES_RING_MAX_AGE_MS},
 * else the least sharp frame if the newcomer is sharper, else the newcomer is dropped.
 */
export class FrameRing {
  readonly size: number;
  readonly capacity: number;
  convention: number | null = null;
  private readonly lumaStore: Float32Array;
  private readonly validStore: Uint8Array;
  private readonly slots: RingSlot[] = [];

  constructor(size: number = SUPERRES_CROP_SIZE, capacity: number = SUPERRES_RING_SIZE) {
    this.size = size;
    this.capacity = capacity;
    this.lumaStore = new Float32Array(capacity * size * size);
    this.validStore = new Uint8Array(capacity * size * size);
  }

  get count(): number {
    return this.slots.length;
  }

  reset(): void {
    this.slots.length = 0;
    this.convention = null;
  }

  /** Copies the candidate into a slot when admitted; the caller's buffers stay the caller's. */
  offer(
    luma: Float32Array,
    valid: Uint8Array | null,
    anchors: readonly Point2[],
    toCrop: Matrix3 | null,
    convention: number,
    nowMs: number,
    stillWidth: number,
  ): RingOffer {
    const vol = palmQuadVol(luma, this.size);
    if (vol < SUPERRES_VOL_FLOOR) return { accepted: false, reason: "soft", vol };

    let reason: RingOffer["reason"] = "kept";
    if (this.convention !== null && this.convention !== convention) {
      this.reset();
      reason = "new-convention";
    }
    const signature = poseSignature(anchors.map((p) => [p.x, p.y] as const));
    const newest = this.newest();
    if (newest !== null && findPoseDuplicate([{ index: 0, signature: newest.signature }], signature, stillWidth) === null) {
      this.reset();
      reason = "new-pose";
    }
    this.convention = convention;

    // Slot index == storage index, always; a replacement overwrites in place.
    let slot = this.slots.length;
    if (slot >= this.capacity) {
      let oldest = 0;
      let softest = 0;
      for (let i = 1; i < this.slots.length; i += 1) {
        if (this.slots[i].timestampMs < this.slots[oldest].timestampMs) oldest = i;
        if (this.slots[i].vol < this.slots[softest].vol) softest = i;
      }
      if (nowMs - this.slots[oldest].timestampMs > SUPERRES_RING_MAX_AGE_MS) slot = oldest;
      else if (vol > this.slots[softest].vol) slot = softest;
      else return { accepted: false, reason: "not-sharper", vol };
    }

    const plane = this.size * this.size;
    this.lumaStore.set(luma, slot * plane);
    if (valid === null) this.validStore.fill(1, slot * plane, (slot + 1) * plane);
    else this.validStore.set(valid, slot * plane);
    const entry: RingSlot = { anchors: anchors.map((p) => ({ x: p.x, y: p.y })), toCrop, timestampMs: nowMs, vol, signature };
    if (slot === this.slots.length) this.slots.push(entry);
    else this.slots[slot] = entry;
    return { accepted: true, reason, vol };
  }

  /** The most recently admitted frame, by timestamp — the pose the ring is currently collecting. */
  private newest(): RingSlot | null {
    let best: RingSlot | null = null;
    for (const slot of this.slots) if (best === null || slot.timestampMs > best.timestampMs) best = slot;
    return best;
  }

  /** Views over the ring's storage — no copies. Valid until the next `offer`. */
  frames(): SuperResFrame[] {
    const plane = this.size * this.size;
    return this.slots.map((slot, i) => ({
      luma: this.lumaStore.subarray(i * plane, (i + 1) * plane),
      valid: this.validStore.subarray(i * plane, (i + 1) * plane),
      anchors: slot.anchors,
      toCrop: slot.toCrop,
      timestampMs: slot.timestampMs,
      vol: slot.vol,
    }));
  }

  /** Index of the sharpest frame, or -1 when empty. */
  sharpest(): number {
    let best = -1;
    for (let i = 0; i < this.slots.length; i += 1) if (best < 0 || this.slots[i].vol > this.slots[best].vol) best = i;
    return best;
  }
}
