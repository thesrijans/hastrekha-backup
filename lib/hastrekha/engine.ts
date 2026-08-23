import { resolveBirthWindows, type WindowHit } from "./dob";
import type {
  ConditionValue,
  EvaluateOptions,
  FeatureBag,
  FeatureScalar,
  FiredReason,
  FiredRule,
  KbRule,
  KnowledgeBase,
  Polarity,
  ReadingCluster,
  ReadingCoverage,
  ReadingResult,
  RuleCategory,
  RuleCondition,
} from "./types";

/* ------------------------------- Constants ------------------------------- */

export const BIRTH_WINDOW_FEATURE = "user.birth_window";
export const BIRTH_DATE_FEATURE = "user.birth_date";
export const BIRTH_DAY_OF_MONTH_FEATURE = "user.birth_day_of_month";
const MOUNT_FEATURE_PREFIX = "mounts.";
const NEGATIVE_WINDOW_SUFFIX = "_NEG";

/** Positive DOB rule fired without mount data (meta.conditions_semantics.positive_dob_rules). */
const DOB_ONLY_RELAX_MULTIPLIER = 0.7;
/** Several negative windows match the DOB and mounts can't disambiguate (resolution_policy). */
const NEG_AMBIGUITY_MULTIPLIER = 0.8;
/** Cross-source agreement bonus per additional distinct book in a cluster. */
const AGREEMENT_BONUS_PER_SOURCE = 0.15;
/** Weight mass at which the "depth" half of confidence saturates. */
const CONFIDENCE_WEIGHT_TARGET = 8;
const DEFAULT_MAX_RULES = 60;
const HIGHLIGHT_LIMIT = 5;
const HIGHLIGHT_TAGS: ReadonlySet<string> = new Set(["gold_rule", "shareable"]);

/* ---------------------------- Feature resolution ---------------------------- */

type ResolvedFeature =
  | { readonly kind: "scalar"; readonly value: FeatureScalar }
  | { readonly kind: "set"; readonly values: readonly FeatureScalar[] }
  | { readonly kind: "missing" };

const MISSING: ResolvedFeature = { kind: "missing" };

function isScalar(value: unknown): value is FeatureScalar {
  const type = typeof value;
  return type === "number" || type === "string" || type === "boolean";
}

function isScalarArray(value: unknown): value is readonly FeatureScalar[] {
  return Array.isArray(value) && value.every(isScalar);
}

