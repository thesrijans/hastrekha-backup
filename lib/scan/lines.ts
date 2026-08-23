/**
 * Fused mask → named lines → engine features.
 *
 * This is the layer the pipeline sketch called "line geometry", and it is where the accuracy really
 * lives. The model is `n_classes=1`: it says "line here", never "heart line here". Everything below
 * turns a probability field into four *named* lines and then into the KB's vocabulary, which is
 * almost entirely categorical — `lines.head.origin` is one of four enum values, not a number.
 *
 * Pipeline: threshold → Zhang-Suen thinning → trace polylines → simplify → assign by landmark
 * topology → derive features.
 *
 * Everything works in rectified crop space, where the canonical anchors put the wrist, knuckles and
 * thumb root at known coordinates (see `zones.ts`). That is what makes "does this line start under
 * the index finger" a coordinate test instead of a learned one.
 *
 * **Only feature keys that exist in `data/kb/hastrekha_kb.features.json` are emitted.** The mapping
 * is exported as {@link FEATURE_MAPPING} so it can be printed and audited rather than trusted.
 */
import type { FeatureBag } from "@/lib/hastrekha";
import { applyHomography, canonicalQuad, solveHomography } from "./rectify";
import { EDGE_ZONES, HEART_END_ZONES, nearestZone, RESERVED_EDGE_ZONES } from "./zones";
import { ACTIVE_LINE_IDS, RECTIFIED_SIZE, type ActiveLineId, type Point2, type TracedLine } from "./types";

/** A pixel is part of a line above this probability. */
export const LINE_THRESHOLD = 0.45;
/** Traces shorter than this fraction of the crop are noise, not lines. */
const MIN_TRACE_FRACTION = 0.12;
/** Douglas-Peucker tolerance, in crop pixels. */
const SIMPLIFY_EPSILON = 1.6;
/** A gap in the skeleton wider than this counts as a break in the line. */
const BREAK_GAP_PX = 6;

export type Poly = readonly Point2[];

/* ------------------------------- Morphology ------------------------------- */

export function binarize(field: Float32Array, threshold: number = LINE_THRESHOLD): Uint8Array {
  const out = new Uint8Array(field.length);
  for (let i = 0; i < field.length; i += 1) out[i] = field[i] >= threshold ? 1 : 0;
  return out;
}

/** Eight neighbours, clockwise from north — the ordering Zhang-Suen's transition count assumes. */
function neighbours(binary: Uint8Array, size: number, x: number, y: number): number[] {
  const at = (nx: number, ny: number): number =>
    nx < 0 || ny < 0 || nx >= size || ny >= size ? 0 : binary[ny * size + nx];
  return [
    at(x, y - 1),
    at(x + 1, y - 1),
    at(x + 1, y),
    at(x + 1, y + 1),
    at(x, y + 1),
    at(x - 1, y + 1),
    at(x - 1, y),
    at(x - 1, y - 1),
  ];
}

/** 0→1 transitions walking the neighbour ring; 1 means the pixel is on a simple arc. */
function transitions(ring: readonly number[]): number {
  let count = 0;
  for (let i = 0; i < ring.length; i += 1) {
    if (ring[i] === 0 && ring[(i + 1) % ring.length] === 1) count += 1;
  }
  return count;
}

/**
 * Zhang-Suen thinning: erodes a blob to a one-pixel skeleton without breaking connectivity.
 *
 * A segmentation mask gives lines several pixels wide, and width varies with pressure and lighting.
 * Measuring length, curvature or forks off a variable-width blob is meaningless; off a skeleton it
 * is well defined. Width is not thrown away — it is captured separately as the depth proxy.
 */
