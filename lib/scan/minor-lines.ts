/**
 * Minor-line feature emission (flag `emitMinorLines`, default off) — the bridge between the
 * 12-class trace classifier and the KB.
 *
 * `classifyAll` has named sun / health / marriage / girdle / bracelet traces since the trace
 * taxonomy landed, but nothing ever turned them into features — 82 KB rules sat one emission step
 * from evidence the detector already had (reachability audit §2). This module closes that step
 * WITHOUT touching detection or the four major lines' emission: it only reads the
 * {@link TraceSet} the pipeline already produces.
 *
 * Confidence IS the gate: there is no per-feature confidence channel into the engine
 * (`effectiveWeight = rule.weight × calibration`, engine.ts:308), so a low-confidence trace must
 * simply not emit — the area then stays INSUFFICIENT through missing mass, the same discipline
 * `endpointObserved` applies to origin enums.
 *
 * Every emitted key exists in data/kb/hastrekha_kb.json's condition-key set —
 * test/minor-lines.test.ts parses the KB and enforces it. That constraint overrode two keys the
 * step spec named: `lines.sun.form` and `lines.marriage.count` are NOT KB keys (emitting them
 * would be the next silent-spelling bug), so sun emits `present` only and marriage emits the
 * KB-real `lines.marriage.presence`, banded by depth. Likewise health's "wavy" is not a KB value
 * (`form` ∈ crossing_to_life / cut_at_end / fish_tail_end / straight_free / touching_life);
 * a wavy health trace emits nothing rather than a value no rule can match.
 */
import type { Point2 } from "./types";
import type { TraceSet, ClassifiedTrace } from "./lines";

/**
 * Geometric-match floor for firing a KB rule — deliberately above `MIN_CLASS_SCORE` (0.42): a
 * trace that barely earned its name should render on the overlay, not testify in a reading.
 */
export const MINOR_EMIT_MIN_SCORE = 0.55;
/** Mean field response floor — a ghost of a crease is not KB evidence. */
export const MINOR_EMIT_MIN_DEPTH = 0.35;
/** Faint-tier traces (persistence-admitted shallow creases) never fire rules. */
export const MINOR_EMIT_REQUIRE_STRONG = true;

/** Marriage depth at which presence reads as the KB's "clear_deep" (mirrors life's clear band). */
export const MARRIAGE_CLEAR_DEPTH = 0.72;
/** Health-trace waviness above which no `form` value is emitted (KB has no "wavy" value). */
export const HEALTH_STRAIGHT_MAX_WAVINESS = 0.5;
/** Health-to-life proximity band for "crossing_to_life", as a fraction of crop size. */
export const HEALTH_CROSSING_BAND = 0.06;

export interface MinorLineOptions {
  /** The completed life polyline (crop px) — enables health "crossing_to_life". */
  readonly lifePoly?: readonly Point2[];
}

function qualifies(trace: ClassifiedTrace): boolean {
  if (trace.classScore < MINOR_EMIT_MIN_SCORE) return false;
  if (trace.depth < MINOR_EMIT_MIN_DEPTH) return false;
  if (MINOR_EMIT_REQUIRE_STRONG && trace.tier !== "strong") return false;
  return true;
}

/** Mean inter-segment turn angle — the same waviness notion lines.ts bands `texture` with. */
function turnWaviness(points: readonly Point2[]): number {
  if (points.length < 3) return 0;
  let total = 0;
  let count = 0;
  for (let i = 2; i < points.length; i += 1) {
    const ax = points[i - 1].x - points[i - 2].x;
    const ay = points[i - 1].y - points[i - 2].y;
    const bx = points[i].x - points[i - 1].x;
    const by = points[i].y - points[i - 1].y;
    const la = Math.hypot(ax, ay);
    const lb = Math.hypot(bx, by);
    if (la === 0 || lb === 0) continue;
    total += Math.acos(Math.min(1, Math.max(-1, (ax * bx + ay * by) / (la * lb))));
    count += 1;
  }
  return count === 0 ? 0 : total / count;
}

function nearPolyline(points: readonly Point2[], poly: readonly Point2[], bandPx: number): boolean {
  for (const p of points) {
    for (const q of poly) {
      if (Math.hypot(p.x - q.x, p.y - q.y) <= bandPx) return true;
    }
  }
  return false;
}

/**
 * Derive KB-facing minor-line features from the classifier's existing traces.
 *
 * Returns a nested partial feature bag (`{ lines: {...}, signs: {...} }`) ready to deep-merge
 * into `LineExtraction.features`. Emits nothing at all when no trace qualifies for a class —
 * except `signs.bracelets.count`, whose KB conditions are all `gte`, so an explicit 0 is honest
 * data and can never mis-fire a rule.
 */
export function minorLineFeatures(traces: TraceSet, opts: MinorLineOptions = {}, size = 128): Record<string, unknown> {
  const lines: Record<string, unknown> = {};
  const signs: Record<string, unknown> = {};
  const byClass = new Map<string, ClassifiedTrace[]>();
  for (const trace of traces.traces) {
    if (!qualifies(trace)) continue;
    const list = byClass.get(trace.class);
    if (list === undefined) byClass.set(trace.class, [trace]);
    else list.push(trace);
  }

  const sun = byClass.get("sun");
  if (sun !== undefined) lines.sun = { present: true };

  const health = byClass.get("health");
  if (health !== undefined) {
    const best = health.reduce((a, b) => (b.classScore > a.classScore ? b : a));
    const healthBag: Record<string, unknown> = {};
    if (opts.lifePoly !== undefined && nearPolyline(best.points, opts.lifePoly, HEALTH_CROSSING_BAND * size)) {
      healthBag.form = "crossing_to_life";
    } else if (turnWaviness(best.points) <= HEALTH_STRAIGHT_MAX_WAVINESS) {
      healthBag.form = "straight_free";
    }
    // A wavy, non-crossing health trace emits no form — the KB has no value for it.
    if (Object.keys(healthBag).length > 0) lines.health = healthBag;
  }

  const marriage = byClass.get("marriage");
  if (marriage !== undefined) {
    const deepest = Math.max(...marriage.map((t) => t.depth));
    lines.marriage = { presence: deepest >= MARRIAGE_CLEAR_DEPTH ? "clear_deep" : "short_faint_marks" };
  }

  const bracelets = byClass.get("bracelets");
  // gte-only conditions: an explicit 0 is honest absence-data and cannot fire anything.
  signs.bracelets = { count: bracelets?.length ?? 0 };

  const girdle = byClass.get("girdle_of_venus");
  if (girdle !== undefined) signs.girdle_of_venus = { present: true };

  const out: Record<string, unknown> = {};
  if (Object.keys(lines).length > 0) out.lines = lines;
  if (Object.keys(signs).length > 0) out.signs = signs;
  return out;
}

/**
 * Fix #5's other half (flag `featureVocabV2`): two fate claimants — the principal plus a
 * demoted duplicate carrying `demotedFrom: "fate"` — mean a sister fate line, the KB's
 * `lines.fate.structure = "double"`. Lives here rather than in extractLines because extractLines
 * never sees the classifier's output.
 */
export function fateDoubleOverride(traces: TraceSet): boolean {
  const principal = traces.traces.some((t) => t.class === "fate" && qualifies(t));
  const demoted = traces.traces.some((t) => t.demotedFrom === "fate" && qualifies(t));
  return principal && demoted;
}
