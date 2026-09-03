/* ============================================================================
 * FEATURE VOCAB V2 — audit-§4 fixes behind the featureVocabV2 flag
 *
 * Two halves. IDENTITY: with the flag off, extractLines on a real golden field
 * is deepEqual to the default path — the freeze holds byte-for-byte. FIXES:
 * corridor-drawn synthetic fields trigger each v2 branch and emit the KB's
 * value; the same field with the flag off does not.
 *
 * Fix #4 (fate origin "head_line") carries a measured caveat instead of a
 * fabricated pass: the fate corridor's s=0 end is the WRIST (completion.ts
 * knots[0] = {0.5, 0.93}), and `endpointObserved` marks any interior start
 * extrapolated — so a fate line beginning at the head line can never surface
 * an observed start, and the head_line value stays unreachable through
 * extractLines even with v2. The branch is tested for inertness; making the
 * value genuinely reachable needs Phase-4 endpoint semantics.
 * ========================================================================== */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import sharp from "sharp";
import { rectifyPalm } from "../lib/scan/rectify";
import { detectRidges, normalizeResponses } from "../lib/scan/ridge";
import { detectVessels, sigmasFor } from "../lib/scan/frangi";
import { normaliseIllumination } from "../lib/scan/illumination";
import { blendComposite, compositeStack, emptyStack, pushFrame } from "../lib/scan/stack";
import { combineProbabilities } from "../lib/scan/segmenter";
import { alignFusion, emptyFusion, fuse, type FusionState } from "../lib/scan/fusion";
import {
  HEART_PALE_DEPTH_MAX,
  QUADRANGLE_CONFUSED_MIN_BRANCHES,
  extractAllTraces,
  extractLines,
} from "../lib/scan/lines";
import { CORRIDORS } from "../lib/scan/completion";
import { fateDoubleOverride } from "../lib/scan/minor-lines";
import { MASK_SIZE, RECTIFIED_SIZE, type Point2 } from "../lib/scan/types";

let assertions = 0;
const ok = (condition: boolean, message: string): void => {
  assert.ok(condition, message);
  assertions += 1;
};

const S = MASK_SIZE;

/* ------------------------------ Field helpers ------------------------------ */

function stamp(field: Float32Array, x: number, y: number, value: number, radius = 1): void {
  for (let dy = -radius; dy <= radius; dy += 1) {
    for (let dx = -radius; dx <= radius; dx += 1) {
      const px = Math.round(x) + dx;
      const py = Math.round(y) + dy;
      if (px >= 0 && px < S && py >= 0 && py < S) {
        const at = py * S + px;
        if (value > field[at]) field[at] = value;
      }
    }
  }
}

function drawPolyline(field: Float32Array, points: readonly Point2[], value: number, radius = 1): void {
  for (let i = 1; i < points.length; i += 1) {
    const steps = Math.max(1, Math.ceil(Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y)));
    for (let s = 0; s <= steps; s += 1) {
      stamp(
        field,
        points[i - 1].x + ((points[i].x - points[i - 1].x) * s) / steps,
        points[i - 1].y + ((points[i].y - points[i - 1].y) * s) / steps,
        value,
        radius,
      );
    }
  }
}

/** The corridor centreline in field pixels — guarantees completion accepts the line. */
const centreline = (id: keyof typeof CORRIDORS): Point2[] =>
  CORRIDORS[id].knots.map((k) => ({ x: k.x * S, y: k.y * S }));

const flat = (bag: unknown, prefix = ""): Record<string, unknown> => {
  const out: Record<string, unknown> = {};
  if (typeof bag !== "object" || bag === null) return out;
  for (const [key, value] of Object.entries(bag as Record<string, unknown>)) {
    const at = prefix === "" ? key : `${prefix}.${key}`;
    if (typeof value === "object" && value !== null && !Array.isArray(value)) Object.assign(out, flat(value, at));
    else out[at] = value;
  }
  return out;
};

/* ------------------- 1. IDENTITY on a real golden field ------------------- */

