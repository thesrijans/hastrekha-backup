/**
 * Homomorphic illumination normalisation — flat-fielding the crop before any crease detection.
 *
 * The model is the standard one: an image is reflectance times illumination, `I = R · L`, with `L`
 * varying slowly across the palm. Estimating `L` by a large-radius blur of `I` and dividing it out
 * leaves reflectance, which is where the creases live. A palm lit from one side arrives with a
 * brightness ramp across it, and without this every downstream threshold means something different
 * on the bright side than the dark side.
 *
 * **Why this replaces CLAHE rather than joining it.** Both are local contrast normalisers over
 * comparable support, so running both normalises twice over the same scale — and worse, homomorphic
 * output is already flat-fielded to a narrow band around a fixed pedestal, so CLAHE would then
 * equalise that narrow histogram and stretch sensor noise to visible contrast in every tile that
 * happens to contain no crease. But the decisive reason is temporal. CLAHE is a per-tile,
 * content-dependent, rank-based map. Rectification puts the same skin on the same pixel, but it does
 * *not* put the same skin in the same tile: as the hand moves, new skin sweeps into the crop edges
 * and every tile's histogram shifts, so the value a given crease maps to changes discontinuously
 * between frames. That is a direct contributor to lines flickering as the hand moves, and it makes
 * any cross-frame comparison — the whole basis of the temporal stack in `stack.ts` — meaningless.
 * Division depends only on a 15px neighbourhood and is linear, so it is stable under motion.
 *
 * The honest counter-argument is that CLAHE does one thing division does not: it applies a monotone
 * nonlinearity that expands whatever contrast is present, lifting a barely-there crease into
 * visibility. That job is already owned by a better-placed stage — `normalizeResponses` in ridge.ts
 * scales the final discriminative field by a percentile of its own responses, which cannot invent
 * per-tile structure the way a per-tile equaliser can. `clahe()` remains exported and tested; it
 * simply leaves the default path.
 */

/**
 * Illumination blur radius, matching the specified 31-tap kernel: radius 15, σ 5.
 *
 * Two standard conventions agree at exactly 5.0 here, which is why it is not a taste call —
 * truncating at 3σ gives 15/3 = 5, and the usual `ksize → σ` default `0.3·((k−1)/2 − 1) + 0.8`
 * gives 0.3·14 + 0.8 = 5.
 */
export const ILLUM_SIGMA = 5;
export const ILLUM_RADIUS = 15;
/**
 * Box widths whose three passes approximate that Gaussian.
 *
 * Three successive box blurs converge to a Gaussian by the central limit theorem; the maximum
 * deviation from a variance-matched Gaussian is about 3%, which is meaningless in a quantity that is
 * about to be divided out. A box of odd width w has variance (w²−1)/12, so matching σ = 5 needs the
 * three variances to sum to 25: [9,11,11] gives 6.67 + 10 + 10 = 26.67, i.e. σ_eff = 5.16.
 *
 * Erring wide rather than narrow is deliberate. Too wide over-smooths the illuminant and leaves a
 * little residual shading, which is benign. Too narrow starts putting the creases themselves into
 * the illumination estimate, which divides them straight back out — the one failure that would make
 * this stage worse than doing nothing. The cost is independent of radius: three passes over two
 * axes, about seven times cheaper than the exact 31-tap convolution.
 */
export const ILLUM_BOX_WIDTHS: readonly number[] = [9, 11, 11];
/**
 * Floor on the illumination estimate — a floor, not an additive epsilon.
 *
 * `max(L, 0.06)` caps the amplification at about 17×, whereas `L + ε` still permits unbounded gain in
 * a near-black neighbourhood. That case is real and routine: `rectifyPalm` writes literal black
 * outside the source frame, so `L` ramps to zero near a clipped crop border, and an additive epsilon
 * turns the first genuine palm pixels inside that ramp into a saturated halo.
 */
export const ILLUM_FLOOR = 0.06;
/**
 * Where flat skin lands. A fixed affine map, never a per-frame percentile stretch — an adaptive
 * output scale would reintroduce exactly the frame-to-frame flicker this module exists to remove,
 * and would make the temporal stack comparing frames of different scales.
 */
export const ILLUM_PEDESTAL = 0.5;
/**
 * Reflectance-to-output gain. At 1.0 a ±50% local reflectance swing fills the full range; palm
 * creases sit 20–40% below their local mean, so they land at 0.10–0.30 against a 0.5 background.
 * That is the same band CLAHE put them in, which is why `SUPPORT_FLOOR`, `NORM_FLOOR` and
 * `LINE_THRESHOLD` downstream need no retuning.
 */
export const ILLUM_GAIN = 1;
/**
 * Mean luma below which normalisation is bypassed entirely.
 *
 * At ten code values out of 255 the sensor is in its noise floor and `I/L` is a ratio of noise to
 * noise. Normalising would manufacture full-contrast structure out of nothing, and the black-hat and
 * Gabor stages would faithfully trace it. The quality gate already has `too_dark` to tell the user;
 * returning amplified noise is strictly worse than returning the frame unchanged.
 */
export const ILLUM_DARK_BYPASS = 0.04;

interface Scratch {
  readonly a: Float32Array;
  readonly b: Float32Array;
  /** Dedicated destination for the illumination estimate, so it can never alias the ping-pong pair. */
  readonly light: Float32Array;
}

