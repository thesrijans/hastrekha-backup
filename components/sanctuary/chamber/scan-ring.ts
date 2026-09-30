/**
 * The celestial ring — the zodiac wheel from the wordmark, drawn as canvas arcs — and, since G4b, THE CHAKRA:
 * the scan's progress, told on the wheel itself (docs/specs/chakra-scan-g4.txt §1).
 *
 * §6.3: "The zodiac ring from the reference, drawn as canvas arcs, rotating
 * 0.6°/s." Its sectors used to fill with the tilt choreography; the chakra
 * spec found the wheel "on screen the whole time but says nothing", and the
 * choreography blocks nothing any more (§2). So the sector band and its spokes
 * are gone, and in their place, still while the engraving turns:
 *
 *   the INNER ring — four arcs, one per major line, each filling clockwise in
 *     antique gold with its line's evidence toward CONFIRMED, its Devanagari
 *     name beside it, a ✓ at its end once confirmed, "—" and a dimmed hairline
 *     once the budget has marked it unclear;
 *   the OUTER ring — the thin circle, now one hairline arc per minor line, open
 *     at six o'clock for its one quiet caption, "अभी नहीं", until S3;
 *   the CENTRE — "पहचान N%"; and on completion every arc pulses once and a gold
 *     sweep closes the ring (lib/scan/chakra.ts has the timings).
 *
 * THE REFERENCE, read outward from the centre (brand-hastrekha-logo-zodiac-wheel):
 * an inner circle, a fine tick band, a thin circle, and an outer ring of evenly
 * spaced beads with a small ornamental finial at each of the four quarters.
 * Every one of those is a hairline, engraved rather than printed; they still
 * turn, under the chakra, which does not — a name that turned would be read
 * sideways by the end of a scan.
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
import { CHAKRA_MAJOR_ARCS, CHAKRA_MINOR_ARCS, CHAKRA_WORDS, type ChakraArc, type ChakraMinorId } from "@/lib/scan/chakra";
import type { ActiveLineId } from "@/lib/scan/types";

/** Spec §6.3, exactly: the ring turns six tenths of a degree each second. */
export const RING_DEGREES_PER_SECOND = 0.6;

/** Twelve, because the wheel is a zodiac and the reference divides it twelve ways. */
export const RING_SECTORS = 12;

/** Beads on the outer ring. Four per sector, so a bead lands on every twelfth of the wheel. */
export const RING_BEADS = RING_SECTORS * 4;

/** Ticks in the fine band. Six per sector — the reference's own density at this size. */
export const RING_TICKS = RING_SECTORS * 6;

/**
 * The ring's radii, as fractions of its outer radius.
 *
 * Fractions rather than pixels so the whole wheel scales with the viewport
 * without any band changing its proportion to the others — which is the thing
 * that would make it stop reading as the wordmark's wheel. G4b: the major arcs
 * sit where the sector band was, and the thin circle is the minors' ring.
 */
export const RING_RADII = {
  bead: 1,
  minorRing: 0.955,
  majorArc: 0.855,
  tickOuter: 0.755,
  tickInner: 0.715,
  innerCircle: 0.69,
} as const;

/** How much of the smaller viewport dimension the ring's outer radius takes, at most. */
export const RING_EXTENT = 0.42;

/**
 * M1.3 — THE RING IS SIZED TO THE HAND. With a hand in view the ring's radius eases toward the hand's
 * own extent (chamber-canvas.tsx measures it: the farthest landmark from the hand's centre, in canvas
 * pixels, times {@link RING_HAND_MARGIN}); with none it rests at its largest. Never smaller than
 * {@link RING_MIN_SHARE} of that largest, so a hand held far away still gets a wheel rather than a coin.
 */
export const RING_HAND_MARGIN = 1.12;
export const RING_MIN_SHARE = 0.45;

/**
 * M1.3 — THE PHONE'S FREE BAND. On a phone the chamber's DOM owns a row at each end of the screen: the
 * back mark above; below, from the bottom edge up, the Rekha Monitor's handle, the controls row (G4b: the
 * flip, the shutter and the torch) and the litany's leaf. The ring must fit between them — "nothing
 * overlapping the feed" means the hand's wheel is never under a leaf or a control — so on a phone its radius
 * is also capped by the band and its centre is held inside it. In CSS pixels:
 *
 *   top      the back mark's 44px target at 0.75rem, plus a gap
 *   bottom   the monitor handle (3rem), the dock's gap (1.25rem), the controls row (--snc-shutter-row, G4b) and
 *            the leaf at its TALLEST — the longest stage line, the "found nothing" note and the longest hint together
 *            reach 306px above the bottom edge at 390×844, 390×664 and 412×915 (scripts/capture/capture-chamber-phone.mjs
 *            measures it) — plus a 9px gap. Measured, not estimated (M1.3: 228, sized to a one-hint leaf, let the
 *            tallest leaf into the wheel by 31px; G4b: 268 + the row's 72, less the width the leaf got back, is 315).
 */
