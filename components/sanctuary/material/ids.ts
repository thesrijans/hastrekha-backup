/**
 * THE MATERIAL SPRITE — every shared SVG id, frozen, plus the numbers each
 * filter was tuned to.
 *
 * WHY THE IDS ARE CONSTANTS RATHER THAN STRINGS AT THE USE SITE.
 *
 * An SVG filter reference is a document-global lookup by name: `url(#snc-f-torn)`
 * resolves against whatever is mounted, and a typo does not throw, does not warn
 * and does not fall back — the element simply renders unfiltered. A parchment
 * panel that quietly loses its torn edge looks like a design choice, not a bug,
 * which is exactly the failure mode this module exists to make impossible.
 * `SanctuaryDefId` makes the set closed, so a misspelling is a compile error and
 * a rename is one edit.
 *
 * WHY THERE IS NO REACT IN THIS FILE.
 *
 * The tuned parameters below are needed in two places at once: by
 * `<SanctuaryDefs />`, which renders them, and by the primitives that must
 * reserve room for what they do (a displacement map moves pixels OUTSIDE the
 * element box; see {@link SNC_TORN_BLEED_PX}). Several of those primitives are
 * client components. If the numbers lived beside the defs component, a `"use
 * client"` primitive importing one number would pull a React component into the
 * client graph and rely on tree-shaking to take it back out again. A constants
 * module with no imports cannot do that to anyone.
 *
 * WHY ONE SPRITE AND NOT A FILTER PER COMPONENT.
 *
 * `feTurbulence` is the single most expensive thing on any of these screens: it
 * is evaluated per filter *element*, not per reference, so ten torn panels
 * sharing one `#snc-f-torn` is one noise field, while ten inlined copies is ten.
 * On the LOW/FLOOR devices §10 describes, that difference is the whole frame
 * budget. Duplicating a filter is therefore not a style preference — it is a
 * performance regression with no visible symptom on the machine that wrote it.
 */

/* ------------------------------- filter ids ------------------------------- */

/**
 * The torn leaf edge: `feTurbulence` (turbulence, {@link SNC_TORN_BASE_FREQUENCY},
 * {@link SNC_TORN_OCTAVES}) driving an `feDisplacementMap` at
 * {@link SNC_TORN_DISPLACEMENT_SCALE}, which pushes the outline off its path by
 * a few pixels in a way that never repeats along an edge.
 *
 * This is observation 1(e) — a real leaf is bitten, not rounded — and it is the
 * reason no parchment surface in the sanctuary carries a `border-radius`.
 */
export const SNC_FILTER_TORN = "snc-f-torn";

/**
 * The same tearing at {@link SNC_TORN_ROUGH_DISPLACEMENT_SCALE}, roughly double.
 *
 * Exists because a single amplitude applied everywhere reads as a texture rather
 * than as damage: the eye finds the repeat immediately when a bundle of leaves
 * all fray by the same amount. Its turbulence seed differs from the plain filter
 * ({@link SNC_TORN_ROUGH_TURBULENCE_SEED}) so this is a genuinely different bite
 * and not a scaled copy of the same one.
 */
export const SNC_FILTER_TORN_ROUGH = "snc-f-torn-rough";

/**
 * The fibrous grain of observation 1(b): `feTurbulence` (fractalNoise,
 * {@link SNC_GRAIN_BASE_FREQUENCY}, {@link SNC_GRAIN_OCTAVES}) desaturated to
 * pure luminance.
 *
 * The desaturation is load-bearing. Raw `feTurbulence` writes four independent
 * noise channels, so an undesaturated grain is *coloured* confetti — it tints
 * the parchment green and violet at the 5–8% opacity this is used at, which is
 * precisely the range where a tint is felt without being seen. Luminance-only
 * grain darkens and lightens the leaf and changes its hue by nothing.
 */
export const SNC_FILTER_GRAIN = "snc-f-grain";

/**
 * The pressed emblem of observation 5: one tiny `feDropShadow`, offset down by
 * {@link SNC_EMBOSS_DY} and blurred by {@link SNC_EMBOSS_STD_DEVIATION}, in the
 * warm near-black of the ground rather than a grey.
 *
 * Down and warm, both deliberate: the sanctuary has one warm light source above
 * the scene (§3 light discipline), so a seal pressed INTO wax pools its shadow
 * on the lower side of the depression. A grey drop shadow under a red seal is
 * the single most "rendered"-looking thing this component set could do.
 */
