/* ============================================================================
 * scan-complete G3 — DETECTION PROGRESS YOU CAN SEE
 *
 * "Per-line progress … 0 → 100% driven by the line's accumulator probability
 * toward CONFIRMED (not a timer), plus one overall percentage. Lines at 100%
 * get their ✓ … A line not found after the scan budget (named constant, ~20 s
 * of usable frames) is marked 'इस हाथ पर स्पष्ट नहीं'." Each clause is checked
 * against lib/scan/detection-progress.ts:
 *  1. idle: four empty rings, nothing spent;
 *  2. a ring IS the accumulator's measure — 100% only when confirmed;
 *  3. a high-water mark within one palm; a confirmed line stays confirmed;
 *  4. a new palm (the evidence reset) starts again;
 *  5. usable time counts only frames the accumulator took, gaps capped;
 *  6. the budget marks the unconfirmed lines unclear — and never on wall time;
 *  7. evidence wins over the clock; the overall % and "complete";
 *  8. the bag the chamber posts leaves an unclear line out;
 *  9. cost.
 * ========================================================================== */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  BLUR_STALL_MS,
  BLUR_WORDS,
  DETECTION_IDLE,
  DETECTION_LINE_IDS,
  LINE_PROGRESS_CEILING,
  SCAN_BUDGET_USABLE_MS,
  SCAN_BUDGET_WALL_MS,
  TORCH_OFFER,
  blurStalled,
  USABLE_FRAME_GAP_CAP_MS,
  bagWithoutLines,
  concludeDetection,
  newlyConfirmed,
  nextDetection,
  unclearLines,
  type DetectionState,
} from "../lib/scan/detection-progress";
import type { RekhaLine, RekhaSnapshot } from "../lib/scan/rekha-persist";
import type { ActiveLineId } from "../lib/scan/types";

let assertions = 0;
const ok = (condition: boolean, message: string): void => {
  assert.ok(condition, message);
  assertions += 1;
};

type LineSpec = Partial<Record<ActiveLineId, { state: RekhaLine["state"]; progress: number }>>;

/** A snapshot with these lines, after this many usable frames. */
function snap(frames: number, spec: LineSpec = {}): RekhaSnapshot {
  const lines: Partial<Record<ActiveLineId, RekhaLine>> = {};
  for (const [id, line] of Object.entries(spec) as [ActiveLineId, { state: RekhaLine["state"]; progress: number }][]) {
    lines[id] = { id, state: line.state, progress: line.progress, points: [[0, 0], [10, 10]], held: false };
  }
  return {
    lines,
    anyConfirmed: Object.values(spec).some((line) => line?.state === "confirmed"),
    flicker: { heart: 0, head: 0, life: 0, fate: 0 },
    firstConfirmedMs: { heart: null, head: null, life: null, fate: null },
    frames,
    costMs: 0,
  };
}

/** Feed `count` usable frames `gapMs` apart from `startMs`, each with the same lines; returns the state and the clock. */
function feed(state: DetectionState, startFrames: number, count: number, startMs: number, gapMs: number, spec: LineSpec = {}) {
  let s = state;
  let t = startMs;
  for (let i = 1; i <= count; i += 1) {
    t += gapMs;
    s = nextDetection(s, snap(startFrames + i, spec), t);
  }
  return { state: s, frames: startFrames + count, nowMs: t };
}

/* ---------------------------------- 1. idle ---------------------------------- */

{
  ok(DETECTION_LINE_IDS.join(",") === "heart,head,life,fate", "the rings are for the four majors (minors join once S3 covers them)");
  ok(DETECTION_LINE_IDS.every((id) => DETECTION_IDLE.lines[id].status === "gathering" && DETECTION_IDLE.lines[id].progress === 0), "idle: four empty rings");
  ok(DETECTION_IDLE.overall === 0 && !DETECTION_IDLE.complete && DETECTION_IDLE.usableMs === 0, "…0%, nothing spent, not complete");
  ok(nextDetection(DETECTION_IDLE, null, 1000) === DETECTION_IDLE, "no evidence at all changes nothing — the same object back");
  ok(SCAN_BUDGET_USABLE_MS === 15_000, "the scan budget is a named constant: 15 s of usable frames (G4's decision, down from G3's 20)");
  ok(SCAN_BUDGET_WALL_MS === 40_000, "…with a hard wall-clock cap, also named: 40 s from the first usable frame");
}

