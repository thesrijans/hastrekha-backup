/**
 * Offline pipeline runner for the eval harness (Phase 0d) — composable operating points.
 *
 * **Reuses the exact chain of `runFrame` in test/golden-run.ts** — sharp → RGBA → `rectifyPalm`
 * at RECTIFIED_SIZE → box downsample to MASK_SIZE → six ticks of illumination / stack / Frangi /
 * Gabor ridge / `combineProbabilities` / `fuse` — and then, unlike runFrame, replays the
 * extraction GEOMETRY path (`thin(binarize(field, t))` → `tracePolylines` → `completeLines`,
 * mirroring lines.ts:570-586 where completion runs on the RAW fragments) so the binarisation
 * threshold can be swept WITHOUT editing lib/scan: `LINE_THRESHOLD` (lines.ts:28, shipped 0.45)
 * is `binarize`'s default parameter, and `binarize` is exported with the threshold injectable.
 * The field itself is untouched, so completion's energy/observed gates stay authentic.
 *
 * A rung is FRAMING + POST:
 *   framing (what the UNet sees):  classical (no model) · palmquad (--model, shipped crop) ·
 *                                  fullhand-fixed · fullhand-ransac (H2 framing path)
 *   post (what extraction reads):  fused (fusion.ema) · enhancer (.enhanced) ·
 *                                  enhancer-ridge (.ridge) — RekhaEnhancer, ONE process() call:
 *                                  spatial stages only, no temporal state (stills).
 * Legacy aliases (baseline, enhancer, enhancer-ridge, unet-fullhand-*) resolve in index.ts.
 * The expensive field is computed once per (case, framing, post); thresholds reuse it.
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
import { LINE_THRESHOLD, binarize, extractAllTraces, extractLines, thin, tracePolylines } from "../../lib/scan/lines";
import { minorLineFeatures } from "../../lib/scan/minor-lines";
import { completeLines } from "../../lib/scan/completion";
import { MASK_SIZE, RECTIFIED_SIZE, type ActiveLineId, type Point2 } from "../../lib/scan/types";
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

export const FRAMINGS = ["classical", "palmquad", "fullhand-fixed", "fullhand-ransac"] as const;
export type Framing = (typeof FRAMINGS)[number];
export const POSTS = ["fused", "enhancer", "enhancer-ridge"] as const;
export type Post = (typeof POSTS)[number];

export interface ComposedRung {
  readonly framing: Framing;
  readonly post: Post;
}
export const rungId = (rung: ComposedRung): string => `${rung.framing}+${rung.post}`;

/** The threshold LINE_THRESHOLD (lines.ts:28) is swept over — shipped value included exactly. */
export const SHIPPED_THRESHOLD = LINE_THRESHOLD;
export const SWEEP_THRESHOLDS: readonly number[] = Array.from({ length: 15 }, (_, i) =>
  Number((0.15 + i * 0.05).toFixed(2)),
);

export interface RunOptions {
  readonly modelPath?: string;
}

export interface CaseField {
  /** The map extraction reads for this (case, framing, post) — threshold-independent. */
  readonly field: Float32Array | null;
  readonly error?: string;
  readonly notes: readonly string[];
  readonly approximate?: boolean;
}

export interface DetectedLines {
  readonly lines: Readonly<Record<LabelLineId, readonly (readonly number[])[] | null>>;
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
  probs256(rgba: Uint8ClampedArray): Promise<Float32Array>;
}

let unetCache: { path: string; session: UnetSession | null; error?: string } | null = null;

async function loadUnet(modelPath: string): Promise<{ session: UnetSession | null; error?: string }> {
  if (unetCache !== null && unetCache.path === modelPath) return unetCache;
  try {
    const ort = await import("onnxruntime-web");
    ort.env.wasm.numThreads = 1;
    const session = await ort.InferenceSession.create(modelPath, { executionProviders: ["wasm"] });
    unetCache = {
      path: modelPath,
      session: {
        async probs256(rgba: Uint8ClampedArray): Promise<Float32Array> {
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
          const probabilities = Float32Array.from(outputs[session.outputNames[0]].data as Float32Array);
          sigmoidInPlace(probabilities);
          return probabilities;
        },
      },
    };
  } catch (error) {
    unetCache = {
      path: modelPath,
      session: null,
      error: `UNet unavailable offline (${error instanceof Error ? error.message : String(error)})`,
    };
  }
  return unetCache;
}

