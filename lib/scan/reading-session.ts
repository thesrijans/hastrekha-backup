/**
 * The reading session: one monotonic accumulator behind everything the user watches build.
 *
 * A scan is a minute of noisy observation, and the naive thing — re-evaluate the rules from whatever
 * the latest frame produced — makes the ticker thrash. A feature flips, its rule stops firing, a card
 * disappears, and the next frame brings it back. Worse, the *final* reading is currently built from a
 * fresh extraction over the merged capture masks, so it can contain rules the user never saw and omit
 * ones they watched confirm. The reading they get is not the reading they watched.
 *
 * This module makes the feature bag **monotonic**. Each leaf feature carries the evidence behind it —
 * a value, a confidence, which stage produced it, and when. A new observation may reinforce a feature
 * (same value, higher confidence) or supersede it (different value, *decisively* higher confidence),
 * and nothing else. A feature never silently degrades, and the bag as a whole only ever gets better.
 *
 * Two consequences worth stating plainly, because they are the point rather than side effects:
 *
 *  - **Rules accumulate.** New rules fire as new features cross into confidence, and a rule's weight
 *    can rise as the evidence under it firms up, but nothing vanishes because a single frame wobbled.
 *  - **What posts is what was watched.** The session's bag is what goes to /api/reading, so the final
 *    reading is the one the user saw assemble — with the end-of-scan merged-mask extraction folded in
 *    as simply the best-evidenced observation of all, competing on the same terms as every other.
 *
 * The one thing this deliberately does NOT do is guarantee a rule survives to the final reading. If
 * better evidence contradicts an earlier value, the value changes and a rule may stop being
 * supported. The rule stays visible in the ticker — the user did earn it — but the reading is built
 * from what is currently believed, because printing a claim we now have good reason to think wrong
 * would be the worse failure. {@link ReadingSession.superseded} makes that visible instead of silent.
 */
import type { FeatureBag, FeatureScalar } from "@/lib/hastrekha";
import { ACTIVE_LINE_IDS, type ActiveLineId } from "./types";
import type { CompletionResult } from "./completion";

/** Where a feature's value came from. Derived from what the pipeline actually produces, not invented. */
export type EvidenceSource =
  /** Hand geometry from `featuresFromLandmarks` — mounts, finger ratios, thumb, spacing. */
  | "landmark"
  /** Line geometry from `extractLines` over the live fused mask. */
  | "line"
  /** The same extraction over the merged capture masks, at the end of the guided sequence. */
  | "capture"
  /** Supplied by the user rather than measured — a birth date. Never superseded by a measurement. */
  | "user";

/**
 * How much better a *different* value must be before it replaces the one on screen.
 *
 * Without this the accumulator churns: `observedEnergy` and the gate score both wobble by a few
 * percent frame to frame, so two nearly-tied values would swap every tick, and every swap can add or
 * remove a rule card. A tenth of the confidence range is comfortably above that noise and well below
 * a genuine improvement — a merged five-pose mask beats a single live frame by far more than this.
 */
export const SUPERSEDE_MARGIN = 0.1;

/**
 * Total accumulated confidence at which reading depth reads one half.
 *
 * Depth is deliberately asymptotic rather than a percentage of some notional complete reading: there
 * is no such thing as a finished palm reading, and a bar that fills to 100% would be claiming one.
 * A good scan lands 25–40 leaf features at 0.5–0.8 confidence, so a sum near 12 is a solid reading
 * and reads about halfway — leaving the number visibly climbing for as long as the user keeps going.
 */
export const DEPTH_HALF_SUM = 12;

/** A line counts as "locked" — worth an enhance beat — at this observed-energy × coverage product. */
export const LINE_LOCK_CONFIDENCE = 0.45;

export interface FeatureEvidence {
  readonly value: FeatureScalar;
  readonly confidence: number;
  readonly source: EvidenceSource;
  readonly atMs: number;
}

/** Why the session changed on a given observation, so the UI can animate only what actually moved. */
export interface SessionDelta {
  /** Leaf keys seen for the first time. These are what slide in at the top of the ticker. */
  readonly added: readonly string[];
  /** Leaf keys whose value changed because better evidence arrived. */
  readonly replaced: readonly string[];
  /** Leaf keys that kept their value and gained confidence. */
  readonly reinforced: readonly string[];
  /** Lines that crossed into confidence on this observation — the enhance beats. */
  readonly locked: readonly ActiveLineId[];
  readonly depthBefore: number;
  readonly depthAfter: number;
}

