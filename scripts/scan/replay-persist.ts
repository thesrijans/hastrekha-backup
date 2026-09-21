/**
 * S1.5 — rekha persistence, measured: before (the shipped EMA path) vs after
 * (rekhaPersist: accumulator → evidence field → extraction → line hold), on the
 * same frames.
 *
 * SCENARIOS, each a sequence at the live cadence (one worker frame per
 * RECTIFY_INTERVAL_MS = 200 ms, an extraction every EXTRACT_INTERVAL_MS =
 * 700 ms), through the worker's own chain (replay-chain.ts):
 *
 *   session-15     the golden session's 15 stills in order, one frame each —
 *                  "the stills replayed as a sequence", literally.
 *   session-20s    20 s (100 frames) walking the same 15 stills, ~1.3 s each,
 *                  every frame's anchors jittered (σ = ANCHOR_JITTER_PX, the
 *                  residual landmark jitter the accumulator's alignment is
 *                  for) and ~10% of frames motion-blurred (which the frame
 *                  weight must skip). A replay standing in for a live scan —
 *                  NOT a live scan, which needs a hand at a camera.
 *   legacy-*-20s   each fate-absent legacy frame (ground truth has no fate) as
 *                  the same 20 s jittered sequence — the false-fate check.
 *
 * MEASURED per scenario and per line, before and after:
 *   flicker     CONFIRMED → lost → CONFIRMED transitions (before: a line
 *               "confirmed" is a line the published extraction draws; empty
 *               extractions are not published, as in the live hook)
 *   first       time to the first CONFIRMED
 *   false fate  any CONFIRMED fate on a fate-absent case
 *   cost        the accumulator's added work per frame (after only)
 *
 * The after path is run at several null levels (--nulls=a,b,c) over the same
 * cached frames, so the calibration can be chosen against these bars rather
 * than by eye.
 *
 *   npx tsx scripts/scan/replay-persist.ts [--nulls=0.17,0.27,0.43] [--seed=N] [--monitor-state]
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { alignFusion, emptyFusion, fuse, type FusionState } from "../../lib/scan/fusion";
import { extractLines, type LineExtraction } from "../../lib/scan/lines";
import { REKHA_PERSIST_EVIDENCE, RekhaPersistence, rekhaFrameWeight, type RekhaSnapshot } from "../../lib/scan/rekha-persist";
import { ACTIVE_LINE_IDS, type ActiveLineId, type Point2 } from "../../lib/scan/types";
import { blurImage, gaussian, loadImage, loadUnet, ReplayChain, rng, WORK } from "./replay-chain";

const FRAME_MS = 200;
const EXTRACT_MS = 700;
const ANCHOR_JITTER_PX = 1.5;
const BLUR_FRACTION = 0.1;
const SESSION_DIR = "fixtures/golden/session-2026-09-02T16-16-28-716Z";
/** --seed=N reruns the same scenarios with different jitter and blur draws (default 1). */
const SEED = Number(process.argv.find((a) => a.startsWith("--seed="))?.slice(7) ?? 1);

interface Frame {
  readonly plane: Float32Array;
  readonly gray: Float32Array;
  readonly weight: number;
  readonly vol: number;
  readonly toCrop: import("../../lib/scan/rectify").Matrix3;
  readonly convention: number;
}

interface Scenario {
  readonly name: string;
  readonly fateAbsent: boolean;
  readonly frames: Frame[];
}

interface Still {
  readonly image: string;
  readonly anchors: Point2[];
  readonly box: (source: ImageData) => { x: number; y: number }[];
}

function sessionStills(): Still[] {
  const meta = JSON.parse(readFileSync(`${SESSION_DIR}/metadata.json`, "utf8")) as {
    stills: { rawFile: string; anchors: number[][]; landmarks: { x: number; y: number }[] }[];
  };
  return meta.stills.map((s) => ({
    image: `${SESSION_DIR}/raw/${s.rawFile}`,
    anchors: s.anchors.map(([x = 0, y = 0]) => ({ x, y })),
    box: () => s.landmarks.map((l) => ({ x: l.x, y: l.y })),
  }));
}

function legacyStill(name: string): Still {
  const gt = JSON.parse(readFileSync(`test/fixtures/ground-truth/${name}.json`, "utf8")) as { frame: string; anchors: number[][] };
  return {
    image: gt.frame,
    anchors: gt.anchors.map(([x = 0, y = 0]) => ({ x, y })),
    box: (source) => gt.anchors.map(([x = 0, y = 0]) => ({ x: x / source.width, y: y / source.height })),
  };
}

