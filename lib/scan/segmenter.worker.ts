/// <reference lib="webworker" />
/**
 * Line-segmentation worker: classical ridge detection always, UNet refinement when the model loads.
 *
 * Inference runs off the main thread so a slow frame stalls the model, never the camera preview or
 * the overlay. Contract with `segmenter-onnx.ts`: one request in flight at a time; this worker does
 * not queue — the caller drops frames instead, because a queue of stale palms is worse than no palm.
 *
 * **Nothing here fails silently.** Every startup step writes into a diagnostics record that is
 * posted to the main thread and rendered in the debug HUD. An earlier version swallowed load errors
 * in a `console.warn` inside a worker, so a missing model, a bad wasm path and a broken export all
 * looked identical from the outside: no lines, no explanation.
 */
import { emptyDiagnostics, type SegmenterDiagnostics } from "./segmenter";
import { combineProbabilities } from "./segmenter";
import { detectRidges, normalizeResponses, type RidgeTimings } from "./ridge";
import { detectVessels, sigmasFor } from "./frangi";
import { normaliseIllumination } from "./illumination";
import { blendComposite, compositeStack, emptyStack, pushFrame, type FrameStack } from "./stack";
import { RECTIFIED_SIZE } from "./types";

type OrtModule = typeof import("onnxruntime-web/webgpu");
type OrtSession = Awaited<ReturnType<OrtModule["InferenceSession"]["create"]>>;

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
  /** Anchor count this crop was rectified with; a change invalidates the temporal stack. */
  readonly convention: number;
  /** Per-pixel 1 where the crop sampled real frame content, transferred. Optional. */
  readonly validity?: ArrayBuffer;
  /** Set false to skip the UNet entirely on this frame regardless of its stride. */
  readonly wantUnet?: boolean;
}

export type WorkerRequest = InitMessage | InferMessage;

export type WorkerResponse =
  | { readonly type: "status"; readonly diagnostics: SegmenterDiagnostics }
  | { readonly type: "ready"; readonly backend: string; readonly diagnostics: SegmenterDiagnostics }
  | {
      readonly type: "result";
      readonly id: number;
      /** Fused probability field — what the pipeline consumes. */
      readonly fused: ArrayBuffer;
      /** Raw UNet field for the debug HUD; null when running classical-only or on a skipped frame. */
      readonly unet: ArrayBuffer | null;
      /** Black-hat + Gabor, held from its last run when the budget skipped it this frame. */
      readonly ridge: ArrayBuffer;
      /** Frangi vesselness. */
      readonly frangi: ArrayBuffer;
      /** The temporal low-order composite, or null while the stack is still empty. */
      readonly median: ArrayBuffer | null;
      readonly size: number;
      readonly timings: Record<string, number>;
      readonly diagnostics: SegmenterDiagnostics;
    }
  | { readonly type: "error"; readonly id?: number; readonly message: string; readonly diagnostics: SegmenterDiagnostics };

const INPUT_NAME = "input";
const OUTPUT_NAME = "logits";
/** The wasm file whose presence proves `env.wasm.wasmPaths` resolves to the vendored directory. */
const WASM_PROBE_FILE = "ort-wasm-simd-threaded.wasm";

/**
 * Wall-clock the fast tier is allowed per frame.
 *
 * A third of a 30fps frame. The tier runs in a worker, so overrunning does not stall the preview —
 * but it does stall the *next* inference, and a detector that answers about a frame three frames old
 * is worse than one that answers about every second frame promptly.
 */
const FAST_TIER_BUDGET_MS = 8;
/** Frames measured before the cadence is fixed. One would time a cold JIT rather than steady state. */
const FAST_TIER_PROBE_FRAMES = 5;
/**
 * How often the expensive classical detector runs, in frames.
 *
 * Black-hat plus a Gabor bank measured about four times the fast tier's cost, which no per-frame
 * budget accommodates. It is also the slowest-changing evidence in the pipeline — it feeds an
 * exponential average that forgets over several frames — so sampling it at a third of the rate costs
 * far less than the numbers suggest, and its last output is held in between rather than dropped.
 */
const CLASSICAL_STRIDE = 3;
/** How often the UNet runs. It is the most expensive stage and the least time-critical. */
const UNET_STRIDE = 6;

interface Tier {
  readonly size: number;
  readonly gray: Float32Array;
  readonly normalised: Float32Array;
  readonly detectorInput: Float32Array;
  readonly frangi: Float32Array;
  readonly ridge: Float32Array;
  readonly classical: Float32Array;
  readonly stack: FrameStack;
  readonly probes: number[];
  fastMedian: number;
  fastStride: number;
  classicalStride: number;
  ridgeFrames: number;
  lastRidgeTimings: RidgeTimings | null;
}

