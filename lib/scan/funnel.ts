/**
 * The STAGE FUNNEL (scan-rescue R1, §3.2): per 10 s window, how many frames reached each stage of
 * the live scan, in pipeline order — so "no rekhas on my phone" names the stage that lost them.
 *
 *   captured → hand found → palm-facing accepted → every gate → rectified → extraction run →
 *   lines proposed (per id) → lines held (per id) → drawn
 *
 * plus, per window, a rejection histogram (the FIRST failing gate of each rejected frame — the
 * hint the reader was shown) and the palm's width in source pixels (the landmarks' extent times the
 * frame's width: what the extractor actually has to work with at this distance and lens).
 *
 * Outside the frozen core, and OFF unless asked for: the hook creates one only under `?cost=1`, and
 * every call site is a single `funnel?.` optional chain, so a scan with the readout off does no work
 * here at all. Where it shows: the chamber's ?cost=1 readout (one line per window) and
 * `window.__hrFunnel` for the phone rig (scripts/phone-rig/rig.mjs).
 *
 * Mutated in place from the frame loop, like lib/scan/telemetry.ts: an allocating version would be
 * measurably worse than what it measures.
 */
import { ALL_CHECKS } from "./quality";
import { ACTIVE_LINE_IDS, type ActiveLineId, type QualityIssue } from "./types";

/** One window of the funnel. */
export const FUNNEL_WINDOW_MS = 10_000;

/** How many closed windows are kept (2 minutes at 10 s). */
export const FUNNEL_KEEP_WINDOWS = 12;

export interface FunnelGate {
  passed: number;
  failed: number;
}

/** A window's counts, in pipeline order. */
export interface FunnelWindow {
  readonly startMs: number;
  endMs: number;
  /** Frames the loop saw with a playing video. */
  captured: number;
  /** …with a hand in them. */
  handFound: number;
  /** …whose palm faced the camera (the `not_palm_up` gate). */
  palmAccepted: number;
  /** …that passed EVERY gate (what a claim may be made from). */
  gatesPassed: number;
  /** Per gate: how many hand frames passed it and how many failed it. */
  readonly gates: Record<QualityIssue, FunnelGate>;
  /** The FIRST failing gate of each rejected hand frame — what the reader was told. */
  readonly rejections: Record<QualityIssue, number>;
  /** Frames a rectified crop was produced from. */
  rectified: number;
  /** Extraction runs (on the fused evidence, at the profile's cadence). */
  extractions: number;
  /** Extractions that proposed the line, per id. */
  readonly proposed: Record<ActiveLineId, number>;
  /** Extractions after which the accumulator HELD the line (state confirmed), per id. */
  readonly held: Record<ActiveLineId, number>;
  /** Frames with at least one line on screen. */
  drawn: number;
  /** The palm's extent in source pixels, one sample per hand frame (sorted at snapshot). */
  readonly palmWidthPx: number[];
  /** Hand frames per guided pose ("FLAT", "TILT_LEFT", …; "done" after the sequence). */
  readonly poses: Record<string, number>;
  /** The display-space palm tilt of each hand frame (the tilt gate's own number; sorted at snapshot). */
  readonly tilt: number[];
}

export interface FunnelSummaryStat {
  readonly n: number;
  readonly min: number;
  readonly median: number;
  readonly max: number;
}

export interface FunnelWindowSummary extends Omit<FunnelWindow, "palmWidthPx" | "tilt"> {
  readonly palmWidthPx: FunnelSummaryStat | null;
  readonly tilt: FunnelSummaryStat | null;
}

export interface FunnelSnapshot {
  readonly windowMs: number;
  /** Closed windows, oldest first, then the one still open. */
  readonly windows: readonly FunnelWindowSummary[];
  readonly current: FunnelWindowSummary;
}

/** What one frame tells the funnel. */
export interface FunnelFrame {
  readonly hand: boolean;
  /** The landmarks' extent in source pixels, or null without a hand. */
  readonly palmWidthPx: number | null;
  /** The gate's per-check verdicts for this frame, or null without a hand. */
  readonly checks: Readonly<Record<QualityIssue, boolean>> | null;
  /** The gate's failing checks in hint order (the first is the hint shown). */
  readonly issues: readonly QualityIssue[];
  /** How many lines the overlay has to draw this frame. */
  readonly drawnLines: number;
  /** The guided pose in force, or null outside the sequence. */
  readonly pose: string | null;
  /** The display-space palm tilt (lib/scan/quality.ts palmTilt), or null without a hand. */
  readonly tilt: number | null;
}

const gateRecord = <T>(make: () => T): Record<QualityIssue, T> =>
  Object.fromEntries(ALL_CHECKS.map((check) => [check, make()])) as Record<QualityIssue, T>;
const lineRecord = (): Record<ActiveLineId, number> =>
  Object.fromEntries(ACTIVE_LINE_IDS.map((id) => [id, 0])) as Record<ActiveLineId, number>;

