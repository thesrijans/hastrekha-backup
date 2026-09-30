/**
 * Upay KB: remedies as the old books give them - a gift, a vow, a recitation, a gem, a way of conduct, a
 * day - each with the line of the public-domain text it comes from.
 *
 * Generated in the lab (hastrekha-lab `upay/`: acquire.py records each source's licence and fetches its text
 * layer, corpus.py cuts pages, build.py validates the authored rules, match.py is the reference matcher,
 * embed.py builds the embedding index, export.py writes):
 *
 *   data/kb/hastrekha_upay.json                UpayRules (ok + review; blocked passages never leave the lab)
 *   data/kb/hastrekha_upay.index.json          inverted index by tag / area / graha / question + embedding index
 *   data/kb/hastrekha_upay.source-pages.json   the text of every cited page - test data only, imported by nothing
 *
 * This module is PURE: it types and validates the documents it is handed and mirrors the lab's quote
 * locator, so "every emitted rule has a locatable source" can be checked in the app. upay-match.ts is the
 * matcher; upay-load.ts is the only module that imports the JSON.
 */

export const UPAY_AREAS = ["dhan", "rishte", "karm", "sehat", "swabhav"] as const;
export type UpayArea = (typeof UPAY_AREAS)[number];
export const UPAY_TRADITIONS = ["puranic", "vedic", "jyotish", "folk"] as const;
export type UpayTradition = (typeof UPAY_TRADITIONS)[number];
export const REMEDY_TYPES = ["dana", "vrata", "mantra", "ratna", "conduct", "timing", "puja"] as const;
export type RemedyType = (typeof REMEDY_TYPES)[number];
export const UPAY_GRAHAS = ["Sun", "Moon", "Mars", "Mercury", "Jupiter", "Venus", "Saturn", "Rahu", "Ketu"] as const;
export type UpayGraha = (typeof UPAY_GRAHAS)[number];
export const DISCLAIMER_KEYS = ["ratna", "purchase", "adult_fast", "folk"] as const;
export type DisclaimerKey = (typeof DISCLAIMER_KEYS)[number];

export interface UpaySource {
  work: string;
  text: string;
  /** "p. 205", "scan leaf 191", "ch. 84, v. 25"; null for a folk custom. */
  loc: string | null;
  year: number | null;
  licence: string;
  /** Page ids of the cited pages (English sources). */
  pages?: string[];
  chapter?: number;
  verse?: string;
  /** The line of the source that states the remedy (English sources; the Sanskrit quote stays in the lab). */
  quote?: string;
  quoteEdits?: number;
}

export interface UpayRule {
  id: string;
  tradition: UpayTradition;
  trigger: { areas: UpayArea[]; problemTags: string[]; palmFeatures: string[]; grahas: UpayGraha[] };
  remedy: { type: RemedyType; hi: string; en: string; duration?: string; day?: string; direction?: string; count?: number; fastDays?: number };
  source: UpaySource;
  safety: "ok" | "review";
  confidence: "explicit" | "inferred";
  /** Present on remedies tied to a planet: matched only for a reader with a birth chart. */
  requires?: "kundli";
  /** The LifeRule questions (lib/jyotish) this remedy speaks to. */
  questions: string[];
  /** Fixed texts to show with the remedy; keys of `disclaimers`. */
  disclaimers: DisclaimerKey[];
}

export interface UpayData {
  version: string;
  rules: UpayRule[];
  byId: Map<string, UpayRule>;
  problemTags: Record<string, { hi: string; en: string; areas: UpayArea[] }>;
  disclaimers: Record<DisclaimerKey, { hi: string; en: string }>;
  blockedCount: number;
}

export class UpayValidationError extends Error {
  readonly problems: string[];
  constructor(problems: string[]) {
    super(`upay data invalid (${problems.length}): ${problems.slice(0, 8).join("; ")}`);
    this.name = "UpayValidationError";
    this.problems = problems;
  }
}

