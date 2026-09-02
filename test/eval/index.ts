/**
 * Eval harness CLI (sprint Phase 0d) — the scoreboard every future core change reports against.
 *
 * ```
 * npm run eval                                            # baseline on all GT
 * npm run eval -- --rung=baseline,enhancer,enhancer-ridge --fwhm
 * npm run eval -- --model=fixtures/private/models/palm-lines.fp32.onnx
 * npm run eval -- --tol=6 --root=fixtures
 * ```
 *
 * Read-only over lib/scan/** — this measures the frozen core, it never changes it.
 */
import path from "node:path";
import { loadGroundTruthDetailed, type EvalCase } from "./gt-adapter";
import { EVAL_TOLS, EVAL_TOL_PX_AT_512, EVAL_SIZE, lineMetrics, type LineMetrics, type LineRow } from "./metrics";
import { RUNGS, runStill, type Rung } from "./run-pipeline";
import { measureFwhm, type FwhmResult } from "./fwhm";
import { renderMarkdown, writeJson, type EvalReport, type RungRun } from "./report";
import { LABEL_LINE_IDS } from "../../lib/scan/dev/session-types";

interface CliArgs {
  readonly rungs: readonly Rung[];
  readonly modelPath?: string;
  readonly headlineTol: number;
  readonly fwhm: boolean;
  readonly root: string;
}

function parseArgs(argv: readonly string[]): CliArgs {
  const get = (name: string): string | undefined => {
    const hit = argv.find((arg) => arg.startsWith(`--${name}=`));
    return hit?.slice(name.length + 3);
  };
  const rungArg = get("rung");
  const rungs =
    rungArg === undefined
      ? (["baseline"] as Rung[])
      : rungArg.split(",").map((r) => {
          if (!(RUNGS as readonly string[]).includes(r)) throw new Error(`unknown rung "${r}" — expected ${RUNGS.join("|")}`);
          return r as Rung;
        });
  const tolArg = get("tol");
  return {
    rungs,
    modelPath: get("model"),
    headlineTol: tolArg === undefined ? EVAL_TOL_PX_AT_512 : Number(tolArg),
    fwhm: argv.includes("--fwhm"),
    root: get("root") ?? "fixtures",
  };
}

async function scoreRung(cases: readonly EvalCase[], rung: Rung, args: CliArgs, tols: readonly number[]): Promise<RungRun> {
  const rows: LineRow[] = [];
  const errors: Record<string, string> = {};
  const notes = new Set<string>();
  let approximateCases = 0;
  for (const evalCase of cases) {
    const detected = await runStill(evalCase, rung, { modelPath: args.modelPath });
    for (const note of detected.notes) notes.add(note);
    if (detected.approximate === true) approximateCases += 1;
    if (detected.error !== undefined) {
      errors[evalCase.id] = detected.error;
      continue;
    }
    for (const id of LABEL_LINE_IDS) {
      const gtLine = evalCase.lines[id];
      if (gtLine === undefined) continue; // unlabeled ≠ absent — excluded from scoring entirely
      const gt = gtLine.absent ? null : gtLine.points;
      const byTol: Record<number, LineMetrics> = {};
      for (const tol of tols) byTol[tol] = lineMetrics(detected.lines[id], gt, EVAL_SIZE, tol);
      rows.push({ caseId: evalCase.id, source: evalCase.source, hand: evalCase.hand, lineId: id, byTol });
    }
  }
  return { rung, rows, errors, notes: [...notes], approximateCases };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const tols = EVAL_TOLS.includes(args.headlineTol) ? EVAL_TOLS : [...EVAL_TOLS, args.headlineTol].sort((a, b) => a - b);

  const { cases, sessionDirs } = loadGroundTruthDetailed(args.root);
  for (const dir of sessionDirs) {
    console.log(`gt: session ${dir.id} — ${dir.layout} layout, ${dir.labelCount} label(s)`);
  }
  const active = cases.filter((c) => c.skip === undefined);
  if (active.length === 0) {
    console.log("no active ground-truth cases found — nothing to evaluate");
    return;
  }

  const runs: RungRun[] = [];
  for (const rung of args.rungs) runs.push(await scoreRung(active, rung, args, tols));

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
  };

  console.log(renderMarkdown(report));
  const jsonPath = writeJson(report);
  console.log(`\nJSON: ${path.relative(process.cwd(), jsonPath)}`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
