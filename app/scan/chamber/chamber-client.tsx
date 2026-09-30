"use client";

/**
 * ============================================================================
 * THE CHAMBER — the scanning ritual, over the same pipeline.
 * ============================================================================
 *
 * A SECOND SURFACE, NOT A REPLACEMENT. `/scan` is untouched and stays live;
 * this route mounts the very same `useHandScan` and draws a different room
 * around it. §10's frame budget covers the drawing this route adds; see
 * lib/sanctuary/frame-cost.ts for how that is measured, and the readout below
 * for where the number comes out.
 *
 * ── THE THREE FLAGS THIS ROUTE, AND ONLY THIS ROUTE, TURNS ON (S1.1) ──
 *
 * rekhaPersist, corridorSearch and superRes (CHAMBER_SCAN_FLAGS): evidence
 * that accumulates across frames and holds a confirmed line, the corridor
 * fill-in that persistence releases, and the super-resolution fusion that feeds
 * it sharper evidence. Switched on in one mount effect and put back on unmount
 * to whatever each was before — /scan keeps its defaults. The pipeline's own
 * per-frame cost grows by the accumulator's (≤ 3 ms, S1.5, printed under
 * `?cost=1`), and the Rekha Monitor draws what it finds.
 *
 * ── WHAT THIS FILE OWNS, AND WHAT IT DELIBERATELY DOES NOT ──
 *
 * It owns the session bookkeeping (fold observations, post the reading, hand
 * off to the pothi) and the phase machine. It owns no drawing, no timing and no
 * copy: the wheel and the constellation are the canvas's, the litany's seven
 * lines are a pure module's, the reveal beat's three and a half seconds are a
 * score, and the failure copy is below only because failure copy is a fact
 * about this route's own states.
 *
 * ── THE PHONE (M1) ──
 *
 * The chamber chooses its camera: the BACK one on a phone, the front one
 * elsewhere, silently the front one where there is no back camera. The reader
 * can flip between them and, where the back camera has one, light its torch;
 * both marks sit at the litany's lower corners, where a thumb reaches. The
 * mirror follows the camera that opened (lib/scan/camera-select.ts). On a
 * MID or LOW device the pipeline runs its lite profile — the lite landmark
 * model, 480p, extraction every 900 ms — and `?cost=1` says which profile ran.
 *
 * ── WHAT IS NOT REBUILT HERE ──
 *
 * No live ticker, no debug HUD, no enhance toasts, no deep-scan flash. Those
 * belong to `/scan`, which is an instrument, and this is a ceremony. The
 * knowledge base is not loaded either: the rules-fired signal comes from the
 * reading the server returns rather than from evaluating 548 rules on-device a
 * second time, which keeps a 106 KB parse out of a route whose budget is 45.
 */

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactElement } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { LandmarkFeatureResult } from "@/lib/scan/features";
import { extractLines } from "@/lib/scan/lines";
import { emptySession, observe, observeLines, sessionBag, type ReadingSession } from "@/lib/scan/reading-session";
import { mergedMask, type CaptureState } from "@/lib/scan/capture";
import { MASK_SIZE, type ActiveLineId, type TracedLine } from "@/lib/scan/types";
import { useHandScan, readTouchSignals } from "@/components/scan/use-hand-scan";
import { useCapabilityTier } from "@/components/sanctuary/use-capability-tier";
import { SanctuaryIcon } from "@/components/sanctuary/sanctuary-icons";
import { scanProfileFor } from "@/lib/scan/scan-profile";
import { browserFamily, flipVisible, isTouchDevice } from "@/lib/scan/camera-select";
import { cameraDeniedDirections, cameraFailureNote } from "@/lib/sanctuary/chamber-camera";
import { encodeCrop, handOffToPothi, rescanPrompt, RESCAN_PARAM } from "@/lib/sanctuary/pothi-handoff";
import {
  chamberCurrentLine,
  raiseChamberSignals,
  CHAMBER_SIGNALS_IDLE,
  type ChamberSignals,
} from "@/lib/sanctuary/chamber-stages";
import { formatFrameCost, withinFrameBudget, type FrameCostSummary } from "@/lib/sanctuary/frame-cost";
import { formatFunnel } from "@/lib/scan/funnel";
import { ChamberCanvas } from "@/components/sanctuary/chamber/chamber-canvas";
import { RekhaMonitor, detectionLedger, rekhaLedger } from "@/components/sanctuary/chamber/rekha-monitor";
import {
  bagWithoutLines,
  BLUR_WORDS,
  blurStalled,
  DETECTION_IDLE,
  DETECTION_LINE_IDS,
  LINE_TICK_SPACING_MS,
  newlyConfirmed,
  nextDetection,
  TORCH_OFFER,
  unclearLines,
  type DetectionState,
} from "@/lib/scan/detection-progress";
import { cropLuma, estimateFreezeShift, FREEZE_WAIT_MS, freezeReady, heldLinesOn, prelabelOf, type FreezeCandidate, type FreezeShift } from "@/lib/scan/freeze-frame";
import { growthStillOf, handOf, openSnapStore, type SnapPair, type SnapStore } from "@/lib/scan/snap-store";
import type { RekhaLine, RekhaSnapshot } from "@/lib/scan/rekha-persist";
import { CompletionLeaf } from "@/components/sanctuary/chamber/completion-leaf";
import { fallbackFreeze, makeSnaps, readSnapPalette, revokeSnaps, type CompletionSnaps } from "@/components/sanctuary/chamber/completion-snaps";
import { CHAMBER_SCAN_FLAGS, withScanFlags } from "@/lib/scan/flags";
import { ScanLitany, type LitanyHint } from "@/components/sanctuary/chamber/scan-litany";
import { haptic } from "@/components/sanctuary/sound-provider";
import { bandTickDue, DISTANCE_WORDS, type DistanceState } from "@/lib/scan/distance";
import { REASON_WORDS, type ReasonKey } from "@/lib/scan/scan-reason";
import { RevealBeat } from "@/components/sanctuary/chamber/reveal-beat";
import { Parchment } from "@/components/sanctuary/material";
import { BuildStamp } from "@/components/sanctuary/shell/build-stamp";
import { BUILD_SHA_SHORT } from "@/lib/build-stamp";
import type { ReadingResponse } from "@/app/read/reading-types";
import styles from "./chamber.module.css";

