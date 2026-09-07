"use client";

/**
 * ============================================================================
 * THE CHAMBER — the scanning ritual, over the same pipeline.
 * ============================================================================
 *
 * A SECOND SURFACE, NOT A REPLACEMENT. `/scan` is untouched and stays live;
 * this route mounts the very same `useHandScan` and draws a different room
 * around it. Not one file under lib/scan is edited by this work, and all nine
 * scan flags keep their defaults — which is why the pipeline's own cost is
 * unchanged by construction and everything §10 budgets is the drawing this
 * route adds. See lib/sanctuary/frame-cost.ts for how that is measured, and the
 * readout below for where the number comes out.
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
import { MASK_SIZE } from "@/lib/scan/types";
import { useHandScan } from "@/components/scan/use-hand-scan";
import { encodeCrop, handOffToPothi, rescanPrompt, RESCAN_PARAM } from "@/lib/sanctuary/pothi-handoff";
import {
  chamberCurrentLine,
  raiseChamberSignals,
  CHAMBER_SIGNALS_IDLE,
  type ChamberSignals,
} from "@/lib/sanctuary/chamber-stages";
import { formatFrameCost, withinFrameBudget, type FrameCostSummary } from "@/lib/sanctuary/frame-cost";
import { ChamberCanvas } from "@/components/sanctuary/chamber/chamber-canvas";
import { ScanLitany } from "@/components/sanctuary/chamber/scan-litany";
import { RevealBeat } from "@/components/sanctuary/chamber/reveal-beat";
import { Parchment } from "@/components/sanctuary/material";
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
type ChamberPhase = "scanning" | "building" | "revealing" | "failed";

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

        const response = await fetch("/api/reading", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ tier: "free", source: "CAMERA_SCAN", features: sessionBag(finalSession) }),
        });
        if (!mountedRef.current) return;
        if (!response.ok) {
          setFailure(`Paath nahi ban paya (${response.status}). Thodi der baad dobara.`);
          setPhase("failed");
          return;
        }
        const reading = (await response.json()) as ReadingResponse;
        setRulesFired(reading.rules.length);

        handOffToPothi({
          reading,
          lines: found.lines,
          space: MASK_SIZE,
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
  const onCaptureComplete = useCallback(
    (capture: CaptureState) => {
      void buildReading(capture, cropRef.current);
    },
    [buildReading],
  );

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
  } = useHandScan({ onFeatures, onLineFeatures, onCaptureComplete });

  useEffect(() => {
    cropRef.current = rectified?.image ?? cropRef.current;
  }, [rectified]);

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
   * A camera the reader refused, a browser that has none, and a pipeline that
   * broke are three different facts and get three different sentences. The one
   * thing none of them does is offer a retry the chamber cannot honour: a
   * denied permission is not fixed by pressing a button, so that state sends
   * the reader to their browser settings in words instead.
   */
  const cameraFailure =
    status === "denied"
      ? "Camera ki ijaazat nahi mili. Browser ki settings mein ise allow karke wapas aao."
      : status === "unsupported"
        ? "Is browser mein camera nahi khulta. Kisi doosre browser se koshish karo."
        : status === "error"
          ? (cameraError ?? "Camera khulte hue ruk gaya.")
          : null;

  const blocked = cameraFailure ?? failure;
  const idle = status === "idle" || status === "starting";

  return (
    <div className={styles.chamber}>
      <video
        ref={setVideoElement}
        playsInline
        muted
        aria-label="Hatheli ka camera"
        className={styles.feed}
        style={mirrored ? { transform: "scaleX(-1)" } : undefined}
      />

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
      />

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

      {/* THE FAILURES, in the same ink, on the same leaf. An error here is still
          something happening in a room rather than a dialog over one. */}
      {blocked === null ? null : (
        <div className={styles.gate}>
          <Parchment tone="aged" tear="rough" seed={9091} className={styles.gateLeaf}>
            <p className={styles.gateLine} lang="hi">
              कक्ष अभी नहीं खुला.
            </p>
            <p className={styles.gateNote}>{blocked}</p>
            {status === "denied" ? null : (
              <button
                type="button"
                className={styles.gateButton}
                onClick={() => {
                  setFailure(null);
                  setPhase("scanning");
                  start();
                }}
              >
                Dobara koshish karo
              </button>
            )}
          </Parchment>
        </div>
      )}

      <ScanLitany
        line={line}
        hint={status === "running" && !quality.ok ? quality.hint : null}
        visible={blocked === null && !idle && phase !== "revealing"}
      />

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
        </p>
      ) : null}
    </div>
  );
}
