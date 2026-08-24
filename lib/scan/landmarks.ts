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
 * Peak outward bulge, as a fraction of **palm width** (|indexMCP − pinkyMCP|).
 *
 * The basis matters as much as the number: an earlier version scaled by `palmSpan` — the bounding
 * box of all 21 landmarks — which is dominated by finger length, so spreading a finger moved the
 * palm edge. Palm width is the invariant, and it foreshortens with the palm when the hand tilts,
 * which is exactly the behaviour a lateral offset needs.
 *
 * **Calibrated against docs/reference/edge-feedback-current.webp**, a clean near-square palm whose
 * proportions match anatomy (palmWidth/chord = 0.757 against the textbook ~0.75). Measuring its
 * ulnar silhouette put the three drawn samples at 0.107 / 0.269 / 0.345 palm widths; this setting
 * lands all three a uniform ~0.02 inside it.
 *
 * The previous 0.86 came from edge-target-standard.webp, whose palmWidth/chord is 0.380 — half of
 * anatomical. That frame's palm width is foreshortened or mis-measured, so normalising by it
 * inflated the constant, and the result overshot badly on a squarely-presented hand.
 */
export const PALM_EDGE_PEAK = 0.42;

/**
 * Where along the knuckle→wrist run the bulge is widest — the hypothenar (Luna) mount.
 *
 * Moved 0.65 → 0.56 so the p2 sample at t = 0.66 sits on the *falling* limb rather than at the
 * crest. That ratio between the two drawn samples is what the measured silhouette actually
 * constrains: 0.345 / 0.269 = 1.28, which an apex of 0.56 reproduces and 0.65 does not.
 */
export const PALM_EDGE_APEX = 0.56;

/**
 * Floor on the taper, as a fraction of the peak.
 *
 * The reference mark reaches ~0 at both ends, but that is a drawing artefact: it was traced between
 * the two visible landmark dots. The skin edge at the little knuckle is genuinely outboard of the
 * knuckle itself, and rectification needs a non-degenerate 5th anchor at that end. This floor is the
 * smallest value that keeps both facts true.
 */
export const PALM_EDGE_TAPER_FLOOR = 0.2;

/**
 * Bulge profile along the edge, 0–1, peaking at {@link PALM_EDGE_APEX}.
 *
 * A tent, not a constant. The measured target rises roughly linearly from the knuckle to the apex
 * and falls more steeply to the wrist; a constant offset — what this used to be — draws a straight
 * line parallel to the knuckle→wrist chord, which is the wrong *shape* however the magnitude is
 * tuned. Exported so tests and the tuning overlay share one definition.
 */
export function edgeProfile(t: number): number {
  const rise = t / PALM_EDGE_APEX;
  const fall = (1 - t) / (1 - PALM_EDGE_APEX);
  return Math.max(PALM_EDGE_TAPER_FLOOR, Math.min(1, rise, fall));
}

/** Where the three derived points sample the knuckle→wrist run. */
export const PALM_EDGE_SAMPLE_T = { percussionTop: 0, p1: 0.33, p2: 0.66 } as const;

export interface PalmEdge {
  /** One third of the way from the little knuckle to the wrist, stepped off the edge. */
  readonly p1: Point2;
  /** Two thirds along the same run — at the bulge, by design. */
  readonly p2: Point2;
  /** The little knuckle itself, stepped off the edge — the top of the percussion edge. */
  readonly percussionTop: Point2;
  /** Unit vector along the ulnar edge, little knuckle → wrist. */
  readonly edgeAxis: Point2;
  /** Unit vector away from the radial side, perpendicular to {@link edgeAxis}. */
  readonly outward: Point2;
  /** Maximum outward step, in normalised frame units. Each point gets peak × {@link edgeProfile}. */
  readonly peak: number;
  /** Palm width the peak was scaled from, in normalised frame units. */
  readonly palmWidth: number;
}

