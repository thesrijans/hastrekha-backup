/* ============================================================================
 * SANCTUARY TOKENS — the design layer, pinned to the spec that produced it
 *
 * WHAT IS PINNED, AND WHY EACH PIN EXISTS.
 *
 * 1. THE COLOUR TABLE, TRIPLE-ANCHORED. The fifteen §3 colours are hard-coded
 *    below, then checked in both directions: every one must appear in
 *    app/sanctuary.css with that exact value, AND the §3 block of
 *    docs/specs/ui-sanctuary-spec.md must still say the same thing. A token
 *    nudged "just a shade" in either file fails here. The reverse direction is
 *    pinned too — the set of --color-snc-* tokens must be EXACTLY these fifteen
 *    — because the standing instruction on this layer was to invent no colour,
 *    and a sixteenth gold is exactly how a one-warm-light scene stops being one.
 *
 * 2. THE COLLISION THAT FORCED THE PREFIX. globals.css already defines
 *    --color-ink as #eaf2f4, a near-white used as body text by a hundred-odd
 *    existing utilities. The sanctuary's ink is #2A1E12, near-black manuscript
 *    ink. Same word, opposite colour. If those two ever end up sharing a
 *    variable name, the existing product silently repaints itself — so this
 *    asserts the disjointness of the two name sets as a set operation, not as a
 *    spot check, and asserts both inks by value so the direction of the danger
 *    stays visible to whoever reads this next.
 *
 * 3. SOLID STROKES, NEVER DASHED. The spec's linework rule has no dashed rung.
 *    This app also ships a dash-driven draw-on animation (.hr-draw) in
 *    globals.css, and stroke properties inherit — so "we just never write a
 *    dash" is not a guarantee, it is a hope. Both stroke utilities must
 *    re-assert `stroke-dasharray: none`, and no other dasharray value may
 *    appear anywhere in the file.
 *
 * 4. @theme static, NOT @theme. Measured against tailwindcss 4.3.3: a plain
 *    @theme block emits only the variables some generated utility references,
 *    so --snc-ease and friends — read from inline styles and motion values the
 *    compiler cannot scan — would never reach :root at all. The `static` flag
 *    is what makes this layer readable via var(). It is parsed per block, which
 *    is why globals.css keeps its own default pruning; that block must NOT gain
 *    the flag, and that is asserted too.
 *
 * 5. THE SCALARS. Stroke ladder, easing, durations, parallax clamps, flicker
 *    range, dust drift — each by value, plus the relations that catch a
 *    transposition a value-only check would wave through (fast < slow, mobile
 *    clamp tighter than desktop, and the flicker periods actually being
 *    1000 / Hz of the frequency bounds, which cross over).
 *
 * 6. THE WIRING. globals.css must import the new file exactly once, before any
 *    rule (CSS requires it) and after Tailwind itself, and must still contain
 *    no other imports — the whole permitted change to that file was one line.
 * ========================================================================== */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

let assertions = 0;
const ok = (condition: boolean, message: string): void => {
  assert.ok(condition, message);
  assertions += 1;
};

const ROOT = path.resolve(__dirname, "..");
const SANCTUARY = path.join(ROOT, "app", "sanctuary.css");
const GLOBALS = path.join(ROOT, "app", "globals.css");
const SPEC = path.join(ROOT, "docs", "specs", "ui-sanctuary-spec.md");

/* --------------------------------- helpers -------------------------------- */

/** Comments legitimately quote token values, so they must go before parsing. */
const stripComments = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, "");

/**
 * Whitespace and hex case are not meaning in CSS: `#0A0806` and `#0a0806` are
 * the same colour, and `cubic-bezier(.16, 1, .3, 1)` is the spec's
 * `cubic-bezier(.16,1,.3,1)`. Everything else — every digit — must match.
 */
const dense = (value: string): string => value.replace(/\s+/g, "").toLowerCase();

/** Body of the brace-delimited block that follows `from`, brace-counted. */
const blockAfter = (css: string, from: number): string => {
  const open = css.indexOf("{", from);
  assert.ok(open !== -1, "expected a block to follow");
  let depth = 0;
  for (let i = open; i < css.length; i += 1) {
    if (css[i] === "{") depth += 1;
    else if (css[i] === "}") {
      depth -= 1;
      if (depth === 0) return css.slice(open + 1, i);
    }
  }
  throw new Error("unbalanced braces while reading a block");
};

