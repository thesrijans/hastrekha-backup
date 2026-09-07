/* ============================================================================
 * MATERIAL PARCHMENT — the torn leaf, and the five layers that stop it being a
 * flat fill with a hex on it
 *
 * WHAT IS PINNED HERE, AND WHY EACH PIN IS A PROMISE RATHER THAN A DETAIL.
 *
 * 1. ALL FIVE LAYERS EXIST. The failure this component replaces was not ugly;
 *    it was PLAUSIBLE. A parchment panel with a fill and a grain on it looks
 *    finished in review and looks like a SaaS card on a screen, and every one
 *    of the five layers is individually easy to delete in a "simplify the
 *    markup" pass without anything breaking. So each layer gets its own
 *    assertion, named for the observation it comes from, and each one asserts
 *    the layer's DEFINING PAINT rather than merely its presence — a burn layer
 *    with no corner radials is not a burnt rim, it is a frame.
 *
 * 2. THE OUTLINE IS BITTEN AND NOT ROUNDED. `border-radius` must not appear in
 *    the markup, the component, or the stylesheet. This is the single most
 *    likely regression in the whole build: a radius is what every other panel
 *    in every other codebase has, it is one line, and it would quietly turn the
 *    leaf back into a card while every other assertion still passed.
 *
 * 3. THE SAME SEED IS THE SAME LEAF, AND TWO SEEDS ARE TWO LEAVES. Both halves
 *    matter and they fail in opposite directions. Without stability the server
 *    HTML and the hydrated client disagree, React throws the subtree away, and
 *    the leaf visibly re-tears itself on every load. Without variation an eight
 *    leaf bundle is one leaf printed eight times, which reads as wallpaper —
 *    the exact thing the seeded-randomness apparatus was built to prevent.
 *
 * 4. THE MATERIAL NEVER DEGRADES. No transition, no animation, no capability
 *    branch anywhere in the component or its stylesheet, so a FLOOR device and
 *    a reduced-motion reader get byte-identical material to everyone else.
 *    Motion is what FLOOR turns off; a reader who asked for stillness did not
 *    ask for a worse manuscript.
 *
 * 5. NO COLOUR OF ITS OWN, AND NO CLIENT BUNDLE. Every colour resolves to a
 *    --color-snc-* token, so no hex may appear in either source file; and the
 *    component must carry no "use client", because a leaf is pure markup and a
 *    directive added by habit would ship React to every device for nothing.
 *
 * HOW THIS TEST LOADS A COMPONENT THAT OWNS A STYLESHEET.
 *
 * `tsx` runs these files through Node's CommonJS loader, which cannot parse
 * CSS — importing parchment.tsx directly would throw on its `.module.css`
 * import before a single assertion ran. The bundler-free fix is to register a
 * `.css` handler that returns the identity proxy CSS Modules are conventionally
 * stubbed with, then require the component AFTER that handler exists (hence
 * createRequire rather than a static import, whose require would be hoisted
 * above the patch). One consequence is stated rather than hidden: class names
 * are stubs here, so NOTHING below asserts on a class. Every claim is made
 * against a `data-snc-layer` attribute or against a real inline value, which is
 * what a browser would actually paint from.
 * ========================================================================== */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import Module, { createRequire } from "node:module";
import path from "node:path";
import { createElement, type ReactElement } from "react";
import { renderToString } from "react-dom/server";
import type { ParchmentProps, ParchmentTear, ParchmentTone } from "../components/sanctuary/material/parchment";

let assertions = 0;
const ok = (condition: boolean, message: string): void => {
  assert.ok(condition, message);
  assertions += 1;
};

/* --------------------- loading the component under test ------------------- */

/** A CSS Modules stand-in: `styles.leaf` is the string "leaf", so stubbed markup stays readable in a failure message. */
const CLASS_NAME_STUB: Record<string, string> = new Proxy(
  {},
  { get: (_target, key): string | undefined => (typeof key === "string" ? key : undefined) },
) as Record<string, string>;

interface CjsExtensionHost {
  _extensions: Record<string, (loaded: { exports: unknown }, filename: string) => void>;
}

/* `__esModule: true` rather than exporting the proxy directly: the interop
 * wrapper esbuild emits asks a CommonJS export whether it is an ES module, and
 * a bare proxy would answer with the string "__esModule" — truthy — and hand
 * back the wrong object. Stating it removes the guess. */
(Module as unknown as CjsExtensionHost)._extensions[".css"] = (loaded): void => {
  loaded.exports = { __esModule: true, default: CLASS_NAME_STUB };
};

