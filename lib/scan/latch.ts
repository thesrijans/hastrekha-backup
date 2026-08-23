/**
 * Rule latching for the live ticker.
 *
 * Two problems this solves, and the second one came from testing on real hands.
 *
 * **Flicker.** A rule that appears and vanishes as confidence wobbles does not read as "the estimate
 * moved"; it reads as the app retracting a claim about someone's life. So firing is a ratchet: a rule
 * must hold for {@link LatchOptions.confirmAfter} consecutive *gate-passing* evaluations to become
 * confirmed.
 *
 * **Confirmation on garbage.** Rules were latching while the quality gate was failing — eleven rules
 * confirmed off the back of a hand. Gate-failing frames now contribute nothing at all, and after
 * {@link LatchOptions.decayAfterMs} of continuous failure the streaks are wiped and anything already
 * confirmed is demoted to *captured*: still shown, because the user did earn it during a good
 * stretch, but visibly marked as belonging to an earlier capture rather than to what the camera is
 * looking at now.
 *
 * Pure, so all of it is unit-tested rather than eyeballed against a camera.
 */

export type RuleStanding = "confirmed" | "captured" | "provisional" | "absent";

export interface LatchOptions {
  /** Consecutive gate-passing evaluations a rule must survive before it is committed to. */
  readonly confirmAfter: number;
  /** Continuous gate-failure after which streaks reset and confirmations are demoted to captured. */
  readonly decayAfterMs: number;
}

export const DEFAULT_LATCH_OPTIONS: LatchOptions = { confirmAfter: 4, decayAfterMs: 2000 };

export interface LatchState {
  /** Consecutive gate-passing evaluations each rule has fired for. */
  readonly streaks: ReadonlyMap<string, number>;
  /** Confirmed during the current good stretch. */
  readonly confirmed: ReadonlySet<string>;
  /** Confirmed during an earlier stretch, kept visible but marked. */
  readonly captured: ReadonlySet<string>;
  /** When the current run of gate failures began, or null while the gate is passing. */
  readonly gateFailSinceMs: number | null;
}

export function emptyLatch(): LatchState {
  return { streaks: new Map(), confirmed: new Set(), captured: new Set(), gateFailSinceMs: null };
}

/**
 * Folds one **gate-passing** evaluation into the latch.
 *
 * Callers must not invoke this for a frame that failed the gate — use {@link markGateFail}. That
 * separation is deliberate: it makes "did this frame earn the right to advance a rule" a decision at
 * the call site rather than a flag buried in here.
 */
export function updateLatch(
  previous: LatchState,
  firedRuleIds: readonly string[],
  options: LatchOptions = DEFAULT_LATCH_OPTIONS,
): LatchState {
  const streaks = new Map<string, number>();
  const confirmed = new Set(previous.confirmed);

  for (const ruleId of new Set(firedRuleIds)) {
    const next = (previous.streaks.get(ruleId) ?? 0) + 1;
    streaks.set(ruleId, next);
    if (next >= options.confirmAfter) confirmed.add(ruleId);
  }
  // Rules absent this round simply do not carry a streak forward — that is the reset.

  return { streaks, confirmed, captured: previous.captured, gateFailSinceMs: null };
}

/**
 * Records that this frame failed the gate.
 *
 * Nothing decays immediately — a momentary wobble should not throw away a good scan. Only after
 * `decayAfterMs` of continuous failure are streaks wiped and confirmations demoted.
 */
export function markGateFail(
  previous: LatchState,
  nowMs: number,
  options: LatchOptions = DEFAULT_LATCH_OPTIONS,
): LatchState {
  const since = previous.gateFailSinceMs ?? nowMs;
  if (nowMs - since < options.decayAfterMs) {
    return { ...previous, gateFailSinceMs: since };
  }
  if (previous.streaks.size === 0 && previous.confirmed.size === 0) {
    return { ...previous, gateFailSinceMs: since };
  }
  return {
    streaks: new Map(),
    confirmed: new Set(),
    captured: new Set([...previous.captured, ...previous.confirmed]),
    gateFailSinceMs: since,
  };
}

export function standingOf(state: LatchState, ruleId: string): RuleStanding {
  if (state.confirmed.has(ruleId)) return "confirmed";
  if (state.captured.has(ruleId)) return "captured";
  return (state.streaks.get(ruleId) ?? 0) > 0 ? "provisional" : "absent";
}

/** Every rule the user has earned, in either stretch. Drives the "N confirmed" counter. */
export function heldRuleIds(state: LatchState): readonly string[] {
  return [...new Set([...state.confirmed, ...state.captured])];
}

/**
 * Render order: confirmed, then captured, then provisional.
 *
 * Captured rules are included even when they are not in `candidateIds`, because the whole point is
 * that they survive the hand leaving the frame.
 */
export function orderedStandings(
  state: LatchState,
  candidateIds: readonly string[],
): ReadonlyArray<{ readonly ruleId: string; readonly standing: RuleStanding }> {
  const out: Array<{ ruleId: string; standing: RuleStanding }> = [];
  for (const ruleId of state.confirmed) out.push({ ruleId, standing: "confirmed" });
  for (const ruleId of state.captured) {
    if (!state.confirmed.has(ruleId)) out.push({ ruleId, standing: "captured" });
  }
  for (const ruleId of candidateIds) {
    if (state.confirmed.has(ruleId) || state.captured.has(ruleId)) continue;
    if ((state.streaks.get(ruleId) ?? 0) > 0) out.push({ ruleId, standing: "provisional" });
  }
  return out;
}
