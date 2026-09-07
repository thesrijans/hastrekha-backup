/* ============================================================================
 * POTHI BOOK — fifteen leaves, one binding, and the four ways it could lie
 *
 * <PothiBook> is the only component in the Pothi that decides what a reader
 * MEETS rather than what a leaf says, and every pin below aims at a way that
 * decision could go quietly wrong.
 *
 *  1. THE BOOK OWNS NO SEAL POLICY. The three chapters sealed at launch (VI
 *     sun/mercury, VII mounts, XIV the question) must be sealed because
 *     `resolveChapter` said so, not because the book knows their numerals. So
 *     the sealed faces are asserted through the rendered markup AND the book's
 *     own source is searched for those numerals as string literals — a
 *     shortcut that happened to be right today would keep sealing chapter VII
 *     on the day mounts became measurable, and nothing else would fail.
 *
 *  2. A SEALED CHAPTER RENDERS <SealedLeaf> AND NEVER <LeafPage>, AND VICE
 *     VERSA. <LeafPage> already returns null for a sealed state, so a book that
 *     mounted both would render a seal beside an empty sheet and still pass
 *     every assertion about the seal's text. The faces are therefore counted,
 *     not merely searched: exactly one content marker per leaf.
 *
 *  3. THE DEGRADE IS A CLASS, NOT A HOPE. At FLOOR the crossfade class is on
 *     the root and the 3D class is not — asserted by splitting the class
 *     attribute on spaces rather than by substring, because `crossfade` is a
 *     substring of half the names in that stylesheet.
 *
 *  4. NO READING ⇒ NO BOOK. Not fifteen sealed leaves, which would read as
 *     fifteen separate failures of one reading; one closed bundle naming the
 *     real reason, with the /scan link that can genuinely fix it. Asserted in
 *     both directions: the seal is present AND not one chapter leaf is.
 *
 * WHAT renderToString CANNOT SEE, AND WHAT IS DONE ABOUT IT. React does not
 * serialise event handlers, so `onKeyDown` and the pointer handlers leave no
 * trace in the markup. Those are asserted against the component's SOURCE, with
 * the comments stripped first — this file's own subject documents its handlers
 * in prose, and a search over raw text would pass on the sentences that
 * describe them rather than on the code that wires them.
 *
 * HOW A COMPONENT THAT OWNS A STYLESHEET IS LOADED HERE. The idiom of
 * test/pothi-leaf-page.test.ts: `tsx` runs this through Node's CommonJS loader,
 * which cannot parse CSS, so a `.css` handler returning the conventional
 * identity proxy is registered FIRST and the component is required after it
 * exists — hence createRequire rather than a static import, whose require would
 * be hoisted above the patch. The consequence is stated rather than hidden:
 * class names are stubs here, so `styles.fold` renders as the string "fold".
 * Nothing below asserts on how a class LOOKS; the class assertions are about
 * which name the component chose, which survives stubbing intact.
 * ========================================================================== */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import Module, { createRequire } from "node:module";
import path from "node:path";
import { createElement, type ReactElement } from "react";
import { renderToString } from "react-dom/server";
import { POTHI_CHAPTERS, resolveChapter } from "../lib/sanctuary/pothi-chapters";
import type { CapabilityTier } from "../components/sanctuary/use-capability-tier";
import type { PothiSessionGeometry } from "../lib/sanctuary/pothi-geometry";
import type { PublicAreaVerdict, PublicRule, ReadingResponse } from "../app/read/reading-types";

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

interface PothiBookModule {
  PothiBook: (props: Record<string, unknown>) => ReactElement;
  POTHI_NO_READING_SEAL_CODE: string;
  POTHI_TURN_MIN_FPS: number;
  POTHI_TURN_MAX_FRAME_MS: number;
  POTHI_TURN_DURATION_MS: Readonly<Record<"fold" | "crossfade", number>>;
  POTHI_TURN_COMMIT_FRACTION: number;
  pothiTurnMode: (capabilityTier: CapabilityTier, degraded: boolean) => "fold" | "crossfade";
  pothiFolio: (chapter: (typeof POTHI_CHAPTERS)[number]) => string;
  faceUp: (angleDeg: number) => "recto" | "verso";
}

