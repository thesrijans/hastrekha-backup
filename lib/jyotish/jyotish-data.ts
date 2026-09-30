/**
 * Jyotish + life-question KB: what the classical texts say about marriage, children, wealth, career,
 * travel, timing and the day, as deterministic rules over a birth chart, a day's panchang, a question
 * chart or a palm.
 *
 * Generated in the lab (hastrekha-lab `jyotish/`: acquire.py fetches the transcriptions and records their
 * licences, corpus.py cuts them into chapter and verse, build.py validates the authored rules,
 * concordance.py pairs palm and chart per question, export.py writes):
 *
 *   data/jyotish/rules.json         LifeRules: condition + our own Hindi and English paraphrase + citation
 *   data/jyotish/verse-index.json   chapter and verse NUMBERS of each citing edition (no text)
 *   data/jyotish/grammar.json       the condition vocabulary and the semantics an evaluator must follow
 *   data/jyotish/sources.json       the licence table
 *   data/concordance.json           per question: the palm rules and the chart rules that speak to it
 *
 * This module is PURE: it takes the documents as arguments, types them and refuses anything malformed.
 * It evaluates nothing - no ephemeris, no chart. `parseCondition` is the mirror of the lab's
 * jyotish/conditions.py: the same grammar, and the same derivation of the birth-data tier a condition
 * needs (`requires`), so a rule that the lab accepted and this loader accepts mean the same thing.
 *
 * jyotish-load.ts is the only module that imports the JSON files.
 */

/* ------------------------------- Vocabulary ------------------------------- */

export const LIFE_QUESTIONS = [
  "marriage.timing",
  "marriage.spouse_nature",
  "marriage.meeting_circumstance",
  "marriage.direction_or_place",
  "children.indications",
  "wealth.sources",
  "wealth.timing",
  "career.field",
  "career.timing",
  "travel.foreign",
  "property",
  "education",
  "opportunity.period",
  "daily.guidance",
] as const;
export type LifeQuestion = (typeof LIFE_QUESTIONS)[number];

export const TRADITIONS = ["jyotish", "palmistry", "samudrika"] as const;
export type Tradition = (typeof TRADITIONS)[number];
export const RULE_KINDS = ["classical", "derived"] as const;
export type RuleKind = (typeof RULE_KINDS)[number];
export const LIFE_POLARITIES = ["growth", "caution", "change", "neutral"] as const;
export type LifePolarity = (typeof LIFE_POLARITIES)[number];
/** `blocked` exists in the lab only; an exported rule is never blocked. */
export const EXPORTED_SAFETIES = ["ok", "review"] as const;
export type ExportedSafety = (typeof EXPORTED_SAFETIES)[number];
export const REVIEW_REASONS = ["separation", "debts", "enemies", "other"] as const;
export const BIRTH_TIERS = ["birthTime.exact", "birthTime.approx", "moonOnly"] as const;
export type BirthTier = (typeof BIRTH_TIERS)[number];

export const GRAHAS = ["Sun", "Moon", "Mars", "Mercury", "Jupiter", "Venus", "Saturn", "Rahu", "Ketu"] as const;
export const SIGNS = ["Aries", "Taurus", "Gemini", "Cancer", "Leo", "Virgo", "Libra", "Scorpio", "Sagittarius", "Capricorn", "Aquarius", "Pisces"] as const;
export const ORIGINS = ["lagna", "moon", "sun", "venus", "jupiter", "upapada", "arudha", "karakamsha", "horaLagna"] as const;
export const VARGAS = ["D1", "D2", "D3", "D4", "D7", "D9", "D10", "D12", "D16", "D20", "D24", "D30", "D60"] as const;
export const KARAKAS = ["atma", "amatya", "bhratri", "matri", "putra", "gnati", "dara"] as const;
export const SIGN_TYPES = ["movable", "fixed", "dual", "odd", "even", "fire", "earth", "air", "water"] as const;
export const DIGNITIES = ["exalted", "debilitated", "own", "moolatrikona", "friendly", "inimical", "combust", "retrograde", "vargottama", "strong", "weak"] as const;
export const DASHA_LEVELS = ["maha", "antar", "any"] as const;
export const TRANSIT_ORIGINS = ["lagna", "moon"] as const;
export const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;
export const NAKSHATRAS = [
  "Ashwini", "Bharani", "Krittika", "Rohini", "Mrigashira", "Ardra", "Punarvasu", "Pushya", "Ashlesha", "Magha", "PurvaPhalguni",
  "UttaraPhalguni", "Hasta", "Chitra", "Swati", "Vishakha", "Anuradha", "Jyeshtha", "Mula", "PurvaAshadha", "UttaraAshadha",
  "Shravana", "Dhanishtha", "Shatabhisha", "PurvaBhadrapada", "UttaraBhadrapada", "Revati",
] as const;
export const NAKSHATRA_GROUPS = ["dhruva", "chara", "ugra", "mishra", "kshipra", "mridu", "tikshna"] as const;
export const TITHI_GROUPS = ["nanda", "bhadra", "jaya", "rikta", "purna"] as const;
export const PAKSHAS = ["shukla", "krishna", "any"] as const;
export const YOGAS = [
  "Vishkambha", "Priti", "Ayushman", "Saubhagya", "Shobhana", "Atiganda", "Sukarma", "Dhriti", "Shula", "Ganda", "Vriddhi", "Dhruva",
  "Vyaghata", "Harshana", "Vajra", "Siddhi", "Vyatipata", "Variyan", "Parigha", "Shiva", "Siddha", "Sadhya", "Shubha", "Shukla",
  "Brahma", "Indra", "Vaidhriti",
] as const;
export const KARANAS = ["Bava", "Balava", "Kaulava", "Taitila", "Gara", "Vanija", "Vishti", "Shakuni", "Chatushpada", "Naga", "Kimstughna"] as const;
export const PALM_OPS = ["eq", "neq", "gt", "gte", "lt", "lte", "in", "exists"] as const;

