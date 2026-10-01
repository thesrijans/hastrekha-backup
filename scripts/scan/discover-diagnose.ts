/**
 * S3 — tracer-led discovery: the diagnostic behind every iteration.
 *
 * For the legacy ground-truth cases (the eval harness's palmquad crop) and the golden session's 15 stills (each
 * rectified at native resolution through its own anchors), discover the four majors (lib/scan/discover.ts) and
 * render the crop at 512 — left the luma, right the valley depth the discovery walks — with:
 *
 *   white    hand-traced ground truth (legacy only)
 *   colour   the accepted, smoothed line (heart red · head gold · life green · fate blue): solid over the crease,
 *            faded where bridged across a gap
 *   dashed   a candidate the band's floor rejected
 *   grey     the raw minimal path under the smoothing
 *
 * and print, per line: the verdict and score, median px at 512 to ground truth (legacy), the ground truth's own
 * valley ratio (discover.ts valleyRatioAlong — the eval's measure; < 1.0 × the band median = "GT suspect", S3.7a), the jaggedness bars (max turn over 10 px, median
 * smooth→raw), and per still how much of the fate line runs along the life line (exclusivity). A summary JSON is
 * written next to the overlays.
 *
 *   npx tsx scripts/scan/discover-diagnose.ts [--only=legacy|session] [--label=name] [--bands]
 *
 * --bands also outlines each line's corridor band (its colour, dotted) — where discovery may look.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { DISCOVER_BAND_SCALE, DISCOVER_BLACKHAT_RADIUS, DISCOVER_FLOORS, DISCOVER_ORDER, Discoverer, valleyRatioAlong, type DiscoveredLine, type DiscoveryResult } from "../../lib/scan/discover";
import { CORRIDORS } from "../../lib/scan/completion";
import { buildCorridorMask } from "../../lib/scan/corridor-path";
import { rectifyPalm } from "../../lib/scan/rectify";
import { distanceToPolyline, resamplePolyline, TURN_BAR_DEG, type PathPoint } from "../../lib/scan/smooth-path";
import { valleyDepth } from "../../lib/scan/trace-valley";
import { MASK_SIZE, RECTIFIED_SIZE, type ActiveLineId, type Point2 } from "../../lib/scan/types";
import { loadGroundTruthDetailed, type EvalCase } from "../../test/eval/gt-adapter";
import { lineMetrics } from "../../test/eval/metrics";
import { lumaOf } from "../../test/eval/run-pipeline";
import { loadImage, MODEL_PATH } from "./replay-chain";

const SESSION_DIR = "fixtures/golden/session-2026-09-02T16-16-28-716Z";
const OUT = 512;
const SIZE = RECTIFIED_SIZE;
const COLOURS: Readonly<Record<ActiveLineId, string>> = { heart: "#ff6b6b", head: "#ffd166", life: "#06d6a0", fate: "#4ea1ff" };
const only = process.argv.find((a) => a.startsWith("--only="))?.slice(7);
const label = process.argv.find((a) => a.startsWith("--label="))?.slice(8) ?? "s3-discover";
const showBands = process.argv.includes("--bands");
/** --radius=6 overrides DISCOVER_BLACKHAT_RADIUS for an experiment. */
const radius = Number(process.argv.find((a) => a.startsWith("--radius="))?.slice(9) ?? DISCOVER_BLACKHAT_RADIUS);
/** --scale=life:1.3,fate:1.2 overrides DISCOVER_BAND_SCALE for an experiment. */
const bandScale = { ...DISCOVER_BAND_SCALE };
for (const pair of (process.argv.find((a) => a.startsWith("--scale="))?.slice(8) ?? "").split(",").filter(Boolean)) {
  const [id, value] = pair.split(":");
  if (id !== undefined && id in bandScale) bandScale[id as ActiveLineId] = Number(value);
}
const stamp = new Date().toISOString().replaceAll(":", "-").slice(0, 19);
const dir = path.resolve("captures/ui", `${stamp}-${label}`);
mkdirSync(dir, { recursive: true });

