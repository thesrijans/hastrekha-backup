/**
 * ============================================================================
 * <PalmPlate> — the left page of a Pothi spread: the line that was actually
 * measured, drawn on the hand it was measured from.
 * ============================================================================
 *
 * WHAT THIS COMPONENT IS FOR.
 *
 * Chapters II–V each talk about one crease. The reading response carries no
 * geometry at all — no polyline, no crop, no per-line confidence — so the only
 * honest picture of "your heart line" comes from the scan session's hand-off
 * (lib/sanctuary/pothi-geometry.ts). This component renders that hand-off and
 * nothing else. It has no fallback illustration of a heart line, no stock hand
 * photograph and no idealised crease: where the measurement is missing it says
 * so, and where even the polyline is gone it renders NOTHING and lets the caller
 * seal the leaf. That refusal is the component's whole reason to exist — A2 says
 * a confident-looking empty state is the failure this build was made to prevent,
 * and a plausible drawing of somebody's palm is the most confident empty state
 * this product could possibly ship.
 *
 * THE THREE STATES, AND WHY THERE ARE EXACTLY THREE.
 *
 *  1. **Measured.** The tab still holds the crop. The crop is aged onto the leaf
 *     — sepia'd, then multiplied through the parchment's own pigment — so it
 *     reads as something drawn INTO the manuscript rather than a photograph
 *     pasted on it, and the traced creases are inked over it.
 *  2. **Revisited.** The polylines survived but the crop did not, because R3
 *     keeps the crop in sessionStorage and nowhere else: `prisma/schema.prisma`
 *     says "no images, ever" and /scan promises the reader the same. The same
 *     measured line is then drawn on the neutral palm diagram below, with the
 *     note मूल चित्र सुरक्षित नहीं रखा जाता in the margin — the absence stated
 *     in the margin, which is where a scribe states one.
 *  3. **Nothing.** No crop and no line. Returns null. The caller seals the leaf
 *     with a reason from `resolveChapter`, which knows the reason and this does
 *     not.
 *
 * THE STROKE LADDER IS THE ARGUMENT OF THE PAGE. The chapter's own line is drawn
 * at the ACTIVE rung (2px, full opacity, the soft gold-dust glow) and every
 * other line present at the SECONDARY rung (1px, 0.35). That is not decoration:
 * a plate showing four equal creases makes the reader hunt for the one the
 * chapter is about, and the two rungs in app/sanctuary.css exist precisely so
 * that the subject of a page leads and its context recedes.
 *
 * WHY THERE IS NO `"use client"` HERE.
 *
 * No state, no effect, no handler, no browser API — every value this renders
 * arrives as a prop, including the geometry. Reading `sessionStorage` is the
 * CALLER'S job (see `readPothiGeometry`), and it has to be: storage is a client
 * concern, while this component is markup and should stay renderable on the
 * server, in a test, and inside a client tree alike. A caller that is itself a
 * client component may of course render this; that is the arrangement the wax
 * seal already documents, and it costs nothing here because there is no hook to
 * pull across the boundary.
 *
 * WHAT IT REQUIRES OF THE ROUTE. `<SanctuaryDefs />` must be mounted, because
 * the neutral diagram strokes itself with the shared `#snc-g-gold` ramp. Without
 * the sprite the outline renders with no stroke at all — silently, the way every
 * missing SVG def fails.
 *
 * WHAT IT DOES NOT DO. It draws no leaf of its own: no parchment, no border, no
 * background. The caller lays it on a <Parchment>, which is what makes the burn
 * at the plate's rim read as the crop staining the sheet rather than as a frame
 * floating on one.
 */
import type { CSSProperties, ReactElement } from "react";
import { defUrl, SNC_GRADIENT_GOLD } from "@/components/sanctuary/material";
import type { CapabilityTier } from "@/components/sanctuary/use-capability-tier";
import {
  POTHI_PLATE_SIZE,
  pothiPlatePaths,
  type PothiGeometry,
  type PothiPlateLineId,
} from "@/lib/sanctuary/pothi-geometry";
import styles from "./palm-plate.module.css";

/* ------------------------------- The copy ---------------------------------- */

/**
 * The margin note for a revisited reading.
 *
 * "The original image is not kept." Devanagari, which the rest of the product
 * reserves for chapter titles and page numerals — deliberately so here: this is
 * a scribe's note about the manuscript itself, not a sentence of the reading,
 * and setting it in the same script as the chapter headings is what separates
 * the two. It states a POLICY in the present tense ("is not kept"), never an
 * apology and never a failure: nothing went wrong, the promise was kept.
 */
export const POTHI_PLATE_ORIGINAL_NOT_KEPT = "मूल चित्र सुरक्षित नहीं रखा जाता";

