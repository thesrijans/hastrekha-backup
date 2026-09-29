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
import { PALM_ANCHORS, palmAnchors } from "./rectify";
import type { FacingReadout, FrameStats, Handedness, Landmark3, Point2, QualityIssue, QualityVerdict } from "./types";

const MIN_LUMA = 0.18;
const MAX_LUMA = 0.92;
const MAX_CLIPPED = 0.12;
/** Landmark drift, in fractions of the frame, above which the hand counts as moving. */
const MAX_JITTER = 0.012;
/**
 * How far inside every edge the palm must sit for `out_of_frame` to pass (scan-complete G1): a fraction
 * of the frame's SHORT side, so the margin is the same number of pixels on all four edges of a portrait
 * phone frame and a landscape webcam frame alike (21.6 px at 720×1280).
 */
export const PALM_FRAME_MARGIN = 0.03;
/**
 * The closest a palm may come (G1): `too_close` fails once the palm quad is wider than this fraction of
 * the frame's width. The distance meter (G2) reads the same constant as its upper bound, so the meter and
 * the gate cannot disagree about "too close".
 */
export const PALM_QUAD_MAX_WIDTH = 0.85;
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
  /** The whole hand's span below which the pose is `too_far`. */
  readonly minSpan: number;
  /**
   * The top of the span band the frame score rewards. No longer a gate (G1): `too_close` measures the
   * palm quad against {@link PALM_QUAD_MAX_WIDTH}, because the fingertips are the first thing to leave a
   * close palm's frame and a close palm is the best crease evidence there is.
   */
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
 * MediaPipe determines handedness *assuming the input image is mirrored* (selfie view).
 *
 * This is the ONE constant to flip if a device disagrees. The debug HUD's facing row makes any
 * disagreement visible in a glance: show a palm and `winding sign` must equal `expected sign`.
 */
export const MEDIAPIPE_ASSUMES_MIRRORED_INPUT: boolean = true;

/**
 * Whether the frames this pipeline hands MediaPipe are mirrored. They never are.
 *
 * The landmarker always gets the RAW camera frame, from whichever camera took it; the mirror is a
 * display concern (lib/scan/camera-select.ts, M1.1) and never touches pixels. And a back camera's
 * photograph of a palm is the same kind of image as a front camera's — the palmar surface seen from
 * in front of it — so the label and the winding pair up the same way through both. The pairing is
 * therefore a property of the INPUT, not of the preview.
 *
 * It used to be keyed to the preview flag, which was only ever true while the front camera was the
 * only camera. With the back camera's unmirrored preview that keying would have expected the opposite
 * winding and failed every confidently-labelled palm as the back of a hand.
 *
 * MEASURED, M1: on the 15 raw session stills of a right hand, MediaPipe says "Right" (0.97), the thumb
 * is on the image's right and the winding is NEGATIVE. So the two stories told here — "the label is
 * inverted" and "a right palm winds positive" — are each wrong, and cancel: label "Right" → swapped →
 * expects negative → the real right palm passes. The gate is right on real frames; only the facing
 * readout's `physical` field names the wrong hand. Recorded rather than rewritten under M1, which
 * changes none of the pairing — only what it depends on.
 */
export const PIPELINE_FEEDS_MIRRORED_INPUT: boolean = false;

