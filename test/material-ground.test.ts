/* ============================================================================
 * MATERIAL GROUND — <SanctuaryGround> and <SanctuaryHeader>
 *
 * WHAT IS PINNED HERE, AND WHY EACH PIN IS WORTH ITS LINES.
 *
 * 1. THE GROUND IS SIX STRATA, NOT A FILL. The failure this pass exists to fix
 *    is a flat dark background wearing a warm hex, and it is a failure nobody
 *    reports: the page looks fine, it just looks *rendered*. Each stratum is
 *    therefore asserted by name — base, stone, grain, scratches, vignette,
 *    watermark — because "the ground still has grain" is not something a code
 *    review notices going missing.
 *
 * 2. THE VIGNETTE ACTUALLY REACHES THE CORNERS. Observation 6 asks for corners
 *    that go almost black. `farthest-corner` is the only radius that lands its
 *    last stop ON the corner at every aspect ratio, so it is asserted as a
 *    keyword rather than trusting a percentage that is right on the author's
 *    monitor and short on a phone.
 *
 * 3. THE GROUND CANNOT BE FELT. A full-viewport fixed layer is one CSS property
 *    away from becoming the containing block for the whole page's fixed
 *    children — a `transform`, a `filter`, a `contain`, a `will-change` — and
 *    when that happens a dialog somewhere else in the route silently starts
 *    scrolling with the document. The property list is asserted as an absence,
 *    because the day someone adds `will-change: transform` "for performance"
 *    the bug will surface three files away.
 *
 * 4. THE VARIATION SURVIVES HYDRATION. The scratch field is markup computed
 *    from a seed. `Math.random()` — or trigonometry, whose last bits are
 *    implementation-defined — means the server and the client disagree, React
 *    discards the subtree and the ground visibly re-scratches itself on every
 *    load. Same seed, same seven lines, byte for byte.
 *
 * 5. FLOOR RENDERS THE WHOLE MATERIAL. What the FLOOR tier withholds is motion.
 *    Nothing in the ground moves, so FLOOR and HIGH must produce identical
 *    markup — asserted by diffing the two renders, so a future "FLOOR
 *    optimisation" that drops the grain fails here instead of shipping.
 *
 * 6. THE HEADER CARRIES NO INSTRUMENT ACCENT. The product header's active pill
 *    and its filled Login are drawn from the cold accents of globals.css, and
 *    that clash against candlelight is the entire reason this variant exists.
 *    The rendered markup and the stylesheet are both searched for them, and for
 *    any colour literal at all.
 *
 * HOW REACT IS RENDERED WITHOUT A BROWSER, AND WHY THERE IS A LOADER STUB.
 *
 * `react-dom/server` already ships (test/area-ui.test.tsx is the precedent), so
 * the real components are rendered to HTML and the markup is read. What that
 * precedent did not have to solve is CSS Modules: both components import a
 * `.module.css`, and Node cannot parse CSS. The `.css` extension is therefore
 * registered to return a Proxy that answers every lookup with its own key, so
 * `styles.vignette` evaluates to the string "vignette" — the same mapping CSS
 * Modules performs, minus the hash. The class names in the assertions below are
 * consequently the authored names, and the stylesheets themselves are asserted
 * as text, which is where their claims actually live.
 * ========================================================================== */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import Module from "node:module";
import path from "node:path";
import { createElement, type ReactElement } from "react";
import { renderToString } from "react-dom/server";
import type { CapabilityTier } from "../components/sanctuary/use-capability-tier";

let assertions = 0;
const ok = (condition: boolean, message: string): void => {
  assert.ok(condition, message);
  assertions += 1;
};

/* ------------------------- the CSS Modules stand-in ----------------------- */

interface CjsModule {
  exports: unknown;
}

/**
 * Every property lookup returns the property's own name, and `default` returns
 * the same object again.
 *
 * The self-reference is not decoration: the transpiler wraps a CommonJS require
 * in an ES-module interop shim that reads `__esModule` and then hands back
 * either the namespace or its `default`. Answering both paths with the same
 * proxy makes the stub correct under either one, instead of correct on the
 * machine it was written on.
 */
const cssModuleStub: unknown = new Proxy(
  {},
  {
    get: (_target, key: string | symbol): unknown => {
      if (typeof key !== "string") return undefined;
      if (key === "__esModule") return false;
      if (key === "default") return cssModuleStub;
      return key;
    },
  },
);

