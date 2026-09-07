/* ============================================================================
 * MATERIAL FOUNDATION — the shared defs sprite, the frozen ids, and the PRNG
 * that every irregular shape in the sanctuary is built from
 *
 * WHAT IS PINNED, AND WHY EACH PIN EXISTS.
 *
 * 1. THE SPRITE IS COMPLETE, AND EACH DEFINITION EXISTS EXACTLY ONCE. An SVG
 *    filter reference is a document-global lookup that fails SILENTLY: an
 *    element pointing at a missing `#snc-f-torn` renders unfiltered, with no
 *    error, no warning and no visual clue beyond a panel that looks slightly
 *    too tidy. So every id in ids.ts must appear in the rendered markup, and
 *    appear once — a second copy of a filter is not a cosmetic duplicate but a
 *    second feTurbulence evaluated per frame, which is the one thing §10's LOW
 *    and FLOOR devices cannot afford and the authoring laptop will never show.
 *
 * 2. THE TUNED NUMBERS ARE THE TUNED NUMBERS. baseFrequency 0.02 / 4 octaves
 *    for the tear and 0.8 / 3 for the grain are not defaults; they are the
 *    difference between a torn leaf and pinking shears, and between fibre and
 *    coloured confetti. They are cheap to "clean up" in a refactor and
 *    impossible to notice going wrong in review, so they are asserted in the
 *    markup rather than trusted to a constant nobody re-reads.
 *
 * 3. THE SPRITE COSTS NOTHING AND IS INVISIBLE TO ASSISTIVE TECH. Zero-sized,
 *    out of flow, aria-hidden, not focusable — and deliberately NOT hidden with
 *    `display: none` or `visibility: hidden`, both of which are the obvious way
 *    to hide a defs sprite and both of which have stopped filters resolving in
 *    a shipping engine. That absence is asserted, because it is the kind of
 *    tidy-up a future reader would make on sight.
 *
 * 4. NO COLOUR LIVES IN THE COMPONENT. Every paint in the sprite must resolve
 *    to a --color-snc-* token, so the rendered markup must contain no hex and no
 *    rgb() at all. A literal here would be a colour outside the token layer that
 *    no palette review would ever see.
 *
 * 5. IT IS A SERVER COMPONENT. The file must carry no "use client": this is a
 *    few hundred bytes of static markup, and a directive added by habit would
 *    ship a React component to every device for nothing.
 *
 * 6. THE RANDOMNESS IS NOT RANDOM. Same seed, same sequence — forever, and on
 *    both sides of the wire. This is the property that lets a torn edge be
 *    server-rendered at all: `Math.random()` in a shape means the server HTML
 *    and the hydrated client disagree, React throws the subtree away, and the
 *    leaf visibly re-tears itself on every load. The bound on `seededJitter` is
 *    pinned for the matching reason — consumers reserve padding for exactly that
 *    much travel, and an offset past it is a tear clipped back into a straight
 *    line.
 * ========================================================================== */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { SanctuaryDefs } from "../components/sanctuary/material/sanctuary-defs";
import { seededJitter, seededRandom } from "../components/sanctuary/material/rng";
import {
  SANCTUARY_DEF_IDS,
  SNC_EMBOSS_DY,
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
  SNC_TORN_BLEED_PX,
  SNC_TORN_DISPLACEMENT_SCALE,
  SNC_TORN_OCTAVES,
  SNC_TORN_ROUGH_BLEED_PX,
  SNC_TORN_ROUGH_DISPLACEMENT_SCALE,
  SNC_TORN_ROUGH_TURBULENCE_SEED,
  SNC_TORN_TURBULENCE_SEED,
  defUrl,
} from "../components/sanctuary/material/ids";

let assertions = 0;
const ok = (condition: boolean, message: string): void => {
  assert.ok(condition, message);
  assertions += 1;
};

const html = renderToString(createElement(SanctuaryDefs));

/** How many times a literal substring occurs — the only honest way to ask "exactly once". */
const count = (haystack: string, needle: string): number => haystack.split(needle).length - 1;

/**
 * The markup of the one element carrying `id`, from its opening `<` to its
 * closing tag. Every assertion about a filter's parameters is scoped through
 * this, so "the grain is fractalNoise" cannot be satisfied by some other
 * filter's attribute elsewhere in the sprite.
 */
const defBlock = (id: string): string => {
  const at = html.indexOf(`id="${id}"`);
  assert.ok(at !== -1, `expected the sprite to define #${id}`);
  const open = html.lastIndexOf("<", at);
  const tag = /^<([a-zA-Z]+)/.exec(html.slice(open))?.[1] ?? "";
  assert.ok(tag.length > 0, `expected a tag name before #${id}`);
  const close = html.indexOf(`</${tag}>`, at);
  assert.ok(close !== -1, `expected #${id} to be closed`);
  return html.slice(open, close + tag.length + 3);
};

