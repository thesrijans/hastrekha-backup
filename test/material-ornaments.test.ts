/* ============================================================================
 * MATERIAL ORNAMENTS — the six engraved marks, and the one stroke philosophy
 * they are only a family because they share.
 *
 * WHAT IS PINNED HERE, AND WHY EACH PIN IS A PROMISE RATHER THAN A DETAIL.
 *
 * 1. ONE STROKE, EVERYWHERE. Every line in every ornament is 1px, non-scaling,
 *    and painted from the shared #snc-g-gold ramp. This is asserted by walking
 *    EVERY element of EVERY render rather than by spot-checking, because the
 *    failure is additive: one 2px stroke or one flat `--color-snc-gold-500`
 *    line looks fine in isolation and destroys the family's coherence the
 *    moment two ornaments sit on the same page. A hand-drawn alphabet with one
 *    letter set in a different weight is not an alphabet.
 *
 * 2. NO COLOUR OF THEIR OWN. Not one hex, not one rgb(), in the markup OR in
 *    the stylesheet. A literal here is a colour that no palette review would
 *    ever see, in the layer whose entire job is to look like one material.
 *
 * 3. THE RULE FADES AT BOTH ENDS. Observation 2 — there is not one solid gold
 *    bar anywhere in the references — is checked at both ends of the chain: the
 *    divider must PAINT with #snc-g-rule, and #snc-g-rule must still be a
 *    gradient whose terminal stops are fully transparent. Asserting only the
 *    first would pass forever after somebody "simplified" the gradient.
 *
 * 4. EVERY url(#…) RESOLVES. An SVG paint or filter reference is a silent
 *    document-global lookup: a mistyped id renders unpainted, with no error and
 *    no warning, and an unpainted hairline is invisible rather than wrong. So
 *    every reference the family emits is checked against SANCTUARY_DEF_IDS.
 *
 * 5. FOUR CORNERS, ONE LIGHT. <AncientCorner> must emit NO `transform`. The
 *    obvious way to make a top-right corner is scale(-1,1) on the top-left one,
 *    and it is wrong: the gold ramp is an objectBoundingBox gradient, so
 *    mirroring the element mirrors the light source, and §3 allows exactly one.
 *    The absence of a transform is the only observable trace of that decision,
 *    so it is pinned.
 *
 * 6. THE WHEEL STOPS TWO WAYS, AND THE MATERIAL NEVER DOES. At FLOOR the spin
 *    class must be ABSENT (the animation is never allocated), and the
 *    stylesheet must neutralise it under prefers-reduced-motion (the tier is
 *    measured once; the preference is live). The FLOOR markup must otherwise be
 *    byte-identical to HIGH — rim, beads, twelve spokes, ticks and hub all
 *    present. What FLOOR turns off is motion. It is never the material.
 *
 * 7. THE ROTATION IS THE SPECIFIED ROTATION. 0.15 deg/s is one turn per 2400 s,
 *    and CSS cannot compute that from the constant, so the stylesheet states it
 *    as a literal. The two are checked against each other here, because a
 *    drifting pair is invisible until somebody times a forty-minute rotation.
 *
 * 8. THE SEEDS ARE SEEDS. Same seed, same markup — the property that lets a
 *    hand-wavered engraving be server-rendered at all. Different seed,
 *    different markup, or four corners of one box are one cut printed four
 *    times.
 * ========================================================================== */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import Module, { createRequire } from "node:module";
import path from "node:path";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { SanctuaryDefs } from "../components/sanctuary/material/sanctuary-defs";
import { SANCTUARY_DEF_IDS } from "../components/sanctuary/material/ids";

let assertions = 0;
const ok = (condition: boolean, message: string): void => {
  assert.ok(condition, message);
  assertions += 1;
};

