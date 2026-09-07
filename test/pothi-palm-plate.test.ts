/* ============================================================================
 * POTHI PALM PLATE — the left page: the hand-off contract, the projection, and
 * the three things the plate is allowed to draw
 *
 * WHAT IS PINNED HERE, AND WHY EACH PIN IS A PROMISE RATHER THAN A DETAIL.
 *
 * 1. A MALFORMED HAND-OFF READS AS ABSENT, NEVER AS A HALF-DRAWN HAND. The blob
 *    comes from a previous page load, possibly written by a previous deploy,
 *    possibly edited by hand in devtools. Every way it can be wrong — missing,
 *    unparseable, right-shaped-wrong-typed, a storage that throws on the
 *    property access — has to end at the same `null`, because `null` is the one
 *    answer the leaf has an honest rendering for. A validator that repaired half
 *    a blob would put a confident wrong palm in front of a reader, which is the
 *    A2 failure the whole Pothi exists to prevent.
 *
 * 2. THE POLYLINE SCALES BY `space`, AND THE WRONG `space` IS VISIBLY WRONG.
 *    This is the regression pin, and it has a scar behind it: the traces are
 *    made in MASK_SIZE (128) space while the crop they came from is 256, and a
 *    projection that assumes either constant draws the whole hand at half or
 *    twice its true size. That looks like a small hand, not like a bug. So both
 *    directions are asserted — the right space spans the plate, the wrong space
 *    demonstrably does not — and neither literal may appear in the source.
 *
 * 3. THE CROP IS SESSION-ONLY, AND ITS ABSENCE IS STATED IN THE MARGIN. R3:
 *    prisma says "no images, ever" and /scan promises the reader the same. A
 *    revisited reading therefore has no crop, and the plate must fall back to
 *    the neutral diagram WITH the Devanagari note rather than quietly dropping
 *    to a picture that no longer says whose hand it is. The note is asserted by
 *    its exact text, because a reworded promise is a different promise.
 *
 * 4. THE CHAPTER'S OWN LINE LEADS. Exactly one line at the active rung, every
 *    other at the secondary — a plate of four equal creases makes the reader
 *    hunt for the subject of the page.
 *
 * 5. NO COLOUR OF ITS OWN, AND NO CLIENT BUNDLE. Every colour resolves to a
 *    --color-snc-* token, so no hex may appear in any of the three files; and
 *    the component carries no "use client", because it has no state and a
 *    directive added by habit would ship React to every device for a picture.
 *
 * HOW THIS TEST LOADS A COMPONENT THAT OWNS A STYLESHEET.
 *
 * `tsx` runs these files through Node's CommonJS loader, which cannot parse CSS
 * — importing palm-plate.tsx directly would throw on its `.module.css` import
 * before a single assertion ran. The fix, copied from test/material-parchment
 * .test.ts, is to register a `.css` handler returning the identity proxy CSS
 * Modules are conventionally stubbed with, then require the component AFTER the
 * handler exists. One consequence is stated rather than hidden: MODULE class
 * names are stubs here, so nothing below asserts on one. The two class names
 * that ARE asserted — `snc-stroke-active` and `snc-stroke-secondary` — are
 * GLOBAL classes declared in app/sanctuary.css and written as literal strings in
 * the component, so they survive the stub and mean exactly what they say.
 * ========================================================================== */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import Module, { createRequire } from "node:module";
import path from "node:path";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import {
  POTHI_CROP_MAX_CHARS,
  POTHI_GEOMETRY_SESSION_KEY,
  POTHI_PLATE_LINE_IDS,
  POTHI_PLATE_SIZE,
  isPothiGeometry,
  pothiPlatePaths,
  pothiPolylinePath,
  readPothiGeometry,
  toChapterGeometry,
  writePothiGeometry,
  type PothiGeometry,
  type PothiGeometryStorage,
} from "../lib/sanctuary/pothi-geometry";
import type { PalmPlateProps } from "../components/sanctuary/pothi/palm-plate";

let assertions = 0;
const ok = (condition: boolean, message: string): void => {
  assert.ok(condition, message);
  assertions += 1;
};

/* --------------------- loading the component under test ------------------- */

/** A CSS Modules stand-in: `styles.ink` is the string "ink", so stubbed markup stays readable in a failure message. */
const CLASS_NAME_STUB: Record<string, string> = new Proxy(
  {},
  { get: (_target, key): string | undefined => (typeof key === "string" ? key : undefined) },
) as Record<string, string>;

