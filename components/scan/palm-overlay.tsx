"use client";

import { useEffect, useRef } from "react";
import {
  applyHomography,
  canonicalAnchors,
  solveHomography,
  PALM_ANCHORS,
  type Matrix3,
} from "@/lib/scan/rectify";
import { palmBoundary } from "@/lib/scan/landmarks";
import { catmullRomSegments } from "@/lib/scan/curve";
import { HAND_BONES, LM } from "@/lib/scan/landmark-index";
import { coverTransform, videoNormToCanvas, videoPxToCanvas, type CoverTransform } from "@/lib/scan/view-transform";
import { LINE_THRESHOLD, type ClassifiedTrace, type Poly } from "@/lib/scan/lines";
import { MIN_CLASS_SCORE } from "@/lib/scan/classify";
import { scanFlags, SCAN_FLAG_NAMES } from "@/lib/scan/flags";
import { contractStats } from "@/lib/scan/contract";
import { MASK_SIZE, type Landmark3, type Point2 } from "@/lib/scan/types";

const LINE_GLOW = "#ff9a3c";
const MOUNT_GLOW = "#35e0c8";
const SWEEP_PERIOD_MS = 2400;
/**
 * How visible the faintest drawable trace is. A trace that exists is drawn — confidence only decides
 * how loudly. Hiding traces below a confidence floor was one of three independent reasons no line
 * ever reached the screen: fused confidence on a real palm sits well under the old 0.35 gate for the
 * first several seconds, so the overlay showed a warm-up sweep over a mask that already had lines in it.
 */
const TRACE_MIN_ALPHA = 0.25;
/**
 * How long a trace keeps half its brightness once fresh evidence stops arriving.
 *
 * Traces used to be cleared outright the moment an extraction came back empty or the fusion reset,
 * which read as the lines blinking off and on. Fading instead is both nicer and more honest: a trace
 * with no recent evidence behind it *is* less believable than one being re-confirmed every frame,
 * and the fade says exactly that. It never reaches zero on its own — only a genuinely invalidating
 * event (the other hand) clears the traces outright.
 */
const TRACE_HALF_LIFE_MS = 2500;
/** Floor the decay lands on, so a held pose that briefly loses evidence does not vanish entirely. */
const TRACE_DECAY_FLOOR = 0.15;
/**
 * How much of full brightness an INFERRED stretch keeps.
 *
 * A completed line necessarily bridges gaps where no crease was detected. Drawing those at the same
 * weight as observed evidence would present the fit's prior as the user's palm. Dimming them says
 * "this part is joined up, not seen" without breaking the curve into pieces — which matters, because
 * the continuity is the thing that makes it read as a line at all.
 */
const INFERRED_ALPHA = 0.4;
/**
 * How much of full brightness the traces keep while the gate is failing.
 *
 * Not zero, and that is the whole point. Detection is gate-independent — evidence accumulates on any
 * frame with a hand in it — so hiding the traces during a failing pose would hide something the
 * pipeline genuinely knows, and would read as "the scan lost my lines" when it has not. Dimming
 * instead lets the guidance hint sit on top legibly while the lines stay visibly present.
 */
const GATE_FAIL_ALPHA = 0.6;
/**
 * Weight for raw, unnamed fragments — what is drawn when completion could not name a single line.
 *
 * They are real detected creases, so hiding them would throw away the only thing the pipeline knows;
 * but they carry no claim about WHICH line they are, and drawing them at the same weight as a fitted
 * heart line would imply one. Dimmer says "seen, not yet identified".
 */
const UNNAMED_ALPHA = 0.55;
/**
 * Weight and width for a MINOR trace — a crease that is real but is not one of the named lines.
 *
 * Drawn thinner and dimmer rather than not at all. They are genuinely on the palm and the user can
 * see them being found, which is most of what makes the scan feel like it is looking; but they carry
 * no claim about what they mean, and drawing them at a named line’s weight would imply one.
 */
const MINOR_ALPHA = 0.34;
const MINOR_WIDTH = 0.9;
/** Depth at which a trace is drawn at full brightness. Below it, dimmer in proportion — a faint
 * crease IS fainter, and the overlay saying so is the same honesty the depth feature carries. */
