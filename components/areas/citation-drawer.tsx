"use client";

/**
 * Where a finding came from, and a way to say whether it landed.
 *
 * This is the surface the structured `sources[]` was fought for. The legacy `PublicRule.source`
 * pre-joins a rule's sources into one string and drops everything after the first, which is why the
 * existing source drawer can only print a sentence. Area evidence carries the array whole, so this
 * renders each book, its year, and the locus separately — and renders ALL of them when a rule cites
 * more than one, which in the shipped KB is exactly one rule.
 *
 * The footer is fixed copy, and it is the most important text in the feature: it names the book and
 * says plainly that this is reflection rather than prophecy. It is not configurable per area.
 *
 * Feedback posts to the existing `/api/reading/feedback` route, which is rate limited to 30/60s and
 * takes ACCURATE | PARTLY | WRONG. `readingId` is nullable — persistence is best-effort, so a
 * reading that failed to save simply has no thumbs rather than a broken button.
 */
import { useState } from "react";
import type { PublicAreaEvidence, Verdict } from "@/app/read/reading-types";
import { DrawerShell } from "./drawer-shell";

const VERDICTS: ReadonlyArray<{ readonly value: Verdict; readonly label: string }> = [
  { value: "ACCURATE", label: "Sahi" },
  { value: "PARTLY", label: "Thoda sahi" },
  { value: "WRONG", label: "Galat" },
];

type Sent = { readonly status: "idle" } | { readonly status: "saving" } | { readonly status: "done" } | { readonly status: "error" };

/** The book name without its trailing subtitle — "Cheiro — Palmistry for All" reads long in a footer. */
function bookName(text: string): string {
  return text.split("—")[0].trim();
}

export function CitationDrawer({
  item,
  readingId,
  onClose,
}: {
  readonly item: PublicAreaEvidence | null;
  /** Null when the reading could not be persisted; feedback is unavailable in that case. */
  readonly readingId: string | null;
  readonly onClose: () => void;
}) {
  const [sent, setSent] = useState<Sent>({ status: "idle" });

  const send = async (verdict: Verdict) => {
    if (item === null || readingId === null) return;
    setSent({ status: "saving" });
    try {
      const response = await fetch("/api/reading/feedback", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ readingId, ruleIds: [item.rule_id], verdict }),
      });
      setSent(response.ok ? { status: "done" } : { status: "error" });
    } catch {
      setSent({ status: "error" });
    }
  };

  const primary = item?.sources[0];

  return (
    <DrawerShell
      open={item !== null}
      onClose={onClose}
      titleId="citation-drawer-title"
      eyebrow="Citation"
      title={item?.rule_id ?? ""}
      closeLabel="Citation panel band karo"
      level="over"
    >
      {item !== null ? (
        <>
          {item.interpretation_hi_en !== undefined ? (
            <p className="text-base leading-7 text-ink">{item.interpretation_hi_en}</p>
          ) : (
            <p className="text-sm leading-6 text-muted">
              Is sanket ki vyakhya premium reading me khulti hai. Source niche hai — dekh lo ki yeh kahan se aaya.
            </p>
          )}

          <dl className="flex flex-col gap-5 border-t border-hairline pt-5 text-sm">
            {item.sources.map((source, index) => (
              <div key={`${source.text}-${index}`} className="flex flex-col gap-1.5">
                <dt className="font-display text-xs uppercase tracking-[0.18em] text-muted">
                  {item.sources.length > 1 ? `Source ${index + 1}` : "Source"}
                </dt>
                <dd className="flex flex-col gap-1">
                  <span className="text-ink">
                    {bookName(source.text)}
                    {source.year !== null ? <span className="text-muted"> ({source.year})</span> : null}
                  </span>
                  <span className="text-xs leading-5 text-muted">{source.loc}</span>
                </dd>
              </div>
            ))}
          </dl>

          {readingId !== null ? (
            <div className="flex flex-col gap-2 border-t border-hairline pt-5">
              <span className="font-display text-xs uppercase tracking-[0.18em] text-muted">Yeh baat kaisi lagi?</span>
              <div className="flex flex-wrap items-center gap-2">
                {VERDICTS.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    disabled={sent.status === "saving" || sent.status === "done"}
                    onClick={() => void send(option.value)}
                    className="rounded-full border border-hairline px-3 py-1.5 font-display text-xs font-medium text-muted transition-colors hover:border-mount-glow hover:text-ink disabled:opacity-50"
                  >
                    {option.label}
                  </button>
                ))}
                {sent.status === "saving" ? <span className="text-xs text-muted">Save ho raha hai…</span> : null}
                {sent.status === "done" ? <span className="text-xs text-muted">Shukriya.</span> : null}
                {sent.status === "error" ? (
                  <span role="alert" className="text-xs text-line-glow">
                    Save nahi hua — dobara try karo.
                  </span>
                ) : null}
              </div>
            </div>
          ) : null}

          <p className="mt-auto border-t border-hairline pt-5 text-xs leading-6 text-muted">
            Yeh vyakhya {primary === undefined ? "classical palmistry texts" : bookName(primary.text)} se hai.
            Manoranjan aur atma-chintan ke liye — bhavishyavani nahi.
          </p>
        </>
      ) : null}
    </DrawerShell>
  );
}
