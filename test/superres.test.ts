/* ============================================================================
 * SUPER-RESOLUTION (flag superRes) — resolution from real frames, never invented
 *
 * A synthetic sequence with a KNOWN continuous scene: one narrow crease (plus
 * sparse pores so the registration has 2-D texture to lock onto), rendered
 * twelve times at known sub-pixel shifts with pixel integration and sensor
 * noise, one frame spoiled by a specular flash. The fusion must recover the
 * shifts, average the noise down, reject the flash, and give a crease profile
 * sharper than ANY single frame — measured, not asserted by construction.
 *
 * The FWHM half exercises the sampling-limited regime (a crease narrower than
 * a pixel): there, a single frame's profile is aliased and its measured width
 * depends on where the crease happened to fall between pixels; the 2× grid
 * samples the same profile densely enough that the estimator sees its true
 * width. For a crease several pixels wide the gain of fusion is in noise, not
 * in width — which the noise half measures.
 *
 * Nothing here touches the flag store except to pin its default. The live
 * path's identity with the flag off is test/flags-identity.test.ts's job.
 * ========================================================================== */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import {
  boxDownsample,
  boxDownsampleValidity,
  DEFAULT_REGISTRATION,
  FrameRing,
  fitAffine,
  fuseFrames,
  illuminationWidthsFor,
  medianAnchorReference,
  normaliseTexture,
  palmQuadVol,
  parabolicOffset,
  SUPERRES_MIN_FRAMES,
  SUPERRES_RING_MAX_AGE_MS,
  SUPERRES_RING_SIZE,
  SUPERRES_TRIM_MIN_SAMPLES,
  SUPERRES_VOL_FLOOR,
  trimmedWeightedMean,
  type SuperResFrame,
} from "../lib/scan/superres";
import { detectOnTexture } from "../lib/scan/superres-detect";
import { ILLUM_BOX_WIDTHS, ILLUM_PEDESTAL } from "../lib/scan/illumination";
import { DEFAULT_SCAN_FLAGS, SCAN_FLAG_LABELS, SCAN_FLAG_NAMES, allFlagsOff } from "../lib/scan/flags";
import { POSE_DUP_RADIUS, findPoseDuplicate, poseSignature } from "../lib/scan/pose-signature";
import * as stillCapture from "../lib/scan/dev/still-capture";
import {
  CANONICAL_LABEL_SIZE,
  SESSION_SCHEMA_VERSION,
  cropFileName,
  isSessionMetadata,
  labelFileName,
  rawFileName,
  type CaptureStillRecord,
  type SessionMetadata,
} from "../lib/scan/dev/session-types";
import { buildLabelFile, emptyLabelerState, type LabelerState } from "../lib/scan/dev/labeler-file";
import { loadGroundTruthDetailed, type EvalCase } from "./eval/gt-adapter";
import { POSTS, computeField, resetFieldCache, superResGroupOf, superResInfoOf } from "./eval/run-pipeline";
import { MASK_SIZE, type Point2 } from "../lib/scan/types";

let assertions = 0;
const ok = (condition: boolean, message: string): void => {
  assert.ok(condition, message);
  assertions += 1;
};

/* ------------------------------ Deterministic RNG ------------------------------ */

function makeRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function gaussian(rng: () => number): number {
  const u = Math.max(1e-12, rng());
  const v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/* ------------------------------ Synthetic scene ------------------------------ */

const BACKGROUND = 0.6;
const CREASE_DEPTH = 0.25;
/** Crease σ in frame px — deliberately sub-pixel, the regime where sampling limits a single frame. */
const CREASE_SIGMA = 0.6;
/** The crease leans slightly so its sub-pixel phase sweeps every value down the rows. */
const CREASE_SLOPE = 0.02;

interface Scene {
  readonly size: number;
  /** Continuous luma at scene coordinates. */
  sample(x: number, y: number): number;
  creaseX(y: number): number;
  /** A flat patch with no pores, for the noise measurement. */
  readonly flat: { x0: number; y0: number; x1: number; y1: number };
}

function makeScene(size: number, seed: number): Scene {
  const rng = makeRng(seed);
  const creaseX = (y: number): number => size * 0.39 + CREASE_SLOPE * (y - size / 2);
  const flat = { x0: Math.round(size * 0.66), y0: Math.round(size * 0.66), x1: Math.round(size * 0.9), y1: Math.round(size * 0.9) };
  // Pores at skin-like density on a bucket grid; kept clear of the crease band and the flat patch.
  // They are what fixes the registration ALONG the crease — a line alone has the aperture problem.
  const cell = 16;
  const cells = Math.ceil(size / cell);
  const buckets: number[][] = Array.from({ length: cells * cells }, () => []);
  const pores: { x: number; y: number; amp: number; sigma: number }[] = [];
  const wanted = Math.round((size * size) / 150);
  while (pores.length < wanted) {
    const x = rng() * size;
    const y = rng() * size;
    if (Math.abs(x - creaseX(y)) < 14) continue;
    if (x > flat.x0 - 8 && x < flat.x1 + 8 && y > flat.y0 - 8 && y < flat.y1 + 8) continue;
    pores.push({ x, y, amp: (rng() < 0.5 ? -1 : 1) * (0.04 + 0.05 * rng()), sigma: 1.6 + 1.4 * rng() });
  }
  pores.forEach((pore, index) => {
    const reach = Math.ceil((3 * pore.sigma) / cell) + 1;
    const cx = Math.floor(pore.x / cell);
    const cy = Math.floor(pore.y / cell);
    for (let by = cy - reach; by <= cy + reach; by += 1) {
      for (let bx = cx - reach; bx <= cx + reach; bx += 1) {
        if (bx < 0 || by < 0 || bx >= cells || by >= cells) continue;
        buckets[by * cells + bx].push(index);
      }
    }
  });
  return {
    size,
    flat,
    creaseX,
    sample(x, y) {
      const d = x - creaseX(y);
      let value = BACKGROUND - CREASE_DEPTH * Math.exp(-(d * d) / (2 * CREASE_SIGMA * CREASE_SIGMA));
      const bx = Math.floor(x / cell);
      const by = Math.floor(y / cell);
      if (bx >= 0 && by >= 0 && bx < cells && by < cells) {
        for (const index of buckets[by * cells + bx]) {
          const pore = pores[index];
          const dx = x - pore.x;
          const dy = y - pore.y;
          value += pore.amp * Math.exp(-(dx * dx + dy * dy) / (2 * pore.sigma * pore.sigma));
        }
      }
      return value;
    },
  };
}

interface RenderOptions {
  /** Content displacement from the scene: frame(p) = scene(p − shift). */
  readonly shiftX: number;
  readonly shiftY: number;
  readonly noise: number;
  readonly rng: () => number;
  /** Sub-samples per pixel side — the sensor integrates over its pixel. */
  readonly subsamples: number;
  /** Optional scene→frame affine (a, b, c, d) on top of the shift, about the centre. */
  readonly affine?: { a: number; b: number; c: number; d: number };
  readonly gain?: number;
}

function renderFrame(scene: Scene, options: RenderOptions): Float32Array {
  const size = scene.size;
  const out = new Float32Array(size * size);
  const n = options.subsamples;
  const inv = 1 / (n * n);
  const half = size / 2;
  // Inverse of the (optional) affine, so frame pixels pull from the right scene point.
  let inverse: { a: number; b: number; c: number; d: number } | null = null;
  if (options.affine !== undefined) {
    const { a, b, c, d } = options.affine;
    const det = a * d - b * c;
    inverse = { a: d / det, b: -b / det, c: -c / det, d: a / det };
  }
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let sum = 0;
      for (let sy = 0; sy < n; sy += 1) {
        for (let sx = 0; sx < n; sx += 1) {
          let px = x + (sx + 0.5) / n - options.shiftX;
          let py = y + (sy + 0.5) / n - options.shiftY;
          if (inverse !== null) {
            const rx = px - half;
            const ry = py - half;
            px = inverse.a * rx + inverse.b * ry + half;
            py = inverse.c * rx + inverse.d * ry + half;
          }
          sum += scene.sample(px, py);
        }
      }
      let value = sum * inv * (options.gain ?? 1) + options.noise * gaussian(options.rng);
      if (value < 0) value = 0;
      else if (value > 1) value = 1;
      out[y * size + x] = value;
    }
  }
  return out;
}

/** Standard deviation of a plane over a rectangle. */
function stdOver(plane: Float32Array, side: number, x0: number, y0: number, x1: number, y1: number): number {
  let sum = 0;
  let sumSq = 0;
  let count = 0;
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      const v = plane[y * side + x];
      sum += v;
      sumSq += v * v;
      count += 1;
    }
  }
  const mean = sum / count;
  return Math.sqrt(Math.max(0, sumSq / count - mean * mean));
}

/**
 * Crease full width at half depth, median over rows: per row, the minimum near the crease, the
 * local background ±10 frame px away, and the two half-depth crossings by linear interpolation
 * between samples. `unit` is the plane's pixel pitch in frame px (1 for a frame, 0.5 for the 2×
 * fusion), so widths compare in one unit. Same estimator for every plane — the test's honesty.
 */
function creaseFwhm(plane: Float32Array, side: number, unit: number, creaseX: (y: number) => number, rowsFrom: number, rowsTo: number): number {
  const widths: number[] = [];
  for (let row = rowsFrom; row < rowsTo; row += 1) {
    const yFrame = (row + 0.5) * unit;
    const centre = creaseX(yFrame) / unit - 0.5;
    const from = Math.max(1, Math.floor(centre - 6 / unit));
    const to = Math.min(side - 2, Math.ceil(centre + 6 / unit));
    let minAt = from;
    for (let x = from; x <= to; x += 1) if (plane[row * side + x] < plane[row * side + minAt]) minAt = x;
    const reach = Math.round(10 / unit);
    const bgL = plane[row * side + Math.max(0, minAt - reach)];
    const bgR = plane[row * side + Math.min(side - 1, minAt + reach)];
    const background = (bgL + bgR) / 2;
    const depth = background - plane[row * side + minAt];
    if (depth < 0.05) continue;
    const half = plane[row * side + minAt] + depth / 2;
    let left = minAt;
    while (left > 0 && plane[row * side + left] < half) left -= 1;
    let right = minAt;
    while (right < side - 1 && plane[row * side + right] < half) right += 1;
    const lv = plane[row * side + left];
    const lv1 = plane[row * side + left + 1];
    const rv = plane[row * side + right];
    const rv1 = plane[row * side + right - 1];
    const leftX = left + (lv1 === lv ? 0 : (half - lv) / (lv1 - lv));
    const rightX = right - (rv1 === rv ? 0 : (half - rv) / (rv1 - rv));
    widths.push((rightX - leftX) * unit);
  }
  widths.sort((a, b) => a - b);
  return widths.length === 0 ? NaN : widths[widths.length >> 1];
}