/* ------------------- 2. a ring IS the accumulator's measure ------------------- */

{
  let s = nextDetection(DETECTION_IDLE, snap(1, { heart: { state: "candidate", progress: 0.2 }, head: { state: "tracking", progress: 0.55 } }), 100);
  ok(s.lines.heart.progress === 0.2 && s.lines.head.progress === 0.55, "each ring is its line's confirmation progress — the accumulator's mean log-odds toward CONFIRMED");
  ok(s.lines.life.progress === 0 && s.lines.fate.progress === 0, "a line with no evidence yet sits at 0");
  ok(Math.abs(s.overall - (0.2 + 0.55) / 4) < 1e-12, `one overall percentage: the mean of the four rings (${(s.overall * 100).toFixed(1)}%)`);

  s = nextDetection(s, snap(2, { heart: { state: "tracking", progress: 1 } }), 200);
  ok(s.lines.heart.progress === LINE_PROGRESS_CEILING && s.lines.heart.status === "gathering", `an UNCONFIRMED line stops at ${LINE_PROGRESS_CEILING * 100}%, whatever its mean: 100% is the ✓`);

  const before = s;
  s = nextDetection(s, snap(3, { heart: { state: "confirmed", progress: 0.8 } }), 300);
  ok(s.lines.heart.status === "confirmed" && s.lines.heart.progress === 1, "CONFIRMED is 100%, whatever the mean — the hold's own rule decides it");
  ok(newlyConfirmed(before, s).join() === "heart", "…and it is reported once as newly confirmed (its ✓ and its haptic tick)");
  ok(newlyConfirmed(s, nextDetection(s, snap(4, { heart: { state: "confirmed", progress: 0.9 } }), 400)).length === 0, "…never twice");
}

/* --------------------- 3. a high-water mark, within one palm --------------------- */

{
  let s = nextDetection(DETECTION_IDLE, snap(1, { life: { state: "tracking", progress: 0.7 } }), 100);
  s = nextDetection(s, snap(2, { life: { state: "candidate", progress: 0.3 } }), 200);
  ok(s.lines.life.progress === 0.7, "a lower measure does not lower the ring: a re-trace measuring lower is not the scan undoing itself");
  s = nextDetection(s, snap(3, {}), 300);
  ok(s.lines.life.progress === 0.7, "nor does a frame whose extraction missed the line");
  s = nextDetection(s, snap(4, { life: { state: "confirmed", progress: 1 } }), 400);
  s = nextDetection(s, snap(5, { life: { state: "tracking", progress: 0.4 } }), 500);
  ok(s.lines.life.status === "confirmed" && s.lines.life.progress === 1, "a confirmed line stays confirmed on this palm (the hold's own flicker bar: ≤ 1 per 20 s)");
  const same = nextDetection(s, snap(5, { life: { state: "confirmed", progress: 1 } }), 600);
  ok(same === s, "an extraction that adds nothing (no new usable frame, nothing higher) returns the same object");
}

/* ------------------------ 4. a new palm starts again ------------------------ */

{
  let s = feed(DETECTION_IDLE, 0, 30, 0, 250, { heart: { state: "confirmed", progress: 1 }, head: { state: "tracking", progress: 0.6 } }).state;
  ok(s.lines.heart.status === "confirmed" && s.usableMs > 0, "(a palm with a confirmed heart line and time spent)");
  ok(nextDetection(s, null, 9000) === DETECTION_IDLE, "the evidence gone (hand away past HAND_LOSS_RESET_MS, the other hand): back to idle — rings, ✓ and budget");
  s = nextDetection(s, snap(2, { head: { state: "candidate", progress: 0.1 } }), 9000);
  ok(s.lines.heart.status === "gathering" && s.lines.heart.progress === 0 && s.lines.head.progress === 0.1 && s.usableMs === 0, "fewer frames than before: the accumulator was reset under us, and so is the detection");
}

/* ------------------------------ 5. usable time ------------------------------ */

