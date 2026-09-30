/**
 * DETECTION PROGRESS (scan-complete G3): how far each major line's evidence has come toward CONFIRMED, one
 * overall percentage, and — once the scan has spent its budget — the lines this hand does not show clearly.
 *
 * WHAT DRIVES A RING. The line's own accumulator measure, never a clock: `RekhaLine.progress` is the mean
 * log-odds along the line from the CANDIDATE threshold (0) to the CONFIRM threshold (1) — how far its evidence
 * has come toward CONFIRMED (lib/scan/rekha-persist.ts). A line reads 100% only when it IS confirmed (the
 * hold's own rule: at least 60% of its samples at CONFIRMED); until then it stops at
 * {@link LINE_PROGRESS_CEILING}, so the full ring and the ✓ are one event, never two.
 *
 * A HIGH-WATER MARK, PER PALM. Within one palm a ring shows the furthest its line's evidence has reached, as
 * the chamber's litany does (lib/sanctuary/chamber-stages.ts, raiseChamberSignals): a fresh extraction can
 * trace a crease a little differently and measure a little lower, and a ring that walked backwards would read
 * as the scan undoing itself. A confirmed line stays confirmed for the same reason — the hold's hysteresis
 * already keeps flicker to at most one return per line per 20 s (S1.5). But when the evidence ITSELF is reset
 * — the hand gone for HAND_LOSS_RESET_MS, the other hand, an alignment the accumulator had to drop — the rings,
 * the ✓ and the budget all start again: they reported evidence about a palm that is no longer being read.
 *
 * THE BUDGET (G3.2; its numbers set in G4). {@link SCAN_BUDGET_USABLE_MS} of USABLE frames — frames the
 * accumulator actually took evidence from (sharp enough; `RekhaSnapshot.frames` counts them) — not of wall
 * time: a reader finding the distance, or a gate failing, is not time spent reading the palm. But no longer
 * than {@link SCAN_BUDGET_WALL_MS} of wall time from the first usable frame either: whichever runs out first.
 * After it, a line not yet confirmed is marked "इस हाथ पर स्पष्ट नहीं" — absence is a result, not a failure,
 * and the reading seals that chapter saying so (lib/sanctuary/pothi-chapters.ts). The mark stands unless the
 * line is confirmed after all: evidence wins over the clock that gave up on it.
 *
 * BLUR (G4). A palm in view with no usable frame for {@link BLUR_STALL_MS} is told the picture is blurred —
 * {@link blurStalled} — so the rings never sit at 0% in silence.
 *
 * Pure, and outside the frozen core. Only a type comes from the persistence module, which loads lazily.
 */
import type { RekhaSnapshot } from "./rekha-persist";
import { ACTIVE_LINE_IDS, type ActiveLineId } from "./types";

/** The lines the rings are for: the four majors. The minors (सूर्य, बुध, विवाह) join once S3 covers them. */
export const DETECTION_LINE_IDS: readonly ActiveLineId[] = ACTIVE_LINE_IDS;

/**
 * The scan budget (G3.2, set in G4): this much time of usable frames, then a line not yet confirmed is marked
 * unclear — 15 s. G3's 20 s took 57–60 s of wall time on the feeds, where about half the frames are sharp enough.
 */
export const SCAN_BUDGET_USABLE_MS = 15_000;

/**
 * …or this much WALL time from the first usable frame, whichever comes first (G4): a reader whose frames are
 * only now and then sharp is not kept scanning for minutes. It starts at the first usable frame, not at the
 * tap: a hand not yet found, or never sharp, is the blur hint's case, not the budget's.
 */
export const SCAN_BUDGET_WALL_MS = 40_000;

/**
 * A usable frame counts the time since the previous one, up to this. The accumulator takes a frame every
 * 200–400 ms on a phone (the funnel's "rectified" count), so one second is never a real frame gap — it is a
 * pause: the hand away, the gates failing, the tab hidden — and a pause is not scanning time.
 */
export const USABLE_FRAME_GAP_CAP_MS = 1000;

/** An unconfirmed line never shows more than this: 100% IS the ✓. */
export const LINE_PROGRESS_CEILING = 0.99;