/* ------------------------------ 1. Flags and constants ------------------------------ */

{
  ok(DEFAULT_SCAN_FLAGS.superRes === false, "superRes ships off");
  ok(allFlagsOff(DEFAULT_SCAN_FLAGS), "every flag, superRes included, ships off");
  ok(SCAN_FLAG_NAMES.includes("superRes"), "superRes is in the HUD's flag list");
  ok(SCAN_FLAG_LABELS.superRes.length > 0, "and has a label");
  ok(SUPERRES_RING_SIZE === 12 && SUPERRES_MIN_FRAMES === 4, "K = 12 kept, ≥ 4 required");
  ok(SUPERRES_VOL_FLOOR === stillCapture.STILL_VOL_FLOOR, "the ring's VoL floor is the still regrade's floor");
}

/* ------------------------------ 2. The pose guard moved, not changed ------------------------------ */

{
  ok(stillCapture.poseSignature === poseSignature, "dev still-capture re-exports the production poseSignature");
  ok(stillCapture.findPoseDuplicate === findPoseDuplicate, "and the production findPoseDuplicate");
  ok(stillCapture.POSE_DUP_RADIUS === POSE_DUP_RADIUS, "with the same radius");
}

/* ------------------------------ 3. Small pieces ------------------------------ */

{
  // Parabolic peak interpolation: exact on a true parabola, clamped, and zero when flat.
  const at = (offset: number): [number, number, number] => [(-1 - offset) ** 2, offset ** 2, (1 - offset) ** 2];
  for (const truth of [-0.4, -0.1, 0, 0.25, 0.45]) {
    const [m, z, p] = at(truth);
    ok(Math.abs(parabolicOffset(m, z, p) - truth) < 1e-9, `parabola minimum at ${truth} recovered`);
  }
  ok(parabolicOffset(1, 1, 1) === 0, "a flat SAD carries no sub-pixel information");
  ok(parabolicOffset(0, 1, 0) === 0, "a concave SAD is refused rather than extrapolated");
  ok(Math.abs(parabolicOffset(10, 0, 0.1)) <= 0.5, "the offset is clamped to half a pixel");

  // Box downsample + validity rule.
  const four = Float32Array.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]);
  const two = new Float32Array(4);
  boxDownsample(four, 4, 2, two);
  ok(two[0] === 3.5 && two[3] === 13.5, "box downsample averages each 2×2");
  const valid = new Uint8Array(16).fill(1);
  valid[5] = 0;
  const lowValid = new Uint8Array(4);
  boxDownsampleValidity(valid, 4, 2, lowValid);
  ok(lowValid[0] === 0 && lowValid[1] === 1 && lowValid[2] === 1 && lowValid[3] === 1, "one invalid source invalidates its destination pixel");

  // Trimmed weighted mean: outliers go once there are enough samples, never before.
  const order = new Int32Array(SUPERRES_RING_SIZE);
  const out = new Float64Array(2);
  const twelve = Float32Array.from([0.5, 0.52, 0.49, 0.51, 0.5, 0.48, 0.5, 0.51, 0.99, 0.5, 0.02, 0.5]);
  const ones = new Float32Array(SUPERRES_RING_SIZE).fill(1);
  trimmedWeightedMean(twelve, ones, 12, order, out);
  ok(Math.abs(out[0] - 0.5) < 0.012, `twelve samples with a flash and a dropout average to the clean value (${out[0].toFixed(4)})`);
  ok(out[1] === 8, "two samples dropped from each end of twelve");
  const five = Float32Array.from([0.5, 0.5, 0.5, 0.5, 0.99]);
  trimmedWeightedMean(five, ones, 5, order, out);
  ok(out[0] > 0.55 && out[1] === 5, `fewer than ${SUPERRES_TRIM_MIN_SAMPLES} samples are not trimmed — a coin toss is not robustness`);
  trimmedWeightedMean(five, ones, 0, order, out);
  ok(out[0] === 0 && out[1] === 0, "no samples, no value, zero weight");

  // Illumination kernel scaling.
  ok(illuminationWidthsFor(MASK_SIZE).join() === ILLUM_BOX_WIDTHS.join(), "at the working grid the kernel is the worker's");
  ok(illuminationWidthsFor(1024).join() === "65,81,81", `at 1024 the radii scale ×8 and stay odd (${illuminationWidthsFor(1024).join()})`);
  const flatPlane = new Float32Array(64 * 64).fill(0.6);
  const flatWeight = new Float32Array(64 * 64).fill(1);
  flatWeight[0] = 0;
  const flatOut = new Float32Array(64 * 64);
  const bypassed = normaliseTexture(flatPlane, 64, flatWeight, flatOut);
  ok(!bypassed && Math.abs(flatOut[2000] - ILLUM_PEDESTAL) < 1e-5, "flat skin normalises to the pedestal");
  ok(flatOut[0] === ILLUM_PEDESTAL, "a pixel no frame reached reads as the pedestal, like the worker's out-of-crop fill");

  // Affine least squares: exact on exact data, null when degenerate.
  const truth = { a: 1.01, b: 0.004, c: -0.003, d: 0.99, tx: 1.5, ty: -0.7 };
  const from: Point2[] = [
    { x: 64, y: 64 },
    { x: 192, y: 64 },
    { x: 64, y: 192 },
    { x: 192, y: 192 },
    { x: 128, y: 100 },
  ];
  const to = from.map((p) => ({ x: truth.a * p.x + truth.b * p.y + truth.tx, y: truth.c * p.x + truth.d * p.y + truth.ty }));
  const fitted = fitAffine(from, to);
  ok(fitted !== null && Math.abs(fitted.a - truth.a) < 1e-9 && Math.abs(fitted.ty - truth.ty) < 1e-7, "an exact affine is recovered exactly");
  ok(fitAffine(from.slice(0, 2), to.slice(0, 2)) === null, "two pairs cannot fix an affine");
  ok(fitAffine([{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 2 }], [{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 2 }]) === null, "collinear pairs are degenerate");
}