const REF_KEYS = ["planet", "lordOf", "karaka", "dispositorOf", "navamsaDispositorOf"] as const;
const REF_MODIFIERS = ["from", "varga"] as const;
const PLACEMENT_PREDICATES = ["inHouse", "houseFrom", "inSign", "inSignOf", "inNavamsaOf", "signType", "dignity", "conjunct", "aspectedBy", "exchangeWith"] as const;
const HOUSE_PREDICATES = ["occupiedBy", "aspectedBy", "sign", "signOf", "signType"] as const;
const PANCHANG_KEYS = ["tithi", "tithiGroup", "weekday", "nakshatra", "nakshatraGroup", "yoga", "karana", "taraBala", "chandraBala"] as const;

/** The grammar arrays as grammar.json names them; the loader checks the file against these. */
export const GRAMMAR_VOCABULARY: Readonly<Record<string, readonly string[]>> = {
  grahas: GRAHAS,
  signs: SIGNS,
  origins: ORIGINS,
  vargas: VARGAS,
  karakas: KARAKAS,
  signTypes: SIGN_TYPES,
  dignities: DIGNITIES,
  dashaLevels: DASHA_LEVELS,
  transitOrigins: TRANSIT_ORIGINS,
  weekdays: WEEKDAYS,
  nakshatras: NAKSHATRAS,
  nakshatraGroups: NAKSHATRA_GROUPS,
  tithiGroups: TITHI_GROUPS,
  pakshas: PAKSHAS,
  yogas: YOGAS,
  karanas: KARANAS,
  palmOps: PALM_OPS,
  refKeys: REF_KEYS,
  refModifiers: REF_MODIFIERS,
  placementPredicates: PLACEMENT_PREDICATES,
  housePredicates: HOUSE_PREDICATES,
  panchangKeys: PANCHANG_KEYS,
};

/* --------------------------------- Types --------------------------------- */

/** A condition is a JSON tree in the grammar of grammar.json; `parseCondition` is its validator. */
export type LifeCondition = { readonly [key: string]: unknown };

export interface LifeCitation {
  /** The work's title. */
  text: string;
  /** The work's key in verse-index.json. */
  work: string;
  chapter: number;
  /** A verse id of the citing edition, or a range "12-13". For the English books: a printed page. */
  verse: string;
  edition: string;
}

export interface DerivationStep {
  claim_hi: string;
  claim_en: string;
  citation: LifeCitation;
}

export interface LifeRule {
  id: string;
  tradition: Tradition;
  question: LifeQuestion;
  condition: LifeCondition;
  /** The birth data the condition needs: [] (none), or one tier. */
  requires: BirthTier[];
  statement_hi: string;
  statement_en: string;
  kind: RuleKind;
  /** Present exactly when kind is "derived": the cited significations the rule is built from. */
  derivation?: DerivationStep[];
  polarity: LifePolarity;
  citation: LifeCitation;
  safety: ExportedSafety;
  reviewReason?: (typeof REVIEW_REASONS)[number];
  /** The age range, in years, the verse gives for the event. Never under 18. */
  age?: [number, number];
}

export interface VerseIndexWork {
  title: string;
  title_deva: string;
  edition: string;
  chapters: Record<string, { title: string; verses: string[] }>;
}

export interface JyotishData {
  version: string;
  rules: LifeRule[];
  byId: Map<string, LifeRule>;
  byQuestion: Map<LifeQuestion, LifeRule[]>;
  works: Record<string, VerseIndexWork>;
  labels: Record<string, string>;
  blockedCount: number;
}

