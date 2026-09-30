/**
 * THE RESULT'S PICTURE (chakra spec §4): the frozen photograph of the reader's own hand, full screen, and on it —
 * lined — the held lines in gold, each with its Devanagari name on a thin leader.
 *
 * ONE DRAWING, THREE PLACES. The lines are drawn by the live overlay's own code (chamber-canvas.tsx
 * drawFoundLines: observed stretches solid, bridged ones faint, the names on leaders to the gutters), through the
 * frozen frame's own homography (freeze-frame.ts freezeProjector) — so the result shows them as the overlay showed
 * them, on the creases they were traced from. The same function draws the saved picture ({@link renderComposite}),
 * at the photograph's own resolution, and — while the ring closes — the frozen frame at the live view's framing.
 *
 * THE FRAMING. The photograph first lies exactly where the live feed did (object-fit: cover, mirrored as the
 * reader saw it: {@link coverView}); the result then eases to {@link palmView}, which fits the hand into the screen's
 * free band between the title and the leaf — never uncovering an edge, never zooming a small hand past
 * {@link RESULT_MAX_ZOOM} of the cover scale.
 *
 * No colour literal: the palette is the chamber's (chamber-canvas.tsx readPalette, the sanctuary tokens).
 */
import type { FreezeLine } from "@/lib/scan/freeze-frame";
import { freezeProjector } from "@/lib/scan/freeze-frame";
import type { ActiveLineId, Landmark3, Point2, TracedLine } from "@/lib/scan/types";
import { drawFoundLines, REVEAL_MS, type Palette } from "./chamber-canvas";

/** How the photograph lies on a box: box = (mirrored ? width − x : x) · scale + (dx, dy). */
export interface PhotoView {
  readonly scale: number;
  readonly dx: number;
  readonly dy: number;
  readonly mirrored: boolean;
  /** The photograph's own size, raw pixels. */
  readonly width: number;
  readonly height: number;
}

/** A small hand is brought forward, but never past this multiple of the cover scale. */
export const RESULT_MAX_ZOOM = 2.2;
/** The hand's box, grown by this share of its size on every side, so the fingertips are not cut at the edge. */
export const RESULT_FOCUS_PAD = 0.1;
/** How long the photograph takes to move from the live framing to the hand's. */
export const RESULT_FRAMING_MS = 520;

/** The room's look while the ring closes — the live chamber's dim — and the result's, lighter: it is a photograph now. */
export const ROOM_LOOK = { dim: 0.46, vignette: 0.96 } as const;
export const RESULT_LOOK = { dim: 0.1, vignette: 0.55 } as const;

/** The live feed's framing: object-fit cover, centred. */
export function coverView(photo: { readonly width: number; readonly height: number }, box: { readonly width: number; readonly height: number }, mirrored: boolean): PhotoView {
  const scale = Math.max(box.width / photo.width, box.height / photo.height);
  return { scale, dx: (box.width - photo.width * scale) / 2, dy: (box.height - photo.height * scale) / 2, mirrored, width: photo.width, height: photo.height };
}

/** A raw point on the box. */
export function viewPoint(view: PhotoView, point: Point2): Point2 {
  return { x: (view.mirrored ? view.width - point.x : point.x) * view.scale + view.dx, y: point.y * view.scale + view.dy };
}

/** The hand's box in raw pixels: all 21 landmarks (normalised), padded, inside the photograph. Null without a hand. */
export function handFocus(landmarks: readonly Landmark3[], photo: { readonly width: number; readonly height: number }): { x0: number; y0: number; x1: number; y1: number } | null {
  if (landmarks.length < 21) return null;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const mark of landmarks) {
    x0 = Math.min(x0, mark.x * photo.width);
    y0 = Math.min(y0, mark.y * photo.height);
    x1 = Math.max(x1, mark.x * photo.width);
    y1 = Math.max(y1, mark.y * photo.height);
  }
  const padX = (x1 - x0) * RESULT_FOCUS_PAD;
  const padY = (y1 - y0) * RESULT_FOCUS_PAD;
  return {
    x0: Math.max(0, x0 - padX),
    y0: Math.max(0, y0 - padY),
    x1: Math.min(photo.width, x1 + padX),
    y1: Math.min(photo.height, y1 + padY),
  };
}

/**
 * The hand's framing: the focus box fitted into the free band [top, bottom] of the box and centred in it, at no
 * less than the cover scale (the photograph still covers the screen) and no more than {@link RESULT_MAX_ZOOM} of it;
 * then held so no edge of the photograph comes into view.
 */
export function palmView(
  photo: { readonly width: number; readonly height: number },
  box: { readonly width: number; readonly height: number },
  focus: { readonly x0: number; readonly y0: number; readonly x1: number; readonly y1: number } | null,
  free: { readonly top: number; readonly bottom: number },
  mirrored: boolean,
): PhotoView {
  const cover = coverView(photo, box, mirrored);
  if (focus === null || focus.x1 <= focus.x0 || focus.y1 <= focus.y0) return cover;
  const bandHeight = Math.max(1, free.bottom - free.top);
  const fit = Math.min(box.width / (focus.x1 - focus.x0), bandHeight / (focus.y1 - focus.y0));
  const scale = Math.max(cover.scale, Math.min(fit, cover.scale * RESULT_MAX_ZOOM));
  const cx = mirrored ? photo.width - (focus.x0 + focus.x1) / 2 : (focus.x0 + focus.x1) / 2;
  const cy = (focus.y0 + focus.y1) / 2;
  const dx = Math.min(0, Math.max(box.width - photo.width * scale, box.width / 2 - cx * scale));
  const dy = Math.min(0, Math.max(box.height - photo.height * scale, (free.top + free.bottom) / 2 - cy * scale));
  return { scale, dx, dy, mirrored, width: photo.width, height: photo.height };
}