export const SNC_FILTER_EMBOSS = "snc-f-emboss";

/* ------------------------------ gradient ids ------------------------------ */

/**
 * The struck-metal ramp as an SVG gradient, at
 * {@link SNC_GOLD_RAMP_ANGLE_DEG}: dark bronze → bronze → bright → pale → mid →
 * dark bronze, the same six stops in the same order as the `--snc-gold-metal`
 * CSS token so an engraved glyph and the heading above it are made of the same
 * metal.
 *
 * Observation 3: gold that does not vary along its length is yellow, not gold.
 */
export const SNC_GRADIENT_GOLD = "snc-g-gold";

/**
 * Wax: a radial red whose focus is offset up and left of centre, so the lobed
 * blob has a lit crown and a cooled far rim from one light source (observation
 * 5). Centre stays centred — only the focus moves — so the falloff still reaches
 * every lobe instead of leaving the far side flat.
 */
export const SNC_GRADIENT_WAX = "snc-g-wax";

/**
 * The fading rule of observation 2, for ornaments drawn in SVG: gold at zero
 * alpha → gold → gold at zero alpha. There is not one solid gold bar anywhere in
 * the references, and this gradient is how that stays true.
 *
 * Written as three stops of the SAME gold with the ends at `stop-opacity: 0`
 * rather than as a fade to `transparent`: it keeps the hue fixed along the whole
 * length, and it makes the invariant machine-checkable — both terminal stops
 * carry an opacity of zero, which a test can read.
 */
export const SNC_GRADIENT_RULE = "snc-g-rule";

/* -------------------------------- the set --------------------------------- */

/**
 * Every id `<SanctuaryDefs />` mounts, in render order.
 *
 * Exported as the authority for "is the sprite complete?": the foundation test
 * walks this list against the rendered markup, so an id added here without a
 * `<filter>` behind it fails immediately rather than at the first url() that
 * silently resolves to nothing.
 */
export const SANCTUARY_DEF_IDS = [
  SNC_FILTER_TORN,
  SNC_FILTER_TORN_ROUGH,
  SNC_FILTER_GRAIN,
  SNC_FILTER_EMBOSS,
  SNC_GRADIENT_GOLD,
  SNC_GRADIENT_WAX,
  SNC_GRADIENT_RULE,
] as const;

/** The closed set of shared def names, so a mistyped reference cannot compile. */
export type SanctuaryDefId = (typeof SANCTUARY_DEF_IDS)[number];

/**
 * The `url(#…)` form of a shared def, which is the only way any of these ids
 * should ever be spelled at a use site.
 *
 * A function rather than a second table of pre-built strings: the `#` and the
 * parentheses are the part people get wrong (`filter="snc-f-torn"` is valid
 * markup and renders nothing at all), and there is no way to get them wrong
 * here.
 */
export function defUrl(id: SanctuaryDefId): string {
  return `url(#${id})`;
}

/* ---------------------------- tuned parameters ---------------------------- */

/**
 * 0.02 — one noise feature per ~50 user units.
 *
 * This is the number that decides whether an edge reads as *torn* or as
 * *serrated*. An order of magnitude higher (0.2) puts a bite every 5px and the
 * result looks like pinking shears; an order lower puts one gentle bulge along a
 * whole edge and the tear disappears. 50 units against a panel a few hundred
 * wide gives the handful of irregular bites per side the reference leaf has.
 */
export const SNC_TORN_BASE_FREQUENCY = 0.02;

/**
 * 4 octaves. Each octave adds detail at half the scale of the last, so four is
 * bites, notches within bites, roughness on the notches, and fibre — one more
 * would be invisible at any size a panel is rendered at and costs a full extra
 * noise evaluation per pixel.
 */
export const SNC_TORN_OCTAVES = 4;

