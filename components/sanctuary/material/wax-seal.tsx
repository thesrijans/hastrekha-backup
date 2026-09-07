import type { ReactElement } from "react";
import { SNC_GRADIENT_WAX, defUrl } from "./ids";
import { seededJitter, seededRandom } from "./rng";
/* [R6] The one `CapabilityTier` in the sanctuary, imported rather than redeclared, and imported as
 * a TYPE so nothing at runtime crosses from this server component into the client hook that
 * declares it. There is no prop named `tier` here: `ReadingTier` already means something else. */
import type { CapabilityTier } from "@/components/sanctuary/use-capability-tier";
import styles from "./wax-seal.module.css";

/**
 * NOTE THE ABSENCE OF `"use client"`, WHICH IS A DECISION AND NOT AN OVERSIGHT.
 *
 * The A3 brief assumed the 200 ms press would make this a client component. It does not. The press
 * is a one-shot CSS animation triggered by a class that is a pure function of the props, so there
 * is no state, no effect and no handler anywhere in this file — and the house rule is that
 * `"use client"` goes on a component only when one of those three exists. Keeping it off buys three
 * things that a `motion.svg` would have cost:
 *
 *   1. ZERO CLIENT JAVASCRIPT. A seal is a decoration at the foot of a reading. Shipping a
 *      component, its props and framer-motion's runtime to every device so that a 200 ms squash can
 *      play once is the kind of weight that is invisible in review and measurable on the LOW and
 *      FLOOR devices §10 describes.
 *   2. A REDUCED-MOTION GUARANTEE THAT DOES NOT DEPEND ON JS. The stylesheet's
 *      `prefers-reduced-motion` block is true on the first painted frame, before hydration, and
 *      stays true if the bundle never arrives. A JS-only check animates at somebody who asked for
 *      stillness for as long as it takes the hook to settle.
 *   3. A SEAL THAT SURVIVES SSR EXACTLY. Every coordinate below comes from the `seed` prop through
 *      `seededRandom`, never from `Math.random`, so the shape the server writes and the shape the
 *      browser would compute are the same string. That is the property that lets a torn, irregular
 *      thing be server-rendered at all.
 *
 * The caller may of course be a client component and pass a measured `capability`; that is the
 * normal case, and it costs this file nothing.
 */

/* ------------------------------- the shape -------------------------------- */

/**
 * The seal's coordinate system: a 100x100 viewBox, so every constant in this file reads as a
 * percentage of the seal and the geometry is independent of the `size` it is rendered at.
 */
export const WAX_SEAL_VIEWBOX = 100;

/** Dead centre of that box, which every lobe, the emblem and the legend are placed against. */
const CENTRE = WAX_SEAL_VIEWBOX / 2;

/**
 * 38 of 100 — the radius the lobes vary around.
 *
 * Not 50: the wax has to leave room for its own cast shadow and for the outward travel of a lobe,
 * and a blob that touches the edges of its box cannot be laid over anything without being clipped.
 */
export const WAX_SEAL_BASE_RADIUS = 38;

/**
 * 3.2 — how far a lobe may travel from {@link WAX_SEAL_BASE_RADIUS}, i.e. roughly 8% of the radius.
 *
 * This number is the whole difference between poured wax and a logo, and it is bounded in both
 * directions on purpose. Below about 2 the eye reads a circle with a rendering artefact; above
 * about 6 the blob starts to read as a splat or a flower, and a seal is neither. 8% is the amount
 * of irregularity that registers as "this was pressed by a hand" without ever becoming the subject.
 */
export const WAX_SEAL_RADIUS_JITTER = 3.2;

/** Fewest lobes a seal may have. Below eight the polygon under the curve becomes legible as a polygon. */
export const WAX_SEAL_LOBE_MIN = 8;

/** Most lobes a seal may have. Above twelve the lobes are smaller than the jitter and the outline smooths back into a circle. */
export const WAX_SEAL_LOBE_MAX = 12;

