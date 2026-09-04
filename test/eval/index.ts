/**
 * Eval harness CLI (sprint Phase 0d) — composable operating points.
 *
 * ```
 * npm run eval                                              # baseline alias
 * npm run eval -- --rung=classical+fused,fullhand-fixed+enhancer --model=…
 * npm run eval -- --matrix --model=fixtures/private/models/palm-lines.fp32.onnx
 * npm run eval -- --diag                                    # field-stats dump (item 3)
 * npm run eval -- --jitter                                  # H12 anchor jitter (item 4)
 * ```
 *
 * Rungs compose as FRAMING+POST; the legacy aliases still work:
 *   baseline            → (model? palmquad : classical)+fused
 *   enhancer            → (model? palmquad : classical)+enhancer
 *   enhancer-ridge      → (model? palmquad : classical)+enhancer-ridge
 *   unet-fullhand-fixed → fullhand-fixed+fused · unet-fullhand-ransac → fullhand-ransac+fused
 * Every rung is swept over the extraction threshold (LINE_THRESHOLD's binarize seam), 0.15…0.85.
 */
import path from "node:path";
import { loadGroundTruthDetailed, type EvalCase } from "./gt-adapter";
import { EVAL_TOLS, EVAL_TOL_PX_AT_512, EVAL_SIZE, lineMetrics, type LineMetrics, type LineRow } from "./metrics";
import {
  FIELDS,
  FRAMINGS,
  POSTS,
  SWEEP_THRESHOLDS,
  computeField,
  contractFieldOf,
  contractPlaneOf,
  diagnoseFields,
  extractAtThreshold,
  minorEmissionOn,
  rawPlanesOf,
  rungId,
  vocabDiff,
  MINOR_EMISSION_CLASSES,
  type FieldKind,
  type MinorEmissionClass,
  type ComposedRung,
  type Framing,
  type Post,
  type RunOptions,
} from "./run-pipeline";
import { measureFwhm, type FwhmResult } from "./fwhm";
import { measureJitter } from "./jitter";
import { renderMarkdown, writeJson, type EvalReport, type RungSweep } from "./report";
import { LABEL_LINE_IDS, LABELABLE_LINE_IDS } from "../../lib/scan/dev/session-types";
import { contractStats } from "../../lib/scan/contract";
import { CORRIDORS } from "../../lib/scan/completion";
import { buildCorridorMask, searchCorridor } from "../../lib/scan/corridor-path";
import { writeFileSync, readFileSync } from "node:fs";

interface CliArgs {
  readonly rungSpecs: readonly string[];
  readonly matrix: boolean;
  readonly modelPath?: string;
  readonly headlineTol: number;
  readonly fwhm: boolean;
  readonly diag: boolean;
  readonly jitter: boolean;
  readonly root: string;
  /** Score pose-duplicate stills instead of skipping them (capture lane B guard). */
  readonly includeDuplicates: boolean;
  /** H9: two-pass calibration of CONTRACT_DEPTH_DEFAULTS from the GT raw-depth census. */
  readonly calibrateContract: boolean;
}

function parseArgs(argv: readonly string[]): CliArgs {
  const get = (name: string): string | undefined => {
    const hit = argv.find((arg) => arg.startsWith(`--${name}=`));
    return hit?.slice(name.length + 3);
  };
  const tolArg = get("tol");
  return {
    rungSpecs: (get("rung") ?? "baseline").split(","),
    matrix: argv.includes("--matrix"),
    modelPath: get("model"),
    headlineTol: tolArg === undefined ? EVAL_TOL_PX_AT_512 : Number(tolArg),
    fwhm: argv.includes("--fwhm"),
    diag: argv.includes("--diag"),
    jitter: argv.includes("--jitter"),
    root: get("root") ?? "fixtures",
    includeDuplicates: argv.includes("--include-duplicates"),
    calibrateContract: argv.includes("--calibrate-contract"),
  };
}

