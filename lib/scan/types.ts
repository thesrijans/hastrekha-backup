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
 * Side length everything downstream of the detectors works at: the fused field, the accumulator, the
 * traced polylines, the completed lines.
 *
 * The crop stays at {@link RECTIFIED_SIZE} because that is what the UNet was trained on. The classical
 * detectors do not need those pixels — a crease is 4–6px wide at 256, so 2–3px at 128, exactly the
 * width the Frangi scales and the black-hat radii are tuned for — and half resolution is four times
 * cheaper.
 *
 * What matters is that the pipeline then STAYS here. Upsampling the fields back to 256 to threshold
 * and thin them there was measurably destructive: on a real palm the same evidence traced 10
 * fragments at 128 and only 8 after the round trip, completing 2 lines instead of 1. Bilinear
 * interpolation cannot add detail, and `thin()` is a topological operation — smoothing a ridge before
 * skeletonising it changes which pixels survive, always for the worse.
 */
export const MASK_SIZE = 128;

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
  /** Which execution provider produced this, e.g. "webgpu", "wasm" or "ridge-only". */
  readonly backend?: string;
  /**
   * How many anchor correspondences the crop this mask came from was rectified with.
   *
   * Carried so the OVERLAY can project through the same convention. A mask computed in a 5-anchor
   * crop and drawn through a 4-anchor homography lands measurably off the creases it was traced
   * from — about 4.6 video pixels on a typical frame, which is most of a crease width.
   */
  readonly convention?: number;
  /**
   * Raw per-detector fields, for the debug HUD's channel toggles.
   *
   * Every channel is nullable except `ridge`, because each has its own reason to be absent: no model
   * file, a classical pass skipped this frame for budget, a stack not yet filled. A null channel is a
   * fact about this frame rather than a failure, and the HUD says which.
   */
  readonly stages?: {
    /** The UNet's own output. Null with no model file, and on frames it did not run. */
    readonly unet: Float32Array | null;
    /** Black-hat + Gabor. Held from the last frame it ran on when the budget skipped it. */
    readonly ridge: Float32Array;
    /** Frangi vesselness. */
    readonly frangi: Float32Array | null;
    /** The temporal low-order composite that fed this frame's detectors. */
    readonly median: Float32Array | null;
    /** Multi-pose photometric variance, applied on the main thread from capture state. */
    readonly photometric: Float32Array | null;
  };
  /** Per-stage wall-clock milliseconds: unet / clahe / blackhat / gabor / total. */
  readonly timings?: Readonly<Record<string, number>>;
}

/** A traced line in rectified-crop pixel coordinates. Feeds both the geometry classifier and HoloPalm. */
export interface TracedLine {
  readonly id: PalmLineId;
  readonly points: readonly (readonly [number, number])[];
  /** 0–1, how strongly this trace is believed. Measured on observed samples only. */
  readonly confidence: number;
  /**
   * Which index ranges of `points` were actually seen versus bridged across a gap.
   *
   * A completed line necessarily contains stretches where no crease was detected. Carrying that
   * distinction in the data — rather than smoothing it away — is what lets the overlay draw inferred
   * stretches dimmer and lets the feature extraction refuse to make claims about them.
   */
  readonly segments?: ReadonlyArray<{ readonly from: number; readonly to: number; readonly observed: boolean }>;
  /** Fraction of the curve's arc length that sits on observed evidence. */
  readonly observedFraction?: number;
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
  /** The guided pose asked for a tilt and got one the other way (or none at all). */
  | "tilt_direction"
  /** Fingers are curled; a closed hand hides the very lines being read. */
  | "fingers_curled"
  /** The guided sequence asked for the other hand and got the same one. */
  | "wrong_hand"
  | "too_dark"
  | "too_bright"
  | "unsteady"
  /** Palm span is drifting across frames — the pose is not being held. */
  | "inconsistent";

/**
 * Everything the palm/dorsum decision was made from, surfaced so the sign convention can be
 * confirmed on a real device instead of argued about. Null when no hand was detected.
 */
export interface FacingReadout {
  /** MediaPipe's raw label. */
  readonly handedness: Handedness;
  readonly handednessScore: number;
  /** The physical hand, after correcting for MediaPipe's mirrored-input assumption. */
  readonly physical: Handedness;
  /** Raw signed winding of wrist → index knuckle → little knuckle, image space. */
  readonly winding: number;
  readonly windingSign: number;
  /**
   * |winding| / span² — how much projected area the winding triangle actually has. A tilted palm
   * foreshortens to a sliver, where the sign is noise rather than evidence.
   */
  readonly windingStrength: number;
  /** The sign a palm-toward-camera view of `physical` produces. */
  readonly expectedSign: number;
  /** z of the unit palm normal in world space. */
  readonly normalZ: number;
  /** |normalZ| — how square-on the palm is. */
  readonly facing: number;
  /** False when the handedness score was too low to fix the expected sign. */
  readonly trusted: boolean;
  /** False when the projection is too foreshortened for the winding sign to mean anything. */
  readonly windingReadable: boolean;
  readonly palmToward: boolean;
}

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
  /** How the palm/dorsum call was made. Null when no hand was detected. */
  readonly facingReadout: FacingReadout | null;
}

/** Frame statistics the gate needs but cannot compute itself. */
export interface FrameStats {
  /** Mean luma 0–1 over the hand's bounding box. */
  readonly luma: number;
  /** Fraction of pixels at or near full white in the hand's bounding box. */
  readonly clipped: number;
}