/* ------------------------------ 4. The synthetic sequence ------------------------------ */

const SIZE = 256;
const scene = makeScene(SIZE, 7);
const SHIFTS: readonly (readonly [number, number])[] = [
  [0, 0],
  [0.37, -0.48],
  [-0.62, 0.71],
  [1.13, 0.24],
  [-1.41, -1.15],
  [0.85, 1.9],
  [2.21, -0.33],
  [-0.19, 0.62],
  [0.5, -2.05],
  [-2.7, 0.08],
  [1.66, 1.37],
  [-0.93, -0.77],
];
const NOISE = 0.02;
const FLASH_FRAME = 3;
const flash = { cx: Math.round(SIZE * 0.78), cy: Math.round(SIZE * 0.22), r: 14 };

const rng = makeRng(2026);
const frames: SuperResFrame[] = SHIFTS.map(([shiftX, shiftY], index) => {
  const luma = renderFrame(scene, { shiftX, shiftY, noise: NOISE, rng, subsamples: 3 });
  if (index === FLASH_FRAME) {
    // A specular flash: one frame, one bright disc, where there is no crease.
    for (let y = 0; y < SIZE; y += 1) {
      for (let x = 0; x < SIZE; x += 1) {
        if (Math.hypot(x - flash.cx, y - flash.cy) <= flash.r) luma[y * SIZE + x] = Math.min(1, luma[y * SIZE + x] + 0.35);
      }
    }
  }
  // Anchors jitter with the shift, so the median-anchor choice has something to choose from.
  const anchors: Point2[] = [
    { x: 400 + shiftX * 2, y: 700 + shiftY * 2 },
    { x: 250 + shiftX * 2, y: 600 + shiftY * 2 },
    { x: 260 + shiftX * 2, y: 300 + shiftY * 2 },
    { x: 560 + shiftX * 2, y: 360 + shiftY * 2 },
  ];
  return { luma, valid: null, anchors, timestampMs: 1000 + index * 200, vol: palmQuadVol(luma, SIZE) };
});

