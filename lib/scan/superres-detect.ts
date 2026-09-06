/**
 * Detect ONCE on a fused texture (flag `superRes`).
 *
 * The worker's classical chain — illumination normalisation, Frangi, black-hat + Gabor, per-pixel
 * max, `combineProbabilities`, and the H9 contract plane on request — applied to a single luma
 * plane with no temporal state: no composite stack (the fusion IS the temporal composite, and
 * blending the live stack back in would re-admit the single-frame noise the fusion removed) and
 * no stride bookkeeping (every stage runs on every call — this is called once per fusion, not
 * per frame). The UNet is not run here: the fused texture is luma and the model was trained on
 * RGB skin, so the caller may pass the live path's most recent UNet plane instead — it is in the
 * same canonical space, and the blend then keeps the mask on the scale extraction was tuned for.
 *
 * Mirrors the tick body of test/eval/run-pipeline.ts `prepare` minus the stack, which in turn
 * mirrors segmenter.worker.ts — the eval's mirror is the one pinned byte-identical to the worker.
 *
 * Layer: lib/scan (production). Pure. Runs in the superres worker and in node.
 */
import { contractFrameInto, CONTRACT_DEPTH_DEFAULTS } from "./contract";
import { detectVessels, sigmasFor } from "./frangi";
import { normaliseIllumination } from "./illumination";
import { detectRidges, normalizeResponses } from "./ridge";
import { combineProbabilities } from "./segmenter";
import { boxDownsample, boxDownsampleValidity } from "./superres";
import { MASK_SIZE, type LineMask } from "./types";

export interface TextureDetectOptions {
  /** A recent UNet probability plane at {@link MASK_SIZE}², or null for classical only. */
  readonly unet?: Float32Array | null;
  /** Also compute the H9 contract plane. */
  readonly wantContract?: boolean;
  readonly convention?: number;
  readonly backend?: string;
}

/**
 * @param luma 0–1 luma, `size`², where `size` is an integer multiple of {@link MASK_SIZE}.
 * @param valid 1 where the texture carries real frame content, or null for all-valid.
 */
export function detectOnTexture(
  luma: Float32Array,
  size: number,
  valid: Uint8Array | null,
  options: TextureDetectOptions = {},
): LineMask {
  const work = MASK_SIZE;
  if (size % work !== 0 || size < work) throw new Error(`superres detect: texture side ${size} is not a multiple of ${work}`);
  if (luma.length !== size * size) throw new Error("superres detect: luma plane does not match its size");
  const t0 = performance.now();
  const factor = size / work;
  const workPlane = work * work;

  let workGray = luma;
  let validity: Uint8Array | null = valid;
  if (factor > 1) {
    workGray = new Float32Array(workPlane);
    boxDownsample(luma, size, factor, workGray);
    if (valid !== null) {
      validity = new Uint8Array(workPlane);
      boxDownsampleValidity(valid, size, factor, validity);
    }
  }

  const normalised = new Float32Array(workPlane);
  const illumination = normaliseIllumination(workGray, work, normalised, validity);
  const frangi = new Float32Array(workPlane);
  detectVessels(illumination.out, work, sigmasFor(work), frangi);
  normalizeResponses(frangi);
  const tFast = performance.now();

  const wantContract = options.wantContract === true;
  const depth = wantContract ? new Float32Array(workPlane) : null;
  const measured = depth === null ? detectRidges(workGray, work) : detectRidges(workGray, work, { depth });
  const ridge = Float32Array.from(measured.probability);
  const classical = new Float32Array(workPlane);
  for (let i = 0; i < workPlane; i += 1) classical[i] = ridge[i] > frangi[i] ? ridge[i] : frangi[i];

  const unet = options.unet ?? null;
  const unetUsable = unet !== null && unet.length === workPlane ? unet : null;
  const all = combineProbabilities(unetUsable, classical);

  let contract: Float32Array | undefined;
  if (depth !== null) {
    contract = new Float32Array(workPlane);
    contractFrameInto(depth, ridge, frangi, unetUsable, CONTRACT_DEPTH_DEFAULTS, contract);
  }

  const total = performance.now() - t0;
  return {
    width: work,
    height: work,
    all,
    ...(contract === undefined ? {} : { contract }),
    resolves: [],
    inferenceMs: total,
    backend: options.backend ?? "superres",
    convention: options.convention,
    stages: { unet: unetUsable, ridge, frangi, median: null, photometric: null },
    timings: {
      fast: tFast - t0,
      clahe: measured.timings.claheMs,
      blackhat: measured.timings.blackhatMs,
      gabor: measured.timings.gaborMs,
      contract: measured.timings.contractMs ?? 0,
      total,
    },
  };
}
