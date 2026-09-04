/**
 * Hybrid line segmenter — the real implementation of the {@link Segmenter} seam.
 *
 * All the work happens in a worker (`segmenter.worker.ts`); this file is the main-thread half: it
 * owns the worker's lifecycle, enforces **one inference in flight**, and drops frames rather than
 * queueing them. A queue would mean the overlay eventually draws a palm from two seconds ago, which
 * is worse than drawing nothing — the mask must always describe roughly what the camera sees now.
 *
 * Since step 6 the worker fuses two detectors: a classical ridge chain (always available, zero
 * assets) and the optional int8 UNet at `public/models/palm-lines.onnx`. A missing model is a
 * configuration, not an error — `ready` still flips true and `backend` reads "ridge-only".
 */
import {
  emptyDiagnostics,
  ONNX_MODEL_PATH,
  type SegmentContext,
  type Segmenter,
  type SegmenterDiagnostics,
} from "./segmenter";
import { type LineMask } from "./types";
import type { WorkerResponse } from "./segmenter.worker";

export const ORT_WASM_PATH = "/ort/";

interface Pending {
  readonly resolve: (mask: LineMask | null) => void;
  readonly reject: (error: Error) => void;
}

export interface OnnxSegmenterOptions {
  readonly modelPath?: string;
  readonly wasmPath?: string;
  /** Fires whenever the worker reports a state change, so the debug HUD can show startup live. */
  readonly onDiagnostics?: (diagnostics: SegmenterDiagnostics) => void;
}

/**
 * Creates the segmenter and starts loading the worker.
 *
 * Resolves as soon as the worker is spawned, not when it is ready — callers keep scanning while it
 * warms up, and `ready` flips when inference is actually possible. Only a catastrophic failure
 * (worker cannot start at all) leaves the segmenter permanently unavailable.
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
  let diagnostics = emptyDiagnostics(modelPath, wasmPath);

  const publish = (next: SegmenterDiagnostics): void => {
    diagnostics = next;
    options.onDiagnostics?.(next);
  };

  try {
    worker = new Worker(new URL("./segmenter.worker.ts", import.meta.url), { type: "module" });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[segmenter] worker could not be created:", error);
    backend = "unavailable";
    publish({ ...diagnostics, phase: "failed", lastError: `worker could not start — ${message}` });
  }

  if (worker !== null) {
    worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const message = event.data;
      if (message.type === "status") {
        publish(message.diagnostics);
        return;
      }
      if (message.type === "ready") {
        ready = true;
        backend = message.backend;
        publish(message.diagnostics);
        return;
      }
      if (message.type === "error") {
        publish(message.diagnostics);
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
        publish(message.diagnostics);
        lastInferenceMs = message.timings.total ?? 0;
        const pending = inFlight;
        inFlight = null;
        pending?.resolve({
          width: message.size,
          height: message.size,
          all: new Float32Array(message.fused),
          ...(message.contract === undefined ? {} : { contract: new Float32Array(message.contract) }),
          resolves: [], // neither detector names lines; the geometry classifier does.
          inferenceMs: lastInferenceMs,
          backend,
          convention: message.convention,
          stages: {
            unet: message.unet === null ? null : new Float32Array(message.unet),
            ridge: new Float32Array(message.ridge),
            frangi: new Float32Array(message.frangi),
            median: message.median === null ? null : new Float32Array(message.median),
            // Applied on the main thread: it is derived from capture state the worker cannot see.
            photometric: null,
          },
          timings: message.timings,
        });
      }
    };

    worker.onerror = (event) => {
      console.error("[segmenter] worker error:", event.message);
      backend = "unavailable";
      ready = false;
      publish({ ...diagnostics, phase: "failed", lastError: `worker crashed — ${event.message}` });
      inFlight?.resolve(null);
      inFlight = null;
    };

    worker.postMessage({ type: "init", modelPath, wasmPath });
  }

  return {
    id: "hybrid",
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
    get diagnostics() {
      return diagnostics;
    },

    async segment(rectified: ImageData, context?: SegmentContext): Promise<LineMask | null> {
      // Drop, never queue. The newest frame is the only one worth spending compute on.
      if (worker === null || !ready || disposed) return null;
      if (inFlight !== null) {
        publish({ ...diagnostics, dropped: diagnostics.dropped + 1 });
        return null;
      }

      const id = nextId;
      nextId += 1;
      // These buffers are transferred, so hand the worker copies — the caller still owns theirs.
      const rgba = new Uint8ClampedArray(rectified.data).buffer;
      const validity = context?.inside === undefined ? undefined : new Uint8Array(context.inside).buffer;
      const rgbaFullHand = context?.fullHand === undefined ? undefined : new Uint8ClampedArray(context.fullHand.rgba).buffer;
      const pqToFullHand = context?.fullHand?.pqToFullHand;

      return new Promise<LineMask | null>((resolve, reject) => {
        inFlight = { resolve, reject };
        const transfers: ArrayBuffer[] = [rgba];
        if (validity !== undefined) transfers.push(validity);
        if (rgbaFullHand !== undefined) transfers.push(rgbaFullHand);
        if (pqToFullHand !== undefined) transfers.push(pqToFullHand);
        worker?.postMessage(
          {
            type: "infer",
            id,
            width: rectified.width,
            height: rectified.height,
            rgba,
            validity,
            convention: context?.convention ?? 4,
            rgbaFullHand,
            pqToFullHand,
            wantContract: context?.wantContract,
          },
          transfers,
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
