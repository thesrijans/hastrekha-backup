/**
 * THE FREEZE FRAME (scan-complete G4.1, made the chakra's in G4b): the photograph the scan ends on, and the lines
 * that go on it.
 *
 * WHICH FRAME (chakra §3). The BEST frame of the whole scan — not the last one, and no longer the sharpest of the
 * last three seconds (G4): the hook keeps one {@link BestFrame}, scored sharpness × in the band × lines held
 * (lib/scan/chakra.ts bestFrameScore) and replaced only by a better one, with its raw pixels, the stabilised
 * anchors it was rectified through (its palm homography), its landmarks, and its crop's gray at MASK_SIZE. On
 * completion the chamber freezes on it at once: there is no wait for a sharper frame (G4 waited up to 2.5 s for
 * VoL ≥ 100), because the best frame already is the sharpest one that mattered. {@link freezeFrom} rectifies its
 * 512 canonical crop then, once, for the two snaps and the growth still.
 *
 * WHERE THE LINES GO. The held lines live in the evidence accumulator's frame, which follows the newest frame it
 * took (rekha-persist.ts: the hold shifts every polyline with the accumulator's own translation). The best frame
 * can be seconds older, so the lines are carried onto its crop by the same kind of global shift the accumulator
 * itself estimates — {@link estimateFreezeShift} registers the best frame's gray against the accumulator's latest —
 * and then drawn through THAT frame's homography ({@link freezeProjector}, the live overlay's own projection):
 * so the gold sits on the creases in the photograph, where the live overlay drew it on that frame.
 * {@link freezeDeviation} measures exactly that (§6: within ±3 px).
 *
 * Pure, and outside the frozen core.
 */
import type { StillPrelabel, StillQuality } from "./session-schema";
import type { RekhaLine, RekhaSnapshot } from "./rekha-persist";
import { applyHomography, canonicalAnchors, rectifyPalm, solveHomography } from "./rectify";
import { DEFAULT_REGISTRATION, boxDownsample, estimateGlobalShift, palmQuadVol } from "./superres";
import { ACTIVE_LINE_IDS, MASK_SIZE, type ActiveLineId, type Handedness, type Landmark3, type Point2, type TracedLine } from "./types";

/** The canonical crop the snaps and the growth still are made at (GROWTH_CANONICAL_SIZE, the keep-ring's size). */
export const FREEZE_CROP_SIZE = 512;

/**
 * The one frame kept across the scan (chakra §3): owned copies, with everything a capture still records about
 * the moment (lib/scan/session-schema.ts).
 */
export interface BestFrame {
  /** chakra.ts bestFrameScore: vol × in-band × held. */
  readonly score: number;
  /** The palm box's variance of Laplacian at camera resolution — the accumulator's own frame weight measure. */
  readonly vol: number;
  /** Majors held when it was taken, and whether the palm was in the distance band. */
  readonly held: number;
  readonly inBand: boolean;
  /** `performance.now()` when it was taken. */
  readonly atMs: number;
  /** The raw camera frame, unmirrored. */
  readonly raw: ImageData;
  /** The stabilised rectification anchors in raw-frame pixels, PALM_ANCHORS order: its palm homography. */
  readonly anchors: readonly Point2[];
  /** Four or five anchors: the canonical space its crop is in. */
  readonly convention: number;
  /** Its crop's gray at MASK_SIZE² — what the accumulator aligns on (rekha-persist rekhaGray). */
  readonly gray: Float32Array;
  readonly landmarks: readonly Landmark3[];
  readonly handedness: Handedness;
  /** The gate's verdict on that frame, and the stats it was graded on. */
  readonly quality: StillQuality;
  readonly windingStrength: number | null;
  readonly trackSettings: Readonly<Record<string, string | number | boolean>>;
  /**
   * What the live overlay drew over this frame: the extraction's lines (MASK_SIZE space) and the convention they
   * were traced under — drawn through these same anchors. Null when the overlay drew none on it.
   */
  readonly live: { readonly lines: Partial<Record<ActiveLineId, TracedLine>>; readonly convention: number } | null;
  /** The accumulator's hold as it stood when the frame was taken (its confirmed geometry then); null before any. */
  readonly heldAtCapture: RekhaSnapshot | null;
}

