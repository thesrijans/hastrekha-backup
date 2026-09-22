/* ============================================================================
 * S2 — TRACE, DON'T FIT
 *
 *   1. the flag ships off; the chamber alone switches it on
 *   2. the valley: black-hat depth finds a dark crease; the square multi-radius
 *      max IS the largest radius; the local normalisation divides out contrast
 *   3. the tracer on a known crease: follows it from its observed fragment,
 *      extends to where it fades and stops there, refuses a sideways join onto
 *      a parallel crease, never leaves the palm
 *   4. the drawn geometry: traced lines carry observed/extension segments;
 *      the hook draws, holds and hands off the TRACED path and keeps the fit
 *      for features; canvas and Monitor draw extension at 0.6
 * ========================================================================== */
import assert from "node:assert/strict";
import Module, { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createElement, type ReactElement } from "react";
import { renderToString } from "react-dom/server";
import { CHAMBER_SCAN_FLAGS, DEFAULT_SCAN_FLAGS, SCAN_FLAG_LABELS, SCAN_FLAG_NAMES } from "../lib/scan/flags";
import {
  CANONICAL_PALM,
  STOP_COST,
  TRACE_BLACKHAT_RADII,
  ValleyTracer,
  lineCost,
  palmMask,
  rasterPolygon,
  tracedToLine,
  valleyDepth,
} from "../lib/scan/trace-valley";
import type { LineExtraction } from "../lib/scan/lines";
import type { RekhaSnapshot } from "../lib/scan/rekha-persist";

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

const N = 256;

/** The heart corridor's own path, bent slightly: y(x) in 256 px. Its crease is drawn between x0 and x1. */
const creaseY = (x: number): number => 70 - ((x - 56) / (230 - 56)) * 14 + 5 * Math.sin((x - 56) / 40);

/** Skin at 0.7, a dark crease ~3 px wide and 0.18 deep along creaseY between x0 and x1, plus a second crease `offset` below if asked. */
function palm(x0: number, x1: number, second?: { x0: number; x1: number; offset: number }): Float32Array {
  const luma = new Float32Array(N * N).fill(0.7);
  const stamp = (from: number, to: number, dy: number): void => {
    for (let x = from; x <= to; x += 1) {
      const cy = creaseY(x) + dy;
      for (let y = Math.floor(cy - 3); y <= Math.ceil(cy + 3); y += 1) {
        const d = Math.abs(y - cy);
        if (y >= 0 && y < N) luma[y * N + x] = Math.min(luma[y * N + x]!, 0.7 - 0.18 * Math.max(0, 1 - d / 2));
      }
    }
  };
  stamp(x0, x1, 0);
  if (second !== undefined) stamp(second.x0, second.x1, second.offset);
  return luma;
}

/** An extraction whose heart line was found from `fragments` (128 grid). */
function extraction(fragments: { x: number; y: number }[][]): LineExtraction {
  return {
    lines: {},
    polys: [],
    fragments,
    completion: { lines: { heart: {} as never }, reports: {} as never },
    features: {},
    branchPoints: 0,
  } as unknown as LineExtraction;
}

/** A 128-grid fragment along the crease from xa to xb (256 px), offset `dy`. */
function fragment(xa: number, xb: number, dy = 0): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  for (let x = xa; x <= xb; x += 2) out.push({ x: Math.round(x / 2), y: Math.round((creaseY(x) + dy) / 2) });
  return out;
}

const inside = new Uint8Array(N * N).fill(1);

/* ============================ 1. The flag ==================================== */

{
  ok(DEFAULT_SCAN_FLAGS.rekhaTrace === false, "rekhaTrace ships OFF");
  ok(SCAN_FLAG_NAMES.includes("rekhaTrace") && SCAN_FLAG_LABELS.rekhaTrace.length > 0, "it is in the HUD's list with a label");
  ok(CHAMBER_SCAN_FLAGS.includes("rekhaTrace"), "and the chamber turns it on with its other flags");
  ok(!/rekhaTrace|withScanFlags/.test(source("app", "scan", "scan-client.tsx")), "/scan does not");
}

