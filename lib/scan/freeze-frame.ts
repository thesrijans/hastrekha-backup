/**
 * THE FREEZE FRAME (scan-complete G4.1): the photograph detection ends on, and the lines that go on it.
 *
 * WHICH FRAME. "The sharpest recent frame (superres keep-ring / regrade, VoL ≥ 100)": every 512 canonical
 * crop the chamber offers the super-resolution keep-ring is graded by the ring's own measure (palmQuadVol,
 * the still regrade's operator on the crop's centre, lib/scan/superres.ts) and the sharpest of the last few
 * seconds is kept ({@link freezeReplaces}). The ring itself cannot be the source: it holds luma only, and it
 * starts over at every pose commit. Detection may complete a moment before a sharp enough frame has come; the
 * chamber then waits up to {@link FREEZE_WAIT_MS} for one ({@link freezeReady}) and otherwise freezes on the
 * best it has — the snap records the VoL it actually has.
 *
 * WHERE THE LINES GO. The held lines live in the evidence accumulator's frame, which follows the newest
 * frame it took (rekha-persist.ts: the hold shifts every polyline with the accumulator's own translation).
 * The frozen crop can be a second or two older, so the lines are carried onto it by the same kind of global
 * shift the accumulator itself estimates — {@link estimateFreezeShift} registers the frozen crop against the
 * accumulator's latest gray (both canonical crops, at MASK_SIZE) — and never drawn a few pixels off the crease.
 *
 * Pure, and outside the frozen core.
 */
import type { StillPrelabel, StillQuality } from "./session-schema";
import type { RekhaLine, RekhaSnapshot } from "./rekha-persist";
import { DEFAULT_REGISTRATION, SUPERRES_VOL_FLOOR, boxDownsample, estimateGlobalShift } from "./superres";
import { ACTIVE_LINE_IDS, MASK_SIZE, type ActiveLineId, type Handedness, type Landmark3, type Point2 } from "./types";

/** The frozen frame must clear the still regrade's floor — the same VoL ≥ 100 the keep-ring admits. */
export const FREEZE_VOL_FLOOR = SUPERRES_VOL_FLOOR;

/** "Recent": a kept frame older than this gives way to any newer one, sharper or not. */
export const FREEZE_RECENT_MS = 3000;

/** How long a completed detection waits for a frame that clears the floor before freezing on the best it has. */
export const FREEZE_WAIT_MS = 2500;

/** The two numbers a candidate is chosen by. */
export interface FreezeGrade {
  readonly vol: number;
  readonly atMs: number;
}

/**
 * The kept frame: a 512 canonical crop in colour and the raw camera frame it was rectified from — owned
 * copies — with everything a capture still records about the moment (lib/scan/session-schema.ts).
 */
export interface FreezeCandidate extends FreezeGrade {
  /** The rectified crop, SUPERRES_CROP_SIZE² RGBA. */
  readonly crop: ImageData;
  /** The raw camera frame, unmirrored. */
  readonly raw: ImageData;
  /** The rectification anchors in raw-frame pixels, PALM_ANCHORS order. */
  readonly anchors: readonly Point2[];
  /** Four or five anchors: the canonical space the crop is in. */
  readonly convention: number;
  readonly landmarks: readonly Landmark3[];
  readonly handedness: Handedness;
  /** The gate's verdict on that frame, and the stats it was graded on. */
  readonly quality: StillQuality;
  readonly windingStrength: number | null;
  readonly trackSettings: Readonly<Record<string, string | number | boolean>>;
}

/** Whether `offer` takes the kept frame's place: none kept, the kept one no longer recent, or `offer` sharper. */
export function freezeReplaces(kept: FreezeGrade | null, offer: FreezeGrade): boolean {
  if (kept === null) return true;
  if (offer.atMs - kept.atMs > FREEZE_RECENT_MS) return true;
  return offer.vol > kept.vol;
}

/** Whether the kept frame is sharp enough to freeze on. */
export function freezeReady(kept: FreezeGrade | null): boolean {
  return kept !== null && kept.vol >= FREEZE_VOL_FLOOR;
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
 * Register the frozen crop (0–1 luma, `cropSize`², a multiple of MASK_SIZE) against the accumulator's latest
 * gray (MASK_SIZE², lib/scan/rekha-persist.ts rekhaGray): the frozen crop's content displacement relative to
 * it, in MASK_SIZE pixels. Null when the search found no overlap or ran into its boundary — then the lines are
 * better drawn unshifted than by a guess.
 */
export function estimateFreezeShift(frozen: Float32Array, cropSize: number, accumulatorGray: Float32Array): FreezeShift | null {
  const factor = cropSize / MASK_SIZE;
  if (!Number.isInteger(factor) || factor < 1 || accumulatorGray.length !== MASK_SIZE * MASK_SIZE) return null;
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
    out.push({ id, points: line.points.map(([x, y]) => [x + dx, y + dy] as const), segments });
  }
  return out;
}

/** The held lines as the labeler's prelabel (G4.3): 0–1 fractions of the crop, clamped inside it. */
export function prelabelOf(lines: readonly FreezeLine[]): StillPrelabel {
  const clamp = (v: number): number => Math.min(1, Math.max(0, v / MASK_SIZE));
  return {
    source: "chamber-held",
    lines: lines.map((line) => ({ id: line.id, points: line.points.map(([x, y]) => [Number(clamp(x).toFixed(4)), Number(clamp(y).toFixed(4))] as const) })),
  };
}
