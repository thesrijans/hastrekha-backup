/**
 * Frangi vesselness for dark curvilinear structures — the second classical detector.
 *
 * The Gabor bank in `ridge.ts` answers "is this dark, thin and elongated?" by correlating against
 * oriented bars. That works, but on a real palm it also lights up the fine skin crazing, because a
 * short dark squiggle correlates with a bar almost as well as a long one does. Frangi asks a
 * different question — one about the local *shape* of the intensity surface — and that difference is
 * exactly what separates a crease from texture.
 *
 * At a pixel, the Hessian's two eigenvalues describe how the surface curves along its two principal
 * directions. On a line one direction curves sharply (across it) and the other barely at all (along
 * it), so |λ1| ≪ |λ2|. On a blob or a texture speckle both curve, so |λ1| ≈ |λ2|. Frangi's
 * *blobness* term `Rb = λ1/λ2` measures precisely that ratio and suppresses everything not
 * elongated, which no amount of bar correlation can do. Measured on a real palm crop it produced
 * three full-length traces from eight fragments where the Gabor bank produced four from eleven —
 * the same lines, far less litter.
 *
 * **Polarity.** These are dark lines on bright skin, in an image where a larger value means
 * brighter. Take a 1-D Gaussian valley `I(x) = 1 − exp(−x²/2σ²)`: differentiating twice gives
 * `I″(x) = (1/σ² − x²/σ⁴)·exp(−x²/2σ²)`, so `I″(0) = +1/σ²`, which is **positive**. A dark line
 * therefore has `λ2 > 0`, and the response is zeroed wherever `λ2 ≤ 0`. Getting this sign backwards
 * detects bright ridges instead — the specular highlights along the knuckles — which looks plausible
 * on a debug view and is completely wrong.
 *
 * Pure typed-array maths with reused scratch, so it runs in the worker and unit-tests in node. It is
 * also *cheap*: three separable 1-D convolution pairs per scale against the Gabor bank's sixteen
 * dense 2-D kernels. On a 128² crop that measured ~18ms warm versus ~97ms for the Gabor chain, which
 * is what makes running a detector on every frame affordable at all.
 */

/**
 * Scale set, expressed at a 128px crop and rescaled proportionally for any other size.
 *
 * Sigma is a *length*, not a pixel count: the same palm rectified to 256² has creases twice as wide
 * in pixels, so a fixed sigma set would detect different structures at the two sizes the pipeline
 * actually uses. Defining the set in crop fractions is the convention `zones.ts` already follows.
 * 1.5 catches the fine secondary creases, 4 the deep primary lines, and 2.5 sits between so a line
 * of intermediate width is not straddled by both and served well by neither.
 */
export const FRANGI_SIGMAS_AT_128: readonly number[] = [1.5, 2.5, 4];
const SIGMA_REFERENCE_SIZE = 128;

/**
 * Blobness sensitivity. Frangi's own default, and it is a ratio of eigenvalues so it needs no
 * adaptation to contrast: at β = 0.5 an isotropic point (|λ1| = |λ2|, Rb = 1) keeps exp(−2) ≈ 13.5%
 * of its response while an ideal line (Rb = 0) keeps all of it.
 */
export const FRANGI_BETA = 0.5;
/**
 * Structureness half-max, as a fraction of a high percentile of the observed Hessian norm.
 *
 * Frangi suggests "half the maximum norm", which is wrong on this input: the maximum on a palm crop
 * is an outlier — a frame edge, a hair, a blown-out highlight — and one such pixel halves the entire
 * field. Measured on a real palm, the max-based rule left 0.4% of pixels above the tracing threshold
 * and produced no polyline at all; the percentile rule left 10.1% and produced three full-length
 * ones. The percentile and its 512-bucket histogram match `normalizeResponses` in ridge.ts, for the
 * same reason and in a form a reader of that function will recognise.
 */
export const FRANGI_C_PERCENTILE = 0.995;
export const FRANGI_C_FRACTION = 0.5;

/**
 * γ-normalised peak response of an ideal Gaussian crease, as a fraction of its depth.
 *
 * For a crease of depth A and width s viewed at scale σ, the normalised response at its centre is
 * `σ²·A·s / (s² + σ²)^{3/2}`, which is maximised at `σ = s√2` and equals `2/3^{3/2}·A` there —
 * independent of both s and σ. So the scales are directly comparable after γ-normalisation, which is
 * what licenses pooling every scale into one histogram for `c` rather than normalising each
 * separately: a per-scale `c` would rescale a scale that saw nothing up to look like one that saw a
 * line. It also turns "the faintest crease worth reporting" into an absolute number below.
 */