interface ResolvedRung extends ComposedRung {
  readonly aliasOf?: string;
}

function resolveRungs(args: CliArgs): ResolvedRung[] {
  const autoFraming: Framing = args.modelPath === undefined ? "classical" : "palmquad";
  if (args.matrix) {
    const framings: Framing[] = args.modelPath === undefined ? ["classical"] : [...FRAMINGS];
    const grid: ResolvedRung[] = [];
    for (const field of FIELDS) {
      for (const framing of framings) {
        for (const post of POSTS) {
          grid.push({
            framing,
            post,
            field,
            aliasOf: field === "legacy" && framing === autoFraming && post === "fused" ? "baseline" : undefined,
          });
        }
      }
    }
    return grid;
  }
  const aliases: Record<string, ResolvedRung> = {
    baseline: { framing: autoFraming, post: "fused", aliasOf: "baseline" },
    enhancer: { framing: autoFraming, post: "enhancer", aliasOf: "enhancer" },
    "enhancer-ridge": { framing: autoFraming, post: "enhancer-ridge", aliasOf: "enhancer-ridge" },
    "unet-fullhand-fixed": { framing: "fullhand-fixed", post: "fused", aliasOf: "unet-fullhand-fixed" },
    "unet-fullhand-ransac": { framing: "fullhand-ransac", post: "fused", aliasOf: "unet-fullhand-ransac" },
  };
  return args.rungSpecs.map((spec) => {
    const alias = aliases[spec];
    if (alias !== undefined) return alias;
    // "contract:framing+post" reads the H9 contract plane instead of the legacy field.
    const [fieldPart, rest] = spec.includes(":") ? spec.split(":", 2) : ["legacy", spec];
    const [framing, post] = rest.split("+");
    if (
      !(FIELDS as readonly string[]).includes(fieldPart) ||
      !(FRAMINGS as readonly string[]).includes(framing) ||
      !(POSTS as readonly string[]).includes(post)
    ) {
      throw new Error(
        `unknown rung "${spec}" — use an alias or [contract:]<framing>+<post> from ${FRAMINGS.join("|")} × ${POSTS.join("|")}`,
      );
    }
    return { framing: framing as Framing, post: post as Post, field: fieldPart as FieldKind };
  });
}

/* ---------------------- H9: GT pixel masks + raw sampling ---------------------- */

const W128 = 128;

/**
 * Centreline mask (±2px stamp along every labelled present line) and background mask (>6px from
 * every labelled line, 8px border excluded) at the 128 working grid — the same census the recon
 * measured with, now shared by the contract columns and the calibration.
 */
function gtMasks(evalCase: EvalCase): { centreline: Uint8Array; background: Uint8Array } | null {
  const centre = new Uint8Array(W128 * W128);
  const near = new Uint8Array(W128 * W128);
  let any = false;
  for (const id of LABELABLE_LINE_IDS) {
    const line = evalCase.lines[id];
    if (line === undefined || line.absent || line.points.length < 2) continue;
    any = true;
    const pts = line.points;
    for (let i = 1; i < pts.length; i += 1) {
      const ax = pts[i - 1][0] * W128;
      const ay = pts[i - 1][1] * W128;
      const bx = pts[i][0] * W128;
      const by = pts[i][1] * W128;
      const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay)));
      for (let s = 0; s <= steps; s += 1) {
        const x = Math.round(ax + ((bx - ax) * s) / steps);
        const y = Math.round(ay + ((by - ay) * s) / steps);
        for (let dy = -6; dy <= 6; dy += 1) {
          for (let dx = -6; dx <= 6; dx += 1) {
            const px = x + dx;
            const py = y + dy;
            if (px < 0 || px >= W128 || py < 0 || py >= W128) continue;
            const d2 = dx * dx + dy * dy;
            if (d2 <= 36) near[py * W128 + px] = 1;
            if (d2 <= 4) centre[py * W128 + px] = 1;
          }
        }
      }
    }
  }
  if (!any) return null;
  const background = new Uint8Array(W128 * W128);
  for (let y = 8; y < W128 - 8; y += 1) {
    for (let x = 8; x < W128 - 8; x += 1) {
      if (near[y * W128 + x] === 0) background[y * W128 + x] = 1;
    }
  }
  return { centreline: centre, background };
}