/**
 * How each line is named to a screen reader.
 *
 * Hinglish in Latin script, matching the chapter titles transliterated
 * (हृदय रेखा → "Hriday rekha") rather than the English words, because the label
 * is read out beside body copy that is already Hinglish and a lone English
 * "Heart line" would arrive in a different voice.
 */
export const POTHI_PLATE_LINE_LABELS: Readonly<Record<PothiPlateLineId, string>> = {
  heart: "Hriday rekha",
  head: "Mastishk rekha",
  life: "Jeevan rekha",
  fate: "Shani rekha",
};

/* --------------------------- The neutral diagram --------------------------- */

/**
 * The neutral palm, as a hairline outline in the plate's 0-100 square.
 *
 * AUTHORED, NOT TRACED — and, more importantly, REGISTERED. It is deliberately
 * nobody's hand, but it is not a free drawing either: a polyline projected onto
 * it was measured in a rectified crop, and unless this outline agrees with how
 * that crop is framed, every crease lands somewhere the reader's crease is not.
 * A pretty hand in the wrong frame would put a heart line across the knuckles
 * and still look finished, which is the A2 failure wearing a nicer coat.
 *
 * So the silhouette is built on `CANONICAL_ANCHORS` in lib/scan/rectify.ts —
 * where the rectifier actually puts the four palm landmarks, in the crop's own
 * 0-1 units, and therefore the only fixed points this drawing may not invent:
 *
 *     wrist        (0.50, 0.97)      thumb root (CMC)  (0.13, 0.74)
 *     index MCP    (0.24, 0.14)      little MCP        (0.85, 0.24)
 *     percussion   (0.96, 0.26)  — the ulnar bulge, from CANONICAL_PERCUSSION
 *
 * Read that table and the shape of this drawing follows from it. The crop frames
 * the PALM: the knuckle line sits a seventh of the way down, the wrist almost at
 * the bottom edge, and the fingers are mostly OUTSIDE the frame. Hence the two
 * things about this path that look like mistakes and are not.
 *
 *  1. **It is open, and it has no thumb.** The four finger sides run to the top
 *     edge and simply stop, in four separate subpaths, because the fingers
 *     continue past the crop and a rounded fingertip drawn inside the frame
 *     would claim they end there. The thumb is off the left edge for the same
 *     reason — the canonical thumb root already sits at x = 0.13 — so the radial
 *     edge merely passes THROUGH it. Closing the shape, or drawing the missing
 *     parts, would be drawing what the camera did not frame.
 *  2. **The palm fills the whole square.** That is what makes a life line curve
 *     around the ball of the thumb here instead of floating in the middle of a
 *     smaller hand.
 *
 * It carries no creases of its own. A neutral palm with a suggested life line
 * printed on it would put a line in front of the reader that nobody measured,
 * one rung away from a line that somebody did — which is the A2 failure with
 * extra steps.
 */
export const NEUTRAL_PALM_PATH = [
  /* the radial edge: the index finger's thumb side, down past the thumb root, round to the wrist */
  "M 16.5 0",
  "C 16 6 15.4 10 15.4 14.5",
  "C 13.8 32 12.8 52 13 74",
  "C 13.4 82 16 90 22 94",
  /* the wrist */
  "C 30 97.5 42 98 50 97",
  /* the ulnar edge: up past the percussion bulge to the little finger */
  "C 62 95.5 74 90 82 82",
  "C 88 74 93 60 95 46",
  "C 96 38 96 32 96 26",
  "C 95.6 22 93.6 20 92.8 16",
  "L 92.5 0",
  /* the web between index and middle */
  "M 31.5 0",
  "C 31.8 6 32 12 32.4 16",
  "Q 34.1 21 35.9 17",
  "C 36.2 12 36.5 6 36.8 0",
  /* the web between middle and ring */
  "M 51.8 0",
  "C 52.2 7 52.6 15 53 20",
  "Q 54.6 25 56.2 21",
  "C 56.5 14 56.8 7 57.2 0",
  /* the web between ring and little */
  "M 72.2 0",
  "C 72.7 8 73.2 18 73.6 24",
  "Q 75.2 29 76.9 25",
  "C 77.1 17 77.3 8 77.5 0",
].join(" ");

/* -------------------------------- Drawing ---------------------------------- */

/**
 * The two rungs of the stroke ladder, by their global class names.
 *
 * Global and not CSS-module classes on purpose: the ladder is declared once in
 * app/sanctuary.css (`--snc-stroke-active-*`, `--snc-stroke-secondary-*`) so that
 * every stroke in the sanctuary is one of exactly two weights. Re-declaring
 * either width here would create a third rung that looked identical until
 * somebody re-tuned the ladder and this plate did not follow.
 */
