/* ============================================================================
 * THE LITANY — A2 applied to a progress indicator
 *
 * The chamber narrates the scan in seven lines. A progress indicator is the
 * easiest place in a product to lie, because the reader has no way to check it
 * and a timer produces a convincing one for free. Every assertion here is about
 * the two lies specifically available to this component.
 *
 * THE FIRST LIE is a tick a stage did not earn: saying the major lines were
 * traced because enough milliseconds elapsed. Guarded by deriving every status
 * from a pipeline signal, and pinned below by driving states no timer could
 * produce — evidence arriving out of order, evidence never arriving at all.
 *
 * THE SECOND LIE is subtler and is the one A2 is actually about: reporting
 * "इस बार नहीं मिला" for a stage that has not finished looking. Nothing found
 * YET and nothing found AT ALL are the same zero, and telling a reader their
 * hand has no minor lines while the minor-line reader is still running is a
 * verdict delivered before the measurement.
 * ========================================================================== */
import assert from "node:assert/strict";
import {
  CHAMBER_EMPTY_LINE,
  CHAMBER_SIGNALS_IDLE,
  CHAMBER_STAGES,
  CHAMBER_STAGE_IDS,
  chamberComplete,
  chamberCurrentLine,
  chamberLitany,
  raiseChamberSignals,
  type ChamberSignals,
} from "../lib/sanctuary/chamber-stages";

let assertions = 0;
const ok = (condition: boolean, message: string): void => {
  assert.ok(condition, message);
  assertions += 1;
};

const signals = (over: Partial<ChamberSignals> = {}): ChamberSignals => ({ ...CHAMBER_SIGNALS_IDLE, ...over });
const statusOf = (state: ChamberSignals, id: string): string =>
  chamberLitany(state).find((line) => line.stage.id === id)?.status ?? "missing";

/* ------------------------- 1. The seven lines exist ------------------------ */

{
  ok(CHAMBER_STAGES.length === 7, "seven stages, the number the spec prints");
  ok(
    CHAMBER_STAGES.map((s) => s.id).join(",") === CHAMBER_STAGE_IDS.join(","),
    "and the exported id order is the order they are read in — a litany out of order is a different litany",
  );
  for (const stage of CHAMBER_STAGES) {
    ok(/[ऀ-ॿ]/.test(stage.hi), `${stage.id} is written in Devanagari, the language the chamber speaks`);
    ok(stage.en.trim().length > 0, `${stage.id} carries an English line for the accessible name`);
  }
  ok(
    new Set(CHAMBER_STAGES.map((s) => s.hi)).size === 7,
    "no two stages say the same thing: a repeated line reads as the scan having stalled",
  );
  ok(/[ऀ-ॿ]/.test(CHAMBER_EMPTY_LINE), "and the empty line is Devanagari too, not a fallback in English");
}

/* --------------- 2. An idle room claims nothing whatsoever --------------- */

{
  const litany = chamberLitany(CHAMBER_SIGNALS_IDLE);
  ok(
    litany.every((line) => line.status !== "found"),
    "before the camera starts, not one stage is found: an indicator that begins part-complete has told its first lie in its first frame",
  );
  ok(
    litany.filter((line) => line.status === "working").length === 1,
    "exactly one stage is being worked on, and it is the first",
  );
  ok(litany[0].status === "working", "which is preparing the chamber");
  ok(
    litany.every((line) => line.status !== "empty"),
    "and NOTHING is reported empty: nothing has looked yet, so nothing can have failed to find",
  );
  ok(!chamberComplete(CHAMBER_SIGNALS_IDLE), "an idle room is not a finished one");
}

/* ------------------ 3. Status follows evidence, in order ------------------ */

{
  ok(statusOf(signals({ cameraRunning: true }), "chamber") === "found", "the camera running IS the chamber being ready");
  ok(statusOf(signals({ cameraRunning: true }), "hand") === "working", "and the next line is the one now being worked");
  ok(
    statusOf(signals({ cameraRunning: true }), "palm") === "waiting",
    "a stage two places ahead is waiting, not working: only one thing is being done at a time",
  );
  const mapped = signals({ cameraRunning: true, handSeen: true, palmMapped: true });
  ok(statusOf(mapped, "palm") === "found" && statusOf(mapped, "major") === "working", "mapping the palm hands over to the major lines");
}

/* ------- 4. A2: nothing found YET is not the same as nothing found ------- */

{
  const tracing = signals({ cameraRunning: true, handSeen: true, palmMapped: true });
  ok(
    statusOf(tracing, "minor") === "waiting",
    "while the major lines are still being traced, the minor stage is waiting — not empty, though its count is zero",
  );

  /* The pipeline has moved past the minor reader: rules have fired, which cannot
     happen against a bag the line reader has not filled. NOW the zero is a fact. */
  const moved = signals({ cameraRunning: true, handSeen: true, palmMapped: true, majorLines: 3, rulesFired: 12 });
  ok(
    statusOf(moved, "minor") === "empty",
    "once a LATER stage has reported, a minor count of zero is a measurement rather than a wait — and this is the stage whose leaf will be sealed",
  );
  ok(
    statusOf(moved, "major") === "found",
    "and the majors that were found are still found: one empty stage does not retract its neighbours",
  );
  ok(
    chamberLitany(moved).filter((l) => l.status === "found").length === 5,
    "exactly the five stages with evidence are ticked — chamber, hand, palm, majors and patterns — and no sixth has crept in",
  );
}

