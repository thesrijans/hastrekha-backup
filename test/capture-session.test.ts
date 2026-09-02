/* ============================================================================
 * CAPTURE SESSION — Phase 0a harness invariants
 *
 * Pure-function coverage only, per the apply spec: schema roundtrip, the A4
 * layout constants, D6 sharpness on synthetic sharp-vs-blurred arrays, and the
 * stable-window auto-trigger. Nothing here touches the DOM, the camera, or the
 * detection pipeline.
 * ========================================================================== */
import assert from "node:assert/strict";
import {
  advanceStableWindow,
  emptyStableWindow,
  MAX_TICK_DELTA_MS,
  STABLE_WINDOW_MS,
} from "../lib/scan/dev/still-capture";
import {
  CANONICAL_LABEL_SIZE,
  cropFileName,
  isRekhaLabelFile,
  isSessionMetadata,
  labelFileName,
  parseRekhaLabelFile,
  parseSessionMetadata,
  rawFileName,
  SESSION_DIRS,
  SESSION_METADATA_FILE,
  SESSION_SCHEMA_VERSION,
  type CaptureStillRecord,
  type RekhaLabelFile,
  type SessionMetadata,
} from "../lib/scan/dev/session-types";
import { SHARPNESS_MIN_VARIANCE, assessSharpness, varianceOfLaplacian } from "../lib/scan/quality";

let assertions = 0;
const ok = (condition: boolean, message: string): void => {
  assert.ok(condition, message);
  assertions += 1;
};

/* ------------------------- 1. A4 layout constants ------------------------- */

ok(CANONICAL_LABEL_SIZE === 512, "labeling resolution is 512 (D3)");
assert.deepEqual(
  SESSION_DIRS,
  ["raw", "selected", "aligned", "snapshots", "labels"],
  "A4 replay layout: raw/ selected/ aligned/ snapshots/ labels/",
);
assertions += 1;
ok(SESSION_METADATA_FILE === "metadata.json", "metadata file name is fixed");
ok(rawFileName(3) === "still-003.png", "raw names are zero-padded and stable");
ok(cropFileName(12) === "crop-012.png", "crop names are zero-padded and stable");
ok(labelFileName(0) === "label-000.json", "label names are zero-padded and stable");

/* ------------------------ 2. Session schema roundtrip ------------------------ */

const still: CaptureStillRecord = {
  index: 0,
  rawFile: rawFileName(0),
  cropFile: cropFileName(0),
  capturePath: "canvas-fallback",
  width: 1920,
  height: 1080,
  landmarks: Array.from({ length: 21 }, (_, i) => ({ x: i / 21, y: i / 21, z: 0 })),
  anchors: [
    [960, 900],
    [700, 820],
    [640, 400],
    [1100, 410],
  ],
  quality: { score: 0.82, ok: true, issues: [], luma: 0.5, clipped: 0.001, jitter: 0.002, sharpness: 141 },
  poseAngle: { rollDeg: -12.5, windingStrength: 0.31 },
  trackSettings: { width: 1920, height: 1080, frameRate: 30 },
  capturedAt: "2026-09-02T00:00:00.000Z",
};
const session: SessionMetadata = {
  schemaVersion: SESSION_SCHEMA_VERSION,
  sessionId: "session-test",
  hand: "right",
  createdAt: "2026-09-02T00:00:00.000Z",
  canonicalSize: CANONICAL_LABEL_SIZE,
  stills: [still],
};

ok(isSessionMetadata(session), "a well-formed session validates");
ok(parseSessionMetadata(JSON.stringify(session)) !== null, "session survives a JSON roundtrip");
ok(!isSessionMetadata({ ...session, schemaVersion: "other" }), "wrong schemaVersion is rejected");
ok(!isSessionMetadata({ ...session, hand: "both" }), "invalid hand is rejected");
ok(
  !isSessionMetadata({ ...session, stills: [{ ...still, landmarks: still.landmarks.slice(0, 20) }] }),
  "20 landmarks is not a hand — 21 required",
);
ok(
  !isSessionMetadata({ ...session, stills: [{ ...still, capturePath: "screenshot" }] }),
  "unknown capture path is rejected — provenance must be one of the two real ones",
);
ok(parseSessionMetadata("{not json") === null, "malformed JSON parses to null, never throws");

/* ------------------------- 3. Label schema (D4 shape) ------------------------- */

const label: RekhaLabelFile = {
  schemaVersion: SESSION_SCHEMA_VERSION,
  sessionId: "session-test",
  stillIndex: 0,
  frame: "selected/crop-000.png",
  anchors: [
    [256, 480],
    [180, 430],
    [160, 120],
    [280, 120],
  ],
  canonicalSize: CANONICAL_LABEL_SIZE,
  hand: "right",
  lines: [
    { id: "heart", points: [[0.141, 0.25], [0.469, 0.219], [0.844, 0.352]], absent: false },
    { id: "head", points: [], absent: true },
    { id: "life", points: [[0.313, 0.281], [0.484, 0.813]], absent: false },
    { id: "fate", points: [], absent: true },
  ],
  absent: ["head", "fate"],
  mode: "blank_slate",
  labeler: "srijan",
  capturedAt: "2026-09-02T00:00:00.000Z",
  labeledAt: "2026-09-02T00:10:00.000Z",
};

ok(isRekhaLabelFile(label), "a well-formed label validates");
ok(parseRekhaLabelFile(JSON.stringify(label)) !== null, "label survives a JSON roundtrip");

