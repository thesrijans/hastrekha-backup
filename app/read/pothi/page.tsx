import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { ReactElement } from "react";
import {
  GoldRule,
  GoldText,
  SanctuaryDefs,
  SanctuaryGround,
} from "@/components/sanctuary/material";
import { SanctuaryHeader } from "@/components/sanctuary/sanctuary-header";
import { SANCTUARY_FONT_CLASS } from "@/lib/sanctuary/fonts";
import { PothiClient } from "./pothi-client";

/**
 * ============================================================================
 * /read/pothi — the fifteen-leaf reading, behind the dev gate.
 * ============================================================================
 *
 * THE GATE IS THE SAME ONE app/dev/capture, app/dev/label AND
 * app/sanctuary/materials USE, and it is a hard 404 rather than a redirect or a
 * feature flag: any NODE_ENV other than development calls `notFound()` before
 * the client bundle is even referenced. THE EXISTING /read ROUTE IS UNTOUCHED
 * AND STAYS LIVE — this is a second surface over the same response, not a
 * replacement, and nothing about the reading flow changes while it is behind
 * the gate.
 *
 * `robots: { index: false, follow: false }` alongside it, following the same
 * precedent: the gate is what actually stops the route existing, and the
 * metadata is the belt for the case where a preview branch is ever built with
 * NODE_ENV=development.
 *
 * ══ WHY components/header.tsx IS NOT MOUNTED ABOVE THIS ══
 *
 * It returns null for paths under /read/pothi, by its own decision, so a
 * sanctuary route renders its own chrome and nothing else. That is why
 * <SanctuaryHeader /> is here and why this page owns its own masthead: without
 * them the route would have no navigation at all.
 *
 * ══ THE ASSEMBLY ORDER, WHICH IS A CONTRACT AND NOT A PREFERENCE ══
 *
 *  1. `<SanctuaryDefs />` FIRST and ONCE. Every torn leaf, every wax seal,
 *     every ornament and the palm plate's neutral outline reference the shared
 *     `feTurbulence` sprite by id. `feTurbulence` is evaluated per filter
 *     ELEMENT rather than per reference, so fifteen leaves sharing one
 *     `#snc-f-torn` is one noise field where fifteen inlined copies would be
 *     fifteen — the whole frame budget on a LOW device. A missing sprite fails
 *     silently: every leaf renders unfiltered, with square edges, looking like
 *     a design decision.
 *  2. `<SanctuaryGround />`, which paints the room at `z-index: -1`.
 *  3. The masthead and then the book.
 *
 * ══ TWO ABSENCES ON <main> THAT ARE LOAD-BEARING ══
 *
 * NO background and NO `isolate`. The ground paints at negative z-index, and in
 * a stacking context a negative-z descendant is painted BEFORE the in-flow
 * block backgrounds — so a background colour here would cover the entire ground
 * with a flat fill and leave the page looking like the failure the ground
 * exists to fix. `isolate` would seal the ground into this box instead of the
 * viewport.
 *
 * ══ WHY THIS FILE IS A SERVER COMPONENT AND ONLY ONE THING BELOW IS NOT ══
 *
 * The gate, the metadata, the sprite, the ground, the header and the masthead
 * are all markup computed at build time and cost nothing at runtime.
 * <PothiClient /> is the single island, and it is one because the reading lives
 * in `sessionStorage` and the device's rendering budget is measured with rAF —
 * neither is knowable on the server. See that file's header for the backend gap
 * (there is no GET-reading endpoint) that makes the session hand-off necessary
 * in the first place.
 */
export const metadata: Metadata = {
  title: "Pothi — dev",
  robots: { index: false, follow: false },
};

/**
 * The ground's seed.
 *
 * A constant, and a different one from the material bench's, so the two dev
 * surfaces do not share a scratch field. It is not derived from the reading:
 * the room a book is read in does not change because the book did.
 */
const GROUND_SEED = 1115;

/**
 * The masthead's rule, as a CSS length — <GoldRule> takes a width string, not a
 * number (<OrnamentalDivider>, which is drawn in an SVG box, takes the number).
 * It fades at both ends like every rule in this language; it is left decorative,
 * the component's default, so a screen reader is not told the masthead is a
 * thematic break.
 */
const MASTHEAD_RULE_WIDTH = "20rem";