/* ------------- 5. A hand with no major lines is reported, not hidden ------ */

{
  const nothing = signals({ cameraRunning: true, handSeen: true, palmMapped: true, rulesFired: 4, leafReady: true });
  ok(statusOf(nothing, "major") === "empty", "a scan that finished having traced no major crease says so");
  ok(statusOf(nothing, "minor") === "empty", "and the same for the minors");
  ok(
    chamberComplete(nothing),
    "and it still COMPLETES: a hand whose creases were not readable must reach its reading, where the sealed leaves explain it — refusing to finish would turn a legitimate outcome into a hang",
  );
}

/* ------------------- 6. The one line the overlay shows ------------------- */

{
  ok(
    chamberCurrentLine(CHAMBER_SIGNALS_IDLE).stage.id === "chamber",
    "the single line shown is the one being worked on",
  );
  const nearly = signals({ cameraRunning: true, handSeen: true, palmMapped: true, majorLines: 4, minorTraces: 2, rulesFired: 9 });
  ok(chamberCurrentLine(nearly).stage.id === "leaf", "and it moves to the last stage when everything before it is done");
  const done = signals({ cameraRunning: true, handSeen: true, palmMapped: true, majorLines: 4, minorTraces: 2, rulesFired: 9, leafReady: true });
  ok(
    chamberCurrentLine(done).stage.id === "leaf" && chamberCurrentLine(done).status === "found",
    "with everything satisfied the last line stands as found rather than the function running off the end",
  );
}

/* -------------- 7. Every signal can only ever help, never hurt ------------ */

{
  /* A monotonic scan: each signal arrives and never leaves. The count of ticks
     must never go DOWN, because a stage that un-ticks is the indicator caught
     contradicting itself in front of the reader. */
  const steps: ChamberSignals[] = [
    CHAMBER_SIGNALS_IDLE,
    signals({ cameraRunning: true }),
    signals({ cameraRunning: true, handSeen: true }),
    signals({ cameraRunning: true, handSeen: true, palmMapped: true }),
    signals({ cameraRunning: true, handSeen: true, palmMapped: true, majorLines: 2 }),
    signals({ cameraRunning: true, handSeen: true, palmMapped: true, majorLines: 4, minorTraces: 1 }),
    signals({ cameraRunning: true, handSeen: true, palmMapped: true, majorLines: 4, minorTraces: 1, rulesFired: 20 }),
    signals({ cameraRunning: true, handSeen: true, palmMapped: true, majorLines: 4, minorTraces: 1, rulesFired: 20, leafReady: true }),
  ];
  let previous = -1;
  let monotonic = true;
  for (const step of steps) {
    const found = chamberLitany(step).filter((l) => l.status === "found").length;
    if (found < previous) monotonic = false;
    previous = found;
  }
  ok(monotonic, "across a whole scan the tick count never falls: a stage that un-ticks has contradicted itself in front of the reader");
  ok(previous === 7, "and a complete scan ends with all seven earned");
}

/* ---------- 8. The mark rises with the evidence and never falls ---------- */

/*
 * Section 7 proves the litany is monotonic GIVEN monotonic signals. On a real
 * feed they are not: a frame's named-line count drops to zero when the hand
 * moves, the gate fails, or a tilt puts a crease out of view. Recorded on a
 * real scan before this existed — "आपका पत्र तैयार…" at twenty seconds,
 * "सूक्ष्म रेखाएँ…" at twenty-four, back again at twenty-eight.
 */
{
  const seen = signals({ cameraRunning: true, handSeen: true, palmMapped: true, majorLines: 3, minorTraces: 2 });
  const lost = signals({ cameraRunning: true, handSeen: false, palmMapped: false, majorLines: 0, minorTraces: 0 });
  const held = raiseChamberSignals(seen, lost);

  ok(held.majorLines === 3 && held.minorTraces === 2, "a frame that saw nothing does not un-see what the session already holds");
  ok(held.handSeen && held.palmMapped, "and a hand that left the frame is still a hand this scan has met");
  ok(
    statusOf(held, "major") === "found",
    "so the litany stays where it got to: a scan that appears to undo its own progress is the plainest way to look broken while working perfectly",
  );

  const better = raiseChamberSignals(held, signals({ cameraRunning: true, majorLines: 4 }));
  ok(better.majorLines === 4, "and the mark still RISES — it is a floor, not a freeze");

  ok(
    raiseChamberSignals(held, lost) === held,
    "a frame that adds nothing returns the very same object, so a caller can compare by identity and not re-render on a frame that taught it nothing",
  );

  /* The one signal allowed to fall. */
  const stopped = raiseChamberSignals(held, signals({ cameraRunning: false, majorLines: 3 }));
  ok(
    !stopped.cameraRunning,
    "the camera IS allowed to stop — a permission revoked or a tab backgrounded is real, and a chamber that went on claiming to be ready would be the one lie this module exists to prevent",
  );
  ok(stopped.majorLines === 3, "while everything the scan already learned survives the camera stopping");
}

console.log(`CHAMBER LITANY ASSERTIONS PASSED (${assertions})`);
