/**
 * The full detector pipeline on a committed ground-truth frame, reduced to one JSON value.
 *
 * Not a test — the shared body of `golden.test.ts`, which pins this output, and the child process
 * that test spawns to prove the pin actually bites. It is a module and a CLI at once:
 *
 * ```
 * tsx test/golden-run.ts lines-missing-tilt-03    # prints the snapshot to stdout
 * ```
 *
 * The chain is the BROWSER one, deliberately: the same worker-equivalent tiering, the same fusion
 * accumulator at MASK_SIZE, the same six ticks. An offline shortcut here would pin a pipeline nobody
 * runs, which is how the ridge-floor bug survived five steps of green tests.
 */
import { existsSync, readFileSync } from "node:fs";
import sharp from "sharp";
import { rectifyPalm } from "../lib/scan/rectify";
import { detectRidges, normalizeResponses } from "../lib/scan/ridge";
import { detectVessels, sigmasFor } from "../lib/scan/frangi";
import { normaliseIllumination } from "../lib/scan/illumination";
import { blendComposite, compositeStack, emptyStack, pushFrame } from "../lib/scan/stack";
import { combineProbabilities } from "../lib/scan/segmenter";
import { alignFusion, emptyFusion, fuse, type FusionState } from "../lib/scan/fusion";
import { extractLines } from "../lib/scan/lines";
import { MASK_SIZE, RECTIFIED_SIZE, type Point2 } from "../lib/scan/types";

const WORK = MASK_SIZE;
const TICKS = 6;

export interface GroundTruth {
  readonly frame: string;
  readonly anchors: readonly (readonly number[])[];
  readonly lines: readonly { readonly id: string; readonly points: readonly (readonly number[])[] }[];
}

export function groundTruthPath(name: string): string {
  return `test/fixtures/ground-truth/${name}.json`;
}

export function loadGroundTruth(name: string): GroundTruth | null {
  const at = groundTruthPath(name);
  if (!existsSync(at)) return null;
  const gt = JSON.parse(readFileSync(at, "utf8")) as GroundTruth;
  return existsSync(gt.frame) ? gt : null;
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

/** Rounded so the snapshot pins behaviour rather than the last bit of a float. */
function round(value: unknown): unknown {
  if (typeof value === "number") return Number.isInteger(value) ? value : Number(value.toFixed(4));
  if (Array.isArray(value)) return value.map(round);
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      out[key] = round((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}

export interface GoldenSnapshot {
  readonly frame: string;
  readonly polylines: number;
  readonly fragments: number;
  readonly completion: Record<string, { accepted: boolean; reject: string | null; observed: number; energy: number }>;
  readonly features: unknown;
}

export async function runFrame(name: string): Promise<GoldenSnapshot | null> {
  const gt = loadGroundTruth(name);
  if (gt === null) return null;

  const { data, info } = await sharp(gt.frame).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const source = { width: info.width, height: info.height, data: new Uint8ClampedArray(data) } as ImageData;
  const anchors: Point2[] = gt.anchors.map((a) => ({ x: a[0], y: a[1] }));

  const size = RECTIFIED_SIZE;
  const warped = rectifyPalm(source, anchors, size, makeImageData);
  if (warped === null) return null;

  const plane = size * size;
  const workPlane = WORK * WORK;
  const gray = new Float32Array(plane);
  for (let i = 0; i < plane; i += 1) {
    const at = i * 4;
    gray[i] = (0.2126 * warped.image.data[at] + 0.7152 * warped.image.data[at + 1] + 0.0722 * warped.image.data[at + 2]) / 255;
  }
  const small = new Float32Array(workPlane);
  downsample2(gray, size, small);
  const validity = new Uint8Array(workPlane);
  for (let y = 0; y < WORK; y += 1) {
    const a = 2 * y * size;
    const b = a + size;
    for (let x = 0; x < WORK; x += 1) {
      const at = 2 * x;
      validity[y * WORK + x] = warped.inside[a + at] & warped.inside[a + at + 1] & warped.inside[b + at] & warped.inside[b + at + 1];
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
        all: combineProbabilities(null, classical),
        resolves: [],
        inferenceMs: 0,
        backend: "classical",
        stages: { unet: null, ridge, frangi, median: null, photometric: null },
      },
      1000 + tick * 200,
    );
  }

  const found = extractLines(fusion.ema, fusion.size);
  const completion: GoldenSnapshot["completion"] = {};
  for (const id of ["heart", "head", "life", "fate"] as const) {
    const report = found.completion.reports[id];
    completion[id] = {
      accepted: report.accepted,
      reject: report.reject ?? null,
      observed: Number(report.observedFraction.toFixed(4)),
      energy: Number(report.energy.toFixed(4)),
    };
  }

  return {
    frame: name,
    polylines: found.polys.length,
    fragments: found.fragments.length,
    completion: round(completion) as GoldenSnapshot["completion"],
    features: round(found.features),
  };
}

export const GOLDEN_FRAMES = ["lines-missing-tilt-03", "lines-current-02"] as const;

if (process.argv[1]?.endsWith("golden-run.ts")) {
  void (async () => {
    const out: Record<string, GoldenSnapshot | null> = {};
    for (const name of GOLDEN_FRAMES) out[name] = await runFrame(name);
    process.stdout.write(JSON.stringify(out, null, 2));
  })();
}