const tiers = new Map<number, Tier>();
let frameIndex = 0;

function tierFor(size: number): Tier {
  const cached = tiers.get(size);
  if (cached !== undefined) return cached;
  const plane = size * size;
  const fresh: Tier = {
    size,
    gray: new Float32Array(plane),
    normalised: new Float32Array(plane),
    detectorInput: new Float32Array(plane),
    frangi: new Float32Array(plane),
    ridge: new Float32Array(plane),
    classical: new Float32Array(plane),
    stack: emptyStack(size),
    probes: [],
    fastMedian: 0,
    fastStride: 1,
    classicalStride: CLASSICAL_STRIDE,
    ridgeFrames: 0,
    lastRidgeTimings: null,
  };
  tiers.set(size, fresh);
  return fresh;
}

/**
 * Fixes the fast tier's cadence from what it actually costs on this device.
 *
 * Median of the probe frames rather than mean, so one scheduling hiccup during warm-up cannot halve
 * the cadence for the rest of the session. Measured once and then left alone — re-deciding every
 * frame would let the stride oscillate around the budget, which is worse than either choice.
 */
function recordFastCost(tier: Tier, ms: number): void {
  if (tier.probes.length >= FAST_TIER_PROBE_FRAMES) return;
  tier.probes.push(ms);
  if (tier.probes.length < FAST_TIER_PROBE_FRAMES) return;
  const sorted = [...tier.probes].sort((a, b) => a - b);
  tier.fastMedian = sorted[sorted.length >> 1];
  tier.fastStride = tier.fastMedian > FAST_TIER_BUDGET_MS ? 2 : 1;
  // A device that cannot afford the cheap detector every frame certainly cannot afford the dear one
  // at its usual rate either.
  tier.classicalStride = CLASSICAL_STRIDE * tier.fastStride;
}

/** RGBA → 0–1 luma, into a reused buffer. `grayFromRgba` allocates, which a per-frame path cannot. */
function grayInto(rgba: Uint8ClampedArray, out: Float32Array): void {
  for (let i = 0; i < out.length; i += 1) {
    const at = i * 4;
    out[i] = (0.2126 * rgba[at] + 0.7152 * rgba[at + 1] + 0.0722 * rgba[at + 2]) / 255;
  }
}

/**
 * Which crop pixels sampled real frame content.
 *
 * `rectifyPalm` writes literal black outside the source frame, and an illumination estimate that
 * ramps into that black turns the first genuine palm pixels into a bright halo. The main thread
 * knows which pixels were filled; when it says nothing, every pixel is assumed real.
 */
function validityFrom(message: InferMessage): Uint8Array | null {
  return message.validity === undefined ? null : new Uint8Array(message.validity);
}

let ortMod: OrtModule | null = null;
let session: OrtSession | null = null;
let backend = "loading";
let diag: SegmenterDiagnostics = emptyDiagnostics("(unset)", "(unset)");

function patch(changes: Partial<SegmenterDiagnostics>): void {
  diag = { ...diag, ...changes };
  self.postMessage({ type: "status", diagnostics: diag } satisfies WorkerResponse);
}

const describe = (error: unknown): string =>
  error instanceof Error ? `${error.name}: ${error.message}` : String(error);

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

/**
 * Probes the model before loading a byte of ORT.
 *
 * A dev server answers a missing file with `200 text/html` (the app shell), not a 404 — which ORT
 * would then try to parse as a protobuf and fail deep inside wasm with an unreadable message. The
 * content-type check catches that here, where it can be reported plainly.
 */
async function probeModel(path: string): Promise<boolean> {
  patch({ phase: "checking-model" });
  try {
    const response = await fetch(path, { method: "HEAD", cache: "no-store" });
    const contentType = response.headers.get("content-type");
    const length = response.headers.get("content-length");
    const bytes = length === null ? null : Number(length);
    const looksHtml = contentType !== null && contentType.includes("text/html");
    const ok = response.ok && !looksHtml && (bytes === null || bytes > 4096);

    patch({
      modelStatus: response.status,
      modelBytes: bytes,
      modelContentType: contentType,
      modelOk: ok,
      lastError: ok
        ? null
        : looksHtml
          ? `model missing — server returned HTML (${response.status}) instead of the .onnx`
          : `model missing — HTTP ${response.status}${bytes !== null ? `, ${bytes} bytes` : ""}`,
    });
    return ok;
  } catch (error) {
    patch({ modelOk: false, modelStatus: null, lastError: `model probe failed — ${describe(error)}` });
    return false;
  }
}