{
  const reference = medianAnchorReference(frames);
  ok(reference === 0, `the median-anchor reference is the unshifted frame (chose ${reference})`);

  const t0 = performance.now();
  const fusion = fuseFrames(frames, SIZE, 2);
  const fuseMs = performance.now() - t0;
  ok(fusion !== null, "twelve registrable frames fuse");
  if (fusion === null) throw new Error("unreachable");
  ok(fusion.effectiveFrames === SHIFTS.length, `every frame contributed (${fusion.effectiveFrames}/${SHIFTS.length})`);
  ok(fusion.texture.length === (SIZE * 2) ** 2 && fusion.weight.length === fusion.texture.length, "texture and weight are on the 2× grid");
  ok(fusion.referenceIndex === 0, "the fusion is addressed to the reference frame");

  /*
   * Registration recovers the known shifts to a fraction of a pixel. What the splat USES is the
   * affine (the block fit); the global translation is only its seed — so the affine's implied
   * displacement at the frame centre is the number judged, and the seed is held to a looser bound.
   */
  let worst = 0;
  let worstSeed = 0;
  for (let k = 0; k < SHIFTS.length; k += 1) {
    const r = fusion.registrations[k];
    ok(r.accepted, `frame ${k} registered`);
    const c = SIZE / 2;
    const impliedX = c - (r.affine.a * c + r.affine.b * c + r.affine.tx);
    const impliedY = c - (r.affine.c * c + r.affine.d * c + r.affine.ty);
    worst = Math.max(worst, Math.abs(impliedX - SHIFTS[k][0]), Math.abs(impliedY - SHIFTS[k][1]));
    worstSeed = Math.max(worstSeed, Math.abs(r.shiftX - SHIFTS[k][0]), Math.abs(r.shiftY - SHIFTS[k][1]));
  }
  ok(worst < 0.15, `sub-pixel registration: worst error of the affine used for splatting ${worst.toFixed(3)} px (< 0.15)`);
  ok(worstSeed < 0.35, `and of the global seed ${worstSeed.toFixed(3)} px (< 0.35)`);
  ok(
    fusion.registrations.slice(1).every((r) => r.blocksUsed >= 3 || r.blocksUsed === 0),
    "each frame either fitted an affine over ≥ 3 blocks or fell back to its translation",
  );

  /* Noise: the fused luma is far quieter than any single frame in the flat patch. */
  const { flat } = scene;
  const singleStds = frames.map((f) => stdOver(f.luma, SIZE, flat.x0, flat.y0, flat.x1, flat.y1));
  const fusedStd = stdOver(fusion.luma, SIZE * 2, flat.x0 * 2 + 2, flat.y0 * 2 + 2, flat.x1 * 2 - 2, flat.y1 * 2 - 2);
  const bestSingle = Math.min(...singleStds);
  ok(
    fusedStd <= 0.6 * bestSingle,
    `fused noise std ${fusedStd.toFixed(4)} vs best single ${bestSingle.toFixed(4)} — ${((1 - fusedStd / bestSingle) * 100).toFixed(0)}% lower (≥ 40%)`,
  );

  /* Specular flash: present in one frame, absent from the fusion. */
  const flashedValue = frames[FLASH_FRAME].luma[flash.cy * SIZE + flash.cx];
  const fusedAtFlash = fusion.luma[flash.cy * 2 * SIZE * 2 + flash.cx * 2];
  ok(flashedValue > 0.9, `the flash is real in frame ${FLASH_FRAME} (${flashedValue.toFixed(3)})`);
  ok(Math.abs(fusedAtFlash - BACKGROUND) < 0.03, `and rejected by the robust mean (fused ${fusedAtFlash.toFixed(3)} vs background ${BACKGROUND})`);

  /*
   * Sharpness: the fused crease profile is narrower than in ANY single frame, median over rows.
   *
   * Read the margin honestly: it is small (measured ~0.5%). Bilinear shift-and-add at 2× carries
   * the tent kernel's blur (~0.04 px² at the source scale), which nearly cancels the anti-aliasing
   * gain over a 1-px-sampled frame; what the fusion removes decisively is noise and one-frame
   * artefacts, measured above. At the detector's 128 grid — box-reduced from either — the widths
   * are equal; sharpness there is not what this feature buys.
   */
  const rowsFrom = Math.round(SIZE * 0.2);
  const rowsTo = Math.round(SIZE * 0.8);
  const singleWidths = frames.map((f) => creaseFwhm(f.luma, SIZE, 1, scene.creaseX, rowsFrom, rowsTo));
  const fusedWidth = creaseFwhm(fusion.luma, SIZE * 2, 0.5, scene.creaseX, rowsFrom * 2, rowsTo * 2);
  const narrowestSingle = Math.min(...singleWidths);
  ok(Number.isFinite(fusedWidth) && singleWidths.every(Number.isFinite), "FWHM measured on every plane");
  ok(
    fusedWidth < narrowestSingle,
    `fused crease FWHM ${fusedWidth.toFixed(3)} px < narrowest single ${narrowestSingle.toFixed(3)} px (singles ${singleWidths.map((w) => w.toFixed(2)).join(" ")})`,
  );
  const trueWidth = 2.355 * Math.sqrt(CREASE_SIGMA * CREASE_SIGMA + 1 / 12);
  ok(fusedWidth < trueWidth * 1.15, `and within 15% of the pixel-integrated truth ${trueWidth.toFixed(3)} px — sharper by measurement, not by artefact`);

  /* Normalised texture: pedestal-centred where flat, crease well below it. */
  const flatTexture = fusion.texture[(flat.y0 * 2 + 20) * SIZE * 2 + flat.x0 * 2 + 20];
  ok(Math.abs(flatTexture - ILLUM_PEDESTAL) < 0.03, `flat skin sits on the pedestal in the texture (${flatTexture.toFixed(3)})`);
  const creaseCol = Math.round(scene.creaseX(SIZE / 2) * 2 - 0.5);
  const creaseTexture = fusion.texture[SIZE * SIZE * 2 + creaseCol];
  ok(creaseTexture < ILLUM_PEDESTAL - 0.15, `the crease reads well below it (${creaseTexture.toFixed(3)})`);
  ok(fusion.weight.every((w) => w >= 0) && fusion.weight[SIZE * SIZE * 2 + creaseCol] > 1, "weights accumulate where frames landed");

  console.log(
    `  fusion of ${SHIFTS.length} frames at ${SIZE}→${SIZE * 2}: ${fuseMs.toFixed(0)} ms · worst shift error ${worst.toFixed(3)} px · ` +
      `noise ${bestSingle.toFixed(4)}→${fusedStd.toFixed(4)} · FWHM ${narrowestSingle.toFixed(3)}→${fusedWidth.toFixed(3)} px`,
  );
}

/* ------------------------------ 5. Never fabricated ------------------------------ */

{
  ok(fuseFrames(frames.slice(0, 3), SIZE, 2) === null, "three frames → null, the caller falls back to its best single frame");
  ok(fuseFrames([], SIZE, 2) === null, "no frames → null");
  // Frames that cannot register (no overlap with the reference) do not count toward the minimum.
  const blank = (): SuperResFrame => ({ luma: new Float32Array(SIZE * SIZE), valid: new Uint8Array(SIZE * SIZE), anchors: frames[0].anchors, vol: 0 });
  ok(fuseFrames([frames[0], frames[1], blank(), blank()], SIZE, 2) === null, "four offered but only two registrable → null, never a two-frame 'fusion'");
  const pinned = fuseFrames(frames.slice(0, 5), SIZE, 2, { referenceIndex: 2 });
  ok(pinned !== null && pinned.referenceIndex === 2, "the reference can be pinned (the eval pins the labelled still)");
  if (pinned !== null) {
    ok(
      Math.abs(pinned.registrations[0].shiftX - (SHIFTS[0][0] - SHIFTS[2][0])) < 0.15,
      "and shifts are then measured relative to that frame",
    );
  }
}

