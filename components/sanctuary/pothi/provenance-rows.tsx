/**
 * "HastRekha ऐसा क्यों कहती है" — the medallion rows under a reading, and the
 * engraved glyph they are struck with.
 *
 * WHY THIS COMPONENT DECIDES NOTHING.
 *
 * Every judgement about which books may be named lives in
 * lib/sanctuary/pothi-provenance.ts, and this file renders exactly what
 * `provenanceRows()` hands it — in its order, with its strings, at its length.
 * That separation is the whole of R4. The reference card
 * (docs/reference/ui-reading-lifeline-explainability-card.png) shows THREE
 * medallions, two of which cite books this knowledge base does not contain; the
 * fastest way to put those names back on a screen would be a component that
 * "renders three rows" and fills the gaps. So this one renders `rows.length`
 * rows and has no idea what a book is.
 *
 * WHY AN EMPTY LIST STILL PRINTS A SENTENCE.
 *
 * Because A2 is about the empty case. `provenanceRows()` returning nothing is a
 * correct answer — none of this chapter's rules carried a citation the KB
 * actually holds — and the honest rendering of that is a line saying so, with
 * the rule count it was given, not a heading with white space under it. A
 * confident-looking gap is the failure this build exists to prevent.
 *
 * SERVER COMPONENT. No state, no effect, no handler: given the same rows it
 * renders the same markup forever, so it costs zero client JavaScript.
 */
import type { ReactElement } from "react";
import type { ProvenanceRow } from "@/lib/sanctuary/pothi-provenance";
import { WAX_SEAL_VIEWBOX, waxEmblemGeometry, type WaxEmblem } from "../material";
import styles from "./leaf-page.module.css";

/**
 * The hairline weight of an engraved glyph, in user units before
 * `vector-effect` takes over.
 *
 * With `non-scaling-stroke` the number is read in the VIEWPORT's units, so 1
 * here is one CSS pixel at every disc size — the same single weight the whole
 * ornament family is drawn at. Scaling the stroke with the box instead would
 * make the glyph on a 44px provenance disc visibly lighter than the identical
 * glyph on the 64px header crest, which is the tell that two marks were drawn
 * rather than struck from one die.
 */
const EMBLEM_HAIRLINE = 1;

/** Props of {@link EngravedEmblem}. */
export interface EngravedEmblemProps {
  /** Which mark to engrave. The same three the wax seal presses. */
  readonly emblem: WaxEmblem;
  /** Sizing and placement belong to the caller; this component sets neither. */
  readonly className?: string;
}

/**
 * One of the three sanctuary emblems, drawn as engraved line work in
 * `currentColor`.
 *
 * WHY THE GEOMETRY COMES FROM `waxEmblemGeometry()` AND IS NOT REDRAWN HERE.
 *
 * The palm, the lotus and the trishul already exist as vector descriptions
 * beside the wax seal, and they are exported React-free precisely so a second
 * consumer can use them without pressing a blob of wax. Redrawing them would
 * produce a hand on the seal and a slightly different hand on the medallion
 * eight rows below it — the kind of divergence nobody reports and everybody
 * sees.
 *
 * WHY `currentColor` AND NOT `url(#snc-g-gold)`.
 *
 * Because `.snc-medallion` in the token layer sets `color` for exactly this
 * purpose, and its own note says so: the disc owns the gold, and the glyph
 * inherits it rather than every call site restating a gradient id. It also
 * means the mark still renders if a route forgets `<SanctuaryDefs />` — a
 * missing gradient reference paints nothing at all, silently, which is this
 * system's signature failure.
 */
export function EngravedEmblem({ emblem, className }: EngravedEmblemProps): ReactElement {
  const { strokes, fills } = waxEmblemGeometry(emblem);
  return (
    <svg
      className={className}
      viewBox={`0 0 ${WAX_SEAL_VIEWBOX} ${WAX_SEAL_VIEWBOX}`}
      aria-hidden="true"
      focusable="false"
    >
      {strokes.map((d) => (
        <path
          key={d}
          d={d}
          fill="none"
          stroke="currentColor"
          strokeWidth={EMBLEM_HAIRLINE}
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
      ))}
      {fills.map((d) => (
        <path key={d} d={d} fill="currentColor" />
      ))}
    </svg>
  );
}

/** Props of {@link ProvenanceRows}. */
export interface ProvenanceRowsProps {
  /**
   * Exactly what `provenanceRows(reading, ruleIds)` returned. Not a subset, not
   * padded to three, not reordered — the function is the policy and this is its
   * output.
   */
  readonly rows: readonly ProvenanceRow[];
  /**
   * How many rules this leaf rests on, i.e. `ChapterState.ruleIds.length`.
   *
   * Used only by the empty case, and it is the reason the empty case can be a
   * fact rather than an apology: "these N rules carried no citation" is
   * checkable, "no sources found" is a shrug.
   */
  readonly ruleCount: number;
}

/**
 * The medallion rows: a near-black disc with a gold ring and an engraved glyph,
 * the source's title in ink, and the parenthetical beneath it in the leaf's
 * softer ink.
 *
 * The parenthetical is built as ONE template string rather than as
 * `({row.source})` across three JSX children, because React writes `<!-- -->`
 * between adjacent text nodes — which would put comment markers inside a
 * citation, in the markup, forever.
 */
export function ProvenanceRows({ rows, ruleCount }: ProvenanceRowsProps): ReactElement {
  if (rows.length === 0) {
    return (
      <p className={styles.provenanceEmpty} data-snc-provenance="empty">
        {`Is adhyaay ke ${ruleCount} rule ke saath koi granth-hawala response mein nahi aaya — ` +
          `isliye yahan kisi kitaab ka naam nahi hai.`}
      </p>
    );
  }

  return (
    <ul className={styles.provenance} data-snc-provenance="rows">
      {rows.map((row) => (
        <li key={row.key} className={styles.provenanceRow} data-snc-provenance-row={row.key}>
          {/* The disc is decoration: the row's meaning is entirely in the two lines beside it, so
              the glyph is hidden from assistive technology rather than announced twice. */}
          <span className={`${styles.provenanceDisc} snc-medallion`} aria-hidden="true">
            <EngravedEmblem emblem={row.emblem} className={styles.provenanceGlyph} />
          </span>
          <span className={styles.provenanceText}>
            <span className={styles.provenanceTitle}>{row.title}</span>
            <span className={styles.provenanceSource}>{`( ${row.source} )`}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}
