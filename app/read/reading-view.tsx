"use client";

import Link from "next/link";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { HoloPalm } from "@/components/holo-palm";
import { ShareCard } from "@/components/share-card";
import type { FeedbackState, PublicRule, ReadingResponse, Verdict } from "./reading-types";

/** Anchored pricing on the upgrade card. Nothing is purchasable yet. */
const PRICE_ANCHOR_INR = 199;
const PRICE_NOW_INR = 99;

const PREMIUM_PERKS: readonly string[] = [
  "Har category khulti hai — career, rishte, paisa, timing, rukawatein",
  "Har baat ke saath uska classical source aur page",
  "Apna sawaal poocho — reading usi ke aas-paas bunni jaati hai",
  "Remedies aur aage ke phases ki timing",
];

const VERDICTS: ReadonlyArray<{ readonly value: Verdict; readonly label: string }> = [
  { value: "ACCURATE", label: "Accurate" },
  { value: "PARTLY", label: "Partly" },
  { value: "WRONG", label: "Wrong" },
];

/* ------------------------------ Depth meter ------------------------------- */

/**
 * Radial confidence meter.
 *
 * `pathLength={1}` normalises the circle so the dash array is just the ratio — no circumference
 * arithmetic to drift if the radius ever changes.
 */
function DepthMeter({ confidence }: { readonly confidence: number }) {
  const uid = useId();
  const value = Math.min(1, Math.max(0, confidence));
  const percent = Math.round(value * 100);

  return (
    <figure className="flex items-center gap-5">
      <svg
        viewBox="0 0 100 100"
        className="hr-glow-mount h-24 w-24 shrink-0 -rotate-90"
        role="img"
        aria-label={`Reading depth ${percent} percent`}
      >
        <defs>
          <linearGradient id={`${uid}-arc`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="var(--color-mount-glow)" />
            <stop offset="100%" stopColor="var(--color-mount-glow)" stopOpacity="0.55" />
          </linearGradient>
        </defs>
        <circle cx="50" cy="50" r="42" fill="none" stroke="var(--color-hairline)" strokeWidth="6" />
        <circle
          cx="50"
          cy="50"
          r="42"
          fill="none"
          stroke={`url(#${uid}-arc)`}
          strokeWidth="6"
          strokeLinecap="round"
          pathLength={1}
          strokeDasharray={`${value} 1`}
        />
      </svg>
      <figcaption className="flex flex-col gap-1">
        <span className="font-display text-3xl font-semibold tracking-tight text-ink">{percent}%</span>
        <span className="font-display text-xs uppercase tracking-[0.22em] text-mount-glow">Scan depth</span>
        <span className="text-xs text-muted">Jitne features doge, utna badhta hai.</span>
      </figcaption>
    </figure>
  );
}

/* ------------------------------ Source drawer ------------------------------ */

function SourceDrawer({ rule, onClose }: { readonly rule: PublicRule | null; readonly onClose: () => void }) {
  const reduced = useReducedMotion() ?? false;
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const open = rule !== null;

  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {rule !== null ? (
        <>
          <motion.div
            key="backdrop"
            className="fixed inset-0 z-[60] bg-night/80 backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reduced ? 0 : 0.18 }}
            onClick={onClose}
            aria-hidden="true"
          />
          <motion.aside
            key="drawer"
            role="dialog"
            aria-modal="true"
            aria-labelledby="source-drawer-title"
            className="fixed inset-y-0 right-0 z-[61] flex w-full max-w-md flex-col gap-5 overflow-y-auto border-l border-hairline bg-surface p-6"
            initial={reduced ? { opacity: 0 } : { x: "100%" }}
            animate={reduced ? { opacity: 1 } : { x: 0 }}
            exit={reduced ? { opacity: 0 } : { x: "100%" }}
            transition={{ duration: reduced ? 0 : 0.28, ease: [0.32, 0.72, 0, 1] }}
          >
            <div className="flex items-start justify-between gap-4">
              <div className="flex flex-col gap-1">
                <span className="font-display text-xs uppercase tracking-[0.22em] text-line-glow">Source</span>
                <h2 id="source-drawer-title" className="font-display text-xl font-semibold tracking-tight text-ink">
                  {rule.rule_id}
                </h2>
              </div>
              <button
                ref={closeRef}
                type="button"
                onClick={onClose}
                aria-label="Source panel band karo"
                className="rounded-full border border-hairline p-2 text-ink transition-colors hover:border-mount-glow hover:text-mount-glow"
              >
                <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round">
                  <path d="M6 6l12 12M18 6L6 18" />
                </svg>
              </button>
            </div>

            <p className="text-base leading-7 text-ink">{rule.interpretation_hi_en}</p>

            <dl className="flex flex-col gap-4 border-t border-hairline pt-5 text-sm">
              <div className="flex flex-col gap-1">
                <dt className="font-display text-xs uppercase tracking-[0.18em] text-muted">Citation</dt>
                <dd className="text-ink">{rule.source === "" ? "Source recorded nahi hai." : rule.source}</dd>
              </div>
              <div className="flex flex-col gap-1">
                <dt className="font-display text-xs uppercase tracking-[0.18em] text-muted">Category</dt>
                <dd className="text-ink">
                  {rule.category} · {rule.polarity}
                </dd>
              </div>
              <div className="flex flex-col gap-1">
                <dt className="font-display text-xs uppercase tracking-[0.18em] text-muted">Weight</dt>
                <dd className="tabular-nums text-ink">{rule.weight.toFixed(2)}</dd>
              </div>
              {rule.tags.length > 0 ? (
                <div className="flex flex-col gap-2">
                  <dt className="font-display text-xs uppercase tracking-[0.18em] text-muted">Tags</dt>
                  <dd className="flex flex-wrap gap-2">
                    {rule.tags.map((tag) => (
                      <span key={tag} className="rounded-full border border-hairline px-2.5 py-0.5 text-xs text-muted">
                        {tag}
                      </span>
                    ))}
                  </dd>
                </div>
              ) : null}
            </dl>
          </motion.aside>
        </>
      ) : null}
    </AnimatePresence>
  );
}

