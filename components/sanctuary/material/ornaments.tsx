import type { ReactElement } from "react";
/* [R6] The one `CapabilityTier` in the sanctuary, imported rather than redeclared. `import type`
 * erases at compile time, so a pure-SVG server component can name the tier without acquiring any
 * dependency on the client hook that measures it. */
import type { CapabilityTier } from "@/components/sanctuary/use-capability-tier";
import { SNC_FILTER_EMBOSS, SNC_GRADIENT_GOLD, SNC_GRADIENT_RULE, defUrl } from "./ids";
import { seededJitter } from "./rng";
import styles from "./ornaments.module.css";

/**
 * ============================================================================
 * THE ORNAMENT FAMILY — six engraved marks that share one stroke philosophy.
 * ============================================================================
 *
 * NOTE THE ABSENCE OF `"use client"`. All six are server components and must
 * stay so: every one of them is static markup computed from props, with no
 * state, no effect and no handler, so the whole family costs exactly zero
 * client JavaScript. <CelestialRing> turns, but it turns by CSS animation —
 * which is precisely why it can stay on the server (see its own note).
 *
 * WHY THEY LIVE IN ONE FILE. They are not six independent components; they are
 * one alphabet. `polar`, `diamondPath`, `petalPath`, `HAIRLINE` and the waver
 * are shared by four or more of them, and the moment those helpers are copied
 * into six files the six marks stop agreeing about what a hairline is. The
 * family is small enough to read in one sitting and large enough that its
 * consistency is the whole point.
 *
 * ---------------------------------------------------------------------------
 * ONE STROKE PHILOSOPHY, STATED ONCE
 * ---------------------------------------------------------------------------
 *
 * Every line in every ornament is `HAIRLINE`: 1px, painted from the shared
 * `#snc-g-gold` ramp, non-scaling, round-capped. Not "usually"; there is no
 * second stroke anywhere in this file, and test/material-ornaments.test.ts
 * fails on any element that carries a `stroke` and is not exactly that.
 *
 * WHY `vector-effect: non-scaling-stroke`. These marks are drawn in a viewBox
 * and rendered at whatever size the caller asks for — a 28px corner piece and a
 * 400px celestial ring come out of the same geometry. Without it, "1px" means
 * one *user unit*, so the ring's hairline would render at 4px and the corner's
 * at 0.4px, and the family would have no shared weight at all. With it, a
 * hairline is a hairline at every size, which is what §3's stroke ladder
 * actually means.
 *
 * WHY THE PAINT IS A GRADIENT AND NOT A COLOUR. Observation 3: gold that does
 * not vary along its length is yellow. `url(#snc-g-gold)` is the same six-stop
 * ramp the CSS `--snc-gold-metal` token composes, so an engraved lotus and the
 * heading above it are one alloy under one light.
 *
 * ---------------------------------------------------------------------------
 * THE TRAP THAT SHAPES MOST OF THE GEOMETRY BELOW
 * ---------------------------------------------------------------------------
 *
 * `#snc-g-gold` and `#snc-g-rule` are `objectBoundingBox` gradients, and SVG
 * says an element whose bounding box is empty in either dimension does not
 * render an objectBoundingBox paint AT ALL. A perfectly vertical spoke, a
 * perfectly horizontal rule, a straight stem: each has a zero-width or
 * zero-height box, and each would therefore be INVISIBLE — silently, with no
 * error, on every browser.
 *
 * Three consequences run through this file, and none of them is a workaround
 * bolted on afterwards; each is also the better drawing:
 *
 *   1. REPEATED LINEWORK IS ONE `<path>` WITH MANY SUBPATHS. The ring's twelve
 *      spokes are one element, its beads are one element, the ticks are one
 *      element. That gives each family a single 2-D box — and, far more
 *      importantly, ONE gradient across the whole ring, so the spokes on the
 *      lit side are pale and those on the far side are bronze. Twelve separate
 *      spokes would each get their own private copy of the ramp and the wheel
 *      would read as twelve identical stripes rather than one struck object.
 *
 *   2. NOTHING IS PERFECTLY STRAIGHT. Every rule, stem and spoke carries a
 *      sub-pixel seeded waver. This is the "slightly imperfect so it reads as
 *      engraved rather than generated" requirement, and it happens to be the
 *      same thing that keeps a bounding box two-dimensional.
 *
 *   3. RULES ARE TAPERED FILLS, NOT STROKES. A rule that fades must vary in
 *      weight as well as in alpha — a stroked line of constant width that only
 *      loses opacity reads as a line behind fog. The divider's rule is a filled
 *      sliver, thick where it meets the centre diamond and vanishing to nothing
 *      at each end.
 *
 * ---------------------------------------------------------------------------
 * SEEDS, AND WHY THEY ARE NOT `Math.random()`
 * ---------------------------------------------------------------------------
 *
 * Every member takes `seed`. Same seed, same markup, forever, on the server and
 * in the hydrated client — see ./rng for why that is not optional. Two corner
 * pieces on the same box get different seeds and therefore different flourishes;
 * the same corner re-rendered gets the same one.
 */

