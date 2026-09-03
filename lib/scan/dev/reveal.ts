/**
 * Post-commit detector reveal for the labeler (dev harness, lane C).
 *
 * THE ONE SANCTIONED DETECTOR WINDOW IN THE LABELING FLOW. Decision D1 keeps the labeler
 * blank-slate by banning detector imports from the labeler files; this module deliberately sits
 * outside that wall and runs the offline classical pipeline (the eval harness's "classical+fused"
 * rung, in-browser) so the labeler can see what the detector found — but ONLY after the label is
 * frozen. The guarantee moves from "the code cannot see detector output" to "the code cannot see
 * it BEFORE the commit", enforced by the client (reveal is mechanically blocked until the active
 * line is committed or marked absent) and audited by `revealUsed` recorded per line.
 *
 * Everything here is read-only with respect to labels: it takes crop pixels in and hands
 * polylines out. It never touches labeler state.
 */
import { MASK_SIZE, type ActiveLineId } from "../types";
import { normaliseIllumination } from "../illumination";
import { blendComposite, compositeStack, emptyStack, pushFrame } from "../stack";
import { detectVessels, sigmasFor } from "../frangi";
import { detectRidges, normalizeResponses } from "../ridge";
import { combineProbabilities } from "../segmenter";
import { emptyFusion, fuse, type FusionState } from "../fusion";
import { extractAllTraces, extractLines } from "../lines";
import type { TraceClass } from "../classify";
import { LABEL_LINE_IDS, type LabelableLineId } from "./session-types";

/** Same convergence count the eval harness replays — the EMA settles, parity with 0d. */
const REVEAL_TICKS = 6;

/** Classifier classes → labeler minor ids (majors come from completion, not the classifier). */
const CLASS_TO_MINOR: Partial<Record<TraceClass, LabelableLineId>> = {
  sun: "sun",
  health: "health",
  marriage: "marriage",
  bracelets: "bracelets",
  girdle_of_venus: "girdle",
};

/** Detected polylines per labelable id, 0–1 crop fractions. Minor classes can have several. */
export type RevealSet = Partial<Record<LabelableLineId, readonly (readonly (readonly number[])[])[]>>;

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

/**
 * Run the classical pipeline on one canonical crop and return every detected polyline, grouped by
 * labelable id. Pure CPU, a few hundred ms at most — computed once per still and cached by the
 * client. `cropSize` must be a power-of-two multiple of {@link MASK_SIZE} (512 → 128 here).
 */
export function computeReveal(rgba: Uint8ClampedArray, cropSize: number): RevealSet {
  const plane = cropSize * cropSize;
  let gray = new Float32Array(plane);
  for (let i = 0; i < plane; i += 1) {
    const at = i * 4;
    gray[i] = (0.2126 * rgba[at] + 0.7152 * rgba[at + 1] + 0.0722 * rgba[at + 2]) / 255;
  }
  let size = cropSize;
  while (size > MASK_SIZE) {
    const next = new Float32Array((size >> 1) * (size >> 1));
    downsample2(gray, size, next);
    gray = next;
    size >>= 1;
  }

  const workPlane = MASK_SIZE * MASK_SIZE;
  const validity = new Uint8Array(workPlane).fill(1);
  const stack = emptyStack(MASK_SIZE);
  let fusion: FusionState = emptyFusion(MASK_SIZE);
  for (let tick = 0; tick < REVEAL_TICKS; tick += 1) {
    const normalised = new Float32Array(workPlane);
    const illumination = normaliseIllumination(gray, MASK_SIZE, normalised, validity);
    pushFrame(stack, illumination.out, 4, illumination.bypassed);
    const detectorInput = new Float32Array(illumination.out);
    blendComposite(detectorInput, compositeStack(stack));

    const frangi = new Float32Array(workPlane);
    detectVessels(detectorInput, MASK_SIZE, sigmasFor(MASK_SIZE), frangi);
    normalizeResponses(frangi);
    const ridge = Float32Array.from(detectRidges(gray, MASK_SIZE).probability);
    const classical = new Float32Array(workPlane);
    for (let i = 0; i < workPlane; i += 1) classical[i] = ridge[i] > frangi[i] ? ridge[i] : frangi[i];

    fusion = fuse(
      fusion,
      {
        width: MASK_SIZE,
        height: MASK_SIZE,
        all: combineProbabilities(null, classical),
        resolves: [],
        inferenceMs: 0,
        backend: "reveal-classical",
        stages: { unet: null, ridge, frangi, median: null, photometric: null },
      },
      1000 + tick * 200,
    );
  }

  const field = fusion.ema;
  const out: Record<string, (readonly (readonly number[])[])[]> = {};

  const found = extractLines(field, MASK_SIZE);
  for (const id of LABEL_LINE_IDS) {
    const fitted = found.completion.lines[id as ActiveLineId];
    if (fitted === undefined) continue;
    out[id] = [fitted.points.map((p) => [p.x / MASK_SIZE, p.y / MASK_SIZE] as const)];
  }

  const traceSet = extractAllTraces(field, MASK_SIZE);
  for (const trace of traceSet.traces) {
    const id = CLASS_TO_MINOR[trace.class];
    if (id === undefined) continue;
    const poly = trace.points.map((p) => [p.x / MASK_SIZE, p.y / MASK_SIZE] as const);
    (out[id] ??= []).push(poly);
  }
  return out as RevealSet;
}
