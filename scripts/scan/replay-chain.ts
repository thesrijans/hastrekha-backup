/**
 * The segmenter worker's per-frame chain, offline — for replaying stills as a
 * live sequence (S1.5) and for calibrating what the live path is fed.
 *
 * Mirrors lib/scan/segmenter.worker.ts's "infer" handler frame by frame, and
 * keeps its STATE across frames the way the worker does: one temporal stack
 * (pushFrame per frame, keyed by the anchor convention), the classical ridge
 * detector every CLASSICAL_STRIDE frames with the last plane reused between,
 * and UNet every UNET_STRIDE frames with classical-only planes between — which
 * is why the live per-frame field alternates, and why a calibration of it has
 * to see both kinds of frame. test/eval/run-pipeline.ts's prepareFromSource is
 * the same chain for a single still; this is that chain as a sequence.
 *
 * Output per frame: the legacy plane (`mask.all`), the contract plane, the
 * working-size gray the accumulator aligns on, the 256 luma its frame weight is
 * measured on, and the crop matrix.
 */
import path from "node:path";
import sharp from "sharp";
import { rectifyPalm, type Matrix3 } from "../../lib/scan/rectify";
import { detectRidges, normalizeResponses } from "../../lib/scan/ridge";
import { contractFrameInto, CONTRACT_DEPTH_DEFAULTS } from "../../lib/scan/contract";
import { detectVessels, sigmasFor } from "../../lib/scan/frangi";
import { normaliseIllumination } from "../../lib/scan/illumination";
import { blendComposite, compositeStack, emptyStack, pushFrame, type FrameStack } from "../../lib/scan/stack";
import { combineProbabilities, sigmoidInPlace, ONNX_INPUT_NAME } from "../../lib/scan/segmenter";
import { MASK_SIZE, RECTIFIED_SIZE, type Point2 } from "../../lib/scan/types";

/** lib/scan/segmenter.worker.ts CLASSICAL_STRIDE / UNET_STRIDE, restated (the worker keeps them private). */
export const CLASSICAL_STRIDE = 3;
export const UNET_STRIDE = 6;

export const WORK = MASK_SIZE;
export const MODEL_PATH = path.resolve("public/models/palm-lines.onnx");

const makeImageData = (w: number, h: number): ImageData =>
  ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4), colorSpace: "srgb" }) as ImageData;

export function downsample2(src: Float32Array, size: number, dst: Float32Array): void {
  const half = size >> 1;
  for (let y = 0; y < half; y += 1) {
    const a = 2 * y * size;
    const b = a + size;
    for (let x = 0; x < half; x += 1) {
      const at = 2 * x;
      dst[y * half + x] = ((src[a + at] ?? 0) + (src[a + at + 1] ?? 0) + (src[b + at] ?? 0) + (src[b + at + 1] ?? 0)) * 0.25;
    }
  }
}

