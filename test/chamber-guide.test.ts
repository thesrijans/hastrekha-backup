/* ============================================================================
 * scan-complete G2.2 — THE PALM GUIDE
 *
 * "A faint palm-shaped guide outline at the target size, centred, fading out
 * once the palm is in band." Each clause is a number or a structure here:
 *  1. target size: its palm quad spans the meter's target share of the frame's
 *     short side, on screen, at the feed's own cover scale (portrait and landscape);
 *  2. centred: on the ring's resting centre, the place the ring asks for the hand;
 *  3. faint and solid: the palm one closed path at GUIDE_ALPHA, a 1px hairline,
 *     never dashed (ui-sanctuary-spec §3), context left as found;
 *  4. fading: in band it eases to nothing — and at nothing it draws nothing;
 *     out of band it comes back;
 *  5. palm-shaped: fingers with rounded tips at their first joint, fading from
 *     the palm toward the tip (a palm, not rays over the ring — the G2 capture);
 *  6. either hand: mirrored to the thumb's side.
 * ========================================================================== */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  GUIDE_ALPHA,
  GUIDE_FADE_STEPS,
  GUIDE_FINGERS,
  GUIDE_LINE_WIDTH,
  GUIDE_QUAD_ASPECT,
  GUIDE_TIP_ALPHA_SHARE,
  drawPalmGuide,
  fingerOutline,
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

/** A context that records its calls, every point it was given, and the alpha and width of every stroke. */
function recorder() {
  const calls: string[] = [];
  const xs: number[] = [];
  const points: [number, number][] = [];
  const strokes: { alpha: number; width: number }[] = [];
  let depth = 0;
  let dashed = false;
  const target = {
    save: () => ((depth += 1), calls.push("save")),
    restore: () => ((depth -= 1), calls.push("restore")),
    beginPath: () => calls.push("beginPath"),
    closePath: () => calls.push("closePath"),
    moveTo: (x: number, y: number) => (xs.push(x), points.push([x, y]), calls.push("moveTo")),
    lineTo: (x: number, y: number) => (xs.push(x), points.push([x, y]), calls.push("lineTo")),
    bezierCurveTo: (_a: number, _b: number, _c: number, _d: number, x: number, y: number) => (xs.push(x), points.push([x, y]), calls.push("bezierCurveTo")),
    stroke: () => {
      strokes.push({ alpha: target.globalAlpha, width: target.lineWidth });
      calls.push("stroke");
    },
    fill: () => calls.push("fill"),
    setLineDash: (dash: number[]) => (dashed = dashed || dash.length > 0),
    globalAlpha: 1,
    lineWidth: 1,
    lineCap: "butt",
    lineJoin: "miter",
    strokeStyle: "",
  };
  return { context: target as unknown as CanvasRenderingContext2D, calls, xs, points, strokes, depth: () => depth, dashed: () => dashed };
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

/* ------------------------------- 3. faint and solid ------------------------------- */

{
  const g = palmGuideGeometry(ringGeometry(PHONE.width, PHONE.height), PORTRAIT_FEED, PHONE, true)!;
  const r = recorder();
  drawPalmGuide(r.context, g, GUIDE_ALPHA, "var(--color-snc-gold-500)");
  ok(!r.dashed(), "SOLID: no dash pattern is ever set — ui-sanctuary-spec §3, solid strokes only, never dashed anywhere");
  ok(GUIDE_LINE_WIDTH === 1 && r.strokes.every((s) => s.width === 1), "a 1px hairline: the linework ladder's secondary rung");
  ok(!r.calls.includes("fill"), "stroked, never filled — an outline, not a shape laid over a hand");
  ok(r.strokes[0]?.alpha === GUIDE_ALPHA && GUIDE_ALPHA > 0 && GUIDE_ALPHA < 0.5, `faint: the palm drawn at ${GUIDE_ALPHA}, under half`);
  const palmPath = r.calls.slice(0, r.calls.indexOf("stroke"));
  ok(palmPath.includes("closePath") && palmPath.filter((c) => c === "bezierCurveTo").length >= 10, "the palm is ONE closed, curved outline, stroked first");
  ok(r.depth() === 0 && r.calls[0] === "save" && r.calls.at(-1) === "restore", "the context is left as it was found");
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

/* ------------------ 5. a palm: fingers with rounded tips, fading ------------------ */

{
  const g = palmGuideGeometry(ringGeometry(PHONE.width, PHONE.height), PORTRAIT_FEED, PHONE, true)!;
  const r = recorder();
  drawPalmGuide(r.context, g, GUIDE_ALPHA, "gold");
  const fingerStrokes = r.strokes.slice(1);
  ok(fingerStrokes.length === GUIDE_FADE_STEPS, `the fingers follow the palm in ${GUIDE_FADE_STEPS} strokes, one per step of their fade`);
  ok(
    fingerStrokes.every((s, i) => s.alpha < (i === 0 ? GUIDE_ALPHA : fingerStrokes[i - 1]!.alpha)),
    "each step fainter than the one before: the fingers fade from the palm toward their tips",
  );
  const tipAlpha = fingerStrokes.at(-1)!.alpha;
  ok(
    tipAlpha > GUIDE_ALPHA * GUIDE_TIP_ALPHA_SHARE * 0.99 && tipAlpha < GUIDE_ALPHA * 0.5,
    `the tips at ${tipAlpha.toFixed(3)}: faded, and still there — a rounded tip nobody can see closes nothing`,
  );

  /* Every finger ends in a half circle of its own half-width, whose far point is the first joint. */
  const unit = g.quadPx;
  const onScreen = ([x, y]: readonly [number, number]): [number, number] => [g.cx + x * unit, g.cy + y * unit];
  const drawn = (p: [number, number]): boolean => r.points.some(([x, y]) => Math.hypot(x - p[0], y - p[1]) < 1e-6);
  for (const finger of GUIDE_FINGERS) {
    const [bx, by] = finger.base;
    const norm = Math.hypot(finger.direction[0], finger.direction[1]);
    const [dx, dy] = [finger.direction[0] / norm, finger.direction[1] / norm];
    const apex = onScreen([bx + dx * finger.joint, by + dy * finger.joint]);
    const centre = [bx + dx * (finger.joint - finger.halfWidth), by + dy * (finger.joint - finger.halfWidth)] as const;
    const outline = fingerOutline(finger);
    const tip = outline.slice(1, -1);
    ok(
      drawn(apex) && tip.every(({ p }) => Math.abs(Math.hypot(p[0] - centre[0], p[1] - centre[1]) - finger.halfWidth) < 1e-9),
      `the finger at (${finger.base.join(", ")}) is closed by a rounded tip whose far point — its first joint — is drawn`,
    );
    ok(
      outline[0]!.t === 0 && outline.at(-1)!.t === 0 && Math.abs(Math.max(...outline.map((q) => q.t)) - 1) < 1e-12,
      "…and runs from the palm (0) to the joint (1) and back",
    );
  }
  /* On a 412 x 915 phone the tallest finger's tip is on the glass: a rounded tip above the screen rounds nothing. */
  const middle = GUIDE_FINGERS[1]!;
  const middleTip = onScreen([middle.base[0] + (middle.direction[0] / Math.hypot(...middle.direction)) * middle.joint, middle.base[1] + (middle.direction[1] / Math.hypot(...middle.direction)) * middle.joint]);
  ok(middleTip[1] > 0, `the middle finger's tip is on the phone's screen (y ${middleTip[1].toFixed(0)} of ${PHONE.height})`);
}

/* ------------------------------- 6. either hand ------------------------------- */

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
