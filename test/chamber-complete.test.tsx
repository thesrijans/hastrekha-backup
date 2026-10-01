/* ============================================================================
 * scan-complete G4 / G4b — "पहचान पूरी · Scan complete" (the chamber's side)
 *
 *  1. the result (chakra §4): the frozen photograph full screen, the spec's
 *     words exactly, "साधारण · रेखाएँ", the legend (✓ / —), the opt-in OFF by
 *     default and saying what it does, and the three ways on — save, again,
 *     the reading;
 *  2. the snap of the lines: gold, solid (faint is an alpha, never a dash),
 *     observed over bridged, each named in Devanagari over a halo;
 *  3. the blur (G4's folded-in decision): its words, and the torch one tap
 *     away in the gauge's slot, the leaf no taller;
 *  4. the chamber's flow: any of the three completions → the best frame, at
 *     once (camera stopped, double tick, the soft shutter, the ring sealed over
 *     the photograph) → the result; snaps kept for the session only; retake or
 *     the reading; the choreography opens nothing and blocks nothing.
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
const { ChakraResult, RESULT_WORDS, GROWTH_NOTE, compositeFileName } = require("../components/sanctuary/chamber/chakra-result") as typeof import("../components/sanctuary/chamber/chakra-result");
const resultRender = require("../components/sanctuary/chamber/result-render") as typeof import("../components/sanctuary/chamber/result-render");
const { ScanLitany } = require("../components/sanctuary/chamber/scan-litany") as typeof import("../components/sanctuary/chamber/scan-litany");
const snapRender = require("../components/sanctuary/chamber/snap-render") as typeof import("../components/sanctuary/chamber/snap-render");
const { BLUR_WORDS, TORCH_OFFER } = require("../lib/scan/detection-progress") as typeof import("../lib/scan/detection-progress");
const { CHAMBER_STAGES } = require("../lib/sanctuary/chamber-stages") as typeof import("../lib/sanctuary/chamber-stages");
/* eslint-enable @typescript-eslint/no-require-imports */

const render = (component: unknown, props: Record<string, unknown>): string =>
  renderToString(createElement(component as (p: Record<string, unknown>) => ReactElement, props)).replace(/<!-- -->/g, "");
const noop = (): void => undefined;
const withoutComments = (text: string): string => text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

/* ---------------------------- 1. the result screen ---------------------------- */