/* ------------------------------ 6. Affine registration ------------------------------ */

{
  const affine = { a: 1.006, b: 0.003, c: -0.002, d: 0.995 };
  const warped: SuperResFrame = {
    luma: renderFrame(scene, { shiftX: 0.4, shiftY: -0.3, noise: NOISE, rng: makeRng(9), subsamples: 3, affine }),
    valid: null,
    anchors: frames[0].anchors,
    vol: 0,
  };
  const fusion = fuseFrames([frames[0], warped, frames[1], frames[2]], SIZE, 2, { referenceIndex: 0 });
  ok(fusion !== null, "a gently warped frame still fuses");
  if (fusion !== null) {
    const r = fusion.registrations[1];
    ok(r.accepted && r.blocksUsed >= 3, `the warped frame fitted an affine over ${r.blocksUsed} blocks`);
    // Truth: frame(p) = scene(inverse(p − shift − c) + c); mapping frame→scene applied to corners.
    const det = affine.a * affine.d - affine.b * affine.c;
    const inv = { a: affine.d / det, b: -affine.b / det, c: -affine.c / det, d: affine.a / det };
    const half = SIZE / 2;
    let worst = 0;
    for (const p of [{ x: 40, y: 40 }, { x: SIZE - 40, y: 40 }, { x: 40, y: SIZE - 40 }, { x: SIZE - 40, y: SIZE - 40 }]) {
      const rx = p.x - 0.4 - half;
      const ry = p.y + 0.3 - half;
      const truthX = inv.a * rx + inv.b * ry + half;
      const truthY = inv.c * rx + inv.d * ry + half;
      const gotX = r.affine.a * p.x + r.affine.b * p.y + r.affine.tx;
      const gotY = r.affine.c * p.x + r.affine.d * p.y + r.affine.ty;
      worst = Math.max(worst, Math.hypot(gotX - truthX, gotY - truthY));
    }
    ok(worst < 0.35, `affine registration error at the corners ${worst.toFixed(3)} px (< 0.35) — a translation alone would be off by ~1 px there`);
  }
}

/* ------------------------------ 7. The keep-ring ------------------------------ */

{
  const side = 64;
  const ring = new FrameRing(side, SUPERRES_RING_SIZE);
  const width = 1280;
  const baseAnchors: Point2[] = [
    { x: 640, y: 600 },
    { x: 480, y: 520 },
    { x: 500, y: 300 },
    { x: 780, y: 330 },
  ];
  const sharpFrame = (seed: number, amplitude: number): Float32Array => {
    const r = makeRng(seed);
    const plane = new Float32Array(side * side);
    for (let i = 0; i < plane.length; i += 1) plane[i] = 0.5 + amplitude * (r() - 0.5);
    return plane;
  };
  const soft = new Float32Array(side * side).fill(0.5);
  ok(ring.offer(soft, null, baseAnchors, null, 4, 0, width).reason === "soft", "a soft crop (VoL below the floor) is refused");
  ok(ring.count === 0, "and nothing was stored");

  let t = 0;
  const vols: number[] = [];
  for (let i = 0; i < SUPERRES_RING_SIZE; i += 1) {
    t += 200;
    const offer = ring.offer(sharpFrame(100 + i, 0.2 + 0.02 * i), null, baseAnchors, null, 4, t, width);
    ok(offer.accepted, `sharp frame ${i} admitted (VoL ${offer.vol.toFixed(0)})`);
    vols.push(offer.vol);
  }
  ok(ring.count === SUPERRES_RING_SIZE, "the ring holds K frames");
  const softest = Math.min(...vols);
  t += 200;
  const dull = ring.offer(sharpFrame(300, 0.19), null, baseAnchors, null, 4, t, width);
  ok(!dull.accepted && dull.reason === "not-sharper", "a full ring refuses a frame no sharper than its softest");
  t += 200;
  const keen = ring.offer(sharpFrame(301, 0.6), null, baseAnchors, null, 4, t, width);
  ok(keen.accepted && ring.count === SUPERRES_RING_SIZE, "…and replaces the softest with a sharper one");
  ok(ring.frames().every((f) => (f.vol ?? 0) > softest), "the softest frame is the one that left");
  ok(ring.sharpest() >= 0 && (ring.frames()[ring.sharpest()].vol ?? 0) >= keen.vol - 1e-6, "sharpest() names the new frame");

  // Age: past the window the oldest frame goes even to a softer newcomer.
  const aged = ring.offer(sharpFrame(302, 0.19), null, baseAnchors, null, 4, t + SUPERRES_RING_MAX_AGE_MS + 1, width);
  ok(aged.accepted, "an over-age frame is replaced regardless of sharpness");

  // Pose change: a frame from elsewhere restarts the ring with itself as the seed.
  const moved = baseAnchors.map((p) => ({ x: p.x + POSE_DUP_RADIUS * width * 2, y: p.y }));
  const newPose = ring.offer(sharpFrame(303, 0.3), null, moved, null, 4, t + 400, width);
  ok(newPose.accepted && newPose.reason === "new-pose" && ring.count === 1, "a new pose restarts the ring (fusing across a tilt blurs a palm that is not a plane)");

  // Convention change: likewise.
  const newConvention = ring.offer(sharpFrame(304, 0.3), null, moved, null, 5, t + 600, width);
  ok(newConvention.accepted && newConvention.reason === "new-convention" && ring.count === 1 && ring.convention === 5, "a 4↔5 anchor switch restarts the ring — a different canonical space");

  // Storage is preallocated and returned as views, so a later offer overwrites the same memory.
  const before = ring.frames()[0].luma;
  ring.reset();
  ring.offer(sharpFrame(305, 0.3), null, moved, null, 5, t + 800, width);
  ok(ring.frames()[0].luma.buffer === before.buffer, "frames are views over preallocated storage, never fresh allocations");
}

