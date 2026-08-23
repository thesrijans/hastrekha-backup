/**
 * Palm rectification.
 *
 * Coplanar palm landmarks are mapped onto a canonical square with a homography, so the crop the
 * segmenter sees is view-invariant: tilt the hand, move it closer, rotate it, and the same patch of
 * skin lands on the same pixels. Without this, a line model has to learn every viewing angle rather
 * than the lines.
 *
 * Four anchors determine a homography exactly. A fifth — the derived percussion point on the ulnar
 * edge — makes the system over-determined and is solved by least squares, which averages landmark
 * jitter across five correspondences instead of trusting four noisy ones absolutely. The 4-anchor
 * path remains as the fallback for when the little finger is out of frame.
 *
 * Pure maths and typed arrays — no DOM beyond the `ImageData` shape — so all of it is unit-tested.
 */
import { LM } from "./landmark-index";
import { derivePalmEdge } from "./landmarks";
import { RECTIFIED_SIZE, type Landmark3, type Point2 } from "./types";

/** Row-major 3×3, with h[8] normalised to 1. */
export type Matrix3 = readonly [number, number, number, number, number, number, number, number, number];

/**
 * The four base palm anchors, chosen because they are the most nearly coplanar points on the palmar
 * surface and they span it: wrist at the base, thumb root on one side, index and little knuckles
 * across the top.
 */
export const PALM_ANCHORS = [LM.WRIST, LM.THUMB_CMC, LM.INDEX_MCP, LM.PINKY_MCP] as const;

/**
 * Where those anchors land in the rectified crop, in 0–1 units.
 *
 * These are anatomical estimates, not measurements. They are the one knob most likely to need
 * tuning, which is exactly why the debug HUD renders the crop with the source anchors marked —
 * adjust here, watch the crop, repeat on real hands.
 */
export const CANONICAL_ANCHORS: readonly Point2[] = [
  { x: 0.5, y: 0.97 }, // wrist
  { x: 0.13, y: 0.74 }, // thumb CMC
  { x: 0.24, y: 0.14 }, // index MCP
  { x: 0.85, y: 0.24 }, // little MCP
];

/**
 * Canonical position of the derived percussion point (little-finger side, pushed outward).
 *
 * Same status as the four above: an estimate to be tuned against real crops, not a measurement.
 */
export const CANONICAL_PERCUSSION: Point2 = { x: 0.96, y: 0.26 };

/** Gaussian elimination with partial pivoting on a dense square system. */
function gaussianSolve(a: number[][], b: number[]): number[] | null {
  const n = b.length;
  for (let col = 0; col < n; col += 1) {
    let pivot = col;
    for (let row = col + 1; row < n; row += 1) {
      if (Math.abs(a[row][col]) > Math.abs(a[pivot][col])) pivot = row;
    }
    if (Math.abs(a[pivot][col]) < 1e-12) return null; // singular

    if (pivot !== col) {
      [a[pivot], a[col]] = [a[col], a[pivot]];
      [b[pivot], b[col]] = [b[col], b[pivot]];
    }

    const diag = a[col][col];
    for (let row = col + 1; row < n; row += 1) {
      const factor = a[row][col] / diag;
      if (factor === 0) continue;
      for (let k = col; k < n; k += 1) a[row][k] -= factor * a[col][k];
      b[row] -= factor * b[col];
    }
  }

  const x = new Array<number>(n).fill(0);
  for (let row = n - 1; row >= 0; row -= 1) {
    let sum = b[row];
    for (let k = row + 1; k < n; k += 1) sum -= a[row][k] * x[k];
    x[row] = sum / a[row][row];
  }
  return x;
}

/**
 * Solves the homography taking `src` to `dst`.
 *
 * Each correspondence contributes two rows to a linear system in the eight unknowns of a homography
 * normalised with h33 = 1. With exactly four pairs the system is square and solved directly. With
 * more, it is over-determined and solved through the normal equations AᵀA h = Aᵀb — the same
 * elimination, applied to an 8×8 that folds in every correspondence.
 *
 * Least squares here minimises *algebraic* residual, not geometric reprojection error. For the
 * millimetre-scale landmark jitter this exists to absorb the two are close enough that the extra
 * correspondence measurably helps; for gross outliers it would not, and RANSAC would be the answer.
 *
 * @returns null when the points are degenerate (collinear, coincident) and the system is singular —
 * which happens naturally when the hand turns edge-on, so callers must handle it rather than assume.
 */
