/* ============================================================================
 * MATERIAL WAX SEAL — the lobed blob, the pressed emblem, and the 200 ms press
 *
 * WHAT IS PINNED, AND WHY EACH PIN EXISTS.
 *
 * 1. THE SEAL IS NOT A RED CIRCLE. This is the whole component. A blob of wax
 *    is irregular because it was poured and struck, and the fastest way for
 *    that to rot back into a logo is for someone to "simplify" the outline into
 *    a circle, an ellipse, or a border-radius — none of which would look broken
 *    in review. So the radii are read back OUT of the generated path data and
 *    asserted to differ, to differ by a visible amount, and to stay inside the
 *    published jitter; the angular gaps are asserted to differ too, because
 *    evenly spaced lobes read as a cog; and the markup is asserted to contain
 *    no <circle> at all.
 *
 * 2. THE SAME SEED IS THE SAME SEAL, FOREVER. The shape is server-rendered.
 *    Any drift between the server's string and the browser's — a `Math.random`,
 *    an unrounded coordinate, a float that differs in its last bits between V8
 *    and JavaScriptCore — costs a hydration mismatch and a seal that re-pours
 *    itself on every navigation. Determinism is asserted across seeds, and
 *    difference across seeds is asserted with it: a seed that changes nothing
 *    is the same bug wearing a prop.
 *
 * 3. THE EMBLEM IS PRESSED IN, NOT PRINTED ON. That reading is produced by
 *    exactly two things — a face DARKER than the wax around it and a hairline
 *    of LIT wax offset down and to the right, agreeing with the one warm source
 *    above and to the left. Both halves are asserted to exist, and the offset
 *    is asserted to be positive on both axes; flip either and the emblem lifts
 *    off the surface and becomes a sticker.
 *
 * 4. FLOOR AND REDUCED MOTION STOP THE MOTION AND NOTHING ELSE. `pressed`
 *    without the FLOOR tier animates; FLOOR does not; and the stylesheet
 *    removes the animation a second time under `prefers-reduced-motion`, where
 *    it is true before a line of JavaScript has run. What is NOT allowed is the
 *    material degrading: no tier removes the wax, the sheen, the rim or the
 *    emboss, so the FLOOR markup is asserted to differ from the animated markup
 *    in the animation class and in nothing else.
 *
 * 5. THE SEAL INTRODUCES NO COLOUR. The wax fill is the shared `#snc-g-wax`
 *    and nothing else — one pot for every seal in the product — and neither the
 *    component nor its stylesheet may contain a hex or an rgb(). The measured
 *    ramp #9E2925/#7D1F1B/#5E1715 was NOT re-declared here; that decision is
 *    pinned by asserting those literals are absent, because re-adding one is
 *    exactly the tidy-up that would fork the material in two.
 *
 * 6. THE CLASS NAMES ARE REAL. CSS Modules resolve a missing class to
 *    `undefined` silently, so every class token in the rendered markup is
 *    checked against a selector that actually exists in the stylesheet.
 *
 * HOW THIS RUNS WITHOUT A BUNDLER. The component imports a CSS module, and
 * node cannot load one — so a synchronous loader hook (node:module, no
 * dependency) answers any `.css` request with a Proxy that returns each class
 * name as itself. That is precisely what CSS Modules does minus the hash, which
 * makes assertions about WHICH class was applied readable, and it is the reason
 * the component is required after the hook is registered rather than imported
 * at the top.
 * ========================================================================== */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as nodeModule from "node:module";
import path from "node:path";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { SNC_GRADIENT_WAX, defUrl } from "../components/sanctuary/material/ids";
import type { CapabilityTier } from "../components/sanctuary/use-capability-tier";

let assertions = 0;
const ok = (condition: boolean, message: string): void => {
  assert.ok(condition, message);
  assertions += 1;
};

/* ----------------------- the CSS-module loader shim ----------------------- */

/** What a synchronous `load` hook hands back. `source` is left `unknown` so a pass-through to the real loader is not misdescribed. */
interface LoadResult {
  readonly format: string;
  readonly shortCircuit?: boolean;
  readonly source?: unknown;
}

type NextLoad = (url: string, context: unknown) => LoadResult;

