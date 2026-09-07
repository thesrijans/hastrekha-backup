import type { CSSProperties, ReactElement, ReactNode } from "react";
import styles from "./gold-text.module.css";

/**
 * NOTE THE ABSENCE OF `"use client"`, and note that it is a decision rather
 * than an omission. Everything in this file is a pure function of its props:
 * no state, no effect, no handler, no ref, nothing that reads the DOM. Rendered
 * from a server component it costs exactly ZERO client JavaScript, which is the
 * whole reason the gold system is CSS and markup rather than a canvas or a
 * measured layout effect.
 *
 * It also means there is no `CapabilityTier` prop here and nothing for one to
 * do. §10 degrades MOTION; the material never degrades, and nothing below
 * moves — no transition, no animation, no filter. A FLOOR device and a HIGH
 * device render byte-identical gold.
 */

/* ========================================================================== */
/* THE MEASURED CONTRAST CONTRACT                                             */
/* ========================================================================== */

/*
 * WHY THESE NUMBERS ARE CODE AND NOT A COMMENT.
 *
 * Gold-on-black is the classic place a luxury interface quietly becomes
 * unreadable, because the designer judges it by the BRIGHT part of the metal
 * and the reader has to read the dark part. A gradient-filled glyph has no one
 * contrast ratio — it has a range — and the honest number is the worst one.
 *
 * All three ratios below were computed from the committed tokens with the WCAG
 * 2.x definitions of *relative luminance* and *contrast ratio*
 * (https://www.w3.org/TR/WCAG22/#dfn-relative-luminance and
 * #dfn-contrast-ratio): linearise each sRGB channel with
 * `c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4`, take
 * `L = 0.2126R + 0.7152G + 0.0722B`, then `(Llighter + 0.05) / (Ldarker + 0.05)`.
 * test/material-gold.test.ts re-derives every one of them from the hex values
 * it reads out of app/sanctuary.css, so a future adjustment to the ramp cannot
 * leave these constants — or the size floor they justify — quietly stale.
 */

/** WCAG 2.2 SC 1.4.3 minimum for body-size text. The bar the dark end of the ramp does not clear. */
export const WCAG_MIN_CONTRAST_BODY = 4.5;

/** WCAG 2.2 SC 1.4.3 minimum for "large scale" text — 18pt (24px), or 14pt bold. */
export const WCAG_MIN_CONTRAST_LARGE = 3;

/**
 * 3.91:1 — `--color-snc-gold-600` (#8A6A2A), the ramp's darkest stop, on the
 * `--color-snc-stone-800` ground.
 *
 * This is the number that decides the whole API. It is BELOW
 * {@link WCAG_MIN_CONTRAST_BODY} and above {@link WCAG_MIN_CONTRAST_LARGE},
 * which is precisely why {@link GoldText} is display-only: at 16px, part of
 * every glyph would be illegible to a reader with ordinary low-light vision,
 * while at 24px and up the same metal is compliant.
 */
export const GOLD_RAMP_DARKEST_CONTRAST_ON_STONE = 3.91;

/** 13.28:1 — `--color-snc-gold-ramp-pale` (#F0D18A), the crest, on the same ground. The bright end is never the problem. */
export const GOLD_RAMP_BRIGHTEST_CONTRAST_ON_STONE = 13.28;

/**
 * 11.81:1 — flat `--color-snc-gold-400` on the same ground.
 *
 * Exported because a contract that only forbids is useless: this is the
 * measured alternative a caller is sent to when the label is too small for the
 * ramp (a provenance line, a caption, a chip). It clears the body-text minimum
 * by a wide margin at any size, so "use `text-snc-gold-400` instead" is a
 * checked claim rather than a hopeful one.
 */
export const GOLD_FOIL_FLAT_CONTRAST_ON_STONE = 11.81;

/**
 * 24px — the floor under every rung of the size ladder, and the mechanical half
 * of the display-only contract.
 *
 * It is WCAG's "large scale" threshold (18pt) and not a round number chosen for
 * looks: at or above it, {@link GOLD_RAMP_DARKEST_CONTRAST_ON_STONE} is
 * compliant; below it, it is not. The `size` prop is a closed union precisely so
 * this cannot be reached around — there is no way to hand {@link GoldText} a
 * raw font-size, and test/material-gold.test.ts parses the clamp minimum of
 * every rung in gold-text.module.css and fails if one drops under it.
 */
export const GOLD_TEXT_MIN_FONT_SIZE_PX = 24;