interface CjsExtensionHost {
  _extensions: Record<string, (loaded: { exports: unknown }, filename: string) => void>;
}

/* `__esModule: true` rather than exporting the proxy directly: the interop
 * wrapper esbuild emits asks a CommonJS export whether it is an ES module, and a
 * bare proxy would answer with the string "__esModule" — truthy — and hand back
 * the wrong object. */
(Module as unknown as CjsExtensionHost)._extensions[".css"] = (loaded): void => {
  loaded.exports = { __esModule: true, default: CLASS_NAME_STUB };
};

interface PalmPlateModule {
  PalmPlate: (props: PalmPlateProps) => ReturnType<typeof createElement> | null;
  NEUTRAL_PALM_PATH: string;
  POTHI_PLATE_ORIGINAL_NOT_KEPT: string;
  POTHI_PLATE_LINE_LABELS: Readonly<Record<string, string>>;
}

const ROOT = path.resolve(__dirname, "..");
const { PalmPlate, NEUTRAL_PALM_PATH, POTHI_PLATE_ORIGINAL_NOT_KEPT, POTHI_PLATE_LINE_LABELS } = createRequire(
  __filename,
)("../components/sanctuary/pothi/palm-plate") as PalmPlateModule;

const SOURCES: Readonly<Record<string, string>> = {
  geometry: readFileSync(path.join(ROOT, "lib", "sanctuary", "pothi-geometry.ts"), "utf8"),
  component: readFileSync(path.join(ROOT, "components", "sanctuary", "pothi", "palm-plate.tsx"), "utf8"),
  stylesheet: readFileSync(path.join(ROOT, "components", "sanctuary", "pothi", "palm-plate.module.css"), "utf8"),
};

/**
 * A file with its comments removed.
 *
 * Every "this must not appear" assertion runs against this rather than the raw
 * text, and the distinction is not pedantry: these files are documented by
 * NAMING what they refuse to do — the 128-versus-256 confusion, the border
 * radius, the hex — so a prose-level search would fail on the very sentences
 * that explain the rule. What is forbidden is the DECLARATION.
 */
const withoutComments = (text: string): string =>
  text.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1");

const code = {
  geometry: withoutComments(SOURCES.geometry),
  component: withoutComments(SOURCES.component),
  stylesheet: withoutComments(SOURCES.stylesheet),
};

/* --------------------------------- helpers -------------------------------- */

/** A real 1×1 PNG. Short, and genuinely a `data:image/` URL, so the validator is exercised rather than fooled. */
const CROP =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

/** Mask-space points: the traced space /scan works in, spanning the full square corner to corner. */
const MASK_SPAN: readonly (readonly [number, number])[] = [
  [0, 0],
  [64, 40],
  [128, 128],
];

function geometry(over: Partial<PothiGeometry> = {}): PothiGeometry {
  return {
    sessionId: "sess-7f2",
    capturedAt: "2026-09-07T10:15:00.000Z",
    lines: { heart: MASK_SPAN, head: MASK_SPAN },
    space: 128,
    ...over,
  };
}

/** A storage backed by one string, or by a thrower — the three failure modes a real browser has. */
function storageOf(value: string | null): PothiGeometryStorage {
  let held = value;
  return {
    getItem: (): string | null => held,
    setItem: (_key: string, next: string): void => {
      held = next;
    },
  };
}

const throwingStorage: PothiGeometryStorage = {
  getItem: (): string | null => {
    throw new Error("SecurityError: the operation is insecure");
  },
  setItem: (): void => {
    throw new Error("QuotaExceededError");
  },
};

const render = (props: PalmPlateProps): string => renderToString(createElement(PalmPlate, props));

/** Every number in a path `d`, so "does it span the viewBox" can be asked of the emitted string. */
const numbersIn = (d: string): number[] => (d.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);

/**
 * The opening tag containing a marker.
 *
 * Every rung assertion is scoped through this, so "the heart line is active"
 * cannot be satisfied by an `snc-stroke-active` belonging to some other path in
 * the same drawing — which is exactly the mistake a copied-and-edited element
 * makes.
 */
const tagWith = (markup: string, marker: string): string => {
  const at = markup.indexOf(marker);
  assert.ok(at !== -1, `expected the plate to render an element marked ${marker}`);
  const open = markup.lastIndexOf("<", at);
  const close = markup.indexOf(">", at);
  assert.ok(open !== -1 && close !== -1, `expected ${marker} to sit inside a complete tag`);
  return markup.slice(open, close + 1);
};