const COMPONENT_DIR = path.resolve(__dirname, "..", "components", "sanctuary", "pothi");
const ROUTE_DIR = path.resolve(__dirname, "..", "app", "read", "pothi");

const {
  PothiBook,
  POTHI_NO_READING_SEAL_CODE,
  POTHI_TURN_MIN_FPS,
  POTHI_TURN_MAX_FRAME_MS,
  POTHI_TURN_DURATION_MS,
  POTHI_TURN_COMMIT_FRACTION,
  pothiTurnMode,
  pothiFolio,
  faceUp,
} = createRequire(__filename)("../components/sanctuary/pothi/pothi-book") as PothiBookModule;

const bookSource = readFileSync(path.join(COMPONENT_DIR, "pothi-book.tsx"), "utf8");
const bookStyles = readFileSync(path.join(COMPONENT_DIR, "pothi-book.module.css"), "utf8");
const leafSource = readFileSync(path.join(COMPONENT_DIR, "leaf-page.tsx"), "utf8");
const clientSource = readFileSync(path.join(ROUTE_DIR, "pothi-client.tsx"), "utf8");
/* The reading's session key and its validator were lifted out of the client and
 * into lib/sanctuary, so the SCAN side can write the reading without importing a
 * route component — `tsx` cannot parse a CSS module, and a writer that had to
 * would have been a writer nobody could test. The key is asserted where it now
 * lives, which is the same shape the geometry half already had. */
const storeSource = readFileSync(
  path.resolve(__dirname, "..", "lib", "sanctuary", "pothi-reading-store.ts"),
  "utf8",
);
const routeSource = readFileSync(path.join(ROUTE_DIR, "page.tsx"), "utf8");

/**
 * A source file with its comments removed.
 *
 * Every "this must never appear" assertion runs against these rather than the raw text, and the
 * distinction is load-bearing here: this component is documented by NAMING the shortcuts it
 * refuses — the three launch-sealed numerals, the second copy of the resolver — so a search over
 * raw source would fail on the very sentences that explain the rule.
 */
const withoutComments = (text: string): string =>
  text.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1");

const bookCode = withoutComments(bookSource);
const bookCss = withoutComments(bookStyles);
const clientCode = withoutComments(clientSource);
const routeCode = withoutComments(routeSource);

/* --------------------------------- helpers -------------------------------- */

/** SSR output with React's text-node separators removed, so assertions can say what they mean. */
const text = (html: string): string => html.replace(/<!-- -->/g, "");

/** How many times a literal substring occurs — the only honest way to ask "exactly fifteen". */
const count = (haystack: string, needle: string): number => haystack.split(needle).length - 1;

const render = (props: Record<string, unknown>): string => text(renderToString(createElement(PothiBook, props)));

/**
 * The markup of one leaf: from its own marker to the next leaf's, or to the end.
 *
 * The leaves are siblings in chapter order, so this slice is exactly one leaf — which is what lets
 * "chapter VII renders a seal" be a claim about chapter VII rather than about the document.
 */
const leafSlice = (html: string, numeral: string): string => {
  const start = html.indexOf(`data-snc-leaf="${numeral}"`);
  assert.ok(start !== -1, `expected a leaf marked ${numeral}`);
  const next = html.indexOf('data-snc-leaf="', start + 1);
  return next === -1 ? html.slice(start) : html.slice(start, next);
};

/** The class list of the root element, as words — never as a substring search. */
const rootClasses = (html: string): readonly string[] => {
  const match = /class="([^"]*)"\s+data-snc-book="/.exec(html);
  assert.ok(match !== null, "expected the book's root element to carry a class attribute");
  return match[1].split(/\s+/).filter((name) => name.length > 0);
};

/* --------------------------------- fixture -------------------------------- */