/** The frame the chamber freezes on: the best frame, with its 512 canonical crop rectified at the freeze. */
export interface FreezeCandidate extends BestFrame {
  /** The rectified crop, FREEZE_CROP_SIZE² RGBA. */
  readonly crop: ImageData;
  /** The crop's VoL by the keep-ring's measure (superres palmQuadVol) — what a still records as `stillVol`. */
  readonly cropVol: number;
}

/**
 * Rectify the best frame's 512 crop, once, at the freeze. Null when its anchors no longer solve — the chamber
 * then falls back to the video's own frame (completion-snaps.ts fallbackFreeze).
 */
export function freezeFrom(best: BestFrame, createImageData?: (w: number, h: number) => ImageData): FreezeCandidate | null {
  const rectified = rectifyPalm(best.raw, best.anchors, FREEZE_CROP_SIZE, createImageData);
  if (rectified === null) return null;
  const crop = rectified.image;
  return { ...best, crop, cropVol: palmQuadVol(cropLuma(crop.data, crop.width), crop.width) };
}

/** 0–1 luma of an RGBA crop, row-major (Rec. 709, as the keep-ring and the accumulator read it). */
export function cropLuma(rgba: Uint8ClampedArray, size: number): Float32Array {
  const out = new Float32Array(size * size);
  for (let i = 0; i < out.length; i += 1) {
    const at = i * 4;
    out[i] = (0.2126 * rgba[at]! + 0.7152 * rgba[at + 1]! + 0.0722 * rgba[at + 2]!) / 255;
  }
  return out;
}

/** A shift in MASK_SIZE pixels: where the accumulator's content sits in the frozen crop, relative to its own frame. */
export interface FreezeShift {
  readonly dx: number;
  readonly dy: number;
}

/**
 * Register the frozen crop (0–1 luma, `cropSize`², a multiple of MASK_SIZE — the best frame's own gray is
 * MASK_SIZE² already) against the accumulator's latest gray (MASK_SIZE², lib/scan/rekha-persist.ts rekhaGray):
 * the frozen crop's content displacement relative to it, in MASK_SIZE pixels. Null when the search found no
 * overlap or ran into its boundary — then the lines are better drawn unshifted than by a guess.
 */
export function estimateFreezeShift(frozen: Float32Array, cropSize: number, accumulatorGray: Float32Array): FreezeShift | null {
  const factor = cropSize / MASK_SIZE;
  if (!Number.isInteger(factor) || factor < 1 || accumulatorGray.length !== MASK_SIZE * MASK_SIZE || frozen.length !== cropSize * cropSize) return null;
  const low = new Float32Array(MASK_SIZE * MASK_SIZE);
  if (factor === 1) low.set(frozen);
  else boxDownsample(frozen, cropSize, factor, low);
  const half = Math.floor(MASK_SIZE / DEFAULT_REGISTRATION.downsample);
  const estimate = estimateGlobalShift(
    low,
    accumulatorGray,
    null,
    null,
    MASK_SIZE,
    {
      lowCur: new Float32Array(half * half),
      lowRef: new Float32Array(half * half),
      lowCurValid: null,
      lowRefValid: null,
      refIsDownsampled: false,
    },
    /* A ±2 refine around the coarse step: at ±1 an exact odd shift lands on the window's edge and reads as
       truncated (measured: a 3 px shift came back exact, flagged atBoundary, with refine 1; clean with 2). */
    { ...DEFAULT_REGISTRATION, refine: 2 },
  );
  if (!Number.isFinite(estimate.sad) || estimate.atBoundary) return null;
  return { dx: estimate.dx, dy: estimate.dy };
}

/** One held line on the frozen crop. */
export interface FreezeLine {
  readonly id: ActiveLineId;
  /** MASK_SIZE-space points on the FROZEN crop. */
  readonly points: readonly (readonly [number, number])[];
  /** Which index ranges were observed and which bridged (TracedLine semantics); one observed range when unknown. */
  readonly segments: readonly { readonly from: number; readonly to: number; readonly observed: boolean }[];
  /** The valley tracer's geometry (S2): its unobserved stretches are extension, and draw at 0.6 — as they did live. */
  readonly traced?: boolean;
}

