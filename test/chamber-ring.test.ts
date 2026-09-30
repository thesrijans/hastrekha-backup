/* ============================================================================
 * THE CELESTIAL RING
 *
 * §6.3 gives three numbers — twelve sectors, 0.6°/s, filling with the tilt
 * choreography — and one instruction that is not a number: it is the wheel from
 * the wordmark. The numbers are checked directly. The wheel is checked
 * structurally, against a recording context: the reference's bands are all
 * hairlines and only its beads are filled, so a draw that started stroking bars
 * or filling rings would stop being that wheel while still looking like *a*
 * wheel in a screenshot.
 *
 * G4b: the sectors no longer fill with the tilt choreography — the chakra's arcs
 * fill with each major line's evidence instead (docs/specs/chakra-scan-g4.txt §1),
 * and this test pins where they are, what they say, and that the engraving still
 * turns under them while they do not.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  RING_BEADS,
  RING_DEGREES_PER_SECOND,
  RING_EXTENT,
  RING_HAND_MARGIN,
  RING_MIN_SHARE,
  RING_PHONE_RESERVE_BOTTOM,
  RING_PHONE_RESERVE_TOP,
  RING_RADII,
  RING_SECTORS,
  RING_THUMB_Y,
  RING_TICKS,
  drawScanRing,
  ringGeometry,
  ringRotation,
  chakraMarkPlace,
  chakraNamePlace,
  chakraRadians,
  CHAKRA_NAME_RADIUS,
  type ChakraDraw,
} from "../components/sanctuary/chamber/scan-ring";
import { CHAKRA_GAP_DEG, CHAKRA_MAJOR_ARCS, CHAKRA_MINORS, CHAKRA_WORDS } from "../lib/scan/chakra";

let assertions = 0;
const ok = (condition: boolean, message: string): void => {
  assert.ok(condition, message);
  assertions += 1;
};

/** A context that records what it was asked to do, so a draw can be inspected rather than looked at. */
function recorder(): { context: CanvasRenderingContext2D; calls: string[]; depth: () => number } {
  const calls: string[] = [];
  let depth = 0;
  const target = {
    save: () => {
      depth += 1;
      calls.push("save");
    },
    restore: () => {
      depth -= 1;
      calls.push("restore");
    },
    translate: () => calls.push("translate"),
    rotate: () => calls.push("rotate"),
    beginPath: () => calls.push("beginPath"),
    closePath: () => calls.push("closePath"),
    moveTo: () => calls.push("moveTo"),
    lineTo: () => calls.push("lineTo"),
    arc: () => calls.push("arc"),
    stroke: () => calls.push("stroke"),
    fill: () => calls.push("fill"),
    fillRect: () => calls.push("fillRect"),
    fillText: (text: string) => calls.push(`fillText:${text}`),
    strokeText: (text: string) => calls.push(`strokeText:${text}`),
    setLineDash: () => calls.push("setLineDash"),
    lineWidth: 0,
    lineCap: "",
    lineJoin: "",
    font: "",
    textAlign: "",
    textBaseline: "",
    globalAlpha: 1,
    strokeStyle: "",
    fillStyle: "",
  };
  return { context: target as unknown as CanvasRenderingContext2D, calls, depth: () => depth };
}

const PALETTE = { line: "var(--color-snc-gold-500)", arc: "var(--color-snc-gold-500)", text: "var(--color-snc-gold-400)", halo: "var(--color-snc-stone-900)", font: "serif" };

/** A chakra mid-scan: the heart confirmed, the head at 40%, the life line unclear, the fate line not yet seen. */
const CHAKRA: ChakraDraw = {
  majors: [
    { id: "heart", name: "हृदय", status: "confirmed", fill: 1 },
    { id: "head", name: "मस्तिष्क", status: "gathering", fill: 0.4 },
    { id: "life", name: "जीवन", status: "unclear", fill: 0 },
    { id: "fate", name: "शनि", status: "gathering", fill: 0 },
  ],
  minors: CHAKRA_MINORS.map((minor) => ({ id: minor.id })),
  centre: "पहचान 60%",
};

/* -------------------------- 1. The spec's numbers ------------------------- */

{
  ok(RING_SECTORS === 12, "twelve sectors, because the wheel is a zodiac and the reference divides it twelve ways");
  ok(RING_DEGREES_PER_SECOND === 0.6, "and it turns six tenths of a degree a second, the rate §6.3 gives");
  const oneMinute = ringRotation(60_000);
  ok(
    Math.abs(oneMinute - (36 * Math.PI) / 180) < 1e-9,
    "which is 36 degrees in a minute — slow enough that a reader notices it has moved rather than watching it move",
  );
  ok(ringRotation(0) === 0, "it starts where it starts");
  ok(ringRotation(Number.NaN) === 0, "and a broken clock leaves it still rather than spinning it to NaN");
  ok(RING_BEADS % RING_SECTORS === 0, "the beads divide evenly by sector, so a bead lands on every twelfth of the wheel");
  ok(RING_TICKS % RING_SECTORS === 0, "and so do the ticks");
}

/* --------------- 2. A sector lights only once it is earned --------------- */

