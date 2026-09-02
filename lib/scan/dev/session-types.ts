/**
 * Capture-session and label schemas for the dev-only ground-truth harness (sprint Phase 0a).
 *
 * Everything here is pure data: types, layout constants, and strict validators. No DOM, no
 * imports from the live detection pipeline — the eval set must be buildable and checkable
 * without ever touching detector code (the blank-slate rule from spec Phase 0b).
 *
 * The label format is a **superset of `GroundTruth` in `test/golden-run.ts`** (decision D4):
 * `frame` + `anchors` + `lines[{id, points}]` are exactly what `loadGroundTruth` consumes, with
 * points as 0–1 canonical-crop fractions, so a labeler export drops into
 * `test/fixtures/ground-truth/` unchanged. The extra fields (hand, absent flags, labeler,
 * timestamps) ride along and are ignored by the loader.
 *
 * Session directory layout (addendum A4 — full offline replay):
 *
 * ```text
 * <sessionId>/
 *   metadata.json     one SessionMetadata document
 *   raw/              full-resolution originals, still-<n>.png
 *   selected/         512-canonical crops, crop-<n>.png (D3: labeling resolution)
 *   aligned/          reserved empty in 0a (Phase 2 registration output)
 *   snapshots/        reserved empty in 0a (accumulation snapshots)
 *   labels/           labeler exports, label-<n>.json (written in 0a-ii)
 * ```
 */
import type { Landmark3 } from "../types";

/* ------------------------------ Layout constants ------------------------------ */

/**
 * Labeling + eval resolution (decision D3): canonical crop long side for captured stills.
 * Independent of the live pipeline's RECTIFIED_SIZE/MASK_SIZE — the live path is untouched in 0a.
 */
export const CANONICAL_LABEL_SIZE = 512;

export const SESSION_DIR_RAW = "raw";
export const SESSION_DIR_SELECTED = "selected";
export const SESSION_DIR_ALIGNED = "aligned";
export const SESSION_DIR_SNAPSHOTS = "snapshots";
export const SESSION_DIR_LABELS = "labels";
/** Every directory a session export creates, in creation order. aligned/ + snapshots/ stay empty in 0a. */
export const SESSION_DIRS: readonly string[] = [
  SESSION_DIR_RAW,
  SESSION_DIR_SELECTED,
  SESSION_DIR_ALIGNED,
  SESSION_DIR_SNAPSHOTS,
  SESSION_DIR_LABELS,
];
export const SESSION_METADATA_FILE = "metadata.json";

/** Schema tag written into every metadata/label file so replays can detect drift. */
export const SESSION_SCHEMA_VERSION = "0a-1";

/**
 * Label-file schema versions. 0a-1 files predate the labeler internals (0a-ii) and carry NONE of
 * the per-line confidence/method/view fields; 0a-2 files must carry all of them. The validator
 * enforces the split strictly in both directions, so a file can never be half-upgraded.
 */
export const LABEL_SCHEMA_VERSIONS = ["0a-1", "0a-2"] as const;
export type LabelSchemaVersion = (typeof LABEL_SCHEMA_VERSIONS)[number];

/** Grayscale source for the valley operator and the enhanced views (0a-ii). */
export const GRAY_CHANNELS = ["LUMA", "R", "G", "B"] as const;
export type GrayChannel = (typeof GRAY_CHANNELS)[number];

/** Display modes for the labeler stage. Display-only: never written back to a stored crop. */
export const VIEW_MODES = ["NATURAL", "CONTRAST", "CREASE"] as const;
export type ViewMode = (typeof VIEW_MODES)[number];

/**
 * Ruling (0a-ii): string confidence, matching the hand-traced ground truth in
 * test/fixtures/ground-truth/ (`"confidence": "faint"`), not a numeric 1–3 scale.
 */
export const LABEL_CONFIDENCES = ["clear", "faint", "uncertain"] as const;
export type LabelConfidence = (typeof LABEL_CONFIDENCES)[number];

/**
 * How a line's points were produced. `unet-prelabel-corrected` is RESERVED for the locked
 * correction mode (growth set, after the eval set freezes) — nothing produces it in 0a.
 */
export const LABEL_METHODS = ["livewire", "manual", "unet-prelabel-corrected"] as const;
export type LabelMethod = (typeof LABEL_METHODS)[number];

/** Version tag for the enhancement stack a label was drawn under. */
export const ENHANCEMENT_VERSION = "enh-1";

/** File name for a still's full-resolution original inside raw/. */
export function rawFileName(index: number): string {
  return `still-${String(index).padStart(3, "0")}.png`;
}

