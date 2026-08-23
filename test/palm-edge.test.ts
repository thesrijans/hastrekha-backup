import assert from "node:assert/strict";
import { LM } from "../lib/scan/landmark-index";
import { derivePalmEdge, palmBoundary, PALM_EDGE_OFFSET } from "../lib/scan/landmarks";
import { palmSpan } from "../lib/scan/quality";
import {
  applyHomography,
  canonicalAnchors,
  palmAnchors,
  solveHomography,
  type Matrix3,
} from "../lib/scan/rectify";
import { RESERVED_EDGE_ZONES } from "../lib/scan/zones";
import type { Point2 } from "../lib/scan/types";
import { mirrorHand, syntheticHand } from "./hand-fixture";

const distance = (a: Point2, b: Point2): number => Math.hypot(a.x - b.x, a.y - b.y);

/* ------------------------------- Palm edge -------------------------------- */

{
  const { image } = syntheticHand();
  const edge = derivePalmEdge(image);
  assert.ok(edge !== null, "palm edge derives from a full landmark set");
  assert.equal(derivePalmEdge([]), null, "too few landmarks yields no edge");

  assert.ok(Math.abs(edge.offset - palmSpan(image) * PALM_EDGE_OFFSET) < 1e-9, "offset is 12% of palm span");

  const lerpAt = (t: number): Point2 => ({
    x: image[LM.PINKY_MCP].x + (image[LM.WRIST].x - image[LM.PINKY_MCP].x) * t,
    y: image[LM.PINKY_MCP].y + (image[LM.WRIST].y - image[LM.PINKY_MCP].y) * t,
  });

  /* The defining property: every derived point sits FURTHER from the centroid than its base, by
     exactly the offset. That is what "outward" has to mean for the edge to land on skin. */
  const cases: ReadonlyArray<readonly [string, Point2, Point2]> = [
    ["p1", lerpAt(0.33), edge.p1],
    ["p2", lerpAt(0.66), edge.p2],
    ["percussionTop", { x: image[LM.PINKY_MCP].x, y: image[LM.PINKY_MCP].y }, edge.percussionTop],
  ];
  for (const [name, base, pushed] of cases) {
    const before = distance(base, edge.centroid);
    const after = distance(pushed, edge.centroid);
    assert.ok(after > before, name + " moves away from the centroid");
    assert.ok(Math.abs(after - before - edge.offset) < 1e-6, name + " moves exactly the offset distance");
  }

  /* p1 and p2 must sit between the knuckle and the wrist, in order. */
  assert.ok(
    distance(edge.p1, image[LM.PINKY_MCP]) < distance(edge.p2, image[LM.PINKY_MCP]),
    "p1 is nearer the little knuckle than p2",
  );
  assert.ok(distance(edge.p2, image[LM.WRIST]) < distance(edge.p1, image[LM.WRIST]), "and p2 is nearer the wrist");

  /* Mirrored input: a left hand must push outward too, with no handedness branch anywhere. */
  const mirrored = mirrorHand(image);
  const mirroredEdge = derivePalmEdge(mirrored);
  assert.ok(mirroredEdge !== null, "the mirrored hand also derives an edge");

  const mirroredCases: ReadonlyArray<readonly [string, Point2, Point2]> = [
    ["p1", { x: 1 - lerpAt(0.33).x, y: lerpAt(0.33).y }, mirroredEdge.p1],
    ["p2", { x: 1 - lerpAt(0.66).x, y: lerpAt(0.66).y }, mirroredEdge.p2],
    ["percussionTop", { x: 1 - image[LM.PINKY_MCP].x, y: image[LM.PINKY_MCP].y }, mirroredEdge.percussionTop],
  ];
  for (const [name, base, pushed] of mirroredCases) {
    assert.ok(
      distance(pushed, mirroredEdge.centroid) > distance(base, mirroredEdge.centroid),
      "mirrored " + name + " still moves away from the centroid",
    );
  }

  /* And the mirror is exact — mirroring the input mirrors every derived point. */
  assert.ok(Math.abs(mirroredEdge.percussionTop.x - (1 - edge.percussionTop.x)) < 1e-9, "mirroring is exact in x");
  assert.ok(Math.abs(mirroredEdge.percussionTop.y - edge.percussionTop.y) < 1e-9, "and leaves y alone");
  assert.ok(Math.abs(mirroredEdge.offset - edge.offset) < 1e-9, "with the same offset magnitude");

  /* Boundary: thumb ball → wrist → down the ulnar edge → little knuckle. */
  const boundary = palmBoundary(image);
  assert.ok(boundary !== null && boundary.length === 6, "the boundary has six points");
  assert.ok(Math.abs(boundary[0].x - image[LM.THUMB_CMC].x) < 1e-9, "it starts at the thumb ball");
  assert.ok(Math.abs(boundary[1].x - image[LM.WRIST].x) < 1e-9, "then the wrist");
  assert.ok(Math.abs(boundary[5].x - image[LM.PINKY_MCP].x) < 1e-9, "and ends at the little knuckle");
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
    assert.ok(Math.abs(h4[i] - TRUTH[i]) < 1e-6, "4-anchor recovers truth element " + i);
    assert.ok(Math.abs(h5[i] - h4[i]) < 1e-6, "5-anchor reproduces the 4-anchor solve at element " + i);
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
    assert.ok(zone.cx > 0.75, zone.id + " sits on the percussion edge");
    assert.ok(zone.r > 0 && zone.cy > 0 && zone.cy < 1, zone.id + " has a sane footprint");
  }
}

console.log("PALM EDGE + 5-ANCHOR ASSERTIONS PASSED");