const scratchPool = new Map<number, Scratch>();

function scratchFor(size: number): Scratch {
  const cached = scratchPool.get(size);
  if (cached !== undefined) return cached;
  const fresh: Scratch = {
    a: new Float32Array(size * size),
    b: new Float32Array(size * size),
    light: new Float32Array(size * size),
  };
  scratchPool.set(size, fresh);
  return fresh;
}

/**
 * One horizontal box pass, replicate borders, via a running sum.
 *
 * The running sum makes the cost independent of the box width — three adds and a multiply per pixel
 * whatever the radius — which is the entire reason this approximation beats the exact convolution.
 * The accumulator is a float64 JS number even though the planes are Float32Array, so a 256-step
 * running sum accumulates no meaningful drift.
 */
function boxRows(src: Float32Array, dst: Float32Array, size: number, radius: number): void {
  const last = size - 1;
  const inverse = 1 / (2 * radius + 1);
  for (let y = 0; y < size; y += 1) {
    const base = y * size;
    let sum = 0;
    for (let t = -radius; t <= radius; t += 1) sum += src[base + (t < 0 ? 0 : t > last ? last : t)];
    dst[base] = sum * inverse;
    for (let x = 1; x < size; x += 1) {
      const add = x + radius;
      const drop = x - radius - 1;
      sum += src[base + (add > last ? last : add)] - src[base + (drop < 0 ? 0 : drop)];
      dst[base + x] = sum * inverse;
    }
  }
}

/** The same pass down columns. Strided, but a running sum keeps it to one read and one write per pixel. */
function boxCols(src: Float32Array, dst: Float32Array, size: number, radius: number): void {
  const last = size - 1;
  const inverse = 1 / (2 * radius + 1);
  for (let x = 0; x < size; x += 1) {
    let sum = 0;
    for (let t = -radius; t <= radius; t += 1) sum += src[(t < 0 ? 0 : t > last ? last : t) * size + x];
    dst[x] = sum * inverse;
    for (let y = 1; y < size; y += 1) {
      const add = y + radius;
      const drop = y - radius - 1;
      sum += src[(add > last ? last : add) * size + x] - src[(drop < 0 ? 0 : drop) * size + x];
      dst[y * size + x] = sum * inverse;
    }
  }
}

/**
 * Three-pass box blur approximating a Gaussian of {@link ILLUM_SIGMA}.
 *
 * Ping-ponged between two scratch planes so nothing is allocated per frame; three passes is an odd
 * count, so the parity works out to land in `dst` without a final copy.
 */
export function illuminationBlur(
  src: Float32Array,
  dst: Float32Array,
  size: number,
  widths: readonly number[] = ILLUM_BOX_WIDTHS,
): void {
  const { a, b } = scratchFor(size);
  let from = src;
  let to = a;
  for (let pass = 0; pass < widths.length; pass += 1) {
    const radius = (widths[pass] - 1) / 2;
    boxRows(from, to, size, radius);
    from = to;
    to = to === a ? b : a;
  }
  // Vertical passes, finishing in dst.
  for (let pass = 0; pass < widths.length; pass += 1) {
    const radius = (widths[pass] - 1) / 2;
    const last = pass === widths.length - 1;
    boxCols(from, last ? dst : to, size, radius);
    if (last) break;
    from = to;
    to = to === a ? b : a;
  }
}

export interface NormaliseResult {
  /** Flat-fielded crop, 0–1, centred on {@link ILLUM_PEDESTAL}. */
  readonly out: Float32Array;
  /**
   * True when the crop was too dark to normalise and was passed through unchanged. Callers must not
   * push a bypassed frame into the temporal stack — its photometric scale is not comparable.
   */
  readonly bypassed: boolean;
  readonly meanLuma: number;
}

/**
 * Divides out the illumination.
 *
 * @param validity optional per-pixel mask, 1 where the crop sampled real frame content. Pixels
 * outside it are written as the pedestal rather than left at whatever the division produced —
 * `rectifyPalm` fills them with black, and the step from black to mid-grey at the crop border is
 * exactly the edge black-hat responds to, producing a spurious band along the border on every frame.
 */
export function normaliseIllumination(
  gray: Float32Array,
  size: number,
  out: Float32Array,
  validity: Uint8Array | null = null,
): NormaliseResult {
  const plane = size * size;
  let sum = 0;
  for (let i = 0; i < plane; i += 1) sum += gray[i];
  const meanLuma = plane === 0 ? 0 : sum / plane;

  if (meanLuma < ILLUM_DARK_BYPASS) {
    out.set(gray);
    return { out, bypassed: true, meanLuma };
  }

  // A dedicated plane: illuminationBlur ping-pongs through `a`/`b`, so its destination must be neither.
  const light = scratchFor(size).light;
  illuminationBlur(gray, light, size);

  for (let i = 0; i < plane; i += 1) {
    if (validity !== null && validity[i] === 0) {
      out[i] = ILLUM_PEDESTAL;
      continue;
    }
    const reflectance = gray[i] / Math.max(light[i], ILLUM_FLOOR);
    const value = ILLUM_PEDESTAL + (reflectance - 1) * ILLUM_GAIN;
    out[i] = value < 0 ? 0 : value > 1 ? 1 : value;
  }

  return { out, bypassed: false, meanLuma };
}
