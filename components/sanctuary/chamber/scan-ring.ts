/**
 * The celestial ring — the zodiac wheel from the wordmark, drawn as canvas arcs.
 *
 * §6.3: "The zodiac ring from the reference, drawn as canvas arcs, rotating
 * 0.6°/s, filling as the tilt choreography completes."
 *
 * THE REFERENCE, read outward from the centre (brand-hastrekha-logo-zodiac-wheel):
 * an inner circle, a fine tick band, a band of twelve sectors divided by radial
 * spokes, a thin circle, and an outer ring of evenly spaced beads with a small
 * ornamental finial at each of the four quarters. Every one of those is a
 * hairline. Nothing in the wheel is filled, and nothing in it is thick — it is
 * engraved rather than printed, which is why this draws in strokes of one device
 * pixel and never in bars.
 *
 * THE SUN FACE AT THE WHEEL'S CENTRE IS DELIBERATELY ABSENT. In the wordmark it
 * is the subject; here the reader's own hand is, and it lies exactly where the
 * sun would be. Drawing both would put a face under a palm.
 *
 * ── WHY THIS IS A DRAW FUNCTION AND NOT A COMPONENT WITH ITS OWN CANVAS ──
 *
 * The obvious shape is <ScanRing/> owning a canvas of its own, and under the
 * §10 budget it is the wrong one. A second canvas is a second composited layer
 * over a live camera feed and a second raster of the whole viewport every frame,
 * for an effect that must sit UNDER the constellation anyway. So the ring keeps
 * its own module, its own geometry and its own test, and the chamber's single
 * canvas calls it first. The unit is intact; only the layer is shared.
 *
 * No colour appears below. The palette is passed in, read from the sanctuary
 * tokens by the component that owns the canvas, so this file cannot drift from
 * app/sanctuary.css the way a hard-coded gold would.
 */

/** Spec §6.3, exactly: the ring turns six tenths of a degree each second. */
export const RING_DEGREES_PER_SECOND = 0.6;

/** Twelve, because the wheel is a zodiac and the reference divides it twelve ways. */
export const RING_SECTORS = 12;

/** Beads on the outer ring. Four per sector, so a bead lands on every spoke. */
export const RING_BEADS = RING_SECTORS * 4;

/** Ticks in the fine band. Six per sector — the reference's own density at this size. */
export const RING_TICKS = RING_SECTORS * 6;

/**
 * The ring's radii, as fractions of its outer radius.
 *
 * Fractions rather than pixels so the whole wheel scales with the viewport
 * without any band changing its proportion to the others — which is the thing
 * that would make it stop reading as the wordmark's wheel.
 */
export const RING_RADII = {
  bead: 1,
  outerCircle: 0.955,
  sectorOuter: 0.955,
  sectorInner: 0.78,
  tickOuter: 0.755,
  tickInner: 0.715,
  innerCircle: 0.69,
} as const;

/** How much of the smaller viewport dimension the ring's outer radius takes. */
export const RING_EXTENT = 0.42;

/** How strongly a completed sector is washed. A tenth: felt on the second look, never on the first. */
export const SECTOR_WASH_ALPHA = 0.12;

/**
 * How strongly the wheel's own linework is drawn.
 *
 * Under half, and measured on a capture rather than chosen. At full strength
 * the wheel is the brightest object in the frame and reads as a DIAL laid over
 * somebody's hand — an instrument overlay, which is the language §5 reserves
 * for the scanner and not the language it reserves for a dial. The wordmark's
 * wheel is engraved into a dark ground and half-hidden by what sits on it; at
 * this weight so is this one, and the traced creases stay the brightest thing
 * on the screen, which is correct because they are the subject.
 */
export const RING_INK_ALPHA = 0.42;

export interface RingPalette {
  /** The linework: every circle, spoke, tick and bead. */
  readonly line: string;
  /** The wash laid into a sector the choreography has completed. */
  readonly fill: string;
}

export interface RingDraw {
  readonly width: number;
  readonly height: number;
  /** Device pixel ratio, so a hairline is one device pixel rather than one CSS pixel. */
  readonly dpr: number;
  /** Milliseconds since the ring began turning. */
  readonly elapsedMs: number;
  /** 0–1: how much of the tilt choreography is done. Fills that fraction of the sectors. */
  readonly progress: number;
  readonly palette: RingPalette;
}

/**
 * Where the ring's centre sits on a portrait screen, as a fraction of the height.
 *
 * §9: "The Chamber is full-bleed camera with the ring at thumb height." Dead
 * centre is where a ring goes on a desktop, where the screen is a window; on a
 * phone the screen is a thing being held, and the middle of it is behind the
 * hand doing the holding. Below centre is where a thumb reaches and where a
 * palm held up to a front camera actually lands.
 */
export const RING_THUMB_Y = 0.58;

/**
 * The ring's centre and outer radius for a viewport.
 *
 * Exported because the vignette is drawn concentric with it: a room whose
 * darkness is centred somewhere other than its own wheel has two centres, and
 * the eye finds the disagreement long before it can name it.
 */
export function ringGeometry(width: number, height: number): { cx: number; cy: number; radius: number } {
  const portrait = height > width;
  return {
    cx: width / 2,
    cy: height * (portrait ? RING_THUMB_Y : 0.5),
    radius: Math.min(width, height) * RING_EXTENT,
  };
}

/**
 * How many sectors are lit at this progress.
 *
 * Floor, not round, and that is an A2 decision rather than a rounding
 * preference: rounding lights a sector at 4% of its own arc, so the ring reports
 * a pose as begun that the reader has barely started. A sector lights when its
 * share of the choreography is genuinely done.
 */
