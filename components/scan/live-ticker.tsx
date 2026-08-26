"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import type { FiredRule } from "@/lib/hastrekha";
import { orderedStandings, type LatchState, type RuleStanding } from "@/lib/scan/latch";

/** How long the upgrade tick stays lit on the depth readout. Long enough to notice, short enough not to nag. */
const TICK_MS = 700;

/**
 * Height the card list scrolls within, rather than a count it truncates at.
 *
 * Slicing to a fixed number silently removed cards once enough rules fired, which is exactly the
 * retraction this whole step exists to prevent — the user watches a rule confirm, then it vanishes
 * because a newer one pushed it past the cutoff. Scrolling keeps every earned rule reachable.
 */
const LIST_MAX_HEIGHT = "min(46vh, 30rem)";

const STANDING_LABEL: Readonly<Record<RuleStanding, string>> = {
  confirmed: "· confirmed",
  captured: "· captured",
  provisional: "· checking",
  absent: "",
};
/**
 * Shown instead of the standing when a held rule is no longer supported by the current bag.
 *
 * A monotonic bag still permits a value to be replaced by better-evidenced, different evidence, and
 * when that happens a rule can stop firing. The card stays — the user did watch it confirm, and
 * deleting it would be the retraction this whole step exists to prevent — but presenting it as
 * currently true would be worse than either. So it stays, marked, and stops being counted as held.
 */
const REVISED_LABEL = "· revised";

/**
 * Rules firing beside the hand, as features become confident.
 *
 * Three states, and the third came out of real-hand testing. *Provisional* has fired but not held
 * long enough to trust. *Confirmed* cleared the latch during the current good stretch. *Captured*
 * was confirmed earlier and is kept on screen after the gate started failing — the user did earn it,
 * so deleting it would be wrong, but presenting it as live would be a lie about what the camera can
 * currently see.
 *
 * When the gate is failing the whole list dims and says so, because the previous version happily
 * showed eleven confidently-worded rules while the HUD underneath read "turn your palm around".
 */
/**
 * The session's accumulated confidence, climbing live.
 *
 * Deliberately not a percentage of a finished reading — there is no such thing, and a bar that filled
 * to 100% would be claiming one. It is an asymptotic depth that keeps rising as evidence accrues, so
 * the number is always going somewhere while the user holds their palm up.
 *
 * The upgrade tick is driven from an effect comparing against a ref, never from a comparison made
 * during render: writing state during render is a lint error this codebase has hit before, and
 * deriving "did it just increase" from props alone would re-fire the animation on unrelated renders.
 */
function ReadingDepth({ depth }: { readonly depth: number }) {
  const previous = useRef(depth);
  const [ticking, setTicking] = useState(false);

  useEffect(() => {
    if (depth <= previous.current) {
      previous.current = depth;
      return;
    }
    previous.current = depth;
    setTicking(true);
    const id = window.setTimeout(() => setTicking(false), TICK_MS);
    return () => window.clearTimeout(id);
  }, [depth]);

  const percent = Math.round(depth * 100);
  return (
    <div className="flex items-center gap-2">
      <span className="font-display text-[0.7rem] uppercase tracking-[0.18em] text-muted">Reading depth</span>
      <div
        className="relative h-1 w-16 overflow-hidden rounded-full bg-hairline"
        role="progressbar"
        aria-valuenow={percent}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Reading depth"
      >
        <div
          className="h-full rounded-full bg-mount-glow transition-[width] duration-500 ease-out"
          style={{ width: `${percent}%` }}
        />
      </div>
      <span
        className={`font-display text-xs tabular-nums transition-colors duration-300 ${
          ticking ? "text-mount-glow" : "text-muted"
        }`}
      >
        {percent}%
      </span>
    </div>
  );
}