export interface ReadingSession {
  /** Flattened leaf features, dotted keys. The nested bag is reconstructed on demand. */
  readonly features: ReadonlyMap<string, FeatureEvidence>;
  /** Lines that have locked, ever. Once locked a line stays locked — the evidence happened. */
  readonly lockedLines: ReadonlySet<ActiveLineId>;
  /** Keys whose value was replaced at least once, and by what. Kept so supersession is auditable. */
  readonly superseded: ReadonlyMap<string, readonly FeatureScalar[]>;
  /** Monotone 0–1 summary of how much the session knows. Never decreases. */
  readonly depth: number;
  /** Sum of leaf confidences, the quantity `depth` saturates. Monotone by construction. */
  readonly confidenceSum: number;
  readonly observations: number;
}

export function emptySession(): ReadingSession {
  return {
    features: new Map(),
    lockedLines: new Set(),
    superseded: new Map(),
    depth: 0,
    confidenceSum: 0,
    observations: 0,
  };
}

const isScalar = (value: unknown): value is FeatureScalar =>
  typeof value === "string" || typeof value === "number" || typeof value === "boolean";

/**
 * Flattens a nested bag to dotted leaf keys.
 *
 * Arrays are kept whole rather than indexed: the KB's conditions match arrays by membership, so
 * splitting one into `tags.0` / `tags.1` would produce keys no rule can ever reference, and merging
 * two observations element-wise would be meaningless.
 */
export function flattenBag(bag: Record<string, unknown>, prefix = ""): Map<string, FeatureScalar> {
  const out = new Map<string, FeatureScalar>();
  for (const [key, value] of Object.entries(bag)) {
    if (value === undefined || value === null) continue;
    const path = prefix === "" ? key : `${prefix}.${key}`;
    if (isScalar(value)) {
      out.set(path, value);
    } else if (Array.isArray(value)) {
      // Whole-array leaves round-trip unchanged; see the note above.
      out.set(path, value as unknown as FeatureScalar);
    } else if (typeof value === "object") {
      for (const [nested, nestedValue] of flattenBag(value as Record<string, unknown>, path)) {
        out.set(nested, nestedValue);
      }
    }
  }
  return out;
}

/** Rebuilds the nested bag the rules engine expects. Inverse of {@link flattenBag}. */
export function unflattenBag(flat: ReadonlyMap<string, FeatureScalar>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [path, value] of flat) {
    const parts = path.split(".");
    let cursor = out;
    for (let i = 0; i < parts.length - 1; i += 1) {
      const part = parts[i];
      const existing = cursor[part];
      if (existing === undefined || typeof existing !== "object" || Array.isArray(existing)) {
        cursor[part] = {};
      }
      cursor = cursor[part] as Record<string, unknown>;
    }
    cursor[parts[parts.length - 1]] = value;
  }
  return out;
}

/** The bag as the engine wants it: nested, plain, no evidence metadata. */
export function sessionBag(session: ReadingSession): FeatureBag {
  const flat = new Map<string, FeatureScalar>();
  for (const [key, evidence] of session.features) flat.set(key, evidence.value);
  return unflattenBag(flat) as FeatureBag;
}

/** Saturating, monotone in `sum` — see {@link DEPTH_HALF_SUM} for why it is asymptotic. */
export function depthOf(sum: number): number {
  return sum <= 0 ? 0 : sum / (sum + DEPTH_HALF_SUM);
}

/**
 * Per-line confidence from a completion report.
 *
 * Energy times coverage rather than either alone: a curve can sit on strong evidence for a third of
 * its length (high energy, low coverage) or span the whole corridor on faint evidence (the reverse),
 * and neither is a line worth staking a rule on. The product only gets large when both do.
 */
export function lineConfidence(completion: CompletionResult, id: ActiveLineId): number {
  const line = completion.lines[id];
  if (line === undefined) return 0;
  return Math.max(0, Math.min(1, line.observedEnergy * line.observedFraction));
}

/**
 * Confidence for one leaf key of a line-derived bag.
 *
 * Keys under `lines.<id>` inherit that line's confidence directly. Cross-line keys — the quadrangle
 * shape, the general quality flags — take the WEAKEST contributing line, because a derived
 * measurement is only as trustworthy as the shakiest thing it was derived from.
 */
function lineKeyConfidence(key: string, completion: CompletionResult): number {
  for (const id of ACTIVE_LINE_IDS) {
    if (key.startsWith(`lines.${id}.`)) return lineConfidence(completion, id);
  }
  const accepted = ACTIVE_LINE_IDS.map((id) => lineConfidence(completion, id)).filter((c) => c > 0);
  return accepted.length === 0 ? 0 : Math.min(...accepted);
}

interface ObserveOptions {
  readonly source: EvidenceSource;
  readonly nowMs: number;
  /** Uniform confidence for every key in this bag. Ignored where `confidenceFor` is supplied. */
  readonly confidence: number;
  /** Per-key confidence, for a bag whose leaves are not equally believed. */
  readonly confidenceFor?: (key: string) => number;
}

