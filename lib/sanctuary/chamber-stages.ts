/**
 * The litany — what the chamber says it is doing, and when it is allowed to say it.
 *
 * Seven lines, fixed by §6.3 of the spec, read out as the scan proceeds. The
 * whole of the difficulty is in the word "proceeds": a litany is trivial to
 * write against a timer and a lie to show that way, because the stage a reader
 * is watching would then have nothing to do with the stage the pipeline is in.
 * So every status below is derived from a signal the pipeline actually
 * produced, and this module is pure so that the derivation can be tested
 * against states a camera would take minutes to reach.
 *
 * A2 IS THE WHOLE DESIGN HERE. "No stage ever shows a green tick it did not
 * earn" is easy to satisfy for a stage that succeeded and hard for one that
 * found nothing, because "found nothing" and "has not looked yet" produce the
 * same zero. Telling them apart needs evidence that the pipeline has MOVED ON,
 * which is what {@link chamberLitany} looks for: a stage reads "इस बार नहीं
 * मिला" only when a later stage has already reported something. Until then it
 * is still working, and the reader is told that instead.
 */

/** The seven stages, in the order the spec prints them. */
export const CHAMBER_STAGE_IDS = ["chamber", "hand", "palm", "major", "minor", "patterns", "leaf"] as const;

export type ChamberStageId = (typeof CHAMBER_STAGE_IDS)[number];

/**
 * What a stage is doing.
 *
 * `waiting` and `empty` are deliberately not one state. Both draw no tick, but
 * one is a stage that has not run and the other is a stage that ran and found
 * nothing, and the second is the one that turns into a sealed leaf.
 */
export type ChamberStageStatus = "waiting" | "working" | "found" | "empty";

export interface ChamberStage {
  readonly id: ChamberStageId;
  /** The line as the reader sees it. Devanagari, because the chamber speaks the reader's language. */
  readonly hi: string;
  /** The same line in English, for the label a screen reader is given. */
  readonly en: string;
}

/**
 * The litany, verbatim from §6.3.
 *
 * The ellipses are the single character `…` rather than three periods: three
 * periods in Devanagari-adjacent type set as three separate glyphs with the
 * wrong spacing, and the difference is visible at the size this is read at.
 */
export const CHAMBER_STAGES: readonly ChamberStage[] = [
  { id: "chamber", hi: "कक्ष तैयार हो रहा है…", en: "Preparing the chamber" },
  { id: "hand", hi: "हाथ पहचाना जा रहा है…", en: "Recognising your hand" },
  { id: "palm", hi: "हथेली का नक्शा…", en: "Mapping the palm" },
  { id: "major", hi: "मुख्य रेखाएँ…", en: "Tracing the major lines" },
  { id: "minor", hi: "सूक्ष्म रेखाएँ…", en: "Reading the minor lines" },
  { id: "patterns", hi: "पारंपरिक पाठ से मिलान…", en: "Comparing traditional patterns" },
  { id: "leaf", hi: "आपका पत्र तैयार…", en: "Preparing your leaf" },
];

/** What a stage says when it ran and came back with nothing. Spec §6.3, exactly. */
export const CHAMBER_EMPTY_LINE = "इस बार नहीं मिला";

/**
 * The pipeline state the litany reads, reduced to seven booleans and three counts.
 *
 * Deliberately NOT the hook's return value. This module would then import the
 * scan graph to describe a caption, every test of it would need a camera, and
 * the litany would break whenever the pipeline changed shape for reasons that
 * have nothing to do with what the chamber says. The client does the reading;
 * this does the deciding.
 */
export interface ChamberSignals {
  /** The camera is delivering frames. */
  readonly cameraRunning: boolean;
  /** MediaPipe has landmarks for a hand in this frame. */
  readonly handSeen: boolean;
  /** A rectified palm crop exists, so the hand has been mapped to canonical space. */
  readonly palmMapped: boolean;
  /** How many of the four major creases completion has accepted. */
  readonly majorLines: number;
  /** How many minor traces cleared the emission gate. */
  readonly minorTraces: number;
  /** How many knowledge-base rules have fired against the session bag. */
  readonly rulesFired: number;
  /** The reading came back and the hand-off has been written. */
  readonly leafReady: boolean;
}

export interface ChamberLitanyLine {
  readonly stage: ChamberStage;
  readonly status: ChamberStageStatus;
}

/** The empty room: nothing running, nothing seen. The state the route mounts in. */
export const CHAMBER_SIGNALS_IDLE: ChamberSignals = {
  cameraRunning: false,
  handSeen: false,
  palmMapped: false,
  majorLines: 0,
  minorTraces: 0,
  rulesFired: 0,
  leafReady: false,
};

/**
 * Whether each stage's own evidence has arrived, in stage order.
 *
 * Only `minor` is allowed to be satisfied by zero, and that is not an oversight:
 * a hand can genuinely carry no minor line, and the pipeline's own emission gate
 * exists to say so. Every other stage's zero means it has not happened.
 */
function satisfied(signals: ChamberSignals): readonly boolean[] {
  return [
    signals.cameraRunning,
    signals.handSeen,
    signals.palmMapped,
    signals.majorLines > 0,
    signals.minorTraces > 0,
    signals.rulesFired > 0,
    signals.leafReady,
  ];
}

