/**
 * Camera control: stop fighting the auto-exposure, and measure whether it helped.
 *
 * A phone's auto-exposure meters the whole frame. A palm held up close is a large bright object, and
 * the fingers — closer to the lens, and catching most of the light — blow out first. The creases the
 * detector needs are *low-contrast dark valleys on bright skin*, so clipping is the one failure that
 * destroys them outright: once a region is at 255 there is nothing left to normalise, and no amount
 * of illumination correction downstream can recover a value that was never recorded.
 *
 * So this drives the camera down rather than correcting after the fact. Negative exposure bias, fixed
 * focus at roughly arm's length, fixed white balance so the normalisation is not chasing a moving
 * colour temperature, and a closed loop that steps the bias from what the rectified crop actually
 * measures rather than what the whole frame does.
 *
 * **Every constraint here is optional in every browser.** `MediaTrackCapabilities` for exposure,
 * focus and torch is a non-standard extension that Chrome on Android implements, Safari mostly does
 * not, and desktop browsers rarely do. Nothing may throw, nothing may assume, and what was actually
 * accepted has to be visible — otherwise "camera control is on" is a claim with no evidence, and the
 * next person to debug a dark scan cannot tell whether it did anything at all.
 *
 * The decision logic is pure and lives here; the DOM half is a thin wrapper at the bottom. That split
 * is what lets the closed loop be unit-tested instead of eyeballed against a live phone.
 */

/* ------------------------------- Targets ----------------------------------- */

/**
 * Mean luma band the loop aims for, in 0–255.
 *
 * Below 110 the crease-to-skin difference falls into sensor noise; above 140 the brightest parts of a
 * palm start clipping before the mean does, because skin has strong specular highlights. Aiming
 * mid-band leaves headroom on both sides rather than optimising one at the other's expense.
 */
export const LUMA_TARGET_LOW = 110;
export const LUMA_TARGET_HIGH = 140;
/** Fraction of the palm allowed at or near full white. Above this, detail is being lost, not just brightness. */
export const MAX_CLIPPED_FRACTION = 0.01;
/** A pixel at or above this is treated as clipped. Below 255 because sensor noise makes 255 rare even in a blowout. */
export const CLIP_LEVEL = 250 / 255;

/**
 * Exposure bias band, in the EV-like units `exposureCompensation` uses.
 *
 * Deliberately one-sided and negative. The failure being corrected is always overexposure — a palm
 * held toward a camera is the brightest thing in frame — and allowing positive bias would let the
 * loop chase a dark *background* by blowing out the subject, which is exactly the behaviour the
 * camera's own metering already gets wrong.
 */
export const BIAS_MIN = -1;
export const BIAS_MAX = -0.5;
/** Largest single step. Small enough that the loop settles rather than oscillating around the band. */
export const BIAS_STEP = 0.15;
/** How often the loop may act. Faster than this and it steps before the camera has applied the last one. */
export const CONTROL_INTERVAL_MS = 500;

/** Focus distance in metres — a palm held up to look at it. */
export const FOCUS_DISTANCE_M = 0.25;
/** White balance in Kelvin: mixed indoor light, and fixed so normalisation is not chasing a moving target. */
export const WHITE_BALANCE_K = 4000;

/**
 * Software gamma bounds for the fallback path.
 *
 * Capped well short of what would be needed to rescue a badly blown crop, because it cannot: gamma
 * redistributes values that exist and clipped pixels have none. It buys a modest improvement on a
 * merely-bright crop and is honest about being second best.
 */
export const GAMMA_MIN = 1;
export const GAMMA_MAX = 1.8;

/* ------------------------------ Capabilities -------------------------------- */

/**
 * The non-standard track capabilities this module uses.
 *
 * Declared locally rather than augmenting the DOM lib: these are a W3C *draft* extension, support is
 * patchy and browser-specific, and pretending they are part of `MediaTrackCapabilities` would let
 * code elsewhere assume they exist.
 */
export interface ExtendedCapabilities {
  readonly exposureMode?: readonly string[];
  readonly exposureCompensation?: { readonly min: number; readonly max: number; readonly step?: number };
  readonly focusMode?: readonly string[];
  readonly focusDistance?: { readonly min: number; readonly max: number; readonly step?: number };
  readonly whiteBalanceMode?: readonly string[];
  readonly colorTemperature?: { readonly min: number; readonly max: number; readonly step?: number };
  readonly torch?: boolean;
}

