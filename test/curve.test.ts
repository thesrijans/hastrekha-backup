import assert from "node:assert/strict";
import { bezierAt, catmullRomSegments } from "../lib/scan/curve";
import { derivePalmEdge, palmBoundary } from "../lib/scan/landmarks";
import type { Point2 } from "../lib/scan/types";
import { syntheticHand } from "./hand-fixture";

const distance = (a: Point2, b: Point2): number => Math.hypot(a.x - b.x, a.y - b.y);

/* --------------------------------- Degenerate ------------------------------- */

{
  assert.deepEqual(catmullRomSegments([]), [], "no points, no segments");
  assert.deepEqual(catmullRomSegments([{ x: 1, y: 2 }]), [], "one point, no segments");

  const two = catmullRomSegments([
    { x: 0, y: 0 },
    { x: 10, y: 0 },
  ]);
  assert.equal(two.length, 1, "two points make one segment");
  assert.deepEqual(two[0].to, { x: 10, y: 0 }, "which ends at the second point");
}

/* ------------------------------- Interpolation ------------------------------ */

{
  /*
   * The property the whole choice of spline rests on: every input point lies ON the curve. If it
   * did not, the drawn boundary would quietly diverge from what `derivePalmEdge` computes and what
   * the fixture tests assert.
   */
  const points: Point2[] = [
    { x: 0, y: 0 },
    { x: 10, y: 20 },
    { x: 35, y: 25 },
    { x: 60, y: 5 },
    { x: 75, y: -20 },
  ];
  const segments = catmullRomSegments(points);
  assert.equal(segments.length, points.length - 1, "one segment per gap");

  for (let i = 0; i < segments.length; i += 1) {
    const from = points[i];
    const start = bezierAt(from, segments[i], 0);
    const finish = bezierAt(from, segments[i], 1);
    assert.ok(distance(start, points[i]) < 1e-12, `segment ${i} starts on point ${i}`);
    assert.ok(distance(finish, points[i + 1]) < 1e-12, `segment ${i} ends on point ${i + 1}`);
  }
}

{
  /* Collinear input must stay collinear — a spline that bulges through a straight run is wrong. */
  const line: Point2[] = [
    { x: 0, y: 0 },
    { x: 10, y: 10 },
    { x: 20, y: 20 },
    { x: 30, y: 30 },
  ];
  const segments = catmullRomSegments(line);
  for (let i = 0; i < segments.length; i += 1) {
    for (const s of [0.25, 0.5, 0.75]) {
      const p = bezierAt(line[i], segments[i], s);
      assert.ok(Math.abs(p.x - p.y) < 1e-9, `collinear input stays on the line (segment ${i}, s=${s})`);
    }
  }
}

{
  /* Tangent continuity at the interior knots: the curve is smooth, not kinked. */
  const points: Point2[] = [
    { x: 0, y: 0 },
    { x: 20, y: 30 },
    { x: 50, y: 35 },
    { x: 80, y: 10 },
  ];
  const segments = catmullRomSegments(points);
  const eps = 1e-5;
  for (let i = 1; i < segments.length; i += 1) {
    const before = bezierAt(points[i - 1], segments[i - 1], 1 - eps);
    const knot = points[i];
    const after = bezierAt(points[i], segments[i], eps);

    const incoming = { x: knot.x - before.x, y: knot.y - before.y };
    const outgoing = { x: after.x - knot.x, y: after.y - knot.y };
    const magnitude = Math.hypot(incoming.x, incoming.y) * Math.hypot(outgoing.x, outgoing.y);
    const cosine = (incoming.x * outgoing.x + incoming.y * outgoing.y) / magnitude;
    assert.ok(cosine > 0.9999, `no kink at knot ${i} (cos=${cosine.toFixed(6)})`);
  }
}

/* --------------------------- Against the real boundary ---------------------- */

{
  const { image } = syntheticHand();
  const boundary = palmBoundary(image);
  assert.ok(boundary !== null, "the fixture hand yields a boundary");

  const segments = catmullRomSegments(boundary);
  assert.equal(segments.length, boundary.length - 1, "the boundary smooths into one curve, not several");

  /* Every derived sample still lies on the drawn curve. */
  const edge = derivePalmEdge(image);
  assert.ok(edge !== null);
  for (const [name, point] of [
    ["p1", edge.p1],
    ["p2", edge.p2],
    ["percussionTop", edge.percussionTop],
  ] as ReadonlyArray<readonly [string, Point2]>) {
    const onCurve = boundary.some((b, i) => {
      if (distance(b, point) > 1e-12) return false;
      if (i === 0) return true;
      return distance(bezierAt(boundary[i - 1], segments[i - 1], 1), point) < 1e-12;
    });
    assert.ok(onCurve, `${name} lies on the smoothed boundary`);
  }

  /*
   * Smoothing must not blow the curve outward. Sampling densely, no point on the curve may sit
   * further from the wrist than the furthest sample — otherwise the spline would overshoot past the
   * silhouette exactly where the constants were tuned not to.
   */
  const wrist = image[0];
  const furthestSample = Math.max(...boundary.map((p) => distance(p, wrist)));
  let furthestCurve = 0;
  for (let i = 0; i < segments.length; i += 1) {
    for (let s = 0; s <= 1.0001; s += 0.02) {
      furthestCurve = Math.max(furthestCurve, distance(bezierAt(boundary[i], segments[i], s), wrist));
    }
  }
  assert.ok(
    furthestCurve <= furthestSample * 1.03,
    `the spline does not overshoot its samples (${furthestCurve.toFixed(4)} vs ${furthestSample.toFixed(4)})`,
  );
}

console.log("CATMULL-ROM ASSERTIONS PASSED");