/**
 * How much of the angular step between lobes may be spent rotating a lobe off its even position,
 * as a fraction of that step.
 *
 * Radial jitter alone leaves the lobes at perfectly even angles, and evenly spaced bumps read as a
 * cog. 22% of the step is enough that no two gaps are the same width, and small enough that two
 * neighbours can never cross and fold the outline over itself.
 */
const ANGULAR_JITTER_FRACTION = 0.22;

/**
 * Offset added to the seed for the angular draw, so the angles are a DIFFERENT stream from the
 * radii rather than the same numbers reused.
 *
 * With one stream the lobe that reaches furthest out is also always the one rotated furthest
 * clockwise, and every seal in the product shares that correlation — a signature the eye picks up
 * across a page even though no single seal looks wrong.
 */
const ANGULAR_SEED_OFFSET = 1013;

/**
 * Catmull-Rom tension as the standard 1/6 of the neighbour span.
 *
 * A closed Catmull-Rom spline rather than arcs or a polygon because it is the only one of the three
 * that passes exactly THROUGH each lobe point — which is what makes the radii recoverable from the
 * path string, and therefore what makes "this is not a circle" a testable claim rather than a
 * visual opinion.
 */
const SPLINE_TENSION = 1 / 6;

/**
 * Two decimals on every coordinate.
 *
 * Not tidiness: the server and the browser must produce byte-identical path data or React discards
 * the subtree and re-renders it. Rounding to a fixed grid makes the last bits of a `Math.cos`
 * irrelevant, and normalising `-0` to `0` keeps two engines that disagree about the sign of zero
 * from disagreeing about the markup.
 */
function coord(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  return String(rounded === 0 ? 0 : rounded);
}

/** One point on the rim, in viewBox units. */
interface LobePoint {
  readonly x: number;
  readonly y: number;
}

/**
 * The ring of lobe points for a seed: 8-12 of them, each pushed off the base radius and rotated off
 * its even angle, deterministically.
 */
function lobePoints(seed: number): readonly LobePoint[] {
  const pick = seededRandom(seed);
  const count = WAX_SEAL_LOBE_MIN + Math.floor(pick() * (WAX_SEAL_LOBE_MAX - WAX_SEAL_LOBE_MIN + 1));
  const step = (Math.PI * 2) / count;
  const radial = seededJitter(seed, count, WAX_SEAL_RADIUS_JITTER);
  const angular = seededJitter(seed + ANGULAR_SEED_OFFSET, count, step * ANGULAR_JITTER_FRACTION);

  const points: LobePoint[] = [];
  for (let i = 0; i < count; i += 1) {
    const angle = i * step + angular[i];
    const radius = WAX_SEAL_BASE_RADIUS + radial[i];
    points.push({ x: CENTRE + Math.cos(angle) * radius, y: CENTRE + Math.sin(angle) * radius });
  }
  return points;
}

/**
 * The outline of one seal, as SVG path data: a closed, smooth, irregular blob of poured wax.
 *
 * Exported and free of React on purpose. This is the claim the whole component rests on — that the
 * seal is not a red circle — and a claim that can only be checked by looking at a screenshot is a
 * claim nobody checks twice. Every cubic segment ENDS on a lobe point, so a test can read the
 * radii straight back out of the string this returns and assert that they differ, that they stay
 * inside {@link WAX_SEAL_RADIUS_JITTER}, and that the same seed produces the same wax forever.
 *
 * Smooth curves rather than straight sides because the difference between poured wax and a polygon
 * is not the number of sides, it is that wax has no corners: surface tension rounds every one of
 * them on the way down.
 */
