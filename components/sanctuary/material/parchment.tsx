/**
 * <Parchment> — THE TORN LEAF.
 *
 * WHAT THIS COMPONENT IS FOR, STATED AS THE FAILURE IT REPLACES.
 *
 * The first pass at this design language shipped colour VALUES: a panel filled
 * with the parchment token, given a uniform padding and a border radius. That
 * is a SaaS card wearing a tan hex, and no amount of gold on top of it rescues
 * the impression. In the references the leaf is a PHYSICAL MATERIAL, and it is
 * physical because five separate things are true of it at once:
 *
 *   (a) its BOUNDARY IS BITTEN, never rounded — irregular by a few pixels, and
 *       different on every edge and every instance;
 *   (b) its field carries a BROAD LUMINANCE MOTTLE — brighter upper-left where
 *       the one candle is, falling off right and bottom, roughly +/-6% across
 *       the panel, from a handful of very large soft radials;
 *   (c) it has FIBROUS GRAIN, visible only on close inspection, multiplied in
 *       at a few percent;
 *   (d) it has a BURNT RIM — the outer band oxidised toward parch-edge, and the
 *       CORNERS are the darkest point on the whole leaf;
 *   (e) it carries two or three faint STAINS.
 *
 * Any four of those without the fifth still reads as a fill with an effect on
 * it. All five together stop reading as CSS. That is the entire brief, and it
 * is why every layer below is mandatory rather than a quality setting.
 *
 * WHY THERE IS NO "use client" HERE.
 *
 * Everything irregular about a leaf is decided by `seed` and computed by the
 * pure generators in ./rng, so a leaf has no state, no effect and no handler:
 * this is a SERVER COMPONENT and it costs zero client JavaScript. That is not
 * an optimisation, it is the reason the material can be this heavy — a page can
 * afford a dozen fully-realised leaves precisely because none of them ships any
 * code. It is also why Math.random is unusable here (see ./rng): the server
 * HTML and the hydrated client must agree on the outline to the last decimal,
 * or React discards the subtree and the leaf visibly re-tears itself on load.
 *
 * WHY THE MATERIAL IS A SIBLING OF THE CONTENT AND NOT ITS BACKGROUND.
 *
 * The tear is an feDisplacementMap, which moves the pixels of everything in the
 * filtered subtree. Applied to the panel as a whole it would wobble the TEXT,
 * which is unreadable and unforgivable. Applied to a child of the clipped
 * sheet it would be cut back to a straight line by that clip. So the leaf is
 * three siblings: a filtered material stack that holds all five layers and
 * nothing else, an optional ornament layer, and the content — which sits
 * outside the filter and stays pin sharp.
 *
 * WHAT FLOOR AND prefers-reduced-motion CHANGE HERE: NOTHING.
 *
 * There is no transition, no animation and no capability branch in this file or
 * in its stylesheet, by design. What the FLOOR tier turns off is MOTION; the
 * material is never what degrades, because a reader who asked for stillness
 * asked for stillness and not for a worse-looking manuscript.
 */
import { createElement, type CSSProperties, type HTMLAttributes, type ReactElement, type ReactNode } from "react";
import {
  SNC_FILTER_GRAIN,
  SNC_FILTER_TORN,
  SNC_FILTER_TORN_ROUGH,
  SNC_TORN_BLEED_PX,
  SNC_TORN_ROUGH_BLEED_PX,
  defUrl,
} from "./ids";
import { seededJitter, seededRandom } from "./rng";
import styles from "./parchment.module.css";

/* ------------------------------- public types ----------------------------- */

/**
 * Which leaf this is. Three tones and not a numeric scale, because each one is
 * a place in the reference rather than a step in a ramp: `light` is the raised
 * inset the Source Wisdom quotation sits on, `aged` is the leaf the reading is
 * written on, and `dark` is a leaf lying further from the candle — the back of
 * a bundle, or a sheet behind the one in focus.
 */
export type ParchmentTone = "light" | "aged" | "dark";