type Pts = readonly (readonly number[])[];

const makeImageData = (w: number, h: number): ImageData =>
  ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4), colorSpace: "srgb" }) as ImageData;

/** 256-grid pixel points → 0–1 fractions (pixel centres). */
const toFrac = (pts: readonly PathPoint[]): Pts => pts.map((p) => [(p.x + 0.5) / SIZE, (p.y + 0.5) / SIZE]);
/** 0–1 fractions → 512 px polyline attribute. */
const polyAttr = (pts: Pts): string => pts.map(([x = 0, y = 0]) => `${(x * OUT).toFixed(1)},${(y * OUT).toFixed(1)}`).join(" ");

/** The eval's own conversion of a drawn line (MASK_SIZE grid → x / WORK), so the numbers match the +discover rung. */
const asEval = (line: DiscoveredLine): Pts => line.smooth.map((p) => [((p.x + 0.5) * (MASK_SIZE / SIZE) - 0.5) / MASK_SIZE, ((p.y + 0.5) * (MASK_SIZE / SIZE) - 0.5) / MASK_SIZE]);

/** Each band's boundary pixels, dotted in its line's colour. */
function bandsSvg(): string {
  if (!showBands) return "";
  const out: string[] = [];
  for (const id of DISCOVER_ORDER) {
    const corridor = CORRIDORS[id];
    const mask = buildCorridorMask({ ...corridor, halfWidths: corridor.halfWidths.map((w) => w * bandScale[id]) }, SIZE).inside;
    for (let y = 0; y < SIZE; y += 1) {
      for (let x = 0; x < SIZE; x += 1) {
        if (!mask[y * SIZE + x] || (x + y) % 3 !== 0) continue;
        const edge = x === 0 || y === 0 || x === SIZE - 1 || y === SIZE - 1 || !mask[y * SIZE + x - 1] || !mask[y * SIZE + x + 1] || !mask[(y - 1) * SIZE + x] || !mask[(y + 1) * SIZE + x];
        if (edge) out.push(`<rect x="${(x / SIZE) * OUT}" y="${(y / SIZE) * OUT}" width="2" height="2" fill="${COLOURS[id]}" fill-opacity="0.8"/>`);
      }
    }
  }
  return out.join("");
}

function lineSvg(line: DiscoveredLine, accepted: boolean): string {
  const colour = COLOURS[line.id];
  const out: string[] = [];
  out.push(`<polyline points="${polyAttr(toFrac(line.raw))}" fill="none" stroke="#bbbbbb" stroke-width="1" stroke-opacity="0.55"/>`);
  if (!accepted) {
    out.push(`<polyline points="${polyAttr(toFrac(line.smooth))}" fill="none" stroke="${colour}" stroke-width="1.4" stroke-dasharray="5 4" stroke-opacity="0.9"/>`);
  } else {
    // Runs of observed / bridged as separate polylines, joined at their shared point.
    let from = 0;
    for (let i = 1; i <= line.smooth.length; i += 1) {
      if (i < line.smooth.length && line.observed[i] === line.observed[from]) continue;
      const run = line.smooth.slice(from, Math.min(line.smooth.length, i + 1));
      if (run.length >= 2) out.push(`<polyline points="${polyAttr(toFrac(run))}" fill="none" stroke="${colour}" stroke-width="2.6" stroke-opacity="${line.observed[from] ? 1 : 0.45}" stroke-linecap="round"/>`);
      from = i;
    }
  }
  const head = line.smooth[0]!;
  out.push(`<text x="${((head.x + 0.5) / SIZE) * OUT + 5}" y="${((head.y + 0.5) / SIZE) * OUT - 5}" font-size="12" fill="${colour}" font-family="sans-serif">${line.id} ${line.score.toFixed(0)}${accepted ? "" : " ✗"}</text>`);
  return out.join("");
}

