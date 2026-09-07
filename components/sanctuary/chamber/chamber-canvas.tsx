"use client";

/**
 * Everything the chamber draws over the camera, in one canvas.
 *
 * §6.3 lists five things — vignette, rim light, constellation, ring, lines with
 * their names — and the obvious build gives each its own element. Under §10's
 * ≤ 3 ms budget that is the wrong shape twice over: every extra canvas over a
 * live video is another full-viewport composited layer, and a per-layer rAF loop
 * means the same landmark array is read four times a frame. So there is one
 * canvas, one loop, one draw, and the passes are ordered the way the scene is
 * lit: the room, then the wheel, then the hand, then what was found on it.
 *
 * NOTHING HERE TOUCHES THE PIPELINE. Every input is a value `useHandScan`
 * already publishes, and the projection below is the one `components/scan/
 * palm-overlay.tsx` documents at length — reproduced rather than imported
 * because that overlay belongs to the existing /scan route, which this work is
 * not allowed to edit. The rule it encodes is the important part and is pinned
 * in this component's test: when the current frame cannot reproduce the
 * convention the traces were traced under, NOTHING is drawn. A trace through
 * the wrong homography is a confident claim about the wrong piece of skin,
 * which is worse than an empty overlay.
 *
 * NO COLOUR LITERAL APPEARS BELOW. Canvas cannot read a CSS variable, so the
 * palette is read once from the element's own computed style — the same
 * `--color-snc-*` tokens every other surface uses — and re-read on resize.
 */

import { useCallback, useEffect, useRef } from "react";
import { applyHomography, canonicalAnchors, solveHomography, type Matrix3 } from "@/lib/scan/rectify";
import { palmBoundary } from "@/lib/scan/landmarks";
import { HAND_BONES } from "@/lib/scan/landmark-index";
import { coverTransform, videoNormToCanvas, videoPxToCanvas, type CoverTransform } from "@/lib/scan/view-transform";
import { MASK_SIZE, type ActiveLineId, type Landmark3, type Point2, type TracedLine } from "@/lib/scan/types";
import { placeLeaders } from "@/lib/sanctuary/chamber-leaders";
import { createFrameCost, type FrameCostSummary } from "@/lib/sanctuary/frame-cost";
import { drawScanRing, ringGeometry } from "./scan-ring";

/** How long a newly found line takes to come up to full brightness. Slow enough to be a reveal. */
const REVEAL_MS = 900;

/** A bridged stretch of a completed line is drawn at this share of an observed one's alpha. */
const INFERRED_ALPHA = 0.4;

/** The constellation's own weights, all well under the lines': the hand is context, the creases are the subject. */
const BONE_ALPHA = 0.22;
const POINT_ALPHA = 0.6;
const BOUNDARY_ALPHA = 0.3;

/** How far the whole feed is taken down before the vignette. See drawRoom. */
const ROOM_DIM_ALPHA = 0.46;

/** Corner brackets on the palm frame, as a fraction of the frame's own diagonal. */
const CORNER_FRACTION = 0.14;

/** The label's size in CSS pixels. Small, the way the reference sets them. */
const LABEL_PX = 14;

/**
 * The clock the frame window is measured on, at module scope.
 *
 * `performance.now` is the only clock with the resolution a 3 ms budget needs.
 * It lives out here because it is impure and a component's render must not be:
 * inline, React's own lint rule flags it, and the rule is right to — a call
 * that happened during a render React later discarded would be a sample of a
 * frame that never drew.
 */
const nowMs = (): number => performance.now();

export interface ChamberCanvasProps {
  readonly landmarks: readonly Landmark3[] | null;
  readonly videoSize: { readonly width: number; readonly height: number } | null;
  /** The named creases, in MASK_SIZE space. Only lines present here are ever drawn or labelled. */
  readonly lines: Partial<Record<ActiveLineId, TracedLine>>;
  readonly projection: { readonly anchors: readonly Point2[]; readonly convention: number } | null;
  readonly liveProjection?: { readonly current: { readonly anchors: readonly Point2[]; readonly convention: number } | null };
  /** 0–1 of the tilt choreography, which is what fills the ring's sectors. */
  readonly poseProgress: number;
  readonly mirrored: boolean;
  /** The gate's verdict. Dims the constellation; never hides a crease that was found. */
  readonly gatePassing: boolean;
  /** Called with the frame-cost summary as it updates, so the route can report §10's number. */
  readonly onCost?: (summary: FrameCostSummary | null) => void;
  readonly className?: string;
}