export function LiveTicker({
  fired,
  latch,
  gatePassing,
  hint,
  depth,
  currentRuleIds,
}: {
  readonly fired: readonly FiredRule[];
  readonly latch: LatchState;
  readonly gatePassing: boolean;
  readonly hint: string;
  /** 0–1 session depth; drives the header readout. */
  readonly depth: number;
  /** Rule ids the current feature bag still supports. Anything held outside it is marked revised. */
  readonly currentRuleIds: ReadonlySet<string>;
}) {
  const reduced = useReducedMotion() ?? false;
  const byId = new Map(fired.map((item) => [item.rule.rule_id, item] as const));
  const standings = orderedStandings(latch, [...byId.keys()]);
  const isRevised = (ruleId: string): boolean =>
    currentRuleIds.size > 0 && !currentRuleIds.has(ruleId) && (latch.confirmed.has(ruleId) || latch.captured.has(ruleId));
  const heldCount = [...latch.confirmed, ...latch.captured].filter((id) => !isRevised(id)).length;

  return (
    <section aria-labelledby="ticker-heading" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-2">
        <h2 id="ticker-heading" className="font-display text-xs uppercase tracking-[0.22em] text-mount-glow">
          Rules firing
        </h2>
        <div className="flex items-center gap-3">
          <ReadingDepth depth={depth} />
          <span className="font-display text-xs tabular-nums text-muted">{heldCount} held</span>
        </div>
      </div>

      {!gatePassing ? (
        <p
          role="status"
          className="flex items-center gap-2 rounded-lg border border-dashed border-hairline px-3 py-2 text-xs leading-5 text-muted"
        >
          <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-muted" />
          Scan paused — {hint.toLowerCase()}
        </p>
      ) : null}

      {standings.length === 0 ? (
        <p className="rounded-xl border border-dashed border-hairline px-4 py-6 text-center text-sm text-muted">
          Hatheli seedhi rakho — rules yahan aayenge.
        </p>
      ) : (
        // aria-live on the list: a screen reader hears each rule as it commits, not on every frame.
        <ul
          aria-live="polite"
          /*
           * Dimmed while the gate fails, but only to 75%. The previous 50% on this dark surface put
           * the body text under the contrast floor — the cards were not merely de-emphasised, they
           * were unreadable, which is a worse answer than showing them plainly.
           */
          className={`flex flex-col gap-2 overflow-y-auto pr-1 transition-opacity ${
            gatePassing ? "opacity-100" : "opacity-75"
          }`}
          style={{ maxHeight: LIST_MAX_HEIGHT }}
        >
          <AnimatePresence initial={false}>
            {standings.map(({ ruleId, standing }) => {
              const item = byId.get(ruleId);
              if (item === undefined) return null;
              const source = item.rule.sources[0];
              const revised = isRevised(ruleId);
              const solid = standing === "confirmed" && !revised;
              return (
                <motion.li
                  key={ruleId}
                  /*
                   * No `layout`: layout animation is what let a card slide to a new position when
                   * the list re-sorted, and the list no longer re-sorts. The key is the rule id, so
                   * React reuses the same node across standing changes and the entry animation runs
                   * exactly once — a remount here would replay it and read as a flicker.
                   */
                  initial={reduced ? { opacity: 0 } : { opacity: 0, y: -8, scale: 0.98 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={reduced ? { opacity: 0 } : { opacity: 0 }}
                  transition={{ duration: reduced ? 0 : 0.26, ease: [0.16, 1, 0.3, 1] }}
                  className={`rounded-xl border px-4 py-3 transition-colors ${
                    solid ? "border-hairline bg-surface" : "border-dashed border-hairline/70 bg-transparent"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span
                      aria-hidden="true"
                      className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                        standing === "confirmed"
                          ? "hr-glow-chrome bg-mount-glow"
                          : standing === "captured"
                            ? "bg-line-glow/70"
                            : "animate-pulse bg-muted"
                      }`}
                    />
                    <span className="font-display text-[0.7rem] uppercase tracking-[0.18em] text-muted">
                      {item.rule.category}
                    </span>
                    {solid && !revised ? (
                      // Fires once with the card's entry, then fades — the "one more thing found" beat.
                      <motion.span
                        aria-hidden="true"
                        initial={reduced ? { opacity: 0 } : { opacity: 1, scale: 1.3 }}
                        animate={{ opacity: 0, scale: 1 }}
                        transition={{ duration: reduced ? 0 : 1.1, ease: "easeOut" }}
                        className="font-display text-[0.7rem] text-mount-glow"
                      >
                        +
                      </motion.span>
                    ) : null}
                    <span
                      className={`font-display text-[0.7rem] uppercase tracking-[0.18em] ${
                        revised ? "text-muted/70" : standing === "captured" ? "text-line-glow/80" : "text-muted"
                      }`}
                    >
                      {revised ? REVISED_LABEL : STANDING_LABEL[standing]}
                    </span>
                  </div>
                  <p className={`mt-1.5 text-sm leading-6 ${solid ? "text-ink" : "text-muted"}`}>
                    {item.rule.interpretation_hi_en}
                  </p>
                  {source !== undefined ? (
                    <p className="mt-1.5 text-xs text-line-glow/80">
                      {source.text} ({source.year}) — {source.loc}
                    </p>
                  ) : null}
                </motion.li>
              );
            })}
          </AnimatePresence>
        </ul>
      )}
    </section>
  );
}
