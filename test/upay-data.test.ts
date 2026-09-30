/* eslint-disable @typescript-eslint/no-explicit-any -- the committed JSON is read raw and corrupted on purpose here; the parser under test is what types it (as the lab wrote this test) */
/* ============================================================================
 * UPAY DATA — data/kb/hastrekha_upay*.json against its sources
 *
 * The remedies are generated in the lab (hastrekha-lab upay/) from public-domain
 * texts. The failures they can have: a remedy no book states, a medical or
 * guaranteed claim, a planet-tied remedy offered to someone without a chart,
 * a matcher that ranks differently from the lab's. This suite pins:
 *
 *  1. Every emitted rule has a LOCATABLE source: its quote is found on its cited
 *     pages of hastrekha_upay.source-pages.json within 10% character edits, each
 *     page hashing as the lab recorded, the distance equal to the lab's. BPHS
 *     rules resolve to a chapter and verse of data/jyotish/verse-index.json.
 *     Folk customs cite nothing, are inferred, and say so.
 *  2. Safety: nothing blocked; no medical, guaranteed, harmful or money-advice
 *     wording; gems under review with the fixed disclaimer; no fast over a day.
 *  3. Triggers use the closed vocabularies; a graha-tied remedy requires a kundli.
 *  4. matchRemedies returns exactly the lab's ranking on the parity vectors,
 *     explicit before inferred, ok before review, and never offers a graha
 *     remedy without a chart.
 *  5. The index lists every rule and only existing rules; the embedding matrix
 *     has one row per rule.
 *  6. The loader refuses corrupted copies.
 *
 * Data directory: ./data (the app) or HASTREKHA_UPAY_DIR (the lab's staged export).
 * ========================================================================== */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { UpayValidationError, locateQuote, parseUpayData, remedyTextProblem, type UpayRule } from "../lib/upay/upay-data";
import { matchRemedies, nearestRemedyIds } from "../lib/upay/upay-match";

const KB = process.env.HASTREKHA_UPAY_DIR ?? path.join(process.cwd(), "data", "kb");
const readJson = (file: string): any => JSON.parse(readFileSync(file, "utf8"));

let assertions = 0;
const ok = (value: unknown, message: string): void => {
  assert.ok(value, message);
  assertions += 1;
};
const equal = (actual: unknown, expected: unknown, message: string): void => {
  assert.deepEqual(actual, expected, message);
  assertions += 1;
};

const document = readJson(path.join(KB, "hastrekha_upay.json"));
const index = readJson(path.join(KB, "hastrekha_upay.index.json"));
const sourcePages = readJson(path.join(KB, "hastrekha_upay.source-pages.json"));
const data = parseUpayData(document);
ok(data.rules.length > 0, "rules loaded");

/* 1. Locatable sources. */
const verseIndexPath = process.env.HASTREKHA_VERSE_INDEX ?? path.join(process.cwd(), "data", "jyotish", "verse-index.json");
const verseIndex = existsSync(verseIndexPath) ? readJson(verseIndexPath) : null;
for (const rule of data.rules) {
  if (rule.tradition === "folk") {
    ok(rule.source.loc === null && rule.source.quote === undefined && rule.confidence === "inferred", `${rule.id}: a folk custom cites nothing and is inferred`);
    ok(rule.disclaimers.includes("folk") && !/lal kitab|लाल किताब/i.test(JSON.stringify(rule)), `${rule.id}: labelled folk, no book named`);
    continue;
  }
  if (rule.source.work === "bphs") {
    ok(verseIndex !== null, "the jyotish verse index is present for BPHS remedies");
    const chapter = verseIndex.works.bphs.chapters[String(rule.source.chapter)];
    const [first, last = first] = (rule.source.verse as string).split("-");
    ok(chapter && chapter.verses.includes(first) && chapter.verses.includes(last), `${rule.id}: BPHS ${rule.source.chapter}.${rule.source.verse} resolves`);
    continue;
  }
  const book = sourcePages.sources[rule.source.work];
  ok(book !== undefined, `${rule.id}: source pages for ${rule.source.work}`);
  const texts = (rule.source.pages as string[]).map((id) => {
    const page = book.pages[id];
    assert.ok(page, `${rule.id}: page ${id} missing`);
    assert.equal(createHash("sha256").update(page.text, "utf8").digest("hex"), page.sha256, `${rule.id}: page ${id} hash`);
    return page.text as string;
  });
  const located = locateQuote(rule.source.quote as string, texts);
  ok(located.located, `${rule.id}: quote located on ${rule.source.work} ${rule.source.loc} (${located.edits} edits, budget ${located.budget})`);
  equal(located.edits, rule.source.quoteEdits, `${rule.id}: same edit distance as the lab`);
  ok(typeof rule.source.year === "number" && rule.source.year < 1931 && /public domain/i.test(rule.source.licence), `${rule.id}: a public-domain source`);
}