{
  const props = {
    frozen: { raw: { width: 720, height: 1280, data: new Uint8ClampedArray(4) }, anchors: [], convention: 4, landmarks: [] },
    lines: [],
    mirrored: false,
    legend: [
      { id: "heart", name: "हृदय", found: true },
      { id: "head", name: "मस्तिष्क", found: true },
      { id: "life", name: "जीवन", found: true },
      { id: "fate", name: "शनि", found: false },
    ],
    stage: "result",
    growth: false,
    growthBusy: false,
    growthAvailable: true,
    onGrowthChange: noop,
    onRetake: noop,
    onOpenReading: noop,
    opening: false,
  };
  const html = render(ChakraResult, props);
  ok(html.includes("पहचान पूरी") && html.includes("Scan complete") && RESULT_WORDS.title === "पहचान पूरी", "\"पहचान पूरी · Scan complete\", in the spec's words");
  ok(/<canvas[^>]*role="img"/.test(html), "full screen: the frozen photograph itself, drawn — not a thumbnail on a card");
  ok(/data-snc-view-mode="plain"[^>]*>साधारण</.test(html) && /data-snc-view-mode="lined"[^>]*>रेखाएँ</.test(html), "\"साधारण · रेखाएँ\": the plain photograph, or the lined one");
  ok(/aria-pressed="true"[^>]*data-snc-view-mode="lined"/.test(html) && html.includes('data-snc-lined=""'), "…opening on the lines — the reader's own lines are the point");
  ok(/data-snc-legend="3\/4"/.test(html) && /हृदय <span aria-label="found">✓/.test(html) && /शनि <span aria-label="not found">—/.test(html), "a small legend: found ✓, not found —");
  ok(html.includes("अभी नहीं"), "…and the minors, not yet");
  ok(html.includes(RESULT_WORDS.growth) && RESULT_WORDS.growth === "मेरी हथेली से HastRekha को बेहतर बनाने में मदद करें", "the one opt-in, in the spec's words");
  ok(/<input[^>]*type="checkbox"[^>]*data-snc-growth=""/.test(html) && !/<input[^>]*checked[^>]*data-snc-growth/.test(html), "…OFF by default");
  ok(html.includes(GROWTH_NOTE.off) && GROWTH_NOTE.off.includes("कभी अपलोड नहीं"), "…and it says, before it is touched, that the pictures stay on the device and are never uploaded");
  ok(render(ChakraResult, { ...props, growth: true }).includes(GROWTH_NOTE.on) && GROWTH_NOTE.on.includes("बंद करते ही हट जाएगा"), "on, it says it is saved — and that switching it off deletes it");
  ok(!render(ChakraResult, { ...props, growthAvailable: false }).includes("data-snc-growth"), "no store on this device (or no anchors to replay): the opt-in is not offered at all");
  ok(/data-snc-action="save"[^>]*>चित्र सहेजें</.test(html), "\"चित्र सहेजें\" — save the lined picture");
  ok(/data-snc-action="retake"[^>]*>दोबारा स्कैन</.test(html), "\"दोबारा स्कैन\" — retake");
  ok(/data-snc-action="open"[\s\S]*पाठ खोलें[\s\S]*Open reading/.test(html), "\"पाठ खोलें · Open reading\"");
  const opening = render(ChakraResult, { ...props, opening: true });
  ok((opening.match(/disabled=""/g) ?? []).length >= 4, "once the reading is asked for, every way on and the opt-in wait");
  const sealing = render(ChakraResult, { ...props, stage: "sealing" });
  ok(!sealing.includes("data-snc-action") && sealing.includes('data-snc-result="sealing"') && sealing.includes("<canvas"), "sealing: the photograph alone while the ring closes over it — no chrome yet");
  ok(!html.includes('data-snc-complete=""'), "never the ledger's data-snc-complete (G3), which a capture waiting for the result once mistook for it");
  ok(/^hastrekha-hatheli-2026-09-30-0704\.png$/.test(compositeFileName(new Date(2026, 8, 30, 7, 4))), "the saved picture is named by its day and minute, never by anything about the reader");

  const component = readFileSync("components/sanctuary/chamber/chakra-result.tsx", "utf8");
  ok(/navigator\.canShare\?\.\(\{ files: \[file\] \}\) === true/.test(component) && /navigator\.share\(\{ files: \[file\]/.test(component), "saved through the Web Share API with the file where the device can share files (Android)");
  ok(/anchor\.download = name;/.test(component), "…else downloaded");
  const css = readFileSync("components/sanctuary/chamber/chakra-result.module.css", "utf8");
  ok(!/\b(dashed|dotted)\b|stroke-dasharray/.test(css), "the result's styles draw no dashed or dotted line");
  ok(!/border-radius|box-shadow/.test(css), "…and no pill, no card: struck rules under words, the chamber's control language");

  /* The framing: where the live feed was, then the hand, fitted between the title and the leaf. */
  const photo = { width: 720, height: 1280 };
  const box = { width: 412, height: 915 };
  const cover = resultRender.coverView(photo, box, false);
  ok(Math.abs(cover.scale - 915 / 1280) < 1e-9 && cover.dy === 0 && cover.dx < 0, "first, exactly where the live feed lay (object-fit: cover)");
  const focus = { x0: 200, y0: 400, x1: 500, y1: 900 };
  const palm = resultRender.palmView(photo, box, focus, { top: 110, bottom: 640 }, false);
  const mid = resultRender.viewPoint(palm, { x: 350, y: 650 });
  ok(palm.scale >= cover.scale && palm.scale <= cover.scale * resultRender.RESULT_MAX_ZOOM, "then the hand's framing: never smaller than the cover, never past the zoom cap");
  ok(Math.abs(mid.y - (110 + 640) / 2) < 1 && Math.abs(mid.x - box.width / 2) < 1, "…the hand centred in the band between the title and the leaf");
  ok(palm.dx <= 0 && palm.dy <= 0 && palm.dx + photo.width * palm.scale >= box.width - 1e-9 && palm.dy + photo.height * palm.scale >= box.height - 1e-9, "…and no edge of the photograph ever comes into view");
  const mirroredView = resultRender.coverView(photo, box, true);
  ok(Math.abs(resultRender.viewPoint(mirroredView, { x: 0, y: 0 }).x - (photo.width * mirroredView.scale + mirroredView.dx)) < 1e-9, "a mirrored preview's photograph is shown mirrored — as the reader saw it");
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
  ok(
    /const detectionDone = phase === "scanning" && status === "running" && detection\.complete && !recording;/.test(client),
    "(a) detection is complete when every major line is confirmed or marked unclear (G3's `complete`) — held only while a raw recording runs (scan-perfect P1)",
  );
  const freeze = client.slice(client.indexOf("const completeScan = useCallback("), client.indexOf("const detectionDone ="));
  ok(/const best = takeBestFrame\(\);[\s\S]*stop\(\);\s*haptic\("detectionComplete"\);\s*soundRef\.current\?\.play\("shutter"\);/.test(freeze), "at once: the whole scan's best frame taken, the camera stopped, the double tick, the soft shutter sound if sound is on");
  ok(!/FREEZE_WAIT_MS|freezeReady|peekFreeze/.test(client), "…and no wait for a sharper frame: the best frame already is");
  ok(
    /freezeFrom\(best\)[\s\S]*estimateFreezeShift\(frozen\.gray, MASK_SIZE, gray\)[\s\S]*heldLinesOn\(snapshot, shift, confirmedLinesRef\.current, confirmedIds\)[\s\S]*freezeDeviation\(lines, frozen\)/.test(freeze),
    "the held lines — every one the ledger shows ✓ — are carried onto THAT frame, and measured against the overlay's drawing of it",
  );
  ok(/setPhase\("sealing"\)[\s\S]*CHAKRA_RESULT_LATEST_MS/.test(freeze) && /sealing=\{sealing\}\s*onSealed=\{onSealed\}/.test(client), "the ring seals over the photograph; the result comes in once the ring reports it has been seen closed (at the latest CHAKRA_RESULT_LATEST_MS)");
  ok(/makeSnaps\(frozen, lines[\s\S]*snapStoreRef\.current\?\.keepForSession\(pair\)/.test(freeze), "the two snaps are made from THAT frame, and kept for this session only — by default");
  ok(/store\.saveGrowth\(pair, growthStillOf\(current\.frozen\)\)/.test(client) && /store\.deleteGrowth\(growthIdRef\.current\)/.test(client), "the opt-in saves the growth session; off again deletes it");
  ok(/const onRetake = useCallback\(\(\) => \{\s*resetForNewScan\(\);\s*setPhase\("scanning"\);\s*void start\(\);/.test(client), "\"दोबारा स्कैन\": everything starts again, and the camera with it");
  ok(/onClick=\{\(\) => \{\s*resetForNewScan\(\);/.test(client), "…a failure's retry starts again the same way, so a finished detection cannot freeze the next scan at once");
  ok(/completingRef\.current = false;/.test(client), "…and a new scan can complete again");
  ok(
    /const onOpenReading = useCallback\(\(\) => \{\s*const done = completionRef\.current;\s*void buildReading\(capture, done\?\.frozen\.crop \?\? cropRef\.current, done === null \? null : asTracedLines\(done\.lines\)\);/.test(client),
    "\"पाठ खोलें\": the reading, built now — handing off the held lines on the frozen frame's crop (G5)",
  );
  ok(
    /if \(reason !== "detected"\) \{\s*const concluded = concludeDetection\(detectionRef\.current, reason\);/.test(client),
    "G5: a shutter or palm-left completion marks every line still gathering unclear — exactly as the budget does — before the legend and the lines are read",
  );
  ok(/growthAvailable=\{snapStore !== null && completion\.frozen\.anchors\.length > 0\}/.test(client), "the opt-in is offered only where the pair can be kept and replayed");
  ok(/blurShown\s*\?\s*BLUR_WORDS/.test(client) && /PLACEMENT_REASONS\.has\(reason\)/.test(client), "the blur's words lead — unless the palm itself is misplaced");
  ok(/blurShown && torch === "off" && cameraFacing === "environment" \? \{ \.\.\.TORCH_OFFER, onPress: \(\) => void toggleTorch\(\) \}/.test(client), "the torch is offered on the back camera, when it has one and it is off");
  ok(/foldDetection\(rekhaLatestRef\.current, now\)/.test(client), "a quarter-second clock applies the 40 s wall cap with no new frame needed");
  ok(
    /blurStalled\(palmSinceRef\.current, firstRekhaOfferAt\(\), detectionRef\.current\.lastUsableAtMs, now\)/.test(client),
    "the blur clock waits for the first frame offered to the evidence — a pipeline warming up is not a blurred picture",
  );
  ok(/visible=\{blocked === null && !idle && phase === "scanning"\}/.test(client), "the litany speaks while scanning, and is gone once the scan is complete");
  ok(/<RekhaMonitor snapshot=\{rekha\} detection=\{detection\} visible=\{scanning\} minimised \/>/.test(client), "G3's ledger stays as the ring's accessible text version, visually minimised");
}

console.log(`CHAMBER COMPLETE ASSERTIONS PASSED (${assertions})`);
