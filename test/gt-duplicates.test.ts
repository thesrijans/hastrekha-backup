/* ============================================================================
 * GT DUPLICATES — the pose-diversity guard reaches the eval set (lane B)
 *
 * A real session tree is written to a temp directory: two labeled stills where
 * still #1 is marked `duplicateOf: 0` by the capture guard. The adapter must
 * skip the duplicate BY DEFAULT (with the reason visible as a skip case, never
 * a silent drop) and score it only under `includeDuplicates`. The label files
 * are built by the labeler's own buildLabelFile, the metadata validated by the
 * session schema — not hand-rolled lookalikes.
 * ========================================================================== */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  CANONICAL_LABEL_SIZE,
  SESSION_SCHEMA_VERSION,
  cropFileName,
  isSessionMetadata,
  labelFileName,
  rawFileName,
  type CaptureStillRecord,
  type SessionMetadata,
} from "../lib/scan/dev/session-types";
import { buildLabelFile, emptyLabelerState, type LabelerState } from "../lib/scan/dev/labeler-file";
import { loadGroundTruthDetailed } from "./eval/gt-adapter";

let assertions = 0;
const ok = (condition: boolean, message: string): void => {
  assert.ok(condition, message);
  assertions += 1;
};

const makeStill = (index: number, duplicateOf?: number): CaptureStillRecord => ({
  index,
  rawFile: rawFileName(index),
  cropFile: cropFileName(index),
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
  quality: { score: 0.8, ok: true, issues: [], luma: 0.5, clipped: 0, jitter: 0.001, sharpness: 120 },
  poseAngle: { rollDeg: 1.0, windingStrength: 0.4 },
  trackSettings: {},
  capturedAt: `2026-09-03T00:0${index}:00.000Z`,
  stillVol: 140,
  attempts: 1,
  ...(duplicateOf !== undefined ? { duplicateOf } : {}),
});

const metadata: SessionMetadata = {
  schemaVersion: SESSION_SCHEMA_VERSION,
  sessionId: "session-dup-test",
  hand: "right",
  createdAt: "2026-09-03T00:00:00.000Z",
  canonicalSize: CANONICAL_LABEL_SIZE,
  stills: [makeStill(0), makeStill(1, 0)],
};
ok(isSessionMetadata(metadata), "the synthetic metadata (duplicateOf included) passes the session schema");

const labelState: LabelerState = {
  ...emptyLabelerState("LUMA"),
  lines: {
    heart: { points: [[0.14, 0.25], [0.84, 0.35]], absent: false, confidence: "clear", method: "manual", viewAtCommit: "NATURAL", done: true },
    head: { points: [], absent: true, confidence: "clear", method: "manual", viewAtCommit: "NATURAL", done: true },
    life: { points: [[0.31, 0.28], [0.48, 0.81]], absent: false, confidence: "clear", method: "manual", viewAtCommit: "NATURAL", done: true },
    fate: { points: [], absent: true, confidence: "clear", method: "manual", viewAtCommit: "NATURAL", done: true },
  },
};

const repoRoot = mkdtempSync(path.join(tmpdir(), "hastrekha-gt-dup-"));
try {
  const sessionDir = path.join(repoRoot, "fixtures", "golden", metadata.sessionId);
  mkdirSync(path.join(sessionDir, "labels"), { recursive: true });
  mkdirSync(path.join(sessionDir, "selected"), { recursive: true });
  writeFileSync(path.join(sessionDir, "metadata.json"), JSON.stringify(metadata, null, 2));
  for (const index of [0, 1]) {
    const label = buildLabelFile(labelState, metadata, index, "srijan", "2026-09-03T00:10:00.000Z");
    writeFileSync(path.join(sessionDir, "labels", labelFileName(index)), JSON.stringify(label, null, 2));
    // existsSync is all the adapter asks of the crop here; a stub keeps the test I/O-light.
    writeFileSync(path.join(sessionDir, "selected", cropFileName(index)), "png-stub");
  }

  const byDefault = loadGroundTruthDetailed("fixtures", repoRoot).cases.filter((c) => c.source === "session");
  ok(byDefault.length === 2, "both labeled stills surface as cases — the duplicate is not silently dropped");
  const original = byDefault.find((c) => c.id.endsWith("label-000"));
  const duplicate = byDefault.find((c) => c.id.endsWith("label-001"));
  ok(original?.skip === undefined, "the original pose scores normally");
  ok(
    duplicate?.skip !== undefined && duplicate.skip.includes("duplicate of still #0"),
    `the pose duplicate is a SKIP case with the reason (got: ${duplicate?.skip ?? "none"})`,
  );
  ok(
    (duplicate?.skip ?? "").includes("--include-duplicates"),
    "the skip reason names the override, so the report teaches the escape hatch",
  );

  const included = loadGroundTruthDetailed("fixtures", repoRoot, { includeDuplicates: true }).cases.filter(
    (c) => c.source === "session",
  );
  ok(
    included.every((c) => c.skip === undefined),
    "--include-duplicates scores the duplicate too",
  );
} finally {
  rmSync(repoRoot, { recursive: true, force: true });
}

console.log(`GT DUPLICATES ASSERTIONS PASSED (${assertions})`);