export function thin(binary: Uint8Array, size: number, maxIterations = 60): Uint8Array {
  const image = Uint8Array.from(binary);
  const marked: number[] = [];

  for (let iteration = 0; iteration < maxIterations; iteration += 1) {
    let changed = false;

    for (const step of [0, 1]) {
      marked.length = 0;
      for (let y = 1; y < size - 1; y += 1) {
        for (let x = 1; x < size - 1; x += 1) {
          const index = y * size + x;
          if (image[index] === 0) continue;

          const ring = neighbours(image, size, x, y);
          const filled = ring.reduce((sum, value) => sum + value, 0);
          if (filled < 2 || filled > 6) continue;
          if (transitions(ring) !== 1) continue;

          const [n, ne, e, se, s, sw, w, nw] = ring;
          if (step === 0) {
            if (n * e * s !== 0) continue;
            if (e * s * w !== 0) continue;
          } else {
            if (n * e * w !== 0) continue;
            if (n * s * w !== 0) continue;
          }
          void ne;
          void se;
          void sw;
          void nw;
          marked.push(index);
        }
      }
      for (const index of marked) image[index] = 0;
      if (marked.length > 0) changed = true;
    }

    if (!changed) break;
  }

  return image;
}

/* -------------------------------- Tracing --------------------------------- */

const OFFSETS: ReadonlyArray<readonly [number, number]> = [
  [0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1],
];

function filledNeighbours(skeleton: Uint8Array, size: number, x: number, y: number): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (const [dx, dy] of OFFSETS) {
    const nx = x + dx;
    const ny = y + dy;
    if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
    if (skeleton[ny * size + nx] === 1) out.push([nx, ny]);
  }
  return out;
}

export interface TraceStats {
  /** Skeleton pixels with three or more neighbours — where a line forks. */
  readonly branchPoints: number;
}

/**
 * Walks the skeleton into polylines.
 *
 * Starts from endpoints (one neighbour) so traces run end to end rather than from an arbitrary
 * middle. At a junction the walk continues into whichever neighbour best preserves direction, which
 * keeps a long line intact instead of chopping it in three every time a small branch leaves it.
 */
export function tracePolylines(skeleton: Uint8Array, size: number): { polys: Poly[]; stats: TraceStats } {
  const visited = new Uint8Array(skeleton.length);
  const polys: Poly[] = [];
  let branchPoints = 0;

  const degree = (x: number, y: number): number => filledNeighbours(skeleton, size, x, y).length;

  const starts: Array<[number, number]> = [];
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      if (skeleton[y * size + x] === 0) continue;
      const d = degree(x, y);
      if (d >= 3) branchPoints += 1;
      if (d === 1) starts.push([x, y]);
    }
  }

  const walk = (sx: number, sy: number): Point2[] => {
    const points: Point2[] = [];
    let x = sx;
    let y = sy;
    let dx = 0;
    let dy = 0;

    for (;;) {
      visited[y * size + x] = 1;
      points.push({ x, y });

      const options = filledNeighbours(skeleton, size, x, y).filter(([nx, ny]) => visited[ny * size + nx] === 0);
      if (options.length === 0) break;

      let best = options[0];
      if (options.length > 1 && (dx !== 0 || dy !== 0)) {
        let bestDot = -Infinity;
        for (const [nx, ny] of options) {
          const vx = nx - x;
          const vy = ny - y;
          const magnitude = Math.hypot(vx, vy) * Math.hypot(dx, dy);
          const dot = magnitude < 1e-9 ? 0 : (vx * dx + vy * dy) / magnitude;
          if (dot > bestDot) {
            bestDot = dot;
            best = [nx, ny];
          }
        }
      }
      dx = best[0] - x;
      dy = best[1] - y;
      x = best[0];
      y = best[1];
    }
    return points;
  };

  for (const [sx, sy] of starts) {
    if (visited[sy * size + sx] === 1) continue;
    const points = walk(sx, sy);
    if (points.length >= 2) polys.push(points);
  }

  // Closed loops have no endpoint to start from; pick them up on a second sweep.
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      if (skeleton[y * size + x] === 0 || visited[y * size + x] === 1) continue;
      const points = walk(x, y);
      if (points.length >= 2) polys.push(points);
    }
  }

  const minLength = size * MIN_TRACE_FRACTION;
  return { polys: polys.filter((poly) => polylineLength(poly) >= minLength), stats: { branchPoints } };
}

