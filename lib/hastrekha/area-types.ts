/**
 * Types for the life-area layer: five areas, one verdict each.
 *
 * A reading arrives as up to sixty rules sorted by weight. That is honest and almost unusable — a
 * person did not come for a ranked list, they came to know how it looks for the handful of things
 * they actually asked about. These types describe the answer to that question.
 *
 * Three deliberate shapes here, each of which the reading path currently gets wrong:
 *
 *  - **`sources` stays structured.** `toPublicRule` in the reading route flattens a rule's sources
 *    to one pre-joined string and drops everything after the first. A citation surface cannot be
 *    built on that, so {@link AreaEvidence} carries `KbRule["sources"]` whole.
 *  - **`strength` is direction-free.** It answers "how much signal is there", never "is it good".
 *    A single number that mixes the two reads as a score out of 100 for someone's marriage, which
 *    is exactly the fixed-fate claim the KB's safety policy exists to refuse.
 *  - **`direction` and `strength` are nullable, and null is a real state.** When the evidence is
 *    too thin the band is INSUFFICIENT and both go null rather than defaulting to a hedge. The
 *    evidence list is still populated, so the UI can say "we found these, but not enough to call
 *    it" instead of quietly presenting a confident-looking neutral.
 */
import type { KbRule, Polarity, SafetyClass } from "./types";

/* ------------------------------- Constants ------------------------------- */

/**
 * The five areas, in the fixed order every consumer renders them in. Ids are the contract; the
 * Hinglish labels live in the generated map and follow narrator.ts's CATEGORY_LABEL_HI register.
 */
export const AREA_IDS = ["dhan", "rishte", "karm", "sehat", "swabhav"] as const;

/** Bumped whenever the scoring maths changes in a way that moves a published verdict. */
export const AREA_ENGINE_VERSION = "area-v1.0";

/* --------------------------------- Types --------------------------------- */

export type AreaId = (typeof AREA_IDS)[number];

/**
 * What the evidence points at. Hinglish because it is shown, not logged.
 *
 * `mishrit` is not a fallback for "we are unsure" — that is what INSUFFICIENT is for. It means the
 * hand genuinely says both things at once, which classical palmistry does constantly and which a
 * single positive/negative axis would otherwise flatten into a lie.
 */
export type AreaDirection = "anukool" | "mishrit" | "sambhalke";

export type AreaBand = "HIGH" | "MEDIUM" | "LOW" | "INSUFFICIENT";

export interface AreaEvidence {
  readonly rule_id: string;
  /** How the rule reached this area — see the map's precedence table. */
  readonly role: "primary" | "secondary";
  readonly polarity: Polarity;
  /**
   * Signed DIRECTIONAL weight: `+effectiveWeight × ROLE_WEIGHT` for a positive rule, negated for a
   * negative one, and **0 for a neutral one** — a neutral rule adds mass (so it raises `strength`)
   * but pushes in neither direction, and showing it as a positive number would read as good news.
   */
  readonly contribution: number;
  readonly feature_roots: readonly string[];
  readonly interpretation_hi_en: string;
  /** Structured and complete — never flattened, never truncated to `sources[0]`. */
  readonly sources: KbRule["sources"];
  readonly safety_class: SafetyClass;
}

export interface AreaVerdict {
  readonly area: AreaId;
  readonly label_hi_en: string;
  /** Null exactly when `band` is INSUFFICIENT. */
  readonly direction: AreaDirection | null;
  /** 0–100 "sanket ki prabalta" — how much signal, NOT how good. Null when INSUFFICIENT. */
  readonly strength: number | null;
  readonly band: AreaBand;
  /** 0–0.5. The share of the directional mass pulling the other way. */
  readonly conflict: number;
  /** How many distinct parts of the hand the fired evidence read. */
  readonly independence: number;
  /** 0–1, computed PER AREA — not the engine's whole-KB `coverage.ratio`. */
  readonly coverage: number;
  /** Sorted by contribution descending, ties broken by rule_id ascending. */
  readonly evidence: readonly AreaEvidence[];
  readonly meta: {
    readonly map_version: string;
    readonly engine_version: string;
  };
}