/* --------------------------------------------------------------------------
 * LOADING A COMPONENT THAT IMPORTS A CSS MODULE, OUTSIDE THE BUNDLER
 *
 * ornaments.tsx does what every Next component does with its stylesheet:
 * `import styles from "./ornaments.module.css"`. In the app, Next's bundler
 * turns that into a class-name map. Under `tsx`, which is plain Node, it turns
 * into Node trying to parse CSS as JavaScript — `SyntaxError: Unexpected token
 * '.'` — and the test cannot even reach the component.
 *
 * The alternative was to keep the animation out of a stylesheet so the test
 * would not have to know, and that trades a shipped-code compromise (inline
 * @keyframes, or a hand-rolled rotation in JavaScript that would make the ring
 * a client component) for a test-only convenience. So the shipped code stays
 * idiomatic and the TEST supplies what the bundler would: a `.css` handler that
 * returns the identity map, so `styles.spin` is the string "spin" and the
 * assertions below can read it.
 *
 * It has to be installed before the component module is loaded, and an ESM
 * `import` is hoisted above every statement in this file — so the component is
 * pulled in through `createRequire` on the line after the hook, which is the
 * one ordering Node guarantees. `typeof import(...)` keeps it fully typed; that
 * form is erased at compile time and loads nothing.
 * ------------------------------------------------------------------------ */

/** What a CSS-module import resolves to: class name in, class name out. */
type CssModuleExports = Record<string, string>;

/** The shape Node hands an extension handler — narrowed to the one field we set. */
interface LoadableModule {
  exports: unknown;
}

const extensions = (
  Module as unknown as { _extensions: Record<string, (mod: LoadableModule, filename: string) => void> }
)._extensions;

extensions[".css"] = (mod: LoadableModule): void => {
  /* `__esModule` must answer undefined and `default` must answer the map
   * itself. esbuild compiles `import styles from "…css"` to an interop call
   * that reads both, and a naive identity proxy hands back the STRINGS
   * "__esModule" and "default" — so the interop concludes it has a real ES
   * module and binds `styles` to the string "default", whose `.ornament` is
   * undefined. Answering those two keys honestly is the whole difference
   * between this shim working and failing several frames later inside React. */
  const identity: CssModuleExports = new Proxy({} as CssModuleExports, {
    get: (_target, key) => {
      if (typeof key !== "string" || key === "__esModule") return undefined;
      return key === "default" ? identity : key;
    },
  });
  mod.exports = identity;
};

const ornaments = createRequire(__filename)(
  "../components/sanctuary/material/ornaments",
) as typeof import("../components/sanctuary/material/ornaments");

const {
  AncientCorner,
  CELESTIAL_BEADS_DEFAULT,
  CELESTIAL_ROTATION_DEG_PER_SECOND,
  CELESTIAL_ROTATION_PERIOD_SECONDS,
  CELESTIAL_SECTORS_DEFAULT,
  CelestialRing,
  GoldRule,
  LotusDecoration,
  ORNAMENTAL_DIVIDER_HEIGHT_PX,
  ORNAMENT_CORNERS,
  OrnamentalDivider,
  TRISHUL_PARTS,
  TrishulEmblem,
} = ornaments;

/* ----------------------------- reading markup ----------------------------- */

/** One rendered element: its tag and its attributes, which is all these assertions need. */
interface RenderedElement {
  tag: string;
  attrs: Record<string, string>;
}