/** Between two framings, eased (0 → a, 1 → b). */
export function lerpView(a: PhotoView, b: PhotoView, t: number): PhotoView {
  const k = Math.min(1, Math.max(0, t));
  const e = k * k * (3 - 2 * k);
  return { ...b, scale: a.scale + (b.scale - a.scale) * e, dx: a.dx + (b.dx - a.dx) * e, dy: a.dy + (b.dy - a.dy) * e };
}

/** The held lines as the overlay's own line records (the overlay draws TracedLine maps). */
export function asTracedLines(lines: readonly FreezeLine[]): Partial<Record<ActiveLineId, TracedLine>> {
  const out: Partial<Record<ActiveLineId, TracedLine>> = {};
  for (const line of lines) out[line.id] = { id: line.id, points: line.points, confidence: 1, segments: line.segments, traced: line.traced };
  return out;
}

export interface ResultScene {
  /** The photograph, raw-sized: a canvas holding the frozen frame. */
  readonly photo: CanvasImageSource & { readonly width: number; readonly height: number };
  readonly anchors: readonly Point2[];
  readonly convention: number;
  readonly lines: readonly FreezeLine[];
}

/**
 * Draw the photograph on a box in `view`, its look (the room's dim and vignette), and — `lined` — the held lines
 * with their names. Returns the lines' box-space polylines (for the leaders' test, and the ±3 px measure).
 */
export function drawResult(
  context: CanvasRenderingContext2D,
  box: { readonly width: number; readonly height: number },
  scene: ResultScene,
  view: PhotoView,
  palette: Palette,
  options: {
    readonly lined: boolean;
    readonly look: { readonly dim: number; readonly vignette: number };
    /** The names hang no lower than this (the result's leaf lies below it); absent, the whole box. */
    readonly labelBottom?: number;
  },
): void {
  context.clearRect(0, 0, box.width, box.height);
  context.save();
  if (view.mirrored) {
    context.translate(view.dx + view.width * view.scale, view.dy);
    context.scale(-view.scale, view.scale);
  } else {
    context.translate(view.dx, view.dy);
    context.scale(view.scale, view.scale);
  }
  context.drawImage(scene.photo, 0, 0);
  context.restore();

  /* The look: an even wash, then the edges toward stone — the room's, lighter once it is a photograph. */
  context.save();
  if (options.look.dim > 0) {
    context.globalAlpha = options.look.dim;
    context.fillStyle = palette.ink;
    context.fillRect(0, 0, box.width, box.height);
  }
  if (options.look.vignette > 0) {
    const r = Math.max(box.width, box.height);
    const vignette = context.createRadialGradient(box.width / 2, box.height / 2, r * 0.25, box.width / 2, box.height / 2, r * 0.75);
    vignette.addColorStop(0, "transparent");
    vignette.addColorStop(1, palette.stone);
    context.globalAlpha = options.look.vignette;
    context.fillStyle = vignette;
    context.fillRect(0, 0, box.width, box.height);
  }
  context.restore();

  if (!options.lined) return;
  const toFrame = freezeProjector(scene.anchors, scene.convention);
  if (toFrame === null) return;
  const project = (point: Point2): Point2 | null => {
    const inFrame = toFrame(point);
    return inFrame === null ? null : viewPoint(view, inFrame);
  };
  /* Every line fully revealed: the reveal ramp is the live overlay's, and these lines were found long ago. */
  const firstSeen = new Map(scene.lines.map((line) => [line.id as string, -REVEAL_MS * 2]));
  const labelBox = options.labelBottom === undefined ? box : { width: box.width, height: Math.min(box.height, options.labelBottom) };
  drawFoundLines(context, asTracedLines(scene.lines), project, palette, firstSeen, 0, labelBox);
}

/**
 * The saved picture: the photograph at its own resolution, as the reader saw it (mirrored when the view was),
 * with the lines and their names — the result's lined view without the screen's chrome. Drawn in a box of
 * "screen pixels" `scale` times smaller than the photograph, so the lines' and names' sizes read as they do on a
 * phone, then scaled up to the photograph's pixels.
 */
export function renderComposite(target: HTMLCanvasElement, scene: ResultScene, palette: Palette, mirrored: boolean): void {
  const width = scene.photo.width;
  const height = scene.photo.height;
  target.width = width;
  target.height = height;
  const context = target.getContext("2d");
  if (context === null) throw new Error("2d context unavailable");
  const scale = Math.max(1, Math.min(width, height) / 412);
  const box = { width: width / scale, height: height / scale };
  context.setTransform(scale, 0, 0, scale, 0, 0);
  drawResult(context, box, scene, { scale: 1 / scale, dx: 0, dy: 0, mirrored, width, height }, palette, { lined: true, look: { dim: 0, vignette: 0.35 } });
  context.setTransform(1, 0, 0, 1, 0, 0);
}
