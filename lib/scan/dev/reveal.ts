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
import { extractAllTraces, extractLines, type ClassifiedTrace } from "../lines";
import type { TraceClass } from "../classify";
import { contractFrameInto, CONTRACT_DEPTH_DEFAULTS } from "../contract";
import { corridorTraces } from "../corridor-traces";
import { MINOR_EMIT_MIN_DEPTH, MINOR_EMIT_MIN_SCORE, MINOR_EMIT_REQUIRE_STRONG } from "../minor-lines";
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

interface RevealFields {
  /** The legacy fused field (classical+fused rung) — what the post-commit reveal shows. */
  readonly legacy: Float32Array;
  /** The H9 contract EMA, built alongside from the same raw planes; null unless requested. */
  readonly contract: Float32Array | null;
}

/**
 * The offline classical pipeline on one canonical crop: six ticks of illumination / stack /
 * Frangi / Gabor ridge / `combineProbabilities` / `fuse`. With `wantContract` the raw pre-CLAHE
 * depth rides along from the SAME `detectRidges` call and the contract plane accumulates in its
 * own FusionState — the eval's `prepare` mirror, in-browser. Without it, byte-identical to the
 * reveal that shipped.
 */
function runClassical(rgba: Uint8ClampedArray, cropSize: number, wantContract: boolean): RevealFields {
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
  let fusionContract: FusionState = emptyFusion(MASK_SIZE);
  const depthRaw = wantContract ? new Float32Array(workPlane) : null;
  for (let tick = 0; tick < REVEAL_TICKS; tick += 1) {
    const normalised = new Float32Array(workPlane);
    const illumination = normaliseIllumination(gray, MASK_SIZE, normalised, validity);
    pushFrame(stack, illumination.out, 4, illumination.bypassed);
    const detectorInput = new Float32Array(illumination.out);
    blendComposite(detectorInput, compositeStack(stack));

    const frangi = new Float32Array(workPlane);
    detectVessels(detectorInput, MASK_SIZE, sigmasFor(MASK_SIZE), frangi);
    normalizeResponses(frangi);
    const measured = depthRaw === null ? detectRidges(gray, MASK_SIZE) : detectRidges(gray, MASK_SIZE, { depth: depthRaw });
    const ridge = Float32Array.from(measured.probability);
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
    if (depthRaw !== null) {
      const contractPlane = new Float32Array(workPlane);
      contractFrameInto(depthRaw, ridge, frangi, null, CONTRACT_DEPTH_DEFAULTS, contractPlane);
      fusionContract = fuse(
        fusionContract,
        {
          width: MASK_SIZE,
          height: MASK_SIZE,
          all: contractPlane,
          resolves: [],
          inferenceMs: 0,
          backend: "reveal-contract",
          stages: { unet: null, ridge, frangi, median: null, photometric: null },
        },
        1000 + tick * 200,
      );
    }
  }
  return { legacy: fusion.ema, contract: depthRaw === null ? null : fusionContract.ema };
}

const toFractions = (points: readonly { readonly x: number; readonly y: number }[]): readonly (readonly number[])[] =>
  points.map((p) => [p.x / MASK_SIZE, p.y / MASK_SIZE] as const);

/**
 * Run the classical pipeline on one canonical crop and return every detected polyline, grouped by
 * labelable id. Pure CPU, a few hundred ms at most — computed once per still and cached by the
 * client. `cropSize` must be a power-of-two multiple of {@link MASK_SIZE} (512 → 128 here).
 */
export function computeReveal(rgba: Uint8ClampedArray, cropSize: number): RevealSet {
  const field = runClassical(rgba, cropSize, false).legacy;
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

/** The app's minor-emission gate (minor-lines.ts constants) — a trace below it is not a claim. */
function emitted(trace: ClassifiedTrace): boolean {
  return (
    trace.classScore >= MINOR_EMIT_MIN_SCORE &&
    trace.depth >= MINOR_EMIT_MIN_DEPTH &&
    (!MINOR_EMIT_REQUIRE_STRONG || trace.tier === "strong")
  );
}

/**
 * CORRECTION-mode prelabel (growth sessions): every class the APP would claim with `fieldContract`
 * and `corridorSearch` on — extraction on the contract EMA, plus corridor fill-in for fate / sun /
 * health / marriage where the skeleton path found nothing.
 *
 * The gates are the app's, per class and per source, because those differ: a MINOR class only
 * becomes a feature when `minorLineFeatures` qualifies its trace (minor-lines.ts's three
 * constants, applied here as {@link emitted}), and a corridor-found minor is subject to exactly the
 * same test — a corridor path scoring below `MINOR_EMIT_MIN_SCORE` is one the rules engine would
 * ignore, so proposing it to a human would be inviting them to accept a line the app never claims.
 * A corridor-found FATE is the deliberate exception: `corridorFateFeatures` claims presence for any
 * accepted fate path, so any accepted fate path is prelabelled.
 *
 * Polylines per id, best first (classifier or corridor score, then length), 0–1 crop fractions.
 * Same window and same rule as {@link computeReveal}: read-only, touches no labeler state — the
 * client decides what a human gets to accept.
 */
export function computePrelabel(rgba: Uint8ClampedArray, cropSize: number): RevealSet {
  const field = runClassical(rgba, cropSize, true).contract;
  if (field === null) throw new Error("prelabel: contract field unavailable");
  const found = extractLines(field, MASK_SIZE);
  const all = extractAllTraces(field, MASK_SIZE);
  const corridor = corridorTraces(field, MASK_SIZE, found, all);

  const out: Record<string, (readonly (readonly number[])[])[]> = {};
  for (const id of LABEL_LINE_IDS) {
    const fitted = found.completion.lines[id as ActiveLineId];
    if (fitted === undefined) continue;
    out[id] = [toFractions(fitted.points)];
  }
  const candidates: { id: LabelableLineId; score: number; poly: readonly (readonly number[])[] }[] = [];
  for (const trace of all.traces) {
    const id = CLASS_TO_MINOR[trace.class];
    if (id === undefined || !emitted(trace)) continue;
    candidates.push({ id, score: trace.classScore, poly: toFractions(trace.points) });
  }
  for (const trace of corridor) {
    if (trace.class === "fate") {
      candidates.push({ id: "fate", score: trace.classScore, poly: toFractions(trace.points) });
      continue;
    }
    const id = CLASS_TO_MINOR[trace.class];
    // A corridor minor faces the rules engine's own gate — see the note above.
    if (id === undefined || !emitted(trace)) continue;
    candidates.push({ id, score: trace.classScore, poly: toFractions(trace.points) });
  }
  candidates.sort((a, b) => b.score - a.score || b.poly.length - a.poly.length);
  for (const candidate of candidates) {
    // Fate comes from completion when it has one; the corridor only ever fills the gap.
    if (candidate.id === "fate" && out.fate !== undefined) continue;
    (out[candidate.id] ??= []).push(candidate.poly);
  }
  return out as RevealSet;
}
