/**
 * End-to-end line pipeline, with no ML anywhere in it.
 *
 * The bug this exists to catch: every stage passed its own unit test while the overlay stayed
 * blank on a real hand, because nothing asserted that a frame with a visible line in it comes out
 * the far end as a polyline. That is the only claim that matters to a user, so it is tested as one
 * chain — frame → rectify → ridge → fuse → extract — rather than as five isolated stages.
 *
 * The UNet is absent by construction here: `combineProbabilities(null, ridge)` is exactly what the
 * worker computes when the model is missing, so this also pins the ridge-only mode the product ships
 * with when `public/models/palm-lines.onnx` has not been dropped in.
 */
import assert from "node:assert/strict";
import { fuse, emptyFusion } from "../lib/scan/fusion";
import { extractLines } from "../lib/scan/lines";
import { canonicalQuad, rectifyPalm } from "../lib/scan/rectify";
import { combineProbabilities } from "../lib/scan/segmenter";
import { detectRidges, grayFromRgba } from "../lib/scan/ridge";
import { RECTIFIED_SIZE, type LineMask } from "../lib/scan/types";
import { segmentationEligible, FUSION_MIN_COVERAGE, FUSION_MIN_SCORE } from "../lib/scan/quality";
import { emptyCapture, readyToCapture, tickCapture, AUTO_CAPTURE_HOLD_MS } from "../lib/scan/capture";

/** Node has no `ImageData`; the pipeline only ever needs the three fields it actually reads. */
const makeImageData = (w: number, h: number): ImageData =>
  ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4), colorSpace: "srgb" }) as ImageData;

/* ----------------------------- Synthetic frame ------------------------------ */

/**
 * A pale palm with three dark creases across it — the same thing a camera sees, minus the noise.
 *
 * The curves are drawn with a soft falloff rather than hard pixels: a one-pixel hairline would be
 * removed by the black-hat's smallest structuring element, and passing on a shape the real detector
 * could never see would make this test lie.
 */
function paintedPalm(size: number): ImageData {
  const image = makeImageData(size, size);
  const data = image.data;
  const curves: ReadonlyArray<(x: number) => number> = [
    // Heart-line-ish: high across the palm, bowing gently down.
    (x) => size * 0.3 + Math.sin((x / size) * Math.PI) * size * 0.06,
    // Head line: straighter, mid-palm.
    (x) => size * 0.5 + Math.sin((x / size) * Math.PI) * size * 0.03,
    // Life line: an arc sweeping down the thumb side.
    (x) => size * 0.42 + ((x / size) ** 2) * size * 0.5,
  ];

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      // Skin: bright, with a slow gradient so the field is not pathologically flat.
      let value = 205 + Math.round((y / size) * 20);
      for (const curve of curves) {
        const distance = Math.abs(y - curve(x));
        // ~1.8 px half-width, smoothly faded — survives black-hat, still thin enough to thin down.
        if (distance < 3) value -= Math.round(85 * Math.exp(-(distance * distance) / 2.6));
      }
      const at = (y * size + x) * 4;
      data[at] = value;
      data[at + 1] = value;
      data[at + 2] = value;
      data[at + 3] = 255;
    }
  }
  return image;
}

/* --------------------------- The chain, end to end -------------------------- */

