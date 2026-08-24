import assert from "node:assert/strict";
import {
  assessFacing,
  CAPTURE_POSES,
  expectedWindingSign,
  gradeFrame,
  HANDEDNESS_TRUST_SCORE,
  palmSpan,
  palmTilt,
  palmWinding,
  physicalHandedness,
  type PoseProfile,
  type QualityInput,
} from "../lib/scan/quality";
import type { Handedness, Landmark3 } from "../lib/scan/types";
import { mirrorHand, syntheticHand } from "./hand-fixture";

/**
 * World-space mirror. Image coordinates live in 0–1 so they mirror as `1 - x`; world coordinates are
 * metres centred on the wrist, so they mirror as `-x`. Getting this wrong would leave the normal
 * pointing the same way for both hands and quietly invalidate every assertion below.
 */
function mirrorWorld(world: readonly Landmark3[]): Landmark3[] {
  return world.map((point) => ({ ...point, x: -point.x }));
}

const { image: rightPalmImage, world: rightPalmWorld } = syntheticHand();
/** A left palm shown to the camera is the mirror image of a right palm. */
const leftPalmImage = mirrorHand(rightPalmImage);
const leftPalmWorld = mirrorWorld(rightPalmWorld);

/* ---------------------------- Raw winding sign ----------------------------- */

{
  /*
   * Anatomy, not assumption: in image space (x right, y down) a right hand held palm-to-camera puts
   * the thumb on the image's left, so the index knuckle sits left of the little knuckle while both
   * sit above the wrist — a positive cross product. The left palm is its mirror.
   */
  assert.ok(palmWinding(rightPalmImage) > 0, "a right palm winds positive");
  assert.ok(palmWinding(leftPalmImage) < 0, "a left palm winds negative");
  assert.ok(
    Math.abs(palmWinding(rightPalmImage) + palmWinding(leftPalmImage)) < 1e-12,
    "and the two are exact negatives — the measurement carries no handedness of its own",
  );
  assert.equal(palmWinding([]), 0, "no landmarks, no winding");
}

/* --------------------- Handedness / mirror bookkeeping --------------------- */

{
  /*
   * MediaPipe labels handedness assuming a mirrored (selfie) input. We feed it the raw frame, so on
   * a front camera — the case where the preview is CSS-mirrored — its label is inverted.
   */
  assert.equal(physicalHandedness("Right", false), "Right", "unmirrored preview: label is taken as given");
  assert.equal(physicalHandedness("Left", false), "Left", "unmirrored preview: label is taken as given");
  assert.equal(physicalHandedness("Right", true), "Left", "mirrored preview: the label is inverted");
  assert.equal(physicalHandedness("Left", true), "Right", "mirrored preview: the label is inverted");

  assert.equal(expectedWindingSign("Right", false), 1, "physical right palm expects a positive winding");
  assert.equal(expectedWindingSign("Left", false), -1, "physical left palm expects a negative winding");
  // The app's real configuration: front camera, mirrored preview, MediaPipe reports "Left" for a
  // physically right hand — which must still expect the positive winding a right palm produces.
  assert.equal(expectedWindingSign("Left", true), 1, "mirrored preview inverts the expectation with the label");
  assert.equal(expectedWindingSign("Right", true), -1, "and inverts it the other way too");
}

/* ------------------------- The four-case gate matrix ----------------------- */

interface Case {
  readonly name: string;
  readonly image: readonly Landmark3[];
  readonly world: readonly Landmark3[];
  /** What MediaPipe reports for this view. */
  readonly label: Handedness;
  readonly mirrored: boolean;
  readonly expectPalm: boolean;
}

/*
 * Back-of-hand fixtures. MediaPipe identifies WHICH hand it is looking at, not which side of it, so
 * the back of a left hand carries the label "Left" while presenting the geometry of a right palm.
 * That is precisely the confusion the winding test exists to resolve.
 */
