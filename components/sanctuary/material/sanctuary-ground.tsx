import type { ReactElement } from "react";
/* [R6] The one `CapabilityTier` in the sanctuary, imported and never redeclared. `import type` is
 * erased at compile time, so naming a type that lives in a `"use client"` module costs no bundle
 * weight and does not pull this server component across the client boundary. */
import type { CapabilityTier } from "../use-capability-tier";
import { SNC_FILTER_GRAIN, defUrl } from "./ids";
import { seededJitter, seededRandom } from "./rng";
import styles from "./sanctuary-ground.module.css";

/**
 * NOTE THE ABSENCE OF `"use client"`, AND KEEP IT ABSENT. This component has no
 * state, no effect and no handler: it is a shell, five painted divs and two
 * small inline SVGs, all of it decided at render time from a number. It costs
 * exactly zero client JavaScript, and it must, because it is mounted on every
 * sanctuary route and is the one thing on the screen the reader never interacts
 * with.
 */

/* ------------------------------ the scratches ----------------------------- */

/**
 * Seven. "A handful" in the brief, and the number matters in both directions:
 * three reads as someone having drawn three lines, and a dozen reads as
 * hatching. Seven scored marks across a whole viewport is damage — you notice
 * the surface is old without ever counting them.
 */
export const SANCTUARY_GROUND_SCRATCH_COUNT = 7;

/**
 * One scored hairline, in the 0–100 square the scratch layer is drawn in.
 *
 * A viewBox-relative square rather than pixels because the layer is stretched
 * to the viewport with `preserveAspectRatio="none"`: the scratches spread with
 * the screen instead of clustering in one corner of a wide monitor, and the
 * stroke stays hairline because each line asks for `non-scaling-stroke`.
 */
export interface SanctuaryGroundScratch {
  readonly x1: number;
  readonly y1: number;
  readonly x2: number;
  readonly y2: number;
}

/** Inset from the edges where a scratch may start, so no mark begins exactly on the frame. */
const SCRATCH_MARGIN = 6;

/** Shortest and longest travel along one axis. Both ends are non-zero, which is what keeps every scratch off the horizontal and the vertical. */
const SCRATCH_MIN_RUN = 7;
const SCRATCH_MAX_RUN = 31;

/** Two decimals: shorter markup, and far past the point where a rounding difference could be seen. */
const round2 = (value: number): number => Math.round(value * 100) / 100;

/**
 * The scratch field for a seed — the same seven lines, in the same places,
 * forever, on the server and in the browser.
 *
 * WHY THERE IS NO TRIGONOMETRY IN HERE, WHICH LOOKS LIKE THE OBVIOUS WAY TO
 * WRITE IT. An angle-and-length formulation needs `Math.cos`/`Math.sin`, and
 * those are the one corner of the language whose last bits are explicitly
 * implementation-defined: two engines may disagree in the sixteenth decimal.
 * That is normally nothing, and here it is a hydration mismatch — React
 * compares the server's `x2="61.37"` against the client's, throws away the
 * subtree on any difference, and the ground visibly re-scratches itself. Each
 * endpoint is instead an independent signed run added to the start point, which
 * is addition and multiplication of doubles: correctly rounded, and therefore
 * bit-identical in every engine.
 *
 * Both runs are bounded away from zero, so no line can come out axis-aligned,
 * and their ratio varies freely — which is what "odd angles" means. A line is
 * allowed to run off the edge; a scratch that stops politely inside the frame
 * is a drawing, not damage.
 *
 * WHY THE VERTICAL POSITION IS STRATIFIED AND THE HORIZONTAL ONE IS NOT.
 * Seven independent draws down a screen clump: roughly one seed in three puts
 * four of them in the same third of the viewport, and four short marks at
 * similar angles in one place stop reading as damage and start reading as
 * deliberate hatching. Each scratch is therefore given its own horizontal band
 * and jittered inside it, which spreads the field down the screen for EVERY
 * seed rather than for the lucky ones. Left to right is left free, because a
 * scratch is as likely at one side as the other and a grid in both axes would
 * be visible as a grid.
 *
 * Exported so its stability is testable without rendering anything.
 */
