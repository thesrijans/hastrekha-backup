/* ============================================================================
 * MINOR LINES — classifier traces → KB features (flag emitMinorLines)
 *
 * Synthetic TraceSets with exact control over class / score / depth / tier, so
 * every gate is tested in isolation. The load-bearing assertion is the last
 * one: EVERY key this module can emit is parsed out of the real KB's condition
 * set — the test that stops the next silent spelling mismatch.
 * ========================================================================== */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  HEALTH_CROSSING_BAND,
  MARRIAGE_CLEAR_DEPTH,
  MINOR_EMIT_MIN_DEPTH,
  MINOR_EMIT_MIN_SCORE,
  fateDoubleOverride,
  minorLineFeatures,
} from "../lib/scan/minor-lines";
import type { ClassifiedTrace, TraceSet } from "../lib/scan/lines";
import type { TraceClass } from "../lib/scan/classify";
import { DEFAULT_SCAN_FLAGS } from "../lib/scan/flags";

let assertions = 0;
const ok = (condition: boolean, message: string): void => {
  assert.ok(condition, message);
  assertions += 1;
};

const SIZE = 128;

function trace(
  cls: TraceClass,
  overrides: Partial<ClassifiedTrace> = {},
): ClassifiedTrace {
  return {
    points: [
      { x: 60, y: 20 },
      { x: 62, y: 60 },
      { x: 64, y: 100 },
    ],
    tier: "strong",
    depth: 0.6,
    class: cls,
    classScore: 0.7,
    ...overrides,
  };
}

const set = (...traces: ClassifiedTrace[]): TraceSet => ({
  traces,
  strongCount: traces.filter((t) => t.tier === "strong").length,
  faintCount: traces.filter((t) => t.tier === "faint").length,
});

const flat = (bag: Record<string, unknown>, prefix = ""): Record<string, unknown> => {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(bag)) {
    const at = prefix === "" ? key : `${prefix}.${key}`;
    if (typeof value === "object" && value !== null && !Array.isArray(value)) Object.assign(out, flat(value as Record<string, unknown>, at));
    else out[at] = value;
  }
  return out;
};

/* ------------------------------- 1. Correct keys ------------------------------- */

{
  const bag = flat(
    minorLineFeatures(
      set(
        trace("sun"),
        trace("health"),
        trace("marriage", { depth: 0.8 }),
        trace("bracelets"),
        trace("girdle_of_venus"),
      ),
      {},
      SIZE,
    ),
  );
  ok(bag["lines.sun.present"] === true, "sun → lines.sun.present");
  ok(bag["lines.health.form"] === "straight_free", "straight health → lines.health.form straight_free");
  ok(bag["lines.marriage.presence"] === "clear_deep", `deep marriage → clear_deep (band ${MARRIAGE_CLEAR_DEPTH})`);
  ok(bag["signs.bracelets.count"] === 1, "bracelet → signs.bracelets.count 1");
  ok(bag["signs.girdle_of_venus.present"] === true, "girdle → the KB's signs key, not lines.girdle");
  ok(!("lines.marriage.marks" in bag), "marriage.marks is NOT emitted");
  ok(!("lines.sun.form" in bag) && !("lines.marriage.count" in bag), "non-KB keys from the step spec are NOT emitted");
}

/* ------------------------ 2. Each gate blocks independently ------------------------ */

{
  const lowScore = flat(minorLineFeatures(set(trace("sun", { classScore: MINOR_EMIT_MIN_SCORE - 0.01 })), {}, SIZE));
  ok(!("lines.sun.present" in lowScore), "classScore below the floor blocks emission");
  const lowDepth = flat(minorLineFeatures(set(trace("sun", { depth: MINOR_EMIT_MIN_DEPTH - 0.01 })), {}, SIZE));
  ok(!("lines.sun.present" in lowDepth), "depth below the floor blocks emission");
  const faint = flat(minorLineFeatures(set(trace("sun", { tier: "faint" })), {}, SIZE));
  ok(!("lines.sun.present" in faint), "faint-tier traces never fire rules");
}

