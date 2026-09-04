/**
 * THE FIELD CONTRACT (H9): the field means P(crease at this pixel).
 *
 * Measurable statement, and the two numbers every consumer may rely on:
 *
 *   - background p99 <= 0.15   (non-crease palm skin stays LOW)
 *   - hand-traced centreline median >= 0.6   (a real crease reads HIGH)
 *
 * Why an absolute anchor is needed at all: both existing detector normalisers are per-frame
 * percentiles — ridge.ts `normalizeResponses` scales its own 99th percentile to 1.0, frangi fixes
 * `c` from a pooled 99.5th percentile — so the brightest 1% of WHATEVER is present saturates,
 * crease or bare skin (measured: background p99 0.74–1.0 on the two GT hands). And CLAHE is
 * adaptive per-tile amplification, so anything sampled after it has already had its absolute scale
 * equalised away. The only plane that still carries absolute units is the PRE-CLAHE black-hat
 * depth response on the illumination-normalised luma: a crease of physical depth A produces a
 * response proportional to A in raw luma units, whether or not it is the brightest thing in frame.
 * That plane (ridge.ts `detectRidges`' optional `raw` out-param) is the contract's anchor; the
 * percentile-normalised gabor/frangi maps survive only as a SHAPE gate that can reduce, never
 * raise.
 *
 * Deliberately out of scope here: completion.ts's gate constants (ACCEPT_ENERGY 0.3,
 * OBSERVED_ENERGY_FLOOR 0.405, MIN_BIN_WEIGHT 0.9, …) were derived from the LEGACY field's
 * statistics ("a binarised crease sits near 0.55, a gap near 0.15") and are only correct on that
 * scale. They are revisited at freeze-lift when the contract field becomes the default — not in
 * this flag-gated step, where completion continues to consume whichever plane extraction reads.
 */

/** The two calibrated parameters of the depth anchor's sigmoid. */
export interface ContractParams {
  /** Raw-luma depth at which P(crease) crosses 0.5. */
  readonly d0: number;
  /** Sigmoid width, raw luma units. */
  readonly s: number;
}

/**
 * PROVISIONAL — written by `npm run eval -- --calibrate-contract` (two-pass: measure the raw
 * depth-plane distribution on GT, then grid-search d0/s maximising centreline-vs-background
 * separation subject to background p99 <= 0.15). The JSDoc below is refreshed by that command
 * with the GT census, date, and measured margins.
 *
 * Calibration 2026-09-04 (PROVISIONAL): GT census lines-current-02, lines-missing-tilt-03; centre median 0.000, worst bg p99 0.933 (target <= 0.15).
 */
export const CONTRACT_DEPTH_DEFAULTS: ContractParams = { d0: 0.0917, s: 0.0098 };

/**
 * Shape-gate exponent. The percentile maps are trusted for WHERE ridge-like structure is, not for
 * how strong it is; the square root softens their per-frame scale so the gate attenuates
 * non-ridge pixels without deciding the level — the depth term keeps that job.
 */
export const CONTRACT_SHAPE_GAMMA = 0.5;

/** UNet weight in the noisy-OR. Matches the legacy blend's trust in the model (segmenter.ts 0.7). */
export const CONTRACT_UNET_WEIGHT = 0.7;

const sigmoid = (x: number): number => 1 / (1 + Math.exp(-x));

/**
 * One frame of the contract field, into a caller-owned plane.
 *
 * `depthTerm = σ((depthRaw − d0)/s)` is the absolute anchor. `shapeGate = max(gabor, frangi)^γ`
 * can only REDUCE it (both inputs are 0–1). The UNet joins by noisy-OR — two independent
 * witnesses of the same crease — so it can raise a probability but never past 1, and there is no
 * cap and no 0.55 ridge floor: an empty palm is allowed to read empty.
 *
 * `params` is explicit rather than defaulted so tests calibrate to their own synthetics and the
 * production calibration can move without touching a single test expectation.
 */
export function contractFrameInto(
  depthRaw: Float32Array,
  gaborNorm: Float32Array,
  frangiNorm: Float32Array,
  unetProb: Float32Array | null,
  params: ContractParams,
  out: Float32Array,
): void {
  const n = out.length;
  for (let i = 0; i < n; i += 1) {
    const depthTerm = sigmoid((depthRaw[i] - params.d0) / params.s);
    const shape = gaborNorm[i] > frangiNorm[i] ? gaborNorm[i] : frangiNorm[i];
    const shapeGate = Math.pow(Math.max(0, shape), CONTRACT_SHAPE_GAMMA);
    const pClassical = depthTerm * shapeGate;
    out[i] =
      unetProb === null
        ? pClassical
        : 1 - (1 - pClassical) * (1 - CONTRACT_UNET_WEIGHT * unetProb[i]);
  }
}

export interface ContractStats {
  /** Median of the field on centreline-mask pixels; null when no mask (or an empty one) is given. */
  readonly centrelineMedian: number | null;
  /** p99 of the field on background-mask pixels; null when no mask (or an empty one) is given. */
  readonly backgroundP99: number | null;
  readonly mean: number;
}

const quantileOf = (values: number[], q: number): number => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
};

/**
 * The two contract numbers (plus the mean), from optional pixel masks. The eval's columns and the
 * diagnostics HUD both call THIS function, so the number in a report and the number on screen can
 * never be computed two different ways.
 */
export function contractStats(
  field: Float32Array,
  size: number,
  centrelineMask?: Uint8Array,
  backgroundMask?: Uint8Array,
): ContractStats {
  let sum = 0;
  for (let i = 0; i < field.length; i += 1) sum += field[i];
  const collect = (mask?: Uint8Array): number[] => {
    if (mask === undefined || mask.length !== size * size) return [];
    const values: number[] = [];
    for (let i = 0; i < mask.length; i += 1) if (mask[i] === 1) values.push(field[i]);
    return values;
  };
  const centre = collect(centrelineMask);
  const background = collect(backgroundMask);
  return {
    centrelineMedian: centre.length === 0 ? null : quantileOf(centre, 0.5),
    backgroundP99: background.length === 0 ? null : quantileOf(background, 0.99),
    mean: sum / field.length,
  };
}
