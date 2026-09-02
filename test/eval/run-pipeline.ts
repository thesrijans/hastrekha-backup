/**
 * Offline pipeline runner for the eval harness (Phase 0d).
 *
 * **Reuses the exact chain of `runFrame` in test/golden-run.ts** — sharp → RGBA → `rectifyPalm`
 * at RECTIFIED_SIZE → box downsample to MASK_SIZE → six ticks of illumination / stack / Frangi /
 * Gabor ridge / `combineProbabilities` / `fuse` → `extractLines` — because that chain is the
 * browser-equivalent one the goldens pin ("an offline shortcut here would pin a pipeline nobody
 * runs"). The only difference: this returns per-line polyline GEOMETRY (mapped back to 0–1
 * fractions), which runFrame's snapshot deliberately drops.
 *
 * Ablation rungs hook in AFTER fusion, before extraction:
 *   baseline        — extract from fusion.ema, exactly as shipped
 *   enhancer        — RekhaEnhancer(128).process(gray128, fused, 1) ONCE, extract from .enhanced
 *   enhancer-ridge  — same call, extract from .ridge (oriented-NMS thin map)
 * NOTE: stills exercise the enhancer's SPATIAL stages only — one process() call builds no
 * temporal state, so its evidence/probability channels are not what a live session would see.
 * The report must carry that caveat.
 *
 * `--model` plumbs an ONNX path (e.g. the git-ignored fp32 file) into the tick loop via
 * onnxruntime-web's wasm backend; if the runtime cannot initialise under node, the error is
 * recorded on the result and the run continues classical-only — never aborts.
 */
import sharp from "sharp";
import path from "node:path";
import { rectifyPalm } from "../../lib/scan/rectify";
import { detectRidges, normalizeResponses } from "../../lib/scan/ridge";
import { detectVessels, sigmasFor } from "../../lib/scan/frangi";
import { normaliseIllumination } from "../../lib/scan/illumination";
import { blendComposite, compositeStack, emptyStack, pushFrame } from "../../lib/scan/stack";
import { combineProbabilities, sigmoidInPlace, ONNX_INPUT_NAME } from "../../lib/scan/segmenter";
import { alignFusion, emptyFusion, fuse, type FusionState } from "../../lib/scan/fusion";
import { extractLines } from "../../lib/scan/lines";
import { MASK_SIZE, RECTIFIED_SIZE, type Point2 } from "../../lib/scan/types";
import { canonicalAnchors, solveHomography, type Matrix3 } from "../../lib/scan/rectify";
import { RekhaEnhancer } from "../../lib/scan/enhance/rekha-enhancer";
import { CANONICAL_FULLHAND_21 } from "../../lib/scan/models/canonical-fullhand-21";
import {
  UNET_INPUT_SIZE,
  palmQuadToFullHand,
  remapProbabilitiesInto,
  solveFullHandHomography,
  warpFullHand,
} from "../../lib/scan/fullhand-warp";
import { LABEL_LINE_IDS, type LabelLineId } from "../../lib/scan/dev/session-types";
import type { EvalCase } from "./gt-adapter";

const WORK = MASK_SIZE;
const TICKS = 6;

export const RUNGS = ["baseline", "enhancer", "enhancer-ridge", "unet-fullhand-fixed", "unet-fullhand-ransac"] as const;
export type Rung = (typeof RUNGS)[number];

export interface RunOptions {
  /** ONNX model path override; undefined = classical-only, as the shipped offline chain runs. */
  readonly modelPath?: string;
}

export interface DetectedLines {
  /** 0–1 canonical fractions per line; null = not detected. */
  readonly lines: Readonly<Record<LabelLineId, readonly (readonly number[])[] | null>>;
  /** Fatal per-case error — the rung ran but produced nothing usable. */
  readonly error?: string;
  /** Non-fatal notes (e.g. the UNet could not initialise and the run fell back to classical). */
  readonly notes: readonly string[];
  /**
   * Full-hand rungs on legacy cases only: the warp came from the 4-anchor approximation (H2b),
   * not 21 landmarks - the case is scored but flagged, and the report shows the count.
   */
  readonly approximate?: boolean;
}

const makeImageData = (w: number, h: number): ImageData =>
  ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4), colorSpace: "srgb" }) as ImageData;

function downsample2(src: Float32Array, size: number, dst: Float32Array): void {
  const half = size >> 1;
  for (let y = 0; y < half; y += 1) {
    const a = 2 * y * size;
    const b = a + size;
    for (let x = 0; x < half; x += 1) {
      const at = 2 * x;
      dst[y * half + x] = (src[a + at] + src[a + at + 1] + src[b + at] + src[b + at + 1]) * 0.25;
    }
  }
}

/* ------------------------------ Optional UNet ------------------------------ */

interface UnetSession {
  run(rgba: Uint8ClampedArray): Promise<Float32Array>; // 128-space probabilities (palm-quad path)
  probs256(rgba: Uint8ClampedArray): Promise<Float32Array>; // 256-square probabilities, no downsample
}

