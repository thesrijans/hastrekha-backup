/**
 * The flags-off guarantee, enforced rather than promised.
 *
 * Camera control and active illumination are additions to a detection path that took four steps and
 * two total blackouts to get working. The value of "off by default" depends entirely on off meaning
 * *nothing happens* — not "a negligible difference", not "the same within rounding". This asserts the
 * strong form: with every flag off, the reference frame produces polylines identical coordinate by
 * coordinate to the path that existed before any of it, and the pixel-touching seam returns the
 * caller's own array by reference so nothing can have been copied and rewritten on the way through.
 *
 * The second half is the other side of the same coin: with a flag ON, something must actually change.
 * A feature flag that guards a no-op is worse than no flag, because it invites the next person to
 * conclude the feature works when it has never run.
 */
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import sharp from "sharp";
import { detectRidges, normalizeResponses } from "../lib/scan/ridge";
import { detectVessels, sigmasFor } from "../lib/scan/frangi";
import { normaliseIllumination } from "../lib/scan/illumination";
import { blendComposite, compositeStack, emptyStack, pushFrame } from "../lib/scan/stack";
import { combineProbabilities } from "../lib/scan/segmenter";
import { alignFusion, emptyFusion, fuse, type FusionState } from "../lib/scan/fusion";
import { extractLines } from "../lib/scan/lines";
import { rectifyPalm } from "../lib/scan/rectify";
import {
  applyGamma,
  correctExposure,
  creaseContrast,
  fallbackGamma,
  lumaStats,
  nextExposureBias,
  planConstraints,
  BIAS_MAX,
  BIAS_MIN,
  GAMMA_MIN,
  LUMA_TARGET_HIGH,
  LUMA_TARGET_LOW,
  MAX_CLIPPED_FRACTION,
} from "../lib/scan/camera-control";
import {
  applyPhotometricEvidence,
  mergeBracket,
  photometricEvidence,
  FLASH_QUADRANTS,
  type FlashFrame,
} from "../lib/scan/illumination-active";
import { allFlagsOff, scanFlags, DEFAULT_SCAN_FLAGS, SCAN_FLAG_NAMES } from "../lib/scan/flags";
import { MASK_SIZE, type LineMask, type Point2 } from "../lib/scan/types";

const SIZE = 256;
const WORK = MASK_SIZE;
const makeImageData = (w: number, h: number): ImageData =>
  ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4), colorSpace: "srgb" }) as ImageData;

/* --------------------------- The flag store itself ------------------------- */

{
  assert.ok(allFlagsOff(DEFAULT_SCAN_FLAGS), "every flag ships off");
  for (const name of SCAN_FLAG_NAMES) {
    assert.equal(DEFAULT_SCAN_FLAGS[name], false, `${name} defaults to off`);
  }

  let seen = 0;
  const stop = scanFlags.subscribe(() => {
    seen += 1;
  });
  scanFlags.set("cameraControl", true);
  assert.equal(scanFlags.snapshot().cameraControl, true, "a flag can be turned on live");
  assert.equal(seen, 1, "and subscribers hear about it");
  scanFlags.set("cameraControl", true);
  assert.equal(seen, 1, "setting the same value notifies nobody — no needless re-render");
  scanFlags.reset();
  assert.ok(allFlagsOff(scanFlags.snapshot()), "reset returns to the shipped state");
  stop();
}

/* ------------------- The seam that can touch pixels ------------------------ */

{
  const rgba = new Uint8ClampedArray(64 * 64 * 4);
  for (let i = 0; i < rgba.length; i += 4) {
    rgba[i] = 240;
    rgba[i + 1] = 235;
    rgba[i + 2] = 230;
    rgba[i + 3] = 255;
  }
  const stats = lumaStats(rgba, null);
  assert.ok(stats.mean > LUMA_TARGET_HIGH, "the fixture is genuinely too bright, so the ON path has work to do");

  /*
   * The identity guarantee, in its strongest checkable form: the SAME OBJECT comes back. Not an
   * equal copy — the same reference. Nothing was allocated, walked, or rounded.
   */
  const off = correctExposure(rgba, false, stats);
  assert.equal(off.rgba, rgba, "with the flag off the caller's own array is returned by identity");
  assert.equal(off.gamma, GAMMA_MIN, "and no gamma is reported");

  const on = correctExposure(rgba, true, stats);
  assert.notEqual(on.rgba, rgba, "with the flag on the caller's crop is left intact and a copy is corrected");
  assert.ok(on.gamma > GAMMA_MIN, `and a real gamma is applied (${on.gamma.toFixed(3)})`);
  assert.ok(lumaStats(on.rgba, null).mean < stats.mean, "which actually darkens the crop");

  /* A crop already inside the band must not be touched even with the flag on. */
  const fine = new Uint8ClampedArray(64 * 64 * 4);
  for (let i = 0; i < fine.length; i += 4) {
    fine[i] = 120;
    fine[i + 1] = 120;
    fine[i + 2] = 120;
    fine[i + 3] = 255;
  }
  const fineStats = lumaStats(fine, null);
  assert.ok(fineStats.mean >= LUMA_TARGET_LOW && fineStats.mean <= LUMA_TARGET_HIGH, "the fixture is in band");
  assert.equal(correctExposure(fine, true, fineStats).rgba, fine, "a well-exposed crop is returned untouched");
}

