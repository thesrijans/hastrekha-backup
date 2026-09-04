/**
 * Full-resolution still capture for the dev ground-truth harness (sprint Phase 0a).
 *
 * Two paths, tried in order and **recorded** per still — never assumed (spec 0a):
 *
 * 1. `ImageCapture.takePhoto()` — Chromium-only; can return a photo at the sensor's photo
 *    resolution, above the preview stream. Can also stutter the preview on some devices, which is
 *    why the harness only fires it during a stable-window hold.
 * 2. Canvas fallback — draw the `<video>` element at its native `videoWidth × videoHeight` and
 *    encode a PNG. The capture client requests the stream with a large `ideal` size up front, so
 *    the fallback already runs at the camera's maximum stream resolution; constraints are never
 *    switched mid-stream (that would visibly wedge the live preview the gate readout depends on).
 *
 * Also home to the pure stable-window trigger (spec Phase 0a "auto-capture when the gate holds"),
 * kept free of DOM so `test/capture-session.test.ts` can drive it with a synthetic clock.
 */
import { varianceOfLaplacian } from "../quality";
import type { StillCapturePath } from "./session-types";

/* ------------------------------ Stable window ------------------------------ */

/** How long the composite gate (quality + sharpness) must hold before a still auto-fires. */
export const STABLE_WINDOW_MS = 300;

/**
 * A tab switch or GC pause makes one tick's delta huge; counting it as held time would fire a
 * still off a single good frame. Clamped, a stall contributes at most one frame's worth.
 */
export const MAX_TICK_DELTA_MS = 120;

export interface StableWindowState {
  /** Continuous gate-passing milliseconds accumulated so far. */
  readonly heldMs: number;
  /** False after a trigger until the gate fails once — one still per stable hold, not per frame. */
  readonly armed: boolean;
}

export function emptyStableWindow(): StableWindowState {
  return { heldMs: 0, armed: true };
}

export interface StableWindowTick {
  readonly state: StableWindowState;
  /** True exactly once per stable hold, on the tick the window fills. */
  readonly trigger: boolean;
}

/**
 * Advance the stable window by one tick. Pure: same inputs, same outputs.
 *
 * A failing tick resets the held time and re-arms; a passing tick accumulates clamped delta and
 * fires exactly once when the window fills while armed.
 */
export function advanceStableWindow(
  state: StableWindowState,
  gateOk: boolean,
  deltaMs: number,
): StableWindowTick {
  if (!gateOk) {
    return { state: { heldMs: 0, armed: true }, trigger: false };
  }
  const heldMs = state.heldMs + Math.min(Math.max(deltaMs, 0), MAX_TICK_DELTA_MS);
  const shouldFire = state.armed && heldMs >= STABLE_WINDOW_MS;
  return {
    state: { heldMs, armed: state.armed && !shouldFire },
    trigger: shouldFire,
  };
}

/* ----------------------------- Still regrade (A) ----------------------------- */

/**
 * VoL floor for the STILL's canonical-crop centre. Deliberately above the preview's 60: the
 * preview VoL only has to pass a gate, but the still is what gets traced — it needs margin.
 */
export const STILL_VOL_FLOOR = 100;

/** How many capture attempts one trigger may burn before the last still is kept regardless. */
export const STILL_RETRY_MAX = 3;

/** Central fraction of the canonical crop the still VoL is measured on — palm centre, not edges. */
export const STILL_VOL_CENTRE_FRACTION = 0.6;

/**
 * VoL of the centre {@link STILL_VOL_CENTRE_FRACTION} of a canonical palm crop — the number that
 * decides whether a still is sharp enough to trace. Same operator as the preview gate
 * (quality.ts's variance of Laplacian), different subject: the STILL, not the preview frame.
 */
export function stillVolOfCrop(crop: ImageData): number {
  const margin = Math.floor((crop.width * (1 - STILL_VOL_CENTRE_FRACTION)) / 2);
  const side = crop.width - 2 * margin;
  if (side < 3) return 0;
  const luma = new Float32Array(side * side);
  for (let y = 0; y < side; y += 1) {
    for (let x = 0; x < side; x += 1) {
      const at = ((y + margin) * crop.width + x + margin) * 4;
      luma[y * side + x] = 0.2126 * crop.data[at] + 0.7152 * crop.data[at + 1] + 0.0722 * crop.data[at + 2];
    }
  }
  return varianceOfLaplacian(luma, side, side);
}

export interface RegradeDecision {
  /** Keep this still (records `stillVol` + `attempts` either way). */
  readonly accept: boolean;
  /** Capture another attempt right away. */
  readonly retry: boolean;
}

/**
 * Accept/retry decision for one capture attempt (1-based). Below the floor the still is discarded
 * and re-shot, up to {@link STILL_RETRY_MAX} attempts total — the FINAL attempt is kept even when
 * soft, because dropping it would consume the stable-window trigger and leave nothing; its low
 * recorded `stillVol` is the honest mark, and the session list flags it.
 */
export function regradeStill(stillVol: number, attempt: number): RegradeDecision {
  if (stillVol >= STILL_VOL_FLOOR) return { accept: true, retry: false };
  if (attempt >= STILL_RETRY_MAX) return { accept: true, retry: false };
  return { accept: false, retry: true };
}

/* ---------------------------- Pose diversity (B) ---------------------------- */

/** Centroid distance under this fraction of the still width counts as the same pose… */
export const POSE_DUP_RADIUS = 0.04;

/** …when the palm scale also matches within this relative tolerance. */
export const POSE_DUP_SCALE_TOLERANCE = 0.05;