async function render(file: string, luma: Float32Array, layers: string): Promise<void> {
  const size = Math.round(Math.sqrt(luma.length));
  const gray = Buffer.alloc(size * size);
  for (let i = 0; i < gray.length; i += 1) gray[i] = Math.round(Math.min(1, Math.max(0, luma[i]!)) * 255);
  const depth = valleyDepth(luma, size, radius);
  const sorted = Float32Array.from(depth).sort();
  const p99 = sorted[Math.floor(sorted.length * 0.99)]! || 1;
  const dmap = Buffer.alloc(size * size);
  for (let i = 0; i < dmap.length; i += 1) dmap[i] = Math.round(Math.min(1, depth[i]! / p99) * 255);
  const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${OUT}" height="${OUT}">${bandsSvg()}${layers}</svg>`);
  const panel = async (plane: Buffer): Promise<Buffer> =>
    sharp(await sharp(plane, { raw: { width: size, height: size, channels: 1 } }).resize(OUT, OUT, { kernel: "nearest" }).png().toBuffer())
      .composite([{ input: svg }])
      .png()
      .toBuffer();
  await sharp({ create: { width: OUT * 2, height: OUT, channels: 3, background: "#000" } })
    .composite([
      { input: await panel(gray), left: 0, top: 0 },
      { input: await panel(dmap), left: OUT, top: 0 },
    ])
    .png()
    .toFile(file);
}

/** Fraction of `a`'s arc (1 px steps) within `tol` px of `b` — the fate-along-life check. */
function alongFraction(a: readonly PathPoint[], b: readonly PathPoint[], tol: number): number {
  const dense = resamplePolyline(a, 1);
  if (dense.length === 0) return 0;
  return dense.filter((p) => distanceToPolyline(p, b) <= tol).length / dense.length;
}

interface LineRow {
  readonly id: ActiveLineId;
  readonly outcome: string;
  readonly score: number;
  readonly lengthPx: number;
  readonly meanValley: number;
  readonly strength: number;
  readonly shadow: number;
  readonly maxTurnDeg: number | null;
  readonly medianToRaw: number | null;
  readonly gt?: "present" | "absent" | "unlabelled";
  readonly gtValleyRatio?: number;
  readonly gtSuspect?: boolean;
  readonly medianPx?: number | null;
  readonly candidateMedianPx?: number | null;
}

function rowsOf(result: DiscoveryResult): LineRow[] {
  return DISCOVER_ORDER.map((id) => {
    const v = result.verdicts[id];
    const line = v.line;
    return {
      id,
      outcome: v.outcome,
      score: Number(v.score.toFixed(1)),
      lengthPx: line === null ? 0 : Number(line.lengthPx.toFixed(1)),
      meanValley: line === null ? 0 : Number(line.meanValley.toFixed(3)),
      strength: line === null ? 0 : Number(line.strength.toFixed(3)),
      shadow: line === null ? 0 : Number(line.shadow.toFixed(2)),
      maxTurnDeg: line === null ? null : Number(line.maxTurnDeg.toFixed(1)),
      medianToRaw: line === null ? null : Number(line.medianToRaw.toFixed(2)),
    };
  });
}

const fmt = (v: number | null | undefined, digits = 1): string => (v === null || v === undefined || Number.isNaN(v) ? "—" : v.toFixed(digits));

