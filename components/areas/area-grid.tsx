"use client";

/**
 * The five areas, and the panels they open.
 *
 * Owns the open/close state for both sheets so `ReadingView` only has to render one element. The
 * order is taken from the response rather than re-sorted: the API guarantees
 * dhan · rishte · karm · sehat · swabhav, and re-sorting by strength would put the reader's best
 * area first every time, which quietly turns a report into a scoreboard.
 *
 * `swabhav` spans the full width on the last row — not for balance, but because it is the largest
 * area by a wide margin (169 mapped rules against dhan's 19) and its card usually has the most in
 * it. A five-card grid has to give one card the odd slot; giving it to the fullest one is the least
 * arbitrary choice available.
 */
import { useCallback, useState } from "react";
import type { PublicAreaEvidence, PublicAreaVerdict } from "@/app/read/reading-types";
import { AreaCard } from "./area-card";
import { AreaDetail } from "./area-detail";
import { CitationDrawer } from "./citation-drawer";

export function AreaGrid({
  areas,
  readingId,
}: {
  readonly areas: readonly PublicAreaVerdict[];
  readonly readingId: string | null;
}) {
  const [openArea, setOpenArea] = useState<string | null>(null);
  const [openCite, setOpenCite] = useState<PublicAreaEvidence | null>(null);

  const open = useCallback((area: string) => setOpenArea(area), []);
  const closeArea = useCallback(() => {
    setOpenArea(null);
    setOpenCite(null);
  }, []);
  const closeCite = useCallback(() => setOpenCite(null), []);

  if (areas.length === 0) return null;

  const detail = areas.find((verdict) => verdict.area === openArea) ?? null;

  return (
    <section className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h2 className="font-display text-xl font-semibold tracking-tight text-ink sm:text-2xl">Jeevan ke paanch kshetra</h2>
        <p className="text-sm leading-6 text-muted">
          Har kshetra ke peeche uske apne sanket hain — khol ke dekho ki kis baat par aadharit hai.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {areas.map((verdict, index) => (
          <div key={verdict.area} className={index === areas.length - 1 ? "sm:col-span-2" : undefined}>
            <AreaCard verdict={verdict} onOpen={open} index={index} />
          </div>
        ))}
      </div>

      <AreaDetail verdict={detail} onCite={setOpenCite} onClose={closeArea} />
      <CitationDrawer item={openCite} readingId={readingId} onClose={closeCite} />
    </section>
  );
}