export interface ConstraintPlan {
  /** The constraint object to hand `applyConstraints`, or null when nothing is settable. */
  readonly advanced: Record<string, number | string | boolean> | null;
  /** Names this device advertised and the plan targets. */
  readonly supported: readonly string[];
  /** Names the plan wanted and this device does not advertise. Surfaced in the HUD, not swallowed. */
  readonly unsupported: readonly string[];
}

const clamp = (value: number, low: number, high: number): number =>
  value < low ? low : value > high ? high : value;

/**
 * Decides what to ask the camera for, given what it says it can do.
 *
 * Pure, and that is the point: what gets asked for is the interesting part and the part that can be
 * wrong, and it is testable without a camera. A capability that is advertised but whose range does
 * not contain the target is treated as **unsupported** rather than clamped silently — a focus
 * distance clamped to a device's 2m minimum is not "focus at 0.25m", and reporting it as accepted
 * would make the HUD lie.
 */
export function planConstraints(
  capabilities: ExtendedCapabilities | null,
  bias: number,
  wantTorch = false,
): ConstraintPlan {
  const advanced: Record<string, number | string | boolean> = {};
  const supported: string[] = [];
  const unsupported: string[] = [];

  if (capabilities === null) {
    return { advanced: null, supported: [], unsupported: ["capabilities-unavailable"] };
  }

  const exposure = capabilities.exposureCompensation;
  if (capabilities.exposureMode?.includes("manual") === true && exposure !== undefined) {
    advanced.exposureMode = "manual";
    advanced.exposureCompensation = clamp(bias, exposure.min, exposure.max);
    supported.push("exposureCompensation");
  } else if (exposure !== undefined) {
    // Continuous metering with a bias offset — still useful, and commoner than full manual.
    advanced.exposureCompensation = clamp(bias, exposure.min, exposure.max);
    supported.push("exposureCompensation");
  } else {
    unsupported.push("exposureCompensation");
  }

  const focus = capabilities.focusDistance;
  if (capabilities.focusMode?.includes("manual") === true && focus !== undefined) {
    if (FOCUS_DISTANCE_M >= focus.min && FOCUS_DISTANCE_M <= focus.max) {
      advanced.focusMode = "manual";
      advanced.focusDistance = FOCUS_DISTANCE_M;
      supported.push("focusDistance");
    } else {
      // Advertised, but it cannot reach where a palm actually is.
      unsupported.push("focusDistance(range)");
    }
  } else {
    unsupported.push("focusDistance");
  }

  const temperature = capabilities.colorTemperature;
  if (capabilities.whiteBalanceMode?.includes("manual") === true && temperature !== undefined) {
    advanced.whiteBalanceMode = "manual";
    advanced.colorTemperature = clamp(WHITE_BALANCE_K, temperature.min, temperature.max);
    supported.push("colorTemperature");
  } else {
    unsupported.push("colorTemperature");
  }

  if (capabilities.torch === true) {
    if (wantTorch) advanced.torch = true;
    supported.push("torch");
  } else {
    unsupported.push("torch");
  }

  return {
    advanced: Object.keys(advanced).length === 0 ? null : advanced,
    supported,
    unsupported,
  };
}

/* -------------------------------- Metering ---------------------------------- */

export interface LumaStats {
  /** Mean luma over the measured region, 0–255. */
  readonly mean: number;
  /** Fraction of the region at or above {@link CLIP_LEVEL}. */
  readonly clipped: number;
  /** Fraction at or below 5/255 — the other end, where creases vanish into noise. */
  readonly crushed: number;
  readonly samples: number;
}

/**
 * Measures the **rectified crop**, not the camera frame.
 *
 * That distinction is the whole reason this loop exists. The camera meters everything it can see —
 * a bright window, a dark room, the user's face — and the palm is a small part of that. The crop is
 * the palm and nothing else, so metering it is metering the thing that actually has to be exposed
 * correctly.
 *
 * @param inside optional per-pixel validity from `rectifyPalm`; pixels outside the source frame are
 * filled black and would drag the mean down toward a phantom underexposure.
 */