async function buildScenario(
  name: string,
  stills: Still[],
  frameCount: number,
  perturb: boolean,
  fateAbsent: boolean,
  unet: Awaited<ReturnType<typeof loadUnet>>,
): Promise<Scenario> {
  const next = rng(SEED * 0x9e3779b1 + name.length * 7919);
  const chain = new ReplayChain(unet);
  const sources = new Map<string, ImageData>();
  const blurred = new Map<string, ImageData>();
  const frames: Frame[] = [];
  for (let f = 0; f < frameCount; f += 1) {
    const still = stills[Math.min(stills.length - 1, Math.floor((f * stills.length) / frameCount))]!;
    let source = sources.get(still.image);
    if (source === undefined) {
      source = await loadImage(still.image);
      sources.set(still.image, source);
    }
    const blur = perturb && next() < BLUR_FRACTION;
    if (blur) {
      let b = blurred.get(still.image);
      if (b === undefined) {
        b = blurImage(source, 4);
        blurred.set(still.image, b);
      }
      source = b;
    }
    const anchors = perturb
      ? still.anchors.map((a) => ({ x: a.x + gaussian(next) * ANCHOR_JITTER_PX, y: a.y + gaussian(next) * ANCHOR_JITTER_PX }))
      : still.anchors;
    const out = await chain.frame(source, anchors);
    if (out === null) continue;
    const { vol, weight } = rekhaFrameWeight(source, still.box(source));
    frames.push({ plane: out.plane, gray: out.gray, weight, vol, toCrop: out.toCrop, convention: out.convention });
  }
  return { name, fateAbsent, frames };
}

interface LineTally {
  flicker: number;
  first: number | null;
  everConfirmed: boolean;
}

const tally = (): Record<ActiveLineId, LineTally> =>
  Object.fromEntries(ACTIVE_LINE_IDS.map((id) => [id, { flicker: 0, first: null, everConfirmed: false }])) as Record<ActiveLineId, LineTally>;

/** The shipped path: EMA fusion, extraction every EXTRACT_MS, the published extraction drawn. */
function runBefore(s: Scenario): Record<ActiveLineId, LineTally> {
  const out = tally();
  let fusion: FusionState = emptyFusion(WORK);
  let published: LineExtraction | null = null;
  let lastExtract = -Infinity;
  const lost = Object.fromEntries(ACTIVE_LINE_IDS.map((id) => [id, false])) as Record<ActiveLineId, boolean>;
  s.frames.forEach((fr, i) => {
    const now = i * FRAME_MS;
    fusion = alignFusion(fusion, fr.toCrop, fr.convention).state;
    fusion = fuse(fusion, { width: WORK, height: WORK, all: fr.plane, resolves: [], inferenceMs: 0, backend: "replay" }, 1000 + now);
    if (now - lastExtract < EXTRACT_MS) return;
    lastExtract = now;
    const found = extractLines(fusion.ema, WORK);
    if (found.polys.length > 0 || found.fragments.length > 0) published = found;
    for (const id of ACTIVE_LINE_IDS) {
      const shown = published?.lines[id] !== undefined;
      const t = out[id];
      if (shown) {
        if (lost[id]) t.flicker += 1;
        lost[id] = false;
        if (t.first === null) t.first = now;
        t.everConfirmed = true;
      } else if (t.everConfirmed) lost[id] = true;
    }
  });
  return out;
}

interface AfterResult {
  readonly lines: Record<ActiveLineId, LineTally>;
  readonly costs: number[];
  readonly monitorState: RekhaSnapshot | null;
  readonly skipped: number;
}

/** rekhaPersist: accumulator every frame, extraction from its field every EXTRACT_MS, the hold's states. */
function runAfter(s: Scenario, nullLevel: number): AfterResult {
  const rekha = new RekhaPersistence(WORK, { ...REKHA_PERSIST_EVIDENCE, nullLevel });
  const costs: number[] = [];
  let lastExtract = -Infinity;
  let snapshot: RekhaSnapshot | null = null;
  let monitorState: RekhaSnapshot | null = null;
  let skipped = 0;
  let convention: number | null = null;
  s.frames.forEach((fr, i) => {
    const now = i * FRAME_MS;
    if (convention !== null && convention !== fr.convention) rekha.reset();
    convention = fr.convention;
    if (fr.weight < 0.05) skipped += 1;
    snapshot = rekha.observe(fr.plane, fr.gray, fr.weight, now);
    costs.push(rekha.lastCostMs);
    if (now - lastExtract >= EXTRACT_MS) {
      lastExtract = now;
      // Extraction itself is paid by both paths at the same cadence, so only the hold's
      // measurement of the new extraction is added cost.
      const found = extractLines(rekha.field, WORK);
      const t0 = performance.now();
      snapshot = rekha.extracted(found, now);
      costs[costs.length - 1] = (costs[costs.length - 1] ?? 0) + (performance.now() - t0);
    }
    const states = ACTIVE_LINE_IDS.map((id) => snapshot?.lines[id]?.state);
    if (monitorState === null && states.filter((v) => v === "confirmed").length === 2 && states.includes("tracking")) monitorState = snapshot;
  });
  const lines = tally();
  const final = snapshot as RekhaSnapshot | null;
  for (const id of ACTIVE_LINE_IDS) {
    lines[id].flicker = final?.flicker[id] ?? 0;
    lines[id].first = final?.firstConfirmedMs[id] ?? null;
    lines[id].everConfirmed = lines[id].first !== null;
  }
  return { lines, costs, monitorState, skipped };
}