let unetCache: { path: string; session: UnetSession | null; error?: string } | null = null;

async function loadUnet(modelPath: string): Promise<{ session: UnetSession | null; error?: string }> {
  if (unetCache !== null && unetCache.path === modelPath) return unetCache;
  try {
    const ort = await import("onnxruntime-web");
    ort.env.wasm.numThreads = 1;
    const session = await ort.InferenceSession.create(modelPath, { executionProviders: ["wasm"] });
    const probs256 = async (rgba: Uint8ClampedArray): Promise<Float32Array> => {
      const plane = RECTIFIED_SIZE * RECTIFIED_SIZE;
      const nchw = new Float32Array(3 * plane);
      for (let i = 0; i < plane; i += 1) {
        const at = i * 4;
        nchw[i] = rgba[at] / 255;
        nchw[plane + i] = rgba[at + 1] / 255;
        nchw[2 * plane + i] = rgba[at + 2] / 255;
      }
      const feeds = { [ONNX_INPUT_NAME]: new ort.Tensor("float32", nchw, [1, 3, RECTIFIED_SIZE, RECTIFIED_SIZE]) };
      const outputs = await session.run(feeds);
      const logits = outputs[session.outputNames[0]].data as Float32Array;
      const probabilities = Float32Array.from(logits);
      sigmoidInPlace(probabilities);
      return probabilities;
    };
    const wrapped: UnetSession = {
      probs256,
      async run(rgba: Uint8ClampedArray): Promise<Float32Array> {
        const probabilities = await probs256(rgba);
        const small = new Float32Array(WORK * WORK);
        downsample2(probabilities, RECTIFIED_SIZE, small);
        return small;
      },
    };
    unetCache = { path: modelPath, session: wrapped };
  } catch (error) {
    unetCache = {
      path: modelPath,
      session: null,
      error: `UNet unavailable offline (${error instanceof Error ? error.message : String(error)}) — ran classical-only`,
    };
  }
  return unetCache;
}

/* --------------------------------- The run --------------------------------- */

