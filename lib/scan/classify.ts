/**
 * Trace classification: name every line a reader would name, and keep the ones nobody can.
 *
 * The pipeline until now detected everything and then threw most of it away. `completeLines` fits
 * four corridors; anything that was not heart, head, life or fate was traced, measured, and dropped
 * on the floor. On a real palm that is most of what is there — the sun line, the marriage marks, the
 * girdle, the bracelets, and a dozen minor creases that a reader would at least *look* at.
 *
 * So this classifies by **where a trace starts, where it ends, and how it runs** — which is how a
 * reader actually does it, and unlike the corridor fit it degrades gracefully: a trace that matches
 * nothing becomes `minor_unclassified` and is still drawn, rather than vanishing.
 *
 * **Order matters and is set by evidence, not by taste.** Where two classes could claim a trace, it
 * goes to the one the knowledge base can actually say something about, because a correct label the
 * KB cannot use is worth less than a slightly-less-likely label it can. Unique rules per class,
 * counted from `data/kb/hastrekha_kb.json`: head 31, marriage 25, fate 23, heart 19, life 15, sun 13,
 * health 5, intuition 4, girdle_of_venus 4, travel 4, bracelets 1.
 *
 * Those counts are prefix-sensitive in a way that is easy to get wrong, and getting it wrong the
 * first time is what produced this note: the girdle and the bracelets live under `signs.`, not
 * `lines.`, so a grep for `lines.girdle` returns zero and invites the conclusion that the KB knows
 * nothing about them. It knows a little about both. **Every class in this table has at least one rule
 * behind it**, so none of them is decoration.
 *
 * Two of the geometries below also come from the KB's own prose rather than from the classical
 * picture, because the two disagree and the KB is what the reading is generated from — see `travel`
 * and `intuition`.
 */
import { MOUNT_ZONES, EDGE_ZONES } from "./zones";
import type { Point2 } from "./types";

export type TraceClass =
  | "heart"
  | "head"
  | "life"
  | "fate"
  | "sun"
  | "marriage"
  | "health"
  | "intuition"
  | "girdle_of_venus"
  | "travel"
  | "bracelets"
  | "minor_unclassified";

/** Classes in the order they are tested. See the note above on why this order and not another. */
export const TRACE_CLASSES: readonly TraceClass[] = [
  "heart",
  "head",
  "life",
  "fate",
  "marriage",
  "sun",
  "health",
  "intuition",
  "girdle_of_venus",
  "travel",
  "bracelets",
  "minor_unclassified",
];

/**
 * How many KB rules condition on each class. Zero means "drawn, but the reading cannot use it".
 *
 * **Cheiro-era snapshot, taken against the 377-rule KB.** The Dale merge (`0.3.0-dale-merged`,
 * 548 rules) moved every one of these, and not proportionally — health and bracelets roughly
 * tripled while head grew by a tenth. They are deliberately NOT refreshed here, because these
 * numbers set `TRACE_CLASSES` order, and that order decides which class a contested trace is
 * assigned to. Re-deriving them changes classifier behaviour and re-orders the minor classes
 * (`intuition` would fall behind `girdle_of_venus`), so it is a scan-behaviour step with its own
 * fixtures to re-pin — not a bookkeeping edit to fold into a KB merge. `test/traces.test.ts`
 * pins two of these exactly and asserts the ordering, and it is what will fail if this is
 * refreshed without re-deriving the order alongside it.
 */
export const KB_RULE_COUNT: Readonly<Record<TraceClass, number>> = {
  head: 31,
  marriage: 25,
  fate: 23,
  heart: 19,
  life: 15,
  sun: 13,
  health: 5,
  intuition: 4,
  girdle_of_venus: 4,
  travel: 4,
  bracelets: 1,
  minor_unclassified: 0,
};

interface Zone {
  readonly cx: number;
  readonly cy: number;
  readonly r: number;
}

export interface ClassSpec {
  readonly id: Exclude<TraceClass, "minor_unclassified">;
  /** Where the line begins and ends, in 0–1 crop fractions. Traces run either way; both are tried. */
  readonly from: Zone;
  readonly to: Zone;
  /** 0 = horizontal, 1 = vertical, with the tolerance real palms actually span. */
  readonly verticality: number;
  readonly verticalityTol: number;
  /** Arc length as a fraction of the crop side. Minor marks are SHORT and that is diagnostic. */
  readonly minLength: number;
  readonly maxLength: number;
}

