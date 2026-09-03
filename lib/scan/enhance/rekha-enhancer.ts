/**
 * @file Live rekha enhancement pipeline.
 *
 * Composes orientation estimation → coherence-gated line integral → oriented
 * non-maximum suppression → temporal evidence. Takes any [0, 1] crease
 * response (fused ridge/Frangi/UNet output) plus the grayscale frame it came
 * from, and returns a continuous enhanced map, a thin ridge map for polyline
 * extraction, and a per-pixel probability and CANDIDATE/TRACKING/CONFIRMED
 * state for the render ladder.
 *
 * Layer: lib/scan/enhance (production). Pure. Imports nothing from lib/scan/dev.
 */
import { CoherenceEnhancer, type CoherenceEnhanceOptions } from "./coherence-enhance";
import { EvidenceAccumulator, type EvidenceOptions } from "./evidence";
import { OrientationEstimator, type OrientationField, type OrientationOptions } from "./orientation";
import { orientedNonMaxSuppressionInto } from "./oriented-nms";

/**
 * Enhanced responses below this are dropped before NMS so the ridge map does
 * not carry one-pixel noise maxima.
 */
export const DEFAULT_NMS_MIN_RESPONSE = 0.12;

/** Variance-of-Laplacian at which a frame contributes zero evidence. */
export const SHARPNESS_FLOOR = 60;

/** Variance-of-Laplacian at which a frame contributes full evidence. */
export const SHARPNESS_FULL = 220;

export interface RekhaEnhancerOptions {
  readonly orientation: Partial<OrientationOptions>;
  readonly coherence: Partial<CoherenceEnhanceOptions>;
  readonly nmsMinResponse: number;
  readonly evidence: Partial<EvidenceOptions>;
}

/** Output of one frame. Buffers are owned by the enhancer and reused. */
export interface RekhaEnhancementResult {
  /** Coherence-enhanced response in [0, 1]. */
  readonly enhanced: Float32Array;
  /** Oriented NMS of `enhanced`: one-pixel ridges, zero elsewhere. */
  readonly ridge: Float32Array;
  /** Temporal probability per pixel. */
  readonly probability: Float32Array;
  /** Temporal state per pixel (PIXEL_*). */
  readonly state: Uint8Array;
  /** Orientation field used this frame. */
  readonly orientation: OrientationField;
  /** Translation applied to the accumulator before this frame. */
  readonly shiftX: number;
  readonly shiftY: number;
}

/**
 * Map a variance-of-Laplacian sharpness score to a frame weight in [0, 1].
 * @param varianceOfLaplacian Sharpness score from the existing quality gate.
 * @param floor Score at or below which the weight is 0.
 * @param full Score at or above which the weight is 1.
 */
export function frameWeightFromSharpness(
  varianceOfLaplacian: number,
  floor = SHARPNESS_FLOOR,
  full = SHARPNESS_FULL,
): number {
  if (!Number.isFinite(varianceOfLaplacian) || varianceOfLaplacian <= floor) return 0;
  if (varianceOfLaplacian >= full) return 1;
  return (varianceOfLaplacian - floor) / (full - floor);
}

/**
 * Stateful live enhancer. Allocates once per size; `process` is allocation-free.
 */
export class RekhaEnhancer {
  readonly size: number;
  private readonly orientation: OrientationEstimator;
  private readonly coherence: CoherenceEnhancer;
  private readonly evidence: EvidenceAccumulator;
  private readonly enhanced: Float32Array;
  private readonly ridge: Float32Array;
  private readonly nmsMinResponse: number;
  private readonly result: {
    enhanced: Float32Array;
    ridge: Float32Array;
    probability: Float32Array;
    state: Uint8Array;
    orientation: OrientationField;
    shiftX: number;
    shiftY: number;
  };

  constructor(size: number, options?: Partial<RekhaEnhancerOptions>) {
    this.size = size;
    const n = size * size;
    this.orientation = new OrientationEstimator(size, options?.orientation);
    this.coherence = new CoherenceEnhancer(size, options?.coherence);
    this.evidence = new EvidenceAccumulator(size, options?.evidence);
    this.enhanced = new Float32Array(n);
    this.ridge = new Float32Array(n);
    this.nmsMinResponse = options?.nmsMinResponse ?? DEFAULT_NMS_MIN_RESPONSE;
    this.result = {
      enhanced: this.enhanced,
      ridge: this.ridge,
      probability: this.evidence.probability,
      state: this.evidence.state,
      orientation: this.orientation.field,
      shiftX: 0,
      shiftY: 0,
    };
  }

  /** Clear temporal state. Call when the hand leaves the frame or the session restarts. */
  reset(): void {
    this.evidence.reset();
    this.enhanced.fill(0);
    this.ridge.fill(0);
    this.result.shiftX = 0;
    this.result.shiftY = 0;
  }

  /**
   * Process one frame.
   * @param gray Grayscale rectified crop in [0, 1], size×size row-major.
   * @param baseResponse Fused detector response in [0, 1], same layout.
   * @param frameWeight Frame quality in [0, 1]; see {@link frameWeightFromSharpness}.
   * @returns Reused result object; valid until the next call.
   */
  process(gray: Float32Array, baseResponse: Float32Array, frameWeight: number): RekhaEnhancementResult {
    const field = this.orientation.estimate(gray);
    this.coherence.enhanceInto(baseResponse, field, this.enhanced);
    orientedNonMaxSuppressionInto(this.enhanced, field, this.size, this.ridge, this.nmsMinResponse);
    this.evidence.update(this.enhanced, gray, frameWeight);
    this.result.shiftX = this.evidence.lastShiftX;
    this.result.shiftY = this.evidence.lastShiftY;
    return this.result;
  }

  /** Number of frames that have contributed evidence since the last reset. */
  get frameCount(): number {
    return this.evidence.frameCount;
  }
}