/*
 * The masthead's three voices, as class strings, following the material
 * bench's own idiom: the faces are read as `var(--font-snc-*)`, which resolve
 * only under SANCTUARY_FONT_CLASS — applied once on <main> below — and every
 * colour is a `snc-`-prefixed Tailwind utility generated from the tokens in
 * app/sanctuary.css. No literal appears here.
 *
 * The eyebrow is NOT a <GoldText>: the ramp's darkest stop measures under the
 * body-text contrast minimum, so shrinking struck metal to caption size is an
 * accessibility defect that happens to look expensive. Flat gold-500 at that
 * size is the correct mark.
 */
const DISPLAY_FACE = "[font-family:var(--font-snc-display)]";
/*
 * NO `tracking-` UTILITY HERE, and its absence is the fix rather than an
 * oversight. This line is Devanagari — पोथी — and it carried `tracking-[0.3em]`
 * copied from the Latin small-caps eyebrows elsewhere in the product. Measured
 * on a real page that resolved to 3.84px of letter-spacing, and the word came
 * apart on screen as "पो थी": tracking inserts space between the glyphs a
 * conjunct and its matra are assembled from, so the script stops being the
 * script. Devanagari sets its own rhythm through its leading, which is why the
 * line-height below is generous and the tracking is nothing at all.
 */
const EYEBROW = "text-[0.8rem] leading-[1.9] text-snc-gold-500 [font-family:var(--font-snc-devanagari)]";
const STANDFIRST = "max-w-xl text-[0.95rem] leading-8 text-snc-parch-edge [font-family:var(--font-snc-serif)]";

/** The Devanagari name of the book, above the Latin title — the sanctuary header's own order. */
const POTHI_TITLE_HI = "पोथी";
const POTHI_TITLE_EN = "The Pothi";

/**
 * The one line of standing copy on this route.
 *
 * It describes the BOOK — fifteen chapters, and the fact that a leaf that could
 * not be opened says why — and makes no claim about any reading. That is the
 * boundary every fixed string in the Pothi keeps: a constant sentence about the
 * book is a fact; a constant sentence about a hand is the placeholder A2
 * forbids.
 */
const POTHI_STANDFIRST =
  "Pandrah adhyaay. Jo patta khul nahi paaya, wo apni wajah khud batata hai.";

/*
 * NO BACK ARROW ON THIS ROUTE, AND THE ABSENCE IS THE FIX.
 *
 * The arrow used to return to `/read`, the pre-sanctuary reading page, which is
 * the one thing a link out of a sanctuary surface may not do. The obvious repair
 * is to re-point it at the only other sanctuary room, `/scan/chamber` — and that
 * is a worse defect than the one it fixes. The control is a chevron labelled
 * "Wapas", it sits on a leaf of a book, and the room it would lead to is a
 * camera. A back arrow that misnames its own destination is not navigation.
 *
 * <LeafPage> already states the rule this follows, at its own prop: "Omit and no
 * arrow is drawn — a dead control is worse than none." Nothing is stranded by
 * it. The sanctuary header above the book carries a labelled Scan that goes to
 * the chamber, and the wordmark beside it goes home, so the page measured seven
 * links with the arrow gone.
 *
 * The arrow comes back the day the sanctuary has a home or a library to return
 * to — by passing that route to <PothiClient/>, and nothing else.
 */

export default function PothiPage(): ReactElement {
  if (process.env.NODE_ENV !== "development") notFound();

  return (
    <main className={`${SANCTUARY_FONT_CLASS} relative flex w-full flex-1 flex-col`}>
      <SanctuaryDefs />
      <SanctuaryGround seed={GROUND_SEED} capability="HIGH" />

      <div className="mx-auto flex w-full max-w-[84rem] flex-col gap-10 px-4 pb-32 sm:px-8">
        <SanctuaryHeader activeHref="/read/pothi" />

        <header className="flex flex-col items-center gap-4 pt-16 text-center">
          <span className={EYEBROW} lang="hi">
            {POTHI_TITLE_HI}
          </span>
          <GoldText as="h1" size="hero" className={DISPLAY_FACE}>
            {POTHI_TITLE_EN}
          </GoldText>
          <GoldRule width={MASTHEAD_RULE_WIDTH} />
          <p className={STANDFIRST}>{POTHI_STANDFIRST}</p>
        </header>

        <PothiClient />
      </div>
    </main>
  );
}