export function polylineLength(poly: Poly): number {
  let total = 0;
  for (let i = 1; i < poly.length; i += 1) total += Math.hypot(poly[i].x - poly[i - 1].x, poly[i].y - poly[i - 1].y);
  return total;
}

/** Douglas-Peucker. Keeps the overlay cheap: a few dozen points instead of a few hundred. */
export function simplify(poly: Poly, epsilon: number = SIMPLIFY_EPSILON): Poly {
  if (poly.length < 3) return poly;
  const first = poly[0];
  const last = poly[poly.length - 1];

  let maxDistance = 0;
  let index = 0;
  const dx = last.x - first.x;
  const dy = last.y - first.y;
  const norm = Math.hypot(dx, dy);

  for (let i = 1; i < poly.length - 1; i += 1) {
    const distance =
      norm < 1e-9
        ? Math.hypot(poly[i].x - first.x, poly[i].y - first.y)
        : Math.abs(dy * poly[i].x - dx * poly[i].y + last.x * first.y - last.y * first.x) / norm;
    if (distance > maxDistance) {
      maxDistance = distance;
      index = i;
    }
  }

  if (maxDistance <= epsilon) return [first, last];
  return [...simplify(poly.slice(0, index + 1), epsilon).slice(0, -1), ...simplify(poly.slice(index), epsilon)];
}

/* ------------------------------ Classification ---------------------------- */

interface LineSpec {
  readonly id: ActiveLineId;
  /** Expected endpoints in 0–1 crop space; traces may run either way, so both are tried. */
  readonly from: Point2;
  readonly to: Point2;
  /** 0 = horizontal, 1 = vertical. */
  readonly verticality: number;
}

/**
 * Where each line is expected to run, in crop fractions.
 *
 * Heart above head, both roughly horizontal; life arcing down the thumb side; fate rising from the
 * wrist. These are the classical positions, and rectification is what makes them constants.
 */
/**
 * Percussion-edge zones this module does not yet extract, re-exported so the gap is visible from the
 * place that would consume them. See `RESERVED_LINE_IDS` in types.ts for the matching vocabulary.
 */
export { RESERVED_EDGE_ZONES };

export const LINE_SPECS: readonly LineSpec[] = [
  { id: "heart", from: { x: 0.9, y: 0.3 }, to: { x: 0.22, y: 0.22 }, verticality: 0.15 },
  { id: "head", from: { x: 0.2, y: 0.32 }, to: { x: 0.78, y: 0.5 }, verticality: 0.2 },
  { id: "life", from: { x: 0.22, y: 0.26 }, to: { x: 0.44, y: 0.92 }, verticality: 0.75 },
  { id: "fate", from: { x: 0.5, y: 0.93 }, to: { x: 0.47, y: 0.3 }, verticality: 0.9 },
];

function orientationOf(poly: Poly): number {
  const first = poly[0];
  const last = poly[poly.length - 1];
  const dx = Math.abs(last.x - first.x);
  const dy = Math.abs(last.y - first.y);
  return dx + dy < 1e-9 ? 0.5 : dy / (dx + dy);
}

/** Endpoint fit (either direction) plus orientation fit, 0–1. */
function scoreAs(poly: Poly, spec: LineSpec, size: number): { score: number; reversed: boolean } {
  const first = poly[0];
  const last = poly[poly.length - 1];
  const from = { x: spec.from.x * size, y: spec.from.y * size };
  const to = { x: spec.to.x * size, y: spec.to.y * size };

  const forward = Math.hypot(first.x - from.x, first.y - from.y) + Math.hypot(last.x - to.x, last.y - to.y);
  const backward = Math.hypot(last.x - from.x, last.y - from.y) + Math.hypot(first.x - to.x, first.y - to.y);
  const reversed = backward < forward;
  const endpointError = Math.min(forward, backward) / (size * 1.4);

  const orientationError = Math.abs(orientationOf(poly) - spec.verticality);
  const score = Math.max(0, 1 - endpointError) * 0.7 + Math.max(0, 1 - orientationError) * 0.3;
  return { score, reversed };
}

