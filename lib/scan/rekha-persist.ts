/**
 * @file Rekha persistence (flag `rekhaPersist`) — evidence that accumulates
 * across frames, and lines that are HELD once confirmed.
 *
 * THE COMPLAINT THIS ANSWERS. Every extraction used to start from zero: the
 * field an extraction read was a short EMA, so a crease that one frame missed
 * vanished from the overlay, came back a moment later, and vanished again —
 * and the detector spent its time re-finding the first line instead of
 * looking for the next. Two pieces fix that, and both already existed; this
 * module wires them to the live path:
 *
 *  1. PER-PIXEL EVIDENCE. `EvidenceAccumulator` (enhance/evidence.ts) folds
 *     every accepted frame into per-pixel log-odds with decay, a deadband and
 *     a CANDIDATE → TRACKING → CONFIRMED hysteresis ladder, aligned frame to
 *     frame by translation. {@link evidenceFieldInto} turns its probability
 *     map into the field extraction reads.
 *  2. PER-LINE HOLD. {@link RekhaLineHold} measures each extracted major
 *     line against that ladder. Once a line is CONFIRMED its polyline is held
 *     — through extractions that miss it, through blurred frames the
 *     accumulator skips — and dropped only when the pixels under it have
 *     themselves fallen out of the ladder. A held line is not re-found; the
 *     next extraction's attention goes to the lines not yet confirmed, and
 *     corridor search (fill-in only, as built) is released once any major
 *     line is confirmed. Heart held → head searched → life → fate → minors.
 *
 * Nothing here is reached with the flag off: use-hand-scan.ts constructs the
 * accumulator and the hold lazily, inside flag-gated branches, so the frozen
 * pipeline's output is untouched (test/flags-identity.test.ts).
 *
 * Layer: lib/scan (production). Pure. Imports nothing from lib/scan/dev.
 */
import {
  EvidenceAccumulator,
  PIXEL_CANDIDATE,
  PIXEL_CONFIRMED,
  PIXEL_TRACKING,
  DEFAULT_EVIDENCE_OPTIONS,
  type EvidenceOptions,
} from "./enhance/evidence";
import { frameWeightFromSharpness } from "./enhance/rekha-enhancer";
import { varianceOfLaplacian } from "./quality";
import { applyHomography, invertHomography, type Matrix3 } from "./rectify";
import { ACTIVE_LINE_IDS, type ActiveLineId, type TracedLine } from "./types";
import type { LineExtraction } from "./lines";

/* ------------------------------------------------------------------------ */
/* Calibration                                                                */
/* ------------------------------------------------------------------------ */

/**
 * The null level the accumulator is calibrated to — the response the field it
 * is fed shows where there is NO crease.
 *
 * The noise floor it was chosen within (scripts/scan/calibrate-rekha-null.ts;
 * numbers in the flag's JSDoc, flags.ts): creaseless skin in the per-frame
 * legacy field runs p95 0.17 on the session capture and 0.48–0.58 on the two
 * legacy screenshots; the library default of 0.06 sat under its median.
 *
 * The level itself was set on the S1.5 bars (scripts/scan/replay-persist.ts,
 * three jitter/blur seeds, 20 s at the live cadence):
 *
 *   null   false CONFIRMED fate on tilt-03   worst flicker per line per 20 s
 *   0.17   seeds 1 and 3                     2 (session fate)
 *   0.20   seeds 2 and 3                     2 (session fate)
 *   0.22   none                              1
 *   0.27   none                              2 (session life, seed 3)
 *
 * (swept with the exhaustive translation search; re-confirmed at 0.22 with the
 * final options below — coarse-to-fine search, sampled frame weight — on all
 * three seeds: worst flicker 1, no false fate.)
 *
 * 0.22 is the one level that met every bar on every seed. Its margin is thin —
 * 0.20 already confirms a phantom fate — so a live scan that disagrees should
 * move this number with its own measurement, as this one was moved.
 */
export const REKHA_PERSIST_NULL_LEVEL = 0.22;

/**
 * The accumulator's options on the live path: the library defaults, calibrated,
 * with the translation search run coarse-to-fine. The exhaustive ±8 px search
 * spent 0.8 of the accumulator's 1.7 ms; narrowing it to ±4 px paid for itself
 * in cost and failed the flicker bar (a replay's pose change moves a crease
 * further than that, the evidence misregisters, and a held line is dropped and
 * re-found — life flickered twice on seed 3). The pyramid keeps the ±8 px reach
 * for about a third of the comparisons (bench-rekha.ts, replay-persist.ts).
 */