/* ------------------------------ 8. Detect once on the texture ------------------------------ */

{
  // A 256 luma with a real (wide) crease, as the worker would hand the detector after the box reduce.
  const wide = makeScene(256, 11);
  const luma = renderFrame(wide, { shiftX: 0, shiftY: 0, noise: 0.005, rng: makeRng(3), subsamples: 1 });
  // Widen the crease for the detector's scale: blend a 6-px-wide dark band along the same path.
  for (let y = 0; y < 256; y += 1) {
    const cx = wide.creaseX(y);
    for (let x = 0; x < 256; x += 1) {
      const d = x - cx;
      luma[y * 256 + x] -= 0.2 * Math.exp(-(d * d) / (2 * 3 * 3));
    }
  }
  const mask = detectOnTexture(luma, 256, null, { wantContract: false, convention: 4 });
  ok(mask.width === MASK_SIZE && mask.all.length === MASK_SIZE * MASK_SIZE, "the mask is at the working size");
  ok(mask.all.every((v) => v >= 0 && v <= 1), "probabilities are in [0, 1]");
  ok(mask.contract === undefined, "no contract plane unless asked");
  const col = Math.round(wide.creaseX(128) / 2);
  const onCrease = mask.all[64 * MASK_SIZE + col];
  const offCrease = mask.all[64 * MASK_SIZE + col + 30];
  ok(onCrease > 0.5 && onCrease > offCrease + 0.3, `the crease is detected on the texture (on ${onCrease.toFixed(2)}, off ${offCrease.toFixed(2)})`);
  const withContract = detectOnTexture(luma, 256, null, { wantContract: true, convention: 4, backend: "superres" });
  ok(withContract.contract !== undefined && withContract.contract.length === MASK_SIZE * MASK_SIZE, "the contract plane rides along when asked");
  ok(withContract.backend === "superres" && withContract.stages?.median === null, "no temporal composite — the fusion IS the composite");
  assert.throws(() => detectOnTexture(luma, 200, null), /multiple/, "a texture that is not a multiple of the working size is refused");
}

/* ------------------------------ 9. The eval's +superres post ------------------------------ */

const makeStill = (index: number, duplicateOf?: number, stillVol = 140): CaptureStillRecord => ({
  index,
  rawFile: rawFileName(index),
  cropFile: cropFileName(index),
  capturePath: "canvas-fallback",
  width: 1920,
  height: 1080,
  landmarks: Array.from({ length: 21 }, (_, i) => ({ x: i / 21, y: i / 21, z: 0 })),
  anchors: [
    [960 + index, 900],
    [700 + index, 820],
    [640 + index, 400],
    [1100 + index, 410],
  ],
  quality: { score: 0.8, ok: true, issues: [], luma: 0.5, clipped: 0, jitter: 0.001, sharpness: 120 },
  poseAngle: { rollDeg: 1.0, windingStrength: 0.4 },
  trackSettings: {},
  capturedAt: `2026-09-06T00:0${index}:00.000Z`,
  stillVol,
  attempts: 1,
  ...(duplicateOf !== undefined ? { duplicateOf } : {}),
});

{
  ok(POSTS.includes("superres"), "+superres is a post stage");
  const sessionCase = (stillIndex: number): EvalCase => ({
    id: `s/label-${stillIndex}`,
    source: "session",
    hand: "right",
    imagePath: "",
    canonicalSize: 512,
    anchors: [],
    lines: {},
    meta: {},
    sessionDir: "/nowhere",
    stillIndex,
  });
  const legacy: EvalCase = { id: "legacy", source: "legacy", hand: "unknown", imagePath: "", canonicalSize: 256, anchors: [], lines: {}, meta: {} };
  ok(/legacy/.test(superResGroupOf(legacy).reason ?? ""), "a legacy case says n/a and why");
  const stills = [makeStill(0), makeStill(1, 0), makeStill(2, 0), makeStill(3), makeStill(4, 0), makeStill(5, 3), makeStill(6, 0)];
  const group = superResGroupOf(sessionCase(2), stills);
  ok(group.reason === undefined && group.root === 0 && group.members.map((s) => s.index).join() === "0,1,2,4,6", "a duplicate's group is its root plus every sibling of that root");
  const thin = superResGroupOf(sessionCase(5), stills);
  ok(thin.reason !== undefined && /only 2/.test(thin.reason), `a thin group says how many it has (${thin.reason})`);
  ok(/not in the session/.test(superResGroupOf(sessionCase(9), stills).reason ?? ""), "an unknown still is n/a with the reason");
}