async function goldenField(): Promise<Float32Array> {
  const gt = JSON.parse(readFileSync("test/fixtures/ground-truth/lines-missing-tilt-03.json", "utf8")) as {
    frame: string;
    anchors: number[][];
  };
  const { data, info } = await sharp(gt.frame).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const source = { width: info.width, height: info.height, data: new Uint8ClampedArray(data) } as ImageData;
  const makeImageData = (w: number, h: number): ImageData =>
    ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4), colorSpace: "srgb" }) as ImageData;
  const warped = rectifyPalm(source, gt.anchors.map((a) => ({ x: a[0], y: a[1] })), RECTIFIED_SIZE, makeImageData);
  assert.ok(warped !== null);
  assertions += 1;
  const plane = RECTIFIED_SIZE * RECTIFIED_SIZE;
  const gray = new Float32Array(plane);
  for (let i = 0; i < plane; i += 1) {
    const at = i * 4;
    gray[i] = (0.2126 * warped.image.data[at] + 0.7152 * warped.image.data[at + 1] + 0.0722 * warped.image.data[at + 2]) / 255;
  }
  const small = new Float32Array(S * S);
  for (let y = 0; y < S; y += 1) {
    for (let x = 0; x < S; x += 1) {
      const a = 2 * y * RECTIFIED_SIZE + 2 * x;
      const b = a + RECTIFIED_SIZE;
      small[y * S + x] = (gray[a] + gray[a + 1] + gray[b] + gray[b + 1]) * 0.25;
    }
  }
  const validity = new Uint8Array(S * S);
  for (let y = 0; y < S; y += 1) {
    for (let x = 0; x < S; x += 1) {
      const a = 2 * y * RECTIFIED_SIZE + 2 * x;
      const b = a + RECTIFIED_SIZE;
      validity[y * S + x] = warped.inside[a] & warped.inside[a + 1] & warped.inside[b] & warped.inside[b + 1];
    }
  }
  const stack = emptyStack(S);
  let fusion: FusionState = emptyFusion(MASK_SIZE);
  for (let tick = 0; tick < 6; tick += 1) {
    const normalised = new Float32Array(S * S);
    const illumination = normaliseIllumination(small, S, normalised, validity);
    pushFrame(stack, illumination.out, 4, illumination.bypassed);
    const detectorInput = new Float32Array(illumination.out);
    blendComposite(detectorInput, compositeStack(stack));
    const frangi = new Float32Array(S * S);
    detectVessels(detectorInput, S, sigmasFor(S), frangi);
    normalizeResponses(frangi);
    const ridge = Float32Array.from(detectRidges(small, S).probability);
    const classical = new Float32Array(S * S);
    for (let i = 0; i < classical.length; i += 1) classical[i] = ridge[i] > frangi[i] ? ridge[i] : frangi[i];
    fusion = alignFusion(fusion, warped.toCrop, 4).state;
    fusion = fuse(
      fusion,
      { width: S, height: S, all: combineProbabilities(null, classical), resolves: [], inferenceMs: 0, backend: "classical", stages: { unet: null, ridge, frangi, median: null, photometric: null } },
      1000 + tick * 200,
    );
  }
  return fusion.ema;
}

