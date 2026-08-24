/**
 * Anatomical line completion: fragments → four continuous named curves.
 *
 * `assignLines` in lines.ts demands that ONE traced fragment match BOTH endpoints of a line's
 * expected run. Real creases never do that — they break wherever the light is uneven, so a good
 * detection of a heart line arrives as three pieces and is scored as three failures. Measured on a
 * real palm the detector produced eleven fragments, four of them longer than a third of the crop,
 * and the endpoint rule turned that into two stubs on screen.
 *
 * This module replaces the endpoint rule with a **corridor**: a per-line centreline and half-width
 * in canonical crop space, derived from the `LINE_SPECS` endpoints and the `zones.ts` anatomy rather
 * than invented. Any fragment that mostly lies inside a corridor and mostly runs along it seeds that
 * line — many fragments per line, none required to reach an end. The seeds are projected onto the
 * centreline, binned along it, gaps between them are bridged, and the result is sampled as a smooth
 * curve through `curve.ts`'s already-tested Catmull-Rom.
 *
 * **Honesty is the hard part, and it is structural.** A completed curve necessarily contains stretches
 * where no crease was seen. Those stretches are labelled `observed: false`, the overlay draws them
 * dimmer, and — more importantly — the feature extraction refuses to make endpoint claims about them.
 * A line with no seed fragments at all is not emitted, not even faintly: the corridor is identical
 * for every user, so a curve fitted from the prior alone would be this module's opinion rendered as
 * the user's palm, and the reading engine downstream states these as fact.
 *
 * Binning was chosen over an active contour deliberately. The corridor already supplies the
 * smoothness prior a snake's internal energy would re-derive; across a genuine gap the image energy
 * has no basin, so a snake would converge back to that prior anyway while *looking* like it measured
 * something; and a closed-form fit is deterministic, which means it can be asserted rather than
 * eyeballed.
 */
import { bezierAt, catmullRomSegments } from "./curve";
import { ACTIVE_LINE_IDS, RECTIFIED_SIZE, type ActiveLineId, type Point2 } from "./types";

/**
 * A traced polyline in crop pixels.
 *
 * Declared structurally rather than imported from lines.ts, which imports *this* module — the
 * corridors below are derived from that module's LINE_SPECS, but by value at authoring time, so
 * there is no runtime dependency to make circular.
 */
export type Poly = readonly Point2[];

/* ------------------------------- Corridors --------------------------------- */

export interface Corridor {
  readonly id: ActiveLineId;
  /** Centreline control knots in 0–1 crop fractions. First and last are the `LINE_SPECS` endpoints. */
  readonly knots: readonly Point2[];
  /** Half-width at each knot, in crop fractions. Interpolated along arc length between them. */
  readonly halfWidths: readonly number[];
}

/**
 * Where each line is allowed to run, and how far it may stray.
 *
 * Every knot is derived, not chosen: the two ends of each corridor are the `LINE_SPECS` endpoints
 * verbatim, and the interior knots are the straight chord displaced along its normal by a parabolic
 * sagitta sized to graze the relevant `zones.ts` mounts. The half-widths come from the zone radii
 * and from the spread of the classification bands lines.ts already grades these lines against —
 * a corridor narrower than the classes it must distinguish would decide the answer in advance.
 */