const CASES: readonly Case[] = [
  {
    name: "right palm, unmirrored preview",
    image: rightPalmImage,
    world: rightPalmWorld,
    label: "Right",
    mirrored: false,
    expectPalm: true,
  },
  {
    name: "left palm, unmirrored preview",
    image: leftPalmImage,
    world: leftPalmWorld,
    label: "Left",
    mirrored: false,
    expectPalm: true,
  },
  {
    name: "back of right hand, unmirrored preview",
    image: leftPalmImage,
    world: leftPalmWorld,
    label: "Right",
    mirrored: false,
    expectPalm: false,
  },
  {
    name: "back of left hand, unmirrored preview",
    image: rightPalmImage,
    world: rightPalmWorld,
    label: "Left",
    mirrored: false,
    expectPalm: false,
  },
  /* The same four through a mirrored front-camera preview — the app's actual configuration. */
  {
    name: "right palm, mirrored preview (the app case that used to be rejected)",
    image: rightPalmImage,
    world: rightPalmWorld,
    label: "Left", // inverted by MediaPipe's mirrored-input assumption
    mirrored: true,
    expectPalm: true,
  },
  {
    name: "left palm, mirrored preview",
    image: leftPalmImage,
    world: leftPalmWorld,
    label: "Right",
    mirrored: true,
    expectPalm: true,
  },
  {
    name: "back of right hand, mirrored preview",
    image: leftPalmImage,
    world: leftPalmWorld,
    label: "Left",
    mirrored: true,
    expectPalm: false,
  },
  {
    name: "back of left hand, mirrored preview",
    image: rightPalmImage,
    world: rightPalmWorld,
    label: "Right",
    mirrored: true,
    expectPalm: false,
  },
];

for (const testCase of CASES) {
  const readout = assessFacing({
    landmarks: testCase.image,
    span: palmSpan(testCase.image),
    world: testCase.world,
    handedness: testCase.label,
    handednessScore: 0.95,
    mirrored: testCase.mirrored,
    minFacing: 0.55,
  });
  assert.equal(readout.trusted, true, `${testCase.name}: a 0.95 score is trusted`);
  assert.equal(
    readout.palmToward,
    testCase.expectPalm,
    `${testCase.name}: palmToward is ${testCase.expectPalm} (winding ${readout.windingSign}, expected ${readout.expectedSign}, normal z ${readout.normalZ.toFixed(3)})`,
  );

  /* And end to end through the gate, which is what actually blocks the pipeline. */
  const input: QualityInput = {
    landmarks: testCase.image,
    world: testCase.world,
    handedness: testCase.label,
    mirrored: testCase.mirrored,
    stats: { luma: 0.5, clipped: 0 },
    jitter: 0,
    score: 0.95,
    spanHistory: [0.6, 0.6, 0.6, 0.6, 0.6],
  };
  const verdict = gradeFrame(input);
  assert.equal(
    verdict.checks.not_palm_up,
    testCase.expectPalm,
    `${testCase.name}: the not_palm_up check agrees with assessFacing`,
  );
  if (testCase.expectPalm) {
    assert.ok(verdict.ok, `${testCase.name}: a clean palm frame passes the whole gate`);
  }
  assert.ok(verdict.facingReadout !== null, `${testCase.name}: the verdict carries a facing readout`);
}

/* The normal flips with handedness, which is why the low-confidence fallback cannot use it alone. */
{
  const right = assessFacing({
    landmarks: rightPalmImage,
    span: palmSpan(rightPalmImage),
    world: rightPalmWorld,
    handedness: "Right",
    handednessScore: 0.95,
    mirrored: false,
    minFacing: 0.55,
  });
  const left = assessFacing({
    landmarks: leftPalmImage,
    span: palmSpan(leftPalmImage),
    world: leftPalmWorld,
    handedness: "Left",
    handednessScore: 0.95,
    mirrored: false,
    minFacing: 0.55,
  });
  assert.ok(right.palmToward && left.palmToward, "both palms face the camera");
  assert.ok(
    Math.sign(right.normalZ) !== Math.sign(left.normalZ),
    "yet their palm normals have opposite z — the sign alone cannot mean 'toward camera'",
  );
  assert.ok(Math.abs(right.facing) > 0.9 && Math.abs(left.facing) > 0.9, "both are square-on to the camera");
}

/* --------------------- Low-confidence handedness fallback ------------------ */