/** Run one still through one rung. Never throws — errors land on the result. */
export async function runStill(evalCase: EvalCase, rung: Rung, opts: RunOptions = {}): Promise<DetectedLines> {
  const empty: Record<LabelLineId, readonly (readonly number[])[] | null> = {
    heart: null,
    head: null,
    life: null,
    fate: null,
  };
  const notes: string[] = [];
  try {
    const { data, info } = await sharp(path.resolve(evalCase.imagePath)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const source = { width: info.width, height: info.height, data: new Uint8ClampedArray(data) } as ImageData;
    const anchors: Point2[] = evalCase.anchors.map((a) => ({ x: a[0], y: a[1] }));

    const size = RECTIFIED_SIZE;
    const warped = rectifyPalm(source, anchors, size, makeImageData);
    if (warped === null) return { lines: empty, error: "rectifyPalm returned null", notes };

    const plane = size * size;
    const workPlane = WORK * WORK;
    const gray = new Float32Array(plane);
    for (let i = 0; i < plane; i += 1) {
      const at = i * 4;
      gray[i] =
        (0.2126 * warped.image.data[at] + 0.7152 * warped.image.data[at + 1] + 0.0722 * warped.image.data[at + 2]) / 255;
    }
    const small = new Float32Array(workPlane);
    downsample2(gray, size, small);
    const validity = new Uint8Array(workPlane);
    for (let y = 0; y < WORK; y += 1) {
      const a = 2 * y * size;
      const b = a + size;
      for (let x = 0; x < WORK; x += 1) {
        const at = 2 * x;
        validity[y * WORK + x] =
          warped.inside[a + at] & warped.inside[a + at + 1] & warped.inside[b + at] & warped.inside[b + at + 1];
      }
    }

    let unetPlane: Float32Array | null = null;
    let approximate: boolean | undefined;
    const isFullHand = rung === "unet-fullhand-fixed" || rung === "unet-fullhand-ransac";
    if (isFullHand) {
      // The framing rungs are meaningless without the model - record and skip, never fake.
      if (opts.modelPath === undefined) {
        return { lines: empty, error: `--model required for rung ${rung} - case skipped`, notes };
      }
      const loaded = await loadUnet(opts.modelPath);
      if (loaded.session === null) {
        return { lines: empty, error: loaded.error ?? "UNet unavailable", notes };
      }
      /*
       * Full-hand geometry per source kind. Session: the RAW still (fingers in frame; the 512
       * crop is already palm-quad and unusable for this) + 21 landmarks scaled by still size,
       * in the rung's fit mode. Legacy: the H2b 4-correspondence approximation - GT anchors
       * are landmarks 0/1/5/17, pinned to the same indices of the canonical pose; both fit
       * modes collapse to the same 4-point solve there, and the case is flagged approximate.
       */
      let fullSource = source;
      let toCropFullHand: Matrix3 | null = null;
      let quadAnchorsPx: Point2[] = anchors;
      if (
        evalCase.source === "session" &&
        evalCase.rawImagePath !== undefined &&
        evalCase.landmarks !== undefined &&
        evalCase.stillSize !== undefined &&
        evalCase.stillAnchors !== undefined
      ) {
        const raw = await sharp(path.resolve(evalCase.rawImagePath)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
        fullSource = { width: raw.info.width, height: raw.info.height, data: new Uint8ClampedArray(raw.data) } as ImageData;
        toCropFullHand = solveFullHandHomography(
          evalCase.landmarks,
          evalCase.stillSize.width,
          evalCase.stillSize.height,
          rung === "unet-fullhand-fixed" ? "fixed" : "all",
        );
        quadAnchorsPx = evalCase.stillAnchors.map((a) => ({ x: a[0], y: a[1] }));
      } else {
        approximate = true;
        const targets = [0, 1, 5, 17].map((i) => ({
          x: CANONICAL_FULLHAND_21[i][0] * UNET_INPUT_SIZE,
          y: CANONICAL_FULLHAND_21[i][1] * UNET_INPUT_SIZE,
        }));
        toCropFullHand = solveHomography(anchors, targets);
      }
      const quadTargets = canonicalAnchors(quadAnchorsPx.length, RECTIFIED_SIZE);
      const toCropQuad = quadTargets === null ? null : solveHomography(quadAnchorsPx, quadTargets);
      const pqToFull = toCropFullHand === null || toCropQuad === null ? null : palmQuadToFullHand(toCropQuad, toCropFullHand);
      const fullImage = toCropFullHand === null ? null : warpFullHand(fullSource, toCropFullHand, UNET_INPUT_SIZE, makeImageData);
      if (fullImage === null || pqToFull === null) {
        return { lines: empty, error: "full-hand warp unavailable (degenerate geometry)", notes, approximate };
      }
      const fullProbs = await loaded.session.probs256(fullImage.data);
      unetPlane = new Float32Array(WORK * WORK);
      remapProbabilitiesInto(fullProbs, UNET_INPUT_SIZE, pqToFull, unetPlane, WORK, RECTIFIED_SIZE);
    } else if (opts.modelPath !== undefined) {
      const loaded = await loadUnet(opts.modelPath);
      if (loaded.session === null) {
        if (loaded.error !== undefined) notes.push(loaded.error);
      } else {
        unetPlane = await loaded.session.run(warped.image.data);
      }
    }

    // Six ticks, exactly as runFrame does — the browser-equivalent accumulation.
    const stack = emptyStack(WORK);
    let fusion: FusionState = emptyFusion(MASK_SIZE);
    for (let tick = 0; tick < TICKS; tick += 1) {
      const normalised = new Float32Array(workPlane);
      const illumination = normaliseIllumination(small, WORK, normalised, validity);
      pushFrame(stack, illumination.out, 4, illumination.bypassed);
      const detectorInput = new Float32Array(illumination.out);
      blendComposite(detectorInput, compositeStack(stack));

      const frangi = new Float32Array(workPlane);
      detectVessels(detectorInput, WORK, sigmasFor(WORK), frangi);
      normalizeResponses(frangi);
      const ridge = Float32Array.from(detectRidges(small, WORK).probability);

      const classical = new Float32Array(workPlane);
      for (let i = 0; i < workPlane; i += 1) classical[i] = ridge[i] > frangi[i] ? ridge[i] : frangi[i];

      fusion = alignFusion(fusion, warped.toCrop, anchors.length).state;
      fusion = fuse(
        fusion,
        {
          width: WORK,
          height: WORK,
          all: combineProbabilities(unetPlane, classical),
          resolves: [],
          inferenceMs: 0,
          backend: unetPlane === null ? "classical" : "eval-unet",
          stages: { unet: unetPlane, ridge, frangi, median: null, photometric: null },
        },
        1000 + tick * 200,
      );
    }

    // Rung hook: what the extractor reads. Enhancer buffers are OWNED and REUSED — copy them.
    let field = fusion.ema;
    if (rung === "enhancer" || rung === "enhancer-ridge") {
      const enhancer = new RekhaEnhancer(WORK);
      const result = enhancer.process(small, fusion.ema, 1);
      field = Float32Array.from(rung === "enhancer" ? result.enhanced : result.ridge);
      notes.push("enhancer rung: single process() call — spatial stages only, temporal state not exercised");
    }

    const found = extractLines(field, WORK);
    const lines: Record<LabelLineId, readonly (readonly number[])[] | null> = { ...empty };
    for (const id of LABEL_LINE_IDS) {
      const traced = found.lines[id];
      lines[id] = traced === undefined ? null : traced.points.map((p) => [p[0] / WORK, p[1] / WORK]);
    }
    return { lines, notes, approximate };
  } catch (error) {
    return { lines: empty, error: error instanceof Error ? error.message : String(error), notes };
  }
}