const mount = (id: string): Zone => {
  const found = MOUNT_ZONES.find((zone) => zone.id === id);
  if (found === undefined) throw new Error(`classify: unknown mount ${id}`);
  return { cx: found.cx, cy: found.cy, r: found.r };
};

/**
 * Where each class runs, derived from `zones.ts` rather than chosen.
 *
 * Every endpoint below is either a zone from that file or one sentence of anatomy away from one. The
 * confusable pairs, and the single number that separates each:
 *
 *  - **sun vs fate** — both near-vertical in the upper palm. They differ at the TOP: fate ends under
 *    Saturn (x 0.47), sun under Apollo (x 0.66). A gap of 0.19 of the crop, the widest discriminant
 *    in the table.
 *  - **health vs sun** — both rise toward the ulnar side, and orientation does NOT separate them.
 *    It nearly did while sun was modelled as near-vertical, but the KB enumerates sun origins on the
 *    head and fate lines, which makes a real sun line lean. What separates them is where they END:
 *    sun under Apollo (0.66,0.23), health at Mercury (0.82,0.30) — 0.175 of the crop apart.
 *  - **girdle vs heart** — both arc across the upper palm, and this is the tightest pair: the girdle
 *    sits above the heart line by roughly 0.06 of the crop. Heart is tested first and has more rules
 *    behind it, so when the two compete the girdle is the one that yields.
 *  - **marriage vs travel** — no longer a confusable pair at all, once travel follows the KB instead
 *    of tradition: marriage is a short mark on the ulnar edge, travel is a branch off the life line
 *    heading to Luna. Their start zones are more than 0.4 of the crop apart.
 *  - **bracelets vs everything** — the only class below y 0.90, at the wrist.
 */
