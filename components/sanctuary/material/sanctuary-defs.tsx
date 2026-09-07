import type { CSSProperties, ReactElement } from "react";
import {
  SNC_EMBOSS_DY,
  SNC_EMBOSS_FLOOD_OPACITY,
  SNC_EMBOSS_STD_DEVIATION,
  SNC_FILTER_EMBOSS,
  SNC_FILTER_GRAIN,
  SNC_FILTER_TORN,
  SNC_FILTER_TORN_ROUGH,
  SNC_GOLD_RAMP_ANGLE_DEG,
  SNC_GRADIENT_GOLD,
  SNC_GRADIENT_RULE,
  SNC_GRADIENT_WAX,
  SNC_GRAIN_BASE_FREQUENCY,
  SNC_GRAIN_OCTAVES,
  SNC_TORN_BASE_FREQUENCY,
  SNC_TORN_DISPLACEMENT_SCALE,
  SNC_TORN_OCTAVES,
  SNC_TORN_ROUGH_DISPLACEMENT_SCALE,
  SNC_TORN_ROUGH_TURBULENCE_SEED,
  SNC_TORN_TURBULENCE_SEED,
} from "./ids";

/**
 * NOTE THE ABSENCE OF `"use client"`. This is a server component and it must
 * stay one: it is a few hundred bytes of static markup with no state, no effect
 * and no handler, so it costs exactly zero client JavaScript. Every filter here
 * is also inert under `prefers-reduced-motion` and at the FLOOR tier — none of
 * it moves, and the material is never what degrades.
 */

/** Out of flow, zero-sized and unreachable — see the component's note on why not `display: none`. */
const SPRITE_STYLE: CSSProperties = {
  position: "absolute",
  width: 0,
  height: 0,
  overflow: "hidden",
  pointerEvents: "none",
};

/** The emboss shadow's colour, in the warm near-black of the ground rather than any grey. */
const EMBOSS_STYLE: CSSProperties = {
  floodColor: "var(--color-snc-stone-900)",
  floodOpacity: SNC_EMBOSS_FLOOD_OPACITY,
};

/**
 * The 105° ramp direction as an objectBoundingBox vector.
 *
 * A CSS angle is measured clockwise from "up", so 105° points right and slightly
 * down: direction `(sin θ, −cos θ)` in the y-down coordinate system SVG uses.
 * The vector is then anchored at the centre of the box, which is what keeps the
 * bright stop in the middle of the element rather than at one corner.
 *
 * One honest limitation, stated rather than hidden: objectBoundingBox units are
 * the box's own units, so on a very wide element this axis is sheared relative
 * to a true 105° screen angle — the CSS `--snc-gold-metal` token is not. On the
 * things this gradient paints (glyphs, rules, small ornaments, all near square
 * or short) the difference is under a degree, and the alternative — userSpace
 * units — would require every consumer to know its own size.
 */
const GOLD_RAMP_RADIANS = (SNC_GOLD_RAMP_ANGLE_DEG * Math.PI) / 180;

/** Four decimals: enough to place the axis exactly, short enough not to bloat the markup, and identical on server and client. */
const unit = (value: number): number => Math.round(value * 10000) / 10000;

const GOLD_X1 = unit(0.5 - Math.sin(GOLD_RAMP_RADIANS) / 2);
const GOLD_Y1 = unit(0.5 + Math.cos(GOLD_RAMP_RADIANS) / 2);
const GOLD_X2 = unit(0.5 + Math.sin(GOLD_RAMP_RADIANS) / 2);
const GOLD_Y2 = unit(0.5 - Math.cos(GOLD_RAMP_RADIANS) / 2);

/**
 * The single mounted definition of every shared filter and gradient in the
 * sanctuary's material language. Mount once per sanctuary route, at the top of
 * the tree; primitives reference it by `url(#…)` via `defUrl` from ./ids.
 *
 * WHY ONE SPRITE.
 *
 * SVG filter and paint references are resolved by document id, so there is
 * nothing stopping each primitive from inlining its own `<filter>`. What that
 * would cost is invisible in review and obvious on a phone: `feTurbulence` is
 * evaluated per filter element, so twelve leaves with twelve inline copies of
 * the tear is twelve noise fields per frame instead of one shared result. §10's
 * LOW and FLOOR devices have no headroom for that, and the author's laptop will
 * never show it.
 *
 * WHY IT IS HIDDEN THIS PARTICULAR WAY.
 *
 * Zero width and height, absolutely positioned, `overflow: hidden`,
 * `aria-hidden` and not focusable — but deliberately NOT `display: none` and NOT
 * `visibility: hidden`. Both of those are the obvious way to hide a defs sprite
 * and both have historically stopped filters inside them from resolving in at
 * least one shipping engine. Taking it out of flow with zero size achieves the
 * same "no layout impact" with no chance of the definitions being skipped.
 *
 * WHY EVERY COLOUR IS A `var()` IN A `style`, NOT A PRESENTATION ATTRIBUTE.
 *
 * `stop-color` and `flood-color` are CSS properties, and custom properties in
 * SVG *presentation attributes* are the corner of the platform with the least
 * consistent support. Setting them through `style` is the path every engine
 * treats as ordinary CSS, and it keeps this file free of colour literals — every
 * value below resolves to a token from app/sanctuary.css.
 */
