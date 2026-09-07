/* ============================================================================
 * THE CHAMBER — its markup, and the promises the route itself makes
 *
 * The drawing is canvas and is pinned by its own tests. What is left is the
 * markup around it and a set of structural promises that are easy to state and
 * easy to break silently:
 *
 *   · the existing /scan is untouched, and this route is additive
 *   · the pipeline is consumed, never edited, and no scan flag is read
 *   · the ceremony's copy never claims a stage it has not earned (A2)
 *   · nothing here is a toast, an alert or a dialog
 *
 * Rendered with renderToString, the precedent test/area-ui.test.tsx set, with
 * the CSS-module require hook test/pothi-book.test.ts introduced — `tsx` cannot
 * parse a CSS module, and a component that imports one is otherwise untestable
 * in this suite.
 * ========================================================================== */
import assert from "node:assert/strict";
import Module from "node:module";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createElement, type ReactElement } from "react";
import { renderToString } from "react-dom/server";
import { CHAMBER_EMPTY_LINE, CHAMBER_STAGES } from "../lib/sanctuary/chamber-stages";
import { REVEAL_LINES } from "../lib/sanctuary/reveal-beat";

let assertions = 0;
const ok = (condition: boolean, message: string): void => {
  assert.ok(condition, message);
  assertions += 1;
};

/** `styles.foo` becomes the string "foo", so a failure message stays readable. */
const CLASS_NAME_STUB: Record<string, string> = new Proxy(
  {},
  { get: (_target, key) => (typeof key === "string" ? key : "") },
);

interface CjsExtensionHost {
  _extensions: Record<string, (loaded: { exports: unknown }, filename: string) => void>;
}

/* `__esModule: true` rather than the bare proxy: esbuild's interop wrapper asks a
   CommonJS export whether it is an ES module, and a bare proxy answers with the
   truthy string "__esModule" and hands back the wrong object. */
(Module as unknown as CjsExtensionHost)._extensions[".css"] = (loaded): void => {
  loaded.exports = { __esModule: true, default: CLASS_NAME_STUB };
};

const ROOT = path.resolve(__dirname, "..");

/**
 * Source with its comments removed.
 *
 * These files explain themselves at length, and several of the assertions below
 * are about what the code DOES rather than what it discusses — the page's own
 * header, for one, explains why <SanctuaryGround /> is absent, which is exactly
 * the string an assertion about its absence would otherwise find.
 */
const withoutComments = (text: string): string =>
  text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const source = (...parts: string[]): string => readFileSync(path.join(ROOT, ...parts), "utf8");

const CHAMBER_DIR = ["components", "sanctuary", "chamber"];
const ROUTE_DIR = ["app", "scan", "chamber"];

const clientSource = source(...ROUTE_DIR, "chamber-client.tsx");
const pageSource = source(...ROUTE_DIR, "page.tsx");
const pageCode = withoutComments(pageSource);
const routeStyles = source(...ROUTE_DIR, "chamber.module.css");
const canvasSource = source(...CHAMBER_DIR, "chamber-canvas.tsx");
const litanyStyles = source(...CHAMBER_DIR, "scan-litany.module.css");
const beatStyles = source(...CHAMBER_DIR, "reveal-beat.module.css");

const require_ = createRequire(__filename);
const { ScanLitany } = require_("../components/sanctuary/chamber/scan-litany") as {
  ScanLitany: (props: Record<string, unknown>) => ReactElement;
};

const render = (component: (props: Record<string, unknown>) => ReactElement, props: Record<string, unknown>): string =>
  renderToString(createElement(component, props)).replace(/<!-- -->/g, "");

const stage = (id: string) => CHAMBER_STAGES.find((s) => s.id === id) ?? CHAMBER_STAGES[0];

/* ==================== 1. The litany leaf says the truth =================== */

