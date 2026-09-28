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
  PIPELINE_FEEDS_MIRRORED_INPUT,
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

/*
 * THE LABEL EACH FIXTURE CARRIES, in the gate's convention: the label that pairs with that geometry's
 * winding. It is the same through the front camera and the back camera, because the pipeline always
 * hands MediaPipe the RAW frame and both cameras photograph the palmar surface from in front (M1.1).
 *
 * (A measured caveat, not changed by M1: this fixture's "right palm" has its thumb on the image's left;
 * a real right palm in a raw frame has it on the right, and MediaPipe labels it "Right" — see the note
 * at PIPELINE_FEEDS_MIRRORED_INPUT. The fixture's naming and the gate's two conventions are each
 * inverted, and the PAIRING, which is what the gate uses, is the part that holds on real frames.)
 */
const RIGHT_HAND_LABEL: Handedness = "Left";
const LEFT_HAND_LABEL: Handedness = "Right";
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
   * The pairing takes no camera argument: the preview's mirror (lib/scan/camera-select.ts) never
   * touches the pixels MediaPipe sees, so a label pairs with the same winding through either camera.
   */
  assert.equal(PIPELINE_FEEDS_MIRRORED_INPUT, false, "the landmarker is always handed the raw frame");
  assert.equal(physicalHandedness(RIGHT_HAND_LABEL), "Right", "the right-palm fixture's label maps to the right hand");
  assert.equal(physicalHandedness(LEFT_HAND_LABEL), "Left", "and the left-palm fixture's to the left");

  assert.equal(expectedWindingSign(RIGHT_HAND_LABEL), 1, "and pairs with the right-palm fixture's positive winding");
  assert.equal(expectedWindingSign(LEFT_HAND_LABEL), -1, "the left-palm fixture's label with its negative one");
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
const CASES: readonly Case[] = (["front", "back"] as const).flatMap((camera) => {
  /* M1.1: the preview flag follows the camera — mirrored for the front one, never for the back. */
  const mirrored = camera === "front";
  const through = `${camera} camera (${mirrored ? "mirrored" : "unmirrored"} preview)`;
  return [
    { name: `right palm, ${through}`, image: rightPalmImage, world: rightPalmWorld, label: RIGHT_HAND_LABEL, mirrored, expectPalm: true },
    { name: `left palm, ${through}`, image: leftPalmImage, world: leftPalmWorld, label: LEFT_HAND_LABEL, mirrored, expectPalm: true },
    /* The back of a right hand presents a left palm's geometry and still carries the right hand's label. */
    { name: `back of right hand, ${through}`, image: leftPalmImage, world: leftPalmWorld, label: RIGHT_HAND_LABEL, mirrored, expectPalm: false },
    { name: `back of left hand, ${through}`, image: rightPalmImage, world: rightPalmWorld, label: LEFT_HAND_LABEL, mirrored, expectPalm: false },
  ];
});

for (const testCase of CASES) {
  const readout = assessFacing({
    landmarks: testCase.image,
    span: palmSpan(testCase.image),
    world: testCase.world,
    handedness: testCase.label,
    handednessScore: 0.95,
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
    handedness: RIGHT_HAND_LABEL,
    handednessScore: 0.95,
    minFacing: 0.55,
  });
  const left = assessFacing({
    landmarks: leftPalmImage,
    span: palmSpan(leftPalmImage),
    world: leftPalmWorld,
    handedness: LEFT_HAND_LABEL,
    handednessScore: 0.95,
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
    handedness: LEFT_HAND_LABEL, // the other hand's label on a right palm
    handednessScore: lowScore,
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
    handedness: RIGHT_HAND_LABEL,
    handednessScore: lowScore,
    minFacing: 0.55,
  });
  assert.ok(edgeOn.facing < 0.55, "the rotated palm is edge-on");
  assert.ok(!edgeOn.palmToward, "and is rejected even though the winding sign is unconstrained");

  /* Above the threshold the sign IS enforced, so the same mislabelling is caught. */
  const trusted = assessFacing({
    landmarks: rightPalmImage,
    span: palmSpan(rightPalmImage),
    world: rightPalmWorld,
    handedness: LEFT_HAND_LABEL,
    handednessScore: HANDEDNESS_TRUST_SCORE,
    minFacing: 0.55,
  });
  assert.ok(trusted.trusted, "exactly at the threshold counts as trusted");
  assert.ok(!trusted.palmToward, "and the mismatched winding is rejected");
}

