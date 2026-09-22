/**
 * S2 — trace, don't fit: the diagnostic behind every iteration.
 *
 * For the two legacy ground-truth cases (through the eval harness's own chain,
 * palmquad UNet framing, shipped threshold) and the golden session's 15 stills
 * (through the worker-equivalent chain, 12 frames each so the stack is warm and
 * UNet has run), render the rectified crop at 512 with every stage layered:
 *
 *   green   hand-traced ground truth (legacy only)
 *   blue    extractLines' fitted curve (what the app draws today)
 *   red     the observed fragments the tracer was seeded with
 *   gold    the traced path — solid where seeded by observation, 0.6 where
 *           it is pure valley extension; a tick where each end stopped
 *
 * and print, per line: median px at 512 to ground truth for fitted vs traced
 * (legacy), and the traced life line's start/end against the crop (all).
 *
 *   npx tsx scripts/scan/trace-diagnose.ts [--only=legacy|session] [--label=name]
 */
import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { alignFusion, emptyFusion, fuse, type FusionState } from "../../lib/scan/fusion";
import { extractLines, type LineExtraction } from "../../lib/scan/lines";
import { rectifyPalm } from "../../lib/scan/rectify";
import { ValleyTracer, valleyDepth, type TracedPath } from "../../lib/scan/trace-valley";
import { MASK_SIZE, RECTIFIED_SIZE, type ActiveLineId, type Point2 } from "../../lib/scan/types";
import { lineMetrics } from "../../test/eval/metrics";
import { loadGroundTruthDetailed, type EvalCase } from "../../test/eval/gt-adapter";
import { computeField, extractAtThreshold, lumaOf, traceAtThreshold } from "../../test/eval/run-pipeline";
import { loadImage, loadUnet, MODEL_PATH, ReplayChain, WORK } from "./replay-chain";

const SESSION_DIR = "fixtures/golden/session-2026-09-02T16-16-28-716Z";
const OUT = 512;
const LINES: readonly ActiveLineId[] = ["heart", "head", "life", "fate"];
const only = process.argv.find((a) => a.startsWith("--only="))?.slice(7);
const label = process.argv.find((a) => a.startsWith("--label="))?.slice(8) ?? "s2-trace";
const stamp = new Date().toISOString().replaceAll(":", "-").slice(0, 19);
const dir = path.resolve("captures/ui", `${stamp}-${label}`);
mkdirSync(dir, { recursive: true });

const makeImageData = (w: number, h: number): ImageData =>
  ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4), colorSpace: "srgb" }) as ImageData;

type Pts = readonly (readonly number[])[];

/** Fractions → 512 px polyline attribute. */
const polyAttr = (pts: Pts): string => pts.map(([x = 0, y = 0]) => `${(x * OUT).toFixed(1)},${(y * OUT).toFixed(1)}`).join(" ");

function tracedSvg(p: TracedPath, size: number): string {
  // Runs of one kind as separate polylines; extension at 0.6.
  const out: string[] = [];
  let run: number[] = [];
  let kind = p.kinds[0];
  const flush = (): void => {
    if (run.length < 2) return;
    const pts = run.map((q) => `${(((q % size) + 0.5) / size) * OUT},${((((q / size) | 0) + 0.5) / size) * OUT}`).join(" ");
    out.push(`<polyline points="${pts}" fill="none" stroke="#f2c14e" stroke-width="2.4" stroke-opacity="${kind === "extension" ? 0.6 : 1}" stroke-linecap="round"/>`);
  };
  p.pixels.forEach((q, i) => {
    if (p.kinds[i] !== kind) {
      flush();
      run = run.length > 0 ? [run[run.length - 1]!] : [];
      kind = p.kinds[i];
    }
    run.push(q);
  });
  flush();
  // Stop ticks: an open circle at each end, labelled with why.
  for (const [end, stop] of [
    [p.pixels[0]!, p.stops[0]],
    [p.pixels[p.pixels.length - 1]!, p.stops[1]],
  ] as const) {
    const x = (((end % size) + 0.5) / size) * OUT;
    const y = ((((end / size) | 0) + 0.5) / size) * OUT;
    out.push(`<circle cx="${x}" cy="${y}" r="4" fill="none" stroke="#f2c14e" stroke-width="1.5"/>`);
    out.push(`<text x="${x + 6}" y="${y - 6}" font-size="11" fill="#f2c14e" font-family="sans-serif">${p.id} ${stop}</text>`);
  }
  for (const seed of p.seeds) {
    out.push(`<polyline points="${seed.map((s) => `${((s.x + 0.5) / size) * OUT},${((s.y + 0.5) / size) * OUT}`).join(" ")}" fill="none" stroke="#e5484d" stroke-width="1.2" stroke-opacity="0.9"/>`);
  }
  return out.join("");
}