/**
 * Folds one observation into the session.
 *
 * The whole of the monotonicity contract lives in the three branches below, and the order matters:
 *
 *  - **Unseen key** → accept it. Nothing to lose, and this is how the bag fills.
 *  - **Same value** → keep the higher confidence. A repeated observation is corroboration, so the
 *    feature's belief rises; it never falls, because a frame that saw the same thing less clearly is
 *    not evidence against what a clearer frame already established.
 *  - **Different value** → replace only if the new confidence clears the old one by
 *    {@link SUPERSEDE_MARGIN}. A marginal win is noise, and acting on noise is exactly the churn the
 *    ticker must not show.
 *
 * A zero-confidence observation is dropped outright rather than stored at zero — a feature nothing
 * believes in is not a feature, and letting it in would let it be "reinforced" later from nothing.
 */
export function observe(
  session: ReadingSession,
  bag: Record<string, unknown>,
  options: ObserveOptions,
): { readonly session: ReadingSession; readonly delta: SessionDelta } {
  const flat = flattenBag(bag);
  const features = new Map(session.features);
  const superseded = new Map(session.superseded);
  const added: string[] = [];
  const replaced: string[] = [];
  const reinforced: string[] = [];
  let sum = session.confidenceSum;

  for (const [key, value] of flat) {
    const confidence = Math.max(0, Math.min(1, options.confidenceFor?.(key) ?? options.confidence));
    if (confidence <= 0) continue;

    const existing = features.get(key);
    if (existing === undefined) {
      features.set(key, { value, confidence, source: options.source, atMs: options.nowMs });
      sum += confidence;
      added.push(key);
      continue;
    }

    if (Object.is(existing.value, value)) {
      if (confidence > existing.confidence) {
        features.set(key, { value, confidence, source: options.source, atMs: options.nowMs });
        sum += confidence - existing.confidence;
        reinforced.push(key);
      }
      continue;
    }

    if (confidence > existing.confidence + SUPERSEDE_MARGIN) {
      features.set(key, { value, confidence, source: options.source, atMs: options.nowMs });
      sum += confidence - existing.confidence;
      superseded.set(key, [...(superseded.get(key) ?? []), existing.value]);
      replaced.push(key);
    }
  }

  const depthBefore = session.depth;
  const next: ReadingSession = {
    features,
    lockedLines: session.lockedLines,
    superseded,
    confidenceSum: sum,
    depth: depthOf(sum),
    observations: session.observations + 1,
  };

  return {
    session: next,
    delta: { added, replaced, reinforced, locked: [], depthBefore, depthAfter: next.depth },
  };
}

/**
 * Folds a line extraction in, and reports any line that locked.
 *
 * Locking is one-way and one-time. A line that has been seen clearly *was* seen clearly, so it stays
 * locked even if a later frame is worse — which is what makes the enhance beat safe to fire: it can
 * never fire twice for the same line, and the user is never told a line was found and then quietly
 * un-told.
 */
export function observeLines(
  session: ReadingSession,
  bag: Record<string, unknown>,
  completion: CompletionResult,
  source: Extract<EvidenceSource, "line" | "capture">,
  nowMs: number,
): { readonly session: ReadingSession; readonly delta: SessionDelta } {
  const result = observe(session, bag, {
    source,
    nowMs,
    confidence: 0,
    confidenceFor: (key) => lineKeyConfidence(key, completion),
  });

  const locked: ActiveLineId[] = [];
  const lockedLines = new Set(session.lockedLines);
  for (const id of ACTIVE_LINE_IDS) {
    if (lockedLines.has(id)) continue;
    if (lineConfidence(completion, id) >= LINE_LOCK_CONFIDENCE) {
      lockedLines.add(id);
      locked.push(id);
    }
  }

  return {
    session: { ...result.session, lockedLines },
    delta: { ...result.delta, locked },
  };
}

/** True when anything at all changed — the cheap test before doing UI work. */
export function isMeaningful(delta: SessionDelta): boolean {
  return (
    delta.added.length > 0 ||
    delta.replaced.length > 0 ||
    delta.reinforced.length > 0 ||
    delta.locked.length > 0
  );
}

/** Hinglish copy for each line's enhance beat, in the app's voice. */
export const LINE_LOCKED_COPY: Readonly<Record<ActiveLineId, string>> = {
  heart: "Hriday rekha mil gayi — reading update ho gayi",
  head: "Mastak rekha mil gayi — reading update ho gayi",
  life: "Jeevan rekha mil gayi — reading update ho gayi",
  fate: "Bhagya rekha mil gayi — reading update ho gayi",
};
