/**
 * <LeafPage> — one chapter of the Pothi, written on a torn leaf.
 *
 * This is the reference composition
 * (docs/reference/ui-reading-lifeline-explainability-card.png) built against
 * the measured wire: a header strip on the dark ground, the narration in ink on
 * an aged leaf, the ornamental rule, "HastRekha ऐसा क्यों कहती है", the
 * provenance medallions, the Source Wisdom inset, an engraved footer, and the
 * page number in Devanagari outside the sheet.
 *
 * ══ IT RENDERS NOTHING WHEN THE CHAPTER IS SEALED, AND THAT IS THE CONTRACT ══
 *
 * `resolveChapter()` returns content or a seal and never a third thing. This
 * component owns the CONTENT half only: handed a sealed state it returns
 * `null`, because the book — not the leaf — decides which component a sealed
 * chapter mounts. Do not add a fallback branch here and do not mount both: a
 * seal rendered twice, once as a quiet panel and once as an empty leaf, is
 * worse than either.
 *
 * For the same reason `state.partialSeals` is deliberately NOT rendered here.
 * Those are seals on PART of an open chapter — the missing per-line confidence
 * badge, the hand-shape value that never reaches the client, the rows a tier
 * withheld — and they belong beside the leaf, in the same sealed treatment the
 * book already mounts for a fully sealed chapter. If nothing on the route
 * renders them, they are lost; that is a wiring bug in the book, not a licence
 * to print them twice.
 *
 * ══ WHAT IS DERIVED, AND WHY NONE OF IT IS A CONSTANT ══
 *
 * The reference's subtitle reads "Stability • Health • Vitality". Three
 * hand-picked words under a chapter title are the most quietly dishonest thing
 * on that card: they look like findings and they are decoration. Here the
 * subtitle comes from {@link leafSubtitleTerms} — an area chapter's own
 * direction and band in the product's existing vocabulary, then the categories
 * of the rules that actually fired — and it disappears entirely when the
 * response supports no term at all.
 *
 * The body comes from {@link leafBodyBlocks}, which walks the response in a
 * fixed order of preference and ends at `contentTexts()`, the same gate the
 * data layer used to certify this chapter as printable. So the leaf cannot
 * render a sentence the data layer did not already vouch for, and it cannot go
 * blank on a state the data layer called content.
 *
 * The provenance rows are `provenanceRows()` verbatim; the Source Wisdom panel
 * is SEALED, because no verse table exists in the backend and a Sanskrit couplet
 * invented to fill that inset is precisely the failure A2 names.
 *
 * ══ SERVER COMPONENT ══
 *
 * No `"use client"`, in this file or in provenance-rows.tsx. There is no state,
 * no effect and no handler: a leaf is markup computed from props, so it costs
 * zero client JavaScript. Two consequences are stated rather than hidden:
 *
 *  - The back arrow is a plain `<a>`, not `next/link`. One navigation per leaf
 *    does not pay for a router dependency inside a pure-markup subtree, and the
 *    anchor is what keeps this component renderable in a plain Node test.
 *  - "Save reading" and "Share" render ONLY when the book supplies a
 *    destination. A control that looks live and does nothing is the same lie as
 *    an invented reading, wearing a different hat; if the book wants real
 *    buttons it owns the client component and passes hrefs, or renders its own.
 *
 * `<SanctuaryDefs />` must already be mounted on the route: the leaf, the seal
 * and every ornament below reference the shared filter sprite by id, and a
 * `url(#…)` that resolves to nothing renders unfiltered and silent.
 */
import { Fragment, type ReactElement } from "react";
import type { ReadingResponse } from "@/app/read/reading-types";
import { BAND_COPY, DIRECTION_COPY, NO_DIRECTION_COPY } from "@/components/areas/area-vocab";
import type { CapabilityTier } from "@/components/sanctuary/use-capability-tier";
import {
  POTHI_CHAPTERS,
  contentTexts,
  type ChapterState,
  type PothiChapter,
} from "@/lib/sanctuary/pothi-chapters";
import { provenanceRows } from "@/lib/sanctuary/pothi-provenance";
import {
  AncientCorner,
  GoldText,
  LotusDecoration,
  ORNAMENT_CORNERS,
  OrnamentalDivider,
  Parchment,
  WaxSeal,
  type WaxEmblem,
} from "../material";
import { EngravedEmblem, ProvenanceRows } from "./provenance-rows";
import styles from "./leaf-page.module.css";

/* ================================ COPY ==================================== */

