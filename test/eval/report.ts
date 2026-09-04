/**
 * Report rendering for the eval harness (Phase 0d) — operating-point aware: every rung carries a
 * full threshold sweep, tables show the shipped threshold AND each rung's own best, and the JSON
 * dump keeps the whole sweep so any operating point can be re-examined later.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { LABEL_LINE_IDS, LABELABLE_LINE_IDS } from "../../lib/scan/dev/session-types";
import { EVAL_TOLS, EVAL_TOL_PX_AT_512, aggregate, type AggregateBucket, type LineRow } from "./metrics";
import type { EvalCase, SessionDirInfo } from "./gt-adapter";
import type { FwhmResult } from "./fwhm";
import { SHIPPED_THRESHOLD, type Framing, type Post } from "./run-pipeline";

export interface RungSweep {
  /** Composed id, e.g. "classical+fused"; aliasOf carries the legacy name when one resolved here. */
  readonly id: string;
  readonly framing: Framing;
  readonly post: Post;
  readonly aliasOf?: string;
  /** H9 contract columns: mean-across-cases centreline median and background p99 of THIS rung's field. */
  readonly contract?: { readonly centrelineMedian: number | null; readonly backgroundP99: number | null };
  /** Scored rows per swept threshold, keyed by t.toFixed(2). */
  readonly rowsByThreshold: Readonly<Record<string, readonly LineRow[]>>;
  readonly errors: Readonly<Record<string, string>>;
  readonly notes: readonly string[];
  readonly approximateCases: number;
}

export interface EvalReport {
  readonly generatedAt: string;
  readonly tols: readonly number[];
  readonly headlineTol: number;
  readonly cases: readonly EvalCase[];
  readonly sessionDirs?: readonly SessionDirInfo[];
  readonly runs: readonly RungSweep[];
  /** H9 phantom-fate check: corridor search on fate-ABSENT cases; the acceptance target is 0. */
  readonly falseFate?: { readonly checked: number; readonly found: number };
  readonly fwhm: Readonly<Record<string, FwhmResult>> | null;
  /** Minor-class emission confusion vs GT, on the first rung's field. */
  readonly minorEmission?: {
    readonly rungId: string;
    readonly rows: Readonly<Record<string, { readonly tp: number; readonly fp: number; readonly fn: number; readonly tn: number }>>;
  };
  /** featureVocabV2 off→on bag diffs per case — the freeze-lift commit's receipts. */
  readonly vocabDiffs?: Readonly<Record<string, { readonly added: readonly string[]; readonly changed: readonly string[] }>>;
}

const fmt = (value: number, digits = 2): string => (Number.isFinite(value) ? value.toFixed(digits) : "—");
const pct = (value: number): string => (Number.isFinite(value) ? `${(value * 100).toFixed(0)}%` : "—");
const tKey = (t: number): string => t.toFixed(2);

function bucketFor(rows: readonly LineRow[], lineId: string, tol: number): AggregateBucket {
  const scoped = lineId === "ALL" ? rows : rows.filter((row) => row.lineId === lineId);
  return aggregate(scoped, tol).overall;
}

const rowsAt = (run: RungSweep, t: number): readonly LineRow[] => run.rowsByThreshold[tKey(t)] ?? [];

/** Overall F1 with a rankable value for "nothing detected" (NaN → −1). */
function rankF1(rows: readonly LineRow[], tol: number): number {
  const f1 = bucketFor(rows, "ALL", tol).meanF1;
  return Number.isFinite(f1) ? f1 : -1;
}

/**
 * F1 with every MISSED line counted as 0 — meanF1 alone averages over detected pairs, so an
 * operating point that finds one line perfectly outranks one that finds all six decently. This is
 * the criterion the own-best comparisons use; the literal pairs-only best is still shown.
 */
function rankBalanced(rows: readonly LineRow[], tol: number): number {
  const bucket = bucketFor(rows, "ALL", tol);
  if (!Number.isFinite(bucket.meanF1) || !Number.isFinite(bucket.detectRate)) return -1;
  return bucket.meanF1 * bucket.detectRate;
}

function argBest(run: RungSweep, score: (rows: readonly LineRow[]) => number): number {
  let best = SHIPPED_THRESHOLD;
  let bestScore = Number.NEGATIVE_INFINITY;
  for (const key of Object.keys(run.rowsByThreshold)) {
    const value = score(run.rowsByThreshold[key]);
    if (value > bestScore) {
      bestScore = value;
      best = Number(key);
    }
  }
  return best;
}

/** Literal best-by-pairs-F1 (the sweep's raw optimum). */
export function bestThreshold(run: RungSweep, tol: number): number {
  return argBest(run, (rows) => rankF1(rows, tol));
}

/** Balanced best — missed lines count as zero F1. */
export function bestBalancedThreshold(run: RungSweep, tol: number): number {
  return argBest(run, (rows) => rankBalanced(rows, tol));
}

