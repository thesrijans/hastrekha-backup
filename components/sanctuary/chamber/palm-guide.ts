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
 * WHAT SHAPE. A palm, not a hand: the palm's outline with its thenar bulge and the knuckles' scallop, and
 * short stubs where the fingers and the thumb leave it. The fingers are cut short on purpose — at the target
 * distance a real palm's fingertips leave the frame (G1 lets them), and a guide that drew them whole would
 * be asking for a hand the camera no longer sees. The proportions are a real palm's: the landmarks of the
 * golden session's first still, a right hand, in units of its palm-quad width.
 *
 * WHICH WAY. Drawn with the thumb on the display's right (a right palm on the back camera), and mirrored for
 * the other side — the chamber passes the side of the last palm it saw.
 *
 * Canvas 2D, one path, dashed hairline in the linework gold at a faint alpha: the ring's own language, below
 * the constellation, never over a crease. No colour appears here; the palette is passed in.
 */
import { PALM_QUAD_TARGET_FILL } from "@/lib/scan/distance";
import { coverTransform } from "@/lib/scan/view-transform";

/** How strongly the guide is drawn when it is guiding: faint — it is a place to put a hand, not an object. */
export const GUIDE_ALPHA = 0.32;

/** How far the guide's alpha moves toward its target each frame: about half a second to fade at 60 fps. */
export const GUIDE_EASE = 0.12;

/** A dashed hairline: a guide reads as "place here", a solid line as something already there. */
export const GUIDE_DASH: readonly number[] = [6, 5];

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

/** Where each finger (and the thumb) leaves the palm, and which way it goes: base centre, unit direction, half-width. */
const STUBS: readonly { readonly base: Pt; readonly direction: Pt; readonly halfWidth: number }[] = [
  { base: [0.5, -0.69], direction: [0.16, -0.99], halfWidth: 0.11 }, // index
  { base: [0.23, -0.72], direction: [0.03, -1], halfWidth: 0.115 }, // middle
  { base: [-0.07, -0.68], direction: [-0.09, -1], halfWidth: 0.105 }, // ring
  { base: [-0.35, -0.6], direction: [-0.33, -0.94], halfWidth: 0.09 }, // little
  { base: [0.66, 0.06], direction: [0.86, -0.51], halfWidth: 0.14 }, // thumb
];

/** How far the stubs run past the palm, in palm-quad widths: the fingers' first joint, no further. */
export const GUIDE_STUB_LENGTH = 0.34;

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
 * Draw the guide at `alpha`. Nothing at all is drawn at zero: a faded guide leaves no path behind for the
 * compositor, and a test can tell "faded" from "faint". The context is left as it was found.
 */
export function drawPalmGuide(context: CanvasRenderingContext2D, geometry: PalmGuideGeometry, alpha: number, line: string): void {
  if (!(alpha > 0.004) || !(geometry.quadPx > 0)) return;
  const unit = geometry.quadPx;
  const flip = geometry.thumbRight ? 1 : -1;
  const at = ([x, y]: Pt): { x: number; y: number } => ({ x: geometry.cx + x * unit * flip, y: geometry.cy + y * unit });

  context.save();
  context.globalAlpha = alpha;
  context.strokeStyle = line;
  context.lineWidth = 1.25;
  context.lineCap = "round";
  context.setLineDash(GUIDE_DASH as number[]);

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

  /* The stubs: two sides of each finger, from the palm to its first joint, open at the end. */
  for (const stub of STUBS) {
    const [dx, dy] = stub.direction;
    const [nx, ny] = [-dy, dx];
    for (const side of [-1, 1]) {
      const from: Pt = [stub.base[0] + nx * stub.halfWidth * side, stub.base[1] + ny * stub.halfWidth * side];
      const to: Pt = [from[0] + dx * GUIDE_STUB_LENGTH, from[1] + dy * GUIDE_STUB_LENGTH];
      const a = at(from);
      const b = at(to);
      context.moveTo(a.x, a.y);
      context.lineTo(b.x, b.y);
    }
  }
  context.stroke();
  context.restore();
}

/** The guide's alpha after one frame, easing toward faint (guiding) or zero (the palm is in the band). */
export function nextGuideAlpha(current: number, inBand: boolean): number {
  const target = inBand ? 0 : GUIDE_ALPHA;
  const next = current + (target - current) * GUIDE_EASE;
  return Math.abs(next - target) < 0.002 ? target : next;
}
