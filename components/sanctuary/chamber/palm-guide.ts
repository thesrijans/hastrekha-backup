/**
 * THE PALM GUIDE (scan-complete G2.2): a faint palm-shaped outline at the size the distance meter aims for,
 * centred in the ring, fading out once the palm is in the band.
 *
 * WHAT SIZE. The meter's target (lib/scan/distance.ts PALM_QUAD_TARGET_FILL — measured where the landmarker
 * still holds a palm, not the band's middle): the palm quad spanning that share of the frame's short side.
 * The guide is drawn so ITS palm quad is exactly that wide on screen — the frame's short side in video
 * pixels, times the target, times the cover scale the feed is drawn at — so "put your palm on the outline"
 * and "सही दूरी ✓" are the same instruction.
 *
 * WHAT SHAPE. A palm: the palm's outline with its thenar bulge and the knuckles' scallop, and the fingers and
 * thumb as far as their first joint, each closed by a rounded tip and fading out along its length. Open
 * parallel stubs read as rays over the ring (the G2 capture); a rounded tip reads as a finger, and the fade
 * says what the gate says since G1 — the palm is the ask, the fingers only its context. They stop at the
 * first joint because at the target distance a real middle fingertip is already above the frame. The
 * proportions are a real palm's: the landmarks of the golden session's first still, a right hand, in units
 * of its palm-quad width.
 *
 * WHICH WAY. Drawn with the thumb on the display's right (a right palm on the back camera), and mirrored for
 * the other side — the chamber passes the side of the last palm it saw.
 *
 * Canvas 2D, a solid 1px hairline in the linework gold at a faint alpha — the secondary rung, and never
 * dashed (ui-sanctuary-spec §3: solid strokes only) — below the constellation, never over a crease. No
 * colour appears here; the palette is passed in.
 */
import { PALM_QUAD_TARGET_FILL } from "@/lib/scan/distance";
import { coverTransform } from "@/lib/scan/view-transform";

/** How strongly the guide is drawn when it is guiding: faint — it is a place to put a hand, not an object. */
export const GUIDE_ALPHA = 0.32;

/** How far the guide's alpha moves toward its target each frame: about half a second to fade at 60 fps. */
export const GUIDE_EASE = 0.12;

/** The guide's line, in CSS pixels: the linework ladder's secondary rung, solid (ui-sanctuary-spec §3). */
export const GUIDE_LINE_WIDTH = 1;

/** A fingertip is drawn at this share of the palm's alpha: the fingers fade from the palm toward it. */
export const GUIDE_TIP_ALPHA_SHARE = 0.4;

/** The fade is drawn in this many steps along each finger — too small a step (under 0.02 alpha) to see. */
export const GUIDE_FADE_STEPS = 6;

/** Chords in each rounded fingertip's half circle. */
const TIP_CHORDS = 8;

type Pt = readonly [number, number];

/**
 * The palm's outline, thumb on the RIGHT, in palm-quad widths from the palm quad's centre (x right, y down),
 * clockwise from the wrist's little-finger side. Measured off session still 0 (wrist, thumb root, index and
 * little knuckles, percussion edge) and smoothed through a Catmull-Rom curve when drawn.
 */
const PALM_OUTLINE: readonly Pt[] = [
  [-0.3, 0.62],
  [-0.52, 0.3],
  [-0.58, -0.1],
  [-0.5, -0.45],
  [-0.36, -0.6],
  [-0.08, -0.68],
  [0.24, -0.72],
  [0.5, -0.69],
  [0.63, -0.46],
  [0.64, -0.1],
  [0.67, 0.24],
  [0.5, 0.52],
  [0.22, 0.64],
];

interface Finger {
  /** Where it leaves the palm (the centre of its base), in palm-quad widths. */
  readonly base: Pt;
  /** Which way it runs: a unit vector. */
  readonly direction: Pt;
  readonly halfWidth: number;
  /** How far its first joint is from the knuckle (MCP → PIP; the thumb's MCP → IP): where the rounded tip ends. */
  readonly joint: number;
}

/** The fingers and the thumb. Joints measured on session still 0 (unit 184 px there). */
export const GUIDE_FINGERS: readonly Finger[] = [
  { base: [0.5, -0.69], direction: [0.16, -0.99], halfWidth: 0.11, joint: 0.62 }, // index
  { base: [0.23, -0.72], direction: [0.03, -1], halfWidth: 0.115, joint: 0.64 }, // middle
  { base: [-0.07, -0.68], direction: [-0.09, -1], halfWidth: 0.105, joint: 0.57 }, // ring
  { base: [-0.35, -0.6], direction: [-0.33, -0.94], halfWidth: 0.09, joint: 0.44 }, // little
  { base: [0.66, 0.06], direction: [0.86, -0.51], halfWidth: 0.14, joint: 0.55 }, // thumb
];

