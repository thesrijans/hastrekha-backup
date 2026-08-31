/**
 * Life-area scoring: fired rules in, five verdicts out.
 *
 * The engine already decides what fired and how strongly. This layer only asks, per area, three
 * questions the engine never asks: which way does the evidence point, how much of it is there, and
 * how much of it disagrees with itself.
 *
 * **Direction is separated from strength, deliberately.** `direction` says which way, `strength`
 * says how loudly, and they are never multiplied together. A single signed 0–100 would render as a
 * score out of a hundred for someone's marriage — a fixed-fate claim, which is the exact thing the
 * KB's 69 documented safety exclusions exist to refuse. Keeping them apart means the UI can show a
 * strong signal that points somewhere difficult without dressing it as a failing grade.
 *
 * **Disagreement is measured, not resolved.** `buildClusters` in engine.ts keys on
 * `${category}::${polarity}`, so a positive and a negative cluster in one category are built
 * independently and neither is ever told about the other. An area verdict has to face both at once.
 * v1 does not adjudicate — it reports `conflict`, lets it force the direction to `mishrit`, and
 * damps confidence. Adjudication is C3's problem and needs evidence this layer does not have.
 *
 * **Neutral rules count as mass but not as direction.** A neutral rule is a real observation about
 * the hand — it belongs in the evidence list and it should make an area feel better attested — but
 * it says nothing about which way things lean, so it stays out of the `pos − neg` numerator.
 *
 * Input is `fired` plus the provided feature keys, never a FeatureBag. Re-reading the bag would
 * mean re-deciding what fired, and there would then be two answers to that question in the codebase.
 */
import { AREA_IDS, AREA_ENGINE_VERSION, type AreaBand, type AreaDirection, type AreaEvidence, type AreaId, type AreaVerdict } from "./area-types";
import type { AreaMap } from "./area-map-loader";
import type { FiredRule } from "./types";

/* ------------------------------- Constants ------------------------------- */

/**
 * A secondary area gets half the weight of a primary. The map's precedence table places a rule in
 * its primary area on its subject; a secondary is a real but glancing connection, and counting it
 * whole would let a rule about marrying into money speak as loudly about money as about marriage.
 */
const ROLE_WEIGHT: Readonly<Record<"primary" | "secondary", number>> = { primary: 1.0, secondary: 0.5 };

/**
 * Softening constant in the direction ratio, in the same units as weight mass.
 *
 * `(pos − neg) / (pos + neg + K)` rather than `(pos − neg) / (pos + neg)`. Without K a single
 * 0.4-weight rule and nothing else scores a perfect +1.0, which is how a lone faint observation
 * becomes an emphatic verdict. At K = 1.5 — roughly two average rules — that same lone rule lands
 * near +0.21, and it takes real accumulated mass to reach a confident direction.
 */
const DIRECTION_SOFTENING = 1.5;
/** Above this the evidence leans far enough to name a direction. */
const DIRECTION_THRESHOLD = 0.15;
/** At or above this share of opposing mass the area is `mishrit` whatever the lean says. */
const CONFLICT_MISHRIT_GATE = 0.3;

/** Distinct feature roots at which an area counts as fully corroborated. */
const INDEP_TARGET = 4;
/**
 * Ceiling on the coverage denominator.
 *
 * Areas differ wildly in how many parts of the hand their rules read — swabhav's union is 54 roots
 * against dhan's 32 (51 and 14 before the Dale merge). Dividing by the raw union would make the
 * largest area permanently look the least covered, which is backwards: it is the best attested.
 * Capping the denominator asks "did we see enough of this area to speak", not "did we see all of
 * it".
 *
 * The cap is also why the Dale merge did not move DOB-only coverage: every area was already past
 * 12 roots, so the denominator was 12 before and is 12 after, and a birth date still supplies
 * exactly one root. `test/fixtures/area-golden/dob-only.json` is unchanged across the merge.
 */
const ROOT_CAP = 12;

/** Weight mass at which an area is as well attested as this scale can express. */
const MASS_FULL = 3.0;
/** How much of confidence a fully self-contradicting area loses. */
const CONFLICT_PENALTY = 0.6;

const BAND_HIGH = 0.55;
const BAND_MEDIUM = 0.3;
const BAND_LOW = 0.12;

/** Output precision. Matches the golden-snapshot convention in test/golden-run.ts. */
const ROUND_DP = 4;

/** Feature paths collapse to this many dotted segments — the grain the area map is built at. */
const FEATURE_ROOT_SEGMENTS = 2;

