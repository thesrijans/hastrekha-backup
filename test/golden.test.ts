/**
 * The ceiling, pinned — and a proof that the pin bites.
 *
 * Every other suite asserts a *property*: a line is found, a gate refuses, a fraction exceeds a
 * floor. Properties are the right shape for most things and they share one blind spot — they pass
 * just as happily when the pipeline gets quietly worse, as long as it stays above the floor. STEP 14
 * measured that blind spot: with three acceptance gates loosened to values that admit almost
 * anything, the entire suite still went green. Nothing in the repo could tell "the detector
 * improved" from "the bar was lowered".
 *
 * This file closes that. It snapshots the WHOLE feature bag on both committed ground-truth frames,
 * exactly, so any change to what the detector emits has to be looked at and re-baselined on purpose.
 * The snapshot is not a claim that this output is good — §3 of docs/DETECTOR_AUDIT.md is clear that
 * it is not. It is a claim that this output is what today's constants produce, so that tomorrow's
 * change is visible.
 *
 * ## Re-baselining
 *
 * When a change to the detector is intended, regenerate with:
 *
 * ```
 * tsx test/golden-run.ts > /tmp/golden.json     # then split per frame into test/fixtures/golden/
 * ```
 *
 * and put the before/after numbers in the commit message. Re-baselining silently is the one thing
 * this file exists to prevent.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { GOLDEN_FRAMES, loadGroundTruth, runFrame, type GoldenSnapshot } from "./golden-run";

const goldenPath = (name: string): string => `test/fixtures/golden/${name}.json`;

/* ------------------------------ The snapshots ------------------------------ */

