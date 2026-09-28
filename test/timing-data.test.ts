/* ============================================================================
 * TIMING DATA — data/timing/ (Kaal-rekha) against its sources and the KB
 *
 * The timing data is generated in the lab (hastrekha-lab timing/) and quotes
 * four public-domain books. The failure it can have is a date with no source:
 * a scale anchored to nothing measurable, a rule whose quote is not in the
 * book, a meaning that states an age. This suite pins, against the committed
 * files:
 *
 *  1. The data loads and is internally consistent: every author x line has an
 *     entry; every anchored scale has >= 2 anchors, strictly increasing ages,
 *     references in the grammar lib/timing resolves, and resolved in reading
 *     order on the canonical hand; every rule is dated by at least one
 *     anchored scale on the line it is read on; meanings never carry a digit.
 *  2. Every citation — every scale's and every rule's quote — is LOCATABLE in
 *     the source text: found on its cited pages of data/timing/source-pages.json
 *     within 10% character edits (OCR noise), each page's text hashing to the
 *     sha256 the lab recorded. The distance computed here must equal the one the
 *     lab computed, so the two matchers cannot drift apart.
 *  3. The data agrees with the KB: same KB version, every kbRuleIds entry exists.
 *  4. Only lib/timing/timing-data.ts imports data/timing/*.json, and nothing
 *     imports source-pages.json (test data only).
 *  5. The loader refuses corrupted copies, passed in as documents.
 * ========================================================================== */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { loadKnowledgeBase, type KnowledgeBase } from "../lib/hastrekha";
import {
  TIMED_LINE_IDS,
  TIMING_SOURCE_KEYS,
  TimingValidationError,
  loadTimingData,
  locateQuote,
  parseTimingData,
  parseTimingRef,
  validateTimingAgainstKb,
  type TimingCitation,
} from "../lib/timing/timing-data";

let assertions = 0;
const ok = (condition: boolean, message: string): void => {
  assert.ok(condition, message);
  assertions += 1;
};

const ROOT = path.resolve(__dirname, "..");
const KB: KnowledgeBase = loadKnowledgeBase(JSON.parse(readFileSync("data/kb/hastrekha_kb.json", "utf8")));
const rawScales = (): Record<string, unknown> => JSON.parse(readFileSync("data/timing/scales.json", "utf8")) as Record<string, unknown>;
const rawRules = (): Record<string, unknown> => JSON.parse(readFileSync("data/timing/rules.json", "utf8")) as Record<string, unknown>;

interface SourcePages {
  readonly sources: Record<string, { readonly pages: Record<string, { readonly text: string; readonly sha256: string }> }>;
}