/* ------------------------------ Reading view ------------------------------ */

export function ReadingView({
  reading,
  mounts,
  lines,
  feedback,
  onFeedback,
  onRestart,
}: {
  readonly reading: ReadingResponse;
  /** What the user actually reported, so the report palm shows their scan and not a default one. */
  readonly mounts: Record<string, number>;
  /** Polylines traced from the user's own palm, already in HoloPalm's viewBox. */
  readonly lines?: Readonly<Record<string, ReadonlyArray<readonly [number, number]>>>;
  readonly feedback: Record<number, FeedbackState>;
  readonly onFeedback: (readingId: string, sectionIndex: number, ruleIds: readonly string[], verdict: Verdict) => Promise<void>;
  readonly onRestart: () => void;
}) {
  const [openRule, setOpenRule] = useState<PublicRule | null>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  const rulesById = useMemo(() => new Map(reading.rules.map((rule) => [rule.rule_id, rule] as const)), [reading.rules]);

  /**
   * Per section, the strongest cluster citing any of its rules. Clusters carry how many distinct
   * source books agree, which is the honest version of a confidence badge.
   */
  const agreementFor = useCallback(
    (ruleIds: readonly string[]): number => {
      const ids = new Set(ruleIds);
      let best = 0;
      for (const cluster of reading.clusters) {
        if (cluster.rule_ids.some((id) => ids.has(id))) best = Math.max(best, cluster.agreement);
      }
      return best;
    },
    [reading.clusters],
  );

  const openSource = useCallback((rule: PublicRule, trigger: HTMLElement) => {
    returnFocusRef.current = trigger;
    setOpenRule(rule);
  }, []);

  // Send focus back where it came from, or the drawer strands the user at the top of the document.
  const closeSource = useCallback(() => {
    setOpenRule(null);
    returnFocusRef.current?.focus();
    returnFocusRef.current = null;
  }, []);

  const topRule = reading.rules[0];
  const missingCount = reading.coverage.missing.length;
  const { readingId } = reading;

  return (
    <div className="flex flex-col gap-12">
      {/* ------------------------------ Scan header ------------------------------ */}
      <header className="flex flex-col items-center gap-6">
        <span className="font-display text-xs uppercase tracking-[0.22em] text-mount-glow">Scan report</span>
        <div className="w-full max-w-[15rem]">
          <HoloPalm mounts={mounts} lines={lines} animate />
        </div>
      </header>

      <article className="flex flex-col gap-6 border-l border-line-glow/60 pl-5 sm:pl-7">
        <h2 className="font-display text-2xl font-semibold leading-[1.18] tracking-tight text-ink sm:text-4xl">
          {reading.narration.one_liner}
        </h2>
        <div className="flex flex-wrap items-center gap-4">
          {topRule !== undefined ? (
            <ShareCard headline={topRule.interpretation_hi_en} source={topRule.source} mounts={mounts} />
          ) : null}
          <button
            type="button"
            onClick={onRestart}
            className="rounded-full border border-hairline px-4 py-2 font-display text-sm font-medium text-muted transition-colors hover:border-mount-glow hover:text-ink"
          >
            Naya scan
          </button>
        </div>
      </article>

      <div className="border-y border-hairline py-6">
        <DepthMeter confidence={reading.confidence} />
      </div>

      <div className="flex flex-col gap-10">
        {reading.narration.sections.map((section, index) => {
          const state = feedback[index];
          const agreement = agreementFor(section.rule_ids);
          return (
            <article key={`${section.title}-${index}`} className="flex flex-col gap-4">
              <div className="flex flex-wrap items-center gap-3">
                <h3 className="font-display text-xl font-semibold tracking-tight text-ink sm:text-2xl">{section.title}</h3>
                {agreement >= 2 ? (
                  <span className="rounded-full border border-mount-glow/40 bg-mount-glow/10 px-3 py-1 font-display text-xs font-medium tracking-tight text-mount-glow">
                    {agreement} texts agree
                  </span>
                ) : null}
              </div>

              <p className="max-w-2xl text-base leading-8 text-ink/85">{section.body}</p>

              {section.rule_ids.length > 0 ? (
                <ul className="flex flex-wrap gap-2">
                  {section.rule_ids.map((ruleId) => {
                    const rule = rulesById.get(ruleId);
                    if (rule === undefined) return null;
                    return (
                      <li key={ruleId}>
                        <button
                          type="button"
                          onClick={(event) => openSource(rule, event.currentTarget)}
                          aria-haspopup="dialog"
                          className="rounded-full border border-line-glow/40 px-3 py-1 text-xs text-line-glow transition-colors hover:border-line-glow hover:bg-line-glow/10"
                        >
                          {rule.source === "" ? ruleId : `Source: ${rule.source}`}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              ) : null}

              {readingId !== null ? (
                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <span id={`verdict-${index}`} className="text-xs text-muted">
                    Yeh kitna sahi laga?
                  </span>
                  {VERDICTS.map((option) => {
                    const chosen = state?.status === "done" && state.verdict === option.value;
                    return (
                      <button
                        key={option.value}
                        type="button"
                        aria-describedby={`verdict-${index}`}
                        aria-pressed={chosen}
                        disabled={state?.status === "saving"}
                        onClick={() => void onFeedback(readingId, index, section.rule_ids, option.value)}
                        className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors disabled:opacity-50 ${
                          chosen
                            ? "border-mount-glow bg-mount-glow/12 text-mount-glow"
                            : "border-hairline text-muted hover:border-mount-glow/50 hover:text-ink"
                        }`}
                      >
                        {option.label}
                      </button>
                    );
                  })}
                  {state?.status === "saving" ? <span className="text-xs text-muted">Save ho raha hai…</span> : null}
                  {state?.status === "done" ? <span className="text-xs text-muted">Shukriya.</span> : null}
                  {state?.status === "error" ? (
                    <span role="alert" className="text-xs text-line-glow">
                      Save nahi hua — dobara try karo.
                    </span>
                  ) : null}
                </div>
              ) : null}
            </article>
          );
        })}
      </div>

      {missingCount > 0 ? (
        <article className="flex flex-col items-start gap-3 rounded-2xl border border-dashed border-hairline p-6">
          <h3 className="font-display text-xl font-semibold tracking-tight text-ink">
            Palm scan se +{missingCount} unlock
          </h3>
          <p className="max-w-xl text-sm leading-6 text-muted">
            Tumhari hatheli ka scan {missingCount} aur features bhar dega — depth meter utna hi upar jaayega. Scan
            tumhare device par hi chalega, image kabhi upload nahi hoti.
          </p>
          <button
            type="button"
            disabled
            className="cursor-not-allowed rounded-full border border-hairline px-4 py-2 font-display text-sm font-medium text-muted opacity-70"
          >
            Palm scan — coming soon
          </button>
        </article>
      ) : null}

      {reading.lockedRuleCount > 0 ? (
        <article className="flex flex-col items-start gap-4 rounded-2xl border border-hairline bg-surface p-6">
          <h3 className="font-display text-xl font-semibold tracking-tight text-ink sm:text-2xl">
            {reading.lockedRuleCount} aur rules tumhare liye nikle hain
          </h3>
          <ul className="flex flex-col gap-2">
            {PREMIUM_PERKS.map((perk) => (
              <li key={perk} className="flex items-start gap-2.5 text-sm leading-6 text-muted">
                <svg
                  viewBox="0 0 20 20"
                  className="mt-1 h-4 w-4 shrink-0 text-mount-glow"
                  aria-hidden="true"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={1.75}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M4 10.5l4 4 8-9" />
                </svg>
                {perk}
              </li>
            ))}
          </ul>
          <p className="flex items-baseline gap-3">
            <s className="text-muted">₹{PRICE_ANCHOR_INR}</s>
            <span className="font-display text-3xl font-semibold tracking-tight text-ink">₹{PRICE_NOW_INR}</span>
          </p>
          <button
            type="button"
            disabled
            className="cursor-not-allowed rounded-full bg-mount-glow px-5 py-2.5 font-display text-sm font-semibold text-night opacity-70"
          >
            Premium — coming soon
          </button>
        </article>
      ) : null}

      <p className="max-w-2xl text-xs leading-6 text-muted">
        {reading.narration.disclaimer}{" "}
        <Link href="/terms" className="underline underline-offset-4 hover:text-ink">
          Terms
        </Link>
        .
      </p>

      <SourceDrawer rule={openRule} onClose={closeSource} />
    </div>
  );
}
