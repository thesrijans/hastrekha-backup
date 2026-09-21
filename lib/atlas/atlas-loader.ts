/**
 * Loads and validates the Rekha Atlas (रेखा कोश): every line's variations, drawn and cited.
 *
 * The atlas is generated in the lab (hastrekha-lab `atlas/`: variations.py groups the KB, probe.ts
 * and polylines.ts draw and round-trip every variation through lib/scan, plates.py crops the
 * public-domain plates, export.py writes the data). It ships SPLIT, because a page only ever shows
 * one line's book and the whole atlas is ~460 kB:
 *
 *   data/atlas/index.json          ~17 kB — the nine lines, their counts, the plate catalogue
 *   data/atlas/lines/<line>.json   15-100 kB — one book: its variations and every plate they cite
 *
 * {@link ATLAS_INDEX} is the only static import. {@link loadAtlasLine} fetches one book through its
 * own `import()`, so a bundler emits a chunk per line and a client never holds the whole atlas; the
 * nine loaders are written out one by one (not a template string) so each is a separate chunk.
 * test/atlas-data.test.ts forbids any other module from importing a line file statically.
 *
 * Two levels of validation, because the client must not load the KB (661 kB) to open a book:
 *  - {@link loadAtlasLine} checks STRUCTURE — the book against the index, numbering, drawings,
 *    plate references inside the file — and throws on any problem;
 *  - {@link validateAtlasLineAgainstKb} checks a book against the KB: every rule exists and really
 *    tests the variation's conditions, `reading_hi` is its rules' own text and the narrator
 *    template's agreement sentence and nothing else (lib/hastrekha/narrator.ts), every citation is
 *    the rule's own KB source. It runs in the test and on the server, never on a client.
 * Whether a plate's PNG and sidecar are on disk is a file-system question the test answers.
 *
 * Not exported from lib/hastrekha: that barrel is in the client graph (see lib/hastrekha/index.ts).
 */
import atlasIndexDocument from "@/data/atlas/index.json";
import { AREA_IDS, type AreaId } from "@/lib/hastrekha/area-types";
import type { KbRule, KnowledgeBase, Polarity, RuleCategory, RuleCondition, SafetyClass } from "@/lib/hastrekha/types";

/* ------------------------------- Constants ------------------------------- */

const SUPPORTED_ATLAS_VERSIONS: ReadonlySet<string> = new Set(["2.0"]);
const MAX_REPORTED_PROBLEMS = 8;

/** The nine lines, in book order. */
export const ATLAS_LINE_IDS = ["heart", "head", "life", "fate", "sun", "health", "marriage", "bracelets", "girdle"] as const;
export type AtlasLineId = (typeof ATLAS_LINE_IDS)[number];

/** narrator.ts templateNarration's cross-source sentence — the only words the atlas may add. */
const AGREEMENT_SENTENCE = /\(\d+ classical sources is baat par sehmat hain\.\)/g;

/* --------------------------------- Types --------------------------------- */

export type AtlasPoint = readonly [number, number];

export interface AtlasStroke {
  /** line / companion / context / ghost stay in their corridor; branch / influence / extension leave it by design. */
  readonly role: "line" | "companion" | "context" | "ghost" | "branch" | "influence" | "extension";
  /** Whose corridor the stroke belongs to. */
  readonly line: string;
  readonly weight: "normal" | "deep" | "thin" | "broad" | "broad-pale" | "faint";
  readonly texture: "solid" | "chained" | "wavy" | "irregular";
  readonly tone?: "yellowish";
  /** Arc-length fractions of THIS stroke to leave undrawn (breaks). */
  readonly gaps?: readonly (readonly [number, number])[];
  /** 0–1 rectified palm-quad crop space, x toward the little finger, y toward the wrist. */
  readonly points: readonly AtlasPoint[];
}

export interface AtlasMark {
  readonly glyph: string;
  readonly x: number;
  readonly y: number;
  /** Degrees, the host stroke's direction at the mark. */
  readonly angle: number;
  readonly size: number;
}

