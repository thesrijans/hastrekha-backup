/**
 * The canonical full-hand pose the palm-lines UNet was trained against — ported from the upstream
 * training pipeline (H2b, measured against `rectification.py` run as written).
 *
 * Reference copy: docs/specs/canonical-fullhand-21.json — test/fullhand-warp.test.ts asserts
 * these constants deepEqual it, so the two cannot drift.
 *
 * Three port decisions, each proven rather than assumed:
 *
 * **Aspect scaling cancels.** Upstream scales the canonical x by image_width and y by image_height,
 * warps at native size, then resizes the whole frame to 256². Scaling targets by (W, H) and then
 * resizing by (256/W, 256/H) is the identity on the targets — so warping source → 256² against
 * `canonical × 256` directly reproduces the upstream framing in one pass, no native-size
 * intermediate.
 *
 * **No mirror is applied.** Upstream `cv2.flip(…, 1)`s EVERY input before fitting. Our solve pins
 * landmarks by anatomical INDEX to fixed canonical positions, so a hand of the other chirality
 * yields a homography with negative determinant — a reflection — and lands in the same canonical
 * chirality the flip produced. Same rule `rectifyPalm` already relies on for the palm quad.
 *
 * **Bilinear replaces upstream NEAREST — a knowing deviation.** Upstream's final resize used
 * `Image.NEAREST` (detection.py:7). Bilinear is strictly less aliased; H2b measured the framing
 * question as insensitive to this (4-anchor bilinear approximation within IoU 0.006 of the true
 * NEAREST warp).
 */

/** 21 canonical positions, MediaPipe index order (0 = wrist … 20 = pinky tip), 0–1 units. */
export const CANONICAL_FULLHAND_21: readonly (readonly [number, number])[] = [
  [0.5179689526557922, 0.9063420295715332],
  [0.3956378698348999, 0.8119394183158875],
  [0.3236767053604126, 0.6790258884429932],
  [0.2659285664558411, 0.5716733932495117],
  [0.2103527784347534, 0.5098430514335632],
  [0.4344319701194763, 0.5117031931877136],
  [0.4020606279373169, 0.36575648188591003],
  [0.3864668607711792, 0.2713503837585449],
  [0.3803516626358032, 0.19251111149787903],
  [0.5071190297603607, 0.4982593059539795],
  [0.5100136399269104, 0.3213786780834198],
  [0.5105343163013458, 0.21283167600631714],
  [0.5166501700878143, 0.12900274991989136],
  [0.5741184651851654, 0.5180916786193848],
  [0.5966537892818451, 0.3581996262073517],
  [0.6061854958534241, 0.2616880536079407],
  [0.6139127910137177, 0.1775170862674713],
  [0.6363133788108826, 0.5642163157463074],
  [0.6644682884216309, 0.44737303256988525],
  [0.6790897846221924, 0.3749568462371826],
  [0.6878631711006165, 0.3026996850967407],
] as const;

/** The upstream fit contract, quoted for provenance — see docs/specs/canonical-fullhand-21.json. */
export const FULLHAND_CONTRACT = {
  source: "palmistry-main/code/rectification.py:12-33 (pts_target_normalized)",
  fitSource: "palmistry-main/code/rectification.py:44-48 (cv2.findHomography RANSAC 5.0 + warpPerspective BORDER_REPLICATE)",
  ransacReprojThresholdPx: 5.0,
  ransacMaxIters: 2000,
  ransacConfidence: 0.995,
  warpBorderMode: "REPLICATE",
  upstreamFlipUnconditional: true,
} as const;