/**
 * How badly this leaf is damaged, mapped onto the two tearing filters the
 * shared sprite already defines. `rough` is not "more of the same": it uses the
 * sprite's second noise field at double amplitude, so a rough leaf beside a
 * subtle one is another piece of the same material rather than the same bite
 * magnified.
 */
export type ParchmentTear = "subtle" | "rough";

/**
 * The elements a leaf is allowed to be. Deliberately a closed set: a leaf is a
 * region of a document, so `section` and `article` are the honest answers when
 * it has a heading of its own and `div` is the honest answer when it does not.
 * Anything else — a button, a list item — would be a semantic decision hidden
 * inside a decoration.
 */
export type ParchmentElement = "section" | "article" | "div";

/**
 * Every tone, brightest first. Exported so a bundle can walk them without
 * re-typing the union, and so a test can prove each one actually paints
 * differently rather than only carrying a different attribute.
 */
export const PARCHMENT_TONES: readonly ParchmentTone[] = ["light", "aged", "dark"];

/** Both tears, weakest first, for the same reason as {@link PARCHMENT_TONES}. */
export const PARCHMENT_TEARS: readonly ParchmentTear[] = ["subtle", "rough"];

/**
 * A style object that may also carry this component's own custom properties.
 *
 * CSSProperties has no room for `--snc-parch-base`, and the usual escape is a
 * cast through `any`, which switches off checking for every OTHER property in
 * the same object. A pattern index signature keeps `position` and `filter`
 * checked while letting exactly this component's variables through, so a typo
 * in a variable name is still caught the moment it stops matching the prefix.
 */
type ParchmentStyle = CSSProperties & Record<`--snc-parch-${string}`, string>;

/* ------------------------------- the pigments ----------------------------- */

/**
 * The eight colours one leaf is painted from. Every one of them is a color-mix
 * over --color-snc-* tokens, so this file contains no colour of its own: the
 * palette stays reviewable in one place, and a leaf cannot drift away from the
 * ground it sits on.
 */
interface ToneMaterial {
  /** The field the whole leaf starts from — already off the pure token, because a leaf is never one colour. */
  readonly base: string;
  /** The crest of the mottle: the brightest patch, where the candle falls. */
  readonly lift: string;
  /** The second, broader lift that keeps the middle of the panel from flattening. */
  readonly liftSoft: string;
  /** The falloff, right and bottom, away from the light. */
  readonly shade: string;
  /** The oxidised band along all four edges. */
  readonly burn: string;
  /** The corners — the darkest point on the leaf, and the thing that makes it look handled. */
  readonly ember: string;
  /** Two or three faint marks of age. */
  readonly stain: string;
  /** The fold, for a spread. */
  readonly crease: string;
}

/**
 * WHY THE BASE IS NEVER THE PARCHMENT TOKEN AT FULL STRENGTH.
 *
 * The mottle has to be able to go BOTH ways — up toward the candle and down
 * away from it — and the lightest colour in the leaf palette is the parchment
 * token itself. So the field starts a little below it and the crest paints the
 * pure token back on, which buys the +/-6% swing observation 1(b) asks for
 * without inventing a colour and without a white anywhere near this file. On
 * `light`, where the sheet genuinely is the brightest thing on screen, the
 * crest instead reaches for the pale end of the gold ramp, which is the one
 * warm near-white the token layer owns.
 *
 * `dark` mixes toward ink rather than toward the ground, and that is the whole
 * difference between a leaf lying in shadow and a leaf someone turned the
 * opacity down on: shadow on a warm sheet stays warm.
 */