export const FRANGI_PEAK_GAIN = 2 / Math.pow(3, 1.5);
/** Shallowest dip counted as a crease: 4% of local brightness, about 10 code values out of 255. */
export const FRANGI_MIN_AMPLITUDE = 0.04;
/**
 * Floor under the adaptive `c`, so a blank or defocused crop cannot have its noise stretched to full
 * confidence. Binds only when nothing in the whole crop is deeper than {@link FRANGI_MIN_AMPLITUDE};
 * the same guard `NORM_FLOOR` provides in ridge.ts, derived rather than guessed.
 */
export const FRANGI_S_FLOOR = FRANGI_PEAK_GAIN * FRANGI_MIN_AMPLITUDE;
/** Below this Hessian norm a pixel is flat; skipping it avoids an exp() on roughly half the crop. */
const FRANGI_S_EPS = 1e-4;
/** Below this, `1 − exp(−x)` is replaced by `x − x²/2`, exact to 5e-6 and much cheaper. */
const EXPM1_CUTOFF = 0.03;
/** Kernel radius as a multiple of sigma. Beyond 3σ a Gaussian's taps are under 1% of the peak. */
const KERNEL_RADIUS_SIGMAS = 3;

/** Sigma set for a crop of `size` pixels, preserving the physical crease width. */
export function sigmasFor(size: number, base: readonly number[] = FRANGI_SIGMAS_AT_128): number[] {
  const scale = size / SIGMA_REFERENCE_SIZE;
  return base.map((sigma) => sigma * scale);
}

interface DerivativeKernels {
  readonly radius: number;
  /** Gaussian, and its first and second derivatives, with the γ = 1 normalisation folded in. */
  readonly g: Float32Array;
  readonly g1: Float32Array;
  readonly g2: Float32Array;
}

const kernelCache = new Map<number, DerivativeKernels>();

/**
 * Sampled Gaussian derivatives for one scale, with σ² folded into the taps.
 *
 * Analytic derivatives of the continuous Gaussian, sampled — not finite differences of a sampled
 * Gaussian. At σ = 1.5 a finite-difference stencil is dominated by its own truncation error rather
 * than by the structure it is meant to measure.
 *
 * The γ = 1 scale normalisation (`σ²·L″`) lives here rather than in the per-pixel loop: `g2` carries
 * σ² and each `g1` carries σ, so the separable *product* that forms `Lxy` carries σ² exactly once.
 * Applying it again per pixel would square it, and the scales would stop being comparable.
 */
function kernelsFor(sigma: number): DerivativeKernels {
  const cached = kernelCache.get(sigma);
  if (cached !== undefined) return cached;

  const radius = Math.max(1, Math.ceil(KERNEL_RADIUS_SIGMAS * sigma));
  const width = 2 * radius + 1;
  const g = new Float32Array(width);
  const g1 = new Float32Array(width);
  const g2 = new Float32Array(width);
  const s2 = sigma * sigma;
  const s4 = s2 * s2;
  const norm = 1 / (sigma * Math.sqrt(2 * Math.PI));

  let sum = 0;
  for (let t = -radius; t <= radius; t += 1) {
    const value = norm * Math.exp(-(t * t) / (2 * s2));
    g[t + radius] = value;
    // σ on the first derivative, σ² on the second: the γ = 1 normalisation, folded in once.
    g1[t + radius] = sigma * (-t / s2) * value;
    g2[t + radius] = s2 * ((t * t - s2) / s4) * value;
    sum += value;
  }
  // Truncation costs the smoothing kernel a little DC gain; restoring it keeps "blur of flat is
  // flat" exact, so a flat region produces exactly zero curvature rather than a small bias.
  if (sum > 1e-12) {
    for (let i = 0; i < width; i += 1) g[i] /= sum;
  }

  const built: DerivativeKernels = { radius, g, g1, g2 };
  kernelCache.set(sigma, built);
  return built;
}

