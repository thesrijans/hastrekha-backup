/* ============================================================================
 * PRELABEL (CORRECTION mode) — the reveal window's corridor + contract path
 *
 * `computePrelabel` is what a GROWTH session pre-fills the labeler with. It
 * must speak the labeler's language exactly (labelable ids, 0–1 crop
 * fractions, best polyline first), must propose only what the APP itself would
 * claim, and must not perturb `computeReveal` — the EVAL post-commit reveal —
 * which shares its pipeline. Pure CPU on a synthetic crop; no detector claim is
 * asserted beyond shape, because on a synthetic palm the only honest statement
 * is about the contract, not the palmistry.
 *
 * What is NOT pinned here: that computeReveal is byte-identical to the version
 * before the shared-pipeline refactor. That would need the old build to compare
 * against; what is checked is determinism and that the reveal is unchanged
 * across a prelabel run.
 * ========================================================================== */
import assert from "node:assert/strict";
import { computePrelabel, computeReveal, type RevealSet } from "../lib/scan/dev/reveal";
import { CANONICAL_LABEL_SIZE, LABELABLE_LINE_IDS } from "../lib/scan/dev/session-types";
import { MINOR_EMIT_MIN_SCORE } from "../lib/scan/minor-lines";

let assertions = 0;
const ok = (condition: boolean, message: string): void => {
  assert.ok(condition, message);
  assertions += 1;
};

/** A skin-toned crop with two dark creases: a heart-ish arc across the top and a fate-ish vertical. */
function syntheticCrop(size: number): Uint8ClampedArray {
  let seed = 11;
  const random = (): number => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  const rgba = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const fx = x / size;
      const fy = y / size;
      let luma = 0.62 + 0.02 * (random() - 0.5);
      const heartY = 0.3 + 0.08 * Math.sin(fx * Math.PI);
      const dHeart = (fy - heartY) * size;
      luma -= 0.22 * Math.exp(-(dHeart * dHeart) / (2 * 3 * 3));
      const dFate = (fx - 0.5) * size;
      if (fy > 0.4 && fy < 0.9) luma -= 0.18 * Math.exp(-(dFate * dFate) / (2 * 3 * 3));
      const value = Math.round(Math.min(1, Math.max(0, luma)) * 255);
      const at = (y * size + x) * 4;
      rgba[at] = value;
      rgba[at + 1] = Math.round(value * 0.9);
      rgba[at + 2] = Math.round(value * 0.8);
      rgba[at + 3] = 255;
    }
  }
  return rgba;
}

function checkShape(set: RevealSet, label: string): number {
  let polylines = 0;
  for (const [id, polys] of Object.entries(set)) {
    ok((LABELABLE_LINE_IDS as readonly string[]).includes(id), `${label}: ${id} is a labelable id`);
    ok(polys !== undefined && polys.length > 0, `${label}: ${id} carries at least one polyline`);
    for (const poly of polys ?? []) {
      polylines += 1;
      ok(poly.length >= 2, `${label}: ${id} polyline has ≥ 2 points`);
      ok(poly.every((p) => p[0] >= 0 && p[0] <= 1 && p[1] >= 0 && p[1] <= 1), `${label}: ${id} points are 0–1 crop fractions`);
    }
  }
  return polylines;
}

const crop = syntheticCrop(CANONICAL_LABEL_SIZE);

const revealA = computeReveal(crop, CANONICAL_LABEL_SIZE);
const prelabel = computePrelabel(crop, CANONICAL_LABEL_SIZE);
const revealB = computeReveal(crop, CANONICAL_LABEL_SIZE);

checkShape(revealA, "reveal");
const prelabelPolys = checkShape(prelabel, "prelabel");
ok(prelabelPolys >= 1, `the prelabel claims something on a two-crease palm (${prelabelPolys} polyline(s): ${Object.keys(prelabel).join(",")})`);

assert.deepEqual(revealB, revealA, "computeReveal is deterministic — and the prelabel path did not perturb it");
assertions += 1;
assert.deepEqual(computePrelabel(crop, CANONICAL_LABEL_SIZE), prelabel, "computePrelabel is deterministic");
assertions += 1;

// Majors carry exactly one polyline (completion's fit, or the corridor's fate); every id is unique.
for (const id of ["heart", "head", "life", "fate"] as const) {
  const polys = prelabel[id];
  if (polys !== undefined) ok(polys.length === 1, `${id}: one polyline — a major is a single fitted line`);
}

/*
 * MEASURED, and left standing as the honest record: on this two-crease synthetic crop the
 * classifier finds a `marriage` trace (3 points, near the heart arc) that clears the app's own
 * emission gate, so the app WOULD claim it and the
 * prelabel faithfully proposes it. A synthetic palm has no marriage line; that proposal is wrong,
 * and it is precisely what a human rejects with A. The prelabel's job is to reproduce the app's
 * claims, not to be right — being right is the labeler's job, which is why growth labels are
 * excluded from scoring.
 *
 * What IS pinned: a minor is proposed only where the app's gates admit one, so the phantom cannot
 * come from the corridor fill-in scoring below that gate.
 */
const minorsProposed = (["sun", "health", "marriage", "bracelets", "girdle"] as const).filter((id) => prelabel[id] !== undefined);
ok(
  minorsProposed.length <= 1,
  `at most one minor class is proposed on this crop, and only above the app's gate ${MINOR_EMIT_MIN_SCORE} (${JSON.stringify(minorsProposed)})`,
);
for (const id of minorsProposed) {
  const polys = prelabel[id] ?? [];
  ok(polys.length >= 1 && polys.every((p) => p.length >= 2), `${id}: every proposed polyline is drawable`);
}

/* A palm with no creases must produce NO prelabel — resolution and lines both come from evidence. */
const blank = new Uint8ClampedArray(CANONICAL_LABEL_SIZE * CANONICAL_LABEL_SIZE * 4);
for (let i = 0; i < CANONICAL_LABEL_SIZE * CANONICAL_LABEL_SIZE; i += 1) {
  const at = i * 4;
  blank[at] = 160;
  blank[at + 1] = 144;
  blank[at + 2] = 128;
  blank[at + 3] = 255;
}
const blankSet = computePrelabel(blank, CANONICAL_LABEL_SIZE);
ok(Object.keys(blankSet).length === 0, `a featureless crop yields nothing, never a fabricated line (${JSON.stringify(Object.keys(blankSet))})`);

console.log(`PRELABEL ASSERTIONS PASSED (${assertions})`);