export function solveHomography(src: readonly Point2[], dst: readonly Point2[]): Matrix3 | null {
  if (src.length !== dst.length || src.length < 4) return null;

  const rows: number[][] = [];
  const rhs: number[] = [];
  for (let i = 0; i < src.length; i += 1) {
    const { x, y } = src[i];
    const { x: u, y: v } = dst[i];
    rows.push([x, y, 1, 0, 0, 0, -u * x, -u * y]);
    rhs.push(u);
    rows.push([0, 0, 0, x, y, 1, -v * x, -v * y]);
    rhs.push(v);
  }

  let h: number[] | null;
  if (rows.length === 8) {
    h = gaussianSolve(rows.map((row) => [...row]), [...rhs]);
  } else {
    // Normal equations: AᵀA is always 8×8 however many correspondences there are.
    const ata: number[][] = Array.from({ length: 8 }, () => new Array<number>(8).fill(0));
    const atb = new Array<number>(8).fill(0);
    for (let r = 0; r < rows.length; r += 1) {
      const row = rows[r];
      const value = rhs[r];
      for (let i = 0; i < 8; i += 1) {
        atb[i] += row[i] * value;
        for (let j = 0; j < 8; j += 1) ata[i][j] += row[i] * row[j];
      }
    }
    h = gaussianSolve(ata, atb);
  }

  if (h === null || h.some((value) => !Number.isFinite(value))) return null;
  return [h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], 1] as Matrix3;
}

/** Applies a homography to a point. Returns null when the point maps to the line at infinity. */
export function applyHomography(h: Matrix3, p: Point2): Point2 | null {
  const w = h[6] * p.x + h[7] * p.y + h[8];
  if (Math.abs(w) < 1e-12) return null;
  return { x: (h[0] * p.x + h[1] * p.y + h[2]) / w, y: (h[3] * p.x + h[4] * p.y + h[5]) / w };
}

/** The four base palm anchors in frame pixel coordinates. */
export function palmQuad(landmarks: readonly Landmark3[], frameWidth: number, frameHeight: number): Point2[] | null {
  if (landmarks.length < 21) return null;
  return PALM_ANCHORS.map((index) => ({
    x: landmarks[index].x * frameWidth,
    y: landmarks[index].y * frameHeight,
  }));
}

/** The canonical four targets, scaled to a crop of `size` pixels. */
export function canonicalQuad(size: number = RECTIFIED_SIZE): Point2[] {
  return CANONICAL_ANCHORS.map((p) => ({ x: p.x * size, y: p.y * size }));
}

/**
 * Canonical targets for a 4- or 5-anchor solve.
 *
 * @returns null for any other count, so a mismatched source list fails loudly rather than
 * silently rectifying against the wrong correspondences.
 */
export function canonicalAnchors(count: number, size: number = RECTIFIED_SIZE): Point2[] | null {
  if (count === 4) return canonicalQuad(size);
  if (count === 5) return [...canonicalQuad(size), { x: CANONICAL_PERCUSSION.x * size, y: CANONICAL_PERCUSSION.y * size }];
  return null;
}

/** How far inside the frame the percussion point must sit before it is trusted. */
const PERCUSSION_MARGIN = 0.01;

export interface AnchorSet {
  readonly src: readonly Point2[];
  readonly usedPercussion: boolean;
}

/**
 * Builds the source anchors for rectification, adding the percussion point when it is usable.
 *
 * MediaPipe reports a `visibility` field for hand landmarks that is not meaningfully populated, so
 * occlusion is judged by a condition that can actually be checked: whether the derived percussion
 * point still lands inside the frame. A little finger off the edge pushes it out, and the solve
 * falls back to four anchors rather than fitting to a point that was extrapolated into nowhere.
 */