{
  const working = render(ScanLitany, {
    line: { stage: stage("major"), status: "working" },
    hint: "Bilkul sahi — hold karo",
    visible: true,
  });
  ok(working.includes(stage("major").hi), "the leaf carries the stage being worked on, in Devanagari");
  ok(working.includes('lang="hi"'), "and marks it as Hindi, so a screen reader does not read Devanagari as Latin");
  ok(working.includes(`aria-label="${stage("major").en}"`), "with the English line as the accessible name");
  ok(
    !working.includes(CHAMBER_EMPTY_LINE),
    "a stage still being worked shows NO empty line: nothing found yet is not nothing found, and this is where A2 is broken most easily",
  );
  ok(working.includes("Bilkul sahi"), "the gate's own words are carried through unedited");

  const empty = render(ScanLitany, { line: { stage: stage("minor"), status: "empty" }, hint: null, visible: true });
  ok(empty.includes(CHAMBER_EMPTY_LINE), "a stage that ran and found nothing says so, in the reader's own language");
  ok(!empty.includes("Bilkul sahi"), "and a hint that was not given is not invented");

  const found = render(ScanLitany, { line: { stage: stage("leaf"), status: "found" }, hint: null, visible: true });
  ok(!found.includes(CHAMBER_EMPTY_LINE), "a stage that found something does not also report nothing");
}

/* ================ 2. Nothing on this route is a notification ============== */

{
  const markup = render(ScanLitany, { line: { stage: stage("hand"), status: "working" }, hint: null, visible: true });
  ok(
    !/role="alert"|role="dialog"|role="alertdialog"/.test(markup),
    "the litany is not an alert and not a dialog: §6.3 asks for ink on a leaf, and a toast is a system notifying you about itself",
  );
  ok(markup.includes('aria-live="polite"'), "it is polite rather than assertive — worth announcing, never worth interrupting a sentence for");
  ok(
    /data-snc-litany="(in|out)"/.test(markup),
    "and its own visibility is a data attribute the stylesheet animates, so the sheet slides rather than appearing",
  );
  ok(
    render(ScanLitany, { line: { stage: stage("hand"), status: "working" }, hint: null, visible: false }).includes(
      'data-snc-litany="out"',
    ),
    "hidden is a state of the same leaf rather than an unmounted one: a leaf that unmounted could not slide away",
  );
}

/* ======================= 3. The route's own promises ====================== */