/* 2. Safety. */
for (const rule of data.rules) {
  equal(remedyTextProblem(rule.remedy.hi, rule.remedy.en), null, `${rule.id}: text passes the safety lexicon`);
  ok(rule.safety === "ok" || rule.safety === "review", `${rule.id}: not blocked`);
  if (rule.remedy.type === "ratna") ok(rule.safety === "review" && rule.disclaimers.includes("ratna"), `${rule.id}: a gem is under review with the disclaimer`);
  if (rule.remedy.type === "vrata") ok(rule.remedy.fastDays === 0 || rule.remedy.fastDays === 1, `${rule.id}: no fast beyond a day`);
  if (rule.remedy.fastDays === 1) ok(rule.disclaimers.includes("adult_fast"), `${rule.id}: a fast carries the adult framing`);
}
ok(remedyTextProblem("ग्रंथ के अनुसार यह रत्न रोग दूर करता है।", "The text commends wearing this stone on the right hand.") !== null, "medical Hindi is refused");
ok(remedyTextProblem("ग्रंथ के अनुसार यह दान शुभ है।", "The text says this gift will certainly bring wealth to the giver.") !== null, "a promise is refused");
ok(data.disclaimers.ratna.hi.length > 0 && data.disclaimers.adult_fast.en.length > 0, "the fixed disclaimers are shipped");
ok(document.blocked.count >= 0 && !("rules" in document.blocked), "blocked passages are counted, not shipped");

/* 3. Triggers. */
for (const rule of data.rules) {
  ok(rule.trigger.problemTags.every((tag) => tag in data.problemTags), `${rule.id}: tags in the closed list`);
  equal(rule.requires === "kundli", rule.trigger.grahas.length > 0, `${rule.id}: requires kundli exactly when tied to a planet`);
  ok(Array.isArray(rule.questions), `${rule.id}: linked to life questions`);
}

/* 4. The matcher. */
const vectorsPath = process.env.HASTREKHA_UPAY_VECTORS ?? path.join(KB, "..", "..", "..", "match-vectors.json");
if (existsSync(vectorsPath)) {
  for (const vector of readJson(vectorsPath).vectors) {
    equal(matchRemedies(data.rules, vector.context), vector.expected, `matcher parity: ${JSON.stringify(vector.context)}`);
  }
}
const noChart = matchRemedies(data.rules, { problemTag: "graha_shanti", grahas: ["Saturn"], hasKundli: false, limit: 50 });
ok(noChart.every((m) => data.byId.get(m.id)!.requires !== "kundli"), "no planet-tied remedy without a chart");
const withChart = matchRemedies(data.rules, { problemTag: null, grahas: ["Saturn"], hasKundli: true, limit: 50 });
ok(withChart.length > 0 && withChart.every((m) => data.byId.get(m.id)!.trigger.grahas.includes("Saturn")), "with a chart, Saturn's remedies and only those");
for (const tag of Object.keys(data.problemTags)) {
  const matches = matchRemedies(data.rules, { problemTag: tag, hasKundli: false, limit: 200 }).map((m) => data.byId.get(m.id) as UpayRule);
  const rank = (r: UpayRule): number => (r.confidence === "explicit" ? 0 : 2) + (r.safety === "ok" ? 0 : 1);
  ok(matches.every((r, i) => i === 0 || rank(matches[i - 1]) <= rank(r)), `ranking for ${tag}: explicit before inferred, ok before review`);
}
equal(matchRemedies(data.rules, { hasKundli: false }), [], "an empty context matches nothing");

/* 5. The index. */
equal(index.ids, data.rules.map((r) => r.id), "the index lists every rule in order");
for (const [tag, ids] of Object.entries(index.byTag as Record<string, string[]>)) {
  equal(ids, data.rules.filter((r) => r.trigger.problemTags.includes(tag)).map((r) => r.id), `index.byTag.${tag}`);
}
if (index.embedding !== null) {
  const bytes = Buffer.from(index.embedding.vectors, "base64");
  equal(bytes.length, data.rules.length * index.embedding.dim, "one embedding row per rule");
  ok(/MIT/.test(index.embedding.model.licence) && typeof index.embedding.model.id === "string", "the embedding model and its licence are recorded");
  const matrix = new Int8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const self = new Float32Array(index.embedding.dim);
  for (let j = 0; j < self.length; j += 1) self[j] = matrix[j] / 127;
  equal(nearestRemedyIds(index.ids, matrix, index.embedding.dim, self, 1)[0], index.ids[0], "a rule's own vector is its nearest neighbour");
}

/* 6. Corrupted copies. */
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const refuses = (mutate: (doc: any) => void, pattern: RegExp, message: string): void => {
  const doc = clone(document);
  mutate(doc);
  assert.throws(() => parseUpayData(doc), (error: unknown) => error instanceof UpayValidationError && pattern.test(error.problems.join("\n")), message);
  assertions += 1;
};
refuses((doc) => (doc.rules[0].safety = "blocked"), /blocked/, "a blocked rule");
refuses((doc) => (doc.rules[0].trigger.problemTags = ["win_lottery"]), /problemTags/, "a tag outside the list");
refuses((doc) => (doc.rules[0].remedy.en = "The text says this practice cures every disease of the wearer."), /blocked wording/, "a medical claim");
refuses((doc) => (doc.rules[1].id = doc.rules[0].id), /duplicate/, "a duplicate id");
refuses(
  (doc) => {
    const cited = doc.rules.find((r: any) => r.tradition !== "folk" && r.source.work !== "bphs");
    delete cited.source.quote;
  },
  /quote/,
  "a cited remedy without its source line",
);
refuses(
  (doc) => {
    const tied = doc.rules.find((r: any) => r.trigger.grahas.length > 0);
    delete tied.requires;
  },
  /kundli/,
  "a planet-tied remedy not marked requires kundli",
);

console.log(`UPAY DATA ASSERTIONS PASSED (${assertions})`);