export const REKHA_PERSIST_EVIDENCE: Partial<EvidenceOptions> = {
  nullLevel: REKHA_PERSIST_NULL_LEVEL,
  motionPyramid: true,
};

/** The capture harness's padding round the landmark box (app/dev/capture BBOX_PAD_FRACTION). */
export const REKHA_BBOX_PAD_FRACTION = 0.08;

/**
 * The live path samples the palm box's Laplacian at every 3rd pixel each way.
 * Each sample is still the full-resolution operator — nothing is downsampled —
 * so the statistic is the one D6 measures, estimated from a ninth of the box:
 * 3 ms a frame at 1280×720 became about a third of one, which is what the S1.5
 * cost bar needed (numbers in scripts/scan/bench-rekha.ts, which also reports
 * the sampled-vs-full agreement on every fixture frame).
 */
export const REKHA_VOL_STRIDE = 3;

/**
 * Sharpness of one camera frame, measured the way the ramp's constants were
 * set: variance of the Laplacian on 0–255 luma over the hand's bounding box
 * (padded by {@link REKHA_BBOX_PAD_FRACTION} of the frame) at FULL camera
 * resolution — quality.ts's D6 operator on the capture harness's box.
 *
 * Not on the rectified crop. The crop is resampled, which is a low-pass, and
 * measured there every frame of the calibration scored 14–17 against the
 * ramp's floor of 60: a weight of zero on every frame, and an accumulator that
 * skipped the lot.
 *
 * @param points the hand's landmarks (or, for a frame without them, its palm
 * anchors), normalised 0–1 to the frame.
 */
export function palmBoxVol(
  source: ImageData,
  points: readonly { readonly x: number; readonly y: number }[],
  stride: number = REKHA_VOL_STRIDE,
): number {
  if (points.length === 0) return 0;
  const { width, height, data } = source;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  const pad = REKHA_BBOX_PAD_FRACTION;
  const sx = Math.max(0, Math.floor((minX - pad) * width));
  const sy = Math.max(0, Math.floor((minY - pad) * height));
  const sw = Math.min(width - sx, Math.ceil((maxX - minX + 2 * pad) * width));
  const sh = Math.min(height - sy, Math.ceil((maxY - minY + 2 * pad) * height));
  if (!(sw >= 3 && sh >= 3)) return 0;
  if (stride <= 1) {
    const luma = new Float32Array(sw * sh);
    for (let y = 0; y < sh; y += 1) {
      const row = (sy + y) * width + sx;
      for (let x = 0; x < sw; x += 1) {
        const at = (row + x) * 4;
        luma[y * sw + x] = 0.2126 * (data[at] ?? 0) + 0.7152 * (data[at + 1] ?? 0) + 0.0722 * (data[at + 2] ?? 0);
      }
    }
    return varianceOfLaplacian(luma, sw, sh);
  }
  // Sampled: the same full-resolution 4-neighbour Laplacian as varianceOfLaplacian, evaluated at
  // every `stride`-th interior pixel each way, its luma read straight from the RGBA.
  const rowBytes = width * 4;
  let sum = 0;
  let sumSq = 0;
  let count = 0;
  for (let y = sy + 1; y < sy + sh - 1; y += stride) {
    for (let x = sx + 1; x < sx + sw - 1; x += stride) {
      const c = (y * width + x) * 4;
      const l = c - 4;
      const r0 = c + 4;
      const u = c - rowBytes;
      const d = c + rowBytes;
      const centre = 0.2126 * data[c]! + 0.7152 * data[c + 1]! + 0.0722 * data[c + 2]!;
      const around =
        0.2126 * (data[l]! + data[r0]! + data[u]! + data[d]!) +
        0.7152 * (data[l + 1]! + data[r0 + 1]! + data[u + 1]! + data[d + 1]!) +
        0.0722 * (data[l + 2]! + data[r0 + 2]! + data[u + 2]! + data[d + 2]!);
      const r = 4 * centre - around;
      sum += r;
      sumSq += r * r;
      count += 1;
    }
  }
  if (count === 0) return 0;
  const mean = sum / count;
  return sumSq / count - mean * mean;
}

