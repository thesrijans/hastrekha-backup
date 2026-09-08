/* ============================================================================
 * POTHI SEALED LEAF — the honesty component, rendered and held to its word
 *
 * WHAT IS PINNED HERE, AND WHY EACH PIN IS A PROMISE RATHER THAN A DETAIL.
 *
 * 1. THE LEAF CLAIMS NOTHING. A2 is the product: a confident-looking empty
 *    state is the failure this build exists to prevent, and a sealed leaf is
 *    the only alternative the Pothi has. So the strongest assertion in this
 *    file is subtractive — strip the markup to visible text, remove the one
 *    fixed Devanagari line and the SealReason's own fields, and require that
 *    what remains contains no letter and no digit. A placeholder sentence, a
 *    hedged reading, a stray label, an invented count: every one of them fails
 *    that, and no gentler assertion catches all four.
 *
 * 2. THE RESCAN BUTTON APPEARS IF AND ONLY IF `capture` DOES. Chapter VII is
 *    sealed because mounts are NEVER measured — /scan sends an empty mount bag
 *    — so its seal carries no capture instruction and the leaf must not offer
 *    a button. Inviting a rescan that cannot help is the same lie as inventing
 *    the reading, wearing a helpful face. Asserted in both directions, on
 *    fixtures AND on the real seals resolveChapter produces, because the two
 *    can drift apart: a component that hard-coded the button would pass every
 *    fixture written by the person who hard-coded it.
 *
 * 3. THE REASON IS RENDERED VERBATIM AND IS NEVER A CONSTANT. Each code below
 *    is fed a detail carrying its own name, and the rendered leaf must contain
 *    that exact string. A component that summarised, truncated or templated the
 *    detail would still look right and would have stopped quoting the response.
 *
 * 4. THE MATERIAL IS REAL. A blank aged, roughly torn <Parchment> with a
 *    <WaxSeal> on it — not a div wearing a tan token. Asserted through the
 *    layer and tone attributes the leaf actually emits and the shared wax
 *    gradient the seal is poured from.
 *
 * 5. NO COLOUR OF ITS OWN, AND NO CLIENT BUNDLE. No hex, rgb() or hsl()
 *    literal in either source file or in the rendered markup, and no
 *    "use client" — a sealed leaf is what a reader sees when something is
 *    missing, and shipping a bundle to tell them so would be its own insult.
 *
 * EVERY SEAL CODE IS DRIVEN, AND THE LIST IS IMPORTED. `SEAL_CODES` is read
 * from lib/sanctuary/pothi-chapters.ts rather than retyped, so a sixteenth code
 * added there arrives here as a rendered leaf on the next run instead of as a
 * gap nobody notices.
 *
 * HOW THIS TEST LOADS A COMPONENT THAT OWNS A STYLESHEET. `tsx` runs these
 * files through Node's CommonJS loader, which cannot parse CSS, so a `.css`
 * handler returning the conventional identity proxy is registered first and the
 * component is required AFTER it exists — hence createRequire rather than a
 * static import, whose require would be hoisted above the patch. The
 * consequence is stated rather than hidden: class names are stubs here, so
 * nothing below asserts on how a class LOOKS. Section 9 asserts only that the
 * component and its stylesheet still name the same set of classes, which is a
 * claim about wiring and survives stubbing intact.
 * ========================================================================== */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import Module, { createRequire } from "node:module";
import path from "node:path";
import { createElement, type ReactElement } from "react";
import { renderToString } from "react-dom/server";
import { SNC_GRADIENT_WAX, defUrl } from "../components/sanctuary/material/ids";
import { POTHI_CHAPTERS, SEAL_CODES, resolveChapter } from "../lib/sanctuary/pothi-chapters";
import type { ChapterState, SealReason } from "../lib/sanctuary/pothi-chapters";
import type { ReadingResponse } from "../app/read/reading-types";
import type { SealedLeafProps } from "../components/sanctuary/pothi/sealed-leaf";

let assertions = 0;
const ok = (condition: boolean, message: string): void => {
  assert.ok(condition, message);
  assertions += 1;
};

