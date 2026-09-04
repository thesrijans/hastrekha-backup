/* ============================================================================
 * FIELD CONTRACT (H9) — the P(crease) plane's algebra and its two numbers
 *
 * The synthetic-palm case uses EXPLICIT synthetic-matched params, never the
 * calibrated defaults: calibration rewrites CONTRACT_DEPTH_DEFAULTS from GT
 * and must not be able to break a test. The defaults get exactly one
 * existence/finiteness assertion and nothing else reads them.
 * ========================================================================== */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  contractFrameInto,
  contractStats,
  CONTRACT_DEPTH_DEFAULTS,
  CONTRACT_UNET_WEIGHT,
} from "../lib/scan/contract";
import { DEFAULT_SCAN_FLAGS } from "../lib/scan/flags";

let assertions = 0;
const ok = (condition: boolean, message: string): void => {
  assert.ok(condition, message);
  assertions += 1;
};

const one = (depth: number, gabor: number, frangi: number, unet: number | null, d0: number, s: number): number => {
  const out = new Float32Array(1);
  contractFrameInto(
    Float32Array.of(depth),
    Float32Array.of(gabor),
    Float32Array.of(frangi),
    unet === null ? null : Float32Array.of(unet),
    { d0, s },
    out,
  );
  return out[0];
};

/* ------------------------------ 1. The algebra ------------------------------ */

{
  // Monotone in depthRaw at fixed shape.
  let previous = -1;
  for (const depth of [0, 0.01, 0.02, 0.03, 0.05, 0.1]) {
    const value = one(depth, 1, 0, null, 0.02, 0.01);
    ok(value > previous, `monotone in depthRaw (depth ${depth} → ${value.toFixed(4)})`);
    previous = value;
  }

  // The shape gate can only REDUCE the depth term.
  const full = one(0.05, 1, 1, null, 0.02, 0.01);
  for (const shape of [0.8, 0.5, 0.2, 0]) {
    ok(one(0.05, shape, 0, null, 0.02, 0.01) <= full, `shape gate ${shape} only reduces`);
  }
  ok(one(0.05, 0, 0, null, 0.02, 0.01) === 0, "zero shape ⇒ zero — the gate is a hard veto");

  // Noisy-OR: never exceeds 1, never applies a floor.
  ok(one(1, 1, 1, 1, 0.02, 0.01) <= 1, "noisy-OR never exceeds 1 even fully saturated");
  const unetOnly = one(0, 0, 0, 1, 0.02, 0.01);
  ok(Math.abs(unetOnly - CONTRACT_UNET_WEIGHT) < 1e-6, "pClassical 0 + unet 1 → exactly the unet weight, no cap");
  ok(one(0, 0, 0, 0, 0.02, 0.01) === 0, "everything empty reads EMPTY — no 0.55 ridge floor survives");
}

/* --------------------------- 2. Synthetic palm --------------------------- */

{
  const S = 128;
  const plane = S * S;
  // Seeded LCG so the "skin texture" is the same on every run.
  let seed = 42;
  const random = (): number => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  const CREASE_DEPTH = 0.05;
  const TEXTURE_DEPTH = 0.008;
  const depthRaw = new Float32Array(plane);
  const gabor = new Float32Array(plane);
  const frangi = new Float32Array(plane);
  for (let i = 0; i < plane; i += 1) {
    depthRaw[i] = random() * TEXTURE_DEPTH;
    gabor[i] = random() * 0.6; // percentile maps light up on texture too — that is the disease
  }
  const centreline = new Uint8Array(plane);
  const background = new Uint8Array(plane);
  for (let x = 10; x < S - 10; x += 1) {
    const y = 40 + Math.round(x * 0.2);
    depthRaw[y * S + x] = CREASE_DEPTH;
    gabor[y * S + x] = 1;
    centreline[y * S + x] = 1;
  }
  for (let y = 8; y < S - 8; y += 1) {
    for (let x = 8; x < S - 8; x += 1) {
      const creaseY = 40 + Math.round(x * 0.2);
      if (Math.abs(y - creaseY) > 6) background[y * S + x] = 1;
    }
  }
  // EXPLICIT synthetic-matched params: d0 between texture and crease depth, s a fifth of the gap.
  const params = { d0: (TEXTURE_DEPTH + CREASE_DEPTH) / 2, s: (CREASE_DEPTH - TEXTURE_DEPTH) / 5 };
  const field = new Float32Array(plane);
  contractFrameInto(depthRaw, gabor, frangi, null, params, field);
  const stats = contractStats(field, S, centreline, background);
  ok(stats.backgroundP99 !== null && stats.backgroundP99 <= 0.15, `background p99 ${stats.backgroundP99?.toFixed(3)} <= 0.15 — texture stays dark despite bright gabor`);
  ok(stats.centrelineMedian !== null && stats.centrelineMedian >= 0.6, `centreline median ${stats.centrelineMedian?.toFixed(3)} >= 0.6`);
  ok(Number.isFinite(stats.mean) && stats.mean > 0, "mean is a real number");
}

/* ------------------------- 3. Calibrated defaults ------------------------- */

// One line, nothing more: calibration rewrites the values and must not break tests.
ok(
  Number.isFinite(CONTRACT_DEPTH_DEFAULTS.d0) && Number.isFinite(CONTRACT_DEPTH_DEFAULTS.s) && CONTRACT_DEPTH_DEFAULTS.d0 > 0 && CONTRACT_DEPTH_DEFAULTS.s > 0,
  "CONTRACT_DEPTH_DEFAULTS exists, finite, positive",
);

/* --------------------------- 4. Worker shape pin --------------------------- */

{
  // Mechanical pin (the boundary-test style): the worker result carries `contract` ONLY through
  // the conditional spread — wantContract false ⇒ the result keys are byte-identical.
  const source = readFileSync("lib/scan/segmenter.worker.ts", "utf8");
  ok(/\.\.\.\(contractPlane === null \? \{\} : \{ contract:/.test(source), "worker result adds `contract` via a null-guarded spread");
  const resultLiteral = source.slice(source.indexOf('type: "result"', source.indexOf("postMessage")));
  ok(!/\n\s+contract: /.test(resultLiteral.slice(0, resultLiteral.indexOf("satisfies"))), "no unconditional `contract:` key in the result literal");
}

/* --------------------------------- 5. Flags --------------------------------- */

ok(DEFAULT_SCAN_FLAGS.fieldContract === false, "fieldContract defaults OFF");
ok(DEFAULT_SCAN_FLAGS.corridorSearch === false, "corridorSearch defaults OFF");

console.log(`CONTRACT ASSERTIONS PASSED (${assertions})`);
