"use client";

/**
 * One life area, at a glance. Three cards, not one card with three severities.
 *
 * The third state is the one that matters. When an area has too little behind it the card does not
 * apologise and does not show a greyed-out zero — it says plainly that nothing can be called yet and
 * offers the scan. A DOB-only reading lands `dhan` here every single time, by construction: the map
 * measured exactly one money rule reachable from a birth date. That card is the conversion surface,
 * so it is styled as an invitation rather than an error.
 */
import Link from "next/link";
import { motion, useReducedMotion } from "framer-motion";
import type { PublicAreaVerdict } from "@/app/read/reading-types";
import { StrengthBar } from "./strength-bar";
import {
  BAND_COPY,
  DIRECTION_COPY,
  NEED_MORE_COPY,
  NO_DIRECTION_COPY,
  cardStateFor,
  directionChipClass,
  remainingSignals,
  totalEvidence,
} from "./area-vocab";

/** Card entry easing, matching the toast and ticker entries elsewhere in the app. */
const ENTRY_EASE: readonly [number, number, number, number] = [0.16, 1, 0.3, 1];

/** The solid card idiom from reading-view.tsx — dashed is reserved for upsell surfaces. */
const CARD_BASE = "flex h-full flex-col gap-4 rounded-2xl border border-hairline bg-surface p-5 text-left";

export function AreaCard({
  verdict,
  onOpen,
  index = 0,
}: {
  readonly verdict: PublicAreaVerdict;
  readonly onOpen: (area: string) => void;
  /** Stagger position in the grid. */
  readonly index?: number;
}) {
  const reduced = useReducedMotion() ?? false;
  const state = cardStateFor(verdict);
  const shown = totalEvidence(verdict);

  const entry = reduced
    ? { initial: { opacity: 1 }, animate: { opacity: 1 }, transition: { duration: 0 } }
    : {
        initial: { opacity: 0, y: 8 },
        animate: { opacity: 1, y: 0 },
        transition: { duration: 0.36, delay: index * 0.05, ease: ENTRY_EASE },
      };

  /* ------------------------- Not enough to say anything ------------------------- */
  if (state === "need-more-data") {
    const more = remainingSignals(verdict);
    return (
      <motion.article {...entry} className={CARD_BASE}>
        <h3 className="font-display text-lg font-semibold tracking-tight text-ink">{verdict.label_hi_en}</h3>
        <p className="text-sm leading-6 text-muted">{NEED_MORE_COPY}</p>
        {/*
         * No strength, no direction, no band — showing a 0% bar here would be a claim about the
         * palm rather than about how little we were given.
         */}
        <Link
          href="/scan"
          className="mt-auto inline-flex items-center gap-2 rounded-full border border-mount-glow/50 bg-mount-glow/10 px-4 py-2 font-display text-sm font-medium text-mount-glow transition-colors hover:bg-mount-glow/20"
        >
          Hatheli scan karo
          {more > 0 ? <span className="tabular-nums text-xs text-mount-glow/80">+{more} sanket</span> : null}
        </Link>
        {more > 0 ? (
          <p className="text-xs leading-5 text-muted">
            Scan se is hisse me <span className="tabular-nums text-ink">{more}</span> aur sanket khul sakte hain.
          </p>
        ) : null}
      </motion.article>
    );
  }

  /* ------------------------------ Real evidence ------------------------------- */
  const noDirection = state === "no-direction";
  return (
    <motion.article {...entry} className={CARD_BASE}>
      <div className="flex items-start justify-between gap-3">
        <h3 className="font-display text-lg font-semibold tracking-tight text-ink">{verdict.label_hi_en}</h3>
        {noDirection ? null : (
          <span className={directionChipClass(verdict.direction)}>
            {DIRECTION_COPY[verdict.direction ?? ""] ?? verdict.direction}
          </span>
        )}
      </div>

      {noDirection ? (
        <p className="text-sm leading-6 text-muted">{NO_DIRECTION_COPY}</p>
      ) : (
        <span className="font-display text-xs uppercase tracking-[0.18em] text-muted">
          {BAND_COPY[verdict.band] ?? verdict.band}
        </span>
      )}

      <StrengthBar strength={verdict.strength} compact />

      <div className="mt-auto flex items-center justify-between gap-3 pt-1">
        <span className="text-xs text-muted">
          <span className="tabular-nums text-ink">{shown}</span> sanket
        </span>
        <button
          type="button"
          onClick={() => onOpen(verdict.area)}
          className="font-display text-sm font-medium text-mount-glow transition-opacity hover:opacity-80"
        >
          Padho →
        </button>
      </div>
    </motion.article>
  );
}
