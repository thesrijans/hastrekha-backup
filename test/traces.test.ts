/**
 * Detect everything, then classify — and let the faint tier in without letting noise in with it.
 *
 * The pipeline used to trace the palm, fit four corridors, and drop everything else on the floor. On
 * a real hand that is most of what is there. This asserts the two properties that make keeping the
 * rest safe: a **faint** trace has to persist across fused frames before it may be admitted, so noise
 * cannot promote itself; and a trace that matches no class is kept as `minor_unclassified` rather
 * than being deleted or, worse, given the nearest plausible name.
 */
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import sharp from "sharp";
import { extractAllTraces, LINE_THRESHOLD } from "../lib/scan/lines";
import {
  classifyAll,
  classifyTrace,
  scoreAgainst,
  verticalityOf,
  CLASS_SPECS,
  KB_RULE_COUNT,
  MIN_CLASS_SCORE,
  TRACE_CLASSES,
  type TraceClass,
} from "../lib/scan/classify";
import { FAINT_STABILITY_FRAMES, FAINT_THRESHOLD, HIT_THRESHOLD } from "../lib/scan/fusion";
import { detectRidges, normalizeResponses } from "../lib/scan/ridge";
import { detectVessels, sigmasFor } from "../lib/scan/frangi";
import { normaliseIllumination } from "../lib/scan/illumination";
import { rectifyPalm } from "../lib/scan/rectify";
import { MASK_SIZE, type Point2 } from "../lib/scan/types";

const SIZE = MASK_SIZE;

/* --------------------------- The class table ------------------------------- */

{
  /* Every class in the vocabulary is either specified or is the explicit catch-all. */
  const specified = new Set(CLASS_SPECS.map((spec) => spec.id));
  for (const id of TRACE_CLASSES) {
    if (id === "minor_unclassified") continue;
    assert.ok(specified.has(id), `${id} has a geometry spec`);
  }
  assert.equal(CLASS_SPECS.length, TRACE_CLASSES.length - 1, "and nothing is specified that is not in the vocabulary");

  /*
   * The order is set by KB evidence, so a trace two classes could claim goes to the one the reading
   * can actually use. Principal lines lead — they are the four with corridors and the most rules —
   * and after them the order must be non-increasing in rule count.
   */
  const minorOrder = TRACE_CLASSES.filter(
    (id) => !["heart", "head", "life", "fate", "minor_unclassified"].includes(id),
  );
  for (let i = 1; i < minorOrder.length; i += 1) {
    assert.ok(
      KB_RULE_COUNT[minorOrder[i - 1]] >= KB_RULE_COUNT[minorOrder[i]],
      `${minorOrder[i - 1]} (${KB_RULE_COUNT[minorOrder[i - 1]]} rules) is tested before ` +
        `${minorOrder[i]} (${KB_RULE_COUNT[minorOrder[i]]})`,
    );
  }

  /*
   * Every class has at least one rule behind it, so none is decoration. This assertion exists
   * because the counts were first taken with the wrong prefix: the girdle and the bracelets live
   * under signs.*, not lines.*, and grepping the latter returns zero for both — which led to the
   * conclusion that the KB knew nothing about them. It knows a little about each.
   */
  for (const id of TRACE_CLASSES) {
    if (id === "minor_unclassified") continue;
    assert.ok(KB_RULE_COUNT[id] > 0, id + " has at least one KB rule behind it");
  }
  assert.equal(KB_RULE_COUNT.girdle_of_venus, 4, "the girdle is graded under signs.girdle_of_venus.*");
  assert.equal(KB_RULE_COUNT.bracelets, 1, "and the bracelets under signs.bracelets.count");
}

/* ------------------- Confusable pairs stay separable ----------------------- */

/** A straight trace between two canonical points, at crop scale. */
function straight(from: Point2, to: Point2, points = 24): Point2[] {
  const out: Point2[] = [];
  for (let i = 0; i < points; i += 1) {
    const t = i / (points - 1);
    out.push({ x: (from.x + (to.x - from.x) * t) * SIZE, y: (from.y + (to.y - from.y) * t) * SIZE });
  }
  return out;
}

