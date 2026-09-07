/* ============================================================================
 * MATERIAL GOLD — <GoldText>, <GoldRule> and the struck-metal contract
 *
 * WHAT IS PINNED, AND WHY EACH PIN EXISTS.
 *
 * 1. THE ALLOY IS THE TOKEN LAYER'S. Neither the component nor its stylesheet
 *    may contain a colour. The ramp is six stops at one angle, defined once in
 *    app/sanctuary.css as --snc-gold-metal and mirrored once in the SVG sprite;
 *    a second copy anywhere is a second alloy from the first day either is
 *    adjusted, and an engraved glyph beside a CSS heading would stop looking
 *    like one object. So: no hex, no rgb(), no gradient of its own, in either
 *    file.
 *
 * 2. THE FILL IS TRANSPARENT AND NOTHING ELSE. `background-clip: text` shows
 *    the ramp only where the glyph is NOT painted. One stray `color: #C9A24B`
 *    — the exact failure this whole pass exists to fix — and the metal
 *    disappears behind flat yellow with no error and no layout change. The
 *    rendered markup must therefore carry no colour at all, and the module's
 *    only `color` declaration is the deliberate high-contrast fallback.
 *
 * 3. THE SIZE FLOOR IS AN ACCESSIBILITY CONTRACT, NOT A STYLE. A
 *    gradient-filled glyph has no single contrast ratio, and the honest number
 *    is its WORST: --color-snc-gold-600 on --color-snc-stone-800 measures
 *    3.91:1, which FAILS the 4.5:1 body minimum and PASSES the 3:1 large-text
 *    minimum. That one measurement is why GoldText is display-only. So the
 *    ratios are re-derived here from the committed hexes with the WCAG formula
 *    rather than trusted to the constants, and every rung of the size ladder is
 *    parsed out of the CSS and checked against the 24px floor those ratios
 *    imply. Adjust the ramp and this test tells you the API contract moved.
 *
 * 4. THE TOOTH CANNOT TINT. 3% speckle is what stops the ramp reading as
 *    plastic, and white/black speckle would desaturate the metal toward grey.
 *    Both tooth colours must therefore be mixes of the ramp's OWN two ends with
 *    `transparent`, i.e. pure alpha, and must sit ABOVE the ramp in the layer
 *    order or they are not a surface at all.
 *
 * 5. EVERY RULE FADES AT BOTH ENDS. There is not one solid gold bar anywhere in
 *    the references. Checked here from the consumer's side, because <GoldRule>
 *    is the thing that makes it true at forty call sites.
 *
 * 6. NONE OF IT SHIPS JAVASCRIPT. No "use client", no state, no handler. §10
 *    degrades MOTION; the material never degrades, and nothing in this file
 *    moves, so a FLOOR device renders byte-identical gold to a HIGH one.
 *
 * A NOTE ON THE `.css` LOADER BELOW. `tsx` compiles TypeScript and nothing
 * else, so a component that imports a CSS Module cannot be required under it
 * without a stub — Node hands the stylesheet to the JS parser and dies on the
 * first `.`. The dozen lines under "the CSS Modules loader" are that stub, and
 * they are a real (tiny) implementation rather than an empty object on purpose:
 * they export exactly the class names the file actually declares, so a
 * component reaching for `styles.tittle` renders `undefined` into the class
 * attribute and is caught below, which is the one bug an empty-object stub
 * would hide.
 * ========================================================================== */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToString } from "react-dom/server";

let assertions = 0;
const ok = (condition: boolean, message: string): void => {
  assert.ok(condition, message);
  assertions += 1;
};

const ROOT = path.resolve(__dirname, "..");
const MATERIAL = path.join(ROOT, "components", "sanctuary", "material");
const COMPONENT_PATH = path.join(MATERIAL, "gold-text.tsx");
const MODULE_CSS_PATH = path.join(MATERIAL, "gold-text.module.css");
const SANCTUARY_CSS_PATH = path.join(ROOT, "app", "sanctuary.css");

/* -------------------------------------------------------------------------
 * Source text, with comments removed.
 *
 * Every "this file contains no colour" assertion below runs against the
 * stripped text, because the prose in both files legitimately QUOTES the hexes
 * it is explaining. A test that could not tell a documented value from a
 * declared one would either be unfailable or would forbid writing the reason
 * down, and the reasons are half of why these files exist.
 * ---------------------------------------------------------------------- */