export const CORRIDORS: Readonly<Record<ActiveLineId, Corridor>> = {
  /*
   * Heart: percussion edge to the Jupiter mounts, bowing 4% toward the fingers. At x = 0.47 the
   * centreline passes 0.025 under Saturn's centre, inside its r = 0.10 — the heart line crossing
   * the mount bases, which is where it belongs.
   */
  heart: {
    id: "heart",
    knots: [
      { x: 0.9, y: 0.3 },
      { x: 0.732, y: 0.26 },
      { x: 0.563, y: 0.233 },
      { x: 0.392, y: 0.22 },
      { x: 0.22, y: 0.22 },
    ],
    halfWidths: [0.075, 0.06, 0.055, 0.06, 0.085],
  },
  /*
   * Head: the thumb web across to the percussion side. The terminal y is pulled from LINE_SPECS'
   * 0.50 to 0.44 — the midpoint of lines.ts's own `gentle_slope_luna` and `deep_slope_luna` bands.
   * 0.50 *is* deep_slope, and a prior sitting on an extreme of the classes it must distinguish
   * decides those classes before the evidence does.
   */
  head: {
    id: "head",
    knots: [
      { x: 0.2, y: 0.32 },
      { x: 0.348, y: 0.335 },
      { x: 0.494, y: 0.36 },
      { x: 0.638, y: 0.395 },
      { x: 0.78, y: 0.44 },
    ],
    halfWidths: [0.075, 0.065, 0.06, 0.08, 0.105],
  },
  /*
   * Life: the arc around the thumb ball. The bulge is the circle through both ends that grazes the
   * palm-side rims of Mars inner (x 0.39 at y 0.46) and Venus (x 0.38 at y 0.70) — sagitta 0.055.
   * The widest half-width of the four, because lines.ts's own `life.arc` classes split at max-x
   * 0.42 and the hugging variant runs 0.082 inside the centreline.
   */
  life: {
    id: "life",
    knots: [
      { x: 0.22, y: 0.26 },
      { x: 0.314, y: 0.412 },
      { x: 0.382, y: 0.573 },
      { x: 0.424, y: 0.742 },
      { x: 0.44, y: 0.92 },
    ],
    halfWidths: [0.07, 0.085, 0.095, 0.095, 0.11],
  },
  /*
   * Fate: wrist to the base of Saturn, near-straight (its `LINE_SPECS` verticality is 0.9). The only
   * one-sided taper of the four: the distal end is pinned under Saturn while the origin roams, so
   * the corridor is wide at the wrist and narrow at the top. The wrist half-width is exactly
   * `EDGE_ZONES.wrist.r` and deliberately no wider — reaching as far as Luna would swallow the life
   * corridor whole, and a Luna-origin fate line is better fitted from mid-palm up with its origin
   * left unclaimed than fitted to the wrist and claimed wrongly.
   */
  fate: {
    id: "fate",
    knots: [
      { x: 0.5, y: 0.93 },
      { x: 0.492, y: 0.775 },
      { x: 0.485, y: 0.62 },
      { x: 0.477, y: 0.462 },
      { x: 0.47, y: 0.3 },
    ],
    halfWidths: [0.16, 0.13, 0.095, 0.07, 0.055],
  },
};

/** Samples along a corridor: 64 over a ~0.6-of-crop arc is ~2.5px spacing at 256, finer than a crease. */
export const CORRIDOR_SAMPLES = 64;
/** Densification steps per Catmull-Rom segment when measuring the centreline's arc length. */
const DENSIFY_STEPS = 16;

/** Fraction of a fragment's points that must lie inside a corridor before it may seed that line. */
export const CORRIDOR_MIN_INSIDE = 0.6;
/**
 * Worst angular deviation a genuine line makes from its prior, as a cosine — 35°. The steepest
 * classified head line leaves the corridor tangent by ~26° over its last quarter; 35° covers that
 * while still rejecting cross-family claims, where a horizontal heart fragment sits ~83° off fate.
 */
export const COS_TANGENT_TOL = 0.819;
/** Fraction of inside points whose tangent must agree. Not 1.0 — a fragment crossing a fork wobbles. */
export const TANGENT_MIN_AGREE = 0.7;
/** Arc length inside the corridor a fragment needs before it votes, as a fraction of the crop side. */
export const MIN_SEED_LENGTH_FRACTION = 0.05;
/** Below this a fragment is either mostly outside its corridor or barely oriented along it. */
export const MIN_CORRIDOR_SCORE = 0.35;
/**
 * Offset dominates because perpendicular distance is the only thing separating the two overlapping
 * pairs — heart/head at the thumb web, life/fate around mid-palm — where the tangents differ by
 * 6° and 21°. Tangent is what rejects cross-family claims. Coverage matters least: a long fragment
 * that leaves the corridor at one end is still an excellent seed.
 */
const SCORE_OFFSET_WEIGHT = 0.45;
const SCORE_TANGENT_WEIGHT = 0.35;
const SCORE_COVER_WEIGHT = 0.2;

/** Control bins along the corridor. ~13px each at 256 — a real break occupies its own bin. */
export const CONTROL_BINS = 12;
/** Skeleton pixels a bin needs before it counts as observed rather than interpolated. */
const MIN_BIN_POINTS = 2;
/** …carrying at least two pixels' worth of at-threshold evidence. Tied to lines.ts's LINE_THRESHOLD. */
const MIN_BIN_WEIGHT = 0.9;
/** Two binomial passes ≈ a Gaussian of one bin: kills bin jitter, keeps the heart line's sagitta. */
const SMOOTH_PASSES = 2;
/**
 * How far past the last observed bin the curve may be drawn, as a fraction of corridor arc length.
 *
 * Interior gaps are bridged with no such limit — both ends of an interior gap are real evidence of
 * the same crease — while ends get 15% and no more. That asymmetry is exactly what turns fragments
 * into long continuous curves without fabricating where they start and stop.
 */
