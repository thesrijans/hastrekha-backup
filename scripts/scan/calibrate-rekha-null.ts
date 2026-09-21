/**
 * Calibrate the rekhaPersist accumulator's null level to the field it is fed.
 *
 * The accumulator scores each pixel by logit(response) − logit(nullLevel): a
 * response above the null argues for a crease, one below argues against. So
 * the null must be the level CREASELESS SKIN produces in the per-frame field
 * the live path hands it — the legacy `mask.all` (the chamber runs with
 * fieldContract off) — not the raw detector's, not the EMA's.
 *
 * Measured on the two legacy fixtures (hand-traced ground truth: background =
 * inside the palm quad and more than MARGIN px from every traced crease) and
 * one session still (no labels exist for the session, so background = more than
 * MARGIN px from the still's own extracted skeleton — a proxy, and said so).
 * Each case runs through the worker's chain (scripts/scan/replay-chain.ts) for
 * 12 frames so the stack is warm and both UNet frames (every 6th) and
 * classical-only frames are sampled; frames 1–3 are discarded as warm-up.
 *
 * Also reports each case's frame weight (crop VoL through the enhancer ramp),
 * because a null level is only half the calibration: a weight of zero on every
 * frame would make the accumulator skip the lot.
 *
 *   npx tsx scripts/scan/calibrate-rekha-null.ts
 */
import { readFileSync } from "node:fs";
import { alignFusion, emptyFusion, fuse, type FusionState } from "../../lib/scan/fusion";
import { binarize, thin, LINE_THRESHOLD } from "../../lib/scan/lines";
import { rekhaFrameWeight } from "../../lib/scan/rekha-persist";
import type { Point2 } from "../../lib/scan/types";
import { loadImage, loadUnet, ReplayChain, WORK } from "./replay-chain";

const MARGIN = 4;
const FRAMES = 12;
const WARMUP = 3;

interface Case {
  readonly name: string;
  readonly image: string;
  readonly anchors: Point2[];
  /** Crease polylines in working-size pixels, or null to derive background from the still's own skeleton. */
  readonly creases: Point2[][] | null;
  /** Normalised points the frame weight's box is cut round: landmarks when the case has them, else its anchors. */
  readonly box: (source: ImageData) => { x: number; y: number }[];
}

function legacy(name: string): Case {
  const gt = JSON.parse(readFileSync(`test/fixtures/ground-truth/${name}.json`, "utf8")) as {
    frame: string;
    anchors: number[][];
    lines: { points: number[][] }[];
  };
  return {
    name,
    image: gt.frame,
    anchors: gt.anchors.map(([x = 0, y = 0]) => ({ x, y })),
    creases: gt.lines.map((l) => l.points.map(([x = 0, y = 0]) => ({ x: x * WORK, y: y * WORK }))),
    box: (source) => gt.anchors.map(([x = 0, y = 0]) => ({ x: x / source.width, y: y / source.height })),
  };
}

function sessionStill(index: number): Case {
  const dir = "fixtures/golden/session-2026-09-02T16-16-28-716Z";
  const meta = JSON.parse(readFileSync(`${dir}/metadata.json`, "utf8")) as {
    stills: { rawFile: string; anchors: number[][]; landmarks: { x: number; y: number }[] }[];
  };
  const still = meta.stills[index]!;
  return {
    name: `session still ${index}`,
    image: `${dir}/raw/${still.rawFile}`,
    anchors: still.anchors.map(([x = 0, y = 0]) => ({ x, y })),
    creases: null,
    box: () => still.landmarks.map((l) => ({ x: l.x, y: l.y })),
  };
}

/** Per-pixel distance (working px) to the nearest crease sample — brute force over densified polylines. */
function nearCrease(creases: Point2[][], size: number): Uint8Array {
  const near = new Uint8Array(size * size);
  for (const line of creases) {
    for (let k = 0; k + 1 < line.length; k += 1) {
      const a = line[k]!;
      const b = line[k + 1]!;
      const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) * 2));
      for (let s = 0; s <= steps; s += 1) {
        const x = a.x + ((b.x - a.x) * s) / steps;
        const y = a.y + ((b.y - a.y) * s) / steps;
        for (let dy = -MARGIN; dy <= MARGIN; dy += 1) {
          for (let dx = -MARGIN; dx <= MARGIN; dx += 1) {
            if (dx * dx + dy * dy > MARGIN * MARGIN) continue;
            const px = Math.round(x + dx);
            const py = Math.round(y + dy);
            if (px >= 0 && py >= 0 && px < size && py < size) near[py * size + px] = 1;
          }
        }
      }
    }
  }
  return near;
}

