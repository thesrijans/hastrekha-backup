/**
 * What the chamber costs, per frame, measured rather than asserted.
 *
 * The budget is "≤ 3 ms added over the current scan on a mid-range Android"
 * (spec §10). A budget with no instrument behind it is a wish, and the usual way
 * of checking one — open the profiler, look at a flame chart, decide it seems
 * fine — cannot be re-run by anyone else and produces no number to put in a
 * report. So the chamber carries its own instrument and this module is it.
 *
 * WHAT "ADDED" MEANS HERE, precisely. Not one scan pipeline file is edited by
 * the chamber; it mounts the same hook the existing route mounts and draws its
 * own overlays from the state that hook already publishes. The pipeline's cost
 * is therefore unchanged by construction, and everything this route adds is the
 * time inside its own draw calls. That is what is timed below: the ring, the
 * constellation and the labels, each frame, in one span.
 *
 * P95 AND NOT MEAN, and this is the whole reason a mean is not enough. A frame
 * budget is missed by the frames that overrun, and a mean hides them: an overlay
 * that costs 1 ms on nineteen frames and 30 ms on the twentieth has a mean of
 * 2.45 ms and drops a frame every third of a second. The tail is the measurement.
 *
 * Pure and clock-injected, so the tests measure the arithmetic instead of the
 * machine they happen to run on.
 */

/** How many frames the window holds: about four seconds at 60 Hz, long enough for a real tail. */
export const FRAME_COST_WINDOW = 240;

export interface FrameCostSummary {
  /** How many frames are in the window. Below a useful count the percentiles are not reported. */
  readonly count: number;
  readonly p50: number;
  readonly p95: number;
  /** The single worst frame in the window — the one that actually dropped, if any did. */
  readonly worst: number;
  readonly mean: number;
}

/**
 * Fewer samples than this and no summary is offered.
 *
 * A p95 over eight frames is the second-worst of eight, which is a number that
 * looks like a measurement and is not one. Returning null instead is what keeps
 * a readout from stating a tail it has not seen.
 */
export const FRAME_COST_MIN_SAMPLES = 30;

export interface FrameCost {
  /** Record one frame's cost in milliseconds. Non-finite and negative values are refused. */
  record: (ms: number) => void;
  /** Time `draw` and record it. Returns whatever `draw` returned, so it can wrap a real call site. */
  measure: <T>(draw: () => T) => T;
  /** The window's summary, or null while it is still filling. */
  summary: () => FrameCostSummary | null;
  /** Drop every sample — used when the scan restarts, so one session's tail is not another's. */
  reset: () => void;
}

/** Nearest-rank percentile on an already-sorted array. `p` is a fraction in [0, 1]. */
function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return 0;
  const rank = Math.ceil(p * sorted.length);
  const index = Math.min(sorted.length - 1, Math.max(0, rank - 1));
  return sorted[index];
}

/**
 * A fixed window of frame costs.
 *
 * A ring rather than a growing array: this runs for as long as a scan does, and
 * an unbounded array would both leak and let a slow first second keep skewing a
 * percentile a minute later. The window is what is happening now.
 *
 * @param now the clock. Injected so a test can advance it by hand; the chamber
 *   passes `performance.now`, which is the only clock with the resolution a 3 ms
 *   budget needs — `Date.now` is quantised far too coarsely to see it at all.
 */
export function createFrameCost(now: () => number, capacity: number = FRAME_COST_WINDOW): FrameCost {
  const samples: number[] = [];
  let at = 0;

  const record = (ms: number): void => {
    /* A negative or non-finite span is a broken clock, not a fast frame. Recording
       it would drag a percentile down and hide exactly what this exists to catch. */
    if (!Number.isFinite(ms) || ms < 0) return;
    if (samples.length < capacity) {
      samples.push(ms);
      return;
    }
    samples[at] = ms;
    at = (at + 1) % capacity;
  };

  return {
    record,
    measure<T>(draw: () => T): T {
      const started = now();
      try {
        return draw();
      } finally {
        /* `finally`, so a draw that throws still reports the time it burned.
           A frame that threw halfway is the most expensive kind there is. */
        record(now() - started);
      }
    },
    summary(): FrameCostSummary | null {
      if (samples.length < FRAME_COST_MIN_SAMPLES) return null;
      const sorted = [...samples].sort((a, b) => a - b);
      let total = 0;
      for (const value of sorted) total += value;
      return {
        count: sorted.length,
        p50: percentile(sorted, 0.5),
        p95: percentile(sorted, 0.95),
        worst: sorted[sorted.length - 1],
        mean: total / sorted.length,
      };
    },
    reset(): void {
      samples.length = 0;
      at = 0;
    },
  };
}

/** The number the budget is written against. A summary at or under this passes §10. */
export const CHAMBER_FRAME_BUDGET_MS = 3;

/**
 * Whether a summary meets the budget, and it is the P95 that is asked.
 *
 * Judging on the median would pass an overlay that misses a frame every twenty,
 * which is the failure a reader actually sees — a stutter, in the one moment
 * the product is asking them to hold still and pay attention.
 */
export function withinFrameBudget(summary: FrameCostSummary | null): boolean {
  return summary !== null && summary.p95 <= CHAMBER_FRAME_BUDGET_MS;
}

/** One line, for the readout and for a report: `p50 0.41 · p95 1.28 · worst 2.90 ms (240 frames)`. */
export function formatFrameCost(summary: FrameCostSummary | null): string {
  if (summary === null) return "measuring…";
  return `p50 ${summary.p50.toFixed(2)} · p95 ${summary.p95.toFixed(2)} · worst ${summary.worst.toFixed(2)} ms (${summary.count} frames)`;
}
