/* ============================================================================
 * THE REVEAL BEAT
 *
 * §6.3 writes this one as a score — two sentences, a 1.2 s silence, a 1.6 s
 * silence, a 0.6 s darkening — and closes with the line the whole beat exists
 * to obey: "Mystery comes from silence and darkness, never from jump-scares."
 *
 * A score is testable at the millisecond, which is the only reason it is a pure
 * function rather than a chain of timeouts inside the component. The assertions
 * below are the three ways this beat could break without looking broken: a
 * silence that is not silent, a line that appears and then leaves, and a
 * navigation that fires before the reader has read anything.
 * ========================================================================== */
import assert from "node:assert/strict";
import {
  REVEAL_ARRIVE_AT_MS,
  REVEAL_DARKEN_AT_MS,
  REVEAL_DARK_MS,
  REVEAL_LINES,
  REVEAL_SECOND_AT_MS,
  revealAt,
  revealReduced,
} from "../lib/sanctuary/reveal-beat";

let assertions = 0;
const ok = (condition: boolean, message: string): void => {
  assert.ok(condition, message);
  assertions += 1;
};

/* -------------------------- 1. The spec's timings ------------------------- */

{
  ok(REVEAL_SECOND_AT_MS === 1200, "the second line arrives after the 1.2 s silence the score writes");
  ok(REVEAL_DARKEN_AT_MS - REVEAL_SECOND_AT_MS === 1600, "and the darkening begins after the 1.6 s silence that follows it");
  ok(REVEAL_DARK_MS === 600, "the darkening itself takes 0.6 s");
  ok(REVEAL_ARRIVE_AT_MS === 3400, "so the bundle arrives at 3.4 s, which is the score added up");
  ok(REVEAL_LINES.length === 2, "two sentences, and only two");
  for (const line of REVEAL_LINES) {
    ok(/[ऀ-ॿ]/.test(line.hi), "each is Devanagari, in the reader's own language");
    ok(line.en.trim().length > 0, "and carries an English line for the accessible name");
  }
}

/* ------------------ 2. The silences are genuinely silent ----------------- */

{
  /* Nothing happens between the first line and the second except time. A
     spinner, a shimmer or a progress bar in this window would turn a held
     breath into a wait, which is the exact difference the spec is drawing. */
  const early = revealAt(10);
  const late = revealAt(REVEAL_SECOND_AT_MS - 1);
  ok(early.linesShown === 1 && late.linesShown === 1, "through the whole first silence there is one line on screen and nothing else");
  ok(early.darkness === 0 && late.darkness === 0, "and no darkening has begun");
  ok(early.phase === "first" && late.phase === "first", "the phase does not flicker inside its own silence");

  const second = revealAt(REVEAL_SECOND_AT_MS);
  const beforeDark = revealAt(REVEAL_DARKEN_AT_MS - 1);
  ok(second.linesShown === 2 && beforeDark.linesShown === 2, "then two lines, for the whole of the second silence");
  ok(beforeDark.darkness === 0, "with the room still lit right up to the moment it is not");
}

/* ---------------- 3. A line already read does not un-read --------------- */

{
  let shown = 0;
  let monotonic = true;
  for (let t = 0; t <= REVEAL_ARRIVE_AT_MS + 500; t += 17) {
    const state = revealAt(t);
    if (state.linesShown < shown) monotonic = false;
    shown = state.linesShown;
  }
  ok(monotonic, "across the whole beat the line count never falls: a sentence that appeared and then left would be the jump-scare the spec forbids, in text");
  ok(shown === 2, "and both are still there at the end");
}

/* --------------------- 4. The darkening is a ramp ----------------------- */

{
  ok(revealAt(REVEAL_DARKEN_AT_MS).darkness === 0, "the darkening starts at nothing");
  ok(Math.abs(revealAt(REVEAL_DARKEN_AT_MS + REVEAL_DARK_MS / 2).darkness - 0.5) < 1e-9, "and is linear through its middle");
  ok(revealAt(REVEAL_ARRIVE_AT_MS).darkness === 1, "reaching black exactly when the bundle arrives");
  let rising = true;
  let previous = -1;
  for (let t = REVEAL_DARKEN_AT_MS; t <= REVEAL_ARRIVE_AT_MS; t += 10) {
    const d = revealAt(t).darkness;
    if (d < previous) rising = false;
    previous = d;
  }
  ok(rising, "and never brightens on the way — a fade that steps back is a screen that looks like it has faulted");
}

/* ------------- 5. Nothing arrives before the reader has read ------------ */

{
  ok(!revealAt(0).arrived, "not at the start");
  ok(!revealAt(REVEAL_ARRIVE_AT_MS - 1).arrived, "not one millisecond early");
  ok(revealAt(REVEAL_ARRIVE_AT_MS).arrived, "and exactly on time");
  ok(revealAt(REVEAL_ARRIVE_AT_MS * 4).arrived, "a late frame is still arrived rather than wrapping round to the start");
  ok(!revealAt(Number.NaN).arrived, "and a broken clock does not navigate");
  ok(revealAt(-500).phase === "first", "nor does a negative one run the score backwards");
}

/* ------------- 6. Reduced motion removes movement, not time ------------- */

{
  const early = revealReduced(10);
  ok(early.linesShown === 2, "under reduced motion both sentences are there from the first frame — there is no fade to have missed");
  ok(early.darkness === 0, "and nothing is animating");
  ok(!early.arrived, "but the beat has NOT been skipped");
  ok(
    revealReduced(REVEAL_ARRIVE_AT_MS - 1).arrived === false && revealReduced(REVEAL_ARRIVE_AT_MS).arrived,
    "it still runs its full 3.4 s: the reader has two sentences to read, and reduced motion is a request about movement rather than a request to be hurried",
  );
}

console.log(`CHAMBER REVEAL ASSERTIONS PASSED (${assertions})`);