/** Custom-property declarations, in source order, duplicates preserved. */
const declarations = (css: string): ReadonlyArray<readonly [string, string]> => {
  const found: Array<readonly [string, string]> = [];
  const pattern = /(--[a-zA-Z0-9-]+)\s*:\s*([^;]+);/g;
  let match: RegExpExecArray | null = pattern.exec(css);
  while (match !== null) {
    found.push([match[1], match[2].trim()] as const);
    match = pattern.exec(css);
  }
  return found;
};

/** Declaration bodies of the rule whose selector is exactly `selector`. */
const ruleBody = (css: string, selector: string): string => {
  const at = css.indexOf(`${selector} {`);
  assert.ok(at !== -1, `expected a rule for ${selector}`);
  return blockAfter(css, at);
};

/* ------------------------------ the §3 table ------------------------------ */
/* Hard-coded from docs/specs/ui-sanctuary-spec.md §3. Left column is the name
 * the spec uses; the CSS name is that name under the `snc-` prefix. */
const SPEC_COLOURS: ReadonlyArray<readonly [string, string]> = [
  ["stone-900", "#0A0806"],
  ["stone-800", "#0D0B09"],
  ["stone-700", "#16120D"],
  ["obsidian", "#1C1712"],
  ["gold-400", "#E8C56A"],
  ["gold-500", "#C9A24B"],
  ["gold-600", "#8A6A2A"],
  ["gold-dust", "rgba(201,162,75,0.12)"],
  ["parchment", "#D9C39A"],
  ["parch-edge", "#B8A075"],
  ["ink", "#2A1E12"],
  ["ink-red", "#8B1E1E"],
  ["moon", "#2B3A52"],
  ["flame", "#FFB347"],
  ["flame-warm", "#E08A2E"],
];

/* The nine --color-* names globals.css owned before this layer existed. */
const EXISTING_COLOUR_NAMES: ReadonlyArray<string> = [
  "--color-night",
  "--color-surface",
  "--color-line-glow",
  "--color-mount-glow",
  "--color-ink",
  "--color-muted",
  "--color-hairline",
  "--color-background",
  "--color-foreground",
];

/* ------------------------------- load & parse ----------------------------- */

ok(existsSync(SANCTUARY), "app/sanctuary.css exists");
ok(existsSync(GLOBALS), "app/globals.css exists");
ok(existsSync(SPEC), "the governing spec is still where the tokens were quoted from");

const sanctuaryRaw = readFileSync(SANCTUARY, "utf8");
const globalsRaw = readFileSync(GLOBALS, "utf8");
const specRaw = readFileSync(SPEC, "utf8");

const sanctuaryCss = stripComments(sanctuaryRaw);
const globalsCss = stripComments(globalsRaw);
const specDense = dense(specRaw);

/* --------------------------- 4. the @theme block -------------------------- */

