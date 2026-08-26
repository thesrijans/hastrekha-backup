"use client";

import { useEffect, useRef } from "react";
import { applyHomography, canonicalQuad, palmQuad, solveHomography, PALM_ANCHORS, type Matrix3 } from "@/lib/scan/rectify";
import { palmBoundary } from "@/lib/scan/landmarks";
import { catmullRomSegments } from "@/lib/scan/curve";
import { HAND_BONES, LM } from "@/lib/scan/landmark-index";
import { coverTransform, videoNormToCanvas, videoPxToCanvas, type CoverTransform } from "@/lib/scan/view-transform";
import type { Poly } from "@/lib/scan/lines";
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

const ANCHOR_SET = new Set<number>(PALM_ANCHORS);

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
  onDrawn,
  evidenceAtMs,
  mirrored,
  edgePeak,
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
    evidenceAtMs,
    mirrored,
    edgePeak,
  });
  useEffect(() => {
    stateRef.current = {
      landmarks,
      videoSize,
      polys,
      segments,
      confidence,
      gatePassing,
      tracesNamed,
      evidenceAtMs,
      mirrored,
      edgePeak,
    };
  }, [landmarks, videoSize, polys, segments, confidence, gatePassing, tracesNamed, evidenceAtMs, mirrored, edgePeak]);

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
        evidenceAtMs: evidenceAt,
        mirrored: flip,
        edgePeak: peakOverride,
      } = stateRef.current;

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
      const quad = palmQuad(marks, transform.videoW, transform.videoH);
      /*
       * The canonical square must be built at the size the POLYLINES are expressed in, not at the
       * crop's. They are traced from the fused field, which lives at MASK_SIZE — using the crop's 256
       * here would map every trace through a homography twice its scale and paint the whole set into
       * the top-left quadrant of the palm, which looks exactly like "the lines are slightly wrong"
       * rather than like a units bug.
       */
      const cropToVideo: Matrix3 | null = quad === null ? null : solveHomography(canonicalQuad(MASK_SIZE), quad);
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

      if (!warming) {
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
      } else if (boundaryCanvas !== null) {
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