/** Confirms the vendored ORT runtime is actually reachable at `wasmPaths`. */
async function probeWasm(base: string): Promise<void> {
  try {
    const response = await fetch(`${base}${WASM_PROBE_FILE}`, { method: "HEAD", cache: "no-store" });
    const length = response.headers.get("content-length");
    patch({
      wasmProbe: response.ok
        ? `ok ${response.status}${length !== null ? ` (${(Number(length) / 1e6).toFixed(1)} MB)` : ""}`
        : `MISSING ${response.status} at ${base}${WASM_PROBE_FILE} — run "npm run vendor:mediapipe"`,
    });
  } catch (error) {
    patch({ wasmProbe: `unreachable — ${describe(error)}` });
  }
}

async function createSession(modelPath: string, wasmPath: string): Promise<void> {
  patch({ phase: "loading-ort" });
  ortMod = await import("onnxruntime-web/webgpu");
  ortMod.env.wasm.wasmPaths = wasmPath;
  ortMod.env.wasm.numThreads = Math.min(4, Math.max(1, navigator.hardwareConcurrency ?? 1));

  await probeWasm(wasmPath);

  const providers: Array<"webgpu" | "wasm"> = [];
  if (typeof navigator !== "undefined" && "gpu" in navigator) providers.push("webgpu");
  providers.push("wasm");

  patch({ phase: "creating-session", providersTried: providers });
  const failures: string[] = [];
  for (const provider of providers) {
    try {
      session = await ortMod.InferenceSession.create(modelPath, {
        executionProviders: [provider],
        graphOptimizationLevel: "all",
      });
      backend = provider;
      patch({ executionProvider: provider, lastError: failures.length > 0 ? failures.join(" | ") : null });
      return;
    } catch (error) {
      failures.push(`${provider}: ${describe(error)}`);
      session = null;
    }
  }
  // Every provider refused the model — that is a load failure, not a reason to go quiet.
  patch({ lastError: failures.join(" | ") });
}

/**
 * One throwaway inference at startup.
 *
 * The first WebGPU run compiles shaders and the first ridge call builds the Gabor kernel cache.
 * Paying both here beats paying them on the user's first good frame, where it looks like a freeze.
 */