/**
 * 8 — the displacement amplitude, in user units, of the plain tear.
 *
 * `feDisplacementMap` shifts a pixel by `scale × (channel − 0.5)`, so a scale of
 * 8 moves the outline by at most ±4px: observation 1(e)'s "irregular bites of a
 * few px". Large enough to be unmistakably not a straight cut, small enough that
 * text set 24px inside the edge is never touched.
 */
export const SNC_TORN_DISPLACEMENT_SCALE = 8;

/** 16 — the rough tear, double the amplitude (±8px), for the outermost leaf of a bundle and for a torn-off corner. */
export const SNC_TORN_ROUGH_DISPLACEMENT_SCALE = 16;

/**
 * The worst-case outward travel of {@link SNC_FILTER_TORN}, derived rather than
 * retyped: half the scale, because the displacement is symmetric about the
 * channel midpoint.
 *
 * Consumers need this. A displaced edge leaves the element's box, and an
 * ancestor with `overflow: hidden` — or a filter region left at its default —
 * will clip the tear back into a straight line, which is the same failure as not
 * having the filter at all. Reserve this much padding.
 */
export const SNC_TORN_BLEED_PX: number = SNC_TORN_DISPLACEMENT_SCALE / 2;

/** The same worst-case travel for {@link SNC_FILTER_TORN_ROUGH}: ±8px. */
export const SNC_TORN_ROUGH_BLEED_PX: number = SNC_TORN_ROUGH_DISPLACEMENT_SCALE / 2;

/**
 * Fixed turbulence seeds, one per tearing filter.
 *
 * Two reasons, and the second is the important one. First, `feTurbulence`
 * defaults to seed 0 and browsers have historically differed in what they
 * generate there, so stating a seed makes the tear the same shape in every
 * engine. Second, the rough filter must not be a magnified copy of the plain
 * one: with a shared seed, a rough-torn leaf laid over a plain-torn leaf shows
 * the same bites in the same places at twice the size, and the bundle reads as
 * printed wallpaper. Different seeds make them different pieces of the same
 * material.
 *
 * Per-INSTANCE variation is a different mechanism entirely and does not live
 * here: it comes from the `seed` prop and `seededRandom` in ./rng, because a
 * filter is shared by every element that references it.
 */
export const SNC_TORN_TURBULENCE_SEED = 7;

/** The rough tear's own noise field. See {@link SNC_TORN_TURBULENCE_SEED} for why it differs. */
export const SNC_TORN_ROUGH_TURBULENCE_SEED = 23;

/**
 * 0.8 — grain at roughly one feature per 1.25 user units, i.e. just above the
 * pixel.
 *
 * Observation 1(b) says the grain is "visible only on close inspection". That is
 * a statement about spatial frequency, not only about opacity: coarser noise at
 * low opacity reads as dirt or as a compression artefact, while noise this fine
 * reads as fibre in the sheet. It is also why this filter must be composited at
 * 5–8% and multiplied, never screened.
 */
export const SNC_GRAIN_BASE_FREQUENCY = 0.8;

/** 3 octaves — enough for fibre to clump slightly rather than look like uniform television static, and one cheaper than the tear. */
export const SNC_GRAIN_OCTAVES = 3;

/** 1 user unit down: the emboss must read as depth at 16–20px glyph sizes, and anything larger stops being a press and becomes a cast shadow. */
export const SNC_EMBOSS_DY = 1;

/** 0.5 — half a unit of blur. Just enough to keep the pressed edge from aliasing; a soft emboss is a glow, and nothing here glows. */
export const SNC_EMBOSS_STD_DEVIATION = 0.5;

/** 0.72 — the emboss shadow is nearly opaque, because it sits on wax and parchment (both light) rather than on the ground. */
export const SNC_EMBOSS_FLOOD_OPACITY = "0.72";

/**
 * 105° — the angle of the metal ramp, shared by the CSS token and the SVG
 * gradient so both are lit by the same source.
 *
 * Not 90°: a ramp straight across reads as a horizontal wipe, and the highlight
 * lands in a band the same height as the text. Tilting it 15° past horizontal
 * drags the bright stop diagonally across a glyph the way a light source above
 * and to the left crosses a struck, slightly convex surface.
 */
export const SNC_GOLD_RAMP_ANGLE_DEG = 105;
