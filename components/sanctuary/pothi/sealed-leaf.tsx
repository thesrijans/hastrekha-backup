import Link from "next/link";
import type { ReactElement } from "react";
import { Parchment, WaxSeal } from "@/components/sanctuary/material";
import type { WaxEmblem } from "@/components/sanctuary/material";
import type { CapabilityTier } from "@/components/sanctuary/use-capability-tier";
import type { SealReason } from "@/lib/sanctuary/pothi-chapters";
import styles from "./sealed-leaf.module.css";

/**
 * ============================================================================
 * <SealedLeaf> — THE LEAF THAT DID NOT OPEN, AND SAYS SO.
 * ============================================================================
 *
 * WHAT THIS COMPONENT IS FOR, STATED AS THE FAILURE IT REPLACES.
 *
 * A2 is the product: a confident-looking empty state is the failure this whole build exists to
 * prevent. Every other way of handling absent data — a placeholder sentence, a greyed card, a
 * skeleton that never resolves, a hedge like "your Sun line suggests balance" — puts something in
 * front of a reader that is indistinguishable, to that reader, from a real finding. This component
 * is the only alternative the Pothi has: it renders the ABSENCE as a finished object, and it names
 * the actual cause in the reader's own language.
 *
 * It therefore invents NOTHING. Every string it prints is either the one fixed Devanagari line
 * below ({@link SEALED_LEAF_UNOPENED_HI}, which is a statement about this leaf and not about the
 * reader's hand) or a field of the {@link SealReason} it was handed by
 * lib/sanctuary/pothi-chapters.ts, where each detail is derived from the response it describes.
 * `test/pothi-sealed-leaf.test.ts` strips the markup back to visible text, removes those known
 * strings, and asserts that what is left contains no letters at all — which is the machine-checkable
 * form of "this leaf claims no reading".
 *
 * THE ONE DECISION THAT SEPARATES HONESTY FROM A DARK PATTERN.
 *
 * The rescan button renders if and only if `reason.capture` exists. Chapter VII is sealed because
 * mounts are NEVER measured — /scan sends an empty mount bag and no rescan can change that — so its
 * seal carries no capture instruction and this leaf must not offer a button. Inviting someone to
 * scan again for a thing the scanner cannot see spends their attention on an outcome we already
 * know is impossible; it is the same lie as inventing the reading, wearing a helpful face. The gate
 * lives in exactly one place ({@link sealedLeafRescanHref}) so it cannot be half-applied, and the
 * test asserts it in both directions.
 *
 * WHY THERE IS NO `"use client"` HERE.
 *
 * Because there is no state, no effect and no handler. The composition is a pure function of its
 * props: `next/link` renders an `<a>` on the server, `<Parchment>` and `<WaxSeal>` are themselves
 * server components computed from `seed`, and the only interactivity — hover and focus on the link
 * — is CSS. A sealed leaf is the page a reader sees when something is MISSING; making them
 * download a bundle to be told so would be its own small insult.
 *
 * WHAT WAS CONSIDERED AND REMOVED.
 *
 * An <OrnamentalDivider /> between the wax and the ink, and an <AncientCorner /> set on the leaf.
 * Both are correct in this language and both made the leaf louder than the sentence it exists to
 * deliver. §7's rule — if a refinement adds an effect, ask whether removing something would work
 * better — resolves this one: the composition is blank leaf, wax, ink, air. Nothing else.
 */

/**
 * The single fixed line, and the only string in this file that is not derived from the response.
 *
 * It is safe to fix precisely because it says nothing about the reader: "this leaf has not opened
 * yet" is a fact about the book. The moment a constant sentence starts describing a HAND it becomes
 * the placeholder A2 forbids, which is why the sentence underneath it is always
 * {@link SealReason.detail} and never a second constant.
 *
 * Exported so a route, a test and this component all read one string. The final mark is U+0964
 * DEVANAGARI DANDA — the full stop this script actually uses; a Latin period here would fall out of
 * the Tiro face mid-sentence.
 */
export const SEALED_LEAF_UNOPENED_HI = "यह पत्ता अभी खुला नहीं।";

/** The rescan link's visible label, in the same Devanagari voice as the line above it. */
export const SEALED_LEAF_RESCAN_LABEL = "दोबारा स्कैन करें";

/** Where the rescan link goes. /scan is the live scanner; nothing else can refill a measured gap. */
export const SEALED_LEAF_RESCAN_PATH = "/scan";

/**
 * The query parameter that carries WHICH seal sent the reader to the scanner.
 *
 * THE MECHANISM, STATED PLAINLY: the link is `/scan?rescan=<SealReason.code>` — a stable machine
 * code from `SEAL_CODES`, never the capture sentence itself. Three reasons, and the third is the
 * one that decides it:
 *
 *   1. `capture` is DERIVED text. It quotes counts and key names from this particular response
 *      ("dobara scan karein — lines.heart aur 3 aur isi scan se aati hain"), so putting it in a URL
 *      would mint a different URL for every reading — unshareable, unloggable, uncacheable.
 *   2. A code is a closed set. /scan can switch on `line_unread` versus `area_insufficient` and give
 *      a different framing; it cannot switch on a paragraph.
 *   3. PRIVACY. That paragraph names which of the reader's features came back empty. A query string
 *      travels in history, in a `Referer` header and in any log the next request touches. The
 *      instruction belongs on the leaf, in front of the reader — which is where this component
 *      renders it — and not in a URL.
 *
 * Stated rather than implied: /scan reads no query parameter today, so this is provenance and not
 * yet behaviour. It is inert, not misleading — the link's promise to the reader is "this takes you
 * to the scanner", and it keeps that promise exactly.
 */