/** Every value of one attribute inside a block, in source order. */
const attrs = (block: string, name: string): string[] =>
  [...block.matchAll(new RegExp(`${name}="([^"]*)"`, "g"))].map((m) => m[1]);

/* -------------------------- 1. the contract of ids ------------------------ */

const CONTRACT_IDS: ReadonlyArray<string> = [
  "snc-f-torn",
  "snc-f-torn-rough",
  "snc-f-grain",
  "snc-f-emboss",
  "snc-g-gold",
  "snc-g-wax",
  "snc-g-rule",
];

ok(SANCTUARY_DEF_IDS.length === CONTRACT_IDS.length, "the sprite defines exactly the seven shared ids of the contract");
for (const id of CONTRACT_IDS) {
  ok((SANCTUARY_DEF_IDS as readonly string[]).includes(id), `${id} is still spelled exactly as the shared contract froze it`);
}
ok(new Set(SANCTUARY_DEF_IDS).size === SANCTUARY_DEF_IDS.length, "no id is listed twice");
ok(defUrl(SNC_FILTER_TORN) === `url(#${SNC_FILTER_TORN})`, "defUrl produces the url(#…) form, which is the part hand-written references get wrong");

for (const id of SANCTUARY_DEF_IDS) {
  ok(count(html, `id="${id}"`) === 1, `#${id} is defined exactly once — a duplicated filter is a duplicated feTurbulence per frame`);
}

ok(count(html, "<filter") === 4, "the sprite holds the four filters of the contract and no fifth");
ok(count(html, "<linearGradient") === 2, "two linear gradients: the metal ramp and the fading rule");
ok(count(html, "<radialGradient") === 1, "one radial gradient: the wax");
ok(count(html, "<defs>") === 1, "everything is inside one <defs>");

/* ------------------- 2. the tear, at the amplitude it was tuned to -------- */

const torn = defBlock(SNC_FILTER_TORN);
ok(attrs(torn, "type")[0] === "turbulence", "the tear is turbulence noise (fractalNoise would give a soft edge, not a bitten one)");
ok(attrs(torn, "baseFrequency")[0] === String(SNC_TORN_BASE_FREQUENCY), `the tear runs at baseFrequency ${SNC_TORN_BASE_FREQUENCY} — an order of magnitude up is pinking shears`);
ok(attrs(torn, "numOctaves")[0] === String(SNC_TORN_OCTAVES), `the tear is ${SNC_TORN_OCTAVES} octaves`);
ok(attrs(torn, "scale")[0] === String(SNC_TORN_DISPLACEMENT_SCALE), `the tear displaces by ${SNC_TORN_DISPLACEMENT_SCALE}`);
ok(attrs(torn, "seed")[0] === String(SNC_TORN_TURBULENCE_SEED), "the tear states its noise seed, so the same shape is torn in every engine");
ok(torn.includes('in="SourceGraphic"'), "the tear displaces the element itself");
ok(torn.includes('xChannelSelector="R"') && torn.includes('yChannelSelector="G"'), "the two displacement channels are different, or the edge would move diagonally in lockstep");
ok(/x="-\d+%"/.test(torn) && /width="1[0-9][0-9]%"/.test(torn), "the filter region is widened past the element box, or the displaced edge is clipped back into a straight line");

const rough = defBlock(SNC_FILTER_TORN_ROUGH);
ok(attrs(rough, "scale")[0] === String(SNC_TORN_ROUGH_DISPLACEMENT_SCALE), `the rough tear displaces by ${SNC_TORN_ROUGH_DISPLACEMENT_SCALE}`);
ok(attrs(rough, "seed")[0] === String(SNC_TORN_ROUGH_TURBULENCE_SEED), "the rough tear states its own noise seed");
ok(
  attrs(rough, "seed")[0] !== attrs(torn, "seed")[0],
  "the rough tear uses a different noise field, so a rough edge beside a plain one is not the same bite magnified",
);
ok(
  SNC_TORN_BLEED_PX === SNC_TORN_DISPLACEMENT_SCALE / 2 && SNC_TORN_ROUGH_BLEED_PX === SNC_TORN_ROUGH_DISPLACEMENT_SCALE / 2,
  "the published bleed is half the displacement scale, because feDisplacementMap is symmetric about the channel midpoint",
);
ok(SNC_TORN_BLEED_PX === 4, "consumers reserve 4px for a plain tear");

