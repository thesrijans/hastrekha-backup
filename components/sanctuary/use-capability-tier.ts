"use client";

/**
 * CAPABILITY TIER — how much scene this device is allowed to render.
 *
 * §10 buys four different experiences with one decision: HIGH gets R3F and full
 * particles, MID gets plates + parallax + particles, LOW gets plates with
 * crossfade transitions and no particles, FLOOR is static and is also the
 * `prefers-reduced-motion` target. The decision has to be made before the first
 * camera move, from signals that are cheap, partly absent, and very easy to
 * read optimistically — which is exactly the trap §14 names: "a WebGL showpiece
 * that drops the scan to 12 fps" ships the day an unmeasured device is treated
 * as a capable one.
 *
 * So this module is deliberately split in two. `classifyCapability` is a pure,
 * total function over `CapabilitySignals` with no DOM anywhere in it, so every
 * threshold below is pinned by test/capability-tier.test.ts rather than by
 * whatever laptop the author happened to be sitting at. `useCapabilityTier` is
 * a thin client hook that gathers the signals, measures one frame cost, and
 * re-runs the pure function — it holds no policy of its own.
 *
 * [R6] The type is `CapabilityTier`, always spelled in full, and no consumer
 * takes a bare prop named `tier`: `ReadingTier` (free | premium | deep) already
 * exists and the Pothi renders both at once (a `premium` reading at `LOW`).
 */
import { useEffect, useRef, useState } from "react";

/**
 * The four rendering budgets of §10, as a closed union so a component can
 * `switch` on it exhaustively and the compiler catches a forgotten branch the
 * day a fifth scene is added.
 */
export type CapabilityTier = "HIGH" | "MID" | "LOW" | "FLOOR";

/**
 * Weakest to strongest. Exported because "is this device at least MID?" is a
 * question consumers keep asking, and comparing by index is the only way to ask
 * it without re-encoding the ordering — wrongly, eventually — at each site.
 */
export const CAPABILITY_TIERS: readonly CapabilityTier[] = ["FLOOR", "LOW", "MID", "HIGH"];

/**
 * The answer before anything has been measured, and the answer when every
 * signal is missing.
 *
 * LOW, not FLOOR and never HIGH. Not HIGH because an unmeasured device that
 * gets R3F is the §14 failure. Not FLOOR because FLOOR is a promise kept to
 * someone who asked for no motion; handing it to everybody for the first
 * ~170 ms and then starting motion is both a worse first frame and a lie about
 * what FLOOR means. LOW costs nothing to render (plates and crossfades, no
 * particles, no WebGL) and can only be revised upward.
 */
export const SAFE_CAPABILITY_TIER: CapabilityTier = "LOW";

/**
 * The best tier reachable while any signal is still unknown.
 *
 * MID is the honest ceiling for a partially blind reading: parallax and CSS
 * particles are compositor work a mid-range phone absorbs, while R3F is a
 * second renderer competing with the scan pipeline for one main thread. The
 * consequence is deliberate and worth naming out loud: Safari and Firefox do
 * not expose `navigator.deviceMemory`, so they cap at MID even on an M-series
 * Mac. Under-serving a fast Mac is a disappointment; over-serving a slow
 * Android is a broken scan.
 */
export const UNMEASURED_SIGNAL_CEILING: CapabilityTier = "MID";

/** The query §10 names as the FLOOR trigger, exported so the sanctuary asks it identically everywhere. */
export const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

/* -------------------------------- Thresholds -------------------------------- */

/**
 * 8 GB — the largest value `navigator.deviceMemory` will ever report (the spec
 * quantises and caps it), so this line means "a desktop or a flagship phone":
 * Pixel 8/9, Galaxy S23+, any laptop. Room for a WebGL context beside the
 * scan's own working buffers.
 */
export const DEVICE_MEMORY_HIGH_GB = 8;

/**
 * 4 GB — the mid-range Android band (Redmi Note, Moto G). Plates, parallax and
 * particles fit here; a second GPU-backed scene next to the detector does not.
 */
export const DEVICE_MEMORY_MID_GB = 4;

/**
 * 2 GB — entry-level Android and older iPads. Static plates only: every extra
 * animated layer is a texture the compositor will evict and re-upload.
 */
export const DEVICE_MEMORY_LOW_GB = 2;