/**
 * The lines to draw on the frozen crop: the snapshot's CONFIRMED lines — the held ones — carried by `shift`.
 * A line below CONFIRMED is not drawn on a photograph the reader keeps.
 *
 * And every line the ledger shows ✓ (`confirmed`, the detection's sticky mark): one the hold has since let go
 * (its flicker, S1.5: at most one return per line per 20 s) is drawn from `remembered`, its last confirmed
 * geometry — a reader who saw "जीवन ✓" finds the life line on the snap (the first G4 capture: four ✓, three
 * lines drawn). Its last frame can be a moment older than the snapshot's, a drift of well under a pixel of the
 * mask for a palm held still.
 */
export function heldLinesOn(
  snapshot: RekhaSnapshot | null,
  shift: FreezeShift | null,
  remembered: Partial<Record<ActiveLineId, RekhaLine>> = {},
  confirmed: readonly ActiveLineId[] = [],
): readonly FreezeLine[] {
  const dx = shift?.dx ?? 0;
  const dy = shift?.dy ?? 0;
  const out: FreezeLine[] = [];
  for (const id of ACTIVE_LINE_IDS) {
    const live = snapshot?.lines[id];
    const line = live !== undefined && live.state === "confirmed" ? live : confirmed.includes(id) ? remembered[id] : undefined;
    if (line === undefined || line.state !== "confirmed" || line.points.length < 2) continue;
    const last = line.points.length - 1;
    const segments =
      line.segments !== undefined && line.segments.length > 0
        ? line.segments.map((s) => ({ from: s.from, to: s.to, observed: s.observed }))
        : [{ from: 0, to: last, observed: true }];
    out.push({ id, points: line.points.map(([x, y]) => [x + dx, y + dy] as const), segments, ...(line.traced === true ? { traced: true } : {}) });
  }
  return out;
}

/**
 * THE LINES AS DRAWN ON THAT FRAME (chakra §3, §6). A held line the live overlay drew over the frozen frame goes on
 * the photograph with the geometry it was drawn with there — the reader sees on the photograph exactly what they
 * saw on that frame, through that frame's homography. The accumulator's own geometry keeps evolving after the
 * frame (each extraction re-traces a crease; the hold takes the newer trace), and carried back it lands a pixel or
 * two beside the drawing (measured in `?cost=1`: "held vs live"). A line confirmed only after the frame, which the
 * overlay never drew there, is carried in from the accumulator (held + shift). Only held lines are drawn either way.
 */
export function linesAsDrawn(held: readonly FreezeLine[], frame: Pick<BestFrame, "live" | "convention">): { readonly lines: readonly FreezeLine[]; readonly fromLive: readonly ActiveLineId[] } {
  const live = frame.live !== null && frame.live.convention === frame.convention ? frame.live.lines : null;
  const fromLive: ActiveLineId[] = [];
  const lines = held.map((line): FreezeLine => {
    const drawn = live?.[line.id];
    if (drawn === undefined || drawn.points.length < 2) return line;
    fromLive.push(line.id);
    const last = drawn.points.length - 1;
    return {
      id: line.id,
      points: drawn.points,
      segments: drawn.segments !== undefined && drawn.segments.length > 0 ? drawn.segments.map((s) => ({ from: s.from, to: s.to, observed: s.observed })) : [{ from: 0, to: last, observed: true }],
      ...(drawn.traced === true ? { traced: true } : {}),
    };
  });
  return { lines, fromLive };
}

/** The held lines as the labeler's prelabel (G4.3): 0–1 fractions of the crop, clamped inside it. */
export function prelabelOf(lines: readonly FreezeLine[]): StillPrelabel {
  const clamp = (v: number): number => Math.min(1, Math.max(0, v / MASK_SIZE));
  return {
    source: "chamber-held",
    lines: lines.map((line) => ({ id: line.id, points: line.points.map(([x, y]) => [Number(clamp(x).toFixed(4)), Number(clamp(y).toFixed(4))] as const) })),
  };
}

