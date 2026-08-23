"use client";

import type { HandLandmarker } from "@mediapipe/tasks-vision";
import { useCallback, useEffect, useRef, useState } from "react";
import { createHandLandmarker, MissingScanAssetError, toObservation } from "@/lib/scan/landmarks";
import { featuresFromLandmarks, type LandmarkFeatureResult } from "@/lib/scan/features";
import { gradeFrame, landmarkJitter } from "@/lib/scan/quality";
import { palmQuad, rectifyPalm, type RectifyResult } from "@/lib/scan/rectify";
import { createNoopSegmenter } from "@/lib/scan/segmenter";
import type { FrameStats, HandObservation, Landmark3, QualityVerdict } from "@/lib/scan/types";

export type ScanStatus = "idle" | "starting" | "running" | "denied" | "unsupported" | "error";

/** Feature/rule cadence. Landmarks run at camera rate; everything downstream is throttled. */
const FEATURE_INTERVAL_MS = 160;
/** Rectification is ~65k bilinear samples, so it runs far below frame rate and only on good frames. */
const RECTIFY_INTERVAL_MS = 260;
/** Luma is sampled from a tiny downscale — reading a full frame back every tick would stall the loop. */
const LUMA_SIZE = 48;

const IDLE_QUALITY: QualityVerdict = { ok: false, issues: ["no_hand"], hint: "Camera chalu karo", score: 0 };

export interface UseHandScanOptions {
  /** Front camera is the natural pose for reading your own palm, and it needs a mirrored preview. */
  readonly mirrored?: boolean;
  readonly facingMode?: "user" | "environment";
  /**
   * Called from the frame loop each time features are recomputed.
   *
   * This is the seam the live ticker folds into: it fires from a rAF callback rather than an effect,
   * so accumulating state off it costs no extra render pass.
   */
  readonly onFeatures?: (result: LandmarkFeatureResult) => void;
}

/**
 * Owns the camera, the landmark loop and everything derived from a frame.
 *
 * Deliberately started by an explicit `start()` rather than on mount: camera permission should follow
 * a user gesture, and it keeps a heavyweight side effect out of render.
 *
 * Nothing here uploads anything. Frames live in a canvas that is never read by any network call.
 */