export function sanctuaryGroundScratches(seed: number, count: number): readonly SanctuaryGroundScratch[] {
  if (!Number.isFinite(count) || count <= 0) return [];
  const bands = Math.floor(count);
  const next = seededRandom(seed);
  const span = 100 - SCRATCH_MARGIN * 2;
  const runSpan = SCRATCH_MAX_RUN - SCRATCH_MIN_RUN;
  const scratches: SanctuaryGroundScratch[] = [];

  for (let i = 0; i < bands; i += 1) {
    const x1 = SCRATCH_MARGIN + next() * span;
    const y1 = SCRATCH_MARGIN + ((i + next()) / bands) * span;
    const runX = (SCRATCH_MIN_RUN + next() * runSpan) * (next() < 0.5 ? -1 : 1);
    const runY = (SCRATCH_MIN_RUN + next() * runSpan) * (next() < 0.5 ? -1 : 1);
    scratches.push({ x1: round2(x1), y1: round2(y1), x2: round2(x1 + runX), y2: round2(y1 + runY) });
  }

  return scratches;
}

/* ------------------------------ the watermark ----------------------------- */

/**
 * Six degrees of tilt, either way.
 *
 * Enough that two sanctuary routes seen one after the other are not
 * photocopies, and far too little to read as a rotated graphic — an ornament
 * cut into stone was cut at whatever angle the hand held, never at a stated
 * one. It is a static attribute in the markup, not a transition and not a CSS
 * transform: nothing here moves, and nothing here can become the containing
 * block for a fixed element.
 */
export const SANCTUARY_GROUND_ORNAMENT_TILT_DEG = 6;

/**
 * A prime offset, so the ornament's tilt is drawn from a different part of the
 * generator than the scratches. Without it, seed *n*'s first scratch and its
 * ornament would be the same number wearing two hats, and two grounds one seed
 * apart would rotate in step with their own scratch field.
 */
const ORNAMENT_SEED_OFFSET = 977;

/** The engraved rosette's petal angles — six, at even sixths of a turn. Written out rather than computed so the markup is obviously fixed. */
const ROSETTE_PETAL_ANGLES: readonly number[] = [0, 30, 60, 90, 120, 150];

/* --------------------------------- component ------------------------------- */

/** What the ground needs to know, which is almost nothing — it is a room, not a control. */
export interface SanctuaryGroundProps {
  /**
   * Deterministic variation: the scratch field and the ornament's tilt. Same
   * seed, same ground, every render on both sides of the wire. Callers usually
   * already have one — a route index, a reading id hashed down — and passing a
   * different number per route is what stops the sanctuary looking printed.
   */
  readonly seed: number;
  /**
   * [R6] The device's rendering budget, spelled in full and never as a bare
   * `tier` (`ReadingTier` already means something else).
   *
   * IT CHANGES NOTHING HERE, AND THAT IS THE POINT, STATED OUT LOUD RATHER THAN
   * IMPLIED BY A MISSING BRANCH. Nothing in the ground animates at any tier —
   * there is no transition, no keyframe, no rAF — so FLOOR has nothing to turn
   * off, and every stratum renders in full on the weakest device and under
   * `prefers-reduced-motion`. What FLOOR withholds is motion; the material is
   * never what degrades. The value is published on the root as a data
   * attribute so a scene above can style against it and so this promise is
   * visible in devtools instead of being folded away.
   */
  readonly capability: CapabilityTier;
}

/**
 * The warm near-black stone every sanctuary route is carved out of: six fixed,
 * non-interactive strata behind the whole viewport.
 *
 * WHAT IT IS FOR. Observation 6 — the ground is near-black and warm, lit from
 * one place, heavily vignetted, and nothing glows. A flat fill of the same
 * token reads as a dark theme; this reads as a room. The strata, back to front,
 * are base, warm stone, grain, scratches, vignette, ornament, and each one is
 * tagged `data-snc-layer` so the stack is legible in devtools and assertable in
 * a test rather than being six anonymous divs.
 *
 * WHAT IT REQUIRES OF THE ROUTE. Exactly two things.
 *
 *  1. `<SanctuaryDefs />` must be mounted on the route. The grain stratum
 *     references the shared `#snc-f-grain` — one noise field for the whole
 *     sanctuary rather than a copy per component, which is the difference §10's
 *     LOW and FLOOR devices actually feel. If the sprite is missing the grain
 *     rect paints as an unfiltered black rectangle and the ground goes visibly
 *     wrong on the first frame. That is deliberate: a silent loss of texture
 *     would be mistaken for a design choice and shipped, and this is the one
 *     failure mode worth making loud.
 *  2. Nothing between this element and the viewport may create a stacking
 *     context — mount it as a child of the route's own root. The negative
 *     z-index is what lets content sit above it without any wrapper, and a
 *     `transform` or `isolation` on an ancestor would seal it inside a box.
 *
 * WHAT IT PROMISES BACK. It never paints over content, never takes a pointer
 * event, never repaints on scroll, and never becomes the containing block for
 * anybody else's `position: fixed` element — see the stylesheet's note on the
 * properties this file refuses to contain.
 */
