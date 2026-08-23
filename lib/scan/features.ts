/**
 * Landmarks → engine features.
 *
 * All measurement uses **world** landmarks, not image-space ones. Image-space landmarks are
 * normalised to 0–1 on both axes independently, so on a 16:9 frame an x-distance and a y-distance of
 * the same numeric size are physically different lengths — every ratio computed from them would be
 * silently wrong. World landmarks are metric with the wrist at the origin.
 *
 * The governing rule here is that a feature is only emitted when 21 joint positions can actually
 * establish it. Everything the KB asks for that landmarks *cannot* see is listed in
 * {@link NOT_DERIVABLE_FROM_LANDMARKS} and deliberately left unset — a product that prints a page
 * citation next to every claim must not fire rules on invented evidence.
 */
import type { FeatureBag } from "@/lib/hastrekha";
import { FINGER_MOUNTS, LM } from "./landmark-index";
import type { Landmark3 } from "./types";

/**
 * KB features that 21 landmarks cannot honestly produce, and why.
 *
 * Kept as data so the gap is auditable rather than folklore. Each of these needs either the
 * rectified crop (texture, silhouette, shading) or an interactive test the camera cannot perform.
 */
export const NOT_DERIVABLE_FROM_LANDMARKS: Readonly<Record<string, string>> = {
  "thumb.joint_top": "stiff vs supple needs a flexion test, not a static pose",
  "thumb.joint_middle_supple": "same — requires watching the joint bend",
  "thumb.clubbed": "a width/silhouette property; landmarks carry no thickness",
  "thumb.waist_like": "width profile along the phalange, not joint positions",
  "thumb.base_phalange_long": "the base phalange is the fleshy Venus ball, not the metacarpal bone",
  "thumb.will_phalange": "needs a thickness judgement, and which segment it names is ambiguous",
  "fingers.joints": "smooth vs knotty is joint swelling — texture, needs the crop",
  "hand.shape_detail.conic_firmness": "soft vs firm is tactile; no camera can see it",
  "hand.shape_detail.spatulate_wider_at": "needs the hand silhouette, not skeleton points",
  "mounts.*": "mount prominence is fleshy relief — needs shading from the rectified crop",
};

export interface LandmarkMetrics {
  readonly palmLength: number;
  readonly palmWidth: number;
  readonly palmAspect: number;
  readonly fingerLengths: Readonly<Record<string, number>>;
  readonly middleOverPalm: number;
  readonly indexOverMiddle: number;
  readonly ringOverMiddle: number;
  readonly indexOverRing: number;
  /** Little-finger tip position along the ring finger's axis, as a fraction of ring length. */
  readonly pinkyReachOnRing: number;
  readonly thumbAbductionDeg: number;
  readonly thumbIpAngleDeg: number;
  readonly thumbNailOverWill: number;
  readonly fingerSpacing: number;
  readonly pinkyDeviationDeg: number;
}

export interface ShapeSuggestion {
  readonly shape: string;
  readonly confidence: number;
}

export interface LandmarkFeatureResult {
  /** Ready to merge into the reading request's feature bag. */
  readonly features: FeatureBag;
  /** Raw ratios, for the debug HUD and for tuning the thresholds below. */
  readonly metrics: LandmarkMetrics;
  /**
   * A hand-shape guess offered to the user as a pre-fill, never written into `features` unless it
   * clears {@link SHAPE_CONFIDENCE_FLOOR}. Self-reported shape beats a shaky 7-way guess.
   */
  readonly shapeSuggestion: ShapeSuggestion | null;
}

/** Below this, the shape is offered as a suggestion only and never enters the feature bag. */
export const SHAPE_CONFIDENCE_FLOOR = 0.72;

function distance(a: Landmark3, b: Landmark3): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

/** Sum of the three segments, so a slightly curled finger still measures its true length. */
function fingerLength(world: readonly Landmark3[], finger: { mcp: number; pip: number; dip: number; tip: number }): number {
  return (
    distance(world[finger.mcp], world[finger.pip]) +
    distance(world[finger.pip], world[finger.dip]) +
    distance(world[finger.dip], world[finger.tip])
  );
}

function angleDeg(a: Landmark3, vertex: Landmark3, b: Landmark3): number {
  const u = { x: a.x - vertex.x, y: a.y - vertex.y, z: a.z - vertex.z };
  const v = { x: b.x - vertex.x, y: b.y - vertex.y, z: b.z - vertex.z };
  const dot = u.x * v.x + u.y * v.y + u.z * v.z;
  const mag = Math.hypot(u.x, u.y, u.z) * Math.hypot(v.x, v.y, v.z);
  if (mag < 1e-9) return 0;
  return (Math.acos(Math.min(1, Math.max(-1, dot / mag))) * 180) / Math.PI;
}