function isBag(value: unknown): value is FeatureBag {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Resolve a dotted path ("mounts.jupiter") inside a nested feature bag. */
export function getFeature(bag: FeatureBag, path: string): ResolvedFeature {
  const segments = path.split(".");
  let cursor: unknown = bag;
  for (const segment of segments) {
    if (!isBag(cursor)) return MISSING;
    cursor = cursor[segment];
    if (cursor === undefined || cursor === null) return MISSING;
  }
  if (isScalar(cursor)) return { kind: "scalar", value: cursor };
  if (isScalarArray(cursor)) return { kind: "set", values: cursor };
  return MISSING;
}

/* ---------------------------- Condition evaluation ---------------------------- */

type ConditionOutcome = "true" | "false" | "missing";

function valueAsList(value: ConditionValue): readonly FeatureScalar[] {
  return Array.isArray(value) ? value : [value as FeatureScalar];
}

function evaluateCondition(condition: RuleCondition, resolved: ResolvedFeature): ConditionOutcome {
  if (condition.op === "exists") {
    // "exists" is a presence test: a missing feature is a definite false, not unknown.
    if (resolved.kind === "missing") return "false";
    if (resolved.kind === "set") return resolved.values.length > 0 ? "true" : "false";
    return resolved.value === false || resolved.value === "" ? "false" : "true";
  }
  if (resolved.kind === "missing") return "missing";
  switch (condition.op) {
    case "gte":
    case "lte": {
      if (resolved.kind !== "scalar" || typeof resolved.value !== "number") return "false";
      if (typeof condition.value !== "number") return "false";
      const pass = condition.op === "gte" ? resolved.value >= condition.value : resolved.value <= condition.value;
      return pass ? "true" : "false";
    }
    case "eq": {
      if (resolved.kind === "set") return resolved.values.includes(condition.value as FeatureScalar) ? "true" : "false";
      return resolved.value === condition.value ? "true" : "false";
    }
    case "in": {
      const allowed = valueAsList(condition.value);
      if (resolved.kind === "set") return resolved.values.some((value) => allowed.includes(value)) ? "true" : "false";
      return allowed.includes(resolved.value) ? "true" : "false";
    }
    default:
      return "false";
  }
}

/* ------------------------------ Derived features ------------------------------ */

const ISO_DAY_PATTERN = /^\d{4}-\d{2}-(\d{2})/;

/** Adds user.birth_day_of_month (1–31) from user.birth_date when absent. Never mutates the caller's bag. */
function augmentDerivedFeatures(input: FeatureBag): FeatureBag {
  const date = getFeature(input, BIRTH_DATE_FEATURE);
  if (date.kind !== "scalar" || typeof date.value !== "string") return input;
  if (getFeature(input, BIRTH_DAY_OF_MONTH_FEATURE).kind !== "missing") return input;
  const match = ISO_DAY_PATTERN.exec(date.value);
  if (!match) return input;
  const user = input.user;
  const userBag: FeatureBag = isBag(user) ? user : {};
  return { ...input, user: { ...userBag, birth_day_of_month: Number(match[1]) } };
}

/* ------------------------------ DOB augmentation ------------------------------ */

interface DobContext {
  readonly hits: readonly WindowHit[];
  readonly ids: readonly string[];
  /** Negative window ids that matched — drives the ambiguity policy. */
  readonly negativeIds: readonly string[];
  /** The negative window preferred by mount prominence (or null if mounts unavailable). */
  readonly preferredNegativeId: string | null;
}

function buildDobContext(bag: FeatureBag, kb: KnowledgeBase): DobContext {
  const table = kb.meta.mount_birth_windows;
  const explicit = getFeature(bag, BIRTH_WINDOW_FEATURE);
  const dateFeature = getFeature(bag, BIRTH_DATE_FEATURE);

  let hits: readonly WindowHit[] = [];
  if (table && dateFeature.kind === "scalar" && typeof dateFeature.value === "string") {
    hits = resolveBirthWindows(dateFeature.value, table);
  }
  const ids = new Set<string>(hits.map((hit) => hit.window.window_id));
  if (explicit.kind === "set") explicit.values.forEach((value) => ids.add(String(value)));
  if (explicit.kind === "scalar") ids.add(String(explicit.value));

  const negativeIds = [...ids].filter((id) => id.endsWith(NEGATIVE_WINDOW_SUFFIX));
  let preferredNegativeId: string | null = null;
  if (negativeIds.length > 1 && table) {
    let bestProminence = -1;
    for (const id of negativeIds) {
      const window = table.windows.find((candidate) => candidate.window_id === id);
      if (!window) continue;
      const mount = getFeature(bag, window.mount_feature);
      if (mount.kind === "scalar" && typeof mount.value === "number" && mount.value > bestProminence) {
        bestProminence = mount.value;
        preferredNegativeId = id;
      }
    }
  }
  return { hits, ids: [...ids], negativeIds, preferredNegativeId };
}

/* ------------------------------- Rule evaluation ------------------------------- */

interface RuleOutcome {
  readonly fired: boolean;
  readonly multiplier: number;
  readonly reasons: readonly FiredReason[];
}

const NOT_FIRED: RuleOutcome = { fired: false, multiplier: 0, reasons: [] };

function evaluateRule(rule: KbRule, bag: FeatureBag, dob: DobContext, relaxMissingMounts: boolean): RuleOutcome {
  let multiplier = 1;
  const reasons: FiredReason[] = [];
  const missingFeatures: string[] = [];
  let windowCondition: RuleCondition | null = null;

  for (const condition of rule.conditions) {
    if (condition.feature === BIRTH_WINDOW_FEATURE) {
      windowCondition = condition;
      const wanted = valueAsList(condition.value).map(String);
      const matched = wanted.find((id) => dob.ids.includes(id));
      if (!matched) return NOT_FIRED;
      const hit = dob.hits.find((candidate) => candidate.window.window_id === matched);
      if (hit && hit.kind === "minor") {
        multiplier *= hit.multiplier;
        reasons.push("minor_window");
      }
      if (matched.endsWith(NEGATIVE_WINDOW_SUFFIX) && dob.negativeIds.length > 1) {
        if (dob.preferredNegativeId === null || dob.preferredNegativeId !== matched) {
          multiplier *= NEG_AMBIGUITY_MULTIPLIER;
          reasons.push("neg_window_ambiguous");
        }
      }
      continue;
    }
    const outcome = evaluateCondition(condition, getFeature(bag, condition.feature));
    if (outcome === "false") return NOT_FIRED;
    if (outcome === "missing") missingFeatures.push(condition.feature);
  }

  if (missingFeatures.length > 0) {
    const onlyMountsMissing = missingFeatures.every((feature) => feature.startsWith(MOUNT_FEATURE_PREFIX));
    if (!relaxMissingMounts || windowCondition === null || !onlyMountsMissing) return NOT_FIRED;
    multiplier *= DOB_ONLY_RELAX_MULTIPLIER;
    reasons.push("dob_only_relaxed");
  }

  if (reasons.length === 0) reasons.push("full_match");
  return { fired: true, multiplier, reasons };
}

/* --------------------------------- Clustering --------------------------------- */

function clusterKey(category: RuleCategory, polarity: Polarity): string {
  return `${category}::${polarity}`;
}

function buildClusters(fired: readonly FiredRule[]): readonly ReadingCluster[] {
  const groups = new Map<string, FiredRule[]>();
  for (const item of fired) {
    const key = clusterKey(item.rule.category, item.rule.polarity);
    const group = groups.get(key);
    if (group) group.push(item);
    else groups.set(key, [item]);
  }
  const clusters: ReadingCluster[] = [];
  for (const rules of groups.values()) {
    const sources = new Set<string>();
    let mass = 0;
    for (const item of rules) {
      item.sourceTexts.forEach((text) => sources.add(text));
      mass += item.effectiveWeight;
    }
    const agreement = Math.max(1, sources.size);
    const score = mass * (1 + AGREEMENT_BONUS_PER_SOURCE * (agreement - 1));
    clusters.push({
      category: rules[0].rule.category,
      polarity: rules[0].rule.polarity,
      score,
      agreement,
      rules: [...rules].sort((a, b) => b.effectiveWeight - a.effectiveWeight),
    });
  }
  return clusters.sort((a, b) => b.score - a.score);
}

/* ---------------------------------- Coverage ---------------------------------- */

/** Every feature key referenced by the KB, with user.birth_window mapped to user.birth_date. */
export function kbFeatureKeys(kb: KnowledgeBase): readonly string[] {
  const keys = new Set<string>();
  for (const rule of kb.rules) {
    for (const condition of rule.conditions) {
      const derivedFromDob = condition.feature === BIRTH_WINDOW_FEATURE || condition.feature === BIRTH_DAY_OF_MONTH_FEATURE;
      keys.add(derivedFromDob ? BIRTH_DATE_FEATURE : condition.feature);
    }
  }
  return [...keys].sort();
}

function buildCoverage(kb: KnowledgeBase, bag: FeatureBag): ReadingCoverage {
  const provided: string[] = [];
  const missing: string[] = [];
  for (const key of kbFeatureKeys(kb)) {
    if (getFeature(bag, key).kind === "missing") missing.push(key);
    else provided.push(key);
  }
  const total = provided.length + missing.length;
  return { provided, missing, ratio: total === 0 ? 0 : provided.length / total };
}

/* ------------------------------------ API ------------------------------------ */

/**
 * Evaluate the knowledge base against a feature bag.
 * Pure and deterministic — the LLM narrator consumes this output and never decides what fires.
 */
export function evaluateRules(kb: KnowledgeBase, input: FeatureBag, options: EvaluateOptions = {}): ReadingResult {
  const includeSensitive = options.includeSensitive ?? true;
  const relaxMissingMounts = options.relaxMissingMounts ?? true;
  const maxRules = options.maxRules ?? DEFAULT_MAX_RULES;
  const categoryFilter = options.categories ? new Set<RuleCategory>(options.categories) : null;

  const bag = augmentDerivedFeatures(input);
  const dob = buildDobContext(bag, kb);
  const fired: FiredRule[] = [];
  let suppressedSensitive = 0;
  let rulesEvaluated = 0;

  for (const rule of kb.rules) {
    if (categoryFilter && !categoryFilter.has(rule.category)) continue;
    rulesEvaluated += 1;
    const outcome = evaluateRule(rule, bag, dob, relaxMissingMounts);
    if (!outcome.fired) continue;
    if (rule.safety_class === "sensitive" && !includeSensitive) {
      suppressedSensitive += 1;
      continue;
    }
    const effectiveWeight = Math.min(1, Math.max(0, rule.weight * outcome.multiplier));
    fired.push({
      rule,
      effectiveWeight,
      reasons: outcome.reasons,
      sourceTexts: [...new Set(rule.sources.map((source) => source.text))],
    });
  }

  fired.sort((a, b) => b.effectiveWeight - a.effectiveWeight || a.rule.rule_id.localeCompare(b.rule.rule_id));
  const kept = fired.slice(0, maxRules);
  const clusters = buildClusters(kept);
  const highlights = kept
    .filter((item) => item.rule.tags.some((tag) => HIGHLIGHT_TAGS.has(tag)))
    .slice(0, HIGHLIGHT_LIMIT);
  const coverage = buildCoverage(kb, bag);
  const weightMass = kept.reduce((sum, item) => sum + item.effectiveWeight, 0);
  const confidence = Number((0.5 * coverage.ratio + 0.5 * Math.min(1, weightMass / CONFIDENCE_WEIGHT_TARGET)).toFixed(3));

  return {
    fired: kept,
    clusters,
    highlights,
    confidence,
    coverage,
    safety: { sensitiveIncluded: includeSensitive, suppressedSensitive },
    birthWindows: dob.ids,
    meta: {
      kbVersion: kb.meta.kb_version,
      rulesEvaluated,
      rulesFired: kept.length,
      evaluatedAt: options.now ?? new Date().toISOString(),
    },
  };
}
