/**
 * @file Temporal evidence accumulator for live rekha detection.
 *
 * Replaces exponential-moving-average fusion with per-pixel log-odds
 * accumulation plus a hysteresis state machine. Each frame contributes
 * evidence e = logit(p) − logit(p₀), where p₀ is the response level expected
 * under the null hypothesis (no crease). Evidence is weighted by frame quality
 * so a blurry or badly rectified frame adds little, and decays so stale
 * evidence fades. State transitions use separate up and down thresholds and a
 * confirmation count, which is what stops confirmed lines flickering and stops
 * a single lucky frame confirming noise.
 *
 * Before each update the accumulator is aligned to the new frame by a
 * translation estimated between consecutive grayscale frames. Rectification
 * already removes most hand motion; what remains is landmark jitter of a few
 * pixels, which is enough to smear a thin line if ignored.
 *
 * Layer: lib/scan/enhance (production). Pure. Imports nothing from lib/scan/dev.
 */

export const PIXEL_NONE = 0;
export const PIXEL_CANDIDATE = 1;
export const PIXEL_TRACKING = 2;
export const PIXEL_CONFIRMED = 3;
export type PixelState = typeof PIXEL_NONE | typeof PIXEL_CANDIDATE | typeof PIXEL_TRACKING | typeof PIXEL_CONFIRMED;

export interface EvidenceOptions {
  /** Per-frame retention of log-odds. 0.9 gives a memory of roughly ten frames. */
  readonly decay: number;
  /**
   * Null-hypothesis response level. Calibrate to the noise floor of the
   * ENHANCED response (after coherence gating), not of the raw detector.
   */
  readonly nullLevel: number;
  /** Responses are clamped to [c, 1 − c] before logit to bound single-frame evidence. */
  readonly probabilityClamp: number;
  /** Evidence with magnitude below this is ignored, suppressing random-walk drift. */
  readonly deadband: number;
  /** Absolute clamp on accumulated log-odds. */
  readonly logOddsMax: number;
  /** NONE → CANDIDATE above this. */
  readonly candidateAbove: number;
  /** CANDIDATE → TRACKING above this; CONFIRMED → TRACKING below it. */
  readonly trackingAbove: number;
  /** TRACKING → CONFIRMED after `confirmFrames` consecutive frames above this. */
  readonly confirmAbove: number;
  /** Consecutive frames required above `confirmAbove`. */
  readonly confirmFrames: number;
  /** Any state → NONE below this. */
  readonly dropBelow: number;
  /** Frames with weight below this are skipped entirely (no decay, no shift). */
  readonly minFrameWeight: number;
  /** Enable translation compensation between frames. */
  readonly motionEnabled: boolean;
  /** Box-downsample factor for the coarse shift search. */
  readonly motionDownsample: number;
  /** Coarse search radius in downsampled pixels. */
  readonly motionSearch: number;
  /** Full-resolution refinement radius around the coarse estimate. */
  readonly motionRefine: number;
  /** A shift is applied only if its SAD is at most this fraction of the zero-shift SAD. */
  readonly motionMinGain: number;
  /**
   * Relative SAD penalty per pixel of displacement. Regularises toward zero
   * motion when the image cannot disambiguate (a straight crease with little
   * texture is an aperture problem: motion along it is unobservable).
   */
  readonly motionShiftPenalty: number;
  /**
   * Coarse-to-fine translation search. Off (the default), the shift is found
   * exhaustively at ±`motionSearch` on the `motionDownsample` grid. On, the
   * same range is searched at ±ceil(motionSearch / 2) on a grid twice as
   * coarse, refined ±1 on the `motionDownsample` grid, then ±`motionRefine` at
   * full resolution — the same reach for about a third of the comparisons.
   * Its limit: a texture that repeats faster than twice the coarse cell (under
   * ~8 px at the default downsample) aliases on the coarse grid and can lead
   * the search to a false minimum; one with an 18 px period or longer is found
   * exactly. Rectified palm luma — broad shading, thin creases, unperiodic skin —
   * is the second kind.
   */
  readonly motionPyramid: boolean;
}