export function waxSealPath(seed: number): string {
  const points = lobePoints(seed);
  const count = points.length;
  /* Defensive rather than a throw: `lobePoints` cannot return an empty ring today, and a decoration
   * that throws during render is a blank page rather than a missing ornament. */
  if (count === 0) return "";

  const at = (index: number): LobePoint => points[((index % count) + count) % count];
  let path = `M ${coord(points[0].x)} ${coord(points[0].y)}`;

  for (let i = 0; i < count; i += 1) {
    const previous = at(i - 1);
    const start = at(i);
    const end = at(i + 1);
    const following = at(i + 2);
    const c1x = start.x + (end.x - previous.x) * SPLINE_TENSION;
    const c1y = start.y + (end.y - previous.y) * SPLINE_TENSION;
    const c2x = end.x - (following.x - start.x) * SPLINE_TENSION;
    const c2y = end.y - (following.y - start.y) * SPLINE_TENSION;
    path += ` C ${coord(c1x)} ${coord(c1y)} ${coord(c2x)} ${coord(c2y)} ${coord(end.x)} ${coord(end.y)}`;
  }

  return `${path} Z`;
}

/* ------------------------------- the emblems ------------------------------ */

/**
 * Which mark is pressed into the wax.
 *
 * A closed union rather than a free string, so a fourth emblem is a compile error at every call
 * site until its geometry exists — an unknown emblem name would otherwise stamp a blank seal, which
 * looks like an unfinished feature rather than a bug.
 */
export type WaxEmblem = "palm" | "lotus" | "trishul";

/**
 * One emblem's line work, split by how it is painted.
 *
 * Two arrays and not one, because the two are genuinely different marks: `strokes` are engraved
 * lines, which need round caps and a weight, and `fills` are solid pressed areas, which need
 * neither. Keeping them apart is what lets both be rendered twice — once dark, once as the lit lip
 * — from one description.
 */
export interface WaxEmblemGeometry {
  /** Open or closed paths drawn as engraved line work, in viewBox units. */
  readonly strokes: readonly string[];
  /** Closed paths pressed as solid areas, in viewBox units. */
  readonly fills: readonly string[];
}

/**
 * Original vector geometry for each emblem, drawn against the same 100x100 box as the blob.
 *
 * Drawn, not traced: these are constructed from the descriptions in the brief — an open hand, an
 * engraved bloom, a staff with a trident, an arc and a diamond — rather than lifted off the
 * reference photographs, which are lit, damaged, and someone else's line work.
 *
 * All three sit inside a radius of about 21 from the centre, comfortably within the smallest lobe
 * a seed can produce ({@link WAX_SEAL_BASE_RADIUS} minus {@link WAX_SEAL_RADIUS_JITTER}), so no
 * emblem can ever run off the edge of its own wax.
 */