function openWindow(startMs: number): FunnelWindow {
  return {
    startMs,
    endMs: startMs,
    captured: 0,
    handFound: 0,
    palmAccepted: 0,
    gatesPassed: 0,
    gates: gateRecord(() => ({ passed: 0, failed: 0 })),
    rejections: gateRecord(() => 0),
    rectified: 0,
    extractions: 0,
    proposed: lineRecord(),
    held: lineRecord(),
    drawn: 0,
    palmWidthPx: [],
    poses: {},
    tilt: [],
  };
}

function stat(samples: readonly number[], digits: number): FunnelSummaryStat | null {
  if (samples.length === 0) return null;
  const sorted = [...samples].sort((a, b) => a - b);
  const round = (v: number): number => Number(v.toFixed(digits));
  return { n: sorted.length, min: round(sorted[0]!), median: round(sorted[Math.floor(sorted.length / 2)]!), max: round(sorted[sorted.length - 1]!) };
}

function summarise(window: FunnelWindow): FunnelWindowSummary {
  const { palmWidthPx, tilt, ...rest } = window;
  return { ...rest, palmWidthPx: stat(palmWidthPx, 0), tilt: stat(tilt, 3) };
}

export class StageFunnel {
  private readonly closed: FunnelWindow[] = [];
  private current: FunnelWindow | null = null;

  constructor(private readonly windowMs: number = FUNNEL_WINDOW_MS) {}

  /** The window `at` falls in, opening a new one when the current has run its length. */
  private window(at: number): FunnelWindow {
    if (this.current === null) this.current = openWindow(at);
    while (at - this.current.startMs >= this.windowMs) {
      this.closed.push(this.current);
      if (this.closed.length > FUNNEL_KEEP_WINDOWS) this.closed.shift();
      this.current = openWindow(this.current.startMs + this.windowMs);
    }
    if (at > this.current.endMs) this.current.endMs = at;
    return this.current;
  }

  /** One frame of the loop. */
  frame(at: number, frame: FunnelFrame): void {
    const w = this.window(at);
    w.captured += 1;
    if (frame.drawnLines > 0) w.drawn += 1;
    if (!frame.hand) return;
    w.handFound += 1;
    if (frame.palmWidthPx !== null) w.palmWidthPx.push(frame.palmWidthPx);
    if (frame.tilt !== null) w.tilt.push(frame.tilt);
    const pose = frame.pose ?? "none";
    w.poses[pose] = (w.poses[pose] ?? 0) + 1;
    if (frame.checks !== null) {
      for (const check of ALL_CHECKS) {
        if (frame.checks[check]) w.gates[check].passed += 1;
        else w.gates[check].failed += 1;
      }
      if (frame.checks.not_palm_up) w.palmAccepted += 1;
    }
    if (frame.issues.length === 0) w.gatesPassed += 1;
    else w.rejections[frame.issues[0]!] += 1;
  }

  /** A rectified crop was produced. */
  rectified(at: number): void {
    this.window(at).rectified += 1;
  }

  /** An extraction ran: which lines it proposed, and which the accumulator holds after it. */
  extracted(at: number, proposed: readonly ActiveLineId[], held: readonly ActiveLineId[]): void {
    const w = this.window(at);
    w.extractions += 1;
    for (const id of proposed) w.proposed[id] += 1;
    for (const id of held) w.held[id] += 1;
  }

  snapshot(at?: number): FunnelSnapshot {
    const current = at === undefined ? (this.current ?? openWindow(0)) : this.window(at);
    return { windowMs: this.windowMs, windows: this.closed.map(summarise), current: summarise(current) };
  }
}

/** The readout's line for one window: the counts in order, the first loss named, the palm's width. */
export function formatFunnel(w: FunnelWindowSummary): string {
  const ids = (record: Record<ActiveLineId, number>): string =>
    ACTIVE_LINE_IDS.filter((id) => record[id] > 0)
      .map((id) => `${id} ${record[id]}`)
      .join(" ") || "none";
  const reject = ALL_CHECKS.filter((check) => w.rejections[check] > 0)
    .map((check) => `${check} ${w.rejections[check]}`)
    .join(" ");
  const width = w.palmWidthPx === null ? "–" : `${w.palmWidthPx.median}px (${w.palmWidthPx.min}–${w.palmWidthPx.max})`;
  const poses = Object.entries(w.poses).map(([pose, n]) => `${pose} ${n}`).join(" ") || "none";
  const tilt = w.tilt === null ? "–" : `${w.tilt.median} (${w.tilt.min}…${w.tilt.max})`;
  return (
    `funnel ${Math.round((w.endMs - w.startMs) / 1000)}s: captured ${w.captured} → hand ${w.handFound} → palm ${w.palmAccepted} → gates ${w.gatesPassed}` +
    ` → rectified ${w.rectified} → extractions ${w.extractions} → proposed ${ids(w.proposed)} → held ${ids(w.held)} → drawn ${w.drawn}` +
    ` · rejected ${reject || "none"} · palm ${width} · pose ${poses} · tilt ${tilt}`
  );
}