const DEPTH_FULL = 0.6;

const ANCHOR_SET = new Set<number>(PALM_ANCHORS);

/*
 * ── Diagnostic layers (dev harness lane D, flag `scanDiagnostics`) ─────────────────────────────
 *
 * "O" cycles NONE → FIELD → RIDGE → TRACES → LINES. LINES is the shipped overlay, untouched.
 * FIELD/RIDGE render the canonical 128 map as a corner PIP rather than warped onto the hand:
 * canvas 2D has no perspective drawImage, and the PIP answers the actual question — "what did the
 * detector see" — without a per-pixel software warp at frame rate. TRACES projects every
 * classified trace with its class + score. A corner readout (field p99/mean, LINE_THRESHOLD,
 * trace counts around MIN_CLASS_SCORE, flags on) renders on every layer while the flag is on.
 */
const DIAG_LAYERS = ["NONE", "FIELD", "CONTRACT", "RIDGE", "TRACES", "LINES"] as const;
type DiagLayer = (typeof DIAG_LAYERS)[number];
const DIAG_PIP_SIZE = 160;
const DIAG_TEXT = "rgba(232, 226, 214, 0.92)";
const DIAG_BACK = "rgba(13, 11, 9, 0.72)";

interface DiagnosticsData {
  readonly field: Float32Array | null;
  readonly ridge: Float32Array | null;
  readonly classified: readonly ClassifiedTrace[];
  /** H9 contract EMA (flag fieldContract/corridorSearch); drawn by the CONTRACT layer. */
  readonly contract?: Float32Array | null;
  /** Last corridor attempts (flag corridorSearch): class, accepted, mean field. */
  readonly corridor?: readonly { readonly cls: string; readonly accepted: boolean; readonly meanField: number | null }[];
}

/** p99/mean of a field, cached by array identity — sorting 16k floats per frame would be silly. */
function fieldStats(
  cache: { field: Float32Array | null; p99: number; mean: number },
  field: Float32Array,
): { p99: number; mean: number } {
  if (cache.field !== field) {
    const sorted = Float32Array.from(field).sort();
    let total = 0;
    for (let i = 0; i < field.length; i += 1) total += field[i];
    cache.field = field;
    cache.p99 = sorted[Math.min(sorted.length - 1, Math.floor(0.99 * sorted.length))];
    cache.mean = total / field.length;
  }
  return { p99: cache.p99, mean: cache.mean };
}

/** Tint one canonical map into the PIP canvas (value → warm alpha) and blit it top-right. */
function drawPip(
  context: CanvasRenderingContext2D,
  pip: HTMLCanvasElement,
  plane: Float32Array,
  width: number,
): void {
  const pipContext = pip.getContext("2d");
  if (pipContext === null) return;
  const image = pipContext.createImageData(MASK_SIZE, MASK_SIZE);
  for (let i = 0; i < plane.length; i += 1) {
    const v = Math.min(1, Math.max(0, plane[i]));
    const at = i * 4;
    image.data[at] = 255;
    image.data[at + 1] = 154;
    image.data[at + 2] = 60;
    image.data[at + 3] = Math.round(v * 255);
  }
  pipContext.putImageData(image, 0, 0);
  context.save();
  context.fillStyle = DIAG_BACK;
  context.fillRect(width - DIAG_PIP_SIZE - 12, 12, DIAG_PIP_SIZE + 4, DIAG_PIP_SIZE + 4);
  context.imageSmoothingEnabled = false;
  context.drawImage(pip, width - DIAG_PIP_SIZE - 10, 14, DIAG_PIP_SIZE, DIAG_PIP_SIZE);
  context.restore();
}