/**
 * Lines confirmed in the same update each get their own tick, this far apart: a vibration cancels the one still
 * running, so two ticks at once are felt as one (measured: 3 ticks for 4 confirmations on tight-00, whose heart
 * and head lines confirmed together).
 */
export const LINE_TICK_SPACING_MS = 160;

export type LineDetectionStatus = "gathering" | "confirmed" | "unclear";

export interface LineDetection {
  readonly status: LineDetectionStatus;
  /** 0–1: the furthest the line's evidence has come toward CONFIRMED on this palm; 1 once it is confirmed. */
  readonly progress: number;
}

export interface DetectionState {
  readonly lines: Readonly<Record<ActiveLineId, LineDetection>>;
  /** Milliseconds of usable frames on this palm (see {@link SCAN_BUDGET_USABLE_MS}). */
  readonly usableMs: number;
  /** When this palm's first usable frame arrived — the wall-clock budget runs from it. */
  readonly firstUsableAtMs: number | null;
  /** Which budget ran out, once one has: the usable time or the wall clock. */
  readonly spentBy: "usable" | "wall" | null;
  /** The overall percentage, 0–1: the mean of the rings, a confirmed or an unclear line counting whole — both are results. */
  readonly overall: number;
  /** Every line is a result, confirmed or unclear — the condition G4's "पहचान पूरी" waits for. */
  readonly complete: boolean;
  /** Bookkeeping: the accumulator's frame count last seen, and when its latest usable frame arrived. */
  readonly frames: number;
  readonly lastUsableAtMs: number | null;
}

const GATHERING: LineDetection = { status: "gathering", progress: 0 };

/** No palm read yet: every ring empty, nothing spent. */
export const DETECTION_IDLE: DetectionState = {
  lines: Object.fromEntries(DETECTION_LINE_IDS.map((id) => [id, GATHERING])) as Record<ActiveLineId, LineDetection>,
  usableMs: 0,
  firstUsableAtMs: null,
  spentBy: null,
  overall: 0,
  complete: false,
  frames: 0,
  lastUsableAtMs: null,
};

/**
 * The detection after one snapshot of the evidence (`useHandScan`'s `rekha`, null when there is none).
 * Returns the SAME object when nothing changed, so a caller can compare by identity.
 */
export function nextDetection(state: DetectionState, snapshot: RekhaSnapshot | null, nowMs: number): DetectionState {
  if (snapshot === null) return DETECTION_IDLE;
  /* Fewer frames than last time: the accumulator was reset under us (an alignment dropped, a remap failed). */
  const base = snapshot.frames < state.frames ? DETECTION_IDLE : state;

  let usableMs = base.usableMs;
  let lastUsableAtMs = base.lastUsableAtMs;
  let firstUsableAtMs = base.firstUsableAtMs;
  if (snapshot.frames > base.frames) {
    if (lastUsableAtMs !== null) usableMs += Math.min(USABLE_FRAME_GAP_CAP_MS, Math.max(0, nowMs - lastUsableAtMs));
    lastUsableAtMs = nowMs;
    firstUsableAtMs ??= nowMs;
  }
  /* Whichever budget runs out first (G4): the usable time, or the wall clock since the first usable frame. */
  const spentBy: DetectionState["spentBy"] =
    base.spentBy ?? (usableMs >= SCAN_BUDGET_USABLE_MS ? "usable" : firstUsableAtMs !== null && nowMs - firstUsableAtMs >= SCAN_BUDGET_WALL_MS ? "wall" : null);
  const spent = spentBy !== null;

  let changed =
    base !== state ||
    usableMs !== base.usableMs ||
    lastUsableAtMs !== base.lastUsableAtMs ||
    firstUsableAtMs !== base.firstUsableAtMs ||
    spentBy !== base.spentBy ||
    snapshot.frames !== base.frames;
  const lines = {} as Record<ActiveLineId, LineDetection>;
  for (const id of DETECTION_LINE_IDS) {
    const previous = base.lines[id];
    const line = snapshot.lines[id];
    let next: LineDetection;
    if (line?.state === "confirmed") {
      next = previous.status === "confirmed" ? previous : { status: "confirmed", progress: 1 };
    } else if (previous.status === "confirmed") {
      next = previous;
    } else {
      const measured = line === undefined || !Number.isFinite(line.progress) ? 0 : Math.min(LINE_PROGRESS_CEILING, Math.max(0, line.progress));
      const progress = Math.max(previous.progress, measured);
      const status: LineDetectionStatus = previous.status === "unclear" || spent ? "unclear" : "gathering";
      next = progress === previous.progress && status === previous.status ? previous : { status, progress };
    }
    if (next !== previous) changed = true;
    lines[id] = next;
  }
  if (!changed) return state;

  let sum = 0;
  let resolved = 0;
  for (const id of DETECTION_LINE_IDS) {
    const line = lines[id];
    if (line.status === "gathering") sum += line.progress;
    else {
      sum += 1;
      resolved += 1;
    }
  }
  return {
    lines,
    usableMs,
    firstUsableAtMs,
    spentBy,
    overall: sum / DETECTION_LINE_IDS.length,
    complete: resolved === DETECTION_LINE_IDS.length,
    frames: snapshot.frames,
    lastUsableAtMs,
  };
}

