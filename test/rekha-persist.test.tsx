/* ============================================================================
 * S1 — REKHA PERSISTENCE + THE MONITOR
 *
 *   1. the flag ships off and the chamber is its only user
 *   2. the extraction field is zero where nothing is known (never p = 0.5)
 *   3. the hold: a CONFIRMED line survives a missed extraction and unusable
 *      frames, is lost only when the pixels under it drop, and a return counts
 *      as one flicker
 *   4. held lines follow the accumulator's shift and a convention remap
 *   5. the frame weight is palm-box sharpness (a blurred frame weighs 0)
 *   6. the live hook: everything flag-gated, extraction reads the field, a
 *      pose commit does not reset the evidence, super-res folds in, not over
 *   7. the monitor: states by rung, names only when confirmed, no reading text
 * ========================================================================== */
import assert from "node:assert/strict";
import Module, { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createElement, type ReactElement } from "react";
import { renderToString } from "react-dom/server";
import { EvidenceAccumulator, PIXEL_CONFIRMED } from "../lib/scan/enhance/evidence";
import { DEFAULT_SCAN_FLAGS, SCAN_FLAG_LABELS, SCAN_FLAG_NAMES } from "../lib/scan/flags";
import {
  REKHA_PERSIST_NULL_LEVEL,
  RekhaLineHold,
  RekhaPersistence,
  evidenceFieldInto,
  measureLine,
  palmBoxVol,
  rekhaFrameWeight,
  type RekhaSnapshot,
} from "../lib/scan/rekha-persist";
import type { LineExtraction } from "../lib/scan/lines";
import type { ActiveLineId, TracedLine } from "../lib/scan/types";

let assertions = 0;
const ok = (condition: boolean, message: string): void => {
  assert.ok(condition, message);
  assertions += 1;
};

const CLASS_NAME_STUB: Record<string, string> = new Proxy({}, { get: (_t, key) => (typeof key === "string" ? key : "") });
interface CjsExtensionHost {
  _extensions: Record<string, (loaded: { exports: unknown }, filename: string) => void>;
}
(Module as unknown as CjsExtensionHost)._extensions[".css"] = (loaded): void => {
  loaded.exports = { __esModule: true, default: CLASS_NAME_STUB };
};

const ROOT = path.resolve(__dirname, "..");
const source = (...parts: string[]): string => readFileSync(path.join(ROOT, ...parts), "utf8");
const withoutComments = (text: string): string => text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

/* ----------------------------------------------------------------------------- */

const SIZE = 32;
const ROW = 16;

/** A frame with a bright horizontal crease on ROW (or none), everything else at the null's floor. */
function frame(withLine: boolean): Float32Array {
  const plane = new Float32Array(SIZE * SIZE).fill(0.05);
  if (withLine) for (let x = 4; x < 28; x += 1) plane[ROW * SIZE + x] = 0.95;
  return plane;
}
const gray = new Float32Array(SIZE * SIZE).fill(0.5);

function traced(id: ActiveLineId, y: number): TracedLine {
  return { id, points: [[4, y], [27, y]], confidence: 1 };
}

function extraction(lines: Partial<Record<ActiveLineId, TracedLine>>): LineExtraction {
  return { lines, polys: [], fragments: [], completion: { lines: {}, reports: {} } as never, features: {}, branchPoints: 0 };
}

/* ============================ 1. The flag ==================================== */

{
  ok(DEFAULT_SCAN_FLAGS.rekhaPersist === false, "rekhaPersist ships OFF");
  ok(SCAN_FLAG_NAMES.includes("rekhaPersist") && SCAN_FLAG_LABELS.rekhaPersist.length > 0, "and is in the HUD's list with a label");
  const flagsDoc = source("lib", "scan", "flags.ts");
  ok(
    /p95 0\.483/.test(flagsDoc) && /p95 0\.576/.test(flagsDoc) && /p95 0\.169/.test(flagsDoc),
    "its JSDoc records the measured noise floor on the two legacy fixtures and the session still",
  );
  ok(REKHA_PERSIST_NULL_LEVEL === 0.22, "the calibrated null is 0.22, the one level that met every S1.5 bar on every seed");
  ok(
    /0\.17\s+seeds 1 and 3/.test(source("lib", "scan", "rekha-persist.ts")),
    "and the sweep that set it is written beside the constant",
  );
  const users = ["app/scan/chamber/chamber-client.tsx", "app/scan/scan-client.tsx"].filter((file) =>
    /CHAMBER_SCAN_FLAGS|withScanFlags/.test(source(file)),
  );
  ok(users.length === 1 && users[0] === "app/scan/chamber/chamber-client.tsx", "the chamber, and ONLY the chamber, switches the S1 flags on");
}

