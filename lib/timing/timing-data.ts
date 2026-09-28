/**
 * Kaal-rekha (काल रेखा) data: how each classical author reads TIME on the lines, and the rules that attach
 * an event to a position on a line.
 *
 * Generated in the lab (hastrekha-lab `timing/`: acquire.py fetches the public-domain books, corpus.py cuts
 * them into pages, plates.py digitises Cheiro's time charts, build.py validates, export.py writes):
 *
 *   data/timing/scales.json         every author x line (Cheiro 1916, Cheiro 1897, Benham 1900, Dale 1895 x
 *                                   life, head, heart, fate, sun, marriage): an anchored TimingScale, or
 *                                   "unanchorable" with the passage, or "none"
 *   data/timing/rules.json          TimedRules: feature + position -> meaning, with the scales that date it
 *   data/timing/source-pages.json   the text of every cited page - test data only, imported by nothing
 *
 * A TimingScale anchors ages to things measurable on a real hand, named by reference strings (see
 * {@link parseTimingRef} and scales.json "refs"): landmarks, line ends, line crossings, finger projections,
 * the wrist crease, and - only where the author states it - an exact fraction between two of those. Nothing
 * here computes an age on a real hand; that is lib/timing's engine (B1), which resolves these references
 * against a traced line and the hand's landmarks. The canonical positions each scale resolves to on the app's
 * canonical hand (`canonical.u`) are carried so the engine can be checked against the lab.
 *
 * Server-side data: rules.json is ~200 kB and the client never needs it (the reading response carries the
 * computed timeline). Only this module imports data/timing/*.json; test/timing-data.test.ts enforces that.
 * Not exported from lib/hastrekha: that barrel is in the client graph.
 */
import timingScalesDocument from "@/data/timing/scales.json";
import timingRulesDocument from "@/data/timing/rules.json";
import { AREA_IDS, type AreaId } from "@/lib/hastrekha/area-types";
import type { KnowledgeBase } from "@/lib/hastrekha/types";

/* ------------------------------- Constants ------------------------------- */

const SUPPORTED_TIMING_VERSIONS: ReadonlySet<string> = new Set(["1.0"]);
const MAX_REPORTED_PROBLEMS = 8;

/** The six lines the timing work covers, in report order. */
export const TIMED_LINE_IDS = ["life", "head", "heart", "fate", "sun", "marriage"] as const;
export type TimedLineId = (typeof TIMED_LINE_IDS)[number];

/** The four sources, keyed as the lab keys them. */
export const TIMING_SOURCE_KEYS = ["cheiro-1916", "cheiro-1897", "benham-1900", "dale-1895"] as const;
export type TimingSourceKey = (typeof TIMING_SOURCE_KEYS)[number];

export const TIMED_FEATURES = [
  "break", "island", "chain", "fork", "cross", "star", "square", "dot",
  "branch_rising", "branch_falling", "line_start", "line_end", "crossing", "influence", "fading", "deepening", "bend",
] as const;
export type TimedFeature = (typeof TIMED_FEATURES)[number];

export const READ_AT = ["feature", "departure", "junction", "opposite", "position"] as const;
export type ReadAtKind = (typeof READ_AT)[number];

export const TIMED_POLARITIES = ["challenge", "growth", "change", "neutral"] as const;
export type TimedPolarity = (typeof TIMED_POLARITIES)[number];

/** MediaPipe landmark names (lib/scan/landmark-index.ts LM keys, lower-cased). */
const LANDMARK_NAMES: ReadonlySet<string> = new Set(
  ["wrist", "thumb_cmc", "thumb_mcp", "thumb_ip", "thumb_tip"].concat(
    ...["index", "middle", "ring", "pinky"].map((f) => [`${f}_mcp`, `${f}_pip`, `${f}_dip`, `${f}_tip`]),
  ),
);
const FINGERS: ReadonlySet<string> = new Set(["index", "middle", "ring", "little"]);
const WEBS: ReadonlySet<string> = new Set(["index_middle", "middle_ring", "ring_little"]);
const MOUNTS: ReadonlySet<string> = new Set(["jupiter", "saturn", "sun", "mercury", "mars_inner", "venus", "moon"]);
const SIDES = ["radial", "ulnar", "distal", "proximal"] as const;