/** How many times a literal substring occurs — the only honest way to ask "exactly one active line". */
const count = (haystack: string, needle: string): number => haystack.split(needle).length - 1;

/* ============================ 1. The hand-off reads as absent ============== */

{
  /* The three the brief names, in the three ways a browser actually produces
   * them: nothing written yet, a blob that is not JSON, and Safari's private
   * mode where even touching storage raises. */
  ok(readPothiGeometry(storageOf(null)) === null, "an empty session reads as absent, not as an empty hand");
  ok(readPothiGeometry(storageOf("{not json")) === null, "an unparseable blob reads as absent rather than throwing into a render");
  ok(readPothiGeometry(throwingStorage) === null, "a storage that throws on access reads as absent — private mode is not an error state");

  /* And the two that are easiest to get wrong, because they parse cleanly. */
  ok(readPothiGeometry(storageOf('{"sessionId":"a"}')) === null, "valid JSON of the wrong shape is still absent: parsing is not validating");
  ok(readPothiGeometry(null) === null, "no storage at all (SSR, where there is no window) reads as absent");
}

/* ============================ 2. The validator is strict ================== */

{
  ok(isPothiGeometry(geometry()), "the fixture the rest of this file is built on is genuinely valid");
  ok(isPothiGeometry(geometry({ lines: {}, cropDataUrl: CROP })), "a crop with no traced line is a real hand-off: the image alone is worth showing");

  ok(!isPothiGeometry(geometry({ space: 0 })), "a space of zero is rejected: it would project every coordinate to infinity");
  ok(!isPothiGeometry(geometry({ space: Number.NaN })), "a non-finite space is rejected rather than emitting NaN into a path");
  ok(!isPothiGeometry(geometry({ sessionId: "  " })), "a blank session id is absent data wearing a present type");
  ok(!isPothiGeometry(geometry({ capturedAt: "yesterday" })), "a timestamp that does not parse is malformed, not merely informal");
  ok(
    !isPothiGeometry(geometry({ cropDataUrl: "https://example.test/hand.jpg" })),
    "a network crop is rejected: R3 keeps the image inside the tab, and a fetched hand would leave it",
  );
  ok(
    !isPothiGeometry(geometry({ cropDataUrl: `data:image/png;base64,${"A".repeat(POTHI_CROP_MAX_CHARS)}` })),
    "an oversized crop is rejected at the boundary rather than wedging the session quota silently",
  );
  ok(
    !isPothiGeometry({ ...geometry(), lines: { heart: MASK_SPAN, marriage: MASK_SPAN } }),
    "an unknown line id is rejected whole: a fifth crease means the writer and the reader disagree about the contract",
  );
  ok(
    !isPothiGeometry(geometry({ lines: { heart: [[4, 4]] } })),
    "a one-point line is rejected: an M with no L paints nothing while every surrounding check still passes",
  );
  ok(
    !isPothiGeometry(geometry({ lines: { heart: [[4, 4], [Number.POSITIVE_INFINITY, 2]] } })),
    "a non-finite coordinate is rejected: one bad point is a line that leaves the plate",
  );
  ok(!isPothiGeometry(geometry({ lines: {} })), "neither crop nor line carries nothing to draw, so it reads as absent and the caller seals the leaf");
  ok(!isPothiGeometry(null) && !isPothiGeometry([]) && !isPothiGeometry("{}"), "null, an array and a string are not hand-offs");
}

/* ============================ 3. Round trip and refusal =================== */

{
  const store = storageOf(null);
  ok(writePothiGeometry(geometry({ cropDataUrl: CROP }), store), "a valid hand-off is stored");
  const back = readPothiGeometry(store);
  ok(back !== null && back.space === 128 && back.cropDataUrl === CROP, "and reads back identical — the round trip is the contract");
  ok(back !== null && back.lines.heart?.length === MASK_SPAN.length, "including every traced point, not a truncated line");

  ok(
    !writePothiGeometry(geometry({ space: -1 }), storageOf(null)),
    "the writer refuses a blob its own reader would reject: failing at the scanner is a bug, failing at the leaf is a mystery",
  );
  ok(!writePothiGeometry(geometry(), throwingStorage), "a full or blocked quota returns false instead of throwing into the scan flow");
  ok(!writePothiGeometry(geometry(), null), "no storage means not stored, and the Pothi falls back to the neutral diagram");

  ok(
    POTHI_GEOMETRY_SESSION_KEY.startsWith("hastrekha:") && /:v\d+$/.test(POTHI_GEOMETRY_SESSION_KEY),
    "the key is namespaced and versioned, so an old writer and a new reader never meet a half-understood blob",
  );
}