export function waxEmblemGeometry(emblem: WaxEmblem): WaxEmblemGeometry {
  switch (emblem) {
    /* An open hand seen palm-out: the knuckle line, four fingers of four different lengths, a thumb
     * swung away from the body of the hand, and one engraved crease across the palm — which is the
     * line this entire product is about, and the reason this is the default emblem. */
    case "palm":
      return {
        strokes: [
          "M 41.4 60.5 C 38.8 55 39.2 48.6 40.8 44.4 L 59.2 44.4 C 60.8 48.6 61.2 55 58.6 60.5 C 55.6 65.2 44.4 65.2 41.4 60.5 Z",
          "M 40.9 49.6 C 37.4 48.2 34.6 49.8 33.6 53.2",
          "M 44.2 44.4 L 44.2 34.8",
          "M 48.6 44.4 L 48.6 32.6",
          "M 53 44.4 L 53.2 34",
          "M 57.2 44.4 L 57.8 37.4",
          "M 46.2 46.6 C 44.4 51.4 45.2 56.4 48.4 59.4",
        ],
        fills: [],
      };

    /* A bloom seen head-on: one upright centre petal, a pair leaning out of it, a pair lower and
     * wider still, and the water line under all five. Five petals and not six, because an odd count
     * has a centre and a symmetric axis, which is what makes a lotus read as a lotus. */
    case "lotus":
      return {
        strokes: [
          "M 50 31.6 C 45.4 38.4 44.8 48.4 50 56.6 C 55.2 48.4 54.6 38.4 50 31.6 Z",
          "M 50 56.6 C 42.6 53.8 37.4 46 37.6 37.8 C 43.4 41 48.2 48.2 50 56.6 Z",
          "M 50 56.6 C 57.4 53.8 62.6 46 62.4 37.8 C 56.6 41 51.8 48.2 50 56.6 Z",
          "M 50 57.6 C 41.6 59 32.8 55.2 29.2 48 C 36 46.2 44.6 50.2 50 57.6 Z",
          "M 50 57.6 C 58.4 59 67.2 55.2 70.8 48 C 64 46.2 55.4 50.2 50 57.6 Z",
          "M 38.8 61.6 C 43.4 65.4 56.6 65.4 61.2 61.6",
        ],
        fills: [],
      };

    /* Staff, two outer tines curving in to their points, the yoke they spring from, the band across
     * the shaft, and the diamond at the foot — the only solid area in any of the three, so the
     * trishul is also the emblem that proves the fill path is wired at all. */
    case "trishul":
      return {
        strokes: [
          "M 50 30.2 L 50 60.4",
          "M 40.2 45.6 C 38.8 39 40.2 33.4 43.4 29.8",
          "M 59.8 45.6 C 61.2 39 59.8 33.4 56.6 29.8",
          "M 40.2 45.6 C 44.2 47.8 55.8 47.8 59.8 45.6",
          "M 42.6 54.6 C 46.2 57.4 53.8 57.4 57.4 54.6",
        ],
        fills: ["M 50 59.4 L 53.4 64.4 L 50 69.4 L 46.6 64.4 Z"],
      };
  }
}

/* ------------------------------ the press --------------------------------- */

/**
 * 200 ms: the squash on mount, in the one place the component and its stylesheet can both be
 * checked against.
 *
 * Deliberately shorter than `--snc-duration-fast` (400 ms), which is the band for things that
 * travel. A stamp does not travel; it lands.
 */
export const WAX_SEAL_PRESS_DURATION_MS = 200;

/**
 * How far the lit copy of the emblem is offset from the dark one, in viewBox units.
 *
 * 1.2 of 100 is about one device pixel at the 96-120px a seal is stamped at, which is the whole
 * intent: an emboss you can measure is a bevel, and a bevel is a 2003 web page. Down AND right,
 * because the lit wall of a groove is the one facing away from a light that is above and to the
 * left — the same source the cast shadow in the stylesheet falls away from.
 */
const EMBOSS_OFFSET = 1.2;

/** Weight of the engraved line work, in viewBox units — a little under 2px at the sizes a seal is stamped. */
const EMBLEM_STROKE_WIDTH = 2.6;

/** Baseline of the stamped legend, low enough to clear the emblem and high enough to stay inside the smallest lobe. */
const LABEL_BASELINE = 72;

/**
 * How wide a long legend is compressed to fit, in viewBox units.
 *
 * 42 is what fits inside the narrowest wax at that baseline: at 26 units below centre the rim of a
 * fully bitten-in lobe is about 27 units from the axis on each side, so 21 either way leaves the
 * legend a margin it cannot lose on any seed.
 */
const LABEL_FIT_WIDTH = 42;

/**
 * Legends longer than this are squeezed to {@link LABEL_FIT_WIDTH}; shorter ones are left alone.
 *
 * The conditional matters. `textLength` applied unconditionally stretches a four-character id
 * across the whole seal like a title, which is a worse failure than a long id set slightly tight.
 */
const LABEL_FIT_CHARS = 10;

/** With a legend under it, the emblem gives up 14% of its size and rises 6 units, so the two are not fighting for the middle of the wax. */
const LABEL_EMBLEM_SCALE = 0.86;

/** Where the emblem's centre moves to when a legend is present. */
const LABEL_EMBLEM_CENTRE_Y = 44;