/* ============================ 2. The valley ================================== */

{
  const luma = palm(60, 220);
  const depth = valleyDepth(luma);
  // On a crease pixel the black-hat is exactly how far it sits below the skin around it (0.7 − luma);
  // on skin it is zero.
  const on = Math.round(creaseY(140)) * N + 140;
  const off = Math.round(creaseY(140) + 20) * N + 140;
  ok(
    Math.abs(depth[on]! - (0.7 - luma[on]!)) < 1e-6 && depth[on]! > 0.1 && depth[off]! < 1e-6,
    `black-hat depth is the crease's own depth below the skin (${depth[on]!.toFixed(3)}) and zero on skin`,
  );

  ok(Math.max(...TRACE_BLACKHAT_RADII) === 12, "radii are ridge.ts's [2, 4, 6] scaled to 256");

  const lc = lineCost(depth, "heart");
  const scaled = lineCost(valleyDepth(luma.map((v) => 0.2 + (v - 0.7) * 2.5)), "heart");
  let worst = 0;
  for (let i = 0; i < lc.cost.length; i += 1) if (lc.band[i]) worst = Math.max(worst, Math.abs(lc.cost[i]! - scaled.cost[i]!));
  ok(worst < 1e-3, `the per-line normalisation divides out contrast: 2.5x the contrast, same cost (max diff ${worst.toExponential(1)})`);
  ok(lc.cost[Math.round(creaseY(140)) * N + 140]! < 0.1, "a crease costs near the floor (0.04)");
}

/* ============================ 3. The tracer ================================== */

{
  const tracer = new ValleyTracer();
  // Crease drawn from x 70 to 210; only x 110..170 was observed.
  const luma = palm(70, 210);
  const result = tracer.trace(extraction([fragment(110, 170)]), luma, inside);
  const heart = result.paths.heart;
  ok(heart !== undefined, "a seeded line is traced");
  const pts = heart!.pixels.map((q) => ({ x: q % N, y: (q / N) | 0 }));
  const offCrease = Math.max(...pts.map((p) => Math.abs(p.y - creaseY(p.x))));
  ok(offCrease <= 2, `the whole trace lies on the crease (worst ${offCrease.toFixed(1)} px off it)`);
  const xs = pts.map((p) => p.x);
  ok(Math.min(...xs) <= 76 && Math.max(...xs) >= 204, `it extends past its seed to where the crease really runs (x ${Math.min(...xs)}–${Math.max(...xs)} of 70–210)`);
  ok(Math.min(...xs) >= 62 && Math.max(...xs) <= 218, "and stops where it fades — within a stop window of the crease's ends, not at the corridor's knots");
  ok(heart!.stops.includes("faded"), `the stop is recorded as a fade (${heart!.stops.join("/")})`);
  const kinds = new Set(heart!.kinds);
  ok(kinds.has("observed") && kinds.has("extension"), "observed and extension stretches are both marked");

  const line = tracedToLine(heart!);
  ok(line.traced === true && (line.segments ?? []).some((s) => !s.observed) && (line.segments ?? []).some((s) => s.observed), "as a TracedLine it is marked traced, with observed and extension segments");
  ok((line.segments ?? []).every((s, i, all) => s.to > s.from && (i === 0 || s.from === all[i - 1]!.to)), "segments are half-open and contiguous");
  ok(line.points.every(([x, y]) => x >= 0 && x < 128 && y >= 0 && y < 128), "in the MASK_SIZE grid everything downstream draws in");

  // Two parallel creases, 24 px apart; seeds on the upper one then the lower one further along.
  const twin = palm(60, 150, { x0: 150, x1: 220, offset: 24 });
  const joined = tracer.trace(extraction([fragment(80, 140), fragment(165, 210, 24)]), twin, inside).paths.heart!;
  const jumped = joined.pixels.some((q) => ((q / N) | 0) > creaseY(q % N) + 12);
  ok(!jumped, "a join that would run SIDEWAYS onto a parallel crease is refused: the trace stays on its own crease");

  // The palm: the canonical outline, and nothing traced outside it.
  const palmPx = rasterPolygon(CANONICAL_PALM, N);
  ok(palmPx[128 * N + 128] === 1 && palmPx[128 * N + 10] === 0, "the canonical palm covers the crop's centre and not its radial margin");
  ok(palmMask(inside, N).reduce((a, b) => a + b, 0) < palmPx.reduce((a, b) => a + b, 0), "the trace mask is the palm, eroded");

  ok(STOP_COST > 0.5 && STOP_COST < 1, "STOP_COST is a named constant inside the cost's range");
}