const DEVANAGARI = /[ऀ-ॿ]/;
const LATIN = /[A-Za-z]/;
const DIGIT = /[0-9०-९]/;

/* --------------------------------- Types --------------------------------- */

export interface TimingCitation {
  readonly text: string;
  readonly loc: string;
  readonly year: number;
  readonly source: TimingSourceKey;
  /** Printed page labels, in order; the quote may run across them. */
  readonly pages: readonly string[];
  /** The book's own words, locatable on `pages` of source-pages.json. */
  readonly quote: string;
  /** Character edits the lab's locator needed (OCR noise); the app test recomputes it. */
  readonly quoteEdits?: number;
}

export interface TimingAnchor {
  readonly ref: string;
  readonly age: number;
  /** An author's own stated band ("about fourteen to twenty-one"), when he gives one. */
  readonly range?: readonly [number, number];
  /** text = stated in the prose; figure = read off the author's figure; plate = digitised from his time chart. */
  readonly basis: "text" | "figure" | "plate";
  /** Years the anchor may be off from the source. */
  readonly tolerance: number;
  readonly note?: string;
}

export type TimingMeasure =
  | { readonly kind: "arc"; readonly line: TimedLineId; readonly from: string; readonly toward: string }
  | { readonly kind: "axis"; readonly line: TimedLineId; readonly from: string; readonly to: string; readonly project: "palm_axis" | "orthogonal"; readonly subject?: string };

interface ScaleBase {
  readonly id: string;
  readonly author: string;
  readonly work: string;
  readonly year: number;
  readonly source: TimingSourceKey;
  readonly line: TimedLineId;
}

export interface AnchoredScale extends ScaleBase {
  readonly status: "anchored";
  /** Marriage only: "position" dates a line by where it sits on the mount, "course" dates events along it. */
  readonly role?: "position" | "course";
  /** A stated condition for using this variant instead of the author's main scale. */
  readonly when?: string;
  readonly measure: TimingMeasure;
  /** Where age 0 is, when the author says; null when he does not. */
  readonly origin: { readonly ref: string; readonly age: number } | null;
  /** At least two, ages strictly increasing, in reading order. */
  readonly anchors: readonly TimingAnchor[];
  readonly interpolation: "linear" | "piecewise";
  readonly extrapolate: { readonly before: "none" | "open"; readonly after: "none" | "open" };
  /** Plain-words reading direction. */
  readonly direction: string;
  /**
   * The same direction as a token, so scales of different kinds compare. Scales on one line that disagree here
   * read the line from opposite ends (Dale reads the life line from the wrist up; Cheiro and Benham from the top).
   */
  readonly directionKey: "radial_to_ulnar" | "ulnar_to_radial" | "proximal_to_distal" | "distal_to_proximal";
  readonly notes: string;
  readonly citation: TimingCitation;
  /** Each anchor resolved on the app's canonical hand (lab timing/canonical.ts): reading coordinate and point. */
  readonly canonical: { readonly u: readonly number[]; readonly points: readonly (readonly [number, number])[] };
}

export interface UnanchorableScale extends ScaleBase {
  readonly status: "unanchorable";
  readonly reason: string;
  readonly citation: TimingCitation;
}

export interface NoScale extends ScaleBase {
  readonly status: "none";
  readonly reason: string;
  readonly searched: readonly string[];
}

export type TimingScale = AnchoredScale | UnanchorableScale | NoScale;

export interface ReadAt {
  readonly line: TimedLineId;
  readonly at: ReadAtKind;
  /** For "opposite": the line the feature is on. */
  readonly of?: TimedLineId;
}

export interface TimedRule {
  readonly id: string;
  readonly source: TimingSourceKey;
  readonly author: string;
  readonly work: string;
  readonly year: number;
  /** The line the feature is on. */
  readonly line: TimedLineId;
  readonly feature: TimedFeature;
  /** The other line or mark for a crossing, or a branch's target; null when none. */
  readonly with: string | null;
  /** A short qualifier that separates rules sharing line + feature (bend "up" / "down", ...). */
  readonly detail?: string;
  /** Where the age is read; some authors read two dates. */
  readonly readAt: readonly ReadAt[];
  /** The book's meaning in our words - never an age. */
  readonly meaning_hi: string;
  readonly meaning_en: string;
  readonly areas: readonly AreaId[];
  readonly polarity: TimedPolarity;
  readonly sensitive: boolean;
  /** Anchored scales that date the rule: the rule's own author first, then the others on the same line. */
  readonly scaleRefs: readonly string[];
  readonly kbRuleIds: readonly string[];
  /**
   * authored = named in the lab's rule file (same book, same passage, checked by hand); feature = the KB rule
   * tests exactly this rule's feature (a single condition) with a compatible polarity - usually another author.
   */
  readonly kbLinks: ReadonlyArray<{ readonly ruleId: string; readonly match: "same_book" | "other_book"; readonly how: "authored" | "feature" }>;
  readonly citation: TimingCitation;
  readonly notes?: string;
}

