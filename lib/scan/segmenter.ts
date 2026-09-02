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

/* ------------------------------ Model fusion ------------------------------- */

export const UNET_WEIGHT = 0.7;
export const RIDGE_BLEND_WEIGHT = 0.3;
/** The ridge floor: what a crease is worth when the UNet is blind to it — or absent entirely. */
export const RIDGE_FLOOR_WEIGHT = 0.55;

/**
 * Combines the UNet's learned probability with the classical ridge field:
 *
 *     lineProbability = max(unet·0.7 + ridge·0.3, ridge·0.55)
 *
 * The blend term trusts the model but lets strong classical evidence nudge it; the floor term
 * guarantees a crease the model missed still surfaces at up to 0.55.
 *
 * **With no UNet the classical field passes through unchanged**, and that is not the same as
 * evaluating the formula with `unet = 0`. Doing that scales the only evidence there is down to 55%
 * of itself, which — against `LINE_THRESHOLD` of 0.45 — silently raises the bar a crease must clear
 * from 0.45 to 0.818. It was the single largest reason the live overlay stayed blank: the model runs
 * on one frame in six, so five masks in six were being attenuated into near-nothing before anything
 * downstream ever saw them. The floor weight is a floor *relative to the model*, not a tax on going
 * without one.
 *
 * Pure, so the formula is unit-tested rather than trusted.
 */
export function combineProbabilities(unet: Float32Array | null, ridge: Float32Array): Float32Array {
  const out = new Float32Array(ridge.length);
  if (unet === null) {
    out.set(ridge);
    return out;
  }
  if (unet.length !== ridge.length) throw new Error("combineProbabilities: field sizes disagree");
  for (let i = 0; i < ridge.length; i += 1) {
    out[i] = Math.max(unet[i] * UNET_WEIGHT + ridge[i] * RIDGE_BLEND_WEIGHT, ridge[i] * RIDGE_FLOOR_WEIGHT);
  }
  return out;
}

/**
 * Everything the segmenter knows about why it is or is not working.
 *
 * Load failures used to die in a `console.warn` inside a worker, where nobody sees them — the only
 * symptom was that lines never appeared. Every step of startup now records itself here and is
 * rendered in the debug HUD, so "no lines" always comes with a reason.
 */
export interface SegmenterDiagnostics {
  readonly phase:
    | "idle"
    | "checking-model"
    | "loading-ort"
    | "creating-session"
    | "warming"
    | "ready"
    | "failed";
  readonly modelPath: string;
  /** HTTP status from the HEAD probe; null before it runs. */
  readonly modelStatus: number | null;
  readonly modelBytes: number | null;
  readonly modelContentType: string | null;
  /** False when the model is absent, or when a dev server answered a 404 with an HTML page. */
  readonly modelOk: boolean;
  readonly wasmPath: string;
  /** Result of probing one vendored ORT wasm file — catches a wasmPaths mismatch directly. */
  readonly wasmProbe: string | null;
  readonly providersTried: readonly string[];
  readonly executionProvider: string | null;
  readonly warmupMs: number | null;
  readonly firstInferenceMs: number | null;
  readonly inferences: number;
  /** Frames dropped because one was already in flight — high is normal, it is the drop-not-queue rule. */
  readonly dropped: number;
  /** Measured median cost of the every-frame detector tier, and the cadence that measurement chose. */
  readonly fastTierMs: number;
  readonly fastTierStride: number;
  /** Resolution the classical detectors ran at, which may be half the crop's. */
  readonly workSize: number;
  readonly classicalStride: number;
  /** Frames currently held in the temporal composite stack. */
  readonly stackFilled: number;
  readonly lastError: string | null;
}

export function emptyDiagnostics(modelPath: string, wasmPath: string): SegmenterDiagnostics {
  return {
    phase: "idle",
    modelPath,
    modelStatus: null,
    modelBytes: null,
    modelContentType: null,
    modelOk: false,
    wasmPath,
    wasmProbe: null,
    providersTried: [],
    executionProvider: null,
    warmupMs: null,
    firstInferenceMs: null,
    inferences: 0,
    dropped: 0,
    fastTierMs: 0,
    fastTierStride: 1,
    workSize: 0,
    classicalStride: 1,
    stackFilled: 0,
    lastError: null,
  };
}

/** What the detectors need to know about a crop beyond its pixels. */
export interface SegmentContext {
  /** Anchor count it was rectified with; a change invalidates the temporal stack. */
  readonly convention: number;
  /** Per-pixel 1 where the crop sampled real frame content. */
  readonly inside?: Uint8Array;
  /**
   * Full-hand UNet framing (flag unetFullHand): the 256² full-hand canonical RGBA and the
   * palm-quad→full-hand Matrix3 as a Float64 buffer. Attached by the client on accepted crops
   * while the flag is on; the worker uses them only on its UNet-stride frames.
   */
  readonly fullHand?: { readonly rgba: Uint8ClampedArray; readonly pqToFullHand: ArrayBuffer };
}

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
  /** Live startup/runtime diagnostics, surfaced in the debug HUD. */
  readonly diagnostics: SegmenterDiagnostics;
  /** @returns null when the implementation has nothing to offer for this frame. */
  segment(rectified: ImageData, context?: SegmentContext): Promise<LineMask | null>;
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
    diagnostics: { ...emptyDiagnostics("(none)", "(none)"), phase: "idle", lastError: "no-op segmenter" },
    async segment(): Promise<LineMask | null> {
      return null;
    },
    dispose(): void {
      /* nothing held */
    },
  };
}