{
  /*
   * The pairs that share territory. Each must land on the right class, because these are precisely
   * the cases where a plausible-but-wrong label would go unnoticed.
   */
  const cases: ReadonlyArray<readonly [string, Point2[], TraceClass]> = [
    ["fate (wrist → under Saturn)", straight({ x: 0.5, y: 0.93 }, { x: 0.47, y: 0.3 }), "fate"],
    ["sun (mid palm → Apollo)", straight({ x: 0.62, y: 0.72 }, { x: 0.66, y: 0.23 }), "sun"],
    ["heart (percussion → Jupiter)", straight({ x: 0.9, y: 0.3 }, { x: 0.22, y: 0.22 }), "heart"],
    ["head (thumb web → ulnar)", straight({ x: 0.2, y: 0.32 }, { x: 0.78, y: 0.44 }), "head"],
    ["life (thumb web → wrist)", straight({ x: 0.22, y: 0.26 }, { x: 0.44, y: 0.92 }), "life"],
    ["marriage (short, beside the heart line)", straight({ x: 0.87, y: 0.27 }, { x: 0.96, y: 0.265 }, 8), "marriage"],
    ["travel (life line → Luna, per the KB)", straight({ x: 0.42, y: 0.75 }, { x: 0.76, y: 0.66 }), "travel"],
    ["bracelets (across the wrist)", straight({ x: 0.3, y: 0.95 }, { x: 0.7, y: 0.95 }), "bracelets"],
  ];

  for (const [label, poly, expected] of cases) {
    const match = classifyTrace(poly, SIZE);
    assert.equal(match.id, expected, `${label} classifies as ${expected}, got ${match.id} (${match.score.toFixed(2)})`);
  }

  /* The discriminants, stated as numbers rather than trusted. */
  const fateSpec = CLASS_SPECS.find((s) => s.id === "fate");
  const sunSpec = CLASS_SPECS.find((s) => s.id === "sun");
  assert.ok(fateSpec !== undefined && sunSpec !== undefined);
  assert.ok(
    Math.abs(fateSpec.to.cx - sunSpec.to.cx) > 0.15,
    "fate and sun terminate far enough apart to be told apart at the top of the palm",
  );

  const marriageSpec = CLASS_SPECS.find((s) => s.id === "marriage");
  const travelSpec = CLASS_SPECS.find((s) => s.id === "travel");
  assert.ok(marriageSpec !== undefined && travelSpec !== undefined);
  /* They are no longer neighbours at all: travel is a life-line branch, marriage an edge mark. */
  assert.ok(
    Math.hypot(marriageSpec.from.cx - travelSpec.from.cx, marriageSpec.from.cy - travelSpec.from.cy) > 0.4,
    "marriage and travel start nowhere near each other once travel follows the KB rather than tradition",
  );

  /*
   * health vs sun is separated by the TERMINAL, not by orientation. Orientation nearly did the job
   * while sun was modelled as near-vertical, but the KB puts sun origins on the head and fate lines,
   * which makes a real sun line lean into health's band. Asserting the endpoint gap keeps the test
   * honest about which number is actually doing the work.
   */
  const healthSpec = CLASS_SPECS.find((s) => s.id === "health");
  assert.ok(healthSpec !== undefined);
  const terminalGap = Math.hypot(healthSpec.to.cx - sunSpec.to.cx, healthSpec.to.cy - sunSpec.to.cy);
  assert.ok(
    terminalGap > 0.15,
    `health and sun terminate far enough apart to be told apart (${terminalGap.toFixed(3)})`,
  );
  const orientationGap = Math.abs(healthSpec.verticality - sunSpec.verticality);
  assert.ok(
    orientationGap < healthSpec.verticalityTol,
    "and their orientation bands DO overlap, which is why the endpoint carries the discrimination",
  );
}

/* ----------------- Unclassifiable traces are KEPT, not dropped ------------- */

