/* eslint-disable @typescript-eslint/no-explicit-any -- the committed JSON is read raw and corrupted on purpose here; the parser under test is what types it (as the lab wrote this test) */
/* ============================================================================
 * JYOTISH DATA — data/jyotish/ and data/concordance.json against their sources
 *
 * The life-question rules are generated in the lab (hastrekha-lab jyotish/) from
 * classical texts. The failures they can have: a condition the engine cannot
 * evaluate, a citation that points at no verse, a rule that should have been
 * blocked, a concordance that names a palm rule that does not exist. This suite
 * pins, against the committed files:
 *
 *  1. Every rule's condition PARSES under the grammar, and its `requires` is
 *     exactly the birth data the condition needs.
 *  2. Every citation — each rule's, and each derivation step's — RESOLVES to a
 *     chapter and verse of its citing edition in data/jyotish/verse-index.json.
 *  3. Safety: no rule is blocked; no statement carries blocked wording, a zero
 *     count of children, or money advice; review rules say why; no age under 18;
 *     children rules never promise or deny.
 *  4. Derived rules are labelled and carry two or more cited steps; classical
 *     rules carry none.
 *  5. The spec's minimum coverage is present, question by question.
 *  6. The concordance lists exactly the rules of each question, files each
 *     chart rule under how it is read, and names only palm rules, atlas
 *     variations and timed rules that exist.
 *  7. No transcribed Sanskrit is shipped: the verse index carries ids only and
 *     no rule carries a quote.
 *  8. The loader refuses corrupted copies.
 *
 * Runs in the app (`tsx test/jyotish-data.test.ts`, data under ./data) or from
 * the lab with the app as working directory.
 * ========================================================================== */
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import {
  BIRTH_TIERS,
  JyotishValidationError,
  LIFE_QUESTIONS,
  ConditionError,
  parseConcordance,
  parseCondition,
  parseJyotishData,
  readingMode,
  resolveCitation,
  statementProblem,
  validateConcordanceAgainstPalm,
  type LifeRule,
} from "../lib/jyotish/jyotish-data";

const DATA = process.env.HASTREKHA_DATA_DIR ?? path.join(process.cwd(), "data");
// The palm datasets the concordance points into; the same directory unless a staged export is being tested.
const PALM = process.env.HASTREKHA_PALM_DATA_DIR ?? DATA;
const readJson = (...parts: string[]): any => JSON.parse(readFileSync(path.join(DATA, ...parts), "utf8"));
const readPalm = (...parts: string[]): any => JSON.parse(readFileSync(path.join(PALM, ...parts), "utf8"));

let assertions = 0;
const ok = (value: unknown, message: string): void => {
  assert.ok(value, message);
  assertions += 1;
};
const equal = (actual: unknown, expected: unknown, message: string): void => {
  assert.deepEqual(actual, expected, message);
  assertions += 1;
};
const refuses = (fn: () => unknown, pattern: RegExp, message: string): void => {
  assert.throws(fn, (error: unknown) => error instanceof JyotishValidationError && pattern.test(error.problems.join("\n")), message);
  assertions += 1;
};

const rulesDocument = readJson("jyotish", "rules.json");
const verseIndexDocument = readJson("jyotish", "verse-index.json");
const grammarDocument = readJson("jyotish", "grammar.json");
const sourcesDocument = readJson("jyotish", "sources.json");
const concordanceDocument = readJson("concordance.json");

/* 1 + 2. The loader accepts the committed data; then every rule is checked again, one assertion each. */
const data = parseJyotishData(rulesDocument, verseIndexDocument, grammarDocument);
ok(data.rules.length > 0, "rules loaded");
equal(data.rules.length, rulesDocument.counts.rules, "counts.rules");