/* ======================= 4. The drawn geometry, live ======================== */

{
  const hook = withoutComments(source("components", "scan", "use-hand-scan.ts"));
  ok(
    /import type \{ ValleyTracer \} from "@\/lib\/scan\/trace-valley";/.test(hook) && /void import\("@\/lib\/scan\/trace-valley"\)/.test(hook),
    "the tracer is fetched when the flag is first seen on — never imported statically, so /scan does not carry it",
  );
  ok(
    /const traced = tracer\.trace\(found, traceModule\.lumaFromRgba\(crop\.rgba, crop\.size\), crop\.inside\);\s*drawn = \{ \.\.\.found, lines: traced\.lines \};/.test(hook),
    "extraction decides which lines exist; the drawn geometry is the trace, on the frame's own crop",
  );
  ok(/rekha\.extracted\(drawn, at\)/.test(hook), "persistence holds the TRACED path");
  ok(/setExtraction\(rekha === null \? drawn : \{ \.\.\.drawn,/.test(hook), "the chamber draws it");
  ok(/onLineFeatures\?\.\(forFeatures, at\)/.test(hook) && /let forFeatures = found;/.test(hook), "the fitted curve is kept for features only");
  ok(/\{ rgba: warped\.image\.data, inside: warped\.inside, size: warped\.image\.width \}/.test(hook), "the per-frame extraction hands the tracer the crop its mask came from");

  const client = withoutComments(source("app", "scan", "chamber", "chamber-client.tsx"));
  ok(/lines: drawnRef\.current \?\? found\.lines,/.test(client), "the pothi hand-off carries the lines the reader was shown");

  const canvas = source("components", "sanctuary", "chamber", "chamber-canvas.tsx");
  ok(/export const TRACED_EXTENSION_ALPHA = 0\.6;/.test(canvas) && /line\.traced === true \? TRACED_EXTENSION_ALPHA : INFERRED_ALPHA/.test(canvas), "the chamber draws traced extension at 0.6");

  const require_ = createRequire(__filename);
  const monitor = require_("../components/sanctuary/chamber/rekha-monitor") as typeof import("../components/sanctuary/chamber/rekha-monitor");
  const snapshot: RekhaSnapshot = {
    lines: {
      heart: {
        id: "heart",
        state: "confirmed",
        points: [[20, 40], [60, 36], [100, 34], [110, 33]],
        progress: 1,
        held: false,
        traced: true,
        segments: [
          { from: 0, to: 2, observed: true },
          { from: 2, to: 4, observed: false },
        ],
      },
    },
    anyConfirmed: true,
    flicker: { heart: 0, head: 0, life: 0, fate: 0 },
    firstConfirmedMs: { heart: 600, head: null, life: null, fate: null },
    frames: 12,
    costMs: 1,
  };
  const markup = renderToString(createElement(monitor.RekhaMonitor as unknown as (p: Record<string, unknown>) => ReactElement, { snapshot })).replace(/<!-- -->/g, "");
  ok(
    /<path(?![^>]*data-snc-extension)[^>]*stroke-opacity="1"/.test(markup) && /<path[^>]*data-snc-extension=""[^>]*stroke-opacity="0.6"/.test(markup),
    "the Monitor draws a traced line's observed stretch at its rung and its extension at 0.6",
  );
  ok(monitor.REKHA_EXTENSION_OPACITY === 0.6, "at the named 0.6");
}

console.log(`TRACE VALLEY ASSERTIONS PASSED (${assertions})`);
