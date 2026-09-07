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
 * The A2 assertion here is `ringLitSectors` flooring rather than rounding. A
 * ring that lights a sector at 4% of its own arc is telling the reader a pose
 * is under way that they have barely begun.
 * ========================================================================== */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  RING_BEADS,
  RING_DEGREES_PER_SECOND,
  RING_EXTENT,
  RING_RADII,
  RING_SECTORS,
  RING_THUMB_Y,
  RING_TICKS,
  drawScanRing,
  ringGeometry,
  ringLitSectors,
  ringRotation,
} from "../components/sanctuary/chamber/scan-ring";

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
    lineWidth: 0,
    strokeStyle: "",
    fillStyle: "",
  };
  return { context: target as unknown as CanvasRenderingContext2D, calls, depth: () => depth };
}

const PALETTE = { line: "var(--color-snc-gold-500)", fill: "var(--color-snc-flame-warm)" };

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
  ok(RING_BEADS % RING_SECTORS === 0, "the beads divide evenly by sector, so a bead lands on every spoke");
  ok(RING_TICKS % RING_SECTORS === 0, "and so do the ticks");
}

/* --------------- 2. A sector lights only once it is earned --------------- */

{
  ok(ringLitSectors(0) === 0, "nothing done, nothing lit");
  ok(
    ringLitSectors(1 / RING_SECTORS - 0.001) === 0,
    "a sector one thousandth short of its own share is NOT lit: rounding here would light a sector at 4% of its arc and report a pose the reader has barely started",
  );
  ok(ringLitSectors(1 / RING_SECTORS) === 1, "and lights the moment its share is genuinely done");
  ok(ringLitSectors(1) === RING_SECTORS, "a finished choreography lights the whole wheel");
  ok(ringLitSectors(4) === RING_SECTORS, "and cannot light more than the wheel has");
  ok(ringLitSectors(-1) === 0 && ringLitSectors(Number.NaN) === 0, "nonsense lights nothing rather than throwing mid-frame");
}

/* ------------------------ 3. Where the wheel sits ------------------------ */

{
  const phone = ringGeometry(390, 844);
  ok(phone.cx === 195, "the wheel is centred horizontally");
  ok(
    Math.abs(phone.cy - 844 * RING_THUMB_Y) < 1e-9,
    "and on a portrait screen it sits BELOW centre, at thumb height — the middle of a phone is behind the hand holding it",
  );
  const desktop = ringGeometry(1440, 900);
  ok(desktop.cy === 450, "on a landscape screen, which is a window rather than a held object, it returns to the centre");
  ok(
    Math.abs(phone.radius - 390 * RING_EXTENT) < 1e-9,
    "the radius follows the SMALLER dimension, so the wheel is never cropped by the narrow axis",
  );
  ok(ringGeometry(0, 0).radius === 0, "a zero viewport has a zero ring rather than a negative one");
}

/* ------------------- 4. The bands are in the right order ----------------- */

{
  const order = [
    RING_RADII.innerCircle,
    RING_RADII.tickInner,
    RING_RADII.tickOuter,
    RING_RADII.sectorInner,
    RING_RADII.sectorOuter,
    RING_RADII.bead,
  ];
  let ascending = true;
  for (let i = 1; i < order.length; i += 1) if (order[i] <= order[i - 1]) ascending = false;
  ok(ascending, "read outward, every band sits outside the one before it: a tick band inside the inner circle is a wheel drawn inside out");
  ok(RING_RADII.bead === 1, "the beads are the outer edge, which is what the outer radius means");
  ok(RING_RADII.innerCircle < 0.75, "and the middle is left open, because the reader's hand is what goes there");
}

/* -------------------- 5. What the draw actually draws ------------------- */

{
  const { context, calls, depth } = recorder();
  drawScanRing(context, { width: 390, height: 844, dpr: 2, elapsedMs: 5_000, progress: 0, palette: PALETTE });
  ok(depth() === 0, "the context is left exactly as it was found — a leaked transform makes the NEXT pass wrong, which is the hardest kind of frame bug to attribute");
  ok(calls.includes("translate") && calls.includes("rotate"), "the wheel is placed and turned rather than drawn at an angle point by point");
  ok(calls.filter((c) => c === "stroke").length >= 4, "the circles, spokes, ticks and finials are each stroked");
  ok(calls.filter((c) => c === "fill").length === 1, "and exactly ONE fill: the beads, which are punched dots in the reference and the only filled marks in the wheel");

  const unlit = recorder();
  drawScanRing(unlit.context, { width: 390, height: 844, dpr: 2, elapsedMs: 0, progress: 0, palette: PALETTE });
  const lit = recorder();
  drawScanRing(lit.context, { width: 390, height: 844, dpr: 2, elapsedMs: 0, progress: 1, palette: PALETTE });
  ok(
    lit.calls.filter((c) => c === "fill").length === unlit.calls.filter((c) => c === "fill").length + 1,
    "a completed choreography adds exactly one more fill — the sector wash — rather than redrawing the wheel in a second style",
  );
  ok(
    lit.calls.filter((c) => c === "closePath").length -
      unlit.calls.filter((c) => c === "closePath").length ===
      RING_SECTORS,
    "and the wash it adds is twelve closed sectors, one per sector, not one arc swept across them",
  );

  const tiny = recorder();
  drawScanRing(tiny.context, { width: 0, height: 0, dpr: 1, elapsedMs: 0, progress: 1, palette: PALETTE });
  ok(tiny.calls.length === 0, "a zero viewport draws nothing at all rather than a degenerate ring at the origin");
}

/* --------------------- 6. No colour lives in this file ------------------- */

{
  const source = readFileSync(path.resolve(__dirname, "..", "components", "sanctuary", "chamber", "scan-ring.ts"), "utf8");
  ok(!/#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(/.test(source), "the ring carries no colour of its own: the palette is passed in, read from the sanctuary tokens");
  ok(/RING_DEGREES_PER_SECOND\s*=\s*0\.6/.test(source), "and the spec's rotation rate is a named constant rather than a number inlined in a trig expression");
}

console.log(`CHAMBER RING ASSERTIONS PASSED (${assertions})`);
