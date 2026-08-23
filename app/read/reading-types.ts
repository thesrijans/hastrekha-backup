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

export interface ReadingResponse {
  /** Null when the reading could not be persisted; feedback is unavailable in that case. */
  readonly readingId: string | null;
  readonly narration: Narration;
  readonly rules: readonly PublicRule[];
  readonly clusters: readonly ReadingCluster[];
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
