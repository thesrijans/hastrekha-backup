/**
 * Placement: a trace must be drawn through the rectification it was traced in.
 *
 * The failure this exists to prevent is peculiarly convincing. Traces drawn through the *wrong*
 * homography still look like palm lines — smooth, plausibly placed, following the general run of the
 * hand — they just sit beside the creases instead of on them. There is no crash, no blank screen and
 * no obviously wrong number; the scan simply reads the wrong palm, confidently.
 *
 * Two independent mismatches were measured in the shipped path, and both are pinned here:
 *
 *  - **Convention.** The crop is fitted with four or five anchor correspondences depending on whether
 *    the percussion point is usable; the overlay always solved from four. Measured on a real frame:
 *    4.6 video pixels, which is about a crease's whole width.
 *  - **Anchor source.** The crop is fitted to *stabilised* anchors — the 1-euro filtered ones — while
 *    the overlay solved from raw landmarks. Zero on a still hand, and growing with motion, which is
 *    the worst possible shape for a bug: invisible in testing, present when it matters.
 */
import assert from "node:assert/strict";
import {
  applyHomography,
  canonicalAnchors,
  canonicalQuad,
  palmAnchors,
  palmQuad,
  solveHomography,
  type Matrix3,
} from "../lib/scan/rectify";
import { emptyStabiliser, stabiliseAnchors } from "../lib/scan/stabilise";
import { MASK_SIZE, type Landmark3, type Point2 } from "../lib/scan/types";
import { syntheticHand } from "./hand-fixture";

const FRAME_W = 640;
const FRAME_H = 480;

/** Canonical crop points standing in for where traces get drawn. */
const PROBES: Point2[] = [];
for (let gy = 1; gy <= 4; gy += 1) {
  for (let gx = 1; gx <= 4; gx += 1) PROBES.push({ x: (gx * MASK_SIZE) / 5, y: (gy * MASK_SIZE) / 5 });
}

function project(h: Matrix3, points: readonly Point2[]): Point2[] {
  return points.map((p) => applyHomography(h, p)).filter((p): p is Point2 => p !== null);
}

function worstGap(a: readonly Point2[], b: readonly Point2[]): number {
  let worst = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i += 1) {
    worst = Math.max(worst, Math.hypot(a[i].x - b[i].x, a[i].y - b[i].y));
  }
  return worst;
}

/* ------------------- The convention mismatch, measured -------------------- */

{
  const marks = syntheticHand().image;
  const anchors = palmAnchors(marks, FRAME_W, FRAME_H);
  assert.ok(anchors !== null, "the fixture yields anchors");
  assert.equal(anchors.src.length, 5, "and the percussion point is usable, so the crop uses five");

  /* What the mask was computed in. */
  const cropTargets = canonicalAnchors(anchors.src.length, MASK_SIZE);
  assert.ok(cropTargets !== null);
  const maskToVideo = solveHomography(cropTargets, anchors.src);
  assert.ok(maskToVideo !== null, "the five-anchor fit solves");

  /* What the overlay used to project through: always four, from raw landmarks. */
  const quad = palmQuad(marks, FRAME_W, FRAME_H);
  assert.ok(quad !== null);
  const fourToVideo = solveHomography(canonicalQuad(MASK_SIZE), quad);
  assert.ok(fourToVideo !== null);

  const gap = worstGap(project(maskToVideo, PROBES), project(fourToVideo, PROBES));
  assert.ok(
    gap > 1,
    `projecting a 5-anchor crop through a 4-anchor homography misplaces traces (${gap.toFixed(1)} px)`,
  );

  /* And the fix: same convention, same anchors, zero gap. */
  const matched = solveHomography(cropTargets, anchors.src);
  assert.ok(matched !== null);
  assert.equal(
    worstGap(project(maskToVideo, PROBES), project(matched, PROBES)),
    0,
    "reproducing the convention from the same anchors is exact",
  );
}

/* -------------------- The anchor-source mismatch --------------------------- */

