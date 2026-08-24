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
import type { FacingReadout, FrameStats, Handedness, Landmark3, QualityIssue, QualityVerdict } from "./types";

const MIN_LUMA = 0.18;
const MAX_LUMA = 0.92;
const MAX_CLIPPED = 0.12;
/** Landmark drift, in fractions of the frame, above which the hand counts as moving. */
const MAX_JITTER = 0.012;
const FRAME_MARGIN = 0.02;
/** MediaPipe's own confidence in the hand it reports. Below this the landmarks are guesswork. */
const MIN_DETECTION_SCORE = 0.7;
/**
 * 0 = fully curled, 1 = flat and open.
 *
 * Retuned 0.62 → 0.55 once the overlay geometry was fixed (step 6): with the cover mapping in
 * place, real relaxed-open hands measured just under the old floor. Exported so tests assert
 * against the live value instead of a stale literal.
 */
export const MIN_FINGER_EXTENSION = 0.55;
/**
 * Planarity tolerance relax. A finger leaning slightly out of the palm plane is normal for a
 * relaxed open hand; scaling the planarity term up 15% stops it dominating the min() below.
 */
const PLANARITY_RELAX = 1.15;
/** Coefficient of variation of palm span across the history window. */
const MAX_SPAN_VARIATION = 0.06;
export const SPAN_HISTORY_FRAMES = 5;