/* ========================================================================== */
/* shared geometry                                                            */
/* ========================================================================== */

/**
 * The single stroke of the whole family. Spread onto every element that carries
 * a line; there is deliberately no variant, no "bold" and no second width.
 */
const HAIRLINE = {
  fill: "none",
  stroke: defUrl(SNC_GRADIENT_GOLD),
  strokeWidth: 1,
  vectorEffect: "non-scaling-stroke",
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;

/** The struck-metal fill, for the marks that are solid rather than drawn. */
const GOLD_FILL = defUrl(SNC_GRADIENT_GOLD);

/**
 * Three decimals in path data.
 *
 * Not tidiness: `Math.sin` results are full-precision doubles, and their
 * decimal expansion is where a server string and a client string could in
 * principle disagree. Rounding to a fixed, tiny number of places makes the
 * markup byte-identical on both sides of the wire and keeps a twelve-spoke path
 * under a hundred characters instead of over a thousand.
 */
const n = (value: number): number => Math.round(value * 1000) / 1000;

/**
 * A point at `radius` from (cx, cy), `degFromUp` degrees clockwise from
 * straight up.
 *
 * Measured from UP rather than from the +x axis because every ornament here is
 * radially symmetric about the vertical — the trishul's staff, the lotus's
 * central petal, the wheel's twelve o'clock spoke — and an angle convention
 * that makes the axis of symmetry `0` is one whose numbers can be read.
 */
function polar(cx: number, cy: number, radius: number, degFromUp: number): readonly [number, number] {
  const a = (degFromUp * Math.PI) / 180;
  return [n(cx + radius * Math.sin(a)), n(cy - radius * Math.cos(a))];
}

/**
 * A diamond — the family's punctuation mark, from the wordmark's terminals to
 * the trishul's finial.
 *
 * Separate radii because the reference's diamonds are all taller than they are
 * wide; a square rotated 45° reads as a bullet, and a lozenge reads as a
 * struck ornament.
 */
function diamondPath(cx: number, cy: number, rx: number, ry: number): string {
  return `M${n(cx)},${n(cy - ry)}L${n(cx + rx)},${n(cy)}L${n(cx)},${n(cy + ry)}L${n(cx - rx)},${n(cy)}Z`;
}

/**
 * A four-pointed sparkle: the small star that punctuates the reference's Source
 * Wisdom lotus.
 *
 * Concave waist at 22% of the radius. A star whose waist is much wider reads as
 * a compass rose, and one much narrower reads as a cross — 22% is where it
 * reads as a glint.
 */
function sparklePath(cx: number, cy: number, radius: number): string {
  const w = radius * 0.22;
  return (
    `M${n(cx)},${n(cy - radius)}L${n(cx + w)},${n(cy - w)}L${n(cx + radius)},${n(cy)}` +
    `L${n(cx + w)},${n(cy + w)}L${n(cx)},${n(cy + radius)}L${n(cx - w)},${n(cy + w)}` +
    `L${n(cx - radius)},${n(cy)}L${n(cx - w)},${n(cy - w)}Z`
  );
}

/**
 * A petal, leaf or trident tine: a lens springing from (cx, cy), `length` long,
 * `halfWidth` at its fattest, pointed at both ends, optionally bowed to one
 * side by `bow`.
 *
 * Two quadratics rather than a cubic, so both ends are genuine cusps. A cubic
 * lens has a rounded point, and a rounded petal tip is the difference between
 * an engraving and a clip-art flower.
 *
 * `bow` is what makes one primitive serve a lotus petal (straight) and a
 * trishul tine (curved): it slides BOTH control points to the same side of the
 * spine, so the whole shape sweeps rather than fattening. A tine that leaves
 * the junction straight looks like a fork; one that curves out and back looks
 * like a flame, which is what the reference's trident actually is.
 */
function petalPath(
  cx: number,
  cy: number,
  degFromUp: number,
  length: number,
  halfWidth: number,
  bow = 0,
): string {
  const a = (degFromUp * Math.PI) / 180;
  const dx = Math.sin(a);
  const dy = -Math.cos(a);
  const [tx, ty] = [cx + length * dx, cy + length * dy];
  const [mx, my] = [cx + length * 0.45 * dx, cy + length * 0.45 * dy];
  /* The perpendicular of (dx, dy) is (-dy, dx); the two control points sit on
   * either side of the spine at the widest part of the petal, and `bow` moves
   * the pair of them together. */
  const [ox, oy] = [-dy * halfWidth, dx * halfWidth];
  const [bx, by] = [-dy * bow, dx * bow];
  return (
    `M${n(cx)},${n(cy)}Q${n(mx + ox + bx)},${n(my + oy + by)} ${n(tx)},${n(ty)}` +
    `Q${n(mx - ox + bx)},${n(my - oy + by)} ${n(cx)},${n(cy)}Z`
  );
}

/** Join a component's own class with a caller's, dropping the empty ones. */
const cx = (...names: ReadonlyArray<string | undefined>): string => names.filter(Boolean).join(" ");

/* ========================================================================== */
/* 1. <OrnamentalDivider />                                                   */
/* ========================================================================== */

/**
 * The divider's height in user units, which — because it renders at 1:1 — is
 * also its height in CSS pixels. Exported so a caller can reserve the space
 * without measuring the DOM.
 */
export const ORNAMENTAL_DIVIDER_HEIGHT_PX = 12;

/** Below this the two tapering rules have no room left and the mark collapses into its own cluster. */
const DIVIDER_MIN_WIDTH_PX = 96;

/** Half the gap the centre cluster occupies, i.e. where each tapering rule stops. */
const DIVIDER_CLUSTER_HALF = 13;

/** Props of {@link OrnamentalDivider}. */
export interface OrnamentalDividerProps {
  /**
   * The divider's width in CSS pixels, which is also its viewBox width — the
   * geometry is recomputed at the requested size rather than scaled to it, so
   * a 600px divider has longer rules and an identically-sized centre diamond.
   * Scaling instead would make the diamond grow with the column, which is the
   * one thing a piece of punctuation must not do.
   */
  width?: number;
  /** Drives the sub-pixel waver of the two rules. Same seed, same engraving. */
  seed?: number;
  /** Appended to the component's own classes. */
  className?: string;
}

/**
 * The rule under the body text in ui-reading-lifeline-explainability-card.png:
 * a centre diamond flanked by two pips, two rules tapering away from it, and a
 * tiny diamond terminal near each end.
 *
 * WHY THE TWO RULES ARE ONE `<path>` WITH TWO SUBPATHS. `#snc-g-rule` is an
 * objectBoundingBox gradient, so it spans whatever box the element it paints
 * happens to have. Drawn as one element the box is the FULL width of the
 * divider, and the gradient does exactly what observation 2 asks: transparent
 * at the far left, full alpha at the centre, transparent at the far right. Drawn
 * as two elements each rule would get its own private copy of the ramp and fade
 * to nothing on the inside edge as well — leaving a hole either side of the
 * diamond, which is the opposite of the intended reading.
 *
 * WHY THE TERMINALS ARE PAINTED SEPARATELY. They sit where the rule's alpha has
 * already gone to zero, so they carry the solid gold ramp at reduced opacity
 * instead. That is the reference's actual composition: two small marks with a
 * line materialising between them, not a bar with decoration on top.
 */
export function OrnamentalDivider({ width = 240, seed = 0, className }: OrnamentalDividerProps): ReactElement {
  const w = Math.max(DIVIDER_MIN_WIDTH_PX, width);
  const cxMid = w / 2;
  const cy = ORNAMENTAL_DIVIDER_HEIGHT_PX / 2;
  /* Four draws: the vertical waver of each rule's belly and of each tip. A
   * quarter of a pixel — felt, never seen, and enough to keep the bounding box
   * two-dimensional so the gradient paints at all. */
  const wave = seededJitter(seed, 4, 0.25);

  /** One tapering rule: a point at `xTip`, its full 1.1px weight at `xThick`. */
  const taper = (xTip: number, xThick: number, bellyWave: number, tipWave: number): string => {
    const half = 0.55;
    const mid = (xTip + xThick) / 2;
    return (
      `M${n(xTip)},${n(cy + tipWave)}` +
      `Q${n(mid)},${n(cy - half * 0.6 + bellyWave)} ${n(xThick)},${n(cy - half)}` +
      `L${n(xThick)},${n(cy + half)}` +
      `Q${n(mid)},${n(cy + half * 0.6 + bellyWave)} ${n(xTip)},${n(cy + tipWave)}Z`
    );
  };

  const rules =
    taper(2, cxMid - DIVIDER_CLUSTER_HALF, wave[0], wave[1]) +
    taper(w - 2, cxMid + DIVIDER_CLUSTER_HALF, wave[2], wave[3]);

  return (
    <svg
      className={cx(styles.ornament, styles.divider, className)}
      width={w}
      height={ORNAMENTAL_DIVIDER_HEIGHT_PX}
      viewBox={`0 0 ${w} ${ORNAMENTAL_DIVIDER_HEIGHT_PX}`}
      role="presentation"
      aria-hidden="true"
      focusable="false"
      data-snc-ornament="divider"
    >
      {/* The two rules, one element, one ramp across the whole width. */}
      <path data-snc-part="rule" d={rules} fill={defUrl(SNC_GRADIENT_RULE)} />
      {/* The terminals, out where the rule's alpha has already reached zero. */}
      <path
        data-snc-part="terminal"
        d={diamondPath(8, cy, 2, 2.6) + diamondPath(w - 8, cy, 2, 2.6)}
        fill={GOLD_FILL}
        opacity={0.55}
      />
      {/* The two pips that flank the centre diamond in the reference. */}
      <path
        data-snc-part="pip"
        d={diamondPath(cxMid - 8.5, cy, 1.2, 1.7) + diamondPath(cxMid + 8.5, cy, 1.2, 1.7)}
        fill={GOLD_FILL}
        opacity={0.8}
      />
      {/* The focal point. Solid, full strength: the one place on the divider the eye lands. */}
      <path data-snc-part="diamond" d={diamondPath(cxMid, cy, 3.6, 5)} fill={GOLD_FILL} />
      <path data-snc-part="diamond-facet" d={diamondPath(cxMid, cy, 1.7, 2.4)} {...HAIRLINE} />
    </svg>
  );
}

/* ========================================================================== */
/* 2. <AncientCorner />                                                       */
/* ========================================================================== */

/** Which corner of a frame the piece is drawn for. */
export type OrnamentCorner = "tl" | "tr" | "bl" | "br";

/** Every corner, in the order a frame is assembled. Exported so callers loop rather than retype. */
export const ORNAMENT_CORNERS: readonly OrnamentCorner[] = ["tl", "tr", "bl", "br"] as const;

/** Props of {@link AncientCorner}. */
export interface AncientCornerProps {
  /** Which corner this piece belongs in. Defaults to top-left, the orientation the geometry is written in. */
  corner?: OrnamentCorner;
  /** Side length in CSS pixels. */
  size?: number;
  /** Drives the waver of the bracket's two open ends. */
  seed?: number;
  /** Appended to the component's own classes. */
  className?: string;
}

/**
 * The engraved corner of the reference's Source Wisdom box: a hairline bracket
 * with a curled leaf tucked into the elbow and a small diamond at the join.
 * Never a heavy bracket — one weight, one pass, the way a stylus leaves it.
 *
 * WHY THE OTHER THREE CORNERS ARE MIRRORED IN THE COORDINATES AND NOT BY
 * `transform="scale(-1,1)"`.
 *
 * A transform is the obvious way to do this and it is wrong here for a specific
 * reason: `#snc-g-gold` is an objectBoundingBox gradient, so mirroring the
 * element mirrors the ramp with it, and a mirrored ramp is a mirrored LIGHT
 * SOURCE. The sanctuary has exactly one warm source above and to the left
 * (§3), and a frame whose right-hand corners are lit from the right is the
 * fastest way to make a page look assembled rather than photographed. Folding
 * the sign into `px`/`py` costs two helper functions and keeps all four corners
 * under the same candle.
 */
export function AncientCorner({
  corner = "tl",
  size = 28,
  seed = 0,
  className,
}: AncientCornerProps): ReactElement {
  const flipX = corner === "tr" || corner === "br";
  const flipY = corner === "bl" || corner === "br";
  /** Fold the mirror into the coordinates so the gradient — and therefore the light — never flips. */
  const px = (u: number): number => n(flipX ? size - u : u);
  const py = (v: number): number => n(flipY ? size - v : v);
  /* Half a pixel of drift on the two open ends, so four corners of one box are
   * four cuts rather than one cut printed four times. */
  const wave = seededJitter(seed, 2, 0.5);

  const bracket =
    `M${px(2)},${py(size - 3 + wave[0])}` +
    `L${px(2)},${py(9)}` +
    `Q${px(2)},${py(2)} ${px(9)},${py(2)}` +
    `L${px(size - 3 + wave[1])},${py(2)}`;

  /* The inner companion line: shorter, stopping well before the bracket's ends,
   * which is what makes the corner read as a border with a returned edge rather
   * than as two nested rectangles. */
  const inner =
    `M${px(5.5)},${py(size * 0.6)}` +
    `L${px(5.5)},${py(10.5)}` +
    `Q${px(5.5)},${py(5.5)} ${px(10.5)},${py(5.5)}` +
    `L${px(size * 0.6)},${py(5.5)}`;

  /* The flourish: a single curled leaf springing from the elbow into the field,
   * drawn as one closed cubic pair so its tip is a cusp. */
  const flourish =
    `M${px(8)},${py(8)}` +
    `C${px(15)},${py(8.5)} ${px(17)},${py(12)} ${px(13.5)},${py(16.5)}` +
    `C${px(12.5)},${py(12.5)} ${px(10.5)},${py(9.8)} ${px(8)},${py(8)}Z`;

  return (
    <svg
      className={cx(styles.ornament, className)}
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      role="presentation"
      aria-hidden="true"
      focusable="false"
      data-snc-ornament="corner"
      data-snc-corner={corner}
    >
      <path data-snc-part="bracket" d={bracket} {...HAIRLINE} />
      <path data-snc-part="inner" d={inner} {...HAIRLINE} opacity={0.6} />
      <path data-snc-part="flourish" d={flourish} {...HAIRLINE} opacity={0.8} />
      <path data-snc-part="diamond" d={diamondPath(px(3.6), py(3.6), 1.1, 1.5)} fill={GOLD_FILL} />
    </svg>
  );
}

/* ========================================================================== */
/* 3. <GoldRule />                                                            */
/* ========================================================================== */

/**
 * The plain fading rule — RE-EXPORTED, NOT REIMPLEMENTED.
 *
 * `./gold-text` already exports `GoldRule`, and it is the better one: it takes
 * `width`, `inset` and `decorative`, and it defaults to `aria-hidden` so a page
 * carrying six ornamental rules does not announce six separators. Writing a
 * second `<hr className="snc-gold-rule">` here would have been four lines and a
 * permanent fork — two components with one name, differing in exactly the
 * accessibility default nobody checks.
 *
 * So the ornament family CARRIES the mark without OWNING it. A caller can
 * import every ornament from one module, `<GoldRule>` included, and there is
 * still only one implementation to fix when it changes. The plain rule and its
 * ornamental cousin below are then genuinely a pair rather than cousins by
 * coincidence: {@link OrnamentalDivider} is the same fade with the diamond
 * cluster added, painted from the same `#snc-g-rule` stops.
 */
export { GoldRule, type GoldRuleProps } from "./gold-text";

/* ========================================================================== */
/* 4. <LotusDecoration />                                                     */
/* ========================================================================== */

/** The bloom's outer ring: seven petals, fanned, longest at the centre. */
const LOTUS_OUTER_PETALS: readonly number[] = [-78, -52, -26, 0, 26, 52, 78];

/** The inner row that gives the bloom depth rather than a flat fan. */
const LOTUS_INNER_PETALS: readonly number[] = [-34, 0, 34];

/** Props of {@link LotusDecoration}. */
export interface LotusDecorationProps {
  /** Side length in CSS pixels. The mark is square. */
  size?: number;
  /** Drives the petal-length variation and the placement of the sparkles. */
  seed?: number;
  /**
   * How strongly the engraving sits on the leaf. Default 0.55 — the reference's
   * lotus is barely there, a watermark rather than an illustration, and a lotus
   * at full strength competes with the quotation it decorates.
   */
  opacity?: number;
  /** Appended to the component's own classes. */
  className?: string;
}

/**
 * The engraved lotus from the reference's Source Wisdom box: a seven-petal
 * bloom over a three-petal inner row, a curved stem, two leaves and four
 * sparkles — all hairline, all low opacity. Original vector, not a trace.
 *
 * WHY THE STEM IS CURVED AND THE PETALS VARY IN LENGTH. Both are the same
 * decision: a straight stem has a zero-width bounding box and would not paint
 * an objectBoundingBox gradient at all (see the file header), and seven petals
 * of identical length read as a machine-drawn fan. The seeded variation is what
 * makes it a drawing, and it is also what makes it render.
 *
 * WHY EACH ROW IS ONE `<path>`. Seven petals sharing one bounding box share one
 * pass of the metal ramp, so the bloom is lit from upper-left as a single
 * object. Seven separate elements would each restart the ramp and the flower
 * would strobe.
 */
export function LotusDecoration({
  size = 96,
  seed = 0,
  opacity = 0.55,
  className,
}: LotusDecorationProps): ReactElement {
  /* Ten draws: seven outer petals, three inner. Two and a half units of length
   * variation is the difference between a drawn bloom and a printed one. */
  const petalWave = seededJitter(seed, 10, 2.5);
  /* Eight draws: an x and a y nudge for each of the four sparkles. */
  const sparkleWave = seededJitter(seed + 101, 8, 5);

  const bloomX = 48;
  const bloomY = 60;

  const outer = LOTUS_OUTER_PETALS.map((deg, i) =>
    petalPath(bloomX, bloomY, deg, 30 - Math.abs(deg) * 0.13 + petalWave[i], 7.5),
  ).join("");

  const inner = LOTUS_INNER_PETALS.map((deg, i) =>
    petalPath(bloomX, bloomY - 1, deg, 17 + petalWave[7 + i] * 0.5, 4.6),
  ).join("");

  /* Anchors for the sparkles, then nudged. Chosen rather than random so the
   * glints stay clear of the bloom instead of landing inside it. */
  const sparkleAnchors: ReadonlyArray<readonly [number, number, number]> = [
    [16, 30, 3.4],
    [80, 24, 2.6],
    [86, 52, 3],
    [12, 62, 2.2],
  ];
  const sparkles = sparkleAnchors
    .map(([sx, sy, r], i) => sparklePath(sx + sparkleWave[i * 2], sy + sparkleWave[i * 2 + 1], r))
    .join("");

  return (
    <svg
      className={cx(styles.ornament, className)}
      width={size}
      height={size}
      viewBox="0 0 96 96"
      role="presentation"
      aria-hidden="true"
      focusable="false"
      data-snc-ornament="lotus"
      opacity={opacity}
    >
      {/* The stem: two gentle bends, so it is drawn rather than ruled. */}
      <path
        data-snc-part="stem"
        d="M48,60C46.6,70 45.2,78 46.4,92"
        {...HAIRLINE}
      />
      {/* Two leaves off the stem, one element so they share the ramp. */}
      <path
        data-snc-part="leaf"
        d={petalPath(47, 74, -108, 20, 5.5) + petalPath(46.5, 82, 104, 17, 4.8)}
        {...HAIRLINE}
      />
      <path data-snc-part="petal-outer" d={outer} {...HAIRLINE} />
      <path data-snc-part="petal-inner" d={inner} {...HAIRLINE} opacity={0.85} />
      {/* The calyx: the short cup the petals spring from. */}
      <path data-snc-part="calyx" d="M40.5,60.5Q48,66.5 55.5,60.5" {...HAIRLINE} />
      <path data-snc-part="sparkle" d={sparkles} fill={GOLD_FILL} opacity={0.75} />
    </svg>
  );
}

/* ========================================================================== */
/* 5. <CelestialRing />                                                       */
/* ========================================================================== */

/** The zodiac's twelve. A default rather than a constant, because a ring of eight is a legitimate ornament. */
export const CELESTIAL_SECTORS_DEFAULT = 12;

/** Beads on the outer ring. Four per zodiac sector at the default sector count, which is what reads as a bead ring rather than as a dotted line. */
export const CELESTIAL_BEADS_DEFAULT = 48;

/**
 * 0.15 degrees per second — slow enough that the wheel is never seen to move
 * and is always in a different place when the reader looks back.
 */
export const CELESTIAL_ROTATION_DEG_PER_SECOND = 0.15;

/**
 * 2400 s — one full turn, derived rather than retyped. The stylesheet states
 * this number as a literal (`animation: sncCelestialSpin 2400s`), because CSS
 * cannot compute it; test/material-ornaments.test.ts checks the two against
 * each other so the pair cannot drift.
 */
export const CELESTIAL_ROTATION_PERIOD_SECONDS = 360 / CELESTIAL_ROTATION_DEG_PER_SECOND;

/** Props of {@link CelestialRing}. */
export interface CelestialRingProps {
  /** Diameter in CSS pixels. Geometry is a 100-unit viewBox scaled to this; the hairline stays 1px at any size. */
  size?: number;
  /** Drives the angular waver of the spokes and ticks. */
  seed?: number;
  /** How many sectors the spokes divide the wheel into. Twelve, as in the zodiac. */
  sectors?: number;
  /** How many beads the outer ring carries. */
  beads?: number;
  /**
   * [R6] The measured capability tier. At FLOOR the rotation class is not
   * emitted at all — see the component note for why that is not the same thing
   * as the reduced-motion query, and why both exist.
   */
  capabilityTier?: CapabilityTier;
  /** Appended to the component's own classes. */
  className?: string;
}

/**
 * The zodiac wheel from brand-hastrekha-logo-zodiac-wheel.png, rebuilt as
 * original vector: an outer rim, a ring of beads, twelve sectors struck off by
 * radial spokes, minor tick marks, and the hub circle at the centre. It turns
 * at 0.15 deg/s.
 *
 * WHY IT IS STILL A SERVER COMPONENT DESPITE MOVING.
 *
 * The rotation is a CSS animation on the root element, so nothing here needs
 * state, an effect or a frame loop — which means this ornament costs zero
 * client JavaScript even though it is the only member of the family that moves.
 * A `useEffect` + `requestAnimationFrame` version would have been a client
 * component, a hydration boundary, and a wake-up every frame for forty minutes
 * per turn.
 *
 * HOW IT STOPS, AND WHY THAT TAKES TWO MECHANISMS.
 *
 * At the FLOOR tier the `.spin` class is NOT APPLIED — the markup contains no
 * animation to run, so the weakest devices never allocate one. That handles
 * capability. It cannot handle preference: the tier is measured once at mount,
 * while `prefers-reduced-motion` is a live media query someone can change in
 * the OS without this tree re-rendering, so the stylesheet neutralises `.spin`
 * under that query as well. Tier decides whether the animation exists;
 * preference decides whether it runs.
 *
 * WHAT DOES NOT STOP: everything else. Rim, beads, spokes, ticks and hub render
 * identically at FLOOR and under reduced motion. Motion is the only thing that
 * degrades; the material never is.
 */
export function CelestialRing({
  size = 160,
  seed = 0,
  sectors = CELESTIAL_SECTORS_DEFAULT,
  beads = CELESTIAL_BEADS_DEFAULT,
  capabilityTier = "HIGH",
  className,
}: CelestialRingProps): ReactElement {
  const sectorCount = Math.max(1, Math.floor(sectors));
  const beadCount = Math.max(0, Math.floor(beads));
  const c = 50;

  /* Half a degree of angular drift per spoke — the wheel was struck by hand, so
   * its twelve divisions are twelve near-equal divisions. */
  const spokeWave = seededJitter(seed, sectorCount, 0.5);
  const tickWave = seededJitter(seed + 7, sectorCount * 2, 0.4);

  const spokeStep = 360 / sectorCount;

  const spokes = Array.from({ length: sectorCount }, (_, i) => {
    const deg = i * spokeStep + spokeWave[i];
    const [x1, y1] = polar(c, c, 20, deg);
    const [x2, y2] = polar(c, c, 38, deg);
    return `M${x1},${y1}L${x2},${y2}`;
  }).join("");

  /* Two minor ticks inside every sector, at its thirds — the reference's wheel
   * is graduated, not merely divided. */
  const ticks = Array.from({ length: sectorCount * 2 }, (_, i) => {
    const sector = Math.floor(i / 2);
    const third = (i % 2) + 1;
    const deg = sector * spokeStep + (spokeStep * third) / 3 + tickWave[i];
    const [x1, y1] = polar(c, c, 33.5, deg);
    const [x2, y2] = polar(c, c, 38, deg);
    return `M${x1},${y1}L${x2},${y2}`;
  }).join("");

  /* Every bead is a closed subpath of one element, so the whole bead ring is a
   * single object under a single pass of the metal ramp. */
  const beadRadius = 0.9;
  const beadRing = Array.from({ length: beadCount }, (_, i) => {
    const [bx, by] = polar(c, c, 42, (i * 360) / beadCount);
    return (
      `M${n(bx + beadRadius)},${by}` +
      `A${beadRadius},${beadRadius} 0 1,0 ${n(bx - beadRadius)},${by}` +
      `A${beadRadius},${beadRadius} 0 1,0 ${n(bx + beadRadius)},${by}Z`
    );
  }).join("");

  return (
    <svg
      className={cx(styles.ornament, capabilityTier === "FLOOR" ? undefined : styles.spin, className)}
      width={size}
      height={size}
      viewBox="0 0 100 100"
      role="presentation"
      aria-hidden="true"
      focusable="false"
      data-snc-ornament="celestial-ring"
      data-snc-sectors={sectorCount}
      data-snc-beads={beadCount}
    >
      <circle data-snc-part="rim" cx={c} cy={c} r={46} {...HAIRLINE} />
      {beadCount > 0 ? <path data-snc-part="beads" d={beadRing} fill={GOLD_FILL} /> : null}
      <circle data-snc-part="band" cx={c} cy={c} r={38} {...HAIRLINE} />
      <path data-snc-part="ticks" d={ticks} {...HAIRLINE} opacity={0.6} />
      <path data-snc-part="spokes" d={spokes} {...HAIRLINE} opacity={0.85} />
      <circle data-snc-part="hub" cx={c} cy={c} r={20} {...HAIRLINE} />
    </svg>
  );
}

/* ========================================================================== */
/* 6. <TrishulEmblem />                                                       */
/* ========================================================================== */

/**
 * The five parts of the mark, in paint order. Exported so a caller — and the
 * test — can name them without re-deriving the anatomy from the markup.
 */
export const TRISHUL_PARTS = ["arc", "trident", "staff", "diamond", "ruby"] as const;

/** One named part of {@link TrishulEmblem}. */
export type TrishulPart = (typeof TRISHUL_PARTS)[number];

/** Props of {@link TrishulEmblem}. */
export interface TrishulEmblemProps {
  /** Side length in CSS pixels. The mark is square. */
  size?: number;
  /** Drives the waver of the arc's open ends and the tines. */
  seed?: number;
  /** Appended to the component's own classes. */
  className?: string;
}

/**
 * The mark from brand-bhrigu-bodh-logo-concept.png, rebuilt as ORIGINAL clean
 * vector — five parts, named in {@link TRISHUL_PARTS}: a surrounding arc broken
 * top and bottom, a tapering staff, the trident head with its outer tines and
 * wing sweeps, the finial diamond, and the small ruby pressed into the join.
 *
 * WHY THE STAFF IS A FILLED TAPER AND NOT A THICK STROKE. Two reasons, and both
 * are the same reason. A stroked vertical line has a zero-width bounding box
 * and cannot paint an objectBoundingBox gradient, so it would render invisible;
 * and the reference's staff is not a line at all — it is a blade, wider at the
 * shoulder than at the point. Drawing what is actually there solves the
 * technical problem for free.
 *
 * WHY THE RUBY CARRIES `#snc-f-emboss`. Observation 5's pressed emblem: the
 * shared emboss filter is a tiny downward, WARM drop shadow, which is what
 * makes a red cabochon read as set INTO the metal rather than stuck on top of
 * it. The stone is `--color-snc-ink-red`, the palette's own red, and it is the
 * only non-gold paint in the entire ornament family.
 */
export function TrishulEmblem({ size = 120, seed = 0, className }: TrishulEmblemProps): ReactElement {
  /* Three-quarters of a unit at the arc's four open ends and on the tine tips:
   * a struck mark, not a generated one. */
  const wave = seededJitter(seed, 6, 0.75);

  /* The arc: a ring of radius 30 about (50, 52), broken at the top where the
   * finial rises and at the bottom where the staff exits. Two subpaths, one
   * element, so both halves are lit by one pass of the ramp. */
  const arcR = 30;
  const [aRightTop, aRightBottom] = [24 + wave[0], 156 + wave[1]];
  const [aLeftTop, aLeftBottom] = [-24 + wave[2], -156 + wave[3]];
  const [rtx, rty] = polar(50, 52, arcR, aRightTop);
  const [rbx, rby] = polar(50, 52, arcR, aRightBottom);
  const [ltx, lty] = polar(50, 52, arcR, aLeftTop);
  const [lbx, lby] = polar(50, 52, arcR, aLeftBottom);
  const arc =
    `M${rtx},${rty}A${arcR},${arcR} 0 0,1 ${rbx},${rby}` +
    `M${ltx},${lty}A${arcR},${arcR} 0 0,0 ${lbx},${lby}`;

  /* The staff: a blade, 2.8 units at the shoulder, tapering to a point at 90. */
  const staff = "M48.6,24L51.4,24L51.8,58L50,90L48.2,58Z";

  /* The trident head, all six pieces in one element so the whole head is struck
   * from one pass of the ramp: two long outer tines, two short inner ones, and
   * the pair of wings sweeping out and down to the arc.
   *
   * They are FILLED tines, not stroked curves. The first version drew them as
   * hairlines and the mark read as a dagger with a red bead — a 1px line has no
   * mass, so beside a filled staff the head simply disappeared. The reference's
   * trident is metal, and metal has a silhouette. */
  const junction: readonly [number, number] = [50, 53];
  const [jx, jy] = junction;
  const trident =
    petalPath(jx, jy, -33 + wave[4], 32, 2.2, -4.5) +
    petalPath(jx, jy, 33 + wave[5], 32, 2.2, 4.5) +
    petalPath(jx, jy, -14, 20, 1.6, -1.6) +
    petalPath(jx, jy, 14, 20, 1.6, 1.6) +
    petalPath(jx, jy - 1, -104, 27, 1.9, 5) +
    petalPath(jx, jy - 1, 104, 27, 1.9, -5);

  return (
    <svg
      className={cx(styles.ornament, className)}
      width={size}
      height={size}
      viewBox="0 0 100 100"
      role="presentation"
      aria-hidden="true"
      focusable="false"
      data-snc-ornament="trishul"
    >
      <path data-snc-part="arc" d={arc} {...HAIRLINE} opacity={0.8} />
      <path data-snc-part="trident" d={trident} fill={GOLD_FILL} />
      {/* The staff crosses in front of the head, as it does in the reference. */}
      <path data-snc-part="staff" d={staff} fill={GOLD_FILL} />
      {/* The finial: a lozenge on the staff's head with a small ball above it. */}
      <path
        data-snc-part="diamond"
        d={diamondPath(50, 15, 4.2, 7.5) + diamondPath(50, 4.5, 1.5, 1.9)}
        fill={GOLD_FILL}
      />
      {/* The stone, pressed in — a bezel of the same hairline and the warm emboss beneath. */}
      <g data-snc-part="ruby" filter={defUrl(SNC_FILTER_EMBOSS)}>
        <circle cx={jx} cy={jy} r={4} fill="var(--color-snc-ink-red)" />
        <circle cx={jx} cy={jy} r={4} {...HAIRLINE} />
      </g>
    </svg>
  );
}