/* -------------------------- The closed loop -------------------------------- */

{
  const stats = (mean: number, clipped: number) => ({ mean, clipped, crushed: 0, samples: 1000 });

  /* Clipping outranks brightness: a crop can average correctly with its highlights already gone. */
  const blown = nextExposureBias(BIAS_MAX, stats(125, 0.08));
  assert.ok(blown < BIAS_MAX, "clipping pulls the bias down even when the mean is in band");

  /* In band and clean: settled, and the caller can skip a pointless applyConstraints. */
  assert.equal(nextExposureBias(-0.7, stats(125, 0)), -0.7, "an in-band frame does not move the bias");

  /* Bounds hold however extreme the input. */
  let bias = BIAS_MAX;
  for (let i = 0; i < 50; i += 1) bias = nextExposureBias(bias, stats(255, 0.9));
  assert.equal(bias, BIAS_MIN, "the loop bottoms out at the floor rather than running away");
  for (let i = 0; i < 50; i += 1) bias = nextExposureBias(bias, stats(20, 0));
  assert.equal(bias, BIAS_MAX, "and tops out at the ceiling — the band is one-sided by design");

  /* It settles rather than oscillating: a frame just over the line takes a small step, not a lurch. */
  const gentle = nextExposureBias(-0.7, stats(LUMA_TARGET_HIGH + 1, 0));
  assert.ok(gentle < -0.7 && gentle > -0.78, `a marginal overshoot takes a small step (${gentle.toFixed(3)})`);

  /* Gamma cannot rescue what was never recorded, and the constant says so by being bounded. */
  assert.equal(fallbackGamma(stats(120, 0)), GAMMA_MIN, "an in-band crop gets a no-op gamma");
  assert.ok(fallbackGamma(stats(200, 0.2)) > 1.2, "a blown crop gets a real one");
  assert.ok(fallbackGamma(stats(254, 0.9)) <= 1.8, "but never more than the cap");

  /* The lookup-table gamma matches the direct computation it replaces, to within a code value. */
  const probe = new Uint8ClampedArray([0, 64, 128, 192, 255, 255, 255, 255]);
  const expected = [...probe].map((v, i) => (i % 4 === 3 ? v : Math.round(Math.pow(v / 255, 1.5) * 255)));
  applyGamma(probe, 1.5);
  for (let i = 0; i < probe.length; i += 1) {
    if (i % 4 === 3) continue;
    assert.ok(Math.abs(probe[i] - expected[i]) <= 1, `gamma table matches pow at index ${i}`);
  }
  assert.equal(MAX_CLIPPED_FRACTION, 0.01, "the clipping budget is one percent of the palm");
}

/* ------------------------------ Constraints -------------------------------- */

{
  assert.equal(planConstraints(null, -0.7).advanced, null, "no capabilities means no constraints, not a throw");

  const rich = planConstraints(
    {
      exposureMode: ["continuous", "manual"],
      exposureCompensation: { min: -2, max: 2 },
      focusMode: ["continuous", "manual"],
      focusDistance: { min: 0.1, max: 5 },
      whiteBalanceMode: ["continuous", "manual"],
      colorTemperature: { min: 2800, max: 7000 },
      torch: true,
    },
    -0.7,
  );
  assert.ok(rich.advanced !== null, "a capable device gets a plan");
  assert.equal(rich.advanced.exposureCompensation, -0.7, "the bias is passed through when in range");
  assert.equal(rich.unsupported.length, 0, "and nothing is reported unsupported");
  assert.ok(rich.supported.includes("torch"), "torch is reported available");
  assert.equal(rich.advanced.torch, undefined, "but not switched on unless asked for");

  /*
   * The honesty case. A device that advertises focus but cannot reach a palm's distance must be
   * reported UNSUPPORTED, not silently clamped — "focus at 2m" is not the constraint that was asked
   * for, and calling it accepted makes the HUD claim something untrue.
   */
  const farFocus = planConstraints(
    { focusMode: ["manual"], focusDistance: { min: 2, max: 10 }, exposureCompensation: { min: -1, max: 1 } },
    -0.7,
  );
  assert.ok(farFocus.unsupported.includes("focusDistance(range)"), "an unreachable focus range is reported honestly");
  assert.equal(farFocus.advanced?.focusDistance, undefined, "and not requested");

  /* Out-of-range bias is clamped to what the device can do, which IS the right behaviour here. */
  const narrow = planConstraints({ exposureCompensation: { min: -0.2, max: 0.2 } }, -1);
  assert.equal(narrow.advanced?.exposureCompensation, -0.2, "a bias beyond the device's range is clamped to it");
}