/* ================= 4. THE REGRESSION PIN: the polyline scales by `space` === */

{
  /*
   * The whole bug, in two lines. Identical points; only the declared space
   * differs. With the space they were actually traced in the path fills the
   * plate; with the crop's space it covers a quarter of it — a small hand, which
   * is why this failed review the first time it shipped.
   */
  const correct = pothiPolylinePath(MASK_SPAN, 128);
  const wrong = pothiPolylinePath(MASK_SPAN, 256);
  assert.ok(correct !== null && wrong !== null, "both projections produce a path at all");

  const spread = Math.max(...numbersIn(correct));
  const shrunk = Math.max(...numbersIn(wrong));
  ok(spread === POTHI_PLATE_SIZE, `space=128 spans the viewBox: the path reaches ${spread} of ${POTHI_PLATE_SIZE}`);
  ok(shrunk < POTHI_PLATE_SIZE, `the same points at space=256 do NOT span it: the path stops at ${shrunk}`);
  ok(shrunk === POTHI_PLATE_SIZE / 2, "and it is short by exactly the ratio of the two spaces, which is what makes the failure a projection bug and not a rounding one");
  ok(correct.startsWith("M ") && correct.includes(" L "), "the path is a moveto followed by linetos: measurements, not a spline fitted through them");

  ok(pothiPolylinePath(MASK_SPAN, 0) === null, "a space of zero yields no path rather than a path of infinities");
  ok(pothiPolylinePath([[1, 1]], 128) === null, "a one-point line yields no path");
  ok(pothiPolylinePath(undefined, 128) === null, "an absent line yields no path");

  ok(
    !/\b(?:128|256)\b/.test(code.geometry) && !/\b(?:128|256)\b/.test(code.component),
    "neither source carries 128 or 256 as a literal: the space is what the hand-off says it is, every single time",
  );

  const projected = pothiPlatePaths(geometry());
  ok(
    projected.length === 2 && projected[0].id === "heart" && projected[1].id === "head",
    "lines come back in the module's fixed order, not in the writer's key order, so two renders of one hand-off agree byte for byte",
  );
}

/* ============================ 5. The adapter ============================== */

{
  const chapter = toChapterGeometry(geometry());
  ok(chapter.size === 128, "`space` becomes `size` — the same number under the resolver's name for it");
  ok(chapter.lines.length === 2 && chapter.lines.every((line) => line.observedFraction === null), "observedFraction is null and never invented: the hand-off does not carry it");
  ok(
    chapter.lines.map((line) => line.id).join(",") === "heart,head",
    "and the resolver sees the same fixed order the plate draws in",
  );
}

/* ================= 6. Nothing measured survived: render nothing =========== */

{
  ok(render({ lineId: "heart", geometry: null }) === "", "no hand-off renders nothing at all — the caller seals the leaf with a reason this component does not know");
  ok(
    render({ lineId: "heart", geometry: { ...geometry(), lines: {} } }) === "",
    "and a hand-off with no crop and no line renders nothing rather than a frame around an empty square",
  );
}

/* ============== 7. Revisited: the neutral diagram and the note ============= */