export const MAX_END_EXTRAPOLATION = 0.15;
/** A single interior hole larger than this is two lines, not one with a gap. */
export const MAX_INFERRED_RUN = 0.4;
/** Curve samples per bin: ~3.5px spacing at 256, finer than a break, same point count the overlay already draws. */
const CURVE_SAMPLES_PER_BIN = 4;

/**
 * Mean field along the whole curve a completion must reach.
 *
 * Derived from what the fused field actually looks like rather than picked: a crease that binarised
 * sits near 0.55, and the field under a gap is faint-not-absent near 0.15 — that is *why* it fell
 * under lines.ts's LINE_THRESHOLD of 0.45 instead of being zero. So energy ≈ 0.15 + 0.40·observed,
 * and 0.30 corresponds to a curve that is about 37% observed. Setting the floor at LINE_THRESHOLD
 * itself would reject precisely the completed lines this module exists to produce.
 */
export const ACCEPT_ENERGY = 0.3;
/** Below this the curve is more prior than palm. Placed where ACCEPT_ENERGY also bites, so neither floor works alone. */
export const MIN_OBSERVED_FRACTION = 0.35;
/**
 * Mean field on the OBSERVED samples only — a self-consistency check, not a new scale. Those samples
 * came from a skeleton binarised at LINE_THRESHOLD, so falling below it there means the smoothing
 * pulled the fit off the very evidence it was built from. The 0.9 is slack for bilinear sampling.
 */
export const OBSERVED_ENERGY_FLOOR = 0.405;
/** How close an end must be to observed evidence for an endpoint-derived feature to be claimed. */
export const OBSERVED_ENDPOINT_TOLERANCE = 0.05;
/** Fraction of sampled x positions at which heart must lie above head. Not 1.0 — the ends may graze. */
const ORDERING_MIN_AGREE = 0.9;
/** How many x positions the heart/head ordering is checked at. */
const ORDERING_SAMPLES = 16;

export interface CorridorSample {
  /** Centreline position, crop fractions. */
  readonly x: number;
  readonly y: number;
  /** Unit tangent. */
  readonly tx: number;
  readonly ty: number;
  /** Unit left normal. The sign is a convention, consistent within a corridor and never compared across. */
  readonly nx: number;
  readonly ny: number;
  /** Normalised arc position, 0 at the first knot and 1 at the last. */
  readonly s: number;
  /** Half-width here, crop fractions. */
  readonly half: number;
}

const corridorCache = new Map<ActiveLineId, readonly CorridorSample[]>();

/**
 * Resamples a corridor at uniform ARC LENGTH.
 *
 * Uniform in arc length, not in curve parameter: the knots are not equally spaced, so parameter-
 * uniform samples would bunch on the short segments and leave the long ones coarse. Every downstream
 * step — binning, gap measurement, the extrapolation limit — is expressed in arc length, and would
 * silently mean different things at different points along the line otherwise.
 */
export function sampleCorridor(corridor: Corridor, count: number = CORRIDOR_SAMPLES): readonly CorridorSample[] {
  const { knots, halfWidths } = corridor;
  const segments = catmullRomSegments(knots);

  const dense: Point2[] = [knots[0]];
  for (let i = 0; i < segments.length; i += 1) {
    for (let step = 1; step <= DENSIFY_STEPS; step += 1) {
      dense.push(bezierAt(knots[i], segments[i], step / DENSIFY_STEPS));
    }
  }

  const cumulative = new Float64Array(dense.length);
  for (let i = 1; i < dense.length; i += 1) {
    cumulative[i] = cumulative[i - 1] + Math.hypot(dense[i].x - dense[i - 1].x, dense[i].y - dense[i - 1].y);
  }
  const total = cumulative[dense.length - 1];
  if (total < 1e-9) return [];

  // Knot k sits at densified index k·DENSIFY_STEPS by construction; its half-width applies there.
  const knotArc = knots.map((_, k) => cumulative[Math.min(dense.length - 1, k * DENSIFY_STEPS)] / total);

  const halfAt = (s: number): number => {
    for (let k = 1; k < knotArc.length; k += 1) {
      if (s <= knotArc[k]) {
        const span = knotArc[k] - knotArc[k - 1];
        const u = span < 1e-9 ? 0 : (s - knotArc[k - 1]) / span;
        return halfWidths[k - 1] + (halfWidths[k] - halfWidths[k - 1]) * u;
      }
    }
    return halfWidths[halfWidths.length - 1];
  };

  const out: CorridorSample[] = [];
  let cursor = 0;
  for (let k = 0; k < count; k += 1) {
    const s = count === 1 ? 0 : k / (count - 1);
    const target = s * total;
    while (cursor < dense.length - 2 && cumulative[cursor + 1] < target) cursor += 1;
    const span = cumulative[cursor + 1] - cumulative[cursor];
    const u = span < 1e-12 ? 0 : (target - cumulative[cursor]) / span;
    const a = dense[cursor];
    const b = dense[cursor + 1];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const length = Math.hypot(dx, dy) || 1;
    out.push({
      x: a.x + dx * u,
      y: a.y + dy * u,
      tx: dx / length,
      ty: dy / length,
      nx: dy / length,
      ny: -dx / length,
      s,
      half: halfAt(s),
    });
  }
  return out;
}