const STROKE_ACTIVE = "snc-stroke-active";
const STROKE_SECONDARY = "snc-stroke-secondary";

/**
 * Gold for the ink, as flat tokens rather than the `#snc-g-gold` ramp.
 *
 * THE REASON IS GEOMETRIC, NOT AESTHETIC. An SVG gradient paints in
 * objectBoundingBox units by default, and a traced crease can be very nearly
 * straight — a head line often is. A bounding box of zero height makes the
 * gradient degenerate, and the affected engines respond by painting the stroke
 * with NOTHING: the chapter's own line disappears on exactly the hands whose
 * head line is straightest. Flat tokens cannot do that. The neutral diagram is a
 * large closed shape with no such risk, so it keeps the family's ramp and the
 * plate still belongs to the ornament set.
 *
 * The active line takes gold-400 (the palette's own "foil highlight, active
 * state") and everything else gold-500 (its "primary gold, all linework"), so
 * the ladder is carried by weight, opacity, glow AND value at once.
 */
const INK_ACTIVE = "var(--color-snc-gold-400)";
const INK_SECONDARY = "var(--color-snc-gold-500)";

/** Radius of the travelling particle, in plate units — under a pixel at any size a leaf is read at. */
const TRAIL_RADIUS = 0.9;

/** Stroke geometry shared by every drawn line. See each note: all three are load-bearing. */
const STROKE_GEOMETRY = {
  fill: "none",
  /* Pixel widths, not scaled ones: the ladder's 1px and 2px are measured on the
   * SCREEN, and a plate rendered at 320px would otherwise draw its "2px" active
   * line at six and a half. Same rule the whole ornament family follows. */
  vectorEffect: "non-scaling-stroke",
  /* A crease ends where the evidence ends; a butt cap would chop it square. */
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;

/** The custom property the trail's motion path travels along; set per render because the path is measured. */
interface PalmPlateStyle extends CSSProperties {
  "--snc-plate-trail"?: string;
}

/** Joins class names, dropping the absent ones — the FLOOR tier omits a class rather than passing "". */
function cx(...names: readonly (string | undefined)[]): string {
  return names.filter((name): name is string => name !== undefined && name.length > 0).join(" ");
}

/* -------------------------------- The plate -------------------------------- */

export interface PalmPlateProps {
  /**
   * The crease this chapter is about. It gets the active rung and the trail;
   * every other line in the hand-off recedes to the secondary rung.
   *
   * Typed as {@link PothiPlateLineId} — the four creases /scan extracts — so a
   * chapter that could never have a polyline (VI's RESERVED sun and mercury)
   * cannot be handed to this component at all. Chapter VI is sealed by the data
   * layer for that same reason; the type keeps the two answers agreeing.
   */
  readonly lineId: PothiPlateLineId;
  /**
   * The scan session's hand-off, or null.
   *
   * Null is an ordinary value, not an error: a revisited reading, a private-mode
   * browser and a fresh tab all produce it, and it makes this component render
   * nothing so the caller can seal the leaf with a reason it knows and this
   * component does not.
   */
  readonly geometry: PothiGeometry | null;
  /**
   * [R6] The device's measured rendering budget, spelled in full and never as a
   * bare `tier` (`ReadingTier` already means something else, and the Pothi shows
   * both at once).
   *
   * It changes exactly one thing: at FLOOR the travelling particle's animation
   * class is not emitted, so the cheapest devices never allocate the animation.
   * The crop, the wash, the burn, the outline and every traced line are
   * identical at every tier. Motion is what degrades; the material never is.
   *
   * Defaults to HIGH because the fallback for an unmeasured caller should be the
   * full page — a caller that has measured a tier always passes it, and
   * `prefers-reduced-motion` removes the motion for everyone else regardless of
   * what is passed here.
   */
  readonly capabilityTier?: CapabilityTier;
  /** Classes for the figure. The stylesheet sits in @layer components, so a utility passed here still wins. */
  readonly className?: string;
}

/**
 * The measured hand.
 *
 * @returns the plate, or null when the hand-off carries neither a crop nor a
 * single drawable line — in which case the caller seals the leaf.
 */
export function PalmPlate({
  lineId,
  geometry,
  capabilityTier = "HIGH",
  className,
}: PalmPlateProps): ReactElement | null {
  const paths = geometry === null ? [] : pothiPlatePaths(geometry);
  const crop = geometry?.cropDataUrl;

  /* Nothing measured survived. Render nothing rather than a frame around an
   * empty square — an empty plate is a picture of a hand we do not have. */
  if (paths.length === 0 && crop === undefined) return null;

  const active = paths.find((path) => path.id === lineId) ?? null;
  const others = paths.filter((path) => path.id !== lineId);
  const measured = crop !== undefined;

  /* The particle exists only when there is a line for it to travel, and only
   * above FLOOR. prefers-reduced-motion stops it a second time, in the
   * stylesheet, because the tier is measured once at mount while the preference
   * is a live query the reader can flip without this tree re-rendering. */
  const trail = active !== null && capabilityTier !== "FLOOR";
  const trailStyle: PalmPlateStyle | undefined =
    active === null ? undefined : { "--snc-plate-trail": `path("${active.d}")` };

  const label = plateLabel(lineId, measured, active !== null);
  const box = `0 0 ${POTHI_PLATE_SIZE} ${POTHI_PLATE_SIZE}`;

  return (
    <figure className={cx(styles.plate, className)} data-snc-plate={measured ? "measured" : "neutral"}>
      <div className={styles.frame}>
        {measured ? (
          <>
            {/* The crop, aged by the stylesheet's filter chain. `preserveAspectRatio="none"`
                is a correctness choice, not a lazy one: the polylines are projected onto the
                full square, so the image must fill the same square exactly. Any letterboxing
                or slicing would slide the ink off the creases it was traced from — and the
                crop is square by construction anyway, so nothing is actually stretched. */}
            <svg
              className={cx(styles.layer, styles.crop)}
              viewBox={box}
              preserveAspectRatio="none"
              aria-hidden="true"
              data-snc-layer="crop"
            >
              <image
                href={crop}
                x={0}
                y={0}
                width={POTHI_PLATE_SIZE}
                height={POTHI_PLATE_SIZE}
                preserveAspectRatio="none"
              />
            </svg>
            <span className={cx(styles.layer, styles.wash)} aria-hidden="true" data-snc-layer="wash" />
            <span className={cx(styles.layer, styles.burn)} aria-hidden="true" data-snc-layer="burn" />
          </>
        ) : null}

        <svg
          className={cx(styles.layer, styles.ink)}
          viewBox={box}
          preserveAspectRatio="none"
          role="img"
          aria-label={label}
          data-snc-layer="ink"
        >
          {measured ? null : (
            /* The neutral palm, at the secondary rung: it is context for the
               measured line, never a claim of its own. */
            <path
              d={NEUTRAL_PALM_PATH}
              className={STROKE_SECONDARY}
              stroke={defUrl(SNC_GRADIENT_GOLD)}
              data-snc-part="neutral-palm"
              {...STROKE_GEOMETRY}
            />
          )}

          {others.map((path) => (
            <path
              key={path.id}
              d={path.d}
              className={STROKE_SECONDARY}
              stroke={INK_SECONDARY}
              data-snc-line={path.id}
              data-snc-rung="secondary"
              {...STROKE_GEOMETRY}
            />
          ))}

          {active === null ? null : (
            <path
              d={active.d}
              className={STROKE_ACTIVE}
              stroke={INK_ACTIVE}
              data-snc-line={active.id}
              data-snc-rung="active"
              {...STROKE_GEOMETRY}
            />
          )}

          {active === null ? null : (
            /* Drawn at the origin and moved entirely by `offset-path`, so a
               browser without motion paths leaves it where the stylesheet's base
               state has already made it invisible rather than parking a visible
               dot in the corner of the plate. */
            <circle
              className={cx(styles.trail, trail ? styles.trailAnimated : undefined)}
              cx={0}
              cy={0}
              r={TRAIL_RADIUS}
              fill={INK_ACTIVE}
              style={trailStyle}
              data-snc-part="trail"
            />
          )}
        </svg>
      </div>

      {measured ? null : (
        <figcaption className={styles.margin} data-snc-layer="margin">
          {POTHI_PLATE_ORIGINAL_NOT_KEPT}
        </figcaption>
      )}
    </figure>
  );
}

/**
 * What the plate says it is showing, derived from what it is actually showing.
 *
 * Four sentences for four real states, and not one of them is a template with a
 * hole in it: a reader on a screen reader is told whether this is their own
 * scanned palm or a neutral diagram, because that difference is the whole of R3
 * and hiding it behind one generic "palm diagram" label would put the sighted
 * reader's margin note out of reach of everybody else.
 */
function plateLabel(lineId: PothiPlateLineId, measured: boolean, hasActive: boolean): string {
  const line = POTHI_PLATE_LINE_LABELS[lineId];
  if (measured) {
    return hasActive
      ? `Aapke scan ki hatheli, jis par aapki naapi gayi ${line} khinchi hai.`
      : "Aapke scan ki hatheli ka chitra.";
  }
  return hasActive
    ? `Aam hatheli ka chitra, jis par aapki naapi gayi ${line} khinchi hai.`
    : "Aam hatheli ka chitra, jis par aapki naapi gayi rekhaayein khinchi hain.";
}
