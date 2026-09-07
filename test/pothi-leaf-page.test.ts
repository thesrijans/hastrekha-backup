/* ============================================================================
 * POTHI LEAF PAGE — the reading leaf, and the four things it must never do
 *
 * The reference composition (docs/reference/ui-reading-lifeline-explainability-
 * card.png) is a beautiful card that, taken literally, would ship three lies:
 * two book names this knowledge base does not contain, a Sanskrit couplet no
 * backend can produce, and a hand-picked subtitle that looks like a finding.
 * <LeafPage> is that composition rebuilt against the measured wire, so every
 * pin below is aimed at one of those temptations coming back.
 *
 *  1. THE NARRATION IS PRINTED VERBATIM. Not summarised, not re-wrapped, not
 *     truncated to fit the leaf. The body on the page is the body on the wire,
 *     byte for byte, or the leaf is paraphrasing a reading about someone's life.
 *
 *  2. THE PROVENANCE ROWS ARE `provenanceRows()`, WHOLE AND UNPADDED. The
 *     fixture below yields exactly TWO rows, and the leaf must render two — not
 *     the reference's three, not a filled-in third. This is the assertion that
 *     stops "Ancient Texts" reappearing as a plausible-looking row, and the
 *     struck names are searched for separately, in the markup AND in the source,
 *     for the case where somebody types one back in by hand.
 *
 *  3. THE SOURCE WISDOM INSET IS SEALED, AND CARRIES NO DEVANAGARI AT ALL. A
 *     verse there could only be invented, so the region is asserted to contain
 *     no character in the Devanagari block — which also rules out the dandas a
 *     shloka is bracketed with. The rest of the page is full of Devanagari (the
 *     chapter's own name, the page number), so the assertion is scoped to the
 *     region rather than to the document.
 *
 *  4. A SEALED CHAPTER RENDERS NOTHING, AND A MISSING DESTINATION RENDERS NO
 *     CONTROL. Both are the same rule: this component owns the content half
 *     only, and a control that looks live but goes nowhere is an invented
 *     reading wearing a different hat.
 *
 * HOW A COMPONENT THAT OWNS A STYLESHEET IS LOADED HERE.
 *
 * `tsx` runs this file through Node's CommonJS loader, which cannot parse CSS,
 * so leaf-page.tsx would throw on its `.module.css` import before an assertion
 * ran. The idiom is test/material-parchment.test.ts's: register a `.css`
 * handler returning the identity proxy CSS Modules are conventionally stubbed
 * with, then `createRequire` the component AFTER the patch exists. One
 * consequence is stated rather than hidden — class names are stubs here, so
 * nothing below asserts on a class. Every claim is made against a `data-snc-*`
 * attribute or against text a reader would actually see. The one hole that
 * leaves (a `styles.typo` renders as "typo" here and as nothing in a browser)
 * is closed at the foot of the file by reading the components and the
 * stylesheet against each other.
 * ========================================================================== */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import Module, { createRequire } from "node:module";
import path from "node:path";
import { createElement, type ReactElement } from "react";
import { renderToString } from "react-dom/server";
import { POTHI_CHAPTERS, resolveChapter, type ChapterState } from "../lib/sanctuary/pothi-chapters";
import { STRUCK_SOURCE_NAMES, provenanceRows } from "../lib/sanctuary/pothi-provenance";
import type {
  PublicAreaVerdict,
  PublicRule,
  ReadingResponse,
} from "../app/read/reading-types";

let assertions = 0;
const ok = (condition: boolean, message: string): void => {
  assert.ok(condition, message);
  assertions += 1;
};

/* --------------------- loading the component under test ------------------- */

/** A CSS Modules stand-in: `styles.leaf` is the string "leaf", so stubbed markup stays readable. */
const CLASS_NAME_STUB: Record<string, string> = new Proxy(
  {},
  { get: (_target, key): string | undefined => (typeof key === "string" ? key : undefined) },
) as Record<string, string>;

interface CjsExtensionHost {
  _extensions: Record<string, (loaded: { exports: unknown }, filename: string) => void>;
}

/* `__esModule: true` rather than exporting the proxy directly: the interop wrapper esbuild emits
 * asks a CommonJS export whether it is an ES module, and a bare proxy would answer with the string
 * "__esModule" — truthy — and hand back the wrong object. */
(Module as unknown as CjsExtensionHost)._extensions[".css"] = (loaded): void => {
  loaded.exports = { __esModule: true, default: CLASS_NAME_STUB };
};