{
  const revisited = render({ lineId: "heart", geometry: geometry() });
  ok(revisited.includes(NEUTRAL_PALM_PATH), "with no crop the plate draws the neutral palm diagram it authors itself");
  ok(
    revisited.includes(POTHI_PLATE_ORIGINAL_NOT_KEPT),
    "and states the reason in the margin, in the exact words of the promise: a reworded promise is a different promise",
  );
  ok(revisited.includes('data-snc-plate="neutral"'), "the state is published on the figure, so a leaf above can style it and a reviewer can see it in devtools");
  ok(!revisited.includes("<image"), "no crop element is emitted when there is no crop — an empty <image> would be a broken picture, not an absence");
  ok(
    tagWith(revisited, 'data-snc-part="neutral-palm"').includes("snc-stroke-secondary"),
    "the diagram is drawn at the secondary rung: it is context for the measured line, never a claim of its own",
  );
  ok(
    !/[Zz]/.test(NEUTRAL_PALM_PATH) && count(NEUTRAL_PALM_PATH, "M ") === 4,
    "the outline is open, in four subpaths: the fingers run off the top of the crop, and a rounded fingertip drawn inside the frame would claim they end there",
  );
  ok(
    numbersIn(NEUTRAL_PALM_PATH).every((value) => value >= 0 && value <= POTHI_PLATE_SIZE),
    "and every coordinate of it sits inside the plate, so nothing of the diagram spills onto the leaf around it",
  );

  /*
   * THE REGISTRATION PIN, and the reason this diagram is not a free drawing.
   *
   * A polyline projected onto the neutral palm was measured in a crop whose
   * framing is decided by CANONICAL_ANCHORS in lib/scan/rectify.ts. If the
   * outline disagrees with that framing, every crease lands somewhere the
   * reader's crease is not — a heart line across the knuckles, on a picture that
   * still looks finished. So the anchors are READ from the rectifier rather than
   * retyped here, and a retune there fails this suite instead of silently
   * sliding the drawing out from under the ink.
   */
  const rectify = readFileSync(path.join(ROOT, "lib", "scan", "rectify.ts"), "utf8");
  const anchorPairs = [...rectify.matchAll(/\{\s*x:\s*(-?[\d.]+),\s*y:\s*(-?[\d.]+)\s*\}/g)]
    .map((match) => [Number(match[1]) * POTHI_PLATE_SIZE, Number(match[2]) * POTHI_PLATE_SIZE] as const)
    .filter(([x, y]) => x > 0 && x < POTHI_PLATE_SIZE && y > 0 && y < POTHI_PLATE_SIZE);
  ok(anchorPairs.length >= 5, `the rectifier's canonical anchors were found and read: ${anchorPairs.length} of them`);

  /** Every on-curve endpoint of a path — the last coordinate pair of each command. */
  const endpoints = (d: string): (readonly [number, number])[] =>
    (d.match(/[MLCQ][^MLCQZ]*/g) ?? []).map((segment) => {
      const nums = numbersIn(segment);
      return [nums[nums.length - 2], nums[nums.length - 1]] as const;
    });
  const nearest = (point: readonly [number, number]): number =>
    Math.min(...endpoints(NEUTRAL_PALM_PATH).map(([x, y]) => Math.hypot(x - point[0], y - point[1])));

  /* Three anchors sit ON the silhouette — the wrist, the thumb root, the ulnar
   * percussion bulge — so the outline must pass through them, not near them. */
  const onEdge = anchorPairs.filter((anchor) => nearest(anchor) <= 1.5);
  ok(onEdge.length >= 3, `the wrist, the thumb root and the percussion bulge lie on the drawn edge: ${onEdge.length} anchors within 1.5 units of it`);

  /* The other two are KNUCKLE CENTRES, so the nearest edge is half a finger
   * away by construction; the pin there is that they land on the drawn hand at
   * all rather than beside it. */
  ok(
    anchorPairs.every((anchor) => nearest(anchor) <= 10),
    "and the two knuckle anchors fall within half a finger of the outline, so the fingers are drawn where the rectifier puts them",
  );
  ok(
    render({ lineId: "heart", geometry: geometry() }).includes(POTHI_PLATE_LINE_LABELS.heart),
    "the accessible label names the line actually drawn, so a screen reader is told which crease leads",
  );
}

/* ================= 8. Measured: the crop, aged, with no note =============== */

{
  const measured = render({ lineId: "heart", geometry: geometry({ cropDataUrl: CROP }) });
  ok(measured.includes(CROP), "with a crop the plate draws the crop");
  ok(measured.includes('data-snc-plate="measured"'), "and says so on the figure");
  ok(!measured.includes(NEUTRAL_PALM_PATH), "the neutral diagram is absent: it is a fallback, never a backdrop under a real hand");
  ok(
    !measured.includes(POTHI_PLATE_ORIGINAL_NOT_KEPT),
    "and the margin note is absent, because the original image IS here — the note is a fact about the session, not a disclaimer to sprinkle",
  );
  ok(
    measured.includes('data-snc-layer="wash"') && measured.includes('data-snc-layer="burn"'),
    "the aging is real layers over the image, not a single opacity: a wash that multiplies the parchment through it and a burn at the rim",
  );
  ok(count(measured, 'preserveAspectRatio="none"') >= 2, "image and ink share one square exactly — any letterbox would slide the ink off the creases it was traced from");
}

