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
