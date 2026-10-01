/**
 * scan-perfect evidence D8 — the lab's Ridge view of the supplied phone photo, re-rendered.
 *
 * fixtures/private/images/lab-ridge-view-phone-photo.png is a screenshot of /scan's debug panel
 * (components/scan/debug-panel.tsx) with the Ridge tab selected. The panel paints the worker's 128² ridge field
 * (`tier.workRidge` = detectRidges(workGray, 128), lib/scan/segmenter.worker.ts) 1:1 into the TOP-LEFT of its 256²
 * canvas — paintField, colour ramp (53, 224, 200) × value — over the rectified crop the canvas still holds, so the
 * screenshot shows the whole crop's ridge field as an inset and three quarters of the crop itself.
 *
 * This rebuilds that view from the screenshot and the CURRENT code:
 *   1. the 254 px panel at (31, 37) back to the 256² canvas;
 *   2. the original ridge field read back from the inset's green channel (value = G / 224);
 *   3. the crop with its hidden top-left quarter filled smoothly from its edges (said so: the ridge field's
 *      top-left quarter is therefore not comparable and is left out of every score);
 *   4. detectRidges on that crop exactly as the worker runs it (luma → 2×2 mean to 128 → detectRidges);
 *   5. painted as the panel paints it, side by side with the original, and scored on the three visible quarters:
 *      the correlation of the two fields, and how much of each is "line" (> 0.3, > 0.5).
 *
 * Run it before a build and after: the same photo through the same view, compared.
 *
 *   npx tsx scripts/scan/ridge-view-photo.ts [--label name]
 *
 * Writes captures/evidence/ridge-view/<stamp>-<label>/ (git-ignored: a palm).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { detectRidges } from "../../lib/scan/ridge";
import { downsample2 } from "./replay-chain";

const PHOTO = "fixtures/private/images/lab-ridge-view-phone-photo.png";
/** Where the 256² canvas sits in the screenshot: a 254 px box at (31, 37), measured on the image. */
const PANEL = { left: 31, top: 37, size: 254 };
const CANVAS = 256;
const WORK = 128;
/** debug-panel.tsx paintField's ridge ramp. */
const RAMP: readonly [number, number, number] = [53, 224, 200];
const label = process.argv.includes("--label") ? process.argv[process.argv.indexOf("--label") + 1]! : "ridge-view";