/* ======================= 2. The extraction field ============================ */

{
  const acc = new EvidenceAccumulator(SIZE, { motionEnabled: false, nullLevel: 0.22 });
  const field = new Float32Array(SIZE * SIZE);
  evidenceFieldInto(acc, field);
  ok(field.every((v) => v === 0), "an accumulator with no evidence yields an all-zero field, not the half-lit p = 0.5 of its raw map");
  for (let f = 0; f < 8; f += 1) acc.update(frame(true), gray, 1);
  evidenceFieldInto(acc, field);
  ok((field[ROW * SIZE + 10] ?? 0) > 0.9, `a crease seen for eight frames reads near 1 (${(field[ROW * SIZE + 10] ?? 0).toFixed(3)})`);
  ok((field[4 * SIZE + 10] ?? 1) === 0, "skin below the null reads exactly 0");
  ok(acc.state[ROW * SIZE + 10] === PIXEL_CONFIRMED, "and the crease's pixels are CONFIRMED on the accumulator's own ladder");
}

/* ============================ 3. The hold ================================== */

{
  const rekha = new RekhaPersistence(SIZE, { motionEnabled: false, nullLevel: 0.22 });
  const heart = traced("heart", ROW);
  let snap: RekhaSnapshot = rekha.observe(frame(true), gray, 1, 0);
  snap = rekha.extracted(extraction({ heart }), 0);
  ok(snap.lines.heart !== undefined && snap.lines.heart.state !== "confirmed", `one frame is not enough to confirm (${snap.lines.heart?.state})`);
  for (let f = 1; f <= 8; f += 1) snap = rekha.observe(frame(true), gray, 1, f * 200);
  snap = rekha.extracted(extraction({ heart }), 1600);
  ok(snap.lines.heart?.state === "confirmed" && snap.anyConfirmed, "eight frames of the crease confirm the heart line — and release the corridor search");
  ok(snap.firstConfirmedMs.heart !== null, "its time to first CONFIRMED is recorded");

  snap = rekha.extracted(extraction({}), 1800);
  ok(snap.lines.heart?.state === "confirmed" && snap.lines.heart.held, "an extraction that misses it does not lose it: the line is HELD");

  for (let f = 0; f < 10; f += 1) snap = rekha.observe(frame(false), gray, 0, 2000 + f * 200);
  ok(snap.lines.heart?.state === "confirmed", "ten UNUSABLE frames (weight 0) change nothing — skip, not decay");

  for (let f = 0; f < 3; f += 1) snap = rekha.observe(frame(false), gray, 1, 4000 + f * 200);
  ok(snap.lines.heart?.state === "confirmed", "a short loss — three usable frames without it — does not drop it either");

  for (let f = 0; f < 30; f += 1) snap = rekha.observe(frame(false), gray, 1, 5000 + f * 200);
  ok(snap.lines.heart === undefined, "a sustained absence drops the pixels out of the ladder, and only then is the line lost");
  ok(snap.flicker.heart === 0, "losing it is not yet a flicker");

  for (let f = 0; f < 10; f += 1) snap = rekha.observe(frame(true), gray, 1, 12000 + f * 200);
  snap = rekha.extracted(extraction({ heart }), 14000);
  ok(snap.lines.heart?.state === "confirmed" && snap.flicker.heart === 1, "its return is ONE flicker — the S1.5 count");

  const m = measureLine(rekha.accumulator, heart.points);
  ok(m.confirmed > 0.9 && m.progress > 0.9, `measureLine reads a confirmed crease as confirmed along its length (${m.confirmed.toFixed(2)})`);
}

/* ================= 4. Held lines follow shift and remap ===================== */

{
  const hold = new RekhaLineHold();
  const acc = new EvidenceAccumulator(SIZE, { motionEnabled: false, nullLevel: 0.22 });
  for (let f = 0; f < 8; f += 1) acc.update(frame(true), gray, 1);
  hold.update(acc, extraction({ heart: traced("heart", ROW) }), 0);
  ok(hold.isHeld("heart"), "a confirmed line is held");
  hold.shift(2, -1);
  const shifted = hold.heldMissingFrom(extraction({})).heart;
  ok(shifted?.points[0]?.[0] === 6 && shifted.points[0][1] === ROW - 1, "a translation of the accumulator moves the held polyline with it");
  hold.remap([1, 0, -3, 0, 1, 0, 0, 0, 1]);
  const remapped = hold.heldMissingFrom(extraction({})).heart;
  ok(Math.abs((remapped?.points[0]?.[0] ?? 0) - 9) < 1e-9, "a convention remap (pull x' = x − 3) moves it by the INVERSE, +3 — where the pixels went");

  const moved = new EvidenceAccumulator(SIZE, { motionEnabled: false, nullLevel: 0.22 });
  for (let f = 0; f < 8; f += 1) moved.update(frame(true), gray, 1);
  moved.remap([1, 0, 0, 0, 1, -4, 0, 0, 1]);
  ok(moved.state[(ROW + 4) * SIZE + 10] === PIXEL_CONFIRMED && moved.state[ROW * SIZE + 10] !== PIXEL_CONFIRMED, "the accumulator remaps its evidence through the same pull matrix fusion.ts warps the EMA with");
}