/**
 * 8 logical cores — a desktop or a big.LITTLE flagship, where a core is still
 * free for the detector worker while a render loop runs. Below this, R3F and
 * the pipeline are the same cores taking turns.
 */
export const CORES_HIGH = 8;

/** 4 logical cores — the mid-range floor. The scan already contends for these, so only main-thread-cheap motion is safe. */
export const CORES_MID = 4;

/** 2 logical cores — the last point at which the render loop and the pipeline are not literally the same thread. */
export const CORES_LOW = 2;

/**
 * 20 ms median idle frame — a 60 Hz panel idles at 16.7 ms and a 50 Hz panel at
 * 20.0 ms, so this admits any display keeping up with itself while the page
 * does nothing, with the median absorbing jitter. A device that cannot hold
 * 50 fps at rest will not hold 60 with an R3F scene and the scan both running.
 * Note what this signal is not: it measures whether a device keeps up with its
 * OWN refresh rate, so a weak 120 Hz phone can pass it at 8.3 ms — which is
 * exactly why it is never consulted alone.
 */
export const FRAME_MS_HIGH = 20;

/** 26 ms ≈ 38 fps at rest — a device already working. Compositor-only motion (parallax, particles) survives; WebGL does not. */
export const FRAME_MS_MID = 26;

/**
 * 34 ms ≈ 30 fps at rest — crossfades only. A crossfade is one opacity
 * interpolation and still reads as intentional at 30 fps, where a moving
 * parallax layer reads as judder.
 */
export const FRAME_MS_LOW = 34;

/**
 * 250 ms ≈ 4 fps. No real device idles this slowly; a reading at or above this
 * is a throttled background tab (rAF drops to roughly 1 Hz) or a paused
 * debugger. Believing it would pin a flagship to FLOOR for the whole session,
 * so it is discarded as UNKNOWN instead — which caps the tier at MID rather
 * than dropping it to FLOOR.
 */
export const FRAME_MS_IMPLAUSIBLE = 250;

/** How many signals a complete reading has. Fewer than this caps the result at {@link UNMEASURED_SIGNAL_CEILING}. */
const SIGNAL_COUNT = 3;

const TIER_RANK: Readonly<Record<CapabilityTier, number>> = { FLOOR: 0, LOW: 1, MID: 2, HIGH: 3 };

/** Safe-direction combiner: the classifier is a minimum, because one weak axis is enough to ruin a frame. */
function weaker(a: CapabilityTier, b: CapabilityTier): CapabilityTier {
  return TIER_RANK[a] <= TIER_RANK[b] ? a : b;
}

/**
 * A reading counts only if it is a positive finite number. Zero, negative and
 * NaN all mean "the host did not really answer", and are routed to UNKNOWN
 * rather than to a tier, so a broken clock never buys or costs a tier.
 */
function usable(value: number | null): number | null {
  return value !== null && Number.isFinite(value) && value > 0 ? value : null;
}

function memoryTier(gigabytes: number | null): CapabilityTier | null {
  const gb = usable(gigabytes);
  if (gb === null) return null;
  if (gb >= DEVICE_MEMORY_HIGH_GB) return "HIGH";
  if (gb >= DEVICE_MEMORY_MID_GB) return "MID";
  if (gb >= DEVICE_MEMORY_LOW_GB) return "LOW";
  return "FLOOR";
}

function coreTier(cores: number | null): CapabilityTier | null {
  const count = usable(cores);
  if (count === null) return null;
  if (count >= CORES_HIGH) return "HIGH";
  if (count >= CORES_MID) return "MID";
  if (count >= CORES_LOW) return "LOW";
  return "FLOOR";
}

function frameTier(frameMs: number | null): CapabilityTier | null {
  const ms = usable(frameMs);
  if (ms === null || ms >= FRAME_MS_IMPLAUSIBLE) return null;
  if (ms <= FRAME_MS_HIGH) return "HIGH";
  if (ms <= FRAME_MS_MID) return "MID";
  if (ms <= FRAME_MS_LOW) return "LOW";
  return "FLOOR";
}

/**
 * Everything the decision is allowed to depend on. An explicit struct rather
 * than a pile of globals, so the policy can be tested on devices nobody in this
 * repo owns, and so `null` — "this host does not answer that question" — is a
 * value the type system forces every caller to confront.
 */