/* End to end: a real session tree with five pose-duplicate stills rendered from the synthetic scene. */
async function evalEndToEnd(): Promise<void> {
  const size = CANONICAL_LABEL_SIZE;
  const big = makeScene(size, 5);
  const metadata: SessionMetadata = {
    schemaVersion: SESSION_SCHEMA_VERSION,
    sessionId: "session-superres-test",
    hand: "right",
    createdAt: "2026-09-06T00:00:00.000Z",
    canonicalSize: size,
    stills: [makeStill(0), makeStill(1, 0), makeStill(2, 0), makeStill(3, 0), makeStill(4, 0)],
  };
  ok(isSessionMetadata(metadata), "the synthetic session passes the schema");
  const labelState: LabelerState = {
    ...emptyLabelerState("LUMA"),
    lines: {
      heart: { points: [[0.14, 0.25], [0.84, 0.35]], absent: false, confidence: "clear", method: "manual", viewAtCommit: "NATURAL", done: true },
      head: { points: [], absent: true, confidence: "clear", method: "manual", viewAtCommit: "NATURAL", done: true },
      life: { points: [[0.31, 0.28], [0.48, 0.81]], absent: false, confidence: "clear", method: "manual", viewAtCommit: "NATURAL", done: true },
      fate: { points: [], absent: true, confidence: "clear", method: "manual", viewAtCommit: "NATURAL", done: true },
    },
  };
  const repoRoot = mkdtempSync(path.join(tmpdir(), "hastrekha-superres-"));
  try {
    const sessionDir = path.join(repoRoot, "fixtures", "golden", metadata.sessionId);
    mkdirSync(path.join(sessionDir, "labels"), { recursive: true });
    mkdirSync(path.join(sessionDir, "selected"), { recursive: true });
    writeFileSync(path.join(sessionDir, "metadata.json"), JSON.stringify(metadata, null, 2));
    const label = buildLabelFile(labelState, metadata, 0, "test", "2026-09-06T00:10:00.000Z");
    writeFileSync(path.join(sessionDir, "labels", labelFileName(0)), JSON.stringify(label, null, 2));
    const stillShifts: readonly (readonly [number, number])[] = [
      [0, 0],
      [0.4, -0.6],
      [-0.7, 0.3],
      [1.2, 0.8],
      [-0.5, -1.1],
    ];
    const stillRng = makeRng(77);
    for (let index = 0; index < stillShifts.length; index += 1) {
      const luma = renderFrame(big, { shiftX: stillShifts[index][0], shiftY: stillShifts[index][1], noise: 0.02, rng: stillRng, subsamples: 1 });
      const rgba = Buffer.alloc(size * size * 4);
      for (let i = 0; i < size * size; i += 1) {
        const g = Math.max(1, Math.round(luma[i] * 255)); // 1, not 0: black is "outside the frame" by the crop convention
        rgba[i * 4] = g;
        rgba[i * 4 + 1] = g;
        rgba[i * 4 + 2] = g;
        rgba[i * 4 + 3] = 255;
      }
      await sharp(rgba, { raw: { width: size, height: size, channels: 4 } }).png().toFile(path.join(sessionDir, "selected", cropFileName(index)));
    }
    const cases = loadGroundTruthDetailed("fixtures", repoRoot).cases.filter((c) => c.source === "session" && c.skip === undefined);
    ok(cases.length === 1 && cases[0].sessionDir === sessionDir && cases[0].stillIndex === 0, "the adapter records the session dir and still index");
    resetFieldCache();
    const info = await superResInfoOf(cases[0]);
    ok(info.available, `the group fuses (${info.reason ?? "ok"})`);
    ok(info.stillsInGroup === 5 && info.stillsSharp === 5 && info.stillsFused === 5, `5 stills in group, 5 sharp, 5 fused (got ${info.stillsInGroup}/${info.stillsSharp}/${info.stillsFused})`);
    const fused = await computeField(cases[0], { framing: "classical", post: "superres" });
    ok(fused.field !== null && fused.field.length === MASK_SIZE * MASK_SIZE, `the +superres post yields a field (${fused.error ?? "ok"})`);
    ok(fused.notes.some((n) => /5 of 5 sharp still\(s\) fused/.test(n)), "and says what it fused");
    const single = await computeField(cases[0], { framing: "classical", post: "fused" });
    ok(single.field !== null, "the single-still field computes alongside");
    const notClassical = await computeField(cases[0], { framing: "palmquad", post: "superres" }, { modelPath: "x.onnx" });
    ok(notClassical.field === null && /classical-only/.test(notClassical.error ?? ""), "superres is classical-only and says so");
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
}

/* Registration options: the accumulator's search geometry, with the penalty re-sized for luma (documented). */
ok(
  DEFAULT_REGISTRATION.downsample === 2 && DEFAULT_REGISTRATION.search === 4 && DEFAULT_REGISTRATION.refine === 1,
  "registration search geometry is evidence.ts's motion geometry",
);
ok(DEFAULT_REGISTRATION.shiftPenalty === 0.001, "the shift penalty is a tie-breaker, a twentieth of the accumulator's — the noise-floor measurement in superres.ts");

evalEndToEnd()
  .then(() => {
    console.log(`SUPERRES ASSERTIONS PASSED (${assertions})`);
  })
  .catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
