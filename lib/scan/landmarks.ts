/**
 * MediaPipe HandLandmarker wrapper.
 *
 * The heavy import is dynamic so `@mediapipe/tasks-vision` and its WASM never reach the initial
 * bundle or the server render — only the scan route pays for it, and only once the user starts the
 * camera.
 *
 * Both asset paths are **local by default**. Loading them from Google's CDN would work, but this
 * product tells users their palm never leaves the device, and a build that silently reaches out to a
 * third party at scan time is a bad shape for that promise. Run `npm run vendor:mediapipe` to copy
 * the WASM out of node_modules, and drop `hand_landmarker.task` into `public/models/` yourself.
 */
import type { HandLandmarker, HandLandmarkerResult } from "@mediapipe/tasks-vision";
import type { HandObservation, Handedness, Landmark3 } from "./types";

export const MEDIAPIPE_WASM_PATH = "/mediapipe/wasm";
export const HAND_LANDMARKER_MODEL_PATH = "/models/hand_landmarker.task";

export interface LandmarkerOptions {
  readonly wasmPath?: string;
  readonly modelPath?: string;
  /** "GPU" delegates to WebGL where available. Falls back to CPU on failure. */
  readonly delegate?: "GPU" | "CPU";
}

export class MissingScanAssetError extends Error {
  readonly assetPath: string;

  constructor(assetPath: string) {
    super(
      `Scan asset missing: ${assetPath}. Run "npm run vendor:mediapipe" for the WASM, and download ` +
        `hand_landmarker.task from Google's MediaPipe model page into public/models/.`,
    );
    this.name = "MissingScanAssetError";
    this.assetPath = assetPath;
  }
}

/** HEAD the asset first so a missing file is an actionable message, not an opaque WASM abort. */
async function assertAsset(path: string): Promise<void> {
  try {
    const response = await fetch(path, { method: "HEAD" });
    if (!response.ok) throw new MissingScanAssetError(path);
  } catch (error) {
    if (error instanceof MissingScanAssetError) throw error;
    throw new MissingScanAssetError(path);
  }
}

export async function createHandLandmarker(options: LandmarkerOptions = {}): Promise<HandLandmarker> {
  const wasmPath = options.wasmPath ?? MEDIAPIPE_WASM_PATH;
  const modelPath = options.modelPath ?? HAND_LANDMARKER_MODEL_PATH;

  await assertAsset(modelPath);

  const { FilesetResolver, HandLandmarker: Landmarker } = await import("@mediapipe/tasks-vision");
  const fileset = await FilesetResolver.forVisionTasks(wasmPath);

  return Landmarker.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: modelPath, delegate: options.delegate ?? "GPU" },
    numHands: 1,
    runningMode: "VIDEO",
    // The palm is held still and close, so a stricter detector costs nothing and rejects fewer frames later.
    minHandDetectionConfidence: 0.6,
    minHandPresenceConfidence: 0.6,
    minTrackingConfidence: 0.6,
  });
}

function copyLandmarks(source: ReadonlyArray<{ x: number; y: number; z: number }>): Landmark3[] {
  return source.map((point) => ({ x: point.x, y: point.y, z: point.z }));
}

/**
 * Reduces a MediaPipe result to the first hand, or null when nothing was found.
 *
 * MediaPipe's handedness is reported for the image as given. When the preview is mirrored — which it
 * is for a front camera — the label is the opposite of the user's actual hand, so callers pass
 * `mirrored` down to the quality gate rather than trying to correct the label here.
 */
export function toObservation(result: HandLandmarkerResult, timestampMs: number): HandObservation | null {
  const landmarks = result.landmarks?.[0];
  const world = result.worldLandmarks?.[0];
  const handedness = result.handedness?.[0]?.[0];
  if (landmarks === undefined || world === undefined || landmarks.length < 21) return null;

  const label: Handedness = handedness?.categoryName === "Left" ? "Left" : "Right";
  return {
    landmarks: copyLandmarks(landmarks),
    world: copyLandmarks(world),
    handedness: label,
    score: handedness?.score ?? 0,
    timestampMs,
  };
}