const loaders = (Module as unknown as { _extensions: Record<string, (m: CjsModule, filename: string) => void> })._extensions;
loaders[".css"] = (loaded: CjsModule): void => {
  loaded.exports = cssModuleStub;
};

/**
 * The components are pulled in AFTER that registration, which is the whole
 * reason they are not plain `import` statements: imports hoist above every
 * other statement in the file, so a stylesheet would be required — and would
 * throw — before the loader above existed.
 */
const load = Module.createRequire(__filename);

interface GroundScratch {
  readonly x1: number;
  readonly y1: number;
  readonly x2: number;
  readonly y2: number;
}

interface GroundModule {
  readonly SanctuaryGround: (props: { readonly seed: number; readonly capability: CapabilityTier }) => ReactElement;
  readonly SANCTUARY_GROUND_SCRATCH_COUNT: number;
  readonly SANCTUARY_GROUND_ORNAMENT_TILT_DEG: number;
  readonly sanctuaryGroundScratches: (seed: number, count: number) => readonly GroundScratch[];
}

interface HeaderModule {
  readonly SanctuaryHeader: (props: { readonly activeHref?: "/read" | "/scan" | "/privacy" | "/terms" | null }) => ReactElement;
  readonly SANCTUARY_NAV: readonly { readonly href: string; readonly label: string }[];
  readonly SANCTUARY_WORDMARK_LATIN: string;
  readonly SANCTUARY_WORDMARK_DEVANAGARI: string;
}

const ground = load("../components/sanctuary/material/sanctuary-ground") as GroundModule;
const header = load("../components/sanctuary/sanctuary-header") as HeaderModule;

/* --------------------------------- helpers -------------------------------- */

const repo = (...parts: string[]): string => path.resolve(__dirname, "..", ...parts);
const read = (...parts: string[]): string => readFileSync(repo(...parts), "utf8");

const GROUND_TSX = read("components", "sanctuary", "material", "sanctuary-ground.tsx");
const GROUND_CSS = read("components", "sanctuary", "material", "sanctuary-ground.module.css");
const HEADER_TSX = read("components", "sanctuary", "sanctuary-header.tsx");
const HEADER_CSS = read("components", "sanctuary", "sanctuary-header.module.css");
const PRODUCT_HEADER_TSX = read("components", "header.tsx");

/** How many times a literal substring occurs — the only honest way to ask "exactly once". */
const count = (haystack: string, needle: string): number => haystack.split(needle).length - 1;

/**
 * A source file with its block comments removed.
 *
 * Every assertion about what a file does NOT contain runs against this. All
 * four files under test explain themselves at length, and several of them
 * explain precisely which property, hook or import they refuse to use —
 * searching the raw text for "transform" would find the paragraph promising
 * there is no transform, and searching for `usePathname` would find the
 * paragraph explaining why it is not called. A promise written down must not be
 * mistaken for the thing it promises about.
 *
 * The colour-literal checks in section 7 are the deliberate exception and run
 * against the RAW text: a hex in a comment is a hex somebody will copy.
 */
