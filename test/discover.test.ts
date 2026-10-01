/* ============================================================================
 * S3 — TRACER-LED DISCOVERY
 *
 *   1. the flag ships off; the chamber alone switches it on; the hook loads the
 *      module lazily, runs it INSTEAD of the S2 tracer, and draws the HELD line
 *   2. smoothing: spikes out, the curvature-limited fit stays in its ±2 px tube,
 *      corners are found, the bars measure what they claim
 *   3. discovery on planted creases: each major found on its crease with free
 *      endpoints; no crease → no line; exclusivity (no fate along life, lines
 *      share an origin, never a body); a corner splits; a held line is refined
 *      in its tube, never re-discovered
 *   4. the hold: refined by EMA 0.15 only from a path scoring at least as well,
 *      grows past its ends, never shrinks
 * ========================================================================== */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  DISCOVER_FLOORS,
  DISCOVER_ORDER,
  Discoverer,
  EXCLUSION_DILATE_PX,
  HELD_TUBE_PX,
  SHADOW_PX,
  discoveredToLine,
  heldInGrid,
  onCrease,
  palmReference,
  trimToCrease,
  type DiscoveryResult,
} from "../lib/scan/discover";
import { CHAMBER_SCAN_FLAGS, DEFAULT_SCAN_FLAGS, SCAN_FLAG_LABELS, SCAN_FLAG_NAMES } from "../lib/scan/flags";
import { HOLD_REFINE_ALPHA, refineHeldLine } from "../lib/scan/hold-refine";
import { RekhaPersistence, type RekhaSnapshot } from "../lib/scan/rekha-persist";
import {
  distanceToPolyline,
  kinkIndices,
  medianDistance,
  removeSpikes,
  resamplePolyline,
  smoothPath,
  tubeSmooth,
  turningBar,
  SMOOTH_TUBE_PX,
  TURN_BAR_DEG,
  type PathPoint,
} from "../lib/scan/smooth-path";
import { STOP_COST } from "../lib/scan/trace-valley";
import { MASK_SIZE, type ActiveLineId, type TracedLine } from "../lib/scan/types";
import type { LineExtraction } from "../lib/scan/lines";

let assertions = 0;
const ok = (condition: boolean, message: string): void => {
  assert.ok(condition, message);
  assertions += 1;
};
const ROOT = path.resolve(__dirname, "..");
const source = (...parts: string[]): string => readFileSync(path.join(ROOT, ...parts), "utf8");
const withoutComments = (text: string): string => text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

/* ============================ 1. The flag and the hook ======================= */

{
  ok(DEFAULT_SCAN_FLAGS.rekhaDiscover === false, "rekhaDiscover ships OFF");
  ok(SCAN_FLAG_NAMES.includes("rekhaDiscover") && SCAN_FLAG_LABELS.rekhaDiscover.length > 0, "it is in the HUD's list with a label");
  ok(CHAMBER_SCAN_FLAGS.includes("rekhaDiscover"), "the chamber turns it on with its other flags (restored on unmount, chamber-ui pins it)");
  ok(!/rekhaDiscover|withScanFlags/.test(source("app", "scan", "scan-client.tsx")), "/scan does not");

  const hook = withoutComments(source("components", "scan", "use-hand-scan.ts"));
  ok(
    /import\("@\/lib\/scan\/discover"\)/.test(hook) && !/^import (?!type)[^;]*from "@\/lib\/scan\/discover"/m.test(hook),
    "the hook fetches the discovery module the first time the flag is seen on — never a static import into /scan's first load",
  );
  ok(
    /if \(discoverModule !== null && crop !== undefined\)[\s\S]*?\} else if \(traceModule !== null && crop !== undefined\)/.test(hook),
    "with both flags on, discovery draws and the S2 tracer is not run",
  );
  ok(
    /discoverModule\.heldInGrid\(rekha\.hold\.heldLines\(\), crop\.size\)/.test(hook),
    "discovery is handed the lines persistence holds — refined in their tubes, never re-discovered",
  );
  ok(
    /discoverModule !== null \? rekha\.hold\.heldLines\(\) : rekha\.hold\.heldMissingFrom\(drawn\)/.test(hook),
    "S3.6: under the flag what is published — the chamber, the Monitor, the photograph, the hand-off — is the HELD line",
  );
  ok(/extractLines\(activeFusion\.ema/.test(hook), "extractLines still runs — for the features");
}

/* ============================ 2. Smoothing =================================== */