/** Scalar projection of `point` onto the segment `from`→`to`, as a fraction of that segment. */
function projectionFraction(point: Landmark3, from: Landmark3, to: Landmark3): number {
  const axis = { x: to.x - from.x, y: to.y - from.y, z: to.z - from.z };
  const rel = { x: point.x - from.x, y: point.y - from.y, z: point.z - from.z };
  const lengthSq = axis.x * axis.x + axis.y * axis.y + axis.z * axis.z;
  if (lengthSq < 1e-12) return 0;
  return (rel.x * axis.x + rel.y * axis.y + rel.z * axis.z) / lengthSq;
}

export function measure(world: readonly Landmark3[]): LandmarkMetrics {
  const palmLength = distance(world[LM.WRIST], world[LM.MIDDLE_MCP]);
  const palmWidth = distance(world[LM.INDEX_MCP], world[LM.PINKY_MCP]);

  const fingerLengths = {
    jupiter: fingerLength(world, FINGER_MOUNTS.jupiter),
    saturn: fingerLength(world, FINGER_MOUNTS.saturn),
    sun: fingerLength(world, FINGER_MOUNTS.sun),
    mercury: fingerLength(world, FINGER_MOUNTS.mercury),
  };

  const safe = (value: number, by: number): number => (by < 1e-9 ? 0 : value / by);

  // The classical test for a "long" little finger: does its tip reach the ring finger's top joint?
  const pinkyReachOnRing = projectionFraction(
    world[LM.PINKY_TIP],
    world[LM.RING_MCP],
    world[LM.RING_TIP],
  );

  const thumbAbductionDeg = angleDeg(world[LM.THUMB_MCP], world[LM.THUMB_CMC], world[LM.INDEX_MCP]);
  const thumbIpAngleDeg = angleDeg(world[LM.THUMB_MCP], world[LM.THUMB_IP], world[LM.THUMB_TIP]);
  const thumbNailOverWill = safe(
    distance(world[LM.THUMB_IP], world[LM.THUMB_TIP]),
    distance(world[LM.THUMB_MCP], world[LM.THUMB_IP]),
  );

  const tipGaps = [
    distance(world[LM.INDEX_TIP], world[LM.MIDDLE_TIP]),
    distance(world[LM.MIDDLE_TIP], world[LM.RING_TIP]),
    distance(world[LM.RING_TIP], world[LM.PINKY_TIP]),
  ];
  const fingerSpacing = safe(tipGaps.reduce((sum, gap) => sum + gap, 0) / tipGaps.length, palmWidth);

  const pinkyDeviationDeg = angleDeg(world[LM.PINKY_MCP], world[LM.PINKY_PIP], world[LM.PINKY_TIP]);

  return {
    palmLength,
    palmWidth,
    palmAspect: safe(palmWidth, palmLength),
    fingerLengths,
    middleOverPalm: safe(fingerLengths.saturn, palmLength),
    indexOverMiddle: safe(fingerLengths.jupiter, fingerLengths.saturn),
    ringOverMiddle: safe(fingerLengths.sun, fingerLengths.saturn),
    indexOverRing: safe(fingerLengths.jupiter, fingerLengths.sun),
    pinkyReachOnRing,
    thumbAbductionDeg,
    thumbIpAngleDeg,
    thumbNailOverWill,
    fingerSpacing,
    pinkyDeviationDeg,
  };
}

/**
 * Hand shape from two ratios.
 *
 * Only the cases those ratios genuinely determine are scored highly. Elementary, spatulate and conic
 * all hinge on the *silhouette* — fingertip taper, palm broadening — which a skeleton cannot see, so
 * they are never claimed here.
 */
function suggestShape(metrics: LandmarkMetrics): ShapeSuggestion | null {
  const { palmAspect, middleOverPalm } = metrics;
  const squarePalm = Math.abs(palmAspect - 1) < 0.12;
  const longPalm = palmAspect < 0.86;
  const longFingers = middleOverPalm >= 1.0;
  const shortFingers = middleOverPalm <= 0.88;

  if (squarePalm && shortFingers) return { shape: "square", confidence: 0.82 };
  if (longPalm && longFingers && metrics.fingerSpacing < 0.2) return { shape: "psychic", confidence: 0.74 };
  if (longPalm && longFingers) return { shape: "philosophic", confidence: 0.62 };
  if (squarePalm && longFingers) return { shape: "square", confidence: 0.6 };
  return null;
}