for (const rule of data.rules) {
  const tier = parseCondition(rule.condition);
  equal(rule.requires, tier, `${rule.id}: requires matches the condition`);
  ok(tier.length <= 1 && tier.every((t) => (BIRTH_TIERS as readonly string[]).includes(t)), `${rule.id}: one tier at most`);
  const verses = resolveCitation(rule.citation, data.works);
  ok(verses !== null && verses.length >= 1, `${rule.id}: citation resolves (${rule.citation.work} ${rule.citation.chapter}.${rule.citation.verse})`);
  ok(rule.citation.edition.length > 10 && rule.citation.text.length > 3, `${rule.id}: citation names its text and edition`);
  for (const [k, step] of (rule.derivation ?? []).entries()) {
    ok(resolveCitation(step.citation, data.works) !== null, `${rule.id}: derivation[${k}] citation resolves`);
  }
}

/* 3. Safety. */
for (const rule of data.rules) {
  ok(rule.safety === "ok" || rule.safety === "review", `${rule.id}: not blocked`);
  equal(statementProblem(rule.statement_hi, rule.statement_en), null, `${rule.id}: statements pass the safety lexicon`);
  ok(rule.safety !== "review" || typeof rule.reviewReason === "string", `${rule.id}: review says why`);
  ok(rule.age === undefined || rule.age[0] >= 18, `${rule.id}: no age under eighteen`);
  ok(!("quote" in rule.citation) && !("notes" in rule), `${rule.id}: no lab-only field`);
}
ok(rulesDocument.blocked.count > 0, "the lab blocked passages, and the app is told how many");
ok(!("rules" in rulesDocument.blocked) && !("items" in rulesDocument.blocked), "the blocked list itself is not shipped");
equal(statementProblem("परंपरा में यह रोग का संकेत माना जाता है।", "The tradition reads this as a favourable sign for the partner."), 'blocked wording "रोग"', "the lexicon catches blocked Hindi");
equal(statementProblem("परंपरा में यह शुभ माना जाता है।", "The tradition reads the death of the partner here."), 'blocked wording "death"', "the lexicon catches blocked English");
ok(statementProblem("परंपरा में संतान नहीं होने का संकेत माना जाता है।", "The tradition reads a quiet period for the family here.") !== null, "a zero count of children is refused");
ok(statementProblem("परंपरा में यह समय शुभ माना जाता है।", "The tradition says to invest in this period of the year.") !== null, "money advice is refused");

/* 4. Derived rules. */
for (const rule of data.rules) {
  if (rule.kind === "derived") {
    ok(Array.isArray(rule.derivation) && rule.derivation.length >= 2, `${rule.id}: derived with a cited chain`);
    ok(rule.id.startsWith("D."), `${rule.id}: derived id`);
  } else {
    ok(rule.derivation === undefined, `${rule.id}: classical carries no derivation`);
  }
}
equal(rulesDocument.labels.derived_hi, "परंपरा से व्युत्पन्न", "the derived label the UI shows");

/* 5. Coverage: the spec's minimum, by question and by how the rule is read. */
const of = (question: string): LifeRule[] => data.byQuestion.get(question as any) ?? [];
const has = (question: string, test: (rule: LifeRule) => boolean, what: string): void => ok(of(question).some(test), `coverage: ${question} — ${what}`);
const text = (rule: LifeRule): string => JSON.stringify(rule.condition);
for (const question of LIFE_QUESTIONS) ok(of(question).length > 0, `coverage: ${question} has rules`);
has("marriage.timing", (r) => readingMode(r.condition) === "dasha" || text(r).includes('"dasha'), "a dasha rule");
has("marriage.timing", (r) => text(r).includes('"transit":"Jupiter"'), "a Jupiter transit rule");
has("marriage.spouse_nature", (r) => text(r).includes('"lordOf":7'), "the seventh lord");
has("marriage.spouse_nature", (r) => text(r).includes('"planet":"Venus"'), "Venus");
has("marriage.meeting_circumstance", (r) => r.kind === "derived", "a derived, labelled rule");
has("marriage.direction_or_place", (r) => r.kind === "derived", "a derived, labelled rule");
has("children.indications", (r) => text(r).includes('"lordOf":5') || text(r).includes('"house":5'), "the fifth house or its lord");
has("children.indications", (r) => text(r).includes('"planet":"Jupiter"'), "Jupiter");
has("wealth.sources", (r) => text(r).includes('"lordOf":2') || text(r).includes('"lordOf":11'), "the second or eleventh lord");
has("career.field", (r) => text(r).includes("10"), "the tenth house");
has("travel.foreign", (r) => text(r).includes("12") || text(r).includes("9"), "the twelfth or ninth house");
has("opportunity.period", (r) => readingMode(r.condition) === "transit", "a transit rule");
has("daily.guidance", (r) => readingMode(r.condition) === "panchang", "a panchang rule");
for (const rule of of("children.indications")) {
  ok(!/\b(will have|shall have)\b/i.test(rule.statement_en), `${rule.id}: children are indications, not promises`);
}
for (const rule of of("daily.guidance")) equal(rule.requires.length <= 1, true, `${rule.id}: a day rule needs at most the birth star`);