/* ========================================================================== */
/* GOLD TEXT                                                                  */
/* ========================================================================== */

/**
 * The rungs of the display ladder, in descending size — the authority the test
 * walks against the CSS module, so a variant named here without a rule behind
 * it fails loudly instead of rendering unstyled 16px gold.
 */
export const GOLD_TEXT_SIZES = ["hero", "display", "title", "subtitle"] as const;

/** One rung of the ladder. Closed, because every member carries a checked contrast floor. */
export type GoldTextSize = (typeof GOLD_TEXT_SIZES)[number];

/**
 * The elements {@link GoldText} may become.
 *
 * Deliberately short. `as` exists so a title can be the right HEADING for its
 * place in the document outline, not so gold can be sprayed on arbitrary
 * markup — an `as="div"` would be a heading with no semantics and an
 * `as="button"` would be an interactive control with none of its states.
 */
export const GOLD_TEXT_ELEMENTS = ["h1", "h2", "h3", "span", "p"] as const;

/** The element type of a {@link GoldText}. */
export type GoldTextElement = (typeof GOLD_TEXT_ELEMENTS)[number];

/** Props of {@link GoldText}. */
export interface GoldTextProps {
  /**
   * Which element to render. Defaults to `span`, the only choice with no
   * document-outline meaning — a component must not silently insert an `h2`
   * into someone else's heading hierarchy.
   */
  as?: GoldTextElement;
  /** Which rung of the display ladder. Defaults to `title`. Every rung floors at {@link GOLD_TEXT_MIN_FONT_SIZE_PX}. */
  size?: GoldTextSize;
  /** Letterspaced capitals, as both references set their titles. See the CSS module for why tracking alone is not enough. */
  caps?: boolean;
  /** Extra classes — layout, alignment, font-family. Appended last so a caller can win. */
  className?: string;
  /** The words. */
  children?: ReactNode;
}

/**
 * Joins the class names that are actually present.
 *
 * Not exported and not clever: the alternative is a template literal, which
 * writes `"snc-gold-text  undefined"` into the DOM the moment an optional class
 * is absent — harmless to look at, and the reason a stray `undefined` in a
 * class attribute is the fastest way to lose an hour.
 */
function classes(...names: ReadonlyArray<string | undefined | false>): string {
  return names.filter((name): name is string => typeof name === "string" && name.length > 0).join(" ");
}

/**
 * Text rendered as STRUCK METAL: the shared six-stop ramp clipped to the
 * glyphs, a 3% tooth so the surface is not plastic, and the emboss — a warm
 * near-black lip below, a pale hairline above — that makes a letterform read as
 * raised rather than coloured in.
 *
 * WHY THIS IS A COMPONENT AND NOT JUST THE `.snc-gold-text` CLASS.
 *
 * Because the class alone is the failure state one refactor away. Flat #C9A24B
 * text is what the material pass exists to fix, and the three things that stop
 * it happening again — the tooth layered over the ramp in the right order, the
 * tracking with its trailing-space compensation, and above all the SIZE FLOOR
 * that the measured 3.91:1 dark stop makes non-negotiable — are not things a
 * caller can be relied upon to remember to add. Here they are unskippable.
 *
 * THE ONE HARD RULE FOR CALLERS: THIS IS DISPLAY TYPE.
 *
 * Anything smaller than {@link GOLD_TEXT_MIN_FONT_SIZE_PX} must not use this
 * component. Not "should not" — the darkest stop of the ramp measures
 * {@link GOLD_RAMP_DARKEST_CONTRAST_ON_STONE} against the ground, under the
 * {@link WCAG_MIN_CONTRAST_BODY} body-text minimum, so a shrunken GoldText is
 * an accessibility defect that happens to look expensive. For a caption, a
 * provenance line, a chip or any running text, use flat `text-snc-gold-400`,
 * measured at {@link GOLD_FOIL_FLAT_CONTRAST_ON_STONE}. The `size` union
 * enforces this; `className` can still override a font-size, and doing so is
 * the one way to break the contract, so do not.
 *
 * TYPEFACE IS DELIBERATELY NOT SET HERE. The sanctuary display face arrives via
 * `SANCTUARY_FONT_CLASS` on a route ancestor (see lib/sanctuary/fonts.ts, and
 * app/privacy/page.tsx for the pattern). Restating a `font-family` here would
 * be a second copy of the fallback stack, drifting from the first the day
 * either changes.
 *
 * @example
 * <GoldText as="h1" size="display">Life Line</GoldText>
 * <GoldText as="p" size="subtitle" caps>Stability · Health · Vitality</GoldText>
 */