export const RING_PHONE_RESERVE_TOP = 64;
export const RING_PHONE_RESERVE_BOTTOM = 315;
/** The chamber's phone layout is the Rekha Monitor's: below 900px it becomes the pull-up sheet. */
export const RING_PHONE_MAX_WIDTH = 899;

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

/* ------------------------------ the chakra (G4b) ------------------------------ */

/** A major's arc when filled: this share of the ring's radius wide, within these bounds (CSS px). */
export const CHAKRA_ARC_WIDTH = 0.021;
export const CHAKRA_ARC_MIN_PX = 2.5;
export const CHAKRA_ARC_MAX_PX = 4;
/**
 * An arc's empty track — over the engraving's 0.42, so the four slots read as slots at 0% (the first G4b capture
 * lost them among the circles at 0.55) — and an unclear arc's hairline, dimmed.
 */
export const CHAKRA_TRACK_ALPHA = 0.75;
export const CHAKRA_UNCLEAR_ALPHA = 0.22;
/** The minors' hairlines and their one caption: quiet. */
export const CHAKRA_MINOR_ALPHA = 0.45;
export const CHAKRA_CAPTION_ALPHA = 0.62;
/** A name's anchor, out along its arc's diagonal: just clear of the beads and the finials' tips. */
export const CHAKRA_NAME_RADIUS = 1.08;
/** Text sizes, CSS px: the names and their marks, the centre, the caption. */
export const CHAKRA_NAME_PX = 13;
export const CHAKRA_CENTRE_PX = 15;
export const CHAKRA_CAPTION_PX = 10;
/** The pulse on completion widens every arc by up to this share. */
export const CHAKRA_PULSE_GAIN = 0.9;

export interface RingPalette {
  /** The engraving: every circle, tick, bead and finial, and the arcs' empty tracks. */
  readonly line: string;
  /** The arcs' fill: antique gold. */
  readonly arc?: string;
  /** The names, the marks and the centre's words. */
  readonly text?: string;
  /** The dark halo under every word, so it reads on a palm of any tone. */
  readonly halo?: string;
  /** The Devanagari face, as a CSS font-family list. */
  readonly font?: string;
}

/** One major's arc to draw (lib/scan/chakra.ts ChakraMajor). */
export interface ChakraMajorDraw {
  readonly id: ActiveLineId;
  readonly name: string;
  readonly status: "gathering" | "confirmed" | "unclear";
  /** 0–1 of the arc filled. */
  readonly fill: number;
}

/** What the chakra shows this frame. */
export interface ChakraDraw {
  readonly majors: readonly ChakraMajorDraw[];
  readonly minors: readonly { readonly id: ChakraMinorId }[];
  /** "पहचान N%" — or, sealing, "पहचान पूरी". */
  readonly centre: string;
  /** A second, smaller line under the centre ("Scan complete"). */
  readonly centreSub?: string | null;
  /** On completion: the pulse (0 → 1 → 0) and the gold sweep (0 → 1) that closes the ring. */
  readonly seal?: { readonly pulse: number; readonly sweep: number } | null;
}