/** `module.registerHooks` is Node 22.15+/23.5+ and is not in @types/node@20, so its shape is declared here rather than asserted with `any`. */
type HookRegistrar = (hooks: { load(url: string, context: unknown, nextLoad: NextLoad): LoadResult }) => void;

const registerHooks = (nodeModule as unknown as { readonly registerHooks?: HookRegistrar }).registerHooks;
ok(typeof registerHooks === "function", "node exposes synchronous module hooks, which is how a CSS module is loadable outside a bundler");

registerHooks!({
  load(url, context, nextLoad) {
    if (!url.endsWith(".css")) return nextLoad(url, context);
    /* An explicit ES-module shape, not a bare Proxy: a Proxy that answers every string key would
     * also answer `__esModule` truthily, and the transpiler's interop would then hand the component
     * the string "default" instead of the class map. */
    return {
      format: "commonjs",
      shortCircuit: true,
      source:
        'const classes = new Proxy({}, { get: (_t, key) => (typeof key === "string" ? key : undefined) });' +
        "module.exports = { __esModule: true, default: classes };",
    };
  },
});

const COMPONENT_PATH = "../components/sanctuary/material/wax-seal";
type WaxSealModule = typeof import("../components/sanctuary/material/wax-seal");
const seal = nodeModule.createRequire(__filename)(COMPONENT_PATH) as WaxSealModule;

const {
  WAX_SEAL_BASE_RADIUS,
  WAX_SEAL_LOBE_MAX,
  WAX_SEAL_LOBE_MIN,
  WAX_SEAL_PRESS_DURATION_MS,
  WAX_SEAL_RADIUS_JITTER,
  WAX_SEAL_VIEWBOX,
  WaxSeal,
  waxEmblemGeometry,
  waxSealPath,
} = seal;

const CENTRE = WAX_SEAL_VIEWBOX / 2;
const SOURCE_DIR = path.resolve(__dirname, "..", "components", "sanctuary", "material");
const componentSource = readFileSync(path.join(SOURCE_DIR, "wax-seal.tsx"), "utf8");
const styleSource = readFileSync(path.join(SOURCE_DIR, "wax-seal.module.css"), "utf8");

/**
 * Both files with their block comments removed.
 *
 * Every assertion about what a file DECLARES reads these rather than the raw text, for two reasons
 * pointing opposite ways: a commented-out rule must not be able to satisfy a pin, and the long
 * comment explaining why the measured wax literals were NOT re-declared must not itself be read as
 * declaring them.
 */