async function main(): Promise<void> {
let pinned = 0;

for (const name of GOLDEN_FRAMES) {
  const at = goldenPath(name);
  if (loadGroundTruth(name) === null || !existsSync(at)) {
    console.log(`  ${name}: frame or snapshot absent — skipped`);
    continue;
  }
  const expected = JSON.parse(readFileSync(at, "utf8")) as GoldenSnapshot;
  const actual = await runFrame(name);
  assert.ok(actual !== null, `${name} runs`);

  /*
   * Compared as formatted JSON rather than with deepStrictEqual, because when this fails the useful
   * thing is a readable diff of two documents, not "Values have same structure but are not reference
   * equal" against a wall of nested objects.
   */
  const a = JSON.stringify(actual, null, 2);
  const b = JSON.stringify(expected, null, 2);
  if (a !== b) {
    const aLines = a.split("\n");
    const bLines = b.split("\n");
    const diffs: string[] = [];
    for (let i = 0; i < Math.max(aLines.length, bLines.length) && diffs.length < 12; i += 1) {
      if (aLines[i] !== bLines[i]) diffs.push(`    line ${i + 1}:\n      pinned: ${bLines[i] ?? "—"}\n      now:    ${aLines[i] ?? "—"}`);
    }
    assert.fail(`${name}: the emitted feature bag no longer matches ${at}\n${diffs.join("\n")}`);
  }
  pinned += 1;
  console.log(`  ${name}: ${actual.polylines} polylines, feature bag matches the pin`);
}

/* --------------------- The trap, proved rather than assumed ---------------- */

/**
 * One run of the pipeline with the source temporarily patched, in a CHILD process.
 *
 * A child because the parent has already imported the originals and a fresh module graph is the only
 * way to pick up new constants. The bytes are restored in a `finally` and the restore is verified.
 * Patching a copy of the tree instead would mean rebuilding the `@/` aliases and the whole relative
 * import graph somewhere else — more moving parts than the thing under test.
 */
function runWithPatches(patches: ReadonlyArray<{ file: string; from: string; to: string }>): Record<string, GoldenSnapshot | null> {
  const originals = new Map<string, string>();
  for (const patch of patches) {
    if (!originals.has(patch.file)) originals.set(patch.file, readFileSync(patch.file, "utf8"));
  }
  try {
    for (const patch of patches) {
      const before = readFileSync(patch.file, "utf8");
      assert.ok(
        before.includes(patch.from),
        `the meta-test can still find \`${patch.from}\` in ${patch.file} — update it if the constant moved`,
      );
      writeFileSync(patch.file, before.replace(patch.from, patch.to), "utf8");
    }
    return JSON.parse(
      execFileSync("npx", ["tsx", "test/golden-run.ts"], {
        encoding: "utf8",
        shell: process.platform === "win32",
        maxBuffer: 32 * 1024 * 1024,
      }),
    ) as Record<string, GoldenSnapshot | null>;
  } finally {
    for (const [file, text] of originals) writeFileSync(file, text, "utf8");
  }
}

/** Which committed frames a patched run differs from the pin on. */
function framesChangedBy(patched: Record<string, GoldenSnapshot | null>): string[] {
  const changed: string[] = [];
  for (const name of GOLDEN_FRAMES) {
    if (!existsSync(goldenPath(name))) continue;
    const expected = JSON.parse(readFileSync(goldenPath(name), "utf8")) as GoldenSnapshot;
    const got = patched[name];
    assert.ok(got !== null && got !== undefined, `${name} still runs under the patch`);
    if (JSON.stringify(got) !== JSON.stringify(expected)) changed.push(name);
  }
  return changed;
}

if (pinned > 0) {
  const COMPLETION = "lib/scan/completion.ts";

  /*
   * THE TRAP, FIRED. Lower the tracing threshold and the pinned bags must change — if they do not,
   * this whole file is decoration.
   *
   * LINE_THRESHOLD is the right probe because it is the constant that actually binds here: it moves
   * BOTH frames, and in opposite directions (tilt-03 loses two lines to over-tracing, current-02
   * gains one), which is exactly the "is this better or just looser?" question a property test cannot
   * answer and a snapshot can.
   */
  const loosenedThreshold = runWithPatches([
    { file: "lib/scan/lines.ts", from: "export const LINE_THRESHOLD = 0.45;", to: "export const LINE_THRESHOLD = 0.25;" },
  ]);
  assert.equal(readFileSync("lib/scan/lines.ts", "utf8").includes("LINE_THRESHOLD = 0.45"), true, "reverted");
  const movedByThreshold = framesChangedBy(loosenedThreshold);
  assert.equal(
    movedByThreshold.length,
    GOLDEN_FRAMES.length,
    `loosening LINE_THRESHOLD MUST change every pinned frame (it changed ${movedByThreshold.length})`,
  );
  console.log(`  trap fires: LINE_THRESHOLD 0.45 -> 0.25 changes ${movedByThreshold.join(", ")}`);

  /*
   * AND THE AUDIT'S EXPERIMENT, CORRECTED.
   *
   * STEP 14 loosened ACCEPT_ENERGY, MIN_OBSERVED_FRACTION and CORRIDOR_MIN_INSIDE to 0.05 / 0.02 /
   * 0.15, found the suite still green, and concluded the suite was blind. The suite *was* blind —
   * that is why the snapshots above now exist — but the conclusion drawn from this particular
   * experiment did not follow, because on these two frames those three constants change NOTHING.
   *
   * They are slack, not load-bearing. Every line that is accepted here clears the strict bar
   * comfortably, so lowering the bar admits nobody new; and the one rejection, `fate: no_seeds`, is
   * not theirs to fix — `scoreFragment` gates on four conditions and a fragment let through by
   * CORRIDOR_MIN_INSIDE still has to clear TANGENT_MIN_AGREE, MIN_SEED_LENGTH_FRACTION and
   * MIN_CORRIDOR_SCORE, which it does not.
   *
   * Pinned as an equality rather than deleted, because it is a real property of the current
   * detector and a fragile one: the day one of those three starts binding, this assertion fails and
   * says so, which is more useful than a comment claiming they are unimportant.
   */
  const auditValues = runWithPatches([
    { file: COMPLETION, from: "export const CORRIDOR_MIN_INSIDE = 0.55;", to: "export const CORRIDOR_MIN_INSIDE = 0.15;" },
    { file: COMPLETION, from: "export const ACCEPT_ENERGY = 0.3;", to: "export const ACCEPT_ENERGY = 0.05;" },
    { file: COMPLETION, from: "export const MIN_OBSERVED_FRACTION = 0.35;", to: "export const MIN_OBSERVED_FRACTION = 0.02;" },
  ]);
  const completionNow = readFileSync(COMPLETION, "utf8");
  assert.ok(
    completionNow.includes("ACCEPT_ENERGY = 0.3;") &&
      completionNow.includes("MIN_OBSERVED_FRACTION = 0.35;") &&
      completionNow.includes("CORRIDOR_MIN_INSIDE = 0.55;"),
    "the loosened constants were reverted byte for byte",
  );
  assert.deepEqual(
    framesChangedBy(auditValues),
    [],
    "the audit's three constants are slack on these frames — if this now fails, one of them has " +
      "become load-bearing and DETECTOR_AUDIT.md §3 needs re-measuring, not this assertion relaxing",
  );
  console.log("  audit's three constants (ACCEPT_ENERGY/MIN_OBSERVED_FRACTION/CORRIDOR_MIN_INSIDE): still slack");
}

console.log("GOLDEN CEILING ASSERTIONS PASSED");
}

void main();
