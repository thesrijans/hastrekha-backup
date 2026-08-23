"use client";

import type { HandLandmarker } from "@mediapipe/tasks-vision";
import { useCallback, useEffect, useRef, useState } from "react";
import { createHandLandmarker, MissingScanAssetError, toObservation } from "@/lib/scan/landmarks";
import { featuresFromLandmarks, type LandmarkFeatureResult } from "@/lib/scan/features";
import {
  CAPTURE_POSES,
  gradeFrame,
  landmarkJitter,
  palmSpan,
  SPAN_HISTORY_FRAMES,
  type PoseProfile,
} from "@/lib/scan/quality";
import { palmAnchors, rectifyPalm, type RectifyResult } from "@/lib/scan/rectify";
import { createOnnxSegmenter } from "@/lib/scan/segmenter-onnx";
import type { Segmenter } from "@/lib/scan/segmenter";
import { emptyFusion, fuse, resetFusion, shouldReset, type FusionState } from "@/lib/scan/fusion";
import { extractLines, type LineExtraction, type Poly } from "@/lib/scan/lines";
import {
  commitCapture,
  currentPose,
  emptyCapture,
  poseProgressOf,
  progressOf,
  readyToCapture,
  tickCapture,
  type CaptureState,
} from "@/lib/scan/capture";
import type { FrameStats, Handedness, HandObservation, Landmark3, QualityVerdict } from "@/lib/scan/types";

export type ScanStatus = "idle" | "starting" | "running" | "denied" | "unsupported" | "error";

/** Feature/rule cadence. Landmarks run at camera rate; everything downstream is throttled. */
const FEATURE_INTERVAL_MS = 160;
/** Rectification is ~65k bilinear samples, so it runs far below frame rate and only on good frames. */
const RECTIFY_INTERVAL_MS = 200;
/** Thinning + tracing is the most expensive CPU step; it does not need to keep up with inference. */
const EXTRACT_INTERVAL_MS = 700;
/** Luma is sampled from a tiny downscale — reading a full frame back every tick would stall the loop. */
const LUMA_SIZE = 48;
/** Clamp on the frame delta fed to the capture clock, so a backgrounded tab cannot auto-capture. */
const MAX_FRAME_DELTA_MS = 120;

const IDLE_QUALITY: QualityVerdict = {
  ok: false,
  issues: ["no_hand"],
  hint: "Camera chalu karo",
  score: 0,
  checks: {} as QualityVerdict["checks"],
};

export interface UseHandScanOptions {
  /** Front camera is the natural pose for reading your own palm, and it needs a mirrored preview. */
  readonly mirrored?: boolean;
  readonly facingMode?: "user" | "environment";
  /**
   * Called from the frame loop **only for frames that pass the gate**, each time features are
   * recomputed. Firing on a failing frame is what previously let rules confirm off the back of a
   * hand, so the filter lives here rather than at the call site.
   */
  readonly onFeatures?: (result: LandmarkFeatureResult) => void;
  /** Called for every frame that fails the gate, so the latch can decay. */
  readonly onGateFail?: (nowMs: number) => void;
  /** Called once the last guided pose is captured. */
  readonly onCaptureComplete?: (capture: CaptureState) => void;
}