const quantile = (values: number[], q: number): number => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
};

/** Values of `plane` under a mask. */
function maskedValues(plane: Float32Array, mask: Uint8Array): number[] {
  const out: number[] = [];
  for (let i = 0; i < mask.length; i += 1) if (mask[i] === 1) out.push(plane[i]);
  return out;
}

async function scoreSweep(
  cases: readonly EvalCase[],
  rung: ResolvedRung,
  opts: RunOptions,
  tols: readonly number[],
): Promise<RungSweep> {
  const rowsByThreshold: Record<string, LineRow[]> = {};
  for (const t of SWEEP_THRESHOLDS) rowsByThreshold[t.toFixed(2)] = [];
  const errors: Record<string, string> = {};
  const notes = new Set<string>();
  let approximateCases = 0;
  const centreMedians: number[] = [];
  const backgroundP99s: number[] = [];

  for (const evalCase of cases) {
    const caseField = await computeField(evalCase, rung, opts);
    for (const note of caseField.notes) notes.add(note);
    if (caseField.approximate === true) approximateCases += 1;
    if (caseField.field === null) {
      errors[evalCase.id] = caseField.error ?? "no field";
      continue;
    }
    // H9 contract columns: the two contract numbers measured on THIS rung's field.
    const masks = gtMasks(evalCase);
    if (masks !== null) {
      const stats = contractStats(caseField.field, W128, masks.centreline, masks.background);
      if (stats.centrelineMedian !== null) centreMedians.push(stats.centrelineMedian);
      if (stats.backgroundP99 !== null) backgroundP99s.push(stats.backgroundP99);
    }
    // post "corridor": fate fill-in over the CONTRACT plane, regardless of the rung's own field.
    const corridorFate =
      rung.post === "corridor"
        ? await (async () => {
            const contractField = await contractFieldOf(evalCase, rung.framing, opts);
            if (contractField === null) return null;
            const found = searchCorridor(contractField, W128, CORRIDORS.fate);
            return found === null ? null : found.points.map((p) => [p.x / W128, p.y / W128] as const);
          })()
        : null;
    for (const t of SWEEP_THRESHOLDS) {
      const detectedRaw = extractAtThreshold(caseField.field, t);
      const detected =
        corridorFate !== null && detectedRaw.lines.fate === null
          ? { lines: { ...detectedRaw.lines, fate: corridorFate } }
          : detectedRaw;
      // Polyline metrics cover the four completion lines only — extractAtThreshold has no minor
      // channel; minor classes are scored by the emission-vs-GT section instead.
      for (const id of LABEL_LINE_IDS) {
        const gtLine = evalCase.lines[id];
        if (gtLine === undefined) continue; // unlabeled ≠ absent
        const gt = gtLine.absent ? null : gtLine.points;
        const byTol: Record<number, LineMetrics> = {};
        for (const tol of tols) byTol[tol] = lineMetrics(detected.lines[id], gt, EVAL_SIZE, tol);
        rowsByThreshold[t.toFixed(2)].push({
          caseId: evalCase.id,
          source: evalCase.source,
          hand: evalCase.hand,
          lineId: id,
          byTol,
        });
      }
    }
  }
  const mean = (xs: number[]): number | null => (xs.length === 0 ? null : xs.reduce((a, b) => a + b, 0) / xs.length);
  return {
    id: rungId(rung),
    framing: rung.framing,
    post: rung.post,
    aliasOf: rung.aliasOf,
    rowsByThreshold,
    errors,
    notes: [...notes],
    approximateCases,
    contract: { centrelineMedian: mean(centreMedians), backgroundP99: mean(backgroundP99s) },
  };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const tols = EVAL_TOLS.includes(args.headlineTol) ? EVAL_TOLS : [...EVAL_TOLS, args.headlineTol].sort((a, b) => a - b);

  if (args.jitter) {
    const sessions = measureJitter(args.root);
    if (sessions.length === 0) {
      console.log("no session with ≥5 landmark-bearing stills found — H12 needs more captures");
      return;
    }
    console.log(
      "# H12 anchor jitter (discrete captures — an UPPER BOUND on tracking jitter; the hand repositions between stills)\n",
    );
    for (const s of sessions) {
      console.log(`session ${s.sessionId} — ${s.stills} stills`);
      console.log("| anchor | std still px | std canonical px |");
      console.log("|---|--:|--:|");
      for (const a of s.anchors) console.log(`| ${a.name} | ${a.stdStillPx.toFixed(1)} | ${a.stdCanonicalPx.toFixed(1)} |`);
      console.log(`| **mean** | **${s.meanStillPx.toFixed(1)}** | **${s.meanCanonicalPx.toFixed(1)}** |`);
    }
    return;
  }

  const { cases, sessionDirs } = loadGroundTruthDetailed(args.root, undefined, {
    includeDuplicates: args.includeDuplicates,
  });
  for (const dir of sessionDirs) {
    console.log(`gt: session ${dir.id} — ${dir.layout} layout, ${dir.labelCount} label(s)`);
  }
  const active = cases.filter((c) => c.skip === undefined);
  if (active.length === 0) {
    console.log("no active ground-truth cases found — nothing to evaluate");
    return;
  }

  if (args.calibrateContract) {
    await calibrateContract(active, { modelPath: args.modelPath });
    return;
  }

  if (args.diag) {
    const target = active.find((c) => c.source === "legacy") ?? active[0];
    console.log(`# field diagnostics — ${target.id} (item 3)\n`);
    console.log("| framing | map | p99 | mean | max |");
    console.log("|---|---|--:|--:|--:|");
    const framings: Framing[] = args.modelPath === undefined ? ["classical"] : ["classical", "palmquad"];
    for (const framing of framings) {
      const result = await diagnoseFields(target, framing, {
        modelPath: framing === "classical" ? undefined : args.modelPath,
      });
      if (typeof result === "string") {
        console.log(`| ${framing} | (error: ${result}) | — | — | — |`);
        continue;
      }
      for (const row of result) {
        console.log(`| ${framing} | ${row.label} | ${row.p99.toFixed(3)} | ${row.mean.toFixed(4)} | ${row.max.toFixed(3)} |`);
      }
    }
    return;
  }

  const rungs = resolveRungs(args);
  const runs: RungSweep[] = [];
  for (const rung of rungs) runs.push(await scoreSweep(active, rung, { modelPath: args.modelPath }, tols));

  /*
   * Phantom-fate check, every run: on every fate-ABSENT case, the corridor search over the
   * contract plane must come back empty-handed. The acceptance target is 0 — one phantom fate is
   * a calibration bug, not noise.
   */
  const falseFate = { checked: 0, found: 0 };
  for (const evalCase of active) {
    const fateLine = evalCase.lines.fate;
    if (fateLine === undefined || !fateLine.absent) continue;
    const contractField = await contractFieldOf(evalCase, rungs[0].framing, { modelPath: args.modelPath });
    if (contractField === null) continue;
    falseFate.checked += 1;
    if (searchCorridor(contractField, W128, CORRIDORS.fate) !== null) falseFate.found += 1;
  }

  /*
   * Minor-line emission vs GT (on the FIRST rung's field) + the featureVocabV2 off/on bag diff —
   * both per case, both from the exact functions the live flags run.
   */
  const emissionRows: Record<MinorEmissionClass, { tp: number; fp: number; fn: number; tn: number }> = {
    sun: { tp: 0, fp: 0, fn: 0, tn: 0 },
    health: { tp: 0, fp: 0, fn: 0, tn: 0 },
    marriage: { tp: 0, fp: 0, fn: 0, tn: 0 },
    bracelets: { tp: 0, fp: 0, fn: 0, tn: 0 },
    girdle: { tp: 0, fp: 0, fn: 0, tn: 0 },
  };
  const vocabDiffs: Record<string, { added: string[]; changed: string[] }> = {};
  for (const evalCase of active) {
    const caseField = await computeField(evalCase, rungs[0], { modelPath: args.modelPath });
    if (caseField.field === null) continue;
    const emitted = minorEmissionOn(caseField.field);
    for (const cls of MINOR_EMISSION_CLASSES) {
      const gtLine = evalCase.lines[cls === "girdle" ? "girdle" : cls];
      if (gtLine === undefined) continue; // no minor label for this class ⇒ excluded, not absent
      const present = !gtLine.absent;
      if (emitted[cls] && present) emissionRows[cls].tp += 1;
      else if (emitted[cls] && !present) emissionRows[cls].fp += 1;
      else if (!emitted[cls] && present) emissionRows[cls].fn += 1;
      else emissionRows[cls].tn += 1;
    }
    vocabDiffs[evalCase.id] = vocabDiff(caseField.field);
  }

  let fwhm: Record<string, FwhmResult> | null = null;
  if (args.fwhm) {
    fwhm = {};
    for (const evalCase of active) fwhm[evalCase.id] = await measureFwhm(evalCase);
  }

  const report: EvalReport = {
    generatedAt: new Date().toISOString(),
    tols,
    headlineTol: args.headlineTol,
    cases,
    sessionDirs,
    runs,
    fwhm,
    minorEmission: { rungId: runs[0]?.id ?? "-", rows: emissionRows },
    vocabDiffs,
    falseFate,
  };
  console.log(renderMarkdown(report));
  const jsonPath = writeJson(report);
  console.log(`\nJSON: ${path.relative(process.cwd(), jsonPath)}`);
}