/** Every element in a render, in source order. */
function elementsOf(html: string): RenderedElement[] {
  const found: RenderedElement[] = [];
  for (const match of html.matchAll(/<([a-zA-Z][\w-]*)((?:\s+[a-zA-Z][\w-]*="[^"]*")*)\s*\/?>/g)) {
    const attrs: Record<string, string> = {};
    for (const attr of match[2].matchAll(/([a-zA-Z][\w-]*)="([^"]*)"/g)) attrs[attr[1]] = attr[2];
    found.push({ tag: match[1], attrs });
  }
  return found;
}

/** The one element carrying `data-snc-part="…"`, or undefined. */
function partOf(html: string, part: string): RenderedElement | undefined {
  return elementsOf(html).find((el) => el.attrs["data-snc-part"] === part);
}

/**
 * How many subpaths a `d` contains.
 *
 * The family draws every repeated family of linework — twelve spokes,
 * forty-eight beads, seven petals — as ONE element with many subpaths, so that
 * they share one bounding box and therefore one pass of the metal ramp. Counting
 * `M` commands is how a count of things is read back out of that decision.
 */
const subpaths = (d: string | undefined): number => (d ? (d.match(/M/g) ?? []).length : 0);

/** How many times a literal substring occurs. */
const count = (haystack: string, needle: string): number => haystack.split(needle).length - 1;

/* ------------------------------- the renders ------------------------------ */

const dividerHtml = renderToString(createElement(OrnamentalDivider, { seed: 3 }));
const dividerWideHtml = renderToString(createElement(OrnamentalDivider, { seed: 3, width: 600 }));
const cornerHtml: Record<string, string> = {};
for (const corner of ORNAMENT_CORNERS) {
  cornerHtml[corner] = renderToString(createElement(AncientCorner, { corner, seed: 5 }));
}
const goldRuleHtml = renderToString(createElement(GoldRule, {}));
const lotusHtml = renderToString(createElement(LotusDecoration, { seed: 9 }));
const ringHtml = renderToString(createElement(CelestialRing, { seed: 2 }));
const ringFloorHtml = renderToString(createElement(CelestialRing, { seed: 2, capabilityTier: "FLOOR" }));
const trishulHtml = renderToString(createElement(TrishulEmblem, { seed: 4 }));

/** Every ornament render, labelled, for the assertions that must hold across all six. */
const ALL_RENDERS: ReadonlyArray<readonly [string, string]> = [
  ["OrnamentalDivider", dividerHtml],
  ["AncientCorner tl", cornerHtml.tl],
  ["AncientCorner tr", cornerHtml.tr],
  ["AncientCorner bl", cornerHtml.bl],
  ["AncientCorner br", cornerHtml.br],
  ["GoldRule", goldRuleHtml],
  ["LotusDecoration", lotusHtml],
  ["CelestialRing", ringHtml],
  ["CelestialRing FLOOR", ringFloorHtml],
  ["TrishulEmblem", trishulHtml],
];

/* ============================ 1. ONE STROKE ============================== */

const GOLD_STROKE = "url(#snc-g-gold)";
let strokedElements = 0;

for (const [name, html] of ALL_RENDERS) {
  for (const el of elementsOf(html)) {
    const stroke = el.attrs.stroke;
    if (stroke === undefined) continue;
    strokedElements += 1;
    ok(stroke === GOLD_STROKE, `${name}: every stroke is the shared metal ramp, not a flat gold (<${el.tag}> strokes ${stroke})`);
    ok(el.attrs["stroke-width"] === "1", `${name}: every stroke is 1px — the family has exactly one weight (<${el.tag}>)`);
    ok(
      el.attrs["vector-effect"] === "non-scaling-stroke",
      `${name}: the hairline is non-scaling, or "1px" would mean one USER UNIT and a 160px ring would draw at 4px while a 28px corner drew at 0.4px`,
    );
  }
}
ok(strokedElements >= 14, `the family draws real linework — ${strokedElements} stroked elements across the six ornaments`);

/* ========================= 2. NO COLOUR OF THEIR OWN ===================== */

const HEX = /#[0-9a-fA-F]{3,8}\b/;
for (const [name, html] of ALL_RENDERS) {
  ok(!HEX.test(html), `${name}: no hex literal — every paint is a shared gradient or a --color-snc-* token`);
  ok(!/\brgba?\(/.test(html), `${name}: no rgb()/rgba() literal either`);
  ok(!/\bhsla?\(/.test(html), `${name}: and no hsl() — the token layer is the only place a colour is chosen`);
}

const ORNAMENTS_DIR = path.resolve(__dirname, "..", "components", "sanctuary", "material");
const componentSource = readFileSync(path.join(ORNAMENTS_DIR, "ornaments.tsx"), "utf8");
const styleSource = readFileSync(path.join(ORNAMENTS_DIR, "ornaments.module.css"), "utf8");
/**
 * The stylesheet with its comments removed.
 *
 * The prose in that file NAMES the things it refuses to do ("no border-radius,
 * no box-shadow, no transition"), which is exactly what the next assertion
 * searches for. Scanning the raw text would make the file fail for explaining
 * itself, and the obvious fix — deleting the explanation — is the wrong one.
 */
const styleRules = styleSource.replace(/\/\*[\s\S]*?\*\//g, "");
/**
 * The component with its comments removed, for the same reason.
 *
 * ornaments.tsx explains at length why <CelestialRing> does NOT reach for
 * `useEffect` and `requestAnimationFrame` — and a search of the raw text for
 * those identifiers finds them in that very sentence. A file must not fail a
 * test for documenting the trap it avoids.
 */
const componentCode = componentSource.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

ok(!HEX.test(componentSource), "ornaments.tsx itself contains no hex literal, not even in a comment nobody would grep");
ok(!HEX.test(styleSource), "ornaments.module.css contains no hex literal");
ok(!/\brgba?\(|\bhsla?\(/.test(styleSource), "…and no rgb()/hsl() either: the stylesheet paints nothing at all");
ok(
  !/border-radius|box-shadow|transition/.test(styleRules),
  "the ornament stylesheet has no border-radius, no box-shadow and no transition — §7's restraint applies to the CSS too",
);

/* =================== 3. THE RULE FADES AT BOTH ENDS ===================== */

const rule = partOf(dividerHtml, "rule");
ok(rule !== undefined, "the divider draws a rule");
ok(rule?.attrs.fill === "url(#snc-g-rule)", "the divider's side rules are painted from the fading rule gradient, not from a gold");
ok(
  subpaths(rule?.attrs.d) === 2,
  "the two side rules are TWO SUBPATHS OF ONE ELEMENT — split into two elements each would get its own copy of the objectBoundingBox ramp and fade to nothing beside the diamond, leaving a hole either side of it",
);

/* …and the gradient it points at still vanishes at both ends. */
const spriteHtml = renderToString(createElement(SanctuaryDefs));
const ruleGradientAt = spriteHtml.indexOf('id="snc-g-rule"');
ok(ruleGradientAt !== -1, "the sprite still defines #snc-g-rule");
const ruleGradient = spriteHtml.slice(ruleGradientAt, spriteHtml.indexOf("</linearGradient>", ruleGradientAt));
const ruleStops = [...ruleGradient.matchAll(/style="([^"]*)"/g)].map((m) => m[1]);
ok(ruleStops.length === 3, "the rule gradient is three stops");
ok(
  ruleStops[0].includes("stop-opacity:0") && ruleStops[2].includes("stop-opacity:0"),
  "both ends of the rule gradient are fully transparent — there is not one solid gold bar anywhere in the references",
);
ok(ruleStops[1].includes("stop-opacity:1"), "and it is brightest at its centre");

/* The divider's own composition, from the reference card. */
ok(partOf(dividerHtml, "diamond") !== undefined, "the divider has a centre diamond");
ok(subpaths(partOf(dividerHtml, "pip")?.attrs.d) === 2, "two pips flank the centre diamond");
ok(
  subpaths(partOf(dividerHtml, "terminal")?.attrs.d) === 2,
  "there is a tiny diamond terminal at each end, where the rule's own alpha has already reached zero",
);
ok(
  Number(partOf(dividerHtml, "terminal")?.attrs.opacity) < 1,
  "the terminals sit under full strength: they punctuate the rule rather than replacing it",
);

/* The ornament is placed, not scaled. */
ok(dividerHtml.includes(`height="${ORNAMENTAL_DIVIDER_HEIGHT_PX}"`), "the divider renders at its stated height");
ok(dividerHtml.includes('viewBox="0 0 240 12"'), "the default divider is 240 units wide");
ok(dividerWideHtml.includes('viewBox="0 0 600 12"'), "a wider divider recomputes its geometry at that width…");
ok(
  dividerWideHtml.includes(`height="${ORNAMENTAL_DIVIDER_HEIGHT_PX}"`),
  "…and is still 12px tall, so the centre diamond does not grow with the column it punctuates",
);
ok(
  renderToString(createElement(OrnamentalDivider, { width: 10 })).includes('viewBox="0 0 96 12"'),
  "an impossibly narrow divider clamps instead of inverting its own tapers",
);

/* ==================== 4. EVERY url(#…) RESOLVES ========================= */

const KNOWN_IDS = new Set<string>(SANCTUARY_DEF_IDS);
let references = 0;
for (const [name, html] of ALL_RENDERS) {
  for (const match of html.matchAll(/url\(#([^)]+)\)/g)) {
    references += 1;
    ok(
      KNOWN_IDS.has(match[1]),
      `${name}: url(#${match[1]}) names a def the shared sprite actually mounts — a mistyped id renders UNPAINTED, with no error and no warning`,
    );
  }
}
ok(references >= 20, `the family leans on the shared sprite rather than inlining its own filters (${references} references)`);
ok(
  count(componentSource, "<filter") === 0 && count(componentSource, "<linearGradient") === 0,
  "no ornament inlines a duplicate filter or gradient: feTurbulence is evaluated per filter ELEMENT, so a second copy is a second noise field per frame",
);

/* ================== 5. FOUR CORNERS, ONE LIGHT SOURCE =================== */

const brackets = ORNAMENT_CORNERS.map((corner) => partOf(cornerHtml[corner], "bracket")?.attrs.d ?? "");
ok(brackets.every((d) => d.length > 0), "every corner draws its bracket");
ok(new Set(brackets).size === 4, "all four corners are genuinely different geometry, not one path re-labelled");
for (const [name, html] of ALL_RENDERS) {
  ok(
    !/\stransform="/.test(html),
    `${name}: no transform anywhere in the family — mirroring a corner with scale(-1,1) would mirror the objectBoundingBox gold ramp with it, and §3 allows exactly one warm light source`,
  );
}
ok(cornerHtml.tl.includes('data-snc-corner="tl"'), "a corner states which corner it is");
ok(partOf(cornerHtml.tl, "flourish") !== undefined, "the corner carries a small flourish, not a bare bracket");
ok(partOf(cornerHtml.tl, "diamond") !== undefined, "…and the family's diamond at the join");
ok(
  Number(partOf(cornerHtml.tl, "inner")?.attrs.opacity) < 1,
  "the inner companion line sits under the bracket in weight, so the corner reads as a returned edge rather than as two nested rectangles",
);

/* ========================= <GoldRule /> ================================= */

ok(goldRuleHtml.startsWith("<hr"), "GoldRule renders an <hr>: the fade already exists in the token layer as .snc-gold-rule, and an <hr> is the element that draws it");
ok(goldRuleHtml.includes("snc-gold-rule"), "…carrying the token layer's own fading rule class rather than a second implementation of the same three stops");
ok(!goldRuleHtml.includes("<svg"), "GoldRule draws no vector of its own — observation 7: the refinement that removes something wins");
ok(
  !/export function GoldRule|const GoldRule/.test(componentCode),
  "the ornament family RE-EXPORTS GoldRule from ./gold-text rather than defining a second one: two components with one name would differ in exactly the accessibility default nobody checks",
);
ok(
  /export \{ GoldRule/.test(componentCode),
  "…but it does carry the mark, so a caller can import every ornament from one module",
);
ok(goldRuleHtml.includes('aria-hidden="true"'), "a plain rule is ornament by default, so a page of six of them does not announce six separators");
ok(
  !renderToString(createElement(GoldRule, { decorative: false })).includes("aria-hidden"),
  "…and the rare rule that really divides two sections can say so",
);
ok(
  renderToString(createElement(GoldRule, { className: "mt-8" })).includes("mt-8"),
  "a caller's class is appended, so spacing belongs to the placement and not to the rule",
);
ok(dividerHtml.includes('aria-hidden="true"') && dividerHtml.includes('role="presentation"'), "the ornamental divider is decorative and says so");

/* ========================= <LotusDecoration /> ========================== */

ok(subpaths(partOf(lotusHtml, "petal-outer")?.attrs.d) === 7, "the bloom's outer row is seven petals");
ok(subpaths(partOf(lotusHtml, "petal-inner")?.attrs.d) === 3, "…over a three-petal inner row, which is what gives it depth rather than a flat fan");
ok(subpaths(partOf(lotusHtml, "leaf")?.attrs.d) === 2, "two leaves spring off the stem");
ok(subpaths(partOf(lotusHtml, "sparkle")?.attrs.d) === 4, "four sparkle marks, as in the reference's Source Wisdom box");
ok(partOf(lotusHtml, "stem") !== undefined && partOf(lotusHtml, "calyx") !== undefined, "the bloom has a stem and a calyx");
ok(
  !/M48,60L/.test(partOf(lotusHtml, "stem")?.attrs.d ?? ""),
  "the stem is curved, never a straight line: a straight stem has a zero-width bounding box and an objectBoundingBox gradient would not paint it at all",
);
const lotusOpacity = elementsOf(lotusHtml)[0].attrs.opacity;
ok(Number(lotusOpacity) === 0.55, "the lotus is a watermark at 0.55, not an illustration competing with the quotation it decorates");
ok(
  renderToString(createElement(LotusDecoration, { opacity: 0.3 })).includes('opacity="0.3"'),
  "…and a caller can push it further back",
);

/* ========================== <CelestialRing /> =========================== */

ok(CELESTIAL_SECTORS_DEFAULT === 12, "the wheel divides into the zodiac's twelve by default");
ok(ringHtml.includes('data-snc-sectors="12"'), "…and says so in the markup");
ok(subpaths(partOf(ringHtml, "spokes")?.attrs.d) === 12, "twelve spokes are actually drawn");
ok(
  subpaths(partOf(renderToString(createElement(CelestialRing, { sectors: 8 })), "spokes")?.attrs.d) === 8,
  "a caller asking for eight sectors gets eight spokes",
);
ok(
  subpaths(partOf(ringHtml, "beads")?.attrs.d) === CELESTIAL_BEADS_DEFAULT,
  `the bead ring carries its own prop's count (${CELESTIAL_BEADS_DEFAULT} by default)`,
);
ok(
  subpaths(partOf(renderToString(createElement(CelestialRing, { beads: 24 })), "beads")?.attrs.d) === 24,
  "…and honours a different bead count independently of the sector count",
);
ok(subpaths(partOf(ringHtml, "ticks")?.attrs.d) === 24, "two minor ticks graduate every sector");
for (const part of ["rim", "band", "hub"]) {
  ok(partOf(ringHtml, part) !== undefined, `the wheel has its ${part} circle`);
}

/* 6. It stops two ways, and the material never does. */
const ringClass = elementsOf(ringHtml)[0].attrs.class ?? "";
const floorClass = elementsOf(ringFloorHtml)[0].attrs.class ?? "";
ok(ringClass.includes("spin"), "at HIGH the wheel carries the rotation class");
for (const capabilityTier of ["MID", "LOW"] as const) {
  const html = renderToString(createElement(CelestialRing, { seed: 2, capabilityTier }));
  ok((elementsOf(html)[0].attrs.class ?? "").includes("spin"), `${capabilityTier} still turns`);
}
ok(!floorClass.includes("spin"), "at FLOOR the rotation class is ABSENT — the weakest devices never allocate an animation at all");
ok(
  ringFloorHtml.replace(floorClass, ringClass) === ringHtml,
  "and FLOOR differs from HIGH in that class and NOTHING else: rim, beads, twelve spokes, ticks and hub all render. What FLOOR turns off is motion; the material is never what degrades",
);
ok(
  /@media\s*\(prefers-reduced-motion:\s*reduce\)/.test(styleRules),
  "the stylesheet also stops the wheel under prefers-reduced-motion — the tier is measured ONCE at mount, while the preference is a live media query someone can change without this tree re-rendering",
);
ok(
  /@media[^{]*prefers-reduced-motion[^}]*\{[^}]*animation:\s*none/.test(styleRules.replace(/\s+/g, " ")),
  "…with `animation: none`, not `animation-play-state: paused`: paused holds the layer and freezes the wheel mid-turn, which reads as broken rather than as engraved",
);

/* 7. The rotation is the specified rotation. */
ok(CELESTIAL_ROTATION_DEG_PER_SECOND === 0.15, "the wheel turns at the specified 0.15 deg/s");
ok(CELESTIAL_ROTATION_PERIOD_SECONDS === 2400, "which is one turn every 2400 s, derived rather than retyped");
ok(
  styleRules.includes(`${CELESTIAL_ROTATION_PERIOD_SECONDS}s linear infinite`),
  "the stylesheet's literal duration matches the exported constant — CSS cannot compute it, so the pair is checked here instead of by timing a forty-minute rotation",
);
ok(!/will-change/.test(styleRules), "the wheel does not promote a compositor layer to repaint 0.15 degrees per second");

/* ========================= <TrishulEmblem /> ============================ */

ok(TRISHUL_PARTS.length === 5, "the mark is five named parts");
for (const part of TRISHUL_PARTS) {
  ok(partOf(trishulHtml, part) !== undefined, `the trishul draws its ${part}`);
}
ok(partOf(trishulHtml, "staff")?.attrs.fill === "url(#snc-g-gold)", "the staff is a FILLED taper, not a thick stroke: a stroked vertical line has a zero-width bounding box and would not paint an objectBoundingBox gradient at all");
ok(subpaths(partOf(trishulHtml, "arc")?.attrs.d) === 2, "the surrounding arc is broken top and bottom, where the finial rises and the staff exits");
ok(subpaths(partOf(trishulHtml, "trident")?.attrs.d) === 6, "the trident head is six pieces: two long outer tines, two short inner ones, and two wing sweeps");
ok(
  partOf(trishulHtml, "trident")?.attrs.fill === "url(#snc-g-gold)",
  "the head is FILLED metal, not hairline curves: a 1px line has no mass, and the first version of this mark read as a dagger with a red bead because the tines beside a filled staff simply disappeared",
);
ok(subpaths(partOf(trishulHtml, "diamond")?.attrs.d) === 2, "the finial is a lozenge with a small ball above it");
ok(
  partOf(trishulHtml, "ruby")?.attrs.filter === "url(#snc-f-emboss)",
  "the ruby is PRESSED IN: the shared emboss is a tiny downward warm shadow, which is what seats a cabochon into metal instead of sticking it on top",
);
ok(
  trishulHtml.includes('fill="var(--color-snc-ink-red)"'),
  "the stone is the palette's own ink-red — the only non-gold paint in the entire ornament family",
);
ok(count(trishulHtml, "var(--color-snc-ink-red)") === 1, "…and it appears exactly once; nothing else in the family is red");

/* ====================== 8. THE SEEDS ARE SEEDS ========================== */

const stable: ReadonlyArray<readonly [string, string, string, string]> = [
  ["OrnamentalDivider", dividerHtml, renderToString(createElement(OrnamentalDivider, { seed: 3 })), renderToString(createElement(OrnamentalDivider, { seed: 4 }))],
  ["AncientCorner", cornerHtml.tl, renderToString(createElement(AncientCorner, { corner: "tl", seed: 5 })), renderToString(createElement(AncientCorner, { corner: "tl", seed: 6 }))],
  ["LotusDecoration", lotusHtml, renderToString(createElement(LotusDecoration, { seed: 9 })), renderToString(createElement(LotusDecoration, { seed: 10 }))],
  ["CelestialRing", ringHtml, renderToString(createElement(CelestialRing, { seed: 2 })), renderToString(createElement(CelestialRing, { seed: 3 }))],
  ["TrishulEmblem", trishulHtml, renderToString(createElement(TrishulEmblem, { seed: 4 })), renderToString(createElement(TrishulEmblem, { seed: 5 }))],
];
for (const [name, first, again, other] of stable) {
  ok(first === again, `${name}: the same seed renders byte-identical markup — this is what lets a hand-wavered engraving survive hydration instead of re-cutting itself on every load`);
  ok(first !== other, `${name}: a different seed renders a different engraving, or four corners of one box are one cut printed four times`);
}

/* ==================== the family is free to ship ======================== */

ok(
  !/^\s*["']use client["']/m.test(componentSource),
  "the whole family is server components: six pure-SVG marks must cost zero client JavaScript, and the one that MOVES moves by CSS animation precisely so it can stay on the server",
);
ok(
  !/useState|useEffect|useRef|requestAnimationFrame/.test(componentCode),
  "…and nothing in the file reaches for state, an effect or a frame loop",
);
for (const [name, html] of ALL_RENDERS) {
  if (!html.startsWith("<svg")) continue;
  ok(html.includes('aria-hidden="true"'), `${name}: the ornament is decorative and hidden from assistive technology`);
  ok(html.includes('focusable="false"'), `${name}: …and cannot be tabbed into, which old engines otherwise allow for svg`);
}

console.log(`MATERIAL ORNAMENTS ASSERTIONS PASSED (${assertions})`);