export interface FeatureOptions {
  /** Gate score for this capture; becomes `hand.overall_quality`. */
  readonly quality?: number;
  /** True once line extraction is producing usable traces. Gates `reading.lines_available`. */
  readonly linesAvailable?: boolean;
  /** True when mounts have been supplied from anywhere (self-report today). */
  readonly mountsAvailable?: boolean;
  /** True once both hands have been captured. */
  readonly handsCompared?: boolean;
}

/**
 * Derives everything 21 landmarks legitimately support.
 *
 * Thresholds are classical proportions expressed as ratios; they are the second-most-likely thing
 * to need tuning after the rectification anchors, which is why {@link LandmarkMetrics} is returned
 * alongside and surfaced in the debug HUD.
 */
export function featuresFromLandmarks(
  world: readonly Landmark3[],
  options: FeatureOptions = {},
): LandmarkFeatureResult | null {
  if (world.length < 21) return null;

  const metrics = measure(world);
  const fingers: Record<string, unknown> = {};
  const thumb: Record<string, unknown> = {};
  const hand: Record<string, unknown> = {};
  const reading: Record<string, unknown> = {};

  /* ------------------------------- Fingers ------------------------------- */

  if (metrics.middleOverPalm >= 1.0) fingers.length_vs_palm = "long";

  if (metrics.indexOverMiddle >= 0.95) fingers.jupiter = { length: "long" };
  else if (metrics.indexOverMiddle <= 0.86) fingers.jupiter = { length: "short" };

  if (metrics.middleOverPalm >= 1.05) fingers.saturn = { length: "long" };
  else if (metrics.middleOverPalm <= 0.88) fingers.saturn = { length: "short" };

  if (metrics.ringOverMiddle >= 1.0) fingers.sun = { length: "excessive" };
  else if (metrics.ringOverMiddle >= 0.96) fingers.sun = { length: "long" };
  else if (metrics.ringOverMiddle <= 0.88) fingers.sun = { length: "short" };

  // Reaching past the ring finger's top joint is the classical "long Mercury".
  if (metrics.pinkyReachOnRing >= 0.78) fingers.mercury = { length: "long_past_apollo_nail" };
  else if (metrics.pinkyReachOnRing >= 0.68) fingers.mercury = { length: "long" };
  else if (metrics.pinkyReachOnRing <= 0.55) fingers.mercury = { length: "short" };

  const indexRingGap = Math.abs(1 - metrics.indexOverRing);
  if (indexRingGap < 0.02) fingers.jupiter_vs_apollo = "equal";
  else if (metrics.indexOverRing < 0.94) fingers.jupiter_vs_apollo = "apollo_much_longer";
  else if (metrics.indexOverMiddle >= 0.97) fingers.jupiter_vs_apollo = "jupiter_near_saturn_length";

  fingers.spacing = Number(metrics.fingerSpacing.toFixed(3));

  // A markedly bent last segment on the little finger; the KB only cares that it is crooked.
  if (metrics.pinkyDeviationDeg < 155) {
    const mercury = (fingers.mercury as Record<string, unknown> | undefined) ?? {};
    fingers.mercury = { ...mercury, crooked: true };
  }

  /* -------------------------------- Thumb -------------------------------- */

  thumb.present = true;
  if (metrics.thumbAbductionDeg < 25) thumb.cramped_to_palm = true;
  if (metrics.thumbIpAngleDeg > 160) thumb.straight_full = true;
  if (metrics.thumbNailOverWill > 1.05) thumb.nail_phalange_long = true;

  /* --------------------------------- Hand -------------------------------- */

  const shapeSuggestion = suggestShape(metrics);
  if (shapeSuggestion !== null && shapeSuggestion.confidence >= SHAPE_CONFIDENCE_FLOOR) {
    hand.shape = shapeSuggestion.shape;
    hand.shape_type_available = true;
    reading.hand_shape_available = true;
  }
  if (options.quality !== undefined) hand.overall_quality = Number(options.quality.toFixed(3));

  if (options.linesAvailable === true) reading.lines_available = true;
  if (options.mountsAvailable === true) reading.mounts_available = true;
  if (options.handsCompared === true) reading.hands_comparison_available = true;

  const features: Record<string, unknown> = { fingers, thumb };
  if (Object.keys(hand).length > 0) features.hand = hand;
  if (Object.keys(reading).length > 0) features.reading = reading;

  return { features: features as FeatureBag, metrics, shapeSuggestion };
}