{
  /* A trace across the middle of nowhere, matching no class's endpoints. */
  const nowhere = straight({ x: 0.45, y: 0.55 }, { x: 0.55, y: 0.6 }, 10);
  const match = classifyTrace(nowhere, SIZE);
  assert.equal(match.id, "minor_unclassified", `an unplaceable trace stays unnamed, got ${match.id}`);

  /* And it is not silently given a near-miss name: every class scored below the floor. */
  for (const spec of CLASS_SPECS) {
    const scored = scoreAgainst(nowhere, spec, SIZE);
    assert.ok(scored.score < MIN_CLASS_SCORE, `${spec.id} does not claim it (${scored.score.toFixed(2)})`);
  }

  /* Principal lines are singular: a second heart-shaped trace cannot also be the heart line. */
  const heart = straight({ x: 0.9, y: 0.3 }, { x: 0.22, y: 0.22 });
  const alsoHeart = straight({ x: 0.88, y: 0.32 }, { x: 0.24, y: 0.24 });
  const assigned = classifyAll([heart, alsoHeart], SIZE);
  const hearts = assigned.filter((m) => m.id === "heart").length;
  assert.equal(hearts, 1, "only one trace may be the heart line");
  assert.equal(assigned.filter((m) => m.id === "minor_unclassified").length, 1, "the loser is kept, unnamed");

  /* Minor classes are NOT exclusive — marriage marks come in twos and threes. */
  const marks = [
    straight({ x: 0.87, y: 0.25 }, { x: 0.96, y: 0.25 }, 8),
    straight({ x: 0.87, y: 0.29 }, { x: 0.96, y: 0.29 }, 8),
  ];
  const both = classifyAll(marks, SIZE);
  assert.equal(both.filter((m) => m.id === "marriage").length, 2, "two marriage marks are both kept as marriage");
}

{
  /* Orientation is measured end to end, so a wiggle does not flip a horizontal line to vertical. */
  const wiggly: Point2[] = [];
  for (let i = 0; i < 30; i += 1) {
    wiggly.push({ x: (i / 29) * SIZE, y: SIZE * 0.3 + Math.sin(i / 2) * SIZE * 0.02 });
  }
  assert.ok(verticalityOf(wiggly) < 0.15, `a wiggly horizontal line still reads horizontal (${verticalityOf(wiggly).toFixed(3)})`);
}

/* ------------------- The faint tier needs stability ------------------------ */

{
  const plane = SIZE * SIZE;
  const field = new Float32Array(plane);

  /* One STRONG line, and one FAINT line at the sun's position. */
  for (let x = 20; x < SIZE - 20; x += 1) {
    const y = Math.round(SIZE * 0.28);
    for (let d = -1; d <= 1; d += 1) field[(y + d) * SIZE + x] = 0.9;
  }
  const faintPixels: number[] = [];
  for (let y = Math.round(SIZE * 0.3); y < Math.round(SIZE * 0.7); y += 1) {
    const x = Math.round(SIZE * 0.64);
    for (let d = -1; d <= 1; d += 1) {
      const at = y * SIZE + x + d;
      field[at] = 0.32; // above FAINT_THRESHOLD, below LINE_THRESHOLD
      faintPixels.push(at);
    }
  }
  assert.ok(0.32 > FAINT_THRESHOLD && 0.32 < LINE_THRESHOLD, "the fixture's faint line is genuinely in the faint band");

  /* No stability information at all: the faint tier is skipped entirely rather than admitted blind. */
  const noStability = extractAllTraces(field, SIZE, null);
  assert.equal(noStability.faintCount, 0, "without a stability record the faint tier contributes nothing");
  assert.ok(noStability.strongCount > 0, "while the strong tier is unaffected");

  /* Stability below the bar: still refused. */
  const young = new Uint16Array(plane);
  for (const at of faintPixels) young[at] = FAINT_STABILITY_FRAMES - 1;
  assert.equal(
    extractAllTraces(field, SIZE, young).faintCount,
    0,
    "a faint trace one frame short of the requirement is refused — noise cannot promote itself",
  );

  /* Stability met: admitted. */
  const settled = new Uint16Array(plane);
  for (const at of faintPixels) settled[at] = FAINT_STABILITY_FRAMES;
  const admitted = extractAllTraces(field, SIZE, settled);
  assert.ok(admitted.faintCount > 0, `a persistent faint trace is admitted (${admitted.faintCount})`);
  assert.equal(admitted.strongCount, noStability.strongCount, "and the strong tier is untouched by it");

  /* Every trace carries a depth, and the faint one is measurably shallower. */
  const strong = admitted.traces.filter((t) => t.tier === "strong");
  const faint = admitted.traces.filter((t) => t.tier === "faint");
  assert.ok(strong.every((t) => t.depth > 0.5), "strong traces report a deep response");
  assert.ok(faint.every((t) => t.depth < 0.5), "faint traces report a shallow one");
  assert.ok(
    Math.min(...strong.map((t) => t.depth)) > Math.max(...faint.map((t) => t.depth)),
    "so the KB can tell a deep line from a faint one, which several of its rules turn on",
  );

  assert.ok(FAINT_THRESHOLD < HIT_THRESHOLD, "the faint tier really is the lower threshold");
}