/** Scale about the centre of the box, then lift — written out so the two numbers above stay readable as the decision they are. */
const LABELLED_EMBLEM_TRANSFORM = `translate(${CENTRE} ${LABEL_EMBLEM_CENTRE_Y}) scale(${LABEL_EMBLEM_SCALE}) translate(${-CENTRE} ${-CENTRE})`;

/**
 * Stable, per-seal ids for the two definitions that CANNOT live in the shared sprite: the clip path
 * is the seed's own outline, and the sheen is painted through it.
 *
 * Derived from the props rather than from `useId` on purpose. `useId` would give two renders of the
 * same seal two different ids, which makes the markup untestable and changes on every navigation;
 * this way the id is a function of the shape, so two seals that collide are two seals with
 * identical definitions and the collision is invisible. The cost is that a page stamping the same
 * emblem with the same seed twice emits a duplicate id — benign, and avoidable by giving each seal
 * the seed it should have had anyway.
 */
function instanceKey(emblem: WaxEmblem, seed: number): string {
  const normalised = Number.isFinite(seed) ? Math.trunc(seed) : 0;
  return `${emblem}-${(normalised >>> 0).toString(36)}`;
}

/**
 * One emblem's marks, ready to be rendered twice.
 *
 * Both halves of the emboss are the same geometry in `currentColor`, so the dark face and the lit
 * lip are set by the `color` of the group above them and cannot drift apart into two hand-tuned
 * colours.
 */
function emblemMarks(emblem: WaxEmblem): ReactElement {
  const { strokes, fills } = waxEmblemGeometry(emblem);
  return (
    <>
      {strokes.map((d) => (
        <path
          key={d}
          d={d}
          fill="none"
          stroke="currentColor"
          strokeWidth={EMBLEM_STROKE_WIDTH}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ))}
      {fills.map((d) => (
        <path key={d} d={d} fill="currentColor" stroke="none" />
      ))}
    </>
  );
}

/* ------------------------------ the component ----------------------------- */

/** Everything a seal needs, and nothing about where it sits — placement belongs to whoever stamps it. */
export interface WaxSealProps {
  /** Rendered width and height in CSS pixels. The geometry is in a 100x100 viewBox, so this scales everything at once. */
  readonly size: number;
  /** Which mark is pressed into the wax. */
  readonly emblem: WaxEmblem;
  /** Drives the outline. The same seed is the same seal forever, on the server and in the browser; two seals side by side must be given different seeds. */
  readonly seed: number;
  /** Play the 200 ms press on mount. Off by default, because a seal that is already on the page was not just stamped. */
  readonly pressed?: boolean;
  /** [R6] The measured tier. FLOOR renders the seal complete and perfectly still; it never renders less material. */
  readonly capability?: CapabilityTier;
  /** The session id stamped into the wax. Also becomes the seal's accessible name; without it the seal is decoration and is hidden from assistive technology. */
  readonly label?: string;
}

/**
 * A blob of red wax with an emblem pressed into it — the mark that closes a reading.
 *
 * WHY THIS IS AN SVG AND NOT A DIV WITH A BORDER-RADIUS.
 *
 * Because a circle is not a seal. Wax poured onto a leaf and struck with a die spreads unevenly,
 * takes the shape of the pressure that made it, and is different every time — so the outline here
 * is 8-12 lobes at 8% radial jitter joined by a closed spline ({@link waxSealPath}), and no
 * `border-radius` appears anywhere in this component or its stylesheet. The three things layered
 * over it are the three things a photograph of wax actually shows: a crown lit by the one warm
 * source (the shared `#snc-g-wax` focus, with a wet sheen clipped to the rim over it), a warm
 * shadow thrown down and to the right, and an emblem that is DARKER than its surround with a
 * hairline of lit wax on its lower-right wall — pressed in, never printed on.
 *
 * WHAT FLOOR TURNS OFF.
 *
 * The press, and only the press. Every layer of material renders identically at every tier and
 * under `prefers-reduced-motion`; the seal simply arrives already stamped.
 */