export const DEFAULT_EVIDENCE_OPTIONS: EvidenceOptions = {
  decay: 0.9,
  nullLevel: 0.06,
  probabilityClamp: 0.02,
  deadband: 0.3,
  logOddsMax: 6,
  candidateAbove: 0.5,
  trackingAbove: 1.5,
  confirmAbove: 2.5,
  confirmFrames: 3,
  dropBelow: -0.5,
  minFrameWeight: 0.05,
  motionEnabled: true,
  motionDownsample: 2,
  motionSearch: 4,
  motionRefine: 1,
  motionMinGain: 0.85,
  motionShiftPenalty: 0.02,
  motionPyramid: false,
};

function logit(p: number): number {
  return Math.log(p / (1 - p));
}

/**
 * Copy `src` into `dst` shifted by (dx, dy); vacated cells receive `fill`.
 * dst[y][x] = src[y − dy][x − dx].
 */
function shiftInto(
  src: Float32Array | Uint8Array,
  dst: Float32Array | Uint8Array,
  size: number,
  dx: number,
  dy: number,
  fill: number,
): void {
  for (let y = 0; y < size; y += 1) {
    const sy = y - dy;
    const rowValid = sy >= 0 && sy < size;
    const row = y * size;
    const srow = sy * size;
    for (let x = 0; x < size; x += 1) {
      const sx = x - dx;
      dst[row + x] = rowValid && sx >= 0 && sx < size ? (src[srow + sx] ?? fill) : fill;
    }
  }
}

/** Mean absolute difference between `cur` and `prev` shifted by (dx, dy). */
function meanAbsDiff(cur: Float32Array, prev: Float32Array, size: number, dx: number, dy: number): number {
  let sum = 0;
  let count = 0;
  const y0 = Math.max(0, dy);
  const y1 = Math.min(size, size + dy);
  const x0 = Math.max(0, dx);
  const x1 = Math.min(size, size + dx);
  for (let y = y0; y < y1; y += 1) {
    const row = y * size;
    const prow = (y - dy) * size;
    for (let x = x0; x < x1; x += 1) {
      sum += Math.abs((cur[row + x] ?? 0) - (prev[prow + x - dx] ?? 0));
      count += 1;
    }
  }
  return count > 0 ? sum / count : Number.POSITIVE_INFINITY;
}

/**
 * Per-pixel temporal evidence with hysteresis and motion compensation.
 * Allocates once; `update` is allocation-free.
 */
export class EvidenceAccumulator {
  readonly size: number;
  /** Accumulated log-odds per pixel. */
  readonly logOdds: Float32Array;
  /** Probability per pixel, σ(logOdds), refreshed after each update. */
  readonly probability: Float32Array;
  /** State per pixel: one of PIXEL_*. */
  readonly state: Uint8Array;
  /** Translation applied before the most recent update, in full-resolution pixels. */
  lastShiftX = 0;
  lastShiftY = 0;
  /** Number of frames that contributed evidence. */
  frameCount = 0;

  private readonly options: EvidenceOptions;
  private readonly confirmCount: Uint8Array;
  private readonly scratchF: Float32Array;
  private readonly scratchU: Uint8Array;
  private readonly prevGray: Float32Array;
  private readonly lowSize: number;
  private readonly lowCur: Float32Array;
  private readonly lowPrev: Float32Array;
  private readonly coarseSize: number;
  private readonly coarseCur: Float32Array;
  private readonly coarsePrev: Float32Array;
  private readonly logitNull: number;
  private hasPrev = false;