export const MIN_ASSIGN_SCORE = 0.45;

/**
 * Greedy assignment of traces to the four named lines.
 *
 * Greedy rather than optimal because the alternative is a Hungarian solve over at most four rows,
 * and the scores are far enough apart in practice that the extra machinery would buy nothing. Each
 * trace is used once, so two lines can never claim the same skeleton.
 */
export function assignLines(polys: readonly Poly[], size: number = RECTIFIED_SIZE): Partial<Record<ActiveLineId, Poly>> {
  const candidates: Array<{ id: ActiveLineId; index: number; score: number; reversed: boolean }> = [];
  polys.forEach((poly, index) => {
    for (const spec of LINE_SPECS) {
      const { score, reversed } = scoreAs(poly, spec, size);
      if (score >= MIN_ASSIGN_SCORE) candidates.push({ id: spec.id, index, score, reversed });
    }
  });
  candidates.sort((a, b) => b.score - a.score);

  const out: Partial<Record<ActiveLineId, Poly>> = {};
  const usedPolys = new Set<number>();
  for (const candidate of candidates) {
    if (out[candidate.id] !== undefined || usedPolys.has(candidate.index)) continue;
    const poly = polys[candidate.index];
    out[candidate.id] = candidate.reversed ? [...poly].reverse() : poly;
    usedPolys.add(candidate.index);
  }
  return out;
}

/* -------------------------------- Measures -------------------------------- */

/** Mean probability under the trace: a proxy for how deeply the line is cut. */
function depthProxy(field: Float32Array, poly: Poly, size: number): number {
  let sum = 0;
  let n = 0;
  for (const point of poly) {
    const x = Math.round(point.x);
    const y = Math.round(point.y);
    if (x < 0 || y < 0 || x >= size || y >= size) continue;
    sum += field[y * size + x];
    n += 1;
  }
  return n === 0 ? 0 : sum / n;
}

/** Point-to-point jumps larger than {@link BREAK_GAP_PX} — the line stopping and restarting. */
function breakCount(poly: Poly): number {
  let breaks = 0;
  for (let i = 1; i < poly.length; i += 1) {
    if (Math.hypot(poly[i].x - poly[i - 1].x, poly[i].y - poly[i - 1].y) > BREAK_GAP_PX) breaks += 1;
  }
  return breaks;
}

/** Peak deviation from the straight chord, over chord length. 0 = straight, higher = more bowed. */
function curvature(poly: Poly): number {
  if (poly.length < 3) return 0;
  const first = poly[0];
  const last = poly[poly.length - 1];
  const chord = Math.hypot(last.x - first.x, last.y - first.y);
  if (chord < 1e-6) return 0;
  let maxDistance = 0;
  for (const point of poly) {
    const distance =
      Math.abs((last.y - first.y) * point.x - (last.x - first.x) * point.y + last.x * first.y - last.y * first.x) / chord;
    if (distance > maxDistance) maxDistance = distance;
  }
  return maxDistance / chord;
}

/** Mean turn angle between consecutive segments — wobble that curvature averages away. */
function waviness(poly: Poly): number {
  if (poly.length < 3) return 0;
  let total = 0;
  let n = 0;
  for (let i = 2; i < poly.length; i += 1) {
    const ax = poly[i - 1].x - poly[i - 2].x;
    const ay = poly[i - 1].y - poly[i - 2].y;
    const bx = poly[i].x - poly[i - 1].x;
    const by = poly[i].y - poly[i - 1].y;
    const magnitude = Math.hypot(ax, ay) * Math.hypot(bx, by);
    if (magnitude < 1e-9) continue;
    total += Math.acos(Math.min(1, Math.max(-1, (ax * bx + ay * by) / magnitude)));
    n += 1;
  }
  return n === 0 ? 0 : total / n;
}

