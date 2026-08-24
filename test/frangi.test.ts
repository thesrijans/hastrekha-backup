import assert from "node:assert/strict";
import {
  detectVessels,
  hessianEigenvalues,
  sigmasFor,
  FRANGI_PEAK_GAIN,
  FRANGI_S_FLOOR,
  FRANGI_SIGMAS_AT_128,
} from "../lib/scan/frangi";
import { normalizeResponses } from "../lib/scan/ridge";
import { binarize, thin, tracePolylines } from "../lib/scan/lines";

/* ------------------------------ Eigenvalues -------------------------------- */

{
  /*
   * The ordering contract is the whole basis of the blobness ratio: Rb = λ1/λ2 with |λ1| ≤ |λ2|.
   * Swap them and every line reads as a blob and every blob as a line, silently.
   */
  const [lo, hi] = hessianEigenvalues(4, 0, 0.05);
  assert.ok(Math.abs(lo) <= Math.abs(hi), "ordered by magnitude, not by sign");
  assert.ok(Math.abs(lo - 0.05) < 1e-12 && Math.abs(hi - 4) < 1e-12, "diagonal matrix returns its diagonal");

  /* The two invariants any eigen-decomposition must satisfy, on an off-diagonal case. */
  for (const [a, b, d] of [
    [2, 1, 3],
    [-5, 2, 1],
    [0.1, -0.4, -0.2],
    [1, 0, 1],
  ] as ReadonlyArray<readonly [number, number, number]>) {
    const [l1, l2] = hessianEigenvalues(a, b, d);
    assert.ok(Math.abs(l1 + l2 - (a + d)) < 1e-9, `trace preserved for (${a},${b},${d})`);
    assert.ok(Math.abs(l1 * l2 - (a * d - b * b)) < 1e-9, `determinant preserved for (${a},${b},${d})`);
    assert.ok(Math.abs(l1) <= Math.abs(l2) + 1e-12, `magnitude ordering holds for (${a},${b},${d})`);
  }

  /* An isotropic point gives Rb = 1 — maximum suppression — with no special case needed. */
  const [i1, i2] = hessianEigenvalues(1, 0, 1);
  assert.equal(i1 / i2, 1, "an isotropic point has blobness exactly 1");
}

/* -------------------------------- Polarity --------------------------------- */

const SIZE = 64;

/** A dark horizontal bar on bright skin — the polarity the palm actually presents. */
function darkLine(size: number, width = 1.4): Float32Array {
  const out = new Float32Array(size * size).fill(0.75);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const d = y - size / 2;
      out[y * size + x] -= 0.35 * Math.exp(-(d * d) / (2 * width * width));
    }
  }
  return out;
}

/** The same bar, inverted: bright on dark. A knuckle highlight, and NOT a crease. */
function brightLine(size: number, width = 1.4): Float32Array {
  const out = new Float32Array(size * size).fill(0.4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const d = y - size / 2;
      out[y * size + x] += 0.35 * Math.exp(-(d * d) / (2 * width * width));
    }
  }
  return out;
}

{
  const dark = detectVessels(darkLine(SIZE), SIZE, [1.5, 2.5]);
  const bright = detectVessels(brightLine(SIZE), SIZE, [1.5, 2.5]);

  const centre = (field: Float32Array): number => {
    let best = 0;
    for (let x = 8; x < SIZE - 8; x += 1) best = Math.max(best, field[(SIZE / 2) * SIZE + x]);
    return best;
  };

  assert.ok(centre(dark) > 0.5, `a dark crease responds strongly (${centre(dark).toFixed(3)})`);
  assert.equal(centre(bright), 0, "a bright ridge responds exactly zero — the polarity guard");

  /*
   * The sign this rests on, checked directly rather than inferred from the response: differentiating
   * I(x) = B − A·exp(−x²/2s²) twice gives I″(0) = +A/s², so a dark valley has a POSITIVE largest
   * eigenvalue. Getting it backwards detects highlights, which looks plausible on a debug view.
   */
  const profile = darkLine(SIZE);
  const row = SIZE / 2;
  const second =
    profile[(row + 1) * SIZE + SIZE / 2] - 2 * profile[row * SIZE + SIZE / 2] + profile[(row - 1) * SIZE + SIZE / 2];
  assert.ok(second > 0, `the second derivative across a dark line is positive (${second.toFixed(4)})`);
}

/* ------------------------------ Blob rejection ----------------------------- */

{
  /*
   * The property that makes Frangi worth adding beside the Gabor bank: it suppresses compact blobs,
   * which is what the fine skin crazing on a real palm looks like. A bar and a dot of the same depth
   * and width must NOT score the same.
   */
  const line = new Float32Array(SIZE * SIZE).fill(0.75);
  const blob = new Float32Array(SIZE * SIZE).fill(0.75);
  for (let y = 0; y < SIZE; y += 1) {
    for (let x = 0; x < SIZE; x += 1) {
      const dy = y - SIZE / 2;
      const dx = x - SIZE / 2;
      line[y * SIZE + x] -= 0.35 * Math.exp(-(dy * dy) / 4);
      blob[y * SIZE + x] -= 0.35 * Math.exp(-(dy * dy + dx * dx) / 4);
    }
  }

  const lineField = detectVessels(line, SIZE, [1.5, 2.5]);
  const blobField = detectVessels(blob, SIZE, [1.5, 2.5]);
  const at = (SIZE / 2) * SIZE + SIZE / 2;
  assert.ok(
    blobField[at] < lineField[at] * 0.5,
    `a blob scores well under an equally deep line (${blobField[at].toFixed(3)} vs ${lineField[at].toFixed(3)})`,
  );
}