async function legacy(discoverer: Discoverer): Promise<unknown[]> {
  const load = loadGroundTruthDetailed("fixtures", path.resolve("."));
  const cases = load.cases.filter((c: EvalCase) => c.source === "legacy" && c.skip === undefined);
  console.log(`LEGACY (palmquad crop at ${SIZE}) — floors ${JSON.stringify(DISCOVER_FLOORS)}`);
  const out: unknown[] = [];
  for (const evalCase of cases) {
    const crop = await lumaOf(evalCase, "palmquad", { modelPath: MODEL_PATH });
    if (crop === null) {
      console.log(`  ${evalCase.id}: no crop`);
      continue;
    }
    const result = discoverer.discover(crop.luma, crop.inside);
    let layers = "";
    const rows = rowsOf(result).map((row): LineRow => {
      const gtLine = evalCase.lines[row.id];
      const gtPts = gtLine === undefined || gtLine.absent ? null : gtLine.points;
      if (gtPts !== null) layers = `<polyline points="${polyAttr(gtPts)}" fill="none" stroke="#ffffff" stroke-width="2" stroke-opacity="0.8"/>` + layers;
      const v = result.verdicts[row.id];
      const accepted = v.outcome === "accepted" && v.line !== null ? v.line : null;
      const ratio = gtPts === null ? undefined : valleyRatioAlong(crop.luma, row.id, gtPts);
      return {
        ...row,
        gt: gtLine === undefined ? "unlabelled" : gtLine.absent ? "absent" : "present",
        gtValleyRatio: ratio === undefined ? undefined : Number(ratio.toFixed(2)),
        gtSuspect: ratio === undefined ? undefined : ratio < 1,
        medianPx: gtPts === null || accepted === null ? null : Number(lineMetrics(asEval(accepted), gtPts, OUT, 6).medianDistPx.toFixed(1)),
        candidateMedianPx: gtPts === null || v.line === null ? null : Number(lineMetrics(asEval(v.line), gtPts, OUT, 6).medianDistPx.toFixed(1)),
      };
    });
    for (const id of DISCOVER_ORDER) {
      const v = result.verdicts[id];
      if (v.line !== null) layers += lineSvg(v.line, v.outcome === "accepted");
    }
    const file = path.join(dir, `legacy-${evalCase.id}.png`);
    await render(file, crop.luma, layers);
    console.log(`  ${evalCase.id}   discover ${result.ms.toFixed(1)} ms   ${file}`);
    for (const r of rows) {
      console.log(
        `    ${r.id.padEnd(6)} GT ${String(r.gt).padEnd(10)} ${r.gtValleyRatio === undefined ? "" : `valley ${r.gtValleyRatio.toFixed(2)}${r.gtSuspect ? " SUSPECT" : ""}`.padEnd(16)}` +
          ` ${r.outcome.padEnd(8)} score ${fmt(r.score).padStart(6)}  len ${fmt(r.lengthPx).padStart(5)}  str ${fmt(r.strength, 2)}  shadow ${fmt(r.shadow, 2)}` +
          `  median ${fmt(r.medianPx).padStart(5)} px (candidate ${fmt(r.candidateMedianPx)})  turn ${fmt(r.maxTurnDeg)}°  smooth→raw ${fmt(r.medianToRaw, 2)} px`,
      );
    }
    // S3.8 — a present line over the 8 px bar: which of no valley in band / floor rejects / band excludes / smoothing pulls off, in px.
    const depth8 = valleyDepth(crop.luma, SIZE, radius);
    const corridorBand = (id: ActiveLineId): Uint8Array => {
      const corridor = CORRIDORS[id];
      return buildCorridorMask({ ...corridor, halfWidths: corridor.halfWidths.map((w) => w * bandScale[id]) }, SIZE).inside;
    };
    for (const r of rows) {
      if (r.gt !== "present" || r.medianPx === null || r.medianPx === undefined || r.medianPx <= 8) continue;
      const gtPts = evalCase.lines[r.id]!.points;
      const v = result.verdicts[r.id];
      const band = corridorBand(r.id);
      const dense = resamplePolyline(gtPts.map(([x = 0, y = 0]) => ({ x: x * SIZE, y: y * SIZE })), 1);
      const inBand = dense.filter((p) => band[Math.min(SIZE - 1, Math.max(0, Math.round(p.y))) * SIZE + Math.min(SIZE - 1, Math.max(0, Math.round(p.x)))]).length / Math.max(1, dense.length);
      const med = (vals: number[]): number => [...vals].sort((a, b) => a - b)[vals.length >> 1] ?? 0;
      const bandMedian = med(Array.from(band.reduce<number[]>((acc, on, i) => (on ? (acc.push(depth8[i]!), acc) : acc), [])));
      const along = (pts: readonly PathPoint[]): number => med(resamplePolyline(pts, 1).map((p) => depth8[Math.min(SIZE - 1, Math.max(0, Math.round(p.y))) * SIZE + Math.min(SIZE - 1, Math.max(0, Math.round(p.x)))]!)) / Math.max(1e-6, bandMedian);
      const rawPx = v.line === null ? null : lineMetrics(toFrac(v.line.raw), gtPts, OUT, 6).medianDistPx;
      console.log(
        `    S3.8 ${r.id}: drawn ${fmt(r.medianPx)} px from GT · raw path ${fmt(rawPx)} px (smoothing moves it ${fmt(rawPx === null ? null : r.medianPx - rawPx)} px)` +
          ` · GT in band ${(inBand * 100).toFixed(0)}% · valley ratio (r${radius}) along GT ${along(dense).toFixed(2)} vs along the found path ${v.line === null ? "—" : along(v.line.raw).toFixed(2)}` +
          ` · score ${fmt(v.score)} vs floor ${DISCOVER_FLOORS[r.id]}`,
      );
    }
    out.push({ case: evalCase.id, ms: result.ms, overlay: file, lines: rows });
  }
  // The S3.7a bars over these cases.
  const all = out as { lines: LineRow[] }[];
  console.log(`  BARS (median ≤ 8 px on valley-backed GT · detection ≥ 90% · false-line 0):`);
  for (const id of DISCOVER_ORDER) {
    const rows = all.map((c) => c.lines.find((l) => l.id === id)!).filter((r) => r !== undefined);
    const present = rows.filter((r) => r.gt === "present");
    const detected = present.filter((r) => r.outcome === "accepted");
    const backed = detected.filter((r) => r.gtSuspect !== true && r.medianPx !== null && r.medianPx !== undefined);
    const suspect = detected.filter((r) => r.gtSuspect === true);
    const absent = rows.filter((r) => r.gt === "absent");
    const falseLines = absent.filter((r) => r.outcome === "accepted");
    const mean = (xs: number[]): number | null => (xs.length === 0 ? null : xs.reduce((a, b) => a + b, 0) / xs.length);
    console.log(
      `    ${id.padEnd(6)} detect ${detected.length}/${present.length}  median (valley-backed) ${backed.map((r) => fmt(r.medianPx)).join(", ") || "—"} → mean ${fmt(mean(backed.map((r) => r.medianPx!)))} px` +
        `${suspect.length > 0 ? `  · GT suspect ${suspect.map((r) => fmt(r.medianPx)).join(", ")} px` : ""}  false-line ${falseLines.length}/${absent.length}`,
    );
  }
  return out;
}

