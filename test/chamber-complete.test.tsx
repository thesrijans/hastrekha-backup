/* ============================================================================
 * scan-complete G4 — "पहचान पूरी" + BOTH SNAPS (the chamber's side)
 *
 *  1. the completion leaf: the spec's words exactly, both snaps side by side,
 *     the opt-in OFF by default and saying what it does, the two ways on;
 *  2. the snap of the lines: gold, solid (faint is an alpha, never a dash),
 *     observed over bridged, each named in Devanagari over a halo;
 *  3. the blur (G4's folded-in decision): its words, and the torch one tap
 *     away in the gauge's slot, the leaf no taller;
 *  4. the chamber's flow: detection complete → wait for VoL ≥ 100 → freeze
 *     (camera stopped, double tick, snaps, session-only keep) → retake or the
 *     reading; the choreography no longer opens the reading on its own.
 * ========================================================================== */
import assert from "node:assert/strict";
import Module from "node:module";
import { readFileSync } from "node:fs";
import { createElement, type ReactElement } from "react";
import { renderToString } from "react-dom/server";

let assertions = 0;
const ok = (condition: boolean, message: string): void => {
  assert.ok(condition, message);
  assertions += 1;
};

const CLASS_NAME_STUB: Record<string, string> = new Proxy({}, { get: (_target, key) => (typeof key === "string" ? key : "") });
interface CjsExtensionHost {
  _extensions: Record<string, (loaded: { exports: unknown }, filename: string) => void>;
}
(Module as unknown as CjsExtensionHost)._extensions[".css"] = (loaded): void => {
  loaded.exports = { __esModule: true, default: CLASS_NAME_STUB };
};

/* eslint-disable @typescript-eslint/no-require-imports -- loaded after the CSS hook above, which a static import would precede */
const { CompletionLeaf, COMPLETION_WORDS, GROWTH_NOTE } = require("../components/sanctuary/chamber/completion-leaf") as typeof import("../components/sanctuary/chamber/completion-leaf");
const { ScanLitany } = require("../components/sanctuary/chamber/scan-litany") as typeof import("../components/sanctuary/chamber/scan-litany");
const snapRender = require("../components/sanctuary/chamber/snap-render") as typeof import("../components/sanctuary/chamber/snap-render");
const { BLUR_WORDS, TORCH_OFFER } = require("../lib/scan/detection-progress") as typeof import("../lib/scan/detection-progress");
const { CHAMBER_STAGES } = require("../lib/sanctuary/chamber-stages") as typeof import("../lib/sanctuary/chamber-stages");
/* eslint-enable @typescript-eslint/no-require-imports */

const render = (component: unknown, props: Record<string, unknown>): string =>
  renderToString(createElement(component as (p: Record<string, unknown>) => ReactElement, props)).replace(/<!-- -->/g, "");
const noop = (): void => undefined;
const withoutComments = (text: string): string => text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

/* ---------------------------- 1. the completion leaf ---------------------------- */