export interface CapabilitySignals {
  /** `navigator.deviceMemory` in GB. Absent on Safari and Firefox; quantised and capped at 8 in Chrome. */
  readonly deviceMemory: number | null;
  /** `navigator.hardwareConcurrency`, logical cores. */
  readonly hardwareConcurrency: number | null;
  /** Median idle frame delta in ms from {@link probeFrameMs}; `null` until the probe resolves. */
  readonly frameMs: number | null;
  /** The `prefers-reduced-motion: reduce` match — not a performance signal but a stated preference that outranks all of them. */
  readonly prefersReducedMotion: boolean;
}

/**
 * The whole policy, pure and total: no DOM, no clock, no React, the same answer
 * for the same struct forever.
 *
 * Three rules, in order:
 *  1. `prefersReducedMotion` returns FLOOR and short-circuits everything else.
 *     §10 makes FLOOR the reduced-motion target, and somebody who asked their
 *     OS for stillness is not overruled by their 8-core CPU.
 *  2. Otherwise the answer is the WEAKEST tier any known signal supports. One
 *     slow axis is enough to drop frames, so the combiner is a minimum and
 *     never an average — averaging is how a fast CPU hides a starved GPU.
 *  3. Unknown signals never buy a tier. With any signal missing the result is
 *     capped at {@link UNMEASURED_SIGNAL_CEILING}; with every signal missing it
 *     is {@link SAFE_CAPABILITY_TIER}, never HIGH. An unknown device that gets
 *     HIGH is precisely the WebGL-showpiece-drops-the-scan-to-12fps failure
 *     §14 forbids, so ignorance always resolves downward.
 */
export function classifyCapability(signals: CapabilitySignals): CapabilityTier {
  if (signals.prefersReducedMotion) return "FLOOR";

  const measured: CapabilityTier[] = [];
  for (const candidate of [
    memoryTier(signals.deviceMemory),
    coreTier(signals.hardwareConcurrency),
    frameTier(signals.frameMs),
  ]) {
    if (candidate !== null) measured.push(candidate);
  }

  if (measured.length === 0) return SAFE_CAPABILITY_TIER;

  const supported = measured.reduce(weaker);
  return measured.length < SIGNAL_COUNT ? weaker(supported, UNMEASURED_SIGNAL_CEILING) : supported;
}

/* ---------------------------------- Probe ----------------------------------- */

/**
 * `requestAnimationFrame`, narrowed to what the probe uses. Injected instead of
 * called directly so the probe is testable without a browser, and so the hook
 * can wrap it to remember the outstanding handle: the scheduler seam is also
 * the teardown seam.
 */
export type RafScheduler = (callback: () => void) => number;

/** `performance.now`, injected for the same reason — a fake clock makes the median deterministic in a test. */
export type FrameClock = () => number;

/**
 * Nine deltas.
 *
 * Odd on purpose, so the median is an actually observed frame and not the mean
 * of two — averaging the middle pair readmits half of the outlier the median
 * exists to reject. Nine deltas is ~170 ms at 60 Hz: long enough that a single
 * GC pause is outvoted, short enough that the tier is settled well inside the
 * "first leaf visible < 1.5 s" budget of §10.
 */
export const FRAME_PROBE_SAMPLES = 9;

/**
 * Upper-middle order statistic. For an odd count that is the exact median; for
 * an even count it deliberately takes the slower of the two middles, because
 * every other tie-break in this module also breaks toward the safe tier.
 */