{
  let s = nextDetection(DETECTION_IDLE, snap(1), 1000);
  ok(s.usableMs === 0 && s.lastUsableAtMs === 1000, "the first usable frame starts the clock");
  s = nextDetection(s, snap(2), 1300);
  ok(s.usableMs === 300, "each usable frame adds the time since the one before (300 ms)");
  s = nextDetection(s, snap(2, { heart: { state: "tracking", progress: 0.5 } }), 1600);
  ok(s.usableMs === 300, "an extraction's snapshot — no new frame taken — adds nothing");
  s = nextDetection(s, snap(3), 9600);
  ok(s.usableMs === 300 + USABLE_FRAME_GAP_CAP_MS, `a pause (8 s with no usable frame: the hand away, the gates failing) counts ${USABLE_FRAME_GAP_CAP_MS} ms at most`);
  s = nextDetection(s, snap(7), 9900);
  ok(s.usableMs === 300 + USABLE_FRAME_GAP_CAP_MS + 300, "several frames folded between two looks count as the time between them, not per frame");
}

/* ------------------- 6. the budget marks unclear — never on wall time ------------------- */

{
  const spec: LineSpec = { heart: { state: "confirmed", progress: 1 }, head: { state: "tracking", progress: 0.62 }, life: { state: "candidate", progress: 0.15 } };
  /* 60 frames 250 ms apart: 14.75 s usable — one frame short. */
  const almost = feed(DETECTION_IDLE, 0, 60, 0, 250, spec);
  ok(almost.state.usableMs === 14_750 && unclearLines(almost.state).length === 0, `14.75 s of usable frames: nothing is marked yet (${almost.state.usableMs} ms)`);
  const spent = nextDetection(almost.state, snap(almost.frames + 1, spec), almost.nowMs + 250);
  ok(spent.usableMs === SCAN_BUDGET_USABLE_MS && spent.spentBy === "usable", "the usable budget reached — and recorded as the one that ran out");
  ok(unclearLines(spent).join() === "head,life,fate", `every line not yet confirmed is marked "इस हाथ पर स्पष्ट नहीं" (${unclearLines(spent).join(", ")})`);
  ok(spent.lines.heart.status === "confirmed", "a confirmed line is untouched");
  ok(spent.lines.head.progress === 0.62, "an unclear line keeps the progress it reached (the readout reports it)");
  ok(spent.complete && spent.overall === 1, "every line a result — confirmed or unclear — is complete, and the overall is 100%: absence is a result");

  /* Wall time with frames the accumulator refused (weight 0: frames never rise above 0) marks nothing. */
  let idle = nextDetection(DETECTION_IDLE, snap(0, spec), 0);
  for (let t = 250; t <= 60_000; t += 250) idle = nextDetection(idle, snap(0, spec), t);
  ok(
    idle.usableMs === 0 && idle.firstUsableAtMs === null && unclearLines(idle).length === 0,
    "60 s of wall time without ONE usable frame marks nothing unclear — the wall clock starts at the first usable frame; before it, it is the blur hint's case",
  );
}

/* ------------------ 6b. the wall-clock cap (G4): whichever runs out first ------------------ */

{
  const spec: LineSpec = { heart: { state: "confirmed", progress: 1 }, fate: { state: "tracking", progress: 0.5 } };
  /* A usable frame every 3 s: each counts 1 s (the gap cap), so usable time crawls — 13 s by 39 s of wall. */
  let s = nextDetection(DETECTION_IDLE, snap(1, spec), 10_000);
  let frames = 1;
  for (let t = 13_000; t <= 49_000; t += 3000) s = nextDetection(s, snap((frames += 1), spec), t);
  ok(s.firstUsableAtMs === 10_000 && s.usableMs === 13_000 && unclearLines(s).length === 0, `39 s after the first usable frame, 13 s usable: nothing marked yet (${s.usableMs} ms)`);
  s = nextDetection(s, snap(frames, spec), 49_999);
  ok(unclearLines(s).length === 0, "…still nothing at 39.999 s");
  s = nextDetection(s, snap(frames, spec), 50_000);
  ok(
    s.spentBy === "wall" && unclearLines(s).join() === "head,life,fate" && s.lines.heart.status === "confirmed" && s.complete,
    "40 s of wall clock from the first usable frame marks the unconfirmed lines — with no new frame needed (a look at the same evidence later)",
  );
  ok(s.usableMs < SCAN_BUDGET_USABLE_MS, `…before the usable budget could (${s.usableMs} of ${SCAN_BUDGET_USABLE_MS} ms): whichever comes first`);
  const reset = nextDetection(s, snap(1, spec), 51_000);
  ok(reset.firstUsableAtMs === 51_000 && reset.spentBy === null && unclearLines(reset).length === 0, "a new palm (the evidence reset) starts both clocks again");
}