const TONE_MATERIAL: Readonly<Record<ParchmentTone, ToneMaterial>> = {
  light: {
    base: "color-mix(in oklab, var(--color-snc-parchment) 94%, var(--color-snc-parch-edge))",
    lift: "color-mix(in oklab, var(--color-snc-gold-ramp-pale) 48%, transparent)",
    liftSoft: "color-mix(in oklab, var(--color-snc-parchment) 60%, transparent)",
    shade: "color-mix(in oklab, var(--color-snc-parch-edge) 34%, transparent)",
    burn: "color-mix(in oklab, var(--color-snc-parch-edge) 58%, transparent)",
    ember: "color-mix(in oklab, var(--color-snc-parch-edge) 74%, var(--color-snc-ink))",
    stain: "color-mix(in oklab, var(--color-snc-ink) 48%, var(--color-snc-ink-red))",
    crease: "color-mix(in oklab, var(--color-snc-ink) 18%, transparent)",
  },
  aged: {
    base: "color-mix(in oklab, var(--color-snc-parchment) 76%, var(--color-snc-parch-edge))",
    lift: "color-mix(in oklab, var(--color-snc-parchment) 92%, transparent)",
    liftSoft: "color-mix(in oklab, var(--color-snc-parchment) 56%, transparent)",
    shade: "color-mix(in oklab, var(--color-snc-parch-edge) 46%, transparent)",
    burn: "color-mix(in oklab, var(--color-snc-parch-edge) 82%, transparent)",
    ember: "color-mix(in oklab, var(--color-snc-parch-edge) 44%, var(--color-snc-ink))",
    stain: "color-mix(in oklab, var(--color-snc-ink) 55%, var(--color-snc-ink-red))",
    crease: "color-mix(in oklab, var(--color-snc-ink) 26%, transparent)",
  },
  /* The alphas here are a fraction of the other two tones', and that is
   * arithmetic rather than taste. A mottle is a PERCENTAGE swing about the
   * field it sits on, so the same alpha buys wildly different amounts of it
   * depending on how far the pigment is from the base: painting parchment at
   * 44% over a near-parchment field is a whisper, and painting it at 44% over a
   * field mixed halfway into ink is a 30% swing — a blotch, not a leaf. These
   * were set by measuring the composite, not by copying the row above. */
  dark: {
    base: "color-mix(in oklab, var(--color-snc-parchment) 54%, var(--color-snc-ink))",
    lift: "color-mix(in oklab, var(--color-snc-parchment) 13%, transparent)",
    liftSoft: "color-mix(in oklab, var(--color-snc-flame-warm) 11%, transparent)",
    shade: "color-mix(in oklab, var(--color-snc-ink) 12%, transparent)",
    burn: "color-mix(in oklab, var(--color-snc-ink) 52%, transparent)",
    ember: "color-mix(in oklab, var(--color-snc-parch-edge) 26%, var(--color-snc-ink))",
    stain: "color-mix(in oklab, var(--color-snc-ink) 68%, var(--color-snc-ink-red))",
    crease: "color-mix(in oklab, var(--color-snc-ink) 34%, transparent)",
  },
};

/* ------------------------------- the geometry ----------------------------- */

/** Six sampled points along each edge. Fewer and the bites read as a wave; more is markup nobody reads for a difference nobody sees. */
const PARCHMENT_EDGE_SAMPLES = 6;

/**
 * How many boundary points one leaf's outline has: four corners plus six
 * samples per edge.
 *
 * Exported because it is the length of the jitter stream a leaf consumes, and a
 * test that wants to prove two seeds produce genuinely different OUTLINES —
 * rather than two strings that happen to differ somewhere — needs to know how
 * many numbers went into one.
 */
export const PARCHMENT_EDGE_POINT_COUNT = 4 + PARCHMENT_EDGE_SAMPLES * 4;

/** A corner is bitten harder than an edge, because a leaf is handled by its corners and they go first. */
const CORNER_BITE_FACTOR = 1.7;

/** How far a sampled point slides ALONG its edge, in percent. Without this the bites sit on a regular grid and the eye finds the repeat at once. */
const EDGE_DRIFT_PCT = 3.4;

/** Two decimals: short enough not to bloat the outline, exact enough that server and client agree on every digit. */
const round2 = (value: number): number => Math.round(value * 100) / 100;