export function SanctuaryDefs(): ReactElement {
  return (
    <svg aria-hidden="true" focusable="false" width={0} height={0} style={SPRITE_STYLE}>
      <defs>
        {/* ------------------------------------------------------------------
         * THE TORN EDGE — observation 1(e). A leaf is bitten, never rounded.
         *
         * The filter region is widened past the default 120% because the whole
         * point of the effect is pixels leaving the box: at the default region a
         * displaced edge is clipped back to a straight line, which looks exactly
         * like the filter failing to apply.
         * ------------------------------------------------------------------ */}
        <filter
          id={SNC_FILTER_TORN}
          x="-12%"
          y="-12%"
          width="124%"
          height="124%"
          filterUnits="objectBoundingBox"
          colorInterpolationFilters="sRGB"
        >
          <feTurbulence
            type="turbulence"
            baseFrequency={SNC_TORN_BASE_FREQUENCY}
            numOctaves={SNC_TORN_OCTAVES}
            seed={SNC_TORN_TURBULENCE_SEED}
            result="snc-torn-noise"
          />
          <feDisplacementMap
            in="SourceGraphic"
            in2="snc-torn-noise"
            scale={SNC_TORN_DISPLACEMENT_SCALE}
            xChannelSelector="R"
            yChannelSelector="G"
          />
        </filter>

        {/* The same tear at double amplitude and a DIFFERENT noise seed, so a
         * rough-torn edge beside a plain one is another piece of the same
         * material rather than a magnified copy of it. */}
        <filter
          id={SNC_FILTER_TORN_ROUGH}
          x="-18%"
          y="-18%"
          width="136%"
          height="136%"
          filterUnits="objectBoundingBox"
          colorInterpolationFilters="sRGB"
        >
          <feTurbulence
            type="turbulence"
            baseFrequency={SNC_TORN_BASE_FREQUENCY}
            numOctaves={SNC_TORN_OCTAVES}
            seed={SNC_TORN_ROUGH_TURBULENCE_SEED}
            result="snc-torn-rough-noise"
          />
          <feDisplacementMap
            in="SourceGraphic"
            in2="snc-torn-rough-noise"
            scale={SNC_TORN_ROUGH_DISPLACEMENT_SCALE}
            xChannelSelector="R"
            yChannelSelector="G"
          />
        </filter>

        {/* ------------------------------------------------------------------
         * THE FIBRE GRAIN — observation 1(b), the thing that stops parchment
         * being a flat fill.
         *
         * This filter GENERATES; it never reads SourceGraphic. Consumers put it
         * on an empty element sized to the panel and composite the result at
         * 5–8% with multiply. Hence the tight 0/100% region: an overflowing
         * noise field would show as a grey halo around the panel it grains.
         *
         * The two colour matrices are both necessary and do different jobs.
         * `saturate 0` collapses the four independent noise channels to
         * luminance, without which the grain tints the leaf (see ./ids). The
         * second forces alpha to 1: turbulence writes a noisy alpha channel too,
         * and grain that is transparent in patches lets the ground through
         * instead of shading the sheet — the opacity of this layer belongs to
         * the consumer, not to the noise.
         * ------------------------------------------------------------------ */}
        <filter
          id={SNC_FILTER_GRAIN}
          x="0%"
          y="0%"
          width="100%"
          height="100%"
          filterUnits="objectBoundingBox"
          colorInterpolationFilters="sRGB"
        >
          <feTurbulence
            type="fractalNoise"
            baseFrequency={SNC_GRAIN_BASE_FREQUENCY}
            numOctaves={SNC_GRAIN_OCTAVES}
            result="snc-grain-noise"
          />
          <feColorMatrix in="snc-grain-noise" type="saturate" values="0" result="snc-grain-luma" />
          {/* ART-DIRECTION PASS: the grain was invisible at every size on a real capture, and the
            * cause was contrast rather than opacity. fractalNoise lands in a narrow band around mid
            * grey; multiplied at the 5-8% the spec allows, a +/-0.25 luminance swing arrives as
            * +/-1.7% and the eye reads a flat wash. Stretching the noise about its own midpoint
            * BEFORE compositing restores the fibre while leaving the opacity inside its band — the
            * honest fix, since turning the opacity up instead would have darkened the whole leaf to
            * buy texture. Slope and intercept are a pair: 0.5 must map to 0.5 or the grain shifts
            * the parchment's value as well as its texture. */}
          <feComponentTransfer in="snc-grain-luma" result="snc-grain-stretched">
            <feFuncR type="linear" slope="1.32" intercept="-0.16" />
            <feFuncG type="linear" slope="1.32" intercept="-0.16" />
            <feFuncB type="linear" slope="1.32" intercept="-0.16" />
          </feComponentTransfer>
          {/* THE GRAIN IS A TEXTURE, NOT A SHEET — and this row is the whole difference.
            *
            * It used to force alpha to 1 while keeping the noise as its colour, which made the
            * layer an OPAQUE field of grey wherever the parchment base was not painted underneath
            * it. Two failures on real captures came from that one decision: a rectangle of neutral
            * grey around a torn leaf, and a palm plate that rendered as grey static instead of as
            * fibre on tan. Neutral grey where the whole system is warm — the exact failure the art
            * direction forbids, arriving from inside the material rather than from a stray shadow.
            *
            * So the output is now BLACK with alpha driven by the noise: dark fibres carry alpha and
            * multiply into the sheet, bright ones carry none and leave it alone. The layer can no
            * longer paint a surface of its own, only shade one that is already there — which is
            * what fibre is. A missing base now reads as nothing, not as static. */}
          <feColorMatrix
            in="snc-grain-stretched"
            type="matrix"
            values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  -1 0 0 0 1"
          />
        </filter>

        {/* ------------------------------------------------------------------
         * THE PRESSED EMBLEM — observation 5. Tiny, downward, and warm: the
         * shadow of a shape pushed INTO a surface, lit by the one warm source
         * above the scene. A grey shadow here is the failure state.
         * ------------------------------------------------------------------ */}
        <filter
          id={SNC_FILTER_EMBOSS}
          x="-25%"
          y="-25%"
          width="150%"
          height="150%"
          filterUnits="objectBoundingBox"
          colorInterpolationFilters="sRGB"
        >
          <feDropShadow dx={0} dy={SNC_EMBOSS_DY} stdDeviation={SNC_EMBOSS_STD_DEVIATION} style={EMBOSS_STYLE} />
        </filter>

        {/* ------------------------------------------------------------------
         * THE METAL — observation 3. Six stops, evenly spaced, identical to the
         * `--snc-gold-metal` CSS token, so an engraved SVG glyph and the CSS
         * heading beside it are the same alloy under the same light.
         *
         * The vector is the 105° direction expressed in objectBoundingBox units
         * and anchored at the centre of the box (see GOLD_* below).
         * ------------------------------------------------------------------ */}
        <linearGradient
          id={SNC_GRADIENT_GOLD}
          x1={GOLD_X1}
          y1={GOLD_Y1}
          x2={GOLD_X2}
          y2={GOLD_Y2}
          gradientUnits="objectBoundingBox"
        >
          <stop offset="0" style={{ stopColor: "var(--color-snc-gold-600)" }} />
          <stop offset="0.2" style={{ stopColor: "var(--color-snc-gold-ramp-bronze)" }} />
          <stop offset="0.4" style={{ stopColor: "var(--color-snc-gold-ramp-bright)" }} />
          <stop offset="0.6" style={{ stopColor: "var(--color-snc-gold-ramp-pale)" }} />
          <stop offset="0.8" style={{ stopColor: "var(--color-snc-gold-500)" }} />
          <stop offset="1" style={{ stopColor: "var(--color-snc-gold-600)" }} />
        </linearGradient>

        {/* ------------------------------------------------------------------
         * WAX — observation 5. Centre stays at the middle so the falloff reaches
         * every lobe of an irregular blob; only the FOCUS moves up and left, to
         * where the light is. The lit crown and the cooled rim are both mixed
         * from existing tokens rather than invented: wax is ink-red carrying a
         * little of the candle on top and a little of the ground at the edge.
         * ------------------------------------------------------------------ */}
        <radialGradient id={SNC_GRADIENT_WAX} cx="0.5" cy="0.5" r="0.62" fx="0.34" fy="0.28">
          <stop offset="0" style={{ stopColor: "color-mix(in oklab, var(--color-snc-ink-red) 72%, var(--color-snc-flame-warm))" }} />
          <stop offset="0.55" style={{ stopColor: "var(--color-snc-ink-red)" }} />
          <stop offset="1" style={{ stopColor: "color-mix(in oklab, var(--color-snc-ink-red) 58%, var(--color-snc-stone-900))" }} />
        </radialGradient>

        {/* ------------------------------------------------------------------
         * THE FADING RULE — observation 2, and the single highest-leverage rule
         * in the whole language. Gold at zero alpha, gold, gold at zero alpha:
         * one hue, brightest at the centre, gone at both ends. The foil gold
         * (400) rather than the linework gold, because a rule that spends most
         * of its length under half alpha needs the brighter metal to read as a
         * line at all.
         * ------------------------------------------------------------------ */}
        <linearGradient id={SNC_GRADIENT_RULE} x1="0" y1="0" x2="1" y2="0" gradientUnits="objectBoundingBox">
          <stop offset="0" style={{ stopColor: "var(--color-snc-gold-400)", stopOpacity: "0" }} />
          <stop offset="0.5" style={{ stopColor: "var(--color-snc-gold-400)", stopOpacity: "1" }} />
          <stop offset="1" style={{ stopColor: "var(--color-snc-gold-400)", stopOpacity: "0" }} />
        </linearGradient>
      </defs>
    </svg>
  );
}
