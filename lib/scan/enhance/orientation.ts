/**
 * @file Structure-tensor orientation field for palm creases.
 *
 * A palm line is locally one-dimensional: intensity changes sharply across it
 * and slowly along it. The structure tensor J = G_σt * (∇u ∇uᵀ) captures that.
 * Its dominant eigenvector is the ACROSS-line direction, so the line direction
 * is the perpendicular, and the eigenvalue spread (coherence) measures how
 * confidently 1-D the neighbourhood is. Pores, skin texture and sensor noise
 * are isotropic and score near-zero coherence, which is what lets the rest of
 * the stack suppress them without a learned model.
 *
 * Layer: lib/scan/enhance (production). Pure. Imports nothing from lib/scan/dev.
 */
import { gaussianBlurInto, gaussianKernel } from "./kernels";

/** Sigmas below are specified at this canonical size and scaled linearly. */
export const REFERENCE_SIZE = 256;

/**
 * Gradient smoothing sigma at REFERENCE_SIZE. Slightly above one pixel so
 * single-pixel sensor noise does not dominate the gradient.
 */
export const DEFAULT_GRADIENT_SIGMA_AT_REF = 1.2;

/**
 * Tensor integration sigma at REFERENCE_SIZE. Roughly one crease width plus
 * margin: large enough to average texture into isotropy, small enough that a
 * curving line keeps a meaningful local direction.
 */
export const DEFAULT_TENSOR_SIGMA_AT_REF = 4.0;

/** Guards the coherence ratio against division by zero on flat skin. */
export const COHERENCE_EPSILON = 1e-7;

const HALF_PI = Math.PI / 2;

/** Orientation field for one frame. Buffers are owned by the estimator. */
export interface OrientationField {
  readonly size: number;
  /** Line direction in radians, in (−π/2, π/2]. Direction ALONG the crease. */
  readonly theta: Float32Array;
  /** Coherence in [0, 1]. 1 = perfectly 1-D, 0 = isotropic. */
  readonly coherence: Float32Array;
  /** Gradient energy (λ1 + λ2). Optional gate against flat regions. */
  readonly energy: Float32Array;
}

export interface OrientationOptions {
  /** Gradient smoothing sigma in pixels at the working size. */
  readonly gradientSigma: number;
  /** Tensor integration sigma in pixels at the working size. */
  readonly tensorSigma: number;
}

/**
 * Scale a value specified at REFERENCE_SIZE to the working size.
 * @param valueAtRef Value at 256 px.
 * @param size Working image side length.
 */
export function scaleForSize(valueAtRef: number, size: number): number {
  return (valueAtRef * size) / REFERENCE_SIZE;
}

/**
 * Estimates the orientation field of a grayscale palm crop.
 * Allocates all buffers once; `estimate` is allocation-free.
 */
export class OrientationEstimator {
  readonly size: number;
  readonly field: OrientationField;

  private readonly theta: Float32Array;
  private readonly coherence: Float32Array;
  private readonly energy: Float32Array;
  private readonly smooth: Float32Array;
  private readonly jxx: Float32Array;
  private readonly jyy: Float32Array;
  private readonly jxy: Float32Array;
  private readonly tmp: Float32Array;
  private readonly gradientKernel: Float32Array;
  private readonly tensorKernel: Float32Array;

  constructor(size: number, options?: Partial<OrientationOptions>) {
    this.size = size;
    const n = size * size;
    this.theta = new Float32Array(n);
    this.coherence = new Float32Array(n);
    this.energy = new Float32Array(n);
    this.smooth = new Float32Array(n);
    this.jxx = new Float32Array(n);
    this.jyy = new Float32Array(n);
    this.jxy = new Float32Array(n);
    this.tmp = new Float32Array(n);
    const gradientSigma = options?.gradientSigma ?? scaleForSize(DEFAULT_GRADIENT_SIGMA_AT_REF, size);
    const tensorSigma = options?.tensorSigma ?? scaleForSize(DEFAULT_TENSOR_SIGMA_AT_REF, size);
    this.gradientKernel = gaussianKernel(gradientSigma);
    this.tensorKernel = gaussianKernel(tensorSigma);
    this.field = { size, theta: this.theta, coherence: this.coherence, energy: this.energy };
  }

  /**
   * Compute the orientation field of one frame.
   * @param gray Grayscale image in [0, 1], size×size row-major.
   * @returns The estimator's field (same object every call).
   */
  estimate(gray: Float32Array): OrientationField {
    const { size, smooth, jxx, jyy, jxy, tmp } = this;
    const max = size - 1;

    gaussianBlurInto(gray, smooth, tmp, size, this.gradientKernel);

    for (let y = 0; y < size; y += 1) {
      const row = y * size;
      const rowUp = (y > 0 ? y - 1 : y) * size;
      const rowDown = (y < max ? y + 1 : y) * size;
      for (let x = 0; x < size; x += 1) {
        const xl = x > 0 ? x - 1 : x;
        const xr = x < max ? x + 1 : x;
        const gx = 0.5 * ((smooth[row + xr] ?? 0) - (smooth[row + xl] ?? 0));
        const gy = 0.5 * ((smooth[rowDown + x] ?? 0) - (smooth[rowUp + x] ?? 0));
        const i = row + x;
        jxx[i] = gx * gx;
        jyy[i] = gy * gy;
        jxy[i] = gx * gy;
      }
    }

    gaussianBlurInto(jxx, jxx, tmp, size, this.tensorKernel);
    gaussianBlurInto(jyy, jyy, tmp, size, this.tensorKernel);
    gaussianBlurInto(jxy, jxy, tmp, size, this.tensorKernel);

    const { theta, coherence, energy } = this;
    for (let i = 0; i < jxx.length; i += 1) {
      const a = jxx[i] ?? 0;
      const b = jyy[i] ?? 0;
      const c = jxy[i] ?? 0;
      const trace = a + b;
      const diff = a - b;
      const disc = Math.sqrt(diff * diff + 4 * c * c);
      const ratio = disc / (trace + COHERENCE_EPSILON);
      coherence[i] = trace > COHERENCE_EPSILON ? ratio * ratio : 0;
      energy[i] = trace;
      // Gradient (across-line) direction, then rotate by 90° to the line direction.
      let t = 0.5 * Math.atan2(2 * c, diff) + HALF_PI;
      if (t > HALF_PI) t -= Math.PI;
      theta[i] = t;
    }

    return this.field;
  }
}
