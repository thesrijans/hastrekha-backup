"use client";

/**
 * Ground-truth capture harness (sprint Phase 0a, dev-only — see page.tsx for the gate).
 *
 * Runs its own lightweight loop rather than `useHandScan`: the harness needs landmarks + the
 * quality gate + sharpness, and none of the detection pipeline. The stream is requested with a
 * large `ideal` size so the canvas-fallback still grabs at the camera's maximum resolution
 * (see lib/scan/dev/still-capture.ts for why constraints are never switched mid-stream).
 *
 * Capture fires two ways, both recorded identically:
 * - manual "Capture still" button;
 * - auto-trigger when the composite gate (quality.ok AND sharpness.ok) holds for
 *   {@link STABLE_WINDOW_MS} — the pure stable-window logic lives in still-capture.ts and is
 *   unit-tested in test/capture-session.test.ts.
 *
 * Landmark caveat, recorded rather than hidden: landmarks are detected on the preview frame, and
 * the crop anchors are those normalised landmarks scaled to the still's dimensions. For the
 * canvas-fallback path the still IS the preview frame, so this is exact; for ImageCapture photos
 * a sensor-crop aspect difference makes it approximate. `capturePath` is stored per still so the
 * eval set can tell the two apart, and Phase 2's registration QA is where residuals get measured.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { createHandLandmarker, toObservation, MissingScanAssetError } from "@/lib/scan/landmarks";
import {
  assessSharpness,
  gradeFrame,
  landmarkJitter,
  palmSpan,
  CAPTURE_POSES,
  SHARPNESS_MIN_VARIANCE,
  SPAN_HISTORY_FRAMES,
  type QualityInput,
  type SharpnessReading,
} from "@/lib/scan/quality";
import type { Handedness } from "@/lib/scan/types";
import { palmAnchors, rectifyPalm } from "@/lib/scan/rectify";
import { LM } from "@/lib/scan/landmark-index";
import type { HandObservation, Landmark3, QualityVerdict } from "@/lib/scan/types";
import {
  advanceStableWindow,
  captureStill,
  emptyStableWindow,
  findPoseDuplicate,
  poseSignature,
  regradeStill,
  setTorch,
  stillVolOfCrop,
  STABLE_WINDOW_MS,
  STILL_RETRY_MAX,
  STILL_VOL_FLOOR,
  type StableWindowState,
} from "@/lib/scan/dev/still-capture";
import {
  CANONICAL_LABEL_SIZE,
  cropFileName,
  rawFileName,
  sequenceCropName,
  sequenceFrameName,
  SEQUENCE_AMBIENT_POSE_INDEX,
  SEQUENCE_POSE_COUNT,
  SEQUENCE_SCHEMA_VERSION,
  type CaptureStillRecord,
  type SequenceFrameRecord,
  type SequenceManifest,
  type SessionHand,
  type SessionMetadata,
} from "@/lib/scan/dev/session-types";
import { openSessionStore, type SessionStore, type SessionSummary } from "@/lib/scan/dev/session-store";

/** Sharpness is measured on the full-res palm bbox — too heavy for every rAF, cheap at 5Hz. */
const SHARPNESS_INTERVAL_MS = 200;
/** Pad the landmark bbox by this fraction on each side before measuring sharpness. */
const BBOX_PAD_FRACTION = 0.08;
/** The preview is front-camera-mirrored, matching /scan; quality's handedness logic needs to know. */
const MIRRORED = true;

type Status = "idle" | "starting" | "running" | "denied" | "unsupported" | "error";

interface StagedStillView {
  readonly index: number;
  readonly path: string;
  /** Preview VoL at trigger time. */
  readonly sharpness: number;
  /** VoL measured on the STILL's canonical-crop centre (A) - the traceability number. */
  readonly stillVol: number;
  /** Capture attempts this still cost (1 = first try); the final attempt is kept even when soft. */
  readonly attempts: number;
  /** Index of an earlier still this one near-duplicates in pose (B), if any. */
  readonly duplicateOf: number | null;
  readonly auto: boolean;
}