/* --------------------- loading the component under test ------------------- */

/** A CSS Modules stand-in: `styles.stack` is the string "stack", so stubbed markup stays readable. */
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

interface SealedLeafModule {
  SealedLeaf: (props: SealedLeafProps) => ReactElement;
  SEALED_LEAF_UNOPENED_HI: string;
  SEALED_LEAF_RESCAN_LABEL: string;
  SEALED_LEAF_RESCAN_PATH: string;
  SEALED_LEAF_RESCAN_PARAM: string;
  sealedLeafRescanHref: (reason: SealReason) => string | null;
}

const COMPONENT_DIR = path.resolve(__dirname, "..", "components", "sanctuary", "pothi");
const {
  SealedLeaf,
  SEALED_LEAF_UNOPENED_HI,
  SEALED_LEAF_RESCAN_LABEL,
  SEALED_LEAF_RESCAN_PATH,
  SEALED_LEAF_RESCAN_PARAM,
  sealedLeafRescanHref,
} = createRequire(__filename)("../components/sanctuary/pothi/sealed-leaf") as SealedLeafModule;

const source = readFileSync(path.join(COMPONENT_DIR, "sealed-leaf.tsx"), "utf8");
const stylesheet = readFileSync(path.join(COMPONENT_DIR, "sealed-leaf.module.css"), "utf8");

/**
 * Both files with their comments removed.
 *
 * Every "this must not appear" assertion runs against these rather than the raw text. The
 * distinction is not pedantry: this component is documented by NAMING what it refuses to do — the
 * warning colour it will not use, the placeholder it will not print — so a prose-level search would
 * fail on the very sentences that explain the rule.
 */
const withoutComments = (text: string): string =>
  text.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1");

const code = withoutComments(source);
const css = withoutComments(stylesheet);

/* --------------------------------- helpers -------------------------------- */

/** One sealed leaf, rendered to the HTML a browser would actually receive. */
const render = (props: SealedLeafProps): string => renderToString(createElement(SealedLeaf, props));

/**
 * The text a reader would actually see: tags dropped, React's `<!-- -->` text separators removed,
 * the five entities React escapes decoded back, whitespace collapsed.
 *
 * Decoding matters for section 7. The real seals contain quotation marks (`Yeh "kam sanket" nahi
 * hai`), which React writes as `&quot;` — leaving them encoded would make the subtractive assertion
 * find leftover letters from the word "quot" and fail on a component that did nothing wrong.
 */