/** Left: the crop's luma; right: the valley depth the tracer walks (display-stretched to its p99). */
async function render(file: string, luma: Float32Array, layers: string): Promise<void> {
  const size = Math.round(Math.sqrt(luma.length));
  const gray = Buffer.alloc(size * size);
  for (let i = 0; i < gray.length; i += 1) gray[i] = Math.round(Math.min(1, Math.max(0, luma[i]!)) * 255);
  const depth = valleyDepth(luma, size);
  const sorted = Float32Array.from(depth).sort();
  const p99 = sorted[Math.floor(sorted.length * 0.99)]! || 1;
  const dmap = Buffer.alloc(size * size);
  for (let i = 0; i < dmap.length; i += 1) dmap[i] = Math.round(Math.min(1, depth[i]! / p99) * 255);
  const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${OUT}" height="${OUT}">${layers}</svg>`);
  const left = await sharp(await sharp(gray, { raw: { width: size, height: size, channels: 1 } }).resize(OUT, OUT, { kernel: "nearest" }).png().toBuffer())
    .composite([{ input: svg }])
    .png()
    .toBuffer();
  const right = await sharp(await sharp(dmap, { raw: { width: size, height: size, channels: 1 } }).resize(OUT, OUT, { kernel: "nearest" }).png().toBuffer())
    .composite([{ input: svg }])
    .png()
    .toBuffer();
  await sharp({ create: { width: OUT * 2, height: OUT, channels: 3, background: "#000" } })
    .composite([
      { input: left, left: 0, top: 0 },
      { input: right, left: OUT, top: 0 },
    ])
    .png()
    .toFile(file);
}

const lifeEnds = (p: TracedPath | undefined, size: number): string => {
  if (p === undefined) return "no life line";
  const a = p.pixels[0]!;
  const b = p.pixels[p.pixels.length - 1]!;
  const f = (q: number): string => `(${((q % size) / size).toFixed(3)}, ${(((q / size) | 0) / size).toFixed(3)})`;
  const xs = p.pixels.map((q) => (q % size) / size);
  const ys = p.pixels.map((q) => ((q / size) | 0) / size);
  // Bulge: how far the path swings toward the thumb side (min x) between its ends, vs the chord.
  const minX = Math.min(...xs);
  return `start ${f(a)} → end ${f(b)} · x-range ${minX.toFixed(3)}–${Math.max(...xs).toFixed(3)} · y-range ${Math.min(...ys).toFixed(3)}–${Math.max(...ys).toFixed(3)} · ends ${p.stops.join("/")}`;
};

async function legacy(): Promise<void> {
  const load = loadGroundTruthDetailed("fixtures", path.resolve("."));
  const cases = load.cases.filter((c: EvalCase) => c.source === "legacy" && c.skip === undefined);
  const modelPath = MODEL_PATH;
  console.log(`LEGACY (palmquad UNet, shipped threshold 0.45) — median px at ${OUT} to ground truth`);
  for (const evalCase of cases) {
    const rung = { framing: "palmquad" as const, post: "trace" as const };
    const cf = await computeField(evalCase, rung, { modelPath });
    const crop = await lumaOf(evalCase, "palmquad", { modelPath });
    if (cf.field === null || crop === null) {
      console.log(`  ${evalCase.id}: ${cf.error}`);
      continue;
    }
    const fitted = extractAtThreshold(cf.field, 0.45);
    const traced = traceAtThreshold(cf.field, 0.45, crop);
    const rows: string[] = [];
    let layers = "";
    for (const id of LINES) {
      const gt = evalCase.lines[id];
      if (gt === undefined) continue;
      const gtPts = gt.absent ? null : gt.points;
      if (gtPts !== null) layers += `<polyline points="${polyAttr(gtPts)}" fill="none" stroke="#3ecf8e" stroke-width="2" stroke-opacity="0.85"/>`;
      const f = fitted.lines[id];
      const t = traced.lines[id];
      if (f !== null) layers += `<polyline points="${polyAttr(f)}" fill="none" stroke="#4ea1ff" stroke-width="1.4" stroke-opacity="0.9"/>`;
      const mf = lineMetrics(f, gtPts, OUT, 6);
      const mt = lineMetrics(t, gtPts, OUT, 6);
      const fmt = (m: typeof mf, has: boolean): string => (has ? `${m.medianDistPx.toFixed(1)} px` : m.verdict);
      let stage = "";
      const path = traced.paths[id];
      if (path !== undefined && gtPts !== null) {
        const toFrac = (q: number): readonly number[] => [((q % RECTIFIED_SIZE) + 0.5) / RECTIFIED_SIZE, (((q / RECTIFIED_SIZE) | 0) + 0.5) / RECTIFIED_SIZE];
        const seedPts = path.seeds.flat().map((q) => [(q.x + 0.5) / RECTIFIED_SIZE, (q.y + 0.5) / RECTIFIED_SIZE]);
        const ext = path.pixels.filter((_, i) => path.kinds[i] === "extension").map(toFrac);
        const obs = path.pixels.filter((_, i) => path.kinds[i] !== "extension").map(toFrac);
        const med = (pts: Pts): string => (pts.length < 2 ? "—" : `${lineMetrics(pts, gtPts, OUT, 6).medianDistPx.toFixed(1)}`);
        // Valley along the ground truth vs along the trace: depth ratio to the band median.
        const depth = valleyDepth(crop.luma);
        const along = (pts: Pts): number => {
          const vals = pts.map(([x = 0, y = 0]) => depth[Math.min(255, Math.floor(y * 256)) * 256 + Math.min(255, Math.floor(x * 256))]!);
          vals.sort((a, b) => a - b);
          return (vals[vals.length >> 1] ?? 0) / Math.max(1e-6, path.bandMedian);
        };
        const dense = (pts: Pts): Pts => {
          const out: number[][] = [];
          for (let k = 0; k + 1 < pts.length; k += 1) {
            const [ax = 0, ay = 0] = pts[k]!;
            const [bx = 0, by = 0] = pts[k + 1]!;
            const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) * 256));
            for (let s2 = 0; s2 < n; s2 += 1) out.push([ax + ((bx - ax) * s2) / n, ay + ((by - ay) * s2) / n]);
          }
          return out;
        };
        stage = ` · stage px: seeds ${med(seedPts)}, seeded path ${med(obs)}, extension ${med(ext)} · valley ratio along GT ${along(dense(gtPts)).toFixed(2)} vs trace ${along(obs.concat(ext)).toFixed(2)} · stops ${path.stops.join("/")}`;
      }
      rows.push(`${id.padEnd(6)} fitted ${fmt(mf, f !== null).padEnd(14)} traced ${fmt(mt, t !== null).padEnd(10)}${stage}`);
    }
    for (const p of Object.values(traced.paths)) if (p !== undefined) layers += tracedSvg(p, RECTIFIED_SIZE);
    const file = path.join(dir, `legacy-${evalCase.id}.png`);
    await render(file, crop.luma, layers);
    console.log(`  ${evalCase.id}   trace ${traced.ms.toFixed(1)} ms`);
    for (const r of rows) console.log(`    ${r}`);
    console.log(`    life: ${lifeEnds(traced.paths.life, RECTIFIED_SIZE)}`);
    console.log(`    ${file}`);
  }
}