/* ------------------------------ Field computation ------------------------------ */

interface Prepared {
  readonly ema: Float32Array;
  readonly small: Float32Array;
  readonly notes: string[];
  readonly approximate?: boolean;
}

const fieldCache = new Map<string, Prepared | { error: string }>();

async function prepare(evalCase: EvalCase, framing: Framing, opts: RunOptions): Promise<Prepared | { error: string }> {
  const key = `${evalCase.id}|${framing}|${opts.modelPath ?? ""}`;
  const cached = fieldCache.get(key);
  if (cached !== undefined) return cached;
  const notes: string[] = [];
  let approximate: boolean | undefined;
  try {
    const { data, info } = await sharp(path.resolve(evalCase.imagePath)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const source = { width: info.width, height: info.height, data: new Uint8ClampedArray(data) } as ImageData;
    const anchors: Point2[] = evalCase.anchors.map((a) => ({ x: a[0], y: a[1] }));
    const size = RECTIFIED_SIZE;
    const warped = rectifyPalm(source, anchors, size, makeImageData);
    if (warped === null) throw new Error("rectifyPalm returned null");

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

    // The UNet plane, per framing.
    let unetPlane: Float32Array | null = null;
    if (framing !== "classical") {
      if (opts.modelPath === undefined) throw new Error(`--model required for framing "${framing}"`);
      const loaded = await loadUnet(opts.modelPath);
      if (loaded.session === null) throw new Error(loaded.error ?? "UNet unavailable");
      if (framing === "palmquad") {
        const probabilities = await loaded.session.probs256(warped.image.data);
        unetPlane = new Float32Array(workPlane);
        downsample2(probabilities, RECTIFIED_SIZE, unetPlane);
      } else {
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
            framing === "fullhand-fixed" ? "fixed" : "all",
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
        if (fullImage === null || pqToFull === null) throw new Error("full-hand warp unavailable (degenerate geometry)");
        const fullProbs = await loaded.session.probs256(fullImage.data);
        unetPlane = new Float32Array(workPlane);
        remapProbabilitiesInto(fullProbs, UNET_INPUT_SIZE, pqToFull, unetPlane, WORK, RECTIFIED_SIZE);
      }
    }

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
          backend: unetPlane === null ? "classical" : `eval-${framing}`,
          stages: { unet: unetPlane, ridge, frangi, median: null, photometric: null },
        },
        1000 + tick * 200,
      );
    }
    const prepared: Prepared = { ema: fusion.ema, small, notes, approximate };
    fieldCache.set(key, prepared);
    return prepared;
  } catch (error) {
    const failed = { error: error instanceof Error ? error.message : String(error) };
    fieldCache.set(key, failed);
    return failed;
  }
}

/** The map extraction reads for one (case, framing, post). Cached per case+framing. */
export async function computeField(evalCase: EvalCase, rung: ComposedRung, opts: RunOptions = {}): Promise<CaseField> {
  const prepared = await prepare(evalCase, rung.framing, opts);
  if ("error" in prepared) return { field: null, error: prepared.error, notes: [] };
  const notes = [...prepared.notes];
  let field = prepared.ema;
  if (rung.post !== "fused") {
    const enhancer = new RekhaEnhancer(WORK);
    const result = enhancer.process(prepared.small, prepared.ema, 1);
    field = Float32Array.from(rung.post === "enhancer" ? result.enhanced : result.ridge);
    notes.push("enhancer post: single process() call — spatial stages only, temporal state not exercised");
  }
  return { field, notes, approximate: prepared.approximate };
}

/**
 * Extraction at an injected threshold — the geometry path of lines.ts extractLines (:570-586)
 * replayed verbatim: binarize at `threshold` instead of the default, thin, trace, and hand the
 * RAW fragments to completeLines against the untouched field.
 */