interface LeafPageModule {
  LeafPage: (props: Record<string, unknown>) => ReactElement | null;
  SOURCE_WISDOM_SEAL_CODE: string;
  devanagariNumber: (value: number) => string;
  leafSubtitleTerms: (state: ChapterState) => readonly string[];
}

const COMPONENT_DIR = path.resolve(__dirname, "..", "components", "sanctuary", "pothi");
const { LeafPage, SOURCE_WISDOM_SEAL_CODE, devanagariNumber, leafSubtitleTerms } = createRequire(__filename)(
  "../components/sanctuary/pothi/leaf-page",
) as LeafPageModule;

const leafSource = readFileSync(path.join(COMPONENT_DIR, "leaf-page.tsx"), "utf8");
const rowsSource = readFileSync(path.join(COMPONENT_DIR, "provenance-rows.tsx"), "utf8");
const stylesheet = readFileSync(path.join(COMPONENT_DIR, "leaf-page.module.css"), "utf8");

/**
 * Both components and the sheet with their comments stripped.
 *
 * The "this must never appear" assertions run against these rather than the raw text, and the
 * distinction is load-bearing here in a way it is nowhere else in this repo: these files DOCUMENT
 * the struck book names, in prose, as the thing they refuse to print. A search over the raw source
 * would fail on the very sentences that explain the rule.
 */
const withoutComments = (text: string): string =>
  text.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1");

const leafCode = withoutComments(leafSource);
const rowsCode = withoutComments(rowsSource);
const css = withoutComments(stylesheet);

/* --------------------------------- helpers -------------------------------- */

/**
 * SSR output with React's text-node separators removed.
 *
 * `renderToString` writes `<!-- -->` between adjacent text nodes, which would turn a citation into
 * "( Cheiro<!-- --> — Palmistry for All )". Stripping them lets every assertion below say what it
 * means about the text a reader sees.
 */
const text = (html: string): string => html.replace(/<!-- -->/g, "");

/** How many times a literal substring occurs — the only honest way to ask "exactly two rows". */
const count = (haystack: string, needle: string): number => haystack.split(needle).length - 1;

/**
 * The markup between two `data-snc-region` markers.
 *
 * Scoping matters: "the page contains no Devanagari" is false and must be — the chapter's own name
 * and its page number are Devanagari by design. What must be true is that the SOURCE WISDOM panel
 * contains none, and slicing from its marker to the footer's is how that question gets asked.
 */
const region = (html: string, from: string, to: string): string => {
  const start = html.indexOf(`data-snc-region="${from}"`);
  const end = html.indexOf(`data-snc-region="${to}"`);
  assert.ok(start !== -1, `expected a region marked ${from}`);
  assert.ok(end > start, `expected the region ${to} to follow ${from}`);
  return html.slice(start, end);
};

/** Every character in the Devanagari block, dandas included. */
const DEVANAGARI = /[ऀ-ॿ]/;

const chapterOf = (numeral: string) => {
  const found = POTHI_CHAPTERS.find((entry) => entry.numeral === numeral);
  assert.ok(found !== undefined, `expected chapter ${numeral} in POTHI_CHAPTERS`);
  return found;
};

/* --------------------------------- fixture -------------------------------- */

/**
 * The narration body, and it is deliberately awkward.
 *
 * An em dash, a digit and an apostrophe, because those are the three things a leaf could mangle
 * without anyone noticing: an entity-escaped dash, a lining figure where the sheet asks for
 * old-style, a smart quote turned into `&#x27;`. Asserting on this string asserts that the body
 * survived the render intact.
 */
const NARRATION_BODY =
  "Aapki jeevan rekha 30 ke aas-paas ek mod leti hai — uske baad wo dobara gehri hoti hai, " +
  "jo lauti hui urja ka sanket hai.";

const SECTION_TITLE = "Jeevan rekha ka mod";

const LIFE_RULES: readonly PublicRule[] = [
  {
    rule_id: "PALM-LIFE-004",
    category: "vitality",
    polarity: "positive",
    interpretation_hi_en: "Jeevan rekha chaudi aur saaf hai.",
    weight: 0.8,
    /* Pre-joined exactly as the route emits it: "Text (year) — loc", sources[1..] already dropped. */
    source: "Cheiro — Palmistry for All (1916) — Ch.VI — the Line of Life",
    tags: ["life_line"],
  },
  {
    rule_id: "PALM-LIFE-011",
    category: "personality",
    polarity: "neutral",
    interpretation_hi_en: "Rekha par ek break dikhta hai.",
    weight: 0.4,
    source: "Dale — Indian Palmistry (1895) — p.44",
    tags: ["life_line"],
  },
];