/* ------------------------------ Safety lexicon ------------------------------ */

// Mirrors the lab's upay/build.py.
const MEDICAL_EN =
  /\b(cure[sd]?|curing|heal\w*|disease\w*|illness\w*|sick\w*|fever\w*|poison\w*|antidote\w*|medicin\w*|drug\w*|leprosy|diagnos\w*|treat(s|ed|ment|ing)?|ailment\w*|longevity|death|dead|dies?|dying|infertil\w*|barren\w*)\b/i;
const MEDICAL_HI = /रोग|बीमार|इलाज|उपचार|औषध|दवा|ज्वर|बुखार|(?<![ऀ-ॿ])विष(?![ऀ-ॿ])|चिकित्सा|मृत्यु|मरण|आयु बढ़|दीर्घायु|बांझ|बाँझ/;
const PROMISE_EN = /\b(guarantee\w*|surely|certainly|will definitely|without fail|never fails|assured\w*|is sure to|undoubtedly)\b/i;
const PROMISE_HI = /गारंटी|निश्चित|अवश्य ही|पक्का|अचूक|शर्तिया|निःसंदेह|निस्संदेह/;
const HARM_EN = /\b(kill\w*|sacrific\w*|slaughter\w*|destroy\w* (an |the |his |her |your )?enem\w*|ruin\w*|subjugat\w*|bewitch\w*|spell\w*)\b/i;
const HARM_HI = /बलि|वध|हत्या|शत्रु का नाश|शत्रु-नाश|वशीकरण|मारण|उच्चाटन/;
const MONEY_EN = /\b(invest\w*|lend\w*|borrow\w*|loan\w*|buy\w*|purchas\w*)\b/i;
const MONEY_HI = /निवेश|उधार|खरीद|ख़रीद/;
const DEVANAGARI = /[ऀ-ॿ]/;
const LATIN = /[A-Za-z]/;

/** Why a remedy's text may not be shown, or null. */
export function remedyTextProblem(hi: string, en: string): string | null {
  if (!DEVANAGARI.test(hi) || LATIN.test(hi)) return "remedy.hi is not Devanagari Hindi";
  if (DEVANAGARI.test(en) || en.length < 30) return "remedy.en is not an English sentence";
  for (const [text, patterns] of [
    [en, [MEDICAL_EN, PROMISE_EN, HARM_EN, MONEY_EN]],
    [hi, [MEDICAL_HI, PROMISE_HI, HARM_HI, MONEY_HI]],
  ] as const) {
    for (const pattern of patterns) {
      const hit = pattern.exec(text);
      if (hit) return `blocked wording ${JSON.stringify(hit[0])}`;
    }
  }
  return null;
}

/* ------------------------------ Quote location ------------------------------ */

const QUOTE_MAX_EDIT_RATIO = 0.1;
const QUOTE_MIN_EDITS = 3;
const HYPHEN_BREAK = /([A-Za-z0-9])[-‐‑][ \t\r]*\n[ \t\r]*([A-Za-z0-9])/g;
const RUNNING_TITLE = /language of the hand|indian palmistry|scientific hand|palmistry for all/i;