/* ------------------------------- Tilted poses ------------------------------- */

/**
 * The tilt gate is judged in the space the user tilts in — the preview — and ONE physical tilt must
 * pass the same pose through either camera and with either hand. It did not: `palmTilt` took the x of
 * the wrist → index → little winding normal, and that winding points OUT of a palm whose thumb is on
 * the image's right (a right palm, seen palm-on) and INTO one whose thumb is on the image's left (a
 * left palm), so the LEFT hand read its every tilt with the opposite sign, through both cameras — its
 * tilt poses could be passed only by tilting the other way (R1). The right hand was never affected.
 *
 * What the camera changes is not the hand's chirality but the lean's direction. A palm shown to
 * either lens is seen palm-on, thumb on the same side; but image-right is the user's right through
 * the back camera (it looks the way they look) and their left through the front camera (it looks at
 * them; the preview mirrors it back). The frames below are built from that physical scene in the
 * landmarker's own axes — image x right and y down; world x right, y down, z away from the lens
 * (MEASURED under R1 on every real observation: world y follows image y, world z correlates +0.6–0.7
 * with image z, whose smaller values are documented as nearer) — so what each camera's raw frame
 * contains is derived, not assumed.
 */

type Camera = "front" | "back";

interface RawFrame {
  readonly image: Landmark3[];
  readonly world: Landmark3[];
  readonly mirrored: boolean;
  /** What the landmarker reports for this geometry, in the gate's pairing (see the labels above). */
  readonly label: Handedness;
}

/**
 * The raw frame a camera takes of a palm the user tilts `degrees` toward THEIR left (positive) or
 * right (negative): the lean of the palm's outward normal, as they see it on the preview.
 *
 * Seen palm-on with the fingers up, a right palm has its thumb on the viewer's right — so on the
 * image's right through EITHER lens (M1 and R1 measured exactly this on raw frames: thumb on the
 * image's right, label "Right") — and a left palm on the image's left. The back camera looks the way
 * the user looks, so image-right is the user's right and the preview is the raw frame; the front
 * camera looks AT the user, so image-right is the user's left, and the preview mirrors it back.
 */