function reading(over: Partial<ReadingResponse> = {}): ReadingResponse {
  return {
    readingId: "rd_leaf_test",
    narration: {
      one_liner: "Jeevan rekha lauti hui urja dikhati hai.",
      sections: [{ title: SECTION_TITLE, body: NARRATION_BODY, rule_ids: ["PALM-LIFE-004"] }],
      disclaimer: "Yeh paramparik paath hai, bhavishyavani nahi.",
      engine: "template",
    },
    rules: LIFE_RULES,
    clusters: [],
    lockedRuleCount: 0,
    confidence: 0.62,
    coverage: { provided: ["lines.life"], missing: ["mounts.venus"], ratio: 0.5 },
    ...over,
  };
}

const LIFE_CHAPTER = chapterOf("IV");
const LIFE_STATE = resolveChapter(LIFE_CHAPTER, reading(), null);
assert.equal(LIFE_STATE.status, "content", "the fixture must open chapter IV, or nothing below is testing the leaf");

const render = (props: Record<string, unknown>): string => {
  const element = createElement(LeafPage, props);
  return renderToString(element);
};

const LEAF = text(
  render({
    state: LIFE_STATE,
    reading: reading(),
    sessionId: "sess_9f2c",
    backHref: "/read/pothi",
    saveHref: "/api/reading/save",
    shareHref: "/read/pothi/share",
  }),
);

/* ------------------ 1. the narration is printed verbatim ------------------ */

ok(
  LEAF.includes(NARRATION_BODY),
  "the narration body appears on the leaf byte for byte — a leaf that re-wraps or trims it is paraphrasing a reading about someone's life",
);
ok(
  LEAF.includes(SECTION_TITLE),
  "and the section's own title comes with it: the wire carries a title per section and dropping it silently merges two findings into one",
);
ok(
  count(LEAF, 'data-snc-block="section"') === 1,
  "exactly one block, from the narration — with a section present the leaf must not also dump every fired rule underneath it",
);

/* ---------------- 2. the provenance rows are what the data layer says ----- */

const EXPECTED_ROWS = provenanceRows(reading(), LIFE_STATE.status === "content" ? LIFE_STATE.ruleIds : []);

ok(
  EXPECTED_ROWS.length === 2,
  `the fixture cites Cheiro and Dale and nothing else, so provenanceRows() returns two rows (got ${EXPECTED_ROWS.length}) — the reference card's third medallion has no source in this KB`,
);
ok(
  count(LEAF, "data-snc-provenance-row=") === EXPECTED_ROWS.length,
  `the leaf renders exactly ${EXPECTED_ROWS.length} rows, never the reference's fixed three: a row the data layer did not return is a fabricated citation printed under a real one`,
);
for (const row of EXPECTED_ROWS) {
  ok(
    LEAF.includes(`data-snc-provenance-row="${row.key}"`),
    `the "${row.key}" row is rendered, keyed as the data layer keyed it`,
  );
  ok(LEAF.includes(row.title), `and carries its title verbatim: ${row.title}`);
  ok(
    LEAF.includes(`( ${row.source} )`),
    `and its parenthetical is the canonical string the data layer emitted, not the source text echoed back: ( ${row.source} )`,
  );
}
ok(
  LEAF.indexOf(EXPECTED_ROWS[0].title) < LEAF.indexOf(EXPECTED_ROWS[1].title),
  "in the data layer's order — Cheiro before Dale, because provenanceRows() decides the order and the leaf does not re-sort it",
);
ok(
  !LEAF.includes("AI Interpretation"),
  "and the narration row is ABSENT for a template narration: no model wrote a word of this leaf, so crediting one would be backwards",
);

/* the empty case, which is the one A2 is actually about */
{
  const uncited = reading({ rules: LIFE_RULES.map((rule) => ({ ...rule, source: "" })) });
  const state = resolveChapter(LIFE_CHAPTER, uncited, null);
  const html = text(render({ state, reading: uncited }));
  ok(
    provenanceRows(uncited, state.status === "content" ? state.ruleIds : []).length === 0,
    "a reading whose rules carry no source yields no provenance rows at all",
  );
  ok(
    html.includes('data-snc-provenance="empty"') && html.includes("2 rule"),
    "and the leaf then prints a sentence naming how many rules it had, rather than leaving a heading with white space under it",
  );
  ok(
    count(html, "data-snc-provenance-row=") === 0,
    "with not one medallion invented to fill the gap",
  );
}