{
  const props = {
    palmSrc: "blob:palm",
    rawSrc: "blob:raw",
    linesSrc: "blob:lines",
    growth: false,
    growthBusy: false,
    growthAvailable: true,
    onGrowthChange: noop,
    onRetake: noop,
    onOpenReading: noop,
    opening: false,
  };
  const html = render(CompletionLeaf, props);
  ok(html.includes("पहचान पूरी") && html.includes("Detection complete") && COMPLETION_WORDS.title === "पहचान पूरी", "\"पहचान पूरी · Detection complete\", in the spec's words");
  ok(/data-snc-snap="palm"[\s\S]*src="blob:palm"[\s\S]*src="blob:raw"[\s\S]*आपकी हथेली/.test(html), "snap (a) \"आपकी हथेली\": the plain palm — the rectified crop, the raw frame in its corner");
  ok(/data-snc-snap="lines"[\s\S]*src="blob:lines"[\s\S]*आपकी रेखाएँ/.test(html), "snap (b) \"आपकी रेखाएँ\": the same frame with the held lines");
  ok(html.indexOf('data-snc-snap="palm"') < html.indexOf('data-snc-snap="lines"'), "…side by side, the palm first");
  ok(
    html.includes('data-snc-completion=""') && !html.includes('data-snc-complete=""'),
    "the leaf is marked data-snc-completion — never the ledger's data-snc-complete (G3), which a capture waiting for the leaf once mistook for it",
  );
  ok(html.includes(COMPLETION_WORDS.growth) && COMPLETION_WORDS.growth === "मेरी हथेली से HastRekha को बेहतर बनाने में मदद करें", "the one opt-in, in the spec's words");
  ok(/<input[^>]*type="checkbox"[^>]*data-snc-growth=""/.test(html) && !/<input[^>]*checked[^>]*data-snc-growth/.test(html), "…OFF by default");
  ok(html.includes(GROWTH_NOTE.off) && GROWTH_NOTE.off.includes("कभी अपलोड नहीं"), "…and it says, before it is touched, that the pictures stay on the device and are never uploaded");
  ok(render(CompletionLeaf, { ...props, growth: true }).includes(GROWTH_NOTE.on) && GROWTH_NOTE.on.includes("बंद करते ही हट जाएगा"), "on, it says it is saved — and that switching it off deletes it");
  ok(!render(CompletionLeaf, { ...props, growthAvailable: false }).includes("data-snc-growth"), "no store on this device (or no anchors to replay): the opt-in is not offered at all");
  ok(/data-snc-action="retake"[^>]*>दोबारा स्कैन</.test(html), "\"दोबारा स्कैन\" — retake");
  ok(/data-snc-action="open"[\s\S]*पाठ खोलें[\s\S]*Open reading/.test(html), "\"पाठ खोलें · Open reading\"");
  const opening = render(CompletionLeaf, { ...props, opening: true });
  ok((opening.match(/disabled=""/g) ?? []).length >= 3, "once the reading is asked for, both ways on and the opt-in wait");
  const css = readFileSync("components/sanctuary/chamber/completion-leaf.module.css", "utf8");
  ok(!/\b(dashed|dotted)\b|stroke-dasharray/.test(css), "the leaf's styles draw no dashed or dotted line");
  ok(!/border-radius|box-shadow/.test(css), "…and no pill, no card: struck rules under words, the chamber's control language");
}

/* ---------------------------- 2. the snap of the lines ---------------------------- */

{
  const calls: string[] = [];
  const strokes: { alpha: number; width: number; blur: number }[] = [];
  const texts: { kind: string; text: string; x: number; y: number }[] = [];
  let depth = 0;
  let dashed = false;
  const target = {
    save: () => ((depth += 1), calls.push("save")),
    restore: () => ((depth -= 1), calls.push("restore")),
    beginPath: () => calls.push("beginPath"),
    moveTo: () => calls.push("moveTo"),
    lineTo: () => calls.push("lineTo"),
    stroke: () => (strokes.push({ alpha: target.globalAlpha, width: target.lineWidth, blur: target.shadowBlur }), calls.push("stroke")),
    strokeText: (text: string, x: number, y: number) => (texts.push({ kind: "halo", text, x, y }), calls.push("strokeText")),
    fillText: (text: string, x: number, y: number) => (texts.push({ kind: "ink", text, x, y }), calls.push("fillText")),
    setLineDash: (dash: number[]) => (dashed = dashed || dash.length > 0),
    globalAlpha: 1,
    lineWidth: 1,
    shadowBlur: 0,
    shadowColor: "",
    strokeStyle: "",
    fillStyle: "",
    font: "",
    textAlign: "",
    textBaseline: "",
    lineCap: "",
    lineJoin: "",
  };
  const size = 512;
  snapRender.drawSnapLines(
    target as unknown as CanvasRenderingContext2D,
    [
      { id: "heart", points: [[20, 40], [60, 36], [100, 44]], segments: [{ from: 0, to: 1, observed: true }, { from: 1, to: 2, observed: false }] },
      { id: "life", points: [[70, 60], [60, 90], [64, 120]], segments: [{ from: 0, to: 2, observed: true }] },
    ],
    size,
    { line: "gold", glow: "warm", halo: "stone", font: "Tiro" },
  );
  ok(!dashed, "solid: no dash pattern is ever set — faint is an alpha, never a dash (ui-sanctuary-spec §3)");
  const [bridged, observed] = strokes;
  ok(bridged !== undefined && observed !== undefined && strokes.length === 2, "two strokes: the bridged stretches, then the observed ones over their ends");
  ok(bridged!.alpha === snapRender.SNAP_BRIDGED_ALPHA && bridged!.width === size * snapRender.SNAP_BRIDGED_WIDTH && bridged!.blur === 0, `bridged: faint (${snapRender.SNAP_BRIDGED_ALPHA}) and thin, no glow`);
  ok(observed!.alpha === 1 && observed!.width === size * snapRender.SNAP_OBSERVED_WIDTH && observed!.blur > 0, "observed: full gold, the active rung's width at the screen's size, with its glow");
  const names = texts.filter((t) => t.kind === "ink").map((t) => t.text);
  ok(names.join() === "हृदय,जीवन" && texts.filter((t) => t.kind === "halo").length === 2, "each held line named in Devanagari, over a dark halo");
  ok(texts.every((t) => t.x > 0 && t.x < size && t.y > 0 && t.y < size), "every name inside the picture");
  ok(depth === 0 && calls[0] === "save" && calls.at(-1) === "restore", "the context is left as it was found");

  /* Two creases traced a few pixels apart — the first G4 capture's life and fate lines — keep their names apart. */
  const near = snapRender.labelPlaces(
    [
      { id: "life", points: [[88, 60], [90, 80], [92, 100]], segments: [{ from: 0, to: 2, observed: true }] },
      { id: "fate", points: [[90, 60], [92, 80], [94, 100]], segments: [{ from: 0, to: 2, observed: true }] },
    ],
    size,
  );
  const gap = size * snapRender.SNAP_LABEL_SIZE * 1.3;
  ok(
    near.length === 2 && (Math.abs(near[0]!.x - near[1]!.x) >= gap * 1.6 || Math.abs(near[0]!.y - near[1]!.y) >= gap),
    `two names never print over each other (${near.map((p) => `${p.id} ${p.x.toFixed(0)},${p.y.toFixed(0)}`).join(" / ")})`,
  );
}