const strip = (source: string): string => source.replace(/\/\*[\s\S]*?\*\//g, "");
const styleRules = strip(styleSource);
const componentCode = strip(componentSource);

/** How many times a literal substring occurs — the only honest way to ask "exactly once". */
const count = (haystack: string, needle: string): number => haystack.split(needle).length - 1;

/* ------------------------------ path readers ------------------------------ */

/** Every on-curve point of a closed spline: the endpoint of each cubic segment, in order. */
function curveEndpoints(d: string): ReadonlyArray<{ x: number; y: number }> {
  const segment = /C (-?[\d.]+) (-?[\d.]+) (-?[\d.]+) (-?[\d.]+) (-?[\d.]+) (-?[\d.]+)/g;
  return [...d.matchAll(segment)].map((m) => ({ x: Number(m[5]), y: Number(m[6]) }));
}

/** Distance of a point from the centre of the box — the radius a lobe was actually drawn at. */
const radiusOf = (point: { x: number; y: number }): number => Math.hypot(point.x - CENTRE, point.y - CENTRE);

/** Every coordinate pair in a path, whatever command produced it. Used to prove an emblem stays inside its own wax. */
function allPoints(d: string): ReadonlyArray<{ x: number; y: number }> {
  const numbers = [...d.matchAll(/-?\d+(?:\.\d+)?/g)].map((m) => Number(m[0]));
  const points: { x: number; y: number }[] = [];
  for (let i = 0; i + 1 < numbers.length; i += 2) points.push({ x: numbers[i], y: numbers[i + 1] });
  return points;
}

/* ===================== 1. the seal is not a red circle ===================== */

const SEEDS = [0, 1, 7, 42, 1234, -9, 90210];

for (const seed of SEEDS) {
  const d = waxSealPath(seed);
  const lobes = curveEndpoints(d);

  ok(
    lobes.length >= WAX_SEAL_LOBE_MIN && lobes.length <= WAX_SEAL_LOBE_MAX,
    `seed ${seed} pours ${WAX_SEAL_LOBE_MIN}-${WAX_SEAL_LOBE_MAX} lobes — fewer reads as a polygon, more smooths back into a circle`,
  );
  ok(d.startsWith("M ") && d.endsWith(" Z"), `seed ${seed} produces a CLOSED outline — an open blob leaks its fill`);
  ok(!/NaN|Infinity|undefined/.test(d), `seed ${seed} produces finite path data, so a bad seed can never poison the outline`);

  const radii = lobes.map(radiusOf);
  ok(new Set(radii.map((r) => r.toFixed(2))).size > 1, `seed ${seed}: the lobe radii are NOT all equal — this is the pin that the seal is not a circle`);
  ok(
    Math.max(...radii) - Math.min(...radii) > 1,
    `seed ${seed}: the radii differ by more than a rounding artefact, so the irregularity is visible rather than theoretical`,
  );
  ok(
    radii.every((r) => r >= WAX_SEAL_BASE_RADIUS - WAX_SEAL_RADIUS_JITTER - 0.01 && r <= WAX_SEAL_BASE_RADIUS + WAX_SEAL_RADIUS_JITTER + 0.01),
    `seed ${seed}: every lobe stays inside the published jitter — beyond it a seal reads as a splat and can be clipped by its own box`,
  );

  /* Angles, not just radii: lobes at perfectly even angles read as a cog even when their radii vary. */
  const gaps = lobes.map((point, i) => {
    const next = lobes[(i + 1) % lobes.length];
    const raw = Math.atan2(next.y - CENTRE, next.x - CENTRE) - Math.atan2(point.y - CENTRE, point.x - CENTRE);
    return (raw + Math.PI * 2) % (Math.PI * 2);
  });
  ok(new Set(gaps.map((g) => g.toFixed(3))).size > 1, `seed ${seed}: the lobes are unevenly spaced, so the blob is asymmetric rather than a rosette`);
  ok(gaps.every((g) => g > 0.05), `seed ${seed}: no two lobes cross, which would fold the outline over itself`);
}

/* ================== 2. the same seed is the same seal ===================== */

ok(waxSealPath(7) === waxSealPath(7), "the same seed pours the same wax — this is what lets an irregular shape be server-rendered at all");
ok(waxSealPath(7) !== waxSealPath(8), "a different seed pours different wax, or every seal on a page is the same seal");
ok(new Set(SEEDS.map((s) => waxSealPath(s))).size === SEEDS.length, "seven seeds give seven distinct outlines");
ok(
  new Set(SEEDS.map((s) => curveEndpoints(waxSealPath(s)).length)).size > 1,
  "the LOBE COUNT is drawn from the seed too, not fixed — otherwise every seal shares one silhouette at different radii",
);
ok(waxSealPath(7.6) === waxSealPath(7), "a fractional seed truncates rather than becoming a third seal nobody expected");
ok(!/NaN/.test(waxSealPath(Number.NaN)), "a NaN seed — an upstream parse that failed — still pours a seal instead of poisoning the path");
ok(/^-?[\d.]+$/.test(curveEndpoints(waxSealPath(3))[0].x.toFixed(2)), "coordinates are plain decimals, not exponentials, so the string is stable across engines");
ok(!/\d\.\d{3,}/.test(waxSealPath(3)), "coordinates are rounded to two decimals, so the last bits of a Math.cos cannot differ between the server and the browser");

/* ==================== 3. three emblems, drawn not traced =================== */

const EMBLEMS = ["palm", "lotus", "trishul"] as const;
const geometry = EMBLEMS.map((emblem) => waxEmblemGeometry(emblem));
const serialised = geometry.map((g) => JSON.stringify(g));

ok(new Set(serialised).size === EMBLEMS.length, "the three emblems are three genuinely different sets of geometry, not one shape re-labelled");
for (let i = 0; i < EMBLEMS.length; i += 1) {
  const { strokes, fills } = geometry[i];
  const marks = [...strokes, ...fills];
  ok(marks.length >= 5, `${EMBLEMS[i]} is drawn from at least five marks — a one-path emblem is a bullet, not an engraving`);
  ok(marks.every((d) => d.startsWith("M ")), `${EMBLEMS[i]} states an absolute start for every mark, so no mark depends on the one before it`);
  ok(marks.every((d) => !/NaN|Infinity/.test(d)), `${EMBLEMS[i]} carries no non-finite coordinate`);
  ok(fills.every((d) => d.trim().endsWith("Z")), `${EMBLEMS[i]}'s solid areas are closed paths — an open path filled is a rendering accident`);
  ok(
    marks.flatMap((d) => allPoints(d)).every((point) => radiusOf(point) < WAX_SEAL_BASE_RADIUS - WAX_SEAL_RADIUS_JITTER),
    `${EMBLEMS[i]} fits inside the SMALLEST lobe any seed can pour, so it can never run off the edge of its own wax`,
  );
}
ok(waxEmblemGeometry("trishul").fills.length >= 1, "the trishul's diamond is a solid pressed area, which is also what proves the fill path is wired");
ok(
  new Set(geometry.flatMap((g) => g.strokes)).size === geometry.reduce((total, g) => total + g.strokes.length, 0),
  "no two emblems share a single stroke — a shared path would mean one emblem was drawn by editing another",
);

/* ========================= 4. the press, and FLOOR ========================= */

const render = (props: Partial<Parameters<typeof WaxSeal>[0]> = {}): string =>
  renderToString(createElement(WaxSeal, { size: 96, emblem: "palm", seed: 7, ...props }));

const animated = render({ pressed: true });
const still = render({ pressed: false });
const floor = render({ pressed: true, capability: "FLOOR" });

ok(/class="[^"]*\bseal\b[^"]*"/.test(animated), "every seal carries the material class that owns its warm shadow and its wax custom properties");
ok(/class="[^"]*\bpressed\b[^"]*"/.test(animated), "pressed=true stamps the 200 ms squash on");
ok(!/\bpressed\b/.test(still), "pressed=false renders the seal already stamped — a seal that was always there was not just pressed");
ok(!/\bpressed\b/.test(floor), "FLOOR never animates, whatever the caller asked for");

for (const capability of ["LOW", "MID", "HIGH"] satisfies CapabilityTier[]) {
  ok(/\bpressed\b/.test(render({ pressed: true, capability })), `${capability} still presses — FLOOR is the only tier that takes motion away`);
}

ok(
  floor.replace(/ pressed/g, "") === animated.replace(/ pressed/g, ""),
  "FLOOR differs from the animated seal in the animation class and NOTHING else: what a tier removes is motion, never material",
);
ok(render({ pressed: true }) === animated, "the same props render the same markup, so nothing in the seal is time- or random-dependent");
ok(render({ seed: 8, pressed: true }) !== animated, "a different seed renders a different seal");

/* =================== 3. the emboss, both halves of it ===================== */

ok(count(animated, 'class="pressLip"') === 1, "the LIT half of the emboss is rendered — the hairline of wax on the far wall of the groove");
ok(count(animated, 'class="pressInk"') === 1, "the DARK half of the emboss is rendered — the face pressed below the surface of the wax");

const lipOffset = /class="pressLip" transform="translate\((-?[\d.]+) (-?[\d.]+)\)"/.exec(animated);
ok(lipOffset !== null, "the lit half is offset from the dark half; without an offset there is no emboss, only a recoloured emblem");
ok(
  Number(lipOffset![1]) > 0 && Number(lipOffset![2]) > 0,
  "the lit hairline falls DOWN and RIGHT — the wall facing away from the one warm source above and to the left. Reverse it and the emblem lifts off the wax",
);
ok(Number(lipOffset![1]) <= 2, "the offset is about one device pixel at the size a seal is stamped; a measurable one is a bevel");
ok(
  animated.indexOf('class="pressLip"') < animated.indexOf('class="pressInk"'),
  "the lit copy is painted UNDER the dark one, so all that survives is the hairline rather than a doubled emblem",
);
ok(
  styleRules.includes("--snc-wax-press-ink: color-mix(in oklab, var(--color-snc-ink-red) 50%, var(--color-snc-stone-900))"),
  "the pressed face is mixed DARKER than the wax it sits in — the definition of pressed in",
);
ok(
  styleRules.includes("--snc-wax-press-lip: color-mix(in oklab, var(--color-snc-ink-red) 60%, var(--color-snc-flame-warm))"),
  "and the lip is mixed lighter AND warmer, because the light in that groove is a candle and not a white",
);

/* ================= 5. one pot of wax, no colour of its own ================= */

ok(animated.includes(`fill="${defUrl(SNC_GRADIENT_WAX)}"`), "the wax fills from the shared #snc-g-wax, so every seal in the product is poured from one pot");
ok(!/#[0-9a-fA-F]{3,8}\b/.test(animated.replace(/url\(#[^)]*\)/g, "")), "the rendered seal contains no hex literal outside its own url(#…) references");
ok(!/\brgba?\(/.test(animated), "and no rgb()/rgba() either");
ok(!/#[0-9a-fA-F]{3,8}\b/.test(componentCode), "the component source contains no colour literal");
ok(!/#[0-9a-fA-F]{3,8}\b/.test(styleRules), "the stylesheet contains no colour literal either");
for (const measured of ["9E2925", "7D1F1B", "5E1715"]) {
  ok(
    !componentCode.includes(measured) && !styleRules.includes(measured),
    `the measured wax stop #${measured} was NOT re-declared here — it already exists as token mixes inside #snc-g-wax, and a second definition forks the material in two`,
  );
}
ok(count(styleRules, "var(--color-snc-") >= 6, "every colour the stylesheet does declare is mixed from --color-snc-* tokens");

/* ===================== 1. no circle, and no radius ======================== */

ok(!animated.includes("<circle"), "there is no <circle> anywhere in a seal — the shape is the point");
ok(!/border-radius/.test(styleRules), "and no border-radius in the stylesheet: a seal is a lobed path, and a radius here would make it a red dot");
ok(!/border-radius/.test(componentCode), "nor one hidden in an inline style");
ok(count(animated, waxSealPath(7)) === 2, "the clip path and the wax are the SAME outline, so the sheen is bitten off by exactly the rim the wax has");

/* ========================== the specular crown ============================ */

const sheen = /<ellipse[^>]*>/.exec(animated);
ok(sheen !== null, "the seal carries a specular highlight");
ok(
  Number(/cx="(-?[\d.]+)"/.exec(sheen![0])![1]) < CENTRE && Number(/cy="(-?[\d.]+)"/.exec(sheen![0])![1]) < CENTRE,
  "the highlight sits upper-LEFT, agreeing with the wax gradient's own focus and with the direction the cast shadow falls away from",
);
ok(/clip-path="url\(#snc-wax-[^"]+\)"/.test(animated), "the highlight is clipped to the wax, so a sheen can never escape past the rim");
ok(count(animated, "<defs>") === 1, "the seal's own definitions are in one <defs> — the clip and the sheen, neither of which can live in the shared sprite");
ok(!/<filter/.test(animated), "the seal adds no filter of its own: the highlight is a paint, so a page of seals costs no extra feTurbulence");

/* ===================== the stamped session id (label) ==================== */

const unlabelled = render({ pressed: false });
const labelled = render({ pressed: false, label: "hst-7f3a" });
const longLabel = render({ pressed: false, label: "hst-7f3a-0b19-4c62-ae51" });

ok(unlabelled.includes('aria-hidden="true"') && !unlabelled.includes("<title>"), "an unlabelled seal is decoration and is hidden from assistive technology");
ok(labelled.includes('role="img"') && labelled.includes("<title>hst-7f3a</title>"), "a labelled seal is an image with the stamped id as its accessible name");
ok(!labelled.includes('aria-hidden="true"'), "…and is no longer hidden, or the name would be unreachable");
ok(count(labelled, ">hst-7f3a<") === 3, "the legend is drawn twice — once per half of the emboss — plus once as the accessible title");
ok(!labelled.includes("textLength"), "a short id is set at its natural spacing rather than stretched across the seal like a title");
ok(longLabel.includes('textLength="42"') && longLabel.includes('lengthAdjust="spacingAndGlyphs"'), "a long id is compressed to fit inside the narrowest wax instead of running off it");
ok(labelled !== unlabelled && labelled.includes("scale(0.86)"), "a legend lifts and shrinks the emblem, so the two are not fighting for the middle of the wax");

/* ====================== 6. the class names are real ======================= */

const applied = new Set([...labelled.matchAll(/class="([^"]+)"/g)].flatMap((m) => m[1].split(" ")));
ok(applied.size >= 5, "the seal applies a class per material layer rather than styling by element name");
for (const token of applied) {
  ok(new RegExp(`\\.${token}\\b`).test(styleRules), `.${token} is a real selector in wax-seal.module.css — a CSS Module resolves a typo to undefined in silence`);
}

/* ================= 4. the press, as the stylesheet states it ============== */

ok(styleRules.includes("@keyframes snc-wax-press"), "the press is a one-shot CSS animation, which is why this component needs no JavaScript at all");
ok(/0%\s*\{\s*transform:\s*scale\(0\.9\)/.test(styleRules), "the press starts under-size at 0.9");
ok(/62%\s*\{\s*transform:\s*scale\(1\.02\)/.test(styleRules), "…overshoots by 2% at the moment of impact — a squash, not a spring: one keyframe, fixed, unable to oscillate");
ok(/100%\s*\{\s*transform:\s*scale\(1\)/.test(styleRules), "…and settles at true size");
ok(styleRules.includes(`--snc-wax-press-duration: ${WAX_SEAL_PRESS_DURATION_MS}ms`), "the stylesheet's duration is the exported one, so the two cannot drift apart");
ok(styleRules.includes("var(--snc-ease)"), "the press eases with the sanctuary's own curve rather than a second easing invented here");
ok(styleRules.includes("animation-fill-mode: both"), "the fill mode is both, or the seal shows at full size for one frame before jumping down to 0.9");
ok(styleRules.includes("animation-iteration-count: 1"), "the press happens ONCE — a repeating stamp is a pulse, and nothing in the sanctuary pulses");
ok(
  styleRules.includes("animation-name: snc-wax-press"),
  "the keyframe name is a longhand, not buried in a var()-bearing shorthand a CSS-Modules compiler cannot rewrite — that failure is silent and production-only",
);

const reduced = styleRules.slice(styleRules.indexOf("@media (prefers-reduced-motion: reduce)"));
ok(reduced.length > 0, "the stylesheet answers prefers-reduced-motion");
ok(/animation:\s*none/.test(reduced), "…by removing the animation, before a line of JavaScript has run and whether or not any ever does");
ok(!/display:\s*none|opacity:\s*0/.test(reduced), "…and by removing NOTHING else: reduced motion stops movement, it does not take the seal away");

/* ==================== the warm shadow, and the server ==================== */

const shadow = /filter: drop-shadow\((-?[\d.]+)px (-?[\d.]+)px [\d.]+px [^)]*\)/.exec(styleRules);
ok(shadow !== null, "the seal casts a shadow with drop-shadow, which follows the lobed alpha — a box-shadow would trace the square border box");
ok(Number(shadow![1]) > 0 && Number(shadow![2]) > 0, "the shadow falls DOWN and RIGHT, away from the one warm source above and to the left");
ok(
  styleRules.includes("--snc-wax-shadow-near: color-mix(in oklab, var(--color-snc-ink)") && styleRules.includes("--snc-wax-shadow-far: color-mix(in oklab, var(--color-snc-ink)"),
  "both shadow layers are mixed from the WARM near-black of manuscript ink — a grey shadow under a red seal is the fastest way to look rendered",
);
ok(count(styleRules, "drop-shadow(") === 2, "two layers: a contact shadow that seats the wax on the leaf, and a falloff that gives it height");

ok(
  !/^\s*["']use client["']/m.test(componentSource),
  "the seal is a SERVER component: the press is a CSS class that is a pure function of the props, so there is no state, no effect and no handler to justify shipping this to a device",
);
ok(!componentCode.includes("Math.random"), "nothing in the seal is random — the shape comes from the seed, or the server and the browser would disagree about it");

console.log(`MATERIAL WAX SEAL ASSERTIONS PASSED (${assertions})`);