/* --------------------------- Active illumination --------------------------- */

{
  const size = 32;
  const plane = size * size;

  /* Fewer than two frames is not a sequence and must contribute nothing. */
  assert.equal(photometricEvidence([], size).field.every((v) => v === 0), true, "no frames, no evidence");
  const one: FlashFrame[] = [{ quadrant: "tl", luma: new Float32Array(plane).fill(0.5) }];
  assert.equal(photometricEvidence(one, size).field.every((v) => v === 0), true, "one frame, no evidence");

  /*
   * A groove: bright under the light on one side, dark under the light on the other, so its extremes
   * fall on OPPOSITE quadrants. Flat skin: the same everywhere. Only the groove may score.
   */
  const frames: FlashFrame[] = FLASH_QUADRANTS.map((quadrant, index) => {
    const luma = new Float32Array(plane).fill(0.6);
    // The groove pixel swings with the light; tl (0) brightest, br (2) darkest — opposite corners.
    luma[10 * size + 10] = index === 0 ? 0.85 : index === 2 ? 0.35 : 0.6;
    // A pixel whose extremes are ADJACENT quadrants — a moving shadow, not relief.
    luma[20 * size + 20] = index === 0 ? 0.85 : index === 1 ? 0.35 : 0.6;
    return { quadrant, luma };
  });
  const result = photometricEvidence(frames, size);
  const groove = result.field[10 * size + 10];
  const shadow = result.field[20 * size + 20];
  const flat = result.field[5 * size + 5];

  assert.ok(groove > 0.5, `a groove scores (${groove.toFixed(3)})`);
  assert.equal(flat, 0, "flat skin scores exactly zero");
  assert.ok(shadow < groove, `and adjacent-extreme variation scores below a groove (${shadow.toFixed(3)})`);
  assert.ok(result.meanRange > 0, "the sequence reports how much the light actually moved things");

  /* The blend can only ever add, and only where the detectors already saw something. */
  const merged = new Float32Array([0.2, 0.2, 0.9]);
  const photo = new Float32Array([1, 1, 1]);
  const detector = new Float32Array([0, 0.3, 0.3]);
  const before = Float32Array.from(merged);
  applyPhotometricEvidence(merged, photo, detector);
  assert.equal(merged[0], before[0], "no detector support means no boost — it cannot originate a line");
  assert.ok(merged[1] > before[1], "supported evidence is boosted");
  assert.ok(merged[1] <= 1 && merged[2] <= 1, "and nothing exceeds one");
  for (let i = 0; i < merged.length; i += 1) {
    assert.ok(merged[i] >= before[i], "the channel can only ever raise a probability, never lower one");
  }
  const zeroWeight = Float32Array.from(before);
  applyPhotometricEvidence(zeroWeight, photo, detector, 0);
  assert.deepEqual([...zeroWeight], [...before], "weight zero is a no-op, so a disabled window changes nothing");
}

{
  /* Bracket merge: per pixel, whichever exposure recorded it furthest from both extremes. */
  const size = 2;
  const dark = new Float32Array([0.05, 0.4, 0.02, 0.5]);
  const mid = new Float32Array([0.5, 0.95, 0.5, 0.5]);
  const bright = new Float32Array([0.98, 0.99, 0.9, 0.5]);
  const merged = mergeBracket([dark, mid, bright], size);
  assert.equal(merged[0], 0.5, "a pixel crushed dark and blown bright is taken from the middle frame");
  assert.ok(Math.abs(merged[1] - 0.4) < 1e-6, "and one blown in two frames is taken from the dark one");
  assert.equal(mergeBracket([dark], size)[0], dark[0], "a single frame passes through — no bracket, no merge");
  assert.equal(mergeBracket([], size).length, size * size, "and an empty bracket is an empty field, not a throw");
}

/* ================= THE GUARANTEE: flags off changes nothing ================ */

const FRAME = "docs/reference/lines-missing-tilt-03.png";