/**
 * The trace classes that count as a minor line having been READ.
 *
 * `minor_unclassified` is deliberately absent: an unclassified trace is a mark
 * the classifier could not name, and counting it would let the litany report
 * the minor stage as satisfied on evidence the reading itself will not use.
 */
const NAMED_MINOR_CLASSES = new Set(["sun", "health", "marriage", "girdle_of_venus", "bracelets"]);

/** The route's own phases. `scanning` is the long one; the other three are seconds. */
type ChamberPhase = "scanning" | "freezing" | "complete" | "building" | "revealing" | "failed";

/**
 * The reasons that are about WHERE the palm is: while one of these is the top rejection, placing the hand is the
 * instruction, not the blur (G4) — a palm out of frame is not steadied by being told the picture is soft.
 */
const PLACEMENT_REASONS: ReadonlySet<ReasonKey> = new Set<ReasonKey>([
  "no_hand",
  "low_confidence",
  "too_close",
  "out_of_frame_top",
  "out_of_frame_bottom",
  "out_of_frame_left",
  "out_of_frame_right",
  "not_palm_up",
]);

/** A palm unseen this long has left — the blur clock's "present" allows a dropped frame or two. */
const PALM_GRACE_MS = 500;

/** Everything the completion leaf shows and the snap store keeps (G4). */
interface Completion {
  readonly frozen: FreezeCandidate;
  readonly shift: FreezeShift | null;
  readonly snaps: CompletionSnaps;
  readonly pair: SnapPair;
  /** The preview was mirrored when the frame froze: the frozen frame is shown as the reader saw it. */
  readonly mirrored: boolean;
  /** Milliseconds between detection completing and the freeze (the wait for a frame at VoL ≥ 100). */
  readonly waitMs: number;
}

/** A store that never changes — used only for its null server snapshot. See the rescan note below. */
const subscribeToNothing = (): (() => void) => (): void => undefined;

export interface ChamberClientProps {
  /** Where the reading is read. The beat navigates here when the bundle arrives. */
  readonly readHref: string;
  /** Where the back mark returns to. */
  readonly backHref: string;
}