{
  const line = (n: number, f: (i: number) => PathPoint): PathPoint[] => Array.from({ length: n }, (_, i) => f(i));

  const resampled = resamplePolyline([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }], 1);
  ok(resampled.length === 21 && resampled.every((p, i) => i === 0 || Math.abs(Math.hypot(p.x - resampled[i - 1]!.x, p.y - resampled[i - 1]!.y) - 1) < 1e-9), "resampling spaces points 1 px apart along the arc");

  const spiky = line(60, (i) => ({ x: i, y: i === 30 ? 5 : 0 }));
  const despiked = removeSpikes(spiky);
  ok(
    turningBar(despiked, 6) <= 35 && Math.max(...despiked.map((p) => Math.abs(p.y))) < 1.5,
    `a spike is cut by chords until no turn over 6 px exceeds 35° (5 px tall → ${Math.max(...despiked.map((p) => Math.abs(p.y))).toFixed(2)} px)`,
  );
  ok(Math.max(...smoothPath(spiky).smooth.map((p) => Math.abs(p.y))) < 0.5, "and the fit that follows flattens what is left");

  // An 8-connected staircase at a shallow slope, as a pixel path is: stepping 1 px right, and 1 px up every third step.
  const stairs: PathPoint[] = [];
  for (let i = 0, y = 0; i < 90; i += 1) {
    if (i % 3 === 2) y -= 1;
    stairs.push({ x: i, y });
  }
  const fitted = tubeSmooth(removeSpikes(stairs));
  const centre = removeSpikes(stairs);
  ok(fitted.every((p, i) => Math.hypot(p.x - centre[i]!.x, p.y - centre[i]!.y) <= SMOOTH_TUBE_PX + 1e-9), "every fitted point stays in its ±2 px tube");
  ok(turningBar(fitted) <= 5, `the staircase's pixel steps are gone (${turningBar(stairs).toFixed(0)}° raw → ${turningBar(fitted).toFixed(1)}° per 10 px)`);

  const corner = [...line(40, (i) => ({ x: i, y: 0 })), ...line(40, (i) => ({ x: 39, y: i + 1 }))];
  const kinks = kinkIndices(resamplePolyline(corner, 1));
  ok(kinks.length === 1 && Math.abs(kinks[0]! - 39) <= 3, `a right-angle corner is found once, at the corner (${kinks.join(",")})`);
  const arc = line(120, (i) => ({ x: 60 * Math.cos(i / 60), y: 60 * Math.sin(i / 60) }));
  ok(kinkIndices(resamplePolyline(arc, 1)).length === 0, "a crease's own bend (an arc of radius 60 px) is not a corner");

  const wobble = line(150, (i) => ({ x: i, y: 40 * Math.sin(i / 50) + ((i * 7919) % 5) * 0.3 - 0.6 }));
  const brute = (() => {
    const pts = resamplePolyline(smoothPath(wobble).smooth, 1);
    const d = pts.map((p) => distanceToPolyline(p, wobble)).sort((a, b) => a - b);
    return d[d.length >> 1]!;
  })();
  const bars = smoothPath(wobble);
  ok(Math.abs(medianDistance(bars.smooth, wobble) - brute) < 1e-9, "the windowed median distance equals the brute-force one on a fit and its raw path");
  ok(bars.maxTurnDeg <= TURN_BAR_DEG && bars.medianToRaw <= 1.5, `a noisy crease meets both bars (${bars.maxTurnDeg.toFixed(1)}° per 10 px, ${bars.medianToRaw.toFixed(2)} px from raw)`);
}

/* ============================ 3. Discovery =================================== */

const N = 256;