/**
 * Horizontal correlation, replicate borders.
 *
 * Split into clamped strips and an unclamped interior: at 128² with radius 5 the interior is 92% of
 * every row, so hoisting the bounds test out of it is most of the win. Borders replicate to match
 * `gaborBank` and `horizontalExtreme` in ridge.ts — the two detectors are combined per pixel, so a
 * disagreement about what lies outside the crop would show up as a bright rim on one channel only.
 */
function correlateRows(src: Float32Array, dst: Float32Array, size: number, k: Float32Array, r: number): void {
  const last = size - 1;
  for (let y = 0; y < size; y += 1) {
    const base = y * size;
    for (let x = 0; x < size; x += 1) {
      let acc = 0;
      if (x >= r && x + r <= last) {
        for (let t = -r; t <= r; t += 1) acc += src[base + x + t] * k[t + r];
      } else {
        for (let t = -r; t <= r; t += 1) {
          const xx = x + t < 0 ? 0 : x + t > last ? last : x + t;
          acc += src[base + xx] * k[t + r];
        }
      }
      dst[base + x] = acc;
    }
  }
}

/**
 * Vertical correlation, replicate borders — tap-outer, column-inner.
 *
 * The obvious loop order (per output pixel, walk the taps) strides a full row per tap and spends
 * more time missing cache than doing arithmetic. Reading one whole source row per tap and
 * accumulating into one whole destination row keeps both sides sequential. The first tap assigns
 * rather than adds, which removes a separate zeroing pass over the plane.
 */
function correlateCols(src: Float32Array, dst: Float32Array, size: number, k: Float32Array, r: number): void {
  const last = size - 1;
  for (let y = 0; y < size; y += 1) {
    const out = y * size;
    for (let t = -r; t <= r; t += 1) {
      const yy = y + t < 0 ? 0 : y + t > last ? last : y + t;
      const from = yy * size;
      const weight = k[t + r];
      if (t === -r) {
        for (let x = 0; x < size; x += 1) dst[out + x] = src[from + x] * weight;
      } else {
        for (let x = 0; x < size; x += 1) dst[out + x] += src[from + x] * weight;
      }
    }
  }
}

interface Scratch {
  readonly size: number;
  readonly scales: number;
  readonly tmp: Float32Array;
  readonly lxx: Float32Array;
  readonly lyy: Float32Array;
  readonly lxy: Float32Array;
  /** Per-scale blobness factor and Hessian norm, laid out scale-major. */
  readonly aniso: Float32Array;
  readonly norm: Float32Array;
  readonly histogram: Uint32Array;
}

/**
 * Scratch keyed by (crop size, scale count).
 *
 * Keyed rather than a single pool because both sizes the pipeline uses are live at once — 128 for
 * the every-frame classical path and 256 for the periodic full-resolution pass — and a shared pool
 * would be silently resized on every alternation, which is an allocation per frame in disguise.
 */
const scratchPool = new Map<string, Scratch>();

function scratchFor(size: number, scales: number): Scratch {
  const key = `${size}:${scales}`;
  const cached = scratchPool.get(key);
  if (cached !== undefined) return cached;
  const plane = size * size;
  const fresh: Scratch = {
    size,
    scales,
    tmp: new Float32Array(plane),
    lxx: new Float32Array(plane),
    lyy: new Float32Array(plane),
    lxy: new Float32Array(plane),
    aniso: new Float32Array(plane * scales),
    norm: new Float32Array(plane * scales),
    histogram: new Uint32Array(512),
  };
  scratchPool.set(key, fresh);
  return fresh;
}

/**
 * Eigenvalues of the symmetric 2×2 Hessian `[[a, b], [b, d]]`, ordered by magnitude.
 *
 * Written out rather than delegated because the ordering is the whole point: Frangi's terms are
 * defined with |λ1| ≤ |λ2|, and silently swapping them inverts the blobness ratio — every line would
 * read as a blob and every blob as a line. `Math.sqrt` rather than `Math.hypot`: on a 0–1 image the
 * normalised second derivatives are O(0.1), nowhere near overflow, and hypot costs several times more.
 *
 * @returns `[smaller magnitude, larger magnitude]`.
 */
export function hessianEigenvalues(a: number, b: number, d: number): readonly [number, number] {
  const mid = (a + d) / 2;
  const half = (a - d) / 2;
  const spread = Math.sqrt(half * half + b * b);
  const first = mid + spread;
  const second = mid - spread;
  return Math.abs(first) <= Math.abs(second) ? [first, second] : [second, first];
}