export interface ConcordanceEntry {
  label_hi: string;
  label_en: string;
  palm: {
    selector: { kb: string | null; timing: string | null };
    kbRuleIds: string[];
    kbPolarity: Record<string, number>;
    atlasVariations: { line: string; id: string }[];
    timingRuleIds: string[];
    lifeRuleIds: string[];
  };
  chart: { lifeRuleIds: string[]; byReading: Record<string, string[]>; classical: number; derived: number };
  coverage: "both" | "palm_only" | "chart_only" | "none";
}

export interface Concordance {
  version: string;
  kb: { version: string; sha256: string };
  timing: { version: string; sha256: string };
  compare: { polarity: Record<string, Record<string, string>>; verdicts: string[]; rule_en: string; rule_hi: string };
  questions: Record<LifeQuestion, ConcordanceEntry>;
}

export class JyotishValidationError extends Error {
  readonly problems: string[];
  constructor(problems: string[]) {
    super(`jyotish data invalid (${problems.length}): ${problems.slice(0, 8).join("; ")}`);
    this.name = "JyotishValidationError";
    this.problems = problems;
  }
}

/* --------------------------- Condition grammar --------------------------- */

export class ConditionError extends Error {}

interface Needs {
  exact: boolean;
  lagna: boolean;
  birth: boolean;
  prashnaDepth: number;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function oneOf(value: unknown, allowed: readonly string[], what: string): void {
  if (typeof value !== "string" || !allowed.includes(value)) {
    throw new ConditionError(`${what}: ${JSON.stringify(value)} is not one of ${allowed.join(", ")}`);
  }
}

function listOfNames(value: unknown, allowed: readonly string[], what: string): string[] {
  const items = Array.isArray(value) ? value : [value];
  if (items.length === 0) throw new ConditionError(`${what}: empty list`);
  for (const item of items) oneOf(item, allowed, what);
  return items as string[];
}

function listOfInts(value: unknown, lo: number, hi: number, what: string): number[] {
  const items = Array.isArray(value) ? value : [value];
  if (items.length === 0) throw new ConditionError(`${what}: empty list`);
  for (const item of items) {
    if (typeof item !== "number" || !Number.isInteger(item) || item < lo || item > hi) {
      throw new ConditionError(`${what}: ${JSON.stringify(item)} is not an integer in ${lo}..${hi}`);
    }
  }
  return items as number[];
}

function origin(value: unknown, needs: Needs, what: string): void {
  oneOf(value, ORIGINS, what);
  if (needs.prashnaDepth > 0) return;
  needs.birth = true;
  if (value === "lagna") needs.lagna = true;
  else if (value === "upapada" || value === "arudha" || value === "karakamsha" || value === "horaLagna") needs.exact = true;
}

function varga(value: unknown, needs: Needs): void {
  oneOf(value, VARGAS, "varga");
  if (value !== "D1" && needs.prashnaDepth === 0) needs.exact = true;
}

function parseRef(node: unknown, needs: Needs, what: string): void {
  if (!isObject(node)) throw new ConditionError(`${what}: expected an object`);
  const keys = Object.keys(node);
  const refKeys = keys.filter((k) => (REF_KEYS as readonly string[]).includes(k));
  if (refKeys.length !== 1) throw new ConditionError(`${what}: needs exactly one of ${REF_KEYS.join(", ")}`);
  const extra = keys.filter((k) => !(REF_KEYS as readonly string[]).includes(k) && !(REF_MODIFIERS as readonly string[]).includes(k));
  if (extra.length > 0) throw new ConditionError(`${what}: unknown keys ${extra.join(", ")}`);
  refCore(node, needs, what);
}

function refCore(node: Record<string, unknown>, needs: Needs, what: string): void {
  const natal = needs.prashnaDepth === 0;
  if (natal) needs.birth = true;
  if ("planet" in node) {
    oneOf(node.planet, GRAHAS, `${what}.planet`);
  } else if ("lordOf" in node) {
    if (Array.isArray(node.lordOf)) throw new ConditionError(`${what}.lordOf: one house, not a list`);
    listOfInts(node.lordOf, 1, 12, `${what}.lordOf`);
    origin(node.from ?? "lagna", needs, `${what}.from`);
  } else if ("karaka" in node) {
    oneOf(node.karaka, KARAKAS, `${what}.karaka`);
    if (natal) needs.exact = true;
  } else if ("dispositorOf" in node) {
    parseRef(node.dispositorOf, needs, `${what}.dispositorOf`);
  } else if ("navamsaDispositorOf" in node) {
    parseRef(node.navamsaDispositorOf, needs, `${what}.navamsaDispositorOf`);
    if (natal) needs.exact = true;
  }
  if ("from" in node && !("lordOf" in node)) throw new ConditionError(`${what}: \`from\` only qualifies lordOf`);
  if ("varga" in node) varga(node.varga, needs);
}

function parseRefSet(node: unknown, needs: Needs, what: string): void {
  if (Array.isArray(node)) {
    if (node.length === 0) throw new ConditionError(`${what}: empty list`);
    for (const item of node) parseRefSet(item, needs, what);
  } else if (typeof node === "string") {
    if (node !== "benefic" && node !== "malefic" && !(GRAHAS as readonly string[]).includes(node)) {
      throw new ConditionError(`${what}: ${JSON.stringify(node)} is not 'benefic', 'malefic' or a planet`);
    }
    if (needs.prashnaDepth === 0) needs.birth = true;
  } else {
    parseRef(node, needs, what);
  }
}

function only(keys: string[], allowed: readonly string[], what: string): void {
  const extra = keys.filter((k) => !allowed.includes(k));
  if (extra.length > 0) throw new ConditionError(`${what} with unknown keys: ${extra.join(", ")}`);
}

function walk(node: unknown, needs: Needs): void {
  if (!isObject(node) || Object.keys(node).length === 0) throw new ConditionError("expected a non-empty object");
  const keys = Object.keys(node);
  const has = (k: string): boolean => k in node;

  if (has("all") || has("any")) {
    if (keys.length !== 1) throw new ConditionError("combinator with other keys");
    const children = node[keys[0]];
    if (!Array.isArray(children) || children.length < 2) throw new ConditionError(`${keys[0]}: needs a list of two or more conditions`);
    for (const child of children) walk(child, needs);
    return;
  }
  if (has("not")) {
    if (keys.length !== 1) throw new ConditionError("not with other keys");
    walk(node.not, needs);
    return;
  }
  if (has("prashna")) {
    if (keys.length !== 1) throw new ConditionError("prashna with other keys");
    needs.prashnaDepth += 1;
    walk(node.prashna, needs);
    needs.prashnaDepth -= 1;
    return;
  }
  if (has("native")) {
    if (keys.length !== 1) throw new ConditionError("native stands alone");
    oneOf(node.native, ["female", "male"], "native");
    return;
  }
  if (has("palmRuleId") || has("timingRuleId")) {
    if (keys.length !== 1 || typeof node[keys[0]] !== "string") throw new ConditionError("palm rule reference: one string id");
    return;
  }
  if (has("palmFeature")) {
    only(keys, ["palmFeature", "op", "value"], "palmFeature");
    oneOf(node.op, PALM_OPS, "palmFeature.op");
    if (node.op !== "exists" && !has("value")) throw new ConditionError("palmFeature: value missing");
    if (typeof node.palmFeature !== "string" || !node.palmFeature.includes(".")) throw new ConditionError("palmFeature: not a feature path");
    return;
  }
  if (keys.some((k) => (PANCHANG_KEYS as readonly string[]).includes(k))) {
    only(keys, [...PANCHANG_KEYS, "paksha"], "panchang leaf");
    if (has("paksha")) {
      oneOf(node.paksha, PAKSHAS, "paksha");
      if (!has("tithi")) throw new ConditionError("paksha only qualifies tithi");
    }
    if (has("tithi")) listOfInts(node.tithi, 1, 15, "tithi");
    if (has("tithiGroup")) listOfNames(node.tithiGroup, TITHI_GROUPS, "tithiGroup");
    if (has("weekday")) listOfNames(node.weekday, WEEKDAYS, "weekday");
    if (has("nakshatra")) listOfNames(node.nakshatra, NAKSHATRAS, "nakshatra");
    if (has("nakshatraGroup")) listOfNames(node.nakshatraGroup, NAKSHATRA_GROUPS, "nakshatraGroup");
    if (has("yoga")) listOfNames(node.yoga, YOGAS, "yoga");
    if (has("karana")) listOfNames(node.karana, KARANAS, "karana");
    if (has("taraBala")) {
      listOfInts(node.taraBala, 1, 9, "taraBala");
      needs.birth = true;
    }
    if (has("chandraBala")) {
      listOfInts(node.chandraBala, 1, 12, "chandraBala");
      needs.birth = true;
    }
    return;
  }
  if (has("dashaLordOf")) {
    only(keys, ["dashaLordOf", "level"], "dashaLordOf");
    listOfInts(node.dashaLordOf, 1, 12, "dashaLordOf");
    oneOf(node.level ?? "any", DASHA_LEVELS, "level");
    needs.birth = true;
    needs.lagna = true;
    return;
  }
  if (has("dasha")) {
    only(keys, ["dasha", "level", "antar"], "dasha");
    parseRef(node.dasha, needs, "dasha");
    if (has("antar")) parseRef(node.antar, needs, "antar");
    oneOf(node.level ?? "any", DASHA_LEVELS, "level");
    needs.birth = true;
    return;
  }
  if (has("transit")) {
    oneOf(node.transit, GRAHAS, "transit");
    const modes = ["house", "overNatal", "trineTo", "sign"].filter(has);
    if (modes.length !== 1) throw new ConditionError("transit: needs exactly one of house / overNatal / trineTo / sign");
    only(keys, ["transit", "house", "overHouseFrom", "overNatal", "trineTo", "sign"], "transit");
    if (has("house")) {
      listOfInts(node.house, 1, 12, "transit.house");
      oneOf(node.overHouseFrom, TRANSIT_ORIGINS, "overHouseFrom");
      needs.birth = true;
      if (node.overHouseFrom === "lagna") needs.lagna = true;
    } else if (has("sign")) {
      listOfNames(node.sign, SIGNS, "transit.sign");
    } else {
      parseRef(node[modes[0]], needs, `transit.${modes[0]}`);
    }
    return;
  }
  if (has("house")) {
    if (typeof node.house !== "number" || !Number.isInteger(node.house) || node.house < 1 || node.house > 12) {
      throw new ConditionError("house: one integer 1..12");
    }
    if (!keys.some((k) => (HOUSE_PREDICATES as readonly string[]).includes(k))) throw new ConditionError("house: needs a predicate");
    only(keys, [...HOUSE_PREDICATES, "house", "houseFrom", "varga"], "house");
    origin(node.houseFrom ?? "lagna", needs, "houseFrom");
    if (has("varga")) varga(node.varga, needs);
    if (has("occupiedBy") && node.occupiedBy !== "none") parseRefSet(node.occupiedBy, needs, "occupiedBy");
    if (has("aspectedBy")) parseRefSet(node.aspectedBy, needs, "aspectedBy");
    if (has("sign")) listOfNames(node.sign, SIGNS, "sign");
    if (has("signOf")) listOfNames(node.signOf, GRAHAS, "signOf");
    if (has("signType")) listOfNames(node.signType, SIGN_TYPES, "signType");
    return;
  }

  // placement
  const refKeys = keys.filter((k) => (REF_KEYS as readonly string[]).includes(k));
  if (refKeys.length !== 1) throw new ConditionError(`unrecognised condition node: ${keys.join(", ")}`);
  const predicates = keys.filter((k) => (PLACEMENT_PREDICATES as readonly string[]).includes(k) && k !== "houseFrom");
  if (predicates.length === 0) throw new ConditionError("placement: a REF needs at least one predicate");
  only(keys, [...REF_KEYS, ...REF_MODIFIERS, ...PLACEMENT_PREDICATES], "placement");
  refCore(node, needs, "placement");
  if (has("inHouse")) {
    listOfInts(node.inHouse, 1, 12, "inHouse");
    origin(node.houseFrom ?? "lagna", needs, "houseFrom");
  } else if (has("houseFrom")) {
    throw new ConditionError("houseFrom only qualifies inHouse");
  }
  if (has("inSign")) listOfNames(node.inSign, SIGNS, "inSign");
  if (has("inSignOf")) listOfNames(node.inSignOf, GRAHAS, "inSignOf");
  if (has("inNavamsaOf")) {
    listOfNames(node.inNavamsaOf, GRAHAS, "inNavamsaOf");
    if (needs.prashnaDepth === 0) needs.exact = true;
  }
  if (has("signType")) listOfNames(node.signType, SIGN_TYPES, "signType");
  if (has("dignity")) {
    const items = listOfNames(node.dignity, DIGNITIES, "dignity");
    if (items.includes("vargottama") && needs.prashnaDepth === 0) needs.exact = true;
  }
  if (has("conjunct")) parseRefSet(node.conjunct, needs, "conjunct");
  if (has("aspectedBy")) parseRefSet(node.aspectedBy, needs, "aspectedBy");
  if (has("exchangeWith")) parseRef(node.exchangeWith, needs, "exchangeWith");
}

/**
 * Validates a condition against the grammar and returns the birth data it needs:
 * [] (a day's panchang, a question chart, a palm), ["moonOnly"] (planets by sign, counts from the Moon),
 * ["birthTime.approx"] (the lagna: houses, house lords), ["birthTime.exact"] (divisional charts, chara
 * karakas, special lagnas). Throws ConditionError on anything outside the grammar.
 */
export function parseCondition(condition: unknown): BirthTier[] {
  const needs: Needs = { exact: false, lagna: false, birth: false, prashnaDepth: 0 };
  walk(condition, needs);
  if (needs.exact) return ["birthTime.exact"];
  if (needs.lagna) return ["birthTime.approx"];
  if (needs.birth) return ["moonOnly"];
  return [];
}

/** How a rule is read, for grouping: the concordance's `byReading` keys. */
export function readingMode(condition: unknown): "prashna" | "palm" | "panchang" | "transit" | "dasha" | "natal" {
  const found = new Set<string>();
  const visit = (node: unknown): void => {
    if (Array.isArray(node)) {
      node.forEach(visit);
    } else if (isObject(node)) {
      if ("prashna" in node) found.add("prashna");
      if ("dasha" in node || "dashaLordOf" in node) found.add("dasha");
      if ("transit" in node) found.add("transit");
      if (Object.keys(node).some((k) => (PANCHANG_KEYS as readonly string[]).includes(k))) found.add("panchang");
      if ("palmRuleId" in node || "palmFeature" in node || "timingRuleId" in node) found.add("palm");
      Object.values(node).forEach(visit);
    }
  };
  visit(condition);
  for (const mode of ["prashna", "palm", "panchang", "transit", "dasha"] as const) if (found.has(mode)) return mode;
  return "natal";
}

/* ------------------------------ Safety lexicon ------------------------------ */

// Mirrors the lab's jyotish/build.py: no exported statement may carry these.
const BLOCKED_EN =
  /\b(death|dead|die[sd]?|dying|fatal|kill\w*|widow\w*|longevity|life ?span|short[- ]lived|long[- ]lived|disease\w*|illness\w*|sick\w*|ailment\w*|accident\w*|injur\w*|wound\w*|surgery|surgical|operation|infertil\w*|barren\w*|steril\w*|childless\w*|miscarr\w*|abortion\w*|stillb\w*|imprison\w*|jail\w*|prison\w*|curse[ds]?|cursing|suicid\w*|murder\w*|poison\w*)\b/i;
const BLOCKED_HI =
  /मृत्यु|मरण|मौत|निधन|वैधव्य|विधवा|विधुर|दीर्घायु|अल्पायु|आयुष्य|रोग|बीमार|व्याधि|दुर्घटना|चोट|घाव|शल्य|ऑपरेशन|बांझ|बाँझ|वंध्या|वन्ध्या|निःसंतान|निस्संतान|संतानहीन|गर्भपात|कारावास|जेल|क़ैद|कैद|शाप|श्राप|आत्महत्या|हत्या/;
const NO_CHILDREN = /\b(no children|no child|without children|not have children|denies? children)\b|संतान नहीं|संतान न हो|संतान का अभाव/i;
const MONEY_ADVICE_EN = /\b(invest\w*|lend\w*|borrow\w*|loan\w*|buy\w*|purchas\w*)\b/i;
const MONEY_ADVICE_HI = /निवेश|उधार|खरीद|ख़रीद/;
const DEVANAGARI = /[ऀ-ॿ]/;
const LATIN = /[A-Za-z]/;

/** The reason a statement may not be shown, or null. */
export function statementProblem(hi: string, en: string): string | null {
  if (!DEVANAGARI.test(hi) || LATIN.test(hi)) return "statement_hi is not Devanagari Hindi";
  if (DEVANAGARI.test(en) || en.length < 25) return "statement_en is not an English sentence";
  for (const [text, blocked, advice] of [
    [en, BLOCKED_EN, MONEY_ADVICE_EN],
    [hi, BLOCKED_HI, MONEY_ADVICE_HI],
  ] as const) {
    const hit = blocked.exec(text) ?? NO_CHILDREN.exec(text) ?? advice.exec(text);
    if (hit) return `blocked wording ${JSON.stringify(hit[0])}`;
  }
  return null;
}

/* --------------------------------- Parsing --------------------------------- */

const SUPPORTED_VERSIONS: ReadonlySet<string> = new Set(["1.0"]);

function citationProblem(citation: unknown, works: Record<string, VerseIndexWork>): string | null {
  if (!isObject(citation)) return "citation missing";
  const { text, work, chapter, verse, edition } = citation;
  if (typeof text !== "string" || typeof work !== "string" || typeof verse !== "string" || typeof edition !== "string" || typeof chapter !== "number") {
    return "citation needs text, work, chapter, verse, edition";
  }
  const indexed = works[work];
  if (!indexed) return `unknown work ${work}`;
  if (indexed.title !== text || indexed.edition !== edition) return `citation title/edition differ from the verse index for ${work}`;
  const chapterEntry = indexed.chapters[String(chapter)];
  if (!chapterEntry) return `${work}: no chapter ${chapter}`;
  const [first, last = first] = verse.split("-");
  const a = chapterEntry.verses.indexOf(first);
  const b = chapterEntry.verses.indexOf(last);
  if (a < 0 || b < 0) return `${work} ${chapter}: no verse ${verse}`;
  if (b < a || b - a > 7) return `${work} ${chapter}: bad verse range ${verse}`;
  return null;
}

/** Resolves a citation to the verse ids it covers, or null if it does not resolve. */
export function resolveCitation(citation: LifeCitation, works: Record<string, VerseIndexWork>): string[] | null {
  if (citationProblem(citation, works) !== null) return null;
  const verses = works[citation.work].chapters[String(citation.chapter)].verses;
  const [first, last = first] = citation.verse.split("-");
  return verses.slice(verses.indexOf(first), verses.indexOf(last) + 1);
}

function sameTier(a: unknown, b: BirthTier[]): boolean {
  return Array.isArray(a) && a.length === b.length && a.every((value, i) => value === b[i]);
}

/**
 * Types and validates rules.json + verse-index.json + grammar.json. Throws JyotishValidationError listing
 * every problem: an unparseable condition, a `requires` that is not what the condition needs, a citation
 * that does not resolve to a chapter and verse of its edition, a derived rule without cited derivation
 * steps, a statement that fails the safety lexicon, a blocked rule.
 */
export function parseJyotishData(rulesDocument: unknown, verseIndexDocument: unknown, grammarDocument: unknown): JyotishData {
  const problems: string[] = [];
  if (!isObject(rulesDocument) || !isObject(verseIndexDocument) || !isObject(grammarDocument)) {
    throw new JyotishValidationError(["documents must be objects"]);
  }
  const version = rulesDocument.jyotishVersion;
  if (typeof version !== "string" || !SUPPORTED_VERSIONS.has(version)) problems.push(`unsupported jyotishVersion ${JSON.stringify(version)}`);

  for (const [name, expected] of Object.entries(GRAMMAR_VOCABULARY)) {
    const got = grammarDocument[name];
    if (!Array.isArray(got) || got.length !== expected.length || got.some((value, i) => value !== expected[i])) {
      problems.push(`grammar.json ${name} differs from the loader's vocabulary`);
    }
  }

  const works = (isObject(verseIndexDocument.works) ? verseIndexDocument.works : {}) as Record<string, VerseIndexWork>;
  if (Object.keys(works).length === 0) problems.push("verse index has no works");

  const rawRules = Array.isArray(rulesDocument.rules) ? rulesDocument.rules : [];
  if (rawRules.length === 0) problems.push("no rules");
  const rules: LifeRule[] = [];
  const byId = new Map<string, LifeRule>();
  for (const raw of rawRules) {
    if (!isObject(raw) || typeof raw.id !== "string") {
      problems.push("a rule without an id");
      continue;
    }
    const id = raw.id;
    const bad = (message: string): void => void problems.push(`${id}: ${message}`);
    if (byId.has(id)) bad("duplicate id");
    if (!(TRADITIONS as readonly unknown[]).includes(raw.tradition)) bad(`tradition ${String(raw.tradition)}`);
    if (!(LIFE_QUESTIONS as readonly unknown[]).includes(raw.question)) bad(`question ${String(raw.question)}`);
    if (!(RULE_KINDS as readonly unknown[]).includes(raw.kind)) bad(`kind ${String(raw.kind)}`);
    if (!(LIFE_POLARITIES as readonly unknown[]).includes(raw.polarity)) bad(`polarity ${String(raw.polarity)}`);
    if (!(EXPORTED_SAFETIES as readonly unknown[]).includes(raw.safety)) bad(`safety ${String(raw.safety)} (a blocked rule must never be exported)`);
    if (raw.safety === "review" && !(REVIEW_REASONS as readonly unknown[]).includes(raw.reviewReason)) bad("review without a reviewReason");
    try {
      const tier = parseCondition(raw.condition);
      if (!sameTier(raw.requires, tier)) bad(`requires ${JSON.stringify(raw.requires)} but the condition needs ${JSON.stringify(tier)}`);
    } catch (error) {
      bad(`condition: ${(error as Error).message}`);
    }
    if (typeof raw.statement_hi !== "string" || typeof raw.statement_en !== "string") {
      bad("statements missing");
    } else {
      const problem = statementProblem(raw.statement_hi, raw.statement_en);
      if (problem) bad(problem);
    }
    const citation = citationProblem(raw.citation, works);
    if (citation) bad(citation);
    if (raw.kind === "derived") {
      const steps = raw.derivation;
      if (!Array.isArray(steps) || steps.length < 2) {
        bad("derived without a derivation of two or more cited steps");
      } else {
        steps.forEach((step, k) => {
          if (!isObject(step) || typeof step.claim_hi !== "string" || typeof step.claim_en !== "string") bad(`derivation[${k}] needs claim_hi and claim_en`);
          else {
            const stepProblem = citationProblem(step.citation, works);
            if (stepProblem) bad(`derivation[${k}]: ${stepProblem}`);
          }
        });
      }
    } else if ("derivation" in raw) {
      bad("derivation on a classical rule");
    }
    if ("age" in raw) {
      const age = raw.age;
      if (!Array.isArray(age) || age.length !== 2 || !age.every((a) => Number.isInteger(a)) || age[0] < 18 || age[1] < age[0]) bad(`age ${JSON.stringify(age)}`);
    }
    const rule = raw as unknown as LifeRule;
    rules.push(rule);
    byId.set(id, rule);
  }

  const counts = isObject(rulesDocument.counts) ? rulesDocument.counts : {};
  if (counts.rules !== rules.length) problems.push(`counts.rules ${String(counts.rules)} != ${rules.length}`);
  const blocked = isObject(rulesDocument.blocked) && typeof rulesDocument.blocked.count === "number" ? rulesDocument.blocked.count : -1;
  if (blocked < 0) problems.push("blocked count missing");

  if (problems.length > 0) throw new JyotishValidationError(problems);

  const byQuestion = new Map<LifeQuestion, LifeRule[]>(LIFE_QUESTIONS.map((q) => [q, []]));
  for (const rule of rules) byQuestion.get(rule.question)!.push(rule);
  return {
    version: version as string,
    rules,
    byId,
    byQuestion,
    works,
    labels: (isObject(rulesDocument.labels) ? rulesDocument.labels : {}) as Record<string, string>,
    blockedCount: blocked,
  };
}

/**
 * Types and validates concordance.json against the LifeRules: every question present, every chart and
 * palm LifeRule id existing and filed under its own question. KB, atlas and timing ids are checked by
 * `validateConcordanceAgainstPalm`, which needs those datasets.
 */
export function parseConcordance(document: unknown, data: JyotishData): Concordance {
  const problems: string[] = [];
  if (!isObject(document) || !isObject(document.questions)) throw new JyotishValidationError(["concordance must be an object with questions"]);
  if (typeof document.concordanceVersion !== "string" || !SUPPORTED_VERSIONS.has(document.concordanceVersion)) problems.push("unsupported concordanceVersion");
  const questions = document.questions as Record<string, ConcordanceEntry>;
  for (const question of LIFE_QUESTIONS) {
    const entry = questions[question];
    if (!isObject(entry) || !isObject(entry.palm) || !isObject(entry.chart)) {
      problems.push(`${question}: entry missing`);
      continue;
    }
    const expectChart = data.byQuestion.get(question)!.filter((r) => r.tradition === "jyotish").map((r) => r.id).sort();
    const expectPalm = data.byQuestion.get(question)!.filter((r) => r.tradition !== "jyotish").map((r) => r.id).sort();
    if (JSON.stringify(entry.chart.lifeRuleIds) !== JSON.stringify(expectChart)) problems.push(`${question}: chart.lifeRuleIds are not exactly the jyotish rules of the question`);
    if (JSON.stringify(entry.palm.lifeRuleIds) !== JSON.stringify(expectPalm)) problems.push(`${question}: palm.lifeRuleIds are not exactly the palm-tradition rules of the question`);
    const grouped = Object.entries(entry.chart.byReading ?? {});
    const groupedIds = grouped.flatMap(([, ids]) => ids).sort();
    if (JSON.stringify(groupedIds) !== JSON.stringify(expectChart)) problems.push(`${question}: chart.byReading does not partition the chart rules`);
    for (const [mode, ids] of grouped) {
      for (const id of ids) {
        const rule = data.byId.get(id);
        if (rule && readingMode(rule.condition) !== mode) problems.push(`${question}: ${id} filed under ${mode}`);
      }
    }
    const palmTotal = entry.palm.kbRuleIds.length + entry.palm.timingRuleIds.length + entry.palm.lifeRuleIds.length;
    const coverage = palmTotal > 0 && expectChart.length > 0 ? "both" : palmTotal > 0 ? "palm_only" : expectChart.length > 0 ? "chart_only" : "none";
    if (entry.coverage !== coverage) problems.push(`${question}: coverage ${entry.coverage} should be ${coverage}`);
  }
  const extra = Object.keys(questions).filter((q) => !(LIFE_QUESTIONS as readonly string[]).includes(q));
  if (extra.length > 0) problems.push(`unknown questions ${extra.join(", ")}`);
  if (problems.length > 0) throw new JyotishValidationError(problems);
  return {
    version: document.concordanceVersion as string,
    kb: document.kb as Concordance["kb"],
    timing: document.timing as Concordance["timing"],
    compare: document.compare as Concordance["compare"],
    questions: questions as Concordance["questions"],
  };
}

/** The ids the concordance names on the palm side must exist in the palm datasets it was built against. */
export function validateConcordanceAgainstPalm(
  concordance: Concordance,
  palm: { kbVersion: string; kbRuleIds: ReadonlySet<string>; timingRuleIds: ReadonlySet<string>; atlasVariationIds: ReadonlySet<string> },
): string[] {
  const problems: string[] = [];
  if (concordance.kb.version !== palm.kbVersion) problems.push(`concordance built against KB ${concordance.kb.version}, app has ${palm.kbVersion}`);
  for (const [question, entry] of Object.entries(concordance.questions)) {
    for (const id of entry.palm.kbRuleIds) if (!palm.kbRuleIds.has(id)) problems.push(`${question}: KB rule ${id} does not exist`);
    for (const id of entry.palm.timingRuleIds) if (!palm.timingRuleIds.has(id)) problems.push(`${question}: timed rule ${id} does not exist`);
    for (const v of entry.palm.atlasVariations) if (!palm.atlasVariationIds.has(`${v.line}/${v.id}`)) problems.push(`${question}: atlas variation ${v.line}/${v.id} does not exist`);
  }
  return problems;
}
