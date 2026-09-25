/* ============================================================================
 * R1 — THE STAGE FUNNEL (docs/specs/scan-rescue.txt §3.2)
 *
 * What is asserted:
 *  1. The counts fall through the stages in order, per window, and a window
 *     closes at FUNNEL_WINDOW_MS; the first loss is readable off the line.
 *  2. Per-gate pass/fail counts and the first-failing-gate histogram agree
 *     with the frames fed in; the palm width is summarised.
 *  3. Proposed and held lines are counted per id; held only when confirmed.
 *  4. The hook counts nothing unless asked: every call site is an optional
 *     chain on funnelRef, the funnel is created at start() only under the
 *     option, and the chamber asks only under ?cost=1.
 * ========================================================================== */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { FUNNEL_KEEP_WINDOWS, FUNNEL_WINDOW_MS, StageFunnel, formatFunnel } from "../lib/scan/funnel";
import { ALL_CHECKS } from "../lib/scan/quality";
import type { QualityIssue } from "../lib/scan/types";

let assertions = 0;
const ok = (condition: boolean, message: string): void => {
  assert.ok(condition, message);
  assertions += 1;
};
const ROOT = path.resolve(__dirname, "..");
const read = (...parts: string[]): string => readFileSync(path.join(ROOT, ...parts), "utf8");
const withoutComments = (text: string): string => text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

const passing = (): Record<QualityIssue, boolean> => Object.fromEntries(ALL_CHECKS.map((c) => [c, true])) as Record<QualityIssue, boolean>;
const failing = (...issues: QualityIssue[]): Record<QualityIssue, boolean> => {
  const checks = passing();
  for (const issue of issues) checks[issue] = false;
  return checks;
};

/* ------------------------------ 1. the stages, in order ------------------------------ */

{
  const funnel = new StageFunnel();
  for (let i = 0; i < 30; i += 1) {
    const at = i * 100;
    if (i < 10) funnel.frame(at, { hand: false, palmWidthPx: null, checks: null, issues: ["no_hand"], drawnLines: 0, pose: null, tilt: null });
    else if (i < 20) funnel.frame(at, { hand: true, palmWidthPx: 400, checks: failing("too_far"), issues: ["too_far"], drawnLines: 0, pose: null, tilt: null });
    else funnel.frame(at, { hand: true, palmWidthPx: 520, checks: passing(), issues: [], drawnLines: i >= 25 ? 2 : 0, pose: "TILT_LEFT", tilt: -0.3 });
  }
  funnel.rectified(2100);
  funnel.rectified(2600);
  funnel.extracted(2200, ["heart", "head"], []);
  funnel.extracted(2700, ["heart", "head", "life"], ["heart"]);
  const w = funnel.snapshot(2900).current;
  ok(w.captured === 30 && w.handFound === 20 && w.palmAccepted === 20 && w.gatesPassed === 10, `captured 30 → hand 20 → palm 20 → gates 10 (got ${w.captured}/${w.handFound}/${w.palmAccepted}/${w.gatesPassed})`);
  ok(w.rectified === 2 && w.extractions === 2 && w.drawn === 5, "rectified 2, extractions 2, drawn 5");
  ok(w.gates.too_far.failed === 10 && w.gates.too_far.passed === 10 && w.gates.no_hand.failed === 0, "per-gate counts count hand frames only, pass and fail");
  ok(w.rejections.too_far === 10 && w.rejections.no_hand === 0, "the rejection histogram counts the first failing gate of hand frames — no_hand frames are not hand frames");
  ok(w.proposed.heart === 2 && w.proposed.head === 2 && w.proposed.life === 1 && w.proposed.fate === 0, "proposed lines per id");
  ok(w.held.heart === 1 && w.held.head === 0, "held lines per id — only the confirmed ones");
  ok(w.palmWidthPx !== null && w.palmWidthPx.n === 20 && w.palmWidthPx.min === 400 && w.palmWidthPx.max === 520 && w.palmWidthPx.median === 520, `palm width summarised (${JSON.stringify(w.palmWidthPx)})`);
  const line = formatFunnel(w);
  ok(/captured 30 → hand 20 → palm 20 → gates 10 → rectified 2 → extractions 2 → proposed heart 2 head 2 life 1 → held heart 1 → drawn 5/.test(line), `the readout line reads in order: ${line}`);
  ok(/rejected too_far 10/.test(line) && /palm 520px \(400–520\)/.test(line), "…with the rejections and the palm width");
  ok(w.poses.TILT_LEFT === 10 && w.poses.none === 10 && w.tilt !== null && w.tilt.median === -0.3 && w.tilt.n === 10, `…and the pose and the tilt of each hand frame (${JSON.stringify(w.poses)}, tilt ${JSON.stringify(w.tilt)})`);
  ok(/pose none 10 TILT_LEFT 10 · tilt -0\.3 \(-0\.3…-0\.3\)/.test(line), "…printed after the palm width");
}