/* ================= 9. The chapter's own line leads ======================== */

{
  const full = geometry({ lines: { heart: MASK_SPAN, head: MASK_SPAN, life: MASK_SPAN }, cropDataUrl: CROP });
  const markup = render({ lineId: "head", geometry: full });

  ok(count(markup, "snc-stroke-active") === 1, "exactly one line is at the active rung: a plate of equal creases makes the reader hunt for the subject of the page");
  ok(tagWith(markup, 'data-snc-line="head"').includes("snc-stroke-active"), "and it is the chapter's own line");
  ok(
    tagWith(markup, 'data-snc-line="heart"').includes("snc-stroke-secondary") &&
      tagWith(markup, 'data-snc-line="life"').includes("snc-stroke-secondary"),
    "every other measured line recedes to the secondary rung rather than being hidden — context stays visible",
  );
  ok(count(markup, "snc-stroke-secondary") === 2, "and only those two: no third weight has crept in");
  ok(
    count(markup, 'vector-effect="non-scaling-stroke"') === 3,
    "every stroke is a screen-pixel width, so the ladder's 1px and 2px survive the plate being rendered at any size",
  );

  /* A chapter whose own line was not traced still shows the others honestly. */
  const missing = render({ lineId: "fate", geometry: full });
  ok(count(missing, "snc-stroke-active") === 0, "a chapter whose crease was never traced draws no active line rather than promoting a neighbour's");
  ok(count(missing, "snc-stroke-secondary") === 3, "the three that were traced are still drawn, at the rung that claims nothing");
}

/* ================= 10. The particle: once, and off at FLOOR =============== */

{
  const props: PalmPlateProps = { lineId: "heart", geometry: geometry({ cropDataUrl: CROP }) };
  const high = render({ ...props, capabilityTier: "HIGH" });
  const floor = render({ ...props, capabilityTier: "FLOOR" });

  ok(high.includes("trailAnimated"), "above FLOOR the particle's animation class is emitted");
  ok(!floor.includes("trailAnimated"), "at FLOOR it is not: the cheapest devices never allocate the animation at all");
  ok(floor.includes('data-snc-part="trail"') === true, "the particle element itself is still emitted, invisible by its base state — the tier removes motion, never material");
  ok(high.includes("--snc-plate-trail:path("), "and it travels the measured line, handed over as the motion path rather than re-derived");
  ok(
    /@media \(prefers-reduced-motion: reduce\)[\s\S]*animation: none/.test(code.stylesheet),
    "a reader who asked for stillness stops it a second time, because the tier is measured once at mount while the preference is live",
  );
  ok(
    code.stylesheet.includes("@supports (offset-path:"),
    "and a browser without motion paths gets no animation rather than a dot parked in the corner for two seconds",
  );
  ok(
    /\.trail\s*\{[^}]*opacity:\s*0/.test(code.stylesheet),
    "the particle's base state is invisible, which is what makes every one of those failures silent instead of visible",
  );
}

/* ================= 11. No colour, no dash, no card, no bundle ============= */

{
  const HEX = /#[0-9a-fA-F]{3,8}\b/;
  for (const [name, text] of Object.entries(code)) {
    ok(!HEX.test(text), `${name} carries no hex literal: every colour is a --color-snc-* token or the shared gold ramp`);
  }
  ok(
    !/border-radius/.test(code.stylesheet) && !/borderRadius/.test(code.component),
    "no border-radius anywhere: the plate lies on a torn leaf, and a rounded rectangle on a bitten sheet is a card",
  );
  ok(
    !/stroke-dasharray|strokeDasharray/.test(code.component) && !/stroke-dasharray/.test(code.stylesheet),
    "and no dash: solid strokes only, everywhere in the product",
  );
  ok(!/["']use client["']/.test(code.component), "the plate is markup — no state, no effect, no handler — so it ships no client bundle of its own");
  ok(
    !/window\.|sessionStorage/.test(code.component),
    "and it touches no browser API: reading storage is the caller's job, which is what keeps this renderable on the server and in this test",
  );
  ok(
    POTHI_PLATE_LINE_IDS.length === 4 && !POTHI_PLATE_LINE_IDS.includes("sun" as never),
    "only the four extracted creases can reach a plate: a RESERVED line has no extractor, so its polyline could only have been invented",
  );
}

console.log(`POTHI PALM PLATE ASSERTIONS PASSED (${assertions})`);