/* ===================== 4b. The coarse-to-fine search ======================== */

{
  const N = 64;
  const textured = (dx: number, dy: number): Float32Array => {
    const g = new Float32Array(N * N);
    for (let y = 0; y < N; y += 1) for (let x = 0; x < N; x += 1) g[y * N + x] = 0.5 + 0.25 * Math.sin((x - dx) * 0.35) * Math.cos((y - dy) * 0.23) + 0.1 * Math.sin((x - dx) * 0.13 + (y - dy) * 0.21);
    return g;
  };
  const plane = new Float32Array(N * N);
  const shiftOf = (pyramid: boolean): [number, number] => {
    const acc = new EvidenceAccumulator(N, { motionPyramid: pyramid, nullLevel: 0.22 });
    acc.update(plane, textured(0, 0), 1);
    acc.update(plane, textured(6, -4), 1);
    return [acc.lastShiftX, acc.lastShiftY];
  };
  // An 18 px texture: the pyramid's documented limit is a period under ~8 px, which aliases on its coarse grid.
  const exhaustive = shiftOf(false);
  const pyramid = shiftOf(true);
  ok(exhaustive[0] === 6 && exhaustive[1] === -4, `the exhaustive search recovers a (6, −4) px shift (${exhaustive.join(", ")})`);
  ok(pyramid[0] === exhaustive[0] && pyramid[1] === exhaustive[1], "and the coarse-to-fine search finds the same shift, at the same ±8 px reach");
  const liveOptions = source("lib", "scan", "rekha-persist.ts");
  ok(/motionPyramid: true/.test(liveOptions) && /motionPyramid: false/.test(source("lib", "scan", "enhance", "evidence.ts")), "the pyramid is the live path's choice; the library default stays exhaustive");
}

/* ========================== 5. The frame weight ============================ */

{
  const W = 200;
  const H = 120;
  const flat = { width: W, height: H, data: new Uint8ClampedArray(W * H * 4).fill(128) } as unknown as ImageData;
  const sharp = { width: W, height: H, data: new Uint8ClampedArray(W * H * 4) } as unknown as ImageData;
  for (let y = 0; y < H; y += 1) for (let x = 0; x < W; x += 1) for (let c = 0; c < 3; c += 1) sharp.data[(y * W + x) * 4 + c] = (x + y) % 2 === 0 ? 40 : 220;
  const box = [{ x: 0.3, y: 0.3 }, { x: 0.7, y: 0.7 }];
  ok(rekhaFrameWeight(flat, box).weight === 0, "a featureless (blurred) frame weighs 0 and is skipped");
  ok(rekhaFrameWeight(sharp, box).weight === 1, "a sharp frame weighs 1");
  ok(palmBoxVol(sharp, []) === 0, "no points, no box, no weight");
}

/* ============================ 6. The live hook ============================== */