export interface AtlasDrawing {
  /** The variation IS the line's absence: only ghost strokes. */
  readonly absent: boolean;
  readonly strokes: readonly AtlasStroke[];
  readonly marks: readonly AtlasMark[];
  readonly note: string;
  /** Why some check on this drawing cannot pass inside the detector's corridors, when one cannot. */
  readonly knownLimit?: string;
}

export interface AtlasRuleRef {
  readonly id: string;
  readonly category: RuleCategory;
  readonly polarity: Polarity;
  readonly weight: number;
  readonly safety_class: SafetyClass;
  /** The rule's conditions on anything other than this line — they qualify its reading. */
  readonly extraConditions: readonly RuleCondition[];
}

export interface AtlasSource {
  readonly text: string;
  readonly loc: string;
  readonly year: number | null;
  readonly ruleId: string;
}

export interface AtlasReachability {
  /** reachable = /scan emits it today; behind_flag = only with the named scan flags on. */
  readonly status: "reachable" | "behind_flag" | "unreachable";
  readonly flags: readonly string[];
  /** The conditions that stop it being measurable, each with the emitter it was checked against. */
  readonly blocking: ReadonlyArray<{
    readonly feature: string;
    readonly op: string;
    readonly value: unknown;
    readonly status: string;
    readonly evidence: string;
  }>;
  /** For reachable / behind_flag: did the drawing, run through lib/scan, produce the variation? */
  readonly roundTrip?: boolean;
}

export interface AtlasPlateRef {
  readonly plate: string;
  /** The plate's own position numerals the rules cite ("Plate XI position 2"); empty when none. */
  readonly positions: readonly number[];
  readonly ruleIds: readonly string[];
}

export interface AtlasVariation {
  readonly id: string;
  readonly line: AtlasLineId;
  /** 1-based place in its line's book. */
  readonly number: number;
  readonly title_hi: string;
  readonly title_en: string;
  readonly facets: readonly string[];
  readonly conditions: readonly RuleCondition[];
  readonly ruleIds: readonly string[];
  readonly rules: readonly AtlasRuleRef[];
  /**
   * The rules' own Hinglish, merged as narrator.ts templateNarration merges a reading. With
   * readingScope "variation" it holds the rules that need nothing but this variation; with
   * "all_qualified" (every rule also needs something else) it holds them all.
   */
  readonly reading_hi: string;
  /** Always null: the KB has no English reading. English reaches the page through `sources[].loc`. */
  readonly reading_en: null;
  readonly readingScope: "variation" | "all_qualified";
  /** Rules that also need another feature ("…and the fate line rises from the wrist"), each with its own text. */
  readonly qualified: ReadonlyArray<{ readonly ruleId: string; readonly when: readonly RuleCondition[]; readonly text_hi: string }>;
  readonly sources: readonly AtlasSource[];
  readonly areas: readonly AreaId[];
  readonly sensitive: boolean;
  readonly reachable: boolean;
  readonly reachability: AtlasReachability;
  readonly drawing: AtlasDrawing;
  readonly plates: readonly AtlasPlateRef[];
}

export interface AtlasPlate {
  readonly id: string;
  /** Public URL of the PNG; its sidecar JSON (caption, page, scan, mapping) is `sidecar`. */
  readonly src: string;
  readonly sidecar: string;
  readonly book: string;
  readonly label: string;
  readonly caption: string;
  readonly page: number | null;
  readonly pageNote: string;
  readonly width: number;
  readonly height: number;
  readonly overviewLines: readonly string[];
  /** In a line file: the variations OF THIS LINE that cite the plate. */
  readonly variations: readonly string[];
}

export interface AtlasIndexLine {
  readonly id: AtlasLineId;
  readonly title_hi: string;
  readonly title_en: string;
  /** Relative to data/atlas/. */
  readonly file: string;
  readonly bytes: number;
  readonly sha256: string;
  readonly variations: number;
  /** Variations /scan can measure today. */
  readonly measurable: number;
  readonly behindFlag: number;
  readonly plates: readonly string[];
}