/* --------------------------- Scale and resolution -------------------------- */

{
  /*
   * Sigma is a length, so the same physical crease must be found at either crop size the pipeline
   * uses. If the set did not scale, 256² would be looking for creases half as wide as it should.
   */
  assert.deepEqual(sigmasFor(128), [...FRANGI_SIGMAS_AT_128], "the reference size uses the stated set");
  assert.deepEqual(sigmasFor(256), FRANGI_SIGMAS_AT_128.map((s) => s * 2), "and it scales with the crop");

  const wide = 128;
  const scaled = detectVessels(darkLine(wide, 2.8), wide, sigmasFor(wide));
  let peak = 0;
  for (let x = 16; x < wide - 16; x += 1) peak = Math.max(peak, scaled[(wide / 2) * wide + x]);
  assert.ok(peak > 0.5, `a proportionally wider crease at a larger crop still responds (${peak.toFixed(3)})`);
}

/* ------------------------- Adaptive c and the floor ------------------------ */

{
  /* An empty crop must produce nothing, rather than having its noise stretched to full confidence. */
  const flat = new Float32Array(SIZE * SIZE).fill(0.6);
  const nothing = detectVessels(flat, SIZE, [1.5, 2.5]);
  let worst = 0;
  for (const v of nothing) worst = Math.max(worst, v);
  assert.ok(worst < 0.05, `a flat crop stays dark (max ${worst.toExponential(2)})`);

  /*
   * The floor is derived, not guessed: an ideal Gaussian crease of depth A peaks at
   * 2/3^{3/2}·A after gamma normalisation, independent of its width — so "the shallowest crease
   * worth reporting" converts directly into a structureness value.
   */
  assert.ok(Math.abs(FRANGI_PEAK_GAIN - 0.3849) < 1e-4, "the peak gain is 2/3^1.5");
  assert.ok(Math.abs(FRANGI_S_FLOOR - FRANGI_PEAK_GAIN * 0.04) < 1e-9, "the floor is that gain times the min depth");

  /* Contrast adaptation: halving the depth must NOT halve the response, or a dim palm reads as no palm. */
  const strong = detectVessels(darkLine(SIZE), SIZE, [1.5, 2.5], new Float32Array(SIZE * SIZE));
  const strongPeak = Math.max(...strong);
  const faint = new Float32Array(SIZE * SIZE).fill(0.75);
  for (let y = 0; y < SIZE; y += 1) {
    for (let x = 0; x < SIZE; x += 1) {
      const d = y - SIZE / 2;
      faint[y * SIZE + x] -= 0.1 * Math.exp(-(d * d) / (2 * 1.4 * 1.4));
    }
  }
  const faintPeak = Math.max(...detectVessels(faint, SIZE, [1.5, 2.5], new Float32Array(SIZE * SIZE)));
  assert.ok(
    faintPeak > strongPeak * 0.8,
    `a 3.5x fainter crease still reads confidently (${faintPeak.toFixed(3)} vs ${strongPeak.toFixed(3)})`,
  );
}

/* ------------------------------ Determinism -------------------------------- */

{
  /* Scratch is reused across calls; a leak between them would show up as a second call differing. */
  const input = darkLine(SIZE);
  const first = detectVessels(input, SIZE, [1.5, 2.5], new Float32Array(SIZE * SIZE));
  const kept = Float32Array.from(first);
  detectVessels(brightLine(SIZE), SIZE, [1.5, 2.5], new Float32Array(SIZE * SIZE));
  const second = detectVessels(input, SIZE, [1.5, 2.5], new Float32Array(SIZE * SIZE));
  let drift = 0;
  for (let i = 0; i < kept.length; i += 1) drift = Math.max(drift, Math.abs(kept[i] - second[i]));
  assert.equal(drift, 0, "the reused scratch carries nothing between calls");

  /* And the caller's buffer is honoured, so the per-frame path can avoid allocating. */
  const target = new Float32Array(SIZE * SIZE);
  assert.equal(detectVessels(input, SIZE, [1.5], target), target, "the supplied destination is returned");
}

/* -------------------------- Traceable end to end --------------------------- */

{
  /*
   * The reason this module exists is to feed `lines.ts`, so the last assertion is about that seam:
   * a synthetic crease must survive normalisation, binarisation and thinning as ONE polyline.
   */
  const field = normalizeResponses(detectVessels(darkLine(SIZE), SIZE, [1.5, 2.5], new Float32Array(SIZE * SIZE)));
  const { polys } = tracePolylines(thin(binarize(field), SIZE), SIZE);
  assert.ok(polys.length >= 1, `the response traces to at least one polyline (got ${polys.length})`);
  const longest = Math.max(...polys.map((p) => p.length));
  assert.ok(longest > SIZE / 4, `and that polyline spans the crease (${longest} points)`);
}

console.log("FRANGI ASSERTIONS PASSED");