{
  /*
   * A moving hand, which is when the filter and the raw landmarks disagree most. On a still hand the
   * two converge and the bug is invisible — which is exactly why it survived.
   */
  const base = syntheticHand().image;
  const stabiliser = emptyStabiliser();
  let filtered: readonly Point2[] = [];
  let raw: readonly Point2[] = [];

  for (let frame = 0; frame < 30; frame += 1) {
    const drift = frame * 0.006;
    const moving: Landmark3[] = base.map((m) => ({ ...m, x: m.x + drift }));
    const anchors = palmAnchors(moving, FRAME_W, FRAME_H);
    assert.ok(anchors !== null);
    raw = anchors.src;
    filtered = stabiliseAnchors(stabiliser, anchors.src, frame * (1000 / 30)).points;
  }

  const targets = canonicalAnchors(filtered.length, MASK_SIZE);
  assert.ok(targets !== null);
  const fromFiltered = solveHomography(targets, filtered);
  const rawTargets = canonicalAnchors(raw.length, MASK_SIZE);
  assert.ok(rawTargets !== null);
  const fromRaw = solveHomography(rawTargets, raw);
  assert.ok(fromFiltered !== null && fromRaw !== null);

  const gap = worstGap(project(fromFiltered, PROBES), project(fromRaw, PROBES));
  assert.ok(
    gap > 0.5,
    `on a moving hand, filtered and raw anchors disagree (${gap.toFixed(1)} px) — the crop uses one, so the overlay must too`,
  );
}

/* ------------- The rule: matching convention, or do not draw --------------- */

/**
 * The overlay's decision, extracted so it can be asserted rather than eyeballed.
 *
 * Mirrors `palm-overlay.tsx`. Two records, not one, and the distinction is the point:
 *
 *  - `traced` is the rectification the traces were traced in. Only its CONVENTION is used.
 *  - `live` is the current frame's rectification. Its ANCHORS are what the traces project through.
 *
 * Canonical space is motion-compensated, so a trace is equally valid under either frame's matrix and
 * projecting through the live one is what keeps it glued to a moving hand. But the convention must
 * match — a 5-anchor crop was fitted to five targets and reproducing it from four is a different
 * transform — and when it cannot be reproduced from this frame, nothing is drawn.
 */
function projectionFor(
  traced: { readonly convention: number } | null,
  live: { readonly anchors: readonly Point2[]; readonly convention: number } | null,
): Matrix3 | null {
  if (traced === null || live === null) return null;
  if (live.anchors.length !== live.convention) return null;
  if (live.convention !== traced.convention) return null;
  const targets = canonicalAnchors(traced.convention, MASK_SIZE);
  return targets === null ? null : solveHomography(targets, live.anchors);
}

{
  const marks = syntheticHand().image;
  const anchors = palmAnchors(marks, FRAME_W, FRAME_H);
  assert.ok(anchors !== null);
  const convention = anchors.src.length;
  const record = { anchors: anchors.src, convention };

  const consistent = projectionFor({ convention }, record);
  assert.ok(consistent !== null, "a consistent pair projects");

  /* A live record whose anchor count disagrees with its stated convention must NOT draw. */
  assert.equal(
    projectionFor({ convention: 5 }, { anchors: anchors.src.slice(0, 4), convention: 5 }),
    null,
    "four anchors labelled as a five-anchor convention is refused, not silently re-fitted",
  );
  /*
   * THE NEW CASE. The traces were fitted under one convention and this frame resolves the other —
   * the percussion point went out of view, or came back into it. The two transforms are genuinely
   * different, so there is nothing to draw. Until STEP 15 this fell back to raw landmarks and drew
   * anyway, reintroducing the 4.6px offset measured at the top of this file.
   */
  assert.equal(
    projectionFor({ convention: 5 }, { anchors: anchors.src.slice(0, 4), convention: 4 }),
    null,
    "traces fitted under 5 anchors are not drawn through a 4-anchor frame",
  );
  assert.equal(projectionFor(null, record), null, "no traced record draws nothing");
  assert.equal(projectionFor({ convention }, null), null, "and neither does a frame with no anchors");

  /*
   * The property that matters most: a trace projected through the matching record lands where the
   * mask says it is, to floating-point exactness. Anything less and the traces sit beside the creases.
   */
  const targets = canonicalAnchors(convention, MASK_SIZE);
  assert.ok(targets !== null);
  const truth = solveHomography(targets, anchors.src);
  assert.ok(truth !== null);
  assert.equal(worstGap(project(consistent, PROBES), project(truth, PROBES)), 0, "and it is exact");
}