/** A point of a finger's outline and how far along the finger it is: 0 at the palm, 1 at the tip. */
interface FingerPoint {
  readonly p: Pt;
  readonly t: number;
}

/**
 * One finger's outline, from its base on one side, up, round the rounded tip and back down the other: the two
 * sides run straight to a half circle of the finger's half-width whose far point is the joint.
 */
export function fingerOutline(finger: Finger): readonly FingerPoint[] {
  /* The table's directions are measured to two places, so each is normalised: a tip of a non-unit direction
     would be an ellipse. */
  const length = Math.hypot(finger.direction[0], finger.direction[1]);
  const [dx, dy] = [finger.direction[0] / length, finger.direction[1] / length];
  const [nx, ny] = [-dy, dx];
  const [bx, by] = finger.base;
  const r = finger.halfWidth;
  const straight = finger.joint - r;
  const at = (along: number, across: number): Pt => [bx + dx * along + nx * across, by + dy * along + ny * across];
  const out: FingerPoint[] = [{ p: at(0, -r), t: 0 }];
  for (let k = 0; k <= TIP_CHORDS; k += 1) {
    const phi = -Math.PI / 2 + (Math.PI * k) / TIP_CHORDS;
    out.push({ p: at(straight + r * Math.cos(phi), r * Math.sin(phi)), t: (straight + r * Math.cos(phi)) / finger.joint });
  }
  out.push({ p: at(0, r), t: 0 });
  return out;
}

/** The finger's alpha, as a share of the guide's, this far along it. */
export function fingerAlphaShare(t: number): number {
  return 1 - (1 - GUIDE_TIP_ALPHA_SHARE) * Math.min(1, Math.max(0, t));
}

/**
 * The palm quad's height over its width (wrist to the index knuckle, over thumb root to percussion edge): 1.26
 * on session still 0. On a landscape frame the fill is measured along the height, so this converts it back to
 * the width the outline is drawn in.
 */
export const GUIDE_QUAD_ASPECT = 1.26;

export interface PalmGuideGeometry {
  readonly cx: number;
  readonly cy: number;
  /** The guide's palm-quad width on screen, in canvas pixels. */
  readonly quadPx: number;
  /** Thumb on the display's right. */
  readonly thumbRight: boolean;
}

/**
 * Where and how big: centred on the ring, its palm quad at the target fill of the frame's short side, at the
 * cover scale the feed is drawn at. Null before the camera has a size.
 */
export function palmGuideGeometry(
  centre: { readonly cx: number; readonly cy: number },
  videoSize: { readonly width: number; readonly height: number } | null,
  canvas: { readonly width: number; readonly height: number },
  thumbRight: boolean,
): PalmGuideGeometry | null {
  if (videoSize === null) return null;
  const transform = coverTransform(videoSize.width, videoSize.height, canvas.width, canvas.height, false);
  if (transform === null) return null;
  /* The fill is measured along the frame's short side; on a portrait phone that is its width, the axis the
     guide's quad width lies on. On a landscape frame the palm quad's HEIGHT fills the short side, so the
     width the outline is drawn in is that height over the quad's aspect. */
  const landscape = videoSize.width > videoSize.height;
  const shortPx = Math.min(videoSize.width, videoSize.height) * transform.scale * PALM_QUAD_TARGET_FILL;
  const quadPx = landscape ? shortPx / GUIDE_QUAD_ASPECT : shortPx;
  return { cx: centre.cx, cy: centre.cy, quadPx, thumbRight };
}

/**
 * The fingers' outlines cut into the fade's steps: for each step, the stretches of every finger that lie in
 * it, as polylines in palm-quad units. A stretch is cut where it crosses a step boundary, so neighbouring
 * steps meet end to end.
 */