/**
 * The leaf's outline as a clip-path polygon string — the macro bite of
 * observation 1(a), before the shared tearing filter roughens it further.
 *
 * WHY THE PER-INSTANCE VARIATION LIVES IN THIS PATH AND NOT IN THE FILTER.
 *
 * The obvious reading of "the tear must differ per instance" is a per-instance
 * feTurbulence seed, which means a per-instance filter element. The material
 * sprite exists specifically to make that impossible: turbulence is evaluated
 * per filter ELEMENT, so twelve leaves with twelve inline copies is twelve
 * noise fields per frame instead of one, which is the whole frame budget on the
 * devices the spec calls LOW and FLOOR. So the two mechanisms are split by what
 * each is good at — the SHARED filter supplies fibre-scale roughness that is
 * the same material everywhere, and this SEEDED PATH supplies the bites, which
 * are the part a reader could actually notice repeating. One shared noise
 * field, and no two leaves with the same outline.
 *
 * WHY PIXELS AND PERCENTAGES ARE MIXED.
 *
 * Perpendicular offsets are in px so a bite is the same size on a 900px-wide
 * spread as on a 320px inset — a percentage bite would be three times deeper on
 * the long edge and the panel would look stretched rather than torn. Positions
 * ALONG each edge are percentages so the outline scales with the box. Every
 * offset stays within [0, 2 x bite] of the sheet's own edge, which is exactly
 * the bleed the stylesheet reserves for it.
 */
export function parchmentEdgePolygon(seed: number, tear: ParchmentTear): string {
  const bite = tear === "rough" ? SNC_TORN_ROUGH_BLEED_PX : SNC_TORN_BLEED_PX;
  const cornerBite = bite * CORNER_BITE_FACTOR;
  /* Two offsets per point: one perpendicular to the edge, one along it. Drawing
   * them as two halves of one stream never reuses a draw, which is how two
   * neighbouring bites stay uncorrelated. */
  const jitter = seededJitter(seed, PARCHMENT_EDGE_POINT_COUNT * 2, 1);
  let cursor = 0;

  /** The first offset of the current point, mapped from [-1, 1] onto [0, 2 x amplitude]. */
  const primary = (amplitude: number): number => round2(amplitude * (1 + (jitter[cursor] ?? 0)));
  /** The second offset of the current point — used as the other axis on a corner, which needs two. */
  const secondary = (amplitude: number): number =>
    round2(amplitude * (1 + (jitter[cursor + PARCHMENT_EDGE_POINT_COUNT] ?? 0)));
  /** The along-edge drift, signed rather than one-sided: a point slides either way off its nominal station. */
  const drift = (at: number): number =>
    round2(at + (jitter[cursor + PARCHMENT_EDGE_POINT_COUNT] ?? 0) * EDGE_DRIFT_PCT);

  const near = (offset: number): string => `${offset}px`;
  const far = (offset: number): string => `calc(100% - ${offset}px)`;
  const along = (at: number): string => `${at}%`;
  /** Where the nth sample sits along an edge before it drifts. */
  const station = (index: number): number => round2((index * 100) / (PARCHMENT_EDGE_SAMPLES + 1));

  const points: string[] = [];
  const add = (x: string, y: string): void => {
    points.push(`${x} ${y}`);
    cursor += 1;
  };

  /* Clockwise from the top-left. The order matters: a polygon that doubles back
   * on itself clips to nothing, and a leaf that clips to nothing is a missing
   * panel rather than a wrong one. */
  add(near(primary(cornerBite)), near(secondary(cornerBite)));
  for (let i = 1; i <= PARCHMENT_EDGE_SAMPLES; i += 1) add(along(drift(station(i))), near(primary(bite)));
  add(far(primary(cornerBite)), near(secondary(cornerBite)));
  for (let i = 1; i <= PARCHMENT_EDGE_SAMPLES; i += 1) add(far(primary(bite)), along(drift(station(i))));
  add(far(primary(cornerBite)), far(secondary(cornerBite)));
  for (let i = PARCHMENT_EDGE_SAMPLES; i >= 1; i -= 1) add(along(drift(station(i))), far(primary(bite)));
  add(near(primary(cornerBite)), far(secondary(cornerBite)));
  for (let i = PARCHMENT_EDGE_SAMPLES; i >= 1; i -= 1) add(near(primary(bite)), along(drift(station(i))));

  return `polygon(${points.join(", ")})`;
}