/** The lines confirmed between two states — each earns its ✓ and one haptic tick. */
export function newlyConfirmed(previous: DetectionState, next: DetectionState): readonly ActiveLineId[] {
  return DETECTION_LINE_IDS.filter((id) => next.lines[id].status === "confirmed" && previous.lines[id].status !== "confirmed");
}

/* ----------------------------------- Blur (G4) ----------------------------------- */

/**
 * A palm in view this long with no usable frame is a blurred picture, and the reader is told so (G4): a scan
 * that took no evidence for 3 s is not "working", and a ring at 0% that says nothing is the silence G4 ends.
 */
export const BLUR_STALL_MS = 3000;

/** The litany's words for it, exactly, and the one-tap offer on a camera with a torch. */
export const BLUR_WORDS = { hi: "तस्वीर धुंधली है · हाथ स्थिर रखें, रोशनी बढ़ाएँ", en: "The picture is blurred — hold still, and add light" } as const;
export const TORCH_OFFER = { hi: "रोशनी चालू करें", en: "Turn on the light" } as const;

/**
 * Whether the usable frames have stalled: a palm present (continuously, since `palmSinceMs`), frames being
 * OFFERED to the evidence (the first since `firstOfferAtMs`) and none of them sharp enough for
 * {@link BLUR_STALL_MS} — counted from the latest of the palm's arrival, the first offered frame and the last
 * usable one. A pipeline still warming up offers nothing, and is not a blurred picture (the first G4 capture
 * said "blurred" 3 s into every feed, sharp ones too, before a single frame had been graded).
 */
export function blurStalled(palmSinceMs: number | null, firstOfferAtMs: number | null, lastUsableAtMs: number | null, nowMs: number): boolean {
  if (palmSinceMs === null || firstOfferAtMs === null) return false;
  return nowMs - Math.max(palmSinceMs, firstOfferAtMs, lastUsableAtMs ?? -Infinity) >= BLUR_STALL_MS;
}

/** The lines marked "इस हाथ पर स्पष्ट नहीं". */
export function unclearLines(state: DetectionState): readonly ActiveLineId[] {
  return DETECTION_LINE_IDS.filter((id) => state.lines[id].status === "unclear");
}

/**
 * The feature bag without the given lines' own features (`lines.<id>`): what the chamber posts once it has
 * marked a line unclear, so no rule fires on the weak evidence the chamber itself declined to confirm.
 * Cross-line keys are left: they already take the WEAKEST contributing line's confidence (reading-session.ts).
 */
export function bagWithoutLines<T extends object>(bag: T, ids: readonly string[]): T {
  const lines = (bag as { readonly lines?: unknown }).lines;
  if (ids.length === 0 || typeof lines !== "object" || lines === null) return bag;
  const kept: Record<string, unknown> = { ...(lines as Record<string, unknown>) };
  for (const id of ids) delete kept[id];
  return { ...bag, lines: kept };
}
