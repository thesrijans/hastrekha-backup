/**
 * Anatomical completion: fragments become continuous named curves, and the fit stays honest.
 *
 * Two things are being pinned. That completion *works* — a crease broken into pieces by uneven
 * lighting comes out as one line rather than three failures, which is the defect this module exists
 * for. And that it does not work too well — a corridor with no evidence in it produces nothing, and a
 * bridged gap is labelled as bridged, because the reading engine downstream states these as fact.
 */
import assert from "node:assert/strict";
import {
  completeLines,
  corridorFor,
  endpointObserved,
  fitLine,
  projectToCorridor,
  sampleCorridor,
  scoreFragment,
  selectSeeds,
  CORRIDORS,
  CORRIDOR_SAMPLES,
  MAX_END_EXTRAPOLATION,
  type Poly,
} from "../lib/scan/completion";
import { ACTIVE_LINE_IDS, RECTIFIED_SIZE, type ActiveLineId, type Point2 } from "../lib/scan/types";
import { LINE_SPECS } from "../lib/scan/lines";

const SIZE = RECTIFIED_SIZE;

/* --------------------------- Corridors are derived ------------------------- */

{
  /*
   * The corridors are only trustworthy because their ends are the existing LINE_SPECS rather than
   * fresh opinions. If someone retunes LINE_SPECS and not the corridors, the prior silently stops
   * agreeing with the classifier it was derived from — this catches that.
   */
  for (const spec of LINE_SPECS) {
    const corridor = CORRIDORS[spec.id];
    const first = corridor.knots[0];
    const last = corridor.knots[corridor.knots.length - 1];
    assert.ok(
      Math.hypot(first.x - spec.from.x, first.y - spec.from.y) < 1e-9,
      `${spec.id} corridor starts at its LINE_SPECS origin`,
    );
    // Head's terminal is deliberately pulled off the spec, to the middle of the classes it must
    // distinguish rather than sitting on one extreme of them.
    const tolerance = spec.id === "head" ? 0.07 : 1e-9;
    assert.ok(
      Math.hypot(last.x - spec.to.x, last.y - spec.to.y) <= tolerance,
      `${spec.id} corridor ends at (or deliberately near) its LINE_SPECS terminal`,
    );
  }

  for (const id of ACTIVE_LINE_IDS) {
    const samples = corridorFor(id);
    assert.equal(samples.length, CORRIDOR_SAMPLES, `${id} resamples to a fixed count`);
    assert.equal(samples[0].s, 0, `${id} starts at arc 0`);
    assert.ok(Math.abs(samples[samples.length - 1].s - 1) < 1e-9, `${id} ends at arc 1`);

    /* Uniform in ARC LENGTH, not in curve parameter — everything downstream assumes that. */
    const steps: number[] = [];
    for (let i = 1; i < samples.length; i += 1) {
      steps.push(Math.hypot(samples[i].x - samples[i - 1].x, samples[i].y - samples[i - 1].y));
    }
    const mean = steps.reduce((a, b) => a + b, 0) / steps.length;
    const worst = Math.max(...steps.map((s) => Math.abs(s - mean) / mean));
    assert.ok(worst < 0.25, `${id} samples are near-uniform in arc length (worst ${(worst * 100).toFixed(0)}%)`);

    /* Tangent and normal are unit and perpendicular, or every offset measurement is wrong. */
    for (const sample of samples) {
      assert.ok(Math.abs(Math.hypot(sample.tx, sample.ty) - 1) < 1e-6, `${id} tangent is unit`);
      assert.ok(Math.abs(sample.tx * sample.nx + sample.ty * sample.ny) < 1e-9, `${id} normal is perpendicular`);
      assert.ok(sample.half > 0, `${id} has a positive half-width everywhere`);
    }
  }

  /*
   * The corridors must not touch across mid-palm, or heart and head fragments become
   * indistinguishable exactly where the discrimination has to work.
   */
  const heartMid = corridorFor("heart").find((s) => Math.abs(s.x - 0.49) < 0.03);
  const headMid = corridorFor("head").find((s) => Math.abs(s.x - 0.49) < 0.03);
  assert.ok(heartMid !== undefined && headMid !== undefined, "both corridors cross mid-palm");
  const gap = Math.abs(heartMid.y - headMid.y);
  assert.ok(
    gap > heartMid.half + headMid.half,
    `heart and head corridors stay disjoint mid-palm (gap ${gap.toFixed(3)} vs half-widths ${(heartMid.half + headMid.half).toFixed(3)})`,
  );
}

/* ------------------------------- Projection -------------------------------- */

{
  const samples = corridorFor("heart");
  const mid = samples[Math.floor(samples.length / 2)];
  const on: Point2 = { x: mid.x * SIZE, y: mid.y * SIZE };
  const hit = projectToCorridor(samples, on, SIZE);
  assert.ok(Math.abs(hit.offset) < 1.5, "a point on the centreline has ~zero offset");
  assert.ok(hit.inside, "and is inside");

  const off: Point2 = { x: on.x + mid.nx * mid.half * SIZE * 1.5, y: on.y + mid.ny * mid.half * SIZE * 1.5 };
  assert.equal(projectToCorridor(samples, off, SIZE).inside, false, "a point beyond the half-width is outside");
}

