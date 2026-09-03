/**
 * Crease full-width-at-half-minimum on eval cases — hypothesis H1 measured on real captures.
 *
 * For every present GT line: luma profiles perpendicular to the polyline, sampled every 8 px of
 * arc at the case's native canonical size, and again at 128 (repeated 2×2 box downsample — the
 * same operator the worker uses). Median width + sample count per size. A median under ~1.5 px at
 * 128 means the crease is sub-pixel where the detectors actually run.
 */
import sharp from "sharp";
import path from "node:path";
import { rectifyPalm } from "../../lib/scan/rectify";
import { LABELABLE_LINE_IDS, type LabelableLineId } from "../../lib/scan/dev/session-types";
import type { Point2 } from "../../lib/scan/types";
import type { EvalCase } from "./gt-adapter";

const ARC_STEP_PX = 8;

export interface FwhmLine {
  readonly medianAtNativePx: number;
  readonly nNative: number;
  readonly medianAt128Px: number;
  readonly n128: number;
}

export type FwhmResult = Partial<Record<LabelableLineId, FwhmLine>>;

const makeImageData = (w: number, h: number): ImageData =>
  ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4), colorSpace: "srgb" }) as ImageData;

function downsample2(src: Float32Array, size: number, dst: Float32Array): void {
  const half = size >> 1;
  for (let y = 0; y < half; y += 1) {
    const a = 2 * y * size;
    const b = a + size;
    for (let x = 0; x < half; x += 1) {
      const at = 2 * x;
      dst[y * half + x] = (src[a + at] + src[a + at + 1] + src[b + at] + src[b + at + 1]) * 0.25;
    }
  }
}

function sampleBilinear(plane: Float32Array, size: number, x: number, y: number): number {
  const x0 = Math.max(0, Math.min(size - 2, Math.floor(x)));
  const y0 = Math.max(0, Math.min(size - 2, Math.floor(y)));
  const fx = x - x0;
  const fy = y - y0;
  return (
    plane[y0 * size + x0] * (1 - fx) * (1 - fy) +
    plane[y0 * size + x0 + 1] * fx * (1 - fy) +
    plane[(y0 + 1) * size + x0] * (1 - fx) * fy +
    plane[(y0 + 1) * size + x0 + 1] * fx * fy
  );
}

/** Widths of the dark crease at half-depth, one per profile; profiles every ARC_STEP_PX of arc. */
function widthsAlong(plane: Float32Array, size: number, points: Point2[], reach: number): number[] {
  const widths: number[] = [];
  for (let i = 1; i < points.length; i += 1) {
    const segLen = Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
    const steps = Math.max(1, Math.floor(segLen / ARC_STEP_PX));
    for (let s = 0; s < steps; s += 1) {
      const t = (s + 0.5) / steps;
      const cx = points[i - 1].x + (points[i].x - points[i - 1].x) * t;
      const cy = points[i - 1].y + (points[i].y - points[i - 1].y) * t;
      const nx = -(points[i].y - points[i - 1].y) / segLen;
      const ny = (points[i].x - points[i - 1].x) / segLen;
      const N = Math.ceil(reach * 4);
      const profile: number[] = [];
      for (let k = -N; k <= N; k += 1) {
        const d = (k / N) * reach;
        profile.push(sampleBilinear(plane, size, cx + nx * d, cy + ny * d));
      }
      const band = Math.floor(N * 0.45);
      let minAt = N;
      for (let k = N - band; k <= N + band; k += 1) if (profile[k] < profile[minAt]) minAt = k;
      const background = (profile[0] + profile[1] + profile[profile.length - 1] + profile[profile.length - 2]) / 4;
      const depth = background - profile[minAt];
      if (depth < 0.02) continue;
      const half = profile[minAt] + depth / 2;
      let left = minAt;
      while (left > 0 && profile[left] < half) left -= 1;
      let right = minAt;
      while (right < profile.length - 1 && profile[right] < half) right += 1;
      const stepPx = reach / N;
      const width = (right - left) * stepPx;
      if (width > 0 && width < reach * 2) widths.push(width);
    }
  }
  return widths.sort((a, b) => a - b);
}

const median = (xs: number[]): number => (xs.length === 0 ? NaN : xs[Math.floor(xs.length / 2)]);

/** Measure one case. Skipped cases and absent lines simply do not appear in the result. */
export async function measureFwhm(evalCase: EvalCase): Promise<FwhmResult> {
  const out: FwhmResult = {};
  if (evalCase.skip !== undefined) return out;
  const { data, info } = await sharp(path.resolve(evalCase.imagePath)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const source = { width: info.width, height: info.height, data: new Uint8ClampedArray(data) } as ImageData;
  const anchors: Point2[] = evalCase.anchors.map((a) => ({ x: a[0], y: a[1] }));
  const size = evalCase.canonicalSize;
  const warped = rectifyPalm(source, anchors, size, makeImageData);
  if (warped === null) return out;

  const gray = new Float32Array(size * size);
  for (let i = 0; i < gray.length; i += 1) {
    const at = i * 4;
    gray[i] = (0.2126 * warped.image.data[at] + 0.7152 * warped.image.data[at + 1] + 0.0722 * warped.image.data[at + 2]) / 255;
  }
  // Repeated box halving down to 128 — the worker's operator, applied as many times as needed.
  let current = gray;
  let currentSize = size;
  while (currentSize > 128) {
    const next = new Float32Array((currentSize >> 1) * (currentSize >> 1));
    downsample2(current, currentSize, next);
    current = next;
    currentSize >>= 1;
  }

  for (const id of LABELABLE_LINE_IDS) {
    const line = evalCase.lines[id];
    if (line === undefined || line.absent || line.points.length < 2) continue;
    const native = widthsAlong(
      gray,
      size,
      line.points.map((p) => ({ x: p[0] * size, y: p[1] * size })),
      Math.max(8, size / 32),
    );
    const at128 = widthsAlong(
      current,
      currentSize,
      line.points.map((p) => ({ x: p[0] * currentSize, y: p[1] * currentSize })),
      4,
    );
    out[id] = {
      medianAtNativePx: median(native),
      nNative: native.length,
      medianAt128Px: median(at128),
      n128: at128.length,
    };
  }
  return out;
}