interface Palette {
  readonly gold: string;
  readonly foil: string;
  readonly warm: string;
  readonly ink: string;
  /** The room's deepest ground — what the vignette's edge reaches, and never black. */
  readonly stone: string;
  readonly font: string;
}

/** Read the sanctuary tokens off the element, so this file owns no colour of its own. */
function readPalette(element: HTMLElement): Palette {
  const style = getComputedStyle(element);
  const token = (name: string): string => style.getPropertyValue(name).trim();
  return {
    gold: token("--color-snc-gold-500"),
    foil: token("--color-snc-gold-400"),
    warm: token("--color-snc-flame-warm"),
    ink: token("--color-snc-ink"),
    stone: token("--color-snc-stone-900"),
    /* The Devanagari face, resolved: canvas needs a family name, and the CSS
       variable it comes from only resolves on an element. */
    font: style.fontFamily,
  };
}

export function ChamberCanvas({
  landmarks,
  videoSize,
  lines,
  projection,
  liveProjection,
  poseProgress,
  mirrored,
  gatePassing,
  onCost,
  className,
}: ChamberCanvasProps): React.ReactElement {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  /* Props are read through a ref inside the loop rather than closed over, so the
     rAF chain is started once per mount instead of being torn down and rebuilt
     on every landmark update — which at frame rate is a cancel and a schedule
     per frame, and shows up in exactly the measurement this component reports. */
  const propsRef = useRef({ landmarks, videoSize, lines, projection, liveProjection, poseProgress, mirrored, gatePassing });
  /* Written in an effect rather than during render. Writing a ref while
     rendering is what `react-hooks/refs` forbids, and the rule is right: React
     may render this component and throw the result away, and a ref written on a
     discarded render is state the loop would then draw from. */
  useEffect(() => {
    propsRef.current = { landmarks, videoSize, lines, projection, liveProjection, poseProgress, mirrored, gatePassing };
  }, [landmarks, videoSize, lines, projection, liveProjection, poseProgress, mirrored, gatePassing]);

  const costRef = useRef(createFrameCost(nowMs));
  const onCostRef = useRef(onCost);
  useEffect(() => {
    onCostRef.current = onCost;
  }, [onCost]);

  /** When each line was first seen, so a reveal is a ramp rather than a pop. */
  const firstSeenRef = useRef(new Map<string, number>());

  const setCanvas = useCallback((node: HTMLCanvasElement | null) => {
    canvasRef.current = node;
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return;
    const context = canvas.getContext("2d");
    if (context === null) return;

    let palette = readPalette(canvas);
    let raf = 0;
    let started = 0;
    let lastReport = 0;

    /*
     * THE BACKING STORE IS IN DEVICE PIXELS AND EVERY DRAW IS IN CSS PIXELS,
     * and the transform below is what keeps those two facts from colliding.
     *
     * Without it the first capture came out drawn at half scale on a 2× screen:
     * a 13px label rendered at 13 DEVICE pixels, which is 6.5 CSS pixels — a
     * line name too small to read — and the gutter that keeps names off the
     * edge was 7 CSS pixels wide, so the first label was clipped by the
     * viewport. Everything below is now stated in the units it was designed in.
     */
    const resize = (): void => {
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      const rect = canvas.getBoundingClientRect();
      canvas.width = Math.max(1, Math.round(rect.width * ratio));
      canvas.height = Math.max(1, Math.round(rect.height * ratio));
      dpr = ratio;
      box = { width: rect.width, height: rect.height };
      palette = readPalette(canvas);
    };
    let dpr = 1;
    let box = { width: 1, height: 1 };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);

    const frame = (timestamp: number): void => {
      if (started === 0) started = timestamp;
      costRef.current.measure(() => {
        context.setTransform(dpr, 0, 0, dpr, 0, 0);
        drawChamber(context, box, palette, propsRef.current, firstSeenRef.current, timestamp, timestamp - started);
      });
      /* Reported four times a second rather than every frame: a readout that
         re-renders React sixty times a second is itself a frame cost, and would
         be measuring the instrument. */
      if (timestamp - lastReport > 250) {
        lastReport = timestamp;
        onCostRef.current?.(costRef.current.summary());
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
    };
  }, []);

  return <canvas ref={setCanvas} aria-hidden="true" className={className} />;
}