export function useHandScan(options: UseHandScanOptions = {}) {
  const { onFeatures, onGateFail, onCaptureComplete } = options;
  const mirrored = options.mirrored ?? true;
  const facingMode = options.facingMode ?? "user";

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const landmarkerRef = useRef<HandLandmarker | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const frameCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const lumaCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const previousLandmarksRef = useRef<readonly Landmark3[] | null>(null);
  const spanHistoryRef = useRef<number[]>([]);
  const baselineHandRef = useRef<Handedness | null>(null);
  const lastFeatureAtRef = useRef(0);
  const lastRectifyAtRef = useRef(0);
  const lastExtractAtRef = useRef(0);
  const lastFrameAtRef = useRef(0);
  const runningRef = useRef(false);
  const loopRef = useRef<(() => void) | null>(null);
  const segmenterRef = useRef<Segmenter | null>(null);
  const fusionRef = useRef<FusionState>(emptyFusion());
  const captureRef = useRef<CaptureState>(emptyCapture());
  const lastPoseRef = useRef<string | null>(null);
  const lastRectifiedRef = useRef<ImageData | null>(null);

  const [status, setStatus] = useState<ScanStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [quality, setQuality] = useState<QualityVerdict>(IDLE_QUALITY);
  const [observation, setObservation] = useState<HandObservation | null>(null);
  const [features, setFeatures] = useState<LandmarkFeatureResult | null>(null);
  const [rectified, setRectified] = useState<RectifyResult | null>(null);
  const [stats, setStats] = useState<FrameStats>({ luma: 0, clipped: 0 });
  const [fps, setFps] = useState(0);
  const [backend, setBackend] = useState("loading");
  const [inferenceMs, setInferenceMs] = useState(0);
  const [fusedConfidence, setFusedConfidence] = useState(0);
  /** The EMA buffer itself, for the debug mask view. Mutated in place; redraws key off confidence. */
  const [fusedField, setFusedField] = useState<Float32Array | null>(null);
  const [polys, setPolys] = useState<readonly Poly[]>([]);
  const [extraction, setExtraction] = useState<LineExtraction | null>(null);
  const [capture, setCapture] = useState<CaptureState>(emptyCapture);

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
    segmenterRef.current?.dispose();
    segmenterRef.current = null;
    previousLandmarksRef.current = null;
    spanHistoryRef.current = [];
  }, []);

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
    const delta = lastFrameAtRef.current === 0 ? 0 : now - lastFrameAtRef.current;
    if (delta > 0) setFps((previous) => previous * 0.9 + (1000 / delta) * 0.1);
    lastFrameAtRef.current = now;

    try {
      const result = landmarker.detectForVideo(video, now);
      const next = toObservation(result, now);
      setObservation(next);

      const frameStats = sampleLuma(video);
      setStats(frameStats);

      const pose: PoseProfile | null = currentPose(captureRef.current);

      // A pose change invalidates the fused mask — a tilted palm rectifies to different pixels.
      const poseKey = pose?.pose ?? "done";
      const poseChanged = lastPoseRef.current !== null && lastPoseRef.current !== poseKey;
      lastPoseRef.current = poseKey;

      if (shouldReset(fusionRef.current, { handPresent: next !== null, poseChanged, nowMs: now })) {
        fusionRef.current = resetFusion(fusionRef.current);
        setFusedConfidence(0);
        setPolys([]);
      }

      let verdict: QualityVerdict;
      if (next === null) {
        previousLandmarksRef.current = null;
        spanHistoryRef.current = [];
        verdict = gradeFrame(null);
      } else {
        if (baselineHandRef.current === null) baselineHandRef.current = next.handedness;

        const jitter = landmarkJitter(previousLandmarksRef.current, next.landmarks);
        previousLandmarksRef.current = next.landmarks;

        const history = spanHistoryRef.current;
        history.push(palmSpan(next.landmarks));
        if (history.length > SPAN_HISTORY_FRAMES) history.shift();

        verdict = gradeFrame({
          landmarks: next.landmarks,
          world: next.world,
          handedness: next.handedness,
          mirrored,
          stats: frameStats,
          jitter,
          score: next.score,
          spanHistory: history,
          pose: pose ?? undefined,
          baselineHandedness: baselineHandRef.current,
        });
      }
      setQuality(verdict);

      /*
       * The hard rule from real-hand testing: a frame that fails ANY check contributes nothing.
       * No features, no latch progress, no mask fusion, no capture progress. Everything downstream
       * of this branch is gated on `verdict.ok`.
       */
      const nextCapture = tickCapture(captureRef.current, verdict.ok, Math.min(MAX_FRAME_DELTA_MS, delta));
      if (nextCapture !== captureRef.current) {
        captureRef.current = nextCapture;
        setCapture(nextCapture);
      }

      if (!verdict.ok || next === null) {
        onGateFail?.(now);
        schedule();
        return;
      }

      if (now - lastFeatureAtRef.current > FEATURE_INTERVAL_MS) {
        lastFeatureAtRef.current = now;
        const derived = featuresFromLandmarks(next.world, {
          quality: verdict.score,
          linesAvailable: fusionRef.current.frames > 0,
        });
        setFeatures(derived);
        if (derived !== null) onFeatures?.(derived);
      }

      if (now - lastRectifyAtRef.current > RECTIFY_INTERVAL_MS) {
        lastRectifyAtRef.current = now;
        const source = frameImageData(video);
        // Five correspondences when the percussion point is in frame, four when it is not.
        const anchors = source === null ? null : palmAnchors(next.landmarks, source.width, source.height);
        if (source !== null && anchors !== null) {
          const warped = rectifyPalm(source, anchors.src);
          if (warped !== null) {
            lastRectifiedRef.current = warped.image;
            setRectified(warped);

            // Fire and forget: the segmenter drops this frame if one is already in flight.
            void segmenterRef.current?.segment(warped.image).then((mask) => {
              if (mask === null || !runningRef.current) return;
              fusionRef.current = fuse(fusionRef.current, mask, performance.now());
              setFusedConfidence(fusionRef.current.confidence);
              setFusedField(fusionRef.current.ema);
              setInferenceMs(mask.inferenceMs ?? 0);
              setBackend(mask.backend ?? segmenterRef.current?.backend ?? "wasm");

              const at = performance.now();
              if (at - lastExtractAtRef.current > EXTRACT_INTERVAL_MS) {
                lastExtractAtRef.current = at;
                const found = extractLines(fusionRef.current.ema, fusionRef.current.size);
                setExtraction(found);
                setPolys(found.polys);
              }
            });
          }
        }
      }

      if (readyToCapture(captureRef.current) && fusionRef.current.frames > 0) {
        const committed = commitCapture(
          captureRef.current,
          fusionRef.current.ema,
          fusionRef.current.confidence,
          now,
        );
        captureRef.current = committed;
        setCapture(committed);
        // Each pose starts from a clean average; the merged mask is assembled at the end.
        fusionRef.current = resetFusion(fusionRef.current);
        setFusedConfidence(0);
        if (committed.done) onCaptureComplete?.(committed);
      }
    } catch (loopError) {
      console.error("[scan] frame failed:", loopError);
    }

    schedule();
  }, [frameImageData, mirrored, onCaptureComplete, onFeatures, onGateFail, sampleLuma, schedule]);

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
      // Starts loading in the background; scanning proceeds while the model warms up.
      segmenterRef.current = createOnnxSegmenter();

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

  const restartCapture = useCallback(() => {
    captureRef.current = emptyCapture();
    setCapture(captureRef.current);
    fusionRef.current = resetFusion(fusionRef.current);
    setFusedConfidence(0);
    setPolys([]);
    setExtraction(null);
    baselineHandRef.current = null;
  }, []);

  return {
    status,
    error,
    quality,
    observation,
    features,
    rectified,
    stats,
    fps,
    backend,
    inferenceMs,
    fusedConfidence,
    fusedField,
    polys,
    extraction,
    capture,
    pose: currentPose(capture),
    poseProgress: poseProgressOf(capture),
    totalProgress: progressOf(capture),
    poseCount: CAPTURE_POSES.length,
    mirrored,
    setVideoElement,
    start,
    stop,
    restartCapture,
  };
}