/* ------------------------------ the placements ---------------------------- */

/**
 * A large odd constant folded into the seed before the mottle and stains are
 * placed.
 *
 * Without it the placement stream and the outline stream start from the same
 * number, so one leaf's stains would be derived from the same draws as its own
 * bites — and, worse, the neighbouring seed's outline would echo this leaf's
 * stain positions. A salt this size decorrelates the two and gives up no
 * determinism.
 */
const PLACEMENT_SEED_SALT = 0x5f356495;

/** Where a soft radial sits and how big it is, all in percentages of the leaf. */
interface Patch {
  readonly x: number;
  readonly y: number;
  readonly rx: number;
  readonly ry: number;
}

/**
 * The three anchors of the broad mottle, in the order the reference reads: the
 * crest upper-left where the candle is, a second lift through the middle so the
 * centre never flattens, and the falloff into the lower-right.
 */
const MOTTLE_ANCHORS: readonly Patch[] = [
  { x: 24, y: 20, rx: 84, ry: 68 },
  { x: 57, y: 47, rx: 70, ry: 78 },
  { x: 93, y: 95, rx: 88, ry: 76 },
];

/** Three candidate marks of age; a leaf shows two or three of them, chosen by its own seed. */
const STAIN_ANCHORS: readonly Patch[] = [
  { x: 31, y: 67, rx: 19, ry: 14 },
  { x: 77, y: 25, rx: 13, ry: 17 },
  { x: 61, y: 86, rx: 16, ry: 11 },
];

/** How far a patch wanders from its anchor, in percent: enough that two leaves are visibly different sheets, not so far that the light source moves. */
const PATCH_DRIFT_PCT = 8;

/** A patch nudged off its anchor by the leaf's own stream, so no two leaves are mottled or stained alike. */
const driftPatch = (anchor: Patch, next: () => number): Patch => ({
  x: round2(anchor.x + (next() * 2 - 1) * PATCH_DRIFT_PCT),
  y: round2(anchor.y + (next() * 2 - 1) * PATCH_DRIFT_PCT),
  rx: anchor.rx,
  ry: anchor.ry,
});

/** One soft radial, written the way every layer here writes them: sized, placed, and gone well before its own edge. */
const radial = (patch: Patch, paint: string, stop: number): string =>
  `radial-gradient(${patch.rx}% ${patch.ry}% at ${patch.x}% ${patch.y}%, ${paint}, transparent ${stop}%)`;

/* -------------------------------- the burn -------------------------------- */

/**
 * How far the corner bloom reaches. A min() rather than a percentage or a
 * length alone: on a full-width spread the corners must not eat half the sheet,
 * and on a small inset a fixed 7rem would swallow it whole.
 *
 * Roughly four times the edge band, which is the ratio the reference shows —
 * the corners of a handled leaf are not a slightly darker version of its edges,
 * they are a different order of damage.
 */
const BURN_CORNER_REACH = "min(34%, 7rem)";

/**
 * The oxidised band along each edge: observation 1(d)'s "outer 8-14px",
 * measured at the size the reference was drawn at.
 *
 * A LENGTH and not a percentage, and this is the one number here most worth
 * getting right. A 13% band looks correct on the phone the reference was drawn
 * on and puts a 117px scorch down the side of a 900px spread — at which point
 * the leaf is not aged, it is charred, and the panel has lost a sixth of its
 * width to an effect. The clamp lets the band grow a little with the sheet and
 * stops well before that: 10px on a small inset, ~12px at the reference's own
 * width, and never past 26px however wide the leaf gets.
 */
