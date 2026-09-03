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
import { scanFlags } from "@/lib/scan/flags";
import { matrixToBuffer, palmQuadToFullHand, solveFullHandHomography, warpFullHand } from "@/lib/scan/fullhand-warp";
import {
  applyPhotometricEvidence,
  mergeBracket,
  photometricEvidence,
  BRACKET_OFFSETS,
  type FlashFrame,
  type FlashQuadrant,
} from "@/lib/scan/illumination-active";
import {
  applyPlan,
  correctExposure,
  creaseContrast,
  emptyCameraControl,
  lumaStats,
  nextExposureBias,
  CONTROL_INTERVAL_MS,
  type CameraControlState,
} from "@/lib/scan/camera-control";
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
import { extractAllTraces, extractLines, type ClassifiedTrace, type LineExtraction, type Poly } from "@/lib/scan/lines";
import { fateDoubleOverride, minorLineFeatures } from "@/lib/scan/minor-lines";
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
  type Point2,
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
/**
 * How long to let the sensor settle after asking for a new exposure.
 *
 * `applyConstraints` resolves when the request is ACCEPTED, not when the sensor has acted on it, and
 * a camera typically takes several frames to walk to a new exposure. Sampling before it arrives puts
 * two nearly-identical frames in the bracket and calls them different exposures — which produces a
 * merge that looks like it worked and contains no more information than one frame did.
 */
