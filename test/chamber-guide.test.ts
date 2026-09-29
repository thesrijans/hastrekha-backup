/* ============================================================================
 * scan-complete G2.2 — THE PALM GUIDE
 *
 * "A faint palm-shaped guide outline at the target size, centred, fading out
 * once the palm is in band." Each clause is a number or a structure here:
 *  1. target size: its palm quad spans the meter's target share of the frame's
 *     short side, on screen, at the feed's own cover scale (portrait and landscape);
 *  2. centred: on the ring's resting centre, the place the ring asks for the hand;
 *  3. faint: drawn at GUIDE_ALPHA, dashed, one path, context left as found;
 *  4. fading: in band it eases to nothing — and at nothing it draws nothing;
 *     out of band it comes back;
 *  5. palm-shaped, either hand: mirrored to the thumb's side.
 * ========================================================================== */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  GUIDE_ALPHA,
  GUIDE_DASH,
  GUIDE_QUAD_ASPECT,
  drawPalmGuide,
  nextGuideAlpha,
  palmGuideGeometry,
} from "../components/sanctuary/chamber/palm-guide";
import { ringGeometry } from "../components/sanctuary/chamber/scan-ring";
import { PALM_QUAD_TARGET_FILL } from "../lib/scan/distance";

let assertions = 0;
const ok = (condition: boolean, message: string): void => {
  assert.ok(condition, message);
  assertions += 1;
};

/** A context that records its calls and the x of every point it was given. */
function recorder() {
  const calls: string[] = [];
  const xs: number[] = [];
  let depth = 0;
  let dashed = false;
  let alphaAtStroke = -1;
  const target = {
    save: () => ((depth += 1), calls.push("save")),
    restore: () => ((depth -= 1), calls.push("restore")),
    beginPath: () => calls.push("beginPath"),
    closePath: () => calls.push("closePath"),
    moveTo: (x: number) => (xs.push(x), calls.push("moveTo")),
    lineTo: (x: number) => (xs.push(x), calls.push("lineTo")),
    bezierCurveTo: (_a: number, _b: number, _c: number, _d: number, x: number) => (xs.push(x), calls.push("bezierCurveTo")),
    stroke: () => {
      alphaAtStroke = target.globalAlpha;
      calls.push("stroke");
    },
    fill: () => calls.push("fill"),
    setLineDash: (dash: number[]) => (dashed = dash.length > 0),
    globalAlpha: 1,
    lineWidth: 1,
    lineCap: "butt",
    strokeStyle: "",
  };
  return { context: target as unknown as CanvasRenderingContext2D, calls, xs, depth: () => depth, dashed: () => dashed, alpha: () => alphaAtStroke };
}

const PHONE = { width: 412, height: 915 };
const PORTRAIT_FEED = { width: 720, height: 1280 };

/* ------------------------------- 1 + 2. size and place ------------------------------- */

{
  const rest = ringGeometry(PHONE.width, PHONE.height);
  const g = palmGuideGeometry(rest, PORTRAIT_FEED, PHONE, true)!;
  const scale = Math.max(PHONE.width / PORTRAIT_FEED.width, PHONE.height / PORTRAIT_FEED.height);
  const expected = PALM_QUAD_TARGET_FILL * PORTRAIT_FEED.width * scale;
  ok(Math.abs(g.quadPx - expected) < 1e-9, `portrait: the guide's palm quad is ${g.quadPx.toFixed(1)} px — the target ${PALM_QUAD_TARGET_FILL} of the frame's width at the feed's cover scale ${scale.toFixed(4)}`);
  ok(g.cx === rest.cx && g.cy === rest.cy, `centred on the ring's resting centre (${g.cx}, ${g.cy.toFixed(1)})`);

  const laptop = { width: 1440, height: 900 };
  const landscapeFeed = { width: 1280, height: 720 };
  const l = palmGuideGeometry(ringGeometry(laptop.width, laptop.height), landscapeFeed, laptop, true)!;
  const lScale = Math.max(laptop.width / landscapeFeed.width, laptop.height / landscapeFeed.height);
  ok(Math.abs(l.quadPx * GUIDE_QUAD_ASPECT - PALM_QUAD_TARGET_FILL * landscapeFeed.height * lScale) < 1e-9, "landscape: the guide's palm quad HEIGHT fills the target share of the frame's height — the short side the meter reads");
  ok(palmGuideGeometry(rest, null, PHONE, true) === null, "no camera size yet, no guide: nothing to scale it to");
}

