/** Shape of POST /api/reading's response, as the reading UI consumes it. */

export interface PublicRule {
  readonly rule_id: string;
  readonly category: string;
  readonly polarity: string;
  readonly interpretation_hi_en: string;
  readonly weight: number;
  readonly source: string;
  readonly tags: readonly string[];
}

export interface NarrationSection {
  readonly title: string;
  readonly body: string;
  readonly rule_ids: readonly string[];
}

export interface Narration {
  readonly one_liner: string;
  readonly sections: readonly NarrationSection[];
  readonly disclaimer: string;
  readonly engine: "llm" | "template";
}

export interface ReadingCluster {
  readonly category: string;
  readonly polarity: string;
  readonly score: number;
  /** Distinct source books agreeing inside this cluster — drives the "N texts agree" badge. */
  readonly agreement: number;
  readonly rule_ids: readonly string[];
}

/**
 * One classical citation, structured.
 *
 * Note the contrast with {@link PublicRule.source}, which pre-joins to a single string and keeps
 * only the first source. Area evidence carries the array whole, because a citation drawer cannot be
 * built from a joined string. The old field stays as it is until C4 migrates the reading UI.
 */
export interface AreaSource {
  readonly text: string;
  readonly loc: string;
  readonly year: number;
}

export interface PublicAreaEvidence {
  readonly rule_id: string;
  readonly role: "primary" | "secondary";
  readonly polarity: string;
  /** Signed directional weight; 0 for a neutral rule, which adds mass but no lean. */
  readonly contribution: number;
  /** Absent on the free tier — the citation is shown, the reading is not. */
  readonly interpretation_hi_en?: string;
  readonly sources: readonly AreaSource[];
}

/**
 * A life-area verdict as the wire carries it. Always five, in the fixed order
 * dhan · rishte · karm · sehat · swabhav.
 *
 * `direction` and `strength` are BOTH null exactly when `band` is "INSUFFICIENT" — that is a real
 * state meaning "we looked and cannot say", not a missing value to be defaulted. `evidence` is
 * still populated there, so the UI can show what was found without claiming a verdict.
 */
export interface PublicAreaVerdict {
  readonly area: string;
  readonly label_hi_en: string;
  readonly direction: "anukool" | "mishrit" | "sambhalke" | null;
  /** 0–100 "how much signal", never "how good" — direction-free by construction. */
  readonly strength: number | null;
  readonly band: "HIGH" | "MEDIUM" | "LOW" | "INSUFFICIENT";
  readonly conflict: number;
  readonly independence: number;
  readonly coverage: number;
  readonly evidence: readonly PublicAreaEvidence[];
  /** Evidence rows this tier did not receive — the free tier's upsell number. */
  readonly lockedEvidenceCount: number;
  readonly meta: { readonly map_version: string; readonly engine_version: string };
}

export interface ReadingResponse {
  /** Null when the reading could not be persisted; feedback is unavailable in that case. */
  readonly readingId: string | null;
  readonly narration: Narration;
  readonly rules: readonly PublicRule[];
  readonly clusters: readonly ReadingCluster[];
  /** Five life-area verdicts. Response-computed, not persisted — see docs/AREA_VERDICTS.md. */
  readonly areas: readonly PublicAreaVerdict[];
  readonly lockedRuleCount: number;
  readonly confidence: number;
  readonly coverage: {
    readonly provided: readonly string[];
    readonly missing: readonly string[];
    readonly ratio: number;
  };
}

export type Verdict = "ACCURATE" | "PARTLY" | "WRONG";

export type FeedbackState =
  | { readonly status: "saving" }
  | { readonly status: "done"; readonly verdict: Verdict }
  | { readonly status: "error" };

export interface ReadingPayload {
  readonly tier: "free";
  readonly features: Record<string, unknown>;
  readonly question?: string;
  readonly userName?: string;
}