const stripComments = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1");

const COMPONENT_SRC = readFileSync(COMPONENT_PATH, "utf8");
const COMPONENT_CODE = stripComments(COMPONENT_SRC);
const MODULE_CSS_RAW = readFileSync(MODULE_CSS_PATH, "utf8");
const MODULE_CSS = stripComments(MODULE_CSS_RAW);
const SANCTUARY_CSS = stripComments(readFileSync(SANCTUARY_CSS_PATH, "utf8"));

/** The declarations of one rule, by selector. Comments are already gone, so a selector named in prose cannot match. */
const ruleBody = (css: string, selector: string): string => {
  const at = css.indexOf(selector);
  assert.ok(at !== -1, `expected a rule for ${selector}`);
  const open = css.indexOf("{", at);
  const close = css.indexOf("}", open);
  assert.ok(open !== -1 && close !== -1, `expected ${selector} to be a complete rule`);
  return css.slice(open + 1, close);
};

/** Every local class name a stylesheet declares. Values never match: `2.5rem` and `0.18em` put a digit after the dot. */
const localClassNames = (css: string): string[] => [
  ...new Set([...css.matchAll(/\.([A-Za-z_][A-Za-z0-9_-]*)/g)].map((match) => match[1])),
];

/* -------------------------------------------------------------------------
 * The CSS Modules loader. See the header note for why this exists at all.
 * ---------------------------------------------------------------------- */
require.extensions[".css"] = (loaded, filename): void => {
  const declared: Record<string, string> = {};
  const base = path.basename(filename).replace(/\.module\.css$/, "");
  for (const name of localClassNames(stripComments(readFileSync(filename, "utf8")))) {
    declared[name] = `${base}__${name}`;
  }
  loaded.exports = declared;
};

/* eslint-disable-next-line @typescript-eslint/no-require-imports --
 * A plain `import` is hoisted above the loader registration above, so the
 * stylesheet would reach Node's JS parser before the stub existed. This is the
 * one require in the file and it is required to be one. */
const gold = require("../components/sanctuary/material/gold-text") as typeof import("../components/sanctuary/material/gold-text");

const {
  GOLD_FOIL_FLAT_CONTRAST_ON_STONE,
  GOLD_RAMP_BRIGHTEST_CONTRAST_ON_STONE,
  GOLD_RAMP_DARKEST_CONTRAST_ON_STONE,
  GOLD_TEXT_ELEMENTS,
  GOLD_TEXT_MIN_FONT_SIZE_PX,
  GOLD_TEXT_SIZES,
  GoldRule,
  GoldText,
  WCAG_MIN_CONTRAST_BODY,
  WCAG_MIN_CONTRAST_LARGE,
  goldBorderClassName,
} = gold;

/* =========================================================================
 * 1. THE ALLOY BELONGS TO THE TOKEN LAYER
 * ====================================================================== */