/* 6. Concordance. */
const concordance = parseConcordance(concordanceDocument, data);
const kb = readPalm("kb", "hastrekha_kb.json");
const timing = readPalm("timing", "rules.json");
const atlasIds = new Set<string>();
for (const file of readdirSync(path.join(PALM, "atlas", "lines"))) {
  const line = readPalm("atlas", "lines", file);
  for (const variation of line.variations) atlasIds.add(`${line.line}/${variation.id}`);
}
equal(
  validateConcordanceAgainstPalm(concordance, {
    kbVersion: kb.meta.kb_version,
    kbRuleIds: new Set(kb.rules.map((r: any) => r.rule_id)),
    timingRuleIds: new Set(timing.rules.map((r: any) => r.id)),
    atlasVariationIds: atlasIds,
  }),
  [],
  "every palm id the concordance names exists",
);
for (const question of LIFE_QUESTIONS) {
  const entry = concordance.questions[question];
  ok(entry.label_hi.length > 0 && entry.label_en.length > 0, `concordance: ${question} is labelled`);
  ok(["both", "palm_only", "chart_only", "none"].includes(entry.coverage), `concordance: ${question} states its coverage`);
}
const marriageTiming = concordance.questions["marriage.timing"];
ok(marriageTiming.palm.timingRuleIds.length > 0 && marriageTiming.chart.lifeRuleIds.length > 0, "marriage timing: marriage lines and influence lines <-> the chart's dasha and transit rules");
equal(marriageTiming.coverage, "both", "marriage timing is read by both traditions");
ok(concordance.compare.verdicts.includes("agree") && concordance.compare.verdicts.includes("disagree"), "the concordance states how palm and chart are compared");
ok(concordance.compare.rule_hi.length > 0 && concordance.compare.rule_en.length > 0, "in both languages");
// Palm-tradition LifeRules use features the palm KB knows.
const features = readPalm("kb", "hastrekha_kb.features.json").features as Record<string, unknown>;
const palmFeatures = (node: unknown, out: string[] = []): string[] => {
  if (Array.isArray(node)) node.forEach((child) => palmFeatures(child, out));
  else if (typeof node === "object" && node !== null) {
    const record = node as Record<string, unknown>;
    if (typeof record.palmFeature === "string") out.push(record.palmFeature);
    Object.values(record).forEach((child) => palmFeatures(child, out));
  }
  return out;
};
for (const rule of data.rules.filter((r) => r.tradition !== "jyotish")) {
  const used = palmFeatures(rule.condition);
  ok(used.length > 0 && used.every((feature) => feature in features), `${rule.id}: palm features exist in the KB vocabulary`);
}