export function GoldText({
  as = "span",
  size = "title",
  caps = false,
  className,
  children,
}: GoldTextProps): ReactElement {
  const Tag = as;
  return (
    /*
     * `snc-gold-text` first, from the token layer — it owns the ramp, the clip,
     * the transparent fill and the emboss, and this file never restates any of
     * them. `styles.metal` follows and, being unlayered, legitimately overrides
     * the one property it must (background-image) to lay the tooth over the
     * alloy. The caller's className is last so layout and alignment can win.
     */
    <Tag className={classes("snc-gold-text", styles.metal, styles[size], caps && styles.caps, className)}>
      {children}
    </Tag>
  );
}

/* ========================================================================== */
/* GOLD RULE                                                                  */
/* ========================================================================== */

/** Props of {@link GoldRule}. */
export interface GoldRuleProps {
  /**
   * An explicit CSS length for the rule (`"12rem"`, `"40%"`). When given and
   * `inset` is not, the rule centres itself — a short rule pinned to the left
   * margin reads as a broken border rather than as an ornament.
   */
  width?: string;
  /** Symmetric horizontal inset from the container, as a CSS length. Sets `margin-inline`. */
  inset?: string;
  /**
   * Whether this rule is ornament (the default) or a real thematic break.
   *
   * Default `true`, and the default is the accessible one: an `<hr>` carries the
   * `separator` role, so a page that draws six ornamental rules announces six
   * separators to a screen reader — noise that says nothing about the document.
   * Pass `false` for the rare rule that genuinely divides two sections.
   */
  decorative?: boolean;
  /** Extra classes — vertical spacing belongs to the caller, since `.snc-gold-rule` clears its own margin. */
  className?: string;
}

/**
 * The fading hairline: a 1px gold rule that is brightest at its centre and gone
 * at both ends.
 *
 * WHY THIS EXISTS AS A COMPONENT AT ALL, GIVEN IT IS ONE CLASS AND AN `<hr>`.
 *
 * Because the alternative to a component is `<hr className="snc-gold-rule" />`
 * hand-written at forty call sites, and the two things that go wrong there are
 * both invisible in review: a typo in the class silently renders the browser's
 * default grey `<hr>` (which looks like a deliberate divider, not a bug), and
 * nobody hand-writes `aria-hidden` on an ornament. Sizing it by prop rather
 * than by ad-hoc utility keeps the third failure — a rule that stops fading
 * because someone reached for `border-t` instead — off the table too.
 *
 * There is not one solid gold bar anywhere in the references, and this
 * component is a large part of how that stays true.
 */
export function GoldRule({ width, inset, decorative = true, className }: GoldRuleProps): ReactElement {
  /*
   * No style attribute at all in the default case. An `<hr>` is already a block
   * that fills its container and `.snc-gold-rule` already zeroes its margin, so
   * emitting `style="width:;margin-inline:0"` would be noise in the markup and a
   * needless specificity trap for the caller's className.
   */
  const sized = width !== undefined || inset !== undefined;
  const style: CSSProperties | undefined = sized
    ? { width, marginInline: inset ?? (width === undefined ? undefined : "auto") }
    : undefined;

  return (
    <hr aria-hidden={decorative ? true : undefined} className={classes("snc-gold-rule", className)} style={style} />
  );
}

/* ========================================================================== */
/* GOLD BORDER                                                                */
/* ========================================================================== */

/**
 * The class list for a box framed in the same struck metal — `border-image`
 * from the shared ramp, at the secondary rung of the stroke ladder.
 *
 * A helper rather than a `<GoldBorder>` wrapper, and the reason is the one that
 * matters in this design language: a frame is a property of a box that already
 * exists (a leaf, a medallion field, the Source Wisdom panel of the reference
 * card), and wrapping it in an extra `<div>` to carry a border would add a box
 * to the layout purely to hold a style. A caller writes
 * `className={goldBorderClassName("p-6")}` on the element it already has.
 *
 * Why not just type the class by hand: `snc-gold-border` misspelled renders NO
 * border and no error — the same silent failure as a mistyped `url(#…)` filter
 * reference, and the reason `defUrl` exists next door in ./ids.
 *
 * @param className extra classes to append; anything falsy is dropped rather than stringified.
 * @example <section className={goldBorderClassName("px-6 py-5")}>…</section>
 */
export function goldBorderClassName(className?: string): string {
  return classes("snc-gold-border", className);
}