interface ParchmentModule {
  Parchment: (props: ParchmentProps) => ReactElement;
  parchmentEdgePolygon: (seed: number, tear: ParchmentTear) => string;
  PARCHMENT_EDGE_POINT_COUNT: number;
  PARCHMENT_TONES: readonly ParchmentTone[];
  PARCHMENT_TEARS: readonly ParchmentTear[];
}

const COMPONENT_DIR = path.resolve(__dirname, "..", "components", "sanctuary", "material");
const { Parchment, parchmentEdgePolygon, PARCHMENT_EDGE_POINT_COUNT, PARCHMENT_TONES, PARCHMENT_TEARS } = createRequire(
  __filename,
)("../components/sanctuary/material/parchment") as ParchmentModule;

const source = readFileSync(path.join(COMPONENT_DIR, "parchment.tsx"), "utf8");
const stylesheet = readFileSync(path.join(COMPONENT_DIR, "parchment.module.css"), "utf8");

/**
 * Both files with their comments removed.
 *
 * Every "this must not appear" assertion below runs against these rather than
 * against the raw text, and the distinction is not pedantry: this component is
 * documented by NAMING the things it refuses to do — border-radius, overflow,
 * transitions, the ornament it must not import — so a prose-level search would
 * fail on the very sentences that explain the rule. What is forbidden is the
 * DECLARATION, and stripping comments is what makes the assertion mean that.
 */
const withoutComments = (text: string): string =>
  text.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1");

const code = withoutComments(source);
const css = withoutComments(stylesheet);

/* --------------------------------- helpers -------------------------------- */

/** One leaf, rendered to the HTML a browser would actually receive. */
const render = (props: ParchmentProps): string => renderToString(createElement(Parchment, props));

/**
 * The opening tag of the element carrying `data-snc-layer="…"`.
 *
 * Every layer assertion is scoped through this, so "the grain multiplies"
 * cannot be satisfied by a `multiply` that belongs to some other layer in the
 * same stack — which is precisely the mistake a copied-and-edited layer makes.
 */
const layerTag = (markup: string, layer: string): string => {
  const at = markup.indexOf(`data-snc-layer="${layer}"`);
  assert.ok(at !== -1, `expected the leaf to render a layer named ${layer}`);
  const open = markup.lastIndexOf("<span", at);
  const close = markup.indexOf(">", at);
  assert.ok(open !== -1 && close !== -1, `expected the ${layer} layer to be a complete tag`);
  return markup.slice(open, close + 1);
};

/** How many times a literal substring occurs — the only honest way to ask "exactly four corner radials". */
const count = (haystack: string, needle: string): number => haystack.split(needle).length - 1;

const AGED = render({ seed: 3 });

/* ------------- 1(a) the torn edge: bitten, per-instance, not rounded ------- */

ok(
  AGED.includes("filter:url(#snc-f-torn)"),
  "observation 1(a): the leaf references the SHARED tearing filter — a url() that resolves to nothing fails silently and looks like a design choice",
);
ok(
  render({ seed: 3, tear: "rough" }).includes("filter:url(#snc-f-torn-rough)"),
  "observation 1(a): tear=rough reaches for the sprite's second, deeper tear rather than scaling the first",
);
ok(
  layerTag(AGED, "sheet").includes("clip-path:polygon("),
  "observation 1(a): the leaf's visible outline is a polygon of seeded points, so the boundary is bitten rather than described by a rectangle",
);

/* ---------------------- 1(b) the broad luminance mottle ------------------- */

{
  const mottle = layerTag(AGED, "mottle");
  ok(
    count(mottle, "radial-gradient(") === 3 &&
      mottle.includes("var(--snc-parch-lift)") &&
      mottle.includes("var(--snc-parch-shade)"),
    "observation 1(b): three very large radials, lifting and falling — this is the layer that decides whether the panel still reads flat when you squint at it",
  );
}

/* ------- 1(b) again: the mottle is a swing you can SEE, on every tone ----- */