function rungTable(rows: readonly LineRow[], tols: readonly number[], headline: number): string {
  const lines: string[] = [];
  const tolCols = tols.map((tol) => `P@${tol} | R@${tol} | F1@${tol}`).join(" | ");
  lines.push(`| line | n | detect | false-line | ${tolCols} | median px | p95 px |`);
  lines.push(`|---|--:|--:|--:|${tols.map(() => "--:|--:|--:").join("|")}|--:|--:|`);
  for (const id of [...LABEL_LINE_IDS, "ALL"]) {
    const head = bucketFor(rows, id, headline);
    const cells = tols
      .map((tol) => {
        const b = bucketFor(rows, id, tol);
        return `${pct(b.meanPrecision)} | ${pct(b.meanRecall)} | ${fmt(b.meanF1)}`;
      })
      .join(" | ");
    lines.push(
      `| ${id} | ${head.n} | ${pct(head.detectRate)} | ${pct(head.falseLineRate)} | ${cells} | ${fmt(head.meanMedianDistPx, 1)} | ${fmt(head.meanP95DistPx, 1)} |`,
    );
  }
  return lines.join("\n");
}

function deltaTable(baseRows: readonly LineRow[], otherRows: readonly LineRow[], headline: number): string {
  const lines: string[] = [];
  lines.push(`| line | Δdetect | ΔF1@${headline} | Δmedian px |`);
  lines.push("|---|--:|--:|--:|");
  for (const id of [...LABEL_LINE_IDS, "ALL"]) {
    const a = bucketFor(baseRows, id, headline);
    const b = bucketFor(otherRows, id, headline);
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
      `headline tolerance ${report.headlineTol}px · threshold sweep 0.15…0.85 step 0.05 (shipped LINE_THRESHOLD = ${SHIPPED_THRESHOLD}).`,
  );
  if (report.sessionDirs !== undefined && report.sessionDirs.length > 0) {
    const labelled = report.sessionDirs.reduce((sum, dir) => sum + dir.labelCount, 0);
    out.push("");
    out.push(
      `${report.sessionDirs.length} session dir(s) discovered (${labelled} labelled still(s)): ` +
        report.sessionDirs.map((dir) => `${dir.id} [${dir.layout}]`).join(" · "),
    );
  }

  /* Operating points — the sweep's summary. */
  out.push("");
  out.push("## operating points (overall, headline tolerance)");
  out.push("");
  out.push(
    `| rung | alias | best t (pairs-F1) | F1 / detect @best | bal. t | F1 / detect @bal | F1 / detect @shipped | ctr median | bg p99 |`,
  );
  out.push("|---|---|--:|--:|--:|--:|--:|--:|--:|");
  for (const run of report.runs) {
    const best = bestThreshold(run, report.headlineTol);
    const balanced = bestBalancedThreshold(run, report.headlineTol);
    const b1 = bucketFor(rowsAt(run, best), "ALL", report.headlineTol);
    const b2 = bucketFor(rowsAt(run, balanced), "ALL", report.headlineTol);
    const shipped = bucketFor(rowsAt(run, SHIPPED_THRESHOLD), "ALL", report.headlineTol);
    const ctr = run.contract?.centrelineMedian ?? null;
    const bg = run.contract?.backgroundP99 ?? null;
    out.push(
      `| ${run.id} | ${run.aliasOf ?? "—"} | ${best.toFixed(2)} | ${fmt(b1.meanF1)} / ${pct(b1.detectRate)} | ${balanced.toFixed(2)} | ${fmt(b2.meanF1)} / ${pct(b2.detectRate)} | ${fmt(shipped.meanF1)} / ${pct(shipped.detectRate)} | ${ctr === null ? "—" : ctr.toFixed(3)} | ${bg === null ? "—" : bg.toFixed(3)} |`,
    );
  }
  out.push("");
  out.push(
    "> best t maximises pairs-only F1 (can reward finding ONE line well); bal. t maximises F1 with missed lines counted as 0 — the own-best deltas use bal. t.",
  );
  if (report.falseFate !== undefined) {
    out.push("");
    out.push(
      `## phantom-fate check: ${report.falseFate.found}/${report.falseFate.checked} fate-ABSENT case(s) produced a corridor fate — false-fate rate ${
        report.falseFate.checked === 0 ? "n/a (no fate-absent GT)" : (report.falseFate.found / report.falseFate.checked).toFixed(2)
      } (target 0)`,
    );
  }

  for (const run of report.runs) {
    out.push("");
    out.push(`## rung: ${run.id}${run.aliasOf !== undefined ? ` (alias: ${run.aliasOf})` : ""} — at shipped t=${SHIPPED_THRESHOLD}`);
    out.push("");
    out.push(rungTable(rowsAt(run, SHIPPED_THRESHOLD), report.tols, report.headlineTol));
    const best = bestBalancedThreshold(run, report.headlineTol);
    if (tKey(best) !== tKey(SHIPPED_THRESHOLD)) {
      out.push("");
      out.push(`### same rung at its balanced-best t=${best.toFixed(2)}`);
      out.push("");
      out.push(rungTable(rowsAt(run, best), report.tols, report.headlineTol));
    }
    const errorEntries = Object.entries(run.errors);
    if (errorEntries.length > 0) {
      out.push("");
      out.push(`errors: ${errorEntries.map(([id, err]) => `${id} (${err})`).join(" · ")}`);
    }
    if (run.approximateCases > 0) {
      out.push("");
      out.push(`> ${run.approximateCases} case(s) used the 4-anchor full-hand approximation (legacy GT has no 21-landmark set).`);
    }
    for (const note of run.notes) {
      out.push("");
      out.push(`> ${note}`);
    }
  }

  const baseline = report.runs.find((run) => run.aliasOf === "baseline") ?? report.runs[0];
  if (baseline !== undefined && report.runs.length > 1) {
    out.push("");
    out.push(`## rung vs ${baseline.id} — at shipped t=${SHIPPED_THRESHOLD}`);
    for (const run of report.runs) {
      if (run === baseline) continue;
      out.push("");
      out.push(`### ${run.id} − ${baseline.id}`);
      out.push("");
      out.push(deltaTable(rowsAt(baseline, SHIPPED_THRESHOLD), rowsAt(run, SHIPPED_THRESHOLD), report.headlineTol));
    }
    const baseBest = bestBalancedThreshold(baseline, report.headlineTol);
    out.push("");
    out.push(`## rung vs ${baseline.id} — each at its OWN balanced-best t (baseline t=${baseBest.toFixed(2)})`);
    for (const run of report.runs) {
      if (run === baseline) continue;
      const best = bestBalancedThreshold(run, report.headlineTol);
      out.push("");
      out.push(`### ${run.id} (t=${best.toFixed(2)}) − ${baseline.id} (t=${baseBest.toFixed(2)})`);
      out.push("");
      out.push(deltaTable(rowsAt(baseline, baseBest), rowsAt(run, best), report.headlineTol));
    }
  }

  if (report.fwhm !== null) {
    out.push("");
    out.push("## crease FWHM (H1 on this ground truth)");
    out.push("");
    out.push("| case | line | median @native px | n | median @128 px | n |");
    out.push("|---|---|--:|--:|--:|--:|");
    for (const [caseId, result] of Object.entries(report.fwhm)) {
      for (const id of LABELABLE_LINE_IDS) {
        const line = result[id];
        if (line === undefined) continue;
        out.push(
          `| ${caseId} | ${id} | ${fmt(line.medianAtNativePx)} | ${line.nNative} | ${fmt(line.medianAt128Px)} | ${line.n128} |`,
        );
      }
    }
  }

  if (report.minorEmission !== undefined) {
    out.push("");
    out.push(`## minor-line emission vs GT (field: ${report.minorEmission.rungId}, flag thresholds)`);
    out.push("");
    out.push("| class | n | TP | FP | FN | TN | precision |");
    out.push("|---|--:|--:|--:|--:|--:|--:|");
    let any = false;
    for (const [cls, r] of Object.entries(report.minorEmission.rows)) {
      const n = r.tp + r.fp + r.fn + r.tn;
      if (n === 0) continue;
      any = true;
      const precision = r.tp + r.fp === 0 ? NaN : r.tp / (r.tp + r.fp);
      out.push(`| ${cls} | ${n} | ${r.tp} | ${r.fp} | ${r.fn} | ${r.tn} | ${fmt(precision)} |`);
    }
    if (!any) out.push("| (no minor-class labels in the current GT — label sun/health/marriage/bracelets/girdle in /dev/label to populate) | | | | | | |");
  }

  if (report.vocabDiffs !== undefined) {
    out.push("");
    out.push("## featureVocabV2 off → on (keys added/changed only)");
    for (const [caseId, diff] of Object.entries(report.vocabDiffs)) {
      out.push("");
      out.push(`- **${caseId}**`);
      if (diff.added.length === 0 && diff.changed.length === 0) out.push("  - (no change on this field)");
      for (const add of diff.added) out.push(`  - added: \`${add}\``);
      for (const change of diff.changed) out.push(`  - changed: \`${change}\``);
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

/** Write the full report JSON (whole sweep included); returns the path. */
export function writeJson(report: EvalReport, repoRoot: string = path.resolve(__dirname, "..", "..")): string {
  const dir = path.join(repoRoot, "test", "eval", "out");
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${report.generatedAt.replace(/[:.]/g, "-")}.json`);
  writeFileSync(file, JSON.stringify(report, null, 2), "utf8");
  return file;
}

export { EVAL_TOLS, EVAL_TOL_PX_AT_512 };