/* --------------------------- Through the frame's homography --------------------------- */

/**
 * MASK_SIZE space → the frame's raw pixels, through its own anchors: the live overlay's projection exactly
 * (chamber-canvas.tsx traceProjector, `solveHomography(canonicalAnchors(convention, MASK_SIZE), anchors)`), so a
 * line lands in the photograph where the overlay drew it on that frame. Null when the anchors do not solve.
 */
export function freezeProjector(anchors: readonly Point2[], convention: number): ((point: Point2) => Point2 | null) | null {
  if (anchors.length !== convention) return null;
  const targets = canonicalAnchors(convention, MASK_SIZE);
  if (targets === null) return null;
  const cropToFrame = solveHomography(targets, anchors);
  if (cropToFrame === null) return null;
  return (point) => applyHomography(cropToFrame, point);
}

/** A polyline through `project`, dropping points that do not project (never clamped into place). */
export function projectPolyline(points: readonly (readonly [number, number])[], project: (point: Point2) => Point2 | null): Point2[] {
  const out: Point2[] = [];
  for (const [x, y] of points) {
    const p = project({ x, y });
    if (p !== null && Number.isFinite(p.x) && Number.isFinite(p.y)) out.push(p);
  }
  return out;
}

/**
 * The distance from `p` to the polyline, and whether its nearest point is interior — not one of the polyline's two
 * ends, where a point past the end of a trace that has since grown longer would measure its extension, not an offset.
 */
function toPolyline(p: Point2, line: readonly Point2[]): { readonly distance: number; readonly interior: boolean } {
  let best = Infinity;
  let interior = false;
  for (let i = 0; i + 1 < line.length; i += 1) {
    const a = line[i]!;
    const b = line[i + 1]!;
    const vx = b.x - a.x;
    const vy = b.y - a.y;
    const length2 = vx * vx + vy * vy;
    const t = length2 === 0 ? 0 : Math.min(1, Math.max(0, ((p.x - a.x) * vx + (p.y - a.y) * vy) / length2));
    const d = Math.hypot(p.x - (a.x + t * vx), p.y - (a.y + t * vy));
    if (d < best) {
      best = d;
      interior = !((i === 0 && t === 0) || (i + 2 === line.length && t === 1));
    }
  }
  return { distance: best, interior };
}

/** How far one drawing of a line sits from another, over the stretch both cover: point distances in pixels. */
export interface LineDeviation {
  readonly id: ActiveLineId;
  /** Points of the frozen line compared (those whose nearest live point is interior). */
  readonly compared: number;
  readonly p50: number;
  readonly p95: number;
  readonly max: number;
}

/**
 * §6: how far each held line on the frozen photograph lands from where the live overlay drew it on that same
 * frame — both through the frame's own anchors, in its raw pixels (a caller scales to screen pixels). Lines the
 * overlay did not draw on that frame (confirmed later) have nothing to be compared with and are left out.
 */
export function freezeDeviation(lines: readonly FreezeLine[], frame: Pick<BestFrame, "anchors" | "convention" | "live">): readonly LineDeviation[] {
  const live = frame.live;
  if (live === null || live.convention !== frame.convention) return [];
  const project = freezeProjector(frame.anchors, frame.convention);
  if (project === null) return [];
  const out: LineDeviation[] = [];
  for (const line of lines) {
    const drawn = live.lines[line.id];
    if (drawn === undefined || drawn.points.length < 2) continue;
    const livePx = projectPolyline(drawn.points, project);
    const frozenPx = projectPolyline(line.points, project);
    if (livePx.length < 2) continue;
    const distances = frozenPx
      .map((p) => toPolyline(p, livePx))
      .filter((d) => d.interior)
      .map((d) => d.distance)
      .sort((a, b) => a - b);
    if (distances.length === 0) continue;
    const at = (q: number): number => distances[Math.min(distances.length - 1, Math.floor(q * (distances.length - 1) + 0.5))]!;
    out.push({ id: line.id, compared: distances.length, p50: at(0.5), p95: at(0.95), max: distances.at(-1)! });
  }
  return out;
}
