/**
 * Video → canvas coordinate mapping.
 *
 * The camera preview renders with `object-fit: cover`: the video is scaled until it *covers* the
 * container and the overflow is cropped equally from both sides. Landmarks, however, are normalised
 * to the **video frame**. Multiplying them by the canvas size — what the overlay originally did —
 * is an `object-fit: fill` mapping: it squashes the geometry to the container's aspect ratio and
 * drops the centre-crop offset, which is exactly why the skeleton floated beside the hand instead
 * of sitting on it.
 *
 * This module is the single source of truth for that mapping. Every overlay draw — skeleton,
 * boundary, anchors, glow polylines, mount dots, sweep — goes through it, and the mirror lives here
 * too, so no drawing code ever applies its own `scaleX(-1)` on top.
 *
 * Pure maths, unit-tested for all four aspect combinations and both mirror states.
 */
import type { Point2 } from "./types";

export interface CoverTransform {
  /** Uniform scale from video pixels to canvas pixels. One number — cover never stretches. */
  readonly scale: number;
  /** Centre-crop offsets in canvas pixels; ≤ 0 on the cropped axis, 0 on the fitted one. */
  readonly offsetX: number;
  readonly offsetY: number;
  readonly videoW: number;
  readonly videoH: number;
  readonly canvasW: number;
  readonly canvasH: number;
  readonly mirrored: boolean;
}

/**
 * Builds the transform for one (video, canvas) pairing.
 *
 * Returns null on degenerate dimensions — a video element before `loadedmetadata` reports 0×0, and
 * silently mapping through that would put every point at the origin.
 */
export function coverTransform(
  videoW: number,
  videoH: number,
  canvasW: number,
  canvasH: number,
  mirrored: boolean,
): CoverTransform | null {
  if (videoW <= 0 || videoH <= 0 || canvasW <= 0 || canvasH <= 0) return null;
  if (!Number.isFinite(videoW) || !Number.isFinite(videoH) || !Number.isFinite(canvasW) || !Number.isFinite(canvasH)) {
    return null;
  }
  // Cover: scale until BOTH axes are filled — the larger of the two ratios.
  const scale = Math.max(canvasW / videoW, canvasH / videoH);
  return {
    scale,
    offsetX: (canvasW - videoW * scale) / 2,
    offsetY: (canvasH - videoH * scale) / 2,
    videoW,
    videoH,
    canvasW,
    canvasH,
    mirrored,
  };
}

/** Maps a point in **video pixels** to canvas pixels, applying the mirror last. */
export function videoPxToCanvas(transform: CoverTransform, point: Point2): Point2 {
  const x = point.x * transform.scale + transform.offsetX;
  const y = point.y * transform.scale + transform.offsetY;
  return { x: transform.mirrored ? transform.canvasW - x : x, y };
}

/** Maps a point in **normalised video space** (0–1, the landmark convention) to canvas pixels. */
export function videoNormToCanvas(transform: CoverTransform, point: Point2): Point2 {
  return videoPxToCanvas(transform, { x: point.x * transform.videoW, y: point.y * transform.videoH });
}

/**
 * One-shot form for callers without a hot loop: normalised video point → canvas pixels.
 *
 * Hot paths (the overlay's rAF loop) should build the transform once per frame with
 * {@link coverTransform} and reuse it instead.
 */
export function videoToCanvas(
  point: Point2,
  videoW: number,
  videoH: number,
  canvasW: number,
  canvasH: number,
  mirrored: boolean,
): Point2 | null {
  const transform = coverTransform(videoW, videoH, canvasW, canvasH, mirrored);
  return transform === null ? null : videoNormToCanvas(transform, point);
}