async function session(discoverer: Discoverer): Promise<unknown[]> {
  const meta = JSON.parse(readFileSync(`${SESSION_DIR}/metadata.json`, "utf8")) as { stills: { rawFile: string; anchors: number[][] }[] };
  console.log(`\nSESSION STILLS (native ${meta.stills.length} raw stills, rectified at ${SIZE} through their own anchors)`);
  const costs: number[] = [];
  const turns: number[] = [];
  const toRaw: number[] = [];
  const out: unknown[] = [];
  for (const [i, still] of meta.stills.entries()) {
    const source = await loadImage(`${SESSION_DIR}/raw/${still.rawFile}`);
    const anchors: Point2[] = still.anchors.map(([x = 0, y = 0]) => ({ x, y }));
    const warped = rectifyPalm(source, anchors, SIZE, makeImageData);
    if (warped === null) continue;
    const luma = new Float32Array(SIZE * SIZE);
    for (let k = 0; k < luma.length; k += 1) {
      const at = k * 4;
      luma[k] = (0.2126 * warped.image.data[at]! + 0.7152 * warped.image.data[at + 1]! + 0.0722 * warped.image.data[at + 2]!) / 255;
    }
    const result = discoverer.discover(luma, Uint8Array.from(warped.inside));
    costs.push(result.ms);
    let layers = "";
    for (const id of DISCOVER_ORDER) {
      const v = result.verdicts[id];
      if (v.line !== null) layers += lineSvg(v.line, v.outcome === "accepted");
      if (v.outcome === "accepted" && v.line !== null) {
        turns.push(v.line.maxTurnDeg);
        toRaw.push(v.line.medianToRaw);
      }
    }
    const fate = result.verdicts.fate;
    const life = result.verdicts.life;
    const fateOnLife =
      fate.outcome === "accepted" && fate.line !== null && life.outcome === "accepted" && life.line !== null ? alongFraction(fate.line.smooth, life.line.smooth, 6) : null;
    const file = path.join(dir, `still-${String(i).padStart(2, "0")}.png`);
    await render(file, luma, layers);
    const rows = rowsOf(result);
    console.log(
      `  still ${String(i).padStart(2)}  ${result.ms.toFixed(1).padStart(5)} ms  ` +
        rows.map((r) => `${r.id} ${r.outcome === "accepted" ? "✓" : r.outcome === "floor" ? "✗" : r.outcome === "shadow" ? "≈" : "·"}${fmt(r.score, 0)}${r.maxTurnDeg === null ? "" : `/${fmt(r.maxTurnDeg, 0)}°`}${r.shadow > 0.2 ? `~${fmt(r.shadow * 100, 0)}%` : ""}`).join("  ") +
        (fateOnLife === null ? "" : `  fate-on-life ${(fateOnLife * 100).toFixed(0)}%`),
    );
    out.push({ still: i, ms: result.ms, overlay: file, fateOnLife, lines: rows });
  }
  const q = (xs: number[], p: number): number => [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(p * xs.length))] ?? NaN;
  console.log(`  cost over ${costs.length} stills (Node, 1× CPU): median ${fmt(q(costs, 0.5))} ms, max ${fmt(Math.max(...costs))} ms`);
  console.log(`  jaggedness over ${turns.length} accepted lines: max turn per 10 px median ${fmt(q(turns, 0.5))}°, worst ${fmt(Math.max(...turns))}° (bar ${TURN_BAR_DEG}°) · smooth→raw median ${fmt(q(toRaw, 0.5), 2)} px, worst ${fmt(Math.max(...toRaw), 2)} px (bar 1.5)`);
  console.log(`  overlays: ${dir}`);
  return out;
}