export interface TimingData {
  readonly timingVersion: string;
  readonly kbVersion: string;
  readonly scales: readonly TimingScale[];
  readonly rules: readonly TimedRule[];
  readonly scaleById: ReadonlyMap<string, TimingScale>;
  readonly ruleById: ReadonlyMap<string, TimedRule>;
  /** Anchored scales per line, the order they appear in scales.json. */
  readonly anchoredByLine: ReadonlyMap<TimedLineId, readonly AnchoredScale[]>;
  readonly rulesByLine: ReadonlyMap<TimedLineId, readonly TimedRule[]>;
  readonly excludedCount: { readonly total: number; readonly byReason: Readonly<Record<string, number>> };
}

export class TimingValidationError extends Error {
  constructor(public readonly problems: readonly string[]) {
    super(`timing data validation failed with ${problems.length} problem(s): ` + problems.slice(0, MAX_REPORTED_PROBLEMS).join(" | "));
    this.name = "TimingValidationError";
  }
}

/* ---------------------------- Reference grammar ---------------------------- */

export type TimingPointRef =
  | { readonly kind: "landmark"; readonly name: string }
  | { readonly kind: "finger_base"; readonly finger: string }
  | { readonly kind: "web"; readonly web: string }
  | { readonly kind: "mount"; readonly mount: string }
  | { readonly kind: "percussion" }
  | TimingLineRef;

export type TimingLineRef =
  | { readonly kind: "end"; readonly line: TimedLineId; readonly side: (typeof SIDES)[number] }
  | { readonly kind: "cross"; readonly line: TimedLineId; readonly other: TimedLineId }
  | { readonly kind: "under"; readonly line: TimedLineId; readonly point: TimingPointRef }
  | { readonly kind: "level"; readonly line: TimedLineId; readonly point: TimingPointRef }
  | { readonly kind: "frac"; readonly a: TimingLineRef; readonly b: TimingLineRef; readonly t: number }
  | { readonly kind: "arc"; readonly a: TimingLineRef; readonly d: number };

export type TimingRef = TimingPointRef | { readonly kind: "axis"; readonly t: number };

const isLine = (value: string): value is TimedLineId => (TIMED_LINE_IDS as readonly string[]).includes(value);

/**
 * Parse one reference string. Returns null for anything outside the grammar the lab resolves
 * (timing/geometry.py): the engine must never guess at a reference it does not understand.
 */