async function session(): Promise<void> {
  const meta = JSON.parse(readFileSync(`${SESSION_DIR}/metadata.json`, "utf8")) as { stills: { rawFile: string; anchors: number[][] }[] };
  const unet = await loadUnet();
  const tracer = new ValleyTracer();
  console.log(`\nSESSION STILLS (worker-equivalent chain, 12 frames each, UNet every 6th) — traced vs fitted`);
  const costs: number[] = [];
  for (const [i, still] of meta.stills.entries()) {
    const source = await loadImage(`${SESSION_DIR}/raw/${still.rawFile}`);
    const anchors: Point2[] = still.anchors.map(([x = 0, y = 0]) => ({ x, y }));
    const chain = new ReplayChain(unet);
    let fusion: FusionState = emptyFusion(WORK);
    let luma: Float32Array | null = null;
    let inside: Uint8Array | null = null;
    for (let f = 1; f <= 12; f += 1) {
      const fr = await chain.frame(source, anchors);
      if (fr === null) break;
      fusion = alignFusion(fusion, fr.toCrop, fr.convention).state;
      fusion = fuse(fusion, { width: WORK, height: WORK, all: fr.plane, resolves: [], inferenceMs: 0, backend: "replay" }, 1000 + f * 200);
      luma = fr.luma;
      inside = fr.inside;
    }
    if (luma === null) continue;
    const found: LineExtraction = extractLines(fusion.ema, MASK_SIZE);
    const traced = tracer.trace(found, luma, inside ?? undefined);
    costs.push(traced.ms);
    let layers = "";
    for (const id of LINES) {
      const fl = found.completion.lines[id];
      if (fl !== undefined) layers += `<polyline points="${fl.points.map((p) => `${((p.x + 0.5) / MASK_SIZE) * OUT},${((p.y + 0.5) / MASK_SIZE) * OUT}`).join(" ")}" fill="none" stroke="#4ea1ff" stroke-width="1.4" stroke-opacity="0.9"/>`;
    }
    for (const p of Object.values(traced.paths)) if (p !== undefined) layers += tracedSvg(p, RECTIFIED_SIZE);
    const file = path.join(dir, `still-${String(i).padStart(2, "0")}.png`);
    await render(file, luma, layers);
    const got = LINES.filter((id) => traced.lines[id] !== undefined).join(",") || "none";
    console.log(`  still ${String(i).padStart(2)}: traced [${got}] in ${traced.ms.toFixed(1)} ms · life ${lifeEnds(traced.paths.life, RECTIFIED_SIZE)}`);
  }
  const sorted = [...costs].sort((a, b) => a - b);
  console.log(`  trace cost over ${costs.length} stills: median ${sorted[sorted.length >> 1]?.toFixed(1)} ms, max ${sorted[sorted.length - 1]?.toFixed(1)} ms`);
  console.log(`  overlays: ${dir}`);
}

async function main(): Promise<void> {
  if (only !== "session") await legacy();
  if (only !== "legacy") await session();
}

void main();

export { makeImageData, rectifyPalm };