/* ------------------------- Seeding: what may vote -------------------------- */

/** A fragment running along a corridor, with an optional constant offset, over an arc range. */
function alongCorridor(id: ActiveLineId, from: number, to: number, offset = 0): Poly {
  const samples = corridorFor(id);
  const out: Point2[] = [];
  for (const sample of samples) {
    if (sample.s < from || sample.s > to) continue;
    out.push({
      x: (sample.x + offset * sample.nx) * SIZE,
      y: (sample.y + offset * sample.ny) * SIZE,
    });
  }
  return out;
}

{
  const good = alongCorridor("heart", 0.1, 0.5);
  const scored = scoreFragment(good, "heart", SIZE);
  assert.ok(scored !== null, "a fragment running along the corridor scores");
  assert.ok(scored.insideFraction > 0.95, "essentially all of it is inside");
  assert.ok(scored.tangentAgreement > 0.9, "and it runs along, not across");

  /* A fragment crossing the corridor is rejected on tangent even though it passes through. */
  const crossing: Point2[] = [];
  const mid = corridorFor("heart")[32];
  for (let t = -20; t <= 20; t += 1) {
    crossing.push({ x: mid.x * SIZE + mid.nx * t, y: mid.y * SIZE + mid.ny * t });
  }
  assert.equal(scoreFragment(crossing, "heart", SIZE), null, "a fragment crossing the corridor cannot seed it");

  /* A fragment elsewhere on the palm is rejected on membership. */
  const elsewhere = alongCorridor("life", 0.4, 0.8);
  assert.equal(scoreFragment(elsewhere, "heart", SIZE), null, "a life fragment cannot seed heart");

  /* A too-short fragment is rejected however well placed it is. */
  const stub = alongCorridor("heart", 0.48, 0.5);
  assert.equal(scoreFragment(stub, "heart", SIZE), null, "a stub is below the seed-length floor");
}

{
  /* Every fragment goes to exactly one line, so two lines can never claim the same skeleton. */
  const fragments = [alongCorridor("heart", 0.1, 0.6), alongCorridor("life", 0.1, 0.6), alongCorridor("fate", 0.2, 0.8)];
  const seeds = selectSeeds(fragments, SIZE);
  const total = ACTIVE_LINE_IDS.reduce((sum, id) => sum + seeds[id].length, 0);
  assert.equal(total, fragments.length, "no fragment is used twice and none is lost");
  assert.equal(seeds.heart.length, 1, "the heart fragment went to heart");
  assert.equal(seeds.life.length, 1, "the life fragment went to life");
}

/* ----------------------- Fitting across a real break ----------------------- */

/** A probability field with a bright ridge painted along a corridor's arc ranges. */
function fieldAlong(id: ActiveLineId, ranges: ReadonlyArray<readonly [number, number]>): Float32Array {
  const field = new Float32Array(SIZE * SIZE);
  const samples = corridorFor(id);
  for (const sample of samples) {
    if (!ranges.some(([a, b]) => sample.s >= a && sample.s <= b)) continue;
    const cx = sample.x * SIZE;
    const cy = sample.y * SIZE;
    for (let dy = -2; dy <= 2; dy += 1) {
      for (let dx = -2; dx <= 2; dx += 1) {
        const x = Math.round(cx + dx);
        const y = Math.round(cy + dy);
        if (x < 0 || y < 0 || x >= SIZE || y >= SIZE) continue;
        const value = 0.9 * Math.exp(-(dx * dx + dy * dy) / 4);
        if (value > field[y * SIZE + x]) field[y * SIZE + x] = value;
      }
    }
  }
  return field;
}

{
  /*
   * THE CENTRAL CASE. One crease, broken into two pieces by a shadow. The old endpoint rule scored
   * this as two failures and drew nothing; completion must produce ONE curve spanning both, with the
   * gap between them marked inferred.
   */
  const ranges = [
    [0.05, 0.4],
    [0.6, 0.95],
  ] as const;
  const field = fieldAlong("heart", ranges);
  const seeds = [alongCorridor("heart", 0.05, 0.4), alongCorridor("heart", 0.6, 0.95)];

  const fitted = fitLine("heart", seeds, field, SIZE);
  assert.ok(fitted !== null, "two fragments of one crease fit as one line");
  assert.equal(fitted.seedCount, 2, "both fragments contributed");
  assert.ok(fitted.lengthPx > SIZE * 0.5, `and the curve spans the palm (${fitted.lengthPx.toFixed(0)} px)`);

  const observedRuns = fitted.segments.filter((s) => s.observed);
  const inferredRuns = fitted.segments.filter((s) => !s.observed);
  assert.ok(observedRuns.length >= 2, "the two seen stretches are marked observed");
  assert.ok(inferredRuns.length >= 1, "and the bridge between them is marked inferred");
  assert.ok(
    fitted.observedFraction > 0.4 && fitted.observedFraction < 1,
    `most but not all of it is observed (${(fitted.observedFraction * 100).toFixed(0)}%)`,
  );

  /* The segments must tile the point list exactly, or the overlay would drop or double-draw a run. */
  let cursor = 0;
  for (const segment of fitted.segments) {
    assert.equal(segment.from, cursor, "segments are contiguous");
    cursor = segment.to;
  }
  assert.equal(cursor, fitted.points.length, "and cover every point");

  /* The fitted curve sits on the evidence, not beside it. */
  assert.ok(fitted.observedEnergy > 0.45, `the observed stretches sit on the ridge (${fitted.observedEnergy.toFixed(2)})`);
}