async function main(): Promise<void> {
  const field = await goldenField();
  const defaultBag = extractLines(field, S).features;
  const offBag = extractLines(field, S, false).features;
  assert.deepEqual(offBag, defaultBag, "flag off === default path, byte for byte, on a real field");
  assertions += 1;
  const offFlat = flat(defaultBag);
  ok(!("lines.life.tight_venus_arc" in offFlat), "no v2 key leaks with the flag off");
  ok(offFlat["lines.heart.depth"] !== "pale_broad_shallow", "no v2 value leaks with the flag off");

  // #2 on the same real field: tight_venus_arc ⇔ the arc's own narrow band, and only under v2.
  const onFlat = flat(extractLines(field, S, true).features);
  if ("lines.life.arc" in onFlat) {
    const narrow = onFlat["lines.life.arc"] === "narrow_hugging_thumb";
    ok((onFlat["lines.life.tight_venus_arc"] === true) === narrow, "#2 tight_venus_arc mirrors the narrow arc band exactly");
  }

  /* --------------------- #1 wavy explicit false + #3 pale --------------------- */
  {
    const synthetic = new Float32Array(S * S);
    /*
     * The pale band moved DOWN (0.45 → 0.30, upper-edge inclusive). Through `extractLines`' fixed
     * binarize (LINE_THRESHOLD 0.45, and f32(0.45) itself rounds DOWN so a 0.45 stamp never
     * binarizes) a skeleton's observed depthProxy cannot sit at 0.30 — the samples ride the
     * skeleton, which only exists where the field cleared ≈0.45. So at the DEFAULT threshold the
     * band is structurally INERT and this case pins that: the weakest detectable heart stays
     * broad_shallow under v2. The band exists for lower-threshold extraction paths (the eval
     * sweep's seam extracts at 0.15–0.85; a future threshold change would inherit it), where a
     * genuine ≤0.30 depth is measurable. Same treatment as fix #4: pin the inertness, don't fake
     * a pass.
     */
    drawPolyline(synthetic, centreline("heart"), 0.4);
    drawPolyline(synthetic, centreline("heart"), 0.451, 0);
    drawPolyline(synthetic, centreline("life"), 0.6);
    const off = flat(extractLines(synthetic, S, false).features);
    const on = flat(extractLines(synthetic, S, true).features);
    ok(!("lines.quality.wavy" in off), "#1 off: straight lines emit no wavy key");
    ok(on["lines.quality.wavy"] === false, "#1 on: wavy is an explicit false — the KB's `eq false` rules can fire");
    ok(off["lines.heart.depth"] === "broad_shallow", "#3 off: the weakest band is still broad_shallow");
    ok(
      on["lines.heart.depth"] === "broad_shallow",
      `#3 on: at the default threshold no observable depth reaches the ≤${HEART_PALE_DEPTH_MAX} pale band — structurally inert, pinned (got ${String(on["lines.heart.depth"])})`,
    );
    ok(HEART_PALE_DEPTH_MAX < 0.45, "#3 the pale ceiling sits below LINE_THRESHOLD — the inertness above is why");
  }

  /* ------------------------- #7 diverging_open / confused ------------------------- */
  {
    const synthetic = new Float32Array(S * S);
    // Heart tilted within its corridor: high on the radial side, high-gap on the ulnar side.
    const heart: Point2[] = [
      { x: 0.9 * S, y: 0.27 * S },
      { x: 0.75 * S, y: 0.21 * S },
      { x: 0.5 * S, y: 0.21 * S },
      // Radial end kept ≥6px clear of the head band — closer and the 3px stamps merge under
      // thinning, and BOTH corridors reject the fused blob (measured: no_seeds on each).
      { x: 0.25 * S, y: 0.27 * S },
      { x: 0.22 * S, y: 0.265 * S },
    ];
    drawPolyline(synthetic, heart, 0.6);
    drawPolyline(synthetic, centreline("head"), 0.6);
    const off = flat(extractLines(synthetic, S, false).features);
    const on = flat(extractLines(synthetic, S, true).features);
    ok(on["geometry.quadrangle_shape"] === "diverging_open", `#7 on: widening quadrangle reads diverging_open (got ${String(on["geometry.quadrangle_shape"])})`);
    ok(off["geometry.quadrangle_shape"] !== "diverging_open", "#7 off: the v2 value never appears");

    // Confused: enough branch spurs takes precedence.
    const spurred = Float32Array.from(synthetic);
    for (let i = 0; i < QUADRANGLE_CONFUSED_MIN_BRANCHES + 1; i += 1) {
      const x = (0.3 + i * 0.12) * S;
      const headY = 0.335 * S + (x / S) * 0.1 * S;
      drawPolyline(spurred, [{ x, y: headY }, { x: x + 4, y: headY + 8 }], 0.6);
    }
    const confused = flat(extractLines(spurred, S, true).features);
    ok(confused["geometry.quadrangle_shape"] === "confused_lines", `#7 on: branch density reads confused_lines (got ${String(confused["geometry.quadrangle_shape"])})`);
  }

  /* ------------------------------ #5 fate double ------------------------------ */
  {
    const synthetic = new Float32Array(S * S);
    const fate = centreline("fate");
    drawPolyline(synthetic, fate, 0.7);
    drawPolyline(synthetic, fate.map((p) => ({ x: p.x + 6, y: p.y })), 0.7); // parallel sister
    const tracked = extractAllTraces(synthetic, S, null, true);
    ok(tracked.traces.some((t) => t.demotedFrom === "fate"), "#5 the demoted fate twin is visible under trackDemotions");
    ok(fateDoubleOverride(tracked), "#5 principal + demoted fate ⇒ structure double");
    const untracked = extractAllTraces(synthetic, S, null);
    ok(untracked.traces.every((t) => t.demotedFrom === undefined), "#5 default path carries no demotion field — shipped shapes unchanged");
    ok(!fateDoubleOverride(untracked), "#5 without tracking, no double claim");
  }

  /* --------------------- #4 fate head_line origin: inert, documented --------------------- */
  {
    // Full-corridor fate: the observable start is the WRIST end (knots[0] = {0.5, 0.93}); the head
    // line can never be within the band of it, so v2 must leave origin exactly as v1 emitted it.
    const synthetic = new Float32Array(S * S);
    drawPolyline(synthetic, centreline("fate"), 0.7);
    drawPolyline(synthetic, centreline("head"), 0.6);
    const off = flat(extractLines(synthetic, S, false).features);
    const on = flat(extractLines(synthetic, S, true).features);
    ok(on["lines.fate.origin"] === off["lines.fate.origin"], "#4 v2 does not disturb a wrist-observable origin");
    ok(on["lines.fate.origin"] !== "head_line", "#4 head_line stays unreachable through extractLines — see banner");
  }

  console.log(`FEATURE VOCAB ASSERTIONS PASSED (${assertions})`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