export function lumaStats(rgba: Uint8ClampedArray, inside: Uint8Array | null = null): LumaStats {
  let sum = 0;
  let clipped = 0;
  let crushed = 0;
  let samples = 0;
  const pixels = rgba.length >> 2;
  for (let i = 0; i < pixels; i += 1) {
    if (inside !== null && inside[i] === 0) continue;
    const at = i * 4;
    const luma = (0.2126 * rgba[at] + 0.7152 * rgba[at + 1] + 0.0722 * rgba[at + 2]) / 255;
    sum += luma;
    if (luma >= CLIP_LEVEL) clipped += 1;
    if (luma <= 5 / 255) crushed += 1;
    samples += 1;
  }
  if (samples === 0) return { mean: 0, clipped: 0, crushed: 0, samples: 0 };
  return { mean: (sum / samples) * 255, clipped: clipped / samples, crushed: crushed / samples, samples };
}

/**
 * The next exposure bias, from what the crop measured.
 *
 * Clipping is handled before brightness and overrides it. A crop can sit inside the target mean band
 * while its highlights are gone — a palm with the fingers blown out and the heel in shadow averages
 * to a perfectly reasonable number — and in that case the mean is the wrong thing to be steering by.
 *
 * @returns the same value when already settled, so callers can skip a pointless `applyConstraints`.
 */
export function nextExposureBias(current: number, stats: LumaStats): number {
  if (stats.samples === 0) return current;

  if (stats.clipped > MAX_CLIPPED_FRACTION) {
    // Proportional to how far over: a badly blown frame should not need ten polite steps to recover.
    const excess = Math.min(1, stats.clipped / (MAX_CLIPPED_FRACTION * 4));
    return clamp(current - BIAS_STEP * (0.5 + excess), BIAS_MIN, BIAS_MAX);
  }
  if (stats.mean > LUMA_TARGET_HIGH) {
    const error = Math.min(1, (stats.mean - LUMA_TARGET_HIGH) / 60);
    return clamp(current - BIAS_STEP * Math.max(0.3, error), BIAS_MIN, BIAS_MAX);
  }
  if (stats.mean < LUMA_TARGET_LOW && stats.clipped === 0) {
    const error = Math.min(1, (LUMA_TARGET_LOW - stats.mean) / 60);
    return clamp(current + BIAS_STEP * Math.max(0.3, error), BIAS_MIN, BIAS_MAX);
  }
  return current;
}

/**
 * Gamma for the software fallback, when the camera refused every constraint.
 *
 * Strictly second best, and bounded to say so. Gamma redistributes values that were recorded; it
 * cannot recover a clipped pixel, because that pixel holds no information about how much brighter
 * than white it was. On a merely-bright crop it helps; on a blown one it darkens the surroundings of
 * a hole and makes the hole more obvious. Returning 1 — a no-op — whenever the crop is already inside
 * the band keeps the fallback from touching frames that do not need it.
 */
export function fallbackGamma(stats: LumaStats): number {
  if (stats.samples === 0 || stats.mean <= LUMA_TARGET_HIGH) return GAMMA_MIN;
  // Solve v^γ so the measured mean lands at the top of the band, then temper it.
  const ratio = stats.mean / 255;
  const target = LUMA_TARGET_HIGH / 255;
  if (ratio <= 0 || ratio >= 1) return GAMMA_MIN;
  const exact = Math.log(target) / Math.log(ratio);
  return clamp(exact, GAMMA_MIN, GAMMA_MAX);
}

/**
 * Applies gamma to a crop's RGB in place. Alpha is untouched; the crop is opaque by construction.
 *
 * A 256-entry lookup rather than `Math.pow` per channel: this runs on every rectify tick when the
 * fallback is active, and three pow calls per pixel over 65k pixels is 200k transcendental calls a
 * frame for a curve that only has 256 possible inputs.
 */
export function applyGamma(rgba: Uint8ClampedArray, gamma: number): void {
  if (gamma <= GAMMA_MIN + 1e-6) return;
  const table = new Uint8ClampedArray(256);
  for (let v = 0; v < 256; v += 1) table[v] = Math.round(Math.pow(v / 255, gamma) * 255);
  for (let i = 0; i < rgba.length; i += 4) {
    rgba[i] = table[rgba[i]];
    rgba[i + 1] = table[rgba[i + 1]];
    rgba[i + 2] = table[rgba[i + 2]];
  }
}

/* --------------------------- Effect measurement ----------------------------- */

/**
 * Mean detector response over the palm interior — "crease contrast", the number that says whether
 * any of this helped.
 *
 * Measured over an inset region rather than the whole crop, because the crop's border is the
 * rectification's own edge and always carries some response. Read-only: it cannot change what the
 * pipeline produces, which is why it is safe to compute with the flags off and compare against.
 */