function visibleText(html: string): string {
  return html
    .replace(/<!-- -->/g, "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

/** How many times a literal substring occurs — the only honest way to ask "exactly once". */
function occurrences(haystack: string, needle: string): number {
  let count = 0;
  let at = haystack.indexOf(needle);
  while (at !== -1) {
    count += 1;
    at = haystack.indexOf(needle, at + needle.length);
  }
  return count;
}

/** A seal built by hand, for driving one code through the leaf with a string nothing else could produce. */
function reasonFor(sealCode: string, capture?: string): SealReason {
  return {
    code: sealCode,
    hi: `SUMMARY-LINE-FOR-${sealCode}`,
    detail: `DETAIL-EVIDENCE-FOR-${sealCode} — 7 keys khaali, 3 rule fire hue.`,
    capture,
  };
}

/* ---------------------------- the wire fixture ----------------------------- */

/**
 * A response that seals all fifteen chapters, so the whole book can be rendered as sealed leaves.
 *
 * Built to exercise the capture gate from BOTH sides through the real resolver rather than through
 * hand-written seals: `lines.heart.origin` is capturable (lib/scan/lines.ts extracts that crease),
 * `mounts.jupiter` and `signs.star` are not (nothing produces them at all), and `hand.*` is absent
 * from `missing` entirely — so chapter II gets a capture instruction, chapters I, III, IV, V do not,
 * and VI/VII/XIV are the launch seals that carry none by construction.
 *
 * The two narration strings are deliberately distinctive and deliberately unreferenced by any seal:
 * section 7 asserts they never reach the markup, which is what "this leaf renders no reading" means
 * when the reading is right there in the object being handed in.
 */
const READING: ReadingResponse = {
  readingId: "rd_sealed_leaf_fixture",
  narration: {
    one_liner: "NARRATION-ONE-LINER-THAT-MUST-NEVER-BE-PRINTED",
    sections: [],
    disclaimer: "DISCLAIMER-THAT-MUST-NEVER-BE-PRINTED",
    engine: "template",
  },
  rules: [],
  clusters: [],
  lockedRuleCount: 0,
  confidence: 0.42,
  coverage: {
    provided: ["fingers.length_vs_palm"],
    missing: ["lines.heart.origin", "mounts.jupiter", "signs.star"],
    ratio: 0.11,
  },
};

const RESOLVED: readonly ChapterState[] = POTHI_CHAPTERS.map((chapter) =>
  resolveChapter(chapter, READING, null),
);

const SEALED = RESOLVED.flatMap((state) => (state.status === "sealed" ? [state] : []));

/* ------------- 1. Every chapter of the fixture seals, and renders ---------- */

{
  ok(SEALED.length === POTHI_CHAPTERS.length, "the fixture seals all fifteen chapters, so every leaf here is a sealed one");

  const withCapture = SEALED.filter((state) => state.reason.capture !== undefined);
  const withoutCapture = SEALED.filter((state) => state.reason.capture === undefined);
  ok(withCapture.length > 0, "and at least one real seal carries a capture instruction");
  ok(withoutCapture.length > 0, "and at least one real seal deliberately carries none");

  for (const state of SEALED) {
    const html = render({ reason: state.reason, seed: POTHI_CHAPTERS.indexOf(state.chapter) });
    const text = visibleText(html);
    assert.ok(
      text.includes(SEALED_LEAF_UNOPENED_HI),
      `chapter ${state.chapter.numeral} prints the unopened line`,
    );
    assert.ok(text.includes(state.reason.hi), `chapter ${state.chapter.numeral} prints its reason verbatim`);
    assert.ok(text.includes(state.reason.detail), `chapter ${state.chapter.numeral} prints its detail verbatim`);
    assert.equal(
      text.includes(SEALED_LEAF_RESCAN_LABEL),
      state.reason.capture !== undefined,
      `chapter ${state.chapter.numeral} offers a rescan exactly when a rescan could help`,
    );
  }
  assertions += 1;

  /* The named case the whole gate exists for. Mounts have no producer, so no capture, so no button. */
  const mounts = SEALED.find((state) => state.reason.code === SEAL_CODES.mountsUnmeasured);
  ok(mounts !== undefined, "the fixture reaches the mounts seal");
  ok(mounts?.reason.capture === undefined, "and the data layer gives it no capture instruction");
  ok(
    !render({ reason: mounts!.reason, seed: 7 }).includes(`<a `),
    "so the mounts leaf renders no link at all — a rescan cannot see a mount, and offering one would be a dark pattern",
  );

  console.log(`  fifteen chapters sealed: ${withCapture.length} invite a rescan, ${withoutCapture.length} honestly do not`);
}

/* --------------- 2. Every seal code the data layer can produce ------------- */

{
  const codes = Object.values(SEAL_CODES);
  ok(codes.length === 15, `every seal code is driven through the leaf (${codes.length} of them)`);

  for (const sealCode of codes) {
    const bare = reasonFor(sealCode);
    const bareText = visibleText(render({ reason: bare, seed: 3 }));
    assert.ok(bareText.includes(bare.detail), `${sealCode}: the detail is rendered verbatim`);
    assert.ok(bareText.includes(bare.hi), `${sealCode}: the one-line reason is rendered verbatim`);
    assert.ok(
      !bareText.includes(SEALED_LEAF_RESCAN_LABEL),
      `${sealCode}: no capture means no rescan offer`,
    );

    const capture = `CAPTURE-INSTRUCTION-FOR-${sealCode}`;
    const invited = render({ reason: reasonFor(sealCode, capture), seed: 3 });
    const invitedText = visibleText(invited);
    assert.ok(invitedText.includes(capture), `${sealCode}: the capture instruction is shown to the reader`);
    assert.ok(invitedText.includes(SEALED_LEAF_RESCAN_LABEL), `${sealCode}: and the rescan is offered`);
    assert.ok(
      invited.includes(`href="${SEALED_LEAF_RESCAN_PATH}?${SEALED_LEAF_RESCAN_PARAM}=${sealCode}"`),
      `${sealCode}: the link carries the seal code to /scan`,
    );
  }
  assertions += 1;
  console.log(`  all ${codes.length} seal codes render, both with and without a capture instruction`);
}

/* ------------------- 3. The one fixed line, and only one ------------------- */

{
  /* Pinned as a literal so the exported constant cannot drift: this is the sentence the product
   * says when it has nothing to say, and a silent edit to it is an edit to the product's voice. */
  ok(SEALED_LEAF_UNOPENED_HI === "यह पत्ता अभी खुला नहीं।", "the unopened line is exactly the approved Devanagari");
  ok(
    SEALED_LEAF_UNOPENED_HI.endsWith("।"),
    "and ends in a DEVANAGARI DANDA rather than a Latin full stop, which would drop out of the Tiro face",
  );

  const html = render({ reason: reasonFor(SEAL_CODES.lineUnread), seed: 11 });
  ok(occurrences(visibleText(html), SEALED_LEAF_UNOPENED_HI) === 1, "the leaf says it exactly once");

  /* The constant is the ONLY fixed sentence. A second one would be a placeholder by another name. */
  ok(
    occurrences(code, "।") === 1,
    "and the component carries exactly one danda outside its comments — one fixed sentence, no second constant claiming anything about a hand",
  );
  console.log("  the fixed line is fixed, singular, and about the leaf rather than the reader");
}

/* --------------------- 4. The rescan gate, both ways ---------------------- */

{
  const helpful = reasonFor(SEAL_CODES.areaInsufficient, "Dobara scan karein — hatheli seedhi rakhein.");
  const hopeless = reasonFor(SEAL_CODES.mountsUnmeasured);

  ok(
    sealedLeafRescanHref(helpful) === `${SEALED_LEAF_RESCAN_PATH}?${SEALED_LEAF_RESCAN_PARAM}=${helpful.code}`,
    "the href helper builds <scanner>?rescan=<code> when a rescan can help",
  );
  ok(sealedLeafRescanHref(hopeless) === null, "and returns null when it cannot — one gate, one place");

  const inviting = render({ reason: helpful, seed: 2 });
  ok(
    inviting.includes(`href="${SEALED_LEAF_RESCAN_PATH}?${SEALED_LEAF_RESCAN_PARAM}=${helpful.code}"`),
    "the rendered button links to the scanner",
  );
  ok(
    SEALED_LEAF_RESCAN_PATH === "/scan/chamber",
    "and the scanner it means is the CHAMBER, not the pre-sanctuary /scan: this is the one control a sealed leaf offers, and it used to walk the reader out of the skin they were standing in",
  );
  ok(visibleText(inviting).includes(SEALED_LEAF_RESCAN_LABEL), "and is labelled in Devanagari");

  const quiet = render({ reason: hopeless, seed: 2 });
  ok(!quiet.includes("<a "), "the sealed-forever leaf renders no anchor");
  ok(!quiet.includes(SEALED_LEAF_RESCAN_PATH), "and no path to the scanner anywhere in its markup");
  ok(!visibleText(quiet).includes(SEALED_LEAF_RESCAN_LABEL), "and never shows the rescan words");

  /* The capture sentence is DERIVED per response — it quotes this reading's own missing keys — so it
   * must not travel in a URL where it would land in history and in a Referer header. */
  const derived = reasonFor(SEAL_CODES.lineUnread, "PRIVATE-DETAIL-ABOUT-THIS-READING");
  const rendered = render({ reason: derived, seed: 2 });
  ok(
    visibleText(rendered).includes("PRIVATE-DETAIL-ABOUT-THIS-READING"),
    "the capture instruction is put in front of the reader",
  );
  ok(
    !rendered.includes(`href="/scan?${SEALED_LEAF_RESCAN_PARAM}=PRIVATE-DETAIL`),
    "and never into the query string, which travels in history and referers",
  );
  console.log("  the button is an honest offer: present only where a rescan can genuinely help");
}

/* ------------------------- 5. It is real material ------------------------- */

{
  const html = render({ reason: reasonFor(SEAL_CODES.handShapeUnread), seed: 5 });

  ok(html.includes('data-snc-tone="aged"'), "the leaf is aged — a sealed chapter is the oldest thing in the book");
  ok(html.includes('data-snc-tear="rough"'), "and roughly torn");
  for (const layer of ["sheet", "mottle", "burn", "grain"]) {
    assert.ok(html.includes(`data-snc-layer="${layer}"`), `the real Parchment renders its ${layer} layer`);
  }
  assertions += 1;

  ok(html.includes(defUrl(SNC_GRADIENT_WAX)), "a real WaxSeal is poured from the shared wax gradient");
  ok(html.includes('viewBox="0 0 100 100"'), "and drawn in the seal's own 100-unit box");
  ok(!html.includes("border-radius"), "nothing on the leaf is rounded — the outline is the seeded tear");
  ok(!/aria-hidden="false"|role="alert"|role="status"/.test(html), "the leaf is not an alert; a reader who reaches it made no mistake");

  /* The wax is drawn from a DIFFERENT stream than the tear, so a page of leaves shares no signature. */
  const twin = render({ reason: reasonFor(SEAL_CODES.handShapeUnread), seed: 5 });
  ok(twin === html, "the same seed is the same leaf, byte for byte — otherwise SSR and hydration disagree");
  ok(render({ reason: reasonFor(SEAL_CODES.handShapeUnread), seed: 6 }) !== html, "and two seeds are two leaves");
  console.log("  blank aged leaf, roughly torn, with real wax pressed into it");
}

/* --------------------- 6. No colour, and no client bundle ----------------- */

{
  const COLOUR_LITERAL = /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})\b|\brgba?\(|\bhsla?\(/;
  ok(!COLOUR_LITERAL.test(code), "the component names no colour of its own");
  ok(!COLOUR_LITERAL.test(css), "and neither does its stylesheet — every colour is a --color-snc-* token");
  ok(!COLOUR_LITERAL.test(render({ reason: reasonFor(SEAL_CODES.readingEmpty, "x"), seed: 9 })), "nor does the markup it emits");

  ok(!/["']use client["']/.test(code), "no \"use client\": there is no state, no effect and no handler here");
  ok(!/useState|useEffect|onClick|onChange/.test(code), "and nothing that would need one");

  /* No warning register anywhere. The only red in this composition is the wax, which <WaxSeal>
   * paints from the shared gradient — this file never reaches for ink-red itself. */
  ok(!/ink-red|--color-snc-flame/.test(css), "no warning colour beyond the wax itself");
  console.log("  token-only colour, zero client JavaScript, no alert register");
}

/* ---------------- 6b. A SealReason is mixed script, and is set so --------- */

{
  /*
   * FOUND BY RENDERING A REAL SEAL, NOT BY READING THE SPEC. `lineUnread.hi` is built as
   * `${chapter.titleHi} par is paath mein kuch nahi aaya.`, so chapter II's reason opens
   * "हृदय रेखा" in Devanagari and finishes in Latin — one sentence, two scripts. Set in the Latin
   * serif alone, those first two words fall past Cormorant and every named Latin fallback to the
   * UA's last resort, which is a different face on every OS and none of them chosen.
   *
   * So every class that can receive SealReason text must name BOTH stacks. This is pinned rather
   * than trusted because the defect is invisible in review (the CSS looks tidy), invisible in
   * English (a Hinglish-only seal renders perfectly), and invisible in this suite's other
   * assertions — the text is present either way.
   */
  const mixed = SEALED.find((state) => state.chapter.numeral === "II");
  ok(mixed !== undefined, "the fixture reaches a chapter whose reason opens in Devanagari");
  ok(
    /[ऀ-ॿ]/.test(mixed?.reason.hi ?? "") && /[A-Za-z]/.test(mixed?.reason.hi ?? ""),
    "and that reason really is one sentence in two scripts",
  );

  /** The declared font stack for one class, comments already stripped. */
  const fontStack = (className: string): string => {
    const at = css.indexOf(`.${className} {`);
    assert.ok(at !== -1, `the stylesheet declares .${className}`);
    const block = css.slice(at, css.indexOf("}", at));
    const declared = /font-family:([^;]+);/.exec(block);
    assert.ok(declared !== null, `.${className} declares a font-family`);
    return declared[1];
  };

  for (const className of ["reason", "detail", "instruction"]) {
    const stack = fontStack(className);
    assert.ok(
      stack.includes("--font-snc-serif") && stack.includes("--font-snc-devanagari"),
      `.${className} carries both scripts' faces — SealReason text is mixed script`,
    );
    assert.ok(
      stack.indexOf("--font-snc-serif") < stack.indexOf("--font-snc-devanagari"),
      `.${className} names the serif FIRST — Tiro is subsetted to devanagari and has no Latin glyphs at all`,
    );
  }
  assertions += 2;
  console.log("  mixed-script reasons are set in both faces, serif first");
}

/* ------------------ 7. The leaf claims no reading whatsoever -------------- */

{
  /*
   * The subtractive assertion, and the reason this file exists. Everything the leaf is ALLOWED to
   * say is removed from the visible text; anything left with a letter or a digit in it is a string
   * the component invented, and an invented string on a leaf about someone's life is the exact
   * failure A2 names.
   */
  for (const state of SEALED) {
    const reason = state.reason;
    const text = visibleText(render({ reason, seed: 4 }));
    const permitted = [SEALED_LEAF_UNOPENED_HI, reason.hi, reason.detail, reason.capture ?? "", SEALED_LEAF_RESCAN_LABEL];
    let residue = text;
    for (const allowed of permitted) {
      if (allowed.length > 0) residue = residue.split(allowed).join(" ");
    }
    assert.ok(
      !/[\p{L}\p{N}]/u.test(residue),
      `chapter ${state.chapter.numeral} invents nothing; leftover text was "${residue.trim()}"`,
    );
    assert.ok(
      !text.includes(READING.narration.one_liner) && !text.includes(READING.narration.disclaimer),
      `chapter ${state.chapter.numeral} prints no narration`,
    );
  }
  assertions += 2;

  /* Named failure modes, spelled out so the intent survives a refactor of the loop above. */
  const html = visibleText(render({ reason: reasonFor(SEAL_CODES.areaAbsent), seed: 1 }));
  ok(!/lorem|ipsum|coming soon|placeholder|TODO/i.test(html), "no placeholder copy");
  ok(!/anukool|mishrit|sambhalke/i.test(html), "no direction verdict");
  ok(!/AI Interpretation|Brihat Samhita|Hastarekha Shastra/i.test(html), "and none of the struck provenance names");
  console.log("  subtractive check clean on all fifteen: every printed string came from the response");
}

/* ---------------------- 8. Component and stylesheet agree ----------------- */

{
  const used = new Set<string>();
  for (const match of code.matchAll(/styles\.([A-Za-z][A-Za-z0-9_]*)/g)) used.add(match[1]);

  const defined = new Set<string>();
  for (const match of css.matchAll(/^\s*\.([A-Za-z][A-Za-z0-9_]*)/gm)) defined.add(match[1]);

  ok(used.size >= 5, "the leaf is laid out by its stylesheet rather than by inline style, which is what keeps it overridable");
  ok(
    [...used].every((name) => defined.has(name)),
    `every class the component names is defined: ${[...used].filter((name) => !defined.has(name)).join(", ") || "none missing"} — a name that resolves to undefined renders an unstyled block, not an error`,
  );
  ok(
    [...defined].every((name) => used.has(name)),
    `and the stylesheet carries no orphan: ${[...defined].filter((name) => !used.has(name)).join(", ") || "none orphaned"} — an unused rule is a layer that was dropped or a rename left half done`,
  );
  console.log(`  ${used.size} classes, all named by both files`);
}

console.log(`POTHI SEALED LEAF ASSERTIONS PASSED (${assertions})`);