/** Lower-case letters and digits only, single spaces; words hyphenated across a line break rejoined. */
export function normaliseForMatch(text: string): string {
  return text
    .normalize("NFKC")
    .replace(/­/g, "")
    .replace(HYPHEN_BREAK, "$1$2")
    .toLowerCase()
    .replace(/ſ/g, "s")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function headerLike(line: string): boolean {
  const t = line.trim();
  if (t === "") return true;
  if (t.length > 45) return false;
  return /\d/.test(t) || t.toUpperCase() === t || RUNNING_TITLE.test(t);
}

/** Pages joined in reading order; the next page's running head and the previous page's folio are dropped. */
export function joinPages(texts: string[]): string {
  const out: string[] = [];
  texts.forEach((text, k) => {
    const lines = text.split("\n");
    if (k > 0) {
      let dropped = 0;
      while (lines.length > 0 && dropped < 2 && headerLike(lines[0])) {
        lines.shift();
        dropped += 1;
      }
    }
    if (k < texts.length - 1) {
      while (lines.length > 0) {
        const last = lines[lines.length - 1].trim();
        if (last !== "" && last.length <= 6 && /^[\divxlc .]+$/i.test(last)) lines.pop();
        else break;
      }
    }
    out.push(lines.join("\n"));
  });
  return out.join("\n");
}

/** Minimum edit distance between `needle` and any substring of `haystack`. */
export function semiGlobalDistance(needle: string, haystack: string): number {
  const n = haystack.length;
  if (needle.length === 0) return 0;
  if (n === 0) return needle.length;
  let prev = new Int32Array(n + 1);
  for (let i = 1; i <= needle.length; i += 1) {
    const cur = new Int32Array(n + 1);
    cur[0] = i;
    const ch = needle.charCodeAt(i - 1);
    for (let j = 1; j <= n; j += 1) {
      const sub = prev[j - 1] + (haystack.charCodeAt(j - 1) === ch ? 0 : 1);
      const del = prev[j] + 1;
      const ins = cur[j - 1] + 1;
      cur[j] = Math.min(sub, del, ins);
    }
    prev = cur;
  }
  let best = prev[0];
  for (let j = 1; j <= n; j += 1) if (prev[j] < best) best = prev[j];
  return best;
}

export function quoteBudget(normalisedQuote: string): number {
  return Math.max(QUOTE_MIN_EDITS, Math.floor(normalisedQuote.length * QUOTE_MAX_EDIT_RATIO));
}

/** Locates a rule's quote on its cited pages. `edits` must not exceed `budget`. */
export function locateQuote(quote: string, pageTexts: string[]): { edits: number; budget: number; located: boolean } {
  const q = normaliseForMatch(quote);
  const edits = semiGlobalDistance(q, normaliseForMatch(joinPages(pageTexts)));
  const budget = quoteBudget(q);
  return { edits, budget, located: edits <= budget };
}

/* --------------------------------- Parsing --------------------------------- */

const SUPPORTED_VERSIONS: ReadonlySet<string> = new Set(["1.0"]);

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function subset(values: unknown, allowed: readonly string[], nonEmpty: boolean): boolean {
  return Array.isArray(values) && (!nonEmpty || values.length > 0) && values.every((v) => typeof v === "string" && allowed.includes(v));
}

/**
 * Types and validates hastrekha_upay.json. Throws UpayValidationError listing every problem: a trigger
 * outside the closed vocabularies, a gem that is not under review, a planet-tied remedy not marked
 * requires "kundli", a fast longer than a day, a cited rule without its quote, blocked wording, a blocked rule.
 */
export function parseUpayData(document: unknown): UpayData {
  if (!isObject(document) || !isObject(document.vocabulary)) throw new UpayValidationError(["document must be an object with a vocabulary"]);
  const problems: string[] = [];
  const version = document.upayVersion;
  if (typeof version !== "string" || !SUPPORTED_VERSIONS.has(version)) problems.push(`unsupported upayVersion ${JSON.stringify(version)}`);
  const problemTags = (isObject(document.vocabulary.problemTags) ? document.vocabulary.problemTags : {}) as UpayData["problemTags"];
  const tagNames = Object.keys(problemTags);
  if (tagNames.length === 0) problems.push("no problem tags");
  const disclaimers = (isObject(document.disclaimers) ? document.disclaimers : {}) as UpayData["disclaimers"];
  for (const key of DISCLAIMER_KEYS) if (!isObject(disclaimers[key])) problems.push(`disclaimer ${key} missing`);

  const rawRules = Array.isArray(document.rules) ? document.rules : [];
  if (rawRules.length === 0) problems.push("no rules");
  const byId = new Map<string, UpayRule>();
  const rules: UpayRule[] = [];
  for (const raw of rawRules) {
    if (!isObject(raw) || typeof raw.id !== "string") {
      problems.push("a rule without an id");
      continue;
    }
    const id = raw.id;
    const bad = (message: string): void => void problems.push(`${id}: ${message}`);
    if (byId.has(id)) bad("duplicate id");
    if (!(UPAY_TRADITIONS as readonly unknown[]).includes(raw.tradition)) bad(`tradition ${String(raw.tradition)}`);
    const trigger = isObject(raw.trigger) ? raw.trigger : {};
    if (!subset(trigger.areas, UPAY_AREAS, true)) bad("trigger.areas");
    if (!subset(trigger.problemTags, tagNames, true)) bad("trigger.problemTags outside the closed list");
    if (!subset(trigger.grahas, UPAY_GRAHAS, false)) bad("trigger.grahas");
    if (!Array.isArray(trigger.palmFeatures)) bad("trigger.palmFeatures");
    const grahas = Array.isArray(trigger.grahas) ? trigger.grahas : [];
    if ((grahas.length > 0) !== (raw.requires === "kundli")) bad("requires 'kundli' exactly when a graha is in the trigger");
    const remedy = isObject(raw.remedy) ? raw.remedy : {};
    if (!(REMEDY_TYPES as readonly unknown[]).includes(remedy.type)) bad(`remedy.type ${String(remedy.type)}`);
    if (typeof remedy.hi !== "string" || typeof remedy.en !== "string") bad("remedy text missing");
    else {
      const problem = remedyTextProblem(remedy.hi, remedy.en);
      if (problem) bad(problem);
    }
    if (remedy.type === "vrata" && remedy.fastDays !== 0 && remedy.fastDays !== 1) bad("a vrata fasts for at most one day");
    if (raw.safety !== "ok" && raw.safety !== "review") bad(`safety ${String(raw.safety)} (a blocked rule must never be exported)`);
    if (remedy.type === "ratna" && raw.safety !== "review") bad("a gem must be under review");
    if (raw.confidence !== "explicit" && raw.confidence !== "inferred") bad("confidence");
    const listed = Array.isArray(raw.disclaimers) ? raw.disclaimers : [];
    if (!subset(listed, DISCLAIMER_KEYS, false)) bad("disclaimers");
    if (remedy.type === "ratna" && !listed.includes("ratna")) bad("a gem carries the gem disclaimer");
    if (remedy.fastDays === 1 && !listed.includes("adult_fast")) bad("a fast carries the adult-fast disclaimer");
    const source = isObject(raw.source) ? raw.source : {};
    if (typeof source.text !== "string" || typeof source.licence !== "string" || typeof source.work !== "string") bad("source needs work, text, licence");
    if (raw.tradition === "folk") {
      if (source.loc !== null || "quote" in source || raw.confidence !== "inferred" || !listed.includes("folk")) bad("a folk custom cites nothing, is inferred and says so");
    } else if (source.work === "bphs") {
      if (typeof source.chapter !== "number" || typeof source.verse !== "string" || "quote" in source) bad("a BPHS remedy cites chapter and verse, without the Sanskrit");
    } else if (typeof source.quote !== "string" || !Array.isArray(source.pages) || source.pages.length === 0 || typeof source.loc !== "string") {
      bad("a cited remedy needs its quote, pages and location");
    }
    if (!Array.isArray(raw.questions)) bad("questions");
    const rule = raw as unknown as UpayRule;
    rules.push(rule);
    byId.set(id, rule);
  }
  const counts = isObject(document.counts) ? document.counts : {};
  if (counts.rules !== rules.length) problems.push(`counts.rules ${String(counts.rules)} != ${rules.length}`);
  const blocked = isObject(document.blocked) && typeof document.blocked.count === "number" ? document.blocked.count : -1;
  if (blocked < 0) problems.push("blocked count missing");
  if (problems.length > 0) throw new UpayValidationError(problems);
  return { version: version as string, rules, byId, problemTags, disclaimers, blockedCount: blocked };
}