export function SanctuaryGround({ seed, capability }: SanctuaryGroundProps): ReactElement {
  const scratches = sanctuaryGroundScratches(seed, SANCTUARY_GROUND_SCRATCH_COUNT);
  const [tilt = 0] = seededJitter(seed + ORNAMENT_SEED_OFFSET, 1, SANCTUARY_GROUND_ORNAMENT_TILT_DEG);

  return (
    <div className={styles.ground} data-snc-capability={capability} aria-hidden="true">
      {/* 1. BASE — opaque, warm, and the colour every corner returns to. */}
      <div className={`${styles.layer} ${styles.base}`} data-snc-layer="base" />

      {/* 2. STONE — one warm source pooling on brown, plus its bounce and the near floor. */}
      <div className={`${styles.layer} ${styles.stone}`} data-snc-layer="stone" />

      {/* 3. GRAIN — the shared fibre field, referenced and never inlined. The rect keeps its
          default paint so a missing sprite is loudly wrong rather than quietly flat. */}
      <div className={`${styles.layer} ${styles.grain}`} data-snc-layer="grain">
        {/* NO viewBox, deliberately: the grain must be generated in device space, so a feature
            stays the size of a pixel or two on every screen instead of being stretched with the
            viewport the way the scratch field below is. */}
        <svg className={styles.fill} aria-hidden="true" focusable="false">
          <rect width="100%" height="100%" filter={defUrl(SNC_FILTER_GRAIN)} />
        </svg>
      </div>

      {/* 4. SCRATCHES — seven scored hairlines from the seed, on the secondary rung of the stroke
          ladder so they are the same weight as every other faint line in the product. */}
      <div className={`${styles.layer} ${styles.scratches}`} data-snc-layer="scratches">
        <svg
          className={styles.fill}
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          aria-hidden="true"
          focusable="false"
        >
          {scratches.map((scratch, index) => (
            <line
              /* Index is the identity here: the list is fixed-length, never reordered and never
                 filtered, and two scratches could legitimately share a start point. */
              key={index}
              className="snc-stroke-secondary"
              x1={scratch.x1}
              y1={scratch.y1}
              x2={scratch.x2}
              y2={scratch.y2}
              stroke="currentColor"
              /* The layer is stretched to the viewport, so without this the "1px" ladder width
                 would be scaled by the aspect ratio and a scratch would fatten on a wide screen. */
              vectorEffect="non-scaling-stroke"
            />
          ))}
        </svg>
      </div>

      {/* 5. VIGNETTE — the falloff of that one source. Corners resolve to the base. */}
      <div className={`${styles.layer} ${styles.vignette}`} data-snc-layer="vignette" />

      {/* 6. WATERMARK — one engraved sprig in the upper right, as in the reference: a vine, two
          leaves, a tendril and a six-petal rosette, all hairline, all cut into the stone. It is
          the last thing painted because an engraved edge survives in a corner the flat tone
          around it has already lost. */}
      <div className={styles.watermark} data-snc-layer="watermark">
        <svg
          className={styles.fill}
          viewBox="0 0 100 100"
          preserveAspectRatio="xMaxYMin meet"
          aria-hidden="true"
          focusable="false"
        >
          <g
            className="snc-stroke-secondary"
            fill="none"
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            transform={`rotate(${round2(tilt)} 62 40)`}
          >
            {/* the vine, falling from the top-right corner */}
            <path d="M97 3C84 14 71 27 62 42c-8 13-12 27-12 43" />
            {/* upper leaf, on the outside of the curve */}
            <path d="M78 20c-11-5-22-2-27 7 10 6 22 5 27-7Z" />
            {/* lower leaf, opposed, so the vine reads as grown rather than drawn */}
            <path d="M62 42c12-2 22 4 24 14-11 4-22-3-24-14Z" />
            {/* the tendril at the foot */}
            <path d="M50 85c-6-8-15-11-23-7 4 9 14 13 23 7Z" />
            {/* the short branch the rosette blooms off — without it the flower floats beside the
                vine instead of belonging to it, which is the tell of an ornament assembled rather
                than grown */}
            <path d="M57 56c-8 2-15 5-20 9" />
            {/* the rosette: six petals about one centre, and a struck dot in the middle */}
            <g transform="translate(34 66)">
              {ROSETTE_PETAL_ANGLES.map((angle) => (
                <ellipse key={angle} cx="0" cy="0" rx="4.2" ry="11" transform={`rotate(${angle})`} />
              ))}
              <circle cx="0" cy="0" r="2.4" />
            </g>
          </g>
        </svg>
      </div>
    </div>
  );
}