const BRACKET_SETTLE_MS = 220;
/** How often a bracket may be taken. It costs three rectify ticks, so not on every one. */
const BRACKET_PERIOD_MS = 4000;

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
   * Every trace found, classified — including the minor creases the four-corridor fit used to drop.
   * Parallel to nothing; the overlay draws these in addition to the named lines, thinner and dimmer.
   */
  const [traces, setTraces] = useState<readonly ClassifiedTrace[]>([]);
  /**
   * Per-stage frame counts over a rolling window. The first zero is the bug — that is the whole
   * contract, and it exists because this pipeline has twice gone blank for a reason no stage-level
   * test could see. Written from the loop, published to React once a second.
   */
  const telemetryRef = useRef<ScanTelemetry>(emptyTelemetry());
  /** Camera-control state. Inert unless the flag is on; see lib/scan/flags.ts for why it is opt-in. */
  const cameraRef = useRef<CameraControlState>(emptyCameraControl());
  const lastControlAtRef = useRef(0);
  const controlBusyRef = useRef(false);
  const [camera, setCamera] = useState<CameraControlState | null>(null);
  /** Mean detector response over the palm interior — the number that says whether any of it helped. */
  const [contrast, setContrast] = useState(0);
  /**
   * The quadrant the flash overlay is currently lighting, or null.
   *
   * Set by the overlay and consumed by the next rectify tick: the sequence needs exactly ONE frame
   * per quadrant, and the frame must be the one the panel was actually lit for. A pull model (the
   * loop takes a frame when it notices a request) is the only way to get that, because the loop is
   * the only thing that knows when a usable rectified crop exists.
   */
  const flashRequestRef = useRef<FlashQuadrant | null>(null);
  const flashFramesRef = useRef<FlashFrame[]>([]);
  /** Evidence from the last completed sequence, applied to masks until the hand moves on. */
  const flashFieldRef = useRef<Float32Array | null>(null);
  /** Merged bracket luma, or null. */
  const bracketFieldRef = useRef<Float32Array | null>(null);
  const bracketRef = useRef<{ step: number; frames: Float32Array[]; startedAtMs: number }>({
    step: -1,
    frames: [],
    startedAtMs: 0,
  });
  const [flashProgress, setFlashProgress] = useState(0);
  const [bracketFrames, setBracketFrames] = useState(0);
  /**
   * The rectification the CURRENT traces were traced in — stabilised anchors in video pixels, and
   * the convention. The overlay projects through this rather than re-deriving from raw landmarks,
   * which measured 4.6 video pixels off the creases the traces came from.
   */
  const [projection, setProjection] = useState<{ anchors: readonly Point2[]; convention: number } | null>(null);
  /**
   * The rectification of the CURRENT frame — refreshed every rectify tick, not every trace update.
   *
   * The overlay projects through this rather than through {@link projection}'s frozen anchors. Both
   * describe the same canonical space, which is motion-compensated: the same skin lands on the same
   * crop pixel however the hand moves. So the traces stay correct under either matrix — but only the
   * live one keeps them *glued* to the hand. The frozen anchors are captured when traces are
   * re-extracted, which runs at the classical stride rather than per frame, so drawing through them
   * pins the traces to where the hand was up to several frames ago and they visibly lag a moving
   * palm.
   *
   * A ref, not state: the draw loop wants the freshest value at the instant it draws, and a state
   * update per rectify tick would re-render the page that owns the video element for a number no
   * React subtree reads.
   *
   * What must still match is the anchor CONVENTION — a 5-anchor crop fitted to five targets is not
   * reproducible from four — which is what the overlay checks against `projection.convention`.
   */
  const liveProjectionRef = useRef<{ anchors: readonly Point2[]; convention: number } | null>(null);
  /**
   * True when landmarks fall outside the frame.
   *
   * MediaPipe still returns 21 points for a clipped hand — it extrapolates the ones it cannot see —
   * and `coverage` does not catch it, because the crop is defined by the palm anchors and those may
   * still be in view while the fingers are not. Measured on a hand pushed a third of a frame off the
   * edge: three landmarks outside, coverage still 1.000. So this is its own check.
   */
  const [degraded, setDegraded] = useState(false);
  const degradedRef = useRef(false);
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
  /** Last client-side full-hand warp cost (flag unetFullHand); merged into the HUD timings row. */
  const fullhandWarpMsRef = useRef(-1);
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

      /*
       * ── Degraded: part of the hand is outside the frame ──────────────────────────────────────
       *
       * MediaPipe returns 21 points whatever it can see; the ones off-screen are extrapolated, and
       * `derivePalmEdge` then builds the percussion anchor out of them. Measured on a hand pushed a
       * third of a frame off the edge: three landmarks outside, and `coverage` still exactly 1.000 —
       * so the segmentation eligibility check cannot catch this, because the crop is defined by the
       * palm anchors and those can still be in view while the fingers are not.
       *
       * Evidence still accumulates, because a partly-clipped palm still shows real creases. What
       * stops is the CLAIM: no line features are emitted while this is true, because a line placed
       * from guessed geometry is worse than no line at all.
       */
      const clipped =
        next !== null && next.landmarks.some((p) => p.x < 0 || p.x > 1 || p.y < 0 || p.y > 1);
      if (clipped !== degradedRef.current) {
        degradedRef.current = clipped;
        setDegraded(clipped);
      }
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
        liveProjectionRef.current =
          anchors === null
            ? null
            : {
                anchors: anchors.points.map((p) => ({ x: p.x, y: p.y })),
                convention: anchors.points.length,
              };
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
             * ── Camera control, entirely opt-in ────────────────────────────────────────────────
             *
             * Nothing in this block runs with the flag off — not the metering, not the loop, not the
             * software fallback. `correctExposure` returns the caller's own array *by identity* in
             * that case, which is the guarantee `test/flags-identity.test.ts` pins by reference
             * rather than by comparing values.
             *
             * The crop is metered rather than the frame, and that is the whole idea: the camera's
             * own metering already sees the entire scene, and it is what got the palm wrong.
             */
            const flags = scanFlags.snapshot();

            /*
             * Serve a pending flash request from THIS crop, before any exposure correction — the
             * photometric comparison is between frames lit differently, so a per-frame gamma applied
             * to some of them and not others would be measuring the correction rather than the light.
             */
            const pending = flashRequestRef.current;
            if (pending !== null && flags.photometric) {
              flashRequestRef.current = null;
              const luma = new Float32Array(MASK_SIZE * MASK_SIZE);
              const step = warped.image.width / MASK_SIZE;
              for (let y = 0; y < MASK_SIZE; y += 1) {
                for (let x = 0; x < MASK_SIZE; x += 1) {
                  const sx = Math.min(warped.image.width - 1, Math.round(x * step));
                  const sy = Math.min(warped.image.height - 1, Math.round(y * step));
                  const at = (sy * warped.image.width + sx) * 4;
                  luma[y * MASK_SIZE + x] =
                    (0.2126 * warped.image.data[at] +
                      0.7152 * warped.image.data[at + 1] +
                      0.0722 * warped.image.data[at + 2]) /
                    255;
                }
              }
              flashFramesRef.current.push({ quadrant: pending, luma });
              setFlashProgress(flashFramesRef.current.length);
            }

            /*
             * ── Exposure bracket ───────────────────────────────────────────────────────────────
             *
             * Gated on the camera having ACCEPTED an exposure constraint, not merely on the flag. On
             * a device where the constraint was refused, the three "different" exposures are the same
             * frame three times: the merge costs two extra rectify ticks and hands back the middle
             * one. Doing nothing and saying so is better than spending the time and calling it HDR.
             *
             * The merged plane is currently produced and measured rather than fed to the detectors.
             * That is deliberate: I have no device here on which `exposureCompensation` is settable,
             * so the settle timing below is reasoned rather than measured, and wiring an unverified
             * capture sequence into the detector input is exactly the kind of change that has taken
             * this pipeline down before. The maths is unit-tested; the timing needs a real camera.
             */
            if (
              flags.hdrBracket &&
              cameraRef.current.applied.includes("exposureCompensation") &&
              !controlBusyRef.current
            ) {
              const bracket = bracketRef.current;
              if (bracket.step < 0) {
                if (now - bracket.startedAtMs > BRACKET_PERIOD_MS) {
                  bracketRef.current = { step: 0, frames: [], startedAtMs: now };
                }
              } else if (now - bracket.startedAtMs > BRACKET_SETTLE_MS) {
                const luma = new Float32Array(MASK_SIZE * MASK_SIZE);
                const stride = warped.image.width / MASK_SIZE;
                for (let y = 0; y < MASK_SIZE; y += 1) {
                  for (let x = 0; x < MASK_SIZE; x += 1) {
                    const sx = Math.min(warped.image.width - 1, Math.round(x * stride));
                    const sy = Math.min(warped.image.height - 1, Math.round(y * stride));
                    const at = (sy * warped.image.width + sx) * 4;
                    luma[y * MASK_SIZE + x] =
                      (0.2126 * warped.image.data[at] +
                        0.7152 * warped.image.data[at + 1] +
                        0.0722 * warped.image.data[at + 2]) /
                      255;
                  }
                }
                bracket.frames.push(luma);
                setBracketFrames(bracket.frames.length);

                const nextStep = bracket.step + 1;
                if (nextStep >= BRACKET_OFFSETS.length) {
                  bracketFieldRef.current = mergeBracket(bracket.frames, MASK_SIZE);
                  bracketRef.current = { step: -1, frames: [], startedAtMs: now };
                } else {
                  bracket.step = nextStep;
                  bracket.startedAtMs = now;
                  const track = streamRef.current?.getVideoTracks()[0];
                  if (track !== undefined) {
                    controlBusyRef.current = true;
                    void applyPlan(
                      track,
                      cameraRef.current,
                      cameraRef.current.bias + BRACKET_OFFSETS[nextStep],
                      now,
                    ).then((state) => {
                      controlBusyRef.current = false;
                      cameraRef.current = state;
                    });
                  }
                }
              }
            }

            let cropData = warped.image.data;
            if (flags.cameraControl) {
              const stats = lumaStats(warped.image.data, warped.inside);
              const corrected = correctExposure(warped.image.data, true, stats);
              cropData = corrected.rgba;

              const track = streamRef.current?.getVideoTracks()[0];
              const due = now - lastControlAtRef.current > CONTROL_INTERVAL_MS;
              if (track !== undefined && due && !controlBusyRef.current) {
                lastControlAtRef.current = now;
                const wanted = nextExposureBias(cameraRef.current.bias, stats);
                /*
                 * One in flight at a time. `applyConstraints` regularly takes longer than the control
                 * interval, and queueing them makes the camera lurch through a backlog of decisions
                 * that were made about frames it has already moved past.
                 */
                controlBusyRef.current = true;
                void applyPlan(track, { ...cameraRef.current, gamma: corrected.gamma }, wanted, now).then(
                  (state) => {
                    controlBusyRef.current = false;
                    cameraRef.current = state;
                    setCamera(state);
                  },
                );
              } else if (corrected.gamma !== cameraRef.current.gamma) {
                cameraRef.current = { ...cameraRef.current, gamma: corrected.gamma };
                setCamera(cameraRef.current);
              }
            }

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
            const anchorsAtFire: readonly Point2[] = anchors.points.map((p) => ({ x: p.x, y: p.y }));
            /*
             * The very same ImageData when uncorrected: with the flag off `cropData` IS
             * `warped.image.data`, so this allocates nothing and the worker receives byte-for-byte
             * what it always received.
             */
            const cropForWorker =
              cropData === warped.image.data
                ? warped.image
                : ({ width: warped.image.width, height: warped.image.height, data: cropData } as ImageData);
            /*
             * Full-hand UNet framing (flag unetFullHand, default off): build the training-shaped
             * 256² warp from the RAW landmarks (no stabiliser — the 21-point solve is its own
             * average) plus the palm-quad→full-hand matrix, and attach both. The crop homography
             * is `warped.toCrop` — the very matrix this crop was rectified through, so the remap
             * is exact by construction. Attached on every accepted crop rather than "UNet frames
             * only": the worker owns the UNet stride (`frameIndex % UNET_STRIDE`, worker-side
             * counter) and the client cannot see it — the worker simply ignores these fields on
             * non-UNet frames. Any null along the way falls back to the unchanged message.
             */
            let fullHand: { rgba: Uint8ClampedArray; pqToFullHand: ArrayBuffer } | undefined;
            if (scanFlags.snapshot().unetFullHand) {
              const tFullhand = performance.now();
              const toCropFullHand = solveFullHandHomography(next.landmarks, source.width, source.height, "fixed");
              const pqToFull = toCropFullHand === null ? null : palmQuadToFullHand(warped.toCrop, toCropFullHand);
              const fullHandImage =
                toCropFullHand === null || pqToFull === null ? null : warpFullHand(source, toCropFullHand);
              if (fullHandImage !== null && pqToFull !== null) {
                fullHand = { rgba: fullHandImage.data, pqToFullHand: matrixToBuffer(pqToFull) };
                fullhandWarpMsRef.current = performance.now() - tFullhand;
              }
            } else {
              fullhandWarpMsRef.current = -1;
            }
            void segmenterRef.current
              ?.segment(cropForWorker, { convention, inside: warped.inside, fullHand })
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

              /*
               * Screen-flash evidence, from the last completed "Gehri scan". Same additive, gated
               * form as the multi-pose channel: it may only raise a probability, and only where the
               * live detectors already saw something. A sequence captured over three quarters of a
               * second has no business originating a line on its own.
               */
              const flash = flashFieldRef.current;
              if (flash !== null && mask.stages !== undefined && flash.length === mask.all.length) {
                applyPhotometricEvidence(mask.all, flash, mask.stages.ridge);
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
              setStageTimings(
                mask.timings === undefined || mask.timings === null
                  ? null
                  : fullhandWarpMsRef.current >= 0
                    ? { ...mask.timings, fullhandWarp: fullhandWarpMsRef.current }
                    : mask.timings,
              );
              // Read-only measurement over a field the worker already produced — it cannot alter the
              // pipeline, which is why it is safe to compute with the flags off and compare against.
              if (mask.stages?.frangi != null) {
                setContrast(creaseContrast(mask.stages.frangi, mask.width));
              }
              setInferenceMs(mask.inferenceMs ?? 0);
              setBackend(mask.backend ?? segmenterRef.current?.backend ?? "wasm");

              const at = performance.now();
              if (at - lastExtractAtRef.current > EXTRACT_INTERVAL_MS) {
                lastExtractAtRef.current = at;
                const vocabV2 = scanFlags.snapshot().featureVocabV2;
                const found = extractLines(fusionRef.current.ema, fusionRef.current.size, vocabV2);
                /*
                 * Everything else on the palm. The four completed lines are the headline, but a
                 * reader looks at the minor creases too, and dropping them was throwing away most of
                 * what the detector had already found. The faint tier is gated on the accumulator’s
                 * own persistence counter, so a shallow trace has to have been there a while.
                 */
                const all = extractAllTraces(
                  fusionRef.current.ema,
                  fusionRef.current.size,
                  fusionRef.current.faintHits,
                  vocabV2, // demotion tracking only feeds the v2 fate-double check
                );
                setTraces(all.traces);
                recordStage(telemetryRef.current, "tracesExtracted", at, all.faintCount);
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
                /*
                 * Minor-line emission (flag emitMinorLines): the classifier's qualifying sun /
                 * health / marriage / bracelet / girdle traces become KB features, deep-merged
                 * into the extraction's bag. featureVocabV2 additionally lets a demoted second
                 * fate claimant override structure to the KB's "double". Both flags off ⇒ the
                 * callback receives `found` untouched, byte for byte.
                 */
                let forFeatures = found;
                if (scanFlags.snapshot().emitMinorLines) {
                  const minor = minorLineFeatures(all, { lifePoly: found.completion.lines.life?.points }, fusionRef.current.size);
                  const baseLines = (found.features.lines ?? {}) as Record<string, unknown>;
                  const baseSigns = (found.features.signs ?? {}) as Record<string, unknown>;
                  const minorLines = (minor.lines ?? {}) as Record<string, unknown>;
                  const minorSigns = (minor.signs ?? {}) as Record<string, unknown>;
                  const mergedLines: Record<string, unknown> = { ...minorLines, ...baseLines };
                  if (vocabV2 && fateDoubleOverride(all)) {
                    mergedLines.fate = { ...(mergedLines.fate as Record<string, unknown> | undefined), structure: "double" };
                  }
                  forFeatures = {
                    ...found,
                    features: {
                      ...found.features,
                      ...(Object.keys(mergedLines).length > 0 ? { lines: mergedLines } : {}),
                      ...(Object.keys(minorSigns).length > 0 ? { signs: { ...minorSigns, ...baseSigns } } : {}),
                    } as typeof found.features,
                  };
                }
                const named = found.polys.length > 0;
                const drawable = named ? found.polys : found.fragments;
                if (drawable.length > 0) {
                  // Deliberately outside the gate: a tilted palm shows the same creases, and line
                  // evidence is a measurement rather than a claim about pose quality.
                  // Refused while the hand is clipped: the crop was fitted to extrapolated
                  // landmarks, so any line placed from it is a claim about guessed geometry.
                  if (named && !degradedRef.current) onLineFeatures?.(forFeatures, at);
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
                  // The rectification these traces were traced in, so the overlay projects consistently.
                  setProjection({ anchors: anchorsAtFire, convention: conventionAtFire });
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
  /**
   * Called by the flash overlay as each quadrant lights.
   *
   * Records a REQUEST rather than grabbing a frame here: this fires from a React effect, and the only
   * place a usable rectified crop exists is inside the frame loop. The loop serves the request on its
   * next rectify tick, which is also the first tick that could have seen the panel.
   */
  const requestFlashFrame = useCallback((quadrant: FlashQuadrant) => {
    flashRequestRef.current = quadrant;
  }, []);

  /** Starts a sequence: clears whatever the last one gathered so the two are never mixed. */
  const beginFlashSequence = useCallback(() => {
    flashFramesRef.current = [];
    flashRequestRef.current = null;
    setFlashProgress(0);
  }, []);

  /**
   * Folds a completed sequence into an evidence field.
   *
   * A short sequence is discarded rather than used: with fewer than three quadrants the
   * direction-consistency term has too few positions to distinguish a groove from a moving shadow,
   * and a channel that cannot tell those apart is worse than no channel.
   */
  const completeFlashSequence = useCallback(() => {
    const frames = flashFramesRef.current;
    flashRequestRef.current = null;
    if (frames.length < 3) {
      flashFieldRef.current = null;
      setFlashProgress(0);
      return { frames: frames.length, meanRange: 0 };
    }
    const result = photometricEvidence(frames, MASK_SIZE);
    flashFieldRef.current = result.field;
    setFlashProgress(frames.length);
    return { frames: result.frames, meanRange: result.meanRange };
  }, []);

  /** Drops flash evidence — the hand has moved on, or the user turned the feature off. */
  const clearFlashEvidence = useCallback(() => {
    flashFieldRef.current = null;
    flashFramesRef.current = [];
    setFlashProgress(0);
  }, []);

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

  /**
   * Lane E (flag `scanDiagnostics`): stage the current frame as a one-still capture session so a
   * bad reading in the wild becomes a labelable eval fixture immediately. The dev module is
   * loaded dynamically behind the flag — the one allowlisted production→dev edge (see
   * test/import-boundary.test.ts); with the flag off nothing is imported and nothing runs.
   */
  const exportEvalCase = useCallback(async (): Promise<string | null> => {
    if (!scanFlags.snapshot().scanDiagnostics) return null;
    const video = videoRef.current;
    if (video === null || video.videoWidth === 0 || video.videoHeight === 0) return null;
    const { observation: obs, quality: verdict } = latestRef.current;
    if (obs === null) return null;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const context = canvas.getContext("2d");
    if (context === null) return null;
    context.drawImage(video, 0, 0);
    const frame = context.getImageData(0, 0, canvas.width, canvas.height);
    const { stageEvalCase } = await import("@/lib/scan/dev/eval-export");
    return stageEvalCase({ frame, observation: obs, quality: verdict });
  }, []);

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
    traces,
    telemetry,
    camera,
    contrast,
    projection,
    liveProjectionRef,
    degraded,
    flashProgress,
    bracketFrames,
    requestFlashFrame,
    beginFlashSequence,
    completeFlashSequence,
    clearFlashEvidence,
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
    exportEvalCase,
  };
}