/* ------------------------ On the real reference frames --------------------- */

const FRAMES: ReadonlyArray<{ readonly file: string; readonly anchors: Point2[] }> = [
  {
    file: "docs/reference/lines-missing-tilt-03.png",
    anchors: [
      { x: 294, y: 543 },
      { x: 212, y: 493 },
      { x: 221, y: 297 },
      { x: 376, y: 355 },
    ],
  },
  {
    file: "docs/reference/lines-current-02.png",
    anchors: [
      { x: 512, y: 530 },
      { x: 377, y: 490 },
      { x: 320, y: 234 },
      { x: 553, y: 235 },
    ],
  },
];

const makeImageData = (w: number, h: number): ImageData =>
  ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4), colorSpace: "srgb" }) as ImageData;

async function main(): Promise<void> {
  for (const frame of FRAMES) {
    if (!existsSync(frame.file)) {
      console.log(`  ${frame.file} not present — skipping`);
      continue;
    }
    const { data, info } = await sharp(frame.file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const source = { width: info.width, height: info.height, data: new Uint8ClampedArray(data) } as ImageData;
    const warped = rectifyPalm(source, frame.anchors, 256, makeImageData);
    assert.ok(warped !== null);

    const plane = SIZE * SIZE;
    const gray = new Float32Array(plane);
    const validity = new Uint8Array(plane);
    for (let y = 0; y < SIZE; y += 1) {
      const a = 2 * y * 256;
      const b = a + 256;
      for (let x = 0; x < SIZE; x += 1) {
        const at = 2 * x;
        const luma = (i: number): number =>
          (0.2126 * warped.image.data[i * 4] +
            0.7152 * warped.image.data[i * 4 + 1] +
            0.0722 * warped.image.data[i * 4 + 2]) /
          255;
        gray[y * SIZE + x] = (luma(a + at) + luma(a + at + 1) + luma(b + at) + luma(b + at + 1)) / 4;
        validity[y * SIZE + x] =
          warped.inside[a + at] & warped.inside[a + at + 1] & warped.inside[b + at] & warped.inside[b + at + 1];
      }
    }
    const normalised = normaliseIllumination(gray, SIZE, new Float32Array(plane), validity);
    const frangi = normalizeResponses(detectVessels(normalised.out, SIZE, sigmasFor(SIZE), new Float32Array(plane)));
    const ridge = detectRidges(gray, SIZE).probability;
    const field = new Float32Array(plane);
    for (let i = 0; i < plane; i += 1) field[i] = Math.max(ridge[i], frangi[i]);

    /* A settled accumulator: every faint pixel has persisted long enough to be eligible. */
    const stability = new Uint16Array(plane);
    for (let i = 0; i < plane; i += 1) {
      if (field[i] >= FAINT_THRESHOLD) stability[i] = FAINT_STABILITY_FRAMES;
    }

    const set = extractAllTraces(field, SIZE, stability);
    const counts = new Map<TraceClass, number>();
    for (const trace of set.traces) counts.set(trace.class, (counts.get(trace.class) ?? 0) + 1);
    const named = [...counts.entries()]
      .filter(([id]) => id !== "minor_unclassified")
      .sort((a, b) => b[1] - a[1])
      .map(([id, n]) => `${id} ${n}`)
      .join(", ");

    console.log(
      `  ${frame.file.split("/").pop()}: ${set.traces.length} traces ` +
        `(strong ${set.strongCount}, faint ${set.faintCount})  ` +
        `named: ${named === "" ? "none" : named}  ` +
        `unclassified ${counts.get("minor_unclassified") ?? 0}`,
    );

    assert.ok(set.traces.length > 0, `${frame.file} yields traces`);
    assert.ok(
      set.traces.every((t) => t.depth >= 0 && t.depth <= 1),
      "every trace reports a depth in range",
    );
  }
}

void main().then(() => console.log("TRACE CLASSIFICATION ASSERTIONS PASSED"));