export interface AtlasIndex {
  readonly atlasVersion: string;
  readonly generatedAt: string;
  readonly kb: { readonly version: string; readonly sha256: string };
  readonly space: string;
  readonly readingContract: string;
  readonly books: Readonly<Record<string, { readonly title: string; readonly author: string; readonly year: number; readonly licence: string; readonly record: string }>>;
  readonly lines: readonly AtlasIndexLine[];
  /** The whole plate catalogue, without per-variation links (those live in the line files). */
  readonly plates: ReadonlyArray<Omit<AtlasPlate, "variations"> & { readonly lines: readonly string[] }>;
}

/** One line's book, as loaded. */
export interface AtlasLineBook {
  readonly atlasVersion: string;
  readonly kbVersion: string;
  readonly line: { readonly id: AtlasLineId; readonly title_hi: string; readonly title_en: string };
  /** In book order: variations[i].number === i + 1. */
  readonly variations: readonly AtlasVariation[];
  readonly plates: readonly AtlasPlate[];
  readonly byId: ReadonlyMap<string, AtlasVariation>;
  readonly plateById: ReadonlyMap<string, AtlasPlate>;
}

export class AtlasValidationError extends Error {
  constructor(public readonly problems: readonly string[]) {
    super(`atlas validation failed with ${problems.length} problem(s): ` + problems.slice(0, MAX_REPORTED_PROBLEMS).join(" | "));
    this.name = "AtlasValidationError";
  }
}

/* --------------------------------- Index --------------------------------- */

/** The index: small, static, safe in any bundle. */
export const ATLAS_INDEX: AtlasIndex = atlasIndexDocument as unknown as AtlasIndex;

/**
 * One `import()` per line, written out so each line file becomes its own chunk. A template-string
 * import would make the bundler pull every JSON file under the directory into one context.
 */
const LINE_FILES: Readonly<Record<AtlasLineId, () => Promise<{ default: unknown }>>> = {
  heart: () => import("@/data/atlas/lines/heart.json"),
  head: () => import("@/data/atlas/lines/head.json"),
  life: () => import("@/data/atlas/lines/life.json"),
  fate: () => import("@/data/atlas/lines/fate.json"),
  sun: () => import("@/data/atlas/lines/sun.json"),
  health: () => import("@/data/atlas/lines/health.json"),
  marriage: () => import("@/data/atlas/lines/marriage.json"),
  bracelets: () => import("@/data/atlas/lines/bracelets.json"),
  girdle: () => import("@/data/atlas/lines/girdle.json"),
};

/* ------------------------------- Validation ------------------------------- */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

function hasCondition(rule: KbRule, condition: RuleCondition): boolean {
  return rule.conditions.some((c) => c.feature === condition.feature && c.op === condition.op && same(c.value, condition.value));
}

/** What is left of a reading once every member rule's own text and the agreement sentence are removed. */
export function residualProse(reading: string, texts: readonly string[]): string {
  let rest = reading;
  // Longest first, so a text that contains another is removed whole.
  for (const text of [...texts].sort((a, b) => b.length - a.length)) rest = rest.split(text).join(" ");
  return rest.replace(AGREEMENT_SENTENCE, " ").trim();
}

/**
 * Check one line file's structure against the index and itself. No KB needed.
 *
 * @param line the book that was asked for; the file must be that book.
 * @param document the parsed line file (tests pass corrupted copies instead of touching the file).
 * @throws {AtlasValidationError}
 */