export function parseTimingRef(ref: string): TimingRef | null {
  const r = ref.trim();
  let m: RegExpMatchArray | null;
  if ((m = r.match(/^axis@([0-9]*\.?[0-9]+)$/))) return { kind: "axis", t: Number(m[1]) };
  if ((m = r.match(/^frac\(([^,()]+),([^,()]+),([0-9]*\.?[0-9]+)\)$/))) {
    const a = parseTimingRef(m[1]);
    const b = parseTimingRef(m[2]);
    if (!isLineRef(a) || !isLineRef(b) || refLine(a) !== refLine(b)) return null;
    return { kind: "frac", a, b, t: Number(m[3]) };
  }
  if ((m = r.match(/^arc\(([^,()]+),([0-9]*\.?[0-9]+)\)$/))) {
    const a = parseTimingRef(m[1]);
    return isLineRef(a) ? { kind: "arc", a, d: Number(m[2]) } : null;
  }
  if ((m = r.match(/^lm\.([a-z_]+)$/))) return LANDMARK_NAMES.has(m[1]) ? { kind: "landmark", name: m[1] } : null;
  if ((m = r.match(/^finger_base\.([a-z]+)$/))) return FINGERS.has(m[1]) ? { kind: "finger_base", finger: m[1] } : null;
  if ((m = r.match(/^web\.([a-z_]+)$/))) return WEBS.has(m[1]) ? { kind: "web", web: m[1] } : null;
  if ((m = r.match(/^mount\.([a-z_]+)$/))) return MOUNTS.has(m[1]) ? { kind: "mount", mount: m[1] } : null;
  if (r === "percussion") return { kind: "percussion" };
  if ((m = r.match(/^([a-z]+)\.end:([a-z]+)$/))) {
    return isLine(m[1]) && (SIDES as readonly string[]).includes(m[2]) ? { kind: "end", line: m[1], side: m[2] as (typeof SIDES)[number] } : null;
  }
  if ((m = r.match(/^([a-z]+)×([a-z]+)$/))) return isLine(m[1]) && isLine(m[2]) && m[1] !== m[2] ? { kind: "cross", line: m[1], other: m[2] } : null;
  if ((m = r.match(/^([a-z]+)\|wrist_crease$/))) return isLine(m[1]) ? { kind: "level", line: m[1], point: { kind: "landmark", name: "wrist" } } : null;
  if ((m = r.match(/^([a-z]+)\|(under|level):(.+)$/))) {
    const point = parseTimingRef(m[3]);
    if (!isLine(m[1]) || point === null || point.kind === "axis" || isLineRef(point)) return null;
    return { kind: m[2] as "under" | "level", line: m[1], point };
  }
  return null;
}

function isLineRef(ref: TimingRef | null): ref is TimingLineRef {
  return ref !== null && ["end", "cross", "under", "level", "frac", "arc"].includes(ref.kind);
}

/** The line a line reference sits on. */
export function refLine(ref: TimingLineRef): TimedLineId {
  return ref.kind === "frac" || ref.kind === "arc" ? refLine(ref.a) : ref.line;
}

/* ----------------------------- Quote location ----------------------------- */

/**
 * Lower-case ASCII letters and digits only, single spaces, words hyphenated across a line break rejoined.
 * Mirrors the lab's timing/common.py normalise_for_match character for character.
 */