const BURN_BAND = "clamp(10px, 3.5%, 26px)";

/** Fibre at 7%: inside the 5-8% the reference measures, and low enough that it is felt rather than seen. */
const GRAIN_OPACITY = 0.07;

/** Stains land near 3% once each radial's own falloff is accounted for. */
const STAIN_LAYER_OPACITY = 0.055;

/* -------------------------------- the leaf -------------------------------- */

/** The root element's props, extended with the two data hooks a leaf publishes about itself. */
interface ParchmentRootProps extends HTMLAttributes<HTMLElement> {
  "data-snc-tone": ParchmentTone;
  "data-snc-tear": ParchmentTear;
}

/** What a leaf needs to know. */
export interface ParchmentProps {
  /** Which leaf this is; see {@link ParchmentTone}. Defaults to `aged`, the leaf a reading is written on. */
  tone?: ParchmentTone;
  /** How badly it is damaged; see {@link ParchmentTear}. Defaults to `subtle`. */
  tear?: ParchmentTear;
  /**
   * The one number that makes this leaf itself.
   *
   * Required, and required on purpose: an optional seed would default to a
   * constant, every leaf on a page would share one outline and one mottle, and
   * a bundle would read as printed wallpaper — the exact failure the whole
   * seeded-randomness apparatus exists to prevent. Pass something the caller
   * already has: a chapter index, a position in a bundle, a reading id hashed
   * down.
   */
  seed: number;
  /**
   * Ornamental corner pieces.
   *
   * Two shapes, because two callers want two different things and neither
   * should have to import the other's component. `true` renders the hairline
   * marks defined in this leaf's own stylesheet — four fading gold arms, enough
   * to finish a plain panel. Any node instead renders THAT into the corner
   * layer, which is the slot the ornaments agent's <AncientCorner /> fills;
   * this file deliberately does not import it, so neither component can break
   * the other's build.
   */
  corners?: ReactNode;
  /** A single vertical crease down the middle, for a leaf that has been folded — a spread, not a card. */
  fold?: boolean;
  /** Which element to render; see {@link ParchmentElement}. Defaults to `div`, the option that claims nothing. */
  as?: ParchmentElement;
  /** Classes for the leaf's outer box. The stylesheet sits in @layer components, so a utility passed here still wins. */
  className?: string;
  /** The reading, the quotation, the provenance rows — whatever is written on this leaf. Rendered outside the tearing filter, so it stays sharp. */
  children?: ReactNode;
}

/** The four corners the built-in hairline marks occupy, in the order the stylesheet mirrors them. */
const BUILT_IN_CORNERS = ["tl", "tr", "bl", "br"] as const;

/**
 * A sheet of parchment: five layers of material, an irregular boundary, and
 * whatever is written on it.
 *
 * Do not wrap a leaf in `overflow: hidden`. The tear leaves the element's box by
 * design — that is what makes it a tear — and an ancestor that clips will cut
 * the outline back into the straight rectangle this component exists to avoid.
 */