  constructor(size: number, options?: Partial<EvidenceOptions>) {
    this.size = size;
    this.options = { ...DEFAULT_EVIDENCE_OPTIONS, ...options };
    const n = size * size;
    this.logOdds = new Float32Array(n);
    this.probability = new Float32Array(n);
    this.state = new Uint8Array(n);
    this.confirmCount = new Uint8Array(n);
    this.scratchF = new Float32Array(n);
    this.scratchU = new Uint8Array(n);
    this.prevGray = new Float32Array(n);
    this.lowSize = Math.max(1, Math.floor(size / this.options.motionDownsample));
    this.lowCur = new Float32Array(this.lowSize * this.lowSize);
    this.lowPrev = new Float32Array(this.lowSize * this.lowSize);
    this.coarseSize = this.options.motionPyramid ? Math.max(1, Math.floor(this.lowSize / 2)) : 0;
    this.coarseCur = new Float32Array(this.coarseSize * this.coarseSize);
    this.coarsePrev = new Float32Array(this.coarseSize * this.coarseSize);
    this.logitNull = logit(this.options.nullLevel);
  }

  /** Clear all evidence and motion history. */
  reset(): void {
    this.logOdds.fill(0);
    this.probability.fill(0);
    this.state.fill(PIXEL_NONE);
    this.confirmCount.fill(0);
    this.hasPrev = false;
    this.lastShiftX = 0;
    this.lastShiftY = 0;
    this.frameCount = 0;
  }

  /**
   * Fold one frame of evidence into the accumulator.
   * @param response Enhanced crease response in [0, 1], size×size row-major.
   * @param gray Grayscale frame in [0, 1] used for motion alignment.
   * @param frameWeight Frame quality in [0, 1]; frames below `minFrameWeight` are skipped.
   */
  update(response: Float32Array, gray: Float32Array, frameWeight: number): void {
    const { options } = this;
    if (!(frameWeight >= options.minFrameWeight)) {
      this.lastShiftX = 0;
      this.lastShiftY = 0;
      return;
    }

    if (options.motionEnabled) {
      this.alignToFrame(gray);
    } else {
      this.lastShiftX = 0;
      this.lastShiftY = 0;
    }

    const { logOdds, probability, state, confirmCount } = this;
    const w = frameWeight > 1 ? 1 : frameWeight;
    const clampLo = options.probabilityClamp;
    const clampHi = 1 - options.probabilityClamp;
    const { decay, deadband, logOddsMax, candidateAbove, trackingAbove, confirmAbove, confirmFrames, dropBelow } = options;

    for (let i = 0; i < logOdds.length; i += 1) {
      let p = response[i] ?? 0;
      if (p < clampLo) p = clampLo;
      else if (p > clampHi) p = clampHi;
      let e = logit(p) - this.logitNull;
      if (e > -deadband && e < deadband) e = 0;

      let l = decay * (logOdds[i] ?? 0) + w * e;
      if (l > logOddsMax) l = logOddsMax;
      else if (l < -logOddsMax) l = -logOddsMax;
      logOdds[i] = l;
      probability[i] = 1 / (1 + Math.exp(-l));

      const s = state[i] ?? PIXEL_NONE;
      let next: number = s;
      if (l < dropBelow) {
        next = PIXEL_NONE;
      } else if (s === PIXEL_NONE) {
        if (l > candidateAbove) next = PIXEL_CANDIDATE;
      } else if (s === PIXEL_CANDIDATE) {
        if (l > trackingAbove) next = PIXEL_TRACKING;
      } else if (s === PIXEL_CONFIRMED) {
        if (l < trackingAbove) next = PIXEL_TRACKING;
      }

      if (next === PIXEL_TRACKING) {
        if (l > confirmAbove) {
          const c = (confirmCount[i] ?? 0) + 1;
          confirmCount[i] = c > 255 ? 255 : c;
          if (c >= confirmFrames) next = PIXEL_CONFIRMED;
        } else {
          confirmCount[i] = 0;
        }
      } else if (next !== PIXEL_CONFIRMED) {
        confirmCount[i] = 0;
      }
      state[i] = next;
    }

    this.prevGray.set(gray);
    this.hasPrev = true;
    this.frameCount += 1;
  }

