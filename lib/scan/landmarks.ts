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
import { LM } from "./landmark-index";
import { palmSpan } from "./quality";
import type { HandObservation, Handedness, Landmark3, Point2 } from "./types";

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

/* ------------------------------- Palm edge -------------------------------- */

/**
 * The five landmarks whose mean defines the palm's centre.
 *
 * Knuckles and wrist only. Including fingertips would drag the centroid up into the fingers, and
 * every "outward" direction derived from it would tilt with however the fingers happen to be spread.
 */
export const PALM_CENTROID_POINTS = [
  LM.WRIST,
  LM.INDEX_MCP,
  LM.MIDDLE_MCP,
  LM.RING_MCP,
  LM.PINKY_MCP,
] as const;

/** Outward push as a fraction of palm span. */
export const PALM_EDGE_OFFSET = 0.12;

export interface PalmEdge {
  /** One third of the way from the little knuckle to the wrist, pushed out to the skin edge. */
  readonly p1: Point2;
  /** Two thirds along the same run. */
  readonly p2: Point2;
  /** The little knuckle itself, pushed out — the top of the percussion edge. */
  readonly percussionTop: Point2;
  /** Palm centre the outward direction was taken from. Exposed for the debug overlay and tests. */
  readonly centroid: Point2;
  /** Push distance actually applied, in normalised frame units. */
  readonly offset: number;
}

function lerp(a: Landmark3 | Point2, b: Landmark3 | Point2, t: number): Point2 {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

/**
 * Derived points along the ulnar (percussion) edge of the palm.
 *
 * MediaPipe gives no landmark on the outer edge of the hand — the skeleton stops at the knuckles —
 * so the visible palm boundary has nothing to trace against on that side. These three points are
 * extrapolated: sample the little-knuckle-to-wrist run, then push each sample directly away from the
 * palm centroid by a fraction of palm span, which lands them on the fleshy edge.
 *
 * Pushing along `point - centroid` means the direction is correct for either hand without any
 * handedness branch: mirror the input and every offset mirrors with it.
 *
 * Works in normalised image space (0–1), the same space as `landmarks`.
 */
export function derivePalmEdge(
  landmarks: readonly Landmark3[],
  offsetFraction: number = PALM_EDGE_OFFSET,
): PalmEdge | null {
  if (landmarks.length < 21) return null;

  let cx = 0;
  let cy = 0;
  for (const index of PALM_CENTROID_POINTS) {
    cx += landmarks[index].x;
    cy += landmarks[index].y;
  }
  const centroid: Point2 = { x: cx / PALM_CENTROID_POINTS.length, y: cy / PALM_CENTROID_POINTS.length };

  const offset = palmSpan(landmarks) * offsetFraction;
  if (!Number.isFinite(offset) || offset <= 0) return null;

  const pushOut = (point: Point2): Point2 => {
    const dx = point.x - centroid.x;
    const dy = point.y - centroid.y;
    const length = Math.hypot(dx, dy);
    // A sample sitting exactly on the centroid has no outward direction; leave it where it is
    // rather than inventing one.
    if (length < 1e-9) return point;
    return { x: point.x + (dx / length) * offset, y: point.y + (dy / length) * offset };
  };

  const pinky = landmarks[LM.PINKY_MCP];
  const wrist = landmarks[LM.WRIST];

  return {
    p1: pushOut(lerp(pinky, wrist, 0.33)),
    p2: pushOut(lerp(pinky, wrist, 0.66)),
    percussionTop: pushOut({ x: pinky.x, y: pinky.y }),
    centroid,
    offset,
  };
}

/**
 * The full visible palm boundary, in normalised image space.
 *
 * Thumb ball → wrist → down the ulnar edge → little knuckle. This is the outline the overlay strokes,
 * and it only closes because of the derived points above; the raw skeleton has nothing between the
 * wrist and the little knuckle.
 */
export function palmBoundary(landmarks: readonly Landmark3[]): Point2[] | null {
  const edge = derivePalmEdge(landmarks);
  if (edge === null) return null;
  const thumbBall = landmarks[LM.THUMB_CMC];
  const wrist = landmarks[LM.WRIST];
  const pinky = landmarks[LM.PINKY_MCP];
  return [
    { x: thumbBall.x, y: thumbBall.y },
    { x: wrist.x, y: wrist.y },
    edge.p1,
    edge.p2,
    edge.percussionTop,
    { x: pinky.x, y: pinky.y },
  ];
}
