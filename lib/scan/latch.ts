/**
 * Rule latching for the live ticker.
 *
 * A rule that appears and then vanishes as confidence wobbles does not read as "the estimate moved";
 * it reads as the app retracting a claim about someone's life. So firing is a ratchet: a rule must
 * hold for {@link LatchOptions.confirmAfter} consecutive evaluations to become *confirmed*, and once
 * confirmed it never disappears for the rest of the scan. Anything below that shows as *provisional*
 * and is styled to look unsettled.
 *
 * Pure, so the hysteresis is unit-tested rather than eyeballed against a camera.
 */

export type RuleStanding = "confirmed" | "provisional" | "absent";

export interface LatchOptions {
  /** Consecutive evaluations a rule must survive before it is committed to. */
  readonly confirmAfter: number;
}

export const DEFAULT_LATCH_OPTIONS: LatchOptions = { confirmAfter: 4 };

export interface LatchState {
  /** Consecutive evaluations each rule has fired for, reset the moment it drops out. */
  readonly streaks: ReadonlyMap<string, number>;
  /** Rules that have cleared the threshold. Append-only for the life of a scan. */
  readonly confirmed: ReadonlySet<string>;
}

export function emptyLatch(): LatchState {
  return { streaks: new Map(), confirmed: new Set() };
}

/**
 * Folds one evaluation's fired rule ids into the latch.
 *
 * Returns a fresh state; nothing is mutated, so React can compare by reference.
 */
export function updateLatch(
  previous: LatchState,
  firedRuleIds: readonly string[],
  options: LatchOptions = DEFAULT_LATCH_OPTIONS,
): LatchState {
  const fired = new Set(firedRuleIds);
  const streaks = new Map<string, number>();
  const confirmed = new Set(previous.confirmed);

  for (const ruleId of fired) {
    const next = (previous.streaks.get(ruleId) ?? 0) + 1;
    streaks.set(ruleId, next);
    if (next >= options.confirmAfter) confirmed.add(ruleId);
  }
  // Rules absent this round simply do not carry a streak forward — that is the reset.

  return { streaks, confirmed };
}

export function standingOf(state: LatchState, ruleId: string): RuleStanding {
  if (state.confirmed.has(ruleId)) return "confirmed";
  return (state.streaks.get(ruleId) ?? 0) > 0 ? "provisional" : "absent";
}

/** Confirmed first, then whatever is currently provisional — the order the ticker renders. */
export function orderedStandings(
  state: LatchState,
  candidateIds: readonly string[],
): ReadonlyArray<{ readonly ruleId: string; readonly standing: RuleStanding }> {
  const out: Array<{ ruleId: string; standing: RuleStanding }> = [];
  for (const ruleId of candidateIds) {
    if (state.confirmed.has(ruleId)) out.push({ ruleId, standing: "confirmed" });
  }
  for (const ruleId of candidateIds) {
    if (!state.confirmed.has(ruleId) && (state.streaks.get(ruleId) ?? 0) > 0) {
      out.push({ ruleId, standing: "provisional" });
    }
  }
  return out;
}