/**
 * The litany for one moment of the scan.
 *
 * THE RULE, in one sentence: a stage is `found` when its own evidence arrived,
 * `empty` when it did not but a LATER stage's did, `working` when it is the
 * earliest stage still without evidence, and `waiting` after that.
 *
 * The `empty` clause is the A2 one and it is worth being explicit about what it
 * buys. Minor lines are read once, early, and a hand with none produces the same
 * `minorTraces === 0` at second three as at second thirty. Showing "इस बार नहीं
 * मिला" at second three would be a verdict delivered before the measurement;
 * showing it never would leave a stage spinning for the whole scan on a hand
 * that simply has no sun line. Waiting for a later stage to report is the only
 * signal available that separates the two, and it is a real one: the rules
 * engine cannot fire against a bag the line reader has not filled.
 *
 * A stage that is `empty` is exactly the stage whose leaf will be sealed, which
 * is the same fact the pothi will state in its own words a few seconds later.
 */
export function chamberLitany(signals: ChamberSignals): readonly ChamberLitanyLine[] {
  const has = satisfied(signals);
  const lastSatisfied = has.lastIndexOf(true);
  /* The earliest stage still without evidence — the one genuinely being worked on. */
  const working = has.indexOf(false);

  return CHAMBER_STAGES.map((stage, index) => {
    if (has[index]) return { stage, status: "found" as const };
    if (index < lastSatisfied) return { stage, status: "empty" as const };
    if (index === working) return { stage, status: "working" as const };
    return { stage, status: "waiting" as const };
  });
}

/**
 * The single line the chamber shows while the hand is still being read.
 *
 * The overlay has room for one line of ink on one small leaf, not seven rows of
 * a checklist: a checklist is an installer, and this is meant to read as
 * something being done rather than as something being processed. The full
 * litany is still built above, because the reveal beat prints it and because a
 * status that is only ever rendered one row at a time is a status nobody can
 * test.
 */
export function chamberCurrentLine(signals: ChamberSignals): ChamberLitanyLine {
  const litany = chamberLitany(signals);
  const working = litany.find((line) => line.status === "working");
  if (working !== undefined) return working;
  /* Everything is satisfied: the last line is the true one, and it is `leaf`. */
  return litany[litany.length - 1];
}

/**
 * The evidence so far, raised by this frame.
 *
 * WHY THE LITANY NEEDS A HIGH-WATER MARK AT ALL. Every count a caller can hand
 * this module is read from the CURRENT frame — the named lines are whatever the
 * last extraction produced, the minor traces are what the classifier saw in the
 * frame just gone — and both legitimately drop to zero when the hand moves, the
 * gate fails, or a tilt puts a crease out of view. A litany read straight off
 * them walks backwards: recorded on a real feed, "आपका पत्र तैयार…" at twenty
 * seconds, "सूक्ष्म रेखाएँ…" at twenty-four, and back again at twenty-eight. A
 * scan that appears to undo its own progress is the plainest way to look broken
 * while working perfectly.
 *
 * This is not smoothing. The session bag a scan posts is monotonic by
 * construction — evidence accumulates and only ever improves — so a crease seen
 * once IS still evidence a moment later, whatever the newest frame caught. The
 * mark is what the session knows; the frame is only what it just saw.
 *
 * `cameraRunning` IS ALLOWED TO FALL, and it is the only one. A camera can
 * genuinely stop — a permission revoked, a tab backgrounded, a device taken
 * away — and a chamber that went on claiming to be ready would be the one lie
 * this whole module exists to prevent.
 *
 * Returns the SAME object when the frame added nothing, so a caller can compare
 * by identity and re-render only when something was actually learned.
 */
export function raiseChamberSignals(mark: ChamberSignals, frame: ChamberSignals): ChamberSignals {
  const next: ChamberSignals = {
    cameraRunning: frame.cameraRunning,
    handSeen: mark.handSeen || frame.handSeen,
    palmMapped: mark.palmMapped || frame.palmMapped,
    majorLines: Math.max(mark.majorLines, frame.majorLines),
    minorTraces: Math.max(mark.minorTraces, frame.minorTraces),
    rulesFired: Math.max(mark.rulesFired, frame.rulesFired),
    leafReady: mark.leafReady || frame.leafReady,
  };
  const unchanged =
    next.cameraRunning === mark.cameraRunning &&
    next.handSeen === mark.handSeen &&
    next.palmMapped === mark.palmMapped &&
    next.majorLines === mark.majorLines &&
    next.minorTraces === mark.minorTraces &&
    next.rulesFired === mark.rulesFired &&
    next.leafReady === mark.leafReady;
  return unchanged ? mark : next;
}

/**
 * Whether the scan has run far enough that a reader would expect a result.
 *
 * Used only to decide when the reveal beat may begin. It asks for the leaf
 * rather than for every stage, because a hand with no minor lines must still
 * reach its reading — the sealed leaves are how that absence is reported, and
 * refusing to finish would turn a legitimate outcome into a hang.
 */
export function chamberComplete(signals: ChamberSignals): boolean {
  return signals.leafReady;
}
