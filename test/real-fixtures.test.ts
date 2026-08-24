import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { derivePalmEdge, palmBoundary } from "../lib/scan/landmarks";
import { palmSpan } from "../lib/scan/quality";
import { LM } from "../lib/scan/landmark-index";
import type { Landmark3, Point2 } from "../lib/scan/types";

/**
 * Regression tests against **real exported frames**.
 *
 * The palm-edge constants cannot be settled from synthetic fixtures — a hand generated to satisfy
 * the construction proves nothing about the construction. `/scan`'s debug panel exports a raw frame
 * plus every landmark and derived point; dropping the pair into `test/fixtures/real/` turns that
 * capture into a permanent test.
 *
 * The suite is deliberately **empty-safe**: with no fixtures it reports and passes, so CI on a fresh
 * clone is green and nobody is tempted to commit camera frames just to keep the build alive.
 */

const FIXTURE_DIR = path.join(process.cwd(), "test", "fixtures", "real");

interface FixtureDerived {
  readonly p1: Point2;
  readonly p2: Point2;
  readonly percussionTop: Point2;
  readonly edgeAxis: Point2;
  readonly outward: Point2;
  readonly peak?: number;
  readonly palmWidth?: number;
}

interface Fixture {
  readonly imageW: number;
  readonly imageH: number;
  readonly mirroredPreview: boolean;
  readonly handednessLabel: string | null;
  readonly handednessScore: number | null;
  readonly landmarks: Landmark3[] | null;
  readonly worldLandmarks: Landmark3[] | null;
  readonly derived: FixtureDerived | null;
  readonly anchorsUsed: number;
}

/** Tolerates the path being absent — or, as happened once, existing as a stray empty file. */
function fixtureFiles(): string[] {
  if (!existsSync(FIXTURE_DIR)) return [];
  if (!statSync(FIXTURE_DIR).isDirectory()) {
    console.warn(`REAL FIXTURES: ${FIXTURE_DIR} exists but is not a directory — skipping.`);
    return [];
  }
  return readdirSync(FIXTURE_DIR)
    .filter((name) => /^frame-.*\.json$/.test(name))
    .sort();
}

const files = fixtureFiles();

if (files.length === 0) {
  console.log(
    "REAL FIXTURES: none present — skipping. Export a frame from /scan's debug panel and drop the " +
      "PNG + JSON pair into test/fixtures/real/ to turn it into a regression test.",
  );
} else {
  console.log(`REAL FIXTURES: checking ${files.length} exported frame(s)`);
}

const close = (a: Point2, b: Point2, eps: number): boolean => Math.hypot(a.x - b.x, a.y - b.y) < eps;