/*
 * The observation says "roughly +/-6% lightness across the panel", and that
 * number is the difference between a leaf and a swatch. It is also the easiest
 * thing in this component to get wrong WITHOUT NOTICING, in both directions and
 * for the same reason: a mottle is a percentage swing about the field it sits
 * on, so one alpha copied from one tone to another buys a whisper on a pale
 * base and a blotch on a dark one. Measured here rather than trusted, by
 * resolving the leaf's own published pigments against the real token hexes in
 * app/sanctuary.css.
 *
 * The mixing is done in sRGB where the component mixes in oklab, so these
 * numbers are an approximation — which is exactly why the bounds are wide. They
 * are not trying to pin the design at +/-6%; they are trying to catch a mottle
 * that has become invisible (a flat fill again) or violent (blotches), and
 * either of those is far outside a band this generous.
 */
{
  const tokenCss = readFileSync(path.resolve(__dirname, "..", "app", "sanctuary.css"), "utf8");
  const tokens = new Map(
    [...tokenCss.matchAll(/(--color-snc-[a-z0-9-]+):\s*(#[0-9a-fA-F]{6})/g)].map((match) => [match[1], match[2]] as const),
  );

  const rgb = (hex: string): number[] => [1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16));
  /** A pigment as a colour plus the alpha it is painted at; `transparent` in a color-mix is how this component spells an alpha. */
  const pigment = (expression: string): { colour: number[]; alpha: number } => {
    const plain = /^var\((--color-snc-[a-z0-9-]+)\)$/.exec(expression.trim());
    if (plain) return { colour: rgb(tokens.get(plain[1]) ?? ""), alpha: 1 };
    const mixed =
      /^color-mix\(in oklab, var\((--color-snc-[a-z0-9-]+)\) (\d+)%, (transparent|var\((--color-snc-[a-z0-9-]+)\))\)$/.exec(
        expression.trim(),
      );
    assert.ok(mixed, `expected a token-only pigment, got: ${expression}`);
    const first = rgb(tokens.get(mixed[1]) ?? "");
    const share = Number(mixed[2]) / 100;
    if (mixed[3] === "transparent") return { colour: first, alpha: share };
    const second = rgb(tokens.get(mixed[4]) ?? "");
    return { colour: first.map((value, i) => value * share + second[i] * (1 - share)), alpha: 1 };
  };

  const luminance = (colour: number[]): number => 0.2126 * colour[0] + 0.7152 * colour[1] + 0.0722 * colour[2];
  const paintedOver = (top: { colour: number[]; alpha: number }, under: number[]): number[] =>
    under.map((value, i) => top.colour[i] * top.alpha + value * (1 - top.alpha));

  for (const tone of PARCHMENT_TONES) {
    const declarations = /style="([^"]*)"/.exec(render({ seed: 3, tone }))?.[1] ?? "";
    const vars = new Map(
      declarations.split(";").map((declaration) => {
        const at = declaration.indexOf(":");
        return [declaration.slice(0, at), declaration.slice(at + 1)] as const;
      }),
    );
    const base = pigment(vars.get("--snc-parch-base") ?? "").colour;
    const high = luminance(paintedOver(pigment(vars.get("--snc-parch-lift") ?? ""), base));
    const low = luminance(paintedOver(pigment(vars.get("--snc-parch-shade") ?? ""), base));
    const swing = (100 * (high - low)) / (high + low);
    ok(
      swing >= 3 && swing <= 14,
      `observation 1(b): the ${tone} leaf's mottle swings +/-${swing.toFixed(1)}% about its field — under 3% is a flat fill wearing a gradient, over 14% is blotches rather than candlelight`,
    );
  }
}

/* ---------------------------- 1(c) the fibrous grain ---------------------- */

{
  const grain = layerTag(AGED, "grain");
  ok(
    grain.includes("filter:url(#snc-f-grain)") && grain.includes("opacity:0.07"),
    "observation 1(c): fibre from the shared grain filter, at 7% — inside the 5-8% the reference measures, felt rather than seen",
  );
  ok(
    grain.includes("mix-blend-mode:multiply"),
    "observation 1(c): the grain MULTIPLIES — screened or normal it would haze the leaf toward grey instead of shading its fibre",
  );
}

/* ----------------------- 1(d) the burnt rim, corner-weighted -------------- */

{
  const burn = layerTag(AGED, "burn");
  const corners = ["at 0% 0%", "at 100% 0%", "at 100% 100%", "at 0% 100%"];
  ok(
    corners.every((corner) => burn.includes(corner)) &&
      count(burn, "var(--snc-parch-ember)") === 4 &&
      count(burn, "var(--snc-parch-burn)") === 4 &&
      burn.includes("mix-blend-mode:multiply"),
    "observation 1(d): four corner blooms laid over four edge bands and multiplied in, which is what makes the corners the darkest point rather than the frame merely even",
  );
  ok(
    count(burn, "linear-gradient(to ") === 4 && count(burn, "transparent clamp(") === 4,
    "observation 1(d): all four edge bands end at a CLAMPED PIXEL length — as a bare percentage the same band that reads right on a phone becomes a 100px scorch down the side of a spread",
  );
}

/* ------------------------------- 1(e) the stains -------------------------- */