/* --------------------------- Feature mapping table ------------------------- */

/**
 * Every KB feature key this module can emit, and what produces it.
 *
 * Verified against `data/kb/hastrekha_kb.features.json` — nothing outside that file is ever written,
 * because a key the KB does not know is a silently dead feature, and a *wrong* value fires a real
 * rule on bad evidence.
 */
export const FEATURE_MAPPING: Readonly<Record<string, string>> = {
  "reading.lines_available": "any line assigned",
  "lines.heart.present": "heart trace assigned",
  "lines.heart.length_norm": "arc length / crop width",
  "lines.heart.origin": "terminal (index-side) endpoint → nearest HEART_END_ZONES",
  "lines.heart.depth": "mean mask probability under the trace",
  "lines.heart.breaks": "count of skeleton gaps > 6px",
  "lines.heart.curvature": "chord deviation with a downward terminal slope",
  "lines.head.quality": "continuity × depth proxy, 0–1",
  "lines.head.origin": "distance from head start to life start, in crop px",
  "lines.head.termination": "terminal endpoint position and slope",
  "lines.head.curvature": "chord deviation vs straightness threshold",
  "lines.head.texture": "mean inter-segment turn angle (waviness)",
  "lines.life.arc": "maximum outward excursion from the thumb side",
  "lines.life.breaks_count": "count of skeleton gaps > 6px",
  "lines.life.texture": "depth proxy banded into clear_deep / broad_shallow / chained",
  "lines.life.rise_origin": "start endpoint height relative to the index knuckle",
  "lines.life.sweeps_to_luna": "terminal endpoint crosses the crop midline",
  "lines.fate.present": "fate trace assigned",
  "lines.fate.origin": "start endpoint → nearest of wrist / life / luna / plain of Mars",
  "lines.fate.stopped_at": "terminal endpoint height vs head and heart lines",
  "lines.fate.structure": "breaks and depth proxy",
  "lines.head_heart_blended_single": "exactly one horizontal trace spanning both bands",
  "geometry.quadrangle_shape": "vertical gap between head and heart at mid-palm",
  "lines.quality.wavy": "waviness above threshold on any assigned line",
  "lines.quality.forked_lines_general": "skeleton branch points present",
  "lines.quality.head_end_fork": "branch point within 12px of the head terminal",
};

/* -------------------------------- Extraction ------------------------------ */

export interface LineExtraction {
  readonly lines: Partial<Record<ActiveLineId, TracedLine>>;
  readonly polys: readonly Poly[];
  readonly features: FeatureBag;
  readonly branchPoints: number;
}

/**
 * Full extraction from a fused probability field.
 *
 * Every derived value is a coordinate or intensity measurement against the canonical crop — no
 * feature is emitted on a guess, and a line that was not assigned contributes nothing at all rather
 * than a default.
 */