  /**
   * Resample all evidence through a pull homography — `m` maps a destination
   * pixel centre to its source position, in this accumulator's own pixel
   * space: the matrix and the convention `fusion.ts` `warpField` use, so an
   * accumulator remapped here stays registered with the EMA remapped there.
   * Log-odds resample bilinearly; the state and the confirmation count
   * nearest-neighbour, because a state is a label and a count is a count.
   * Cells pulled from outside the field become NONE with zero evidence —
   * newly revealed skin has no history. Motion history is dropped: the
   * previous frame lives in the old space, so the next update does not align.
   */
  remap(m: readonly number[]): void {
    const { size, logOdds, state, confirmCount, scratchF, scratchU } = this;
    const [a = 1, b = 0, c = 0, d = 0, e = 1, f = 0, g = 0, h = 0, i = 1] = m;
    const counts = new Uint8Array(size * size);
    for (let y = 0; y < size; y += 1) {
      const py = y + 0.5;
      for (let x = 0; x < size; x += 1) {
        const px = x + 0.5;
        const at = y * size + x;
        const w = g * px + h * py + i;
        const sx = Math.abs(w) < 1e-12 ? -1 : (a * px + b * py + c) / w - 0.5;
        const sy = Math.abs(w) < 1e-12 ? -1 : (d * px + e * py + f) / w - 0.5;
        if (!(sx >= 0 && sy >= 0 && sx <= size - 1 && sy <= size - 1)) {
          scratchF[at] = 0;
          scratchU[at] = PIXEL_NONE;
          counts[at] = 0;
          continue;
        }
        const x0 = sx | 0;
        const y0 = sy | 0;
        const x1 = x0 + 1 > size - 1 ? size - 1 : x0 + 1;
        const y1 = y0 + 1 > size - 1 ? size - 1 : y0 + 1;
        const fx = sx - x0;
        const fy = sy - y0;
        const l00 = logOdds[y0 * size + x0] ?? 0;
        const top = l00 + ((logOdds[y0 * size + x1] ?? 0) - l00) * fx;
        const l01 = logOdds[y1 * size + x0] ?? 0;
        const bottom = l01 + ((logOdds[y1 * size + x1] ?? 0) - l01) * fx;
        scratchF[at] = top + (bottom - top) * fy;
        const near = Math.round(sy) * size + Math.round(sx);
        scratchU[at] = state[near] ?? PIXEL_NONE;
        counts[at] = confirmCount[near] ?? 0;
      }
    }
    logOdds.set(scratchF);
    state.set(scratchU);
    confirmCount.set(counts);
    for (let k = 0; k < logOdds.length; k += 1) this.probability[k] = 1 / (1 + Math.exp(-(logOdds[k] ?? 0)));
    this.hasPrev = false;
    this.lastShiftX = 0;
    this.lastShiftY = 0;
  }

  private downsample(gray: Float32Array, out: Float32Array): void {
    const { size, lowSize } = this;
    const d = this.options.motionDownsample;
    const inv = 1 / (d * d);
    for (let ly = 0; ly < lowSize; ly += 1) {
      for (let lx = 0; lx < lowSize; lx += 1) {
        let sum = 0;
        const y0 = ly * d;
        const x0 = lx * d;
        for (let yy = 0; yy < d; yy += 1) {
          const row = (y0 + yy) * size;
          for (let xx = 0; xx < d; xx += 1) {
            sum += gray[row + x0 + xx] ?? 0;
          }
        }
        out[ly * lowSize + lx] = sum * inv;
      }
    }
  }