function rawFrame(hand: Handedness, camera: Camera, degrees: number): RawFrame {
  const shape = syntheticHand().image; // a flat palm, thumb on the image's left
  const usersRightIsImageRight = camera === "back";
  const thumbOnImageRight = hand === "Right";
  /* The rotation about the vertical axis that leans the lens-facing normal (0, 0, -1) toward the user's left. */
  const radians = ((usersRightIsImageRight ? degrees : -degrees) * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const world = shape.map((p) => {
    const x = (thumbOnImageRight ? 0.5 - p.x : p.x - 0.5) * 0.25;
    return { x: x * cos, y: (p.y - 0.9) * 0.25, z: -x * sin };
  });
  // Orthographic re-projection: the x-extent foreshortens by cos(θ), exactly as a real tilt does.
  const image = world.map((p) => ({ x: 0.5 + p.x * 4, y: 0.9 + p.y * 4, z: p.z }));
  /* The label the landmarker gives this geometry: the one whose expected winding it has (M1: a thumb-right palm is "Right"). */
  const windingSign = palmWinding(image) > 0 ? 1 : -1;
  const label = (["Right", "Left"] as const).find((candidate) => expectedWindingSign(candidate) === windingSign);
  assert.ok(label !== undefined, "one label pairs with this winding");
  return { image, world, mirrored: camera === "front", label };
}

function gradeRaw(frame: RawFrame, pose: PoseProfile): ReturnType<typeof gradeFrame> {
  const span = palmSpan(frame.image);
  return gradeFrame({
    landmarks: frame.image,
    world: frame.world,
    handedness: frame.label,
    mirrored: frame.mirrored,
    stats: { luma: 0.5, clipped: 0 },
    jitter: 0,
    score: 0.95,
    spanHistory: [span, span, span, span, span],
    pose,
  });
}

{
  const FLAT = CAPTURE_POSES.find((p) => p.pose === "FLAT");
  const TILT_LEFT = CAPTURE_POSES.find((p) => p.pose === "TILT_LEFT");
  const TILT_RIGHT = CAPTURE_POSES.find((p) => p.pose === "TILT_RIGHT");
  assert.ok(FLAT !== undefined && TILT_LEFT !== undefined && TILT_RIGHT !== undefined, "the flat and tilt poses exist");
  const tiltOf = (frame: RawFrame): number => palmTilt(frame.world, frame.mirrored);

  /*
   * The derivation itself, pinned. One hand through the two cameras: the same palm-on silhouette with
   * the thumb on the same side — only the lean reverses in the raw frame, because the user's left is
   * image-left through the back camera and image-right through the front. And the OTHER hand leaning
   * the OTHER way is the mirror image (which is what a horizontally flipped feed is — not the same
   * palm through the other camera).
   */
  for (const hand of ["Right", "Left"] as const) {
    const back = rawFrame(hand, "back", 30);
    const front = rawFrame(hand, "front", 30);
    assert.ok(
      back.image.every((p, i) => Math.abs(p.x - front.image[i]!.x) < 1e-9 && Math.abs(p.y - front.image[i]!.y) < 1e-9),
      `${hand} hand: the two cameras see the same silhouette, thumb on the same side`,
    );
    assert.ok(
      back.world.every((p, i) => Math.abs(p.x - front.world[i]!.x) < 1e-9 && Math.abs(p.z + front.world[i]!.z) < 1e-9),
      `${hand} hand: …leaning the opposite way in the raw frame`,
    );
    for (const camera of ["front", "back"] as const) {
      assert.equal(palmWinding(rawFrame(hand, camera, 0).image) < 0, hand === "Right", `${hand} hand, ${camera} camera: the thumb is on the image's ${hand === "Right" ? "right" : "left"}`);
      assert.equal(rawFrame(hand, camera, 0).label, hand, `${hand} hand, ${camera} camera: labelled "${hand}", as the landmarker labels a raw frame`);
    }
  }
  for (const camera of ["front", "back"] as const) {
    const right = rawFrame("Right", camera, 30);
    const leftOtherWay = rawFrame("Left", camera, -30);
    assert.ok(
      right.image.every((p, i) => Math.abs(p.x - (1 - leftOtherWay.image[i]!.x)) < 1e-9 && Math.abs(p.y - leftOtherWay.image[i]!.y) < 1e-9) &&
        right.world.every((p, i) => Math.abs(p.x + leftOtherWay.world[i]!.x) < 1e-9 && Math.abs(p.z - leftOtherWay.world[i]!.z) < 1e-9),
      `${camera} camera: the other hand leaning the other way is the mirror image`,
    );
  }

  for (const hand of ["Right", "Left"] as const) {
    for (const camera of ["front", "back"] as const) {
      const who = `${hand.toLowerCase()} hand through the ${camera} camera`;

      /* A flat palm passes FLAT and satisfies neither tilt pose — as a tilt failure, never a facing one. */
      const flat = rawFrame(hand, camera, 0);
      assert.equal(gradeRaw(flat, FLAT).ok, true, `${who}: a flat palm passes FLAT`);
      assert.ok(Math.abs(tiltOf(flat)) < 1e-9, `${who}: a flat palm reads flat (${tiltOf(flat)})`);
      for (const pose of [TILT_LEFT, TILT_RIGHT]) {
        const verdict = gradeRaw(flat, pose);
        assert.equal(verdict.checks.tilt_direction, false, `${who}: a flat palm does not satisfy ${pose.pose}`);
        assert.equal(verdict.checks.not_palm_up, true, `${who}: …and is not told to face the camera`);
      }

      /* Tilted to the user's left: TILT LEFT passes, TILT RIGHT says "the other way". */
      const left = rawFrame(hand, camera, 30);
      assert.ok(tiltOf(left) < -0.25, `${who}: a palm tilted to the user's left reads left (${tiltOf(left).toFixed(3)})`);
      assert.equal(gradeRaw(left, TILT_LEFT).ok, true, `${who}: …and passes TILT LEFT`);
      const wrongWay = gradeRaw(left, TILT_RIGHT);
      assert.equal(wrongWay.ok, false, `${who}: TILT RIGHT rejects a left-tilted palm`);
      assert.equal(wrongWay.checks.tilt_direction, false, `${who}: …as a tilt-direction failure`);
      assert.equal(wrongWay.checks.not_palm_up, true, `${who}: …not as a facing failure`);
      assert.equal(wrongWay.hint, "Doosri taraf jhukao", `${who}: …and says which way to go`);

      /* Tilted to the user's right: the same, the other way. */
      const right = rawFrame(hand, camera, -30);
      assert.ok(tiltOf(right) > 0.25, `${who}: a palm tilted to the user's right reads right (${tiltOf(right).toFixed(3)})`);
      assert.equal(gradeRaw(right, TILT_RIGHT).ok, true, `${who}: …and passes TILT RIGHT`);
      const wrongWayRight = gradeRaw(right, TILT_LEFT);
      assert.equal(wrongWayRight.ok, false, `${who}: TILT LEFT rejects a right-tilted palm`);
      assert.equal(wrongWayRight.checks.tilt_direction, false, `${who}: …as a tilt-direction failure`);
      assert.equal(wrongWayRight.checks.not_palm_up, true, `${who}: …not as a facing failure`);
      assert.equal(wrongWayRight.hint, "Doosri taraf jhukao", `${who}: …and says which way to go`);
    }
  }

  /* The reading is the USER's tilt: one number for one scene, through both cameras, with both hands. */
  for (const degrees of [30, 0, -30]) {
    const readings = (["Right", "Left"] as const).flatMap((hand) => (["front", "back"] as const).map((camera) => tiltOf(rawFrame(hand, camera, degrees))));
    assert.ok(
      readings.every((reading) => Math.abs(reading - readings[0]!) < 1e-9),
      `a ${degrees}° tilt reads the same through both cameras with both hands: ${readings.map((r) => r.toFixed(3)).join(", ")}`,
    );
  }

  /* And a mirrored frame — the other hand, leaning the other way — reads as the negation, under the same preview. */
  const raw = rawFrame("Right", "back", 30);
  assert.ok(
    Math.abs(palmTilt(mirrorWorld(raw.world), false) + palmTilt(raw.world, false)) < 1e-9,
    "a mirrored world reads as the negation of the raw one, under the same preview",
  );
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
    handedness: RIGHT_HAND_LABEL,
    handednessScore: 0.95,
    minFacing: 0.3,
  });
  assert.equal(full.windingReadable, true, "a square-on palm has a readable winding");
  assert.equal(full.palmToward, true, "and reads as palm-toward");

  const flattened = squeeze(0.15);
  const foreshortened = assessFacing({
    landmarks: flattened,
    span: palmSpan(flattened),
    world,
    handedness: RIGHT_HAND_LABEL,
    handednessScore: 0.95,
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
    handedness: LEFT_HAND_LABEL,
    handednessScore: 0.95,
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
    handedness: LEFT_HAND_LABEL,
    handednessScore: 0.95,
    minFacing: 0.3,
  });
  assert.equal(wrongLabelSquare.palmToward, false, "a readable mismatch still rejects a dorsum");
}

console.log("FACING / HANDEDNESS ASSERTIONS PASSED");