/**
 * Multi-scale vesselness, 0–1, over a 0–1 grayscale crop.
 *
 * Two passes over the scales, because `c` cannot be known until every scale has been measured.
 * The first computes each scale's Hessian, eigenvalues, blobness factor and norm; the second, once
 * the pooled percentile has fixed `c`, turns those into a response and keeps the per-pixel maximum
 * across scales — so a fine crease and a deep fold are both reported at full strength rather than
 * averaged against each other.
 *
 * @param out optional destination; a fresh array is allocated when omitted. Pass one from a caller
 * that runs per frame — with `out` supplied this function allocates nothing at all after warm-up.
 */
export function detectVessels(
  gray: Float32Array,
  size: number,
  sigmas: readonly number[] = sigmasFor(size),
  out?: Float32Array,
): Float32Array {
  const plane = size * size;
  const result = out ?? new Float32Array(plane);
  result.fill(0);
  if (gray.length !== plane || sigmas.length === 0) return result;

  const scratch = scratchFor(size, sigmas.length);
  const { tmp, lxx, lyy, lxy, aniso, norm, histogram } = scratch;
  const twoBetaSquared = 2 * FRANGI_BETA * FRANGI_BETA;

  /* ---- Pass 1: per scale, the Hessian and its derived quantities ---- */
  let peak = 0;
  for (let s = 0; s < sigmas.length; s += 1) {
    const { radius, g, g1, g2 } = kernelsFor(sigmas[s]);
    correlateRows(gray, tmp, size, g2, radius);
    correlateCols(tmp, lxx, size, g, radius);
    correlateRows(gray, tmp, size, g, radius);
    correlateCols(tmp, lyy, size, g2, radius);
    correlateRows(gray, tmp, size, g1, radius);
    correlateCols(tmp, lxy, size, g1, radius);

    const base = s * plane;
    for (let i = 0; i < plane; i += 1) {
      const [lo, hi] = hessianEigenvalues(lxx[i], lxy[i], lyy[i]);
      // Bright ridge, not a crease — see the polarity note at the top of this file.
      if (hi <= 0) {
        aniso[base + i] = 0;
        norm[base + i] = 0;
        continue;
      }
      const magnitude = Math.sqrt(lo * lo + hi * hi);
      if (magnitude < FRANGI_S_EPS) {
        aniso[base + i] = 0;
        norm[base + i] = 0;
        continue;
      }
      const blobness = lo / hi;
      aniso[base + i] = Math.exp(-(blobness * blobness) / twoBetaSquared);
      norm[base + i] = magnitude;
      if (magnitude > peak) peak = magnitude;
    }
  }
  if (peak <= 0) return result;

  /* ---- The pooled percentile that fixes c ---- */
  histogram.fill(0);
  let signal = 0;
  const total = plane * sigmas.length;
  for (let i = 0; i < total; i += 1) {
    const value = norm[i];
    if (value <= 0) continue;
    const bucket = ((value / peak) * 512) | 0;
    histogram[bucket > 511 ? 511 : bucket] += 1;
    signal += 1;
  }
  if (signal === 0) return result;

  const wanted = Math.max(1, Math.floor(signal * (1 - FRANGI_C_PERCENTILE)));
  let counted = 0;
  let cutoff = 0;
  for (let bucket = 511; bucket >= 0; bucket -= 1) {
    counted += histogram[bucket];
    if (counted >= wanted) {
      cutoff = bucket;
      break;
    }
  }
  const percentile = (cutoff / 512) * peak;
  const c = FRANGI_C_FRACTION * Math.max(percentile, FRANGI_S_FLOOR);
  const invTwoCSquared = 1 / (2 * c * c);

  /* ---- Pass 2: the response, maximised across scales ---- */
  for (let s = 0; s < sigmas.length; s += 1) {
    const base = s * plane;
    for (let i = 0; i < plane; i += 1) {
      const shape = aniso[base + i];
      if (shape === 0) continue;
      const magnitude = norm[base + i];
      const x = magnitude * magnitude * invTwoCSquared;
      const structureness = x < EXPM1_CUTOFF ? x - 0.5 * x * x : 1 - Math.exp(-x);
      const value = shape * structureness;
      if (value > result[i]) result[i] = value;
    }
  }

  return result;
}