export interface PalmOverlayProps {
  /** Live landmarks; the overlay re-projects onto these every frame. */
  readonly landmarks: readonly Landmark3[] | null;
  /** Intrinsic camera dimensions — the space the landmarks are normalised to. */
  readonly videoSize: { readonly width: number; readonly height: number } | null;
  /** Traced lines in rectified crop space. Reused across frames while inference catches up. */
  readonly polys: readonly Poly[];
  /**
   * Per-poly observed/inferred index ranges, parallel to `polys`. Absent entries draw fully bright,
   * which is the correct default for a raw trace that was measured end to end.
   */
  readonly segments?: readonly (readonly { readonly from: number; readonly to: number; readonly observed: boolean }[] | undefined)[];
  /** 0–1 fused confidence; scales trace opacity. The sweep plays only when there is no trace at all. */
  readonly confidence: number;
  /**
   * Whether the quality gate is currently passing. Traces are drawn either way — only their
   * brightness changes — because the gate governs what may be CLAIMED, never what may be shown.
   */
  readonly gatePassing: boolean;
  /** False when `polys` are raw fragments rather than named lines; they are drawn at lower weight. */
  readonly tracesNamed?: boolean;
  /**
   * The rectification the traces were traced in: the stabilised anchors in VIDEO pixels, and the
   * convention they were fitted under. Null means the traces cannot be projected consistently and
   * must not be drawn — a trace through the wrong homography is a confident claim about the wrong
   * skin, which is worse than showing nothing.
   *
   * Only `convention` is read when {@link liveProjection} is supplying live anchors; see the draw
   * loop for which of the two is projected through and why.
   */
  readonly projection?: { readonly anchors: readonly Point2[]; readonly convention: number } | null;
  /**
   * The CURRENT frame's rectification, refreshed every rectify tick by the scan hook.
   *
   * A ref rather than a prop value: the draw loop runs at frame rate and wants the freshest anchors
   * at the instant it draws, not a snapshot React scheduled some renders ago.
   */
  readonly liveProjection?: { readonly current: { readonly anchors: readonly Point2[]; readonly convention: number } | null } | null;
  /**
   * Minor traces: everything found that is not one of the named lines. Drawn under them, thinner and
   * dimmer, scaled by their measured depth.
   */
  readonly minorTraces?: readonly { readonly points: readonly Point2[]; readonly depth: number }[];
  /**
   * Reports how many polylines were actually STROKED this frame.
   *
   * The last link in the telemetry chain, and the only one that cannot be inferred from state: every
   * count upstream can be non-zero while nothing reaches the canvas, because a transform can be null,
   * an alpha can be zero, or a projection can put every point off-screen. Measuring the draw itself is
   * the difference between "we published traces" and "the user saw traces".
   */
  readonly onDrawn?: (count: number) => void;
  /**
   * `performance.now()` of the last extraction that produced these traces. The overlay fades them
   * out from here, so persistence is measured against real elapsed time rather than frame count —
   * a stalled tab must not make stale traces look fresh.
   */
  readonly evidenceAtMs: number;
  readonly mirrored: boolean;
  /** Dev tuning override for PALM_EDGE_PEAK; undefined uses the shipped constant. */
  readonly edgePeak?: number;
  /** Lane D diagnostic data; only read while the `scanDiagnostics` flag is on. */
  readonly diagnostics?: DiagnosticsData | null;
  readonly className?: string;
}

/**
 * Strokes a smooth curve through `points`.
 *
 * The maths lives in `lib/scan/curve.ts` so the interpolation property — every sample stays ON the
 * drawn curve — is unit-tested rather than trusted; this is only the canvas half.
 */
function strokeCatmullRom(context: CanvasRenderingContext2D, points: readonly Point2[]): void {
  const segments = catmullRomSegments(points);
  if (segments.length === 0) return;
  context.beginPath();
  context.moveTo(points[0].x, points[0].y);
  for (const segment of segments) {
    context.bezierCurveTo(
      segment.control1.x,
      segment.control1.y,
      segment.control2.x,
      segment.control2.y,
      segment.to.x,
      segment.to.y,
    );
  }
  context.stroke();
}