function skeletonCreases(field: Float32Array, size: number): Point2[][] {
  const skeleton = thin(binarize(field, LINE_THRESHOLD * 0.6), size);
  const points: Point2[][] = [];
  for (let i = 0; i < skeleton.length; i += 1) if (skeleton[i]) points.push([{ x: i % size, y: Math.floor(i / size) }, { x: i % size, y: Math.floor(i / size) }]);
  return points;
}

const pct = (sorted: Float32Array, p: number): number => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] ?? NaN;

async function main(): Promise<void> {
  const unet = await loadUnet();
  console.log(`UNet: ${unet === null ? "unavailable — classical only" : "public/models/palm-lines.onnx (onnxruntime-web, wasm)"}\n`);
  const cases = [legacy("lines-current-02"), legacy("lines-missing-tilt-03"), sessionStill(0)];
  const pooled: number[] = [];
  const perCaseP95: number[] = [];
  for (const c of cases) {
    const source = await loadImage(c.image);
    const chain = new ReplayChain(unet);
    let fusion: FusionState = emptyFusion(WORK);
    const frames: { plane: Float32Array; validity: Uint8Array; usedUnet: boolean }[] = [];
    let vol = 0;
    let weight = 0;
    for (let f = 1; f <= FRAMES; f += 1) {
      const frame = await chain.frame(source, c.anchors);
      if (frame === null) throw new Error(`${c.name}: rectification failed`);
      fusion = alignFusion(fusion, frame.toCrop, frame.convention).state;
      fusion = fuse(fusion, { width: WORK, height: WORK, all: frame.plane, resolves: [], inferenceMs: 0, backend: "replay" }, 1000 + f * 200);
      if (f > WARMUP) frames.push({ plane: frame.plane, validity: frame.validity, usedUnet: frame.usedUnet });
      ({ vol, weight } = rekhaFrameWeight(source, c.box(source)));
    }
    const near = nearCrease(c.creases ?? skeletonCreases(fusion.ema, WORK), WORK);
    const report: string[] = [];
    const all: number[] = [];
    for (const kind of [true, false]) {
      const values: number[] = [];
      for (const fr of frames) {
        if (fr.usedUnet !== kind) continue;
        for (let i = 0; i < fr.plane.length; i += 1) if (fr.validity[i] && !near[i]) values.push(fr.plane[i] ?? 0);
      }
      all.push(...values);
      if (values.length === 0) continue;
      const sorted = Float32Array.from(values).sort();
      report.push(`${kind ? "UNet" : "classical"} frames: n=${values.length} p50 ${pct(sorted, 0.5).toFixed(4)} p90 ${pct(sorted, 0.9).toFixed(4)} p95 ${pct(sorted, 0.95).toFixed(4)} p99 ${pct(sorted, 0.99).toFixed(4)}`);
    }
    const sortedAll = Float32Array.from(all).sort();
    const p95 = pct(sortedAll, 0.95);
    perCaseP95.push(p95);
    // Equal weight per case in the pool: resample every case to the same count.
    const n = 20000;
    for (let k = 0; k < n; k += 1) pooled.push(sortedAll[Math.floor((k / n) * sortedAll.length)] ?? 0);
    console.log(`${c.name} (${c.creases === null ? "background: off its own skeleton" : "background: off traced ground truth"})`);
    for (const line of report) console.log(`  ${line}`);
    console.log(`  all frames: p95 ${p95.toFixed(4)}   palm-box VoL ${vol.toFixed(1)} -> frame weight ${weight.toFixed(3)}\n`);
  }
  const sortedPool = Float32Array.from(pooled).sort();
  console.log(`pooled (equal weight per case): p50 ${pct(sortedPool, 0.5).toFixed(4)} p90 ${pct(sortedPool, 0.9).toFixed(4)} p95 ${pct(sortedPool, 0.95).toFixed(4)} p99 ${pct(sortedPool, 0.99).toFixed(4)}`);
  console.log(`per-case p95: ${perCaseP95.map((v) => v.toFixed(4)).join(", ")}`);
}

void main();