/** Cached samples for one line. Built once; the corridors are compile-time constants. */
export function corridorFor(id: ActiveLineId): readonly CorridorSample[] {
  const cached = corridorCache.get(id);
  if (cached !== undefined) return cached;
  const built = sampleCorridor(CORRIDORS[id]);
  corridorCache.set(id, built);
  return built;
}

export interface CorridorHit {
  readonly index: number;
  readonly s: number;
  /** Signed perpendicular offset from the centreline, in crop PIXELS. */
  readonly offset: number;
  /** Half-width at this position, in crop pixels. */
  readonly half: number;
  readonly inside: boolean;
}

/** Nearest corridor sample to a crop-pixel point, with the signed offset along that sample's normal. */
export function projectToCorridor(
  samples: readonly CorridorSample[],
  point: Point2,
  size: number,
): CorridorHit {
  let best = 0;
  let bestDistance = Infinity;
  for (let i = 0; i < samples.length; i += 1) {
    const dx = point.x - samples[i].x * size;
    const dy = point.y - samples[i].y * size;
    const distance = dx * dx + dy * dy;
    if (distance < bestDistance) {
      bestDistance = distance;
      best = i;
    }
  }
  const sample = samples[best];
  const offset = (point.x - sample.x * size) * sample.nx + (point.y - sample.y * size) * sample.ny;
  const half = sample.half * size;
  return { index: best, s: sample.s, offset, half, inside: Math.abs(offset) <= half };
}

/* -------------------------------- Seeding ---------------------------------- */

export interface SeedScore {
  readonly id: ActiveLineId;
  readonly score: number;
  readonly insideFraction: number;
  readonly tangentAgreement: number;
  readonly meanOffsetRatio: number;
  readonly insideLengthPx: number;
}

/** Local tangent window, in points. Wider than a break so a fork does not flip the direction. */
const TANGENT_WINDOW = 3;

/**
 * How well a fragment matches one line's corridor, or null when it fails a hard gate.
 *
 * Membership is judged over the WHOLE fragment rather than locally, and that is deliberate: near
 * the thumb web the heart and head corridors overlap and their tangents differ by only about six
 * degrees, so no local test can separate them. A long fragment votes with its whole body, and by
 * mid-palm the two centrelines are 0.134 of the crop apart — which is what resolves the ambiguity.
 */