export function palmAnchors(
  landmarks: readonly Landmark3[],
  frameWidth: number,
  frameHeight: number,
  allowPercussion = true,
): AnchorSet | null {
  const base = palmQuad(landmarks, frameWidth, frameHeight);
  if (base === null) return null;
  if (!allowPercussion) return { src: base, usedPercussion: false };

  const edge = derivePalmEdge(landmarks);
  if (edge === null) return { src: base, usedPercussion: false };

  const { percussionTop } = edge;
  const inFrame =
    percussionTop.x > PERCUSSION_MARGIN &&
    percussionTop.x < 1 - PERCUSSION_MARGIN &&
    percussionTop.y > PERCUSSION_MARGIN &&
    percussionTop.y < 1 - PERCUSSION_MARGIN;
  if (!inFrame) return { src: base, usedPercussion: false };

  return {
    src: [...base, { x: percussionTop.x * frameWidth, y: percussionTop.y * frameHeight }],
    usedPercussion: true,
  };
}

function bilinear(src: ImageData, x: number, y: number, out: Uint8ClampedArray, at: number): void {
  const { width, height, data } = src;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const x1 = Math.min(x0 + 1, width - 1);
  const y1 = Math.min(y0 + 1, height - 1);

  for (let channel = 0; channel < 4; channel += 1) {
    const p00 = data[(y0 * width + x0) * 4 + channel];
    const p10 = data[(y0 * width + x1) * 4 + channel];
    const p01 = data[(y1 * width + x0) * 4 + channel];
    const p11 = data[(y1 * width + x1) * 4 + channel];
    const top = p00 + (p10 - p00) * fx;
    const bottom = p01 + (p11 - p01) * fx;
    out[at + channel] = top + (bottom - top) * fy;
  }
}

export interface RectifyResult {
  readonly image: ImageData;
  /** Frame → crop transform, so landmarks can be projected into crop space for the classifier. */
  readonly toCrop: Matrix3;
  /** Fraction of destination pixels that fell inside the source frame. Low means the hand is clipped. */
  readonly coverage: number;
  /** Whether the fifth (percussion) correspondence was part of the fit. */
  readonly usedPercussion: boolean;
}

/**
 * Warps the palm out of `source` into a `size`×`size` crop.
 *
 * Inverse mapping: we iterate destination pixels and pull from the source, because forward mapping
 * leaves holes. The crop→frame homography is obtained by solving with the correspondences swapped
 * rather than inverting a matrix — same result, less numerical drift, no inversion code to get wrong.
 *
 * At 256² this is ~65k bilinear samples. Cheap enough to run per captured frame, not per preview
 * frame; callers should throttle it.
 */
export function rectifyPalm(
  source: ImageData,
  anchors: readonly Point2[],
  size: number = RECTIFIED_SIZE,
  createImageData: (w: number, h: number) => ImageData = (w, h) => new ImageData(w, h),
): RectifyResult | null {
  const target = canonicalAnchors(anchors.length, size);
  if (target === null) return null;

  const toCrop = solveHomography(anchors, target);
  const toFrame = solveHomography(target, anchors);
  if (toCrop === null || toFrame === null) return null;

  const image = createImageData(size, size);
  const out = image.data;
  let inside = 0;

  for (let dy = 0; dy < size; dy += 1) {
    for (let dx = 0; dx < size; dx += 1) {
      const at = (dy * size + dx) * 4;
      const p = applyHomography(toFrame, { x: dx + 0.5, y: dy + 0.5 });
      if (p === null || p.x < 0 || p.y < 0 || p.x >= source.width || p.y >= source.height) {
        out[at] = 0;
        out[at + 1] = 0;
        out[at + 2] = 0;
        out[at + 3] = 255;
        continue;
      }
      bilinear(source, p.x, p.y, out, at);
      out[at + 3] = 255;
      inside += 1;
    }
  }

  return { image, toCrop, coverage: inside / (size * size), usedPercussion: anchors.length === 5 };
}
