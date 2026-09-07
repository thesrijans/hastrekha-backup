/* ============================================================================
 * SANCTUARY FONTS — pinning ruling [R1] (spec §4) as source text
 *
 * next/font is a build-time SWC transform: importing lib/sanctuary/fonts.ts
 * outside a Next build throws, so this test reads the module as TEXT and
 * asserts against its literal call sites. That is not a workaround — the call
 * sites ARE the contract, because next/font only accepts literals and refuses
 * anything computed.
 *
 * What is pinned and why:
 *
 *  1. Tiro Devanagari Hindi is `preload: false`. This is THE ruling. Tiro's
 *     devanagari 400 cut measures 62.1 KB; the preloaded set is Cinzel-600
 *     (14.9 KB) + Cormorant variable normal (36.9 KB) = 51.8 KB against a 90 KB
 *     ceiling on new preloaded bytes. Flipping Tiro to preloaded makes it
 *     113.9 KB and breaks the budget the route was granted. The cost of the
 *     ruling — Devanagari swapping a beat late — is accepted in the spec, so a
 *     future agent "fixing" that swap by preloading is the exact regression
 *     this file exists to catch.
 *
 *  2. The preloaded set is Cinzel + Cormorant and NOTHING else — asserted as
 *     counts (exactly two `preload: true`, exactly one `preload: false`) and as
 *     arithmetic against the measured KB figures the module carries as data.
 *
 *  3. Cinzel ships the STATIC 600 cut only (the variable latin cut is 25.3 KB
 *     against 14.9 KB for the one weight the design uses).
 *
 *  4. All three faces expose a `--font-snc-*` variable, so one className can
 *     carry the whole set, and the module never reaches for the root layout —
 *     A1 forbids editing it to reclaim preload budget, and an import is the
 *     first step toward that.
 * ========================================================================== */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

let assertions = 0;
const ok = (condition: boolean, message: string): void => {
  assert.ok(condition, message);
  assertions += 1;
};

const SOURCE_PATH = path.resolve(__dirname, "..", "lib", "sanctuary", "fonts.ts");
const source = readFileSync(SOURCE_PATH, "utf8");

/* ------------------------------ Text helpers ------------------------------ */

/** Slice one next/font call site — `Font_Name({ ... });` — out of the source. */
function callSite(fontFunction: string): string {
  const start = source.indexOf(`${fontFunction}({`);
  ok(start !== -1, `${fontFunction} is called at module scope (next/font requires a literal call site)`);
  const end = source.indexOf("});", start);
  ok(end !== -1, `${fontFunction}'s call site is closed`);
  return source.slice(start, end + 3);
}

/**
 * Occurrence count within the three call sites only — never the whole file. The
 * JSDoc argues about `preload: false` in prose, and prose must not be able to
 * satisfy (or break) a count that is about declarations.
 */
function count(pattern: RegExp): number {
  return [...callSites.matchAll(pattern)].length;
}

/** Read one numeric literal out of SANCTUARY_FONT_BUDGET_KB by key. */
function budget(key: string): number {
  const match = source.match(new RegExp(`${key}:\\s*([0-9.]+)`));
  ok(match !== null, `SANCTUARY_FONT_BUDGET_KB declares ${key}`);
  return Number(match?.[1]);
}

/** The quoted family names of one SANCTUARY_FONT_FALLBACKS role. */
function fallbackStack(role: string): string[] {
  const match = source.match(new RegExp(`${role}:\\s*\\[([^\\]]*)\\]`));
  ok(match !== null, `SANCTUARY_FONT_FALLBACKS declares the ${role} role`);
  return [...(match?.[1] ?? "").matchAll(/"([^"]+)"/g)].map((entry) => entry[1]);
}

const cinzel = callSite("Cinzel");
const cormorant = callSite("Cormorant_Garamond");
const tiro = callSite("Tiro_Devanagari_Hindi");
const callSites = `${cinzel}\n${cormorant}\n${tiro}`;

/* --------------------------- Imports and isolation ------------------------- */

const importLines = [...source.matchAll(/^import .*$/gm)].map((match) => match[0]);
ok(importLines.length === 1, "fonts.ts has exactly one import — the module is font declarations and nothing else");
ok(
  /^import \{ Cinzel, Cormorant_Garamond, Tiro_Devanagari_Hindi \} from "next\/font\/google";$/.test(importLines[0]),
  "the sole import names all three families from next/font/google",
);