export function scoreFragment(poly: Poly, id: ActiveLineId, size: number): SeedScore | null {
  if (poly.length < 2) return null;
  const samples = corridorFor(id);
  if (samples.length === 0) return null;

  let insideCount = 0;
  let insideLength = 0;
  let tangentPass = 0;
  let offsetSum = 0;
  let tangentSum = 0;
  let previousInside = false;

  for (let i = 0; i < poly.length; i += 1) {
    const hit = projectToCorridor(samples, poly[i], size);
    if (!hit.inside) {
      previousInside = false;
      continue;
    }

    const before = poly[Math.max(0, i - TANGENT_WINDOW)];
    const after = poly[Math.min(poly.length - 1, i + TANGENT_WINDOW)];
    const dx = after.x - before.x;
    const dy = after.y - before.y;
    const length = Math.hypot(dx, dy);
    // Absolute cosine: tracePolylines walks a fragment from whichever end it found first.
    const cosine = length < 1e-9 ? 0 : Math.abs((dx / length) * samples[hit.index].tx + (dy / length) * samples[hit.index].ty);

    insideCount += 1;
    offsetSum += hit.half < 1e-9 ? 1 : Math.min(1, Math.abs(hit.offset) / hit.half);
    if (cosine >= COS_TANGENT_TOL) tangentPass += 1;
    tangentSum += Math.min(1, Math.max(0, (cosine - COS_TANGENT_TOL) / (1 - COS_TANGENT_TOL)));
    if (previousInside) insideLength += Math.hypot(poly[i].x - poly[i - 1].x, poly[i].y - poly[i - 1].y);
    previousInside = true;
  }

  if (insideCount === 0) return null;
  const insideFraction = insideCount / poly.length;
  const tangentAgreement = tangentPass / insideCount;
  if (insideFraction < CORRIDOR_MIN_INSIDE) return null;
  if (tangentAgreement < TANGENT_MIN_AGREE) return null;
  if (insideLength < MIN_SEED_LENGTH_FRACTION * size) return null;

  const meanOffsetRatio = offsetSum / insideCount;
  const score =
    SCORE_OFFSET_WEIGHT * (1 - meanOffsetRatio) +
    SCORE_TANGENT_WEIGHT * (tangentSum / insideCount) +
    SCORE_COVER_WEIGHT * insideFraction;

  return { id, score, insideFraction, tangentAgreement, meanOffsetRatio, insideLengthPx: insideLength };
}

/**
 * Assigns every fragment to at most one line, greedily by score.
 *
 * The same greedy discipline `assignLines` uses, with the one cap that caused the bug removed: a
 * line may collect arbitrarily many fragments. A fragment still goes to exactly one line, so two
 * lines can never claim the same skeleton.
 */
export function selectSeeds(
  polys: readonly Poly[],
  size: number = RECTIFIED_SIZE,
): Readonly<Record<ActiveLineId, readonly Poly[]>> {
  const candidates: Array<{ id: ActiveLineId; index: number; score: number }> = [];
  polys.forEach((poly, index) => {
    for (const id of ACTIVE_LINE_IDS) {
      const scored = scoreFragment(poly, id, size);
      if (scored !== null && scored.score >= MIN_CORRIDOR_SCORE) {
        candidates.push({ id, index, score: scored.score });
      }
    }
  });
  candidates.sort((a, b) => b.score - a.score);

  const out: Record<ActiveLineId, Poly[]> = { heart: [], head: [], life: [], fate: [] };
  const used = new Set<number>();
  for (const candidate of candidates) {
    if (used.has(candidate.index)) continue;
    used.add(candidate.index);
    out[candidate.id].push(polys[candidate.index]);
  }
  return out;
}

/* ---------------------------------- Fit ------------------------------------ */

export interface LineSegment {
  /** Index range into `FittedLine.points`, half-open at `to`. */
  readonly from: number;
  readonly to: number;
  /** False for a stretch bridged across a gap — the overlay draws these dimmer. */
  readonly observed: boolean;
}

export interface FittedLine {
  readonly id: ActiveLineId;
  readonly points: readonly Point2[];
  readonly segments: readonly LineSegment[];
  /** Arc length carried by observed segments, over total arc length. */
  readonly observedFraction: number;
  /** Mean field under the whole curve. */
  readonly energy: number;
  /** Mean field under the observed samples only. */
  readonly observedEnergy: number;
  readonly seedCount: number;
  readonly lengthPx: number;
}

/** Bilinear read of a probability field, clamped at the borders. */
export function sampleField(field: Float32Array, size: number, x: number, y: number): number {
  const cx = x < 0 ? 0 : x > size - 1 ? size - 1 : x;
  const cy = y < 0 ? 0 : y > size - 1 ? size - 1 : y;
  const x0 = cx | 0;
  const y0 = cy | 0;
  const x1 = x0 + 1 > size - 1 ? size - 1 : x0 + 1;
  const y1 = y0 + 1 > size - 1 ? size - 1 : y0 + 1;
  const fx = cx - x0;
  const fy = cy - y0;
  const top = field[y0 * size + x0] + (field[y0 * size + x1] - field[y0 * size + x0]) * fx;
  const bottom = field[y1 * size + x0] + (field[y1 * size + x1] - field[y1 * size + x0]) * fx;
  return top + (bottom - top) * fy;
}