const themeMatches: ReadonlyArray<string> = sanctuaryCss.match(/@theme\b[^{]*/g) ?? [];
ok(themeMatches.length === 1, "sanctuary.css declares exactly one @theme block");
ok(
  /^@theme\s+static\s*$/.test(themeMatches[0]),
  "the sanctuary @theme is `static`, or Tailwind prunes every variable no utility happens to reference",
);

const themeStart = sanctuaryCss.indexOf("@theme");
const themeBody = blockAfter(sanctuaryCss, themeStart);
const themeDecls = declarations(themeBody);
const themeNames = themeDecls.map(([name]) => name);
const theme = new Map<string, string>(themeDecls);

ok(theme.size === themeDecls.length, "no token is declared twice in the sanctuary @theme");

const allSanctuaryDecls = declarations(sanctuaryCss);
ok(
  allSanctuaryDecls.length === themeDecls.length,
  "every custom property in sanctuary.css lives in the one @theme block, so there is a single source of truth",
);
for (const [name] of allSanctuaryDecls) {
  ok(
    name.startsWith("--color-snc-") || name.startsWith("--snc-"),
    `${name} carries the snc- prefix (an unprefixed token is how this layer would leak into the existing palette)`,
  );
}

/* ---------------------- 1. the colour table, both ways -------------------- */

for (const [specName, specValue] of SPEC_COLOURS) {
  const cssName = `--color-snc-${specName}`;
  const declared = theme.get(cssName);
  ok(declared !== undefined, `${cssName} is declared`);
  ok(
    declared !== undefined && dense(declared) === dense(specValue),
    `${cssName} is ${specValue} exactly as §3 states, not ${String(declared)}`,
  );
  ok(
    specDense.includes(dense(`--${specName}${specValue}`)),
    `the spec's §3 table still reads --${specName} ${specValue}, so the pin above is pinning the current spec`,
  );
}

const colourNames = themeNames.filter((name) => name.startsWith("--color-"));
ok(
  colourNames.length === SPEC_COLOURS.length,
  `sanctuary.css declares exactly the ${SPEC_COLOURS.length} colours §3 lists and no sixteenth one (found ${colourNames.length})`,
);

/* ------------------- 2. the collision that forced the prefix -------------- */

const globalsThemeBody = blockAfter(globalsCss, globalsCss.indexOf("@theme"));
const globalsDecls = declarations(globalsThemeBody);
const globalsNames = new Set(globalsDecls.map(([name]) => name));
const globalsTheme = new Map<string, string>(globalsDecls);
const globalsColourNames = [...globalsNames].filter((name) => name.startsWith("--color-"));

ok(
  /@theme\s*\{/.test(globalsCss),
  "the globals @theme is still a plain @theme — `static` there would change what that untouched file emits",
);
ok(
  globalsColourNames.length === EXISTING_COLOUR_NAMES.length,
  `globals.css still owns exactly ${EXISTING_COLOUR_NAMES.length} --color-* names (found ${globalsColourNames.length}); a new one needs a look at the disjointness below`,
);
for (const name of EXISTING_COLOUR_NAMES) {
  ok(globalsNames.has(name), `${name} is still declared in globals.css`);
}
for (const name of themeNames) {
  ok(!globalsNames.has(name), `${name} does not collide with an existing globals.css token`);
}

ok(
  dense(globalsTheme.get("--color-ink") ?? "") === "#eaf2f4",
  "globals.css --color-ink is still the near-WHITE instrument text",
);
ok(
  dense(theme.get("--color-snc-ink") ?? "") === "#2a1e12",
  "sanctuary --color-snc-ink is the near-BLACK manuscript ink",
);
ok(
  dense(globalsTheme.get("--color-ink") ?? "") !== dense(theme.get("--color-snc-ink") ?? ""),
  "the two inks are opposite colours, which is the whole reason the prefix exists",
);

/* --------------------------- 5. the stroke ladder ------------------------- */

ok(theme.get("--snc-stroke-secondary-width") === "1px", "secondary stroke is 1px");
ok(theme.get("--snc-stroke-secondary-opacity") === "0.35", "secondary stroke is 0.35 opacity");
ok(theme.get("--snc-stroke-active-width") === "2px", "active stroke is 2px");
ok(theme.get("--snc-stroke-active-opacity") === "1", "active stroke is full opacity");

const glow = theme.get("--snc-stroke-active-glow") ?? "";
ok(glow.length > 0, "the soft outer glow exists as one reusable value");
ok(glow.includes("drop-shadow("), "the glow is a drop-shadow chain, so it follows the stroke alpha and not its bounding box");
ok(
  glow.includes("var(--color-snc-gold-dust)"),
  "the glow is coloured from the gold-dust token rather than a fresh literal",
);
ok(
  !/#[0-9a-fA-F]{3,8}|rgba?\(/.test(glow),
  "the glow introduces no colour of its own — every layer resolves to a §3 token",
);

/* ------------------ 3. solid strokes, never dashed, anywhere -------------- */

for (const selector of [".snc-stroke-secondary", ".snc-stroke-active"] as const) {
  const body = ruleBody(sanctuaryCss, selector);
  ok(/stroke-width\s*:/.test(body), `${selector} sets stroke-width`);
  ok(/stroke-opacity\s*:/.test(body), `${selector} sets stroke-opacity (not opacity, which would fade fills too)`);
  ok(/filter\s*:/.test(body), `${selector} sets filter, so the glow rung is explicit either way`);
  ok(
    /stroke-dasharray\s*:\s*none\s*;/.test(body),
    `${selector} re-asserts stroke-dasharray: none, so an inherited dash pattern cannot reach it`,
  );
}

const dashValues = [...sanctuaryCss.matchAll(/stroke-dasharray\s*:\s*([^;]+);/g)].map((m) => m[1].trim());
ok(dashValues.length === 2, "the only two stroke-dasharray declarations are the two defensive ones");
ok(
  dashValues.every((value) => value === "none"),
  "no stroke-dasharray in this layer has any value but none — solid strokes only, never dashed anywhere",
);
ok(
  !/\b(dashed|dotted)\b/.test(sanctuaryCss),
  "no dashed or dotted border style sneaks the same look back in through a different property",
);

/* ------------------------------- 5. motion -------------------------------- */

ok(
  dense(theme.get("--snc-ease") ?? "") === "cubic-bezier(.16,1,.3,1)",
  "the easing is the spec's cubic-bezier(.16, 1, .3, 1)",
);
ok(
  !/spring|elastic|back\(/i.test(sanctuaryCss),
  "no spring or overshoot token exists to reach for — nothing bounces, nothing springs",
);

const ms = (name: string): number => Number.parseInt((theme.get(name) ?? "").replace("ms", ""), 10);
ok(theme.get("--snc-duration-fast") === "400ms", "fast interface move is 400ms");
ok(theme.get("--snc-duration-slow") === "800ms", "slow interface move is 800ms");
ok(theme.get("--snc-duration-camera-min") === "1200ms", "camera move floor is 1200ms (1.2 s)");
ok(theme.get("--snc-duration-camera-max") === "2000ms", "camera move ceiling is 2000ms (2.0 s)");
ok(ms("--snc-duration-fast") < ms("--snc-duration-slow"), "fast is faster than slow");
ok(
  ms("--snc-duration-slow") < ms("--snc-duration-camera-min"),
  "camera moves are slower than every interface move, which is what makes them read as camera",
);
ok(ms("--snc-duration-camera-min") < ms("--snc-duration-camera-max"), "the camera range is not inverted");

/* ---------------------------- 5. parallax clamps -------------------------- */

ok(theme.get("--snc-parallax-max-desktop") === "12px", "desktop/tablet parallax clamps at 12px");
ok(theme.get("--snc-parallax-max-mobile") === "8px", "mobile tilt parallax clamps at 8px");
ok(
  Number.parseInt((theme.get("--snc-parallax-max-mobile") ?? "").replace("px", ""), 10) <
    Number.parseInt((theme.get("--snc-parallax-max-desktop") ?? "").replace("px", ""), 10),
  "the mobile clamp is the tighter of the two, because tilt supplies far more travel than a pointer",
);

/* ------------------------- 5. candle flicker & dust ----------------------- */

const hzMin = Number(theme.get("--snc-flicker-hz-min"));
const hzMax = Number(theme.get("--snc-flicker-hz-max"));
ok(hzMin === 2, "flicker floor is 2 Hz");
ok(hzMax === 4, "flicker ceiling is 4 Hz");
ok(hzMin < hzMax, "the flicker band is a range, not a single rhythm");
ok(theme.get("--snc-flicker-opacity-delta") === "0.04", "flicker swings 4% of opacity");
ok(ms("--snc-flicker-period-min") === 1000 / hzMax, "the shortest period is 1000 / the fastest Hz");
ok(ms("--snc-flicker-period-max") === 1000 / hzMin, "the longest period is 1000 / the slowest Hz");

ok(theme.get("--snc-dust-drift-px-per-frame") === "0.02", "foreground dust drifts at 0.02 px/frame");
ok(
  !/px|ms|s\b/.test(theme.get("--snc-dust-drift-px-per-frame") ?? ""),
  "the dust drift is unitless — it is a per-frame displacement, not a CSS length",
);
ok(theme.get("--snc-moonlight-max-intensity") === "0.25", "the second light stays at or under 25% intensity");

/* ---------------------------- 6. the one-line wiring ---------------------- */

const globalImports = [...globalsRaw.matchAll(/@import\s+([^;]+);/g)].map((m) => m[1].trim());
const sanctuaryImports = globalImports.filter((spec) => spec.includes("sanctuary.css"));
ok(sanctuaryImports.length === 1, "globals.css imports sanctuary.css exactly once");
ok(sanctuaryImports[0] === '"./sanctuary.css"', "it is imported by relative path, with no layer or media qualifier");
ok(globalImports.length === 2, "globals.css still has only two imports: Tailwind, then this layer");
ok(
  globalImports[0].includes("tailwindcss"),
  "Tailwind is imported first, so the sanctuary @theme resolves against a loaded theme namespace",
);

const firstRule = globalsRaw.search(/^[^@\s][^\n]*\{/m);
const lastImportEnd = globalsRaw.lastIndexOf("@import");
ok(
  firstRule === -1 || lastImportEnd < firstRule,
  "both @import statements precede every rule, as CSS requires",
);

console.log(`SANCTUARY TOKENS ASSERTIONS PASSED (${assertions})`);
