import assert from "node:assert/strict";
import { LM } from "../lib/scan/landmark-index";
import {
  derivePalmEdge,
  edgeProfile,
  palmBoundary,
  PALM_EDGE_APEX,
  PALM_EDGE_PEAK,
  PALM_EDGE_SAMPLE_T,
  PALM_EDGE_TAPER_FLOOR,
} from "../lib/scan/landmarks";
import { palmSpan } from "../lib/scan/quality";
import {
  applyHomography,
  canonicalAnchors,
  palmAnchors,
  solveHomography,
  type Matrix3,
} from "../lib/scan/rectify";
import { RESERVED_EDGE_ZONES } from "../lib/scan/zones";
import type { Landmark3, Point2 } from "../lib/scan/types";
import { mirrorHand, syntheticHand } from "./hand-fixture";

const distance = (a: Point2, b: Point2): number => Math.hypot(a.x - b.x, a.y - b.y);

/* ------------------------------- Palm edge -------------------------------- */

/** Signed side of the infinite line a→b. Its sign says which side of that line `p` lies on. */
function sideOfLine(p: Point2, a: Point2, b: Point2): number {
  return (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
}

/** Euclidean distance to the SEGMENT a→b (clamped projection), not to the infinite line. */
function distanceToSegment(p: Point2, a: Point2, b: Point2): number {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const lengthSq = abx * abx + aby * aby;
  if (lengthSq < 1e-18) return distance(p, a);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * abx + (p.y - a.y) * aby) / lengthSq));
  return distance(p, { x: a.x + abx * t, y: a.y + aby * t });
}

/**
 * The invariants the anatomical frame guarantees, checked for a whole hand at once.
 *
 * Both are about *where the edge lands*, which is what the construction exists for — not about
 * distances to a centroid, which the previous construction happened to produce and which said
 * nothing about whether the points came to rest on skin.
 */
function checkEdgeInvariants(marks: readonly Landmark3[], label: string): void {
  const edge = derivePalmEdge(marks);
  assert.ok(edge !== null, `${label}: edge derives`);

  const wrist = marks[LM.WRIST];
  const pinky = marks[LM.PINKY_MCP];
  const index = marks[LM.INDEX_MCP];
  const pinkySide = Math.sign(sideOfLine(pinky, index, wrist));
  assert.notEqual(pinkySide, 0, `${label}: the little knuckle is off the index-to-wrist line`);

  const points: ReadonlyArray<readonly [string, Point2, number]> = [
    ["p1", edge.p1, PALM_EDGE_SAMPLE_T.p1],
    ["p2", edge.p2, PALM_EDGE_SAMPLE_T.p2],
    ["percussionTop", edge.percussionTop, PALM_EDGE_SAMPLE_T.percussionTop],
  ];

  for (const [name, point, t] of points) {
    // 1. Strictly on the pinky side of the index→wrist line.
    const side = sideOfLine(point, index, wrist);
    assert.ok(Math.abs(side) > 1e-9, `${label}: ${name} is strictly off the index-to-wrist line`);
    assert.equal(Math.sign(side), pinkySide, `${label}: ${name} is on the pinky side`);

    // 2. Strictly outside the pinky→wrist segment, by exactly the offset — the frame makes the
    //    step perpendicular to that segment, so the distance is the offset and nothing else.
    const away = distanceToSegment(point, pinky, wrist);
    assert.ok(away > 1e-9, `${label}: ${name} is strictly outside the pinky-to-wrist segment`);
    const expected = edge.peak * edgeProfile(t);
    assert.ok(
      Math.abs(away - expected) < 1e-6,
      `${label}: ${name} steps off by peak x profile(${t}) (${away.toFixed(6)} vs ${expected.toFixed(6)})`,
    );
  }

  // The frame itself: outward must be a unit vector perpendicular to the edge axis.
  assert.ok(Math.abs(Math.hypot(edge.outward.x, edge.outward.y) - 1) < 1e-9, `${label}: outward is a unit vector`);
  assert.ok(Math.abs(Math.hypot(edge.edgeAxis.x, edge.edgeAxis.y) - 1) < 1e-9, `${label}: edgeAxis is a unit vector`);
  assert.ok(
    Math.abs(edge.outward.x * edge.edgeAxis.x + edge.outward.y * edge.edgeAxis.y) < 1e-9,
    `${label}: outward is perpendicular to edgeAxis`,
  );
}