export function ringLitSectors(progress: number): number {
  if (!Number.isFinite(progress) || progress <= 0) return 0;
  return Math.min(RING_SECTORS, Math.floor(progress * RING_SECTORS));
}

/** The ring's rotation in radians at this moment. */
export function ringRotation(elapsedMs: number): number {
  if (!Number.isFinite(elapsedMs)) return 0;
  return ((elapsedMs / 1000) * RING_DEGREES_PER_SECOND * Math.PI) / 180;
}

/**
 * Draw the wheel.
 *
 * The context is left exactly as it was found: every mutation is inside one
 * save/restore pair. A canvas shared by three draw passes where one of them
 * leaks a transform is a bug that shows up as the NEXT pass being subtly wrong,
 * which is among the harder things to attribute in a frame.
 */
export function drawScanRing(context: CanvasRenderingContext2D, draw: RingDraw): void {
  const { cx, cy, radius } = ringGeometry(draw.width, draw.height);
  if (radius <= 0) return;

  const hairline = 1 / Math.max(draw.dpr, 1);
  const lit = ringLitSectors(draw.progress);
  const step = (Math.PI * 2) / RING_SECTORS;

  context.save();
  context.translate(cx, cy);
  context.rotate(ringRotation(draw.elapsedMs));
  context.lineWidth = hairline;
  context.strokeStyle = draw.palette.line;
  context.globalAlpha = RING_INK_ALPHA;

  /* ── the lit sectors, laid in first so every line is drawn ON them ──
     A wash under the linework rather than over it: gold drawn over its own
     wash loses the crispness that makes the wheel read as engraved.

     AND IT IS A WASH. The first capture filled the band at full strength and
     the result was a solid orange arc a third of the screen tall — the
     brightest object in a scene whose subject is a hand, reporting progress
     the way a loading bar does. At a tenth of that it is a sector catching the
     light, which is what the reference's wheel does and what a filled sector
     is FOR: to be noticed on the second look rather than the first. */
  if (lit > 0) {
    context.globalAlpha = SECTOR_WASH_ALPHA;
    /* The wash is its own weight, not the linework's. */
    context.fillStyle = draw.palette.fill;
    context.beginPath();
    for (let i = 0; i < lit; i += 1) {
      const from = i * step - Math.PI / 2;
      context.moveTo(Math.cos(from) * radius * RING_RADII.sectorInner, Math.sin(from) * radius * RING_RADII.sectorInner);
      context.arc(0, 0, radius * RING_RADII.sectorOuter, from, from + step);
      context.arc(0, 0, radius * RING_RADII.sectorInner, from + step, from, true);
      context.closePath();
    }
    context.fill();
    context.globalAlpha = RING_INK_ALPHA;
  }

  /* ── the three circles ── */
  context.beginPath();
  for (const key of ["outerCircle", "sectorInner", "innerCircle"] as const) {
    const r = radius * RING_RADII[key];
    context.moveTo(r, 0);
    context.arc(0, 0, r, 0, Math.PI * 2);
  }
  context.stroke();

  /* ── twelve spokes ── */
  context.beginPath();
  for (let i = 0; i < RING_SECTORS; i += 1) {
    const angle = i * step - Math.PI / 2;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    context.moveTo(cos * radius * RING_RADII.sectorInner, sin * radius * RING_RADII.sectorInner);
    context.lineTo(cos * radius * RING_RADII.sectorOuter, sin * radius * RING_RADII.sectorOuter);
  }
  context.stroke();

  /* ── the fine tick band ── */
  context.beginPath();
  for (let i = 0; i < RING_TICKS; i += 1) {
    const angle = (i / RING_TICKS) * Math.PI * 2;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    context.moveTo(cos * radius * RING_RADII.tickInner, sin * radius * RING_RADII.tickInner);
    context.lineTo(cos * radius * RING_RADII.tickOuter, sin * radius * RING_RADII.tickOuter);
  }
  context.stroke();

  /* ── the outer beads ──
     Filled, and the only filled marks in the wheel: in the reference they are
     punched dots rather than drawn circles, and a stroked ring of 48 tiny
     circles at hairline weight reads as a dotted line instead. */
  context.fillStyle = draw.palette.line;
  const bead = Math.max(hairline, radius * 0.006);
  context.beginPath();
  for (let i = 0; i < RING_BEADS; i += 1) {
    const angle = (i / RING_BEADS) * Math.PI * 2;
    const bx = Math.cos(angle) * radius * RING_RADII.bead;
    const by = Math.sin(angle) * radius * RING_RADII.bead;
    context.moveTo(bx + bead, by);
    context.arc(bx, by, bead, 0, Math.PI * 2);
  }
  context.fill();

  /* ── the four finials ──
     A small diamond at each quarter, which is what the reference puts there and
     what stops the bead ring reading as a dotted circle with no orientation. */
  const finial = radius * 0.022;
  context.beginPath();
  for (let i = 0; i < 4; i += 1) {
    const angle = (i / 4) * Math.PI * 2 - Math.PI / 2;
    const fx = Math.cos(angle) * radius * (RING_RADII.bead + 0.035);
    const fy = Math.sin(angle) * radius * (RING_RADII.bead + 0.035);
    context.moveTo(fx, fy - finial);
    context.lineTo(fx + finial, fy);
    context.lineTo(fx, fy + finial);
    context.lineTo(fx - finial, fy);
    context.closePath();
  }
  context.stroke();

  context.restore();
}
