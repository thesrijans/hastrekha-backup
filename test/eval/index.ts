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
  FRAMINGS,
  POSTS,
  SWEEP_THRESHOLDS,
  computeField,
  diagnoseFields,
  extractAtThreshold,
  minorEmissionOn,
  rungId,
  vocabDiff,
  MINOR_EMISSION_CLASSES,
  type MinorEmissionClass,
  type ComposedRung,
  type Framing,
  type Post,
  type RunOptions,
} from "./run-pipeline";
import { measureFwhm, type FwhmResult } from "./fwhm";
import { measureJitter } from "./jitter";
import { renderMarkdown, writeJson, type EvalReport, type RungSweep } from "./report";
import { LABEL_LINE_IDS } from "../../lib/scan/dev/session-types";

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
    for (const framing of framings) {
      for (const post of POSTS) {
        grid.push({ framing, post, aliasOf: framing === autoFraming && post === "fused" ? "baseline" : undefined });
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
    const [framing, post] = spec.split("+");
    if (!(FRAMINGS as readonly string[]).includes(framing) || !(POSTS as readonly string[]).includes(post)) {
      throw new Error(
        `unknown rung "${spec}" — use an alias or <framing>+<post> from ${FRAMINGS.join("|")} × ${POSTS.join("|")}`,
      );
    }
    return { framing: framing as Framing, post: post as Post };
  });
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

  for (const evalCase of cases) {
    const caseField = await computeField(evalCase, rung, opts);
    for (const note of caseField.notes) notes.add(note);
    if (caseField.approximate === true) approximateCases += 1;
    if (caseField.field === null) {
      errors[evalCase.id] = caseField.error ?? "no field";
      continue;
    }
    for (const t of SWEEP_THRESHOLDS) {
      const detected = extractAtThreshold(caseField.field, t);
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
  return {
    id: rungId(rung),
    framing: rung.framing,
    post: rung.post,
    aliasOf: rung.aliasOf,
    rowsByThreshold,
    errors,
    notes: [...notes],
    approximateCases,
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
  };
  console.log(renderMarkdown(report));
  const jsonPath = writeJson(report);
  console.log(`\nJSON: ${path.relative(process.cwd(), jsonPath)}`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