const specifiers = [...source.matchAll(/from\s+["']([^"']+)["']/g)].map((match) => match[1]);
ok(
  specifiers.every((specifier) => !/layout/.test(specifier)),
  "fonts.ts imports nothing named layout — R1 keeps the root layout untouched, and a dependency edge is the first step toward editing it",
);
ok(
  !source.includes("app/layout"),
  "fonts.ts does not reference app/layout at all (R1: Inter and Space Grotesk keep their current declarations and preloads)",
);

/* ---------------------------- Cinzel — display ----------------------------- */

const cinzelWeights = [...(cinzel.match(/weight:\s*\[([^\]]*)\]/)?.[1] ?? "").matchAll(/"([^"]+)"/g)].map((m) => m[1]);
ok(cinzelWeights.length === 1, "Cinzel declares exactly one weight — one register, one file");
ok(cinzelWeights[0] === "600", "Cinzel ships the static 600 cut (14.9 KB), not the 25.3 KB variable latin cut");
ok(!/weight:\s*"variable"/.test(cinzel), "Cinzel does not fall back to the variable axis, which costs 10.4 KB more");
ok(/subsets:\s*\["latin"\]/.test(cinzel), "Cinzel preloads the latin subset only");
ok(/display:\s*"swap"/.test(cinzel), "Cinzel uses display: swap per §4");
ok(/preload:\s*true/.test(cinzel), "Cinzel is preloaded — the wordmark is in the first painted frame of the Threshold");
ok(/variable:\s*"--font-snc-display"/.test(cinzel), "Cinzel exposes --font-snc-display");

/* ------------------------ Cormorant Garamond — body ------------------------ */

