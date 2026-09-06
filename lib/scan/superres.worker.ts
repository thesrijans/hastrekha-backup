/**
 * Super-resolution worker (flag `superRes`): fuses the keep-ring's frames and detects once on the
 * result, off the main thread. A 12-frame fusion at 512 → 1024 is several hundred milliseconds of
 * arithmetic — on the thread that decodes the video it would be a visible hitch every cadence.
 *
 * Separate from `segmenter.worker.ts` on purpose: that worker carries temporal state (the
 * composite stack, the classical and UNet strides, the held ridge) that a fused frame must not
 * enter — it would contaminate the live stack and might be handed a HELD ridge instead of its own.
 * Leaving it untouched is also what keeps the shipped path byte-identical.
 */
import { detectOnTexture } from "./superres-detect";
import {
  boxDownsample,
  boxDownsampleValidity,
  fuseFrames,
  normaliseTexture,
  SUPERRES_SCALE,
  type SuperResFrame,
} from "./superres";
import { RECTIFIED_SIZE, type Point2 } from "./types";

export interface SuperResFrameMessage {
  readonly luma: ArrayBuffer;
  readonly valid: ArrayBuffer | null;
  readonly anchors: readonly Point2[];
  readonly timestampMs: number;
  readonly vol: number;
}

export interface FuseMessage {
  readonly type: "fuse";
  readonly id: number;
  /** Side of every frame's luma plane. */
  readonly size: number;
  readonly frames: readonly SuperResFrameMessage[];
  /** Pin the reference frame; omitted → median-anchor choice. */
  readonly referenceIndex?: number;
  readonly convention: number;
  readonly wantContract: boolean;
  /** The live path's most recent UNet plane at the working size, or null. */
  readonly unet: ArrayBuffer | null;
}

export type SuperResWorkerRequest = FuseMessage;

export type SuperResWorkerResponse =
  | {
      readonly type: "result";
      readonly id: number;
      /** False when fewer than the minimum frames registered and the single sharpest frame was detected instead. */
      readonly fused: boolean;
      readonly effectiveFrames: number;
      readonly offered: number;
      readonly referenceIndex: number;
      /** Illumination-normalised texture for the diagnostics overlay, `textureSize`². */
      readonly texture: ArrayBuffer;
      readonly textureSize: number;
      readonly all: ArrayBuffer;
      readonly ridge: ArrayBuffer;
      readonly frangi: ArrayBuffer;
      readonly contract?: ArrayBuffer;
      readonly maskSize: number;
      readonly convention: number;
      readonly fuseMs: number;
      readonly timings: Record<string, number>;
    }
  | { readonly type: "error"; readonly id: number; readonly message: string };

const describe = (error: unknown): string => (error instanceof Error ? error.message : String(error));

self.onmessage = (event: MessageEvent<SuperResWorkerRequest>) => {
  const message = event.data;
  if (message.type !== "fuse") return;
  try {
    const t0 = performance.now();
    const size = message.size;
    const plane = size * size;
    const frames: SuperResFrame[] = message.frames.map((frame) => ({
      luma: new Float32Array(frame.luma),
      valid: frame.valid === null ? null : new Uint8Array(frame.valid),
      anchors: frame.anchors,
      timestampMs: frame.timestampMs,
      vol: frame.vol,
    }));
    if (frames.length === 0) throw new Error("no frames to fuse");
    for (const frame of frames) {
      if (frame.luma.length !== plane) throw new Error("frame plane does not match the declared size");
    }

    const fusion = fuseFrames(frames, size, SUPERRES_SCALE, { referenceIndex: message.referenceIndex });
    const fuseMs = performance.now() - t0;

    const detectorSize = RECTIFIED_SIZE;
    const detectorPlane = detectorSize * detectorSize;
    const detectorLuma = new Float32Array(detectorPlane);
    const detectorValid = new Uint8Array(detectorPlane);
    const texture = new Float32Array(detectorPlane);
    let fused = false;
    let effectiveFrames = 1;
    let referenceIndex: number;

    if (fusion !== null) {
      const outSize = size * SUPERRES_SCALE;
      const factor = outSize / detectorSize;
      if (!Number.isInteger(factor) || factor < 1) throw new Error(`fused grid ${outSize} is not a multiple of ${detectorSize}`);
      // The detector gets the RAW fused luma: its own illumination stage then runs exactly once,
      // at its own working resolution, with its own calibrated constants.
      boxDownsample(fusion.luma, outSize, factor, detectorLuma);
      const reached = new Uint8Array(outSize * outSize);
      for (let i = 0; i < reached.length; i += 1) reached[i] = fusion.weight[i] > 0 ? 1 : 0;
      boxDownsampleValidity(reached, outSize, factor, detectorValid);
      boxDownsample(fusion.texture, outSize, factor, texture);
      fused = true;
      effectiveFrames = fusion.effectiveFrames;
      referenceIndex = fusion.referenceIndex;
    } else {
      // Fall back to the single sharpest frame — never a fabricated fusion.
      referenceIndex = 0;
      for (let k = 1; k < frames.length; k += 1) {
        if ((frames[k].vol ?? 0) > (frames[referenceIndex].vol ?? 0)) referenceIndex = k;
      }
      const best = frames[referenceIndex];
      const factor = size / detectorSize;
      if (!Number.isInteger(factor) || factor < 1) throw new Error(`frame side ${size} is not a multiple of ${detectorSize}`);
      boxDownsample(best.luma, size, factor, detectorLuma);
      if (best.valid === null) detectorValid.fill(1);
      else boxDownsampleValidity(best.valid, size, factor, detectorValid);
      const weight = new Float32Array(detectorPlane);
      for (let i = 0; i < detectorPlane; i += 1) weight[i] = detectorValid[i];
      normaliseTexture(detectorLuma, detectorSize, weight, texture);
    }

    const mask = detectOnTexture(detectorLuma, detectorSize, detectorValid, {
      unet: message.unet === null ? null : new Float32Array(message.unet),
      wantContract: message.wantContract,
      convention: message.convention,
      backend: fused ? "superres" : "superres-single",
    });
    const stages = mask.stages;
    if (stages === undefined) throw new Error("detection returned no stages");

    const transfers: ArrayBuffer[] = [
      texture.buffer as ArrayBuffer,
      mask.all.buffer as ArrayBuffer,
      stages.ridge.buffer as ArrayBuffer,
      (stages.frangi as Float32Array).buffer as ArrayBuffer,
    ];
    if (mask.contract !== undefined) transfers.push(mask.contract.buffer as ArrayBuffer);
    self.postMessage(
      {
        type: "result",
        id: message.id,
        fused,
        effectiveFrames,
        offered: frames.length,
        referenceIndex,
        texture: texture.buffer as ArrayBuffer,
        textureSize: detectorSize,
        all: mask.all.buffer as ArrayBuffer,
        ridge: stages.ridge.buffer as ArrayBuffer,
        frangi: (stages.frangi as Float32Array).buffer as ArrayBuffer,
        ...(mask.contract === undefined ? {} : { contract: mask.contract.buffer as ArrayBuffer }),
        maskSize: mask.width,
        convention: message.convention,
        fuseMs,
        timings: { ...(mask.timings ?? {}), fuse: fuseMs, total: performance.now() - t0 },
      } satisfies SuperResWorkerResponse,
      transfers,
    );
  } catch (error) {
    self.postMessage({ type: "error", id: message.id, message: describe(error) } satisfies SuperResWorkerResponse);
  }
};
