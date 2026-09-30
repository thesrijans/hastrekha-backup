/**
 * THE SNAPS (scan-complete G4.2): "आपकी हथेली" — the plain palm, the frozen frame's rectified crop — and
 * "आपकी रेखाएँ" — the same crop with the held lines drawn in gold, each labelled in Devanagari, the observed
 * stretches solid and the bridged ones faint.
 *
 * Drawn on the 512 canonical crop itself, so the lines sit where the creases are in the picture the reader
 * keeps. Widths are set for the size the completion screen shows it at (about a third of 512): the observed
 * stroke reads as the active rung (2px) there, the bridged one as the secondary (1px), and both are SOLID —
 * faint is an alpha, never a dash (ui-sanctuary-spec §3). A soft glow under the observed stretches, the active
 * rung's; a dark halo under each name, so the ink reads on a palm of any tone. No colour is chosen here.
 */
import type { FreezeLine } from "@/lib/scan/freeze-frame";
import { MASK_SIZE, type ActiveLineId } from "@/lib/scan/types";

/** The names on the snap — the ledger's, one word each. */
export const SNAP_LINE_NAMES: Readonly<Record<ActiveLineId, string>> = { heart: "हृदय", head: "मस्तिष्क", life: "जीवन", fate: "शनि" };

/** Observed stretches: this share of the crop's side wide (≈ 2 px at the screen's third of 512), full alpha. */
export const SNAP_OBSERVED_WIDTH = 0.011;
/** Bridged stretches: half as wide, and faint. */
export const SNAP_BRIDGED_WIDTH = 0.0055;
export const SNAP_BRIDGED_ALPHA = 0.4;
/** The names: this share of the side tall (≈ 10 px on screen). */
export const SNAP_LABEL_SIZE = 0.056;

export interface SnapPalette {
  /** The lines' and names' gold. */
  readonly line: string;
  /** The glow under an observed stretch. */
  readonly glow: string;
  /** The halo under a name. */
  readonly halo: string;
  /** The Devanagari face, as a CSS font-family list. */
  readonly font: string;
}

type Pt = readonly [number, number];

/**
 * Where a line's name goes: beside its middle, pushed away from the crop's centre (`side` 1) or toward it
 * (`side` -1, the other side of the line — where a name goes when its own side is taken).
 */
export function labelAnchor(points: readonly Pt[], size: number, side: 1 | -1 = 1): { x: number; y: number } {
  const scale = size / MASK_SIZE;
  const mid = points[Math.floor((points.length - 1) / 2)]!;
  const a = points[Math.max(0, Math.floor((points.length - 1) / 2) - 2)]!;
  const b = points[Math.min(points.length - 1, Math.floor((points.length - 1) / 2) + 2)]!;
  let nx = -(b[1] - a[1]);
  let ny = b[0] - a[0];
  const length = Math.hypot(nx, ny) || 1;
  nx /= length;
  ny /= length;
  const cx = mid[0] * scale;
  const cy = mid[1] * scale;
  /* Away from the centre: the side of the line the crop's middle is not on (or, `side` -1, the side it is). */
  if ((nx * (size / 2 - cx) + ny * (size / 2 - cy) > 0) === (side === 1)) {
    nx = -nx;
    ny = -ny;
  }
  const offset = size * SNAP_LABEL_SIZE * 1.1;
  const margin = size * SNAP_LABEL_SIZE;
  return {
    x: Math.min(size - margin, Math.max(margin, cx + nx * offset)),
    y: Math.min(size - margin * 0.6, Math.max(margin * 0.8, cy + ny * offset)),
  };
}

/**
 * Draw the held lines and their names onto a context already holding the crop (`size`² canvas pixels). The
 * context is left as it was found.
 */
export function drawSnapLines(context: CanvasRenderingContext2D, lines: readonly FreezeLine[], size: number, palette: SnapPalette): void {
  const scale = size / MASK_SIZE;
  context.save();
  context.lineCap = "round";
  context.lineJoin = "round";
  context.strokeStyle = palette.line;

  /* Bridged stretches first, faint, so the observed ones lie over their ends. */
  for (const observed of [false, true]) {
    context.lineWidth = size * (observed ? SNAP_OBSERVED_WIDTH : SNAP_BRIDGED_WIDTH);
    context.globalAlpha = observed ? 1 : SNAP_BRIDGED_ALPHA;
    context.shadowColor = observed ? palette.glow : "transparent";
    context.shadowBlur = observed ? size * 0.012 : 0;
    context.beginPath();
    for (const line of lines) {
      for (const segment of line.segments) {
        if (segment.observed !== observed) continue;
        const stretch = line.points.slice(segment.from, segment.to + 1);
        if (stretch.length < 2) continue;
        context.moveTo(stretch[0]![0] * scale, stretch[0]![1] * scale);
        for (let i = 1; i < stretch.length; i += 1) context.lineTo(stretch[i]![0] * scale, stretch[i]![1] * scale);
      }
    }
    context.stroke();
  }

  /* The names, in Devanagari, over a dark halo. */
  context.shadowColor = "transparent";
  context.shadowBlur = 0;
  context.globalAlpha = 1;
  context.font = `${Math.round(size * SNAP_LABEL_SIZE)}px ${palette.font}`;
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.lineWidth = size * 0.012;
  context.strokeStyle = palette.halo;
  context.fillStyle = palette.line;
  for (const at of labelPlaces(lines, size)) {
    context.strokeText(SNAP_LINE_NAMES[at.id], at.x, at.y);
    context.fillText(SNAP_LINE_NAMES[at.id], at.x, at.y);
  }
  context.restore();
}

/**
 * Every name's place, in turn: a name that would sit on one already placed goes to the other side of its own
 * line, and failing that a label's height further down. Two creases traced close together (the first G4
 * capture: the life and fate lines within a few pixels) must not print their names over each other.
 */
export function labelPlaces(lines: readonly FreezeLine[], size: number): readonly { readonly id: ActiveLineId; readonly x: number; readonly y: number }[] {
  const gap = size * SNAP_LABEL_SIZE * 1.3;
  const margin = size * SNAP_LABEL_SIZE;
  const placed: { id: ActiveLineId; x: number; y: number }[] = [];
  const clear = (p: { x: number; y: number }): boolean => placed.every((q) => Math.abs(q.x - p.x) >= gap * 1.6 || Math.abs(q.y - p.y) >= gap);
  for (const line of lines) {
    const outward = labelAnchor(line.points, size, 1);
    const inward = labelAnchor(line.points, size, -1);
    let at = clear(outward) ? outward : clear(inward) ? inward : null;
    for (let step = 1; at === null && step <= 4; step += 1) {
      const lower = { x: outward.x, y: Math.min(size - margin * 0.6, outward.y + gap * step) };
      if (clear(lower)) at = lower;
    }
    placed.push({ id: line.id, ...(at ?? outward) });
  }
  return placed;
}