{
  /* G4b §1: four arcs of ~84° with small gaps, one per major, in the ledger's order clockwise from twelve o'clock. */
  const order = ["heart", "head", "life", "fate"] as const;
  ok(order.every((id, i) => CHAKRA_MAJOR_ARCS[id].startDeg === i * 90 + CHAKRA_GAP_DEG / 2 && CHAKRA_MAJOR_ARCS[id].sweepDeg === 84), "the inner ring: four arcs of 84°, हृदय मस्तिष्क जीवन शनि clockwise from twelve o'clock, a 6° gap at each finial");
  ok(Math.abs(chakraRadians(0) + Math.PI / 2) < 1e-12 && Math.abs(chakraRadians(90)) < 1e-12, "twelve o'clock is up and clockwise is clockwise on the canvas");
  const r = 200;
  const names = order.map((id) => chakraNamePlace(CHAKRA_MAJOR_ARCS[id], r));
  ok(names.every((p) => Math.abs(Math.hypot(p.x, p.y) - r * CHAKRA_NAME_RADIUS) < 1e-9), "each name sits beside its arc, just outside the beads, at the arc's middle");
  ok(
    names[0]!.x > 0 && names[0]!.y < 0 && names[1]!.x > 0 && names[1]!.y > 0 && names[2]!.x < 0 && names[2]!.y > 0 && names[3]!.x < 0 && names[3]!.y < 0,
    "…the four diagonals: हृदय upper right, मस्तिष्क lower right, जीवन lower left, शनि upper left",
  );
  ok(names.every((p) => p.align === (p.x >= 0 ? "left" : "right") && p.baseline === (p.y < 0 ? "bottom" : "top")), "…each set AWAY from the wheel, so a name never lies across the ring whatever its length");
  const heartMark = chakraMarkPlace(CHAKRA_MAJOR_ARCS.heart, r, CHAKRA_GAP_DEG);
  ok(Math.abs(heartMark.x - r * RING_RADII.majorArc) < 1e-9 && Math.abs(heartMark.y) < 1e-9, "a ✓ stands at its arc's END, in the gap after it — the heart's at three o'clock");
}

/* ------------------------ 3. Where the wheel sits ------------------------ */

{
  const phone = ringGeometry(390, 844);
  ok(phone.cx === 195, "the wheel is centred horizontally");
  ok(
    phone.cy <= 844 * RING_THUMB_Y + 1e-9 && phone.cy - phone.radius >= RING_PHONE_RESERVE_TOP,
    "on a phone it sits never LOWER than thumb height — M1.3 gives thumb height to the litany, and the free band above the litany's row decides the wheel's place",
  );
  const tall = ringGeometry(390, 1400);
  ok(Math.abs(tall.cy - 1400 * RING_THUMB_Y) < 1e-9, "where the free band allows it, exactly at thumb height");
  const desktop = ringGeometry(1440, 900);
  ok(desktop.cy === 450, "on a landscape screen, which is a window rather than a held object, it returns to the centre");
  ok(desktop.radius === 900 * RING_EXTENT, "and a desktop keeps the wheel at its largest — the phone's band does not apply there");
  ok(
    Math.abs(phone.radius - 390 * RING_EXTENT) < 1e-9,
    "the radius follows the SMALLER dimension, so the wheel is never cropped by the narrow axis",
  );
  ok(ringGeometry(0, 0).radius === 0, "a zero viewport has a zero ring rather than a negative one");
}

/* ------------- 3b. M1.3: inside the phone's free band, sized to the hand ------------- */

{
  /* 390×844 and 412×915 are the two phones M1.3 names; 390×664 is the first with Safari's bars showing. */
  for (const [width, height] of [
    [390, 844],
    [412, 915],
    [390, 664],
    [360, 640],
  ] as const) {
    for (const extent of [null, 60, 120, 400]) {
      const { cy, radius } = ringGeometry(width, height, extent);
      ok(
        cy - radius >= RING_PHONE_RESERVE_TOP - 1e-9 && cy + radius <= height - RING_PHONE_RESERVE_BOTTOM + 1e-9,
        `${width}×${height}, extent ${extent}: the wheel stays between the back mark's row and the litany's — nothing of the chamber lies over it`,
      );
    }
  }
  const short = ringGeometry(390, 664);
  ok(short.cy < 664 * RING_THUMB_Y, "a short viewport LIFTS the wheel rather than running it under the litany");

  const cap = ringGeometry(390, 844).radius;
  ok(ringGeometry(390, 844, null).radius === cap, "with no hand the ring rests at its largest");
  ok(ringGeometry(390, 844, 120).radius === 120, "with a hand it takes the hand's own extent");
  ok(ringGeometry(390, 844, 10).radius === cap * RING_MIN_SHARE, "never shrinking to a coin for a hand held far away");
  ok(ringGeometry(390, 844, 5000).radius === cap, "nor growing past the band for one held too close");
  ok(ringGeometry(390, 844, Number.NaN).radius === cap, "and a nonsense extent is treated as no hand");
  ok(RING_HAND_MARGIN > 1, "the wheel sits just OUTSIDE the hand, never through the fingertips");
}