export function extractLines(field: Float32Array, size: number = RECTIFIED_SIZE): LineExtraction {
  const skeleton = thin(binarize(field), size);
  const { polys: rawPolys, stats } = tracePolylines(skeleton, size);
  const polys = rawPolys.map((poly) => simplify(poly));
  const assigned = assignLines(polys, size);

  const lines: Partial<Record<ActiveLineId, TracedLine>> = {};
  const heart: Record<string, unknown> = {};
  const head: Record<string, unknown> = {};
  const life: Record<string, unknown> = {};
  const fate: Record<string, unknown> = {};
  const quality: Record<string, unknown> = {};
  const geometry: Record<string, unknown> = {};
  const linesBag: Record<string, unknown> = {};
  const reading: Record<string, unknown> = {};

  let maxWaviness = 0;

  for (const id of ACTIVE_LINE_IDS) {
    const poly = assigned[id];
    if (poly === undefined) continue;
    const depth = depthProxy(field, poly, size);
    lines[id] = {
      id,
      points: poly.map((p) => [Number(p.x.toFixed(1)), Number(p.y.toFixed(1))] as const),
      confidence: depth,
    };
    maxWaviness = Math.max(maxWaviness, waviness(poly));
  }

  const heartPoly = assigned.heart;
  const headPoly = assigned.head;
  const lifePoly = assigned.life;
  const fatePoly = assigned.fate;

  if (heartPoly !== undefined) {
    const end = heartPoly[heartPoly.length - 1];
    const depth = depthProxy(field, heartPoly, size);
    heart.present = true;
    heart.length_norm = Number(Math.min(1, polylineLength(heartPoly) / size).toFixed(3));
    heart.origin = nearestZone(HEART_END_ZONES, end, size).value;
    heart.depth = depth > 0.75 ? "deep" : depth > 0.55 ? "thin" : "broad_shallow";
    const breaks = breakCount(heartPoly);
    if (breaks > 0) heart.breaks = breaks;
    // Only claim the classical downward curve when the terminal actually dips below the trace mean.
    const meanY = heartPoly.reduce((sum, p) => sum + p.y, 0) / heartPoly.length;
    if (curvature(heartPoly) > 0.08 && end.y > meanY) heart.curvature = "downward_curve_at_jupiter";
  } else {
    heart.present = false;
  }

  if (headPoly !== undefined) {
    const start = headPoly[0];
    const end = headPoly[headPoly.length - 1];
    const depth = depthProxy(field, headPoly, size);
    const continuity = 1 / (1 + breakCount(headPoly));
    head.quality = Number(Math.min(1, depth * continuity).toFixed(3));

    if (lifePoly !== undefined) {
      const lifeStart = lifePoly[0];
      const separation = Math.hypot(start.x - lifeStart.x, start.y - lifeStart.y) / size;
      head.origin =
        separation < 0.03
          ? "joined_life_line"
          : separation < 0.08
            ? "separated_narrow"
            : start.y > lifeStart.y
              ? "inside_life_line"
              : "separated_wide";
    }

    const drop = (end.y - start.y) / size;
    head.termination =
      drop < -0.04
        ? "upturn_mercury"
        : drop < 0.06
          ? "straight_mental_mars"
          : drop < 0.16
            ? "gentle_slope_luna"
            : "deep_slope_luna";
    head.curvature = curvature(headPoly) > 0.07 ? "sloping_to_luna" : "straight_clear";
    if (waviness(headPoly) > 0.5) head.texture = "irregular";
  }

  if (lifePoly !== undefined) {
    const start = lifePoly[0];
    const end = lifePoly[lifePoly.length - 1];
    const depth = depthProxy(field, lifePoly, size);
    // How far the arc bulges into the palm from the thumb edge.
    const excursion = Math.max(...lifePoly.map((p) => p.x)) / size;
    life.arc = excursion > 0.42 ? "wide_into_palm" : "narrow_hugging_thumb";
    const breaks = breakCount(lifePoly);
    if (breaks > 0) life.breaks_count = breaks;
    life.texture = depth > 0.72 ? "clear_deep" : depth > 0.55 ? "broad_shallow" : "chained";
    life.rise_origin = start.y < 0.3 * size ? "jupiter_side" : "mars_low";
    if (end.x > 0.5 * size) life.sweeps_to_luna = true;
  }

  if (fatePoly !== undefined) {
    const start = fatePoly[0];
    const end = fatePoly[fatePoly.length - 1];
    const depth = depthProxy(field, fatePoly, size);
    fate.present = true;

    const origins = [
      { value: "wrist", ...EDGE_ZONES.wrist },
      { value: "plain_of_mars", ...EDGE_ZONES.plainOfMars },
      { value: "mount_luna", cx: 0.76, cy: 0.66 },
      { value: "life_line", cx: 0.3, cy: 0.72 },
    ];
    fate.origin = nearestZone(origins, start, size).value;

    if (headPoly !== undefined || heartPoly !== undefined) {
      const headY = headPoly === undefined ? Infinity : headPoly.reduce((s, p) => s + p.y, 0) / headPoly.length;
      const heartY = heartPoly === undefined ? Infinity : heartPoly.reduce((s, p) => s + p.y, 0) / heartPoly.length;
      if (Math.abs(end.y - headY) < 0.06 * size) fate.stopped_at = "head_line";
      else if (Math.abs(end.y - heartY) < 0.06 * size) fate.stopped_at = "heart_line";
    }

    const breaks = breakCount(fatePoly);
    if (breaks > 0) fate.structure = "broken_with_overlap";
    else if (depth < 0.5) fate.structure = "faint";
  }

  /* Head and heart fused into one line across the palm — a real and rule-bearing configuration. */
  const horizontals = polys.filter((poly) => orientationOf(poly) < 0.3 && polylineLength(poly) > size * 0.5);
  if (horizontals.length === 1 && (heartPoly === undefined || headPoly === undefined)) {
    linesBag.head_heart_blended_single = true;
  }

  if (headPoly !== undefined && heartPoly !== undefined) {
    const headY = headPoly.reduce((sum, p) => sum + p.y, 0) / headPoly.length;
    const heartY = heartPoly.reduce((sum, p) => sum + p.y, 0) / heartPoly.length;
    const gap = Math.abs(headY - heartY) / size;
    geometry.quadrangle_shape = gap < 0.1 ? "very_narrow" : gap > 0.22 ? "very_wide" : "even";
  }

  if (maxWaviness > 0.55) quality.wavy = true;
  if (stats.branchPoints > 0) quality.forked_lines_general = true;
  if (headPoly !== undefined && stats.branchPoints > 0) {
    // A fork specifically at the head line's terminal is its own rule.
    const end = headPoly[headPoly.length - 1];
    const nearTerminal = polys.some(
      (poly) => poly !== headPoly && Math.hypot(poly[0].x - end.x, poly[0].y - end.y) < 12,
    );
    if (nearTerminal) quality.head_end_fork = true;
  }

  const assignedCount = Object.keys(lines).length;
  if (assignedCount > 0) reading.lines_available = true;

  if (Object.keys(heart).length > 0) linesBag.heart = heart;
  if (Object.keys(head).length > 0) linesBag.head = head;
  if (Object.keys(life).length > 0) linesBag.life = life;
  if (Object.keys(fate).length > 0) linesBag.fate = fate;
  if (Object.keys(quality).length > 0) linesBag.quality = quality;

  const features: Record<string, unknown> = {};
  if (Object.keys(linesBag).length > 0) features.lines = linesBag;
  if (Object.keys(geometry).length > 0) features.geometry = geometry;
  if (Object.keys(reading).length > 0) features.reading = reading;

  return { lines, polys, features: features as FeatureBag, branchPoints: stats.branchPoints };
}

/**
 * Carries traced lines out of the rectified crop and onto another canonical hand drawing.
 *
 * Both spaces place the same four anchors at known positions, so one homography maps between them.
 * That is what lets the reading show the user's *own* lines on the replica palm instead of the
 * idealised ones — same geometry, different canvas.
 */
export function projectLines(
  lines: Partial<Record<ActiveLineId, TracedLine>>,
  targetAnchors: ReadonlyArray<{ readonly x: number; readonly y: number }>,
  size: number = RECTIFIED_SIZE,
): Record<string, ReadonlyArray<readonly [number, number]>> {
  const transform = solveHomography(canonicalQuad(size), targetAnchors);
  if (transform === null) return {};

  const out: Record<string, ReadonlyArray<readonly [number, number]>> = {};
  for (const [id, line] of Object.entries(lines)) {
    if (line === undefined) continue;
    const points: Array<readonly [number, number]> = [];
    for (const [x, y] of line.points) {
      const projected = applyHomography(transform, { x, y });
      if (projected !== null) points.push([Number(projected.x.toFixed(1)), Number(projected.y.toFixed(1))]);
    }
    if (points.length > 1) out[id] = points;
  }
  return out;
}