{
  const lowScore = HANDEDNESS_TRUST_SCORE - 0.05;

  /* Below the trust score the sign is not enforced, so a mislabelled palm still passes. */
  const mislabelled = assessFacing({
    landmarks: rightPalmImage,
    span: palmSpan(rightPalmImage),
    world: rightPalmWorld,
    handedness: "Left", // wrong label, and no mirror to excuse it
    handednessScore: lowScore,
    mirrored: false,
    minFacing: 0.55,
  });
  assert.equal(mislabelled.trusted, false, "a sub-threshold score is not trusted");
  assert.equal(mislabelled.windingSign, 1);
  assert.equal(mislabelled.expectedSign, -1);
  assert.ok(mislabelled.palmToward, "the fallback accepts either winding sign rather than hard-blocking");

  /* Squareness is still required — an edge-on hand is rejected in either regime. */
  const edgeOn = assessFacing({
    landmarks: rightPalmImage,
    span: palmSpan(rightPalmImage),
    world: rightPalmWorld.map((p) => ({ x: p.x, y: 0, z: p.y })), // palm rotated into the view axis
    handedness: "Right",
    handednessScore: lowScore,
    mirrored: false,
    minFacing: 0.55,
  });
  assert.ok(edgeOn.facing < 0.55, "the rotated palm is edge-on");
  assert.ok(!edgeOn.palmToward, "and is rejected even though the winding sign is unconstrained");

  /* Above the threshold the sign IS enforced, so the same mislabelling is caught. */
  const trusted = assessFacing({
    landmarks: rightPalmImage,
    span: palmSpan(rightPalmImage),
    world: rightPalmWorld,
    handedness: "Left",
    handednessScore: HANDEDNESS_TRUST_SCORE,
    mirrored: false,
    minFacing: 0.55,
  });
  assert.ok(trusted.trusted, "exactly at the threshold counts as trusted");
  assert.ok(!trusted.palmToward, "and the mismatched winding is rejected");
}

/* ------------------------------- Tilted poses ------------------------------- */

/**
 * The bug: TILT LEFT rejected a palm that was tilted left, and blamed it on the palm not facing the
 * camera — advice that could not fix anything, since the palm was already facing the user.
 *
 * Two separate faults, so two separate fixes, and both are pinned here. `palmTilt` read the RAW
 * camera frame while `PoseProfile.tiltSign` describes the MIRRORED preview the user is tilting
 * against, so a correct tilt measured as its own opposite. And a tilt failure raised
 * `not_palm_up`, which is a different problem with a different hint.
 */

