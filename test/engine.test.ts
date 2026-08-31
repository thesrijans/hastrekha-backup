import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import {
  evaluateRules,
  kbFeatureKeys,
  mergeKnowledgeBases,
  resolveBirthWindows,
  templateNarration,
  type FeatureBag,
} from "../lib/hastrekha";

const KB_PATH = process.env.KB_PATH ?? "data/kb/batches/hastrekha_kb_sprint1_batch5b_mounts.json";
const doc: unknown = JSON.parse(readFileSync(KB_PATH, "utf8"));
const kb = mergeKnowledgeBases([doc], "test");
assert.equal(kb.rules.length, kb.meta.rule_count);
assert.ok(kb.meta.mount_birth_windows, "birth window table present");

/* DOB resolver */
const table = kb.meta.mount_birth_windows;
const jan25 = resolveBirthWindows("1994-01-25", table).map((hit) => `${hit.window.window_id}:${hit.kind}`);
assert.deepEqual(jan25.sort(), ["MOON_NEG:core", "SAT_NEG:core", "SAT_POS:minor", "SUN_NEG:core"].sort());
const dec31 = resolveBirthWindows("2000-12-31", table).map((hit) => hit.window.window_id);
assert.ok(dec31.includes("SAT_POS"), "year wrap works");
assert.deepEqual(resolveBirthWindows("garbage", table), []);

/* Full-feature evaluation */
const bag: FeatureBag = {
  mounts: { jupiter: 0.8, saturn: 0.5, sun: 0.9, mercury: 0.4, moon: 0.75, venus: 0.7, mars_inner: 0.6, mars_outer: 0.3 },
  lines: { head: { quality: "good" } },
  hand: { overall_quality: "good" },
  user: { birth_date: "1994-03-25" },
};
const full = evaluateRules(kb, bag, { now: "2026-08-21T00:00:00Z" });
assert.ok(full.fired.length > 10, `fired ${full.fired.length}`);
assert.ok(full.fired.every((f) => f.effectiveWeight > 0 && f.effectiveWeight <= 1));
assert.ok(full.highlights.length > 0 && full.highlights.length <= 5);
assert.ok(full.birthWindows.includes("MARS_POS") && full.birthWindows.includes("JUP_NEG"));
assert.ok(full.clusters[0].score >= full.clusters[full.clusters.length - 1].score, "clusters sorted");
const ids = new Set(full.fired.map((f) => f.rule.rule_id));
assert.equal(ids.size, full.fired.length, "no duplicate fired rules");

/* DOB-only evaluation (no palm yet) — positive rules relax, negatives fire */
const dobOnly = evaluateRules(kb, { user: { birth_date: "1990-07-30" } }, { now: "2026-08-21T00:00:00Z" });
assert.ok(dobOnly.fired.some((f) => f.reasons.includes("dob_only_relaxed")), "relaxation applied");
assert.ok(dobOnly.coverage.ratio < full.coverage.ratio, "coverage lower without palm");
assert.ok(dobOnly.confidence < full.confidence, "confidence lower without palm");
const strict = evaluateRules(kb, { user: { birth_date: "1990-07-30" } }, { relaxMissingMounts: false });
assert.ok(strict.fired.length < dobOnly.fired.length, "strict mode fires fewer");

/* Negative-window ambiguity: Jan 25 matches SAT_NEG + SUN_NEG + MOON_NEG */
const ambiguous = evaluateRules(kb, { user: { birth_date: "1994-01-25" } });
assert.ok(ambiguous.fired.some((f) => f.reasons.includes("neg_window_ambiguous")), "ambiguity multiplier applied");
const disamb = evaluateRules(kb, { user: { birth_date: "1994-01-25" }, mounts: { saturn: 0.9, sun: 0.3, moon: 0.3 } });
const satRule = disamb.fired.find((f) => f.rule.conditions.some((c) => c.feature === "user.birth_window" && c.value === "SAT_NEG"));
assert.ok(satRule && !satRule.reasons.includes("neg_window_ambiguous"), "preferred window keeps full weight");

/* Safety toggle */
const free = evaluateRules(kb, bag, { includeSensitive: false });
assert.ok(free.safety.suppressedSensitive > 0 && free.fired.every((f) => f.rule.safety_class === "standard"));

/* Category filter */
const careerOnly = evaluateRules(kb, bag, { categories: ["career"] });
assert.ok(careerOnly.fired.every((f) => f.rule.category === "career"));

/* Template narration — every section cites fired rules, no Devanagari */
const narration = templateNarration(full, "premium");
assert.ok(narration.sections.length > 0 && narration.sections.every((s) => s.rule_ids.length > 0));
assert.ok(!/[\u0900-\u097F]/.test(JSON.stringify(narration)));

console.log("features in KB:", kbFeatureKeys(kb).length);
console.log("full: fired", full.fired.length, "clusters", full.clusters.length, "confidence", full.confidence, "coverage", full.coverage.ratio.toFixed(2));
console.log("dob-only: fired", dobOnly.fired.length, "confidence", dobOnly.confidence);
console.log("top highlight:", full.highlights[0]?.rule.rule_id, "-", full.highlights[0]?.rule.interpretation_hi_en.slice(0, 90));
console.log("template one-liner:", narration.one_liner.slice(0, 120));
console.log("ALL ASSERTIONS PASSED");

/* ---- merged KB (548 rules) ---- */
const mergedDoc: unknown = JSON.parse(readFileSync("data/kb/hastrekha_kb.json", "utf8"));
const merged = mergeKnowledgeBases([mergedDoc], "merged-test");
assert.equal(merged.rules.length, 548);
const rich = evaluateRules(merged, {
  user: { birth_date: "1994-03-25" },
  hand: { shape: "conic", overall_quality: 0.7 },
  thumb: { present: true, clubbed: false, joint_top: "supple" },
  lines: { head: { quality: 0.7, origin: "separated_narrow", termination: "gentle_slope_luna" }, heart: { present: true, origin: "jupiter" }, travel: { present: true }, sun: { present: true } },
  signs: { island: { locations: ["head"] }, star: { locations: ["jupiter"] } },
  mounts: { jupiter: 0.8, sun: 0.9, venus: 0.7 },
});
assert.ok(rich.fired.length > 15, `merged fired ${rich.fired.length}`);
assert.ok(rich.fired.some((f) => f.rule.rule_id === "PALM-TIME-008"), "birth_day_of_month derived (25 → 7/16/25 group)");
assert.ok(rich.fired.some((f) => f.rule.rule_id === "PALM-TRVL-001"), "exists op fires on lines.travel.present");
assert.ok(rich.fired.some((f) => f.rule.rule_id === "PALM-THUMB-001"), "exists op on thumb.present");
assert.ok(!rich.fired.some((f) => f.rule.rule_id === "PALM-MARK-007"), "exists false when signs.circle missing");
const byPrefix = new Map<string, number>();
rich.fired.forEach((f) => { const p = f.rule.rule_id.split("-")[1]; byPrefix.set(p, (byPrefix.get(p) ?? 0) + 1); });
console.log("merged: fired", rich.fired.length, "confidence", rich.confidence, "prefixes", [...byPrefix.keys()].join(","));
console.log("MERGED KB ASSERTIONS PASSED");