/**
 * The heading over the provenance rows, in the product's own mixed register.
 *
 * The only Devanagari in the leaf's body, and it is a heading rather than a
 * sentence — lib/hastrekha/narrator.ts rejects Devanagari in body text outright,
 * so this app reserves the script for chapter titles, headings and numerals.
 */
const WHY_HEADING = "HastRekha ऐसा क्यों कहती है";

/** The inset's title, kept in Latin exactly as the reference sets it. */
const SOURCE_WISDOM_HEADING = "Source Wisdom";

/**
 * The code for the one seal this component raises itself.
 *
 * Not in `SEAL_CODES`: that table covers seals the DATA layer can derive from a
 * response, and this one is a fact about the backend rather than about any
 * reading — there is no verse table to query, for anybody, yet. Exported so a
 * test and an analytics label can name it without a string typo.
 */
export const SOURCE_WISDOM_SEAL_CODE = "source_wisdom_unbuilt";

/** The seal's single ink line. */
const SOURCE_WISDOM_SEAL_LINE = "Yahan shlok aana tha. Abhi aata nahi.";

/** The accessible name of the back arrow — the only word of chrome on the strip. */
const BACK_LABEL = "Wapas";

const SAVE_LABEL = "Save reading";
const SHARE_LABEL = "Share";

/** The word before the numerals, so "पृष्ठ ०४ / १५" reads as a page and not a fraction. */
const PAGE_NUMBER_WORD = "पृष्ठ";

/** U+2022 with hair space either side, as the reference sets its subtitle. */
const SUBTITLE_SEPARATOR = " • ";

/**
 * The field label above a bare list of birth-window ids.
 *
 * A field NAME, never an interpretation: chapter XIII opens on window ids whose
 * date ranges stay in the KB, and printing them under a label is honest where
 * printing them under a sentence about someone's life would not be.
 */
const BIRTH_WINDOW_LABEL = "Janm-window";

/* ============================== NUMERALS ================================== */

const DEVANAGARI_DIGITS = "०१२३४५६७८९";

/**
 * A non-negative integer in Devanagari digits.
 *
 * Exists so the "/ १५" half of the page number is DERIVED from
 * `POTHI_CHAPTERS.length` rather than typed. A sixteenth chapter would
 * otherwise leave every leaf claiming to be one of fifteen, and nothing would
 * fail.
 */
export function devanagariNumber(value: number): string {
  const digits = String(Math.max(0, Math.trunc(value)));
  let out = "";
  for (const digit of digits) out += DEVANAGARI_DIGITS.charAt(Number(digit));
  return out;
}

/* =============================== IDENTITY ================================= */

/**
 * Which emblem a chapter is struck with, by KIND rather than one per chapter.
 *
 * A per-chapter table would be fifteen aesthetic choices nobody could review;
 * a kind is a claim. The palm covers the lines and the hand itself, because
 * both are marks ON the hand. The lotus covers the five life areas, which are
 * about a life rather than about an anatomy. The trishul covers the meta
 * chapters — the whole reading, the life direction, the question — which are
 * about the book rather than about the hand.
 */
const CHAPTER_EMBLEM: Readonly<Record<PothiChapter["kind"], WaxEmblem>> = {
  line: "palm",
  structure: "palm",
  area: "lotus",
  meta: "trishul",
};

/** The emblem for a chapter's crest and its wax seal. Both, so one leaf is one mark. */
export function chapterEmblem(chapter: PothiChapter): WaxEmblem {
  return CHAPTER_EMBLEM[chapter.kind];
}

/**
 * The leaf's seed: its position in the book.
 *
 * Every irregular thing on the page — the torn outline, the mottle, the stains,
 * the lobes of the wax, the waver of the divider — is addressed by this number,
 * so chapter IV tears the same way on the server and in the browser and a
 * different way from chapter V. Bound to the chapter and not to the reading id
 * on purpose: a leaf that re-tears itself when the same chapter is re-read
 * would read as a redraw rather than as a page.
 */
export function chapterSeed(chapter: PothiChapter): number {
  const index = POTHI_CHAPTERS.findIndex((entry) => entry.numeral === chapter.numeral);
  return (index >= 0 ? index : chapter.numeral.length) + 1;
}

/**
 * How far the inset's seed is moved off its host's.
 *
 * A nested leaf sharing its parent's seed tears with the same bite pattern at a
 * smaller scale, which the eye reads at once as one shape printed twice.
 */