/** Rotates the fixture about its vertical axis and re-projects, so image and world stay consistent. */
function tiltedHand(degrees: number): { image: Landmark3[]; world: Landmark3[] } {
  const base = syntheticHand();
  const radians = (degrees * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const world = base.world.map((p) => ({ x: p.x * cos + p.z * sin, y: p.y, z: -p.x * sin + p.z * cos }));
  // Orthographic re-projection: the x-extent foreshortens by cos(θ), exactly as a real tilt does.
  const image = world.map((p) => ({ x: 0.5 + p.x * 4.0, y: 0.9 - p.y * 4.79, z: p.z }));
  return { image, world };
}

function gradeTilt(
  hand: { image: Landmark3[]; world: Landmark3[] },
  pose: PoseProfile,
  mirrored: boolean,
): ReturnType<typeof gradeFrame> {
  const span = palmSpan(hand.image);
  return gradeFrame({
    landmarks: hand.image,
    world: hand.world,
    handedness: "Right",
    mirrored,
    stats: { luma: 0.5, clipped: 0 },
    jitter: 0,
    score: 0.95,
    spanHistory: [span, span, span, span, span],
    pose,
  });
}

{
  const TILT_LEFT = CAPTURE_POSES.find((p) => p.pose === "TILT_LEFT");
  const TILT_RIGHT = CAPTURE_POSES.find((p) => p.pose === "TILT_RIGHT");
  assert.ok(TILT_LEFT !== undefined && TILT_RIGHT !== undefined, "the tilt poses exist");

  /* The mirror correction itself: screen space is the mirror of camera space, and nothing else. */
  const rotated = tiltedHand(35);
  assert.equal(
    palmTilt(rotated.world, true),
    -palmTilt(rotated.world, false),
    "the mirrored reading is the negation of the raw one",
  );
  assert.ok(Math.abs(palmTilt(rotated.world, false)) > 0.5, "a 35° rotation is a substantial tilt");

  /* Rear camera, no mirroring: a left-leaning normal satisfies TILT LEFT. */
  const leftRear = tiltedHand(35);
  assert.ok(palmTilt(leftRear.world, false) < 0, "35° leans the normal to screen-left unmirrored");
  assert.equal(gradeTilt(leftRear, TILT_LEFT, false).ok, true, "TILT LEFT accepts a left-leaning palm");

  /*
   * Front camera, mirrored preview — the configuration the bug was reported on. The user tilts left
   * as they see it, which is a right-leaning rotation in the raw frame the landmarker consumes.
   */
  const raw = tiltedHand(-35);
  const mirroredHand = {
    image: raw.image.map((p) => ({ ...p, x: 1 - p.x })),
    world: raw.world.map((p) => ({ ...p, x: -p.x })),
  };
  assert.ok(palmTilt(mirroredHand.world, true) < 0, "and leans screen-left once mirrored");

  const accepted = gradeTilt(mirroredHand, TILT_LEFT, true);
  assert.equal(accepted.ok, true, "TILT LEFT accepts a left-tilted palm on a mirrored preview");
  assert.equal(
    accepted.checks.not_palm_up,
    true,
    "and never blames the palm for facing the wrong way — the exact reported symptom",
  );

  /* Tilting the wrong way is still rejected, but as its own failure with its own hint. */
  const wrongWay = gradeTilt(mirroredHand, TILT_RIGHT, true);
  assert.equal(wrongWay.ok, false, "TILT RIGHT rejects a left-tilted palm");
  assert.equal(wrongWay.checks.tilt_direction, false, "as a tilt-direction failure");
  assert.equal(wrongWay.checks.not_palm_up, true, "not as a facing failure");
  assert.equal(wrongWay.hint, "Doosri taraf jhukao", "and says which way to go");

  /* A square-on palm satisfies neither tilt pose — the check is not vacuous. */
  const square = tiltedHand(0);
  assert.equal(gradeTilt(square, TILT_LEFT, false).checks.tilt_direction, false, "no tilt is not a left tilt");
  assert.equal(gradeTilt(square, TILT_RIGHT, false).checks.tilt_direction, false, "nor a right one");
}

/* --------------------- Winding sign on a foreshortened palm ----------------- */

{
  /*
   * The winding triangle is measured in the projection, so a palm rotated well off square-on
   * collapses it toward zero area and the sign becomes landmark jitter. Trusting it there is what
   * made a relaxed `minFacing` insufficient on its own: the pose let the tilt through and the sign
   * test rejected it anyway.
   */
  const { image, world } = syntheticHand();
  const squeeze = (factor: number): Landmark3[] =>
    image.map((p) => ({ ...p, x: 0.5 + (p.x - 0.5) * factor }));

  const full = assessFacing({
    landmarks: image,
    span: palmSpan(image),
    world,
    handedness: "Right",
    handednessScore: 0.95,
    mirrored: false,
    minFacing: 0.3,
  });
  assert.equal(full.windingReadable, true, "a square-on palm has a readable winding");
  assert.equal(full.palmToward, true, "and reads as palm-toward");

  const flattened = squeeze(0.15);
  const foreshortened = assessFacing({
    landmarks: flattened,
    span: palmSpan(flattened),
    world,
    handedness: "Right",
    handednessScore: 0.95,
    mirrored: false,
    minFacing: 0.3,
  });
  assert.equal(foreshortened.windingReadable, false, "a foreshortened palm does not");
  assert.ok(foreshortened.windingStrength < full.windingStrength, "strength falls with the projected area");
  assert.equal(foreshortened.trusted, true, "handedness is still trusted — only the geometry degraded");

  /* With the sign unreadable, the WRONG handedness label can no longer veto a palm. */
  const wrongLabel = assessFacing({
    landmarks: flattened,
    span: palmSpan(flattened),
    world,
    handedness: "Left",
    handednessScore: 0.95,
    mirrored: false,
    minFacing: 0.3,
  });
  assert.equal(wrongLabel.palmToward, true, "an unreadable sign is ignored rather than believed");

  /*
   * The honest limit, stated rather than hidden: at full strength that same mismatch DOES reject.
   * The relaxation is scoped to projections that cannot carry a sign, not a general loosening.
   */
  const wrongLabelSquare = assessFacing({
    landmarks: image,
    span: palmSpan(image),
    world,
    handedness: "Left",
    handednessScore: 0.95,
    mirrored: false,
    minFacing: 0.3,
  });
  assert.equal(wrongLabelSquare.palmToward, false, "a readable mismatch still rejects a dorsum");
}

console.log("FACING / HANDEDNESS ASSERTIONS PASSED");
