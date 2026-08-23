/**
 * Frame quality gate.
 *
 * Decides whether a frame may contribute anything at all — features, latch progress, mask fusion —
 * and tells the user the one thing that would fix it. Pure functions over landmarks plus a few
 * pre-computed statistics, so the whole gate is unit-testable without a camera.
 *
 * Testing on real hands showed the first version was far too permissive: it accepted the *back* of a
 * hand and let eleven rules confirm off it. Three checks were added as a result — detector
 * confidence, open-palm pose, and cross-frame stability — and `checks` now reports every one of them
 * individually so the debug HUD can show exactly which is failing.
 */
import { FINGER_MOUNTS, LM } from "./landmark-index";
import type { FrameStats, Handedness, Landmark3, QualityIssue, QualityVerdict } from "./types";

const MIN_LUMA = 0.18;
const MAX_LUMA = 0.92;
const MAX_CLIPPED = 0.12;
/** Landmark drift, in fractions of the frame, above which the hand counts as moving. */
const MAX_JITTER = 0.012;
const FRAME_MARGIN = 0.02;
/** MediaPipe's own confidence in the hand it reports. Below this the landmarks are guesswork. */
const MIN_DETECTION_SCORE = 0.7;
/** 0 = fully curled, 1 = flat and open. */
const MIN_FINGER_EXTENSION = 0.62;
/** Coefficient of variation of palm span across the history window. */
const MAX_SPAN_VARIATION = 0.06;
export const SPAN_HISTORY_FRAMES = 5;

/** Ordered by which is most useful to say first — one hint at a time beats a list of complaints. */
const HINTS: Readonly<Record<QualityIssue, string>> = {
  no_hand: "Hatheli camera ke saamne laao",
  low_confidence: "Haath saaf nahi dikh raha",
  out_of_frame: "Poora haath frame mein laao",
  not_palm_up: "Hatheli camera ki taraf ghumao",
  fingers_curled: "Ungliyan khol kar seedhi rakho",
  too_far: "Thoda paas laao",
  too_close: "Thoda door karo",
  wrong_hand: "Doosra haath dikhao",
  too_dark: "Roshni kam hai — ujaale mein aao",
  too_bright: "Bahut tez roshni — thoda hatt jao",
  unsteady: "Haath sthir rakho",
  inconsistent: "Haath ek jagah tikaao",
};

const HINT_ORDER: readonly QualityIssue[] = [
  "no_hand",
  "low_confidence",
  "out_of_frame",
  "not_palm_up",
  "fingers_curled",
  "wrong_hand",
  "too_far",
  "too_close",
  "too_dark",
  "too_bright",
  "unsteady",
  "inconsistent",
];

export const ALL_CHECKS: readonly QualityIssue[] = HINT_ORDER;

/* ------------------------------ Pose profiles ------------------------------ */

export type CapturePose = "FLAT" | "TILT_LEFT" | "TILT_RIGHT" | "CLOSER" | "OTHER_HAND";

export interface PoseProfile {
  readonly pose: CapturePose;
  readonly label: string;
  readonly instruction: string;
  readonly minFacing: number;
  readonly minSpan: number;
  readonly maxSpan: number;
  /** Signed image-space tilt the pose expects; null means "don't care". */
  readonly tiltSign: -1 | 1 | null;
  /** Which hand this step wants, relative to the first hand seen. */
  readonly wantsOtherHand: boolean;
}

/**
 * The guided capture sequence.
 *
 * Tilted poses relax `minFacing` — demanding a square-on palm while asking the user to tilt would be
 * a gate that can never pass — but they require the tilt to actually be in the requested direction,
 * so tilting the wrong way is rejected rather than silently accepted.
 */
export const CAPTURE_POSES: readonly PoseProfile[] = [
  {
    pose: "FLAT",
    label: "Flat",
    instruction: "Hatheli seedhi camera ke saamne",
    minFacing: 0.55,
    minSpan: 0.3,
    maxSpan: 0.86,
    tiltSign: null,
    wantsOtherHand: false,
  },
  {
    pose: "TILT_LEFT",
    label: "Tilt left",
    instruction: "Hatheli halke se baayein jhukao",
    minFacing: 0.3,
    minSpan: 0.28,
    maxSpan: 0.86,
    tiltSign: -1,
    wantsOtherHand: false,
  },
  {
    pose: "TILT_RIGHT",
    label: "Tilt right",
    instruction: "Ab halke se daayein jhukao",
    minFacing: 0.3,
    minSpan: 0.28,
    maxSpan: 0.86,
    tiltSign: 1,
    wantsOtherHand: false,
  },
  {
    pose: "CLOSER",
    label: "Closer",
    instruction: "Hatheli camera ke aur paas laao",
    minFacing: 0.5,
    minSpan: 0.55,
    maxSpan: 0.97,
    tiltSign: null,
    wantsOtherHand: false,
  },
  {
    pose: "OTHER_HAND",
    label: "Other hand",
    instruction: "Ab doosra haath dikhao",
    minFacing: 0.55,
    minSpan: 0.3,
    maxSpan: 0.86,
    tiltSign: null,
    wantsOtherHand: true,
  },
];