/**
 * The narration body, deliberately awkward: an em dash, a digit and a hyphenated word, because
 * those are what a book could mangle on the way through a leaf without anyone noticing.
 */
const NARRATION_BODY =
  "Aapki jeevan rekha 30 ke aas-paas ek mod leti hai — uske baad wo dobara gehri hoti hai.";

const SECTION_TITLE = "Jeevan rekha ka mod";

const RULES: readonly PublicRule[] = [
  {
    rule_id: "PALM-LIFE-004",
    category: "vitality",
    polarity: "positive",
    interpretation_hi_en: "Jeevan rekha chaudi aur saaf hai.",
    weight: 0.8,
    source: "Cheiro — Palmistry for All (1916) — Ch.VI — the Line of Life",
    tags: ["life_line"],
  },
  {
    rule_id: "PALM-HEART-002",
    category: "relationships",
    polarity: "neutral",
    interpretation_hi_en: "Hriday rekha Jupiter tak jaati hai.",
    weight: 0.5,
    source: "Dale — Indian Palmistry (1895) — p.44",
    tags: ["heart_line"],
  },
];

/** One scored area, so chapter VIII opens on a real verdict rather than on a seal. */
const RISHTE: PublicAreaVerdict = {
  area: "rishte",
  label_hi_en: "Pyaar aur Rishte",
  direction: "anukool",
  strength: 61,
  band: "MEDIUM",
  conflict: 0.1,
  independence: 0.7,
  coverage: 0.5,
  evidence: [
    {
      rule_id: "PALM-HEART-002",
      role: "primary",
      polarity: "neutral",
      contribution: 0.4,
      interpretation_hi_en: "Hriday rekha Jupiter tak jaati hai.",
      sources: [{ text: "Dale — Indian Palmistry", loc: "p.44", year: 1895 }],
    },
  ],
  lockedEvidenceCount: 0,
  meta: { map_version: "v1", engine_version: "test" },
};

function reading(over: Partial<ReadingResponse> = {}): ReadingResponse {
  return {
    readingId: "rd_book_test",
    narration: {
      one_liner: "Jeevan rekha lauti hui urja dikhati hai.",
      sections: [{ title: SECTION_TITLE, body: NARRATION_BODY, rule_ids: ["PALM-LIFE-004"] }],
      disclaimer: "Yeh paramparik paath hai, bhavishyavani nahi.",
      engine: "template",
    },
    rules: RULES,
    clusters: [],
    areas: [RISHTE],
    lockedRuleCount: 0,
    confidence: 0.62,
    coverage: { provided: ["lines.life", "lines.heart"], missing: ["mounts.venus"], ratio: 0.5 },
    ...over,
  };
}

/** A hand-off in the SESSION shape: mask space, no crop — the revisited-reading case. */
const GEOMETRY: PothiSessionGeometry = {
  sessionId: "sess_book_test",
  capturedAt: "2026-09-07T09:15:00.000Z",
  space: 128,
  lines: {
    life: [
      [40, 20],
      [30, 60],
      [44, 100],
    ],
    heart: [
      [20, 34],
      [90, 28],
    ],
  },
};

const BOOK = render({
  reading: reading(),
  geometry: GEOMETRY,
  capabilityTier: "HIGH",
  sessionId: "sess_book_test",
  backHref: "/read",
});

/* ------------------------- 1. fifteen leaves exist ------------------------ */

ok(
  count(BOOK, "data-snc-leaf=") === POTHI_CHAPTERS.length,
  `the book binds ${POTHI_CHAPTERS.length} leaves and no more — a window of three rendered leaves would look identical on screen and would silently drop twelve chapters from the document`,
);
for (const chapter of POTHI_CHAPTERS) {
  ok(
    BOOK.includes(`data-snc-leaf="${chapter.numeral}"`),
    `chapter ${chapter.numeral} (${chapter.titleEn}) is one of them`,
  );
}
ok(
  count(BOOK, 'data-snc-leaf-state="current"') === 1,
  "and exactly one of them is face-up: a book showing two current leaves is two sheets of one manuscript in the same air",
);

