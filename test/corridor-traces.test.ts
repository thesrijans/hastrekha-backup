/* ============================================================================
 * CORRIDOR TRACES — fill-in only, and the fate feature is exactly "faint"
 * ========================================================================== */
import assert from "node:assert/strict";
import { corridorFateFeatures, corridorTraces, type CorridorAttempt } from "../lib/scan/corridor-traces";
import { buildCorridorMask } from "../lib/scan/corridor-path";
import { CORRIDORS } from "../lib/scan/completion";
import { MINOR_CORRIDORS } from "../lib/scan/corridors-minor";
import type { CorridorShape } from "../lib/scan/corridor-path";
import type { ClassifiedTrace, LineExtraction, TraceSet } from "../lib/scan/lines";

let assertions = 0;
const ok = (condition: boolean, message: string): void => {
  assert.ok(condition, message);
  assertions += 1;
};

const S = 128;
const PLANE = S * S;

function drawCorridor(field: Float32Array, corridor: CorridorShape, value: number): void {
  const { centreline } = buildCorridorMask(corridor, S);
  for (const c of centreline) {
    const cx = Math.round(c.x);
    const cy = Math.round(c.y);
    for (let dy = -1; dy <= 1; dy += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        const px = cx + dx;
        const py = cy + dy;
        if (px >= 0 && px < S && py >= 0 && py < S) field[py * S + px] = value;
      }
    }
  }
}

/** Minimal LineExtraction view — corridorTraces reads ONLY completion.lines.fate. */
const foundWith = (fate: boolean): LineExtraction =>
  ({ completion: { lines: fate ? { fate: { points: [] } } : {} } }) as unknown as LineExtraction;

const emptyTraces: TraceSet = { traces: [], strongCount: 0, faintCount: 0 };
const qualifyingTrace = (cls: ClassifiedTrace["class"]): ClassifiedTrace => ({
  points: [
    { x: 60, y: 20 },
    { x: 62, y: 60 },
  ],
  tier: "strong",
  depth: 0.6,
  class: cls,
  classScore: 0.7,
});

const fieldWithFate = (): Float32Array => {
  const field = new Float32Array(PLANE).fill(0.02);
  drawCorridor(field, CORRIDORS.fate, 0.6);
  return field;
};

/* ------------------------------ 1. Fill-in only ------------------------------ */

{
  // Fate present in `found` ⇒ NO fate search, even over a field that would accept one.
  const attempts: CorridorAttempt[] = [];
  const traces = corridorTraces(fieldWithFate(), S, foundWith(true), emptyTraces, attempts);
  ok(!traces.some((t) => t.class === "fate"), "fate present in found ⇒ no corridor fate");
  ok(!attempts.some((a) => a.cls === "fate"), "…and the fate search never even RAN");

  // Fate missing ⇒ searched and (on this field) found, tagged and scored by the field.
  const found = corridorTraces(fieldWithFate(), S, foundWith(false), emptyTraces);
  const fate = found.find((t) => t.class === "fate");
  ok(fate !== undefined, "fate missing ⇒ the corridor fills it in");
  ok(fate?.source === "corridor" && fate.tier === "strong", "tagged source:corridor, tier strong");
  ok(fate !== undefined && Math.abs(fate.classScore - 0.6) < 0.15, `classScore is the path's mean field (${fate?.classScore.toFixed(3)})`);
}

{
  // A qualifying classifier sun trace ⇒ no sun search; without it, the corridor may fill in.
  const field = new Float32Array(PLANE).fill(0.02);
  drawCorridor(field, MINOR_CORRIDORS.sun, 0.6);
  const withSun: TraceSet = { traces: [qualifyingTrace("sun")], strongCount: 1, faintCount: 0 };
  const attempts: CorridorAttempt[] = [];
  const none = corridorTraces(field, S, foundWith(true), withSun, attempts);
  ok(!none.some((t) => t.class === "sun"), "an emitted sun blocks the sun search");
  ok(!attempts.some((a) => a.cls === "sun"), "…which never ran");
  const filled = corridorTraces(field, S, foundWith(true), emptyTraces);
  ok(filled.some((t) => t.class === "sun" && t.source === "corridor"), "no emitted sun ⇒ corridor sun fill-in");
}

/* --------------------- 2. Fate features: exactly faint --------------------- */

{
  const traces = corridorTraces(fieldWithFate(), S, foundWith(false), emptyTraces);
  const features = corridorFateFeatures(traces) as { lines?: { fate?: Record<string, unknown> } };
  assert.deepEqual(features, { lines: { fate: { present: true, structure: "faint" } } });
  assertions += 1;
  ok(Object.keys(features.lines?.fate ?? {}).length === 2, "presence + faint structure and NOTHING else");
  assert.deepEqual(corridorFateFeatures([]), {}, "no corridor fate ⇒ no features");
  assertions += 1;
}

console.log(`CORRIDOR TRACES ASSERTIONS PASSED (${assertions})`);