/** Mirrors the DOB rewrite `kbFeatureKeys` performs in engine.ts — see {@link rootOf}. */
const BIRTH_DATE_ROOT = "user.birth_date";
const DOB_DERIVED_ROOTS: ReadonlySet<string> = new Set(["user.birth_window", "user.birth_day_of_month"]);

/* --------------------------------- Types --------------------------------- */

export interface AreaScoreInput {
  /**
   * The fired rules to score.
   *
   * Today the reading route passes `ReadingResult.fired`, which is already truncated to
   * `maxRules`. That is a known and accepted limitation: the truncation is by effective weight, so
   * what it drops is the weakest evidence, and an area that only existed below the cut was never
   * going to clear INSUFFICIENT. C3 will pass the pre-truncation list from inside the API, which is
   * why this takes a plain list rather than a whole `ReadingResult`.
   */
  readonly fired: readonly FiredRule[];
  /** KB feature keys the caller actually supplied — `ReadingResult.coverage.provided`. */
  readonly providedFeatures: readonly string[];
}

/* -------------------------------- Helpers -------------------------------- */

const round = (value: number): number => Number(value.toFixed(ROUND_DP));

/**
 * First `FEATURE_ROOT_SEGMENTS` dotted segments, with the DOB family folded together.
 *
 * The fold is not cosmetic. `kbFeatureKeys` in engine.ts rewrites `user.birth_window` and
 * `user.birth_day_of_month` to `user.birth_date` before reporting them, so `coverage.provided`
 * speaks one vocabulary while the area map — built from raw condition features — speaks another.
 * Without this, every `user.birth_window` root in the map fails to match the `user.birth_date` the
 * caller actually supplied, and a DOB-only reading scores coverage 0 in every area no matter how
 * many rules fired. Measured before the fix: 0.000 across all five, on every birth date tried.
 *
 * Applied to BOTH sides of the intersection, so the two vocabularies meet in the middle.
 */
function rootOf(feature: string): string {
  const root = feature.split(".").slice(0, FEATURE_ROOT_SEGMENTS).join(".");
  return DOB_DERIVED_ROOTS.has(root) ? BIRTH_DATE_ROOT : root;
}

interface Accumulator {
  positive: number;
  negative: number;
  neutral: number;
  readonly roots: Set<string>;
  readonly evidence: AreaEvidence[];
}

function emptyAccumulator(): Accumulator {
  return { positive: 0, negative: 0, neutral: 0, roots: new Set(), evidence: [] };
}

function bandFor(confidence: number): AreaBand {
  if (confidence >= BAND_HIGH) return "HIGH";
  if (confidence >= BAND_MEDIUM) return "MEDIUM";
  if (confidence >= BAND_LOW) return "LOW";
  return "INSUFFICIENT";
}

function directionFor(raw: number, conflict: number): AreaDirection {
  // The conflict gate is checked first on purpose: an area whose evidence is genuinely split is
  // `mishrit` even when the arithmetic happens to lean, because reporting the lean alone would
  // hide the half of the hand that says otherwise.
  if (conflict >= CONFLICT_MISHRIT_GATE) return "mishrit";
  if (raw >= DIRECTION_THRESHOLD) return "anukool";
  if (raw <= -DIRECTION_THRESHOLD) return "sambhalke";
  return "mishrit";
}

/* --------------------------------- Scoring -------------------------------- */

/**
 * Score every area. Always returns exactly five verdicts in {@link AREA_IDS} order, including for
 * areas nothing fired in — a missing area in the output would read as a rendering bug, whereas an
 * INSUFFICIENT one truthfully says "we looked and could not say".
 *
 * Fired rules absent from the map are skipped silently. That is not a swallowed error: the map
 * deliberately omits `reading_method` (how to read a hand, never a finding) and the `timing` rules
 * that have nothing to attach to until an age representation exists. See docs/AREA_VERDICTS.md.
 */
