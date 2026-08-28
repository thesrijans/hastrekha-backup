"use client";

/**
 * The rows behind an area verdict — the reason this feature is worth anything.
 *
 * Structurally the same card list `LiveTicker` renders during a scan, with the ticker's motion taken
 * out: this is a settled list being read, not a feed being watched, and cards that slide while
 * someone is trying to read them are noise.
 *
 * Two rules the row layout enforces:
 *
 * **A locked row still shows its citation.** The free tier receives the source and not the reading,
 * so the row renders a blurred placeholder over real provenance. That is the honest version of a
 * paywall — it proves the finding exists rather than hinting that it might.
 *
 * **A sensitive rule gets no badge.** The engine already decided whether it was allowed through
 * (`includeSensitive` per tier); flagging it again in the UI would be judging it twice and would
 * mark the reader's own hand as delicate.
 */
import { motion, useReducedMotion } from "framer-motion";
import type { PublicAreaEvidence } from "@/app/read/reading-types";
import { citationChip } from "./area-vocab";

const ENTRY_EASE: readonly [number, number, number, number] = [0.16, 1, 0.3, 1];

/** Polarity dot colour. Neutral is deliberately the same muted as the hairline — it leans nowhere. */
function dotClass(polarity: string): string {
  if (polarity === "positive") return "bg-mount-glow";
  if (polarity === "negative") return "bg-line-glow";
  return "bg-muted";
}

export function EvidenceList({
  evidence,
  onCite,
  emptyCopy = "Is hisse me abhi koi sanket nahi mila.",
}: {
  readonly evidence: readonly PublicAreaEvidence[];
  readonly onCite: (item: PublicAreaEvidence) => void;
  readonly emptyCopy?: string;
}) {
  const reduced = useReducedMotion() ?? false;

  if (evidence.length === 0) {
    return <p className="text-sm leading-6 text-muted">{emptyCopy}</p>;
  }

  return (
    <ul className="flex flex-col gap-3">
      {evidence.map((item, index) => {
        const locked = item.interpretation_hi_en === undefined;
        const source = item.sources[0];
        return (
          <motion.li
            key={item.rule_id}
            initial={reduced ? { opacity: 1 } : { opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: reduced ? 0 : 0.3, delay: reduced ? 0 : index * 0.04, ease: ENTRY_EASE }}
            className="flex flex-col gap-2 rounded-xl border border-hairline bg-night/40 p-4"
          >
            <div className="flex items-start gap-3">
              <span className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${dotClass(item.polarity)}`} aria-hidden="true" />
              {locked ? (
                <div className="flex flex-1 flex-col gap-2">
                  {/* A real shape, blurred — not a teaser bar. The finding exists; the words are paid. */}
                  <span className="select-none text-sm leading-6 text-muted/70 blur-[3px]" aria-hidden="true">
                    Is sanket ki poori vyakhya premium reading me khulti hai aur uska matlab wahan vistaar se.
                  </span>
                  <span className="flex items-center gap-1.5 font-display text-[0.65rem] uppercase tracking-[0.16em] text-muted">
                    <svg viewBox="0 0 24 24" className="h-3 w-3" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth={2}>
                      <rect x="5" y="11" width="14" height="9" rx="2" />
                      <path d="M8 11V8a4 4 0 1 1 8 0v3" />
                    </svg>
                    Premium me khulta hai
                  </span>
                </div>
              ) : (
                <p className="flex-1 text-sm leading-6 text-ink">{item.interpretation_hi_en}</p>
              )}
            </div>

            {source !== undefined ? (
              <button
                type="button"
                onClick={() => onCite(item)}
                className="self-start rounded-full border border-hairline px-2.5 py-0.5 text-xs text-muted transition-colors hover:border-line-glow hover:text-line-glow"
              >
                {citationChip(source)}
              </button>
            ) : null}
          </motion.li>
        );
      })}
    </ul>
  );
}