const fmtFirst = (v: number | null): string => (v === null ? "—" : `${(v / 1000).toFixed(1)}s`);
const pctl = (xs: number[], p: number): number => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(s.length * p))] ?? NaN;
};

async function main(): Promise<void> {
  const nullsArg = process.argv.find((a) => a.startsWith("--nulls="));
  const nulls = nullsArg ? nullsArg.slice(8).split(",").map(Number) : [0.17, 0.27, 0.43];
  const unet = await loadUnet();
  console.log(`seed ${SEED}`);
  console.log(`UNet: ${unet === null ? "unavailable — classical only" : "palm-lines.onnx via onnxruntime-web (every 6th frame, as the worker)"}`);

  const stills = sessionStills();
  const scenarios: Scenario[] = [
    await buildScenario("session-15", stills, stills.length, false, false, unet),
    await buildScenario("session-20s", stills, 100, true, false, unet),
    await buildScenario("legacy-current-02-20s", [legacyStill("lines-current-02")], 100, true, true, unet),
    await buildScenario("legacy-tilt-03-20s", [legacyStill("lines-missing-tilt-03")], 100, true, true, unet),
  ];

  // Warm the JIT on the first scenario before anything is timed: the first pass through the
  // accumulator compiles it, and a cold compile is not a cost the live path pays per frame.
  for (const nl of nulls) runAfter(scenarios[0]!, nl);

  const report: Record<string, unknown> = { nulls, seed: SEED, scenarios: {} };
  for (const s of scenarios) {
    const skippedFrames = s.frames.filter((f) => f.weight < 0.05).length;
    const vols = s.frames.map((f) => f.vol);
    console.log(`\n=== ${s.name}: ${s.frames.length} frames (${(s.frames.length * FRAME_MS / 1000).toFixed(1)} s), ${skippedFrames} unusable (weight < 0.05), palm-box VoL p50 ${pctl(vols, 0.5).toFixed(0)}${s.fateAbsent ? ", fate absent in ground truth" : ""}`);
    const before = runBefore(s);
    const rows: string[] = [];
    rows.push(`  ${"".padEnd(14)} ${ACTIVE_LINE_IDS.map((id) => id.padEnd(22)).join("")}`);
    rows.push(`  ${"before".padEnd(14)} ${ACTIVE_LINE_IDS.map((id) => `flicker ${before[id].flicker}, first ${fmtFirst(before[id].first)}`.padEnd(22)).join("")}`);
    const entry: Record<string, unknown> = { frames: s.frames.length, unusable: skippedFrames, before };
    for (const nl of nulls) {
      const after = runAfter(s, nl);
      const cost = { mean: after.costs.reduce((a, b) => a + b, 0) / Math.max(1, after.costs.length), p95: pctl(after.costs, 0.95), max: Math.max(...after.costs) };
      rows.push(
        `  ${`after @${nl}`.padEnd(14)} ${ACTIVE_LINE_IDS.map((id) => `flicker ${after.lines[id].flicker}, first ${fmtFirst(after.lines[id].first)}`.padEnd(22)).join("")} cost mean ${cost.mean.toFixed(2)} p95 ${cost.p95.toFixed(2)} max ${cost.max.toFixed(2)} ms`,
      );
      if (s.fateAbsent) rows.push(`  ${"".padEnd(14)} false CONFIRMED fate: before ${before.fate.everConfirmed ? "YES" : "no"}, after ${after.lines.fate.everConfirmed ? "YES" : "no"}`);
      entry[`after@${nl}`] = { lines: after.lines, cost };
      if (process.argv.includes("--monitor-state") && after.monitorState !== null && s.name === "session-20s") {
        const dir = path.resolve("captures/ui/scores");
        mkdirSync(dir, { recursive: true });
        writeFileSync(path.join(dir, `rekha-monitor-state@${nl}.json`), JSON.stringify(after.monitorState));
        rows.push(`  ${"".padEnd(14)} monitor state (2 confirmed + 1 tracking) written: captures/ui/scores/rekha-monitor-state@${nl}.json`);
      }
    }
    for (const r of rows) console.log(r);
    (report.scenarios as Record<string, unknown>)[s.name] = entry;
  }
  const dir = path.resolve("captures/ui/scores");
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `rekha-persist-${new Date().toISOString().replaceAll(":", "-").slice(0, 19)}.json`);
  writeFileSync(file, JSON.stringify(report, null, 2));
  console.log(`\n${file}`);
}

void main();
