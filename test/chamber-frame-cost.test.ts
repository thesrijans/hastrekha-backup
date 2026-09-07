/* ============================================================================
 * THE FRAME BUDGET, AND THE INSTRUMENT THAT CHECKS IT
 *
 * §10 gives the chamber ≤ 3 ms of added cost per frame. The instrument is what
 * turns that from a wish into a number, so the instrument itself is what is
 * tested here — with an injected clock, because a measurement harness verified
 * against the machine it runs on measures the machine.
 *
 * The one decision worth defending: the budget is judged on P95, not on the
 * mean. An overlay costing 1 ms on nineteen frames and 30 ms on the twentieth
 * has a mean of 2.45 ms — inside budget — and drops a frame three times a
 * second. Section 4 drives exactly that distribution and requires it to fail.
 * ========================================================================== */
import assert from "node:assert/strict";
import {
  CHAMBER_FRAME_BUDGET_MS,
  FRAME_COST_MIN_SAMPLES,
  FRAME_COST_WINDOW,
  createFrameCost,
  formatFrameCost,
  withinFrameBudget,
} from "../lib/sanctuary/frame-cost";

let assertions = 0;
const ok = (condition: boolean, message: string): void => {
  assert.ok(condition, message);
  assertions += 1;
};

/** A clock the test drives by hand. `tick(ms)` is one frame that cost that much. */
function fakeClock(): { now: () => number; advance: (ms: number) => void } {
  let t = 0;
  return { now: () => t, advance: (ms) => { t += ms; } };
}

/* ---------------- 1. Nothing is reported before it is known ---------------- */

{
  const cost = createFrameCost(() => 0);
  ok(cost.summary() === null, "an empty window reports nothing rather than zero: zero is a measurement, and none has been taken");
  for (let i = 0; i < FRAME_COST_MIN_SAMPLES - 1; i += 1) cost.record(1);
  ok(
    cost.summary() === null,
    `below ${FRAME_COST_MIN_SAMPLES} frames there is still no summary — a p95 over eight samples is the second-worst of eight, which looks like a measurement and is not one`,
  );
  cost.record(1);
  ok(cost.summary() !== null, "and at the threshold it begins reporting");
  ok(formatFrameCost(null) === "measuring…", "the readout says it is still measuring rather than printing an empty number");
}

/* --------------------- 2. The arithmetic is the arithmetic ---------------- */

{
  const cost = createFrameCost(() => 0);
  /* 100 frames: 1 ms each except the last five at 10 ms. p95 sits at the join. */
  for (let i = 0; i < 95; i += 1) cost.record(1);
  for (let i = 0; i < 5; i += 1) cost.record(10);
  const summary = cost.summary();
  ok(summary !== null, "a hundred frames is a window");
  if (summary !== null) {
    ok(summary.count === 100, "every frame offered is counted");
    ok(summary.p50 === 1, "the median is the cheap frame, which is what most frames are");
    ok(summary.p95 === 1, "the 95th of a hundred is still the cheap one: nearest-rank, and the tail starts after it");
    ok(summary.worst === 10, "and the worst frame is reported as itself, never averaged away");
    ok(Math.abs(summary.mean - 1.45) < 1e-9, "the mean is the mean — kept, but not what the budget is judged on");
  }
}

/* ------------------- 3. The window forgets, on purpose ------------------- */

{
  /* A capacity above FRAME_COST_MIN_SAMPLES, so the window can both fill and be
     summarised — a window smaller than the reporting floor never reports at all. */
  const cost = createFrameCost(() => 0, 40);
  for (let i = 0; i < 40; i += 1) cost.record(50);
  for (let i = 0; i < 40; i += 1) cost.record(1);
  const summary = cost.summary();
  ok(summary !== null && summary.count === 40, "the window never grows past its capacity: this runs as long as a scan does");
  ok(
    summary !== null && summary.worst === 1,
    "and a slow first second stops skewing the tail once it has scrolled out — the window is what is happening NOW, not a transcript",
  );
  cost.reset();
  ok(cost.summary() === null, "a reset drops everything, so one scan's tail is never reported as another's");
}