{
  ok(
    pageCode.includes('process.env.NODE_ENV !== "development"') && pageCode.includes("notFound()"),
    "the chamber is behind the same hard 404 gate as /dev/capture, /dev/label, /sanctuary/materials and /read/pothi",
  );
  ok(/robots:\s*\{\s*index:\s*false/.test(pageSource), "and carries the same noindex metadata beside it");
  ok(pageCode.includes("<SanctuaryDefs />"), "the shared filter sprite is mounted, or every leaf on the route renders with square edges");
  ok(
    !pageCode.includes("SanctuaryGround"),
    "and the stone ground is deliberately NOT: the room here is a photograph of the reader's own, and two rooms at once is a texture over a camera feed",
  );
  ok(pageCode.includes("SANCTUARY_FONT_CLASS"), "the font class is applied, which is also how the canvas resolves a Devanagari family");
}

/* ============ 4. The pipeline is consumed, never edited or steered ======== */

{
  ok(clientSource.includes("useHandScan"), "the chamber mounts the very same hook /scan mounts");
  ok(
    !/from "@\/lib\/scan\/flags"|scanFlags/.test(clientSource) && !/scanFlags/.test(canvasSource),
    "and reads no scan flag: all nine keep their defaults, so this route cannot change what the pipeline does",
  );
  ok(
    !/kbDocument|loadKnowledgeBase|evaluateRules/.test(clientSource),
    "the knowledge base is not loaded a second time — the rules-fired signal comes from the reading the server returns, which keeps a 106 KB parse out of a 45 KB budget",
  );
  ok(
    clientSource.split("handOffToPothi(").length - 1 === 1,
    "it hands off in exactly one place, through the same entry point /scan uses",
  );
  ok(/space:\s*MASK_SIZE/.test(clientSource), "and passes the grid its polylines were traced in explicitly (2db5c39)");
  ok(
    /const rescanAsk = useSyncExternalStore\(/.test(clientSource),
    "the rescan ask is read through a store with a null server snapshot, not a lazy initialiser that would mismatch on hydration",
  );
  ok(
    !/lib\/scan\/dev|app\/dev/.test(clientSource) && !/lib\/scan\/dev/.test(canvasSource),
    "nothing dev-only is imported: the route is gated, but the import boundary does not rely on the gate",
  );
}

/* =============== 5. One canvas, and it is measured =============== */

{
  ok(
    (clientSource.match(/<ChamberCanvas/g) ?? []).length === 1 && !/<canvas/.test(clientSource),
    "one canvas over the feed and no second one: every extra layer over a live camera is another full-viewport raster per frame",
  );
  ok(
    canvasSource.includes("costRef.current.measure("),
    "and the whole draw is inside the frame-cost span, so §10's budget is measured rather than asserted",
  );
  ok(
    /requestAnimationFrame/.test(canvasSource) && (canvasSource.match(/requestAnimationFrame/g) ?? []).length <= 3,
    "with a single rAF chain rather than one per pass",
  );
  ok(
    clientSource.includes('get("cost") === "1"'),
    "the readout is opt-in: a performance figure over a ceremony is the least ceremonial thing imaginable, but it is real and always running",
  );
}

/* ==================== 6. The beat's two lines are fixed =================== */

{
  const beatSource = withoutComments(source(...CHAMBER_DIR, "reveal-beat.tsx"));
  ok(beatSource.includes("REVEAL_LINES.map"), "the beat renders the score's lines rather than holding copies of its own");
  ok(
    !/setTimeout|setInterval/.test(beatSource),
    "and owns no timing: a chain of timeouts drifts, so the darkening would begin at a different moment on a busy device than on an idle one",
  );
  ok(
    beatSource.includes("onArrivedRef.current()") && !beatSource.includes("router"),
    "the beat reports that it arrived and does not navigate: an animation that navigates is an animation that can navigate at the wrong time",
  );
  for (const line of REVEAL_LINES) ok(beatSource.includes("line.hi"), `the score's line is rendered from the score (${line.en})`);
}

/* ======================= 7. No colour, no card, no box =================== */

{
  const HEX = /#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(/;
  /* Comments stripped: these files argue for their own colours by naming the
     tokens, and the rule being checked is about what the code paints. */
  for (const [name, text] of Object.entries({
    "chamber.module.css": withoutComments(routeStyles),
    "scan-litany.module.css": withoutComments(litanyStyles),
    "reveal-beat.module.css": withoutComments(beatStyles),
    "chamber-client.tsx": withoutComments(clientSource),
    "chamber-canvas.tsx": withoutComments(canvasSource),
  })) {
    ok(!HEX.test(text), `${name} carries no colour literal: every pigment is a --color-snc-* token`);
  }
  ok(
    !/border-radius/.test(routeStyles) && !/border-radius/.test(litanyStyles),
    "and no border-radius: the surfaces here are torn leaves, and a rounded rectangle on a bitten sheet is a card",
  );
  ok(
    /pointer-events:\s*none/.test(routeStyles) && /pointer-events:\s*none/.test(litanyStyles),
    "the canvas and the litany are both transparent to a pointer, so neither swallows the one gesture this route has",
  );
  ok(
    /prefers-reduced-motion/.test(litanyStyles) && /prefers-reduced-motion/.test(beatStyles),
    "motion is what degrades: both moving surfaces answer the reduced-motion query",
  );
}

console.log(`CHAMBER UI ASSERTIONS PASSED (${assertions})`);