/* ------------- 3. the Source Wisdom inset is sealed, and mute ------------- */

const WISDOM = region(LEAF, "source-wisdom", "leaf-footer");

ok(
  WISDOM.includes(`data-snc-sealed="${SOURCE_WISDOM_SEAL_CODE}"`),
  "the Source Wisdom panel renders the SEALED treatment: there is no verse table in the backend, so the only alternatives were an honest empty frame and a fabricated shloka",
);
ok(
  !DEVANAGARI.test(WISDOM),
  "and the panel contains NOT ONE Devanagari character — no verse, no transliteration, and no danda to bracket one with",
);
ok(
  /shlok/i.test(WISDOM),
  "the seal names what is missing in the reader's own language rather than showing a blank box",
);
ok(
  WISDOM.includes("2 granth-hawale"),
  "and it QUOTES this leaf — two citations, counted from the response — so the reason cannot survive a change in the data as a stock apology",
);
ok(
  count(WISDOM, 'data-snc-ornament="corner"') === 4,
  "the inset is framed by four real <AncientCorner /> pieces, as the reference frames it — counted by the ornament's own marker, so a placement wrapper with nothing inside it cannot pass",
);
for (const corner of ["tl", "tr", "bl", "br"]) {
  ok(
    WISDOM.includes(`data-snc-corner="${corner}"`),
    `including the ${corner} piece: AncientCorner mirrors its own geometry per corner, so all four must be asked for by name`,
  );
}
ok(
  WISDOM.includes('data-snc-ornament="lotus"'),
  "and carries the lotus beside them, the bloom the reference sets at the right of this panel",
);
ok(
  DEVANAGARI.test(LEAF),
  "sanity: the PAGE does carry Devanagari — the chapter's own name and its numeral — so the assertion above is about the panel and not about a render that failed",
);

/* --------------------- 4. the Devanagari page number ---------------------- */

ok(
  LEAF.includes(`पृष्ठ ${LIFE_CHAPTER.devanagariNumeral} / ${devanagariNumber(POTHI_CHAPTERS.length)}`),
  "the page number is inked in Devanagari numerals, both halves of it",
);
ok(
  devanagariNumber(POTHI_CHAPTERS.length) === "१५" && devanagariNumber(7) === "७",
  "and the total is DERIVED from POTHI_CHAPTERS rather than typed, so a sixteenth chapter cannot leave every leaf claiming to be one of fifteen",
);
ok(
  LEAF.includes('data-snc-page-number="०४"'),
  "chapter IV's leaf is page ०४ — the numeral comes from the chapter data, not from a render-order counter",
);

/* ------------- 5. the subtitle is derived, never the reference's ---------- */

ok(
  !LEAF.includes("Stability") && !LEAF.includes("Stability • Health • Vitality"),
  "the reference's hand-picked 'Stability • Health • Vitality' appears nowhere, and neither does its first word — 'Stability' is not a category this KB has ever emitted, so it could only have been typed",
);
ok(
  !/Stability|Health •/.test(`${leafCode}${rowsCode}`),
  "and the triple is not sitting in the components as a default waiting for an empty response",
);
{
  const terms = leafSubtitleTerms(LIFE_STATE);
  ok(
    terms.includes("Vitality") && terms.includes("Personality"),
    `a line chapter's subtitle is the categories of the rules that actually fired (got ${terms.join(", ")})`,
  );
  ok(LEAF.includes(terms.join(" • ")), "and that is what the strip prints");
}

/* an area chapter takes its words from the product's existing vocabulary */
{
  const verdict: PublicAreaVerdict = {
    area: "dhan",
    label_hi_en: "Paisa aur Samriddhi",
    direction: "anukool",
    strength: 74,
    band: "HIGH",
    conflict: 0.1,
    independence: 3,
    coverage: 0.6,
    evidence: [
      {
        rule_id: "PALM-LIFE-004",
        role: "primary",
        polarity: "positive",
        contribution: 0.7,
        interpretation_hi_en: "Jeevan rekha chaudi aur saaf hai.",
        sources: [{ text: "Cheiro — Palmistry for All", loc: "Ch.VI", year: 1916 }],
      },
    ],
    lockedEvidenceCount: 0,
    meta: { map_version: "1.0", engine_version: "area-v1.0" },
  };
  const withAreas = reading({ areas: [verdict] });
  const state = resolveChapter(chapterOf("XI"), withAreas, null);
  const terms = leafSubtitleTerms(state);
  ok(
    terms[0] === "Anukool" && terms[1] === "Prabal sanket",
    `an area chapter leads with DIRECTION_COPY and BAND_COPY from components/areas/area-vocab.ts (got ${terms.join(", ")}) — one verdict must not be described by two different words in two places`,
  );
  ok(
    text(render({ state, reading: withAreas })).includes("Anukool • Prabal sanket"),
    "and the leaf prints them separated by the reference's bullet",
  );
}