const INSET_SEED_OFFSET = 97;

/* =============================== SUBTITLE ================================= */

/**
 * Three, because the strip has room for three — not because anything in the
 * response comes in threes. Fewer terms simply render fewer.
 */
const SUBTITLE_MAX_TERMS = 3;

/** "reading_method" → "Reading method". The KB's own category, made typeable, never renamed. */
function categoryTerm(category: string): string {
  const words = category.replace(/_/g, " ").trim();
  if (words.length === 0) return "";
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * The small-caps line under the chapter title, derived from this reading.
 *
 * An area chapter leads with the two words the product already uses for its
 * state — `DIRECTION_COPY` and `BAND_COPY` from components/areas/area-vocab.ts,
 * imported rather than re-translated so a card and a leaf cannot describe one
 * verdict with two different words. Everything else is filled from the
 * categories of the rules that actually fired, in wire order, deduplicated.
 *
 * Returns an empty list when the response supports no term — chapter XIII with
 * only window ids, say — and the caller then renders no subtitle at all rather
 * than a filler phrase.
 */
export function leafSubtitleTerms(state: ChapterState): readonly string[] {
  if (state.status === "sealed") return [];

  const terms: string[] = [];
  const area = state.area;
  if (area !== null) {
    const direction: string | undefined = area.direction === null ? undefined : DIRECTION_COPY[area.direction];
    terms.push(direction ?? NO_DIRECTION_COPY);
    /* INSUFFICIENT has no phrase in BAND_COPY on purpose, and an INSUFFICIENT
     * area is sealed before it reaches this component — so this is a guard
     * against a future band, not against today's data. */
    const band: string | undefined = BAND_COPY[area.band];
    if (band !== undefined) terms.push(band);
  }

  for (const rule of state.rules) {
    if (terms.length >= SUBTITLE_MAX_TERMS) break;
    const term = categoryTerm(rule.category);
    if (term.length > 0 && !terms.includes(term)) terms.push(term);
  }

  if (terms.length === 0 && state.birthWindows.length > 0) {
    terms.push(`${state.birthWindows.length} ${BIRTH_WINDOW_LABEL}`);
  }

  return terms.slice(0, SUBTITLE_MAX_TERMS);
}

/* ================================= BODY =================================== */

/** Where a printed block came from. Rendered as `data-snc-block`, so the page can be audited. */
export type LeafBodySource = "section" | "rule" | "evidence" | "birth-window" | "certified";

/** One printed block of the leaf's body. */
export interface LeafBodyBlock {
  /** Stable React key, taken from a rule id or a position — never from the text. */
  readonly key: string;
  readonly source: LeafBodySource;
  /** A section's own title, or a field name; null for a bare paragraph. */
  readonly heading: string | null;
  /** The text, exactly as the response carried it. */
  readonly text: string;
}

/** Non-empty after trimming — the one test every printed string has to pass. */
function written(text: string | undefined): text is string {
  return typeof text === "string" && text.trim().length > 0;
}

/**
 * What this leaf actually prints, in a fixed order of preference.
 *
 * Narration first, because that is prose written for a reader. Then the
 * interpretations of the rules that fired, which are prose too — the KB's own
 * sentences — for a chapter the narrator did not write a section about. Then
 * area evidence, for the response shape where the interpretation rides on the
 * verdict rather than on `rules[]`. Then birth windows, under a field label,
 * because ids are data and must not be dressed as a reading.
 *
 * And last, `contentTexts(state)`: the exact strings the data layer inspected
 * when it decided this chapter was content rather than a seal. That branch is
 * the backstop for the path nobody thought of — it cannot invent, because it
 * can only print what has already been certified as present, and it cannot
 * leave the leaf blank, because `resolveChapter()` guarantees the list is
 * non-empty for every state it calls content.
 */
export function leafBodyBlocks(state: ChapterState): readonly LeafBodyBlock[] {
  if (state.status === "sealed") return [];

  const sections = state.sections
    .filter((section) => written(section.body))
    .map(
      (section, index): LeafBodyBlock => ({
        key: `section-${index}`,
        source: "section",
        heading: written(section.title) ? section.title : null,
        text: section.body,
      }),
    );
  if (sections.length > 0) return sections;

  const rules = state.rules
    .filter((rule) => written(rule.interpretation_hi_en))
    .map(
      (rule): LeafBodyBlock => ({
        key: `rule-${rule.rule_id}`,
        source: "rule",
        heading: null,
        text: rule.interpretation_hi_en,
      }),
    );
  if (rules.length > 0) return rules;

  const evidence = (state.area?.evidence ?? [])
    .filter((item) => written(item.interpretation_hi_en))
    .map(
      (item): LeafBodyBlock => ({
        key: `evidence-${item.rule_id}`,
        source: "evidence",
        heading: null,
        /* `written()` narrowed it above; the fallback keeps the expression total. */
        text: item.interpretation_hi_en ?? "",
      }),
    );
  if (evidence.length > 0) return evidence;

  if (state.birthWindows.length > 0) {
    return state.birthWindows.map(
      (window, index): LeafBodyBlock => ({
        key: `window-${window}`,
        source: "birth-window",
        heading: index === 0 ? BIRTH_WINDOW_LABEL : null,
        text: window,
      }),
    );
  }

  return contentTexts(state).map(
    (text, index): LeafBodyBlock => ({
      key: `certified-${index}`,
      source: "certified",
      heading: null,
      text,
    }),
  );
}

/* =============================== ORNAMENT ================================= */

/** The width the ornamental rule is DRAWN at; it shrinks to its column from there. */
const DIVIDER_WIDTH = 420;

/** The footer's closing mark, narrower than the body rule so the two do not rhyme. */
const FOOTER_ORNAMENT_WIDTH = 260;

/** The wax at the top right, at the size the reference presses it. */
const WAX_SEAL_SIZE = 64;

/** The bloom in the inset — a watermark beside the text, never behind it. */
const INSET_LOTUS_SIZE = 96;

/** The engraved bracket in each corner of the inset. */
const INSET_CORNER_SIZE = 30;

/** Icon geometry lives in a 24-unit box, the size these two marks were drawn at. */
const ACTION_ICON_VIEWBOX = 24;

/**
 * One weight for every line icon on the page.
 *
 * Read in viewport units because each path carries `vector-effect:
 * non-scaling-stroke`, so this is one CSS pixel at any rendered size — the same
 * single hairline the ornament family is drawn at. A second weight anywhere
 * here would make the footer marks read as a different family from the corners
 * six centimetres above them.
 */
const HAIRLINE_STROKE = 1;

/**
 * The heading level of the two sub-headings, as a function of the title's.
 *
 * Derived rather than fixed so a single-leaf route passing `titleAs="h1"` gets
 * h2/h3 beneath it instead of a skipped level, and the default `h2` leaf inside
 * a book gets h3/h4. Two entries, because those are the only two titles the
 * component accepts.
 */
const SUB_HEADINGS: Readonly<Record<"h1" | "h2", { readonly why: "h2" | "h3"; readonly inset: "h3" | "h4" }>> = {
  h1: { why: "h2", inset: "h3" },
  h2: { why: "h3", inset: "h4" },
};

/** A bookmark: a ribbon with a notch cut out of its foot. */
const SAVE_ICON_PATH = "M 6 3.6 H 18 V 20.4 L 12 15.8 L 6 20.4 Z";

/** Share: a sheet with an arrow leaving the top of it, drawn as three separate strokes. */
const SHARE_ICON_PATHS: readonly string[] = [
  "M 12 3.4 V 14.6",
  "M 8 7.4 L 12 3.4 L 16 7.4",
  "M 5 12.6 V 20.4 H 19 V 12.6",
];

/* ================================ COMPONENT =============================== */

/** Props of {@link LeafPage}. */
export interface LeafPageProps {
  /**
   * The chapter as `resolveChapter()` resolved it.
   *
   * A SEALED state renders `null` — see the note at the head of this file for
   * why the book, and not the leaf, mounts the sealed treatment.
   */
  readonly state: ChapterState;
  /** The response the state was resolved from; the provenance rows are read out of it. */
  readonly reading: ReadingResponse;
  /**
   * The chapter, for a caller iterating `POTHI_CHAPTERS` beside `resolvePothi()`.
   *
   * Optional because `ChapterState` already carries the chapter it was resolved
   * against, and that is the copy to trust: the sections, rules and rule ids in
   * the state were selected FOR it. Passing a different chapter here prints one
   * chapter's title over another chapter's evidence, which is a caller bug this
   * component cannot detect — so the safe call is to omit it.
   */
  readonly chapter?: PothiChapter;
  /** Stamped into the wax and used as the seal's accessible name. Without it the seal is decoration. */
  readonly sessionId?: string;
  /** Where the back arrow goes. Omit and no arrow is drawn — a dead control is worse than none. */
  readonly backHref?: string;
  /** Destination for "Save reading". Omitted ⇒ the mark is not rendered. */
  readonly saveHref?: string;
  /** Destination for "Share". Omitted ⇒ the mark is not rendered. */
  readonly shareHref?: string;
  /** [R6] The measured tier, passed to the wax so FLOOR gets the seal already stamped. */
  readonly capability?: CapabilityTier;
  /**
   * Which heading element the chapter title is.
   *
   * `h2` by default, because the Pothi's own route owns the `h1` and fifteen
   * leaves in one document must not be fifteen level-one headings. A route
   * showing a single leaf passes `h1`.
   */
  readonly titleAs?: "h1" | "h2";
}

/**
 * One chapter of the Pothi, or nothing at all.
 *
 * @returns the leaf for an open chapter; `null` for a sealed one.
 */
export function LeafPage({
  state,
  reading,
  chapter: chapterProp,
  sessionId,
  backHref,
  saveHref,
  shareHref,
  capability,
  titleAs = "h2",
}: LeafPageProps): ReactElement | null {
  if (state.status === "sealed") return null;

  const chapter = chapterProp ?? state.chapter;
  const seed = chapterSeed(chapter);
  const emblem = chapterEmblem(chapter);
  const rows = provenanceRows(reading, state.ruleIds);
  const blocks = leafBodyBlocks(state);
  const terms = leafSubtitleTerms(state);
  const pageNumber = `${PAGE_NUMBER_WORD} ${chapter.devanagariNumeral} / ${devanagariNumber(POTHI_CHAPTERS.length)}`;
  const WhyHeading = SUB_HEADINGS[titleAs].why;
  const InsetHeading = SUB_HEADINGS[titleAs].inset;

  /* The four engraved brackets, handed to <Parchment>'s ornament slot. The
   * wrappers carry the placement because that slot only guarantees a positioned
   * box the size of the leaf; AncientCorner mirrors its own geometry, so no
   * transform is needed and the one warm light source stays where it is. */
  const insetCorners = (
    <>
      {ORNAMENT_CORNERS.map((corner) => (
        <span key={corner} className={styles.insetCorner} data-snc-corner={corner}>
          <AncientCorner corner={corner} size={INSET_CORNER_SIZE} seed={seed + INSET_SEED_OFFSET} />
        </span>
      ))}
    </>
  );

  return (
    <article className={styles.page} data-snc-chapter={chapter.numeral} aria-label={chapter.titleEn}>
      <header className={styles.headerStrip}>
        {backHref === undefined ? null : (
          <a className={styles.back} href={backHref} aria-label={BACK_LABEL}>
            <svg
              className={styles.backGlyph}
              viewBox={`0 0 ${ACTION_ICON_VIEWBOX} ${ACTION_ICON_VIEWBOX}`}
              aria-hidden="true"
              focusable="false"
            >
              <path
                d="M 14.6 4.8 L 7.4 12 L 14.6 19.2"
                fill="none"
                stroke="currentColor"
                strokeWidth={HAIRLINE_STROKE}
                strokeLinecap="round"
                strokeLinejoin="round"
                vectorEffect="non-scaling-stroke"
              />
            </svg>
          </a>
        )}

        {/* The dark medallion of the art direction, carrying the chapter's own mark. */}
        <span className={`${styles.crest} snc-medallion`} aria-hidden="true">
          <EngravedEmblem emblem={emblem} className={styles.crestGlyph} />
        </span>

        <div className={styles.titles}>
          {/* Devanagari above, Latin below — the sanctuary header's order. The big line is Latin
              because Tiro Devanagari is deliberately not preloaded (lib/sanctuary/fonts.ts), and
              the swap is far less visible on a 0.86rem eyebrow than on a display title. */}
          <span className={styles.eyebrow} lang="hi">
            {chapter.titleHi}
          </span>
          <GoldText as={titleAs} size="display" className={styles.title}>
            {chapter.titleEn}
          </GoldText>
          {terms.length === 0 ? null : (
            <p className={styles.subtitle} data-snc-subtitle="derived">
              {terms.join(SUBTITLE_SEPARATOR)}
            </p>
          )}
        </div>

        <span className={styles.sealSlot}>
          <WaxSeal size={WAX_SEAL_SIZE} emblem={emblem} seed={seed} capability={capability} label={sessionId} />
        </span>
      </header>

      <Parchment tone="aged" tear="subtle" seed={seed} className={styles.leaf}>
        <div className={styles.body} data-snc-region="narration">
          {/* A block heading is a <p>, not a heading element, and that is deliberate: the number
              of narration sections varies per reading, so promoting each title to a heading would
              put an unpredictable count of outline levels inside one chapter. They are labels
              within one piece of prose — set apart by weight and tracking, not by rank. */}
          {blocks.map((block) => (
            <Fragment key={block.key}>
              {block.heading === null ? null : <p className={styles.blockHeading}>{block.heading}</p>}
              <p className={styles.paragraph} data-snc-block={block.source}>
                {block.text}
              </p>
            </Fragment>
          ))}
        </div>

        <OrnamentalDivider width={DIVIDER_WIDTH} seed={seed} className={styles.divider} />

        <WhyHeading className={styles.whyHeading}>{WHY_HEADING}</WhyHeading>
        <ProvenanceRows rows={rows} ruleCount={state.ruleIds.length} />

        {/*
          THE SOURCE WISDOM INSET, SEALED.

          The reference fills this panel with a Sanskrit couplet, its translation
          and an attribution to a book this KB does not contain. There is no
          verse table anywhere in the backend — `AreaSource` carries text, loc
          and year and nothing else — so the only two things this panel could be
          are a fabricated shloka or an honest empty frame. It is the frame, and
          the line inside it counts THIS leaf's citations so the reason stays
          specific rather than becoming a stock apology.
        */}
        <div className={styles.inset} data-snc-region="source-wisdom">
          <Parchment tone="light" tear="subtle" seed={seed + INSET_SEED_OFFSET} corners={insetCorners}>
            <div className={styles.insetBody}>
              <InsetHeading className={styles.insetHeading}>{SOURCE_WISDOM_HEADING}</InsetHeading>
              <p className={styles.insetSealLine} data-snc-sealed={SOURCE_WISDOM_SEAL_CODE}>
                {SOURCE_WISDOM_SEAL_LINE}
              </p>
              <p className={styles.insetSealDetail}>
                {`Response ka har hawala sirf text, loc aur year laata hai — na shlok, na uska anuvaad. ` +
                  `Is patte ke ${rows.length} granth-hawale bhi wahi teen cheezein laaye. Verse ka koi table ` +
                  `backend mein bana hi nahi hai, isliye yahan banaya hua shlok rakhne ke bajaye jagah khaali ` +
                  `chhodi gayi hai.`}
              </p>
            </div>
            <LotusDecoration size={INSET_LOTUS_SIZE} seed={seed} className={styles.insetLotus} />
          </Parchment>
        </div>

        <footer className={styles.footer} data-snc-region="leaf-footer">
          <OrnamentalDivider width={FOOTER_ORNAMENT_WIDTH} seed={seed + 1} className={styles.footerOrnament} />
          {saveHref === undefined && shareHref === undefined ? null : (
            <div className={styles.actions}>
              {saveHref === undefined ? null : (
                <a className={styles.action} href={saveHref} data-snc-action="save">
                  <svg
                    className={styles.actionGlyph}
                    viewBox={`0 0 ${ACTION_ICON_VIEWBOX} ${ACTION_ICON_VIEWBOX}`}
                    aria-hidden="true"
                    focusable="false"
                  >
                    <path
                      d={SAVE_ICON_PATH}
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={HAIRLINE_STROKE}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      vectorEffect="non-scaling-stroke"
                    />
                  </svg>
                  {SAVE_LABEL}
                </a>
              )}
              {shareHref === undefined ? null : (
                <a className={styles.action} href={shareHref} data-snc-action="share">
                  <svg
                    className={styles.actionGlyph}
                    viewBox={`0 0 ${ACTION_ICON_VIEWBOX} ${ACTION_ICON_VIEWBOX}`}
                    aria-hidden="true"
                    focusable="false"
                  >
                    {SHARE_ICON_PATHS.map((d) => (
                      <path
                        key={d}
                        d={d}
                        fill="none"
                        stroke="currentColor"
                        strokeWidth={HAIRLINE_STROKE}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        vectorEffect="non-scaling-stroke"
                      />
                    ))}
                  </svg>
                  {SHARE_LABEL}
                </a>
              )}
            </div>
          )}
        </footer>
      </Parchment>

      {/* Outside the leaf, on the ground: a page number belongs to the book, not to the sheet. */}
      <p className={styles.pageNumber} lang="hi" data-snc-page-number={chapter.devanagariNumeral}>
        {pageNumber}
      </p>
    </article>
  );
}
