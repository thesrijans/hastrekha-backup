"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import type { FiredRule } from "@/lib/hastrekha";
import { orderedStandings, type LatchState } from "@/lib/scan/latch";

const MAX_VISIBLE = 8;

/**
 * Rules firing beside the hand, as features become confident.
 *
 * Two states, not one. A *provisional* rule has fired at least once but has not held long enough to
 * be trusted; it is styled as unsettled and can still disappear. A *confirmed* rule has cleared the
 * latch and is committed to for the rest of the scan. That distinction is the whole point: an app
 * that shows someone a statement about their life and then silently withdraws it has done something
 * worse than showing nothing.
 */
export function LiveTicker({
  fired,
  latch,
}: {
  readonly fired: readonly FiredRule[];
  readonly latch: LatchState;
}) {
  const reduced = useReducedMotion() ?? false;
  const byId = new Map(fired.map((item) => [item.rule.rule_id, item] as const));
  const standings = orderedStandings(latch, [...byId.keys()]).slice(0, MAX_VISIBLE);
  const confirmedCount = latch.confirmed.size;

  return (
    <section aria-labelledby="ticker-heading" className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between">
        <h2 id="ticker-heading" className="font-display text-xs uppercase tracking-[0.22em] text-mount-glow">
          Rules firing
        </h2>
        <span className="font-display text-xs tabular-nums text-muted">{confirmedCount} confirmed</span>
      </div>

      {standings.length === 0 ? (
        <p className="rounded-xl border border-dashed border-hairline px-4 py-6 text-center text-sm text-muted">
          Hatheli seedhi rakho — rules yahan aayenge.
        </p>
      ) : (
        // aria-live on the list: a screen reader hears each rule as it commits, not on every frame.
        <ul aria-live="polite" className="flex flex-col gap-2">
          <AnimatePresence initial={false}>
            {standings.map(({ ruleId, standing }) => {
              const item = byId.get(ruleId);
              if (item === undefined) return null;
              const source = item.rule.sources[0];
              const confirmed = standing === "confirmed";
              return (
                <motion.li
                  key={ruleId}
                  layout={!reduced}
                  initial={reduced ? { opacity: 0 } : { opacity: 0, x: 12 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={reduced ? { opacity: 0 } : { opacity: 0, x: -12 }}
                  transition={{ duration: reduced ? 0 : 0.22 }}
                  className={`rounded-xl border px-4 py-3 transition-colors ${
                    confirmed ? "border-hairline bg-surface" : "border-dashed border-hairline/70 bg-transparent"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span
                      aria-hidden="true"
                      className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                        confirmed ? "hr-glow-chrome bg-mount-glow" : "animate-pulse bg-muted"
                      }`}
                    />
                    <span className="font-display text-[0.7rem] uppercase tracking-[0.18em] text-muted">
                      {item.rule.category}
                    </span>
                    <span className="font-display text-[0.7rem] uppercase tracking-[0.18em] text-muted">
                      {confirmed ? "· confirmed" : "· checking"}
                    </span>
                  </div>
                  <p className={`mt-1.5 text-sm leading-6 ${confirmed ? "text-ink" : "text-muted"}`}>
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