/** File name for a still's canonical crop inside selected/. */
export function cropFileName(index: number): string {
  return `crop-${String(index).padStart(3, "0")}.png`;
}

/** File name for a still's label inside labels/. */
export function labelFileName(index: number): string {
  return `label-${String(index).padStart(3, "0")}.json`;
}

/* --------------------------------- Capture --------------------------------- */

/** Which mechanism produced the full-resolution still. Recorded per still — never assumed. */
export type StillCapturePath = "image-capture" | "canvas-fallback";

export type SessionHand = "left" | "right";

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
}

/* ---------------------------------- Labels ---------------------------------- */

/** The four lines Phase 0b labels. Matches the spec 0b schema. */
export const LABEL_LINE_IDS = ["heart", "head", "life", "fate"] as const;
export type LabelLineId = (typeof LABEL_LINE_IDS)[number];

/** One labeled line. `absent: true` is a valid observation, not a failure — points then empty. */
export interface RekhaLabelLine {
  readonly id: LabelLineId;
  /** Polyline as 0–1 fractions of the canonical crop (D4 — golden-run compatible). */
  readonly points: readonly (readonly number[])[];
  readonly absent: boolean;
  /** 0a-2: required. How sure the human was — string form matches the hand-traced GT. */
  readonly confidence?: LabelConfidence;
  /** 0a-2: required. 'livewire' when any segment snapped, else 'manual'. */
  readonly method?: LabelMethod;
  /** 0a-2: required. Which view the line was committed under — the bias record. */
  readonly viewAtCommit?: ViewMode;
}

export type LabelerMode = "blank_slate" | "correction";

/**
 * One label file (labels/label-<n>.json). The `frame`/`anchors`/`lines` triple is directly
 * consumable by `loadGroundTruth` in test/golden-run.ts; everything else is provenance.
 */
export interface RekhaLabelFile {
  readonly schemaVersion: LabelSchemaVersion;
  readonly sessionId: string;
  readonly stillIndex: number;
  /** Path to the labeled image — the canonical crop inside selected/. */
  readonly frame: string;
  /** Anchor points in crop pixels (golden-run parity; identity corners for a canonical crop). */
  readonly anchors: readonly (readonly number[])[];
  readonly canonicalSize: number;
  readonly hand: SessionHand;
  readonly lines: readonly RekhaLabelLine[];
  /** Ids of absent lines, duplicated from the per-line flags for ground-truth parity. */
  readonly absent: readonly LabelLineId[];
  readonly mode: LabelerMode;
  readonly labeler: string;
  /** 0a-2: required. Stable id for the person, distinct from the display name above. */
  readonly labelerId?: string;
  /** 0a-2: required. Which enhancement stack + gray channel the labeling ran under. */
  readonly enhancement?: { readonly version: typeof ENHANCEMENT_VERSION; readonly channel: GrayChannel };
  /** ISO timestamps. */
  readonly capturedAt: string;
  readonly labeledAt: string;
}

/* -------------------------------- Validators -------------------------------- */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isPointArray(value: unknown): value is readonly (readonly number[])[] {
  return (
    Array.isArray(value) &&
    value.every((p) => Array.isArray(p) && p.length === 2 && p.every(isFiniteNumber))
  );
}

function isLandmarkArray(value: unknown): value is readonly Landmark3[] {
  return (
    Array.isArray(value) &&
    value.length === 21 &&
    value.every((l) => isRecord(l) && isFiniteNumber(l.x) && isFiniteNumber(l.y) && isFiniteNumber(l.z))
  );
}

function isStillQuality(value: unknown): value is StillQuality {
  return (
    isRecord(value) &&
    isFiniteNumber(value.score) &&
    typeof value.ok === "boolean" &&
    Array.isArray(value.issues) &&
    value.issues.every((issue) => typeof issue === "string") &&
    isFiniteNumber(value.luma) &&
    isFiniteNumber(value.clipped) &&
    isFiniteNumber(value.jitter) &&
    isFiniteNumber(value.sharpness)
  );
}

function isStillRecord(value: unknown): value is CaptureStillRecord {
  return (
    isRecord(value) &&
    isFiniteNumber(value.index) &&
    typeof value.rawFile === "string" &&
    typeof value.cropFile === "string" &&
    (value.capturePath === "image-capture" || value.capturePath === "canvas-fallback") &&
    isFiniteNumber(value.width) &&
    isFiniteNumber(value.height) &&
    isLandmarkArray(value.landmarks) &&
    isPointArray(value.anchors) &&
    isStillQuality(value.quality) &&
    isRecord(value.poseAngle) &&
    isFiniteNumber((value.poseAngle as Record<string, unknown>).rollDeg) &&
    isRecord(value.trackSettings) &&
    typeof value.capturedAt === "string"
  );
}