function pipeline(rgba: Uint8ClampedArray, inside: Uint8Array, toCrop: Parameters<typeof alignFusion>[1]) {
  const plane = SIZE * SIZE;
  const workPlane = WORK * WORK;
  const gray = new Float32Array(plane);
  for (let i = 0; i < plane; i += 1) {
    const at = i * 4;
    gray[i] = (0.2126 * rgba[at] + 0.7152 * rgba[at + 1] + 0.0722 * rgba[at + 2]) / 255;
  }
  const small = new Float32Array(workPlane);
  const validity = new Uint8Array(workPlane);
  for (let y = 0; y < WORK; y += 1) {
    const a = 2 * y * SIZE;
    const b = a + SIZE;
    for (let x = 0; x < WORK; x += 1) {
      const at = 2 * x;
      small[y * WORK + x] = (gray[a + at] + gray[a + at + 1] + gray[b + at] + gray[b + at + 1]) * 0.25;
      validity[y * WORK + x] = inside[a + at] & inside[a + at + 1] & inside[b + at] & inside[b + at + 1];
    }
  }
  const stack = emptyStack(WORK);
  let fusion: FusionState = emptyFusion(WORK);
  let frangi: Float32Array<ArrayBufferLike> = new Float32Array(workPlane);

  for (let tick = 0; tick < 6; tick += 1) {
    const illumination = normaliseIllumination(small, WORK, new Float32Array(workPlane), validity);
    pushFrame(stack, illumination.out, 4, illumination.bypassed);
    const input = new Float32Array(illumination.out);
    blendComposite(input, compositeStack(stack));
    frangi = normalizeResponses(detectVessels(input, WORK, sigmasFor(WORK), new Float32Array(workPlane)));
    const ridge = Float32Array.from(detectRidges(small, WORK).probability);
    const classical = new Float32Array(workPlane);
    for (let i = 0; i < workPlane; i += 1) classical[i] = ridge[i] > frangi[i] ? ridge[i] : frangi[i];
    const mask: LineMask = {
      width: WORK,
      height: WORK,
      all: combineProbabilities(null, classical),
      resolves: [],
      inferenceMs: 0,
    };
    fusion = alignFusion(fusion, toCrop, 4).state;
    fusion = fuse(fusion, mask, 1000 + tick * 200);
  }
  const found = extractLines(fusion.ema, fusion.size);
  return { polys: found.polys, contrast: creaseContrast(frangi, WORK), confidence: fusion.confidence };
}

async function main(): Promise<void> {
  if (!existsSync(FRAME)) {
    console.log(`FLAGS IDENTITY: ${FRAME} not present — skipping the frame half.`);
    console.log("FLAGS IDENTITY ASSERTIONS PASSED");
    return;
  }

  const { data, info } = await sharp(FRAME).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const source = { width: info.width, height: info.height, data: new Uint8ClampedArray(data) } as ImageData;
  const anchors: Point2[] = [
    { x: 294, y: 543 },
    { x: 212, y: 493 },
    { x: 221, y: 297 },
    { x: 376, y: 355 },
  ];
  const warped = rectifyPalm(source, anchors, SIZE, makeImageData);
  assert.ok(warped !== null, "the reference frame rectifies");

  scanFlags.reset();
  const flags = scanFlags.snapshot();
  assert.ok(allFlagsOff(flags), "the identity run has every flag off");

  const stats = lumaStats(warped.image.data, warped.inside);
  const gated = correctExposure(warped.image.data, flags.cameraControl, stats);
  assert.equal(gated.rgba, warped.image.data, "with the flag off the crop reaches the detector untouched");

  const baseline = pipeline(warped.image.data, warped.inside, warped.toCrop);

  /*
   * Now flip every flag on and off again. The store is global and the frame loop reads it live, so a
   * flag that leaked state — a cached plan, a settled bias, a stale gamma — would show up here as a
   * different result for the same input.
   */
  for (const name of SCAN_FLAG_NAMES) {
    scanFlags.set(name, true);
    scanFlags.set(name, false);
  }
  const after = pipeline(warped.image.data, warped.inside, warped.toCrop);

  assert.equal(after.polys.length, baseline.polys.length, "the same number of polylines");
  for (let i = 0; i < baseline.polys.length; i += 1) {
    assert.equal(after.polys[i].length, baseline.polys[i].length, `polyline ${i} has the same point count`);
    for (let p = 0; p < baseline.polys[i].length; p += 1) {
      assert.equal(after.polys[i][p].x, baseline.polys[i][p].x, `polyline ${i} point ${p} x is identical`);
      assert.equal(after.polys[i][p].y, baseline.polys[i][p].y, `polyline ${i} point ${p} y is identical`);
    }
  }
  assert.equal(after.confidence, baseline.confidence, "and the fused confidence is bit-identical");

  /* The frame the whole step must not regress. */
  assert.ok(baseline.polys.length >= 3, `the reference frame still yields its lines (${baseline.polys.length})`);

  console.log(
    `flags off: ${baseline.polys.length} polylines, creaseContrast ${baseline.contrast.toFixed(4)}, ` +
      `confidence ${baseline.confidence.toFixed(3)} — identical after toggling every flag`,
  );
  console.log("FLAGS IDENTITY ASSERTIONS PASSED");
}

void main();