export function useHandScan(options: UseHandScanOptions = {}) {
  const { onFeatures } = options;
  const mirrored = options.mirrored ?? true;
  const facingMode = options.facingMode ?? "user";

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const landmarkerRef = useRef<HandLandmarker | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const frameCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const lumaCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const previousLandmarksRef = useRef<readonly Landmark3[] | null>(null);
  const lastFeatureAtRef = useRef(0);
  const lastRectifyAtRef = useRef(0);
  const lastFrameAtRef = useRef(0);
  const runningRef = useRef(false);
  /**
   * The loop schedules `requestAnimationFrame` through this rather than naming itself, which would be
   * a self-referencing `useCallback`. It also means a re-created `tick` is picked up on the next frame
   * instead of the loop running a stale closure forever.
   */
  const loopRef = useRef<(() => void) | null>(null);

  /** Stable for the lifetime of the hook, and readable during render — unlike a ref. */
  const [segmenter] = useState(createNoopSegmenter);

  const [status, setStatus] = useState<ScanStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [quality, setQuality] = useState<QualityVerdict>(IDLE_QUALITY);
  const [observation, setObservation] = useState<HandObservation | null>(null);
  const [features, setFeatures] = useState<LandmarkFeatureResult | null>(null);
  const [rectified, setRectified] = useState<RectifyResult | null>(null);
  const [stats, setStats] = useState<FrameStats>({ luma: 0, clipped: 0 });
  const [fps, setFps] = useState(0);

  /** Callback ref: writing `.current` from here is an event, not a render-phase mutation. */
  const setVideoElement = useCallback((node: HTMLVideoElement | null) => {
    videoRef.current = node;
  }, []);

  const teardown = useCallback(() => {
    runningRef.current = false;
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    landmarkerRef.current?.close();
    landmarkerRef.current = null;
    segmenter.dispose();
    previousLandmarksRef.current = null;
  }, [segmenter]);

  /** Mean luma and clipping from a tiny downscale of the frame. */
  const sampleLuma = useCallback((video: HTMLVideoElement): FrameStats => {
    let canvas = lumaCanvasRef.current;
    if (canvas === null) {
      canvas = document.createElement("canvas");
      canvas.width = LUMA_SIZE;
      canvas.height = LUMA_SIZE;
      lumaCanvasRef.current = canvas;
    }
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (context === null) return { luma: 0, clipped: 0 };
    context.drawImage(video, 0, 0, LUMA_SIZE, LUMA_SIZE);
    const { data } = context.getImageData(0, 0, LUMA_SIZE, LUMA_SIZE);

    let total = 0;
    let clipped = 0;
    const pixels = LUMA_SIZE * LUMA_SIZE;
    for (let i = 0; i < pixels; i += 1) {
      const at = i * 4;
      const luma = (0.2126 * data[at] + 0.7152 * data[at + 1] + 0.0722 * data[at + 2]) / 255;
      total += luma;
      if (luma > 0.97) clipped += 1;
    }
    return { luma: total / pixels, clipped: clipped / pixels };
  }, []);

  const frameImageData = useCallback((video: HTMLVideoElement): ImageData | null => {
    const width = video.videoWidth;
    const height = video.videoHeight;
    if (width === 0 || height === 0) return null;
    let canvas = frameCanvasRef.current;
    if (canvas === null) {
      canvas = document.createElement("canvas");
      frameCanvasRef.current = canvas;
    }
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (context === null) return null;
    context.drawImage(video, 0, 0, width, height);
    return context.getImageData(0, 0, width, height);
  }, []);

  const schedule = useCallback(() => {
    rafRef.current = requestAnimationFrame(() => loopRef.current?.());
  }, []);

  const tick = useCallback(() => {
    if (!runningRef.current) return;
    const video = videoRef.current;
    const landmarker = landmarkerRef.current;

    if (video === null || landmarker === null || video.readyState < 2) {
      schedule();
      return;
    }

    const now = performance.now();
    if (lastFrameAtRef.current > 0) {
      const delta = now - lastFrameAtRef.current;
      if (delta > 0) setFps((previous) => previous * 0.9 + (1000 / delta) * 0.1);
    }
    lastFrameAtRef.current = now;

    try {
      const result = landmarker.detectForVideo(video, now);
      const next = toObservation(result, now);
      setObservation(next);

      const frameStats = sampleLuma(video);
      setStats(frameStats);

      if (next === null) {
        previousLandmarksRef.current = null;
        setQuality(gradeFrame(null));
      } else {
        const jitter = landmarkJitter(previousLandmarksRef.current, next.landmarks);
        previousLandmarksRef.current = next.landmarks;

        const verdict = gradeFrame({
          landmarks: next.landmarks,
          world: next.world,
          handedness: next.handedness,
          mirrored,
          stats: frameStats,
          jitter,
        });
        setQuality(verdict);

        if (now - lastFeatureAtRef.current > FEATURE_INTERVAL_MS) {
          lastFeatureAtRef.current = now;
          const derived = featuresFromLandmarks(next.world, {
            quality: verdict.score,
            linesAvailable: segmenter.ready,
          });
          setFeatures(derived);
          if (derived !== null) onFeatures?.(derived);
        }

        // Only rectify frames worth keeping — a blurred or edge-on crop poisons the segmenter later.
        if (verdict.ok && now - lastRectifyAtRef.current > RECTIFY_INTERVAL_MS) {
          lastRectifyAtRef.current = now;
          const source = frameImageData(video);
          const quad = source === null ? null : palmQuad(next.landmarks, source.width, source.height);
          if (source !== null && quad !== null) {
            const warped = rectifyPalm(source, quad);
            if (warped !== null) setRectified(warped);
          }
        }
      }
    } catch (loopError) {
      console.error("[scan] frame failed:", loopError);
    }

    schedule();
  }, [frameImageData, mirrored, onFeatures, sampleLuma, schedule, segmenter]);

  // Keeps the running loop pointed at the newest closure without restarting it.
  useEffect(() => {
    loopRef.current = tick;
  }, [tick]);

  const start = useCallback(async () => {
    if (runningRef.current) return;
    setError(null);

    if (typeof navigator === "undefined" || navigator.mediaDevices?.getUserMedia === undefined) {
      setStatus("unsupported");
      setError("Is browser mein camera access nahi hai.");
      return;
    }

    setStatus("starting");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode, width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
      streamRef.current = stream;

      const video = videoRef.current;
      if (video === null) throw new Error("video element not mounted");
      video.srcObject = stream;
      await video.play();

      landmarkerRef.current = await createHandLandmarker();
      runningRef.current = true;
      setStatus("running");
      schedule();
    } catch (startError) {
      teardown();
      if (startError instanceof MissingScanAssetError) {
        setStatus("error");
        setError(startError.message);
        return;
      }
      if (
        startError instanceof DOMException &&
        (startError.name === "NotAllowedError" || startError.name === "SecurityError")
      ) {
        setStatus("denied");
        setError("Camera ki ijazat nahi mili. Browser settings se allow karo.");
        return;
      }
      console.error("[scan] start failed:", startError);
      setStatus("error");
      setError("Camera shuru nahi ho paya.");
    }
  }, [facingMode, schedule, teardown]);

  const stop = useCallback(() => {
    teardown();
    setStatus("idle");
    setObservation(null);
    setQuality(IDLE_QUALITY);
    setFps(0);
  }, [teardown]);

  useEffect(() => teardown, [teardown]);

  return {
    status,
    error,
    quality,
    observation,
    features,
    rectified,
    stats,
    fps,
    segmenterId: segmenter.id,
    mirrored,
    setVideoElement,
    start,
    stop,
  };
}
