/**
 * HastRekha AI — Rules Knowledge Base types (schema v1.0)
 * Mirrors the JSON produced by the extraction sprints (Cheiro batches 1–5B, Benham next).
 * Keep in sync with meta.schema_version in every batch file.
 */

export const KB_SCHEMA_VERSION = "1.0" as const;

export type RuleCategory =
  | "career"
  | "love"
  | "wealth"
  | "personality"
  | "vitality"
  | "timing"
  | "travel"
  | "obstacles"
  | "children"
  | "protection"
  | "reading_method";

export type Polarity = "positive" | "negative" | "neutral";
export type SafetyClass = "standard" | "sensitive";
export type ConditionOp = "gte" | "lte" | "eq" | "in";

/** Scalar feature values understood by the engine. */
export type FeatureScalar = number | string | boolean;
export type ConditionValue = FeatureScalar | readonly FeatureScalar[];

export interface RuleCondition {
  /** Dotted path, e.g. "mounts.jupiter", "user.birth_window", "lines.head.quality" */
  readonly feature: string;
  readonly op: ConditionOp;
  readonly value: ConditionValue;
}

export interface RuleSource {
  readonly text: string;
  readonly loc: string;
  readonly year: number;
}

export interface KbRule {
  readonly rule_id: string;
  readonly domain: "palmistry";
  readonly category: RuleCategory;
  readonly conditions: readonly RuleCondition[];
  readonly requires: readonly string[];
  /** Hinglish, Roman script only (validated at build time). */
  readonly interpretation_hi_en: string;
  readonly polarity: Polarity;
  /** 0.4–0.85 per schema */
  readonly weight: number;
  readonly sources: readonly RuleSource[];
  readonly tags: readonly string[];
  readonly safety_class: SafetyClass;
}

export interface DateRange {
  /** MM-DD */
  readonly start: string;
  /** MM-DD */
  readonly end: string;
}

export interface BirthWindow {
  readonly window_id: string;
  readonly mount: string;
  readonly variant: "positive" | "negative";
  readonly aspect: string;
  /** Feature key whose prominence this window is tied to, e.g. "mounts.jupiter" */
  readonly mount_feature: string;
  readonly core: DateRange;
  readonly minor: DateRange;
  readonly wraps_year: boolean;
  readonly source_loc: string;
}

export interface MountBirthWindows {
  readonly date_format: "MM-DD";
  readonly minor_weight_multiplier: number;
  readonly resolution_policy: string;
  readonly windows: readonly BirthWindow[];
}

export interface KbMetaSource {
  readonly title: string;
  readonly author?: string;
  readonly year?: number;
  readonly fetched_from?: readonly string[];
}

/** Minimal meta the engine depends on; batch files carry more (validated by scripts). */
export interface KbMeta {
  readonly kb_name: string;
  readonly kb_version: string;
  readonly schema_version: string;
  readonly extraction_date: string;
  readonly rule_count: number;
  readonly mount_birth_windows?: MountBirthWindows;
}

export interface KnowledgeBase {
  readonly meta: KbMeta;
  readonly rules: readonly KbRule[];
}

/* ----------------------------- Engine input ----------------------------- */

/** Nested feature bag: { mounts: { jupiter: 0.8 }, user: { birth_date: "1994-03-25" } } */
export interface FeatureBag {
  readonly [key: string]: FeatureScalar | FeatureBag | readonly FeatureScalar[] | undefined;
}

export interface EvaluateOptions {
  /** Include safety_class "sensitive" (softened) rules. Default true for paid tiers, false for free. */
  readonly includeSensitive?: boolean;
  /** Positive DOB rules may fire on DOB alone (x0.7) when mount data is missing. Default true. */
  readonly relaxMissingMounts?: boolean;
  /** Cap on fired rules returned (after sorting). Default 60. */
  readonly maxRules?: number;
  /** Restrict evaluation to these categories (e.g. user asked about career). */
  readonly categories?: readonly RuleCategory[];
  /** ISO timestamp override for deterministic tests. */
  readonly now?: string;
}

/* ----------------------------- Engine output ---------------------------- */

export type FiredReason =
  | "full_match"
  | "dob_only_relaxed"
  | "minor_window"
  | "neg_window_ambiguous";

export interface FiredRule {
  readonly rule: KbRule;
  /** weight after window/relaxation multipliers, clamped 0–1 */
  readonly effectiveWeight: number;
  readonly reasons: readonly FiredReason[];
  /** Distinct source texts (for agreement display) */
  readonly sourceTexts: readonly string[];
}

export interface ReadingCluster {
  readonly category: RuleCategory;
  readonly polarity: Polarity;
  /** Sum of effective weights (for ranking) */
  readonly score: number;
  /** Number of distinct source books agreeing inside this cluster */
  readonly agreement: number;
  readonly rules: readonly FiredRule[];
}

export interface ReadingCoverage {
  /** KB feature keys the caller supplied */
  readonly provided: readonly string[];
  /** KB feature keys the caller did not supply (drives "scan your palm for more" CTA) */
  readonly missing: readonly string[];
  /** provided / (provided + missing) */
  readonly ratio: number;
}

export interface ReadingResult {
  readonly fired: readonly FiredRule[];
  readonly clusters: readonly ReadingCluster[];
  readonly highlights: readonly FiredRule[];
  /** 0–1 — combines coverage and weight mass; UI shows as "reading depth" */
  readonly confidence: number;
  readonly coverage: ReadingCoverage;
  readonly safety: {
    readonly sensitiveIncluded: boolean;
    readonly suppressedSensitive: number;
  };
  readonly birthWindows: readonly string[];
  readonly meta: {
    readonly kbVersion: string;
    readonly rulesEvaluated: number;
    readonly rulesFired: number;
    readonly evaluatedAt: string;
  };
}