{
  const hook = withoutComments(source("components", "scan", "use-hand-scan.ts"));
  ok(
    /if \(scanFlags\.snapshot\(\)\.rekhaPersist && rekhaModule !== null\) \{\s*const rekha = rekhaRef\.current \?\? \(rekhaRef\.current = new rekhaModule\.RekhaPersistence\(MASK_SIZE\)\);/.test(hook) &&
      (hook.match(/new rekhaModule\.RekhaPersistence/g) ?? []).length === 1,
    "the accumulator is constructed in exactly one place, inside the flag check — with the flag off nothing is built",
  );
  ok(
    /import type \{ RekhaPersistence, RekhaSnapshot \} from "@\/lib\/scan\/rekha-persist";/.test(hook) &&
      !/^import \{[^}]*\} from "@\/lib\/scan\/rekha-persist";/m.test(hook) &&
      /void import\("@\/lib\/scan\/rekha-persist"\)/.test(hook),
    "and the module is fetched when the flag is first seen on, never imported statically — /scan's first load does not carry it",
  );
  ok(
    /\{ \.\.\.activeFusion, ema: rekhaRef\.current\.field \}/.test(hook),
    "per-frame extraction reads the accumulator's field when persisting",
  );
  ok(
    /\(persisting \|\| !superResFresh\(at\)\)/.test(hook) && /REKHA_SUPERRES_WEIGHT/.test(hook),
    "a fresh super-resolution fusion is folded INTO the accumulator rather than superseding it",
  );
  ok(
    /corridorSearch && \(rekhaSnap === null \|\| rekhaSnap\.anyConfirmed\)/.test(hook),
    "corridor search waits for the first confirmed major line (and is unchanged with the flag off)",
  );
  const commit = hook.slice(hook.indexOf("fusionRef.current = resetFusion(fusionRef.current);"), hook.indexOf("if (committed.done)"));
  ok(commit.length > 0 && !/rekhaRef\.current\?\.reset|rekhaRef\.current\.reset/.test(commit), "a pose commit resets the EMAs but NOT the evidence — held lines cross poses");
  ok(/conventionRemap\(underPrevious, warped\.toCrop\)/.test(hook), "a convention change remaps the evidence with the EMA's own matrix");
}

/* ============================== 7. The monitor ============================= */

{
  const require_ = createRequire(__filename);
  const monitor = require_("../components/sanctuary/chamber/rekha-monitor") as typeof import("../components/sanctuary/chamber/rekha-monitor");
  const render = (props: Record<string, unknown>): string =>
    renderToString(createElement(monitor.RekhaMonitor as unknown as (p: Record<string, unknown>) => ReactElement, props)).replace(/<!-- -->/g, "");

  const line = (id: ActiveLineId, state: "candidate" | "tracking" | "confirmed", progress: number, y: number) => ({
    id,
    state,
    points: [[20, y], [100, y - 6]] as const,
    progress,
    held: false,
  });
  const snapshot: RekhaSnapshot = {
    lines: { heart: line("heart", "confirmed", 1, 40), life: line("life", "confirmed", 1, 90), head: line("head", "tracking", 0.5, 60) },
    anyConfirmed: true,
    flicker: { heart: 0, head: 0, life: 0, fate: 0 },
    firstConfirmedMs: { heart: 800, head: null, life: 1200, fate: null },
    frames: 30,
    costMs: 1.1,
  };

  ok(monitor.rekhaLedger(snapshot) === "हृदय ✓ · मस्तिष्क … · जीवन ✓ · शनि —", `the ledger reads "${monitor.rekhaLedger(snapshot)}"`);
  const markup = render({ snapshot });
  ok((markup.match(/data-snc-line="/g) ?? []).length === 3, "three lines drawn — the fate line, which has no state, is not drawn at all");
  ok(/data-snc-line="heart"[^>]*data-snc-state="confirmed"[^>]*stroke-width="2"[^>]*stroke-opacity="1"/.test(markup), "CONFIRMED: 2px at 1.0");
  ok(/data-snc-line="head"[^>]*data-snc-state="tracking"[^>]*stroke-width="1.5"[^>]*stroke-opacity="0.675"/.test(markup), "TRACKING: halfway up the ladder at progress 0.5 (1.5px, 0.675)");
  const candidate = monitor.rekhaStroke({ ...line("fate", "candidate", 0.1, 20) });
  ok(candidate.width === 1 && candidate.opacity === 0.35 && !candidate.glow, "CANDIDATE: 1px at 0.35, no glow");
  ok(/class="line confirmed"[^>]*data-snc-line="heart"/.test(markup) && !/class="line confirmed"[^>]*data-snc-line="head"/.test(markup), "the glow belongs to CONFIRMED alone");
  ok((markup.match(/data-snc-leader="/g) ?? []).length === 2 && markup.includes(">हृदय</text>") && markup.includes(">जीवन</text>"), "a Devanagari name on a leader for each CONFIRMED line, and none for the tracking one");
  ok(!/आपकी|आप |your|reading|पाठ|future|भविष्य/i.test(markup.replace(/aria-label="[^"]*"/g, "")), "no reading text anywhere on it — detection only");
  const empty = render({ snapshot: null });
  ok(
    (empty.match(/<span aria-hidden="true">—<\/span>/g) ?? []).length === 4 && !empty.includes("data-snc-line=") && empty.includes('d="M 16.5 0'),
    "before any evidence the ledger marks every line not yet seen, and the plate shows only the hand",
  );
  ok(markup.includes('aria-live="polite"'), "the ledger is announced politely as lines are confirmed");
}

console.log(`REKHA PERSIST ASSERTIONS PASSED (${assertions})`);