/**
 * The frame weight: {@link palmBoxVol} through the enhancer's ramp. A frame
 * below the ramp's floor weighs zero, which the accumulator treats as UNUSABLE
 * — skipped outright, no decay, no shift ("skip-not-decay").
 */
export function rekhaFrameWeight(
  source: ImageData,
  points: readonly { readonly x: number; readonly y: number }[],
): { vol: number; weight: number } {
  const vol = palmBoxVol(source, points);
  return { vol, weight: frameWeightFromSharpness(vol) };
}

/**
 * The rectified crop as the accumulator's alignment input: luma, 0–1, box-
 * averaged down to the accumulator's `size` (the crop is an integer multiple).
 */
export function rekhaGray(crop: ImageData, size: number): Float32Array {
  const { data, width } = crop;
  const step = width / size;
  const out = new Float32Array(size * size);
  const norm = 1 / (step * step * 255);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let sum = 0;
      for (let dy = 0; dy < step; dy += 1) {
        for (let dx = 0; dx < step; dx += 1) {
          const at = ((y * step + dy) * width + (x * step + dx)) * 4;
          sum += 0.2126 * data[at]! + 0.7152 * data[at + 1]! + 0.0722 * data[at + 2]!;
        }
      }
      out[y * size + x] = sum * norm;
    }
  }
  return out;
}

/* ------------------------------------------------------------------------ */
/* The field extraction reads                                                 */
/* ------------------------------------------------------------------------ */

/**
 * The accumulator's probability map as an extraction field: `2p − 1` where the
 * pixel is at least CANDIDATE, zero elsewhere.
 *
 * Why not `p` itself: a pixel with no evidence has log-odds 0 and therefore
 * p = 0.5, so the raw map is half-lit wherever nothing is known, and
 * extraction's fixed 0.45 binarise would trace the whole palm. `2p − 1` =
 * tanh(l/2) is the same map with its zero where the evidence is zero: a
 * CANDIDATE at l = 0.5 reads 0.24 (under even the faint tier), a pixel crosses
 * LINE_THRESHOLD near l = 1, a TRACKING pixel (l > 1.5) reads over 0.63, and a
 * CONFIRMED one approaches 1. The state mask is the [A2] rule in the data:
 * nothing below CANDIDATE can reach extraction at all.
 */
export function evidenceFieldInto(acc: EvidenceAccumulator, out: Float32Array): Float32Array {
  const { probability, state } = acc;
  for (let i = 0; i < out.length; i += 1) {
    const p = probability[i] ?? 0;
    out[i] = (state[i] ?? 0) >= PIXEL_CANDIDATE && p > 0.5 ? 2 * p - 1 : 0;
  }
  return out;
}

/* ------------------------------------------------------------------------ */
/* The line hold                                                              */
/* ------------------------------------------------------------------------ */

export type RekhaLineState = "candidate" | "tracking" | "confirmed";

/** Fractions of a line's samples that decide its state (samples take the best pixel within one of the line). */
export const REKHA_CONFIRM_FRACTION = 0.6;
export const REKHA_TRACK_FRACTION = 0.5;
export const REKHA_CANDIDATE_FRACTION = 0.5;
/**
 * A CONFIRMED line is held while at least this fraction of its samples is
 * still at least CANDIDATE — i.e. until the pixels under it have dropped out of
 * the ladder (the accumulator's own `dropBelow`). 0.3 against 0.6 to confirm is
 * the line-level hysteresis: a line is not lost the moment it stops being
 * confirmable.
 */
export const REKHA_HOLD_FRACTION = 0.3;

export interface RekhaLine {
  readonly id: ActiveLineId;
  readonly state: RekhaLineState;
  /** Mask-space polyline. */
  readonly points: readonly (readonly [number, number])[];
  /**
   * Confirmation progress, 0–1: the mean log-odds along the line, from the
   * CANDIDATE threshold (0) to the CONFIRM threshold (1). The monitor grows a
   * TRACKING line's width and opacity by it.
   */
  readonly progress: number;
  /** True when this frame's extraction did not produce it and it is shown because it is held. */
  readonly held: boolean;
  /** The line's observed/unobserved stretches, as TracedLine carries them (S2: traced extension draws at 0.6). */
  readonly segments?: TracedLine["segments"];
  /** True when the geometry is the valley tracer's (flag rekhaTrace). */
  readonly traced?: boolean;
}