{
  const { image } = syntheticHand();
  const edge = derivePalmEdge(image);
  assert.ok(edge !== null, "palm edge derives from a full landmark set");
  assert.equal(derivePalmEdge([]), null, "too few landmarks yields no edge");
  /* The peak now scales with PALM WIDTH, not the whole-hand bounding box. */
  const palmWidth = Math.hypot(
    image[LM.PINKY_MCP].x - image[LM.INDEX_MCP].x,
    image[LM.PINKY_MCP].y - image[LM.INDEX_MCP].y,
  );
  assert.ok(Math.abs(edge.palmWidth - palmWidth) < 1e-9, "palmWidth is |indexMCP - pinkyMCP|");
  assert.ok(Math.abs(edge.peak - palmWidth * PALM_EDGE_PEAK) < 1e-9, "peak is PALM_EDGE_PEAK x palm width");
  /* Spreading the fingers must not move the palm edge — the old palmSpan basis failed this. */
  const splayed = image.map((point, i) =>
    i === LM.MIDDLE_TIP ? { ...point, y: point.y - 0.12 } : point,
  );
  const splayedEdge = derivePalmEdge(splayed);
  assert.ok(splayedEdge !== null);
  assert.ok(
    Math.abs(splayedEdge.peak - edge.peak) < 1e-12,
    "extending a finger leaves the palm edge untouched",
  );
  assert.ok(
    palmSpan(splayed) > palmSpan(image) + 0.05,
    "even though it materially changes palmSpan, the basis the old constant used",
  );

  checkEdgeInvariants(image, "right hand");

  /* p1 sits nearer the knuckle, p2 nearer the wrist — the boundary order depends on it. */
  assert.ok(
    distance(edge.p1, image[LM.PINKY_MCP]) < distance(edge.p2, image[LM.PINKY_MCP]),
    "p1 is nearer the little knuckle than p2",
  );
  assert.ok(distance(edge.p2, image[LM.WRIST]) < distance(edge.p1, image[LM.WRIST]), "and p2 is nearer the wrist");

  /* Mirrored (left) hand: every invariant holds, with no handedness branch in the code. */
  const mirrored = mirrorHand(image);
  checkEdgeInvariants(mirrored, "mirrored (left) hand");

  /* And the mirror is EXACT — mirroring the input mirrors every derived point. */
  const mirroredEdge = derivePalmEdge(mirrored);
  assert.ok(mirroredEdge !== null);
  const pairs: ReadonlyArray<readonly [string, Point2, Point2]> = [
    ["p1", edge.p1, mirroredEdge.p1],
    ["p2", edge.p2, mirroredEdge.p2],
    ["percussionTop", edge.percussionTop, mirroredEdge.percussionTop],
  ];
  for (const [name, original, flipped] of pairs) {
    assert.ok(Math.abs(flipped.x - (1 - original.x)) < 1e-12, `${name} mirrors exactly in x`);
    assert.ok(Math.abs(flipped.y - original.y) < 1e-12, `${name} is untouched in y`);
  }
  assert.ok(Math.abs(mirroredEdge.peak - edge.peak) < 1e-12, "with the same peak magnitude");
  assert.ok(Math.abs(mirroredEdge.outward.x + edge.outward.x) < 1e-12, "outward mirrors in x");
  assert.ok(Math.abs(mirroredEdge.outward.y - edge.outward.y) < 1e-12, "and holds its y");

  /* Degenerate frames return null rather than NaN geometry. */
  const collinear = image.map((point, i) => {
    if (i === LM.INDEX_MCP) return { x: 0.5, y: 0.3, z: 0 };
    if (i === LM.PINKY_MCP) return { x: 0.5, y: 0.5, z: 0 };
    if (i === LM.WRIST) return { x: 0.5, y: 0.9, z: 0 };
    return point;
  });
  assert.equal(derivePalmEdge(collinear), null, "index/pinky/wrist collinear yields no edge");

  const coincident = image.map((point, i) =>
    i === LM.WRIST ? { x: image[LM.PINKY_MCP].x, y: image[LM.PINKY_MCP].y, z: 0 } : point,
  );
  assert.equal(derivePalmEdge(coincident), null, "wrist coincident with the knuckle yields no edge");

  /*
   * The configuration that used to need a detect-and-invert guard: knuckles and wrist arranged so
   * the palm centroid falls beyond the little knuckle. The anatomical frame never consults a
   * centroid, so this is not a special case at all — the invariants simply hold.
   */
  const awkward: Landmark3[] = image.map((point) => ({ ...point }));
  awkward[LM.THUMB_CMC] = { x: 0.2, y: 0.6, z: 0 };
  awkward[LM.PINKY_MCP] = { x: 0.45, y: 0.5, z: 0 };
  awkward[LM.WRIST] = { x: 0.8, y: 0.85, z: 0 };
  awkward[LM.INDEX_MCP] = { x: 0.85, y: 0.45, z: 0 };
  awkward[LM.MIDDLE_MCP] = { x: 0.8, y: 0.42, z: 0 };
  awkward[LM.RING_MCP] = { x: 0.75, y: 0.45, z: 0 };
  checkEdgeInvariants(awkward, "centroid-beyond-edge hand");

  /* Boundary: thumb ball → wrist → down the ulnar edge → little knuckle, in spatial order. */
  const boundary = palmBoundary(image);
  assert.ok(boundary !== null && boundary.length === 6, "the boundary has six points");
  assert.ok(Math.abs(boundary[0].x - image[LM.THUMB_CMC].x) < 1e-9, "it starts at the thumb ball");
  assert.ok(Math.abs(boundary[1].x - image[LM.WRIST].x) < 1e-9, "then the wrist");
  assert.ok(Math.abs(boundary[5].x - image[LM.PINKY_MCP].x) < 1e-9, "and ends at the little knuckle");

  /* No zig-zag: from the wrist onward each point must get strictly nearer the little knuckle. */
  for (let i = 2; i < boundary.length; i += 1) {
    assert.ok(
      distance(boundary[i], image[LM.PINKY_MCP]) < distance(boundary[i - 1], image[LM.PINKY_MCP]),
      `boundary point ${i} advances toward the little knuckle`,
    );
  }
  assert.equal(palmBoundary([]), null, "no landmarks, no boundary");
}