/* ------------------------------ 2. windows close on time ------------------------------ */

{
  const funnel = new StageFunnel();
  funnel.frame(0, { hand: true, palmWidthPx: 300, checks: passing(), issues: [], drawnLines: 0, pose: null, tilt: null });
  funnel.frame(FUNNEL_WINDOW_MS - 1, { hand: true, palmWidthPx: 300, checks: passing(), issues: [], drawnLines: 0, pose: null, tilt: null });
  funnel.frame(FUNNEL_WINDOW_MS + 5, { hand: false, palmWidthPx: null, checks: null, issues: ["no_hand"], drawnLines: 0, pose: null, tilt: null });
  const snap = funnel.snapshot(FUNNEL_WINDOW_MS + 10);
  ok(snap.windows.length === 1 && snap.windows[0]!.captured === 2 && snap.windows[0]!.handFound === 2, "the first window closed with its two hand frames");
  ok(snap.current.captured === 1 && snap.current.handFound === 0 && snap.current.startMs === FUNNEL_WINDOW_MS, "the next window opened at the boundary with the frame that crossed it");
  ok(FUNNEL_WINDOW_MS === 10_000, "windows are 10 s, as the spec counts them");
  const empty = new StageFunnel().snapshot();
  ok(empty.windows.length === 0 && empty.current.captured === 0 && formatFunnel(empty.current).includes("captured 0"), "an untouched funnel snapshots as zeros, never throws");
}

/* ------------------------------ 3. the hook does nothing unless asked ------------------------------ */

{
  const hook = withoutComments(read("components", "scan", "use-hand-scan.ts"));
  ok(/funnelRef\.current\?\.rectified\(now\)/.test(hook) && /funnelRef\.current\?\.extracted\(/.test(hook), "rectified and extracted are optional chains on the ref");
  ok(/const funnelNow = funnelRef\.current;\s*if \(funnelNow !== null\) \{/.test(hook), "the frame stage is one null check");
  ok(/if \(funnelWantedRef\.current\) \{\s*const created = new StageFunnel\(\);/.test(hook), "the funnel is created at start() only when the option asks");
  ok(/__hrFunnel = \(\) => created\.snapshot\(performance\.now\(\)\)/.test(hook), "…and published as window.__hrFunnel for the rig");
  ok(/hooks\.__hrObservation = \(\) => \{\s*const o = latestRef\.current\.observation;/.test(hook) && /normal: palmNormal\(o\.world\), winding: palmWinding\(o\.landmarks\)/.test(hook), "…with the last raw observation, the winding and the world normal, as window.__hrObservation — inside the same block, so off unless asked");
  const chamber = withoutComments(read("app", "scan", "chamber", "chamber-client.tsx"));
  ok(/funnel: showCost/.test(chamber), "the chamber asks for it only under ?cost=1");
  ok(/data-snc-funnel=""/.test(chamber) && /formatFunnel\(funnel\.windows\.at\(-1\) \?\? funnel\.current\)/.test(chamber), "…and prints the last closed window in the readout");
  const funnelSource = withoutComments(read("lib", "scan", "funnel.ts"));
  ok(!/from "\.\/(ridge|frangi|fusion|stack|completion|lines|classify|rectify)"/.test(funnelSource), "the funnel imports nothing from the frozen core");
}

/* ------------------------------ 4. what a frame costs when it IS on ------------------------------ */

{
  /* The rig reads the funnel under ?cost=1 on a phone; its per-frame cost has to be far below the
     readout's own 1 ms budget. Ten thousand hand frames through every gate, timed. */
  const funnel = new StageFunnel();
  const checks = failing("unsteady");
  const started = performance.now();
  for (let i = 0; i < 10_000; i += 1) funnel.frame(i * 16.7, { hand: true, palmWidthPx: 500 + (i % 7), checks, issues: ["unsteady"], drawnLines: 1, pose: "FLAT", tilt: 0.01 });
  const perFrameUs = ((performance.now() - started) / 10_000) * 1000;
  ok(perFrameUs < 20, `a hand frame costs the funnel ${perFrameUs.toFixed(2)} µs — under 20 µs, two hundredths of the readout's budget`);
  ok(funnel.snapshot().windows.length === FUNNEL_KEEP_WINDOWS, `and it keeps only the last ${FUNNEL_KEEP_WINDOWS} windows however long the scan runs`);
}

console.log(`SCAN FUNNEL ASSERTIONS PASSED (${assertions})`);