/* ------------- 2. the sealed chapters seal, and never also open ----------- */

for (const numeral of ["VI", "VII", "XIV"]) {
  const chapter = POTHI_CHAPTERS.find((entry) => entry.numeral === numeral);
  assert.ok(chapter !== undefined, `expected chapter ${numeral} in POTHI_CHAPTERS`);
  const state = resolveChapter(chapter, reading(), null);
  ok(
    state.status === "sealed",
    `the data layer seals chapter ${numeral} against this very response — if it did not, the assertions below would be testing the fixture rather than the book`,
  );

  const slice = leafSlice(BOOK, numeral);
  ok(
    slice.includes('data-snc-face-content="sealed"'),
    `chapter ${numeral} renders <SealedLeaf>`,
  );
  ok(
    !slice.includes('data-snc-face-content="leaf"'),
    `and NEVER also <LeafPage> — a leaf mounted beside a seal renders an empty sheet, and every assertion about the seal's own text would still pass`,
  );
  ok(
    state.status === "sealed" && slice.includes(state.reason.hi),
    `and the sentence on it is resolveChapter's own reason, verbatim: a book that summarised it would have stopped quoting the response`,
  );
  ok(
    slice.includes(`data-snc-folio="${chapter.devanagariNumeral}"`),
    `a sealed leaf still carries its folio (${chapter.devanagariNumeral}) — <LeafPage> inks its own and this one has none, so the book supplies it`,
  );
}