/* ------------- Live anchors, not frozen ones: the lag, measured ------------ */

{
  /*
   * Why the overlay projects through the CURRENT frame rather than the anchors stored with the
   * traces. Both describe the same canonical space, so both are "correct" — but the stored ones are
   * captured when traces are re-extracted, which runs at the classical stride and not per frame.
   * Draw through those and the traces are pinned to where the hand WAS.
   *
   * Here the same hand translates by 20px between the extraction and the draw. Projecting through
   * the live anchors follows it; projecting through the frozen ones does not, and the traces sit off
   * the creases by the distance the hand moved.
   */
  const at = syntheticHand().image;
  const moved: Landmark3[] = at.map((m) => ({ ...m, x: m.x + 20 / FRAME_W }));

  const frozen = palmAnchors(at, FRAME_W, FRAME_H);
  const current = palmAnchors(moved, FRAME_W, FRAME_H);
  assert.ok(frozen !== null && current !== null);
  assert.equal(frozen.src.length, current.src.length, "the convention is unchanged by the movement");
  const convention = current.src.length;

  const live = projectionFor({ convention }, { anchors: current.src, convention });
  const stale = projectionFor({ convention }, { anchors: frozen.src, convention });
  assert.ok(live !== null && stale !== null);

  /* Where the trace SHOULD land now: the current frame's own rectification. */
  const truthNow = project(live, PROBES);
  assert.equal(worstGap(truthNow, project(live, PROBES)), 0, "live anchors track the hand exactly");

  const lag = worstGap(project(stale, PROBES), truthNow);
  assert.ok(
    lag > 15,
    `and frozen anchors lag by about the distance the hand moved (${lag.toFixed(1)} px of 20)`,
  );
  console.log(`  frozen-anchor lag after a 20px hand move: ${lag.toFixed(1)} px`);
}

/* ---------------- Degraded: a clipped hand still yields anchors ------------ */

{
  /*
   * The reason clipping needs its own check rather than relying on rectification coverage. MediaPipe
   * returns 21 points whatever it can see, extrapolating the ones it cannot; `derivePalmEdge` then
   * builds the percussion anchor out of those guesses. The palm anchors can all still be inside the
   * frame while the fingers are not — so coverage stays high and the crop looks perfectly fine.
   */
  const base = syntheticHand().image;
  const clipped = (marks: readonly Landmark3[]): boolean =>
    marks.some((p) => p.x < 0 || p.x > 1 || p.y < 0 || p.y > 1);

  /*
   * `palmAnchors` does guard the percussion point — it drops to four correspondences when the
   * extrapolated point lands outside the frame. But that guard tests the DERIVED point, not the
   * landmarks it was derived from, so whether it fires depends on which direction the hand left the
   * frame. Sweeping the hand off the edge, there are shifts where landmarks are already outside and
   * the anchor set is still a confident five.
   */
  let sawClippedWithFullAnchors = false;
  let sawClippedWithFallback = false;
  const directions: ReadonlyArray<readonly [number, number]> = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ];
  for (const [dx, dy] of directions) for (let shift = 0.05; shift <= 0.45; shift += 0.05) {
    const pushed: Landmark3[] = base.map((m) => ({ ...m, x: m.x + dx * shift, y: m.y + dy * shift }));
    if (!clipped(pushed)) continue;
    const anchors = palmAnchors(pushed, FRAME_W, FRAME_H);
    if (anchors === null) continue;
    if (anchors.src.length === 5) sawClippedWithFullAnchors = true;
    else sawClippedWithFallback = true;
  }

  assert.ok(
    sawClippedWithFullAnchors,
    "a clipped hand can still produce a full five-anchor set built partly from landmarks that were " +
      "never seen — so the anchor count cannot be used as a proxy for 'the hand is fully in view'",
  );
  assert.ok(sawClippedWithFallback, "and the existing percussion guard does fire sometimes, just not reliably");

  /* Hence the hook's own check, on the landmarks themselves. */
  assert.equal(clipped(base.map((m) => ({ ...m, x: m.x + 0.3 }))), true, "the clipped hand is detected");
  assert.equal(clipped(base), false, "and a hand fully in view is not");
}

console.log("PLACEMENT ASSERTIONS PASSED");