/* ---------------------------------- 6c. blur (G4) ---------------------------------- */

{
  ok(BLUR_STALL_MS === 3000, "the blur stall is a named constant: 3 s");
  ok(!blurStalled(null, 500, null, 99_000), "no palm, no blur hint — that is \"bring your palm\", not \"the picture is blurred\"");
  ok(!blurStalled(1000, null, null, 99_000), "a palm in view but no frame yet OFFERED to the evidence — the pipeline warming up — is not a blurred picture (the first G4 capture's false alarm)");
  ok(!blurStalled(1000, 1500, null, 4499) && blurStalled(1000, 1500, null, 4500), "frames offered for 3 s and none sharp enough: blurred — from the first offered frame, not the palm's arrival");
  ok(!blurStalled(1000, 1500, 5000, 7999) && blurStalled(1000, 1500, 5000, 8000), "3 s since the last usable frame: blurred again");
  ok(!blurStalled(10_000, 1500, 2000, 12_999), "a palm that has just arrived gets its 3 s, whatever the last usable frame of an earlier one");
  ok(BLUR_WORDS.hi === "तस्वीर धुंधली है · हाथ स्थिर रखें, रोशनी बढ़ाएँ" && TORCH_OFFER.hi === "रोशनी चालू करें", "the words, exactly as asked");
}

/* ------------------------- 7. evidence wins over the clock ------------------------- */

{
  const spec: LineSpec = { fate: { state: "tracking", progress: 0.4 } };
  const fed = feed(DETECTION_IDLE, 0, 81, 0, 250, spec);
  const { frames, nowMs } = fed;
  let s = fed.state;
  ok(s.lines.fate.status === "unclear", "(the fate line marked unclear)");
  const before = s;
  s = nextDetection(s, snap(frames + 1, { fate: { state: "confirmed", progress: 1 } }), nowMs + 250);
  ok(s.lines.fate.status === "confirmed" && newlyConfirmed(before, s).join() === "fate", "confirmed after all: the mark gives way to the ✓ (and its tick)");
  ok(s.lines.heart.status === "unclear", "…the others stay unclear: the mark is sticky, the budget spent");
  s = nextDetection(s, snap(frames + 2, { fate: { state: "tracking", progress: 0.4 } }), nowMs + 500);
  ok(s.lines.fate.status === "confirmed", "…and a confirmed line does not fall back to unclear");
}

/* --------- 6d. G5: the reader ends the scan early (the shutter, the palm gone) — exactly like the budget --------- */

{
  const spec: LineSpec = { heart: { state: "confirmed", progress: 1 }, head: { state: "confirmed", progress: 1 }, life: { state: "tracking", progress: 0.71 } };
  const mid = feed(DETECTION_IDLE, 0, 20, 0, 250, spec).state;
  ok(!mid.complete && mid.spentBy === null && unclearLines(mid).length === 0, "mid-scan: two held, two still gathering, nothing spent");
  for (const by of ["shutter", "palm-left"] as const) {
    const done = concludeDetection(mid, by);
    ok(unclearLines(done).join() === "life,fate", `${by}: every line still gathering is marked unclear — life (at 71%) and fate (never seen)`);
    ok(done.lines.heart === mid.lines.heart && done.lines.head === mid.lines.head, `${by}: the held lines are untouched`);
    ok(done.lines.life.progress === 0.71 && done.spentBy === by, `${by}: the progress it reached is kept, and what ended the scan is recorded`);
    ok(done.complete && done.overall === 1 && done.usableMs === mid.usableMs, `${by}: every line a result — the same state a budget timeout leaves (and its usable time is what the sealed leaf reports)`);
  }
  const spentAlready = feed(DETECTION_IDLE, 0, 61, 0, 250, spec).state;
  ok(concludeDetection(spentAlready, "shutter") === spentAlready, "already complete (the budget ran out first): nothing to conclude, and the budget keeps its own name");
  const bag = { lines: { heart: { origin: "jupiter" }, head: { quality: 0.8 }, life: { length_norm: 0.4 }, fate: { origin: "wrist" } } };
  ok(
    JSON.stringify(bagWithoutLines(bag, unclearLines(concludeDetection(mid, "shutter")))) === JSON.stringify({ lines: { heart: { origin: "jupiter" }, head: { quality: 0.8 } } }),
    "…so the reading is the HELD lines': an unfinished line's features never reach the rules",
  );
}