const stripComments = (source: string): string => source.replace(/\/\*[\s\S]*?\*\//g, "");

const GROUND_CSS_RULES = stripComments(GROUND_CSS);
const HEADER_CSS_RULES = stripComments(HEADER_CSS);
const GROUND_CODE = stripComments(GROUND_TSX);
const HEADER_CODE = stripComments(HEADER_TSX);

/** The declarations of one rule, found by its exact selector. */
const rule = (css: string, selector: string): string => {
  const at = css.indexOf(`${selector} {`);
  assert.ok(at !== -1, `expected the stylesheet to define ${selector}`);
  const end = css.indexOf("}", at);
  assert.ok(end !== -1, `expected ${selector} to be closed`);
  return css.slice(at, end + 1);
};

/** Any hex colour, anywhere. A literal in a component is a colour no palette review will ever see. */
const HEX_LITERAL = /#[0-9a-fA-F]{3,8}\b/;

/** rgb()/rgba()/hsl()/hsla() — the other way to smuggle a colour past the token layer. */
const FUNCTIONAL_COLOUR = /\b(?:rgba?|hsla?)\(/;

const groundHtml = renderToString(createElement(ground.SanctuaryGround, { seed: 41, capability: "HIGH" }));

/* ======================================================================== */
/* 1. THE GROUND IS SIX STRATA, EACH ONE A PHYSICAL CLAIM                    */
/* ======================================================================== */

ok(
  count(groundHtml, "data-snc-layer=") === 6,
  "the ground renders exactly six strata — one fewer is the flat-fill failure, one more is an effect nobody asked for",
);

ok(
  groundHtml.includes('data-snc-layer="base"') && rule(GROUND_CSS_RULES, ".base").includes("var(--color-snc-stone-900)"),
  "LAYER 1 base: an opaque fill of the deepest ground token, which is what stops the cold ambient glow of globals.css tinting this warm ground",
);

{
  const stone = rule(GROUND_CSS_RULES, ".stone");
  ok(
    groundHtml.includes('data-snc-layer="stone"') &&
      count(stone, "radial-gradient") === 3 &&
      stone.includes("var(--color-snc-stone-700)"),
    "LAYER 2 stone: three very large warm brown pools — one key above the top edge, its bounce, and the near floor",
  );
  ok(
    count(stone, "transparent") >= 3,
    "…and every pool fades to transparent rather than to a stated tone, because a pool that ends in a colour draws an edge and lit stone has none",
  );
}

ok(
  groundHtml.includes('data-snc-layer="grain"') && groundHtml.includes('filter="url(#snc-f-grain)"'),
  "LAYER 3 grain: the fibre of the surface, drawn by the ONE shared noise filter of the sprite",
);

ok(
  groundHtml.includes('data-snc-layer="scratches"') && count(groundHtml, "<line") === ground.SANCTUARY_GROUND_SCRATCH_COUNT,
  `LAYER 4 scratches: ${ground.SANCTUARY_GROUND_SCRATCH_COUNT} scored hairlines — three reads as someone drawing lines, a dozen reads as hatching`,
);

ok(
  groundHtml.includes('data-snc-layer="vignette"') && rule(GROUND_CSS_RULES, ".vignette").includes("radial-gradient"),
  "LAYER 5 vignette: the falloff of the one warm source",
);

ok(
  count(groundHtml, 'data-snc-layer="watermark"') === 1 && count(groundHtml, "<ellipse") === 6,
  "LAYER 6 watermark: ONE engraved ornament — a vine and a six-petal rosette — and never a second",
);

/* ======================================================================== */
/* 2. THE VIGNETTE ACTUALLY DARKENS THE CORNERS                              */
/* ======================================================================== */

{
  const vignette = rule(GROUND_CSS_RULES, ".vignette");
  ok(
    vignette.includes("farthest-corner"),
    "the vignette is sized to the FARTHEST CORNER, so its last stop lands on the corner at every aspect ratio instead of being right on one screen and short on another",
  );
  ok(
    /var\(--color-snc-stone-900\)\s+100%/.test(vignette),
    "…and that last stop is fully opaque stone-900 — the corners resolve to the deepest ground, which is observation 6's 'corners almost black'",
  );
  ok(
    rule(GROUND_CSS_RULES, ".base").includes("var(--color-snc-stone-900)"),
    "…the same token the base is painted in, so the vignette subtracts light rather than introducing a second, darker colour nobody named",
  );
  ok(
    vignette.startsWith(".vignette {") && /transparent\s+\d/.test(vignette),
    "the vignette fades FROM transparent, so the lit stone survives in the centre and this layer can only ever remove light",
  );
  ok(
    groundHtml.indexOf('data-snc-layer="vignette"') > groundHtml.indexOf('data-snc-layer="stone"') &&
      groundHtml.indexOf('data-snc-layer="vignette"') > groundHtml.indexOf('data-snc-layer="scratches"'),
    "the vignette paints AFTER the stone and the scratches — a falloff under the thing it is meant to dim would dim nothing",
  );
  ok(
    groundHtml.indexOf('data-snc-layer="watermark"') > groundHtml.indexOf('data-snc-layer="vignette"'),
    "…and the engraved ornament is the one stratum above it, because a cut edge still catches light in a corner the flat tone has already lost",
  );
}

/* ======================================================================== */
/* 3. THE GROUND CANNOT BE FELT — IT TRAPS NOTHING AND INTERCEPTS NOTHING    */
/* ======================================================================== */

{
  const shell = rule(GROUND_CSS_RULES, ".ground");
  ok(/position:\s*fixed/.test(shell), "the ground is fixed, so it owns the viewport and never repaints on scroll");
  ok(/inset:\s*0/.test(shell), "…covering it exactly");
  ok(/pointer-events:\s*none/.test(shell), "…and it swallows no click, which a full-viewport overlay otherwise would");
  ok(/z-index:\s*-1/.test(shell), "a negative z-index puts it under ordinary flow content with no wrapper and no isolation at the call site");

  /*
   * The absence that matters. Each of these makes the element a containing
   * block for the page's own fixed children, so a dialog mounted elsewhere in
   * the route would start scrolling with the document — a bug that surfaces
   * three files away from the line that caused it.
   */
  for (const trap of ["transform", "filter", "perspective", "contain", "will-change", "backdrop-filter"]) {
    ok(
      !new RegExp(`(^|[\\s;{])${trap}\\s*:`).test(GROUND_CSS_RULES),
      `the ground stylesheet never sets ${trap} — it would make this backdrop the containing block for every fixed element on the page`,
    );
  }
  ok(
    !/(^|[\s;{])overflow[-a-z]*\s*:/.test(GROUND_CSS_RULES),
    "…and never sets overflow, which would clip a stratum instead of letting the vignette run off the viewport edge",
  );
  ok(
    !/background/.test(shell),
    "the shell itself paints nothing at all: it is geometry, and every colour belongs to a named stratum",
  );
  ok(groundHtml.includes('aria-hidden="true"'), "the whole ground is hidden from assistive technology — it describes nothing");
}

/* ======================================================================== */
/* 4. THE VARIATION IS SEEDED, AND SURVIVES HYDRATION                        */
/* ======================================================================== */

{
  const a = ground.sanctuaryGroundScratches(41, ground.SANCTUARY_GROUND_SCRATCH_COUNT);
  const again = ground.sanctuaryGroundScratches(41, ground.SANCTUARY_GROUND_SCRATCH_COUNT);
  const other = ground.sanctuaryGroundScratches(42, ground.SANCTUARY_GROUND_SCRATCH_COUNT);
  const asText = (field: readonly GroundScratch[]): string => field.map((s) => `${s.x1},${s.y1},${s.x2},${s.y2}`).join("|");

  ok(a.length === ground.SANCTUARY_GROUND_SCRATCH_COUNT, "the scratch field is the published count");
  ok(asText(a) === asText(again), "the same seed scores the same seven lines — this is what lets the ground be server-rendered at all");
  ok(asText(a) !== asText(other), "a different seed scores a different field, or every sanctuary route is the same photocopy");
  ok(
    a.every((s) => s.x1 !== s.x2 && s.y1 !== s.y2),
    "no scratch is axis-aligned: both runs are bounded away from zero, which is what 'odd angles' means mechanically",
  );
  ok(
    a.every((s) => s.x1 >= 6 && s.x1 <= 94 && s.y1 >= 6 && s.y1 <= 94),
    "every scratch STARTS inside the field even though it is free to run off the edge — a mark that stops politely inside the frame is a drawing, not damage",
  );
  ok(
    a.every((s) => Math.abs(s.x2 - s.x1) >= 7 && Math.abs(s.x2 - s.x1) <= 31),
    "…and its travel is bounded, so a scratch can never become a line across the whole screen",
  );
  /*
   * The field is spread for EVERY seed, not for the lucky ones. Seven
   * independent draws down a screen clump often enough that roughly one seed in
   * three would put half the marks in one third of the viewport, and four short
   * lines at similar angles in one place read as deliberate hatching rather than
   * as damage. The vertical position is stratified into one band per scratch,
   * which is what this asserts — across a dozen seeds, never one.
   */
  const thirdsCovered = (seed: number): number => {
    const field = ground.sanctuaryGroundScratches(seed, ground.SANCTUARY_GROUND_SCRATCH_COUNT);
    return new Set(field.map((s) => Math.min(2, Math.floor(s.y1 / (100 / 3))))).size;
  };
  ok(
    Array.from({ length: 12 }, (_unused, i) => thirdsCovered(i * 7 + 3)).every((covered) => covered === 3),
    "every third of the viewport gets a scratch, for every seed — the vertical position is stratified precisely so an unlucky seed cannot pile four marks into one place and turn damage into hatching",
  );

  ok(ground.sanctuaryGroundScratches(41, 0).length === 0, "a zero count is an empty field, not a crash during render");
  ok(ground.sanctuaryGroundScratches(41, Number.NaN).length === 0, "a NaN count is empty rather than an infinite loop — a decoration must never take the page down");

  const twice = renderToString(createElement(ground.SanctuaryGround, { seed: 41, capability: "HIGH" }));
  ok(twice === groundHtml, "two renders of one seed are byte-identical markup, so hydration finds what the server sent");
  ok(
    renderToString(createElement(ground.SanctuaryGround, { seed: 42, capability: "HIGH" })) !== groundHtml,
    "and two seeds are genuinely different ground",
  );
  ok(
    ground.SANCTUARY_GROUND_ORNAMENT_TILT_DEG > 0 && ground.SANCTUARY_GROUND_ORNAMENT_TILT_DEG <= 10,
    "the ornament's tilt is a few degrees: enough that two routes are not photocopies, far too little to read as a rotated graphic",
  );
  ok(
    !/Math\.random|Math\.cos|Math\.sin/.test(GROUND_CODE),
    "the ground contains no Math.random and no trigonometry — one breaks hydration outright, the other's last bits are implementation-defined and break it intermittently",
  );
}

/* ======================================================================== */
/* 5. FLOOR RENDERS THE WHOLE MATERIAL                                       */
/* ======================================================================== */

{
  const strip = (html: string): string => html.replace(/ data-snc-capability="[A-Z]+"/, "");
  const floor = renderToString(createElement(ground.SanctuaryGround, { seed: 41, capability: "FLOOR" }));

  ok(floor.includes('data-snc-capability="FLOOR"'), "the tier is published on the root, so the promise below is visible in devtools rather than folded away");
  ok(
    strip(floor) === strip(groundHtml),
    "FLOOR and HIGH render IDENTICAL material: nothing here animates, so FLOOR has nothing to turn off and the grain, the scratches and the ornament all stay",
  );
  for (const layer of ["base", "stone", "grain", "scratches", "vignette", "watermark"]) {
    ok(floor.includes(`data-snc-layer="${layer}"`), `FLOOR keeps the ${layer} stratum — what FLOOR withholds is motion, never the material`);
  }
  ok(
    !/transition|animation|@keyframes/.test(GROUND_CSS_RULES),
    "and there is no transition, animation or keyframe in the ground at all, so that promise is structural rather than a branch someone has to remember",
  );
}

/* ======================================================================== */
/* 6. THE GROUND USES THE SHARED SPRITE INSTEAD OF INLINING ITS OWN          */
/* ======================================================================== */

ok(
  !groundHtml.includes("<filter") && !groundHtml.includes("<feTurbulence"),
  "the ground defines no filter of its own: feTurbulence is evaluated per filter ELEMENT, so a private copy is a second full-viewport noise field per paint on exactly the devices that cannot afford one",
);
ok(
  GROUND_CODE.includes("defUrl(SNC_FILTER_GRAIN)"),
  "…it reaches the shared field through defUrl and the frozen id, because a hand-typed url(#…) that is wrong renders unfiltered with no error and no warning",
);

/* ======================================================================== */
/* 7. NO COLOUR LIVES OUTSIDE THE TOKEN LAYER                                */
/* ======================================================================== */

for (const [name, source] of [
  ["sanctuary-ground.tsx", GROUND_TSX],
  ["sanctuary-ground.module.css", GROUND_CSS],
  ["sanctuary-header.tsx", HEADER_TSX],
  ["sanctuary-header.module.css", HEADER_CSS],
] as const) {
  ok(!HEX_LITERAL.test(source), `${name} contains no hex literal — a colour in a component is a colour no palette review will ever see`);
  ok(!FUNCTIONAL_COLOUR.test(source), `${name} contains no rgb()/hsl() literal either`);
}
ok(count(GROUND_CSS, "var(--color-snc-") >= 6, "every paint in the ground reads a --color-snc-* token");
ok(count(HEADER_CSS, "var(--color-snc-") >= 6, "so does every paint in the header");

/* ======================================================================== */
/* 8. THE HEADER — GOLD, ENGRAVED, AND CARRYING NO INSTRUMENT ACCENT         */
/* ======================================================================== */

const headerHtml = renderToString(createElement(header.SanctuaryHeader, { activeHref: "/scan" }));
const headerIdle = renderToString(createElement(header.SanctuaryHeader, {}));

/*
 * The cold accents are searched for in the rendered markup and in the
 * STYLESHEET, which is the only place using one would actually paint
 * something. The .tsx is deliberately exempt: it names the tokens it refuses,
 * in prose, and a comment explaining a rejection is documentation rather than a
 * colour.
 */
for (const banned of ["mount-glow", "line-glow", "cyan"]) {
  ok(!headerHtml.includes(banned), `the rendered header contains no "${banned}"`);
  ok(!HEADER_CSS.includes(banned), `and neither does its stylesheet, where reaching for "${banned}" would actually paint`);
}
ok(
  !/--color-(?:night|surface|ink|muted|hairline|foreground|background)\b/.test(HEADER_CSS),
  "the header borrows nothing else from the instrument palette either — its --color-ink is a near-white and the sanctuary's is manuscript black",
);

/* --- the wordmark is struck metal over its Devanagari echo --- */

ok(headerHtml.includes("snc-gold-text"), "the wordmark is clipped to the metal ramp by the token layer's own class, not painted a flat gold");
ok(headerHtml.includes(header.SANCTUARY_WORDMARK_LATIN), "the Latin wordmark is present, letter for letter from the product header");
ok(headerHtml.includes("हस्तरेखा"), "the Devanagari wordmark is present");
ok(
  header.SANCTUARY_WORDMARK_DEVANAGARI.includes("॥"),
  "…framed by the double danda U+0965 and not by two ASCII pipes, which would fall back to a Latin face mid-word",
);
ok(headerHtml.includes('lang="hi"'), "…and marked as Hindi, so a screen reader switches voice and the browser picks a Devanagari fallback while Tiro is in flight");
ok(
  rule(HEADER_CSS_RULES, ".wordmarkDevanagari").includes("var(--font-snc-devanagari)"),
  "the Devanagari line is set in the Devanagari face, read through the variable that already carries its fallback stack",
);
ok(
  !/next\/font/.test(HEADER_CODE),
  "…and the header imports no font module: next/font throws outside the compiler, which would make this component impossible to render here",
);
{
  const latin = rule(HEADER_CSS_RULES, ".wordmarkLatin");
  ok(
    !/(^|[\s;{])color\s*:/.test(latin) && !/background-clip|text-shadow|-webkit-text-fill-color/.test(latin),
    "the wordmark's own class sets NO colour, clip or shadow: module CSS is unlayered and would beat .snc-gold-text, overwriting the transparent that lets the metal show and flattening it to yellow",
  );
  ok(latin.includes("var(--font-snc-display)"), "it sets the display face and the weight fonts.ts actually loads, and nothing else that could collide");
}

/* --- the nav is engraved, and the active state is a lamp behind the stone --- */

{
  const navLink = rule(HEADER_CSS_RULES, ".navLink");
  const active = rule(HEADER_CSS_RULES, ".navLinkActive");

  ok(
    count(headerHtml, "navLink") === header.SANCTUARY_NAV.length + 1,
    "every nav destination renders as a link — the count is the four plus the one carrying the active class",
  );
  ok(count(headerHtml, 'aria-current="page"') === 1, "exactly one link is marked as the current page");
  ok(headerHtml.includes("navLinkActive"), "…and it carries the active state");
  ok(!headerIdle.includes("navLinkActive"), "a route the nav does not list lights nothing, rather than defaulting to the first item");
  ok(
    !headerIdle.includes('aria-current="page"'),
    "…and claims no current page, because announcing the wrong one is worse than announcing none",
  );

  ok(
    /text-shadow:\s*\n?\s*0 -1px 0 var\(--color-snc-stone-900\)/.test(navLink),
    "the nav is ENGRAVED: its shadow sits ABOVE the glyphs, which is where the shadow falls in a letter cut into a surface lit from above — the exact inverse of the raised wordmark",
  );
  ok(navLink.includes("var(--color-snc-gold-500)"), "…in hairline gold, held back from full strength so it reads as linework beside struck metal");
  ok(
    navLink.includes("var(--font-snc-serif)") && /font-weight:\s*500/.test(navLink),
    "…set in the one face loaded as a variable axis, because the display face ships a single 600 cut and 'hairline' is simply unreachable in it",
  );
  ok(!/border-radius/.test(HEADER_CSS_RULES), "no pill, no rounded anything: a radius is the instrument header's vocabulary and it is what makes a warm page look like a dashboard");

  ok(
    /box-shadow:[^;]*inset[^;]*var\(--color-snc-flame-warm\)/.test(active),
    "the active state is a warm INSET glow — a lamp behind the stone, not a highlight laid on top of it",
  );
  ok(
    active.includes("var(--color-snc-flame)"),
    "…with the candle core appearing only as a tight rim, so both light tokens do the job the spec gives them",
  );
  ok(
    !/(^|[\s;{])background-color\s*:/.test(active),
    "…and it is never a filled block: the glow is a gradient rising from below the element, which keeps the brightest part off the letterforms",
  );
}

/* --- Login is a dark panel with a gold edge --- */

{
  const login = rule(HEADER_CSS_RULES, ".login");
  ok(headerHtml.includes("snc-gold-border"), "Login's edge is the token layer's border-image of the same metal ramp as the wordmark");
  ok(
    !/(^|[\s;{])border[-a-z]*\s*:/.test(login),
    "…and its own class sets no border property, which — being unlayered — would silently flatten that ramp to one gold",
  );
  ok(
    login.includes("var(--color-snc-obsidian)") && !/background-color:[^;]*gold/.test(login),
    "Login is a dark panel, NEVER a solid gold fill: a filled button is the loudest thing a page can contain and nothing in either reference is filled with gold",
  );
  ok(login.includes("var(--color-snc-gold-400)"), "its lettering is the foil gold, so the edge and the label are the same metal");
  ok(headerHtml.includes('href="/login"'), "and it still goes where the product header's Login goes");
}

/* --- the separator is a fading rule, and the bar is not a bar --- */

ok(
  headerHtml.includes("snc-gold-rule"),
  "the header is separated from the page by a rule that is brightest at its centre and gone at both ends — there is not one solid gold bar anywhere in the references",
);
ok(
  !/(^|[\s;{])border-bottom\s*:/.test(HEADER_CSS_RULES),
  "…which is why there is no border-bottom: a border is exactly the solid bar that rule replaces",
);
ok(
  !/(^|[\s;{])(?:position\s*:\s*(?:sticky|fixed)|backdrop-filter\s*:)/.test(HEADER_CSS_RULES),
  "the header is not a sticky glass bar: over a transparent ground a sticky header shows the page's own text sliding under the wordmark",
);
ok(
  !/(^|[\s;{])background(?:-color|-image)?\s*:/.test(rule(HEADER_CSS_RULES, ".header")),
  "…and it paints no background of its own, so the ground shows through it",
);

/* --- the skin changed; the information architecture did not --- */

{
  const productOrder = header.SANCTUARY_NAV.map((item) => PRODUCT_HEADER_TSX.indexOf(`href: "${item.href}"`));
  ok(
    productOrder.every((at) => at !== -1),
    "every sanctuary destination is still one of the product header's own — this is a change of material, not of information architecture",
  );
  ok(
    productOrder.join() === [...productOrder].sort((x, y) => x - y).join(),
    "…in the same order, so a reader comparing the two files sees the correspondence without reading any JSX",
  );
  ok(
    /"use client"/.test(PRODUCT_HEADER_TSX),
    "the product header is still the client component it always was — this variant exists beside it and edits nothing",
  );
}

/* ======================================================================== */
/* 9. BOTH ARE SERVER COMPONENTS AND COST NOTHING TO SHIP                    */
/* ======================================================================== */

for (const [name, source] of [
  ["sanctuary-ground.tsx", GROUND_CODE],
  ["sanctuary-header.tsx", HEADER_CODE],
] as const) {
  ok(
    !/^\s*["']use client["']/m.test(source),
    `${name} is a server component: it has no state, no effect and no handler, so a directive added by habit would ship it to every device for nothing`,
  );
  ok(!/\buse[A-Z]\w*\(/.test(source), `…and calls no hook, which is what would force one`);
}

console.log(`MATERIAL GROUND ASSERTIONS PASSED (${assertions})`);