export const CLASS_SPECS: readonly ClassSpec[] = [
  {
    id: "heart",
    from: { ...EDGE_ZONES.percussion },
    to: { cx: 0.22, cy: 0.22, r: 0.12 },
    verticality: 0.15,
    verticalityTol: 0.25,
    minLength: 0.35,
    maxLength: 1.2,
  },
  {
    id: "head",
    from: { ...EDGE_ZONES.webThumbIndex },
    to: { cx: 0.78, cy: 0.44, r: 0.14 },
    verticality: 0.2,
    verticalityTol: 0.28,
    minLength: 0.3,
    maxLength: 1.2,
  },
  {
    id: "life",
    from: { cx: 0.22, cy: 0.26, r: 0.12 },
    to: { cx: 0.44, cy: 0.92, r: 0.14 },
    verticality: 0.75,
    verticalityTol: 0.3,
    minLength: 0.35,
    maxLength: 1.3,
  },
  {
    id: "fate",
    // Wrist to the base of Saturn — the terminal is byte-identical to HEART_END_ZONES.under_saturn_base.
    from: { ...EDGE_ZONES.wrist },
    to: { cx: 0.47, cy: 0.3, r: 0.12 },
    verticality: 0.9,
    verticalityTol: 0.22,
    minLength: 0.3,
    maxLength: 1.1,
  },
  {
    /*
     * Short marks on the percussion edge, in the band the KB's own `position_norm` is defined over:
     * 0 is "right beside the heart line" (PALM-MARR-003) and 1 is "near the base of the little
     * finger" (PALM-MARR-004). That puts the band between the heart corridor's ulnar end at y 0.30
     * and the little MCP at y 0.24 — noticeably higher than `RESERVED_EDGE_ZONES.marriage`, which was
     * a placeholder rather than a measurement.
     */
    id: "marriage",
    from: { cx: 0.955, cy: 0.267, r: 0.055 },
    to: { cx: 0.865, cy: 0.27, r: 0.075 },
    verticality: 0.08,
    verticalityTol: 0.24,
    minLength: 0.04,
    maxLength: 0.18,
  },
  {
    /*
     * END-defined, exactly as fate is: the terminal is pinned under a named finger while the origin
     * roams. The KB enumerates four `lines.sun.origin` values — the heart line, the head line, the
     * fate line and the Luna mount — so the start zone is the centroid of those four points located
     * in this repo's own geometry, wide enough to cover all of them.
     */
    id: "sun",
    from: { cx: 0.65, cy: 0.46, r: 0.23 },
    to: mount("sun"),
    verticality: 0.78,
    verticalityTol: 0.2,
    minLength: 0.14,
    maxLength: 0.55,
  },
  {
    // Crosses the palm diagonally toward Mercury. Its slant is the discriminant against sun.
    id: "health",
    from: { cx: 0.4, cy: 0.85, r: 0.16 },
    to: mount("mercury"),
    verticality: 0.65,
    verticalityTol: 0.2,
    minLength: 0.25,
    maxLength: 0.9,
  },
  {
    /*
     * NOT the short marks on the percussion edge that the classical picture describes.
     *
     * The KB is unambiguous and it is what the reading is generated from: PALM-TRVL-001 reads
     * "aapki JEEVAN REKHA se Chandra parvat ki ore jaati yatra rekhayein" — branches leaving the LIFE
     * line toward the Moon mount — and its sibling features are `lines.life.branch_to_luna` and
     * `lines.life.sweeps_to_luna`. Classifying edge marks as travel would have put a label on the
     * wrong structure entirely, and the rules that fire off it would then describe someone else's palm.
     */
    id: "travel",
    from: { cx: 0.424, cy: 0.745, r: 0.13 },
    to: mount("moon"),
    verticality: 0.2,
    verticalityTol: 0.22,
    minLength: 0.12,
    maxLength: 0.45,
  },
  {
    /*
     * The KB names both endpoints itself: PALM-INTU-001 describes "Budh parvat se Chandra parvat tak
     * ka ardh-chandrakaar" — a crescent from the Mercury mount to the Moon mount. So these are the
     * two mount zones verbatim rather than points near them.
     */
    id: "intuition",
    from: mount("moon"),
    to: mount("mercury"),
    verticality: 0.85,
    verticalityTol: 0.16,
    minLength: 0.28,
    maxLength: 0.55,
  },
  {
    /*
     * An arc above the heart line between the finger webs. The webs are located by interpolating
     * `CANONICAL_ANCHORS` across the knuckle line in three equal finger steps: index/middle lands at
     * (0.342,0.157) and ring/little at (0.748,0.223). The radial radius is widened to 0.11 so it also
     * covers Jupiter, which the KB's `span: jupiter_to_mercury` value requires.
     */
    id: "girdle_of_venus",
    from: { cx: 0.34, cy: 0.16, r: 0.11 },
    to: { cx: 0.79, cy: 0.245, r: 0.1 },
    verticality: 0.165,
    verticalityTol: 0.14,
    minLength: 0.28,
    maxLength: 0.55,
  },
  {
    // Horizontal lines at the wrist. The only class this low.
    id: "bracelets",
    from: { cx: 0.3, cy: 0.95, r: 0.12 },
    to: { cx: 0.7, cy: 0.95, r: 0.12 },
    verticality: 0.1,
    verticalityTol: 0.25,
    minLength: 0.15,
    maxLength: 0.7,
  },
];

/** Below this a trace matches nothing well enough to be named, and stays honestly unclassified. */
export const MIN_CLASS_SCORE = 0.42;

/** Endpoint distance, orientation and length, weighted. Offset dominates — it is what separates classes. */
const ENDPOINT_WEIGHT = 0.55;
const ORIENTATION_WEIGHT = 0.3;
const LENGTH_WEIGHT = 0.15;

export function polylineLengthOf(poly: readonly Point2[]): number {
  let total = 0;
  for (let i = 1; i < poly.length; i += 1) {
    total += Math.hypot(poly[i].x - poly[i - 1].x, poly[i].y - poly[i - 1].y);
  }
  return total;
}

/** 0 = horizontal, 1 = vertical, from the trace's overall run rather than its wiggles. */
export function verticalityOf(poly: readonly Point2[]): number {
  const first = poly[0];
  const last = poly[poly.length - 1];
  const dx = Math.abs(last.x - first.x);
  const dy = Math.abs(last.y - first.y);
  return dx + dy < 1e-9 ? 0.5 : dy / (dx + dy);
}

/** How well a point sits in a zone: 1 at the centre, 0 at the rim and beyond. */
function zoneFit(zone: Zone, point: Point2, size: number): number {
  const distance = Math.hypot(point.x - zone.cx * size, point.y - zone.cy * size);
  return Math.max(0, 1 - distance / (zone.r * size));
}

