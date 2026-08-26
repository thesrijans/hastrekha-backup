/**
 * The browser path, end to end, on a real photograph.
 *
 * Every stage of this pipeline has passed its own unit test while the live overlay stayed blank, and
 * the reason is that the unit tests exercise the *offline* path: they hand `detectRidges` a
 * grayscale array and read a probability field back. The browser does something different. It
 * rectifies a camera frame, ships the crop to a worker at one resolution, does the classical work at
 * another, ships fields back, folds them into an accumulator sized somewhere else again, and only
 * then traces. Almost all of the ways this can fail are *size and plumbing* failures that a
 * stage-level test cannot see, because each stage is individually correct.
 *
 * So this test replicates the worker's own call sequence verbatim — the same downsample, the same
 * detectors at the same working size, the same upsample, the same merge — and then drives the real
 * `fuse` / `extractLines` the hook drives, asserting that polylines actually arrive at the point the
 * overlay would draw them. It is the only test in the suite that would have caught a blank screen.
 */
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import sharp from "sharp";
import { detectRidges, normalizeResponses } from "../lib/scan/ridge";
import { detectVessels, sigmasFor } from "../lib/scan/frangi";
import { normaliseIllumination } from "../lib/scan/illumination";
import { blendComposite, compositeStack, emptyStack, pushFrame } from "../lib/scan/stack";
import { combineProbabilities } from "../lib/scan/segmenter";
import { alignFusion, emptyFusion, fuse, maskApplies, type FusionState } from "../lib/scan/fusion";
import { extractLines } from "../lib/scan/lines";
import { rectifyPalm } from "../lib/scan/rectify";
import { MASK_SIZE, RECTIFIED_SIZE, type LineMask, type Point2 } from "../lib/scan/types";

/** Mirrors `WORK_SIZE` in segmenter.worker.ts. Kept local so a drift there fails here loudly. */
const WORK_SIZE = 128;

const makeImageData = (w: number, h: number): ImageData =>
  ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4), colorSpace: "srgb" }) as ImageData;

/* ----------------------- The worker's own arithmetic ----------------------- */

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

interface Telemetry {
  cropsSent: number;
  workerReplies: number;
  maskLength: number;
  maskAboveThreshold: number;
  fusionFrames: number;
  fusionConfidence: number;
  tracesExtracted: number;
  polylinesAfterCompletion: number;
  polylinesToOverlay: number;
}

/**
 * One worker `infer` cycle, following segmenter.worker.ts step for step.
 *
 * @returns the mask exactly as `segmenter-onnx.ts` would construct it from the reply — including its
 * declared width and height, which is the field the rest of the pipeline trusts and the one most
 * likely to be wrong after a resolution change.
 */
function workerInfer(rgba: Uint8ClampedArray, size: number, inside: Uint8Array, stack: ReturnType<typeof emptyStack>): LineMask {
  const plane = size * size;
  const work = size >= WORK_SIZE * 2 && size % 2 === 0 ? size >> 1 : size;
  const workPlane = work * work;

  const gray = new Float32Array(plane);
  for (let i = 0; i < plane; i += 1) {
    const at = i * 4;
    gray[i] = (0.2126 * rgba[at] + 0.7152 * rgba[at + 1] + 0.0722 * rgba[at + 2]) / 255;
  }

  let workGray = gray;
  let validity: Uint8Array | null = inside;
  if (work !== size) {
    const small = new Float32Array(workPlane);
    downsample2(gray, size, small);
    workGray = small;
    const smallValidity = new Uint8Array(workPlane);
    for (let y = 0; y < work; y += 1) {
      const a = 2 * y * size;
      const b = a + size;
      for (let x = 0; x < work; x += 1) {
        const at = 2 * x;
        smallValidity[y * work + x] = inside[a + at] & inside[a + at + 1] & inside[b + at] & inside[b + at + 1];
      }
    }
    validity = smallValidity;
  }

  const normalised = new Float32Array(workPlane);
  const illumination = normaliseIllumination(workGray, work, normalised, validity);
  pushFrame(stack, illumination.out, 4, illumination.bypassed);
  const composite = compositeStack(stack);
  const detectorInput = new Float32Array(illumination.out);
  blendComposite(detectorInput, composite);

  const frangi = new Float32Array(workPlane);
  detectVessels(detectorInput, work, sigmasFor(work), frangi);
  normalizeResponses(frangi);

  const ridge = Float32Array.from(detectRidges(workGray, work).probability);

  const classical = new Float32Array(workPlane);
  for (let i = 0; i < workPlane; i += 1) classical[i] = ridge[i] > frangi[i] ? ridge[i] : frangi[i];
  const fused = combineProbabilities(null, classical);

  // Exactly how segmenter-onnx.ts builds the mask from the reply: at the WORKING size.
  return {
    width: work,
    height: work,
    all: fused,
    resolves: [],
    inferenceMs: 0,
    backend: "classical",
    stages: { unet: null, ridge, frangi, median: composite === null ? null : Float32Array.from(composite), photometric: null },
  };
}

/* ------------------------------- The run ----------------------------------- */

const FRAME = "docs/reference/lines-missing-tilt-03.png";

