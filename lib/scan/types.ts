/**
 * Shared types for the on-device palm scan.
 *
 * Nothing here touches the DOM or MediaPipe, so every stage of the pipeline can be unit-tested in
 * node. The rule that governs this whole directory: **no palm image ever leaves the device.** Only
 * derived scalar features are sent to /api/reading.
 */

export interface Point2 {
  readonly x: number;
  readonly y: number;
}

/** MediaPipe landmark. Image-space landmarks are normalised 0–1; world landmarks are metres from the wrist. */
export interface Landmark3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export type Handedness = "Left" | "Right";

/** One frame's worth of hand detection. */
export interface HandObservation {
  /** 21 landmarks, normalised to the frame (0–1). */
  readonly landmarks: readonly Landmark3[];
  /** 21 landmarks in metric space with the wrist at the origin. */
  readonly world: readonly Landmark3[];
  readonly handedness: Handedness;
  readonly score: number;
  readonly timestampMs: number;
}

/* --------------------------------- Lines ---------------------------------- */

/**
 * Every line the knowledge base can reason about.
 *
 * Only the first four are produced today. The rest are **reserved deliberately**: the KB already
 * carries 73 rules that need them (marriage alone is 27), and fixing the vocabulary now means adding
 * a class later is a model change, never a feature-contract change.
 */
export type PalmLineId =
  | "heart"
  | "head"
  | "life"
  | "fate"
  // ---- reserved: no extractor yet, but the contract is already shaped for them ----
  | "sun"
  | "marriage"
  | "health"
  | "children"
  | "travel"
  | "intuition";

/** Lines the current pipeline can actually identify. */
export const ACTIVE_LINE_IDS = ["heart", "head", "life", "fate"] as const satisfies readonly PalmLineId[];

/** Declared in the type, not yet extracted. Listed so the gap is visible rather than implied. */
export const RESERVED_LINE_IDS = [
  "sun",
  "marriage",
  "health",
  "children",
  "travel",
  "intuition",
] as const satisfies readonly PalmLineId[];

export type ActiveLineId = (typeof ACTIVE_LINE_IDS)[number];

/** Side length of the rectified palm crop. Matches the pretrained UNet's 256×256 input. */
export const RECTIFIED_SIZE = 256;

/**
 * Output of a segmenter.
 *
 * The pretrained checkpoint is `n_classes=1`: it emits a single "is this a line" probability field,
 * not one channel per line. Splitting that into heart/head/life/fate is the geometry classifier's
 * job, using landmark anchors — the model never knows which line it found.
 *
 * `perLine` exists so a future multi-class model can supply channels directly. Consumers must prefer
 * `perLine` when present and fall back to splitting `all`, which keeps both worlds on one contract.
 */
export interface LineMask {
  readonly width: number;
  readonly height: number;
  /** Probabilities in [0,1], row-major, length width×height. */
  readonly all: Float32Array;
  /** Per-line probabilities when the model provides them. Absent for the 1-class checkpoint. */
  readonly perLine?: Partial<Record<PalmLineId, Float32Array>>;
  /** Which lines this mask can be trusted to distinguish. Empty means "undifferentiated". */
  readonly resolves: readonly PalmLineId[];
  /** Wall-clock inference time, surfaced in the debug HUD. */
  readonly inferenceMs?: number;
  /** Which execution provider produced this, e.g. "webgpu" or "wasm". */
  readonly backend?: string;
}

/** A traced line in rectified-crop pixel coordinates. Feeds both the geometry classifier and HoloPalm. */
export interface TracedLine {
  readonly id: PalmLineId;
  readonly points: readonly (readonly [number, number])[];
  /** 0–1, how strongly this trace is believed. Drives temporal fusion later. */
  readonly confidence: number;
}

/* -------------------------------- Quality --------------------------------- */

export type QualityIssue =
  | "no_hand"
  /** MediaPipe's own confidence in the detection is too low to trust the landmarks. */
  | "low_confidence"
  | "out_of_frame"
  | "too_far"
  | "too_close"
  | "not_palm_up"
  /** Fingers are curled; a closed hand hides the very lines being read. */
  | "fingers_curled"
  /** The guided sequence asked for the other hand and got the same one. */
  | "wrong_hand"
  | "too_dark"
  | "too_bright"
  | "unsteady"
  /** Palm span is drifting across frames — the pose is not being held. */
  | "inconsistent";

export interface QualityVerdict {
  /** True when a rectified crop taken from this frame is worth keeping. */
  readonly ok: boolean;
  readonly issues: readonly QualityIssue[];
  /** The single most useful thing to tell the user right now, in Hinglish. */
  readonly hint: string;
  /** 0–1 overall frame quality; feeds `hand.overall_quality`. */
  readonly score: number;
  /** Per-check pass/fail, every check present. The debug HUD renders this live. */
  readonly checks: Readonly<Record<QualityIssue, boolean>>;
}

/** Frame statistics the gate needs but cannot compute itself. */
export interface FrameStats {
  /** Mean luma 0–1 over the hand's bounding box. */
  readonly luma: number;
  /** Fraction of pixels at or near full white in the hand's bounding box. */
  readonly clipped: number;
}