/* ------------------- 4. The bands are in the right order ----------------- */

{
  const order = [
    RING_RADII.innerCircle,
    RING_RADII.tickInner,
    RING_RADII.tickOuter,
    RING_RADII.majorArc,
    RING_RADII.minorRing,
    RING_RADII.bead,
  ];
  let ascending = true;
  for (let i = 1; i < order.length; i += 1) if (order[i] <= order[i - 1]) ascending = false;
  ok(ascending, "read outward, every band sits outside the one before it: a tick band inside the inner circle is a wheel drawn inside out");
  ok(RING_RADII.bead === 1, "the beads are the outer edge, which is what the outer radius means");
  ok(RING_RADII.innerCircle < 0.75, "and the middle is left open, because the reader's hand is what goes there");
  ok(RING_RADII.majorArc < RING_RADII.minorRing, "the majors are the INNER ring and the minors the outer (chakra §1)");
}

/* -------------------- 5. What the draw actually draws ------------------- */

{
  const { context, calls, depth } = recorder();
  drawScanRing(context, { width: 390, height: 844, dpr: 2, elapsedMs: 5_000, palette: PALETTE });
  ok(depth() === 0, "the context is left exactly as it was found — a leaked transform makes the NEXT pass wrong, which is the hardest kind of frame bug to attribute");
  ok(calls.includes("translate") && calls.includes("rotate"), "the wheel is placed and turned rather than drawn at an angle point by point");
  ok(calls.filter((c) => c === "stroke").length >= 3, "the circles, ticks and finials are each stroked");
  ok(calls.filter((c) => c === "fill").length === 1, "and exactly ONE fill: the beads, which are punched dots in the reference and the only filled marks in the engraving");
  ok(!calls.some((c) => c.startsWith("fillText")), "without a chakra the bare wheel says nothing");

  const chakra = recorder();
  drawScanRing(chakra.context, { width: 390, height: 844, dpr: 2, elapsedMs: 5_000, palette: PALETTE, chakra: CHAKRA });
  const texts = chakra.calls.filter((c) => c.startsWith("fillText:")).map((c) => c.slice("fillText:".length));
  ok(chakra.depth() === 0, "with the chakra, still left as found");
  ok(["हृदय", "मस्तिष्क", "जीवन", "शनि"].every((name) => texts.includes(name)), "every major's name is on the ring");
  ok(texts.includes("पहचान 60%"), "the centre: \"पहचान N%\"");
  ok(texts.filter((t) => t === "✓").length === 1 && texts.filter((t) => t === "—").length === 1, "one ✓ for the confirmed line and one — for the unclear one; nothing for lines still gathering");
  ok(texts.includes(CHAKRA_WORDS.minors), "the outer ring's quiet \"अभी नहीं\" — the minors, honest, not hidden");
  ok(chakra.calls.filter((c) => c.startsWith("strokeText:")).length === texts.length, "every word over its dark halo");
  ok(!chakra.calls.includes("setLineDash"), "solid: no dash pattern — faint is an alpha, never a dash");
  const rotateAt = chakra.calls.indexOf("rotate");
  const firstText = chakra.calls.findIndex((c) => c.startsWith("fillText"));
  const restoreAfterRotate = chakra.calls.indexOf("restore", rotateAt);
  ok(restoreAfterRotate > rotateAt && firstText > restoreAfterRotate, "the engraving turns; the chakra does not — its names are drawn after the turn is undone");

  const sealed = recorder();
  drawScanRing(sealed.context, { width: 390, height: 844, dpr: 2, elapsedMs: 5_000, palette: PALETTE, chakra: { ...CHAKRA, centre: CHAKRA_WORDS.complete, centreSub: CHAKRA_WORDS.completeEn, seal: { pulse: 1, sweep: 0.5 } } });
  const sealedTexts = sealed.calls.filter((c) => c.startsWith("fillText:")).map((c) => c.slice("fillText:".length));
  ok(sealedTexts.includes("पहचान पूरी") && sealedTexts.includes("Scan complete"), "sealing: \"पहचान पूरी · Scan complete\" at the centre");
  ok(sealed.calls.filter((c) => c === "arc").length > chakra.calls.filter((c) => c === "arc").length, "…and the gold sweep is one more arc, closing the ring");

  const tiny = recorder();
  drawScanRing(tiny.context, { width: 0, height: 0, dpr: 1, elapsedMs: 0, palette: PALETTE, chakra: CHAKRA });
  ok(tiny.calls.length === 0, "a zero viewport draws nothing at all rather than a degenerate ring at the origin");
}

/* --------------------- 6. No colour lives in this file ------------------- */

{
  const source = readFileSync(path.resolve(__dirname, "..", "components", "sanctuary", "chamber", "scan-ring.ts"), "utf8");
  ok(!/#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(/.test(source), "the ring carries no colour of its own: the palette is passed in, read from the sanctuary tokens");
  ok(/RING_DEGREES_PER_SECOND\s*=\s*0\.6/.test(source), "and the spec's rotation rate is a named constant rather than a number inlined in a trig expression");
}

console.log(`CHAMBER RING ASSERTIONS PASSED (${assertions})`);