for (const [label, code] of [
  ["gold-text.tsx", COMPONENT_CODE],
  ["gold-text.module.css", MODULE_CSS],
] as const) {
  ok(!/#[0-9a-fA-F]{3,8}\b/.test(code), `${label} declares no hex colour — every colour comes from a --color-snc-* token`);
  ok(!/\brgba?\(/.test(code), `${label} declares no rgb()/rgba() either`);
  ok(!/\bhsla?\(/.test(code), `${label} declares no hsl()/hsla() either`);
}

ok(
  !/[^-]linear-gradient\s*\(/.test(MODULE_CSS),
  "the module declares no plain linear-gradient of its own — a second copy of the alloy is a second alloy the first time either is adjusted (the tooth's REPEATING gradients are texture, not colour)",
);
ok(
  !/gold-ramp-bronze|gold-ramp-bright\b|gold-500/.test(MODULE_CSS),
  "…and it never names an interior stop of the ramp, so the six-stop sequence cannot have been retyped here under another spelling",
);
ok(
  (MODULE_CSS.match(/var\(--snc-gold-metal\)/g) ?? []).length === 1,
  "the module reads --snc-gold-metal exactly once, and that reference is the only place the ramp enters this component",
);
ok(
  !/background-clip/.test(MODULE_CSS) && !/text-fill-color:\s*transparent/.test(MODULE_CSS),
  "the clip and the transparent fill are NOT redeclared here: they belong to .snc-gold-text, and two owners of one property is how a heading goes invisible",
);
ok(
  ruleBody(SANCTUARY_CSS, ".snc-gold-text").includes("background-image: var(--snc-gold-metal)"),
  ".snc-gold-text really is painted from the shared ramp, so this component inherits the alloy rather than approximating it",
);

/* =========================================================================
 * 2. THE FILL IS TRANSPARENT AND NOTHING ELSE
 * ====================================================================== */

const HIGH_CONTRAST_AT = MODULE_CSS.indexOf("@media (prefers-contrast: more)");
ok(HIGH_CONTRAST_AT !== -1, "the module carries a prefers-contrast escape hatch");
const MODULE_CSS_DEFAULT = MODULE_CSS.slice(0, HIGH_CONTRAST_AT);
const MODULE_CSS_HIGH_CONTRAST = MODULE_CSS.slice(HIGH_CONTRAST_AT);

ok(
  !/[;{\s]color\s*:/.test(MODULE_CSS_DEFAULT),
  "the module sets no flat `color` in its default state — the glyph fill stays the token layer's `transparent`, or there is no metal to see",
);
ok(
  /[;{\s]color:\s*var\(--color-snc-gold-400\)/.test(MODULE_CSS_HIGH_CONTRAST) &&
    /-webkit-text-fill-color:\s*var\(--color-snc-gold-400\)/.test(MODULE_CSS_HIGH_CONTRAST),
  "the ONE flat colour is the high-contrast fallback, in a palette token, and it restates -webkit-text-fill-color — setting `color` alone would give Safari users invisible headings",
);
ok(
  /background-image:\s*none/.test(MODULE_CSS_HIGH_CONTRAST),
  "…and it REMOVES the ramp rather than layering something on top of it, which is the correct shape for a refinement",
);

const goldTextRule = ruleBody(SANCTUARY_CSS, ".snc-gold-text");
ok(
  /(^|[;\s])color:\s*transparent/.test(goldTextRule) && /-webkit-text-fill-color:\s*transparent/.test(goldTextRule),
  "the token layer sets both the fill and its Safari prefix to transparent — the prefix is not optional, it is the difference between metal and nothing",
);

/* The emboss: 1px dark BELOW, a hairline light ABOVE. Reversed, the letters
 * look pressed into the page rather than struck out of it. */
const emboss = /text-shadow:([^;]+);/.exec(goldTextRule)?.[1] ?? "";
ok(/0\s+1px\s+0\s+var\(--color-snc-stone-900\)/.test(emboss), "the emboss drops a warm near-black lip 1px BELOW the glyph, agreeing with the one light source above the scene");
ok(/0\s+-1px\s+0\s+color-mix\([^)]*gold-ramp-pale/.test(emboss), "…and catches a pale hairline 1px ABOVE it, which is what makes the letterform read as raised metal");
ok(
  (MODULE_CSS.match(/text-shadow/g) ?? []).length === 1 && /text-shadow:\s*none/.test(MODULE_CSS_HIGH_CONTRAST),
  "the module touches the emboss exactly once, to remove it in high contrast — it never redefines it",
);

/* =========================================================================
 * 3. THE MEASURED CONTRAST CONTRACT, RE-DERIVED
 *
 * Formula: WCAG 2.x relative luminance and contrast ratio, verbatim.
 *   https://www.w3.org/TR/WCAG22/#dfn-relative-luminance
 *   https://www.w3.org/TR/WCAG22/#dfn-contrast-ratio
 * ====================================================================== */

const tokenHex = (name: string): string => {
  const found = new RegExp(`--color-snc-${name}:\\s*(#[0-9A-Fa-f]{6})`).exec(SANCTUARY_CSS);
  assert.ok(found, `expected --color-snc-${name} to be a six-digit hex in app/sanctuary.css`);
  return found[1];
};

/** WCAG: each 8-bit sRGB channel, linearised. */
const linearise = (channel: number): number =>
  channel <= 0.03928 ? channel / 12.92 : Math.pow((channel + 0.055) / 1.055, 2.4);

/** WCAG relative luminance: 0.2126 R + 0.7152 G + 0.0722 B over linearised channels. */
const relativeLuminance = (hex: string): number => {
  const packed = Number.parseInt(hex.slice(1), 16);
  return (
    0.2126 * linearise(((packed >> 16) & 0xff) / 255) +
    0.7152 * linearise(((packed >> 8) & 0xff) / 255) +
    0.0722 * linearise((packed & 0xff) / 255)
  );
};

/** WCAG contrast ratio: (Llighter + 0.05) / (Ldarker + 0.05), rounded the way the constants are written. */
const contrastRatio = (a: string, b: string): number => {
  const [la, lb] = [relativeLuminance(a), relativeLuminance(b)];
  const ratio = (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
  return Math.round(ratio * 100) / 100;
};

const GROUND = tokenHex("stone-800");
const darkest = contrastRatio(tokenHex("gold-600"), GROUND);
const brightest = contrastRatio(tokenHex("gold-ramp-pale"), GROUND);
const foil = contrastRatio(tokenHex("gold-400"), GROUND);

ok(darkest === GOLD_RAMP_DARKEST_CONTRAST_ON_STONE, `the darkest ramp stop measures ${darkest}:1 on stone-800, exactly as the component's constant claims`);
ok(brightest === GOLD_RAMP_BRIGHTEST_CONTRAST_ON_STONE, `the brightest stop measures ${brightest}:1, exactly as claimed`);
ok(foil === GOLD_FOIL_FLAT_CONTRAST_ON_STONE, `flat gold-400 measures ${foil}:1, exactly as claimed`);

ok(WCAG_MIN_CONTRAST_BODY === 4.5 && WCAG_MIN_CONTRAST_LARGE === 3, "the two WCAG 1.4.3 thresholds are the published ones, not house numbers");
ok(
  darkest < WCAG_MIN_CONTRAST_BODY,
  `the display-only rule is NECESSARY: at ${darkest}:1 the dark end of the ramp fails the ${WCAG_MIN_CONTRAST_BODY}:1 body minimum, so gold body text would be an accessibility defect that happens to look expensive`,
);
ok(
  darkest >= WCAG_MIN_CONTRAST_LARGE,
  `…and it is SUFFICIENT: ${darkest}:1 clears the ${WCAG_MIN_CONTRAST_LARGE}:1 large-text minimum, so the ramp is compliant at and above the size floor`,
);
ok(brightest >= WCAG_MIN_CONTRAST_BODY, "the bright end of the ramp was never the problem");
ok(
  foil >= WCAG_MIN_CONTRAST_BODY,
  "the documented alternative for small gold — flat text-snc-gold-400 — is a checked claim: it clears the body minimum at any size",
);
ok(
  GOLD_TEXT_MIN_FONT_SIZE_PX === 24,
  "the floor is WCAG's own 'large scale' threshold, 18pt = 24px, and not a round number picked for looks",
);

/* Every rung of the ladder, parsed out of the stylesheet rather than trusted. */
ok(GOLD_TEXT_SIZES.length === 4, "the ladder has four rungs");
for (const size of GOLD_TEXT_SIZES) {
  const body = ruleBody(MODULE_CSS_DEFAULT, `.${size}`);
  const floorRem = Number(/font-size:\s*clamp\(\s*([\d.]+)rem/.exec(body)?.[1] ?? "0");
  ok(floorRem > 0, `.${size} sizes itself with clamp(), so it has a floor at all rather than a viewport unit that vanishes on a narrow phone`);
  ok(
    floorRem * 16 >= GOLD_TEXT_MIN_FONT_SIZE_PX,
    `.${size} floors at ${floorRem * 16}px, at or above the ${GOLD_TEXT_MIN_FONT_SIZE_PX}px the measured ${darkest}:1 dark stop requires`,
  );
  const leading = Number(/line-height:\s*([\d.]+)/.exec(body)?.[1] ?? "0");
  ok(leading > 0 && leading <= 1.35, `.${size} sets display leading (${leading}), not the body default that opens a gap between two huge lines`);
}

/* =========================================================================
 * 4. THE TOOTH: 3%, made of the ramp, above the ramp
 * ====================================================================== */

const metalRule = ruleBody(MODULE_CSS_DEFAULT, ".metal");
const toothMixes = [...metalRule.matchAll(/color-mix\(([^;]*?)\);/g)].map((match) => match[1]);
ok(toothMixes.length === 2, "there are exactly two tooth colours: one highlight, one shadow");
for (const mix of toothMixes) {
  ok(/\b3%/.test(mix), `the tooth is mixed to 3% — at 6% the striations read as stripes and the letterform looks hatched (${mix.trim()})`);
  ok(
    /,\s*transparent\s*$/.test(mix),
    "…and it is mixed with `transparent`, so the mix is a pure alpha change and the tooth CANNOT introduce a hue the alloy does not already contain",
  );
  ok(
    /var\(--color-snc-gold-(ramp-pale|600)\)/.test(mix),
    "…out of the ramp's own two ends, never white or black, which would desaturate the metal toward grey wherever the speckle landed",
  );
}

const layers = /background-image:([\s\S]*?);/.exec(metalRule)?.[1] ?? "";
ok(layers.includes("repeating-conic-gradient") && layers.includes("repeating-linear-gradient"), "the tooth is a fine chequer plus the drag of the strike");
ok(
  layers.indexOf("var(--snc-gold-metal)") > layers.lastIndexOf("repeating-"),
  "both tooth layers are listed BEFORE the alloy, because CSS paints the first background layer on top — behind the ramp they would be invisible",
);
ok(/background-size:[\s\S]*?3px 3px/.test(metalRule), "the chequer tiles at 3px, too fine to resolve at 3% alpha: it roughens rather than patterns");

/* =========================================================================
 * 5. THE RENDERED MARKUP
 * ====================================================================== */

const html = renderToString(createElement(GoldText, null, "Life Line"));

ok(html.startsWith("<span"), "GoldText defaults to a span — a component must not silently insert an h2 into someone else's heading outline");
ok(html.includes("snc-gold-text"), "the token layer's class is applied, which is where the ramp, the clip and the emboss come from");
ok(html.includes("gold-text__metal"), "and the module's tooth class alongside it");
ok(html.includes("gold-text__title"), "with the default rung of the ladder");
ok(html.includes("Life Line"), "the words survive");
ok(!html.includes("undefined"), "no `undefined` reached the class attribute — the class-joining helper drops absent classes instead of stringifying them");
ok(!/\bstyle=/.test(html), "GoldText emits no inline style at all: every value it uses is in the stylesheet where it can be reviewed");
ok(!/color\s*:/.test(html), "and no colour of any kind, flat or otherwise — the fill stays the token layer's transparent");

for (const size of GOLD_TEXT_SIZES) {
  ok(
    renderToString(createElement(GoldText, { size }, "x")).includes(`gold-text__${size}`),
    `size="${size}" renders the rung that actually exists in the stylesheet`,
  );
}
for (const as of GOLD_TEXT_ELEMENTS) {
  ok(renderToString(createElement(GoldText, { as }, "x")).startsWith(`<${as}`), `as="${as}" renders a <${as}>`);
}

const caps = renderToString(createElement(GoldText, { caps: true }, "Source Wisdom"));
ok(caps.includes("gold-text__caps"), "the caps variant applies the tracking class");
ok(!html.includes("gold-text__caps"), "and is absent by default — tracked capitals are a choice, not the house style for every string");

const capsRule = ruleBody(MODULE_CSS_DEFAULT, ".caps");
ok(/text-transform:\s*uppercase/.test(capsRule), "the caps variant actually uppercases");
const tracking = Number(/letter-spacing:\s*([\d.]+)em/.exec(capsRule)?.[1] ?? "0");
ok(tracking >= 0.1, `the tracking is ${tracking}em — the references letterspace their capitals noticeably, and anything under about 0.1em reads as a mistake rather than a choice`);
ok(
  Number(/margin-inline-end:\s*(-[\d.]+)em/.exec(capsRule)?.[1] ?? "0") === -tracking,
  "…and exactly that much is taken back off the end: letter-spacing applies after the LAST glyph too, so a centred tracked title sits off-centre without this",
);
ok(/word-spacing:\s*[\d.]+em/.test(capsRule), "the word space grows with the tracking, or the line stops resolving into words at a glance");

const withClass = renderToString(createElement(GoldText, { className: "text-center" }, "x"));
ok(/class="[^"]*snc-gold-text[^"]*text-center"/.test(withClass), "a caller's className is appended LAST, so layout and alignment can win over the material");

ok(!/border-radius/.test(MODULE_CSS), "nothing here carries a default border-radius — this language has no rounded corners it did not draw on purpose");
ok(!/box-shadow/.test(MODULE_CSS), "and no box-shadow: the only shadow on gold is the 1px emboss, and it lives in the token layer");

/* =========================================================================
 * 6. THE RULE FADES AT BOTH ENDS
 * ====================================================================== */

const ruleGradient = /background-image:\s*([^;]+);/.exec(ruleBody(SANCTUARY_CSS, ".snc-gold-rule"))?.[1] ?? "";
ok(
  ruleGradient.startsWith("linear-gradient(90deg, transparent,") && ruleGradient.endsWith(", transparent)"),
  "the rule GoldRule draws is transparent at both ends — there is not one solid gold bar anywhere in the references",
);

const bareRule = renderToString(createElement(GoldRule));
ok(bareRule.startsWith("<hr"), "GoldRule is an <hr>, not a styled div");
ok(bareRule.includes("snc-gold-rule"), "carrying the fading-hairline class, spelled once here instead of by hand at every call site");
ok(bareRule.includes('aria-hidden="true"'), "and hidden from assistive technology by default — six ornaments must not announce six separators");
ok(!/\bstyle=/.test(bareRule), "an unsized rule emits no style attribute at all rather than `width:;margin-inline:0`");

const sized = renderToString(createElement(GoldRule, { width: "12rem" }));
ok(sized.includes("width:12rem"), "an explicit width is applied");
ok(sized.includes("margin-inline:auto"), "…and centres itself: a short rule pinned to the left margin reads as a broken border rather than an ornament");

const insetRule = renderToString(createElement(GoldRule, { inset: "2rem" }));
ok(insetRule.includes("margin-inline:2rem") && !insetRule.includes("width:"), "inset alone insets a full-width rule");
const both = renderToString(createElement(GoldRule, { width: "50%", inset: "2rem" }));
ok(both.includes("width:50%") && both.includes("margin-inline:2rem"), "an explicit inset wins over the automatic centring");

ok(!renderToString(createElement(GoldRule, { decorative: false })).includes("aria-hidden"), "a genuine thematic break keeps its separator semantics");
ok(renderToString(createElement(GoldRule, { className: "my-8" })).includes("snc-gold-rule my-8"), "spacing belongs to the caller, since .snc-gold-rule zeroes its own margin");

/* =========================================================================
 * 7. THE BORDER HELPER
 * ====================================================================== */

ok(goldBorderClassName() === "snc-gold-border", "goldBorderClassName spells the border-image class, which renders NOTHING at all when misspelled by hand");
ok(goldBorderClassName("px-6 py-5") === "snc-gold-border px-6 py-5", "and composes the caller's classes");
ok(goldBorderClassName(undefined) === "snc-gold-border", "an absent className is dropped, not stringified");
ok(
  ruleBody(SANCTUARY_CSS, ".snc-gold-border").includes("border-image-source: var(--snc-gold-metal)"),
  "the frame it names is made of the same alloy as the text, so a bordered panel and its heading are one object",
);

/* =========================================================================
 * 8. NONE OF IT SHIPS JAVASCRIPT
 * ====================================================================== */

ok(!/^\s*["']use client["']/m.test(COMPONENT_SRC), "gold-text.tsx is a server component: pure markup and classes must not ship a client bundle");
ok(
  !/\buse(State|Effect|Ref|Memo|Callback|LayoutEffect)\b/.test(COMPONENT_CODE),
  "…and holds no hook that would force it to become one",
);
ok(!/\bon[A-Z][A-Za-z]+\s*=/.test(COMPONENT_CODE), "…and no event handler either");
ok(
  !/transition|animation|@keyframes/.test(MODULE_CSS),
  "nothing in the gold moves, so there is nothing for FLOOR or prefers-reduced-motion to turn off: the material never degrades",
);

console.log(`MATERIAL GOLD ASSERTIONS PASSED (${assertions})`);