{
  const stain = layerTag(AGED, "stain");
  ok(
    count(stain, "radial-gradient(") >= 2 &&
      stain.includes("var(--snc-parch-stain)") &&
      stain.includes("mix-blend-mode:multiply"),
    "observation 1(e): two or three soft marks of age, multiplied in at a few percent so they darken the fibre instead of sitting on top of it",
  );
  ok(
    stain.includes("opacity:0.055"),
    "observation 1(e): the stains sit near 3% once each radial's own falloff is spent — any louder and they read as damage rather than age",
  );
}

/* -------------- the optional fold, and the layers it must not disturb ----- */

ok(AGED.indexOf('data-snc-layer="fold"') === -1, "a leaf is not folded unless it is asked to be: no crease layer by default");
ok(
  render({ seed: 3, fold: true }).includes('data-snc-layer="fold"'),
  "fold renders one vertical crease, for a spread rather than a card",
);

/* --------- 3. the same seed is the same leaf; two seeds are two leaves ---- */

ok(render({ seed: 3 }) === AGED, "the same seed renders byte-identical markup twice — this is what lets a torn edge survive hydration at all");
ok(render({ seed: 4 }) !== AGED, "a different seed renders a different leaf, or a bundle is one leaf printed eight times");
ok(
  parchmentEdgePolygon(3, "subtle") === parchmentEdgePolygon(3, "subtle") &&
    parchmentEdgePolygon(3, "subtle") !== parchmentEdgePolygon(4, "subtle"),
  "the OUTLINE itself is stable per seed and different across seeds — two leaves on one page never share a silhouette",
);
ok(
  parchmentEdgePolygon(3, "subtle").split(", ").length === PARCHMENT_EDGE_POINT_COUNT,
  "the outline carries every one of its published points: four corners and six samples an edge",
);

{
  /* The rough tear must actually bite deeper, not merely name a different
   * filter: the two are separate mechanisms (path amplitude and noise field)
   * and it would be entirely possible to change one and forget the other. */
  const deepest = (polygon: string): number =>
    Math.max(...[...polygon.matchAll(/([\d.]+)px/g)].map((match) => Number(match[1])));
  ok(
    deepest(parchmentEdgePolygon(3, "rough")) > deepest(parchmentEdgePolygon(3, "subtle")),
    "a rough tear takes deeper bites out of the path, so the two tears differ in shape and not only in which filter they cite",
  );
}

ok(
  AGED.includes("--snc-parch-bleed:4px") && render({ seed: 3, tear: "rough" }).includes("--snc-parch-bleed:8px"),
  "each tear publishes its own bleed, so the stylesheet reserves exactly the room that tear can travel — an under-reserved bleed is an outline clipped back to a straight line",
);

/* ---------------------- 2. nothing here is a rounded card ---------------- */

ok(!AGED.includes("border-radius") && !AGED.includes("borderRadius"), "no border-radius survives into the markup: the visible outline is the torn polygon and nothing else");
ok(!/border-radius/.test(css) && !/borderRadius/.test(code), "and none is waiting in the stylesheet or the component to reappear the day someone tidies the outline away");
ok(!/overflow\s*:\s*hidden/.test(css), "the stylesheet never clips: the tear travels outside the leaf's box, and an overflow would cut it back into a rectangle");

/* --------------------------- tone is a real difference ------------------- */

