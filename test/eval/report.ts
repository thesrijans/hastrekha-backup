/**
 * Report rendering for the eval harness (Phase 0d): markdown to stdout, full JSON to
 * test/eval/out/<timestamp>.json so any run can be diffed against any other run later.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { LABEL_LINE_IDS } from "../../lib/scan/dev/session-types";
import { EVAL_TOLS, EVAL_TOL_PX_AT_512, aggregate, type AggregateBucket, type LineRow } from "./metrics";
import type { EvalCase } from "./gt-adapter";
import type { FwhmResult } from "./fwhm";
import type { Rung } from "./run-pipeline";

export interface RungRun {
  readonly rung: Rung;
  readonly rows: readonly LineRow[];
  /** Per-case fatal errors, keyed by case id. */
  readonly errors: Readonly<Record<string, string>>;
  /** Distinct non-fatal notes surfaced by the pipeline. */
  readonly notes: readonly string[];
  /** Cases whose full-hand warp used the 4-anchor approximation (legacy GT, no 21 landmarks). */
  readonly approximateCases?: number;
}

export interface EvalReport {
  readonly generatedAt: string;
  readonly tols: readonly number[];
  readonly headlineTol: number;
  readonly cases: readonly EvalCase[];
  readonly runs: readonly RungRun[];
  readonly fwhm: Readonly<Record<string, FwhmResult>> | null;
}

const fmt = (value: number, digits = 2): string => (Number.isFinite(value) ? value.toFixed(digits) : "—");
const pct = (value: number): string => (Number.isFinite(value) ? `${(value * 100).toFixed(0)}%` : "—");

function bucketFor(rows: readonly LineRow[], lineId: string, tol: number): AggregateBucket {
  const scoped = lineId === "ALL" ? rows : rows.filter((row) => row.lineId === lineId);
  return aggregate(scoped, tol).overall;
}

function rungTable(run: RungRun, tols: readonly number[], headline: number): string {
  const lines: string[] = [];
  const tolCols = tols.map((tol) => `P@${tol} | R@${tol} | F1@${tol}`).join(" | ");
  lines.push(`| line | n | detect | false-line | ${tolCols} | median px | p95 px |`);
  lines.push(`|---|--:|--:|--:|${tols.map(() => "--:|--:|--:").join("|")}|--:|--:|`);
  for (const id of [...LABEL_LINE_IDS, "ALL"]) {
    const head = bucketFor(run.rows, id, headline);
    const cells = tols
      .map((tol) => {
        const b = bucketFor(run.rows, id, tol);
        return `${pct(b.meanPrecision)} | ${pct(b.meanRecall)} | ${fmt(b.meanF1)}`;
      })
      .join(" | ");
    lines.push(
      `| ${id} | ${head.n} | ${pct(head.detectRate)} | ${pct(head.falseLineRate)} | ${cells} | ${fmt(head.meanMedianDistPx, 1)} | ${fmt(head.meanP95DistPx, 1)} |`,
    );
  }
  return lines.join("\n");
}

function deltaTable(baseline: RungRun, other: RungRun, headline: number): string {
  const lines: string[] = [];
  lines.push(`| line | Δdetect | ΔF1@${headline} | Δmedian px |`);
  lines.push("|---|--:|--:|--:|");
  for (const id of [...LABEL_LINE_IDS, "ALL"]) {
    const a = bucketFor(baseline.rows, id, headline);
    const b = bucketFor(other.rows, id, headline);
    const d = (x: number, y: number, digits = 2): string =>
      Number.isFinite(x) && Number.isFinite(y) ? (y - x >= 0 ? "+" : "") + (y - x).toFixed(digits) : "—";
    lines.push(`| ${id} | ${d(a.detectRate, b.detectRate)} | ${d(a.meanF1, b.meanF1)} | ${d(a.meanMedianDistPx, b.meanMedianDistPx, 1)} |`);
  }
  return lines.join("\n");
}

export function renderMarkdown(report: EvalReport): string {
  const out: string[] = [];
  const active = report.cases.filter((c) => c.skip === undefined);
  out.push(`# Rekha eval — ${report.generatedAt}`);
  out.push("");
  out.push(
    `${active.length} active case(s) (${active.filter((c) => c.source === "legacy").length} legacy, ` +
      `${active.filter((c) => c.source === "session").length} session) · metric space 512 px · ` +
      `headline tolerance ${report.headlineTol}px (curve at ${report.tols.join("/")}px).`,
  );

  for (const run of report.runs) {
    out.push("");
    out.push(`## rung: ${run.rung}`);
    out.push("");
    out.push(rungTable(run, report.tols, report.headlineTol));
    const errorEntries = Object.entries(run.errors);
    if (errorEntries.length > 0) {
      out.push("");
      out.push(`errors: ${errorEntries.map(([id, err]) => `${id} (${err})`).join(" · ")}`);
    }
    if (run.notes.length > 0) {
      out.push("");
      for (const note of run.notes) out.push(`> ${note}`);
    }
  }

  const baseline = report.runs.find((run) => run.rung === "baseline");
  if (baseline !== undefined && report.runs.length > 1) {
    out.push("");
    out.push("## rung vs baseline");
    for (const run of report.runs) {
      if (run.rung === "baseline") continue;
      out.push("");
      out.push(`### ${run.rung} − baseline`);
      out.push("");
      out.push(deltaTable(baseline, run, report.headlineTol));
      if (run.approximateCases !== undefined && run.approximateCases > 0) {
        out.push("");
        out.push(
          `> ${run.approximateCases} case(s) used the 4-anchor full-hand approximation (legacy GT carries no 21-landmark set); session cases use the true landmark solve.`,
        );
      }
    }
    const framingRungs = report.runs.filter((run) => run.rung.startsWith("unet-fullhand"));
    if (framingRungs.length > 0) {
      out.push("");
      out.push("## framing delta (palm-quad UNet baseline vs full-hand rungs)");
      out.push("");
      out.push(
        "baseline here is the palm-quad crop through the same model (--model); the rungs differ ONLY in the UNet input framing + remap.",
      );
    }
  }

  if (report.fwhm !== null) {
    out.push("");
    out.push("## crease FWHM (H1 on this ground truth)");
    out.push("");
    out.push("| case | line | median @native px | n | median @128 px | n |");
    out.push("|---|---|--:|--:|--:|--:|");
    for (const [caseId, result] of Object.entries(report.fwhm)) {
      for (const id of LABEL_LINE_IDS) {
        const line = result[id];
        if (line === undefined) continue;
        out.push(
          `| ${caseId} | ${id} | ${fmt(line.medianAtNativePx)} | ${line.nNative} | ${fmt(line.medianAt128Px)} | ${line.n128} |`,
        );
      }
    }
  }

  const skipped = report.cases.filter((c) => c.skip !== undefined);
  out.push("");
  out.push("## skipped cases");
  out.push("");
  if (skipped.length === 0) out.push("none");
  for (const c of skipped) out.push(`- **${c.id}** (${c.source}): ${c.skip}`);
  out.push("");
  return out.join("\n");
}

/** Write the full report JSON; returns the path. */
export function writeJson(report: EvalReport, repoRoot: string = path.resolve(__dirname, "..", "..")): string {
  const dir = path.join(repoRoot, "test", "eval", "out");
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${report.generatedAt.replace(/[:.]/g, "-")}.json`);
  writeFileSync(file, JSON.stringify(report, null, 2), "utf8");
  return file;
}

export { EVAL_TOLS, EVAL_TOL_PX_AT_512 };