export function extractAtThreshold(field: Float32Array, threshold: number): DetectedLines {
  const skeleton = thin(binarize(field, threshold), WORK);
  const { polys } = tracePolylines(skeleton, WORK);
  const completion = completeLines(polys, field, WORK);
  const lines: Record<LabelLineId, readonly (readonly number[])[] | null> = {
    heart: null,
    head: null,
    life: null,
    fate: null,
  };
  for (const id of LABEL_LINE_IDS) {
    const fitted = completion.lines[id as ActiveLineId];
    lines[id] = fitted === undefined ? null : fitted.points.map((p) => [p.x / WORK, p.y / WORK]);
  }
  return { lines };
}

/* ------------------------------ Diagnostics (item 3) ------------------------------ */

export interface FieldStats {
  readonly label: string;
  readonly p99: number;
  readonly mean: number;
  readonly max: number;
}

function stats(label: string, plane: Float32Array): FieldStats {
  const sorted = Float32Array.from(plane).sort();
  let sum = 0;
  for (let i = 0; i < plane.length; i += 1) sum += plane[i];
  return {
    label,
    p99: sorted[Math.floor(sorted.length * 0.99)],
    mean: sum / plane.length,
    max: sorted[sorted.length - 1],
  };
}

/** p99/mean/max of fused, enhanced and ridge maps for one case under one framing. */
export async function diagnoseFields(evalCase: EvalCase, framing: Framing, opts: RunOptions = {}): Promise<FieldStats[] | string> {
  const prepared = await prepare(evalCase, framing, opts);
  if ("error" in prepared) return prepared.error;
  const enhancer = new RekhaEnhancer(WORK);
  const result = enhancer.process(prepared.small, prepared.ema, 1);
  return [
    stats("fused (fusion.ema)", prepared.ema),
    stats("enhanced", Float32Array.from(result.enhanced)),
    stats("ridge (oriented NMS)", Float32Array.from(result.ridge)),
  ];
}

/* ------------------------- Minor emission + vocab diff ------------------------- */

/** The five minor classes the emission-vs-GT table scores, keyed by their labeler id. */
export const MINOR_EMISSION_CLASSES = ["sun", "health", "marriage", "bracelets", "girdle"] as const;
export type MinorEmissionClass = (typeof MINOR_EMISSION_CLASSES)[number];

/**
 * Whether each minor class would EMIT on this field at the flag's thresholds — the same
 * extractAllTraces + minorLineFeatures path the live flag runs (stability null offline, which
 * skips the faint tier; MINOR_EMIT_REQUIRE_STRONG makes that equivalent anyway).
 */
export function minorEmissionOn(field: Float32Array): Record<MinorEmissionClass, boolean> {
  const traces = extractAllTraces(field, WORK, null);
  const found = extractLines(field, WORK);
  const bag = minorLineFeatures(traces, { lifePoly: found.completion.lines.life?.points }, WORK) as {
    lines?: { sun?: unknown; health?: unknown; marriage?: unknown };
    signs?: { bracelets?: { count?: number }; girdle_of_venus?: unknown };
  };
  return {
    sun: bag.lines?.sun !== undefined,
    health: bag.lines?.health !== undefined,
    marriage: bag.lines?.marriage !== undefined,
    bracelets: (bag.signs?.bracelets?.count ?? 0) >= 1,
    girdle: bag.signs?.girdle_of_venus !== undefined,
  };
}

function flattenBag(value: unknown, prefix = ""): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (typeof value !== "object" || value === null) return out;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const at = prefix === "" ? key : `${prefix}.${key}`;
    if (typeof child === "object" && child !== null && !Array.isArray(child)) Object.assign(out, flattenBag(child, at));
    else out[at] = child;
  }
  return out;
}

/** featureVocabV2 off-vs-on feature-bag diff on one field — keys added/changed only. */
export function vocabDiff(field: Float32Array): { added: string[]; changed: string[] } {
  const off = flattenBag(extractLines(field, WORK, false).features);
  const on = flattenBag(extractLines(field, WORK, true).features);
  const added: string[] = [];
  const changed: string[] = [];
  for (const key of Object.keys(on).sort()) {
    if (!(key in off)) added.push(`${key}=${String(on[key])}`);
    else if (String(on[key]) !== String(off[key])) changed.push(`${key}: ${String(off[key])} → ${String(on[key])}`);
  }
  return { added, changed };
}

/** Clear the per-run cache (tests). */
export function resetFieldCache(): void {
  fieldCache.clear();
}