/* ---------------------------------- 3. faint, dashed ---------------------------------- */

{
  const g = palmGuideGeometry(ringGeometry(PHONE.width, PHONE.height), PORTRAIT_FEED, PHONE, true)!;
  const r = recorder();
  drawPalmGuide(r.context, g, GUIDE_ALPHA, "var(--color-snc-gold-500)");
  ok(r.calls.filter((c) => c === "stroke").length === 1 && !r.calls.includes("fill"), "one path, stroked once, never filled — an outline, not a shape laid over a hand");
  ok(r.dashed() && GUIDE_DASH.length === 2, "dashed: a place to put a hand, not a thing already there");
  ok(r.alpha() === GUIDE_ALPHA && GUIDE_ALPHA > 0 && GUIDE_ALPHA < 0.5, `faint: drawn at ${GUIDE_ALPHA}, under half`);
  ok(r.depth() === 0 && r.calls[0] === "save" && r.calls.at(-1) === "restore", "the context is left as it was found");
  ok(r.calls.includes("closePath") && r.calls.filter((c) => c === "bezierCurveTo").length >= 10, "a closed, curved palm outline");
}

/* -------------------------------- 4. fading in band -------------------------------- */

{
  let alpha = GUIDE_ALPHA;
  let frames = 0;
  while (alpha > 0 && frames < 200) {
    alpha = nextGuideAlpha(alpha, true);
    frames += 1;
  }
  ok(alpha === 0 && frames <= 45, `in band the guide fades to nothing in ${frames} frames (${((frames / 60) * 1000).toFixed(0)} ms at 60 fps)`);
  const g = palmGuideGeometry(ringGeometry(PHONE.width, PHONE.height), PORTRAIT_FEED, PHONE, true)!;
  const r = recorder();
  drawPalmGuide(r.context, g, 0, "gold");
  ok(r.calls.length === 0, "and at nothing it draws nothing — faded is not the same as faint");
  let back = 0;
  for (let i = 0; i < 60; i += 1) back = nextGuideAlpha(back, false);
  ok(Math.abs(back - GUIDE_ALPHA) < 0.01, `out of band again, it comes back to faint within a second (${back.toFixed(3)})`);
}

/* ------------------------------- 5. either hand ------------------------------- */

{
  const rest = ringGeometry(PHONE.width, PHONE.height);
  const right = recorder();
  drawPalmGuide(right.context, palmGuideGeometry(rest, PORTRAIT_FEED, PHONE, true)!, GUIDE_ALPHA, "gold");
  const left = recorder();
  drawPalmGuide(left.context, palmGuideGeometry(rest, PORTRAIT_FEED, PHONE, false)!, GUIDE_ALPHA, "gold");
  const mirrored = right.xs.every((x, i) => Math.abs(x - rest.cx - -(left.xs[i]! - rest.cx)) < 1e-9);
  ok(right.xs.length === left.xs.length && mirrored, "the left-thumb guide is the right-thumb one mirrored about the centre, point for point");
  const maxRight = Math.max(...right.xs) - rest.cx;
  const minRight = rest.cx - Math.min(...right.xs);
  ok(maxRight > minRight, "thumb on the right: the outline reaches further right (the thumb's stub) than left");
}

/* ------------------------ the canvas draws it, under the hand ------------------------ */

{
  const canvas = readFileSync("components/sanctuary/chamber/chamber-canvas.tsx", "utf8");
  const guideAt = canvas.indexOf("drawPalmGuide(context");
  const ringAt = canvas.indexOf("drawScanRing(context");
  const handAt = canvas.indexOf("drawConstellation(context, marks");
  ok(ringAt > 0 && guideAt > ringAt && handAt > guideAt, "drawn after the wheel and before the constellation: the reader's palm always lies over the place it was asked to go");
  ok(/if \(state\.guide !== undefined\) \{[\s\S]*?drawPalmGuide[\s\S]*?\}\s*\n\s*const marks = state\.landmarks;/.test(canvas), "…and before the no-hand return: the guide matters most before a hand arrives");
  ok(/dataset\.sncGuide/.test(canvas), "its geometry is published on the element for the layout captures");
}

console.log(`CHAMBER GUIDE ASSERTIONS PASSED (${assertions})`);