{
  const light = render({ seed: 3, tone: "light" });
  ok(light !== AGED, "tone=light and tone=aged are different leaves, not the same leaf with a different attribute on it");
  ok(
    light.includes("var(--color-snc-gold-ramp-pale)") && !AGED.includes("var(--color-snc-gold-ramp-pale)"),
    "the light leaf's crest reaches for the pale end of the gold ramp — the one warm near-white in the token layer — while the aged leaf lifts only to parchment",
  );
  /* Compared on the whole leaf, not on one layer's tag: every layer paints out
   * of the same --snc-parch-* variables, so the tones differ where the
   * variables are DECLARED. That is the design — one pigment table, eight
   * names, three sets of values — and a per-layer comparison would pass
   * whatever the tone table said. */
  const painted = new Set(PARCHMENT_TONES.map((tone) => render({ seed: 3, tone })));
  ok(painted.size === PARCHMENT_TONES.length, "every tone paints a different leaf, so none of the three is decorative duplication");
  const fields = new Set(
    PARCHMENT_TONES.map((tone) => /--snc-parch-base:([^;"]+)/.exec(render({ seed: 3, tone }))?.[1] ?? ""),
  );
  ok(
    fields.size === PARCHMENT_TONES.length && ![...fields].some((field) => field === ""),
    "and the difference is a different field colour on each, not an attribute the stylesheet might ignore",
  );
  ok(PARCHMENT_TEARS.length === 2, "there are exactly two tears, matching the two tearing filters the sprite defines");
}

/* -------------------- the content is outside the filter ------------------ */

{
  const withText = render({ seed: 3, children: "Hastarekha Shastra" });
  const filtered = withText.slice(withText.indexOf("filter:url(#snc-f-torn)"), withText.indexOf('data-snc-layer="grain"'));
  ok(
    !filtered.includes("Hastarekha Shastra") && withText.includes("Hastarekha Shastra"),
    "the reading is rendered OUTSIDE the tearing filter: an feDisplacementMap over the text would wobble every glyph on the leaf",
  );
  ok(count(withText, 'aria-hidden="true"') >= 1, "the material describes nothing and is hidden from assistive technology");
}

/* ------------------------------ the element, and the slots --------------- */

ok(render({ seed: 3, as: "article" }).startsWith("<article"), "`as` chooses the element, so a leaf can be the article it actually is");
ok(AGED.indexOf('data-snc-corner="tl"') === -1, "a leaf has no corner ornaments unless asked");
ok(
  count(render({ seed: 3, corners: true }), "data-snc-corner=") === 4,
  "corners=true renders all four built-in hairline marks, mirrored from one pair of arms",
);
ok(
  render({ seed: 3, corners: createElement("i", { id: "ornament-slot" }) }).includes('id="ornament-slot"'),
  "a node passed as `corners` is rendered into the slot instead, which is how <AncientCorner /> arrives without this file importing it",
);
ok(
  !/AncientCorner|ancient-corner/.test(code),
  "and the leaf does not import that ornament, so the two components cannot break each other's build",
);

/* ---------------- 4. the material never degrades, only motion does ------- */

ok(
  !/transition|animation|@keyframes/.test(css),
  "the stylesheet has no motion at all, so a FLOOR device and a reduced-motion reader get byte-identical material to everyone else",
);
ok(
  !/transition|animation|CapabilityTier|prefers-reduced-motion/.test(code),
  "and the component has no capability branch: what FLOOR turns off is motion, never the material",
);

/* ------------------ 5. no colour of its own, no client bundle ------------ */

ok(!/#[0-9a-fA-F]{3,8}\b/.test(code), "the component contains no hex literal — every colour resolves to a --color-snc-* token");
ok(!/#[0-9a-fA-F]{3,8}\b/.test(css), "and neither does the stylesheet");
ok(!/\brgba?\(/.test(code) && !/\brgba?\(/.test(css), "nor an rgb()/rgba() literal, which is the other way a colour escapes the palette");
ok(count(AGED, "var(--color-snc-") + count(AGED, "var(--snc-parch-") >= 12, "the rendered leaf is painted entirely out of variables");
ok(!/^\s*["']use client["']/m.test(code), "the leaf is a SERVER component: it has no state, no effect and no handler, and must cost zero client JavaScript");
ok(/@layer\s+components/.test(css), "the stylesheet is layered, so a utility passed in className still wins over these defaults");

/* ------------- every class the component names actually exists ----------- */

/*
 * The one hole the CSS Modules stub leaves, closed by reading the two files
 * against each other.
 *
 * With a real bundler `styles.sheat` is `undefined` and the layer renders with
 * no class at all — absolutely positioned rules gone, five layers collapsed
 * into the corner of the leaf. With the stub above it is the string "sheat",
 * which renders happily and asserts fine. So the source is checked against the
 * stylesheet directly: every name the component reaches for must be defined,
 * and every rule the stylesheet defines must be reached for, because a class
 * nobody uses is either a layer that was dropped or a rename half finished.
 */
{
  const used = new Set([...code.matchAll(/styles\.([A-Za-z][A-Za-z0-9_]*)/g)].map((match) => match[1]));
  const defined = new Set([...css.matchAll(/\.([A-Za-z][A-Za-z0-9_]*)\s*[{[]/g)].map((match) => match[1]));
  ok(used.size >= 9, "the leaf is built from the stylesheet rather than from inline layout, which is what keeps it overridable");
  ok(
    [...used].every((name) => defined.has(name)),
    `every class the component names is defined: ${[...used].filter((name) => !defined.has(name)).join(", ") || "none missing"} — a name that resolves to undefined renders an unstyled layer, not an error`,
  );
  ok(
    [...defined].every((name) => used.has(name)),
    `and the stylesheet carries no orphan: ${[...defined].filter((name) => !used.has(name)).join(", ") || "none orphaned"} — an unused rule is a layer that was dropped or a rename left half done`,
  );
}

console.log(`MATERIAL PARCHMENT ASSERTIONS PASSED (${assertions})`);
