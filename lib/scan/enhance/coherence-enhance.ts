/**
 * @file Coherence-gated line-integral enhancement of a crease response map.
 *
 * For every pixel, the detector response is averaged along the local line
 * direction with Gaussian weights. Along a real crease the samples agree and
 * the average stays high, including across short dropouts where the detector
 * lost the line. Across isotropic texture the samples disagree and the average
 * collapses. The result is then gated by coherence so neighbourhoods with no
 * dominant direction are attenuated further. This is the step that turns a
 * fragmented, speckled response into continuous ridges.
 *
 * Layer: lib/scan/enhance (production). Pure. Imports nothing from lib/scan/dev.
 */
import { sampleBilinear } from "./kernels";
import { scaleForSize, type OrientationField } from "./orientation";

/**
 * Half-length of the integration window at REFERENCE_SIZE. Seven pixels each
 * side bridges a dropout of five pixels with the on-line samples still
 * carrying roughly half the weight, while staying short enough that the heart
 * line's curvature does not pull samples off the crease.
 */
export const DEFAULT_HALF_LENGTH_AT_REF = 7;

/** Gaussian sigma along the line, as a fraction of the half-length. */
export const DEFAULT_SIGMA_FRACTION = 0.6;

/**
 * Exponent on coherence in the gate. 0.5 softens the gate so a curving line
 * with moderate coherence is kept; 1.0 would be too aggressive on curves.
 */
export const DEFAULT_COHERENCE_GAMMA = 0.5;

/**
 * Minimum gate value. Isotropic regions keep this fraction of their response
 * so a genuinely faint, short crease is attenuated, not erased.
 */
export const DEFAULT_COHERENCE_FLOOR = 0.15;

export interface CoherenceEnhanceOptions {
  /** Half-length of the along-line window in pixels at the working size. */
  readonly halfLength: number;
  /** Gaussian sigma of the along-line weights in pixels. */
  readonly sigma: number;
  /** Exponent applied to coherence before gating. */
  readonly coherenceGamma: number;
  /** Floor of the coherence gate in [0, 1). */
  readonly coherenceFloor: number;
}

/**
 * Enhances a response map along an orientation field.
 * Allocates once; `enhanceInto` is allocation-free.
 */
export class CoherenceEnhancer {
  readonly size: number;
  private readonly halfLength: number;
  private readonly weights: Float32Array;
  private readonly weightTotal: number;
  private readonly gamma: number;
  private readonly floor: number;

  constructor(size: number, options?: Partial<CoherenceEnhanceOptions>) {
    this.size = size;
    const halfLength = Math.max(1, Math.round(options?.halfLength ?? scaleForSize(DEFAULT_HALF_LENGTH_AT_REF, size)));
    const sigma = options?.sigma ?? halfLength * DEFAULT_SIGMA_FRACTION;
    this.halfLength = halfLength;
    this.gamma = options?.coherenceGamma ?? DEFAULT_COHERENCE_GAMMA;
    this.floor = options?.coherenceFloor ?? DEFAULT_COHERENCE_FLOOR;
    this.weights = new Float32Array(2 * halfLength + 1);
    let total = 0;
    const twoSigmaSq = 2 * sigma * sigma;
    for (let k = -halfLength; k <= halfLength; k += 1) {
      const w = Math.exp(-(k * k) / twoSigmaSq);
      this.weights[k + halfLength] = w;
      total += w;
    }
    this.weightTotal = total;
  }

  /**
   * Enhance a response map.
   * @param response Detector response in [0, 1], size×size row-major.
   * @param field Orientation field of the same frame.
   * @param out Destination buffer, may not alias `response`.
   */
  enhanceInto(response: Float32Array, field: OrientationField, out: Float32Array): void {
    const { size, halfLength, weights, weightTotal, gamma, floor } = this;
    const { theta, coherence } = field;
    const gateSpan = 1 - floor;

    for (let y = 0; y < size; y += 1) {
      const row = y * size;
      for (let x = 0; x < size; x += 1) {
        const i = row + x;
        const t = theta[i] ?? 0;
        const dx = Math.cos(t);
        const dy = Math.sin(t);
        let acc = 0;
        for (let k = -halfLength; k <= halfLength; k += 1) {
          acc += (weights[k + halfLength] ?? 0) * sampleBilinear(response, size, x + k * dx, y + k * dy);
        }
        const along = acc / weightTotal;
        const gate = floor + gateSpan * Math.pow(coherence[i] ?? 0, gamma);
        const v = along * gate;
        out[i] = v < 0 ? 0 : v > 1 ? 1 : v;
      }
    }
  }
}
