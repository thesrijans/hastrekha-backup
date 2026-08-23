/**
 * ONNX line segmenter — the real implementation of the {@link Segmenter} seam.
 *
 * All the work happens in a worker (`segmenter.worker.ts`); this file is the main-thread half: it
 * owns the worker's lifecycle, enforces **one inference in flight**, and drops frames rather than
 * queueing them. A queue would mean the overlay eventually draws a palm from two seconds ago, which
 * is worse than drawing nothing — the mask must always describe roughly what the camera sees now.
 *
 * Model contract (see `segmenter.ts` for the full note): int8 UNet, `n_classes=1`, input
 * `input` float32 [1,3,256,256] RGB in [0,1], output `logits` [1,1,256,256] pre-sigmoid.
 */
import { ONNX_MODEL_PATH, type Segmenter } from "./segmenter";
import { RECTIFIED_SIZE, type LineMask } from "./types";
import type { WorkerResponse } from "./segmenter.worker";

export const ORT_WASM_PATH = "/ort/";

interface Pending {
  readonly resolve: (mask: LineMask | null) => void;
  readonly reject: (error: Error) => void;
}

export interface OnnxSegmenterOptions {
  readonly modelPath?: string;
  readonly wasmPath?: string;
}

/**
 * Creates the segmenter and starts loading the model.
 *
 * Resolves as soon as the worker is spawned, not when the model is ready — callers keep scanning
 * while it warms up, and `ready` flips when inference is actually possible. A missing or broken
 * model leaves `ready` false forever and `segment()` returning null, which the pipeline already
 * treats as "no lines yet" rather than an error.
 */
export function createOnnxSegmenter(options: OnnxSegmenterOptions = {}): Segmenter {
  const modelPath = options.modelPath ?? ONNX_MODEL_PATH;
  const wasmPath = options.wasmPath ?? ORT_WASM_PATH;

  let worker: Worker | null = null;
  let ready = false;
  let backend = "loading";
  let lastInferenceMs = 0;
  let nextId = 1;
  let inFlight: Pending | null = null;
  let disposed = false;

  try {
    worker = new Worker(new URL("./segmenter.worker.ts", import.meta.url), { type: "module" });
  } catch (error) {
    console.error("[segmenter] worker could not be created:", error);
    backend = "unavailable";
  }

  if (worker !== null) {
    worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const message = event.data;
      if (message.type === "ready") {
        ready = true;
        backend = message.backend;
        return;
      }
      if (message.type === "error") {
        // An init failure is terminal; a per-frame failure just loses that frame.
        if (message.id === undefined) {
          backend = "unavailable";
          ready = false;
          console.error("[segmenter] init failed:", message.message);
        } else {
          console.warn("[segmenter] frame failed:", message.message);
        }
        inFlight?.resolve(null);
        inFlight = null;
        return;
      }
      if (message.type === "result") {
        lastInferenceMs = message.inferenceMs;
        const pending = inFlight;
        inFlight = null;
        pending?.resolve({
          width: RECTIFIED_SIZE,
          height: RECTIFIED_SIZE,
          all: new Float32Array(message.probs),
          resolves: [], // 1-class model: it finds lines, it does not name them.
          inferenceMs: message.inferenceMs,
          backend,
        });
      }
    };

    worker.onerror = (event) => {
      console.error("[segmenter] worker error:", event.message);
      backend = "unavailable";
      ready = false;
      inFlight?.resolve(null);
      inFlight = null;
    };

    worker.postMessage({ type: "init", modelPath, wasmPath });
  }

  return {
    id: "unet-onnx",
    get ready() {
      return ready;
    },
    get backend() {
      return backend;
    },
    get lastInferenceMs() {
      return lastInferenceMs;
    },
    resolves: [],

    async segment(rectified: ImageData): Promise<LineMask | null> {
      // Drop, never queue. The newest frame is the only one worth spending a GPU pass on.
      if (worker === null || !ready || disposed || inFlight !== null) return null;

      const id = nextId;
      nextId += 1;
      // The crop's buffer is transferred, so hand the worker a copy — the caller still owns theirs.
      const rgba = new Uint8ClampedArray(rectified.data).buffer;

      return new Promise<LineMask | null>((resolve, reject) => {
        inFlight = { resolve, reject };
        worker?.postMessage(
          { type: "infer", id, width: rectified.width, height: rectified.height, rgba },
          [rgba],
        );
      });
    },

    dispose(): void {
      disposed = true;
      ready = false;
      inFlight?.resolve(null);
      inFlight = null;
      worker?.terminate();
      worker = null;
    },
  };
}