/** Centreline position and normal at an arbitrary arc position, by interpolating the samples. */
function centreAt(samples: readonly CorridorSample[], s: number): CorridorSample {
  const clamped = s < 0 ? 0 : s > 1 ? 1 : s;
  const position = clamped * (samples.length - 1);
  const index = Math.min(samples.length - 2, Math.floor(position));
  const u = position - index;
  const a = samples[index];
  const b = samples[index + 1];
  return {
    x: a.x + (b.x - a.x) * u,
    y: a.y + (b.y - a.y) * u,
    tx: a.tx,
    ty: a.ty,
    nx: a.nx + (b.nx - a.nx) * u,
    ny: a.ny + (b.ny - a.ny) * u,
    s: clamped,
    half: a.half + (b.half - a.half) * u,
  };
}

/**
 * Fits one line from its seeds.
 *
 * Seed points are projected onto the corridor and binned along it as a probability-weighted signed
 * offset — weighted, because a skeleton pixel sitting on a strong crease should pull the control
 * point harder than one sitting on a faint speck, and that costs exactly one bilinear read. Bins
 * with no evidence are interpolated between their observed neighbours; the ends HOLD rather than
 * extrapolate, because past the last evidence nothing says the line continues in the direction it
 * was heading, and extrapolating a trend is how a fit invents a line curving into a mount.
 *
 * @returns null when there are no seeds, or when the evidence does not span enough of the corridor
 * to be one line rather than two.
 */
