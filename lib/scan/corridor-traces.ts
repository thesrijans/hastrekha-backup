/**
 * Corridor fill-in traces (flag `corridorSearch`) — FILL-IN ONLY, never competition.
 *
 * The skeleton path (binarize → thin → trace) stays the primary detector. A corridor is searched
 * only where that path came back empty-handed:
 *
 *  - fate: only when completion produced no fate line at all;
 *  - a minor class (sun / health / marriage): only when no classifier trace of that class passed
 *    the minor-emission gates (the same constants minor-lines.ts fires rules with).
 *
 * A found path enters the SAME ClassifiedTrace → features pipeline as every other trace, tagged
 * `source: "corridor"` with the path's mean contract-field value as its classScore — the trace's
 * confidence IS the field's confidence, nothing invented. Simplified before entry so waviness /
 * point-density statistics see the same density as skeleton traces.
 */
import { CORRIDORS } from "./completion";
import { MINOR_CORRIDORS } from "./corridors-minor";
import { searchCorridor } from "./corridor-path";
import { depthProxy, type ClassifiedTrace, type LineExtraction, type TraceSet } from "./lines";
import type { TraceClass } from "./classify";
import { MINOR_EMIT_MIN_DEPTH, MINOR_EMIT_MIN_SCORE, MINOR_EMIT_REQUIRE_STRONG } from "./minor-lines";

/** The classes the corridor search may fill in. */
export const CORRIDOR_CLASSES = ["fate", "sun", "health", "marriage"] as const;
export type CorridorClass = (typeof CORRIDOR_CLASSES)[number];

/** Same qualification the minor emitter uses — a class BELOW these gates counts as "not emitted". */
function minorEmitted(all: TraceSet, cls: TraceClass): boolean {
  return all.traces.some(
    (t) =>
      t.class === cls &&
      t.classScore >= MINOR_EMIT_MIN_SCORE &&
      t.depth >= MINOR_EMIT_MIN_DEPTH &&
      (!MINOR_EMIT_REQUIRE_STRONG || t.tier === "strong"),
  );
}

/**
 * Search the corridors whose lines are missing and return the accepted paths as traces.
 * `field` must be the CONTRACT field — the acceptance floors are probability statements and mean
 * nothing on the legacy percentile field.
 */
/** One line of the diagnostics readout: what was searched and how it went. */
export interface CorridorAttempt {
  readonly cls: CorridorClass;
  readonly accepted: boolean;
  /** Mean contract field of the ACCEPTED path; null when the search rejected or found nothing. */
  readonly meanField: number | null;
}

export function corridorTraces(
  field: Float32Array,
  size: number,
  found: LineExtraction,
  all: TraceSet,
  report?: CorridorAttempt[],
): ClassifiedTrace[] {
  const out: ClassifiedTrace[] = [];

  const emit = (cls: CorridorClass): void => {
    const corridor = cls === "fate" ? CORRIDORS.fate : MINOR_CORRIDORS[cls];
    const result = searchCorridor(field, size, corridor);
    report?.push({ cls, accepted: result !== null, meanField: result?.meanField ?? null });
    if (result === null) return;
    const points = result.points.map((p) => ({ x: p.x, y: p.y }));
    out.push({
      points,
      tier: "strong",
      depth: depthProxy(field, points, size),
      class: cls,
      classScore: result.meanField,
      source: "corridor",
    });
  };

  if (found.completion.lines.fate === undefined) emit("fate");
  for (const cls of ["sun", "health", "marriage"] as const) {
    if (!minorEmitted(all, cls)) emit(cls);
  }
  return out;
}

/**
 * Features a corridor-found FATE contributes: presence, and the KB's `faint` structure — nothing
 * else. A fate line the skeleton could not see but the corridor could is a faint fate by
 * definition; claiming origin/endings/structure beyond that would be reading the prior. Minor
 * classes contribute nothing here — their corridor traces flow through minorLineFeatures, which
 * is source-agnostic.
 */
export function corridorFateFeatures(traces: readonly ClassifiedTrace[]): Record<string, unknown> {
  const fate = traces.find((t) => t.source === "corridor" && t.class === "fate");
  if (fate === undefined) return {};
  return { lines: { fate: { present: true, structure: "faint" } } };
}