/* 7. No transcribed text is shipped. */
for (const [work, entry] of Object.entries(data.works)) {
  for (const [chapter, value] of Object.entries(entry.chapters)) {
    ok(Object.keys(value).sort().join() === "title,verses" && value.verses.every((v) => typeof v === "string" && v.length <= 8), `${work} ${chapter}: ids only`);
  }
}
ok(!JSON.stringify(rulesDocument).includes('"quote"'), "no quote field anywhere in rules.json");
ok(Array.isArray(sourcesDocument.sources) && sourcesDocument.sources.every((s: any) => s.licence && s.use && s.record), "every source carries its licence, use and record");
ok(sourcesDocument.consideredNotUsed.length > 0, "the sources considered and not used are listed");

/* 8. The loader refuses corrupted copies. */
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const corrupt = (mutate: (doc: any, index: any, grammar: any) => void): (() => unknown) => {
  return () => {
    const doc = clone(rulesDocument);
    const index = clone(verseIndexDocument);
    const grammar = clone(grammarDocument);
    mutate(doc, index, grammar);
    return parseJyotishData(doc, index, grammar);
  };
};
refuses(corrupt((doc) => (doc.rules[0].condition = { lordOf: 13, inHouse: 1 })), /condition/, "a house that does not exist");
refuses(corrupt((doc) => (doc.rules[0].condition = { planet: "Pluto", inHouse: 1 })), /condition/, "a planet outside the grammar");
refuses(corrupt((doc) => (doc.rules[0].requires = ["birthTime.exact", "moonOnly"])), /requires/, "a wrong requires");
refuses(corrupt((doc) => (doc.rules[0].citation.chapter = 999)), /no chapter/, "a chapter that does not exist");
refuses(corrupt((doc) => (doc.rules[0].citation.verse = "9999")), /no verse/, "a verse that does not exist");
refuses(corrupt((doc) => (doc.rules[0].safety = "blocked")), /blocked/, "a blocked rule");
refuses(corrupt((doc) => (doc.rules[0].statement_en = "The tradition reads a long illness of the partner in this placement.")), /blocked wording/, "blocked wording");
refuses(corrupt((doc) => (doc.rules[1].id = doc.rules[0].id)), /duplicate/, "a duplicate id");
refuses(corrupt((doc) => (doc.rules[0].question = "lottery.numbers")), /question/, "an unknown question");
refuses(corrupt((doc, _index, grammar) => grammar.grahas.push("Pluto")), /grammar\.json grahas/, "a grammar that drifted from the loader");
refuses(
  corrupt((doc) => {
    const derived = doc.rules.find((r: any) => r.kind === "derived");
    delete derived.derivation;
  }),
  /derivation/,
  "a derived rule without its chain",
);
assert.throws(() => parseCondition({ lordOf: 7 }), ConditionError, "a REF without a predicate");
assert.throws(() => parseCondition({ all: [{ lordOf: 7, inHouse: 10 }] }), ConditionError, "a combinator of one");
assertions += 2;
equal(parseCondition({ lordOf: 7, inHouse: 10 }), ["birthTime.approx"], "the lagna needs an approximate time");
equal(parseCondition({ planet: "Venus", inSign: "Pisces" }), ["moonOnly"], "a planet's sign needs only the date");
equal(parseCondition({ lordOf: 7, varga: "D9", dignity: "strong" }), ["birthTime.exact"], "a divisional chart needs the exact time");
equal(parseCondition({ tithi: [2, 3], paksha: "shukla" }), [], "the panchang needs no birth data");
equal(parseCondition({ prashna: { lordOf: 7, inHouse: 1 } }), [], "a question chart needs no birth data");
equal(parseCondition({ taraBala: [2, 4, 6] }), ["moonOnly"], "tara bala needs the birth star");
refuses(
  () => {
    const bad = clone(concordanceDocument);
    bad.questions["marriage.timing"].chart.lifeRuleIds.push("J.nothing.1.1");
    return parseConcordance(bad, data);
  },
  /marriage\.timing/,
  "a concordance naming a rule that does not exist",
);

console.log(`JYOTISH DATA ASSERTIONS PASSED (${assertions})`);
