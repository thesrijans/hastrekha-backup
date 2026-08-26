/**
 * Scan telemetry: a count at every stage, so "no lines" always names the stage that lost them.
 *
 * This exists because the pipeline has now gone blank twice for reasons no unit test could see, and
 * both times the debugging started from scratch. Each stage passed its own test; what failed was the
 * *plumbing between* stages — a field attenuated before thresholding, a buffer at one resolution
 * consumed at another. Neither is visible from any single stage, and both are obvious the moment you
 * can see the counts fall off a cliff between two adjacent numbers.
 *
 * The contract is simple enough to read at a glance under pressure: the counters are ordered exactly
 * as the pipeline runs, so **the first zero is the bug**. Everything upstream of it worked.
 *
 * A rolling window rather than a total, because a total cannot distinguish "stopped a minute ago"
 * from "never started", and those want completely different fixes.
 */

/** Stages in pipeline order. The first with a zero count is where frames are being lost. */
export const TELEMETRY_STAGES = [
  "framesSeen",
  "handDetected",
  "rectifyOk",
  "cropsSentToWorker",
  "workerReplies",
  "maskPixelsAboveThreshold",
  "fusionFrames",
  "tracesExtracted",
  "polylinesAfterCompletion",
  "polylinesPassedToOverlay",
  "polylinesDrawn",
] as const;

export type TelemetryStage = (typeof TELEMETRY_STAGES)[number];

/** Window the counts cover. Long enough to survive a throttled stage, short enough to feel live. */
export const TELEMETRY_WINDOW_MS = 5000;

interface Sample {
  readonly atMs: number;
  readonly stage: TelemetryStage;
  readonly count: number;
}

export interface ScanTelemetry {
  /** Ring of recent samples. Reused, never reallocated — this is written from the frame loop. */
  readonly samples: Sample[];
  /** Anchor counts used by the last rectification, for the 4-vs-5 readout. */
  anchorsUsed: number;
  /** Last per-stage totals published, so the HUD renders a stable object between recomputes. */
  totals: Readonly<Record<TelemetryStage, number>>;
  lastPublishedMs: number;
}

const zeroTotals = (): Record<TelemetryStage, number> =>
  Object.fromEntries(TELEMETRY_STAGES.map((stage) => [stage, 0])) as Record<TelemetryStage, number>;

export function emptyTelemetry(): ScanTelemetry {
  return { samples: [], anchorsUsed: 0, totals: zeroTotals(), lastPublishedMs: 0 };
}

/**
 * Records `count` events at `stage`.
 *
 * Mutates in place and returns nothing: this is called several times per frame from the rAF loop,
 * and a version that allocated would be measurably worse than the thing it is measuring.
 */
export function record(telemetry: ScanTelemetry, stage: TelemetryStage, atMs: number, count = 1): void {
  if (count <= 0) return;
  telemetry.samples.push({ atMs, stage, count });
  // Trim from the front while the oldest sample has aged out. Amortised O(1); the window is small.
  let drop = 0;
  while (drop < telemetry.samples.length && atMs - telemetry.samples[drop].atMs > TELEMETRY_WINDOW_MS) {
    drop += 1;
  }
  if (drop > 0) telemetry.samples.splice(0, drop);
}

/** Per-stage totals over the window ending at `nowMs`. */
export function totalsOf(telemetry: ScanTelemetry, nowMs: number): Record<TelemetryStage, number> {
  const totals = zeroTotals();
  for (const sample of telemetry.samples) {
    if (nowMs - sample.atMs > TELEMETRY_WINDOW_MS) continue;
    totals[sample.stage] += sample.count;
  }
  return totals;
}

/**
 * The stage where the pipeline stops, or null when frames reach the screen.
 *
 * "Stops" means the first stage with nothing in it that had something before it — not merely the
 * first zero, because a scan that has not started yet is all zeros and is not broken.
 */
export function firstStall(totals: Readonly<Record<TelemetryStage, number>>): TelemetryStage | null {
  let sawAny = false;
  for (const stage of TELEMETRY_STAGES) {
    if (totals[stage] > 0) {
      sawAny = true;
      continue;
    }
    if (sawAny) return stage;
  }
  return null;
}

/** One line, stages in order, for `console.debug` and the HUD. */
export function formatTelemetry(totals: Readonly<Record<TelemetryStage, number>>): string {
  const body = TELEMETRY_STAGES.map((stage) => `${stage} ${totals[stage]}`).join(" → ");
  const stall = firstStall(totals);
  return stall === null ? body : `${body}    [STALL AT ${stall}]`;
}

/**
 * Recomputes and stores the window totals, at most once per `intervalMs`.
 *
 * @returns true when the totals changed and the caller should publish them. Returning a boolean
 * rather than always publishing is what keeps this off the React render path at frame rate.
 */
export function publish(telemetry: ScanTelemetry, nowMs: number, intervalMs = 1000): boolean {
  if (nowMs - telemetry.lastPublishedMs < intervalMs) return false;
  telemetry.lastPublishedMs = nowMs;
  telemetry.totals = totalsOf(telemetry, nowMs);
  return true;
}