export function Parchment({
  tone = "aged",
  tear = "subtle",
  seed,
  corners,
  fold = false,
  as = "div",
  className,
  children,
}: ParchmentProps): ReactElement {
  const material = TONE_MATERIAL[tone];
  const bleed = tear === "rough" ? SNC_TORN_ROUGH_BLEED_PX : SNC_TORN_BLEED_PX;
  const next = seededRandom(seed + PLACEMENT_SEED_SALT);
  const [crest, centre, falloff] = MOTTLE_ANCHORS.map((anchor) => driftPatch(anchor, next));
  /* Two stains or three, from the leaf's own stream: a fixed count is exactly
   * the kind of regularity the eye picks up across a bundle even when every
   * position differs. */
  const stains = STAIN_ANCHORS.slice(0, next() < 0.5 ? 2 : 3).map((anchor) => driftPatch(anchor, next));

  const rootStyle: ParchmentStyle = {
    "--snc-parch-bleed": `${bleed}px`,
    "--snc-parch-base": material.base,
    "--snc-parch-lift": material.lift,
    "--snc-parch-lift-soft": material.liftSoft,
    "--snc-parch-shade": material.shade,
    "--snc-parch-burn": material.burn,
    "--snc-parch-ember": material.ember,
    "--snc-parch-stain": material.stain,
    "--snc-parch-crease": material.crease,
  };

  const rootProps: ParchmentRootProps = {
    className: className ? `${styles.leaf} ${className}` : styles.leaf,
    style: rootStyle,
    "data-snc-tone": tone,
    "data-snc-tear": tear,
  };

  const cornerLayer =
    corners === undefined || corners === null || corners === false ? null : (
      <span className={styles.corners} aria-hidden="true">
        {corners === true
          ? BUILT_IN_CORNERS.map((corner) => (
              <span key={corner} className={styles.corner} data-snc-corner={corner}>
                <span className={styles.cornerArmInline} />
                <span className={styles.cornerArmBlock} />
              </span>
            ))
          : corners}
      </span>
    );

  /* createElement rather than a capitalised const in JSX: `as` is a union of
   * three intrinsic tag names, and JSX resolves the props of a union tag by
   * intersecting them, which has historically produced errors that depend on
   * the TypeScript version rather than on anything in this file. */
  return createElement(
    as,
    rootProps,
    <>
      {/* ------------------------------------------------------------------
       * THE MATERIAL. Everything inside this span is displaced by the shared
       * tearing filter; nothing outside it is. It is inset by one bleed on
       * every side so the sheet is slightly LARGER than the leaf's own box and
       * the bitten outline can oscillate across the nominal edge rather than
       * only inside it.
       * ------------------------------------------------------------------ */}
      <span
        className={styles.material}
        aria-hidden="true"
        style={{ filter: defUrl(tear === "rough" ? SNC_FILTER_TORN_ROUGH : SNC_FILTER_TORN) }}
      >
        <span
          className={styles.sheet}
          data-snc-layer="sheet"
          style={{
            /* 1(a) THE TORN EDGE. This polygon is the leaf's entire visible
             * outline. There is no border-radius under it: a radius would be a
             * rounded rect showing through wherever a bite happened to be
             * shallow, which is the tidy corner this whole component exists to
             * get rid of. */
            clipPath: parchmentEdgePolygon(seed, tear),
            backgroundColor: "var(--snc-parch-base)",
          }}
        >
          {/* 1(b) THE BROAD LUMINANCE MOTTLE. Three very large radials, with
           * the falloff painted OVER the two lifts, because the right and
           * bottom of the reference leaf lose the light no matter what is
           * under them. This is the layer that decides whether the panel still
           * reads flat when you squint at a screenshot of it. */}
          <span
            className={styles.layer}
            data-snc-layer="mottle"
            style={{
              backgroundImage: [
                radial(falloff, "var(--snc-parch-shade)", 76),
                radial(crest, "var(--snc-parch-lift)", 72),
                radial(centre, "var(--snc-parch-lift-soft)", 80),
              ].join(", "),
            }}
          />

          {/* 1(e) THE STAINS. Two or three, multiplied in at a few percent so
           * they darken the fibre rather than sitting on top of it. */}
          <span
            className={styles.layer}
            data-snc-layer="stain"
            style={{
              backgroundImage: stains.map((stain) => radial(stain, "var(--snc-parch-stain)", 70)).join(", "),
              opacity: STAIN_LAYER_OPACITY,
              mixBlendMode: "multiply",
            }}
          />

          {/* THE FOLD, when this leaf is a spread: one crease, with a faint
           * lift on its left where the ridge catches the one warm source. */}
          {fold ? (
            <span
              className={styles.layer}
              data-snc-layer="fold"
              style={{
                backgroundImage: [
                  "linear-gradient(90deg, transparent calc(50% - 3px),",
                  "var(--snc-parch-lift) calc(50% - 1.5px),",
                  "var(--snc-parch-crease) calc(50% - 0.5px),",
                  "var(--snc-parch-crease) calc(50% + 0.5px),",
                  "transparent calc(50% + 3px))",
                ].join(" "),
              }}
            />
          ) : null}

          {/* 1(d) THE BURNT RIM, CORNER-WEIGHTED. Four corner blooms laid OVER
           * four narrow edge bands, composited into one layer and multiplied
           * into the sheet once. The weighting is the entire point: an edge
           * gets a band of a dozen pixels, while a corner gets an opaque ember
           * fading over four times that, so the extreme corner is the darkest
           * point on the whole leaf. A uniform inset shadow — the obvious way
           * to write this — gives an even frame, which is the one thing a
           * handled manuscript never has. */}
          <span
            className={styles.layer}
            data-snc-layer="burn"
            style={{
              backgroundImage: [
                `radial-gradient(${BURN_CORNER_REACH} ${BURN_CORNER_REACH} at 0% 0%, var(--snc-parch-ember), transparent 100%)`,
                `radial-gradient(${BURN_CORNER_REACH} ${BURN_CORNER_REACH} at 100% 0%, var(--snc-parch-ember), transparent 100%)`,
                `radial-gradient(${BURN_CORNER_REACH} ${BURN_CORNER_REACH} at 100% 100%, var(--snc-parch-ember), transparent 100%)`,
                `radial-gradient(${BURN_CORNER_REACH} ${BURN_CORNER_REACH} at 0% 100%, var(--snc-parch-ember), transparent 100%)`,
                `linear-gradient(to bottom, var(--snc-parch-burn), transparent ${BURN_BAND})`,
                `linear-gradient(to top, var(--snc-parch-burn), transparent ${BURN_BAND})`,
                `linear-gradient(to right, var(--snc-parch-burn), transparent ${BURN_BAND})`,
                `linear-gradient(to left, var(--snc-parch-burn), transparent ${BURN_BAND})`,
              ].join(", "),
              mixBlendMode: "multiply",
            }}
          />

          {/* 1(c) THE FIBROUS GRAIN, last so it lies over everything the sheet
           * is made of, and multiplied so it shades the fibre instead of
           * hazing the leaf. The background colour is not decoration: the
           * grain filter GENERATES its noise and never reads its input, so
           * this layer's own paint is discarded outright the moment the filter
           * resolves. It exists to guarantee the box paints at all, and so
           * that an engine which declines to render an empty filtered element
           * degrades to a harmless even wash rather than to nothing. */}
          <span
            className={styles.layer}
            data-snc-layer="grain"
            style={{
              filter: defUrl(SNC_FILTER_GRAIN),
              backgroundColor: "var(--snc-parch-base)",
              opacity: GRAIN_OPACITY,
              mixBlendMode: "multiply",
              /* THE TEAR, RESTATED ON THIS LAYER, and it is not redundant.
               *
               * Every other layer is clipped by the polygon on .sheet above.
               * This one is not: a filter that GENERATES its output rather than
               * reading its input paints its whole filter region, and it does so
               * inside its own stacking context — so the noise escaped the bitten
               * edge and laid a rectangle of DESATURATED grey over the warm ground
               * around the leaf. Measured on a real capture: the ground reads
               * rgb(15,13,10) and the leak read rgb(32,31,30), neutral where
               * everything in this system is warm, which is exactly the grey-box
               * failure the art direction forbids.
               *
               * It was invisible until the grain was given the contrast it needed
               * to be seen at all, which is the honest way round: the leak was
               * always there and the fix that made the fibre legible is what
               * revealed it. Clipping here bounds the generator to the same
               * outline as the sheet it is meant to be shading. */
              clipPath: parchmentEdgePolygon(seed, tear),
            }}
          />
        </span>
      </span>

      {cornerLayer}

      {/* Outside the filter, and therefore sharp. */}
      <div className={styles.content}>{children}</div>
    </>,
  );
}
