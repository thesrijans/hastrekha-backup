/**
 * Line-segmentation seam.
 *
 * Stage 1 ships a no-op. The interface, the tensor conversion and the reserved line vocabulary are
 * built now so dropping in the real model is a new `Segmenter` implementation and nothing else —
 * no caller, no feature contract and no UI changes.
 *
 * **The contract the ONNX model must satisfy** (milesial-style UNet, `n_channels=3`, `n_classes=1`,
 * exported from `checkpoint_aug_epoch70.pth`):
 *
 * - file       `public/models/palm-lines.onnx`, fetched from {@link ONNX_MODEL_PATH}
 * - input      float32 `[1, 3, 256, 256]`, RGB, NCHW, values in `[0, 1]`
 * - output     float32 `[1, 1, 256, 256]`, raw **logits** — apply sigmoid, see {@link sigmoidInPlace}
 *
 * Because `n_classes` is 1, the model answers "is this pixel a line", not "which line is this".
 * Assigning traces to heart/head/life/fate is the geometry classifier's job, using landmark anchors
 * in rectified-crop space. {@link LineMask.resolves} records that: a 1-class model returns `[]`.
 */
import { RECTIFIED_SIZE, type LineMask, type PalmLineId } from "./types";

export const ONNX_MODEL_PATH = "/models/palm-lines.onnx";
export const ONNX_INPUT_NAME = "input";
export const ONNX_INPUT_SHAPE: readonly number[] = [1, 3, RECTIFIED_SIZE, RECTIFIED_SIZE];
export const ONNX_OUTPUT_SHAPE: readonly number[] = [1, 1, RECTIFIED_SIZE, RECTIFIED_SIZE];

export interface Segmenter {
  /** Stable identifier for the debug HUD, e.g. "noop", "ridge", "unet-onnx". */
  readonly id: string;
  /** False while assets are loading or unavailable; callers must degrade, not throw. */
  readonly ready: boolean;
  /** Execution provider actually in use: "webgpu", "wasm", "loading", "unavailable". */
  readonly backend: string;
  /** Wall-clock milliseconds for the most recent inference. */
  readonly lastInferenceMs: number;
  /** Which lines this implementation can tell apart. Empty means "lines, undifferentiated". */
  readonly resolves: readonly PalmLineId[];
  /** @returns null when the implementation has nothing to offer for this frame. */
  segment(rectified: ImageData): Promise<LineMask | null>;
  dispose(): void;
}

/**
 * Converts a rectified crop to the NCHW float tensor the UNet expects.
 *
 * Channel-planar, not interleaved: all red, then all green, then all blue. Alpha is dropped — the
 * crop is opaque by construction. Exported and pure so the tensor packing is unit-tested here rather
 * than debugged later against a model that silently returns noise for transposed input.
 */
export function imageDataToNchw(image: ImageData): Float32Array {
  const { width, height, data } = image;
  const plane = width * height;
  const out = new Float32Array(3 * plane);
  for (let i = 0; i < plane; i += 1) {
    const at = i * 4;
    out[i] = data[at] / 255;
    out[plane + i] = data[at + 1] / 255;
    out[2 * plane + i] = data[at + 2] / 255;
  }
  return out;
}

/** Logits → probabilities, in place. The checkpoint's final layer is unactivated. */
export function sigmoidInPlace(logits: Float32Array): Float32Array {
  for (let i = 0; i < logits.length; i += 1) logits[i] = 1 / (1 + Math.exp(-logits[i]));
  return logits;
}

/** Wraps a single-channel probability field in the shared mask shape. */
export function toLineMask(
  probabilities: Float32Array,
  resolves: readonly PalmLineId[] = [],
  size: number = RECTIFIED_SIZE,
): LineMask {
  return { width: size, height: size, all: probabilities, resolves };
}

/**
 * The stage-1 implementation: reports itself unready and returns nothing.
 *
 * Deliberately not a fake — returning plausible synthetic lines would let the ticker fire line rules
 * against evidence that does not exist, which is exactly the failure this product cannot afford.
 */
export function createNoopSegmenter(): Segmenter {
  return {
    id: "noop",
    ready: false,
    backend: "none",
    lastInferenceMs: 0,
    resolves: [],
    async segment(): Promise<LineMask | null> {
      return null;
    },
    dispose(): void {
      /* nothing held */
    },
  };
}