/* ------------------------------ 3. the blur, and its one tap ------------------------------ */

{
  const line = { stage: CHAMBER_STAGES.find((s) => s.id === "major")!, status: "working" as const };
  let pressed = 0;
  const withAction = render(ScanLitany, {
    line,
    hint: BLUR_WORDS,
    visible: true,
    distance: { current: { fill: 0.5, state: "ok" } },
    action: { ...TORCH_OFFER, onPress: () => (pressed += 1) },
  });
  ok(withAction.includes("तस्वीर धुंधली है ·") && withAction.includes("हाथ स्थिर रखें, रोशनी बढ़ाएँ"), "the blur's words, exactly — its two halves wrapping at the \"·\"");
  ok(/<button[^>]*aria-label="Turn on the light"[^>]*data-snc-hint-action=""[^>]*>रोशनी चालू करें<\/button>/.test(withAction), "\"रोशनी चालू करें\", a one-tap action at the head of the line");
  ok(!withAction.includes("data-snc-gauge"), "…in the gauge's slot: the line keeps its two rows, the leaf is no taller");
  ok(render(ScanLitany, { line, hint: BLUR_WORDS, visible: true, distance: { current: { fill: 0.5, state: "ok" } } }).includes("data-snc-gauge"), "no action (front camera, no torch, torch already on): the gauge as before");
  void pressed;
  const litanyCss = readFileSync("components/sanctuary/chamber/scan-litany.module.css", "utf8");
  ok(/\.hintAction \{[\s\S]*?line-height: inherit;[\s\S]*?\}/.test(litanyCss) && !/\.hintAction \{[\s\S]*?(border-radius|padding: 0\.[3-9])[\s\S]*?\}/.test(litanyCss), "the action is a struck word the height of its text row — never a pill");
  ok(
    /\.dock \{[\s\S]*?pointer-events: none;[\s\S]*?\}/.test(litanyCss) && /\.hintAction \{[\s\S]*?pointer-events: auto;[\s\S]*?\}/.test(litanyCss),
    "the leaf takes no taps, and its one action does — the first G4 capture tapped it through a dock that swallowed nothing and passed nothing",
  );
}

/* ------------------------------------ 4. the flow ------------------------------------ */

