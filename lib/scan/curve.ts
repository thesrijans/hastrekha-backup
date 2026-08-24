/**
 * Catmull-Rom → cubic Bézier conversion.
 *
 * The palm boundary is five or six samples wide. Joining them with straight chords puts a hard
 * corner at every sample, and a corner reads as intent — it makes any overshoot look deliberate and
 * twice as large as it is. A spline curves between the samples instead.
 *
 * Catmull-Rom is the right family precisely because it **interpolates**: every input point lies on
 * the output curve, so the geometry the tests assert about is exactly the geometry drawn. A
 * smoothing spline (B-spline, say) would pull the curve off the samples, and the drawn edge would
 * quietly stop matching `derivePalmEdge`.
 *
 * Pure maths, no canvas — so the interpolation property is unit-tested rather than eyeballed.
 */
import type { Point2 } from "./types";

/** One cubic Bézier: the curve runs from the previous segment's `to` (or the first point) to `to`. */
export interface BezierSegment {
  readonly control1: Point2;
  readonly control2: Point2;
  readonly to: Point2;
}

/**
 * Tangent scale. 1/6 is the uniform (centripetal-free) Catmull-Rom constant: it makes the Bézier's
 * derivative at each knot equal (P[i+1] − P[i−1]) / 2, which is the Catmull-Rom tangent.
 */
const TANGENT = 1 / 6;

/**
 * Converts a polyline into Bézier segments passing through every point.
 *
 * The first and last points are duplicated as phantom neighbours, so the end segments curve toward
 * their single neighbour rather than flying off.
 *
 * @returns an empty array for fewer than two points; a single straight segment for exactly two.
 */
export function catmullRomSegments(points: readonly Point2[]): BezierSegment[] {
  if (points.length < 2) return [];
  if (points.length === 2) {
    return [{ control1: points[0], control2: points[1], to: points[1] }];
  }

  const out: BezierSegment[] = [];
  for (let i = 0; i < points.length - 1; i += 1) {
    const p0 = points[i === 0 ? 0 : i - 1];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2 >= points.length ? points.length - 1 : i + 2];
    out.push({
      control1: { x: p1.x + (p2.x - p0.x) * TANGENT, y: p1.y + (p2.y - p0.y) * TANGENT },
      control2: { x: p2.x - (p3.x - p1.x) * TANGENT, y: p2.y - (p3.y - p1.y) * TANGENT },
      to: p2,
    });
  }
  return out;
}

/** Evaluates one cubic Bézier at `s` ∈ [0,1]. Used by the tests to sample the drawn curve. */
export function bezierAt(from: Point2, segment: BezierSegment, s: number): Point2 {
  const u = 1 - s;
  const a = u * u * u;
  const b = 3 * u * u * s;
  const c = 3 * u * s * s;
  const d = s * s * s;
  return {
    x: a * from.x + b * segment.control1.x + c * segment.control2.x + d * segment.to.x,
    y: a * from.y + b * segment.control1.y + c * segment.control2.y + d * segment.to.y,
  };
}
