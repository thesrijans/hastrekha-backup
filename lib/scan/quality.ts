/**
 * Frame quality gate.
 *
 * Decides whether a frame is worth rectifying, and — more importantly — tells the user the one thing
 * that would fix it. Pure functions over landmarks plus a couple of pre-computed frame statistics, so
 * the whole gate is unit-testable without a camera.
 */
import { LM } from "./landmark-index";
import type { FrameStats, Handedness, Landmark3, QualityIssue, QualityVerdict } from "./types";

/** Palm should fill a healthy share of the frame: too small starves the segmenter of pixels. */
const MIN_PALM_SPAN = 0.30;
const MAX_PALM_SPAN = 0.86;
const MIN_LUMA = 0.18;
const MAX_LUMA = 0.92;
const MAX_CLIPPED = 0.12;
/** Landmark drift, in fractions of the frame, above which the hand counts as moving. */
const MAX_JITTER = 0.012;
/** How square-on the palm must be. |normal.z| after normalisation; 0 = edge-on, 1 = dead flat. */
const MIN_FACING = 0.55;
const FRAME_MARGIN = 0.02;

/** Ordered by which is most useful to say first — one hint at a time beats a list of complaints. */
const HINTS: Readonly<Record<QualityIssue, string>> = {
  no_hand: "Hatheli camera ke saamne laao",
  out_of_frame: "Poora haath frame mein laao",
  not_palm_up: "Hatheli camera ki taraf ghumao",
  too_far: "Thoda paas laao",
  too_close: "Thoda door karo",
  too_dark: "Roshni kam hai — ujaale mein aao",
  too_bright: "Bahut tez roshni — thoda hatt jao",
  unsteady: "Haath sthir rakho",
};

const HINT_ORDER: readonly QualityIssue[] = [
  "no_hand",
  "out_of_frame",
  "not_palm_up",
  "too_far",
  "too_close",
  "too_dark",
  "too_bright",
  "unsteady",
];

/**
 * How square-on the palm is, as |z| of the unit normal of the wrist → index-knuckle →
 * little-knuckle triangle.
 *
 * Computed from **world** landmarks. Image-space landmarks are a projection, so their cross product
 * measures the projected triangle's winding, not the palm's true orientation.
 */
export function palmFacing(world: readonly Landmark3[]): number {
  if (world.length < 21) return 0;
  const o = world[LM.WRIST];
  const a = world[LM.INDEX_MCP];
  const b = world[LM.PINKY_MCP];

  const u = { x: a.x - o.x, y: a.y - o.y, z: a.z - o.z };
  const v = { x: b.x - o.x, y: b.y - o.y, z: b.z - o.z };

  const nx = u.y * v.z - u.z * v.y;
  const ny = u.z * v.x - u.x * v.z;
  const nz = u.x * v.y - u.y * v.x;
  const length = Math.hypot(nx, ny, nz);
  return length < 1e-9 ? 0 : Math.abs(nz / length);
}

/**
 * Signed winding of the same triangle in image space.
 *
 * Its sign flips between the palmar and dorsal side, which is what separates "showing me your palm"
 * from "showing me the back of your hand" — `palmFacing` alone cannot tell those apart.
 *
 * The sign that means "palm" depends on handedness *and* on whether the preview is mirrored, so the
 * convention below is the one to confirm against a real device using the debug HUD before trusting
 * it. Getting it backwards rejects every correct pose, which is very visible in testing.
 */
export function palmWinding(landmarks: readonly Landmark3[], handedness: Handedness, mirrored: boolean): number {
  if (landmarks.length < 21) return 0;
  const o = landmarks[LM.WRIST];
  const a = landmarks[LM.INDEX_MCP];
  const b = landmarks[LM.PINKY_MCP];
  const cross = (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const handSign = handedness === "Right" ? 1 : -1;
  const mirrorSign = mirrored ? -1 : 1;
  return cross * handSign * mirrorSign;
}

/** Largest normalised extent of the hand across the frame. */
export function palmSpan(landmarks: readonly Landmark3[]): number {
  if (landmarks.length === 0) return 0;
  let minX = 1;
  let maxX = 0;
  let minY = 1;
  let maxY = 0;
  for (const point of landmarks) {
    if (point.x < minX) minX = point.x;
    if (point.x > maxX) maxX = point.x;
    if (point.y < minY) minY = point.y;
    if (point.y > maxY) maxY = point.y;
  }
  return Math.max(maxX - minX, maxY - minY);
}

/** Mean per-landmark movement between two frames, in frame fractions. */
export function landmarkJitter(previous: readonly Landmark3[] | null, current: readonly Landmark3[]): number {
  if (previous === null || previous.length !== current.length || current.length === 0) return 0;
  let total = 0;
  for (let i = 0; i < current.length; i += 1) {
    total += Math.hypot(current[i].x - previous[i].x, current[i].y - previous[i].y);
  }
  return total / current.length;
}

export interface QualityInput {
  readonly landmarks: readonly Landmark3[];
  readonly world: readonly Landmark3[];
  readonly handedness: Handedness;
  readonly mirrored: boolean;
  readonly stats: FrameStats;
  readonly jitter: number;
}

/** Maps a measurement to 0–1 by how comfortably it sits inside its acceptable band. */
function bandScore(value: number, min: number, max: number): number {
  if (value <= min || value >= max) return 0;
  const mid = (min + max) / 2;
  const half = (max - min) / 2;
  return Math.max(0, 1 - Math.abs(value - mid) / half);
}

/**
 * Grades a frame.
 *
 * Every issue is collected (the debug HUD shows them all) but only the first by `HINT_ORDER` is
 * surfaced to the user. Stacking four complaints on screen at once is how people give up.
 */
export function gradeFrame(input: QualityInput | null): QualityVerdict {
  if (input === null || input.landmarks.length < 21) {
    return { ok: false, issues: ["no_hand"], hint: HINTS.no_hand, score: 0 };
  }

  const { landmarks, world, handedness, mirrored, stats, jitter } = input;
  const issues: QualityIssue[] = [];

  const outOfFrame = landmarks.some(
    (p) => p.x < FRAME_MARGIN || p.x > 1 - FRAME_MARGIN || p.y < FRAME_MARGIN || p.y > 1 - FRAME_MARGIN,
  );
  if (outOfFrame) issues.push("out_of_frame");

  const span = palmSpan(landmarks);
  if (span < MIN_PALM_SPAN) issues.push("too_far");
  else if (span > MAX_PALM_SPAN) issues.push("too_close");

  const facing = palmFacing(world);
  const winding = palmWinding(landmarks, handedness, mirrored);
  if (facing < MIN_FACING || winding < 0) issues.push("not_palm_up");

  if (stats.luma < MIN_LUMA) issues.push("too_dark");
  else if (stats.luma > MAX_LUMA || stats.clipped > MAX_CLIPPED) issues.push("too_bright");

  if (jitter > MAX_JITTER) issues.push("unsteady");

  const score =
    bandScore(span, MIN_PALM_SPAN, MAX_PALM_SPAN) * 0.3 +
    Math.min(1, facing / MIN_FACING) * 0.3 +
    bandScore(stats.luma, MIN_LUMA, MAX_LUMA) * 0.2 +
    Math.max(0, 1 - jitter / MAX_JITTER) * 0.2;

  const firstIssue = HINT_ORDER.find((issue) => issues.includes(issue));
  return {
    ok: issues.length === 0,
    issues,
    hint: firstIssue === undefined ? "Bilkul sahi — hold karo" : HINTS[firstIssue],
    score: issues.length === 0 ? Math.min(1, score) : Math.min(0.6, score),
  };
}