  private alignToFrame(gray: Float32Array): void {
    const { options, size, lowSize, lowCur, lowPrev } = this;
    this.downsample(gray, lowCur);
    let shiftX = 0;
    let shiftY = 0;

    if (this.options.motionPyramid) this.halve(lowCur, this.coarseCur, lowSize, this.coarseSize);

    if (this.hasPrev) {
      const search = options.motionSearch;
      const d = options.motionDownsample;
      const penalty = options.motionShiftPenalty;
      let best = Number.POSITIVE_INFINITY;
      let bestDx = 0;
      let bestDy = 0;
      let zero = Number.POSITIVE_INFINITY;
      // Candidates on the motionDownsample grid: every offset within ±search, or — coarse-to-fine —
      // the ±1 neighbourhood of the best offset found at half that resolution.
      let cx0 = -search;
      let cx1 = search;
      let cy0 = -search;
      let cy1 = search;
      if (options.motionPyramid) {
        const cs = Math.ceil(search / 2);
        let cBest = Number.POSITIVE_INFINITY;
        let cDx = 0;
        let cDy = 0;
        for (let dy = -cs; dy <= cs; dy += 1) {
          for (let dx = -cs; dx <= cs; dx += 1) {
            const sad = meanAbsDiff(this.coarseCur, this.coarsePrev, this.coarseSize, dx, dy);
            const score = sad * (1 + penalty * 2 * d * (Math.abs(dx) + Math.abs(dy)));
            if (score < cBest) {
              cBest = score;
              cDx = dx;
              cDy = dy;
            }
          }
        }
        cx0 = Math.max(-search, 2 * cDx - 1);
        cx1 = Math.min(search, 2 * cDx + 1);
        cy0 = Math.max(-search, 2 * cDy - 1);
        cy1 = Math.min(search, 2 * cDy + 1);
        zero = meanAbsDiff(lowCur, lowPrev, lowSize, 0, 0);
      }
      for (let dy = cy0; dy <= cy1; dy += 1) {
        for (let dx = cx0; dx <= cx1; dx += 1) {
          const sad = meanAbsDiff(lowCur, lowPrev, lowSize, dx, dy);
          if (dx === 0 && dy === 0) zero = sad;
          const score = sad * (1 + penalty * d * (Math.abs(dx) + Math.abs(dy)));
          if (score < best) {
            best = score;
            bestDx = dx;
            bestDy = dy;
          }
        }
      }

      if ((bestDx !== 0 || bestDy !== 0) && best <= options.motionMinGain * zero) {
        const cx = bestDx * d;
        const cy = bestDy * d;
        const refine = options.motionRefine;
        let bestFull = Number.POSITIVE_INFINITY;
        for (let dy = -refine; dy <= refine; dy += 1) {
          for (let dx = -refine; dx <= refine; dx += 1) {
            const fx = cx + dx;
            const fy = cy + dy;
            const sad = meanAbsDiff(gray, this.prevGray, size, fx, fy);
            const score = sad * (1 + penalty * (Math.abs(fx) + Math.abs(fy)));
            if (score < bestFull) {
              bestFull = score;
              shiftX = fx;
              shiftY = fy;
            }
          }
        }
      }
    }

    if (shiftX !== 0 || shiftY !== 0) {
      shiftInto(this.logOdds, this.scratchF, size, shiftX, shiftY, 0);
      this.logOdds.set(this.scratchF);
      shiftInto(this.state, this.scratchU, size, shiftX, shiftY, PIXEL_NONE);
      this.state.set(this.scratchU);
      shiftInto(this.confirmCount, this.scratchU, size, shiftX, shiftY, 0);
      this.confirmCount.set(this.scratchU);
    }

    this.lastShiftX = shiftX;
    this.lastShiftY = shiftY;
    lowPrev.set(lowCur);
    if (options.motionPyramid) this.coarsePrev.set(this.coarseCur);
  }

  /** 2×2 box average of a square `size` grid into a `half` grid. */
  private halve(src: Float32Array, dst: Float32Array, size: number, half: number): void {
    for (let y = 0; y < half; y += 1) {
      const a = 2 * y * size;
      const b = a + size;
      for (let x = 0; x < half; x += 1) {
        const at = 2 * x;
        dst[y * half + x] = ((src[a + at] ?? 0) + (src[a + at + 1] ?? 0) + (src[b + at] ?? 0) + (src[b + at + 1] ?? 0)) * 0.25;
      }
    }
  }
}