/** Ordered by which is most useful to say first — one hint at a time beats a list of complaints. */
const HINTS: Readonly<Record<QualityIssue, string>> = {
  no_hand: "Hatheli camera ke saamne laao",
  low_confidence: "Haath saaf nahi dikh raha",
  out_of_frame: "Poora haath frame mein laao",
  not_palm_up: "Hatheli camera ki taraf ghumao",
  tilt_direction: "Doosri taraf jhukao",
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
  "tilt_direction",
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

/* --------------------------- Facing / handedness --------------------------- */

/** At or above this handedness score the label is trusted to fix the expected winding sign. */
export const HANDEDNESS_TRUST_SCORE = 0.8;

/**
 * MediaPipe determines handedness *assuming the input image is mirrored* (selfie view). We hand it
 * the RAW camera frame, so on a front camera — exactly the case where the preview is CSS-mirrored —
 * its label names the opposite of the physical hand.
 *
 * This is the ONE constant to flip if a device disagrees. The debug HUD's facing row makes any
 * disagreement visible in a glance: show a palm and `winding sign` must equal `expected sign`.
 */
export const MEDIAPIPE_ASSUMES_MIRRORED_INPUT = true;

/** The physical hand, correcting for MediaPipe's mirrored-input assumption. */
export function physicalHandedness(label: Handedness, mirrored: boolean): Handedness {
  if (!(MEDIAPIPE_ASSUMES_MIRRORED_INPUT && mirrored)) return label;
  return label === "Right" ? "Left" : "Right";
}

/**
 * Raw signed winding of wrist → index knuckle → little knuckle, in image space.
 *
 * Pure geometry: no handedness or mirror correction folded in, so the measurement and the
 * convention applied to it stay separable — the previous version multiplied both into one number,
 * which is how a correctly-shown palm ended up rejected with nothing to inspect.
 *
 * Its sign flips between the palmar and dorsal side, which is what separates "showing me your palm"
 * from "showing me the back of your hand"; `palmFacing` alone cannot tell those apart.
 */
export function palmWinding(landmarks: readonly Landmark3[]): number {
  if (landmarks.length < 21) return 0;
  const o = landmarks[LM.WRIST];
  const a = landmarks[LM.INDEX_MCP];
  const b = landmarks[LM.PINKY_MCP];
  return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
}

/**
 * The winding sign a palm-toward-camera view produces for the physical hand.
 *
 * Derived from anatomy rather than assumed. In image space (x right, y **down**) a right hand held
 * palm to the camera puts the thumb on the image's left — anatomical position — so the index
 * knuckle sits left of the little knuckle while both sit above the wrist, and the cross product
 * comes out positive. A left palm is the mirror of that, so negative.
 */
export function expectedWindingSign(label: Handedness, mirrored: boolean): 1 | -1 {
  return physicalHandedness(label, mirrored) === "Right" ? 1 : -1;
}

export interface FacingInput {
  readonly landmarks: readonly Landmark3[];
  readonly world: readonly Landmark3[];
  readonly handedness: Handedness;
  readonly handednessScore: number;
  readonly mirrored: boolean;
  /**
   * The pose's own squareness floor. Tilt poses ask for a palm that is *not* square-on, so holding
   * them to the flat pose's floor would be a gate that cannot pass — this must be the pose's value,
   * not a constant.
   */
  readonly minFacing: number;
  /** Normalised palm size, used to judge whether the winding triangle has readable area. */
  readonly span: number;
}

/**
 * Decides whether the palm — not the back of the hand — faces the camera.
 *
 * Two regimes. With a **trusted** handedness label the winding sign must match what that physical
 * hand produces palm-forward, which rejects a dorsum for either hand. Below
 * {@link HANDEDNESS_TRUST_SCORE} the label cannot fix an expected sign, so either sign is accepted
 * and only squareness is required.
 *
 * That fallback deliberately CANNOT reject a back of hand, and the honesty matters: with handedness
 * unknown, a right palm and a left dorsum are geometrically identical in image space, so no cross
 * product can separate them. It is tolerable only because it applies in a narrow band — below
 * {@link MIN_DETECTION_SCORE} the `low_confidence` check has already rejected the frame outright.
 */
export function assessFacing(input: FacingInput): FacingReadout {
  const normal = palmNormal(input.world);
  const normalZ = normal === null ? 0 : normal.z;
  const facing = Math.abs(normalZ);
  const winding = palmWinding(input.landmarks);
  const windingSign = winding > 0 ? 1 : winding < 0 ? -1 : 0;
  const expectedSign = expectedWindingSign(input.handedness, input.mirrored);
  const trusted = input.handednessScore >= HANDEDNESS_TRUST_SCORE;
  const squareOn = facing >= input.minFacing;

  /*
   * Third regime, and the one that made TILT_LEFT unpassable: the winding triangle is measured in
   * the projection, so as the palm rotates away from square-on its area collapses and the sign
   * starts flipping on noise. Relaxing minFacing for a tilt pose without relaxing the sign test
   * moved the failure rather than fixing it — the user saw "turn your palm toward the camera" on a
   * palm that was already facing them, exactly as asked.
   */
  const windingStrength = input.span < 1e-6 ? 0 : Math.abs(winding) / (input.span * input.span);
  const windingReadable = windingStrength >= MIN_WINDING_STRENGTH;

  return {
    handedness: input.handedness,
    handednessScore: input.handednessScore,
    physical: physicalHandedness(input.handedness, input.mirrored),
    winding,
    windingSign,
    windingStrength,
    expectedSign,
    normalZ,
    facing,
    trusted,
    windingReadable,
    palmToward: squareOn && (trusted && windingReadable ? windingSign === expectedSign : windingSign !== 0),
  };
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
    const planarity = Math.min(1, (1 - alignment) * PLANARITY_RELAX);

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

/**
 * Signed lateral tilt **in screen space**, from how far the palm normal leans across the image.
 *
 * The mirror correction is the point. World landmarks come from the RAW camera frame, but the
 * preview the user is tilting against is CSS-mirrored, and `PoseProfile.tiltSign` is written in
 * terms of what the user sees. Without the flip, a correct tilt-left reads as a tilt-right and the
 * pose can only be satisfied by tilting the wrong way.
 */
export function palmTilt(world: readonly Landmark3[], mirrored: boolean): number {
  const normal = palmNormal(world);
  if (normal === null) return 0;
  return mirrored ? -normal.x : normal.x;
}

const MIN_TILT = 0.25;
/**
 * Minimum |winding| / span² for the winding SIGN to be evidence. Below this the wrist→index and
 * wrist→pinky vectors are nearly parallel in projection — a foreshortened palm — and the cross
 * product is dominated by landmark jitter.
 */
const MIN_WINDING_STRENGTH = 0.06;

/* ------------------------- Segmentation eligibility ------------------------ */

/**
 * Detection score below which a frame is not worth segmenting. Deliberately far looser than
 * {@link MIN_DETECTION_SCORE}: this asks only "is that a hand?", not "is it a readable palm?".
 */
export const FUSION_MIN_SCORE = 0.6;
/** Fraction of the rectified crop that must sample inside the frame for the mask to mean anything. */
export const FUSION_MIN_COVERAGE = 0.6;

/**
 * Whether to run mask segmentation and temporal fusion on this frame — **not** the rule gate.
 *
 * Fusion used to sit behind `verdict.ok`, which demands every check pass at once. A real hand
 * satisfies that only in short bursts, so the segmenter was starved of frames and the line overlay
 * never had a mask to trace. Separating the two is safe because fusion only ever feeds an average
 * that is re-thresholded on use, while the gate protects everything that makes a claim to the user:
 * rule latching and capture progress.
 */
export function segmentationEligible(detectionScore: number, coverage: number): boolean {
  return detectionScore >= FUSION_MIN_SCORE && coverage >= FUSION_MIN_COVERAGE;
}

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
    return { ok: false, issues: ["no_hand"], hint: HINTS.no_hand, score: 0, checks, facingReadout: null };
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

  const facingReadout = assessFacing({
    landmarks,
    world,
    handedness,
    handednessScore: score,
    mirrored,
    minFacing: pose.minFacing,
    span,
  });
  const facing = facingReadout.facing;
  // The back-of-hand test, relaxed only where the projection cannot carry a sign (see assessFacing).
  if (!facingReadout.palmToward) checks.not_palm_up = false;

  /*
   * Tilting the wrong way is its own failure with its own hint. It used to raise `not_palm_up`,
   * which told a user holding a perfectly good palm to turn it toward the camera — advice that
   * could not fix the actual problem, since the palm was already facing them.
   */
  if (pose.tiltSign !== null && palmTilt(world, mirrored) * pose.tiltSign < MIN_TILT) {
    checks.tilt_direction = false;
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
    facingReadout,
  };
}