/* --------------------------- Five-anchor rectify --------------------------- */

{
  /* A mild synthetic perspective — the kind a tilted palm produces. */
  const TRUTH: Matrix3 = [1.1, 0.15, 12, -0.08, 0.95, 20, 0.0006, 0.0004, 1];
  const srcTrue: Point2[] = [
    { x: 60, y: 300 },
    { x: 20, y: 230 },
    { x: 40, y: 40 },
    { x: 210, y: 70 },
    { x: 245, y: 80 },
  ];
  const dstTrue = srcTrue.map((p) => {
    const mapped = applyHomography(TRUTH, p);
    assert.ok(mapped !== null, "the truth homography maps every anchor");
    return mapped;
  });

  /* On exact data the over-determined solve must reproduce the exact one. */
  const h4 = solveHomography(srcTrue.slice(0, 4), dstTrue.slice(0, 4));
  const h5 = solveHomography(srcTrue, dstTrue);
  assert.ok(h4 !== null && h5 !== null, "both solves succeed");
  for (let i = 0; i < 9; i += 1) {
    assert.ok(Math.abs(h4[i] - TRUTH[i]) < 1e-6, `4-anchor recovers truth element ${i}`);
    assert.ok(Math.abs(h5[i] - h4[i]) < 1e-6, `5-anchor reproduces the 4-anchor solve at element ${i}`);
  }

  /*
   * Under landmark noise the redundant fifth correspondence should measurably help.
   *
   * The 4-anchor fit maps its four *noisy* observations exactly onto their targets, so it inherits
   * their error wholesale. Least squares over five spreads the residual instead. Measured against
   * the noise-free correspondences, averaged over many seeded trials so the result is deterministic
   * rather than dependent on one lucky noise realisation.
   */
  let seed = 0x5eed1;
  const random = (): number => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const jitter = (amount: number): number => (random() - 0.5) * 2 * amount;

  const reprojection = (fit: Matrix3): number => {
    let total = 0;
    for (let i = 0; i < srcTrue.length; i += 1) {
      const got = applyHomography(fit, srcTrue[i]);
      if (got === null) return Infinity;
      total += (got.x - dstTrue[i].x) ** 2 + (got.y - dstTrue[i].y) ** 2;
    }
    return total / srcTrue.length;
  };

  const TRIALS = 200;
  const NOISE_PX = 2.5;
  let error4 = 0;
  let error5 = 0;
  let counted = 0;
  for (let trial = 0; trial < TRIALS; trial += 1) {
    const observed = srcTrue.map((p) => ({ x: p.x + jitter(NOISE_PX), y: p.y + jitter(NOISE_PX) }));
    const fit4 = solveHomography(observed.slice(0, 4), dstTrue.slice(0, 4));
    const fit5 = solveHomography(observed, dstTrue);
    if (fit4 === null || fit5 === null) continue;
    error4 += reprojection(fit4);
    error5 += reprojection(fit5);
    counted += 1;
  }
  assert.ok(counted > TRIALS * 0.95, "almost every noisy trial stays solvable");
  assert.ok(
    error5 < error4,
    "least-squares over 5 anchors beats the exact 4-anchor fit under noise (" +
      (error5 / counted).toFixed(3) +
      " vs " +
      (error4 / counted).toFixed(3) +
      ")",
  );
  console.log(
    "mean reprojection error: 4-anchor " +
      (error4 / counted).toFixed(3) +
      " → 5-anchor " +
      (error5 / counted).toFixed(3),
  );

  /* Guard rails on the correspondence count. */
  assert.equal(solveHomography(srcTrue.slice(0, 3), dstTrue.slice(0, 3)), null, "three anchors is not enough");
  assert.equal(solveHomography(srcTrue, dstTrue.slice(0, 4)), null, "mismatched lengths are rejected");
  assert.equal(canonicalAnchors(4)?.length, 4, "four canonical targets");
  assert.equal(canonicalAnchors(5)?.length, 5, "five canonical targets");
  assert.equal(canonicalAnchors(6), null, "any other count is refused");
}