export interface PoseSignature {
  /** Anchor centroid, still px. */
  readonly cx: number;
  readonly cy: number;
  /** Mean anchor distance from the centroid — the palm's apparent size, still px. */
  readonly scale: number;
}

/** Pose signature of one still's crop anchors (`[x, y]` pairs in still px). */
export function poseSignature(anchors: readonly (readonly number[])[]): PoseSignature {
  let cx = 0;
  let cy = 0;
  for (const [x, y] of anchors) {
    cx += x;
    cy += y;
  }
  cx /= anchors.length;
  cy /= anchors.length;
  let scale = 0;
  for (const [x, y] of anchors) scale += Math.hypot(x - cx, y - cy);
  return { cx, cy, scale: scale / anchors.length };
}

/**
 * Index of the first accepted still the candidate near-duplicates, or null. Near-duplicate =
 * centroid within {@link POSE_DUP_RADIUS} of the still width AND scale within
 * {@link POSE_DUP_SCALE_TOLERANCE} relative — one hand held in one pose, re-shot. Duplicates are
 * MARKED, never blocked: the labeler and eval need to know, the person capturing does not need to
 * be interrupted.
 */
export function findPoseDuplicate(
  existing: readonly { readonly index: number; readonly signature: PoseSignature }[],
  candidate: PoseSignature,
  stillWidth: number,
): number | null {
  for (const prior of existing) {
    const centroidPx = Math.hypot(candidate.cx - prior.signature.cx, candidate.cy - prior.signature.cy);
    const scaleBase = Math.max(prior.signature.scale, 1e-6);
    const scaleDelta = Math.abs(candidate.scale - prior.signature.scale) / scaleBase;
    if (centroidPx <= POSE_DUP_RADIUS * stillWidth && scaleDelta <= POSE_DUP_SCALE_TOLERANCE) {
      return prior.index;
    }
  }
  return null;
}

/* --------------------------- Torch control (§2.3) --------------------------- */

/** Structural view of the torch capability/constraint — a Chromium extension, absent from TS lib. */
interface TorchCapableTrack {
  getCapabilities?(): { torch?: boolean };
  applyConstraints(constraints: { advanced?: { torch?: boolean }[] }): Promise<void>;
}

/**
 * Turn the track's torch on or off. Returns whether the request was actually applied — false
 * means the camera has no torch (or refused), and the sequence records `torchSupported: false`
 * so the offline solve knows these frames are ambient-only. Never throws: an unsupported torch
 * is a recorded fact, not an error.
 */
export async function setTorch(track: MediaStreamTrack, on: boolean): Promise<boolean> {
  const capable = track as unknown as TorchCapableTrack;
  const capabilities = capable.getCapabilities?.();
  if (capabilities?.torch !== true) return false;
  try {
    await capable.applyConstraints({ advanced: [{ torch: on }] });
    return true;
  } catch {
    return false;
  }
}

/* ------------------------------ Still capture ------------------------------ */

export interface CapturedStill {
  readonly blob: Blob;
  readonly width: number;
  readonly height: number;
  readonly path: StillCapturePath;
  /** JSON-safe snapshot of `track.getSettings()` at capture time. */
  readonly trackSettings: Readonly<Record<string, string | number | boolean>>;
}

/** Minimal structural view of the ImageCapture API — not yet in every TS lib / browser. */
interface ImageCaptureLike {
  takePhoto(): Promise<Blob>;
}
interface ImageCaptureConstructor {
  new (track: MediaStreamTrack): ImageCaptureLike;
}

/** JSON-safe subset of MediaTrackSettings — functions and nested objects dropped. */
export function serializeTrackSettings(
  settings: MediaTrackSettings,
): Readonly<Record<string, string | number | boolean>> {
  const out: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(settings)) {
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      out[key] = value;
    }
  }
  return out;
}

async function blobDimensions(blob: Blob): Promise<{ width: number; height: number }> {
  const bitmap = await createImageBitmap(blob);
  const size = { width: bitmap.width, height: bitmap.height };
  bitmap.close();
  return size;
}

function grabCanvasStill(video: HTMLVideoElement): Promise<CapturedStill> {
  const width = video.videoWidth;
  const height = video.videoHeight;
  if (width === 0 || height === 0) {
    return Promise.reject(new Error("video has no frames yet"));
  }
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (context === null) return Promise.reject(new Error("2d context unavailable"));
  context.drawImage(video, 0, 0, width, height);
  return new Promise<CapturedStill>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob === null) {
        reject(new Error("toBlob returned null"));
        return;
      }
      resolve({ blob, width, height, path: "canvas-fallback", trackSettings: {} });
    }, "image/png");
  });
}

/**
 * Capture one full-resolution still from the running preview.
 *
 * Tries `ImageCapture.takePhoto()` first and falls back to a native-resolution canvas grab; the
 * returned `path` records which one actually ran so sessions are honest about their provenance.
 */
export async function captureStill(
  track: MediaStreamTrack,
  video: HTMLVideoElement,
): Promise<CapturedStill> {
  const trackSettings = serializeTrackSettings(track.getSettings());
  const Ctor = (globalThis as { ImageCapture?: ImageCaptureConstructor }).ImageCapture;
  if (Ctor !== undefined) {
    try {
      const photo = await new Ctor(track).takePhoto();
      const { width, height } = await blobDimensions(photo);
      return { blob: photo, width, height, path: "image-capture", trackSettings };
    } catch {
      // Fall through — takePhoto is flaky on webcams even where the constructor exists.
    }
  }
  const grabbed = await grabCanvasStill(video);
  return { ...grabbed, trackSettings };
}