async function main(): Promise<void> {
  const stamp = new Date().toISOString().replaceAll(":", "-").slice(0, 19);
  const dir = path.resolve("captures", "evidence", "ridge-view", `${stamp}-${label}`);
  mkdirSync(dir, { recursive: true });

  const canvas = await sharp(PHOTO).extract({ left: PANEL.left, top: PANEL.top, width: PANEL.size, height: PANEL.size }).resize(CANVAS, CANVAS, { kernel: "linear" }).removeAlpha().raw().toBuffer();
  const at = (x: number, y: number, c: number): number => canvas[(y * CANVAS + x) * 3 + c]!;

  // 2. The original ridge field, from the inset (the canvas's top-left 128², painted 1:1).
  const original = new Float32Array(WORK * WORK);
  for (let y = 0; y < WORK; y += 1) for (let x = 0; x < WORK; x += 1) original[y * WORK + x] = Math.min(1, at(x, y, 1) / RAMP[1]);

  /*
   * 3. The crop, its hidden quarter filled smoothly from its visible edges (a harmonic fill: Jacobi iterations of
   * Laplace's equation, the right and bottom edges held at the visible pixels beside them). A smooth fill has no
   * edges of its own, so it adds no ridges; a mirror fill did (a seam along y = 64 and a cusp on the axis).
   */
  const rgb = Buffer.from(canvas);
  // Two rows and columns past the inset too: scaling 254 px back to 256 blends the inset's dark edge into them.
  const HIDDEN = WORK + 2;
  for (let c = 0; c < 3; c += 1) {
    let field = new Float32Array(HIDDEN * HIDDEN).fill(at(HIDDEN, HIDDEN, c));
    let next = new Float32Array(HIDDEN * HIDDEN);
    const sample = (x: number, y: number): number => (x >= HIDDEN || y >= HIDDEN ? at(x, y, c) : field[Math.max(0, y) * HIDDEN + Math.max(0, x)]!);
    for (let iteration = 0; iteration < 1500; iteration += 1) {
      for (let y = 0; y < HIDDEN; y += 1) {
        for (let x = 0; x < HIDDEN; x += 1) next[y * HIDDEN + x] = 0.25 * (sample(x - 1, y) + sample(x + 1, y) + sample(x, y - 1) + sample(x, y + 1));
      }
      [field, next] = [next, field];
    }
    for (let y = 0; y < HIDDEN; y += 1) for (let x = 0; x < HIDDEN; x += 1) rgb[(y * CANVAS + x) * 3 + c] = Math.round(field[y * HIDDEN + x]!);
  }

  // 4. The worker's ridge: 0–1 luma at 256, the 2×2 mean to 128, detectRidges at 128.
  const luma = new Float32Array(CANVAS * CANVAS);
  for (let i = 0; i < luma.length; i += 1) luma[i] = (0.2126 * rgb[i * 3]! + 0.7152 * rgb[i * 3 + 1]! + 0.0722 * rgb[i * 3 + 2]!) / 255;
  const gray = new Float32Array(WORK * WORK);
  downsample2(luma, CANVAS, gray);
  const rerendered = detectRidges(gray, WORK).probability;

  // 5. Painted as the panel paints it; the lab view rebuilt; scores on the three visible quarters.
  const paint = (field: Float32Array): Buffer => {
    const out = Buffer.alloc(WORK * WORK * 3);
    for (let i = 0; i < field.length; i += 1) {
      const v = Math.max(0, Math.min(1, field[i]!));
      out[i * 3] = Math.round(RAMP[0] * v);
      out[i * 3 + 1] = Math.round(RAMP[1] * v);
      out[i * 3 + 2] = Math.round(RAMP[2] * v);
    }
    return out;
  };
  const labView = Buffer.from(rgb);
  const painted = paint(rerendered);
  for (let y = 0; y < WORK; y += 1) for (let x = 0; x < WORK; x += 1) for (let c = 0; c < 3; c += 1) labView[(y * CANVAS + x) * 3 + c] = painted[(y * WORK + x) * 3 + c]!;
  const png = (buffer: Buffer, side: number, scale: number): Promise<Buffer> =>
    sharp(buffer, { raw: { width: side, height: side, channels: 3 } }).resize(side * scale, side * scale, { kernel: "nearest" }).png().toBuffer();
  const originalPanel = await sharp(PHOTO).extract({ left: PANEL.left, top: PANEL.top, width: PANEL.size, height: PANEL.size }).resize(CANVAS * 2, CANVAS * 2, { kernel: "nearest" }).png().toBuffer();
  await sharp({ create: { width: CANVAS * 4 + 16, height: CANVAS * 2 + 16, channels: 3, background: "#000" } })
    .composite([
      { input: originalPanel, left: 0, top: 0 },
      { input: await png(labView, CANVAS, 2), left: CANVAS * 2 + 16, top: 0 },
    ])
    .png()
    .toFile(path.join(dir, "lab-view-original-vs-rerendered.png"));
  await sharp({ create: { width: WORK * 8 + 16, height: WORK * 4, channels: 3, background: "#000" } })
    .composite([
      { input: await png(paint(original), WORK, 4), left: 0, top: 0 },
      { input: await png(painted, WORK, 4), left: WORK * 4 + 16, top: 0 },
    ])
    .png()
    .toFile(path.join(dir, "ridge-original-vs-rerendered.png"));

  const quarters = { "top-right": [64, 0], "bottom-left": [0, 64], "bottom-right": [64, 64] } as const;
  const score = (a: Float32Array, b: Float32Array, x0: number, y0: number): { correlation: number; lineOriginal: number; lineRerendered: number; strongOriginal: number; strongRerendered: number } => {
    const xs: number[] = [];
    const ys: number[] = [];
    for (let y = y0; y < y0 + 64; y += 1) for (let x = x0; x < x0 + 64; x += 1) {
      xs.push(a[y * WORK + x]!);
      ys.push(b[y * WORK + x]!);
    }
    const mean = (v: number[]): number => v.reduce((s, t) => s + t, 0) / v.length;
    const ma = mean(xs);
    const mb = mean(ys);
    let num = 0;
    let da = 0;
    let db = 0;
    for (let i = 0; i < xs.length; i += 1) {
      num += (xs[i]! - ma) * (ys[i]! - mb);
      da += (xs[i]! - ma) ** 2;
      db += (ys[i]! - mb) ** 2;
    }
    const frac = (v: number[], t: number): number => v.filter((x) => x > t).length / v.length;
    return {
      correlation: Number((num / Math.sqrt(da * db || 1)).toFixed(3)),
      lineOriginal: Number(frac(xs, 0.3).toFixed(3)),
      lineRerendered: Number(frac(ys, 0.3).toFixed(3)),
      strongOriginal: Number(frac(xs, 0.5).toFixed(3)),
      strongRerendered: Number(frac(ys, 0.5).toFixed(3)),
    };
  };
  const scores = Object.fromEntries(Object.entries(quarters).map(([name, [x0, y0]]) => [name, score(original, rerendered, x0, y0)]));
  writeFileSync(path.join(dir, "ridge-view.json"), JSON.stringify({ photo: PHOTO, panel: PANEL, note: "top-left quarter of the crop is hidden by the inset: harmonic-filled from its edges, left out of the scores", scores }, null, 2));
  writeFileSync(path.join(dir, "ridge-rerendered.f32"), Buffer.from(rerendered.buffer));
  console.log(`ridge view of ${PHOTO}, re-rendered with the current code -> ${dir}`);
  for (const [name, s] of Object.entries(scores)) {
    console.log(`  ${name.padEnd(13)} correlation ${s.correlation}  line > 0.3: original ${s.lineOriginal} re-rendered ${s.lineRerendered}  > 0.5: ${s.strongOriginal} / ${s.strongRerendered}`);
  }
}

void main();