{
  /* palmAnchors uses five when the percussion point is in frame... */
  const { image } = syntheticHand();
  const withEdge = palmAnchors(image, 1280, 720);
  assert.ok(withEdge !== null && withEdge.usedPercussion, "an in-frame percussion point is used");
  assert.equal(withEdge.src.length, 5, "giving five correspondences");

  /* ...and falls back to four when it would land outside the frame. */
  const atEdge = image.map((point, index) => (index === LM.PINKY_MCP ? { ...point, x: 0.995 } : point));
  const fallback = palmAnchors(atEdge, 1280, 720);
  assert.ok(fallback !== null && !fallback.usedPercussion, "an out-of-frame percussion point is dropped");
  assert.equal(fallback.src.length, 4, "falling back to four correspondences");

  assert.equal(palmAnchors(image, 1280, 720, false)?.src.length, 4, "the caller can force the 4-anchor path");
  assert.equal(palmAnchors([], 1280, 720), null, "no landmarks, no anchors");
}

/* Percussion-edge zones are reserved so marriage and outer Mars have coordinates when they land. */
{
  const ids = RESERVED_EDGE_ZONES.map((zone) => zone.id).sort();
  assert.deepEqual(ids, ["marriage", "mars_outer"], "both percussion zones are reserved");
  for (const zone of RESERVED_EDGE_ZONES) {
    assert.ok(zone.cx > 0.75, `${zone.id} sits on the percussion edge`);
    assert.ok(zone.r > 0 && zone.cy > 0 && zone.cy < 1, `${zone.id} has a sane footprint`);
  }
}


