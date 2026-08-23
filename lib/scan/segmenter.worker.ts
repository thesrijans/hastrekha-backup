/// <reference lib="webworker" />
/**
 * Line-segmentation worker.
 *
 * Inference runs off the main thread so a slow frame stalls the model, never the camera preview or
 * the overlay. That separation is what lets the overlay hold 60fps while inference plods along at 5.
 *
 * Contract with `segmenter-onnx.ts`: one request in flight at a time. This worker does not queue —
 * the caller drops frames instead, because a queue of stale palms is worse than no palm at all.
 */
import * as ort from "onnxruntime-web/webgpu";
import { RECTIFIED_SIZE } from "./types";

export interface InitMessage {
  readonly type: "init";
  readonly modelPath: string;
  readonly wasmPath: string;
}

export interface InferMessage {
  readonly type: "infer";
  readonly id: number;
  readonly width: number;
  readonly height: number;
  /** RGBA bytes from the rectified crop, transferred not copied. */
  readonly rgba: ArrayBuffer;
}

export type WorkerRequest = InitMessage | InferMessage;

export type WorkerResponse =
  | { readonly type: "ready"; readonly backend: string; readonly warmupMs: number }
  | { readonly type: "result"; readonly id: number; readonly probs: ArrayBuffer; readonly inferenceMs: number }
  | { readonly type: "error"; readonly id?: number; readonly message: string };

const INPUT_NAME = "input";
const OUTPUT_NAME = "logits";

let session: ort.InferenceSession | null = null;
let backend = "none";

/** RGBA → planar NCHW float in [0,1]. Alpha is dropped; the crop is opaque by construction. */
function toNchw(rgba: Uint8ClampedArray, width: number, height: number): Float32Array {
  const plane = width * height;
  const out = new Float32Array(3 * plane);
  for (let i = 0; i < plane; i += 1) {
    const at = i * 4;
    out[i] = rgba[at] / 255;
    out[plane + i] = rgba[at + 1] / 255;
    out[2 * plane + i] = rgba[at + 2] / 255;
  }
  return out;
}

function sigmoidInPlace(values: Float32Array): Float32Array {
  for (let i = 0; i < values.length; i += 1) values[i] = 1 / (1 + Math.exp(-values[i]));
  return values;
}

async function createSession(modelPath: string, wasmPath: string): Promise<void> {
  ort.env.wasm.wasmPaths = wasmPath;
  // Threads need cross-origin isolation; without the headers this silently degrades, so ask for
  // what is actually available rather than a number that may be quietly ignored.
  ort.env.wasm.numThreads = Math.min(4, Math.max(1, navigator.hardwareConcurrency ?? 1));
  ort.env.wasm.simd = true;

  const providers: Array<"webgpu" | "wasm"> = [];
  // `navigator.gpu` existing is necessary but not sufficient — adapter request is what really tells.
  if (typeof navigator !== "undefined" && "gpu" in navigator) providers.push("webgpu");
  providers.push("wasm");

  for (const provider of providers) {
    try {
      session = await ort.InferenceSession.create(modelPath, {
        executionProviders: [provider],
        graphOptimizationLevel: "all",
      });
      backend = provider;
      return;
    } catch (error) {
      console.warn(`[segmenter] ${provider} unavailable:`, error);
      session = null;
    }
  }
  throw new Error("no execution provider could load the model");
}

/**
 * One throwaway inference at startup.
 *
 * The first run of a WebGPU session compiles shaders and can take an order of magnitude longer than
 * steady state. Paying that during "warming up" is far better than paying it on the user's first
 * good frame, where it looks like the app has frozen.
 */
async function warmup(): Promise<void> {
  if (session === null) return;
  const plane = RECTIFIED_SIZE * RECTIFIED_SIZE;
  const zeros = new ort.Tensor("float32", new Float32Array(3 * plane), [1, 3, RECTIFIED_SIZE, RECTIFIED_SIZE]);
  await session.run({ [INPUT_NAME]: zeros });
}

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const message = event.data;

  if (message.type === "init") {
    try {
      const startedAt = performance.now();
      await createSession(message.modelPath, message.wasmPath);
      await warmup();
      const response: WorkerResponse = { type: "ready", backend, warmupMs: performance.now() - startedAt };
      self.postMessage(response);
    } catch (error) {
      const response: WorkerResponse = {
        type: "error",
        message: error instanceof Error ? error.message : "segmenter init failed",
      };
      self.postMessage(response);
    }
    return;
  }

  if (message.type === "infer") {
    if (session === null) {
      self.postMessage({ type: "error", id: message.id, message: "session not ready" } satisfies WorkerResponse);
      return;
    }
    try {
      const startedAt = performance.now();
      const rgba = new Uint8ClampedArray(message.rgba);
      const input = new ort.Tensor("float32", toNchw(rgba, message.width, message.height), [
        1,
        3,
        message.height,
        message.width,
      ]);
      const output = await session.run({ [INPUT_NAME]: input });
      const logits = output[OUTPUT_NAME] ?? Object.values(output)[0];
      const probs = sigmoidInPlace(Float32Array.from(logits.data as Float32Array));

      const response: WorkerResponse = {
        type: "result",
        id: message.id,
        probs: probs.buffer as ArrayBuffer,
        inferenceMs: performance.now() - startedAt,
      };
      // Transfer, do not copy: 256KB per frame adds up fast at 8fps.
      self.postMessage(response, [probs.buffer as ArrayBuffer]);
    } catch (error) {
      self.postMessage({
        type: "error",
        id: message.id,
        message: error instanceof Error ? error.message : "inference failed",
      } satisfies WorkerResponse);
    }
  }
};