/* ============================== the drawing =============================== */

interface DrawState {
  readonly landmarks: readonly Landmark3[] | null;
  readonly videoSize: { readonly width: number; readonly height: number } | null;
  readonly lines: Partial<Record<ActiveLineId, TracedLine>>;
  readonly projection: { readonly anchors: readonly Point2[]; readonly convention: number } | null;
  readonly liveProjection?: { readonly current: { readonly anchors: readonly Point2[]; readonly convention: number } | null };
  readonly poseProgress: number;
  readonly mirrored: boolean;
  readonly gatePassing: boolean;
}

/**
 * One frame.
 *
 * Exported for the test, which drives it against a recording context and checks
 * what was drawn rather than how it looked — the questions worth asking of an
 * overlay are "did it draw a line it had no evidence for" and "did it leave the
 * context as it found it", and both are answerable from a call log.
 */
export function drawChamber(
  context: CanvasRenderingContext2D,
  canvas: { readonly width: number; readonly height: number },
  palette: Palette,
  state: DrawState,
  firstSeen: Map<string, number>,
  timestamp: number,
  elapsedMs: number,
): void {
  const width = canvas.width;
  const height = canvas.height;

  context.clearRect(0, 0, width, height);

  /* ── 1. the room ───────────────────────────────────────────────────────────
     A vignette to near-black, and one warm source. Both are the SCENE and are
     drawn whether or not a hand has been seen: a chamber that only becomes a
     chamber once it recognises you is a loading state wearing an atmosphere. */
  drawRoom(context, width, height, palette, state.landmarks);

  /* ── 2. the wheel ──────────────────────────────────────────────────────── */
  drawScanRing(context, {
    width,
    height,
    /* 1, because the context is already scaled: a "hairline" here means one CSS
       pixel, and dividing by the device ratio a second time would halve it into
       the sub-pixel blur the scaling exists to avoid. */
    dpr: 1,
    elapsedMs,
    progress: state.poseProgress,
    palette: { line: palette.gold, fill: palette.warm },
  });

  const marks = state.landmarks;
  if (marks === null || marks.length < 21 || state.videoSize === null) return;

  const transform = coverTransform(state.videoSize.width, state.videoSize.height, width, height, state.mirrored);
  /* A degenerate camera box has no cover transform, and there is nothing honest
     to draw through: the hand would land wherever a fallback put it. */
  if (transform === null) return;
  const toCanvas = (p: Point2): Point2 => videoNormToCanvas(transform, p);

  /* ── 3. the hand ───────────────────────────────────────────────────────── */
  drawConstellation(context, marks, toCanvas, palette, state.gatePassing);

  /* ── 4. what was found on it ───────────────────────────────────────────── */
  const project = traceProjector(state, transform);
  if (project === null) return;
  drawFoundLines(context, state.lines, project, palette, firstSeen, timestamp, { width, height });
}

/**
 * The mask-space → canvas projector, or null when this frame cannot reproduce
 * the convention the traces were traced under.
 *
 * Null is the load-bearing return. The tempting fallback — project through raw
 * landmarks instead — is what `palm-overlay` measured at 4.6 video pixels off
 * the crease it came from, which is comparable to a crease's whole width: the
 * lines then sit convincingly BESIDE the creases rather than on them, and look
 * entirely correct while being wrong.
 */
function traceProjector(state: DrawState, transform: CoverTransform): ((p: Point2) => Point2 | null) | null {
  const live = state.liveProjection?.current ?? null;
  const projection = state.projection;
  const consistent =
    projection !== null && live !== null && live.anchors.length === live.convention && live.convention === projection.convention;
  if (!consistent || projection === null || live === null) return null;

  const targets = canonicalAnchors(projection.convention, MASK_SIZE);
  if (targets === null) return null;
  const cropToVideo: Matrix3 | null = solveHomography(targets, live.anchors);
  if (cropToVideo === null) return null;

  return (point: Point2): Point2 | null => {
    const inVideo = applyHomography(cropToVideo, point);
    return inVideo === null ? null : videoPxToCanvas(transform, inVideo);
  };
}