export const SEALED_LEAF_RESCAN_PARAM = "rescan";

/**
 * The rescan destination for a seal, or `null` when a rescan cannot help.
 *
 * The `null` is the whole point and is why this is a function rather than a template inlined at the
 * call site: the decision "may this leaf offer a button?" is one expression, in one place, that both
 * the component and the test read. A caller that wants to place its own control asks this the same
 * question and gets the same answer.
 */
export function sealedLeafRescanHref(reason: SealReason): string | null {
  if (reason.capture === undefined) return null;
  return `${SEALED_LEAF_RESCAN_PATH}?${SEALED_LEAF_RESCAN_PARAM}=${encodeURIComponent(reason.code)}`;
}

/**
 * Rendered width of the wax, in CSS pixels.
 *
 * Large enough to be the leaf's subject rather than a badge in a corner, small enough that the
 * emblem pressed into it stays legible at the 100-unit viewBox the seal is drawn in. A seal at 48px
 * reads as a status dot, which is precisely the SaaS empty-state register this component refuses.
 */
const WAX_SIZE_PX = 104;

/**
 * Added to the leaf's `seed` before it reaches the wax, so the tear and the blob are drawn from
 * DIFFERENT streams of the same generator.
 *
 * The same reasoning as `ANGULAR_SEED_OFFSET` inside <WaxSeal>: with one stream, the leaf whose
 * upper edge is bitten deepest would also always be the leaf whose wax bulges furthest in the same
 * direction. No single leaf looks wrong, and a page of them shares a signature the eye picks up
 * without being able to name it.
 */
const WAX_SEED_OFFSET = 619;

/** Everything a sealed leaf needs. Placement and width belong to whoever lays the page out. */
export interface SealedLeafProps {
  /**
   * Why this leaf did not open, straight from `resolveChapter`.
   *
   * Deliberately the whole {@link SealReason} and not three loose strings: `capture` gates the
   * button and `code` addresses the URL, so a caller who could pass `detail` without them could
   * build a leaf that invites an impossible rescan.
   */
  readonly reason: SealReason;
  /**
   * The one number that makes this leaf itself — the tear, and (offset) the wax.
   *
   * Required for the reason <Parchment> requires it: an optional seed defaults to a constant, and
   * fifteen chapters sharing one outline and one blob is printed wallpaper. Pass the chapter index.
   */
  readonly seed: number;
  /**
   * Which mark is pressed into the wax. Defaults to `lotus`.
   *
   * NOT `palm`, which is <WaxSeal>'s own default. The open hand is this product's mark for a hand
   * that was READ; stamping it on a leaf that could not be read would put our own sign on an
   * absence. The lotus is the quiet, unclaiming mark, and quiet is this leaf's entire register.
   */
  readonly emblem?: WaxEmblem;
  /** Play the 200 ms press on mount. Off by default: a seal already on the page was not just struck. */
  readonly pressed?: boolean;
  /** [R6] The measured tier, passed through to the wax, which drops only the press at FLOOR. */
  readonly capability?: CapabilityTier;
  /** Classes for the leaf's outer box. The stylesheet sits in @layer components, so a utility wins. */
  readonly className?: string;
}

/**
 * A blank leaf, a seal pressed at its centre, and the honest sentence underneath.
 *
 * The order the reader meets it in is the order it is built in, and each step is a smaller claim
 * than the last: the wax says CLOSED before a word is read; the Devanagari line says which leaf;
 * `reason.hi` says why in one breath; `reason.detail` shows the working — the counts and key names
 * that make the claim checkable rather than merely stated; and only then, if and only if a rescan
 * could genuinely fill the gap, `reason.capture` says what would help and the button offers it.
 *
 * Both `hi` and `detail` are rendered, though the brief names only the latter. They are two
 * different sentences from the same derived reason — a one-line answer and its evidence — and
 * dropping the summary would hand the reader a paragraph of counts as their first and only
 * explanation. Neither is a constant; both are printed verbatim, and the test proves it by feeding
 * distinctive strings and finding them.
 *
 * The tone is `aged` and the tear is `rough` because a sealed leaf is the oldest thing in the book:
 * it has been closed the longest. That is also the only place damage appears in this component —
 * there is no red beyond the wax, no icon, no border and no warning register anywhere. A reader who
 * reaches this leaf has not made a mistake.
 */
export function SealedLeaf({
  reason,
  seed,
  emblem = "lotus",
  pressed = false,
  capability,
  className,
}: SealedLeafProps): ReactElement {
  const href = sealedLeafRescanHref(reason);

  return (
    <Parchment tone="aged" tear="rough" seed={seed} as="section" className={className}>
      <div className={styles.stack}>
        <WaxSeal
          size={WAX_SIZE_PX}
          emblem={emblem}
          seed={seed + WAX_SEED_OFFSET}
          pressed={pressed}
          capability={capability}
        />

        <p className={styles.unopened}>{SEALED_LEAF_UNOPENED_HI}</p>
        <p className={styles.reason}>{reason.hi}</p>
        <p className={styles.detail}>{reason.detail}</p>

        {href === null ? null : (
          <>
            <p className={styles.instruction}>{reason.capture}</p>
            <Link className={styles.rescan} href={href}>
              {SEALED_LEAF_RESCAN_LABEL}
            </Link>
          </>
        )}
      </div>
    </Parchment>
  );
}