/* ---------------- 3. bracelets count 0 explicit; marriage silent when none ---------------- */

{
  const empty = flat(minorLineFeatures(set(), {}, SIZE));
  ok(empty["signs.bracelets.count"] === 0, "bracelets.count 0 is emitted explicitly — gte-only, absence is data");
  ok(!("lines.marriage.presence" in empty), "no qualifying marriage trace ⇒ no presence key (the KB has no absent value for it)");
  ok(!("lines.sun.present" in empty), "no sun trace ⇒ no sun key");
}

/* ------------------------- 4. crossing_to_life needs lifePoly ------------------------- */

{
  const health = trace("health", { points: [{ x: 40, y: 40 }, { x: 42, y: 70 }, { x: 44, y: 100 }] });
  const lifeNear = [{ x: 44 + HEALTH_CROSSING_BAND * SIZE - 1, y: 100 }, { x: 50, y: 110 }];
  const withLife = flat(minorLineFeatures(set(health), { lifePoly: lifeNear }, SIZE));
  ok(withLife["lines.health.form"] === "crossing_to_life", "near the life poly → crossing_to_life");
  const without = flat(minorLineFeatures(set(health), {}, SIZE));
  ok(without["lines.health.form"] === "straight_free", "without lifePoly the crossing value is never emitted");
  const wavy = trace("health", {
    points: Array.from({ length: 12 }, (_, i) => ({ x: 40 + (i % 2 === 0 ? 6 : -6), y: 30 + i * 6 })),
  });
  ok(!("lines.health.form" in flat(minorLineFeatures(set(wavy), {}, SIZE))), "a wavy health trace emits no form — the KB has no value for it");
}

/* ------------------------------ 5. fate double ------------------------------ */

{
  ok(
    fateDoubleOverride(set(trace("fate"), trace("minor_unclassified", { demotedFrom: "fate" }))),
    "principal fate + demoted fate ⇒ double",
  );
  ok(!fateDoubleOverride(set(trace("fate"))), "a single fate is not double");
  ok(
    !fateDoubleOverride(set(trace("fate"), trace("minor_unclassified", { demotedFrom: "fate", tier: "faint" }))),
    "a faint demoted twin does not count",
  );
}

/* --------------------- 6. every emitted key exists in the KB --------------------- */

{
  const kb = JSON.parse(readFileSync("data/kb/hastrekha_kb.json", "utf8")) as {
    rules: { conditions: { feature: string }[] }[];
  };
  const kbKeys = new Set(kb.rules.flatMap((rule) => rule.conditions.map((c) => c.feature)));
  // A TraceSet that lights up every emission branch at once.
  const everything = flat(
    minorLineFeatures(
      set(
        trace("sun"),
        trace("health"),
        trace("marriage", { depth: 0.5 }),
        trace("bracelets"),
        trace("bracelets", { points: [{ x: 30, y: 120 }, { x: 90, y: 121 }] }),
        trace("girdle_of_venus"),
      ),
      { lifePoly: [{ x: 60, y: 100 }, { x: 66, y: 110 }] },
      SIZE,
    ),
  );
  ok(Object.keys(everything).length >= 5, `the full-emission bag has every class (${Object.keys(everything).length} keys)`);
  for (const key of Object.keys(everything)) {
    ok(kbKeys.has(key), `emitted key "${key}" exists in the KB's condition-key set`);
  }
}

/* --------------------------------- 7. flags --------------------------------- */

ok(DEFAULT_SCAN_FLAGS.emitMinorLines === false, "emitMinorLines defaults OFF");
ok(DEFAULT_SCAN_FLAGS.featureVocabV2 === false, "featureVocabV2 defaults OFF");

console.log(`MINOR LINES ASSERTIONS PASSED (${assertions})`);