/**
 * Derived points along the ulnar (percussion) edge of the palm.
 *
 * MediaPipe gives no landmark on the outer edge of the hand — the skeleton stops at the knuckles —
 * so the visible palm boundary has nothing to trace against on that side. These three points are
 * extrapolated from an **anatomical frame** built out of two landmark vectors:
 *
 *   edgeAxis = normalize(wrist − pinkyMCP)        — runs down the ulnar edge
 *   outward  = normalize(pinkyMCP − indexMCP), then made perpendicular to edgeAxis
 *
 * `outward` points from the radial (thumb/index) side toward the ulnar side **by construction**, so
 * it is correct for either hand and under any mirroring with no branch and no runtime sanity check:
 * mirror the input and both basis vectors flip their x together, so every derived point mirrors
 * exactly.
 *
 * The step off the edge is `palmWidth × PALM_EDGE_PEAK × edgeProfile(t)` — a bulge that swells over
 * the hypothenar and tapers at both ends, rather than the constant offset this used to apply.
 *
 * Works in normalised image space (0–1), the same space as `landmarks`.
 *
 * @param peakFraction override for {@link PALM_EDGE_PEAK}; the debug overlay's tuning slider drives it.
 * @returns null when the frame is degenerate — wrist coincident with the little knuckle, or index,
 * little and wrist collinear so that "outward" has no perpendicular component to normalise.
 */
export function derivePalmEdge(
  landmarks: readonly Landmark3[],
  peakFraction: number = PALM_EDGE_PEAK,
): PalmEdge | null {
  if (landmarks.length < 21) return null;

  const wrist = landmarks[LM.WRIST];
  const pinky = landmarks[LM.PINKY_MCP];
  const index = landmarks[LM.INDEX_MCP];

  const edgeVecX = wrist.x - pinky.x;
  const edgeVecY = wrist.y - pinky.y;
  const edgeLength = Math.hypot(edgeVecX, edgeVecY);
  if (edgeLength < 1e-9) return null;
  const edgeAxis: Point2 = { x: edgeVecX / edgeLength, y: edgeVecY / edgeLength };

  let outX = pinky.x - index.x;
  let outY = pinky.y - index.y;
  const palmWidth = Math.hypot(outX, outY);
  if (palmWidth < 1e-9) return null;
  outX /= palmWidth;
  outY /= palmWidth;

  // Remove the component running along the edge, leaving pure "away from the palm".
  const along = outX * edgeAxis.x + outY * edgeAxis.y;
  outX -= along * edgeAxis.x;
  outY -= along * edgeAxis.y;
  const outwardLength = Math.hypot(outX, outY);
  if (outwardLength < 1e-9) return null;
  const outward: Point2 = { x: outX / outwardLength, y: outY / outwardLength };

  const peak = palmWidth * peakFraction;
  if (!Number.isFinite(peak) || peak <= 0) return null;

  /** Sample the knuckle→wrist run at `t`, then step off the edge by the tapered offset. */
  const at = (t: number): Point2 => {
    const offset = peak * edgeProfile(t);
    return {
      x: pinky.x + edgeVecX * t + outward.x * offset,
      y: pinky.y + edgeVecY * t + outward.y * offset,
    };
  };

  return {
    p1: at(PALM_EDGE_SAMPLE_T.p1),
    p2: at(PALM_EDGE_SAMPLE_T.p2),
    percussionTop: at(PALM_EDGE_SAMPLE_T.percussionTop),
    edgeAxis,
    outward,
    peak,
    palmWidth,
  };
}

/**
 * The full visible palm boundary, in normalised image space.
 *
 * Thumb ball → wrist → down the ulnar edge → little knuckle. This is the outline the overlay strokes,
 * and it only closes because of the derived points above; the raw skeleton has nothing between the
 * wrist and the little knuckle.
 *
 * Note the order: `p2` is two thirds of the way from the knuckle to the wrist and `p1` one third, so
 * walking away from the wrist visits p2 before p1. Emitting them in name order instead traced a
 * visible zig-zag out to the knuckle, back toward the wrist, then out again.
 */
export function palmBoundary(landmarks: readonly Landmark3[], peakFraction?: number): Point2[] | null {
  const edge = derivePalmEdge(landmarks, peakFraction);
  if (edge === null) return null;
  const thumbBall = landmarks[LM.THUMB_CMC];
  const wrist = landmarks[LM.WRIST];
  const pinky = landmarks[LM.PINKY_MCP];
  return [
    { x: thumbBall.x, y: thumbBall.y },
    { x: wrist.x, y: wrist.y },
    edge.p2,
    edge.p1,
    edge.percussionTop,
    { x: pinky.x, y: pinky.y },
  ];
}
