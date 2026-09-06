/**
 * Main-thread half of the super-resolution worker (flag `superRes`), on the pattern of
 * `segmenter-onnx.ts`: owns the worker's lifecycle, allows ONE fusion in flight, and drops a
 * request rather than queueing it — a fusion answered two cadences late describes a ring that has
 * since turned over. Frame buffers are COPIED at call time (the ring keeps its own storage and
 * keeps writing to it) and the copies are transferred.
 */
import type { SuperResFrame } from "./superres";
import type { SuperResWorkerResponse } from "./superres.worker";
import type { LineMask } from "./types";

export interface SuperResContext {
  readonly size: number;
  readonly convention: number;
  readonly wantContract: boolean;
  readonly unet: Float32Array | null;
  readonly referenceIndex?: number;
}

export interface SuperResResult {
  readonly fused: boolean;
  readonly effectiveFrames: number;
  readonly offered: number;
  readonly referenceIndex: number;
  readonly texture: Float32Array;
  readonly textureSize: number;
  readonly mask: LineMask;
  readonly convention: number;
  readonly fuseMs: number;
  readonly totalMs: number;
}

export interface SuperResFuser {
  readonly ready: boolean;
  readonly busy: boolean;
  fuse(frames: readonly SuperResFrame[], context: SuperResContext): Promise<SuperResResult | null>;
  dispose(): void;
}

interface Pending {
  readonly id: number;
  readonly resolve: (result: SuperResResult | null) => void;
}

export function createSuperResFuser(): SuperResFuser {
  let worker: Worker | null = null;
  let inFlight: Pending | null = null;
  let disposed = false;
  let nextId = 1;

  try {
    worker = new Worker(new URL("./superres.worker.ts", import.meta.url), { type: "module" });
  } catch (error) {
    console.error("[superres] worker could not be created:", error);
  }

  if (worker !== null) {
    worker.onmessage = (event: MessageEvent<SuperResWorkerResponse>) => {
      const message = event.data;
      const pending = inFlight;
      if (pending === null || pending.id !== message.id) return;
      inFlight = null;
      if (message.type === "error") {
        console.warn("[superres] fusion failed:", message.message);
        pending.resolve(null);
        return;
      }
      pending.resolve({
        fused: message.fused,
        effectiveFrames: message.effectiveFrames,
        offered: message.offered,
        referenceIndex: message.referenceIndex,
        texture: new Float32Array(message.texture),
        textureSize: message.textureSize,
        mask: {
          width: message.maskSize,
          height: message.maskSize,
          all: new Float32Array(message.all),
          ...(message.contract === undefined ? {} : { contract: new Float32Array(message.contract) }),
          resolves: [],
          inferenceMs: message.timings.total ?? 0,
          backend: message.fused ? "superres" : "superres-single",
          convention: message.convention,
          stages: {
            unet: null,
            ridge: new Float32Array(message.ridge),
            frangi: new Float32Array(message.frangi),
            median: null,
            photometric: null,
          },
          timings: message.timings,
        },
        convention: message.convention,
        fuseMs: message.fuseMs,
        totalMs: message.timings.total ?? 0,
      });
    };
    worker.onerror = (event) => {
      console.error("[superres] worker error:", event.message);
      inFlight?.resolve(null);
      inFlight = null;
    };
  }

  return {
    get ready() {
      return worker !== null && !disposed;
    },
    get busy() {
      return inFlight !== null;
    },
    fuse(frames, context) {
      if (worker === null || disposed || inFlight !== null || frames.length === 0) return Promise.resolve(null);
      const id = nextId;
      nextId += 1;
      const transfers: ArrayBuffer[] = [];
      const payload = frames.map((frame) => {
        const luma = new Float32Array(frame.luma).buffer;
        const valid = frame.valid === null ? null : new Uint8Array(frame.valid).buffer;
        transfers.push(luma);
        if (valid !== null) transfers.push(valid);
        return {
          luma,
          valid,
          anchors: (frame.anchors ?? []).map((p) => ({ x: p.x, y: p.y })),
          timestampMs: frame.timestampMs ?? 0,
          vol: frame.vol ?? 0,
        };
      });
      const unet = context.unet === null ? null : new Float32Array(context.unet).buffer;
      if (unet !== null) transfers.push(unet);
      return new Promise<SuperResResult | null>((resolve) => {
        inFlight = { id, resolve };
        worker?.postMessage(
          {
            type: "fuse",
            id,
            size: context.size,
            frames: payload,
            referenceIndex: context.referenceIndex,
            convention: context.convention,
            wantContract: context.wantContract,
            unet,
          },
          transfers,
        );
      });
    },
    dispose() {
      disposed = true;
      inFlight?.resolve(null);
      inFlight = null;
      worker?.terminate();
      worker = null;
    },
  };
}
