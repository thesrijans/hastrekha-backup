/* ============================================================================
 * DEVANAGARI IS NEVER LETTER-SPACED
 *
 * Latin display type is tracked here on purpose — Cinzel is an inscriptional
 * face whose capitals were cut to stand apart, and the small-caps voices in this
 * product carry 0.1em to 0.24em. Devanagari cannot take any of it. A conjunct is
 * one glyph assembled from parts, and letter-spacing inserts space between those
 * parts, so tracking does not merely loosen the script: it takes it apart.
 *
 * Captured on real pages before this pass, with the computed values read off the
 * live DOM rather than inferred:
 *
 *   ॥ हस्तरेखा ॥   .wordmarkDevanagari   2.9952px   rendered "ह स्त रे खा"
 *   पोथी           tracking-[0.3em]      3.84px     rendered "पो थी"
 *   ०३             .versoNumeral         3.84px
 *   पृष्ठ ०३ / १५    .folio                1.0496px
 *   हाथ का आकार     .versoTitle           1.008px
 *
 * Eleven rules in total. Every one of them had inherited its tracking from the
 * Latin voice it was written beside, which is exactly how this defect arrives:
 * nobody sets out to letter-space Devanagari, they copy a caption class.
 *
 * THREE CHECKS, because the defect has three shapes. A rule that sets the face
 * and the tracking together (the eleven above). A Tailwind class string that
 * does the same thing in markup. And tracking INHERITED from an ancestor, which
 * neither of the first two can see — that one is caught by rendering the
 * components and walking each Devanagari text node's ancestor chain.
 *
 * WHAT THIS CANNOT CATCH, stated plainly: this suite has no DOM and no cascade,
 * so a tracked ancestor that is not one of the rendered components' own elements
 * — a utility applied by a route, say — is outside its reach. The browser
 * measurement above is the evidence for the current state; this is what keeps it.
 * ========================================================================== */
import assert from "node:assert/strict";
import Module from "node:module";
import { createRequire } from "node:module";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { createElement, type ReactElement } from "react";
import { renderToString } from "react-dom/server";

let assertions = 0;
const ok = (condition: boolean, message: string): void => {
  assert.ok(condition, message);
  assertions += 1;
};

/** `styles.foo` becomes "foo", so a rendered class maps straight back to its source selector. */
const CLASS_NAME_STUB: Record<string, string> = new Proxy(
  {},
  { get: (_t, key) => (typeof key === "string" ? key : "") },
);
interface CjsExtensionHost {
  _extensions: Record<string, (loaded: { exports: unknown }, filename: string) => void>;
}
(Module as unknown as CjsExtensionHost)._extensions[".css"] = (loaded): void => {
  loaded.exports = { __esModule: true, default: CLASS_NAME_STUB };
};

const ROOT = path.resolve(__dirname, "..");
const DEVANAGARI = /[ऀ-ॿ]/;
const FACE = "--font-snc-devanagari";

const SANCTUARY_ROOTS = [
  path.join(ROOT, "app", "read", "pothi"),
  path.join(ROOT, "app", "scan", "chamber"),
  path.join(ROOT, "app", "sanctuary"),
  path.join(ROOT, "components", "sanctuary"),
];

function walk(dir: string, match: RegExp): string[] {
  let out: string[] = [];
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) out = out.concat(walk(full, match));
    else if (match.test(full)) out.push(full);
  }
  return out;
}