/** Strict structural check for a metadata.json document. */
export function isSessionMetadata(value: unknown): value is SessionMetadata {
  return (
    isRecord(value) &&
    value.schemaVersion === SESSION_SCHEMA_VERSION &&
    typeof value.sessionId === "string" &&
    value.sessionId.length > 0 &&
    (value.hand === "left" || value.hand === "right") &&
    typeof value.createdAt === "string" &&
    isFiniteNumber(value.canonicalSize) &&
    (value.labelCount === undefined || isFiniteNumber(value.labelCount)) &&
    Array.isArray(value.stills) &&
    value.stills.every(isStillRecord)
  );
}

/**
 * Strict structural check for a label file, including the D4 invariants: every line id valid and
 * unique, absent lines carry no points, present lines carry ≥2 in-range points, and the top-level
 * `absent` list mirrors the per-line flags exactly.
 */
export function isRekhaLabelFile(value: unknown): value is RekhaLabelFile {
  if (
    !isRecord(value) ||
    !(LABEL_SCHEMA_VERSIONS as readonly string[]).includes(value.schemaVersion as string) ||
    typeof value.sessionId !== "string" ||
    !isFiniteNumber(value.stillIndex) ||
    typeof value.frame !== "string" ||
    !isPointArray(value.anchors) ||
    !isFiniteNumber(value.canonicalSize) ||
    (value.hand !== "left" && value.hand !== "right") ||
    !Array.isArray(value.lines) ||
    !Array.isArray(value.absent) ||
    (value.mode !== "blank_slate" && value.mode !== "correction") ||
    typeof value.labeler !== "string" ||
    typeof value.capturedAt !== "string" ||
    typeof value.labeledAt !== "string"
  ) {
    return false;
  }
  const isV2 = value.schemaVersion === "0a-2";

  // File-level 0a-2 fields: required and valid on 0a-2, absent on 0a-1 — never half-upgraded.
  if (isV2) {
    if (typeof value.labelerId !== "string" || value.labelerId.length === 0) return false;
    const enh = value.enhancement;
    if (
      !isRecord(enh) ||
      enh.version !== ENHANCEMENT_VERSION ||
      !(GRAY_CHANNELS as readonly string[]).includes(enh.channel as string)
    ) {
      return false;
    }
  } else if (value.labelerId !== undefined || value.enhancement !== undefined) {
    return false;
  }

  const seen = new Set<string>();
  for (const line of value.lines) {
    if (!isRecord(line) || typeof line.id !== "string") return false;
    if (!(LABEL_LINE_IDS as readonly string[]).includes(line.id) || seen.has(line.id)) return false;
    seen.add(line.id);
    if (typeof line.absent !== "boolean" || !isPointArray(line.points)) return false;
    if (line.absent && line.points.length > 0) return false;
    if (!line.absent && line.points.length < 2) return false;
    if (!line.points.every((p) => p[0] >= 0 && p[0] <= 1 && p[1] >= 0 && p[1] <= 1)) return false;
    if (isV2) {
      if (!(LABEL_CONFIDENCES as readonly string[]).includes(line.confidence as string)) return false;
      if (!(LABEL_METHODS as readonly string[]).includes(line.method as string)) return false;
      if (!(VIEW_MODES as readonly string[]).includes(line.viewAtCommit as string)) return false;
    } else if (line.confidence !== undefined || line.method !== undefined || line.viewAtCommit !== undefined) {
      return false;
    }
  }
  const flagged = value.lines
    .filter((line): line is RekhaLabelLine => isRecord(line) && line.absent === true)
    .map((line) => line.id)
    .sort();
  const listed = [...value.absent].sort();
  return flagged.length === listed.length && flagged.every((id, i) => id === listed[i]);
}

/** JSON round-trip helper: parse + validate in one step, null on any failure. */
export function parseSessionMetadata(json: string): SessionMetadata | null {
  try {
    const value: unknown = JSON.parse(json);
    return isSessionMetadata(value) ? value : null;
  } catch {
    return null;
  }
}

/** JSON round-trip helper for label files. */
export function parseRekhaLabelFile(json: string): RekhaLabelFile | null {
  try {
    const value: unknown = JSON.parse(json);
    return isRekhaLabelFile(value) ? value : null;
  } catch {
    return null;
  }
}