export function CaptureClient() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const landmarkerRef = useRef<Awaited<ReturnType<typeof createHandLandmarker>> | null>(null);
  const rafRef = useRef<number>(0);
  const loopRef = useRef<(() => void) | null>(null);
  const isMountedRef = useRef(false);
  const runningRef = useRef(false);

  const storeRef = useRef<SessionStore | null>(null);
  const sessionRef = useRef<SessionMetadata | null>(null);
  const observationRef = useRef<HandObservation | null>(null);
  const previousLandmarksRef = useRef<readonly Landmark3[] | null>(null);
  const spanHistoryRef = useRef<number[]>([]);
  const stableRef = useRef<StableWindowState>(emptyStableWindow());
  const verdictRef = useRef<QualityVerdict | null>(null);
  const statsRef = useRef<{ luma: number; clipped: number }>({ luma: 0, clipped: 0 });
  const jitterRef = useRef(0);
  const lastTickAtRef = useRef(0);
  const lastSharpnessAtRef = useRef(0);
  const sharpnessRef = useRef<SharpnessReading>({ variance: 0, ok: false });
  const capturingRef = useRef(false);
  const lumaCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const bboxCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const workCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const [hand, setHand] = useState<SessionHand>("right");
  const [verdict, setVerdict] = useState<QualityVerdict | null>(null);
  const [heldMs, setHeldMs] = useState(0);
  const [sharpness, setSharpness] = useState<SharpnessReading>({ variance: 0, ok: false });
  const [session, setSession] = useState<SessionMetadata | null>(null);
  const [sessions, setSessions] = useState<readonly SessionSummary[]>([]);
  const [stills, setStills] = useState<readonly StagedStillView[]>([]);
  const [rejections, setRejections] = useState<readonly string[]>([]);

  /*
   * Torch-sequence mode (measured-reading §2.3): walks the scan's five-pose tilt choreography
   * with the torch on, keeping the sharpest still per pose through the SAME regrade loop, plus
   * one torch-OFF ambient reference at the choreography's "3/5". State the frame loop reads
   * lives in refs; React state mirrors it for the panel.
   */
  const seqActiveRef = useRef(false);
  const seqStepRef = useRef(0);
  const seqAmbientPendingRef = useRef(false);
  const seqBaselineRef = useRef<Handedness | null>(null);
  const seqTorchSupportedRef = useRef(false);
  const torchOnRef = useRef(false);
  const seqFramesRef = useRef<{ record: SequenceFrameRecord; blob: Blob; cropBlob: Blob }[]>([]);
  const [seqActive, setSeqActive] = useState(false);
  const [seqStep, setSeqStep] = useState(0);
  const [seqAmbientPending, setSeqAmbientPending] = useState(false);
  const [torchState, setTorchState] = useState<"off" | "on" | "unsupported">("off");
  const [exportNote, setExportNote] = useState<string | null>(null);

  /* ------------------------------- Measurement ------------------------------- */

  /** 48×48 mean luma + clip fraction — same cheap stats the /scan gate uses. */
  const sampleStats = useCallback((video: HTMLVideoElement): { luma: number; clipped: number } => {
    const SIZE = 48;
    let canvas = lumaCanvasRef.current;
    if (canvas === null) {
      canvas = document.createElement("canvas");
      canvas.width = SIZE;
      canvas.height = SIZE;
      lumaCanvasRef.current = canvas;
    }
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (context === null) return { luma: 0, clipped: 0 };
    context.drawImage(video, 0, 0, SIZE, SIZE);
    const { data } = context.getImageData(0, 0, SIZE, SIZE);
    let total = 0;
    let clipped = 0;
    for (let i = 0; i < SIZE * SIZE; i += 1) {
      const at = i * 4;
      const luma = (0.2126 * data[at] + 0.7152 * data[at + 1] + 0.0722 * data[at + 2]) / 255;
      total += luma;
      if (luma > 0.97) clipped += 1;
    }
    return { luma: total / (SIZE * SIZE), clipped: clipped / (SIZE * SIZE) };
  }, []);

  /** D6: variance of Laplacian on the palm's bounding box at the video's native resolution. */
  const measureSharpness = useCallback((video: HTMLVideoElement, landmarks: readonly Landmark3[]): SharpnessReading => {
    const width = video.videoWidth;
    const height = video.videoHeight;
    if (width === 0 || height === 0) return { variance: 0, ok: false };
    let minX = 1;
    let minY = 1;
    let maxX = 0;
    let maxY = 0;
    for (const l of landmarks) {
      minX = Math.min(minX, l.x);
      minY = Math.min(minY, l.y);
      maxX = Math.max(maxX, l.x);
      maxY = Math.max(maxY, l.y);
    }
    const sx = Math.max(0, Math.floor((minX - BBOX_PAD_FRACTION) * width));
    const sy = Math.max(0, Math.floor((minY - BBOX_PAD_FRACTION) * height));
    const sw = Math.min(width - sx, Math.ceil((maxX - minX + 2 * BBOX_PAD_FRACTION) * width));
    const sh = Math.min(height - sy, Math.ceil((maxY - minY + 2 * BBOX_PAD_FRACTION) * height));
    if (sw < 3 || sh < 3) return { variance: 0, ok: false };
    let canvas = bboxCanvasRef.current;
    if (canvas === null) {
      canvas = document.createElement("canvas");
      bboxCanvasRef.current = canvas;
    }
    if (canvas.width !== sw || canvas.height !== sh) {
      canvas.width = sw;
      canvas.height = sh;
    }
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (context === null) return { variance: 0, ok: false };
    context.drawImage(video, sx, sy, sw, sh, 0, 0, sw, sh);
    const { data } = context.getImageData(0, 0, sw, sh);
    const luma = new Float32Array(sw * sh);
    for (let i = 0; i < luma.length; i += 1) {
      const at = i * 4;
      luma[i] = 0.2126 * data[at] + 0.7152 * data[at + 1] + 0.0722 * data[at + 2];
    }
    return assessSharpness(luma, sw, sh);
  }, []);

  /* ----------------------- Torch sequence (§2.3) ----------------------- */

  /** Fold one accepted still into the sequence and advance the choreography. */
  const recordSequenceFrame = useCallback(
    async (
      still: { blob: Blob; width: number; height: number; trackSettings: Readonly<Record<string, string | number | boolean>> },
      cropBlob: Blob,
      homography: readonly number[],
      stillVol: number,
      attempts: number,
    ): Promise<void> => {
      const observation = observationRef.current;
      if (observation === null) return;
      const isAmbient = seqAmbientPendingRef.current;
      const order = seqFramesRef.current.length;
      const poseIndex = seqStepRef.current;
      const record: SequenceFrameRecord = {
        order,
        poseIndex,
        pose: CAPTURE_POSES[poseIndex].pose,
        torch: isAmbient ? false : torchOnRef.current,
        file: sequenceFrameName(order),
        cropFile: sequenceCropName(order),
        homography: Array.from(homography),
        landmarks: observation.landmarks,
        width: still.width,
        height: still.height,
        stillVol: Number(stillVol.toFixed(1)),
        attempts,
        trackSettings: still.trackSettings,
        capturedAt: new Date().toISOString(),
      };
      seqFramesRef.current.push({ record, blob: still.blob, cropBlob });

      const track = streamRef.current?.getVideoTracks()[0];
      if (isAmbient) {
        // Ambient reference in the can — torch back on (where it exists) and move to the next pose.
        seqAmbientPendingRef.current = false;
        setSeqAmbientPending(false);
        if (seqTorchSupportedRef.current && track !== undefined) {
          torchOnRef.current = await setTorch(track, true);
          setTorchState(torchOnRef.current ? "on" : "unsupported");
        }
        advanceSequence();
      } else if (poseIndex === SEQUENCE_AMBIENT_POSE_INDEX) {
        // §2.3's ambient-subtraction reference: same pose, torch off, one more still.
        seqAmbientPendingRef.current = true;
        setSeqAmbientPending(true);
        if (seqTorchSupportedRef.current && track !== undefined) {
          await setTorch(track, false);
          torchOnRef.current = false;
          setTorchState("off");
        }
      } else {
        advanceSequence();
      }
    },
    // advanceSequence is a stable callback defined below; the linter sees it via the deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const advanceSequence = useCallback((): void => {
    const next = seqStepRef.current + 1;
    if (next < SEQUENCE_POSE_COUNT) {
      seqStepRef.current = next;
      setSeqStep(next);
      return;
    }
    void finishSequence();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const finishSequence = useCallback(async (): Promise<void> => {
    const store = storeRef.current;
    const current = sessionRef.current;
    seqActiveRef.current = false;
    setSeqActive(false);
    const track = streamRef.current?.getVideoTracks()[0];
    if (track !== undefined) void setTorch(track, false);
    torchOnRef.current = false;
    if (store === null || current === null) return;
    const frames = seqFramesRef.current;
    const ambientFrameIndex = frames.findIndex((f) => !f.record.torch && f.record.poseIndex === SEQUENCE_AMBIENT_POSE_INDEX);
    const manifest: SequenceManifest = {
      schemaVersion: SEQUENCE_SCHEMA_VERSION,
      sessionId: current.sessionId,
      sequenceIndex: current.sequences?.length ?? 0,
      hand: current.hand,
      torchSupported: seqTorchSupportedRef.current,
      frames: frames.map((f) => f.record),
      ambientFrameIndex,
      createdAt: new Date().toISOString(),
    };
    try {
      const updated = await store.addSequence(
        current,
        manifest,
        frames.map((f) => ({ file: f.record.file, blob: f.blob, cropFile: f.record.cropFile, cropBlob: f.cropBlob })),
      );
      sessionRef.current = updated;
      if (isMountedRef.current) {
        setSession(updated);
        setExportNote(`sequence ${manifest.sequenceIndex} staged — ${frames.length} frames (${manifest.torchSupported ? "torch" : "ambient-only"})`);
      }
    } catch (sequenceError) {
      if (isMountedRef.current) setError(sequenceError instanceof Error ? sequenceError.message : "sequence staging failed");
    } finally {
      seqFramesRef.current = [];
    }
  }, []);

  const startSequence = useCallback(async (): Promise<void> => {
    const stream = streamRef.current;
    const observation = observationRef.current;
    if (stream === null || sessionRef.current === null) return;
    const track = stream.getVideoTracks()[0];
    const torchOk = await setTorch(track, true);
    seqTorchSupportedRef.current = torchOk;
    torchOnRef.current = torchOk;
    setTorchState(torchOk ? "on" : "unsupported");
    seqBaselineRef.current = observation?.handedness ?? null;
    seqFramesRef.current = [];
    seqStepRef.current = 0;
    seqAmbientPendingRef.current = false;
    setSeqStep(0);
    setSeqAmbientPending(false);
    seqActiveRef.current = true;
    setSeqActive(true);
  }, []);

  const cancelSequence = useCallback((): void => {
    seqActiveRef.current = false;
    seqAmbientPendingRef.current = false;
    seqFramesRef.current = [];
    setSeqActive(false);
    setSeqAmbientPending(false);
    const track = streamRef.current?.getVideoTracks()[0];
    if (track !== undefined) void setTorch(track, false);
    torchOnRef.current = false;
    setTorchState("off");
  }, []);

  /* --------------------------------- Capture --------------------------------- */

  const captureNow = useCallback(
    async (auto: boolean): Promise<void> => {
      const video = videoRef.current;
      const stream = streamRef.current;
      const store = storeRef.current;
      const current = sessionRef.current;
      const observation = observationRef.current;
      if (video === null || stream === null || store === null || current === null || observation === null) return;
      if (capturingRef.current) return;
      capturingRef.current = true;
      try {
        const track = stream.getVideoTracks()[0];

        // A: regrade the STILL, not the preview - discard and re-shoot below the floor, up to
        // STILL_RETRY_MAX attempts; every attempt is logged and every rejection counted.
        let attempt = 0;
        let still: Awaited<ReturnType<typeof captureStill>>;
        let source: ImageData;
        let anchorSet: NonNullable<ReturnType<typeof palmAnchors>>;
        let rectified: NonNullable<ReturnType<typeof rectifyPalm>>;
        let stillVol = 0;
        for (;;) {
          attempt += 1;
          still = await captureStill(track, video);

        // Decode the still and rectify a canonical crop at labeling resolution (D3: 512).
          const bitmap = await createImageBitmap(still.blob);
          let work = workCanvasRef.current;
          if (work === null) {
            work = document.createElement("canvas");
            workCanvasRef.current = work;
          }
          if (work.width !== bitmap.width || work.height !== bitmap.height) {
            work.width = bitmap.width;
            work.height = bitmap.height;
          }
          const context = work.getContext("2d", { willReadFrequently: true });
          if (context === null) throw new Error("2d context unavailable");
          context.drawImage(bitmap, 0, 0);
          bitmap.close();
          source = context.getImageData(0, 0, still.width, still.height);

          const latest = observationRef.current ?? observation;
          const anchorsNow = palmAnchors(latest.landmarks, still.width, still.height);
          if (anchorsNow === null) throw new Error("anchors unavailable — hand moved out during capture");
          anchorSet = anchorsNow;
          const warped = rectifyPalm(source, anchorSet.src, CANONICAL_LABEL_SIZE);
          if (warped === null) throw new Error("rectification failed on the still");
          rectified = warped;

          stillVol = stillVolOfCrop(rectified.image);
          const decision = regradeStill(stillVol, attempt);
          if (decision.accept) break;
          const rejectedSession = await store.recordStillRejection(sessionRef.current ?? current);
          sessionRef.current = rejectedSession;
          if (isMountedRef.current) {
            setSession(rejectedSession);
            setRejections((prev) => [
              ...prev,
              "attempt " + attempt + "/" + STILL_RETRY_MAX + " rejected - still VoL " + stillVol.toFixed(0) + " < " + STILL_VOL_FLOOR,
            ]);
          }
        }

        // Sequence mode: the accepted still becomes a sequence frame, not a session still.
        if (seqActiveRef.current) {
          const cropCanvasSeq = document.createElement("canvas");
          cropCanvasSeq.width = CANONICAL_LABEL_SIZE;
          cropCanvasSeq.height = CANONICAL_LABEL_SIZE;
          const cropContextSeq = cropCanvasSeq.getContext("2d");
          if (cropContextSeq === null) throw new Error("2d context unavailable");
          cropContextSeq.putImageData(rectified.image, 0, 0);
          const cropBlobSeq = await new Promise<Blob>((resolve, reject) => {
            cropCanvasSeq.toBlob((b) => (b !== null ? resolve(b) : reject(new Error("toBlob null"))), "image/png");
          });
          await recordSequenceFrame(still, cropBlobSeq, rectified.toCrop, stillVol, attempt);
          return;
        }

        // B: pose-diversity guard - mark (never block) near-duplicate poses in this session.
        const priorSignatures = (sessionRef.current ?? current).stills
          .filter((s) => s.width === still.width)
          .map((s) => ({ index: s.index, signature: poseSignature(s.anchors) }));
        const duplicateOf = findPoseDuplicate(
          priorSignatures,
          poseSignature(anchorSet.src.map((p) => [p.x, p.y] as const)),
          still.width,
        );

        const cropCanvas = document.createElement("canvas");
        cropCanvas.width = CANONICAL_LABEL_SIZE;
        cropCanvas.height = CANONICAL_LABEL_SIZE;
        const cropContext = cropCanvas.getContext("2d");
        if (cropContext === null) throw new Error("2d context unavailable");
        cropContext.putImageData(rectified.image, 0, 0);
        const cropBlob = await new Promise<Blob>((resolve, reject) => {
          cropCanvas.toBlob((b) => (b !== null ? resolve(b) : reject(new Error("toBlob null"))), "image/png");
        });

        const grade = verdictRef.current;
        const sharp = sharpnessRef.current;
        const index = (sessionRef.current ?? current).stills.length;
        const chordDx = observation.landmarks[LM.PINKY_MCP].x - observation.landmarks[LM.INDEX_MCP].x;
        const chordDy = observation.landmarks[LM.PINKY_MCP].y - observation.landmarks[LM.INDEX_MCP].y;
        const record: CaptureStillRecord = {
          index,
          rawFile: rawFileName(index),
          cropFile: cropFileName(index),
          capturePath: still.path,
          width: still.width,
          height: still.height,
          landmarks: observation.landmarks,
          anchors: anchorSet.src.map((p) => [Number(p.x.toFixed(2)), Number(p.y.toFixed(2))] as const),
          quality: {
            score: grade?.score ?? 0,
            ok: grade?.ok ?? false,
            issues: grade?.issues ?? [],
            luma: statsRef.current.luma,
            clipped: statsRef.current.clipped,
            jitter: jitterRef.current,
            sharpness: sharp.variance,
          },
          poseAngle: {
            rollDeg: Number(((Math.atan2(chordDy, chordDx) * 180) / Math.PI).toFixed(1)),
            windingStrength: grade?.facingReadout?.windingStrength ?? null,
          },
          trackSettings: still.trackSettings,
          capturedAt: new Date().toISOString(),
          stillVol: Number(stillVol.toFixed(1)),
          attempts: attempt,
          ...(duplicateOf !== null ? { duplicateOf } : {}),
        };

        const updated = await store.addStill(sessionRef.current ?? current, record, still.blob, cropBlob);
        sessionRef.current = updated;
        if (isMountedRef.current) {
          setSession(updated);
          setStills((prev) => [
            ...prev,
            { index, path: still.path, sharpness: sharp.variance, stillVol, attempts: attempt, duplicateOf, auto },
          ]);
        }
      } catch (captureError) {
        if (isMountedRef.current) {
          setError(captureError instanceof Error ? captureError.message : "capture failed");
        }
      } finally {
        capturingRef.current = false;
      }
    },
    [recordSequenceFrame],
  );

  /* -------------------------------- Frame loop -------------------------------- */

  /** Re-arm via a ref, as use-hand-scan does — a rAF loop cannot close over itself. */
  const schedule = useCallback((): void => {
    rafRef.current = requestAnimationFrame(() => loopRef.current?.());
  }, []);

  const tick = useCallback((): void => {
    const video = videoRef.current;
    const landmarker = landmarkerRef.current;
    if (!runningRef.current || video === null || landmarker === null) return;
    const now = performance.now();
    const delta = lastTickAtRef.current === 0 ? 0 : now - lastTickAtRef.current;
    lastTickAtRef.current = now;

    if (video.readyState >= 2) {
      const result = landmarker.detectForVideo(video, now);
      const observation = toObservation(result, now);
      observationRef.current = observation;

      let grade: QualityVerdict;
      if (observation === null) {
        grade = gradeFrame(null);
        previousLandmarksRef.current = null;
      } else {
        const jitter = landmarkJitter(previousLandmarksRef.current, observation.landmarks);
        previousLandmarksRef.current = observation.landmarks;
        jitterRef.current = jitter;
        const history = spanHistoryRef.current;
        history.push(palmSpan(observation.landmarks));
        if (history.length > SPAN_HISTORY_FRAMES) history.shift();
        const stats = sampleStats(video);
        statsRef.current = stats;
        const input: QualityInput = {
          landmarks: observation.landmarks,
          world: observation.world,
          handedness: observation.handedness,
          mirrored: MIRRORED,
          stats,
          jitter,
          score: observation.score,
          spanHistory: history,
          // Sequence mode gates each still on its choreography pose — the same profiles /scan uses.
          ...(seqActiveRef.current
            ? { pose: CAPTURE_POSES[seqStepRef.current], baselineHandedness: seqBaselineRef.current }
            : {}),
        };
        grade = gradeFrame(input);

        if (now - lastSharpnessAtRef.current > SHARPNESS_INTERVAL_MS) {
          lastSharpnessAtRef.current = now;
          const reading = measureSharpness(video, observation.landmarks);
          sharpnessRef.current = reading;
          if (isMountedRef.current) setSharpness(reading);
        }
      }
      verdictRef.current = grade;
      if (isMountedRef.current) setVerdict(grade);

      // Auto-trigger: quality gate AND sharpness must hold together for the whole window (D6).
      const gateOk = grade.ok && sharpnessRef.current.ok && sessionRef.current !== null && !capturingRef.current;
      const advanced = advanceStableWindow(stableRef.current, gateOk, delta);
      stableRef.current = advanced.state;
      if (isMountedRef.current) setHeldMs(advanced.state.heldMs);
      if (advanced.trigger) void captureNow(true);
    }

    schedule();
  }, [captureNow, measureSharpness, sampleStats, schedule]);

  useEffect(() => {
    loopRef.current = tick;
  }, [tick]);

  /* ------------------------------ Start / teardown ------------------------------ */

  const teardown = useCallback((): void => {
    runningRef.current = false;
    cancelAnimationFrame(rafRef.current);
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    landmarkerRef.current?.close();
    landmarkerRef.current = null;
  }, []);

  const start = useCallback(async (): Promise<void> => {
    if (typeof navigator === "undefined" || navigator.mediaDevices?.getUserMedia === undefined) {
      setStatus("unsupported");
      return;
    }
    setStatus("starting");
    setError(null);
    try {
      // Large ideals: the camera clamps to its max, so the canvas-fallback grab is already full-res.
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: { ideal: 4096 }, height: { ideal: 2160 } },
        audio: false,
      });
      streamRef.current = stream;
      const video = videoRef.current;
      if (video === null) throw new Error("video element not mounted");
      video.srcObject = stream;
      await video.play();
      landmarkerRef.current = await createHandLandmarker();
      runningRef.current = true;
      lastTickAtRef.current = 0;
      setStatus("running");
      schedule();
    } catch (startError) {
      teardown();
      if (startError instanceof MissingScanAssetError) {
        setStatus("error");
        setError(startError.message);
      } else if (startError instanceof DOMException && startError.name === "NotAllowedError") {
        setStatus("denied");
      } else {
        setStatus("error");
        setError(startError instanceof Error ? startError.message : "camera start failed");
      }
    }
  }, [schedule, teardown]);

  useEffect(() => {
    isMountedRef.current = true;
    void (async () => {
      const store = await openSessionStore();
      storeRef.current = store;
      if (isMountedRef.current) setSessions(await store.listSessions());
    })();
    return () => {
      isMountedRef.current = false;
      teardown();
    };
  }, [teardown]);

  /* --------------------------------- Sessions --------------------------------- */

  const newSession = useCallback(async (): Promise<void> => {
    const store = storeRef.current;
    if (store === null) return;
    const created = await store.createSession(hand, CANONICAL_LABEL_SIZE);
    sessionRef.current = created;
    if (isMountedRef.current) {
      setSession(created);
      setStills([]);
      setRejections([]);
      setSessions(await store.listSessions());
      setExportNote(null);
    }
  }, [hand]);

  const exportSession = useCallback(async (sessionId: string): Promise<void> => {
    const store = storeRef.current;
    if (store === null) return;
    setExportNote("Export chal raha hai…");
    try {
      let dir = await store.storedExportDirectory();
      if (dir === null) dir = await store.pickExportDirectory();
      if (dir === null) {
        setExportNote("File System Access API is browser mein nahi hai — Chrome/Edge use karo.");
        return;
      }
      const files = await store.exportSession(sessionId, dir);
      setExportNote(`Saved — ${files} files + metadata.json (recommended root: C:\\Projects\\hastrekha-lab\\captures\\)`);
    } catch (exportError) {
      setExportNote(exportError instanceof Error ? exportError.message : "export failed");
    }
  }, []);

  /* ----------------------------------- View ----------------------------------- */

  const checks = verdict?.checks ?? null;

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-5xl flex-col gap-6 px-4 py-8">
      <header className="flex flex-col gap-1">
        <h1 className="font-display text-2xl text-ink">Capture harness</h1>
        <p className="text-sm text-muted">
          Dev-only. Ground truth ke liye full-res stills — raw frames sirf is machine par, export lab
          folder mein (D5).
        </p>
      </header>

      <section className="grid gap-6 md:grid-cols-[1.2fr_1fr]">
        <div className="flex flex-col gap-3">
          {/* The preview is mirrored like /scan so the hand moves the way the user expects. */}
          <video
            ref={videoRef}
            playsInline
            muted
            aria-label="Camera preview for palm capture"
            className="w-full -scale-x-100 rounded-2xl border border-hairline bg-black"
          />
          <div className="flex flex-wrap items-center gap-3">
            {status !== "running" ? (
              <button
                type="button"
                onClick={() => void start()}
                className="rounded-full border border-hairline px-4 py-2 text-sm text-ink transition-colors hover:border-mount-glow hover:text-mount-glow"
              >
                {status === "starting" ? "Camera shuru ho raha hai…" : "Start camera"}
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => void captureNow(false)}
              disabled={status !== "running" || session === null}
              className="rounded-full border border-hairline px-4 py-2 text-sm text-ink transition-colors hover:border-mount-glow hover:text-mount-glow disabled:opacity-40"
            >
              Capture still
            </button>
            <span aria-live="polite" className="text-xs text-muted">
              {status === "denied" ? "Camera permission deny hui." : null}
              {status === "unsupported" ? "Is browser mein camera access nahi hai." : null}
              {error !== null ? error : null}
            </span>
          </div>
        </div>

        <div className="flex flex-col gap-4">
          {/* Gate readout: every quality check + D6 sharpness, live. */}
          <section aria-label="Gate readout" className="rounded-2xl border border-hairline p-4">
            <h2 className="font-display text-xs uppercase tracking-[0.18em] text-muted">Gate</h2>
            <p aria-live="polite" className="mt-1 text-sm text-ink">
              {verdict?.hint ?? "Camera band hai."}
            </p>
            <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
              {checks !== null
                ? Object.entries(checks).map(([name, pass]) => (
                    <div key={name} className="flex justify-between">
                      <dt className="text-muted">{name}</dt>
                      <dd className={pass ? "text-mount-glow" : "text-line-glow"}>{pass ? "pass" : "fail"}</dd>
                    </div>
                  ))
                : null}
              <div className="flex justify-between">
                <dt className="text-muted">sharpness (VoL)</dt>
                <dd className={sharpness.ok ? "text-mount-glow" : "text-line-glow"}>
                  {sharpness.variance.toFixed(0)} / {SHARPNESS_MIN_VARIANCE}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted">stable hold</dt>
                <dd className="tabular-nums text-ink">
                  {Math.min(heldMs, STABLE_WINDOW_MS).toFixed(0)} / {STABLE_WINDOW_MS} ms
                </dd>
              </div>
            </dl>
          </section>

          {/* Session controls. */}
          <section aria-label="Session" className="flex flex-col gap-3 rounded-2xl border border-hairline p-4">
            <div role="radiogroup" aria-label="Hand side" className="flex items-center gap-3 text-sm">
              {(["left", "right"] as const).map((side) => (
                <label key={side} className="flex items-center gap-1.5 text-ink">
                  <input
                    type="radio"
                    name="hand"
                    value={side}
                    checked={hand === side}
                    onChange={() => setHand(side)}
                  />
                  {side === "left" ? "Left haath" : "Right haath"}
                </label>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => void newSession()}
                className="rounded-full border border-hairline px-4 py-2 text-sm text-ink transition-colors hover:border-mount-glow hover:text-mount-glow"
              >
                New session
              </button>
              {session !== null ? (
                <span className="text-xs text-muted">
                  {session.sessionId} · {session.stills.length} stills
                  {(session.rejectedStills ?? 0) > 0 ? " · " + String(session.rejectedStills) + " rejected" : ""}
                </span>
              ) : (
                <span className="text-xs text-muted">Koi session nahi — pehle New session.</span>
              )}
            </div>
            {stills.length > 0 ? (
              <ul aria-label="Captured stills" className="flex flex-col gap-1 text-xs text-muted">
                {stills.map((still) => (
                  <li
                    key={still.index}
                    className={still.duplicateOf !== null ? "tabular-nums opacity-40" : "tabular-nums"}
                  >
                    #{still.index} · {still.path} · preview VoL {still.sharpness.toFixed(0)} · still VoL{" "}
                    {still.stillVol.toFixed(0)}
                    {still.stillVol < STILL_VOL_FLOOR ? " (soft)" : ""} · {still.attempts} attempt
                    {still.attempts > 1 ? "s" : ""} · {still.auto ? "auto" : "manual"}
                    {still.duplicateOf !== null ? " · duplicate of #" + String(still.duplicateOf) : ""}
                  </li>
                ))}
              </ul>
            ) : null}
            {rejections.length > 0 ? (
              <ul aria-label="Rejected attempts" className="flex flex-col gap-1 text-xs text-line-glow">
                {rejections.map((line, i) => (
                  <li key={i} className="tabular-nums">
                    {line}
                  </li>
                ))}
              </ul>
            ) : null}
          </section>

          {/* Torch sequence (measured-reading §2.3). */}
          <section aria-label="Torch sequence" className="flex flex-col gap-2 rounded-2xl border border-hairline p-4">
            <h2 className="font-display text-xs uppercase tracking-[0.18em] text-muted">Sequence (torch)</h2>
            {!seqActive ? (
              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={() => void startSequence()}
                  disabled={status !== "running" || session === null}
                  className="rounded-full border border-hairline px-4 py-2 text-sm text-ink transition-colors hover:border-mount-glow hover:text-mount-glow disabled:opacity-40"
                >
                  Sequence shuru karo
                </button>
                <span className="text-xs text-muted">
                  Kamra dim karo — 5 poses torch ke saath + 1 ambient reference.
                </span>
              </div>
            ) : (
              <div className="flex flex-col gap-2 text-xs">
                <p aria-live="polite" className="text-sm text-ink">
                  {seqAmbientPending
                    ? `Ambient reference — torch OFF, pose ${SEQUENCE_AMBIENT_POSE_INDEX + 1} hold karo`
                    : `Pose ${seqStep + 1}/${SEQUENCE_POSE_COUNT} · ${CAPTURE_POSES[seqStep].label} — ${CAPTURE_POSES[seqStep].instruction}`}
                </p>
                <p className={torchState === "unsupported" ? "text-line-glow" : "text-muted"}>
                  torch:{" "}
                  {torchState === "on"
                    ? "on"
                    : torchState === "unsupported"
                      ? "unsupported — is camera par torch nahi; frames ambient-only record honge"
                      : "off (ambient reference)"}
                  {" "}· frames {seqFramesRef.current.length}
                </p>
                <button
                  type="button"
                  onClick={cancelSequence}
                  className="w-fit rounded-full border border-hairline px-3 py-1 text-xs text-ink transition-colors hover:border-line-glow hover:text-line-glow"
                >
                  Cancel sequence
                </button>
              </div>
            )}
            {session !== null && (session.sequences?.length ?? 0) > 0 ? (
              <ul aria-label="Staged sequences" className="flex flex-col gap-1 text-xs text-muted">
                {(session.sequences ?? []).map((seq) => (
                  <li key={seq.sequenceIndex} className="tabular-nums">
                    seq-{seq.sequenceIndex} · {seq.frames.length} frames ·{" "}
                    {seq.torchSupported ? "torch" : "ambient-only"}
                  </li>
                ))}
              </ul>
            ) : null}
          </section>

          {/* Staged sessions + export. */}
          <section aria-label="Staged sessions" className="flex flex-col gap-2 rounded-2xl border border-hairline p-4">
            <h2 className="font-display text-xs uppercase tracking-[0.18em] text-muted">Staged sessions</h2>
            {sessions.length === 0 ? <p className="text-xs text-muted">Kuch staged nahi.</p> : null}
            <ul className="flex flex-col gap-2">
              {sessions.map((summary) => (
                <li key={summary.sessionId} className="flex flex-wrap items-center justify-between gap-2 text-xs">
                  <span className="text-ink">
                    {summary.sessionId} · {summary.hand} · {summary.stillCount} stills
                  </span>
                  <button
                    type="button"
                    onClick={() => void exportSession(summary.sessionId)}
                    className="rounded-full border border-hairline px-3 py-1 text-xs text-ink transition-colors hover:border-mount-glow hover:text-mount-glow"
                  >
                    Export
                  </button>
                </li>
              ))}
            </ul>
            <span aria-live="polite" className="text-xs text-muted">
              {exportNote}
            </span>
          </section>
        </div>
      </section>
    </main>
  );
}
