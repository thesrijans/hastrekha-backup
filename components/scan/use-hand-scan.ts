"use client";

import type { HandLandmarker } from "@mediapipe/tasks-vision";
import { useCallback, useEffect, useRef, useState } from "react";
import { createHandLandmarker, MissingScanAssetError, toObservation } from "@/lib/scan/landmarks";
import { featuresFromLandmarks, type LandmarkFeatureResult } from "@/lib/scan/features";
import {
  CAPTURE_POSES,
  FUSION_MIN_SCORE,
  gradeFrame,
  landmarkJitter,
  palmSpan,
  segmentationEligible,
  SPAN_HISTORY_FRAMES,
  type PoseProfile,
} from "@/lib/scan/quality";
import { canonicalAnchors, palmAnchors, rectifyPalm, solveHomography, type RectifyResult } from "@/lib/scan/rectify";
import { derivePalmEdge } from "@/lib/scan/landmarks";
import { emptyStabiliser, resetStabiliser, stabiliseAnchors, type AnchorStabiliser } from "@/lib/scan/stabilise";
import {
  emptyTelemetry,
  formatTelemetry,
  publish as publishTelemetry,
  record as recordStage,
  type ScanTelemetry,
  type TelemetryStage,
} from "@/lib/scan/telemetry";
import {
  addPose,
  applyPhotometric,
  emptyPhotometric,
  photometricField,
  photometricWeight,
  resetPhotometric,
  type PhotometricState,
} from "@/lib/scan/photometric";
import { normaliseIllumination } from "@/lib/scan/illumination";
import { palmTilt } from "@/lib/scan/quality";
import { createOnnxSegmenter } from "@/lib/scan/segmenter-onnx";
import type { SegmenterDiagnostics } from "@/lib/scan/segmenter";
import type { Segmenter } from "@/lib/scan/segmenter";
import {
  alignFusion,
  emptyFusion,
  fuse,
  markHandSeen,
  maskApplies,
  resetFusion,
  shouldReset,
  type AlignOutcome,
  type FusionState,
} from "@/lib/scan/fusion";
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
import {
  ACTIVE_LINE_IDS,
  MASK_SIZE,
  type FrameStats,
  type Handedness,
  type HandObservation,
  type Landmark3,
  type QualityVerdict,
} from "@/lib/scan/types";

export type ScanStatus = "idle" | "starting" | "running" | "denied" | "unsupported" | "error";

/** Feature/rule cadence. Landmarks run at camera rate; everything downstream is throttled. */
const FEATURE_INTERVAL_MS = 160;
/** Rectification is ~65k bilinear samples, so it runs far below frame rate. */
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
  facingReadout: null,
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
  readonly onFeatures?: (result: LandmarkFeatureResult, quality: number) => void;
  /** Called for every frame that fails the gate, so the latch can decay. */
  readonly onGateFail?: (nowMs: number) => void;
  /**
   * Called whenever an extraction produces lines — on ANY frame with a hand, gate or no gate.
   *
   * Line evidence previously never reached the rules engine during a scan at all: it was computed
   * once at the end, from the merged capture masks. So the reading the user was shown building had
   * nothing in it about their actual lines, and the final reading contained rules they had never
   * seen. This is the feed that closes that gap.
   */
  readonly onLineFeatures?: (extraction: LineExtraction, nowMs: number) => void;
  /** Called once the last guided pose is captured. */
  readonly onCaptureComplete?: (capture: CaptureState) => void;
}