export interface RekhaSnapshot {
  readonly lines: Partial<Record<ActiveLineId, RekhaLine>>;
  /** At least one major line is CONFIRMED — the corridor search is released. */
  readonly anyConfirmed: boolean;
  /** CONFIRMED → lost → CONFIRMED transitions per line since the reset (the S1.5 flicker count). */
  readonly flicker: Readonly<Record<ActiveLineId, number>>;
  /** Milliseconds from the reset to each line's first CONFIRMED, null until it happens. */
  readonly firstConfirmedMs: Readonly<Record<ActiveLineId, number | null>>;
  /** Frames the accumulator has taken evidence from. */
  readonly frames: number;
  /** Milliseconds the last accumulator update took (evidence, field, hold) — the S1.5 cost figure. */
  readonly costMs: number;
}

interface Measure {
  readonly candidate: number;
  readonly tracking: number;
  readonly confirmed: number;
  readonly progress: number;
}

interface HeldLine {
  line: TracedLine;
  confirmedAt: number;
}

const zeroRecord = <T>(value: T): Record<ActiveLineId, T> =>
  Object.fromEntries(ACTIVE_LINE_IDS.map((id) => [id, value])) as Record<ActiveLineId, T>;

/**
 * Held lines, one per major crease, measured against the accumulator.
 *
 * Call {@link RekhaLineHold.update} after every accumulator update — with the
 * newest extraction when one was made this frame, else null — so states and
 * progress move at the evidence rate, not the (slower) extraction rate.
 */
export class RekhaLineHold {
  private readonly held = new Map<ActiveLineId, HeldLine>();
  private latest: LineExtraction | null = null;
  private readonly wasConfirmed = zeroRecord(false);
  private readonly lostSinceConfirm = zeroRecord(false);
  private readonly flicker = zeroRecord(0);
  private readonly firstConfirmed = zeroRecord<number | null>(null);
  private startedAt: number | null = null;
  private snapshotCache: RekhaSnapshot | null = null;

  reset(): void {
    this.held.clear();
    this.latest = null;
    for (const id of ACTIVE_LINE_IDS) {
      this.wasConfirmed[id] = false;
      this.lostSinceConfirm[id] = false;
      this.flicker[id] = 0;
      this.firstConfirmed[id] = null;
    }
    this.startedAt = null;
    this.snapshotCache = null;
  }

  /** Move every polyline with the accumulator's own translation (call after each update that shifted). */
  shift(dx: number, dy: number): void {
    if (dx === 0 && dy === 0) return;
    const move = (line: TracedLine): TracedLine => ({ ...line, points: line.points.map(([x, y]) => [x + dx, y + dy] as const) });
    for (const entry of this.held.values()) entry.line = move(entry.line);
    if (this.latest !== null) this.latest = shiftExtraction(this.latest, move);
  }

  /** Follow a convention remap: `pull` is the matrix the accumulator was resampled through (new → old). */
  remap(pull: Matrix3): void {
    const push = invertHomography(pull);
    if (push === null) {
      this.held.clear();
      this.latest = null;
      return;
    }
    const move = (line: TracedLine): TracedLine => ({
      ...line,
      points: line.points.map(([x, y]) => {
        const p = applyHomography(push, { x: x + 0.5, y: y + 0.5 });
        return p === null ? ([x, y] as const) : ([p.x - 0.5, p.y - 0.5] as const);
      }),
    });
    for (const entry of this.held.values()) entry.line = move(entry.line);
    if (this.latest !== null) this.latest = shiftExtraction(this.latest, move);
  }

