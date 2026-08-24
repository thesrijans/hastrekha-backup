/**
 * Anchor stabilisation — the other half of making accumulated evidence survive.
 *
 * `fusion.ts` establishes that rectified space is exactly motion-compensated *given exact anchors*.
 * The anchors are not exact. MediaPipe's landmarks jitter by a couple of thousandths of the frame
 * even on a perfectly still hand, and because the rectifying homography is fitted to just four or
 * five of them, that jitter is amplified into the crop: the same patch of skin slides by a few
 * pixels between consecutive frames. A palm crease is two to three pixels wide, so a slide of that
 * size does not blur the average slightly — it walks the line out from under itself, and the EMA
 * accumulates a smeared band rather than a line. `thin()` cannot skeletonise a band, which is a
 * large part of why extraction returned short fragments.
 *
 * The fix belongs at the cause. A **1-euro filter** on each anchor removes the jitter without adding
 * the lag a fixed low-pass would: its cutoff frequency rises with the anchor's own speed, so a still
 * hand is filtered hard and a moving hand is barely filtered at all. That velocity adaptation is not
 * a refinement, it is the whole point — a fixed EMA at the same at-rest strength would leave the crop
 * trailing a moving hand by roughly 190ms, which is far worse misregistration than the jitter it removed.
 *
 * Second job, same module: the four-versus-five anchor decision chatters. `palmAnchors` includes the
 * percussion point when it lands inside the frame, and a point sitting near the edge flips the
 * decision frame to frame. Each flip is a real crop jump that `fusion.ts` has to remap. Hysteresis
 * makes the convention change only when the evidence has been consistent for a while.
 *
 * Pure state-in/state-out, no DOM — so the filter's step response is unit-tested rather than assumed.
 */
import type { Point2 } from "./types";

/**
 * At-rest cutoff. At a 30Hz tick this gives a smoothing factor near 0.17, which measures as a
 * roughly threefold reduction in same-skin slide — taking it below the width of the line being tracked.
 */
export const ONE_EURO_MIN_CUTOFF_HZ = 0.8;
/**
 * How fast the cutoff opens with speed, in Hz per (pixel per second).
 *
 * Chosen so lag-induced misregistration stays around a pixel or two at every speed rather than being
 * minimised at one speed and terrible at others: a slow drift is filtered hard because it can be,
 * and a fast sweep is passed through because trailing the hand is the worse error.
 */
export const ONE_EURO_BETA = 0.06;
/** Cutoff for the speed estimate itself. Low enough that jitter cannot masquerade as motion. */
export const ONE_EURO_D_CUTOFF_HZ = 1.0;
/**
 * Clamp on the filter's timestep.
 *
 * A backgrounded tab resumes with a multi-second delta, which would drive the smoothing factor to 1
 * and silently disable the filter at exactly the moment the hand is least well observed.
 */
export const ANCHOR_MAX_DT_MS = 100;
/** Consecutive dissenting frames before the anchor convention switches — about a quarter-second. */
export const PERCUSSION_HYSTERESIS_FRAMES = 8;

interface Channel {
  value: number;
  derivative: number;
  started: boolean;
}

export interface AnchorStabiliser {
  /** One channel per coordinate of up to five anchors. */
  readonly channels: Channel[];
  lastMs: number;
  /** The convention currently in force, and how many frames have argued for the other one. */
  usePercussion: boolean;
  dissent: number;
  /** Frames processed since the last reset. Surfaced so the HUD can show the filter warming. */
  frames: number;
}

export function emptyStabiliser(): AnchorStabiliser {
  return {
    channels: Array.from({ length: 10 }, () => ({ value: 0, derivative: 0, started: false })),
    lastMs: 0,
    usePercussion: false,
    dissent: 0,
    frames: 0,
  };
}

/** Smoothing factor for a cutoff frequency and timestep — the standard 1-euro alpha. */
export function smoothingFactor(cutoffHz: number, dtSeconds: number): number {
  const tau = 1 / (2 * Math.PI * cutoffHz);
  return 1 / (1 + tau / dtSeconds);
}

function filterChannel(channel: Channel, x: number, dtSeconds: number): number {
  if (!channel.started) {
    channel.started = true;
    channel.value = x;
    channel.derivative = 0;
    return x;
  }
  const rawDerivative = (x - channel.value) / dtSeconds;
  const dAlpha = smoothingFactor(ONE_EURO_D_CUTOFF_HZ, dtSeconds);
  channel.derivative += dAlpha * (rawDerivative - channel.derivative);
  // The adaptive step: a fast anchor gets a high cutoff, so it is passed through rather than lagged.
  const cutoff = ONE_EURO_MIN_CUTOFF_HZ + ONE_EURO_BETA * Math.abs(channel.derivative);
  const alpha = smoothingFactor(cutoff, dtSeconds);
  channel.value += alpha * (x - channel.value);
  return channel.value;
}

export interface StabiliseResult {
  readonly points: readonly Point2[];
  /** True when the convention changed on this frame — the one case `alignFusion` must remap. */
  readonly conventionChanged: boolean;
  readonly usePercussion: boolean;
}

/**
 * Filters one frame's anchors and decides the convention.
 *
 * The anchor *count* is decided here rather than taken from `palmAnchors`, because a decision that
 * flips on a point hovering at the frame edge costs a crop jump every time it changes its mind. The
 * raw observation still wins eventually — it just has to mean it.
 *
 * @param raw the frame-pixel anchors, four or five, as `palmAnchors` produced them.
 * @param nowMs a monotonic clock; the filter is timestep-based, not frame-count-based, so a dropped
 * frame weakens the smoothing exactly as much as it should rather than going unnoticed.
 */
export function stabiliseAnchors(
  stabiliser: AnchorStabiliser,
  raw: readonly Point2[],
  nowMs: number,
): StabiliseResult {
  const wantsPercussion = raw.length === 5;
  let conventionChanged = false;

  if (wantsPercussion === stabiliser.usePercussion) {
    stabiliser.dissent = 0;
  } else {
    stabiliser.dissent += 1;
    if (stabiliser.dissent >= PERCUSSION_HYSTERESIS_FRAMES) {
      stabiliser.usePercussion = wantsPercussion;
      stabiliser.dissent = 0;
      conventionChanged = true;
    }
  }

  // Honour the settled convention, not this frame's opinion — unless the point simply is not there.
  const count = stabiliser.usePercussion && raw.length === 5 ? 5 : 4;

  const dtMs = stabiliser.lastMs === 0 ? ANCHOR_MAX_DT_MS : Math.min(ANCHOR_MAX_DT_MS, Math.max(1, nowMs - stabiliser.lastMs));
  stabiliser.lastMs = nowMs;
  const dtSeconds = dtMs / 1000;

  const points: Point2[] = [];
  for (let i = 0; i < count; i += 1) {
    points.push({
      x: filterChannel(stabiliser.channels[i * 2], raw[i].x, dtSeconds),
      y: filterChannel(stabiliser.channels[i * 2 + 1], raw[i].y, dtSeconds),
    });
  }
  stabiliser.frames += 1;

  return { points, conventionChanged, usePercussion: count === 5 };
}

/** Forgets the filter's history. Used when the hand is lost, so a new hand is not lerped toward. */
export function resetStabiliser(stabiliser: AnchorStabiliser): void {
  for (const channel of stabiliser.channels) {
    channel.started = false;
    channel.value = 0;
    channel.derivative = 0;
  }
  stabiliser.lastMs = 0;
  stabiliser.dissent = 0;
  stabiliser.frames = 0;
}
