/**
 * The capture-session SCHEMA TYPES, shared by the dev harness and production (scan-complete G4.3).
 *
 * Types only. The dev harness (lib/scan/dev/session-types.ts) keeps its constants and strict validators and
 * re-exports these; production — the chamber's opt-in growth save, lib/scan/snap-store.ts — imports them
 * from here, so it writes the very documents the dev labeler reads without importing anything from
 * lib/scan/dev or app/dev (test/import-boundary.test.ts). Moved verbatim; the one addition is the optional
 * {@link StillPrelabel}.
 */
import type { ActiveLineId, Landmark3 } from "./types";

/** Which hand the session is of. */
export type SessionHand = "left" | "right";

/** What a session is for — see `SessionMetadata.purpose`. Absent on a metadata document means `eval`. */
export type SessionPurpose = "eval" | "growth";

/** Which mechanism produced the full-resolution still. Recorded per still — never assumed. */
export type StillCapturePath = "image-capture" | "canvas-fallback";

/** Quality measurements frozen at the moment of capture, including D6 sharpness. */
export interface StillQuality {
  /** Composite 0–1 gate score from `gradeFrame`. */
  readonly score: number;
  /** Whether every gate check passed at capture time. */
  readonly ok: boolean;
  /** Failing check names, empty when ok. */
  readonly issues: readonly string[];
  /** Mean luma 0–1 over the sampled frame. */
  readonly luma: number;
  /** Fraction of near-white pixels. */
  readonly clipped: number;
  /** Mean landmark displacement vs the previous frame, frame fractions. */
  readonly jitter: number;
  /** Variance of Laplacian on palm-bbox luma at full resolution (D6), 0–255 luma scale. */
  readonly sharpness: number;
}

/** Coarse pose estimate per still — seeds addendum A5's pose bucketing, cheap to record now. */
export interface StillPoseAngle {
  /** In-plane roll: angle of the INDEX_MCP → PINKY_MCP chord vs horizontal, degrees. */
  readonly rollDeg: number;
  /** |winding| / span² from the facing readout — how flat-on the palm is. Null when unreadable. */
  readonly windingStrength: number | null;
}

/**
 * scan-complete G4.3 (additive-optional): the lines the app held on this still, for the labeler's
 * CORRECTION mode to start from instead of re-running its own prelabel. Points are 0–1 fractions of the
 * canonical crop, like every label (D4). `chamber-held`: the Rekha Monitor's CONFIRMED lines at the moment
 * detection completed, aligned to this still.
 */
export interface StillPrelabel {
  readonly source: "chamber-held";
  readonly lines: readonly { readonly id: ActiveLineId; readonly points: readonly (readonly number[])[] }[];
}

/** One captured still and everything needed to replay it offline (A4). */
export interface CaptureStillRecord {
  readonly index: number;
  /** File name inside raw/. */
  readonly rawFile: string;
  /** File name inside selected/. */
  readonly cropFile: string;
  readonly capturePath: StillCapturePath;
  /** Full-resolution still dimensions. */
  readonly width: number;
  readonly height: number;
  /** 21 landmarks normalised 0–1 to the preview frame at trigger time. */
  readonly landmarks: readonly Landmark3[];
  /** Anchor points in still pixels, in `PALM_ANCHORS` order — what the crop was rectified from. */
  readonly anchors: readonly (readonly number[])[];
  readonly quality: StillQuality;
  readonly poseAngle: StillPoseAngle;
  /** `MediaStreamTrack.getSettings()` at capture, JSON-safe fields only. */
  readonly trackSettings: Readonly<Record<string, string | number | boolean>>;
  /** ISO timestamp. */
  readonly capturedAt: string;
  /**
   * Additive-optional (0a-2): VoL measured on the STILL's canonical-crop centre — the number that
   * decides whether the still is traceable, as opposed to `quality.sharpness` which graded the
   * PREVIEW. Absent on pre-regrade files.
   */
  readonly stillVol?: number;
  /** How many captures it took to clear STILL_VOL_FLOOR (1 = first try). Absent pre-regrade. */
  readonly attempts?: number;
  /** Pose-diversity guard: index of an earlier accepted still this one near-duplicates. */
  readonly duplicateOf?: number;
  /** G4.3: the app's held lines on this still — CORRECTION mode's starting point. */
  readonly prelabel?: StillPrelabel;
}

/**
 * One frame of a torch sequence. Everything §2.3's offline solve needs, verbatim from capture:
 * the palm homography (frame→crop, row-major Matrix3) gives the palm plane's orientation, the
 * landmarks give scale (torch-falloff normalisation), trackSettings carries whatever exposure/ISO
 * the platform exposed, and `torch` says which light model the frame belongs to.
 */
export interface SequenceFrameRecord {
  /** Capture order within the sequence — also the frame file's key. */
  readonly order: number;
  /** 0-based index into the tilt choreography (CAPTURE_POSES). */
  readonly poseIndex: number;
  /** The pose's id string, denormalised so the manifest reads without the app. */
  readonly pose: string;
  readonly torch: boolean;
  readonly file: string;
  readonly cropFile: string;
  /** Frame→crop palm homography, row-major, 9 numbers. */
  readonly homography: readonly number[];
  readonly landmarks: readonly Landmark3[];
  readonly width: number;
  readonly height: number;
  readonly stillVol: number;
  readonly attempts: number;
  readonly trackSettings: Readonly<Record<string, string | number | boolean>>;
  readonly capturedAt: string;
}

export interface SequenceManifest {
  readonly schemaVersion: "seq-1";
  readonly sessionId: string;
  /** 0-based index of this sequence within the session — names its sequences/seq-NNN/ dir. */
  readonly sequenceIndex: number;
  readonly hand: SessionHand;
  /** False when applyConstraints could not turn the torch on — the frames are ambient-only. */
  readonly torchSupported: boolean;
  readonly frames: readonly SequenceFrameRecord[];
  /** Index into `frames` of the torch-OFF ambient reference. */
  readonly ambientFrameIndex: number;
  readonly createdAt: string;
}

/** The metadata.json document — one per session. */
export interface SessionMetadata {
  readonly schemaVersion: string;
  readonly sessionId: string;
  readonly hand: SessionHand;
  /** ISO timestamp. */
  readonly createdAt: string;
  /** Canonical crop size the selected/ files were rectified at (D3). */
  readonly canonicalSize: number;
  readonly stills: readonly CaptureStillRecord[];
  /** Written at export time: how many stills carry a staged label. Absent pre-0a-ii. */
  readonly labelCount?: number;
  /** Stills discarded by the still-VoL regrade before one was accepted. Absent pre-regrade. */
  readonly rejectedStills?: number;
  /** Staged torch sequences (measured-reading §2.3). Absent on pre-sequence files. */
  readonly sequences?: readonly SequenceManifest[];
  /**
   * What the session is for. Absent means `eval`: blank-slate labels that score the detector.
   * `growth` unlocks the labeler's CORRECTION mode (prelabels accepted/edited by a human); the eval
   * adapter excludes growth sessions from scoring by default, calibration may use them.
   */
  readonly purpose?: SessionPurpose;
}