ok(
  /weight:\s*"variable"/.test(cormorant),
  "Cormorant ships the variable normal cut — 36.9 KB is the figure R1 measured and budgeted for exactly this cut",
);
ok(
  !/weight:\s*\[/.test(cormorant),
  "Cormorant declares no static weight list — next/font ships one file per static weight, which would put the budgeted 36.9 KB at risk for two fixed stops",
);
ok(!/style:/.test(cormorant), "Cormorant requests no italic — style defaults to normal, and each extra style is another file");
ok(/subsets:\s*\["latin"\]/.test(cormorant), "Cormorant preloads the latin subset only");
ok(/display:\s*"swap"/.test(cormorant), "Cormorant uses display: swap per §4");
ok(/preload:\s*true/.test(cormorant), "Cormorant is preloaded — it is the leaf body face, on screen from the first leaf");
ok(/variable:\s*"--font-snc-serif"/.test(cormorant), "Cormorant exposes --font-snc-serif");

/* --------------------- Tiro Devanagari Hindi — the ruling ------------------ */

ok(/subsets:\s*\["devanagari"\]/.test(tiro), "Tiro requests the devanagari subset — the reason it is declared at all");
ok(
  /preload:\s*false/.test(tiro),
  "Tiro is preload: FALSE. Its devanagari cut is 62.1 KB; preloading it takes the route from 51.8 KB to 113.9 KB of new bytes against R1's 90 KB ceiling. Devanagari swapping a beat late is the accepted cost — the fix if it reads badly is self-subsetting via next/font/local, never this flag",
);
ok(!/preload:\s*true/.test(tiro), "Tiro is never preloaded, not even alongside another preload flag");
ok(/weight:\s*\["400"\]/.test(tiro), "Tiro declares weight 400 — the only weight the family has");
ok(/display:\s*"swap"/.test(tiro), "Tiro uses display: swap, so the fallback Devanagari stack shows during the second wave");
ok(/variable:\s*"--font-snc-devanagari"/.test(tiro), "Tiro exposes --font-snc-devanagari");

/* ----------------- The preloaded set is those two and no others ------------ */

ok(count(/preload:\s*true/g) === 2, "exactly two faces are preloaded — Cinzel-600 and Cormorant, per R1's shipping set");
ok(count(/preload:\s*false/g) === 1, "exactly one face is deferred — Tiro");
ok(count(/preload:/g) === 3, "every face states its preload posture explicitly; nothing inherits next/font's default of true");
ok(count(/display:\s*"swap"/g) === 3, "all three faces use display: swap (§4)");

const variables = [...source.matchAll(/variable:\s*"(--font-snc-[a-z-]+)"/g)].map((match) => match[1]);
ok(variables.length === 3, "all three faces declare a --font-snc-* CSS variable");
ok(new Set(variables).size === 3, "the three --font-snc-* variables are distinct, so no face silently overwrites another");
ok(
  !/--font-inter|--font-space-grotesk|--color-ink/.test(source),
  "the sanctuary layer redeclares none of the root layout's or globals.css's tokens — the snc- prefix is what keeps them apart",
);

/* --------------------------- The budget arithmetic ------------------------- */

const displayKb = budget("displayPreloaded");
const serifKb = budget("serifPreloaded");
const devanagariKb = budget("devanagariDeferred");
const baselineKb = budget("rootLayoutBaseline");
const ceilingKb = budget("newPreloadedCeiling");

ok(displayKb === 14.9, "Cinzel latin static 600 is the measured 14.9 KB");
ok(serifKb === 36.9, "Cormorant latin variable normal is the measured 36.9 KB");
ok(devanagariKb === 62.1, "Tiro devanagari 400 is the measured 62.1 KB under next/font's own user agent");
ok(baselineKb === 69.1, "Inter + Space Grotesk already cost 69.1 KB on every route, and the root layout stays untouched");
ok(ceilingKb === 90, "R1's ceiling on NEW preloaded bytes is 90 KB");

const preloadedTotal = displayKb + serifKb;
ok(Math.abs(preloadedTotal - 51.8) < 1e-9, "the preloaded set is Cinzel-600 + Cormorant = 51.8 KB, and nothing else");
ok(preloadedTotal <= ceilingKb, "51.8 KB of new preloaded bytes fits inside the 90 KB ceiling");
ok(
  preloadedTotal + devanagariKb > ceilingKb,
  "adding Tiro to the preloaded set would be 113.9 KB — over the ceiling. This inequality IS the reason preload is false, so if it ever stops holding the ruling has to be re-argued, not quietly relaxed",
);
ok(
  baselineKb + preloadedTotal > ceilingKb && preloadedTotal <= ceilingKb,
  "the 90 KB ceiling counts NEW bytes only — the root layout's 69.1 KB is already spent on every route and is not the sanctuary's to reclaim (A1)",
);

/* ------------------------- Exports the layout needs ------------------------ */

ok(/export const SANCTUARY_FONT_CLASS: string =/.test(source), "SANCTUARY_FONT_CLASS is exported and typed");
const classBody = source.slice(source.indexOf("export const SANCTUARY_FONT_CLASS"));
ok(
  /sanctuaryDisplay\.variable[\s\S]*sanctuarySerif\.variable[\s\S]*sanctuaryDevanagari\.variable/.test(classBody) &&
    /\.join\(" "\)/.test(classBody),
  "SANCTUARY_FONT_CLASS joins all three .variable classes, so a layout applies one className and no consumer has to know the order",
);
for (const name of ["sanctuaryDisplay", "sanctuarySerif", "sanctuaryDevanagari"]) {
  ok(source.includes(`export const ${name} =`), `${name} is exported individually for callers that need one face`);
}
ok(/export const SANCTUARY_FONT_FALLBACKS/.test(source), "SANCTUARY_FONT_FALLBACKS is exported for the swap window");
ok(/export const SANCTUARY_FONT_BUDGET_KB/.test(source), "SANCTUARY_FONT_BUDGET_KB is exported so the ruling is data, not prose");

/* ------------------- Fallback stacks, mirrored at call sites ---------------- */

const GENERICS = new Set(["serif", "sans-serif", "monospace", "cursive", "fantasy", "system-ui"]);
const roles: readonly [string, string][] = [
  ["serifDisplay", cinzel],
  ["serifBody", cormorant],
  ["devanagari", tiro],
];
for (const [role, block] of roles) {
  const stack = fallbackStack(role);
  ok(stack.length >= 2, `the ${role} fallback stack names real faces, not just a generic`);
  ok(GENERICS.has(stack[stack.length - 1]), `the ${role} fallback stack ends in a CSS generic family`);
  for (const family of stack) {
    ok(
      block.includes(`"${family}"`),
      `${role}'s "${family}" is mirrored into its next/font call — next/font only accepts literals, so the exported stack and the call site cannot share one array and must be kept in step`,
    );
  }
}
const devanagariStack = fallbackStack("devanagari");
ok(
  devanagariStack.includes("Nirmala UI") && devanagariStack.includes("Noto Sans Devanagari"),
  "the Devanagari fallback covers Windows and Android/Linux — preload: false guarantees this stack is what the reader sees first",
);
ok(
  devanagariStack[devanagariStack.length - 1] === "sans-serif",
  "the Devanagari stack ends in sans-serif, not serif: serif resolves to a Latin face with no Devanagari coverage on most systems",
);
ok(
  fallbackStack("serifBody").includes("Georgia"),
  "the body stack carries Georgia — the only near-universal face with old-style figures, which §4 puts on every leaf",
);

console.log(`SANCTUARY FONTS ASSERTIONS PASSED (${assertions})`);