/* ------------------------------ Edge profile ------------------------------- */

{
  /*
   * The profile is the correction that mattered most: the previous construction applied a CONSTANT
   * offset, which draws a line parallel to the knuckle→wrist chord. Measured against the marked-up
   * reference frame, the real edge is a tent — it swells over the hypothenar and tapers at both ends.
   */
  assert.ok(Math.abs(edgeProfile(PALM_EDGE_APEX) - 1) < 1e-12, "the profile peaks at the apex");
  assert.equal(edgeProfile(0), PALM_EDGE_TAPER_FLOOR, "and is floored at the knuckle end");
  assert.equal(edgeProfile(1), PALM_EDGE_TAPER_FLOOR, "and at the wrist end");

  for (const t of [0, 0.1, 0.25, 0.4, 0.55, 0.65, 0.8, 0.9, 1]) {
    const v = edgeProfile(t);
    assert.ok(v >= PALM_EDGE_TAPER_FLOOR - 1e-12 && v <= 1 + 1e-12, `profile(${t}) stays within [floor, 1]`);
  }

  /* Monotone up to the apex, monotone down after it — a single bulge, no wobble. */
  let previous = edgeProfile(0);
  for (let t = 0.02; t <= PALM_EDGE_APEX + 1e-9; t += 0.02) {
    const v = edgeProfile(t);
    assert.ok(v >= previous - 1e-12, `profile rises to the apex (t=${t.toFixed(2)})`);
    previous = v;
  }
  previous = edgeProfile(PALM_EDGE_APEX);
  for (let t = PALM_EDGE_APEX + 0.02; t <= 1.0 + 1e-9; t += 0.02) {
    const v = edgeProfile(t);
    assert.ok(v <= previous + 1e-12, `profile falls after the apex (t=${t.toFixed(2)})`);
    previous = v;
  }

  /*
   * p2 sits PAST the apex, on the falling limb — the correction that pulled it back inside the hand.
   *
   * Measured against a clean near-square palm, the silhouette at the two drawn samples is 0.269 and
   * 0.345 palm widths: a ratio of 1.28. Parking p2 on the crest (apex 0.65, as it was) forces that
   * ratio to 1.91 and throws p2 well outside the skin. An apex before p2 is what reproduces 1.28.
   */
  assert.ok(PALM_EDGE_SAMPLE_T.p2 > PALM_EDGE_APEX, "the p2 sample sits past the apex");
  assert.ok(PALM_EDGE_SAMPLE_T.p1 < PALM_EDGE_APEX, "and p1 before it, on the rising limb");
  assert.ok(edgeProfile(PALM_EDGE_SAMPLE_T.p2) < 1, "so p2 is off the crest");
  assert.ok(edgeProfile(PALM_EDGE_SAMPLE_T.p2) > edgeProfile(PALM_EDGE_SAMPLE_T.p1), "yet still bulges further than p1");

  const sampleRatio = edgeProfile(PALM_EDGE_SAMPLE_T.p2) / edgeProfile(PALM_EDGE_SAMPLE_T.p1);
  assert.ok(
    Math.abs(sampleRatio - 1.28) < 0.12,
    `p2/p1 offset ratio matches the measured silhouette (${sampleRatio.toFixed(2)} vs 1.28)`,
  );

  /* The tuning override drives the peak linearly, which is what the slider relies on. */
  const { image: fixture } = syntheticHand();
  const half = derivePalmEdge(fixture, PALM_EDGE_PEAK / 2);
  const full = derivePalmEdge(fixture, PALM_EDGE_PEAK);
  assert.ok(half !== null && full !== null);
  assert.ok(Math.abs(half.peak * 2 - full.peak) < 1e-12, "the peak override scales linearly");
}

console.log("PALM EDGE + 5-ANCHOR ASSERTIONS PASSED");