export function parseAtlasLine(line: AtlasLineId, document: unknown, index: AtlasIndex = ATLAS_INDEX): AtlasLineBook {
  const problems: string[] = [];
  if (!isRecord(document) || !isRecord(document.line) || !Array.isArray(document.variations) || !Array.isArray(document.plates)) {
    throw new AtlasValidationError([`${line}: line file is not { line, variations, plates }`]);
  }
  const atlasVersion = String(document.atlasVersion ?? "");
  if (!SUPPORTED_ATLAS_VERSIONS.has(atlasVersion)) problems.push(`${line}: atlasVersion ${atlasVersion || "<missing>"} is not supported`);
  if (atlasVersion !== index.atlasVersion) problems.push(`${line}: atlasVersion ${atlasVersion} differs from the index's ${index.atlasVersion}`);
  const kbVersion = isRecord(document.kb) ? String(document.kb.version ?? "") : "";
  if (kbVersion !== index.kb.version) problems.push(`${line}: built from KB ${kbVersion}, the index from ${index.kb.version}`);
  if (document.line.id !== line) problems.push(`${line}: the file holds line ${String(document.line.id)}`);

  const variations = document.variations as AtlasVariation[];
  const plates = document.plates as AtlasPlate[];
  const entry = index.lines.find((l) => l.id === line);
  if (entry === undefined) problems.push(`${line}: not in the index`);
  else if (entry.variations !== variations.length) problems.push(`${line}: index says ${entry.variations} variations, the file holds ${variations.length}`);

  const byId = new Map<string, AtlasVariation>();
  const plateById = new Map<string, AtlasPlate>(plates.map((p) => [p.id, p]));
  const areaSet: ReadonlySet<string> = new Set(AREA_IDS);
  variations.forEach((v, i) => {
    if (byId.has(v.id)) problems.push(`${v.id}: duplicate variation id`);
    byId.set(v.id, v);
    if (v.line !== line) problems.push(`${v.id}: belongs to ${v.line}, not ${line}`);
    if (v.number !== i + 1) problems.push(`${v.id}: number ${v.number} at book position ${i + 1}`);
    if (!v.title_hi || !v.title_en) problems.push(`${v.id}: missing title`);
    if (v.ruleIds.length === 0) problems.push(`${v.id}: no rules`);
    if (!same([...v.rules.map((r) => r.id)].sort(), [...v.ruleIds].sort())) problems.push(`${v.id}: rules[] and ruleIds disagree`);
    if (v.reading_en !== null) problems.push(`${v.id}: reading_en must be null (the KB has no English reading)`);
    for (const area of v.areas) if (!areaSet.has(area)) problems.push(`${v.id}: unknown area ${area}`);
    if (v.reachable !== (v.reachability.status === "reachable")) problems.push(`${v.id}: reachable disagrees with reachability.status`);
    const d = v.drawing;
    if (d.absent && d.strokes.some((s) => s.role !== "ghost")) problems.push(`${v.id}: an absent drawing may hold ghost strokes only`);
    if (!d.absent && !d.strokes.some((s) => s.role === "line")) problems.push(`${v.id}: drawing has no line stroke`);
    for (const s of d.strokes) {
      if (s.points.length < 2) problems.push(`${v.id}: a ${s.role} stroke has fewer than two points`);
      if (s.points.some(([x, y]) => !(x >= -0.1 && x <= 1.1 && y >= -0.1 && y <= 1.1))) problems.push(`${v.id}: a ${s.role} stroke leaves the crop`);
    }
    for (const ref of v.plates) {
      const plate = plateById.get(ref.plate);
      if (plate === undefined) problems.push(`${v.id}: plate ${ref.plate} is not in the plate list`);
      else if (!plate.variations.includes(v.id)) problems.push(`${v.id}: plate ${ref.plate} does not list it back`);
    }
  });
  for (const plate of plates) {
    for (const id of plate.variations) {
      const v = byId.get(id);
      if (v === undefined) problems.push(`plate ${plate.id}: variation ${id} is not in this book`);
      else if (!v.plates.some((ref) => ref.plate === plate.id)) problems.push(`plate ${plate.id}: ${id} does not point back`);
    }
    if (plate.src !== `/atlas/plates/${plate.id}.png` || plate.sidecar !== `/atlas/plates/${plate.id}.json`) problems.push(`plate ${plate.id}: src/sidecar path`);
    if (!index.plates.some((p) => p.id === plate.id)) problems.push(`plate ${plate.id}: not in the index's catalogue`);
  }

  if (problems.length > 0) throw new AtlasValidationError(problems);
  return {
    atlasVersion,
    kbVersion,
    line: document.line as AtlasLineBook["line"],
    variations,
    plates,
    byId,
    plateById,
  };
}

