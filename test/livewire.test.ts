/* ============================================================================
 * LIVEWIRE — Dijkstra path snapping over the valley-cost image
 *
 * The claim under test: seed at one end of a drawn crease, cursor at the other,
 * and the returned path lies ON the crease — not near it, on it. Plus the cost
 * floor's job (no free wandering), metric path lengths, and Douglas-Peucker's
 * deviation guarantee. Timing of the full-grid seed solve is measured and
 * logged for the client's full-grid-vs-bounded decision.
 * ========================================================================== */
import assert from "node:assert/strict";
import { valleyResponse } from "../lib/scan/dev/valley";
import {
  COST_FLOOR,
  LIVEWIRE_RADIUS_PX,
  LIVEWIRE_SIMPLIFY_EPSILON_PX,
  Livewire,
  buildCostMap,
  simplifyPolyline,
} from "../lib/scan/dev/livewire";

let assertions = 0;
const ok = (condition: boolean, message: string): void => {
  assert.ok(condition, message);
  assertions += 1;
};

const SIZE = 512;

function makeRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0xffffffff;
  };
}

const curveY = (x: number): number => 180 + 0.0009 * (x - 256) * (x - 256);

function syntheticField(drawCurve: (gray: Float32Array) => void): Float32Array {
  const random = makeRandom(20260902);
  const gray = new Float32Array(SIZE * SIZE);
  for (let i = 0; i < gray.length; i += 1) gray[i] = (200 + (random() * 14 - 7)) / 255;
  drawCurve(gray);
  return gray;
}

/* -------------------------- 1. Snaps to the curve -------------------------- */

{
  const gray = syntheticField((plane) => {
    for (let x = 0; x < SIZE; x += 1) {
      const centre = Math.round(curveY(x));
      for (let dy = -1; dy <= 1; dy += 1) plane[(centre + dy) * SIZE + x] = 60 / 255;
    }
  });
  const valley = valleyResponse(gray, SIZE);
  const cost = buildCostMap(valley, SIZE);
  ok(Math.abs(cost[0] - (COST_FLOOR + 1 - valley[0])) < 1e-6, "cost = floor + (1 − valley)");

  const livewire = new Livewire(cost, SIZE);
  const startX = 8;
  const endX = 504;
  livewire.setSeed(startX, Math.round(curveY(startX)));
  console.log(`  full-grid setSeed on 512²: ${livewire.seedCostMs.toFixed(1)} ms`);

  const flat: number[] = [];
  const count = livewire.pathTo(endX, Math.round(curveY(endX)), flat);
  ok(count >= 300, `a corner-to-corner snap yields a dense path (${count} points)`);

  let worst = 0;
  let sum = 0;
  for (let i = 0; i < flat.length; i += 2) {
    const deviation = Math.abs(flat[i + 1] - Math.round(curveY(flat[i])));
    worst = Math.max(worst, deviation);
    sum += deviation;
  }
  const mean = sum / count;
  ok(worst <= 2.5, `every path pixel within 2.5 px of the curve (worst ${worst.toFixed(2)})`);
  ok(mean < 1.0, `mean deviation under 1 px (got ${mean.toFixed(3)})`);
  ok(flat[0] === startX && flat[flat.length - 2] === endX, "path runs seed → cursor");

  /* ------------------- 4. Douglas-Peucker on the real path ------------------- */
  const points: number[][] = [];
  for (let i = 0; i < flat.length; i += 2) points.push([flat[i], flat[i + 1]]);
  const simplified = simplifyPolyline(points);
  ok(points.length >= 300, "input to simplify is ≥ 300 points");
  ok(simplified.length <= 24, `simplify reduces to ≤ 24 points (got ${simplified.length})`);

  // D-P guarantee: every original point within epsilon of the simplified polyline.
  const segmentDistance = (p: number[], a: number[], b: number[]): number => {
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const lengthSq = dx * dx + dy * dy;
    const t = lengthSq === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / lengthSq));
    return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
  };
  let worstDeviation = 0;
  for (const p of points) {
    let best = Number.POSITIVE_INFINITY;
    for (let i = 0; i + 1 < simplified.length; i += 1) {
      best = Math.min(best, segmentDistance(p, simplified[i], simplified[i + 1]));
    }
    worstDeviation = Math.max(worstDeviation, best);
  }
  ok(
    worstDeviation <= LIVEWIRE_SIMPLIFY_EPSILON_PX + 1e-9,
    `max deviation after simplify ≤ ε=${LIVEWIRE_SIMPLIFY_EPSILON_PX} (got ${worstDeviation.toFixed(3)})`,
  );
}

/* --------------------- 2. Straight line, metric length --------------------- */

{
  const gray = syntheticField((plane) => {
    for (let x = 0; x < SIZE; x += 1) {
      for (let dy = -1; dy <= 1; dy += 1) plane[(256 + dy) * SIZE + x] = 60 / 255;
    }
  });
  const livewire = new Livewire(buildCostMap(valleyResponse(gray, SIZE), SIZE), SIZE);
  livewire.setSeed(8, 256);
  const flat: number[] = [];
  const count = livewire.pathTo(504, 256, flat);
  ok(count > 0, "straight line is reachable");
  let length = 0;
  for (let i = 2; i < flat.length; i += 2) {
    length += Math.hypot(flat[i] - flat[i - 2], flat[i + 1] - flat[i - 1]);
  }
  const euclidean = 504 - 8;
  ok(
    Math.abs(length - euclidean) / euclidean <= 0.02,
    `straight-line path length within 2% of Euclidean (${length.toFixed(1)} vs ${euclidean})`,
  );
}

/* ----------------------- 3. Bounded window semantics ----------------------- */

{
  const cost = new Float32Array(SIZE * SIZE).fill(1);
  const livewire = new Livewire(cost, SIZE);
  livewire.setSeed(256, 256, LIVEWIRE_RADIUS_PX);
  ok(livewire.covers(256 + LIVEWIRE_RADIUS_PX - 1, 256), "window covers up to the radius");
  ok(!livewire.covers(256 + LIVEWIRE_RADIUS_PX + 2, 256), "…and refuses beyond it");
  const flat: number[] = [];
  ok(livewire.pathTo(500, 500, flat) === 0 && flat.length === 0, "pathTo outside the window returns 0, not garbage");
  ok(livewire.pathTo(300, 300, flat) > 0, "pathTo inside the window works");
}

console.log(`LIVEWIRE ASSERTIONS PASSED (${assertions})`);
