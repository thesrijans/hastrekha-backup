"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import type { FiredRule } from "@/lib/hastrekha";
import { orderedStandings, type LatchState, type RuleStanding } from "@/lib/scan/latch";

const MAX_VISIBLE = 8;

const STANDING_LABEL: Readonly<Record<RuleStanding, string>> = {
  confirmed: "· confirmed",
  captured: "· captured",
  provisional: "· checking",
  absent: "",
};

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
export function LiveTicker({
  fired,
  latch,
  gatePassing,
  hint,
}: {
  readonly fired: readonly FiredRule[];
  readonly latch: LatchState;
  readonly gatePassing: boolean;
  readonly hint: string;
}) {
  const reduced = useReducedMotion() ?? false;
  const byId = new Map(fired.map((item) => [item.rule.rule_id, item] as const));
  const standings = orderedStandings(latch, [...byId.keys()]).slice(0, MAX_VISIBLE);
  const heldCount = latch.confirmed.size + latch.captured.size;

  return (
    <section aria-labelledby="ticker-heading" className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="ticker-heading" className="font-display text-xs uppercase tracking-[0.22em] text-mount-glow">
          Rules firing
        </h2>
        <span className="font-display text-xs tabular-nums text-muted">{heldCount} held</span>
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
          className={`flex flex-col gap-2 transition-opacity ${gatePassing ? "opacity-100" : "opacity-50"}`}
        >
          <AnimatePresence initial={false}>
            {standings.map(({ ruleId, standing }) => {
              const item = byId.get(ruleId);
              if (item === undefined) return null;
              const source = item.rule.sources[0];
              const solid = standing === "confirmed";
              return (
                <motion.li
                  key={ruleId}
                  layout={!reduced}
                  initial={reduced ? { opacity: 0 } : { opacity: 0, x: 12 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={reduced ? { opacity: 0 } : { opacity: 0, x: -12 }}
                  transition={{ duration: reduced ? 0 : 0.22 }}
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
                    <span
                      className={`font-display text-[0.7rem] uppercase tracking-[0.18em] ${
                        standing === "captured" ? "text-line-glow/80" : "text-muted"
                      }`}
                    >
                      {STANDING_LABEL[standing]}
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