export const DEFAULT_POSE: PoseProfile = CAPTURE_POSES[0];

/* -------------------------------- Measures -------------------------------- */

/**
 * How square-on the palm is: |z| of the unit normal of the wrist → index-knuckle → little-knuckle
 * triangle.
 *
 * Computed from **world** landmarks. Image-space landmarks are a projection, so their cross product
 * measures the projected triangle's winding, not the palm's true orientation.
 */
export function palmFacing(world: readonly Landmark3[]): number {
  const normal = palmNormal(world);
  return normal === null ? 0 : Math.abs(normal.z);
}

/** Unit normal of the palm plane, in world space. */
export function palmNormal(world: readonly Landmark3[]): { x: number; y: number; z: number } | null {
  if (world.length < 21) return null;
  const o = world[LM.WRIST];
  const a = world[LM.INDEX_MCP];
  const b = world[LM.PINKY_MCP];
  const u = { x: a.x - o.x, y: a.y - o.y, z: a.z - o.z };
  const v = { x: b.x - o.x, y: b.y - o.y, z: b.z - o.z };
  const nx = u.y * v.z - u.z * v.y;
  const ny = u.z * v.x - u.x * v.z;
  const nz = u.x * v.y - u.y * v.x;
  const length = Math.hypot(nx, ny, nz);
  return length < 1e-9 ? null : { x: nx / length, y: ny / length, z: nz / length };
}

/**
 * Signed winding of the same triangle in image space.
 *
 * Its sign flips between the palmar and dorsal side, which is what separates "showing me your palm"
 * from "showing me the back of your hand" — `palmFacing` alone cannot tell those apart, which is
 * exactly how a back-of-hand frame got through and confirmed eleven rules.
 *
 * The sign that means "palm" depends on handedness *and* on whether the preview is mirrored, so this
 * convention is the one to confirm on a real device using the debug HUD's check breakdown.
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

/**
 * How open the hand is, 0–1: the worst of the four fingers.
 *
 * Two independent signals, because either alone is foolable. *Straightness* is tip-to-knuckle
 * distance over the summed segment lengths — a curled finger's segments zig-zag, so the ratio drops.
 * *Planarity* is how much the knuckle→tip vector aligns with the palm normal — an extended finger
 * lies in the palm plane, a curled one points out of it, straight at the camera, where it can still
 * look deceptively straight in projection.
 */