export interface RingDraw {
  readonly width: number;
  readonly height: number;
  /** Device pixel ratio, so a hairline is one device pixel rather than one CSS pixel. */
  readonly dpr: number;
  /** Milliseconds since the ring began turning. */
  readonly elapsedMs: number;
  readonly palette: RingPalette;
  /** M1.3: the hand's extent in CSS pixels, already smoothed; null with no hand in view. */
  readonly extent?: number | null;
  /** G4b: the chakra — the scan's progress. Absent, the bare wheel (its outer circle whole). */
  readonly chakra?: ChakraDraw | null;
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
 * The ring's centre and outer radius for a viewport, and — M1.3 — for the hand in it.
 *
 * Exported because the vignette is drawn concentric with it: a room whose
 * darkness is centred somewhere other than its own wheel has two centres, and
 * the eye finds the disagreement long before it can name it.
 *
 * On a phone (portrait, under the monitor's 900px breakpoint) the radius is also
 * capped by the free band between the chamber's top and bottom rows, and the
 * centre sits at thumb height unless that would push the wheel into either row,
 * in which case it moves just far enough not to. A short viewport — a phone with
 * its browser bars showing — therefore lifts the wheel rather than running it
 * under the litany.
 */
export function ringGeometry(width: number, height: number, extent: number | null = null): { cx: number; cy: number; radius: number } {
  const portrait = height > width;
  const largest = Math.min(width, height) * RING_EXTENT;
  const phone = portrait && width <= RING_PHONE_MAX_WIDTH;
  const top = phone ? RING_PHONE_RESERVE_TOP : 0;
  const bottom = phone ? height - RING_PHONE_RESERVE_BOTTOM : height;
  const cap = phone ? Math.max(0, Math.min(largest, (bottom - top) / 2)) : largest;
  const radius = extent === null || !Number.isFinite(extent) ? cap : Math.min(cap, Math.max(cap * RING_MIN_SHARE, extent));
  const thumb = height * (portrait ? RING_THUMB_Y : 0.5);
  const cy = phone ? Math.min(Math.max(thumb, top + radius), Math.max(top + radius, bottom - radius)) : thumb;
  return { cx: width / 2, cy, radius };
}

/** The ring's rotation in radians at this moment. */
export function ringRotation(elapsedMs: number): number {
  if (!Number.isFinite(elapsedMs)) return 0;
  return ((elapsedMs / 1000) * RING_DEGREES_PER_SECOND * Math.PI) / 180;
}

/** Degrees clockwise from twelve o'clock (the chakra's frame) → canvas radians (clockwise from three o'clock). */
export function chakraRadians(degrees: number): number {
  return ((degrees - 90) * Math.PI) / 180;
}

/** A filled arc's width at this radius, CSS px. */
export function chakraArcWidth(radius: number): number {
  return Math.min(CHAKRA_ARC_MAX_PX, Math.max(CHAKRA_ARC_MIN_PX, radius * CHAKRA_ARC_WIDTH));
}

/**
 * Where a major's name goes: out along its arc's middle — the four diagonals — just clear of the beads, and
 * set AWAY from the wheel in both directions (left-aligned on the right, above in the upper half), so the word
 * never lies across the ring whatever its length.
 */
export function chakraNamePlace(
  arc: ChakraArc,
  radius: number,
): { readonly x: number; readonly y: number; readonly align: "left" | "right"; readonly baseline: "bottom" | "top" } {
  const angle = chakraRadians(arc.startDeg + arc.sweepDeg / 2);
  const x = Math.cos(angle) * radius * CHAKRA_NAME_RADIUS;
  const y = Math.sin(angle) * radius * CHAKRA_NAME_RADIUS;
  return { x, y, align: x >= 0 ? "left" : "right", baseline: y < 0 ? "bottom" : "top" };
}

/** Where a major's ✓ (or "—") stands: at its arc's end, in the gap after it, on the arc's own radius. */
export function chakraMarkPlace(arc: ChakraArc, radius: number, gapDeg: number): { readonly x: number; readonly y: number } {
  const angle = chakraRadians(arc.startDeg + arc.sweepDeg + gapDeg / 2);
  return { x: Math.cos(angle) * radius * RING_RADII.majorArc, y: Math.sin(angle) * radius * RING_RADII.majorArc };
}

/**
 * Draw the wheel, and on it the chakra.
 *
 * The context is left exactly as it was found: every mutation is inside one
 * save/restore pair. A canvas shared by three draw passes where one of them
 * leaks a transform is a bug that shows up as the NEXT pass being subtly wrong,
 * which is among the harder things to attribute in a frame.
 */
export function drawScanRing(context: CanvasRenderingContext2D, draw: RingDraw): void {
  const { cx, cy, radius } = ringGeometry(draw.width, draw.height, draw.extent ?? null);
  if (radius <= 0) return;

  const hairline = 1 / Math.max(draw.dpr, 1);
  const chakra = draw.chakra ?? null;

  context.save();
  context.translate(cx, cy);

  /* ── the engraving, turning ── */
  context.save();
  context.rotate(ringRotation(draw.elapsedMs));
  context.lineWidth = hairline;
  context.strokeStyle = draw.palette.line;
  context.globalAlpha = RING_INK_ALPHA;

  /* The inner circle — and, without a chakra, the thin outer circle whole (with one, it is the minors' ring). */
  context.beginPath();
  for (const key of chakra === null ? (["minorRing", "innerCircle"] as const) : (["innerCircle"] as const)) {
    const r = radius * RING_RADII[key];
    context.moveTo(r, 0);
    context.arc(0, 0, r, 0, Math.PI * 2);
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
     Filled, and the only filled marks in the engraving: in the reference they
     are punched dots rather than drawn circles, and a stroked ring of 48 tiny
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

  /* ── the chakra, still ── */
  if (chakra !== null) drawChakra(context, radius, hairline, draw.palette, chakra);

  context.restore();
}

/** A word over its dark halo. */
function haloText(context: CanvasRenderingContext2D, text: string, x: number, y: number, halo: string | undefined): void {
  if (halo !== undefined) {
    context.strokeStyle = halo;
    context.strokeText(text, x, y);
  }
  context.fillText(text, x, y);
}

/**
 * The chakra, in the ring's own frame (translated to its centre, unrotated). The arcs are strokes, and solid —
 * faint is an alpha, never a dash (ui-sanctuary-spec §3).
 */
function drawChakra(context: CanvasRenderingContext2D, radius: number, hairline: number, palette: RingPalette, chakra: ChakraDraw): void {
  const arcGold = palette.arc ?? palette.line;
  const ink = palette.text ?? palette.line;
  const font = palette.font ?? "serif";
  const pulse = chakra.seal?.pulse ?? 0;
  const width = chakraArcWidth(radius) * (1 + CHAKRA_PULSE_GAIN * pulse);
  const majorR = radius * RING_RADII.majorArc;
  const minorR = radius * RING_RADII.minorRing;
  const arcPath = (arc: ChakraArc, r: number, share = 1): void => {
    const from = chakraRadians(arc.startDeg);
    context.moveTo(Math.cos(from) * r, Math.sin(from) * r);
    context.arc(0, 0, r, from, chakraRadians(arc.startDeg + arc.sweepDeg * Math.min(1, share)));
  };
  context.lineCap = "butt";
  context.lineJoin = "round";

  /* ── the outer ring: the minors, hairlines, open at six o'clock ── */
  context.lineWidth = hairline;
  context.strokeStyle = palette.line;
  context.globalAlpha = CHAKRA_MINOR_ALPHA;
  context.beginPath();
  for (const minor of chakra.minors) arcPath(CHAKRA_MINOR_ARCS[minor.id], minorR);
  context.stroke();

  /* ── the inner ring: each major's track, and a dimmed hairline once it is unclear ── */
  for (const major of chakra.majors) {
    context.globalAlpha = major.status === "unclear" ? CHAKRA_UNCLEAR_ALPHA : CHAKRA_TRACK_ALPHA;
    context.beginPath();
    arcPath(CHAKRA_MAJOR_ARCS[major.id], majorR);
    context.stroke();
  }

  /* ── …and its fill, clockwise from its start, in antique gold; then the seal's sweep from twelve o'clock ── */
  context.strokeStyle = arcGold;
  context.lineWidth = width;
  context.globalAlpha = 1;
  context.beginPath();
  for (const major of chakra.majors) if (major.fill > 0) arcPath(CHAKRA_MAJOR_ARCS[major.id], majorR, major.fill);
  const sweep = chakra.seal?.sweep ?? 0;
  if (sweep > 0) arcPath({ startDeg: 0, sweepDeg: 360 }, majorR, sweep);
  context.stroke();

  /* ── the words: names, marks, the caption and the centre, each over its halo ── */
  context.lineWidth = 3;
  context.fillStyle = ink;
  context.font = `${CHAKRA_NAME_PX}px ${font}`;
  for (const major of chakra.majors) {
    const arc = CHAKRA_MAJOR_ARCS[major.id];
    const name = chakraNamePlace(arc, radius);
    context.textAlign = name.align;
    context.textBaseline = name.baseline;
    context.globalAlpha = major.status === "unclear" ? 0.5 : major.status === "confirmed" ? 1 : major.fill > 0 ? 0.88 : 0.62;
    haloText(context, major.name, name.x, name.y, palette.halo);
    if (major.status !== "gathering") {
      const mark = chakraMarkPlace(arc, radius, 90 - arc.sweepDeg);
      context.textAlign = "center";
      context.textBaseline = "middle";
      context.globalAlpha = major.status === "confirmed" ? 1 : 0.55;
      haloText(context, major.status === "confirmed" ? "✓" : "—", mark.x, mark.y, palette.halo);
    }
  }

  context.textAlign = "center";
  context.textBaseline = "middle";
  if (chakra.minors.length > 0) {
    context.font = `${CHAKRA_CAPTION_PX}px ${font}`;
    context.globalAlpha = CHAKRA_CAPTION_ALPHA;
    haloText(context, CHAKRA_WORDS.minors, 0, minorR, palette.halo);
  }

  const sub = chakra.centreSub ?? null;
  context.globalAlpha = 1;
  context.font = `${CHAKRA_CENTRE_PX}px ${font}`;
  haloText(context, chakra.centre, 0, sub === null ? 0 : -CHAKRA_CENTRE_PX * 0.55, palette.halo);
  if (sub !== null) {
    context.font = `${CHAKRA_CAPTION_PX + 1}px ${font}`;
    context.globalAlpha = 0.8;
    haloText(context, sub, 0, CHAKRA_CENTRE_PX * 0.75, palette.halo);
  }
}