export async function loadImage(file: string): Promise<ImageData> {
  const { data, info } = await sharp(path.resolve(file)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { width: info.width, height: info.height, data: new Uint8ClampedArray(data) } as ImageData;
}

export interface Unet {
  probs256(rgba: Uint8ClampedArray): Promise<Float32Array>;
}

/** The shipped model through onnxruntime-web's wasm backend, as test/eval does. Null when unavailable. */
export async function loadUnet(modelPath = MODEL_PATH): Promise<Unet | null> {
  try {
    const ort = await import("onnxruntime-web");
    ort.env.wasm.numThreads = 1;
    const session = await ort.InferenceSession.create(modelPath, { executionProviders: ["wasm"] });
    return {
      async probs256(rgba) {
        const plane = RECTIFIED_SIZE * RECTIFIED_SIZE;
        const nchw = new Float32Array(3 * plane);
        for (let i = 0; i < plane; i += 1) {
          const at = i * 4;
          nchw[i] = (rgba[at] ?? 0) / 255;
          nchw[plane + i] = (rgba[at + 1] ?? 0) / 255;
          nchw[2 * plane + i] = (rgba[at + 2] ?? 0) / 255;
        }
        const outputs = await session.run({ [ONNX_INPUT_NAME]: new ort.Tensor("float32", nchw, [1, 3, RECTIFIED_SIZE, RECTIFIED_SIZE]) });
        const out = outputs[session.outputNames[0]!]!;
        return sigmoidInPlace(Float32Array.from(out.data as Float32Array));
      },
    };
  } catch {
    return null;
  }
}

export interface ChainFrame {
  /** The legacy per-frame field — what the worker returns as `mask.all`. */
  readonly plane: Float32Array;
  /** The H9 contract plane for the same frame. */
  readonly contract: Float32Array;
  /** Working-size gray (the accumulator's alignment input). */
  readonly gray: Float32Array;
  /** 256 luma, 0–1 (the frame weight's input). */
  readonly luma: Float32Array;
  /** Palm-quad validity at the working size. */
  readonly validity: Uint8Array;
  /** The rectified crop's inside mask at 256. */
  readonly inside: Uint8Array;
  readonly toCrop: Matrix3;
  readonly convention: number;
  readonly usedUnet: boolean;
}

/** The worker's per-session state, and its per-frame step. */
export class ReplayChain {
  private readonly stack: FrameStack = emptyStack(WORK);
  private readonly ridge = new Float32Array(WORK * WORK);
  private readonly depth = new Float32Array(WORK * WORK);
  private frameIndex = 0;
  private ridgeFrames = 0;

  constructor(private readonly unet: Unet | null) {}

  async frame(source: ImageData, anchors: readonly Point2[]): Promise<ChainFrame | null> {
    const warped = rectifyPalm(source, anchors as Point2[], RECTIFIED_SIZE, makeImageData);
    if (warped === null) return null;
    this.frameIndex += 1;
    const size = RECTIFIED_SIZE;
    const plane256 = size * size;
    const workPlane = WORK * WORK;
    const luma = new Float32Array(plane256);
    for (let i = 0; i < plane256; i += 1) {
      const at = i * 4;
      luma[i] = (0.2126 * (warped.image.data[at] ?? 0) + 0.7152 * (warped.image.data[at + 1] ?? 0) + 0.0722 * (warped.image.data[at + 2] ?? 0)) / 255;
    }
    const gray = new Float32Array(workPlane);
    downsample2(luma, size, gray);
    const validity = new Uint8Array(workPlane);
    for (let y = 0; y < WORK; y += 1) {
      const a = 2 * y * size;
      const b = a + size;
      for (let x = 0; x < WORK; x += 1) {
        const at = 2 * x;
        validity[y * WORK + x] = (warped.inside[a + at] ?? 0) & (warped.inside[a + at + 1] ?? 0) & (warped.inside[b + at] ?? 0) & (warped.inside[b + at + 1] ?? 0);
      }
    }

    const normalised = new Float32Array(workPlane);
    const illumination = normaliseIllumination(gray, WORK, normalised, validity);
    pushFrame(this.stack, illumination.out, anchors.length, illumination.bypassed);
    const detectorInput = new Float32Array(illumination.out);
    blendComposite(detectorInput, compositeStack(this.stack));
    const frangi = new Float32Array(workPlane);
    detectVessels(detectorInput, WORK, sigmasFor(WORK), frangi);
    normalizeResponses(frangi);

    if (this.frameIndex % CLASSICAL_STRIDE === 0 || this.ridgeFrames === 0) {
      this.ridge.set(detectRidges(gray, WORK, { depth: this.depth }).probability);
      this.ridgeFrames += 1;
    }

    let unet: Float32Array | null = null;
    if (this.unet !== null && this.frameIndex % UNET_STRIDE === 0) {
      const full = await this.unet.probs256(warped.image.data);
      unet = new Float32Array(workPlane);
      downsample2(full, size, unet);
    }

    const classical = new Float32Array(workPlane);
    for (let i = 0; i < workPlane; i += 1) classical[i] = (this.ridge[i] ?? 0) > (frangi[i] ?? 0) ? (this.ridge[i] ?? 0) : (frangi[i] ?? 0);
    const plane = combineProbabilities(unet, classical);
    const contract = new Float32Array(workPlane);
    contractFrameInto(this.depth, this.ridge, frangi, unet, CONTRACT_DEPTH_DEFAULTS, contract);
    return { plane, contract, gray, luma, validity, inside: Uint8Array.from(warped.inside), toCrop: warped.toCrop, convention: anchors.length, usedUnet: unet !== null };
  }
}

/** Deterministic PRNG (mulberry32), so a replay is reproducible run to run. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A standard normal from a uniform source (Box–Muller). */
export function gaussian(next: () => number): number {
  const u = Math.max(1e-12, next());
  const v = next();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/** A 3×3 box blur of an RGBA image, `passes` times — a motion-blurred frame for the replay. */
export function blurImage(src: ImageData, passes: number): ImageData {
  let cur = new Uint8ClampedArray(src.data);
  const { width, height } = src;
  for (let p = 0; p < passes; p += 1) {
    const out = new Uint8ClampedArray(cur.length);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        for (let c = 0; c < 4; c += 1) {
          let sum = 0;
          let n = 0;
          for (let dy = -1; dy <= 1; dy += 1) {
            const yy = y + dy;
            if (yy < 0 || yy >= height) continue;
            for (let dx = -1; dx <= 1; dx += 1) {
              const xx = x + dx;
              if (xx < 0 || xx >= width) continue;
              sum += cur[(yy * width + xx) * 4 + c] ?? 0;
              n += 1;
            }
          }
          out[(y * width + x) * 4 + c] = sum / n;
        }
      }
    }
    cur = out;
  }
  return { width, height, data: cur, colorSpace: "srgb" } as ImageData;
}
