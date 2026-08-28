"use client";

/**
 * One area, opened.
 *
 * **Why a sheet and not an inline expand.** The grid sits partway down a long report. Expanding a
 * card in place would reflow the four cards around it and push the rest of the reading below the
 * fold, so the reader loses their position to read one area. A sheet keeps the grid intact, is the
 * pattern this app already uses for the source drawer, and on a phone it is simply a full-height
 * panel — which is what a detail view wants to be there anyway. The citation drawer then stacks one
 * level above it, and dismissing it returns to this panel with the scroll position kept.
 *
 * **The conflict split is the point of the whole feature.** When an area's evidence points both
 * ways, the honest thing is to show both sides separately and say so — not to average them into a
 * lukewarm sentence. The engine cannot do this: `buildClusters` keys on `${category}::${polarity}`,
 * so opposing clusters never meet and neither is told about the other. This is the first surface in
 * the app where a reader sees the tension in their own hand laid out rather than resolved for them.
 *
 * **Sensitive rules carry no badge.** The engine already decided whether they were allowed through.
 * Marking them again would judge the same rule twice and would tell the reader their hand is
 * delicate, which is not this component's call to make.
 */
import Link from "next/link";
import type { PublicAreaEvidence, PublicAreaVerdict } from "@/app/read/reading-types";
import { DrawerShell } from "./drawer-shell";
import { EvidenceList } from "./evidence-list";
import { StrengthBar } from "./strength-bar";
import {
  BAND_COPY,
  CONFLICT_COPY,
  CONFLICT_SPLIT_GATE,
  DIRECTION_COPY,
  NEED_MORE_COPY,
  NO_DIRECTION_COPY,
  cardStateFor,
  directionChipClass,
  remainingSignals,
} from "./area-vocab";

const GROUP_COPY: Readonly<Record<string, string>> = {
  positive: "Anukool sanket",
  negative: "Sambhal ke chalne wale sanket",
  neutral: "Tatasth observations",
};

function group(evidence: readonly PublicAreaEvidence[], polarity: string): readonly PublicAreaEvidence[] {
  return evidence.filter((item) => item.polarity === polarity);
}

/*
 * No `readingId` here on purpose: feedback belongs to a single finding, not to a whole area, so the
 * thumbs live in the citation drawer where a specific rule_id is in hand.
 */
export function AreaDetail({
  verdict,
  onCite,
  onClose,
}: {
  readonly verdict: PublicAreaVerdict | null;
  readonly onCite: (item: PublicAreaEvidence) => void;
  readonly onClose: () => void;
}) {
  const split = verdict !== null && verdict.conflict >= CONFLICT_SPLIT_GATE;
  const state = verdict === null ? null : cardStateFor(verdict);

  return (
    <DrawerShell
      open={verdict !== null}
      onClose={onClose}
      titleId="area-detail-title"
      eyebrow="Jeevan kshetra"
      title={verdict?.label_hi_en ?? ""}
      closeLabel="Area panel band karo"
    >
      {verdict !== null ? (
        <>
          {/* ------------------------------- Header ------------------------------- */}
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center gap-2">
              {verdict.direction !== null ? (
                <span className={directionChipClass(verdict.direction)}>
                  {DIRECTION_COPY[verdict.direction] ?? verdict.direction}
                </span>
              ) : null}
              {state === "verdict" ? (
                <span className="font-display text-xs uppercase tracking-[0.18em] text-muted">
                  {BAND_COPY[verdict.band] ?? verdict.band}
                </span>
              ) : null}
            </div>

            {state === "need-more-data" ? (
              <p className="text-sm leading-6 text-muted">{NEED_MORE_COPY}</p>
            ) : state === "no-direction" ? (
              <p className="text-sm leading-6 text-muted">{NO_DIRECTION_COPY}</p>
            ) : null}

            <StrengthBar strength={verdict.strength} />
          </div>

          {/* ---------------------------- The tension ----------------------------- */}
          {split ? (
            <div className="flex items-start gap-3 rounded-xl border border-line-glow/30 bg-line-glow/5 p-4">
              <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-line-glow" aria-hidden="true" />
              <p className="text-sm leading-6 text-ink">
                {CONFLICT_COPY} — dono taraf ke sanket alag-alag niche diye hain.
              </p>
            </div>
          ) : null}

          {/* ------------------------------ Evidence ------------------------------ */}
          {split ? (
            <div className="flex flex-col gap-6">
              {(["positive", "negative", "neutral"] as const).map((polarity) => {
                const rows = group(verdict.evidence, polarity);
                if (rows.length === 0) return null;
                return (
                  <section key={polarity} className="flex flex-col gap-3">
                    <h3 className="font-display text-xs uppercase tracking-[0.18em] text-muted">
                      {GROUP_COPY[polarity]}
                      <span className="ml-2 tabular-nums text-ink">{rows.length}</span>
                    </h3>
                    <EvidenceList evidence={rows} onCite={onCite} />
                  </section>
                );
              })}
            </div>
          ) : (
            <EvidenceList evidence={verdict.evidence} onCite={onCite} />
          )}

          {/* ------------------------------- Upsell ------------------------------- */}
          {verdict.lockedEvidenceCount > 0 ? (
            <div className="flex flex-col gap-1 rounded-xl border border-dashed border-hairline p-4">
              <span className="font-display text-sm font-medium text-ink">
                <span className="tabular-nums">{verdict.lockedEvidenceCount}</span> aur sanket premium me
              </span>
              <span className="text-xs leading-5 text-muted">
                Inke source abhi bhi dikh rahe hain — vyakhya premium reading me khulti hai.
              </span>
            </div>
          ) : null}

          {state === "need-more-data" && remainingSignals(verdict) > 0 ? (
            <Link
              href="/scan"
              className="inline-flex items-center gap-2 self-start rounded-full border border-mount-glow/50 bg-mount-glow/10 px-4 py-2 font-display text-sm font-medium text-mount-glow transition-colors hover:bg-mount-glow/20"
            >
              Hatheli scan karo
              <span className="tabular-nums text-xs text-mount-glow/80">+{remainingSignals(verdict)} sanket</span>
            </Link>
          ) : null}
        </>
      ) : null}
    </DrawerShell>
  );
}