/** The vignette and the one warm rim light, which together are the room. */
function drawRoom(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  palette: Palette,
  marks: readonly Landmark3[] | null,
): void {
  const { cx, cy, radius } = ringGeometry(width, height);

  /*
   * THE FEED IS DIMMED BEFORE IT IS VIGNETTED, and the first capture is why.
   * A vignette alone darkens the edges of whatever it is given, and what it was
   * given was a photograph of a bright wall: the corners went to stone and the
   * middle stayed the brightest thing on the screen. A chamber lit like a
   * kitchen is not a chamber. The even wash takes the room down first, and the
   * vignette then takes its edges to near-black on top of that — which together
   * is the reading light §6.3 asks for, with the hand the only thing in it.
   */
  context.save();
  context.globalAlpha = ROOM_DIM_ALPHA;
  context.fillStyle = palette.ink;
  context.fillRect(0, 0, width, height);
  context.globalAlpha = 1;

  const vignette = context.createRadialGradient(cx, cy, radius * 0.45, cx, cy, Math.max(width, height) * 0.72);
  vignette.addColorStop(0, "transparent");
  vignette.addColorStop(1, palette.stone);
  context.fillStyle = vignette;
  context.globalAlpha = 0.96;
  context.fillRect(0, 0, width, height);
  context.restore();

  /* ONE warm source, on the hand's own side.
     Its position follows the palm rather than sitting at a fixed corner: a rim
     light that stays put while the hand moves is a gradient, and a gradient is
     not a light. With no hand yet it rests above the scene, which is where the
     sanctuary's one source always is. */
  const side = marks === null || marks.length < 21 ? 0.5 : marks[0].x < 0.5 ? 0.22 : 0.78;
  context.save();
  const rim = context.createRadialGradient(width * side, height * 0.3, 0, width * side, height * 0.3, radius * 1.5);
  rim.addColorStop(0, palette.warm);
  rim.addColorStop(1, "transparent");
  context.globalAlpha = 0.1;
  context.fillStyle = rim;
  context.fillRect(0, 0, width, height);
  context.restore();
}

/** Gold points, hairline bones, and a palm frame with engraved corners rather than a box. */
function drawConstellation(
  context: CanvasRenderingContext2D,
  marks: readonly Landmark3[],
  toCanvas: (p: Point2) => Point2,
  palette: Palette,
  gatePassing: boolean,
): void {
  /* The gate governs what may be CLAIMED, never what may be shown, so a failing
     gate dims the constellation instead of removing it. A hand that vanishes
     when it drifts out of pose reads as a tracking failure. */
  const dim = gatePassing ? 1 : 0.55;

  context.save();
  context.strokeStyle = palette.gold;
  context.lineWidth = 1;
  context.globalAlpha = BONE_ALPHA * dim;
  context.beginPath();
  for (const [from, to] of HAND_BONES) {
    const a = toCanvas(marks[from]);
    const b = toCanvas(marks[to]);
    context.moveTo(a.x, a.y);
    context.lineTo(b.x, b.y);
  }
  context.stroke();

  context.globalAlpha = POINT_ALPHA * dim;
  context.fillStyle = palette.foil;
  context.beginPath();
  for (const mark of marks) {
    const p = toCanvas(mark);
    context.moveTo(p.x + 1.6, p.y);
    context.arc(p.x, p.y, 1.6, 0, Math.PI * 2);
  }
  context.fill();

  const boundary = palmBoundary(marks);
  if (boundary !== null && boundary.length >= 4) {
    const quad = boundary.map(toCanvas);
    context.globalAlpha = BOUNDARY_ALPHA * dim;
    context.strokeStyle = palette.gold;
    context.beginPath();
    for (let i = 0; i < quad.length; i += 1) {
      const a = quad[i];
      const b = quad[(i + 1) % quad.length];
      /* ENGRAVED CORNERS, NOT A BOX. Only the ends of each edge are drawn, so
         the palm is bracketed rather than boxed — a full rectangle around
         somebody's hand is a viewfinder, and a viewfinder is camera software. */
      const run = CORNER_FRACTION;
      context.moveTo(a.x, a.y);
      context.lineTo(a.x + (b.x - a.x) * run, a.y + (b.y - a.y) * run);
      context.moveTo(b.x, b.y);
      context.lineTo(b.x + (a.x - b.x) * run, b.y + (a.y - b.y) * run);
    }
    context.stroke();
  }
  context.restore();
}