export function fitLine(
  id: ActiveLineId,
  seeds: readonly Poly[],
  field: Float32Array,
  size: number = RECTIFIED_SIZE,
): FittedLine | null {
  if (seeds.length === 0) return null;
  const samples = corridorFor(id);
  if (samples.length === 0) return null;

  const offsets = new Float64Array(CONTROL_BINS);
  const weights = new Float64Array(CONTROL_BINS);
  const counts = new Int32Array(CONTROL_BINS);
  const observed = new Uint8Array(CONTROL_BINS);

  for (const seed of seeds) {
    for (const point of seed) {
      const hit = projectToCorridor(samples, point, size);
      if (!hit.inside) continue;
      const bin = Math.min(CONTROL_BINS - 1, Math.floor(hit.s * CONTROL_BINS));
      const weight = sampleField(field, size, point.x, point.y);
      offsets[bin] += weight * hit.offset;
      weights[bin] += weight;
      counts[bin] += 1;
    }
  }

  let first = -1;
  let last = -1;
  for (let k = 0; k < CONTROL_BINS; k += 1) {
    if (counts[k] >= MIN_BIN_POINTS && weights[k] >= MIN_BIN_WEIGHT) {
      offsets[k] /= weights[k];
      observed[k] = 1;
      if (first < 0) first = k;
      last = k;
    } else {
      offsets[k] = 0;
    }
  }
  if (first < 0) return null;

  // Interior gaps interpolate between real evidence on both sides; the ends hold, never extrapolate.
  for (let k = first + 1; k < last; k += 1) {
    if (observed[k] === 1) continue;
    let before = k - 1;
    while (before > first && observed[before] === 0) before -= 1;
    let after = k + 1;
    while (after < last && observed[after] === 0) after += 1;
    const span = after - before;
    offsets[k] = span === 0 ? offsets[before] : offsets[before] + ((offsets[after] - offsets[before]) * (k - before)) / span;
  }
  for (let k = 0; k < first; k += 1) offsets[k] = offsets[first];
  for (let k = last + 1; k < CONTROL_BINS; k += 1) offsets[k] = offsets[last];

  // A bin whose weighted mean escaped the corridor (a stray fragment tail) must not drag the curve out.
  for (let k = 0; k < CONTROL_BINS; k += 1) {
    const limit = centreAt(samples, (k + 0.5) / CONTROL_BINS).half * size;
    offsets[k] = Math.min(limit, Math.max(-limit, offsets[k]));
  }

  for (let pass = 0; pass < SMOOTH_PASSES; pass += 1) {
    const previous = Float64Array.from(offsets);
    for (let k = 0; k < CONTROL_BINS; k += 1) {
      const left = previous[Math.max(0, k - 1)];
      const right = previous[Math.min(CONTROL_BINS - 1, k + 1)];
      offsets[k] = 0.25 * left + 0.5 * previous[k] + 0.25 * right;
    }
  }

  /*
   * A single interior hole past MAX_INFERRED_RUN is two lines, not one with a gap. Keep the side
   * carrying more observed evidence rather than drawing a curve that is mostly this module's prior.
   */
  let holeStart = -1;
  let worstHole = 0;
  let worstAt = -1;
  for (let k = first; k <= last; k += 1) {
    if (observed[k] === 0) {
      if (holeStart < 0) holeStart = k;
    } else if (holeStart >= 0) {
      const run = (k - holeStart) / CONTROL_BINS;
      if (run > worstHole) {
        worstHole = run;
        worstAt = holeStart;
      }
      holeStart = -1;
    }
  }
  let lowBin = first;
  let highBin = last;
  if (worstHole > MAX_INFERRED_RUN && worstAt >= 0) {
    let leftObserved = 0;
    let rightObserved = 0;
    for (let k = first; k < worstAt; k += 1) leftObserved += observed[k];
    for (let k = worstAt; k <= last; k += 1) rightObserved += observed[k];
    if (leftObserved >= rightObserved) {
      highBin = worstAt - 1;
    } else {
      lowBin = worstAt;
      while (lowBin <= last && observed[lowBin] === 0) lowBin += 1;
    }
    if (lowBin > highBin) return null;
  }

  const sLow = Math.max(0, lowBin / CONTROL_BINS - MAX_END_EXTRAPOLATION);
  const sHigh = Math.min(1, (highBin + 1) / CONTROL_BINS + MAX_END_EXTRAPOLATION);
  if (sHigh - sLow < 1e-6) return null;

  const controls: Point2[] = [];
  const controlObserved: boolean[] = [];
  const pushControl = (s: number, bin: number): void => {
    const centre = centreAt(samples, s);
    controls.push({
      x: (centre.x + offsets[bin] * centre.nx / size) * size,
      y: (centre.y + offsets[bin] * centre.ny / size) * size,
    });
    controlObserved.push(observed[bin] === 1);
  };

  pushControl(sLow, lowBin);
  for (let k = 0; k < CONTROL_BINS; k += 1) {
    const s = (k + 0.5) / CONTROL_BINS;
    if (s > sLow && s < sHigh) pushControl(s, k);
  }
  pushControl(sHigh, highBin);
  if (controls.length < 2) return null;

  const segmentsOut = catmullRomSegments(controls);
  const points: Point2[] = [controls[0]];
  const flags: boolean[] = [controlObserved[0]];
  for (let i = 0; i < segmentsOut.length; i += 1) {
    for (let step = 1; step <= CURVE_SAMPLES_PER_BIN; step += 1) {
      points.push(bezierAt(controls[i], segmentsOut[i], step / CURVE_SAMPLES_PER_BIN));
      // A sample spanning an observed and an inferred control takes the inferred flag.
      flags.push(controlObserved[i] && controlObserved[i + 1]);
    }
  }

  const segments: LineSegment[] = [];
  let runStart = 0;
  for (let i = 1; i <= flags.length; i += 1) {
    if (i === flags.length || flags[i] !== flags[runStart]) {
      segments.push({ from: runStart, to: i, observed: flags[runStart] });
      runStart = i;
    }
  }

  let lengthPx = 0;
  let observedLength = 0;
  let energySum = 0;
  let observedSum = 0;
  let observedCount = 0;
  for (let i = 0; i < points.length; i += 1) {
    energySum += sampleField(field, size, points[i].x, points[i].y);
    if (flags[i]) {
      observedSum += sampleField(field, size, points[i].x, points[i].y);
      observedCount += 1;
    }
    if (i === 0) continue;
    const step = Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
    lengthPx += step;
    if (flags[i] && flags[i - 1]) observedLength += step;
  }

  return {
    id,
    points,
    segments,
    observedFraction: lengthPx < 1e-9 ? 0 : observedLength / lengthPx,
    energy: energySum / points.length,
    observedEnergy: observedCount === 0 ? 0 : observedSum / observedCount,
    seedCount: seeds.length,
    lengthPx,
  };
}

/* ------------------------------ Accept / reject ---------------------------- */

export type CompletionReject = "no_seeds" | "low_observed" | "low_energy" | "low_observed_energy" | "ordering";

export interface LineCompletionReport {
  readonly id: ActiveLineId;
  readonly seedCount: number;
  readonly observedFraction: number;
  readonly energy: number;
  readonly accepted: boolean;
  readonly reject: CompletionReject | null;
}

export interface CompletionResult {
  readonly lines: Partial<Record<ActiveLineId, FittedLine>>;
  readonly reports: Readonly<Record<ActiveLineId, LineCompletionReport>>;
}