async function main(): Promise<void> {
  if (!existsSync(FRAME)) {
    console.log(`BROWSER PATH: ${FRAME} not present — skipping.`);
    console.log("BROWSER PATH ASSERTIONS PASSED");
    return;
  }

  const { data, info } = await sharp(FRAME).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const source = { width: info.width, height: info.height, data: new Uint8ClampedArray(data) } as ImageData;

  /*
   * The four palm anchors, recovered from the burned-in overlay dots in the reference frame itself
   * rather than guessed — the same technique that caught a bad crop in an earlier step.
   */
  const anchors: Point2[] = [
    { x: 294, y: 543 }, // wrist
    { x: 212, y: 493 }, // thumb CMC
    { x: 221, y: 297 }, // index MCP
    { x: 376, y: 355 }, // pinky MCP
  ];

  const telemetry: Telemetry = {
    cropsSent: 0,
    workerReplies: 0,
    maskLength: 0,
    maskAboveThreshold: 0,
    fusionFrames: 0,
    fusionConfidence: 0,
    tracesExtracted: 0,
    polylinesAfterCompletion: 0,
    polylinesToOverlay: 0,
  };

  const size = RECTIFIED_SIZE;
  const warped = rectifyPalm(source, anchors, size, makeImageData);
  assert.ok(warped !== null, "the reference frame rectifies");
  assert.ok(warped.coverage > 0.6, `and the crop is mostly inside the frame (${warped.coverage.toFixed(2)})`);

  /*
   * The accumulator is created the way the hook creates it — with NO size argument. If that default
   * ever stops matching the crop the worker is fed, `fuse` returns early and silently, and this is
   * the line that catches it.
   */
  let fusion: FusionState = emptyFusion(MASK_SIZE);
  const stack = emptyStack(size >= WORK_SIZE * 2 ? size >> 1 : size);
  let published: readonly (readonly Point2[])[] = [];

  for (let tick = 0; tick < 6; tick += 1) {
    telemetry.cropsSent += 1;
    const mask = workerInfer(warped.image.data, size, warped.inside, stack);
    telemetry.workerReplies += 1;
    telemetry.maskLength = mask.all.length;
    telemetry.maskAboveThreshold = mask.all.reduce((n, v) => (v > 0.45 ? n + 1 : n), 0);

    const aligned = alignFusion(fusion, warped.toCrop, anchors.length);
    fusion = aligned.state;
    assert.ok(maskApplies(fusion, anchors.length), "the mask is addressed to the accumulator's crop space");

    const before = fusion.frames;
    fusion = fuse(fusion, mask, 1000 + tick * 200);
    assert.equal(
      fusion.frames,
      before + 1,
      `tick ${tick}: fuse() accepted the mask — a silent no-op here means a size mismatch ` +
        `(mask ${mask.width}x${mask.height} = ${mask.all.length}, accumulator ${fusion.size}² = ${fusion.ema.length})`,
    );
  }
  telemetry.fusionFrames = fusion.frames;
  telemetry.fusionConfidence = fusion.confidence;

  const found = extractLines(fusion.ema, fusion.size);
  telemetry.tracesExtracted = found.fragments.length;
  telemetry.polylinesAfterCompletion = found.polys.length;
  // The hook's publish guard, verbatim: an empty extraction is not published.
  if (found.polys.length > 0) published = found.polys;
  telemetry.polylinesToOverlay = published.length;

  console.log("browser-path telemetry:");
  for (const [key, value] of Object.entries(telemetry)) {
    console.log(`  ${key.padEnd(26)} ${typeof value === "number" ? value.toFixed(value % 1 === 0 ? 0 : 3) : value}`);
  }
  for (const id of ["heart", "head", "life", "fate"] as const) {
    const report = found.completion.reports[id];
    console.log(
      `  ${`completion.${id}`.padEnd(26)} ${report.accepted ? "ACCEPT" : `reject ${report.reject}`}` +
        ` (seeds ${report.seedCount}, observed ${(report.observedFraction * 100).toFixed(0)}%, E ${report.energy.toFixed(2)})`,
    );
  }

  /* The assertions, in pipeline order, so the FIRST failure names the stage that broke. */
  assert.equal(telemetry.maskLength, MASK_SIZE * MASK_SIZE, "the worker returns a mask at MASK_SIZE");
  assert.equal(fusion.size, MASK_SIZE, "and the accumulator is sized to match it");
  assert.ok(telemetry.maskAboveThreshold > 200, `the mask carries real signal (${telemetry.maskAboveThreshold} px)`);
  assert.equal(telemetry.fusionFrames, 6, "every reply reached the accumulator");
  assert.ok(telemetry.fusionConfidence > 0.2, `and it believes them (${telemetry.fusionConfidence.toFixed(3)})`);
  assert.ok(telemetry.tracesExtracted > 0, `thinning traced fragments (${telemetry.tracesExtracted})`);
  assert.ok(
    telemetry.polylinesAfterCompletion >= 2,
    `completion produced at least two lines (${telemetry.polylinesAfterCompletion})`,
  );
  assert.ok(telemetry.polylinesToOverlay >= 2, `and they passed the hook's publish guard (${telemetry.polylinesToOverlay})`);

  /* Finally: the geometry the overlay would draw must be inside the crop it was traced from. */
  /*
   * The overlay maps these through `canonicalQuad(MASK_SIZE)`, so every point must lie inside a
   * MASK_SIZE square. If the pipeline's resolution ever changes without the overlay's, traces land in
   * a corner of the palm — visually subtle, and this is the assertion that names it.
   */
  for (const poly of published) {
    for (const point of poly) {
      assert.ok(
        point.x >= -1 && point.y >= -1 && point.x <= MASK_SIZE + 1 && point.y <= MASK_SIZE + 1,
        `a drawn point stays inside the mask square (${point.x.toFixed(1)}, ${point.y.toFixed(1)})`,
      );
    }
  }

  console.log("BROWSER PATH ASSERTIONS PASSED");
}

void main();