  /**
   * Re-measure every line against the accumulator.
   * @param extraction this frame's extraction, or null to re-measure the last one.
   */
  update(acc: EvidenceAccumulator, extraction: LineExtraction | null, nowMs: number): RekhaSnapshot {
    if (this.startedAt === null) this.startedAt = nowMs;
    if (extraction !== null) this.latest = extraction;
    const lines: Partial<Record<ActiveLineId, RekhaLine>> = {};
    const opts = DEFAULT_EVIDENCE_OPTIONS;

    for (const id of ACTIVE_LINE_IDS) {
      const fresh = this.latest?.lines[id];
      const freshMeasure = fresh === undefined ? null : measureLine(acc, fresh.points, opts);
      const freshState = freshMeasure === null ? null : stateOf(freshMeasure);
      const held = this.held.get(id);

      let out: RekhaLine | undefined;
      if (held !== undefined) {
        if (fresh !== undefined && freshState === "confirmed") {
          // Re-found and still confirmed: take the newer trace (it may reach further), keep the hold.
          held.line = fresh;
          out = { id, state: "confirmed", points: fresh.points, progress: freshMeasure?.progress ?? 1, held: false, segments: fresh.segments, traced: fresh.traced };
        } else {
          const heldMeasure = measureLine(acc, held.line.points, opts);
          if (heldMeasure.candidate >= REKHA_HOLD_FRACTION) {
            out = { id, state: "confirmed", points: held.line.points, progress: heldMeasure.progress, held: true, segments: held.line.segments, traced: held.line.traced };
          } else {
            this.held.delete(id); // the evidence under it has gone: lost
          }
        }
      }
      if (out === undefined && fresh !== undefined && freshMeasure !== null && freshState !== null) {
        out = { id, state: freshState, points: fresh.points, progress: freshMeasure.progress, held: false, segments: fresh.segments, traced: fresh.traced };
        if (freshState === "confirmed") this.held.set(id, { line: fresh, confirmedAt: nowMs });
      }
      if (out !== undefined) lines[id] = out;

      // Flicker bookkeeping: CONFIRMED → lost → CONFIRMED counts once per return.
      const confirmed = out?.state === "confirmed";
      if (confirmed) {
        if (this.lostSinceConfirm[id]) this.flicker[id] += 1;
        this.lostSinceConfirm[id] = false;
        this.wasConfirmed[id] = true;
        if (this.firstConfirmed[id] === null) this.firstConfirmed[id] = nowMs - this.startedAt;
      } else if (this.wasConfirmed[id]) {
        this.lostSinceConfirm[id] = true;
      }
    }

    this.snapshotCache = {
      lines,
      anyConfirmed: ACTIVE_LINE_IDS.some((id) => lines[id]?.state === "confirmed"),
      flicker: { ...this.flicker },
      firstConfirmedMs: { ...this.firstConfirmed },
      frames: acc.frameCount,
      costMs: 0,
    };
    return this.snapshotCache;
  }

  /** The last snapshot, or null before the first update. */
  get snapshot(): RekhaSnapshot | null {
    return this.snapshotCache;
  }

  /** Held lines missing from `extraction`, to be drawn as if found — the live overlay's half of the hold. */
  heldMissingFrom(extraction: LineExtraction): Partial<Record<ActiveLineId, TracedLine>> {
    const out: Partial<Record<ActiveLineId, TracedLine>> = {};
    for (const [id, entry] of this.held) if (extraction.lines[id] === undefined) out[id] = entry.line;
    return out;
  }

  /** Whether a line is currently held CONFIRMED. */
  isHeld(id: ActiveLineId): boolean {
    return this.held.has(id);
  }
}

function shiftExtraction(extraction: LineExtraction, move: (line: TracedLine) => TracedLine): LineExtraction {
  const lines: Partial<Record<ActiveLineId, TracedLine>> = {};
  for (const id of ACTIVE_LINE_IDS) {
    const line = extraction.lines[id];
    if (line !== undefined) lines[id] = move(line);
  }
  return { ...extraction, lines };
}

function stateOf(m: Measure): RekhaLineState | null {
  if (m.confirmed >= REKHA_CONFIRM_FRACTION) return "confirmed";
  if (m.tracking >= REKHA_TRACK_FRACTION) return "tracking";
  if (m.candidate >= REKHA_CANDIDATE_FRACTION) return "candidate";
  return null;
}

/**
 * Walk a mask-space polyline at one-pixel steps; at each sample take the best
 * state and log-odds within one pixel (a traced crease and its evidence can
 * sit a pixel apart after rounding), and report the fraction of samples at
 * each rung plus the mean confirmation progress.
 */