/* ------------------------- 2. the grain, desaturated ---------------------- */

const grain = defBlock(SNC_FILTER_GRAIN);
ok(attrs(grain, "type")[0] === "fractalNoise", "the grain is fractalNoise — turbulence would clump into visible blotches");
ok(attrs(grain, "baseFrequency")[0] === String(SNC_GRAIN_BASE_FREQUENCY), `the grain runs at baseFrequency ${SNC_GRAIN_BASE_FREQUENCY}, just above the pixel`);
ok(attrs(grain, "numOctaves")[0] === String(SNC_GRAIN_OCTAVES), `the grain is ${SNC_GRAIN_OCTAVES} octaves`);
ok(grain.includes("<feColorMatrix"), "the grain is passed through a colour matrix");
ok(
  /type="saturate"[^>]*values="0"/.test(grain),
  "the grain is desaturated to luminance — raw turbulence writes four independent channels and tints the leaf green and violet at 5-8%",
);
ok(
  count(grain, "<feColorMatrix") === 2,
  "a second matrix forces alpha opaque, so the layer's opacity belongs to the consumer rather than to the noise",
);
ok(/x="0%"[^>]*width="100%"/.test(grain), "the grain region is exactly the element box — an overflowing noise field would halo the panel it grains");

/* --------------------------- 2. the pressed emblem ------------------------ */

const emboss = defBlock(SNC_FILTER_EMBOSS);
ok(emboss.includes("<feDropShadow"), "the emboss is one drop shadow, not a lighting filter");
ok(attrs(emboss, "dy")[0] === String(SNC_EMBOSS_DY), "the emboss falls downward, agreeing with the one warm source above the scene");
ok(attrs(emboss, "dx")[0] === "0", "the emboss has no sideways offset — a pressed emblem is pressed straight in");
ok(
  emboss.includes("flood-color:var(--color-snc-stone-900)"),
  "the emboss is the warm near-black of the ground; a grey shadow under a seal is the fastest way to look rendered",
);

/* -------------------------- 4. no colour of its own ----------------------- */