const stripComments = (text: string): string => text.replace(/\/\*[\s\S]*?\*\//g, "");

/** Every CSS rule in the sanctuary, as { file, selector, body }. */
interface Rule {
  readonly file: string;
  readonly selector: string;
  readonly body: string;
}
const RULES: Rule[] = SANCTUARY_ROOTS.flatMap((root) => walk(root, /\.css$/)).flatMap((file) => {
  const css = stripComments(readFileSync(file, "utf8"));
  const out: Rule[] = [];
  const pattern = /([.#][\w-]+)\s*\{([^}]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = pattern.exec(css)) !== null) out.push({ file, selector: m[1], body: m[2] });
  return out;
});

const declaration = (body: string, property: string): string | null => {
  const m = new RegExp(`(?:^|;|\\{)\\s*${property}\\s*:\\s*([^;]+)`).exec(body);
  return m === null ? null : m[1].trim();
};

/** A rule is "tracked" when it sets letter-spacing to anything but normal. */
const tracked = (body: string): string | null => {
  const value = declaration(body, "letter-spacing");
  return value === null || value === "normal" ? null : value;
};

/* ============ 1. No rule sets the Devanagari face AND a tracking =========== */

{
  const devanagariRules = RULES.filter((r) => r.body.includes(FACE));
  ok(
    devanagariRules.length >= 12,
    `the sweep found the Devanagari rules to check (${devanagariRules.length}) — a check over nothing passes for the wrong reason`,
  );

  const offenders = devanagariRules
    .map((r) => ({ ...r, value: tracked(r.body) }))
    .filter((r) => r.value !== null);
  ok(
    offenders.length === 0,
    offenders.length === 0
      ? "no rule sets the Devanagari face and a letter-spacing together"
      : `these rules letter-space Devanagari: ${offenders.map((o) => `${path.relative(ROOT, o.file)} ${o.selector} (${o.value})`).join(", ")}`,
  );

  const smallCaps = devanagariRules.filter((r) => {
    const caps = declaration(r.body, "font-variant-caps");
    return caps !== null && caps !== "normal";
  });
  ok(
    smallCaps.length === 0,
    "and none asks for small-caps, which Devanagari has no concept of and which some engines answer by synthesising a scaled capital that is simply a different, wrong glyph",
  );
}

/* ========== 2. No Tailwind class string tracks the Devanagari face ========= */

{
  const sources = SANCTUARY_ROOTS.flatMap((root) => walk(root, /\.tsx?$/));
  const offenders: string[] = [];
  for (const file of sources) {
    const code = readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    /* Any quoted run that names the Devanagari face — a className built inline
       or hoisted to a constant, which is the idiom this codebase uses. */
    const pattern = /["'`]([^"'`]*--font-snc-devanagari[^"'`]*)["'`]/g;
    let m: RegExpExecArray | null;
    while ((m = pattern.exec(code)) !== null) {
      if (/\btracking-/.test(m[1])) offenders.push(`${path.relative(ROOT, file)}: ${m[1].slice(0, 90)}`);
    }
  }
  ok(
    offenders.length === 0,
    offenders.length === 0
      ? "no Tailwind class string sets the Devanagari face and a tracking utility together"
      : `these class strings track Devanagari: ${offenders.join(" | ")}`,
  );
}

/* ====== 3. Nothing Devanagari INHERITS a tracking from its ancestors ====== */

/**
 * Which selectors are tracked, by bare class name.
 *
 * Bare, because CSS Modules are stubbed to their source names above, so a
 * rendered `class="folio"` is the `.folio` rule. Two modules could in principle
 * declare the same bare name; the map keeps every match and the check treats a
 * class as tracked if ANY of them is. That is deliberately conservative — it
 * can only ever report more than the truth, never less.
 */
const TRACKED_CLASSES = new Map<string, string>();
for (const rule of RULES) {
  const value = tracked(rule.body);
  if (value === null) continue;
  TRACKED_CLASSES.set(rule.selector.slice(1), `${path.relative(ROOT, rule.file)} ${rule.selector} (${value})`);
}

/**
 * Walk rendered markup with a tag stack, and report every Devanagari text node
 * together with the class chain above it.
 *
 * A parser rather than a regex because inheritance is the whole point of this
 * section: the failure it exists to catch is a class that is nowhere near the
 * text it breaks.
 */
function devanagariChains(html: string): { text: string; chain: string[] }[] {
  const found: { text: string; chain: string[] }[] = [];
  const stack: string[][] = [];
  const token = /<\/?([a-zA-Z][\w-]*)([^>]*)>|([^<]+)/g;
  let m: RegExpExecArray | null;
  while ((m = token.exec(html)) !== null) {
    const [whole, tag, attrs, text] = m;
    if (text !== undefined) {
      const value = text.replace(/<!--[\s\S]*?-->/g, "").trim();
      if (value.length > 0 && DEVANAGARI.test(value)) {
        found.push({ text: value.slice(0, 24), chain: stack.flat() });
      }
      continue;
    }
    if (whole.startsWith("</")) {
      stack.pop();
      continue;
    }
    if (whole.endsWith("/>") || /^(?:br|img|input|hr|meta|path|circle|rect|use|stop|feTurbulence)$/i.test(tag)) continue;
    const cls = /class="([^"]*)"/.exec(attrs ?? "");
    stack.push(cls === null ? [] : cls[1].split(/\s+/).filter(Boolean));
  }
  return found;
}

{
  const require_ = createRequire(__filename);
  const load = <T,>(rel: string): T => require_(rel) as T;

  const { SealedLeaf } = load<{ SealedLeaf: (p: Record<string, unknown>) => ReactElement }>(
    "../components/sanctuary/pothi/sealed-leaf",
  );
  const { ScanLitany } = load<{ ScanLitany: (p: Record<string, unknown>) => ReactElement }>(
    "../components/sanctuary/chamber/scan-litany",
  );
  const { SanctuaryHeader } = load<{ SanctuaryHeader: (p: Record<string, unknown>) => ReactElement }>(
    "../components/sanctuary/sanctuary-header",
  );
  const { CHAMBER_STAGES } = load<{ CHAMBER_STAGES: readonly { id: string; hi: string; en: string }[] }>(
    "../lib/sanctuary/chamber-stages",
  );
  /*
   * <PalmPlate> is in this list because of how it was caught. Its margin note —
   * मूल चित्र सुरक्षित नहीं रखा जाता, three conjuncts in it — was letter-spaced by
   * a rule that never mentions the Devanagari face: `.margin` INHERITS the face
   * from the leaf it lies on. The stylesheet sweep in section 1 is structurally
   * unable to see that, and only a render can. Any component that puts
   * Devanagari on screen belongs here.
   */
  const { PalmPlate } = load<{ PalmPlate: (p: Record<string, unknown>) => ReactElement | null }>(
    "../components/sanctuary/pothi/palm-plate",
  );

  const REASON = {
    code: "lines.heart.absent",
    hi: "हृदय रेखा साफ़ नहीं दिखी।",
    detail: "Is scan mein heart line ke liye koi feature nahi mila.",
    capture: "Khidki ke paas dobara.",
  };

  const rendered: { name: string; html: string }[] = [
    { name: "SealedLeaf", html: renderToString(createElement(SealedLeaf, { reason: REASON, seed: 3 })) },
    {
      name: "ScanLitany",
      html: renderToString(
        createElement(ScanLitany, { line: { stage: CHAMBER_STAGES[3], status: "working" }, hint: null, visible: true }),
      ),
    },
    { name: "SanctuaryHeader", html: renderToString(createElement(SanctuaryHeader, { activeHref: "/read/pothi" })) },
    {
      name: "PalmPlate",
      html: renderToString(
        createElement(PalmPlate, {
          lineId: "heart",
          geometry: {
            sessionId: "devanagari-test",
            capturedAt: "2026-09-07T10:00:00.000Z",
            lines: { heart: [[20, 34], [90, 28]], life: [[24, 30], [44, 100]] },
            space: 128,
          },
        }),
      ),
    },
  ];

  let nodes = 0;
  const offenders: string[] = [];
  for (const { name, html } of rendered) {
    for (const { text, chain } of devanagariChains(html)) {
      nodes += 1;
      for (const cls of chain) {
        const hit = TRACKED_CLASSES.get(cls);
        if (hit !== undefined) offenders.push(`${name} "${text}" inherits ${hit}`);
      }
    }
  }

  ok(nodes >= 4, `the render produced Devanagari to check (${nodes} text nodes across ${rendered.length} components)`);
  ok(
    offenders.length === 0,
    offenders.length === 0
      ? "no rendered Devanagari sits under a tracked class, its own or an ancestor's"
      : `tracking reaches Devanagari here: ${offenders.join(" | ")}`,
  );
}

console.log(`SANCTUARY DEVANAGARI ASSERTIONS PASSED (${assertions})`);