export function scoreAreas(input: AreaScoreInput, map: AreaMap): readonly AreaVerdict[] {
  const accumulators = new Map<AreaId, Accumulator>(AREA_IDS.map((area) => [area, emptyAccumulator()]));

  for (const item of input.fired) {
    const mapping = map.byRuleId.get(item.rule.rule_id);
    if (mapping === undefined) continue;

    const memberships: ReadonlyArray<readonly [AreaId, "primary" | "secondary"]> = [
      [mapping.primary_area, "primary"],
      ...mapping.secondary_areas.map((area) => [area, "secondary"] as const),
    ];

    for (const [area, role] of memberships) {
      const accumulator = accumulators.get(area);
      if (accumulator === undefined) continue;

      const weight = item.effectiveWeight * ROLE_WEIGHT[role];
      // Polarity is read from the KB rule, not from the map — one source of truth, and the loader
      // has already proved the two agree.
      const polarity = item.rule.polarity;
      if (polarity === "positive") accumulator.positive += weight;
      else if (polarity === "negative") accumulator.negative += weight;
      else accumulator.neutral += weight;

      for (const root of mapping.feature_roots) accumulator.roots.add(root);

      accumulator.evidence.push({
        rule_id: item.rule.rule_id,
        role,
        polarity,
        // Signed DIRECTIONAL contribution, so a neutral rule is 0: it raises `strength` by adding
        // mass but pushes neither way, and rendering it as +0.6 would make an explicitly
        // non-committal observation read as good news. Sorting therefore lands positives first,
        // neutral observations in the middle, cautions last — which is the order a reader wants.
        contribution: round(polarity === "positive" ? weight : polarity === "negative" ? -weight : 0),
        feature_roots: [...mapping.feature_roots].sort(),
        interpretation_hi_en: item.rule.interpretation_hi_en,
        sources: item.rule.sources,
        safety_class: item.rule.safety_class,
      });
    }
  }

  const providedRoots = new Set(input.providedFeatures.map(rootOf));

  return AREA_IDS.map((area) => {
    const accumulator = accumulators.get(area) ?? emptyAccumulator();
    const { positive, negative, neutral } = accumulator;
    const directional = positive + negative;
    const mass = directional + neutral;

    // No zero-guard needed: effectiveWeight is clamped to [0,1] and role weights are positive, so
    // `directional >= 0` and the denominator is at least DIRECTION_SOFTENING.
    const raw = (positive - negative) / (directional + DIRECTION_SOFTENING);
    const conflict = directional > 0 ? Math.min(positive, negative) / directional : 0;

    const independence = accumulator.roots.size;
    const indepRatio = Math.min(1, independence / INDEP_TARGET);

    // Both sides normalised through rootOf, so the map's raw condition vocabulary and the engine's
    // rewritten coverage vocabulary are comparable at all.
    const roots = [...new Set(map.areas[area].feature_roots.map(rootOf))];
    const denominator = Math.min(roots.length, ROOT_CAP);
    // Clamped to 1: the numerator counts roots the caller supplied that this area reads, and once
    // the denominator is capped that count can exceed it. An uncapped ratio would push confidence
    // past 1 — measured on a full palm bag, every area overflows (dhan 13/12, sehat 13/12,
    // rishte 15/12, karm 18/12, swabhav 24/12).
    const coverage = denominator === 0 ? 0 : Math.min(1, roots.filter((root) => providedRoots.has(root)).length / denominator);

    const confidence =
      Math.min(1, mass / MASS_FULL) *
      (0.5 + 0.5 * indepRatio) *
      (0.4 + 0.6 * coverage) *
      (1 - conflict * CONFLICT_PENALTY);

    const band = bandFor(confidence);
    const insufficient = band === "INSUFFICIENT";

    const evidence = [...accumulator.evidence].sort(
      (a, b) => b.contribution - a.contribution || a.rule_id.localeCompare(b.rule_id),
    );

    return {
      area,
      label_hi_en: map.areas[area].label_hi_en,
      /*
       * `directional === 0` withholds the direction even when the band clears.
       *
       * An area can accumulate real mass from neutral rules alone — five neutral rishte rules from
       * an ordinary bag reach HIGH — and with no positive or negative weight both `raw` and
       * `conflict` are 0, so `directionFor` falls through every guard to "mishrit". That output is
       * self-contradictory in this layer's own vocabulary: `mishrit` means "the hand says both
       * things at once", and it would be published next to `conflict: 0`. Withholding is the
       * honest answer — the observations are real and stay in `evidence`, but nothing about them
       * leans, so nothing is claimed. `strength` is kept: the mass genuinely is there.
       */
      direction: insufficient || directional === 0 ? null : directionFor(raw, conflict),
      // Direction-free by construction: mass and corroboration only, never `raw`.
      strength: insufficient ? null : Math.round(100 * Math.min(1, mass / MASS_FULL) * (0.6 + 0.4 * indepRatio)),
      band,
      conflict: round(conflict),
      independence,
      coverage: round(coverage),
      evidence,
      meta: { map_version: map.mapVersion, engine_version: AREA_ENGINE_VERSION },
    };
  });
}