/** A deterministic hash in 0–1. */
const hash = (i: number): number => {
  let h = Math.imul(i ^ 0x9e3779b9, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
};

/** Skin at 0.7 with a faint texture (a real palm is never flat), then each crease stamped 0.16 deep, ~3 px wide. */
function palm(creases: readonly (readonly PathPoint[])[]): Float32Array {
  const raw = new Float32Array(N * N);
  for (let i = 0; i < raw.length; i += 1) raw[i] = 0.7 + (hash(i) - 0.5) * 0.03;
  const luma = new Float32Array(N * N);
  for (let y = 0; y < N; y += 1) {
    for (let x = 0; x < N; x += 1) {
      let sum = 0;
      let count = 0;
      for (let dy = -1; dy <= 1; dy += 1) for (let dx = -1; dx <= 1; dx += 1) {
        const yy = y + dy;
        const xx = x + dx;
        if (yy < 0 || yy >= N || xx < 0 || xx >= N) continue;
        sum += raw[yy * N + xx]!;
        count += 1;
      }
      luma[y * N + x] = sum / count;
    }
  }
  for (const crease of creases) {
    for (const p of resamplePolyline(crease, 0.5)) {
      for (let dy = -3; dy <= 3; dy += 1) {
        for (let dx = -3; dx <= 3; dx += 1) {
          const x = Math.round(p.x) + dx;
          const y = Math.round(p.y) + dy;
          if (x < 0 || y < 0 || x >= N || y >= N) continue;
          const d = Math.hypot(x - p.x, y - p.y);
          const dark = 0.7 - 0.16 * Math.exp(-(d * d) / (2 * 1.1 * 1.1));
          if (dark < luma[y * N + x]!) luma[y * N + x] = dark;
        }
      }
    }
  }
  return luma;
}

/* Planted creases, px at 256, inside their corridors (completion.ts CORRIDORS × 256). */
const HEART: PathPoint[] = [{ x: 222, y: 75 }, { x: 187, y: 66 }, { x: 144, y: 59 }, { x: 100, y: 56 }, { x: 70, y: 57 }];
const HEAD: PathPoint[] = [{ x: 62, y: 84 }, { x: 89, y: 87 }, { x: 126, y: 93 }, { x: 163, y: 102 }, { x: 192, y: 111 }];
const LIFE: PathPoint[] = [{ x: 64, y: 84 }, { x: 80, y: 107 }, { x: 97, y: 147 }, { x: 108, y: 190 }, { x: 112, y: 226 }];
const FATE: PathPoint[] = [{ x: 132, y: 226 }, { x: 130, y: 198 }, { x: 128, y: 160 }, { x: 126, y: 125 }, { x: 125, y: 105 }];
const inside = new Uint8Array(N * N).fill(1);

/** A drawn line (MASK_SIZE grid) back at 256. */
const at256 = (line: TracedLine | undefined): PathPoint[] => (line === undefined ? [] : line.points.map(([x, y]) => ({ x: (x + 0.5) * 2 - 0.5, y: (y + 0.5) * 2 - 0.5 })));
const medianTo = (drawn: readonly PathPoint[], truth: readonly PathPoint[]): number => {
  const d = resamplePolyline(drawn, 1)
    .map((p) => distanceToPolyline(p, truth))
    .sort((a, b) => a - b);
  return d[d.length >> 1] ?? Infinity;
};

const discoverer = new Discoverer(N, undefined, undefined, true);

{
  const result: DiscoveryResult = discoverer.discover(palm([HEART, HEAD, LIFE]), inside);
  for (const [id, truth] of [
    ["heart", HEART],
    ["head", HEAD],
    ["life", LIFE],
  ] as const) {
    const drawn = at256(result.lines[id]);
    ok(result.verdicts[id].outcome === "accepted" && drawn.length > 0, `${id}: discovered on a palm where it is the only crease in its band`);
    ok(medianTo(drawn, truth) <= 1.5, `${id}: drawn on its crease (median ${medianTo(drawn, truth).toFixed(2)} px at 256)`);
    const line = result.verdicts[id].line!;
    ok(line.maxTurnDeg <= TURN_BAR_DEG && line.medianToRaw <= 1.5, `${id}: meets the jaggedness bars (${line.maxTurnDeg.toFixed(1)}°, ${line.medianToRaw.toFixed(2)} px)`);
    ok((result.lines[id]!.score ?? 0) >= DISCOVER_FLOORS[id], `${id}: carries its score (${result.lines[id]!.score}) for the hold to refine by`);
  }
  ok(result.verdicts.fate.outcome !== "accepted" && result.lines.fate === undefined, `no fate crease → no fate line (${result.verdicts.fate.outcome}, score ${result.verdicts.fate.score.toFixed(0)} under ${DISCOVER_FLOORS.fate})`);

  // Free endpoints: the heart crease runs only from x 120 to 222; the line must stop where it does, not at the knot (x 56).
  const partial = HEART.filter((p) => p.x >= 100).map((p) => (p.x === 100 ? { x: 120, y: 57.5 } : p));
  const short = at256(discoverer.discover(palm([partial, HEAD, LIFE]), inside).lines.heart);
  const xs = short.map((p) => p.x);
  ok(Math.min(...xs) >= 112 && Math.max(...xs) >= 212, `free endpoints: a crease from x 120 to 222 is drawn from ${Math.min(...xs).toFixed(0)} to ${Math.max(...xs).toFixed(0)}`);

  // With a fate crease planted, fate is found — and nowhere along the life line.
  const withFate = discoverer.discover(palm([HEART, HEAD, LIFE, FATE]), inside);
  const fate = at256(withFate.lines.fate);
  ok(withFate.verdicts.fate.outcome === "accepted" && medianTo(fate, FATE) <= 1.5, `a planted fate crease is discovered on it (median ${medianTo(fate, FATE).toFixed(2)} px)`);
  const life = at256(withFate.lines.life);
  const alongLife = resamplePolyline(fate, 1).filter((p) => distanceToPolyline(p, life) <= EXCLUSION_DILATE_PX).length / Math.max(1, resamplePolyline(fate, 1).length);
  ok(alongLife < 0.1, `exclusivity: ${(alongLife * 100).toFixed(0)}% of the fate line runs within the life line's claim`);
}

{
  // Exclusivity: a palm whose ONLY vertical crease is the life line. The fate band overlaps it at the wrist; the fate
  // must neither trace onto it nor ride its flank.
  const result = discoverer.discover(palm([HEART, HEAD, LIFE]), inside);
  const fate = result.verdicts.fate.line;
  const life = at256(result.lines.life);
  const onLife = fate === null ? 0 : resamplePolyline(fate.smooth, 1).filter((p) => distanceToPolyline(p, life) <= SHADOW_PX).length / Math.max(1, resamplePolyline(fate.smooth, 1).length);
  ok(result.lines.fate === undefined, `the fate band never borrows the life line (candidate ${result.verdicts.fate.outcome}, ${(onLife * 100).toFixed(0)}% within ${SHADOW_PX} px of it)`);

  // Shared origin: the life line leaves the head line 20 px in — both are still found, the life line from the origin.
  const shared: PathPoint[] = [{ x: 62, y: 84 }, { x: 82, y: 86 }, { x: 90, y: 110 }, { x: 99, y: 150 }, { x: 108, y: 190 }, { x: 112, y: 226 }];
  const joined = discoverer.discover(palm([HEART, HEAD, shared]), inside);
  const lifeJoined = at256(joined.lines.life);
  ok(joined.verdicts.head.outcome === "accepted" && joined.verdicts.life.outcome === "accepted", "head and life rising together from the thumb web are both found");
  ok(lifeJoined.length > 0 && Math.min(...lifeJoined.map((p) => p.y)) <= 92, `the life line starts at the shared origin, not below the head line's claim (top y ${Math.min(...lifeJoined.map((p) => p.y)).toFixed(0)})`);

  // A corner: a head crease that turns hard down onto another crease is split at the corner, the stronger arm kept.
  const bent: PathPoint[] = [{ x: 62, y: 84 }, { x: 126, y: 93 }, { x: 192, y: 111 }, { x: 196, y: 150 }];
  const split = at256(discoverer.discover(palm([HEART, bent, LIFE]), inside).lines.head);
  ok(split.length > 0 && Math.max(...split.map((p) => p.y)) < 125, `a path that turns a corner is split there (the drawn head reaches y ${Math.max(...split.map((p) => p.y)).toFixed(0)}, the corner is at 111)`);
}

{
  // Held: the next discovery refines the heart inside its tube — a stronger parallel crease 10 px off cannot take it.
  const first = discoverer.discover(palm([HEART, HEAD, LIFE]), inside);
  const held = heldInGrid({ heart: first.lines.heart! });
  const decoy = HEART.map((p) => ({ x: p.x, y: p.y + 10 }));
  const luma = palm([HEART, HEAD, LIFE]);
  const deeper = palm([decoy]);
  for (let i = 0; i < luma.length; i += 1) luma[i] = Math.min(luma[i]!, deeper[i]! - 0.05);
  const unheld = at256(discoverer.discover(luma, inside).lines.heart);
  const refined = discoverer.discover(luma, inside, held);
  const heart = at256(refined.lines.heart);
  ok(refined.verdicts.heart.line?.held === true, "a held line is searched inside its own tube");
  ok(medianTo(unheld, decoy) <= 2, `(unheld, the stronger decoy 10 px away wins: ${medianTo(unheld, decoy).toFixed(1)} px from it)`);
  ok(medianTo(heart, HEART) <= 2 && Math.max(...resamplePolyline(heart, 1).map((p) => distanceToPolyline(p, held.heart!))) <= HELD_TUBE_PX + 1, `held, it stays on its own crease (median ${medianTo(heart, HEART).toFixed(1)} px) — never re-discovered from scratch`);

  const drawnAgain = heldInGrid({ heart: discoveredToLine(refined.verdicts.heart.line!) }).heart!;
  const smooth = refined.verdicts.heart.line!.smooth;
  ok(drawnAgain.length === smooth.length && drawnAgain.every((p, i) => Math.hypot(p.x - smooth[i]!.x, p.y - smooth[i]!.y) < 0.02), "heldInGrid inverts discoveredToLine's MASK_SIZE mapping");
  const line = discoveredToLine(refined.verdicts.heart.line!);
  ok(line.traced === true && line.segments!.at(-1)!.to === line.points.length && line.segments![0]!.from === 0, "segments are half-open and cover the line, as tracedToLine's");
}

{
  ok(JSON.stringify(DISCOVER_ORDER) === JSON.stringify(["heart", "head", "life", "fate"]), "reliability order heart → head → life → fate");
  const costs = [...Array(10).fill(1.04), ...Array(40).fill(0.1), ...Array(15).fill(1.04), ...Array(6).fill(0.1), ...Array(8).fill(1.04)];
  const span = trimToCrease(costs);
  ok(span !== null && span[0] === 10 && span[1] === 49, `ends are trimmed to the crease, and a speck beyond a longer gap is not the line's (${span?.join("–")})`);
  ok(onCrease([0.1, 0.1, 0.1, 1.04, 0.1, 0.1, 0.1]).every(Boolean), `a one-pixel break in a crease is still crease (the window's mean is under ${STOP_COST})`);
  const flat = new Float32Array(100).fill(0.01);
  flat[0] = 1;
  ok(Math.abs(palmReference(flat, null) - 5 * Math.fround(0.01)) < 1e-9, "on a palm with few creases the reference is 5 × the median, not the texture's own 90th percentile");

  const luma = palm([HEART, HEAD, LIFE, FATE]);
  for (let i = 0; i < 5; i += 1) discoverer.discover(luma, inside);
  const times: number[] = [];
  for (let i = 0; i < 10; i += 1) times.push(discoverer.discover(luma, inside).ms);
  times.sort((a, b) => a - b);
  ok(times[5]! < 60, `a warm discovery costs ${times[5]!.toFixed(1)} ms here (the S3.7d bar is measured in the browser)`);
}

/* ============================ 4. The hold ==================================== */

{
  const straight = (y: number, x0: number, x1: number, score: number): TracedLine => ({
    id: "heart",
    points: Array.from({ length: x1 - x0 + 1 }, (_, i) => [x0 + i, y] as const),
    confidence: 0.8,
    segments: [{ from: 0, to: x1 - x0 + 1, observed: true }],
    traced: true,
    score,
  });
  const held = straight(50, 20, 80, 100);
  const refined = refineHeldLine(held, straight(52, 10, 90, 120));
  const body = refined.points.filter(([x]) => x >= 21 && x <= 79);
  ok(body.every(([, y]) => Math.abs(y - (50 + HOLD_REFINE_ALPHA * 2)) < 0.02), `held points move ${HOLD_REFINE_ALPHA} of the way to the fresh path (y 50 → ${body[5]?.[1]})`);
  ok(refined.points[0]![0] <= 11 && refined.points.at(-1)![0] >= 89, "the line grows by the fresh path beyond its ends");
  const join = refined.points.findIndex(([x]) => x >= 20);
  ok(Math.abs(refined.points[join]![1] - refined.points[join - 1]![1]) < 0.5, "and is joined without a step");
  ok(Math.abs((refined.score ?? 0) - (100 + HOLD_REFINE_ALPHA * 20)) < 0.01, `its score follows the same EMA (${refined.score})`);
  // Twenty refinements toward a path the same length, offset 2 px: the whole line moves, its ends with it — no hook.
  let repeated = held;
  for (let k = 0; k < 20; k += 1) repeated = refineHeldLine(repeated, straight(52, 20, 80, 200));
  const hookTurn = turningBar(repeated.points.map(([x, y]) => ({ x: x * 2, y: y * 2 })));
  ok(hookTurn < 1 && Math.abs(repeated.points[0]![1] - repeated.points[30]![1]) < 0.01, `refined twenty times, the ends move with the line (worst turn ${hookTurn.toFixed(2)}° per 10 px at 256)`);
  const grown = refineHeldLine(held, straight(53, 0, 80, 120));
  ok(turningBar(grown.points.map(([x, y]) => ({ x: x * 2, y: y * 2 }))) <= TURN_BAR_DEG, "a stretch grown from 3 px aside joins without a corner");
  // Growth at a different heading: a smooth fresh path that runs 35° off the held line where it ends. Joined in
  // position only, the line would turn 35° at the join; the Hermite join keeps the held heading and eases over.
  const heading = (35 * Math.PI) / 180;
  const angled: TracedLine = {
    ...straight(50, 20, 80, 130),
    points: Array.from({ length: 41 }, (_, k) => [70 + k * Math.cos(heading), 50 - 10 * Math.sin(heading) + k * Math.sin(heading)] as const),
  };
  const angledGrown = refineHeldLine(held, angled);
  const joinTurn = turningBar(angledGrown.points.map(([x, y]) => ({ x: x * 2, y: y * 2 })));
  ok(angledGrown.points.length > held.points.length && joinTurn <= TURN_BAR_DEG, `a stretch growing off 35° from the held heading joins without a corner (worst turn ${joinTurn.toFixed(1)}° per 10 px)`);
  // A fresh path that leaves the held end at a corner has found another crease beyond it: no growth this extraction.
  const cornered: TracedLine = {
    ...straight(50, 20, 80, 130),
    points: [...straight(50, 20, 80, 130).points, ...Array.from({ length: 20 }, (_, k) => [80 + (k + 1) * Math.cos(Math.PI / 3), 50 + (k + 1) * Math.sin(Math.PI / 3)] as const)],
  };
  const refused = refineHeldLine(held, cornered);
  ok(refused.points.length === held.points.length, `growth onto a continuation 60° off the held end is refused (${refused.points.length} points kept)`);
  const shorter = refineHeldLine(held, straight(52, 40, 60, 120));
  ok(shorter.points.length === held.points.length && shorter.points[0]![1] === 50 && shorter.points.at(-1)![1] === 50, "a shorter fresh path moves only what it reaches — the held line never shrinks");

  // Through persistence itself: the held geometry changes only from a fresh path scoring at least as well.
  const SIZE = 32;
  const ROW = 16;
  const plane = new Float32Array(SIZE * SIZE).fill(0.05);
  for (let x = 4; x < 28; x += 1) plane[ROW * SIZE + x] = 0.95;
  const gray = new Float32Array(SIZE * SIZE).fill(0.5);
  const extraction = (lines: Partial<Record<ActiveLineId, TracedLine>>): LineExtraction => ({ lines, polys: [], fragments: [], completion: { lines: {}, reports: {} } as never, features: {}, branchPoints: 0 });
  const line = (y: number, score: number): TracedLine => ({ id: "heart", points: [[4, y], [16, y], [27, y]], confidence: 1, traced: true, score });
  const rekha = new RekhaPersistence(SIZE, { motionEnabled: false, nullLevel: 0.22 });
  let snap: RekhaSnapshot = rekha.observe(plane, gray, 1, 0);
  for (let f = 1; f <= 8; f += 1) snap = rekha.observe(plane, gray, 1, f * 200);
  snap = rekha.extracted(extraction({ heart: line(ROW, 100) }), 1600);
  ok(snap.lines.heart?.state === "confirmed" && rekha.hold.heldLines().heart?.points[1]?.[1] === ROW, "a confirmed discovered line is held as found");
  snap = rekha.extracted(extraction({ heart: line(ROW + 0.8, 90) }), 1800);
  ok(rekha.hold.heldLines().heart?.points[1]?.[1] === ROW && snap.lines.heart?.points[1]?.[1] === ROW, "a fresh path scoring LESS leaves the held line exactly where it was");
  snap = rekha.extracted(extraction({ heart: line(ROW + 0.8, 120) }), 2000);
  const moved = rekha.hold.heldLines().heart?.points[1]?.[1] ?? 0;
  ok(Math.abs(moved - (ROW + HOLD_REFINE_ALPHA * 0.8)) < 0.02 && snap.lines.heart?.points[1]?.[1] === moved, `one scoring more moves it ${HOLD_REFINE_ALPHA} of the way (y ${moved}) — and that is what the snapshot draws`);
  ok(Math.abs((rekha.hold.heldLines().heart?.score ?? 0) - 103) < 0.01, "the held score follows the EMA");
  ok(MASK_SIZE === 128, "held lines live in the MASK_SIZE grid");
}

console.log(`DISCOVER ASSERTIONS PASSED (${assertions})`);