function medianMs(samples: readonly number[]): number {
  /* Unreachable while FRAME_PROBE_SAMPLES is fixed and odd, but an empty median is a lie the types cannot catch. */
  if (samples.length === 0) return Number.POSITIVE_INFINITY;
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

/**
 * One-off measurement of what a frame currently costs this device, resolving to
 * the MEDIAN of {@link FRAME_PROBE_SAMPLES} consecutive idle frame deltas.
 *
 * Median, not mean: one 300 ms GC pause during startup must not decide the tier
 * for a whole session, and a mean over nine frames turns that one pause into
 * +33 ms on every frame — by itself enough to move HIGH to FLOOR.
 *
 * The first callback only seeds the baseline and contributes no sample: the gap
 * between the call and the next frame boundary is a fraction of a frame rather
 * than a frame, and would bias the series low.
 *
 * If `raf` never calls back — a cancelled chain, a hidden tab — the promise
 * simply stays pending forever, on purpose. Nothing blocks on it, so the cost
 * of never measuring is that the caller keeps the tier it already had, which is
 * the safe one.
 */
export function probeFrameMs(raf: RafScheduler, now: FrameClock): Promise<number> {
  return new Promise<number>((resolve) => {
    const deltas: number[] = [];
    let previous: number | null = null;

    const step = (): void => {
      const stamp = now();
      if (previous !== null) deltas.push(stamp - previous);
      previous = stamp;
      if (deltas.length >= FRAME_PROBE_SAMPLES) {
        resolve(medianMs(deltas));
        return;
      }
      raf(step);
    };

    raf(step);
  });
}

/* ----------------------------------- Hook ------------------------------------ */

/** `deviceMemory` is not in lib.dom and is absent at runtime on Safari and Firefox — read it as `unknown`, never assert it. */
function readDeviceMemory(): number | null {
  if (typeof navigator === "undefined") return null;
  const reported: unknown = (navigator as Navigator & { readonly deviceMemory?: unknown }).deviceMemory;
  return typeof reported === "number" ? reported : null;
}

/** Typed as a number by lib.dom, but embedded webviews do omit it, so the runtime check is not redundant. */
function readHardwareConcurrency(): number | null {
  if (typeof navigator === "undefined") return null;
  const reported: unknown = navigator.hardwareConcurrency;
  return typeof reported === "number" ? reported : null;
}

/**
 * The tier this device should render at, refined as evidence arrives.
 *
 * SSR-safe by construction: the first value is the constant
 * {@link SAFE_CAPABILITY_TIER}, identical on the server and in the first client
 * render, so there is no hydration mismatch and no branch on `window` during
 * render. Everything else happens in an effect — the device signals first
 * (synchronous, so the tier is right within a frame of mount), then the probe,
 * which can only revise the axis nobody had measured yet.
 *
 * Teardown matters because the probe is a live rAF chain: unmounting clears the
 * mounted flag (so a late resolve cannot `setState`), cancels the outstanding
 * frame, and drops the media-query listener. The probe starts once per mount,
 * guarded by the measured value rather than by a "did we start" flag alone:
 * React 19 StrictMode runs the effect, tears it down and runs it again, and a
 * probe killed by that first teardown has to be allowed to start over or the
 * tier stays below what the device deserves. A probe that actually finished is
 * never repeated.
 */
export function useCapabilityTier(): CapabilityTier {
  const [capabilityTier, setCapabilityTier] = useState<CapabilityTier>(SAFE_CAPABILITY_TIER);
  const isMountedRef = useRef(false);
  const frameMsRef = useRef<number | null>(null);
  const probeInFlightRef = useRef(false);
  const rafHandleRef = useRef<number | null>(null);

  useEffect(() => {
    isMountedRef.current = true;

    const media = typeof window.matchMedia === "function" ? window.matchMedia(REDUCED_MOTION_QUERY) : null;

    const apply = (): void => {
      if (!isMountedRef.current) return;
      setCapabilityTier(
        classifyCapability({
          deviceMemory: readDeviceMemory(),
          hardwareConcurrency: readHardwareConcurrency(),
          frameMs: frameMsRef.current,
          /* Without matchMedia the preference is unknowable, and animating at somebody who
             asked for stillness is the one failure here that hurts a person. Unknown = FLOOR. */
          prefersReducedMotion: media === null ? true : media.matches,
        }),
      );
    };

    apply();

    const onMotionPreferenceChange = (): void => apply();
    media?.addEventListener("change", onMotionPreferenceChange);

    if (frameMsRef.current === null && !probeInFlightRef.current) {
      probeInFlightRef.current = true;
      const scheduler: RafScheduler = (callback) => {
        const handle = window.requestAnimationFrame(callback);
        rafHandleRef.current = handle;
        return handle;
      };
      void probeFrameMs(scheduler, () => performance.now()).then((frameMs) => {
        probeInFlightRef.current = false;
        rafHandleRef.current = null;
        frameMsRef.current = frameMs;
        apply();
      });
    }

    return () => {
      isMountedRef.current = false;
      media?.removeEventListener("change", onMotionPreferenceChange);
      if (rafHandleRef.current !== null) {
        window.cancelAnimationFrame(rafHandleRef.current);
        rafHandleRef.current = null;
        /* That chain is dead now, so a re-run of this effect is allowed to start a fresh one. */
        probeInFlightRef.current = false;
      }
    };
  }, []);

  return capabilityTier;
}