ok(!/#[0-9a-fA-F]{3,8}\b/.test(html), "the sprite contains no hex literal — every paint resolves to a --color-snc-* token");
ok(!/\brgba?\(/.test(html), "the sprite contains no rgb()/rgba() literal either");
ok(count(html, "var(--color-snc-") >= 8, "every stop and flood in the sprite reads a token");

/* ---------------------- 2. the metal, matching the CSS ramp --------------- */

const gold = defBlock(SNC_GRADIENT_GOLD);
const goldStops = attrs(gold, "offset");
ok(goldStops.length === 6, "the metal ramp is the six measured stops");
ok(
  goldStops.join(",") === "0,0.2,0.4,0.6,0.8,1",
  "the six stops are evenly spaced, identical to --snc-gold-metal, so an SVG glyph and a CSS heading are the same alloy",
);
ok(
  count(gold, "stop-color:var(--color-snc-gold-600)") === 2,
  "the ramp begins and ends in the engraved shadow gold, which is what makes a glyph read as a curved surface",
);
ok(gold.includes("stop-color:var(--color-snc-gold-ramp-pale)"), "the crest of the ramp is the pale stop added to the token layer");

const x1 = Number(attrs(gold, "x1")[0]);
const y1 = Number(attrs(gold, "y1")[0]);
const x2 = Number(attrs(gold, "x2")[0]);
const y2 = Number(attrs(gold, "y2")[0]);
const radians = (SNC_GOLD_RAMP_ANGLE_DEG * Math.PI) / 180;
ok(Math.abs(x2 - x1 - Math.sin(radians)) < 1e-3, "the ramp axis runs along the 105° direction horizontally");
ok(Math.abs(y2 - y1 + Math.cos(radians)) < 1e-3, "…and vertically — 105° points right and slightly DOWN, not up");
ok(Math.abs(x1 + x2 - 1) < 1e-3 && Math.abs(y1 + y2 - 1) < 1e-3, "the axis is anchored at the centre of the box, so the highlight lands mid-glyph rather than at a corner");

/* ------------------- 2. the fading rule, as an invariant ------------------ */

const rule = defBlock(SNC_GRADIENT_RULE);
const ruleOpacities = attrs(rule, "style");
ok(ruleOpacities.length === 3, "the rule is three stops");
ok(
  ruleOpacities[0].includes("stop-opacity:0") && ruleOpacities[2].includes("stop-opacity:0"),
  "the rule vanishes at BOTH ends — there is not one solid gold bar anywhere in the references",
);
ok(ruleOpacities[1].includes("stop-opacity:1"), "the rule is brightest at its centre");
ok(
  count(rule, "stop-color:var(--color-snc-gold-400)") === 3,
  "all three stops are the same foil gold, so the fade cannot drift toward another hue on the way out",
);

/* ------------------------------- 2. the wax ------------------------------- */

const wax = defBlock(SNC_GRADIENT_WAX);
ok(Number(attrs(wax, "fx")[0]) < Number(attrs(wax, "cx")[0]), "the wax highlight sits left of centre, where the light is");
ok(Number(attrs(wax, "fy")[0]) < Number(attrs(wax, "cy")[0]), "…and above it");
ok(count(wax, "var(--color-snc-ink-red)") >= 1, "the wax is the palette's ink-red, warmed at the crown and cooled at the rim");

/* ---------------- 3 & 5. inert, invisible, and free to ship --------------- */

ok(html.startsWith("<svg"), "the sprite is one svg element");
ok(html.includes('aria-hidden="true"'), "the sprite is hidden from assistive technology — it describes nothing");
ok(html.includes('focusable="false"'), "and cannot be tabbed into, which old engines otherwise allow for svg");
ok(html.includes('width="0"') && html.includes('height="0"'), "the sprite has no intrinsic size");
ok(/position:\s*absolute/.test(html), "the sprite is out of flow, so it can never move a layout");
ok(/overflow:\s*hidden/.test(html), "and clips anything a definition might otherwise paint");
ok(
  !/display:\s*none/.test(html) && !/visibility:\s*hidden/.test(html),
  "the sprite is NOT hidden with display:none or visibility:hidden — both are the obvious tidy-up and both have stopped filters resolving in a shipping engine",
);

const source = readFileSync(path.resolve(__dirname, "..", "components", "sanctuary", "material", "sanctuary-defs.tsx"), "utf8");
ok(!/^\s*["']use client["']/m.test(source), "the sprite is a server component: static markup must not ship a client bundle");

/* --------------------- 6. the randomness is not random -------------------- */

{
  const first = seededRandom(1);
  const again = seededRandom(1);
  const other = seededRandom(2);
  const a: number[] = [];
  const b: number[] = [];
  const c: number[] = [];
  for (let i = 0; i < 16; i += 1) {
    a.push(first());
    b.push(again());
    c.push(other());
  }
  ok(a.join(",") === b.join(","), "the same seed produces the same sequence — this is what makes a torn edge survive hydration");
  ok(a.join(",") !== c.join(","), "a different seed produces a different sequence, or every leaf in a bundle tears identically");
  ok(a.every((v) => v >= 0 && v < 1), "every draw is in [0, 1) — never 1, so `r() * amplitude` cannot reach the amplitude");
  ok(new Set(a).size === a.length, "sixteen consecutive draws are distinct: the generator advances rather than repeating a constant");
  ok(seededRandom(2.7)() === seededRandom(2)(), "a fractional seed truncates rather than becoming a third stream nobody expected");
  ok(Number.isFinite(seededRandom(Number.NaN)()), "a NaN seed — an upstream parse that failed — still yields a usable number instead of NaN forever");
}

/* --------------------------- 6. jitter, and its bound --------------------- */

{
  const amplitude = 4;
  const offsets = seededJitter(11, 12, amplitude);
  ok(offsets.length === 12, "seededJitter returns one offset per requested point");
  ok(offsets.every((v) => Math.abs(v) <= amplitude), "no offset exceeds the amplitude — consumers reserve exactly this much padding for the tear");
  ok(offsets.some((v) => v > 0) && offsets.some((v) => v < 0), "offsets are signed both ways: a one-sided jitter grows the shape instead of roughening it");
  ok(seededJitter(11, 12, amplitude).join(",") === offsets.join(","), "the same seed gives the same shape, every render, server and client");
  ok(seededJitter(12, 12, amplitude).join(",") !== offsets.join(","), "a different seed gives a different shape");
  ok(seededJitter(11, 0, amplitude).length === 0, "a zero count is an empty array, not a crash during render");
  ok(seededJitter(11, -3, amplitude).length === 0, "a negative count is empty too");
  ok(seededJitter(11, Number.NaN, amplitude).length === 0, "a NaN count is empty rather than an infinite loop");
  ok(
    seededJitter(11, 5, -2).every((v) => v === 0),
    "a negative amplitude degrades to the clean shape rather than inverting it — a decoration must never throw during render",
  );
  ok(seededJitter(11, 5, Number.NaN).every((v) => v === 0), "a NaN amplitude does the same, instead of poisoning a clip-path with NaN");
}

console.log(`MATERIAL FOUNDATION ASSERTIONS PASSED (${assertions})`);