/* Absent semantics: absent is a real observation, and the two encodings must agree. */
ok(
  !isRekhaLabelFile({ ...label, absent: ["head"] }),
  "top-level absent list must mirror the per-line flags exactly",
);
ok(
  !isRekhaLabelFile({
    ...label,
    lines: label.lines.map((l) => (l.id === "head" ? { ...l, points: [[0.5, 0.5], [0.6, 0.6]] } : l)),
  }),
  "an absent line cannot carry points",
);
ok(
  !isRekhaLabelFile({
    ...label,
    lines: label.lines.map((l) => (l.id === "heart" ? { ...l, points: [[0.5, 0.5]] } : l)),
  }),
  "a present line needs at least 2 points",
);
ok(
  !isRekhaLabelFile({
    ...label,
    lines: label.lines.map((l) => (l.id === "heart" ? { ...l, points: [[1.2, 0.5], [0.5, 0.5]] } : l)),
  }),
  "points outside 0–1 crop fractions are rejected (D4)",
);
ok(
  !isRekhaLabelFile({ ...label, lines: [...label.lines, label.lines[0]] }),
  "duplicate line ids are rejected",
);
ok(
  !isRekhaLabelFile({ ...label, lines: [{ id: "sun", points: [[0.1, 0.1], [0.2, 0.2]], absent: false }] }),
  "only heart/head/life/fate are labelable in 0a",
);

/* ------------------------ 4. Sharpness (D6, synthetic) ------------------------ */

const SIZE = 64;
/** Hard 0/255 checkerboard: every interior pixel is an edge — variance far above any threshold. */
const sharp = new Float32Array(SIZE * SIZE);
for (let y = 0; y < SIZE; y += 1) {
  for (let x = 0; x < SIZE; x += 1) sharp[y * SIZE + x] = (x + y) % 2 === 0 ? 255 : 0;
}
/** Smooth horizontal ramp: the Laplacian of a linear function is 0 everywhere. */
const blurred = new Float32Array(SIZE * SIZE);
for (let y = 0; y < SIZE; y += 1) {
  for (let x = 0; x < SIZE; x += 1) blurred[y * SIZE + x] = (x / (SIZE - 1)) * 255;
}

const sharpReading = assessSharpness(sharp, SIZE, SIZE);
const blurredReading = assessSharpness(blurred, SIZE, SIZE);
ok(sharpReading.variance > SHARPNESS_MIN_VARIANCE, "checkerboard scores above the floor");
ok(sharpReading.ok, "…and passes");
ok(blurredReading.variance < SHARPNESS_MIN_VARIANCE, "smooth ramp scores below the floor");
ok(!blurredReading.ok, "…and fails — a still, defocused frame is the case D6 exists for");
ok(blurredReading.variance < 1e-6, "a linear ramp's Laplacian variance is ~0 exactly");
ok(varianceOfLaplacian(sharp, 2, 2) === 0, "degenerate sizes return 0, never NaN");
console.log(
  `  sharpness: checkerboard ${sharpReading.variance.toFixed(0)} vs ramp ${blurredReading.variance.toFixed(4)} (floor ${SHARPNESS_MIN_VARIANCE})`,
);

/* ------------------------- 5. Stable-window trigger ------------------------- */

{
  // Fills after STABLE_WINDOW_MS of continuous pass, fires exactly once.
  let state = emptyStableWindow();
  let fired = 0;
  const TICK = 50;
  for (let t = 0; t < 20; t += 1) {
    const step = advanceStableWindow(state, true, TICK);
    state = step.state;
    if (step.trigger) fired += 1;
  }
  ok(fired === 1, "one trigger per stable hold, however long it continues");

  // A fail resets and re-arms.
  const failStep = advanceStableWindow(state, false, TICK);
  state = failStep.state;
  ok(!failStep.trigger && state.heldMs === 0 && state.armed, "gate fail resets the window and re-arms");
  let refired = 0;
  for (let t = 0; t < Math.ceil(STABLE_WINDOW_MS / TICK) + 2; t += 1) {
    const step = advanceStableWindow(state, true, TICK);
    state = step.state;
    if (step.trigger) refired += 1;
  }
  ok(refired === 1, "after a reset the window can fire again");
}

{
  // A near-miss hold that fails before the window fills never fires.
  let state = emptyStableWindow();
  let fired = 0;
  for (let cycle = 0; cycle < 10; cycle += 1) {
    for (let t = 0; t < 5; t += 1) {
      const step = advanceStableWindow(state, true, 50);
      state = step.state;
      if (step.trigger) fired += 1;
    }
    state = advanceStableWindow(state, false, 50).state; // fails at 250ms < 300ms
  }
  ok(fired === 0, "249…250ms holds never trigger — the window is a floor, not a hint");
}

{
  // A tab-switch stall cannot fake a hold: one giant delta is clamped to MAX_TICK_DELTA_MS.
  const step = advanceStableWindow(emptyStableWindow(), true, 10_000);
  ok(
    !step.trigger && step.state.heldMs === MAX_TICK_DELTA_MS,
    "a single stalled tick contributes at most MAX_TICK_DELTA_MS",
  );
  const negative = advanceStableWindow(emptyStableWindow(), true, -50);
  ok(negative.state.heldMs === 0, "a negative delta (clock skew) contributes nothing");
}

console.log(`CAPTURE SESSION ASSERTIONS PASSED (${assertions})`);