{
  /* Ends HOLD rather than extrapolate: a curve may not run far past the last thing actually seen. */
  const field = fieldAlong("head", [[0.1, 0.5]]);
  const fitted = fitLine("head", [alongCorridor("head", 0.1, 0.5)], field, SIZE);
  assert.ok(fitted !== null, "a one-sided fragment still fits");

  const samples = corridorFor("head");
  const last = fitted.points[fitted.points.length - 1];
  const hit = projectToCorridor(samples, last, SIZE);
  assert.ok(
    hit.s <= 0.5 + MAX_END_EXTRAPOLATION + 0.1,
    `the curve stops near the evidence rather than running to the corridor's end (ended at s=${hit.s.toFixed(2)})`,
  );
}

/* ------------------------- Acceptance and honesty -------------------------- */

{
  /* No evidence at all: nothing is drawn. Not a faint guess — nothing. */
  const empty = completeLines([], new Float32Array(SIZE * SIZE), SIZE);
  for (const id of ACTIVE_LINE_IDS) {
    assert.equal(empty.lines[id], undefined, `${id} is not fabricated from the prior alone`);
    assert.equal(empty.reports[id].reject, "no_seeds", `${id} says why`);
  }
}

{
  /* Seeds present but sitting on nothing: the energy floor refuses them. */
  const seeds = [alongCorridor("fate", 0.2, 0.8)];
  const blank = completeLines(seeds, new Float32Array(SIZE * SIZE), SIZE);
  assert.equal(blank.lines.fate, undefined, "a curve with no field under it is refused");
  assert.ok(
    blank.reports.fate.reject === "low_energy" || blank.reports.fate.reject === "low_observed_energy",
    `and the reason names the energy floor (got ${blank.reports.fate.reject})`,
  );
}

{
  /* A full detection of three lines completes all three, and the reports agree. */
  const heartField = fieldAlong("heart", [[0.05, 0.95]]);
  const headField = fieldAlong("head", [[0.05, 0.95]]);
  const lifeField = fieldAlong("life", [[0.05, 0.95]]);
  const field = new Float32Array(SIZE * SIZE);
  for (let i = 0; i < field.length; i += 1) {
    field[i] = Math.max(heartField[i], headField[i], lifeField[i]);
  }
  const fragments = [
    alongCorridor("heart", 0.05, 0.95),
    alongCorridor("head", 0.05, 0.95),
    alongCorridor("life", 0.05, 0.95),
  ];

  const result = completeLines(fragments, field, SIZE);
  for (const id of ["heart", "head", "life"] as const) {
    assert.ok(result.lines[id] !== undefined, `${id} is accepted (${result.reports[id].reject ?? "ok"})`);
    assert.ok(result.reports[id].accepted, `${id} reports accepted`);
    assert.ok(
      (result.lines[id] as { observedFraction: number }).observedFraction > 0.8,
      `${id} is almost entirely observed`,
    );
  }
  assert.equal(result.lines.fate, undefined, "and a line with no evidence stays absent");

  /* Endpoint gating: a fully observed line may claim its ends. */
  const heart = result.lines.heart;
  assert.ok(heart !== undefined);
  assert.ok(endpointObserved(heart, "start"), "a seen start may be claimed");
  assert.ok(endpointObserved(heart, "end"), "so may a seen end");
}

{
  /* An unobserved end may NOT be claimed — the gate that keeps the reading honest. */
  const field = fieldAlong("life", [[0.05, 0.45]]);
  const fitted = fitLine("life", [alongCorridor("life", 0.05, 0.45)], field, SIZE);
  assert.ok(fitted !== null);
  assert.ok(endpointObserved(fitted, "start"), "the seen end is claimable");
  assert.equal(endpointObserved(fitted, "end"), false, "the unseen end is not");
}

{
  /* Sanity that sampleCorridor is deterministic and cached consistently. */
  const a = sampleCorridor(CORRIDORS.fate);
  const b = corridorFor("fate");
  assert.equal(a.length, b.length, "cached and fresh samples agree in length");
  for (let i = 0; i < a.length; i += 1) {
    assert.ok(Math.abs(a[i].x - b[i].x) < 1e-12 && Math.abs(a[i].y - b[i].y) < 1e-12, `sample ${i} agrees`);
  }
}

console.log("COMPLETION ASSERTIONS PASSED");