async function main(): Promise<void> {
  const t0 = performance.now();
  const discoverer = new Discoverer(SIZE, bandScale, radius, true);
  console.log(`Discoverer constructed in ${(performance.now() - t0).toFixed(0)} ms`);
  const summary: Record<string, unknown> = { floors: DISCOVER_FLOORS, bandScale };
  console.log(`band scale ${JSON.stringify(bandScale)} · black-hat radius ${radius}`);
  if (only !== "session") summary.legacy = await legacy(discoverer);
  if (only !== "legacy") summary.session = await session(discoverer);
  // The floor calibration's input: every candidate's score, per band, by source (✓ accepted · ✗ floor · ≈ shadow).
  console.log(`
SCORE DISTRIBUTIONS (candidates; legacy GT in brackets):`);
  for (const id of DISCOVER_ORDER) {
    const legacyRows = ((summary.legacy ?? []) as { case: string; lines: LineRow[] }[]).map((c) => ({ c: c.case, r: c.lines.find((l) => l.id === id)! }));
    const stillRows = ((summary.session ?? []) as { still: number; lines: LineRow[] }[]).map((c) => c.lines.find((l) => l.id === id)!);
    const scores = stillRows.filter((r) => r.outcome !== "no-path").map((r) => r.score).sort((a, b) => a - b);
    console.log(
      `  ${id.padEnd(6)} floor ${DISCOVER_FLOORS[id]} · legacy ${legacyRows.map(({ c, r }) => `${c.replace("lines-", "")}[${r.gt}] ${fmt(r.score, 0)}`).join(", ")} · stills ${scores.map((v) => v.toFixed(0)).join(" ")}`,
    );
  }
  writeFileSync(path.join(dir, "summary.json"), JSON.stringify(summary, null, 2));
}

void main();