/* ------------------- H9: --calibrate-contract (two passes) ------------------- */

/**
 * Pass 1 measures the RAW depth plane's distribution on GT (no hardcoded ranges anywhere); pass 2
 * derives the search grids FROM those measurements and picks the (d0, s) maximising
 * centreline-vs-background separation on the contract plane subject to background p99 <= 0.15.
 * The chosen constants are WRITTEN into lib/scan/contract.ts (and the corridor acceptance floor
 * into lib/scan/corridor-path.ts) with the GT census in the JSDoc.
 */
async function calibrateContract(active: readonly EvalCase[], opts: RunOptions): Promise<void> {
  interface CaseCensus {
    readonly evalCase: EvalCase;
    readonly masks: { centreline: Uint8Array; background: Uint8Array };
    readonly centre: number[];
    readonly background: number[];
  }
  const censuses: CaseCensus[] = [];
  console.log("# contract calibration — pass 1: RAW depth-plane census (raw luma units)\n");
  console.log("| case | centre median | centre p90 | bg median | bg p90 | bg p99 |");
  console.log("|---|--:|--:|--:|--:|--:|");
  for (const evalCase of active) {
    const masks = gtMasks(evalCase);
    if (masks === null) continue;
    const planes = await rawPlanesOf(evalCase, opts);
    if (planes === null) continue;
    const centre = maskedValues(planes.depthRaw, masks.centreline);
    const background = maskedValues(planes.depthRaw, masks.background);
    if (centre.length === 0 || background.length === 0) continue;
    censuses.push({ evalCase, masks, centre, background });
    console.log(
      `| ${evalCase.id} | ${quantile(centre, 0.5).toFixed(4)} | ${quantile(centre, 0.9).toFixed(4)} | ` +
        `${quantile(background, 0.5).toFixed(4)} | ${quantile(background, 0.9).toFixed(4)} | ${quantile(background, 0.99).toFixed(4)} |`,
    );
  }
  if (censuses.length === 0) {
    console.log("\nno GT with labelled centrelines — nothing to calibrate");
    return;
  }
  const pooledCentre = censuses.flatMap((c) => c.centre);
  const pooledBackground = censuses.flatMap((c) => c.background);
  const centreMedian = quantile(pooledCentre, 0.5);
  const centreP90 = quantile(pooledCentre, 0.9);
  const bgMedian = quantile(pooledBackground, 0.5);
  const bgP90 = quantile(pooledBackground, 0.9);
  console.log(
    `| **pooled** | **${centreMedian.toFixed(4)}** | **${centreP90.toFixed(4)}** | **${bgMedian.toFixed(4)}** | **${bgP90.toFixed(4)}** | **${quantile(pooledBackground, 0.99).toFixed(4)}** |`,
  );

  // Pass 2: grids derived from pass 1, nothing hardcoded but the grid densities.
  const D0_STEPS = 9;
  const S_FRACTIONS = [0.1, 0.15, 0.2, 0.3, 0.4, 0.5, 0.75, 1];
  const delta = Math.max(1e-6, centreMedian - bgMedian);
  const d0Grid = Array.from({ length: D0_STEPS }, (_, i) => bgP90 + ((centreP90 - bgP90) * i) / (D0_STEPS - 1));
  const sGrid = S_FRACTIONS.map((f) => f * delta);
  console.log(
    `\n# pass 2: grid search — d0 in [${bgP90.toFixed(4)} .. ${centreP90.toFixed(4)}] (bg p90 .. centre p90), ` +
      `s = fractions of (centre median − bg median) = ${delta.toFixed(4)}\n`,
  );
  interface Scored {
    readonly d0: number;
    readonly s: number;
    readonly centre: number;
    readonly bg: number;
    readonly objective: number;
  }
  const scored: Scored[] = [];
  for (const d0 of d0Grid) {
    for (const s of sGrid) {
      const centreMedians: number[] = [];
      let worstBg = 0;
      for (const census of censuses) {
        const plane = await contractPlaneOf(census.evalCase, { d0, s }, opts);
        if (plane === null) continue;
        const stats = contractStats(plane, W128, census.masks.centreline, census.masks.background);
        if (stats.centrelineMedian !== null) centreMedians.push(stats.centrelineMedian);
        if (stats.backgroundP99 !== null && stats.backgroundP99 > worstBg) worstBg = stats.backgroundP99;
      }
      if (centreMedians.length === 0) continue;
      const centre = centreMedians.reduce((a, b) => a + b, 0) / centreMedians.length;
      scored.push({ d0, s, centre, bg: worstBg, objective: centre - worstBg });
    }
  }
  const feasible = scored.filter((entry) => entry.bg <= 0.15);
  const pool = feasible.length > 0 ? feasible : scored;
  pool.sort((a, b) => b.objective - a.objective);
  console.log("| rank | d0 | s | centre median | worst bg p99 | objective |");
  console.log("|--:|--:|--:|--:|--:|--:|");
  pool.slice(0, 5).forEach((entry, i) => {
    console.log(
      `| ${i + 1} | ${entry.d0.toFixed(4)} | ${entry.s.toFixed(4)} | ${entry.centre.toFixed(3)} | ${entry.bg.toFixed(3)} | ${entry.objective.toFixed(3)} |`,
    );
  });
  const chosen = pool[0];
  console.log(
    `\nchosen: d0=${chosen.d0.toFixed(4)} s=${chosen.s.toFixed(4)} — centre median ${chosen.centre.toFixed(3)}, ` +
      `worst bg p99 ${chosen.bg.toFixed(3)}${feasible.length === 0 ? " (NO grid point met bg p99 <= 0.15 — best objective taken)" : ""}`,
  );

  // Fate-corridor census on the CONTRACT plane (chosen params), fate-ABSENT hands only.
  const corridorMargin = 0.05;
  const fateValues: number[] = [];
  for (const census of censuses) {
    const fateLine = census.evalCase.lines.fate;
    if (fateLine === undefined || !fateLine.absent) continue;
    const plane = await contractPlaneOf(census.evalCase, { d0: chosen.d0, s: chosen.s }, opts);
    if (plane === null) continue;
    const mask = buildCorridorMask(CORRIDORS.fate, W128).inside;
    fateValues.push(...maskedValues(plane, mask));
  }
  const fateP95 = fateValues.length === 0 ? null : quantile(fateValues, 0.95);
  const acceptMean = fateP95 === null ? null : Number((fateP95 + corridorMargin).toFixed(3));
  console.log(
    fateP95 === null
      ? "\nno fate-ABSENT case with labels — CORRIDOR_ACCEPT_MEAN not derivable, left as-is"
      : `\nfate-corridor p95 on contract plane (fate-ABSENT hands): ${fateP95.toFixed(3)} → CORRIDOR_ACCEPT_MEAN = ${String(acceptMean)} (p95 + ${corridorMargin} margin)`,
  );

  const sessionCases = censuses.filter((c) => c.evalCase.source === "session").length;
  const provisional = censuses.length <= 2 || sessionCases === 0;
  if (provisional) {
    console.log(
      `\n*** PROVISIONAL *** — census is ${censuses.length} case(s) (${sessionCases} session). Recalibrate after session labels land.`,
    );
  }

  // Write the constants into the source, JSDoc census included.
  const stamp = new Date().toISOString().slice(0, 10);
  const censusLine = censuses.map((c) => c.evalCase.id).join(", ");
  const contractPath = path.resolve(__dirname, "..", "..", "lib", "scan", "contract.ts");
  const contractSrc = readFileSync(contractPath, "utf8");
  const docTag = ` * Calibration ${stamp}${provisional ? " (PROVISIONAL)" : ""}: GT census ${censusLine}; centre median ${chosen.centre.toFixed(3)}, worst bg p99 ${chosen.bg.toFixed(3)} (target <= 0.15).`;
  let nextSrc = contractSrc.replace(/ \* (UNCALIBRATED[^\n]*|Calibration [^\n]*)/, docTag);
  nextSrc = nextSrc.replace(
    /export const CONTRACT_DEPTH_DEFAULTS: ContractParams = \{ d0: [^,]+, s: [^}]+\};/,
    `export const CONTRACT_DEPTH_DEFAULTS: ContractParams = { d0: ${chosen.d0.toFixed(4)}, s: ${chosen.s.toFixed(4)} };`,
  );
  if (nextSrc === contractSrc) throw new Error("calibration writer failed to update contract.ts");
  writeFileSync(contractPath, nextSrc);
  console.log(`\nwrote CONTRACT_DEPTH_DEFAULTS into ${path.relative(process.cwd(), contractPath)}`);
  if (acceptMean !== null) {
    const corridorPath = path.resolve(__dirname, "..", "..", "lib", "scan", "corridor-path.ts");
    const corridorSrc = readFileSync(corridorPath, "utf8");
    const updated = corridorSrc.replace(
      /export const CORRIDOR_ACCEPT_MEAN = [^;]+;/,
      `export const CORRIDOR_ACCEPT_MEAN = ${String(acceptMean)};`,
    );
    if (updated === corridorSrc) throw new Error("calibration writer failed to update corridor-path.ts");
    writeFileSync(corridorPath, updated);
    console.log(`wrote CORRIDOR_ACCEPT_MEAN into ${path.relative(process.cwd(), corridorPath)}`);
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