function main(): void {
  /* ----------------------------- 1. structure ----------------------------- */

  const data = loadTimingData();
  ok(data.timingVersion === "1.0", `timing version ${data.timingVersion}`);
  const cells = new Set(data.scales.map((s) => `${s.source}|${s.line}`));
  for (const source of TIMING_SOURCE_KEYS) for (const line of TIMED_LINE_IDS) ok(cells.has(`${source}|${line}`), `${source} x ${line} has an entry`);
  const anchored = data.scales.filter((s) => s.status === "anchored");
  ok(anchored.length >= 10, `${anchored.length} anchored scales`);
  for (const s of anchored) {
    ok(s.anchors.length >= 2, `${s.id}: at least two anchors`);
    ok(s.anchors.every((a, i) => i === 0 || a.age > s.anchors[i - 1].age), `${s.id}: ages strictly increasing`);
    ok(s.anchors.every((a) => parseTimingRef(a.ref) !== null), `${s.id}: every anchor reference is in the grammar`);
    ok(s.canonical.u.every((u, i) => i === 0 || u > s.canonical.u[i - 1]), `${s.id}: anchors in reading order on the canonical hand`);
  }
  for (const line of TIMED_LINE_IDS) {
    const rules = data.rulesByLine.get(line) ?? [];
    for (const r of rules) {
      ok(r.scaleRefs.length > 0 && r.scaleRefs.every((id) => data.scaleById.get(id)?.status === "anchored"), `${r.id}: dated by anchored scales`);
      ok(!/[0-9०-९]/.test(r.meaning_hi + r.meaning_en), `${r.id}: no digit in either meaning`);
    }
  }
  ok(data.rules.length >= 100, `${data.rules.length} timed rules`);

  /* ------------------------ 2. every citation located ------------------------ */

  const pages = JSON.parse(readFileSync("data/timing/source-pages.json", "utf8")) as SourcePages;
  for (const [key, src] of Object.entries(pages.sources)) {
    for (const [label, page] of Object.entries(src.pages)) {
      ok(createHash("sha256").update(page.text, "utf8").digest("hex") === page.sha256, `${key} p.${label}: page text hashes as the lab recorded`);
    }
  }
  const citations: Array<{ readonly id: string; readonly citation: TimingCitation }> = [];
  for (const s of data.scales) if (s.status !== "none") citations.push({ id: s.id, citation: s.citation });
  for (const r of data.rules) citations.push({ id: r.id, citation: r.citation });
  let located = 0;
  for (const { id, citation } of citations) {
    const src = pages.sources[citation.source];
    const texts = citation.pages.map((p) => src?.pages[p]?.text);
    ok(texts.every((t) => typeof t === "string"), `${id}: every cited page (${citation.pages.join(", ")}) is in source-pages.json`);
    const result = locateQuote(texts as string[], citation.quote);
    ok(result.ok, `${id}: quote located on ${citation.source} p.${citation.pages.join("-")} (${result.distance} edits, budget ${result.budget})`);
    if (citation.quoteEdits !== undefined) ok(result.distance === citation.quoteEdits, `${id}: this matcher and the lab's agree (${result.distance} vs ${citation.quoteEdits})`);
    located += 1;
  }

  /* ------------------------------- 3. the KB ------------------------------- */

  validateTimingAgainstKb(KB, data);
  ok(true, "timing data agrees with the KB");

  /* -------------------- 4. only the loader imports the data -------------------- */

  const LOADER = path.join(ROOT, "lib", "timing", "timing-data.ts");
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((entry) => {
      const full = path.join(dir, entry);
      if (entry === "node_modules" || entry === "generated") return [];
      return statSync(full).isDirectory() ? walk(full) : /\.(ts|tsx|mts|js|mjs)$/.test(entry) ? [full] : [];
    });
  const sources = ["app", "components", "lib"].flatMap((dir) => walk(path.join(ROOT, dir)));
  const ANY_TIMING = /["'][^"']*data\/timing\/[^"']*["']/;
  const PAGES = /["'][^"']*data\/timing\/source-pages\.json["']/;
  for (const file of sources) {
    const text = readFileSync(file, "utf8");
    const rel = path.relative(ROOT, file);
    ok(!PAGES.test(text), `${rel}: nothing imports source-pages.json`);
    if (file !== LOADER) ok(!ANY_TIMING.test(text), `${rel}: only the timing loader touches data/timing`);
  }

  /* --------------------------- 5. corrupted copies --------------------------- */

  const refuses = (run: () => unknown, fragment: string, label: string): void => {
    let thrown: unknown = null;
    try {
      run();
    } catch (error) {
      thrown = error;
    }
    ok(thrown instanceof TimingValidationError && thrown.problems.some((p) => p.includes(fragment)), label);
  };
  {
    const doc = rawScales();
    const s = (doc.scales as Array<{ status: string; anchors?: Array<{ age: number }> }>).find((x) => x.status === "anchored")!;
    s.anchors![1].age = s.anchors![0].age - 1;
    refuses(() => parseTimingData(doc, rawRules()), "not strictly increasing", "a scale whose ages go backwards is refused");
  }
  {
    const doc = rawScales();
    const s = (doc.scales as Array<{ status: string; anchors?: Array<{ ref: string }> }>).find((x) => x.status === "anchored")!;
    s.anchors![0].ref = "about a third of the way";
    refuses(() => parseTimingData(doc, rawRules()), "about a third of the way", "an anchor that names nothing measurable is refused");
  }
  {
    const doc = rawScales();
    (doc.scales as unknown[]).pop();
    refuses(() => parseTimingData(doc, rawRules()), "no entry", "a missing author x line is refused");
  }
  {
    const doc = rawRules();
    (doc.rules as Array<{ scaleRefs: string[] }>)[0].scaleRefs = ["S.nobody.life"];
    refuses(() => parseTimingData(rawScales(), doc), "is not an anchored scale", "a rule dated by a scale that does not exist is refused");
  }
  {
    const doc = rawRules();
    (doc.rules as Array<{ meaning_en: string }>)[0].meaning_en = "Marriage at twenty-eight, certainly 28.";
    refuses(() => parseTimingData(rawScales(), doc), "meaning_en", "a meaning that states an age is refused");
  }
  {
    const rule = loadTimingData().rules[0];
    const src = pages.sources[rule.citation.source];
    const texts = rule.citation.pages.map((p) => src.pages[p].text);
    ok(!locateQuote(texts, "The seventh son of a seventh son will marry a princess in his forty-second year, as every palmist knows.").ok, "a quote that is not in the book is not located");
  }
  refuses(() => validateTimingAgainstKb({ ...KB, meta: { ...KB.meta, kb_version: "0.0.0" } }, data), "kb version mismatch", "timing data checked against another KB is refused");

  const byStatus = ["anchored", "unanchorable", "none"].map((st) => `${data.scales.filter((s) => s.status === st).length} ${st}`).join(", ");
  console.log(`  scales: ${byStatus}; ${data.rules.length} timed rules; ${located} citations located in ${Object.keys(pages.sources).length} sources; ${sources.length} source files scanned for imports`);
  console.log(`TIMING DATA ASSERTIONS PASSED (${assertions})`);
}

main();