/** Linear interpolation of a polyline's y at a given x, or null when x is outside its span. */
function yAt(points: readonly Point2[], x: number): number | null {
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1];
    const b = points[i];
    if ((x >= a.x && x <= b.x) || (x >= b.x && x <= a.x)) {
      const span = b.x - a.x;
      return Math.abs(span) < 1e-9 ? (a.y + b.y) / 2 : a.y + ((b.y - a.y) * (x - a.x)) / span;
    }
  }
  return null;
}

/**
 * Fits all four lines and applies the acceptance rules.
 *
 * The last rule is anatomical rather than statistical: on every palm the heart line lies above the
 * head line. Where the two corridors genuinely come close, a mis-seeded fragment can produce two
 * curves that cross, and no per-line energy test can catch that because both curves individually sit
 * on real evidence. Comparing them is the only way to see it.
 */
export function completeLines(
  polys: readonly Poly[],
  field: Float32Array,
  size: number = RECTIFIED_SIZE,
): CompletionResult {
  const seeds = selectSeeds(polys, size);
  const lines: Partial<Record<ActiveLineId, FittedLine>> = {};
  const reports: Record<ActiveLineId, LineCompletionReport> = {
    heart: { id: "heart", seedCount: 0, observedFraction: 0, energy: 0, accepted: false, reject: "no_seeds" },
    head: { id: "head", seedCount: 0, observedFraction: 0, energy: 0, accepted: false, reject: "no_seeds" },
    life: { id: "life", seedCount: 0, observedFraction: 0, energy: 0, accepted: false, reject: "no_seeds" },
    fate: { id: "fate", seedCount: 0, observedFraction: 0, energy: 0, accepted: false, reject: "no_seeds" },
  };

  for (const id of ACTIVE_LINE_IDS) {
    const fitted = fitLine(id, seeds[id], field, size);
    if (fitted === null) {
      /*
       * A null fit with seeds present is NOT "no seeds" — the fragments were there, but no bin along
       * the corridor carried enough probability mass to be called observed. Reporting that as
       * `no_seeds` would send anyone reading the HUD to look at the corridor when the problem is the
       * field, so the two are distinguished even though both produce no line.
       */
      if (seeds[id].length > 0) {
        reports[id] = { ...reports[id], seedCount: seeds[id].length, reject: "low_energy" };
      }
      continue;
    }

    const reject: CompletionReject | null =
      fitted.observedFraction < MIN_OBSERVED_FRACTION
        ? "low_observed"
        : fitted.energy < ACCEPT_ENERGY
          ? "low_energy"
          : fitted.observedEnergy < OBSERVED_ENERGY_FLOOR
            ? "low_observed_energy"
            : null;

    reports[id] = {
      id,
      seedCount: fitted.seedCount,
      observedFraction: fitted.observedFraction,
      energy: fitted.energy,
      accepted: reject === null,
      reject,
    };
    if (reject === null) lines[id] = fitted;
  }

  const heart = lines.heart;
  const head = lines.head;
  if (heart !== undefined && head !== undefined) {
    const lo = Math.max(Math.min(...heart.points.map((p) => p.x)), Math.min(...head.points.map((p) => p.x)));
    const hi = Math.min(Math.max(...heart.points.map((p) => p.x)), Math.max(...head.points.map((p) => p.x)));
    let compared = 0;
    let correct = 0;
    for (let i = 0; i < ORDERING_SAMPLES; i += 1) {
      const x = lo + ((hi - lo) * i) / (ORDERING_SAMPLES - 1);
      const heartY = yAt(heart.points, x);
      const headY = yAt(head.points, x);
      if (heartY === null || headY === null) continue;
      compared += 1;
      if (heartY < headY) correct += 1;
    }
    if (compared > 0 && correct / compared < ORDERING_MIN_AGREE) {
      const loser = heart.energy * heart.observedFraction < head.energy * head.observedFraction ? "heart" : "head";
      delete lines[loser];
      reports[loser] = { ...reports[loser], accepted: false, reject: "ordering" };
    }
  }

  return { lines, reports };
}

/** Whether a fitted line's end sits on observed evidence, gating endpoint-derived features. */
export function endpointObserved(
  line: FittedLine,
  which: "start" | "end",
  tolerance: number = OBSERVED_ENDPOINT_TOLERANCE,
): boolean {
  const limit = tolerance * line.points.length;
  for (const segment of line.segments) {
    if (!segment.observed) continue;
    if (which === "start" && segment.from <= limit) return true;
    if (which === "end" && segment.to >= line.points.length - limit) return true;
  }
  return false;
}