export function WaxSeal({
  size,
  emblem,
  seed,
  pressed = false,
  capability,
  label,
}: WaxSealProps): ReactElement {
  const outline = waxSealPath(seed);
  const key = instanceKey(emblem, seed);
  const clipId = `snc-wax-${key}-clip`;
  const sheenId = `snc-wax-${key}-sheen`;

  /* The press is the only thing a tier can take away, and FLOOR takes it. The stylesheet removes it
   * a second time under prefers-reduced-motion, which is the guarantee that holds before this
   * component's props are even known — see the note at the head of this file. */
  const animates = pressed && capability !== "FLOOR";
  const className = [styles.seal, animates ? styles.pressed : ""].filter((token) => token.length > 0).join(" ");

  const emblemTransform = label === undefined ? undefined : LABELLED_EMBLEM_TRANSFORM;
  const fitLegend = label !== undefined && label.length > LABEL_FIT_CHARS;

  /* Both halves of the emboss carry identical content; only the colour and the 1.2-unit offset
   * differ, which is the entire trick. */
  const legend =
    label === undefined ? null : (
      <text
        className={styles.label}
        x={CENTRE}
        y={LABEL_BASELINE}
        textAnchor="middle"
        fill="currentColor"
        textLength={fitLegend ? LABEL_FIT_WIDTH : undefined}
        lengthAdjust={fitLegend ? "spacingAndGlyphs" : undefined}
      >
        {label}
      </text>
    );

  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox={`0 0 ${WAX_SEAL_VIEWBOX} ${WAX_SEAL_VIEWBOX}`}
      role={label === undefined ? undefined : "img"}
      aria-hidden={label === undefined ? true : undefined}
      focusable="false"
    >
      {label === undefined ? null : <title>{label}</title>}

      <defs>
        {/* The seed's own outline, so the sheen is bitten off by the same rim the wax has. */}
        <clipPath id={clipId}>
          <path d={outline} />
        </clipPath>

        {/* The specular, as a paint rather than a blur: a soft-edged highlight with no filter behind
         * it, which is what keeps a seal off the frame budget on the devices §10 worries about. It
         * cannot live in the shared sprite because it is consumed only here and only through the
         * per-seed clip beside it — and unlike a filter it evaluates no noise, so a page of seals is
         * a page of gradients, not a page of feTurbulence. */}
        <radialGradient id={sheenId} cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" style={{ stopColor: "var(--snc-wax-sheen)", stopOpacity: "0.62" }} />
          <stop offset="0.55" style={{ stopColor: "var(--snc-wax-sheen)", stopOpacity: "0.2" }} />
          <stop offset="1" style={{ stopColor: "var(--snc-wax-sheen)", stopOpacity: "0" }} />
        </radialGradient>
      </defs>

      {/* The wax. Its fill is the shared `#snc-g-wax` and nothing else, so every seal in the product
       * is poured from one pot: this component declares no wax colour of its own. */}
      <path className={styles.body} d={outline} fill={defUrl(SNC_GRADIENT_WAX)} />

      {/* The crown, upper-left, where the one warm source is. Rotated so its long axis follows the
       * curve of the surface rather than lying flat across it. */}
      <g clipPath={`url(#${clipId})`}>
        <ellipse
          className={styles.sheen}
          cx={38}
          cy={34}
          rx={23}
          ry={15}
          transform="rotate(-32 38 34)"
          fill={`url(#${sheenId})`}
        />
      </g>

      {/* THE EMBOSS. The lit lip first and offset, the dark face over it at the true position: what
       * remains visible of the lower copy is a hairline down the far wall of the groove. */}
      <g className={styles.pressLip} transform={`translate(${EMBOSS_OFFSET} ${EMBOSS_OFFSET})`}>
        <g transform={emblemTransform}>{emblemMarks(emblem)}</g>
        {legend}
      </g>
      <g className={styles.pressInk}>
        <g transform={emblemTransform}>{emblemMarks(emblem)}</g>
        {legend}
      </g>
    </svg>
  );
}