{
  const frame = paintedPalm(RECTIFIED_SIZE);

  /*
   * Rectify passthrough: the source anchors ARE the canonical quad, so the homography is the
   * identity and the crop is the frame. That keeps this test about detection rather than warping —
   * `palm-edge.test.ts` already owns the geometry — while still running the real code path.
   */
  const warped = rectifyPalm(frame, canonicalQuad(RECTIFIED_SIZE), RECTIFIED_SIZE, makeImageData);
  assert.ok(warped !== null, "the identity warp rectifies");
  assert.ok(warped.coverage > 0.99, `passthrough keeps the whole frame (coverage ${warped.coverage.toFixed(3)})`);
  assert.ok(segmentationEligible(0.9, warped.coverage), "and such a crop is eligible for segmentation");

  /* Exactly what `segmenter.worker.ts` runs when no ONNX model is present. */
  const gray = grayFromRgba(warped.image.data, warped.image.width, warped.image.height);
  const ridge = detectRidges(gray, RECTIFIED_SIZE);
  const fused = combineProbabilities(null, ridge.probability);
  assert.equal(fused.length, RECTIFIED_SIZE * RECTIFIED_SIZE, "the fused field covers the crop");
  assert.ok(Math.max(...fused) > 0.5, "the painted creases produce a strong ridge response");

  const mask: LineMask = {
    width: RECTIFIED_SIZE,
    height: RECTIFIED_SIZE,
    all: fused,
    resolves: [],
    inferenceMs: 0,
    backend: "ridge-only",
  };

  /* Temporal fusion over a few identical frames, as a steady hand would produce. */
  let state = emptyFusion(RECTIFIED_SIZE);
  for (let frameIndex = 0; frameIndex < 5; frameIndex += 1) {
    state = fuse(state, mask, 1000 + frameIndex * 200);
  }
  assert.equal(state.frames, 5, "every frame is accumulated");
  assert.ok(state.confidence > 0, `fusion reports confidence (${state.confidence.toFixed(3)})`);

  const found = extractLines(state.ema, state.size);
  assert.ok(
    found.polys.length >= 1,
    `the pipeline emits at least one polyline (got ${found.polys.length}, ` +
      `${found.branchPoints} branch points)`,
  );

  const longest = Math.max(...found.polys.map((poly) => poly.length));
  assert.ok(longest >= 2, "and a polyline is a line, not a point");

  console.log(
    `pipeline (ridge-only): ${found.polys.length} polylines, longest ${longest} pts, ` +
      `confidence ${state.confidence.toFixed(3)}`,
  );
}

/* ---------------- Fusion is decoupled from the rule gate ------------------- */

{
  /*
   * The amendment that unblocked the overlay: a hand that fails the gate still feeds the segmenter,
   * but must never advance a claim. Both halves are asserted, because either alone is a regression
   * waiting to happen — gate the mask and lines vanish; ungate the latch and the reading lies.
   */
  const coverage = 0.82;
  const detection = 0.72; // a confident hand, but below the gate's own MIN_DETECTION_SCORE
  assert.ok(
    segmentationEligible(detection, coverage),
    "a gate-failing but clearly-present hand still feeds fusion",
  );

  // ...and the mask it produces really does move the average.
  const mask: LineMask = {
    width: 4,
    height: 4,
    all: Float32Array.from({ length: 16 }, (_, i) => (i % 3 === 0 ? 0.8 : 0.1)),
    resolves: [],
    inferenceMs: 0,
    backend: "ridge-only",
  };
  const before = emptyFusion(4);
  const after = fuse(before, mask, 1000);
  assert.equal(after.frames, 1, "the gate-failing frame advances fusion");

  /* The other half: capture progress is still hard-gated. */
  let capture = emptyCapture();
  for (let i = 0; i < 40; i += 1) capture = tickCapture(capture, false, 100);
  assert.equal(capture.holdMs, 0, "a gate-failing frame contributes no hold time");
  assert.equal(readyToCapture(capture), false, "and can never trigger a capture");

  /* Sanity that the clock does run when the gate passes — otherwise the assertion above is vacuous. */
  let passing = emptyCapture();
  for (let i = 0; i * 100 <= AUTO_CAPTURE_HOLD_MS; i += 1) passing = tickCapture(passing, true, 100);
  assert.ok(readyToCapture(passing), "a passing frame does advance capture");

  /* The floors are floors, not decoration. */
  assert.equal(segmentationEligible(FUSION_MIN_SCORE - 0.01, 0.9), false, "a weak detection is skipped");
  assert.equal(segmentationEligible(0.9, FUSION_MIN_COVERAGE - 0.01), false, "a clipped crop is skipped");
}

console.log("FULL PIPELINE ASSERTIONS PASSED");