async function warmup(): Promise<void> {
  patch({ phase: "warming" });
  const startedAt = performance.now();
  const plane = RECTIFIED_SIZE * RECTIFIED_SIZE;
  detectRidges(new Float32Array(plane), RECTIFIED_SIZE);
  if (session !== null && ortMod !== null) {
    const zeros = new ortMod.Tensor("float32", new Float32Array(3 * plane), [1, 3, RECTIFIED_SIZE, RECTIFIED_SIZE]);
    await session.run({ [INPUT_NAME]: zeros });
  }
  patch({ warmupMs: performance.now() - startedAt });
}

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const message = event.data;

  if (message.type === "init") {
    diag = emptyDiagnostics(message.modelPath, message.wasmPath);
    try {
      if (await probeModel(message.modelPath)) {
        await createSession(message.modelPath, message.wasmPath);
      }
      // Ridge always works; a missing or unloadable model degrades the backend, never the worker.
      if (session === null) backend = "ridge-only";
      await warmup();
      patch({ phase: "ready" });
      self.postMessage({ type: "ready", backend, diagnostics: diag } satisfies WorkerResponse);
    } catch (error) {
      patch({ phase: "failed", lastError: describe(error) });
      self.postMessage({
        type: "error",
        message: describe(error),
        diagnostics: diag,
      } satisfies WorkerResponse);
    }
    return;
  }

  if (message.type === "infer") {
    try {
      if (message.width !== message.height) throw new Error("rectified crop must be square");
      const size = message.width;
      const t0 = performance.now();
      const rgba = new Uint8ClampedArray(message.rgba);
      const tier = tierFor(size);
      frameIndex += 1;

      /* ---------------------------- Fast tier ---------------------------- */
      grayInto(rgba, tier.gray);
      const tFast = performance.now();
      const illumination = normaliseIllumination(tier.gray, size, tier.normalised, validityFrom(message));
      pushFrame(tier.stack, illumination.out, message.convention, illumination.bypassed);
      const composite = compositeStack(tier.stack);
      tier.detectorInput.set(illumination.out);
      blendComposite(tier.detectorInput, composite);
      detectVessels(tier.detectorInput, size, sigmasFor(size), tier.frangi);
      normalizeResponses(tier.frangi);
      const fastMs = performance.now() - tFast;

      /*
       * Self-measuring cadence. The fast tier is meant to run on every frame, so it has to be told
       * whether it actually can — device spread is far too wide to decide from a constant. The first
       * few frames are measured (the first alone would time a cold JIT and a cold cache), and if the
       * median exceeds the budget the tier drops to every second frame rather than silently pushing
       * the whole rAF loop past its deadline.
       */
      recordFastCost(tier, fastMs);

      /* -------- Classical tier: same detector family, several times the cost -------- */
      const wantClassical = frameIndex % tier.classicalStride === 0 || tier.ridgeFrames === 0;
      let ridgeTimings = tier.lastRidgeTimings;
      if (wantClassical) {
        const measured = detectRidges(tier.gray, size);
        tier.ridge.set(measured.probability);
        ridgeTimings = measured.timings;
        tier.lastRidgeTimings = measured.timings;
        tier.ridgeFrames += 1;
      }

      /* ------------------------------- UNet ------------------------------ */
      let unet: Float32Array | null = null;
      let unetMs = 0;
      const wantUnet = message.wantUnet !== false && frameIndex % UNET_STRIDE === 0;
      if (wantUnet && session !== null && ortMod !== null) {
        try {
          const tStart = performance.now();
          const input = new ortMod.Tensor("float32", toNchw(rgba, size, size), [1, 3, size, size]);
          const output = await session.run({ [INPUT_NAME]: input });
          const logits = output[OUTPUT_NAME] ?? Object.values(output)[0];
          unet = sigmoidInPlace(Float32Array.from(logits.data as Float32Array));
          unetMs = performance.now() - tStart;
        } catch (error) {
          // One failed model run loses refinement for this frame, never the frame itself — but it
          // is recorded, because a model that throws on every frame looks exactly like no model.
          diag = { ...diag, lastError: `inference: ${describe(error)}` };
          unet = null;
        }
      }

      /*
       * Classical merge by per-pixel MAX before the UNet blend. Max rather than a weighted mean
       * because the two classical detectors fail on *different* structures — black-hat is
       * width-selective and misses a broad shallow fold, Frangi is elongation-selective and misses
       * nothing but blobs — so a line either of them saw should survive at full strength rather than
       * be halved by the one that missed it.
       */
      const classical = tier.classical;
      for (let i = 0; i < classical.length; i += 1) {
        classical[i] = tier.ridge[i] > tier.frangi[i] ? tier.ridge[i] : tier.frangi[i];
      }
      const fused = combineProbabilities(unet, classical);

      const timings: Record<string, number> = {
        // One number for the whole every-frame tier — illumination, stack and Frangi are measured
        // together because they are scheduled together, and reporting a fabricated split would
        // invite tuning against numbers nothing actually measured.
        fast: fastMs,
        unet: unetMs,
        clahe: ridgeTimings?.claheMs ?? 0,
        blackhat: ridgeTimings?.blackhatMs ?? 0,
        gabor: ridgeTimings?.gaborMs ?? 0,
        total: performance.now() - t0,
      };

      diag = {
        ...diag,
        inferences: diag.inferences + 1,
        firstInferenceMs: diag.firstInferenceMs ?? timings.total,
        fastTierMs: tier.fastMedian,
        fastTierStride: tier.fastStride,
        classicalStride: tier.classicalStride,
        stackFilled: tier.stack.filled,
      };

      // Copies, because every buffer here is reused scratch and transferring it would detach it.
      const ridgeOut = Float32Array.from(tier.ridge);
      const frangiOut = Float32Array.from(tier.frangi);
      const medianOut = composite === null ? null : Float32Array.from(composite);
      const transfers: ArrayBuffer[] = [
        fused.buffer as ArrayBuffer,
        ridgeOut.buffer as ArrayBuffer,
        frangiOut.buffer as ArrayBuffer,
      ];
      if (unet !== null) transfers.push(unet.buffer as ArrayBuffer);
      if (medianOut !== null) transfers.push(medianOut.buffer as ArrayBuffer);
      self.postMessage(
        {
          type: "result",
          id: message.id,
          fused: fused.buffer as ArrayBuffer,
          unet: unet === null ? null : (unet.buffer as ArrayBuffer),
          ridge: ridgeOut.buffer as ArrayBuffer,
          frangi: frangiOut.buffer as ArrayBuffer,
          median: medianOut === null ? null : (medianOut.buffer as ArrayBuffer),
          size,
          timings,
          diagnostics: diag,
        } satisfies WorkerResponse,
        transfers,
      );
    } catch (error) {
      patch({ lastError: describe(error) });
      self.postMessage({
        type: "error",
        id: message.id,
        message: describe(error),
        diagnostics: diag,
      } satisfies WorkerResponse);
    }
  }
};