export function normaliseForMatch(text: string): string {
  return text
    .normalize("NFKC")
    .replace(/­/g, "")
    .replace(/([A-Za-z0-9])[-‐‑][ \t\r]*\n[ \t\r]*([A-Za-z0-9])/g, "$1$2")
    .toLowerCase()
    .replace(/ſ/g, "s")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const RUNNING_TITLE = /language of the hand|indian palmistry|scientific hand|palmistry for all/i;

function headerLike(line: string): boolean {
  const t = line.trim();
  if (t === "") return true;
  if (t.length > 45) return false;
  return /\d/.test(t) || t.toUpperCase() === t || RUNNING_TITLE.test(t);
}

/**
 * Pages joined in reading order; at each page turn the next page's running head (up to two header-like lines)
 * and the previous page's trailing folio are dropped. Mirrors the lab's join_pages.
 */
export function joinPages(texts: readonly string[]): string {
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

/** Minimum edit distance between `needle` and any substring of `haystack` (free start and end in the haystack). */
export function semiGlobalDistance(needle: string, haystack: string): number {
  const m = needle.length;
  const n = haystack.length;
  if (m === 0) return 0;
  if (n === 0) return m;
  let prev = new Int32Array(n + 1); // row 0: a match may start anywhere
  let cur = new Int32Array(n + 1);
  for (let i = 1; i <= m; i += 1) {
    const c = needle.charCodeAt(i - 1);
    cur[0] = i;
    for (let j = 1; j <= n; j += 1) {
      const diagonal = prev[j - 1] + (haystack.charCodeAt(j - 1) === c ? 0 : 1);
      const up = prev[j] + 1;
      const left = cur[j - 1] + 1;
      cur[j] = diagonal < up ? (diagonal < left ? diagonal : left) : up < left ? up : left;
    }
    const swap = prev;
    prev = cur;
    cur = swap;
  }
  let best = prev[0];
  for (let j = 1; j <= n; j += 1) if (prev[j] < best) best = prev[j];
  return best;
}

/** The edit budget for a normalised quote: 10% of its length, at least 3. */
export function quoteBudget(normalisedQuote: string): number {
  return Math.max(3, Math.floor(normalisedQuote.length * 0.1));
}

/** Is the quote on these pages (texts in citation order)? */
export function locateQuote(pageTexts: readonly string[], quote: string): { readonly distance: number; readonly budget: number; readonly ok: boolean } {
  const q = normaliseForMatch(quote);
  const distance = semiGlobalDistance(q, normaliseForMatch(joinPages(pageTexts)));
  const budget = quoteBudget(q);
  return { distance, budget, ok: q.length >= 25 && distance <= budget };
}

/* ------------------------------- Validation ------------------------------- */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function checkCitation(where: string, citation: unknown, source: string, problems: string[]): void {
  if (!isRecord(citation)) {
    problems.push(`${where}: no citation`);
    return;
  }
  if (citation.source !== source) problems.push(`${where}: citation is from ${String(citation.source)}, the entry from ${source}`);
  if (typeof citation.text !== "string" || citation.text === "" || typeof citation.loc !== "string" || citation.loc === "") problems.push(`${where}: citation text/loc`);
  if (!Array.isArray(citation.pages) || citation.pages.length === 0 || citation.pages.some((p) => typeof p !== "string" || p === "")) problems.push(`${where}: citation pages`);
  if (typeof citation.quote !== "string" || normaliseForMatch(citation.quote).length < 25) problems.push(`${where}: citation quote too short`);
}

function checkLineRef(where: string, ref: string, line: TimedLineId, problems: string[]): void {
  const parsed = parseTimingRef(ref);
  if (!isLineRef(parsed)) problems.push(`${where}: ${ref} is not a position on a line`);
  else if (refLine(parsed) !== line) problems.push(`${where}: ${ref} is on ${refLine(parsed)}, not ${line}`);
}

function checkScale(scale: Record<string, unknown>, problems: string[]): void {
  const id = String(scale.id);
  const line = scale.line as TimedLineId;
  if (!isLine(String(scale.line))) problems.push(`${id}: line ${String(scale.line)}`);
  if (!(TIMING_SOURCE_KEYS as readonly string[]).includes(String(scale.source))) problems.push(`${id}: source ${String(scale.source)}`);
  if (scale.status === "none") {
    if (typeof scale.reason !== "string" || !Array.isArray(scale.searched) || scale.searched.length === 0) problems.push(`${id}: a 'none' entry needs reason and searched`);
    return;
  }
  checkCitation(id, scale.citation, String(scale.source), problems);
  if (scale.status === "unanchorable") {
    if (typeof scale.reason !== "string" || scale.reason === "") problems.push(`${id}: an unanchorable entry needs its reason`);
    return;
  }
  if (scale.status !== "anchored") {
    problems.push(`${id}: status ${String(scale.status)}`);
    return;
  }
  const measure = scale.measure as TimingMeasure | undefined;
  const anchors = (Array.isArray(scale.anchors) ? scale.anchors : []) as TimingAnchor[];
  if (anchors.length < 2) problems.push(`${id}: fewer than two anchors`);
  for (let i = 1; i < anchors.length; i += 1) if (!(anchors[i].age > anchors[i - 1].age)) problems.push(`${id}: anchor ages not strictly increasing`);
  for (const a of anchors) {
    if (!["text", "figure", "plate"].includes(a.basis)) problems.push(`${id}: anchor ${a.ref} basis ${String(a.basis)}`);
    if (!(a.tolerance >= 0)) problems.push(`${id}: anchor ${a.ref} tolerance`);
    if (a.range !== undefined && !(a.range[0] <= a.age && a.age <= a.range[1])) problems.push(`${id}: anchor ${a.ref} age outside its range`);
  }
  if (measure === undefined || measure.line !== line) problems.push(`${id}: measure.line must be the scale's line`);
  else if (measure.kind === "arc") {
    checkLineRef(`${id} measure.from`, measure.from, line, problems);
    checkLineRef(`${id} measure.toward`, measure.toward, line, problems);
    for (const a of anchors) checkLineRef(`${id} anchor`, a.ref, line, problems);
  } else if (measure.kind === "axis") {
    for (const end of [measure.from, measure.to]) if (parseTimingRef(end) === null || parseTimingRef(end)?.kind === "axis") problems.push(`${id}: axis end ${end} is not a point`);
    if (!["palm_axis", "orthogonal"].includes(measure.project)) problems.push(`${id}: axis project ${String(measure.project)}`);
    for (const a of anchors) if (parseTimingRef(a.ref)?.kind !== "axis") problems.push(`${id}: axis anchor ${a.ref} must be axis@t`);
  } else problems.push(`${id}: measure kind`);
  if (!["linear", "piecewise"].includes(String(scale.interpolation))) problems.push(`${id}: interpolation`);
  if (scale.interpolation === "linear" && anchors.length !== 2) problems.push(`${id}: a linear scale takes exactly two anchors`);
  const ex = scale.extrapolate as AnchoredScale["extrapolate"] | undefined;
  if (!ex || !["none", "open"].includes(ex.before) || !["none", "open"].includes(ex.after)) problems.push(`${id}: extrapolate`);
  const canonical = scale.canonical as AnchoredScale["canonical"] | undefined;
  if (!canonical || canonical.u.length !== anchors.length) problems.push(`${id}: canonical positions missing`);
  else for (let i = 1; i < canonical.u.length; i += 1) if (!(canonical.u[i] > canonical.u[i - 1])) problems.push(`${id}: anchors out of reading order on the canonical hand`);
}

function checkRule(rule: Record<string, unknown>, anchored: ReadonlyMap<string, AnchoredScale>, problems: string[]): void {
  const id = String(rule.id);
  if (!/^T\.[a-z0-9-]+\.[a-z]+\.\d{2,}$/.test(id)) problems.push(`${id}: id format`);
  if (!isLine(String(rule.line))) problems.push(`${id}: line`);
  if (!(TIMED_FEATURES as readonly string[]).includes(String(rule.feature))) problems.push(`${id}: feature ${String(rule.feature)}`);
  const readAt = (Array.isArray(rule.readAt) ? rule.readAt : []) as ReadAt[];
  if (readAt.length === 0) problems.push(`${id}: readAt empty`);
  for (const ra of readAt) {
    if (!isLine(ra.line) || !(READ_AT as readonly string[]).includes(ra.at)) problems.push(`${id}: readAt ${JSON.stringify(ra)}`);
    if (ra.at === "opposite" && (ra.of === undefined || !isLine(ra.of))) problems.push(`${id}: readAt opposite needs of`);
    if (ra.at === "position" && ra.line !== "marriage") problems.push(`${id}: readAt position is for marriage lines`);
  }
  const en = String(rule.meaning_en ?? "");
  const hi = String(rule.meaning_hi ?? "");
  if (en.length < 20 || DEVANAGARI.test(en) || DIGIT.test(en)) problems.push(`${id}: meaning_en`);
  if (hi.length < 10 || !DEVANAGARI.test(hi) || LATIN.test(hi) || DIGIT.test(hi)) problems.push(`${id}: meaning_hi`);
  const areas = (Array.isArray(rule.areas) ? rule.areas : []) as string[];
  if (areas.length === 0 || areas.some((a) => !(AREA_IDS as readonly string[]).includes(a))) problems.push(`${id}: areas`);
  if (!(TIMED_POLARITIES as readonly string[]).includes(String(rule.polarity))) problems.push(`${id}: polarity`);
  if (typeof rule.sensitive !== "boolean") problems.push(`${id}: sensitive`);
  const refs = (Array.isArray(rule.scaleRefs) ? rule.scaleRefs : []) as string[];
  if (refs.length === 0) problems.push(`${id}: no scale dates it`);
  const readLines = new Set(readAt.map((ra) => ra.line));
  for (const ref of refs) {
    const scale = anchored.get(ref);
    if (scale === undefined) problems.push(`${id}: scaleRef ${ref} is not an anchored scale`);
    else if (!readLines.has(scale.line)) problems.push(`${id}: scaleRef ${ref} is on ${scale.line}, not a readAt line`);
  }
  if (!Array.isArray(rule.kbRuleIds)) problems.push(`${id}: kbRuleIds`);
  checkCitation(id, rule.citation, String(rule.source), problems);
}

/**
 * Check both documents' structure and cross-references. No KB needed.
 * @throws {TimingValidationError}
 */
export function parseTimingData(scalesDocument: unknown, rulesDocument: unknown): TimingData {
  const problems: string[] = [];
  if (!isRecord(scalesDocument) || !Array.isArray(scalesDocument.scales)) throw new TimingValidationError(["scales.json is not { scales }"]);
  if (!isRecord(rulesDocument) || !Array.isArray(rulesDocument.rules)) throw new TimingValidationError(["rules.json is not { rules }"]);
  const version = String(scalesDocument.timingVersion ?? "");
  if (!SUPPORTED_TIMING_VERSIONS.has(version)) problems.push(`timingVersion ${version || "<missing>"} is not supported`);
  if (String(rulesDocument.timingVersion ?? "") !== version) problems.push("scales.json and rules.json come from different builds (timingVersion)");
  const kbVersion = isRecord(scalesDocument.kb) ? String(scalesDocument.kb.version ?? "") : "";
  if (!isRecord(rulesDocument.kb) || String(rulesDocument.kb.version ?? "") !== kbVersion) problems.push("scales.json and rules.json were built against different KBs");

  const scales = scalesDocument.scales as Record<string, unknown>[];
  const rules = rulesDocument.rules as Record<string, unknown>[];
  const scaleById = new Map<string, TimingScale>();
  const cells = new Set<string>();
  for (const s of scales) {
    if (scaleById.has(String(s.id))) problems.push(`${String(s.id)}: duplicate scale id`);
    scaleById.set(String(s.id), s as unknown as TimingScale);
    cells.add(`${String(s.source)}|${String(s.line)}`);
    checkScale(s, problems);
  }
  for (const source of TIMING_SOURCE_KEYS) for (const line of TIMED_LINE_IDS) if (!cells.has(`${source}|${line}`)) problems.push(`${source} x ${line}: no entry`);
  const anchored = new Map<string, AnchoredScale>();
  for (const s of scaleById.values()) if (s.status === "anchored") anchored.set(s.id, s);
  const ruleById = new Map<string, TimedRule>();
  for (const r of rules) {
    if (ruleById.has(String(r.id))) problems.push(`${String(r.id)}: duplicate rule id`);
    ruleById.set(String(r.id), r as unknown as TimedRule);
    checkRule(r, anchored, problems);
  }
  if (problems.length > 0) throw new TimingValidationError(problems);

  const anchoredByLine = new Map<TimedLineId, AnchoredScale[]>();
  const rulesByLine = new Map<TimedLineId, TimedRule[]>();
  for (const line of TIMED_LINE_IDS) {
    anchoredByLine.set(line, [...anchored.values()].filter((s) => s.line === line));
    rulesByLine.set(line, [...ruleById.values()].filter((r) => r.line === line));
  }
  const excluded = isRecord(rulesDocument.excludedCount) ? rulesDocument.excludedCount : { total: 0, byReason: {} };
  return {
    timingVersion: version,
    kbVersion,
    scales: [...scaleById.values()],
    rules: [...ruleById.values()],
    scaleById,
    ruleById,
    anchoredByLine,
    rulesByLine,
    excludedCount: excluded as TimingData["excludedCount"],
  };
}

let cached: TimingData | null = null;

/** The shipped timing data, parsed and checked once. */
export function loadTimingData(): TimingData {
  if (cached === null) cached = parseTimingData(timingScalesDocument as unknown, timingRulesDocument as unknown);
  return cached;
}

/**
 * Check the data against the KB: same KB version, and every kbRuleIds entry exists. For tests and the server.
 * @throws {TimingValidationError}
 */
export function validateTimingAgainstKb(kb: KnowledgeBase, data: TimingData): void {
  const problems: string[] = [];
  if (data.kbVersion !== kb.meta.kb_version) problems.push(`kb version mismatch: timing built from ${data.kbVersion}, loaded KB is ${kb.meta.kb_version}`);
  const ids = new Set(kb.rules.map((r) => r.rule_id));
  for (const rule of data.rules) {
    for (const k of rule.kbRuleIds) if (!ids.has(k)) problems.push(`${rule.id}: kbRuleId ${k} is not in the KB`);
    const linked = new Set(rule.kbLinks.map((l) => l.ruleId));
    if (rule.kbRuleIds.length !== linked.size || rule.kbRuleIds.some((k) => !linked.has(k))) problems.push(`${rule.id}: kbLinks and kbRuleIds disagree`);
  }
  if (problems.length > 0) throw new TimingValidationError(problems);
}