{
  const client = withoutComments(readFileSync("app/scan/chamber/chamber-client.tsx", "utf8"));
  ok(!/onCaptureComplete/.test(client), "the pose choreography no longer opens the reading on its own — detection completes the scan");
  ok(/const detectionDone = phase === "scanning" && status === "running" && detection\.complete;/.test(client), "detection is complete when every major line is confirmed or marked unclear (G3's `complete`)");
  ok(/!freezeReady\(peekFreeze\(\)\) && performance\.now\(\) - freezeStartedAtRef\.current < FREEZE_WAIT_MS/.test(client), "the freeze waits for a frame at VoL ≥ 100 — for FREEZE_WAIT_MS at most, then the best there is");
  const freeze = client.slice(client.indexOf("const freeze = async"), client.indexOf("const timer = window.setInterval", client.indexOf("const freeze = async")));
  ok(/setPhase\("freezing"\)[\s\S]*takeFreeze\(\)[\s\S]*stop\(\);[\s\S]*haptic\("detectionComplete"\)/.test(freeze), "then: the camera stops on the frozen frame, and the double tick");
  ok(
    /estimateFreezeShift\(cropLuma\(frozen\.crop\.data, frozen\.crop\.width\), frozen\.crop\.width, gray\)[\s\S]*heldLinesOn\(snapshot, shift, confirmedLinesRef\.current, confirmedIds\)[\s\S]*makeSnaps\(frozen, lines/.test(freeze),
    "the held lines — every one the ledger shows ✓ — are carried onto THAT frame before both snaps are made from it",
  );
  ok(/snapStoreRef\.current\?\.keepForSession\(pair\)/.test(freeze), "the pair is kept for this session only — by default");
  ok(/store\.saveGrowth\(current\.pair, growthStillOf\(current\.frozen\)\)/.test(client) && /store\.deleteGrowth\(growthIdRef\.current\)/.test(client), "the opt-in saves the growth session; off again deletes it");
  ok(/const onRetake = useCallback\(\(\) => \{\s*resetForNewScan\(\);\s*setPhase\("scanning"\);\s*void start\(\);/.test(client), "\"दोबारा स्कैन\": everything starts again, and the camera with it");
  ok(/onClick=\{\(\) => \{\s*resetForNewScan\(\);/.test(client), "…a failure's retry starts again the same way, so a finished detection cannot freeze the next scan at once");
  ok(/const onOpenReading = useCallback\(\(\) => \{\s*void buildReading\(capture, cropRef\.current\);/.test(client), "\"पाठ खोलें\": the reading, built now");
  ok(/growthAvailable=\{snapStore !== null && completion\.frozen\.anchors\.length > 0\}/.test(client), "the opt-in is offered only where the pair can be kept and replayed");
  ok(/blurShown\s*\?\s*BLUR_WORDS/.test(client) && /PLACEMENT_REASONS\.has\(reason\)/.test(client), "the blur's words lead — unless the palm itself is misplaced");
  ok(/blurShown && torch === "off" && cameraFacing === "environment" \? \{ \.\.\.TORCH_OFFER, onPress: \(\) => void toggleTorch\(\) \}/.test(client), "the torch is offered on the back camera, when it has one and it is off");
  ok(/foldDetection\(rekhaLatestRef\.current, now\)/.test(client), "a quarter-second clock applies the 40 s wall cap with no new frame needed");
  ok(
    /blurStalled\(palmSinceRef\.current, firstRekhaOfferAt\(\), detectionRef\.current\.lastUsableAtMs, now\)/.test(client),
    "the blur clock waits for the first frame offered to the evidence — a pipeline warming up is not a blurred picture",
  );

  const hook = readFileSync("components/scan/use-hand-scan.ts", "utf8");
  ok(/freezeReplaces\(kept, \{ vol: offered\.vol, atMs: now \}\)/.test(hook), "the hook keeps the sharpest recent crop offered to the keep-ring, graded by the ring's own VoL");
  ok((hook.match(/freezeRef\.current = null;/g) ?? []).length >= 4, "…and drops it with the evidence: a new palm, a restart, a stop, a take");
}

console.log(`CHAMBER COMPLETE ASSERTIONS PASSED (${assertions})`);