export function fingerExtension(world: readonly Landmark3[]): number {
  const normal = palmNormal(world);
  if (normal === null) return 0;

  let worst = 1;
  for (const finger of Object.values(FINGER_MOUNTS)) {
    const mcp = world[finger.mcp];
    const tip = world[finger.tip];
    const segments =
      Math.hypot(world[finger.pip].x - mcp.x, world[finger.pip].y - mcp.y, world[finger.pip].z - mcp.z) +
      Math.hypot(world[finger.dip].x - world[finger.pip].x, world[finger.dip].y - world[finger.pip].y, world[finger.dip].z - world[finger.pip].z) +
      Math.hypot(tip.x - world[finger.dip].x, tip.y - world[finger.dip].y, tip.z - world[finger.dip].z);
    if (segments < 1e-9) return 0;

    const span = { x: tip.x - mcp.x, y: tip.y - mcp.y, z: tip.z - mcp.z };
    const spanLength = Math.hypot(span.x, span.y, span.z);
    const straightness = spanLength / segments;

    const alignment =
      spanLength < 1e-9
        ? 1
        : Math.abs((span.x * normal.x + span.y * normal.y + span.z * normal.z) / spanLength);
    const planarity = 1 - alignment;

    worst = Math.min(worst, straightness, planarity);
  }
  return Math.max(0, Math.min(1, worst));
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

/**
 * Coefficient of variation of palm span over the history window.
 *
 * Catches the failure jitter misses: a hand drifting steadily toward or away from the camera moves
 * little frame-to-frame but is not holding a pose, and masks fused across that drift smear.
 * Returns 0 until the window is full, so the gate is not blocked while it fills.
 */
export function spanVariation(history: readonly number[]): number {
  if (history.length < SPAN_HISTORY_FRAMES) return 0;
  const window = history.slice(-SPAN_HISTORY_FRAMES);
  const mean = window.reduce((sum, value) => sum + value, 0) / window.length;
  if (mean < 1e-6) return 1;
  const variance = window.reduce((sum, value) => sum + (value - mean) ** 2, 0) / window.length;
  return Math.sqrt(variance) / mean;
}

/** Signed lateral tilt, from how far the palm normal leans across the image. */
export function palmTilt(world: readonly Landmark3[]): number {
  const normal = palmNormal(world);
  return normal === null ? 0 : normal.x;
}

const MIN_TILT = 0.25;

export interface QualityInput {
  readonly landmarks: readonly Landmark3[];
  readonly world: readonly Landmark3[];
  readonly handedness: Handedness;
  readonly mirrored: boolean;
  readonly stats: FrameStats;
  readonly jitter: number;
  /** MediaPipe's confidence in this detection. */
  readonly score: number;
  /** Recent palm spans, oldest first. */
  readonly spanHistory: readonly number[];
  readonly pose?: PoseProfile;
  /** The hand seen at the start of the session, so OTHER_HAND can require the opposite one. */
  readonly baselineHandedness?: Handedness | null;
}

/** Maps a measurement to 0–1 by how comfortably it sits inside its acceptable band. */
function bandScore(value: number, min: number, max: number): number {
  if (value <= min || value >= max) return 0;
  const mid = (min + max) / 2;
  const half = (max - min) / 2;
  return Math.max(0, 1 - Math.abs(value - mid) / half);
}

function allPassing(): Record<QualityIssue, boolean> {
  return Object.fromEntries(ALL_CHECKS.map((check) => [check, true])) as Record<QualityIssue, boolean>;
}

/**
 * Grades a frame against a pose profile.
 *
 * Every check reports individually in `checks` (the debug HUD shows all of them live) but only the
 * first failure by `HINT_ORDER` is surfaced to the user. Stacking four complaints on screen at once
 * is how people give up.
 */
export function gradeFrame(input: QualityInput | null): QualityVerdict {
  if (input === null || input.landmarks.length < 21) {
    const checks = allPassing();
    checks.no_hand = false;
    return { ok: false, issues: ["no_hand"], hint: HINTS.no_hand, score: 0, checks };
  }

  const { landmarks, world, handedness, mirrored, stats, jitter, score, spanHistory, baselineHandedness } = input;
  const pose = input.pose ?? DEFAULT_POSE;
  const checks = allPassing();

  if (score < MIN_DETECTION_SCORE) checks.low_confidence = false;

  if (landmarks.some((p) => p.x < FRAME_MARGIN || p.x > 1 - FRAME_MARGIN || p.y < FRAME_MARGIN || p.y > 1 - FRAME_MARGIN)) {
    checks.out_of_frame = false;
  }

  const span = palmSpan(landmarks);
  if (span < pose.minSpan) checks.too_far = false;
  else if (span > pose.maxSpan) checks.too_close = false;

  const facing = palmFacing(world);
  const winding = palmWinding(landmarks, handedness, mirrored);
  // Winding is the back-of-hand test and is never relaxed, however tilted the requested pose is.
  if (facing < pose.minFacing || winding < 0) checks.not_palm_up = false;

  if (pose.tiltSign !== null) {
    const tilt = palmTilt(world) * pose.tiltSign;
    if (tilt < MIN_TILT) checks.not_palm_up = false;
  }

  const extension = fingerExtension(world);
  if (extension < MIN_FINGER_EXTENSION) checks.fingers_curled = false;

  if (pose.wantsOtherHand && baselineHandedness != null && handedness === baselineHandedness) {
    checks.wrong_hand = false;
  }

  if (stats.luma < MIN_LUMA) checks.too_dark = false;
  else if (stats.luma > MAX_LUMA || stats.clipped > MAX_CLIPPED) checks.too_bright = false;

  if (jitter > MAX_JITTER) checks.unsteady = false;
  if (spanVariation(spanHistory) > MAX_SPAN_VARIATION) checks.inconsistent = false;

  const issues = ALL_CHECKS.filter((check) => !checks[check]);
  const raw =
    bandScore(span, pose.minSpan, pose.maxSpan) * 0.25 +
    Math.min(1, facing / Math.max(pose.minFacing, 1e-6)) * 0.25 +
    Math.min(1, extension / MIN_FINGER_EXTENSION) * 0.2 +
    bandScore(stats.luma, MIN_LUMA, MAX_LUMA) * 0.15 +
    Math.max(0, 1 - jitter / MAX_JITTER) * 0.15;

  const firstIssue = HINT_ORDER.find((issue) => issues.includes(issue));
  return {
    ok: issues.length === 0,
    issues,
    hint: firstIssue === undefined ? "Bilkul sahi — hold karo" : HINTS[firstIssue],
    // A failing frame can never look confident, whatever the individual measurements say.
    score: issues.length === 0 ? Math.min(1, raw) : Math.min(0.45, raw),
    checks,
  };
}