/** The creases, revealed as they are found, each with its name on a thin leader. */
function drawFoundLines(
  context: CanvasRenderingContext2D,
  lines: Partial<Record<ActiveLineId, TracedLine>>,
  project: (p: Point2) => Point2 | null,
  palette: Palette,
  firstSeen: Map<string, number>,
  timestamp: number,
  box: { readonly width: number; readonly height: number },
): void {
  const drawn: { id: string; points: Point2[] }[] = [];

  for (const [id, line] of Object.entries(lines)) {
    if (line === undefined || line.points.length < 2) continue;
    if (!firstSeen.has(id)) firstSeen.set(id, timestamp);
    const points: Point2[] = [];
    for (const [x, y] of line.points) {
      const p = project({ x, y });
      /* A point that will not project is dropped rather than clamped: a clamped
         point is a coordinate invented to keep a line looking continuous. */
      if (p !== null) points.push(p);
    }
    if (points.length < 2) continue;
    drawn.push({ id, points });

    const age = timestamp - (firstSeen.get(id) ?? timestamp);
    const reveal = Math.min(1, Math.max(0, age / REVEAL_MS));
    const segments = line.segments;

    context.save();
    context.strokeStyle = palette.foil;
    context.lineWidth = 2;
    context.lineJoin = "round";
    context.lineCap = "round";
    context.shadowColor = palette.warm;
    context.shadowBlur = 6 * reveal;

    if (segments === undefined || segments.length === 0) {
      context.globalAlpha = reveal;
      strokePath(context, points);
    } else {
      /* Observed and bridged stretches at different weights — the same honesty
         the feature bag carries: a stretch where no crease was seen is drawn
         as the inference it is. */
      for (const segment of segments) {
        const slice = points.slice(segment.from, segment.to + 1);
        if (slice.length < 2) continue;
        context.globalAlpha = reveal * (segment.observed ? 1 : INFERRED_ALPHA);
        strokePath(context, slice);
      }
    }
    context.restore();
  }

  /* The names, last, so a leader is never drawn under a crease. Passed in the
     order the lines were found, which is the order `placeLeaders` keeps. */
  const placed = placeLeaders(drawn, box);
  if (placed.length === 0) return;

  context.save();
  context.font = `${LABEL_PX}px ${palette.font}`;
  context.textBaseline = "middle";
  /* The LEADER is linework gold and the NAME is foil: a hairline rule and a word
     are different jobs, and on the dimmed room gold-500 at label size reads as a
     smudge where gold-400 reads as a word. The reference sets these names small
     and bright, on the ground, with the rule quieter than the word it carries. */
  context.strokeStyle = palette.gold;
  context.fillStyle = palette.foil;
  context.lineWidth = 1;

  for (const leader of placed) {
    const age = timestamp - (firstSeen.get(leader.id) ?? timestamp);
    context.globalAlpha = Math.min(1, Math.max(0, age / REVEAL_MS));

    context.beginPath();
    context.moveTo(leader.anchor.x, leader.anchor.y);
    context.lineTo(leader.elbow.x, leader.elbow.y);
    if (leader.label.y !== leader.elbow.y) context.lineTo(leader.label.x, leader.label.y);
    context.stroke();

    /* NO BACKGROUND, NO PILL, NO BOX — the reference sets these names directly
       on the ground, and a plate behind one would be a tooltip arriving in the
       middle of a ceremony. */
    context.textAlign = leader.side === "left" ? "left" : "right";
    const inset = leader.side === "left" ? 6 : -6;
    context.fillText(leader.name, leader.label.x + inset, leader.label.y);
  }
  context.restore();
}

function strokePath(context: CanvasRenderingContext2D, points: readonly Point2[]): void {
  context.beginPath();
  context.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i += 1) context.lineTo(points[i].x, points[i].y);
  context.stroke();
}