function fingerSteps(): readonly (readonly (readonly Pt[])[])[] {
  const steps: Pt[][][] = Array.from({ length: GUIDE_FADE_STEPS }, () => []);
  const stepOf = (t: number): number => Math.min(GUIDE_FADE_STEPS - 1, Math.max(0, Math.floor(t * GUIDE_FADE_STEPS)));
  for (const finger of GUIDE_FINGERS) {
    const outline = fingerOutline(finger);
    for (let i = 1; i < outline.length; i += 1) {
      const a = outline[i - 1]!;
      const b = outline[i]!;
      /* Where the stretch a→b crosses a step boundary (t linear along it: exact on the sides, a close
         approximation on the tip's short chords), in order from a. */
      const cuts: number[] = [];
      const lo = Math.min(a.t, b.t);
      const hi = Math.max(a.t, b.t);
      for (let k = 1; k < GUIDE_FADE_STEPS; k += 1) {
        const boundary = k / GUIDE_FADE_STEPS;
        if (boundary > lo && boundary < hi) cuts.push((boundary - a.t) / (b.t - a.t));
      }
      cuts.sort((u, v) => u - v);
      let from: Pt = a.p;
      let fromU = 0;
      for (const u of [...cuts, 1]) {
        /* The stretch's own end point when it is reached, so the next stretch can continue the same polyline. */
        const to: Pt = u === 1 ? b.p : [a.p[0] + (b.p[0] - a.p[0]) * u, a.p[1] + (b.p[1] - a.p[1]) * u];
        const step = steps[stepOf(a.t + (b.t - a.t) * ((fromU + u) / 2))]!;
        const last = step.at(-1);
        if (last !== undefined && last.at(-1) === from) last.push(to);
        else step.push([from, to]);
        from = to;
        fromU = u;
      }
    }
  }
  return steps;
}

/** The fade's steps never change with the geometry — they are in palm-quad units — so they are cut once. */
let fingerStepsCache: readonly (readonly (readonly Pt[])[])[] | null = null;

/**
 * Draw the guide at `alpha`. Nothing at all is drawn at zero: a faded guide leaves no path behind for the
 * compositor, and a test can tell "faded" from "faint". The context is left as it was found.
 *
 * The palm is one closed path at `alpha`; the fingers follow in {@link GUIDE_FADE_STEPS} strokes, each at the
 * alpha of its stretch of the fingers ({@link fingerAlphaShare}). Seven strokes a frame, and only while the
 * palm is out of the band.
 */
export function drawPalmGuide(context: CanvasRenderingContext2D, geometry: PalmGuideGeometry, alpha: number, line: string): void {
  if (!(alpha > 0.004) || !(geometry.quadPx > 0)) return;
  const unit = geometry.quadPx;
  const flip = geometry.thumbRight ? 1 : -1;
  const at = ([x, y]: Pt): { x: number; y: number } => ({ x: geometry.cx + x * unit * flip, y: geometry.cy + y * unit });

  context.save();
  context.globalAlpha = alpha;
  context.strokeStyle = line;
  context.lineWidth = GUIDE_LINE_WIDTH;
  context.lineJoin = "round";
  /* Butt ends: two steps of a finger meet end to end, and round caps would overlap there in a brighter dot. */
  context.lineCap = "butt";

  /* The palm: a closed Catmull-Rom curve through the outline, as cubic Béziers. */
  const points = PALM_OUTLINE.map(at);
  const n = points.length;
  context.beginPath();
  context.moveTo(points[0]!.x, points[0]!.y);
  for (let i = 0; i < n; i += 1) {
    const p0 = points[(i - 1 + n) % n]!;
    const p1 = points[i]!;
    const p2 = points[(i + 1) % n]!;
    const p3 = points[(i + 2) % n]!;
    context.bezierCurveTo(
      p1.x + (p2.x - p0.x) / 6,
      p1.y + (p2.y - p0.y) / 6,
      p2.x - (p3.x - p1.x) / 6,
      p2.y - (p3.y - p1.y) / 6,
      p2.x,
      p2.y,
    );
  }
  context.closePath();
  context.stroke();

  /* The fingers: up each side to the rounded tip at the first joint, fading as they go. */
  fingerStepsCache ??= fingerSteps();
  fingerStepsCache.forEach((polylines, step) => {
    if (polylines.length === 0) return;
    context.beginPath();
    for (const polyline of polylines) {
      const first = at(polyline[0]!);
      context.moveTo(first.x, first.y);
      for (let i = 1; i < polyline.length; i += 1) {
        const p = at(polyline[i]!);
        context.lineTo(p.x, p.y);
      }
    }
    context.globalAlpha = alpha * fingerAlphaShare((step + 0.5) / GUIDE_FADE_STEPS);
    context.stroke();
  });
  context.restore();
}

/** The guide's alpha after one frame, easing toward faint (guiding) or zero (the palm is in the band). */
export function nextGuideAlpha(current: number, inBand: boolean): number {
  const target = inBand ? 0 : GUIDE_ALPHA;
  const next = current + (target - current) * GUIDE_EASE;
  return Math.abs(next - target) < 0.002 ? target : next;
}