export function ChamberClient({ readHref, backHref }: ChamberClientProps): ReactElement {
  const router = useRouter();
  const sessionRef = useRef<ReadingSession>(emptySession());
  /*
   * S2: the lines the reader was SHOWN — traced (rekhaTrace) and held (rekhaPersist) — kept for the
   * hand-off, so the pothi draws the geometry the chamber drew rather than a fresh fit of the merged
   * capture. Null until anything has been drawn, and then the merged fit is the fallback.
   */
  const drawnRef = useRef<Partial<Record<ActiveLineId, TracedLine>> | null>(null);
  /* scan-complete G3: the detection progress as it stands, read by the reading when it is asked for. */
  const detectionRef = useRef<DetectionState>(DETECTION_IDLE);
  const mountedRef = useRef(true);

  const [phase, setPhase] = useState<ChamberPhase>("scanning");
  const [failure, setFailure] = useState<string | null>(null);
  const [rulesFired, setRulesFired] = useState(0);
  const [leafReady, setLeafReady] = useState(false);
  const [cost, setCost] = useState<FrameCostSummary | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  /* S1.1 — the chamber's flags on for as long as it is mounted, and back as they were after. */
  useEffect(() => withScanFlags(CHAMBER_SCAN_FLAGS), []);

  /*
   * The rescan ask, read through a store with a NULL SERVER SNAPSHOT.
   *
   * The same shape `/scan` uses and for the same reason: a query parameter is
   * client knowledge on a statically rendered route, and a lazy useState
   * initialiser returns null during SSR and the prompt on the hydration render,
   * which React reports as a mismatch and regenerates the subtree to cover.
   */
  const rescanAsk = useSyncExternalStore(
    subscribeToNothing,
    () => rescanPrompt(new URLSearchParams(window.location.search).get(RESCAN_PARAM)),
    () => null,
  );

  /*
   * M1.5: which browser's words to use when the camera is refused. Client knowledge, read through a
   * store with a null server snapshot for the same reason the rescan ask is.
   */
  const browser = useSyncExternalStore(
    subscribeToNothing,
    () => browserFamily(navigator.userAgent, navigator.maxTouchPoints ?? 0),
    () => null,
  );

  /* F1: a held, touched device — the flip is always offered on one. Client knowledge, read like the browser. */
  const touch = useSyncExternalStore(subscribeToNothing, () => isTouchDevice(readTouchSignals()), () => false);

  /*
   * M1.4: the device's capability tier decides the pipeline profile. It is settled (~170 ms after
   * mount) long before the reader presses the gate, and the hook holds whatever profile was current
   * when the camera opened for the rest of the session.
   */
  const capabilityTier = useCapabilityTier();
  const profile = scanProfileFor(capabilityTier);

  /** The frame-cost readout, shown only when it is asked for. See the note at its render site. */
  const showCost = useSyncExternalStore(
    subscribeToNothing,
    () => new URLSearchParams(window.location.search).get("cost") === "1",
    () => false,
  );

  /* ----------------------------- the session ----------------------------- */

  const onFeatures = useCallback((result: LandmarkFeatureResult, quality: number) => {
    const { session } = observe(sessionRef.current, result.features as Record<string, unknown>, {
      source: "landmark",
      nowMs: performance.now(),
      confidence: quality,
    });
    sessionRef.current = session;
  }, []);

  const onLineFeatures = useCallback((extraction: { features: unknown; completion: unknown }, nowMs: number) => {
    const { session } = observeLines(
      sessionRef.current,
      extraction.features as Record<string, unknown>,
      extraction.completion as Parameters<typeof observeLines>[2],
      "line",
      nowMs,
    );
    sessionRef.current = session;
  }, []);

  /**
   * The capture finished: merge every pose's mask, post the bag, hand off.
   *
   * The same sequence `/scan` runs, and `MASK_SIZE` is passed to both
   * `mergedMask` and the hand-off for the same reason it is there — the traces
   * are extracted at the working resolution, and a consumer that assumed 256
   * drew every line at a quarter of its span (2db5c39).
   */
  const buildReading = useCallback(
    async (capture: CaptureState, cropImage: ImageData | null) => {
      setPhase("building");
      try {
        const merged = mergedMask(capture, MASK_SIZE);
        const found = extractLines(merged, MASK_SIZE);

        const { session: finalSession } = observeLines(
          sessionRef.current,
          found.features as Record<string, unknown>,
          found.completion,
          "capture",
          performance.now(),
        );
        sessionRef.current = finalSession;

        /*
         * scan-complete G3.2: a line the budget marked "इस हाथ पर स्पष्ट नहीं" leaves the bag and the hand-off, and the pothi seals its
         * chapter saying so: no rule fires on evidence the chamber itself declined to confirm.
         */
        const detection = detectionRef.current;
        const unclear = unclearLines(detection);
        const response = await fetch("/api/reading", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ tier: "free", source: "CAMERA_SCAN", features: bagWithoutLines(sessionBag(finalSession), unclear) }),
        });
        if (!mountedRef.current) return;
        if (!response.ok) {
          setFailure(`Paath nahi ban paya (${response.status}). Thodi der baad dobara.`);
          setPhase("failed");
          return;
        }
        const reading = (await response.json()) as ReadingResponse;
        setRulesFired(reading.rules.length);

        const shown: Partial<Record<string, TracedLine>> = { ...(drawnRef.current ?? found.lines) };
        for (const id of unclear) delete shown[id];
        handOffToPothi({
          reading,
          lines: shown,
          space: MASK_SIZE,
          ...(unclear.length === 0 ? {} : { unclear: { lines: unclear, afterUsableMs: detection.usableMs } }),
          ...(cropImage === null ? {} : { cropDataUrl: encodeCrop(cropImage) ?? undefined }),
          sessionId: reading.readingId ?? `chamber-${Math.round(performance.now())}`,
          capturedAt: new Date().toISOString(),
        });

        if (!mountedRef.current) return;
        setLeafReady(true);
        setPhase("revealing");
      } catch {
        if (!mountedRef.current) return;
        setFailure("Network thoda dagmaga gaya. Dobara koshish karo.");
        setPhase("failed");
      }
    },
    [],
  );

  /* The crop is read at hand-off time through a ref, because reading the hook's
     own object inside the callback would make the callback depend on a value
     that changes every frame. */
  const cropRef = useRef<ImageData | null>(null);
  /*
   * scan-complete G4: the pose choreography completing no longer opens the reading. Detection does — every
   * major line confirmed or marked unclear — and the reader opens it from the completion leaf; the capture's
   * merged masks still go into the reading then, however much of the choreography was done.
   */

  /*
   * DESTRUCTURED, not held as one object, and that is a lint rule with a real
   * point behind it: the hook's result carries `liveProjectionRef`, so reading
   * anything off it during render reads a ref during render. Naming the values
   * separately is also what makes the dependency arrays below say what they
   * actually depend on.
   */
  const {
    status,
    error: cameraError,
    quality,
    observation,
    rekha,
    traceMs,
    rectified,
    extraction,
    traces,
    projection,
    liveProjectionRef,
    totalProgress,
    mirrored,
    videoSize,
    setVideoElement,
    start,
    cameraFacing,
    cameraCount,
    flipCamera,
    torch,
    toggleTorch,
    cameraErrorName,
    activeProfile,
    landmarkMs,
    funnel,
    distanceState,
    distanceRef,
    reason,
    capture,
    stop,
    restartCapture,
    peekFreeze,
    takeFreeze,
    accumulatorGray,
    firstRekhaOfferAt,
  } = useHandScan({ onFeatures, onLineFeatures, cameraSelection: "auto", profile, funnel: showCost });

  /*
   * scan-complete G2: the leaf's one instruction. The SPECIFIC top reason of the last second when something
   * is stopping the scan (G2.3); when nothing is, the distance meter's own words (G2.1) — so the reader is
   * always told either what to fix or that the distance is right, and never a generic "poora haath".
   */
  /*
   * G4: no usable frame for BLUR_STALL_MS with a palm in view is a blurred picture — said so, ahead of the
   * tilt, steadiness and distance words (unless the palm itself is misplaced), with the torch one tap away on
   * a back camera that has one. The rings never sit at 0% in silence.
   */
  const [blur, setBlur] = useState(false);
  const blurShown = status === "running" && phase === "scanning" && blur && (reason === null || !PLACEMENT_REASONS.has(reason));
  const hint: LitanyHint | null =
    status !== "running"
      ? null
      : blurShown
        ? BLUR_WORDS
        : reason !== null
          ? REASON_WORDS[reason]
          : distanceState !== null
            ? DISTANCE_WORDS[distanceState]
            : null;
  const hintAction = blurShown && torch === "off" && cameraFacing === "environment" ? { ...TORCH_OFFER, onPress: () => void toggleTorch() } : null;

  /*
   * scan-complete G3: the detection progress — a ring per line driven by its evidence toward CONFIRMED, the
   * overall percentage, and after the budget the lines this hand does not show clearly
   * (lib/scan/detection-progress.ts). Folded in once per accumulator snapshot; each line newly confirmed
   * earns its ✓ and one haptic tick.
   */
  const [detection, setDetection] = useState<DetectionState>(DETECTION_IDLE);
  const rekhaLatestRef = useRef<RekhaSnapshot | null>(null);
  const foldDetection = useCallback((snapshot: RekhaSnapshot | null, nowMs: number) => {
    const previous = detectionRef.current;
    const next = nextDetection(previous, snapshot, nowMs);
    if (next === previous) return;
    detectionRef.current = next;
    setDetection(next);
    /* One tick per line, spaced: two confirmed together are two ticks, not one. */
    newlyConfirmed(previous, next).forEach((_, index) => {
      if (index === 0) haptic("lineConfirmed");
      else window.setTimeout(() => haptic("lineConfirmed"), index * LINE_TICK_SPACING_MS);
    });
  }, []);
  /*
   * G4: each line's last CONFIRMED geometry on this palm — the snap draws every line the ledger shows ✓, and the
   * hold may have let one go since (lib/scan/freeze-frame.ts heldLinesOn). Cleared with the evidence.
   */
  const confirmedLinesRef = useRef<Partial<Record<ActiveLineId, RekhaLine>>>({});
  useEffect(() => {
    const before = rekhaLatestRef.current;
    if (rekha === null || (before !== null && rekha.frames < before.frames)) confirmedLinesRef.current = {};
    if (rekha !== null) {
      for (const id of DETECTION_LINE_IDS) {
        const line = rekha.lines[id];
        if (line?.state === "confirmed") confirmedLinesRef.current[id] = line;
      }
    }
    rekhaLatestRef.current = rekha;
    foldDetection(rekha, performance.now());
  }, [rekha, foldDetection]);

  /* G4: whether a palm is in view, and since when — the blur clock's "present". */
  const palmSinceRef = useRef<number | null>(null);
  const lastPalmAtRef = useRef<number | null>(null);
  const observationRef = useRef(observation);
  useEffect(() => {
    if (observation === null) return;
    observationRef.current = observation;
    const now = performance.now();
    lastPalmAtRef.current = now;
    palmSinceRef.current ??= now;
  }, [observation]);

  /*
   * G4: a quarter-second clock while scanning, for what no new frame announces: the wall-clock budget
   * (40 s from the first usable frame marks the unconfirmed lines with no frame needed) and the blur stall.
   */
  useEffect(() => {
    if (status !== "running" || phase !== "scanning") {
      palmSinceRef.current = null;
      return;
    }
    const timer = window.setInterval(() => {
      const now = performance.now();
      if (lastPalmAtRef.current === null || now - lastPalmAtRef.current > PALM_GRACE_MS) palmSinceRef.current = null;
      foldDetection(rekhaLatestRef.current, now);
      const stalled = blurStalled(palmSinceRef.current, firstRekhaOfferAt(), detectionRef.current.lastUsableAtMs, now);
      setBlur((was) => (was === stalled ? was : stalled));
    }, 250);
    return () => window.clearInterval(timer);
  }, [status, phase, foldDetection, firstRekhaOfferAt]);

  /* ------------------------ G4: पहचान पूरी — the freeze ------------------------ */

  /* The snap store, opened once — which also clears what another browsing session left (session-only). */
  const [snapStore, setSnapStore] = useState<SnapStore | null>(null);
  useEffect(() => {
    let alive = true;
    void openSnapStore().then((store) => {
      if (alive) setSnapStore(store);
    });
    return () => {
      alive = false;
    };
  }, []);

  const [completion, setCompletion] = useState<Completion | null>(null);
  const completionRef = useRef<Completion | null>(null);
  const mirroredRef = useRef(mirrored);
  const snapStoreRef = useRef<SnapStore | null>(null);
  useEffect(() => {
    mirroredRef.current = mirrored;
    snapStoreRef.current = snapStore;
  }, [mirrored, snapStore]);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const videoElementRef = useRef<HTMLVideoElement | null>(null);
  const setVideo = useCallback(
    (element: HTMLVideoElement | null) => {
      videoElementRef.current = element;
      setVideoElement(element);
    },
    [setVideoElement],
  );

  /*
   * Detection is complete — every major line confirmed or marked unclear — and the freeze begins: the sharpest
   * recent frame, once one clears VoL ≥ 100, or after FREEZE_WAIT_MS the best there is. The camera stops on it
   * (the frozen frame stays on screen), the double tick, the two snaps.
   */
  const freezeStartedAtRef = useRef(0);
  const detectionDone = phase === "scanning" && status === "running" && detection.complete;
  useEffect(() => {
    if (!detectionDone) return;
    freezeStartedAtRef.current = performance.now();
    let started = false;
    const freeze = async (): Promise<void> => {
      /* "freezing" first, so nothing between the camera stopping and the leaf appearing reads as idle. */
      setPhase("freezing");
      const waitMs = performance.now() - freezeStartedAtRef.current;
      const frozen = takeFreeze() ?? fallbackFreeze(videoElementRef.current, cropRef.current, observationRef.current);
      const gray = accumulatorGray();
      const snapshot = rekhaLatestRef.current;
      const wasMirrored = mirroredRef.current;
      stop();
      haptic("detectionComplete");
      if (frozen === null) throw new Error("no frame to freeze on");
      /* The held lines live in the accumulator's newest frame; carry them onto the frozen one. */
      const shift = frozen.anchors.length === 0 || gray === null ? null : estimateFreezeShift(cropLuma(frozen.crop.data, frozen.crop.width), frozen.crop.width, gray);
      const confirmedIds = DETECTION_LINE_IDS.filter((id) => detectionRef.current.lines[id].status === "confirmed");
      const lines = heldLinesOn(snapshot, shift, confirmedLinesRef.current, confirmedIds);
      const snaps = await makeSnaps(frozen, lines, readSnapPalette(rootRef.current ?? document.documentElement));
      const pair: SnapPair = {
        palm: snaps.palm,
        raw: snaps.raw,
        lines: snaps.lines,
        prelabel: prelabelOf(lines),
        vol: frozen.vol,
        hand: handOf(frozen.handedness),
        capturedAt: new Date(Date.now() - (performance.now() - frozen.atMs)).toISOString(),
      };
      const next: Completion = { frozen, shift, snaps, pair, mirrored: wasMirrored, waitMs };
      completionRef.current = next;
      setCompletion(next);
      setPhase("complete");
      /* Session-only by default: kept for this browsing session, never uploaded. */
      void snapStoreRef.current?.keepForSession(pair).catch(() => undefined);
    };
    const timer = window.setInterval(() => {
      if (started) return;
      if (!freezeReady(peekFreeze()) && performance.now() - freezeStartedAtRef.current < FREEZE_WAIT_MS) return;
      started = true;
      window.clearInterval(timer);
      void freeze().catch((freezeError: unknown) => {
        console.error("[chamber] freeze failed:", freezeError);
        if (!mountedRef.current) return;
        setFailure("Tasveer nahi ban payi. Dobara scan karo.");
        setPhase("failed");
      });
    }, 120);
    return () => window.clearInterval(timer);
  }, [detectionDone, peekFreeze, takeFreeze, accumulatorGray, stop]);

  /* The opt-in growth save: on saves the pair as a growth session, off deletes it (G4.3). */
  const [growthId, setGrowthId] = useState<string | null>(null);
  const growthIdRef = useRef<string | null>(null);
  const [growthBusy, setGrowthBusy] = useState(false);
  const onGrowthChange = useCallback((on: boolean) => {
    const current = completionRef.current;
    const store = snapStoreRef.current;
    if (current === null || store === null) return;
    setGrowthBusy(true);
    void (async () => {
      try {
        if (on) {
          const id = await store.saveGrowth(current.pair, growthStillOf(current.frozen));
          growthIdRef.current = id;
          setGrowthId(id);
        } else if (growthIdRef.current !== null) {
          await store.deleteGrowth(growthIdRef.current);
          growthIdRef.current = null;
          setGrowthId(null);
        }
      } catch (growthError) {
        console.error("[chamber] growth save:", growthError);
      } finally {
        if (mountedRef.current) setGrowthBusy(false);
      }
    })();
  }, []);

  /* The snaps' object URLs go with the chamber. */
  useEffect(() => () => revokeSnaps(completionRef.current?.snaps ?? null), []);

  /* G2.2: a light tick on entering the band

  /* G2.2: a light tick on entering the band — at most once in BAND_TICK_MIN_INTERVAL_MS (lib/scan/distance.ts). */
  const previousDistanceRef = useRef<DistanceState | null>(null);
  const lastBandTickRef = useRef<number | null>(null);
  useEffect(() => {
    const previous = previousDistanceRef.current;
    previousDistanceRef.current = distanceState;
    const now = performance.now();
    if (bandTickDue(previous, distanceState, lastBandTickRef.current, now)) {
      lastBandTickRef.current = now;
      haptic("bandEnter");
    }
  }, [distanceState]);

  useEffect(() => {
    cropRef.current = rectified?.image ?? cropRef.current;
  }, [rectified]);

  useEffect(() => {
    if (extraction !== null && Object.keys(extraction.lines).length > 0) drawnRef.current = extraction.lines;
  }, [extraction]);

  /* ------------------------------ the litany ----------------------------- */

  const minorTraces = useMemo(
    () => traces.filter((trace) => NAMED_MINOR_CLASSES.has(trace.class)).length,
    [traces],
  );

  /*
   * THE SIGNALS ARE A HIGH-WATER MARK, and the first capture of a real scan is
   * what put them behind one.
   *
   * Every count above is read from the CURRENT frame: `extraction.lines` is
   * whatever the last extraction named, `traces` is what the classifier found
   * in the frame just gone. Both legitimately drop to zero when the hand moves,
   * the gate fails, or a tilt puts a crease out of view — and the litany read
   * straight off them walked backwards in front of the reader. Recorded on a
   * real feed: "आपका पत्र तैयार…" at twenty seconds, "सूक्ष्म रेखाएँ…" at
   * twenty-four, and back again at twenty-eight. A scan that appears to undo
   * its own progress is the plainest way to look broken while working
   * perfectly.
   *
   * The floor is not a cosmetic smoothing, it is the truth of the pipeline: the
   * session bag this scan posts is monotonic by construction — evidence
   * accumulates and only ever improves — so a crease seen once IS still
   * evidence a moment later, whatever the newest frame happened to catch. The
   * litany now says what the session knows rather than what the last frame saw.
   */
  /*
   * Raised DURING RENDER rather than in an effect, which is React's own pattern
   * for state derived from props: `raiseChamberSignals` returns the very same
   * object when the frame added nothing, so this settles in one pass and never
   * loops. An effect here would render the old mark first and correct it a
   * frame later, which on a litany is a stage briefly showing the wrong line.
   */
  const [mark, setMark] = useState<ChamberSignals>(CHAMBER_SIGNALS_IDLE);
  const signals = raiseChamberSignals(mark, {
    cameraRunning: status === "running",
    handSeen: observation !== null,
    palmMapped: rectified !== null,
    majorLines: Object.keys(extraction?.lines ?? {}).length,
    minorTraces,
    rulesFired,
    leafReady,
  });
  if (signals !== mark) setMark(signals);

  const line = chamberCurrentLine(signals);

  /* ------------------------------ the failures --------------------------- */

  /*
   * A camera the reader refused, a browser that has none, a device with no
   * camera, a camera another app is holding, and a pipeline that broke are
   * different facts and get different sentences. A denied permission is not
   * fixed by pressing a button, so that leaf (M1.5) gives the reader their own
   * browser's directions first, and its one control is for AFTER they have
   * followed them.
   */
  const denied = status === "denied";
  const cameraFailure = denied
    ? null
    : status === "unsupported"
      ? "Is browser mein camera nahi khulta. Kisi doosre browser se koshish karo."
      : status === "error"
        ? (cameraFailureNote(cameraErrorName) ?? cameraError ?? "Camera khulte hue ruk gaya.")
        : null;

  const blocked = denied ? "denied" : (cameraFailure ?? failure);
  const idle = status === "idle" || status === "starting";

  /*
   * M1.1 / M1.2 / F1: the flip and the torch, offered while the chamber is
   * actually scanning — the flip ALWAYS on a touch device (the camera count is
   * unknown until permission, and a phone's reader must reach the other camera
   * whatever the list said), on a mouse-driven machine only with two cameras;
   * the torch on a track that can light one.
   */
  const scanning = status === "running" && blocked === null && phase === "scanning";
  const canFlip = scanning && flipVisible(touch, cameraCount);
  const canTorch = scanning && torch !== "unsupported";
  const directions = denied ? cameraDeniedDirections(browser ?? "other") : null;

  /*
   * G4: a new scan from nothing — after "दोबारा स्कैन", or a failure's retry. The evidence, the detection, the litany's
   * mark and the session all start again, so a finished detection cannot freeze the next scan the moment the
   * camera is back.
   */
  const resetForNewScan = useCallback(() => {
    revokeSnaps(completionRef.current?.snaps ?? null);
    completionRef.current = null;
    setCompletion(null);
    growthIdRef.current = null;
    setGrowthId(null);
    sessionRef.current = emptySession();
    drawnRef.current = null;
    cropRef.current = null;
    rekhaLatestRef.current = null;
    confirmedLinesRef.current = {};
    detectionRef.current = DETECTION_IDLE;
    setDetection(DETECTION_IDLE);
    setMark(CHAMBER_SIGNALS_IDLE);
    setLeafReady(false);
    setRulesFired(0);
    setFailure(null);
    setBlur(false);
    restartCapture();
  }, [restartCapture]);

  const onRetake = useCallback(() => {
    resetForNewScan();
    setPhase("scanning");
    void start();
  }, [resetForNewScan, start]);

  /* "पाठ खोलें": the reading, built now from the session and whatever of the choreography's masks there are. */
  const onOpenReading = useCallback(() => {
    void buildReading(capture, cropRef.current);
  }, [buildReading, capture]);

  /* The frozen frame stays on screen from the freeze until the reveal beat takes it. */
  const frozenShown = completion !== null && (phase === "complete" || phase === "building" || phase === "revealing");

  return (
    <div ref={rootRef} className={styles.chamber} data-snc-controls={canFlip || canTorch ? "" : undefined} data-snc-phase={phase}>
      <video
        ref={setVideo}
        playsInline
        muted
        aria-label="Hatheli ka camera"
        className={styles.feed}
        style={mirrored ? { transform: "scaleX(-1)" } : undefined}
      />

      {/* G4: THE FROZEN FRAME — the camera stopped on the sharpest recent frame, shown as the reader saw it. */}
      {frozenShown ? (
        // eslint-disable-next-line @next/next/no-img-element -- an object URL of the frozen frame, never a remote image
        <img
          src={completion.snaps.rawUrl}
          alt=""
          className={styles.frozen}
          style={completion.mirrored ? { transform: "scaleX(-1)" } : undefined}
          data-snc-frozen=""
          data-snc-freeze-vol={completion.frozen.vol.toFixed(1)}
          data-snc-freeze-wait={Math.round(completion.waitMs)}
          data-snc-freeze-shift={completion.shift === null ? "none" : `${completion.shift.dx.toFixed(2)},${completion.shift.dy.toFixed(2)}`}
        />
      ) : null}

      {frozenShown ? null : (
      <ChamberCanvas
        className={styles.canvas}
        landmarks={observation?.landmarks ?? null}
        videoSize={videoSize}
        lines={extraction?.lines ?? {}}
        projection={projection}
        liveProjection={liveProjectionRef}
        poseProgress={totalProgress}
        mirrored={mirrored}
        gatePassing={quality.ok}
        onCost={setCost}
        distance={distanceRef}
      />
      )}

      {/* THE BACK MARK. A mark and not a button: no fill, no border, no radius —
          the same argument the book's controls make about room being the
          difference between deliberate and broken. */}
      <Link href={backHref} className={styles.back} aria-label="Wapas">
        <span aria-hidden="true">‹</span>
      </Link>

      {/* THE GATE. The camera needs a gesture, and this is the one thing on the
          route a reader presses. It is ink on a leaf like everything else the
          chamber says, so the ceremony does not open with a button. */}
      {/* `phase === "scanning"` is not redundant with `idle`. A camera that stops
          after a completed scan makes the hook idle again, and without this the
          gate would open UNDER the reveal beat — captured exactly that way: two
          sentences of the beat printed across the invitation leaf, both
          illegible. The gate belongs to the beginning of the ritual only. */}
      {idle && blocked === null && phase === "scanning" ? (
        <div className={styles.gate}>
          <Parchment tone="aged" tear="rough" seed={7717} className={styles.gateLeaf}>
            <p className={styles.gateLine} lang="hi">
              {rescanAsk ?? "हथेली सामने रखो — कक्ष तैयार है."}
            </p>
            <p className={styles.gateNote}>Tasveer kabhi upload nahi hoti — sab kuch isi device par.</p>
            <button type="button" className={styles.gateButton} onClick={start}>
              Kaksh mein pravesh
            </button>
          </Parchment>
        </div>
      ) : null}

      {/* M1.5 — THE REFUSED CAMERA: the reader's own browser's directions, on the
          same leaf, and one control for after they have followed them. */}
      {directions === null ? null : (
        <div className={styles.gate}>
          <Parchment tone="aged" tear="rough" seed={9091} className={styles.gateLeaf}>
            <p className={styles.gateLine} lang="hi">
              {directions.title}
            </p>
            <p className={styles.gateNote}>{directions.lead}</p>
            <ol className={styles.steps}>
              {directions.steps.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
            {directions.alternative === null ? null : <p className={styles.gateNote}>{directions.alternative}</p>}
            <button type="button" className={styles.gateButton} onClick={start}>
              {directions.retry}
            </button>
          </Parchment>
        </div>
      )}

      {/* THE FAILURES, in the same ink, on the same leaf. An error here is still
          something happening in a room rather than a dialog over one. */}
      {blocked === null || denied ? null : (
        <div className={styles.gate}>
          <Parchment tone="aged" tear="rough" seed={9091} className={styles.gateLeaf}>
            <p className={styles.gateLine} lang="hi">
              कक्ष अभी नहीं खुला.
            </p>
            <p className={styles.gateNote}>{blocked}</p>
            <button
              type="button"
              className={styles.gateButton}
              onClick={() => {
                resetForNewScan();
                setPhase("scanning");
                start();
              }}
            >
              Dobara koshish karo
            </button>
          </Parchment>
        </div>
      )}

      {/* M1.1 / M1.2 / F1 — THE FLIP AND THE TORCH. Marks like the back mark, not
          buttons: no fill, no border, no radius, a 48px target around an engraved
          glyph with its name under it. They sit at the screen's two lower corners
          — on a phone the one place both are in a thumb's reach, and off the ring
          the hand is in — ABOVE everything else: the pull-up sheet and the litany
          leaf never cover them (chamber.module.css). */}
      {canFlip ? (
        <button
          type="button"
          className={styles.control}
          data-snc-control="flip"
          data-snc-facing={cameraFacing}
          aria-label="कैमरा बदलें"
          onClick={() => void flipCamera()}
        >
          <SanctuaryIcon name="flip" size={26} />
          <span className={styles.controlLabel} lang="hi" aria-hidden="true">
            कैमरा बदलें
          </span>
        </button>
      ) : null}
      {canTorch ? (
        <button
          type="button"
          className={styles.control}
          data-snc-control="torch"
          aria-label="रोशनी"
          aria-pressed={torch === "on"}
          onClick={() => void toggleTorch()}
        >
          <SanctuaryIcon name="diya" size={26} />
          <span className={styles.controlLabel} lang="hi" aria-hidden="true">
            रोशनी
          </span>
        </button>
      ) : null}

      {/* S1.4 — the lines found so far, by state, and nothing below CANDIDATE. Detection only. */}
      <RekhaMonitor snapshot={rekha} detection={detection} visible={scanning} />

      <ScanLitany
        line={line}
        hint={hint}
        distance={distanceState === null ? null : distanceRef}
        action={hintAction}
        visible={blocked === null && !idle && phase !== "revealing"}
      />

      {/* G4: पहचान पूरी — the two snaps, the one opt-in, the two ways on. */}
      {frozenShown && phase !== "revealing" ? (
        <CompletionLeaf
          palmSrc={completion.snaps.palmUrl}
          rawSrc={completion.snaps.rawUrl}
          linesSrc={completion.snaps.linesUrl}
          growth={growthId !== null}
          growthBusy={growthBusy}
          growthAvailable={snapStore !== null && completion.frozen.anchors.length > 0}
          onGrowthChange={onGrowthChange}
          onRetake={onRetake}
          onOpenReading={onOpenReading}
          opening={phase === "building"}
        />
      ) : null}

      {phase === "revealing" ? <RevealBeat onArrived={() => router.push(readHref)} /> : null}

      {/*
        THE MEASUREMENT, ON REQUEST (`?cost=1`).
        §10's budget is a number, so the route can print the number. It is off by
        default because a performance readout over a ceremony is the least
        ceremonial thing imaginable — but it is REAL and always running, so the
        figure in a report is the figure the reader's own device produced.
      */}
      {showCost ? (
        <p className={styles.cost} data-snc-budget={withinFrameBudget(cost) ? "within" : "over"}>
          {formatFrameCost(cost)}
          {rekha === null
            ? null
            : ` · rekha ${rekha.costMs.toFixed(2)} ms/frame · ${rekhaLedger(rekha)} · flicker ${Object.values(rekha.flicker).join("/")}`}
          {/* G3: the rings as numbers, and the usable time the budget is counting. */}
          {` · ${detectionLedger(detection)} · usable ${(detection.usableMs / 1000).toFixed(1)} s`}
          {traceMs === null ? null : ` · trace ${traceMs.toFixed(1)} ms/extraction`}
          {/* G4: the frozen frame's grade, the lines' shift onto it, and the wait for it. */}
          {completion === null
            ? null
            : ` · frozen VoL ${completion.frozen.vol.toFixed(0)} shift ${completion.shift === null ? "none" : `${completion.shift.dx.toFixed(1)},${completion.shift.dy.toFixed(1)}`} wait ${Math.round(completion.waitMs)} ms`}
          {activeProfile === null
            ? null
            : ` · profile ${activeProfile.name} (${capabilityTier}) ${videoSize === null ? "–" : `${videoSize.width}×${videoSize.height}`} · extract ${activeProfile.extractIntervalMs} ms`}
          {/* R1: the stage funnel — the last closed 10 s window, or the one still open. */}
          {funnel === null ? null : (
            <span data-snc-funnel="">{` · ${formatFunnel(funnel.windows.at(-1) ?? funnel.current)}`}</span>
          )}
          {landmarkMs === null ? null : ` · landmarks ${landmarkMs.toFixed(1)} ms`}
          {status === "running" ? ` · ${cameraFacing === "environment" ? "back" : "front"}${mirrored ? " mirrored" : ""}` : null}
          {` · build ${BUILD_SHA_SHORT}`}
        </p>
      ) : null}

      {/* THE BUILD STAMP (M0). The chamber has no footer — its foot is the litany,
          the marks and the Monitor's handle — so the line takes the back mark's
          row, the one strip free on every phone and on a desktop. The readout
          owns that row when it is asked for, and carries the SHA itself then. */}
      {showCost ? null : <BuildStamp className={styles.buildStamp} />}
    </div>
  );
}