export function creaseContrast(field: Float32Array, size: number, inset = 0.15): number {
  const low = Math.floor(size * inset);
  const high = size - low;
  let sum = 0;
  let count = 0;
  for (let y = low; y < high; y += 1) {
    for (let x = low; x < high; x += 1) {
      sum += field[y * size + x];
      count += 1;
    }
  }
  return count === 0 ? 0 : sum / count;
}

/**
 * The one seam through which camera control can touch the detection path.
 *
 * Everything else this module does acts on the camera; only the software fallback rewrites pixels.
 * Routing that through a single function with an explicit flag makes the byte-identity guarantee
 * checkable rather than argued: with the flag off it returns **the caller's own array, unmodified and
 * by identity**, so a test can assert `result === input` and know nothing was copied, adjusted or
 * rounded on the way through.
 *
 * @returns the same reference when disabled or when no correction is warranted; otherwise a
 * corrected copy, leaving the caller's crop intact for the debug view.
 */
export function correctExposure(
  rgba: Uint8ClampedArray<ArrayBuffer>,
  enabled: boolean,
  stats: LumaStats,
): { readonly rgba: Uint8ClampedArray<ArrayBuffer>; readonly gamma: number } {
  if (!enabled) return { rgba, gamma: GAMMA_MIN };
  const gamma = fallbackGamma(stats);
  if (gamma <= GAMMA_MIN + 1e-6) return { rgba, gamma: GAMMA_MIN };
  const corrected = new Uint8ClampedArray(rgba) as Uint8ClampedArray<ArrayBuffer>;
  applyGamma(corrected, gamma);
  return { rgba: corrected, gamma };
}

/* ------------------------------- The DOM half ------------------------------- */

export interface CameraControlState {
  /** What the last `applyConstraints` actually took. */
  readonly applied: readonly string[];
  readonly unsupported: readonly string[];
  readonly bias: number;
  /** Software gamma currently being applied to the crop; 1 means none. */
  readonly gamma: number;
  readonly lastError: string | null;
  readonly lastAppliedMs: number;
  /** True once a constraint has been refused and the software path has taken over. */
  readonly usingFallback: boolean;
}

export function emptyCameraControl(): CameraControlState {
  return {
    applied: [],
    unsupported: [],
    bias: BIAS_MAX,
    gamma: GAMMA_MIN,
    lastError: null,
    lastAppliedMs: 0,
    usingFallback: false,
  };
}

/** Reads a track's capabilities without assuming the method or the fields exist. */
export function readCapabilities(track: MediaStreamTrack): ExtendedCapabilities | null {
  const getter = (track as { getCapabilities?: () => MediaTrackCapabilities }).getCapabilities;
  if (typeof getter !== "function") return null;
  try {
    return getter.call(track) as ExtendedCapabilities;
  } catch {
    // Firefox throws rather than returning an empty object. Not an error — just no capabilities.
    return null;
  }
}

/**
 * Asks the camera for a plan, and reports what it took.
 *
 * Never throws and never rejects: a refused constraint is ordinary, and the caller is a frame loop.
 * The failure is recorded in the returned state so the HUD can show it, which is the difference
 * between "camera control did nothing" and "camera control is not supported here".
 */
export async function applyPlan(
  track: MediaStreamTrack,
  state: CameraControlState,
  bias: number,
  nowMs: number,
  wantTorch = false,
): Promise<CameraControlState> {
  const capabilities = readCapabilities(track);
  const plan = planConstraints(capabilities, bias, wantTorch);
  if (plan.advanced === null) {
    return {
      ...state,
      bias,
      applied: [],
      unsupported: plan.unsupported,
      usingFallback: true,
      lastError: "no settable camera constraints on this device",
      lastAppliedMs: nowMs,
    };
  }

  try {
    await track.applyConstraints({ advanced: [plan.advanced] } as MediaTrackConstraints);
    return {
      ...state,
      bias,
      applied: plan.supported,
      unsupported: plan.unsupported,
      usingFallback: false,
      lastError: null,
      lastAppliedMs: nowMs,
    };
  } catch (error) {
    const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    return {
      ...state,
      bias,
      applied: [],
      unsupported: plan.unsupported,
      usingFallback: true,
      lastError: message,
      lastAppliedMs: nowMs,
    };
  }
}