export function useHandScan(options: UseHandScanOptions = {}) {
  const { onFeatures, onGateFail, onLineFeatures, onCaptureComplete } = options;
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
  // Sized to the resolution the worker actually returns — see MASK_SIZE. A mismatch here makes
  // `fuse()` return early and SILENTLY, which is exactly how the overlay went blank once before.
  const fusionRef = useRef<FusionState>(emptyFusion(MASK_SIZE));
  /**
   * Landmark jitter slides the same skin a few crop pixels between frames — more than a crease is
   * wide — which is what smears the accumulated mask into an unthinnable band. Filtering the anchors
   * is the only place that can be fixed; everything downstream inherits a stable crop.
   */
  const stabiliserRef = useRef<AnchorStabiliser>(emptyStabiliser());
  /**
   * Multi-pose photometric evidence. A crease is a groove, so its shading swings as the palm tilts
   * while flat skin's does not — evidence no single-frame detector can produce. It accumulates only
   * at capture commits, and earns its weight from the tilt span actually observed.
   */
  const photometricRef = useRef<PhotometricState>(emptyPhotometric(MASK_SIZE));
  const photometricFieldRef = useRef<Float32Array | null>(null);
  const photometricWeightRef = useRef(0);
  const captureRef = useRef<CaptureState>(emptyCapture());
  const lastPoseRef = useRef<string | null>(null);
  const lastRectifiedRef = useRef<ImageData | null>(null);
  const videoSizeRef = useRef<{ width: number; height: number } | null>(null);
  /** Latest frame state, kept in refs so `exportFrame` does not re-create itself every tick. */
  const latestRef = useRef<{
    observation: HandObservation | null;
    quality: QualityVerdict;
    anchorsUsed: number;
  }>({ observation: null, quality: IDLE_QUALITY, anchorsUsed: 0 });
  /**
   * Fusion generation counter, bumped on every reset (pose commit, pose change, hand loss, restart).
   * An in-flight inference captures the epoch when it is fired; if the world has moved on by the
   * time the worker answers, the stale mask is discarded instead of SEEDING the next pose's clean
   * average at full weight (fuse() blends the first frame at 1.0).
   */
  const fusionEpochRef = useRef(0);
  /**
   * Wall clock of the last extraction that actually produced a trace, and of the gate-pass that
   * started the current attempt. Together they drive the overlay's decay fade and the debug HUD's
   * time-to-first-trace, which is the number this whole step is being judged on.
   */
  const traceEvidenceAtRef = useRef(0);
  const scanStartedAtRef = useRef(0);

  const [status, setStatus] = useState<ScanStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [quality, setQuality] = useState<QualityVerdict>(IDLE_QUALITY);
  const [observation, setObservation] = useState<HandObservation | null>(null);
  const [features, setFeatures] = useState<LandmarkFeatureResult | null>(null);
  const [rectified, setRectified] = useState<RectifyResult | null>(null);
  const [stats, setStats] = useState<FrameStats>({ luma: 0, clipped: 0 });
  const [fps, setFps] = useState(0);
  const [backend, setBackend] = useState("loading");
  /** Segmenter startup + failure trail, mirrored from the worker so the debug HUD can show it. */
  const [diagnostics, setDiagnostics] = useState<SegmenterDiagnostics | null>(null);
  /** Milliseconds from scan start to the first frame that produced a drawable trace. Null until then. */
  const [timeToFirstTraceMs, setTimeToFirstTraceMs] = useState<number | null>(null);
  /** How long the current traces have gone without fresh evidence — the overlay fades on this. */
  const [traceEvidenceAtMs, setTraceEvidenceAtMs] = useState(0);
  /** False while the overlay is showing raw fragments because completion named nothing this pass. */
  const [tracesNamed, setTracesNamed] = useState(true);
  /**
   * Per-stage frame counts over a rolling window. The first zero is the bug — that is the whole
   * contract, and it exists because this pipeline has twice gone blank for a reason no stage-level
   * test could see. Written from the loop, published to React once a second.
   */
  const telemetryRef = useRef<ScanTelemetry>(emptyTelemetry());
  const [telemetry, setTelemetry] = useState<Readonly<Record<TelemetryStage, number>>>(
    () => emptyTelemetry().totals,
  );
  /** What the last motion-compensation decision was, and how far the crop moved. For the HUD. */
  const [alignment, setAlignment] = useState<{ outcome: AlignOutcome; displacement: number; warps: number } | null>(null);
  /** Photometric channel state, for the HUD: how many poses it has, and what weight they earned. */
  const [photometric, setPhotometric] = useState<{ samples: number; weight: number; tiltSpan: number } | null>(null);
  const [inferenceMs, setInferenceMs] = useState(0);
  const [fusedConfidence, setFusedConfidence] = useState(0);
  /** The EMA buffer itself, for the debug mask view. Mutated in place; redraws key off confidence. */
  const [fusedField, setFusedField] = useState<Float32Array | null>(null);
  /** Raw per-detector fields from the last inference, for the debug HUD's three-way mask toggle. */
  const [stageMasks, setStageMasks] = useState<{
    unet: Float32Array | null;
    ridge: Float32Array;
    frangi: Float32Array | null;
    median: Float32Array | null;
    photometric: Float32Array | null;
  } | null>(null);
  const [stageTimings, setStageTimings] = useState<Readonly<Record<string, number>> | null>(null);
  /** Intrinsic camera dimensions — the space landmarks are normalised to; the overlay maps through it. */
  const [videoSize, setVideoSize] = useState<{ width: number; height: number } | null>(null);
  const [polys, setPolys] = useState<readonly Poly[]>([]);
  /** Observed/inferred runs per poly, parallel to `polys` — the overlay dims the inferred ones. */
  const [polySegments, setPolySegments] = useState<
    readonly (readonly { readonly from: number; readonly to: number; readonly observed: boolean }[] | undefined)[]
  >([]);
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

    // Publish the intrinsic camera size the first time it is known (and if the track ever changes).
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    if (vw > 0 && vh > 0 && (videoSizeRef.current === null || videoSizeRef.current.width !== vw || videoSizeRef.current.height !== vh)) {
      videoSizeRef.current = { width: vw, height: vh };
      setVideoSize(videoSizeRef.current);
    }

    const now = performance.now();
    recordStage(telemetryRef.current, "framesSeen", now);
    const delta = lastFrameAtRef.current === 0 ? 0 : now - lastFrameAtRef.current;
    if (delta > 0) setFps((previous) => previous * 0.9 + (1000 / delta) * 0.1);
    lastFrameAtRef.current = now;

    try {
      const result = landmarker.detectForVideo(video, now);
      const next = toObservation(result, now);
      if (next !== null) recordStage(telemetryRef.current, "handDetected", now);
      setObservation(next);
      latestRef.current.observation = next;

      const frameStats = sampleLuma(video);
      setStats(frameStats);

      const pose: PoseProfile | null = currentPose(captureRef.current);

      /*
       * A pose change no longer invalidates the fused mask. It is still the same palm, and
       * `alignFusion` maps the old crop onto the new one — throwing the evidence away here was the
       * single largest reason the overlay went blank whenever the guided sequence advanced.
       */
      lastPoseRef.current = pose?.pose ?? "done";

      if (next !== null) fusionRef.current = markHandSeen(fusionRef.current, now, next.handedness);

      if (shouldReset(fusionRef.current, { handPresent: next !== null, handedness: next?.handedness ?? null, nowMs: now })) {
        // The other hand is a different palm; its traces are wrong immediately, not merely stale.
        const otherHand = next !== null && fusionRef.current.handedness !== null && next.handedness !== fusionRef.current.handedness;
        fusionRef.current = { ...resetFusion(fusionRef.current), handedness: next?.handedness ?? null };
        resetStabiliser(stabiliserRef.current);
        if (otherHand) {
          resetPhotometric(photometricRef.current);
          photometricFieldRef.current = null;
          photometricWeightRef.current = 0;
          setPhotometric(null);
        }
        fusionEpochRef.current += 1;
        setFusedConfidence(0);
        if (otherHand) {
          setPolys([]);
          setPolySegments([]);
          setExtraction(null);
          traceEvidenceAtRef.current = 0;
        }
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
      latestRef.current.quality = verdict;

      /*
       * ── Segmentation eligibility — deliberately NOT the rule gate ──────────────────────────
       *
       * Mask segmentation and temporal fusion run on any frame with a confidently-detected hand and
       * a usable rectified crop, whatever the facing/steadiness checks say. Routing them through the
       * hard gate starved the segmenter: the gate demands all eleven checks pass at once, which a
       * real hand does only in bursts, so inference almost never fired and lines never appeared.
       *
       * This is safe because fusion is already evidence-weighted — a slightly tilted palm still
       * contributes valid line pixels — and `alignFusion` keeps the accumulator addressed to the
       * palm it is actually looking at. What stays hard-gated is everything that makes a *claim*:
       * rule latching and capture progress, below.
       */
      if (next !== null && next.score >= FUSION_MIN_SCORE && now - lastRectifyAtRef.current > RECTIFY_INTERVAL_MS) {
        lastRectifyAtRef.current = now;
        const source = frameImageData(video);
        // Five correspondences when the percussion point is in frame, four when it is not.
        const raw = source === null ? null : palmAnchors(next.landmarks, source.width, source.height);
        // Filtered, and with a hysteresis-settled anchor count — see stabilise.ts for both reasons.
        const anchors = raw === null ? null : stabiliseAnchors(stabiliserRef.current, raw.src, now);
        if (source !== null && anchors !== null) {
          latestRef.current.anchorsUsed = anchors.points.length;
          const warped = rectifyPalm(source, anchors.points);
          if (warped !== null) {
            recordStage(telemetryRef.current, "rectifyOk", now);
            telemetryRef.current.anchorsUsed = anchors.points.length;
          }
          // A crop mostly outside the frame carries no palm to segment.
          if (warped !== null && segmentationEligible(next.score, warped.coverage)) {
            lastRectifiedRef.current = warped.image;
            setRectified(warped);

            /*
             * Align BEFORE firing, not after the worker answers, so the accumulator is already in
             * this crop's space when the mask for this crop arrives and the blend is pixel-for-pixel.
             *
             * Hand motion needs no compensation at all — see `alignFusion`. The only thing that does
             * is the four-versus-five anchor convention, and remapping that requires **this frame**
             * solved under the previous convention, never the previous frame's matrix. Re-solving the
             * same anchors without the percussion point is what makes the remap exact instead of
             * re-injecting the motion rectification just removed.
             */
            const convention = anchors.points.length;
            const previousConvention = fusionRef.current.convention;
            const underPrevious =
              previousConvention !== null && previousConvention !== convention
                ? solveHomography(
                    anchors.points.slice(0, previousConvention),
                    canonicalAnchors(previousConvention) ?? [],
                  )
                : null;
            const aligned = alignFusion(fusionRef.current, warped.toCrop, convention, underPrevious);
            fusionRef.current = aligned.state;
            setAlignment({
              outcome: aligned.outcome,
              displacement: aligned.displacement,
              warps: aligned.state.warps,
            });

            recordStage(telemetryRef.current, "cropsSentToWorker", now);
            // Fire and forget: the segmenter drops this frame if one is already in flight.
            const epochAtFire = fusionEpochRef.current;
            const conventionAtFire = convention;
            void segmenterRef.current
              ?.segment(warped.image, { convention, inside: warped.inside })
              .then((mask) => {
              if (mask === null || !runningRef.current) return;
              recordStage(telemetryRef.current, "workerReplies", performance.now());
              let above = 0;
              for (let i = 0; i < mask.all.length; i += 1) if (mask.all[i] > 0.45) above += 1;
              recordStage(telemetryRef.current, "maskPixelsAboveThreshold", performance.now(), above);
              // A reset happened while this inference was in flight — its evidence belongs to the
              // pre-restart world and must not contaminate the fresh average.
              if (epochAtFire !== fusionEpochRef.current) return;
              /*
               * The accumulator moved to a different CROP SPACE while this was in flight — meaning
               * the anchor convention changed and it was remapped — so this mask is addressed to the
               * old one and blending it would misregister the whole field.
               *
               * Deliberately NOT a comparison of the homography itself. Two frames under the same
               * convention are the same space, so a slow inference is late, not wrong. Comparing
               * matrices here discarded every mask on any device where inference outran the rectify
               * tick, which is what blanked the overlay.
               */
              if (!maskApplies(fusionRef.current, conventionAtFire)) return;

              /*
               * The photometric boost is applied here rather than in the worker because it is
               * derived from capture state — which poses have been committed and how far they
               * tilted — that only the main thread holds. It can only ever ADD probability, and only
               * near evidence the real detectors already found.
               */
              const photo = photometricFieldRef.current;
              const photoWeight = photometricWeightRef.current;
              if (photo !== null && photoWeight > 0 && mask.stages !== undefined && photo.length === mask.all.length) {
                applyPhotometric(mask.all, photo, mask.stages.ridge, mask.width, photoWeight);
              }

              const framesBefore = fusionRef.current.frames;
              fusionRef.current = fuse(fusionRef.current, mask, performance.now());
              if (fusionRef.current.frames > framesBefore) {
                recordStage(telemetryRef.current, "fusionFrames", performance.now());
              }
              setFusedConfidence(fusionRef.current.confidence);
              setFusedField(fusionRef.current.ema);
              setStageMasks(
                mask.stages === undefined
                  ? null
                  : { ...mask.stages, photometric: photometricFieldRef.current },
              );
              setStageTimings(mask.timings ?? null);
              setInferenceMs(mask.inferenceMs ?? 0);
              setBackend(mask.backend ?? segmenterRef.current?.backend ?? "wasm");

              const at = performance.now();
              if (at - lastExtractAtRef.current > EXTRACT_INTERVAL_MS) {
                lastExtractAtRef.current = at;
                const found = extractLines(fusionRef.current.ema, fusionRef.current.size);
                recordStage(telemetryRef.current, "tracesExtracted", at, found.fragments.length);
                recordStage(telemetryRef.current, "polylinesAfterCompletion", at, found.polys.length);
                /*
                 * An empty extraction is a momentary miss, not news. Publishing it would clear the
                 * overlay for the ~0.4s until the next one succeeds, which reads as the lines
                 * blinking — the exact symptom this step exists to remove. Traces are replaced only
                 * by better traces; when evidence genuinely stops, the overlay fades them on
                 * `traceEvidenceAtMs` instead of dropping them at a frame boundary.
                 */
                /*
                 * Completion is all-or-nothing per line, and on a hard frame it can accept none —
                 * which used to mean a blank overlay even though the detector had traced perfectly
                 * real creases. So the raw fragments are the fallback: they ARE detected structure,
                 * they are simply unnamed, and the overlay draws them at reduced weight to say so.
                 * Showing the evidence unlabelled is more honest than showing nothing.
                 */
                const named = found.polys.length > 0;
                const drawable = named ? found.polys : found.fragments;
                if (drawable.length > 0) {
                  // Deliberately outside the gate: a tilted palm shows the same creases, and line
                  // evidence is a measurement rather than a claim about pose quality.
                  if (named) onLineFeatures?.(found, at);
                  setExtraction(found);
                  setPolys(drawable);
                  setPolySegments(
                    named
                      ? ACTIVE_LINE_IDS.flatMap((id) => {
                          const fitted = found.completion.lines[id];
                          return fitted === undefined ? [] : [fitted.segments];
                        })
                      : // Unnamed fragments carry no observed/inferred split — every point was seen.
                        drawable.map(() => undefined),
                  );
                  setTracesNamed(named);
                  recordStage(telemetryRef.current, "polylinesPassedToOverlay", at, drawable.length);
                  traceEvidenceAtRef.current = at;
                  setTraceEvidenceAtMs(at);
                  if (scanStartedAtRef.current > 0) {
                    setTimeToFirstTraceMs((previous) => previous ?? at - scanStartedAtRef.current);
                  }
                }
              }
            });
          }
        }
      }

      /*
       * ── The rule gate — everything below this point makes a claim about the user's palm ──────
       *
       * The hard rule from real-hand testing stands: a frame that fails ANY check contributes no
       * features, no latch progress and no capture progress. Rules latched off a bad frame are read
       * back to the user as fact, so their evidence bar stays high; the mask above only feeds an
       * average that is re-thresholded every time it is used.
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
        if (derived !== null) onFeatures?.(derived, verdict.score);
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

        /*
         * Fold this pose's crop into the photometric accumulator, and republish the channel.
         * The crop is consumed here and never retained per pose: only the running statistics and one
         * reference image live on, which keeps the "no palm image leaves the device" rule intact
         * while still letting the variance be computed across poses.
         */
        const crop = lastRectifiedRef.current;
        if (crop !== null && next !== null) {
          const size = crop.width;
          const luma = new Float32Array(size * size);
          for (let i = 0; i < luma.length; i += 1) {
            const at = i * 4;
            luma[i] = (0.2126 * crop.data[at] + 0.7152 * crop.data[at + 1] + 0.0722 * crop.data[at + 2]) / 255;
          }
          const normalised = new Float32Array(size * size);
          const illumination = normaliseIllumination(luma, size, normalised);
          if (!illumination.bypassed) {
            addPose(photometricRef.current, illumination.out, palmTilt(next.world, mirrored));
            photometricFieldRef.current = photometricField(photometricRef.current);
            photometricWeightRef.current = photometricWeight(photometricRef.current);
            setPhotometric({
              samples: photometricRef.current.samples,
              weight: photometricWeightRef.current,
              tiltSpan: photometricRef.current.maxTilt - photometricRef.current.minTilt,
            });
          }
        }

        // Each pose starts from a clean average; the merged mask is assembled at the end.
        fusionRef.current = resetFusion(fusionRef.current);
        fusionEpochRef.current += 1;
        setFusedConfidence(0);
        if (committed.done) onCaptureComplete?.(committed);
      }
      /*
       * Published once a second, not per frame: this is the one number the debug HUD renders that
       * nothing else would re-render for, and a React update at frame rate on the page that is also
       * decoding video is exactly the cost this instrument is supposed to help avoid.
       */
      if (publishTelemetry(telemetryRef.current, now)) {
        setTelemetry(telemetryRef.current.totals);
        console.debug("[scan]", formatTelemetry(telemetryRef.current.totals));
      }
    } catch (loopError) {
      console.error("[scan] frame failed:", loopError);
    }

    schedule();
  }, [frameImageData, mirrored, onCaptureComplete, onFeatures, onGateFail, onLineFeatures, sampleLuma, schedule]);

  useEffect(() => {
    loopRef.current = tick;
  }, [tick]);

  /*
   * Unmount cleanup. Without this, navigating away from /scan leaves the MediaStream live (camera
   * indicator on), the rAF chain re-arming forever, and the landmarker + worker alive — the
   * teardown was only reachable through the on-screen stop button. Every resource in teardown() is
   * guarded, so StrictMode's mount→cleanup→mount cycle in dev is harmless.
   */
  useEffect(() => teardown, [teardown]);

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
      segmenterRef.current = createOnnxSegmenter({
        // Every load step reports itself, so a missing model or a bad wasm path is visible in the
        // HUD rather than only in a console the user is not looking at.
        onDiagnostics: setDiagnostics,
      });
      setDiagnostics(segmenterRef.current.diagnostics);

      runningRef.current = true;
      scanStartedAtRef.current = performance.now();
      setTimeToFirstTraceMs(null);
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
    videoSizeRef.current = null;
    setVideoSize(null);
  }, [teardown]);

  /**
   * Captures the current RAW video frame plus everything derived from it.
   *
   * Raw and unmirrored on purpose: the mirror is a display concern, and a fixture that had been
   * flipped would not match the landmarks stored beside it. Entirely client-side — the frame goes to
   * a canvas and straight into a Blob download, and nothing is uploaded.
   */
  const exportFrame = useCallback(async (): Promise<{ png: Blob; json: Blob; stamp: string } | null> => {
    const video = videoRef.current;
    if (video === null || video.videoWidth === 0 || video.videoHeight === 0) return null;

    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const context = canvas.getContext("2d");
    if (context === null) return null;
    context.drawImage(video, 0, 0);

    const png = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
    if (png === null) return null;

    const { observation: obs, quality: verdict, anchorsUsed } = latestRef.current;
    const edge = obs === null ? null : derivePalmEdge(obs.landmarks);
    const payload = {
      imageW: video.videoWidth,
      imageH: video.videoHeight,
      mirroredPreview: mirrored,
      handednessLabel: obs?.handedness ?? null,
      handednessScore: obs?.score ?? null,
      landmarks: obs?.landmarks ?? null,
      worldLandmarks: obs?.world ?? null,
      derived:
        edge === null
          ? null
          : {
              p1: edge.p1,
              p2: edge.p2,
              percussionTop: edge.percussionTop,
              edgeAxis: edge.edgeAxis,
              outward: edge.outward,
              peak: edge.peak,
              palmWidth: edge.palmWidth,
            },
      anchorsUsed,
      gateVerdict: verdict,
      capturedAt: new Date().toISOString(),
    };

    return {
      png,
      json: new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }),
      stamp: String(Date.now()),
    };
  }, [mirrored]);

  const restartCapture = useCallback(() => {
    captureRef.current = emptyCapture();
    setCapture(captureRef.current);
    fusionRef.current = resetFusion(fusionRef.current);
    fusionEpochRef.current += 1;
    setFusedConfidence(0);
    setPolys([]);
    setPolySegments([]);
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
    diagnostics,
    inferenceMs,
    timeToFirstTraceMs,
    traceEvidenceAtMs,
    tracesNamed,
    telemetry,
    alignment,
    photometric,
    fusedConfidence,
    fusedField,
    stageMasks,
    stageTimings,
    videoSize,
    polys,
    polySegments,
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
    exportFrame,
  };
}