/* ---------- 4. The mean would have passed this; the P95 must not --------- */

{
  const cost = createFrameCost(() => 0);
  /* Nine frames at 1 ms then one at 15 ms, five times over: fifty frames, a
     tenth of them dropped, and a mean of 2.4 ms that sits inside the budget. */
  for (let round = 0; round < 5; round += 1) {
    for (let i = 0; i < 9; i += 1) cost.record(1);
    cost.record(15);
  }
  const summary = cost.summary();
  ok(summary !== null, "fifty frames of a stuttering overlay");
  if (summary !== null) {
    ok(
      summary.mean < CHAMBER_FRAME_BUDGET_MS,
      `its MEAN is ${summary.mean.toFixed(2)} ms — inside the ${CHAMBER_FRAME_BUDGET_MS} ms budget, which is exactly why the mean is not the test`,
    );
    ok(summary.p95 === 15, "its p95 is the dropped frame, because a tenth of the frames drop and a p95 cannot miss a tenth");
    ok(
      !withinFrameBudget(summary),
      "so the budget REFUSES it: a stutter six times a second, in the one moment the product is asking the reader to hold still",
    );
  }
}

/* ------------------- 5. A quiet overlay passes cleanly ------------------- */

{
  const cost = createFrameCost(() => 0);
  for (let i = 0; i < 200; i += 1) cost.record(0.3 + (i % 7) * 0.05);
  ok(withinFrameBudget(cost.summary()), "a steady sub-millisecond overlay is inside budget");
  ok(!withinFrameBudget(null), "and an unmeasured one is not: absence of a number is never a pass");
}

/* -------------------- 6. measure() times the real thing ------------------ */

{
  const clock = fakeClock();
  const cost = createFrameCost(clock.now);
  const returned: number[] = [];
  for (let i = 0; i < FRAME_COST_MIN_SAMPLES; i += 1) {
    returned.push(
      cost.measure(() => {
        clock.advance(2);
        return i;
      }),
    );
  }
  ok(
    returned.every((value, index) => value === index),
    "measure hands back whatever the draw returned, so it can wrap a real call site instead of sitting beside one",
  );
  const summary = cost.summary();
  ok(summary !== null && summary.p95 === 2, "and it records the span the draw actually took");

  /* A frame that throws is the most expensive kind there is; it must still be counted. */
  const thrower = createFrameCost(clock.now);
  let threw = false;
  try {
    thrower.measure(() => {
      clock.advance(9);
      throw new Error("draw failed");
    });
  } catch {
    threw = true;
  }
  for (let i = 0; i < FRAME_COST_MIN_SAMPLES - 1; i += 1) thrower.record(1);
  ok(threw, "the error is not swallowed — a broken draw must still break");
  ok(thrower.summary()?.worst === 9, "and the time it burned before throwing is in the window rather than lost");
}

/* --------------------- 7. A broken clock cannot pass -------------------- */

{
  const cost = createFrameCost(() => 0);
  for (let i = 0; i < FRAME_COST_MIN_SAMPLES; i += 1) cost.record(5);
  cost.record(Number.NaN);
  cost.record(-4);
  cost.record(Number.POSITIVE_INFINITY);
  const summary = cost.summary();
  ok(
    summary !== null && summary.count === FRAME_COST_MIN_SAMPLES,
    "a non-finite or negative span is a broken clock rather than a fast frame, and is refused",
  );
  ok(summary !== null && summary.p50 === 5, "so it cannot drag a percentile down and hide the thing this exists to catch");
  ok(FRAME_COST_WINDOW >= 120, "the default window is at least two seconds of frames: a tail needs somewhere to live");
}

console.log(`CHAMBER FRAME COST ASSERTIONS PASSED (${assertions})`);