/** The physical hand, correcting for MediaPipe's mirrored-input assumption. The same through either camera. */
export function physicalHandedness(label: Handedness): Handedness {
  if (MEDIAPIPE_ASSUMES_MIRRORED_INPUT === PIPELINE_FEEDS_MIRRORED_INPUT) return label;
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
export function expectedWindingSign(label: Handedness): 1 | -1 {
  return physicalHandedness(label) === "Right" ? 1 : -1;
}

export interface FacingInput {
  readonly landmarks: readonly Landmark3[];
  readonly world: readonly Landmark3[];
  readonly handedness: Handedness;
  readonly handednessScore: number;
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
  const expectedSign = expectedWindingSign(input.handedness);
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
    physical: physicalHandedness(input.handedness),
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

/* ------------------------------- The palm frame ------------------------------ */

/** A frame's size in pixels — what the normalised landmarks are fractions of. */
export interface FrameSize {
  readonly width: number;
  readonly height: number;
}

/**
 * The points the frame gate measures (G1): the rectifier's own palm quad — wrist, thumb root, index and
 * little knuckles — plus the percussion point exactly when the rectifier uses it (rectify.ts
 * `palmAnchors`), normalised to the frame. The fingers are not among them: they are the first thing to
 * leave a close palm's frame, and nothing the rectified crop holds depends on them.
 */
export function palmFramePoints(landmarks: readonly Landmark3[]): Point2[] | null {
  const anchors = palmAnchors(landmarks, 1, 1);
  return anchors === null ? null : anchors.src.map((p) => ({ x: p.x, y: p.y }));
}

/** {@link PALM_FRAME_MARGIN} per axis, in normalised units. Without a frame size, a square frame. */
export function palmFrameMargins(frame?: FrameSize): { readonly x: number; readonly y: number } {
  if (frame === undefined || frame.width <= 0 || frame.height <= 0) return { x: PALM_FRAME_MARGIN, y: PALM_FRAME_MARGIN };
  const pixels = PALM_FRAME_MARGIN * Math.min(frame.width, frame.height);
  return { x: pixels / frame.width, y: pixels / frame.height };
}

/** Whether every point lies at least `margins` inside every edge of the frame. */
export function palmInFrame(points: readonly Point2[], margins: { readonly x: number; readonly y: number }): boolean {
  return points.every((p) => p.x >= margins.x && p.x <= 1 - margins.x && p.y >= margins.y && p.y <= 1 - margins.y);
}

/**
 * Largest normalised extent of the palm quad's four anchors (rectify.ts PALM_ANCHORS) — the palm's own
 * size, fingers excluded (G1). The percussion point is left out: it is derived from these four, and it
 * enters and leaves the anchor set near an edge, which would read as the palm changing size.
 */
export function palmQuadSpan(landmarks: readonly Landmark3[]): number {
  if (landmarks.length < 21) return 0;
  return palmSpan(PALM_ANCHORS.map((index) => landmarks[index]));
}

/**
 * Mean movement of the palm quad's four anchors between two frames, in frame fractions — what
 * `unsteady` measures since G1. On a static close-up the extrapolated fingertips alone wobbled past
 * the limit on half the frames (tight-02: 50% over, palm quad 0%); a hand that really moves moves its
 * palm too.
 */
export function palmJitter(previous: readonly Landmark3[] | null, current: readonly Landmark3[]): number {
  if (previous === null || previous.length < 21 || current.length < 21) return 0;
  return landmarkJitter(
    PALM_ANCHORS.map((index) => previous[index]),
    PALM_ANCHORS.map((index) => current[index]),
  );
}

/** The palm quad's width as a fraction of the frame's width: its points' horizontal extent. */
export function palmQuadWidth(points: readonly Point2[]): number {
  if (points.length === 0) return 0;
  let min = Infinity;
  let max = -Infinity;
  for (const p of points) {
    if (p.x < min) min = p.x;
    if (p.x > max) max = p.x;
  }
  return max - min;
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
 * Signed lateral tilt **in screen space**: how far the palm's outward normal leans across the preview
 * the user is tilting against. Negative leans to the user's left, positive to their right, through
 * either camera and with either hand — `PoseProfile.tiltSign` is written in those terms.
 *
 * Two corrections, and the order matters.
 *
 * First the hand. {@link palmNormal} is the wrist → index → little winding, and that winds the
 * opposite way on the other hand: seen palm-on, it points OUT of a right palm (thumb on the image's
 * right) and INTO a left palm (thumb on the image's left), through either lens — chirality is the
 * hand's, not the camera's. Its x alone therefore read the LEFT hand's every tilt with the opposite
 * sign, through both cameras, so that hand's tilt poses could be passed only by tilting the other
 * way (R1); the right hand's reading was already correct through both. The normal is first oriented
 * to face the lens, which the facing gate has already established the palm does; world z grows away
 * from the lens (MEASURED, R1: on every real observation the landmarker's world z correlates +0.6–0.7
 * with its image z, whose smaller values are documented as nearer, and world y runs down like image y).
 *
 * Then the camera. What the camera changes is not the hand's chirality but which way the user's
 * left lies in the frame: world landmarks come from the RAW frame, and a front camera's preview is
 * mirrored, so its x is negated to read in the space the user sees. A back camera's preview is the
 * raw frame.
 */
export function palmTilt(world: readonly Landmark3[], mirrored: boolean): number {
  const normal = palmNormal(world);
  if (normal === null) return 0;
  const outwardX = normal.z > 0 ? -normal.x : normal.x;
  return mirrored ? -outwardX : outwardX;
}

const MIN_TILT = 0.25;
/**
 * Minimum |winding| / span² for the winding SIGN to be evidence. Below this the wrist→index and
 * wrist→pinky vectors are nearly parallel in projection — a foreshortened palm — and the cross
 * product is dominated by landmark jitter.
 *
 * The span is the palm quad's own ({@link palmQuadSpan}) since scan-complete G1: it used to be the
 * whole hand's, so a close palm's extrapolated fingertips — and the length of anyone's fingers — fed
 * into a decision about the palm's triangle. The floor is the old 0.06 carried into palm-quad units,
 * not re-tuned: ×4.12, the median (hand span / palm-quad span)² on the 15 golden session stills (range
 * 4.01–4.43), under which every one of them reads exactly as before (0.085–0.095 against 0.06, now
 * 0.348–0.401 against 0.247).
 */
const MIN_WINDING_STRENGTH = 0.06 * 4.12;

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
  /**
   * The PREVIEW's mirror (M1.1: true for the front camera, false for the back). Read only by the
   * tilt check, which is written in what the reader sees; the physical hand does not depend on it.
   */
  readonly mirrored: boolean;
  readonly stats: FrameStats;
  /** The palm quad's movement since the previous frame ({@link palmJitter}; G1 — never the fingertips'). */
  readonly jitter: number;
  /** MediaPipe's confidence in this detection. */
  readonly score: number;
  /** Recent palm-quad spans ({@link palmQuadSpan}; G1 — the palm's size, not the fingertips'), oldest first. */
  readonly spanHistory: readonly number[];
  readonly pose?: PoseProfile;
  /** The hand seen at the start of the session, so OTHER_HAND can require the opposite one. */
  readonly baselineHandedness?: Handedness | null;
  /**
   * The frame the landmarks are fractions of, so the palm margin is the same number of pixels on every
   * edge (G1). Absent: a square frame.
   */
  readonly frame?: FrameSize;
}

/** Maps a measurement to 0–1 by how comfortably it sits inside its acceptable band. */
function bandScore(value: number, min: number, max: number): number {
  if (value <= min || value >= max) return 0;
  const mid = (min + max) / 2;
  const half = (max - min) / 2;
  return Math.max(0, 1 - Math.abs(value - mid) / half);
}

/**
 * How comfortably the hand's size sits inside what the size gates accept. The far side ramps up from
 * `minSpan` to the middle of the pose's span band, as it always did. The near side no longer ramps down
 * (G1): the only ceiling is the palm quad's width, and up to it a closer palm is better crease evidence,
 * not worse — the score becomes `hand.overall_quality` and every landmark feature's confidence, so a
 * penalty here would still mark down the frames the gate now accepts.
 */
function sizeScore(span: number, quadWidth: number, pose: PoseProfile): number {
  if (quadWidth > PALM_QUAD_MAX_WIDTH) return 0;
  const middle = (pose.minSpan + pose.maxSpan) / 2;
  return span >= middle ? 1 : bandScore(span, pose.minSpan, pose.maxSpan);
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

  const { landmarks, world, handedness, mirrored, stats, jitter, score, spanHistory, baselineHandedness, frame } = input;
  const pose = input.pose ?? DEFAULT_POSE;
  const checks = allPassing();

  if (score < MIN_DETECTION_SCORE) checks.low_confidence = false;

  /*
   * G1: the frame gate measures the PALM — the rectifier's own anchors, 3% of the short side inside every
   * edge. Fingertips and finger joints may leave the frame. The phone recordings of 2026-09-29 lost 818 of
   * 839 hand frames to the old test (all 21 points 2% inside), with the palm itself in plain view: a close
   * palm is the best crease evidence there is, and its fingertips are the first thing out.
   */
  const palm = palmFramePoints(landmarks) ?? [];
  if (palm.length === 0 || !palmInFrame(palm, palmFrameMargins(frame))) checks.out_of_frame = false;

  /*
   * too_far is the whole hand's span, as it always was: a far hand is whole in view. too_close is the palm
   * quad's width (G1) — a span that counted the fingertips would reject exactly the close palm the frame
   * gate now lets through (at the recordings' framing its span is 1.08 against FLAT's old ceiling of 0.86).
   */
  const span = palmSpan(landmarks);
  const quadWidth = palmQuadWidth(palm);
  if (span < pose.minSpan) checks.too_far = false;
  if (quadWidth > PALM_QUAD_MAX_WIDTH) checks.too_close = false;

  const facingReadout = assessFacing({
    landmarks,
    world,
    handedness,
    handednessScore: score,
    minFacing: pose.minFacing,
    // G1: the palm's own size normalises the palm's winding triangle — no fingertip in a palm decision.
    span: palmQuadSpan(landmarks),
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
    sizeScore(span, quadWidth, pose) * 0.25 +
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

/* -------------------------------- Sharpness -------------------------------- */

/**
 * D6 (Phase 0a): optical sharpness via variance of Laplacian, on palm-bbox luma at full
 * resolution. Everything above measures *geometric* steadiness — `unsteady` is landmark jitter —
 * so a perfectly still, badly focused frame passes the gate. For the ground-truth capture harness
 * that is the worst possible still: label-resolution creases live or die on focus.
 *
 * Additive only: `gradeFrame` and its thresholds are untouched. The capture harness composes this
 * with the gate verdict; the live pipeline never calls it.
 */

/**
 * Minimum variance of Laplacian for a still to auto-select, on 0–255 luma.
 *
 * The classic blur heuristic uses ~100 for photographic 8-bit images; laptop webcams render
 * noticeably softer than phone cameras even in focus, so the floor starts permissive. Tune against
 * real captures — it is a named constant precisely so the first session can move it with evidence.
 */
export const SHARPNESS_MIN_VARIANCE = 60;

export interface SharpnessReading {
  /** Variance of the 4-neighbour Laplacian over interior pixels, 0–255 luma scale. */
  readonly variance: number;
  /** `variance >= SHARPNESS_MIN_VARIANCE`. */
  readonly ok: boolean;
}

/**
 * Variance of the 4-neighbour Laplacian `4·c − n − s − e − w` over interior pixels.
 *
 * `luma` is row-major, `width × height`, values on the 0–255 scale (any ArrayLike — Uint8Clamped
 * from a canvas or synthetic Float32 in tests). Returns 0 for degenerate sizes.
 */
export function varianceOfLaplacian(luma: ArrayLike<number>, width: number, height: number): number {
  if (width < 3 || height < 3 || luma.length < width * height) return 0;
  let sum = 0;
  let sumSq = 0;
  let count = 0;
  for (let y = 1; y < height - 1; y += 1) {
    const row = y * width;
    for (let x = 1; x < width - 1; x += 1) {
      const at = row + x;
      const response =
        4 * luma[at] - luma[at - 1] - luma[at + 1] - luma[at - width] - luma[at + width];
      sum += response;
      sumSq += response * response;
      count += 1;
    }
  }
  if (count === 0) return 0;
  const mean = sum / count;
  return sumSq / count - mean * mean;
}

/** Convenience wrapper pairing the measurement with its gate. */
export function assessSharpness(luma: ArrayLike<number>, width: number, height: number): SharpnessReading {
  const variance = varianceOfLaplacian(luma, width, height);
  return { variance, ok: variance >= SHARPNESS_MIN_VARIANCE };
}