export function measureLine(
  acc: EvidenceAccumulator,
  points: readonly (readonly [number, number])[],
  opts: EvidenceOptions = DEFAULT_EVIDENCE_OPTIONS,
): Measure {
  const { size, state, logOdds } = acc;
  let samples = 0;
  let candidate = 0;
  let tracking = 0;
  let confirmed = 0;
  let progress = 0;
  const span = opts.confirmAbove - opts.candidateAbove;
  const visit = (fx: number, fy: number): void => {
    const cx = Math.round(fx);
    const cy = Math.round(fy);
    let bestState = 0;
    let bestL = -Infinity;
    for (let dy = -1; dy <= 1; dy += 1) {
      const y = cy + dy;
      if (y < 0 || y >= size) continue;
      for (let dx = -1; dx <= 1; dx += 1) {
        const x = cx + dx;
        if (x < 0 || x >= size) continue;
        const at = y * size + x;
        const s = state[at] ?? 0;
        if (s > bestState) bestState = s;
        const l = logOdds[at] ?? 0;
        if (l > bestL) bestL = l;
      }
    }
    samples += 1;
    if (bestState >= PIXEL_CANDIDATE) candidate += 1;
    if (bestState >= PIXEL_TRACKING) tracking += 1;
    if (bestState >= PIXEL_CONFIRMED) confirmed += 1;
    const t = (bestL - opts.candidateAbove) / span;
    progress += t < 0 ? 0 : t > 1 ? 1 : t;
  };
  for (let k = 0; k < points.length; k += 1) {
    const [x0, y0] = points[k]!;
    const next = points[k + 1];
    if (next === undefined) {
      visit(x0, y0);
      break;
    }
    const [x1, y1] = next;
    const steps = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0)));
    for (let s = 0; s < steps; s += 1) visit(x0 + ((x1 - x0) * s) / steps, y0 + ((y1 - y0) * s) / steps);
  }
  if (samples === 0) return { candidate: 0, tracking: 0, confirmed: 0, progress: 0 };
  return { candidate: candidate / samples, tracking: tracking / samples, confirmed: confirmed / samples, progress: progress / samples };
}

/* ------------------------------------------------------------------------ */
/* The live rig                                                               */
/* ------------------------------------------------------------------------ */

/**
 * The accumulator, its extraction field and the hold, as one object the hook
 * owns. Constructed only when the flag is on.
 */
export class RekhaPersistence {
  readonly accumulator: EvidenceAccumulator;
  readonly hold = new RekhaLineHold();
  /** The extraction field, refreshed after every update. */
  readonly field: Float32Array;
  /** Milliseconds the last update took (accumulator + field + hold) — the S1.5 cost figure. */
  lastCostMs = 0;

  constructor(size: number, options: Partial<EvidenceOptions> = REKHA_PERSIST_EVIDENCE) {
    this.accumulator = new EvidenceAccumulator(size, options);
    this.field = new Float32Array(size * size);
  }

  reset(): void {
    this.accumulator.reset();
    this.field.fill(0);
    this.hold.reset();
  }

  /** Follow the EMA through a convention remap (the matrix `alignFusion` resampled with). */
  remap(pull: Matrix3): void {
    this.accumulator.remap(pull);
    evidenceFieldInto(this.accumulator, this.field);
    this.hold.remap(pull);
  }

  /**
   * Fold one frame in: evidence, the field, the hold's translation and states.
   * @param plane the per-frame field (the contract plane when fieldContract is on, else the legacy one).
   * @param gray the same frame's grayscale at the accumulator's size, for translation alignment.
   * @param weight frame quality, {@link rekhaFrameWeight}; below the accumulator's floor the frame is skipped.
   */
  observe(plane: Float32Array, gray: Float32Array, weight: number, nowMs: number): RekhaSnapshot {
    const t0 = performance.now();
    const { accumulator } = this;
    accumulator.update(plane, gray, weight);
    this.hold.shift(accumulator.lastShiftX, accumulator.lastShiftY);
    evidenceFieldInto(accumulator, this.field);
    const snapshot = this.hold.update(accumulator, null, nowMs);
    this.lastCostMs = performance.now() - t0;
    return { ...snapshot, costMs: this.lastCostMs };
  }

  /** Measure a new extraction (made from {@link field}) and return the snapshot with it. */
  extracted(extraction: LineExtraction, nowMs: number): RekhaSnapshot {
    return { ...this.hold.update(this.accumulator, extraction, nowMs), costMs: this.lastCostMs };
  }
}