/** Load one line's book — its own chunk, nothing else — and check its structure. */
export async function loadAtlasLine(line: AtlasLineId): Promise<AtlasLineBook> {
  const loaded = await LINE_FILES[line]();
  return parseAtlasLine(line, loaded.default);
}

/**
 * Check a book against the KB. For the test and the server; the client never loads the KB.
 *
 * @throws {AtlasValidationError} on any disagreement.
 */
export function validateAtlasLineAgainstKb(kb: KnowledgeBase, book: AtlasLineBook): void {
  const problems: string[] = [];
  if (book.kbVersion !== kb.meta.kb_version) problems.push(`kb version mismatch: atlas built from ${book.kbVersion}, loaded KB is ${kb.meta.kb_version}`);
  const kbById = new Map(kb.rules.map((rule) => [rule.rule_id, rule]));
  for (const v of book.variations) {
    const members: KbRule[] = [];
    for (const id of v.ruleIds) {
      const rule = kbById.get(id);
      if (rule === undefined) {
        problems.push(`${v.id}: rule ${id} is not in the KB`);
        continue;
      }
      members.push(rule);
      for (const condition of v.conditions) {
        if (!hasCondition(rule, condition)) problems.push(`${v.id}: ${id} does not test ${condition.feature} ${condition.op} ${JSON.stringify(condition.value)}`);
      }
      const ref = v.rules.find((r) => r.id === id);
      if (ref !== undefined && (ref.polarity !== rule.polarity || ref.weight !== rule.weight || ref.safety_class !== rule.safety_class || ref.category !== rule.category)) {
        problems.push(`${v.id}: ${id} category/polarity/weight/safety_class differ from the KB`);
      }
    }
    if (members.length !== v.ruleIds.length) continue;
    const needsMore = new Set(v.rules.filter((r) => r.extraConditions.length > 0).map((r) => r.id));
    const core = members.filter((r) => !needsMore.has(r.rule_id));
    const expectedScope = core.length > 0 ? "variation" : "all_qualified";
    if (v.readingScope !== expectedScope) problems.push(`${v.id}: readingScope should be ${expectedScope}`);
    const merged = expectedScope === "variation" ? core : members;
    if (!v.reading_hi || residualProse(v.reading_hi, merged.map((r) => r.interpretation_hi_en)) !== "") {
      problems.push(`${v.id}: reading_hi holds words that are not its rules' own text`);
    }
    if (!same([...v.qualified.map((q) => q.ruleId)].sort(), [...needsMore].sort())) problems.push(`${v.id}: qualified[] must list exactly the rules with extra conditions`);
    for (const q of v.qualified) {
      const rule = kbById.get(q.ruleId);
      const ref = v.rules.find((r) => r.id === q.ruleId);
      if (rule === undefined || q.text_hi !== rule.interpretation_hi_en) problems.push(`${v.id}: qualified ${q.ruleId} text is not the KB's`);
      if (ref === undefined || !same(q.when, ref.extraConditions)) problems.push(`${v.id}: qualified ${q.ruleId} 'when' is not its extra conditions`);
      for (const c of q.when) if (rule !== undefined && !hasCondition(rule, c)) problems.push(`${v.id}: ${q.ruleId} does not test ${c.feature}`);
    }
    for (const src of v.sources) {
      const rule = kbById.get(src.ruleId);
      if (rule === undefined || !v.ruleIds.includes(src.ruleId) || !rule.sources.some((k) => k.text === src.text && k.loc === src.loc && k.year === src.year)) {
        problems.push(`${v.id}: citation "${src.loc}" is not one of ${src.ruleId}'s KB sources`);
      }
    }
    if (v.sensitive !== members.some((r) => r.safety_class === "sensitive")) problems.push(`${v.id}: sensitive flag disagrees with its rules`);
  }
  if (problems.length > 0) throw new AtlasValidationError(problems);
}