/* The book must not know those numerals. */
ok(
  !/["'](VI|VII|XIV)["']/.test(bookCode),
  "and the book's own source contains no launch-sealed numeral as a literal: the seal decision belongs to resolveChapter, and a shortcut that is right today would keep sealing chapter VII on the day mounts became measurable",
);
ok(
  !bookCode.includes("SEAL_CODES") && !bookCode.includes("lockedRuleCount"),
  "nor does it reach into the seal table or the response's own fields to second-guess a chapter — it renders what resolvePothi handed it",
);

/* ---------------------- 3. a content chapter opens ----------------------- */

{
  const chapter = POTHI_CHAPTERS.find((entry) => entry.numeral === "IV");
  assert.ok(chapter !== undefined, "expected chapter IV");
  const state = resolveChapter(chapter, reading(), null);
  ok(state.status === "content", "the fixture opens chapter IV, or nothing below is testing an open leaf");

  const slice = leafSlice(BOOK, "IV");
  ok(slice.includes('data-snc-face-content="leaf"'), "chapter IV renders <LeafPage>");
  ok(
    !slice.includes('data-snc-face-content="sealed"'),
    "and not a seal beside it: content and seal are the two halves of one decision, never both",
  );
  ok(
    slice.includes(NARRATION_BODY),
    "with the narration body printed byte for byte — the book passes the state through and rewrites nothing",
  );
  ok(
    slice.includes('data-snc-plate="neutral"'),
    "and the measured crease is drawn beside it: the book converts the SESSION hand-off for <PalmPlate> rather than passing the resolver's shape, which is the `space`-versus-`size` mistake this arrangement exists to make impossible",
  );
}

{
  /* An area chapter, so the second kind of open leaf is covered too. */
  const slice = leafSlice(BOOK, "VIII");
  ok(
    slice.includes('data-snc-face-content="leaf"') && slice.includes(RISHTE.label_hi_en),
    "chapter VIII opens on the scored area verdict, labelled as the engine labelled it",
  );
}

/* A chapter with no evidence at all seals rather than opening on nothing. */
{
  const bare = render({ reading: reading({ rules: [], areas: [], narration: { ...reading().narration, sections: [] } }), capabilityTier: "HIGH" });
  ok(
    !bare.includes('data-snc-face-content="leaf"'),
    "a reading with no sections, no rules and no areas opens NOT ONE leaf — every chapter seals, because there is nothing any of them could honestly print",
  );
  ok(
    count(bare, 'data-snc-face-content="sealed"') === POTHI_CHAPTERS.length,
    "and all fifteen say so",
  );
}

/* ------------------- 4. the degrade is a class, not a hope ---------------- */

{
  const floor = render({ reading: reading(), capabilityTier: "FLOOR" });
  const classes = rootClasses(floor);
  ok(
    classes.includes("crossfade"),
    "at FLOOR the crossfade class is on the root — the tier that is also the prefers-reduced-motion target never gets a rotating sheet",
  );
  ok(
    !classes.includes("fold"),
    "and the 3D class is not, so the fold's transition, its back face and its shadow are never even declared for that device",
  );
  ok(
    floor.includes('data-snc-turn-mode="crossfade"'),
    "with the mode published as a data attribute too, so the choice is legible in devtools rather than folded into a class name",
  );
}
{
  const classes = rootClasses(BOOK);
  ok(classes.includes("fold") && !classes.includes("crossfade"), "above FLOOR the book folds");
}

ok(
  pothiTurnMode("FLOOR", false) === "crossfade" && pothiTurnMode("HIGH", true) === "crossfade",
  "the decision is a pure function of the tier and one latched boolean: FLOOR crossfades, and so does any tier the frame sampler demoted",
);
ok(
  pothiTurnMode("HIGH", false) === "fold" && pothiTurnMode("LOW", false) === "fold",
  "and every other tier folds until it is measured — LOW is a budget, not a verdict",
);
ok(
  !bookCode.includes("setDegraded(false)"),
  "the degrade LATCHES: nothing in this file can restore the fold, so a device sitting on the threshold cannot fold, stutter, fade and fold again",
);
ok(
  Math.abs(POTHI_TURN_MAX_FRAME_MS - 1000 / POTHI_TURN_MIN_FPS) < 1e-9 && POTHI_TURN_MIN_FPS === 55,
  "the threshold is 55 fps expressed in the milliseconds the sampler actually reports, derived rather than typed twice",
);
ok(
  bookCode.includes("probeFrameMs"),
  "and it is measured with the existing probeFrameMs — nine idle deltas, median — rather than a second sampler written here",
);
ok(
  POTHI_TURN_DURATION_MS.fold > POTHI_TURN_DURATION_MS.crossfade &&
    bookCss.includes("--snc-turn-duration"),
  "one duration table feeds both the flight gate and the stylesheet, so a CSS transition can never outlive the gate that stops a second leaf turning through the first",
);
ok(
  POTHI_TURN_COMMIT_FRACTION > 0 && POTHI_TURN_COMMIT_FRACTION < 0.5,
  "a drag commits past a fraction of the stage and springs back below it — never at zero, which would turn the page on a brush",
);

/* ---------------- 5. no reading at all ⇒ the honest empty state ----------- */

{
  const empty = render({ reading: null, capabilityTier: "MID" });
  ok(
    empty.includes('data-snc-book="empty"'),
    "with no reading in the tab the book renders the closed bundle",
  );
  ok(
    count(empty, "data-snc-leaf=") === 0,
    "and NOT ONE chapter leaf: fifteen seals would read as fifteen separate failures of one reading, where the true fact is a single one",
  );
  ok(
    empty.includes(`/scan?rescan=${POTHI_NO_READING_SEAL_CODE}`),
    "the one control on it goes to /scan, because a scan is genuinely what fills this gap — the seal carries a capture instruction for exactly that reason",
  );
  ok(
    withoutComments(storeSource).includes("hastrekha:pothi-reading:v1") &&
      clientCode.includes("pothi-reading-store"),
    "the reading itself travels on a versioned session key, the same hand-off idiom the geometry module already uses across the same boundary — declared once in the store both sides import, never spelled out twice",
  );
  ok(
    /GET/.test(clientSource) && /no GET-reading endpoint|GET-READING ENDPOINT/i.test(clientSource),
    "and the client STATES the backend gap in prose rather than hiding it: there is no endpoint that returns a reading by id, which is the whole reason a session hand-off exists at all",
  );
  ok(
    /paath|reading/i.test(empty),
    "the bundle says in the reader's own language that no reading has been made, rather than showing a blank sheet",
  );
}

/* -------------------- 6. the gestures are actually wired ----------------- */

/*
 * React does not serialise event handlers, so these are claims about the source. Each names the
 * handler prop rather than the function, because a renamed callback is a refactor and a removed
 * prop is a dead gesture.
 */
for (const handler of ["onKeyDown", "onPointerDown", "onPointerMove", "onPointerUp", "onPointerCancel", "onClick"]) {
  ok(bookCode.includes(`${handler}={`), `the ${handler} handler is wired to an element`);
}
ok(
  bookCode.includes("ArrowRight") && bookCode.includes("ArrowLeft"),
  "the arrow keys turn the page, which is the only way a keyboard reader can move through the book",
);
ok(
  bookCode.includes("tabIndex={0}"),
  "and the book is focusable, or those key handlers would never receive a key",
);
ok(
  bookCss.includes("touch-action: pan-y"),
  "a horizontal swipe reaches the pointer handlers because the stage claims that axis — with the default touch-action the browser keeps every touch drag for scrolling and the swipe never arrives",
);
ok(
  bookCode.includes("setPointerCapture") && bookCode.includes("DRAG_ENGAGE_PX"),
  "and the pointer is captured only after the gesture proves itself horizontal, so scrolling a leaf taller than the stage does not turn it",
);
ok(
  bookCss.includes("prefers-reduced-motion"),
  "prefers-reduced-motion is honoured in the stylesheet as well as through the tier: the tier is measured once at mount, the preference is live",
);

/* ---------------------- 7. the folio comes from the data ----------------- */

{
  const chapter = POTHI_CHAPTERS.find((entry) => entry.numeral === "VII");
  assert.ok(chapter !== undefined, "expected chapter VII");
  const folio = pothiFolio(chapter);
  ok(
    folio.includes(chapter.devanagariNumeral) && folio.includes("१५"),
    "the folio names this chapter's Devanagari numeral out of fifteen, both read from POTHI_CHAPTERS rather than typed",
  );
  ok(
    leafSource.includes("पृष्ठ"),
    "and the word before them is the same one <LeafPage> inks on an open leaf — mirrored rather than imported, so this assertion is what stops the two formats drifting apart",
  );
  ok(
    folio.startsWith("पृष्ठ "),
    "in that same order",
  );
}

/* ------------------------- 8. the house rules hold ----------------------- */

const COLOUR_LITERAL = /#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(/;

ok(!COLOUR_LITERAL.test(bookCode), "the component invents no colour: every pigment is a token or a material class");
ok(!COLOUR_LITERAL.test(bookCss), "and neither does its stylesheet");
ok(!COLOUR_LITERAL.test(BOOK), "and none reaches the rendered markup");
ok(
  !/border-radius/.test(bookCss),
  "no border-radius anywhere: a rounded rectangle on a bitten sheet is the one detail that turns the whole book back into a card",
);
ok(
  bookCss.includes("@layer components"),
  "the sheet sits in @layer components, so a utility passed through className still wins",
);
ok(
  bookCode.includes("capabilityTier") && !/\btier\s*[:=?]/.test(bookCode.replace(/capabilityTier/g, "")),
  "[R6] the capability type is spelled in full at every prop and never shortened to `tier`, which already means the reading tier",
);

/* ------------------------- 9. the route and its gate --------------------- */

ok(
  routeCode.includes('process.env.NODE_ENV !== "development"') && routeCode.includes("notFound()"),
  "the route is hard-gated to development, the same 404 app/dev/capture and app/sanctuary/materials use — a dev surface over somebody's reading must not exist in production",
);
ok(
  routeCode.includes("robots") && routeCode.includes("index: false"),
  "with robots noindex beside the gate, for the case where a preview branch is ever built with NODE_ENV=development",
);
for (const mounted of ["SanctuaryDefs", "SanctuaryGround", "SanctuaryHeader"]) {
  ok(routeCode.includes(`<${mounted}`), `the route mounts <${mounted} />`);
}
ok(
  routeCode.indexOf("<SanctuaryDefs") < routeCode.indexOf("<SanctuaryGround"),
  "and the sprite is mounted BEFORE anything that references it — a url(#…) resolving to nothing renders unfiltered and silent, which looks like a design decision",
);
ok(
  routeCode.includes('activeHref="/read"'),
  "the header is told which route it is on, because it is a server component and cannot ask usePathname()",
);
ok(
  !routeCode.includes('"use client"'),
  "the page itself ships no client JavaScript: the gate, the sprite, the ground, the header and the masthead are all markup",
);
ok(
  clientCode.includes('"use client"') && clientCode.includes("useCapabilityTier"),
  "the single island is the one place that reads the tab and measures the device — both unknowable on the server",
);

/* ==========================================================================
 * THE MATERIAL HAS TO SURVIVE THE THIRD DIMENSION
 *
 * Four defects found on real captures, all of the same family: the book's 3D
 * machinery quietly deleting the material the whole design is made of. Each is
 * pinned by the mechanism that fixed it rather than by a screenshot, because a
 * screenshot cannot say WHY and every one of these looked like a styling
 * mistake until it was measured.
 * ========================================================================== */
{
  ok(
    !/backface-visibility:\s*hidden/.test(bookCss),
    "no face culls its own back: under a preserve-3d leaf, Chromium drops every descendant that needs a render surface inside a `backface-visibility: hidden` box, which is a <Parchment>'s filtered tear layer and all four of its blended ones — the leaf then paints as bare ground with the plate's linework floating on it, at 0deg, where there is no back face to cull",
  );
  ok(
    /data-snc-face-up/.test(bookCss) && /data-snc-face-up/.test(bookCode),
    "the away face is hidden by a decision the component makes from the leaf's own angle, in both files, rather than by the compositor",
  );
  ok(
    typeof faceUp === "function" && faceUp(0) === "recto" && faceUp(-180) === "verso" && faceUp(-91) === "verso" && faceUp(-89) === "recto",
    "and that decision flips at edge-on, which is where a sheet actually changes the side it shows",
  );
  ok(
    /snc-face-away/.test(bookCss) && /snc-face-toward/.test(bookCss) && /step-end/.test(bookCss),
    "a programmatic turn steps the swap at the halfway point: the attribute already holds the side the leaf will END on, so left alone the far face would appear the instant the turn began",
  );
  ok(
    count(bookCss, "content-visibility: hidden") === 2,
    "every hidden leaf skips painting outright, both the settled turned one and the three off-stage states: `visibility` alone left fourteen sheets' worth of multiply reaching the ground, measured as a hard-edged rectangle at roughly half the luminance of the ground beside it",
  );
  ok(
    /\[data-snc-leaf-state="turned"\]:not\(\[data-snc-turning="true"\]\)/.test(bookCss),
    "and a turned leaf is visible for exactly as long as it is turning: it hinges at its spine, so at rest it lands a full stage-width to the left of centre with its title half outside the window — no viewport is wide enough to close that, because widening moves both edges together",
  );
  ok(
    bookCode.includes("hasPlateContent"),
    "the plate is only given a leaf once there is something to lie on it, so the slot's `:empty` rule still removes an unmeasured chapter's frame",
  );
  /* BOOK is rendered with a reading AND geometry, so it already contains a plate. */
  ok(
    /data-snc-tone="aged"[^>]*>(?:(?!data-snc-tone=)[\s\S]){0,6000}?data-snc-layer="ink"/.test(BOOK),
    "and the plate lies ON that leaf: <PalmPlate> paints no surface of its own — its own header says the caller supplies one — and while no caller did, the measured creases hung on the bare ground of the room with nothing behind them",
  );
}

console.log(`POTHI BOOK ASSERTIONS PASSED (${assertions})`);