/**
 * The live palm overlay: skeleton, palm boundary, rectification anchors and the glowing traced
 * lines. Nothing else — every stray primitive that was not one of those has been removed.
 *
 * **Coordinates.** The video renders with `object-fit: cover`, so every draw goes through the cover
 * transform in `lib/scan/view-transform.ts` — landmark-space points via `videoNormToCanvas`,
 * crop-space geometry via the crop→video homography and then `videoPxToCanvas`. The mirror lives in
 * that transform too; nothing here applies its own `scaleX(-1)`, which is precisely how the old
 * overlay ended up drawing a skeleton beside the hand instead of on it — it mapped landmarks with an
 * `object-fit: fill` assumption while the video was cover-cropped.
 *
 * **Why polylines and not the mask.** Re-warping a 65k-pixel probability field onto the video every
 * frame would cost more than the inference it displays. The fused mask is traced into polylines once
 * per inference; each frame only pushes a few dozen points through the current transforms. That is
 * why the strokes stay glued to a moving hand at 60fps while the detector underneath runs at 5.
 *
 * Glow is two passes over the same path: a wide blurred stroke underneath, a thin bright core on
 * top. `shadowBlur` alone smears the line; this keeps a crisp centre inside the bloom.
 */
export function PalmOverlay({
  landmarks,
  videoSize,
  polys,
  segments,
  confidence,
  gatePassing,
  tracesNamed = true,
  projection = null,
  liveProjection = null,
  minorTraces,
  onDrawn,
  evidenceAtMs,
  mirrored,
  edgePeak,
  diagnostics = null,
  className,
}: PalmOverlayProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rafRef = useRef<number | null>(null);
  /** Stroke count from the most recent draw, sampled by an interval rather than reported per frame. */
  const drawnRef = useRef(0);
  // Latest props, read by the animation loop without restarting it. Synced in an effect rather than
  // during render: a render that React discards must not leave a mutated ref behind.
  const stateRef = useRef({
    landmarks,
    videoSize,
    polys,
    segments,
    confidence,
    gatePassing,
    tracesNamed,
    projection,
    liveProjection,
    minorTraces,
    evidenceAtMs,
    mirrored,
    edgePeak,
    diagnostics,
  });
  const diagLayerRef = useRef<DiagLayer>("LINES");
  const pipCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const diagStatsRef = useRef<{ field: Float32Array | null; p99: number; mean: number }>({
    field: null,
    p99: 0,
    mean: 0,
  });

  // Lane D: "O" cycles the diagnostic layer — only while the flag is on, so the shipped overlay
  // has zero new key behavior with flags off.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key.toLowerCase() !== "o") return;
      if (!scanFlags.snapshot().scanDiagnostics) return;
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement) return;
      diagLayerRef.current = DIAG_LAYERS[(DIAG_LAYERS.indexOf(diagLayerRef.current) + 1) % DIAG_LAYERS.length];
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    stateRef.current = {
      landmarks,
      videoSize,
      polys,
      segments,
      confidence,
      gatePassing,
      tracesNamed,
      projection,
      liveProjection,
      minorTraces,
      evidenceAtMs,
      mirrored,
      edgePeak,
      diagnostics,
    };
  }, [landmarks, videoSize, polys, segments, confidence, gatePassing, tracesNamed, projection, liveProjection, minorTraces, evidenceAtMs, mirrored, edgePeak, diagnostics]);

  /*
   * Sampled on a timer, not pushed from the draw loop: calling back at 60fps would re-render the
   * page that owns the video element sixty times a second to report a number that changes once a
   * second, which is precisely the kind of cost this instrument exists to make visible.
   */
  useEffect(() => {
    if (onDrawn === undefined) return;
    const id = window.setInterval(() => onDrawn(drawnRef.current), 1000);
    return () => window.clearInterval(id);
  }, [onDrawn]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return;
    const context = canvas.getContext("2d");
    if (context === null) return;

    const reduceMotion =
      typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const draw = (timestamp: number) => {
      const {
        landmarks: marks,
        videoSize: video,
        polys: traces,
        segments: traceSegments,
        confidence: fused,
        gatePassing: gateOk,
        tracesNamed: named,
        projection,
        liveProjection: livePro,
        minorTraces: minor,
        evidenceAtMs: evidenceAt,
        mirrored: flip,
        edgePeak: peakOverride,
        diagnostics: diag,
      } = stateRef.current;
      const flagsNow = scanFlags.snapshot();
      const diagOn = flagsNow.scanDiagnostics;
      const layer: DiagLayer = diagOn ? diagLayerRef.current : "LINES";

      const parent = canvas.parentElement;
      const width = parent?.clientWidth ?? canvas.width;
      const height = parent?.clientHeight ?? canvas.height;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
        canvas.width = Math.round(width * dpr);
        canvas.height = Math.round(height * dpr);
      }

      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      context.clearRect(0, 0, width, height);

      /* ------------------------- Diagnostics (lane D) -------------------------- */
      // Drawn BEFORE the transform guards: the readout must work precisely when nothing else does
      // ("why is it not picking up rekha" usually means a null transform or an empty field).
      if (diagOn) {
        if (layer === "FIELD" && diag?.field != null) {
          let pip = pipCanvasRef.current;
          if (pip === null) {
            pip = document.createElement("canvas");
            pip.width = MASK_SIZE;
            pip.height = MASK_SIZE;
            pipCanvasRef.current = pip;
          }
          drawPip(context, pip, diag.field, width);
        } else if (layer === "CONTRACT" && diag?.contract != null) {
          let pip = pipCanvasRef.current;
          if (pip === null) {
            pip = document.createElement("canvas");
            pip.width = MASK_SIZE;
            pip.height = MASK_SIZE;
            pipCanvasRef.current = pip;
          }
          drawPip(context, pip, diag.contract, width);
        } else if (layer === "RIDGE" && diag?.ridge != null) {
          let pip = pipCanvasRef.current;
          if (pip === null) {
            pip = document.createElement("canvas");
            pip.width = MASK_SIZE;
            pip.height = MASK_SIZE;
            pipCanvasRef.current = pip;
          }
          drawPip(context, pip, diag.ridge, width);
        }
        const stats = diag?.field != null ? fieldStats(diagStatsRef.current, diag.field) : null;
        const above = diag?.classified.filter((t) => t.classScore >= MIN_CLASS_SCORE).length ?? 0;
        const below = (diag?.classified.length ?? 0) - above;
        const flagsOn = SCAN_FLAG_NAMES.filter((name) => flagsNow[name]).join(" ") || "none";
        const lines = [
          `diag ${layer} (O cycles)`,
          stats === null ? "field: none" : `field p99 ${stats.p99.toFixed(3)} mean ${stats.mean.toFixed(4)}`,
          `thr ${LINE_THRESHOLD} | traces >=${MIN_CLASS_SCORE}: ${above} below: ${below}`,
          `flags: ${flagsOn}`,
        ];
        // H9 readout: the contract plane's live stats (contractStats without GT masks yields the
        // mean; the two GT-anchored numbers live in the eval, where centrelines exist).
        if (diag?.contract != null) {
          const cStats = contractStats(diag.contract, MASK_SIZE);
          lines.push(`contract mean ${cStats.mean.toFixed(4)}`);
        }
        for (const attempt of diag?.corridor ?? []) {
          lines.push(
            `corridor ${attempt.cls}: ${attempt.accepted ? "accepted" : "rejected"}${
              attempt.meanField === null ? "" : ` mean ${attempt.meanField.toFixed(3)}`
            }`,
          );
        }
        context.save();
        context.font = "11px ui-monospace, monospace";
        context.textBaseline = "top";
        const boxWidth = Math.max(...lines.map((l) => context.measureText(l).width)) + 16;
        context.fillStyle = DIAG_BACK;
        context.fillRect(8, height - 8 - lines.length * 15 - 10, boxWidth, lines.length * 15 + 10);
        context.fillStyle = DIAG_TEXT;
        lines.forEach((l, i) => context.fillText(l, 16, height - 8 - lines.length * 15 - 4 + i * 15));
        context.restore();
      }

      const transform: CoverTransform | null =
        video === null || marks === null || marks.length < 21
          ? null
          : coverTransform(video.width, video.height, width, height, flip);
      if (transform === null || marks === null) {
        rafRef.current = requestAnimationFrame(draw);
        return;
      }

      const toCanvas = (p: Point2): Point2 => videoNormToCanvas(transform, p);

      /* ------------------------------- Skeleton -------------------------------- */
      context.save();
      context.strokeStyle = MOUNT_GLOW;
      context.globalAlpha = 0.45;
      context.lineWidth = 1.25;
      context.lineCap = "round";
      context.beginPath();
      for (const [from, to] of HAND_BONES) {
        const a = toCanvas(marks[from]);
        const b = toCanvas(marks[to]);
        context.moveTo(a.x, a.y);
        context.lineTo(b.x, b.y);
      }
      context.stroke();
      context.restore();

      context.save();
      context.shadowColor = MOUNT_GLOW;
      context.shadowBlur = 4;
      for (let index = 0; index < marks.length; index += 1) {
        const p = toCanvas(marks[index]);
        const isAnchor = ANCHOR_SET.has(index);
        context.fillStyle = isAnchor ? LINE_GLOW : MOUNT_GLOW;
        context.globalAlpha = isAnchor ? 0.95 : 0.7;
        context.beginPath();
        // Anchors drawn larger: if the crop looks wrong, these four dots are why.
        context.arc(p.x, p.y, isAnchor ? 4 : 2, 0, Math.PI * 2);
        context.fill();
      }
      context.restore();

      /*
       * The palm boundary is drawn straight from landmarks, not through the crop homography: it is
       * already in video space, and routing it via the crop would put it at the mercy of the very
       * rectification it exists to sanity-check.
       */
      const boundary = palmBoundary(marks, peakOverride);
      const boundaryCanvas = boundary === null ? null : boundary.map(toCanvas);
      if (boundaryCanvas !== null) {
        /*
         * ONE continuous curve, and nothing else. Earlier versions also stamped a dot on each
         * derived sample, which read as a dangling stub off the little knuckle rather than as part
         * of the path — the samples are waypoints, not landmarks, and marking them made the boundary
         * look like several primitives instead of one edge.
         */
        context.save();
        context.strokeStyle = MOUNT_GLOW;
        context.shadowColor = MOUNT_GLOW;
        context.shadowBlur = 8;
        context.globalAlpha = 0.35;
        context.lineWidth = 1.5;
        context.lineJoin = "round";
        context.lineCap = "round";
        strokeCatmullRom(context, boundaryCanvas);
        context.restore();
      }

      /* --------------------------- Crop-space geometry -------------------------- */
      // The homography is solved in VIDEO pixel space; the cover transform carries it to canvas.
      /*
       * ── The projection must match the rectification the traces were traced in ────────────────
       *
       * The crop is built from *stabilised* anchors under a 4- or 5-correspondence convention; this
       * overlay used to project through *raw* landmarks and always four. Measured on a real frame,
       * that put every trace 4.6 video pixels off the crease it came from — comparable to a crease's
       * whole width, so the lines sat convincingly beside the creases rather than on them.
       *
       * So: project through the CURRENT frame's stabilised anchors, under the convention the traces
       * were traced in.
       *
       * Current, not frozen. Canonical space is motion-compensated — the same skin lands on the same
       * crop pixel however the hand moves — so a trace is equally valid under either frame's matrix.
       * But `projection`'s anchors are captured when traces are re-extracted, which runs at the
       * classical stride and not per frame, while this loop draws at frame rate. Drawing through them
       * pegs the traces to where the hand was several frames ago, and they lag a moving palm. The
       * live ref is refreshed every rectify tick, so they stay glued to it.
       *
       * What must match is the *convention*, not the matrix: a 5-anchor crop was fitted to five
       * targets and reproducing it from four is a different transform. When this frame cannot
       * reproduce the traced-in convention, NOTHING is drawn. Falling back to raw landmarks — which
       * this did until STEP 15, contradicting the paragraph above it — reintroduces exactly the
       * 4.6px offset the stabilised anchors exist to remove, and a trace through the wrong
       * homography is worse than no trace: it is a confident claim about the wrong piece of skin.
       */
      const live = livePro?.current ?? null;
      const consistent =
        projection !== null &&
        live !== null &&
        live.anchors.length === live.convention &&
        live.convention === projection.convention;
      const quad = consistent ? live.anchors : null;
      /*
       * The canonical square is built at the size the POLYLINES are expressed in AND under the
       * convention they were traced in. MASK_SIZE rather than the crop's 256, because the field lives
       * there; `canonicalAnchors(convention)` rather than a fixed four-corner square, because a
       * 5-anchor crop was fitted to five targets and reproducing it from four is a different
       * transform.
       */
      const targets = consistent && projection !== null ? canonicalAnchors(projection.convention, MASK_SIZE) : null;
      const cropToVideo: Matrix3 | null =
        quad === null || targets === null ? null : solveHomography(targets, quad);
      if (cropToVideo === null) {
        rafRef.current = requestAnimationFrame(draw);
        return;
      }
      const project = (point: Point2): Point2 | null => {
        const inVideo = applyHomography(cropToVideo, point);
        return inVideo === null ? null : videoPxToCanvas(transform, inVideo);
      };

      /*
       * Mount-zone dots used to be scattered here through the crop homography. They were positional
       * guides, never measurements — the scan does not read mount prominence — and they added a field
       * of cyan speckle across the palm that competed with the one thing this overlay is for. Gone
       * entirely, along with their generator; the reading view still renders real mount values.
       */

      /* -------------------------------- Lines --------------------------------- */
      /*
       * Any trace at all is worth drawing; confidence scales opacity from faint to solid, and age
       * fades it. The decay is computed from elapsed milliseconds rather than a per-frame constant
       * because frame rate is not a clock — a phone that drops to 15fps must fade at the same real
       * rate as one holding 60, and a backgrounded tab must not freeze a stale trace at full brightness.
       */
      const age = evidenceAt > 0 ? Math.max(0, timestamp - evidenceAt) : 0;
      const freshness =
        evidenceAt === 0
          ? 1
          : TRACE_DECAY_FLOOR + (1 - TRACE_DECAY_FLOOR) * Math.pow(0.5, age / TRACE_HALF_LIFE_MS);
      const warming = traces.length === 0;
      const traceAlpha =
        (TRACE_MIN_ALPHA + Math.min(1, Math.max(0, fused)) * (1 - TRACE_MIN_ALPHA)) *
        freshness *
        (gateOk ? 1 : GATE_FAIL_ALPHA) *
        (named ? 1 : UNNAMED_ALPHA);

      /*
       * Minor traces first, so the named lines draw over them rather than under.
       *
       * Each is scaled by its own measured depth: a faint crease is drawn faint. That is the same
       * honesty the depth feature carries into the reading — the overlay should not make a shallow
       * mark look like a deep one any more than the feature bag should.
       */
      if (layer === "LINES" && minor !== undefined && minor.length > 0) {
        context.save();
        context.strokeStyle = LINE_GLOW;
        context.lineCap = "round";
        context.lineJoin = "round";
        context.lineWidth = MINOR_WIDTH;
        context.shadowBlur = 0;
        for (const trace of minor) {
          if (trace.points.length < 2) continue;
          const depth = Math.min(1, Math.max(0, trace.depth) / DEPTH_FULL);
          context.globalAlpha = traceAlpha * MINOR_ALPHA * (0.4 + 0.6 * depth);
          context.beginPath();
          let started = false;
          for (const point of trace.points) {
            const projected = project(point);
            if (projected === null) continue;
            if (started) context.lineTo(projected.x, projected.y);
            else {
              context.moveTo(projected.x, projected.y);
              started = true;
            }
          }
          context.stroke();
        }
        context.restore();
      }

      // Lane D TRACES layer: every classified trace, projected, with class + score.
      if (layer === "TRACES" && diag !== null && diag !== undefined) {
        context.save();
        context.lineCap = "round";
        context.lineJoin = "round";
        context.font = "10px ui-monospace, monospace";
        for (const trace of diag.classified) {
          if (trace.points.length < 2) continue;
          context.strokeStyle = trace.classScore >= MIN_CLASS_SCORE ? LINE_GLOW : "rgba(160,160,160,0.7)";
          context.lineWidth = 1.25;
          context.globalAlpha = 0.9;
          context.beginPath();
          let started = false;
          for (const point of trace.points) {
            const projected = project(point);
            if (projected === null) continue;
            if (started) context.lineTo(projected.x, projected.y);
            else {
              context.moveTo(projected.x, projected.y);
              started = true;
            }
          }
          context.stroke();
          const mid = project(trace.points[Math.floor(trace.points.length / 2)]);
          if (mid !== null) {
            context.fillStyle = DIAG_TEXT;
            context.fillText(`${trace.class} ${trace.classScore.toFixed(2)}`, mid.x + 4, mid.y - 4);
          }
        }
        context.restore();
      }

      if (layer === "LINES" && !warming) {
        /*
         * Stroked run by run rather than poly by poly, so an inferred stretch can carry its own
         * alpha. Each run overlaps its neighbour by one point, which is what keeps the joins
         * seamless — stroking [from, to) exclusively would leave a hairline gap at every boundary.
         */
        let strokedThisFrame = 0;
        const strokePaths = (scale: number, count = false) => {
          traces.forEach((poly, index) => {
            if (poly.length < 2) return;
            const runs = traceSegments?.[index] ?? [{ from: 0, to: poly.length, observed: true }];
            for (const run of runs) {
              const stop = Math.min(poly.length, run.to + 1);
              if (stop - run.from < 2) continue;
              context.globalAlpha = scale * (run.observed ? 1 : INFERRED_ALPHA);
              context.beginPath();
              let started = false;
              for (let i = run.from; i < stop; i += 1) {
                const projected = project(poly[i]);
                if (projected === null) continue;
                if (!started) {
                  context.moveTo(projected.x, projected.y);
                  started = true;
                } else {
                  context.lineTo(projected.x, projected.y);
                }
              }
              context.stroke();
              if (count && started) strokedThisFrame += 1;
            }
          });
        };

        context.save();
        context.lineCap = "round";
        context.lineJoin = "round";
        context.strokeStyle = LINE_GLOW;

        // Pass 1: wide, blurred, low alpha — the bloom.
        context.shadowColor = LINE_GLOW;
        context.shadowBlur = 6;
        context.lineWidth = 6;
        strokePaths(0.45 * traceAlpha);

        // Pass 2: thin, bright — the core that keeps the line legible inside the bloom.
        context.shadowBlur = 0;
        context.lineWidth = 1.5;
        strokePaths(traceAlpha, true);
        context.restore();
        // Reported from inside the draw, after the transform and the alpha have had their say.
        drawnRef.current = traceAlpha > 0.01 ? strokedThisFrame : 0;
      } else if (layer === "LINES" && boundaryCanvas !== null) {
        /*
         * Warming up: sweep the palm so the feed never looks dead while detection ramps.
         *
         * **Clipped to the palm.** The band is a full-width horizontal line in *crop* space, and the
         * crop extends well past the hand — the canonical anchors sit at 0.13–0.85 of it — so
         * projecting it unclipped threw long diagonals across the frame and past the wrist, which is
         * what read as stray crisscross strokes. The clip region is the boundary curve closed back
         * across the knuckles, so the sweep can only ever appear on skin.
         */
        const phase = reduceMotion ? 0.5 : (timestamp % SWEEP_PERIOD_MS) / SWEEP_PERIOD_MS;
        const bandY = phase * MASK_SIZE;
        const left = project({ x: 0, y: bandY });
        const right = project({ x: MASK_SIZE, y: bandY });
        if (left !== null && right !== null) {
          context.save();

          // Close the palm: boundary (thumb ball → … → little knuckle) → index knuckle → back.
          const clip = [...boundaryCanvas, toCanvas(marks[LM.INDEX_MCP])];
          context.beginPath();
          clip.forEach((p, index) => {
            if (index === 0) context.moveTo(p.x, p.y);
            else context.lineTo(p.x, p.y);
          });
          context.closePath();
          context.clip();

          const gradient = context.createLinearGradient(left.x, left.y, right.x, right.y);
          gradient.addColorStop(0, "rgba(53,224,200,0)");
          gradient.addColorStop(0.5, "rgba(53,224,200,0.7)");
          gradient.addColorStop(1, "rgba(53,224,200,0)");
          context.strokeStyle = gradient;
          context.shadowColor = MOUNT_GLOW;
          context.shadowBlur = 10;
          context.lineWidth = 2;
          context.beginPath();
          context.moveTo(left.x, left.y);
          context.lineTo(right.x, right.y);
          context.stroke();
          context.restore();
        }
      }

      rafRef.current = requestAnimationFrame(draw);
    };

    rafRef.current = requestAnimationFrame(draw);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    };
  }, []);

  return (
    <canvas ref={canvasRef} aria-hidden="true" className={className ?? "pointer-events-none absolute inset-0 h-full w-full"} />
  );
}