/* ------------------------ 8. the bag leaves an unclear line out ------------------------ */

{
  const bag = { hand: { shape: "square" }, lines: { heart: { origin: "jupiter" }, fate: { origin: "wrist" } }, quadrangle: { width: 0.3 } };
  const without = bagWithoutLines(bag, ["fate"]);
  ok(JSON.stringify(without) === JSON.stringify({ hand: { shape: "square" }, lines: { heart: { origin: "jupiter" } }, quadrangle: { width: 0.3 } }), "the unclear line's own features (lines.fate) leave the bag; everything else stays");
  ok(bag.lines.fate !== undefined, "the bag it was given is not mutated");
  ok(bagWithoutLines(bag, []) === bag && bagWithoutLines({ hand: {} }, ["fate"]).hand !== undefined, "no unclear line, or no lines at all: the bag as it was");

  /* G5: the reading is the HELD lines' — a key that describes an unclear line leaves with it. */
  const full = {
    lines: { heart: { present: true }, head: { quality: 0.7 }, head_heart_blended_single: true, quality: { head_end_fork: true, wavy: true, forked_lines_general: true } },
    geometry: { quadrangle_shape: "wide", palm_ratio: 1.1 },
  };
  const noHead = bagWithoutLines(full, ["head"]);
  ok(
    JSON.stringify(noHead) === JSON.stringify({ lines: { heart: { present: true }, quality: { wavy: true, forked_lines_general: true } }, geometry: { palm_ratio: 1.1 } }),
    "head unclear: its own features, the fork at its end, head-and-heart fused, and the head-heart gap all leave; the palm-wide wavy and forked stay",
  );
  ok(full.lines.quality.head_end_fork === true && full.geometry.quadrangle_shape === "wide", "…and the bag it was given is untouched");
  ok(JSON.stringify(bagWithoutLines(full, ["life", "fate"]).lines) === JSON.stringify(full.lines), "life or fate unclear: no cross-line key names them, so only their own features would go");
}

/* ------------------ 10. the chamber wires it (source, as rekha-persist.test does) ------------------ */

{
  const client = readFileSync("app/scan/chamber/chamber-client.tsx", "utf8");
  ok(
    /const next = nextDetection\(previous, snapshot, nowMs\);/.test(client) && /foldDetection\(rekha, performance\.now\(\)\)/.test(client),
    "the chamber folds every accumulator snapshot into the detection (and, since G4, a quarter-second clock folds the same snapshot for the wall cap)",
  );
  ok(
    /newlyConfirmed\(previous, next\)\.forEach\(\(_, index\) => \{[\s\S]*?haptic\("lineConfirmed"\)[\s\S]*?index \* LINE_TICK_SPACING_MS/.test(client),
    "…and EACH line newly confirmed earns its own haptic tick — two confirmed together are two ticks, spaced so neither cancels the other",
  );
  ok(/<RekhaMonitor snapshot=\{rekha\} detection=\{detection\}/.test(client), "the ledger draws the detection");
  ok(/features: bagWithoutLines\(sessionBag\(finalSession\), unclear\)/.test(client), "the reading's bag leaves the unclear lines out");
  ok(/unclear: \{ lines: unclear, afterUsableMs: detection\.usableMs \}/.test(client) && /for \(const id of unclear\) delete shown\[id\]/.test(client), "…and so does the hand-off, which carries them as unclear for the pothi to seal");
}

/* ----------------------------------- 9. cost ----------------------------------- */

{
  const spec: LineSpec = { heart: { state: "confirmed", progress: 1 }, head: { state: "tracking", progress: 0.5 }, life: { state: "candidate", progress: 0.2 } };
  let s = DETECTION_IDLE;
  const runs = 20_000;
  const t0 = performance.now();
  for (let i = 1; i <= runs; i += 1) s = nextDetection(s, snap(i, spec), i * 250);
  const perCallUs = ((performance.now() - t0) / runs) * 1000;
  ok(perCallUs < 20, `one update costs ${perCallUs.toFixed(2)} µs (snapshot built included) — nothing against the chamber's 3 ms`);
}

console.log(`DETECTION PROGRESS ASSERTIONS PASSED (${assertions})`);
