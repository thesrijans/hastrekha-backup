import {
  KB_SCHEMA_VERSION,
  type KbMeta,
  type KbRule,
  type KnowledgeBase,
  type MountBirthWindows,
  type RuleCategory,
  type RuleDomain,
} from "./types";

const RULE_ID_PATTERN = /^PALM-[A-Z]{3,5}-\d{3}$/;
const DEVANAGARI_PATTERN = /[\u0900-\u097F]/;
const WEIGHT_MIN = 0.4;
const WEIGHT_MAX = 0.85;
const DOMAINS: ReadonlySet<string> = new Set<RuleDomain>(["palmistry", "numerology", "astrology"]);
const CATEGORIES: ReadonlySet<string> = new Set<RuleCategory>([
  "career", "love", "wealth", "personality", "vitality", "timing",
  "travel", "obstacles", "children", "protection", "reading_method",
]);

export class KbValidationError extends Error {
  constructor(public readonly problems: readonly string[]) {
    super(`KB validation failed with ${problems.length} problem(s): ${problems.slice(0, 5).join(" | ")}`);
    this.name = "KbValidationError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Structural check of one rule. Returns problems (empty = OK). */
export function validateRule(candidate: unknown, index: number): readonly string[] {
  const problems: string[] = [];
  if (!isRecord(candidate)) return [`rules[${index}] is not an object`];
  const id = typeof candidate.rule_id === "string" ? candidate.rule_id : `rules[${index}]`;
  if (!RULE_ID_PATTERN.test(id)) problems.push(`${id}: bad rule_id format`);
  if (!DOMAINS.has(String(candidate.domain))) problems.push(`${id}: unknown domain ${String(candidate.domain)}`);
  if (!CATEGORIES.has(String(candidate.category))) problems.push(`${id}: unknown category`);
  if (!Array.isArray(candidate.conditions) || candidate.conditions.length === 0) problems.push(`${id}: conditions empty`);
  if (!Array.isArray(candidate.requires)) problems.push(`${id}: requires missing`);
  const interpretation = candidate.interpretation_hi_en;
  if (typeof interpretation !== "string" || interpretation.trim() === "") problems.push(`${id}: interpretation empty`);
  else if (DEVANAGARI_PATTERN.test(interpretation)) problems.push(`${id}: Devanagari in interpretation`);
  if (!["positive", "negative", "neutral"].includes(String(candidate.polarity))) problems.push(`${id}: bad polarity`);
  const weight = candidate.weight;
  if (typeof weight !== "number" || weight < WEIGHT_MIN || weight > WEIGHT_MAX) problems.push(`${id}: weight out of range`);
  if (!Array.isArray(candidate.sources) || candidate.sources.length === 0) problems.push(`${id}: sources missing`);
  if (!Array.isArray(candidate.tags)) problems.push(`${id}: tags missing`);
  if (!["standard", "sensitive"].includes(String(candidate.safety_class))) problems.push(`${id}: bad safety_class`);
  return problems;
}

/**
 * Merge several batch documents into one KnowledgeBase.
 * Later documents with a mount_birth_windows table override earlier ones (tables are identical by design).
 * @throws KbValidationError on schema problems or duplicate rule_ids.
 */
export function mergeKnowledgeBases(documents: readonly unknown[], mergedVersion: string): KnowledgeBase {
  const problems: string[] = [];
  const rules: KbRule[] = [];
  const seen = new Set<string>();
  let birthWindows: MountBirthWindows | undefined;
  let latestDate = "";

  documents.forEach((doc, docIndex) => {
    if (!isRecord(doc) || !isRecord(doc.meta) || !Array.isArray(doc.rules)) {
      problems.push(`document[${docIndex}]: missing meta/rules`);
      return;
    }
    if (doc.meta.schema_version !== KB_SCHEMA_VERSION) {
      problems.push(`document[${docIndex}]: schema_version ${String(doc.meta.schema_version)} != ${KB_SCHEMA_VERSION}`);
    }
    if (typeof doc.meta.rule_count === "number" && doc.meta.rule_count !== doc.rules.length) {
      problems.push(`document[${docIndex}]: meta.rule_count ${doc.meta.rule_count} != ${doc.rules.length}`);
    }
    if (isRecord(doc.meta.mount_birth_windows)) {
      birthWindows = doc.meta.mount_birth_windows as unknown as MountBirthWindows;
    }
    if (typeof doc.meta.extraction_date === "string" && doc.meta.extraction_date > latestDate) {
      latestDate = doc.meta.extraction_date;
    }
    doc.rules.forEach((candidate, index) => {
      const ruleProblems = validateRule(candidate, index);
      if (ruleProblems.length > 0) {
        problems.push(...ruleProblems);
        return;
      }
      const rule = candidate as KbRule;
      if (seen.has(rule.rule_id)) {
        problems.push(`${rule.rule_id}: duplicate across documents`);
        return;
      }
      seen.add(rule.rule_id);
      rules.push(rule);
    });
  });

  if (problems.length > 0) throw new KbValidationError(problems);

  const meta: KbMeta = {
    kb_name: "HastRekha AI — Rules Knowledge Base",
    kb_version: mergedVersion,
    schema_version: KB_SCHEMA_VERSION,
    extraction_date: latestDate,
    rule_count: rules.length,
    mount_birth_windows: birthWindows,
  };
  return { meta, rules };
}

/** Load a single already-merged KB document (e.g. data/kb/hastrekha_kb.json) with validation. */
export function loadKnowledgeBase(document: unknown): KnowledgeBase {
  if (!isRecord(document) || !isRecord(document.meta)) throw new KbValidationError(["document: missing meta"]);
  const version = typeof document.meta.kb_version === "string" ? document.meta.kb_version : "unknown";
  return mergeKnowledgeBases([document], version);
}