for (const file of files) {
  const label = file;
  const raw = readFileSync(path.join(FIXTURE_DIR, file), "utf8");
  let fixture: Fixture;
  try {
    fixture = JSON.parse(raw) as Fixture;
  } catch (error) {
    assert.fail(`${label}: not valid JSON (${error instanceof Error ? error.message : "unknown"})`);
  }

  assert.ok(fixture.imageW > 0 && fixture.imageH > 0, `${label}: carries image dimensions`);
  assert.ok(Array.isArray(fixture.landmarks) && fixture.landmarks.length === 21, `${label}: has 21 landmarks`);
  const marks = fixture.landmarks as Landmark3[];

  /* Landmarks are normalised to the frame, so every one must sit in [0,1] (a little slack for
     a hand clipping the edge, which MediaPipe reports as slightly out of range). */
  for (let i = 0; i < marks.length; i += 1) {
    assert.ok(
      Number.isFinite(marks[i].x) && Number.isFinite(marks[i].y),
      `${label}: landmark ${i} is finite`,
    );
    assert.ok(marks[i].x > -0.2 && marks[i].x < 1.2, `${label}: landmark ${i} x is in frame`);
    assert.ok(marks[i].y > -0.2 && marks[i].y < 1.2, `${label}: landmark ${i} y is in frame`);
  }

  const edge = derivePalmEdge(marks);
  assert.ok(edge !== null, `${label}: the edge still derives from the stored landmarks`);

  /* (a) Regression: recomputing from the stored landmarks must reproduce what was exported. A
     drift here means a constant or the construction changed since the capture — which is exactly
     what this suite exists to surface. */
  if (fixture.derived !== null) {
    const tolerance = 1e-6;
    const pairs: ReadonlyArray<readonly [string, Point2, Point2]> = [
      ["p1", fixture.derived.p1, edge.p1],
      ["p2", fixture.derived.p2, edge.p2],
      ["percussionTop", fixture.derived.percussionTop, edge.percussionTop],
      ["edgeAxis", fixture.derived.edgeAxis, edge.edgeAxis],
      ["outward", fixture.derived.outward, edge.outward],
    ];
    for (const [name, stored, recomputed] of pairs) {
      assert.ok(
        close(stored, recomputed, tolerance),
        `${label}: recomputed ${name} matches the export ` +
          `(stored ${stored.x.toFixed(5)},${stored.y.toFixed(5)} vs ${recomputed.x.toFixed(5)},${recomputed.y.toFixed(5)})`,
      );
    }
  }

  /* (b) Every derived point must land inside the frame and stay anatomically plausible — within
     1.5 palm spans of the little knuckle. A runaway offset shows up here first. */
  const span = palmSpan(marks);
  assert.ok(span > 0, `${label}: palm span is positive`);
  const pinky = marks[LM.PINKY_MCP];
  const derivedPoints: ReadonlyArray<readonly [string, Point2]> = [
    ["p1", edge.p1],
    ["p2", edge.p2],
    ["percussionTop", edge.percussionTop],
  ];
  for (const [name, point] of derivedPoints) {
    assert.ok(
      point.x >= 0 && point.x <= 1 && point.y >= 0 && point.y <= 1,
      `${label}: ${name} lands inside the image (${point.x.toFixed(3)}, ${point.y.toFixed(3)})`,
    );
    const reach = Math.hypot(point.x - pinky.x, point.y - pinky.y);
    assert.ok(
      reach <= 1.5 * span,
      `${label}: ${name} stays within 1.5 palm spans of the little knuckle (${reach.toFixed(3)} vs ${(1.5 * span).toFixed(3)})`,
    );
  }

  /* (c) The ordered boundary must walk the edge without doubling back: from the wrist onward each
     point gets strictly farther from the wrist, i.e. monotonically toward the little knuckle. */
  const boundary = palmBoundary(marks);
  assert.ok(boundary !== null && boundary.length === 6, `${label}: boundary has six points`);
  const wrist = marks[LM.WRIST];
  for (let i = 2; i < boundary.length; i += 1) {
    const previous = Math.hypot(boundary[i - 1].x - wrist.x, boundary[i - 1].y - wrist.y);
    const current = Math.hypot(boundary[i].x - wrist.x, boundary[i].y - wrist.y);
    assert.ok(
      current > previous,
      `${label}: boundary point ${i} advances away from the wrist (${current.toFixed(4)} > ${previous.toFixed(4)})`,
    );
  }

  /* The paired PNG should be there too — the JSON alone cannot be eyeballed. */
  const png = file.replace(/\.json$/, ".png");
  assert.ok(
    existsSync(path.join(FIXTURE_DIR, png)),
    `${label}: its ${png} is present, so the edge can be checked against the real palm`,
  );

  console.log(
    `  ${label}: ok — ${fixture.handednessLabel ?? "?"} ` +
      `(${(fixture.handednessScore ?? 0).toFixed(2)}), ${fixture.anchorsUsed} anchors, ` +
      `mirrored=${fixture.mirroredPreview}, peak=${edge.peak.toFixed(4)}`,
  );
}

console.log("REAL FIXTURE ASSERTIONS PASSED");