/* --------- 6. a sealed chapter, and a control with nowhere to go ---------- */

{
  const sealed = resolveChapter(chapterOf("VII"), reading(), null);
  ok(sealed.status === "sealed", "chapter VII is sealed at launch whatever the response says");
  ok(
    render({ state: sealed, reading: reading() }) === "",
    "and <LeafPage> renders NOTHING for it: the book decides which component a sealed chapter mounts, and a seal shown twice is worse than either showing",
  );
}
{
  const bare = text(render({ state: LIFE_STATE, reading: reading() }));
  ok(
    !bare.includes("data-snc-action=") && !bare.includes("Save reading"),
    "with no destination supplied the footer draws no Save or Share mark — a control that looks live and goes nowhere is an invented reading wearing a different hat",
  );
  ok(
    !bare.includes("aria-label=\"Wapas\""),
    "and no back arrow either, for the same reason",
  );
  ok(
    LEAF.includes('data-snc-action="save"') && LEAF.includes('data-snc-action="share"'),
    "while a leaf given both hrefs draws both marks, on the parchment rather than in a bar",
  );
}

/* ---------------- 7. R4: the struck names, hunted everywhere -------------- */

for (const struck of STRUCK_SOURCE_NAMES) {
  ok(!LEAF.includes(struck), `"${struck}" is STRUCK and never reaches the markup`);
  ok(
    !leafCode.includes(struck) && !rowsCode.includes(struck),
    `and does not appear in the components either, so it cannot be typed back in as a fallback: "${struck}"`,
  );
}

/* ------------- 8. no colour of its own, and no client bundle -------------- */

const HEX = /#[0-9a-fA-F]{3,8}\b/;
ok(!HEX.test(leafCode) && !HEX.test(rowsCode), "neither component contains a hex literal — every colour resolves to a --color-snc-* token");
ok(!HEX.test(css), "and neither does the stylesheet");
ok(!/\brgba?\(/.test(leafCode) && !/\brgba?\(/.test(rowsCode) && !/\brgba?\(/.test(css), "nor an rgb()/rgba() literal, the other way a colour escapes the palette");
ok(!HEX.test(LEAF), "and no hex survives into the rendered markup");
ok(
  !/^\s*["']use client["']/m.test(leafCode) && !/^\s*["']use client["']/m.test(rowsCode),
  "both are SERVER components: no state, no effect, no handler, so a leaf costs zero client JavaScript",
);
ok(
  !/border-radius/.test(css),
  "and the sheet declares no border-radius — the one disc on this page is .snc-medallion from the token layer",
);
ok(/@layer\s+components/.test(css), "the sheet is layered, so a utility passed through className still wins");

/* ------------- every class the components name actually exists ------------ */

/*
 * The one hole the CSS Modules stub leaves, closed by reading the files against each other. With a
 * real bundler `styles.provenanceDsc` is `undefined` and the row renders unstyled — medallion
 * unsized, columns collapsed — while with the stub above it renders happily and asserts fine.
 */
{
  const used = new Set(
    [...`${leafCode}${rowsCode}`.matchAll(/styles\.([A-Za-z][A-Za-z0-9_]*)/g)].map((match) => match[1]),
  );
  const defined = new Set([...css.matchAll(/\.([A-Za-z][A-Za-z0-9_]*)\s*[{[]/g)].map((match) => match[1]));
  ok(used.size >= 20, "the leaf is built from the stylesheet rather than from inline layout, which is what keeps it overridable");
  ok(
    [...used].every((name) => defined.has(name)),
    `every class the components name is defined: ${[...used].filter((name) => !defined.has(name)).join(", ") || "none missing"} — a name that resolves to undefined renders an unstyled leaf, not an error`,
  );
  ok(
    [...defined].every((name) => used.has(name)),
    `and the sheet carries no orphan: ${[...defined].filter((name) => !used.has(name)).join(", ") || "none orphaned"} — an unused rule is a layer that was dropped or a rename left half done`,
  );
}

console.log(`POTHI LEAF PAGE ASSERTIONS PASSED (${assertions})`);
