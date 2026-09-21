/**
 * S1.5 — the frame cost rekhaPersist adds, measured in isolation.
 *
 * Everything the live hook does per rectified frame with the flag on and not
 * with it off: the working-size gray downsample of the 256 crop, the frame
 * weight (palm-box VoL at camera resolution, 1280×720), and the accumulator's
 * observe (evidence, extraction field, hold re-measure), plus — once per
 * extraction — the hold's measurement of the new extraction. Run over real
 * frames from the worker-equivalent chain (the golden session), after a
 * warm-up, many times, so a figure is a distribution and not one lucky frame.
 *
 *   npx tsx scripts/scan/bench-rekha.ts
 */
import { readFileSync } from "node:fs";
import { extractLines } from "../../lib/scan/lines";
import { RekhaPersistence, evidenceFieldInto, palmBoxVol, rekhaFrameWeight, rekhaGray } from "../../lib/scan/rekha-persist";
import { frameWeightFromSharpness } from "../../lib/scan/enhance/rekha-enhancer";
import { MASK_SIZE, RECTIFIED_SIZE } from "../../lib/scan/types";
import { loadImage, ReplayChain, WORK } from "./replay-chain";

const SESSION_DIR = "fixtures/golden/session-2026-09-02T16-16-28-716Z";
const WARMUP = 200;
const RUNS = 2000;

const stats = (xs: number[]): string => {
  const s = [...xs].sort((a, b) => a - b);
  const at = (p: number): number => s[Math.min(s.length - 1, Math.floor(s.length * p))] ?? NaN;
  return `median ${at(0.5).toFixed(3)} · p95 ${at(0.95).toFixed(3)} · p99 ${at(0.99).toFixed(3)} ms`;
};

async function main(): Promise<void> {
  const meta = JSON.parse(readFileSync(`${SESSION_DIR}/metadata.json`, "utf8")) as {
    stills: { rawFile: string; anchors: number[][]; landmarks: { x: number; y: number }[] }[];
  };
  const chain = new ReplayChain(null);
  const frames: { plane: Float32Array; gray: Float32Array; source: ImageData; landmarks: { x: number; y: number }[] }[] = [];
  for (const still of meta.stills) {
    const source = await loadImage(`${SESSION_DIR}/raw/${still.rawFile}`);
    const out = await chain.frame(source, still.anchors.map(([x = 0, y = 0]) => ({ x, y })));
    if (out !== null) frames.push({ plane: out.plane, gray: out.gray, source, landmarks: still.landmarks });
  }
  const crop = {
    width: RECTIFIED_SIZE,
    height: RECTIFIED_SIZE,
    data: new Uint8ClampedArray(RECTIFIED_SIZE * RECTIFIED_SIZE * 4).map((_, i) => (i * 37) % 251),
  } as unknown as ImageData;
  const rekha = new RekhaPersistence(WORK);
  const tGray: number[] = [];
  const tWeight: number[] = [];
  const tObserve: number[] = [];
  const tUpdate: number[] = [];
  const tHold: number[] = [];
  const tExtracted: number[] = [];
  const tTotal: number[] = [];
  for (let i = 0; i < WARMUP + RUNS; i += 1) {
    const f = frames[i % frames.length]!;
    const t0 = performance.now();
    rekhaGray(crop, MASK_SIZE);
    const t1 = performance.now();
    const { weight } = rekhaFrameWeight(f.source, f.landmarks);
    const t2 = performance.now();
    // observe(), in its parts: evidence update, field, hold (shift + re-measure).
    rekha.accumulator.update(f.plane, f.gray, weight);
    const tu = performance.now();
    rekha.hold.shift(rekha.accumulator.lastShiftX, rekha.accumulator.lastShiftY);
    evidenceFieldInto(rekha.accumulator, rekha.field);
    const th = performance.now();
    rekha.hold.update(rekha.accumulator, null, i * 200);
    const t3 = performance.now();
    if (i >= WARMUP) {
      tUpdate.push(tu - t2);
      tHold.push(t3 - th);
    }
    let extra = 0;
    if (i % 4 === 0) {
      const found = extractLines(rekha.field, WORK); // paid by both paths; not timed as added
      const t4 = performance.now();
      rekha.extracted(found, i * 200);
      extra = performance.now() - t4;
    }
    if (i < WARMUP) continue;
    tGray.push(t1 - t0);
    tWeight.push(t2 - t1);
    tObserve.push(t3 - t2);
    if (i % 4 === 0) tExtracted.push(extra);
    tTotal.push(t3 - t0 + extra);
  }
  console.log(`rekhaPersist added cost per frame, ${RUNS} frames after ${WARMUP} warm-up (Node ${process.version}, V8):`);
  console.log(`  gray downsample (256 → 128)       ${stats(tGray)}`);
  console.log(`  frame weight (palm-box VoL, 1280×720) ${stats(tWeight)}`);
  console.log(`  accumulator observe               ${stats(tObserve)}`);
  console.log(`    of which evidence update        ${stats(tUpdate)}`);
  console.log(`    of which hold re-measure        ${stats(tHold)}`);
  console.log(`  hold measure of an extraction     ${stats(tExtracted)}   (1 frame in ~3.5)`);
  console.log(`  TOTAL added                       ${stats(tTotal)}`);

  // The sampled sharpness against the full one, on every fixture frame: same statistic, a ninth of the pixels.
  const legacy = ["lines-current-02", "lines-missing-tilt-03"].map((name) => {
    const gt = JSON.parse(readFileSync(`test/fixtures/ground-truth/${name}.json`, "utf8")) as { frame: string; anchors: number[][] };
    return { file: gt.frame, anchors: gt.anchors };
  });
  let worstRel = 0;
  let weightFlips = 0;
  const rows: string[] = [];
  for (const [i, f] of frames.entries()) {
    const full = palmBoxVol(f.source, f.landmarks, 1);
    const sampled = palmBoxVol(f.source, f.landmarks);
    worstRel = Math.max(worstRel, Math.abs(sampled - full) / full);
    if ((frameWeightFromSharpness(full) >= 0.05) !== (frameWeightFromSharpness(sampled) >= 0.05)) weightFlips += 1;
    rows.push(`still ${i}: ${full.toFixed(1)} vs ${sampled.toFixed(1)}`);
  }
  for (const l of legacy) {
    const source = await loadImage(l.file);
    const box = l.anchors.map(([x = 0, y = 0]) => ({ x: x / source.width, y: y / source.height }));
    const full = palmBoxVol(source, box, 1);
    const sampled = palmBoxVol(source, box);
    worstRel = Math.max(worstRel, Math.abs(sampled - full) / full);
    if ((frameWeightFromSharpness(full) >= 0.05) !== (frameWeightFromSharpness(sampled) >= 0.05)) weightFlips += 1;
    rows.push(`${l.file.split("/").pop()}: ${full.toFixed(1)} vs ${sampled.toFixed(1)}`);
  }
  console.log(`
palm-box VoL, full vs stride-3 sample, ${rows.length} fixture frames: worst relative difference ${(worstRel * 100).toFixed(1)}%, usable/unusable verdict changed on ${weightFlips}`);
  console.log(`  ${rows.join(" · ")}`);
}

void main();