export interface ClassMatch {
  readonly id: TraceClass;
  readonly score: number;
  /** True when the trace runs opposite to the spec's from→to; callers may reverse it for reporting. */
  readonly reversed: boolean;
}

/**
 * Scores one trace against one class.
 *
 * Both directions are tried because `tracePolylines` walks a skeleton from whichever endpoint it
 * found first, which carries no anatomical meaning at all.
 */
export function scoreAgainst(poly: readonly Point2[], spec: ClassSpec, size: number): ClassMatch {
  if (poly.length < 2) return { id: spec.id, score: 0, reversed: false };

  const first = poly[0];
  const last = poly[poly.length - 1];
  const forward = (zoneFit(spec.from, first, size) + zoneFit(spec.to, last, size)) / 2;
  const backward = (zoneFit(spec.from, last, size) + zoneFit(spec.to, first, size)) / 2;
  const reversed = backward > forward;
  const endpoints = Math.max(forward, backward);

  const orientationError = Math.abs(verticalityOf(poly) - spec.verticality);
  const orientation = Math.max(0, 1 - orientationError / spec.verticalityTol);

  const length = polylineLengthOf(poly) / size;
  const length01 =
    length < spec.minLength
      ? Math.max(0, 1 - (spec.minLength - length) / Math.max(1e-6, spec.minLength))
      : length > spec.maxLength
        ? Math.max(0, 1 - (length - spec.maxLength) / Math.max(1e-6, spec.maxLength))
        : 1;

  const score = ENDPOINT_WEIGHT * endpoints + ORIENTATION_WEIGHT * orientation + LENGTH_WEIGHT * length01;
  return { id: spec.id, score, reversed };
}

/**
 * Names one trace, or admits it cannot.
 *
 * Ties are broken by the class order rather than by score, which is deliberate: two classes scoring
 * within noise of each other is not a measurement, and picking the better-evidenced one at least
 * produces a label the reading can use. A trace below {@link MIN_CLASS_SCORE} against everything is
 * `minor_unclassified` — kept, drawn, and honestly unnamed.
 */
export function classifyTrace(poly: readonly Point2[], size: number): ClassMatch {
  let best: ClassMatch = { id: "minor_unclassified", score: 0, reversed: false };
  let bestRank = Number.POSITIVE_INFINITY;

  for (const spec of CLASS_SPECS) {
    const match = scoreAgainst(poly, spec, size);
    if (match.score < MIN_CLASS_SCORE) continue;
    const rank = TRACE_CLASSES.indexOf(spec.id);
    // A clearly better score wins outright; a near-tie goes to the better-evidenced class.
    if (match.score > best.score + 0.05 || (match.score > best.score - 0.05 && rank < bestRank)) {
      best = match;
      bestRank = rank;
    }
  }
  return best;
}

/**
 * Assigns every trace, allowing at most one holder per *principal* line.
 *
 * The four principal lines are singular on a palm — there is one heart line — so a second trace
 * claiming heart is a worse match for something else. The minor classes are deliberately NOT
 * exclusive: marriage marks come in twos and threes, and so do bracelets and travel lines, and
 * forcing them to compete for one slot would throw away exactly the structure this step exists to keep.
 */
export const PRINCIPAL_CLASSES: readonly TraceClass[] = ["heart", "head", "life", "fate"];

export function classifyAll(
  polys: readonly (readonly Point2[])[],
  size: number,
): readonly ClassMatch[] {
  const scored = polys.map((poly, index) => ({ index, match: classifyTrace(poly, size) }));
  // Strongest first, so a principal slot goes to the best claimant rather than the first seen.
  scored.sort((a, b) => b.match.score - a.match.score);

  const taken = new Set<TraceClass>();
  const out: ClassMatch[] = new Array(polys.length).fill(null).map(() => ({
    id: "minor_unclassified" as TraceClass,
    score: 0,
    reversed: false,
  }));

  for (const { index, match } of scored) {
    if (PRINCIPAL_CLASSES.includes(match.id) && taken.has(match.id)) {
      out[index] = { id: "minor_unclassified", score: match.score, reversed: match.reversed };
      continue;
    }
    if (PRINCIPAL_CLASSES.includes(match.id)) taken.add(match.id);
    out[index] = match;
  }
  return out;
}
