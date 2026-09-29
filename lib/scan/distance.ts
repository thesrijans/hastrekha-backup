/**
 * THE DISTANCE METER (scan-complete G2): how near the palm is, read off the one number the gate itself
 * measures — the palm quad's fill of the frame's short side (quality.ts `palmQuadFill`; its width on a phone
 * held upright) — so what the reader is told about distance is what the gate decides.
 *
 *   बहुत दूर · पास लाएँ               fill below PALM_QUAD_MIN_FILL — guidance only: the gate's too_far is
 *                                  looser (the whole hand's span), so a palm here still scans, just with
 *                                  fewer pixels on every crease
 *   सही दूरी ✓                        fill in [PALM_QUAD_MIN_FILL, PALM_QUAD_MAX_FILL]
 *   बहुत पास · फोन थोड़ा पीछे करें      fill above PALM_QUAD_MAX_FILL — exactly when `too_close` fails
 *
 * The far edge carries a little hysteresis, so a palm hovering there does not flicker the words or re-fire the
 * haptic tick. The near edge carries none, on purpose: it is the gate's own threshold, and a meter that said
 * "right distance" to a frame the gate was rejecting as too close is the disagreement G1 ruled out.
 *
 * Pure, and outside the frozen core.
 */
import { PALM_QUAD_MAX_FILL } from "./quality";

/**
 * The band's near-to-far edge: below this share of the short side the palm is "too far" for the meter. On the
 * reader's own framing (docs/specs/phone-scan-2026-09-29-findings.md, reproduced by the G1 tight crops) the
 * palm quad sits at 0.46–0.56 — in the band, near its far edge; the band asks for closer, never farther.
 */
export const PALM_QUAD_MIN_FILL = 0.45;

/**
 * The target the guide outline is drawn at (G2.2): 0.5 of the short side — MEASURED, not the band's middle.
 * The reader's own framing on the 2026-09-29 recordings (0.46–0.56) was tracked in ≥ 97% of frames on the
 * phone; in emulation the landmarker held the palm at 0.50 and lost it by 0.56 with the fingertips cut
 * (scripts/capture/funnel-feeds.mjs on a fill sweep of two session stills). A guide at the band's middle
 * (0.65) would coax the reader past the point the detector can follow, and following the outline would lose
 * the hand. The band's ceiling stays the gate's: closer than this is still "सही दूरी" until 0.85.
 */
export const PALM_QUAD_TARGET_FILL = 0.5;

/**
 * A palm LOST while at least this close, and not at an edge, is told it is too close (lib/scan/scan-reason.ts):
 * past the target, the likeliest reason the landmarker lets go of a centred palm is that it came nearer than it
 * can follow — and "bring your palm in front of the camera" would be the generic answer to a specific problem.
 */
export const LOST_NEAR_FILL = 0.52;

/** How far below the far edge an in-band palm must drop before the meter calls it far again. */
export const DISTANCE_FAR_HYSTERESIS = 0.02;

export type DistanceState = "far" | "ok" | "near";

/** One frame's reading: the fill and the meter's state for it. */
export interface DistanceReading {
  readonly fill: number;
  readonly state: DistanceState;
}

/** The meter's state for this frame's fill, given the state it was in. */
export function nextDistanceState(fill: number, previous: DistanceState | null): DistanceState {
  if (!Number.isFinite(fill)) return previous ?? "far";
  if (fill > PALM_QUAD_MAX_FILL) return "near";
  const farEdge = previous === "ok" || previous === "near" ? PALM_QUAD_MIN_FILL - DISTANCE_FAR_HYSTERESIS : PALM_QUAD_MIN_FILL;
  return fill < farEdge ? "far" : "ok";
}

/** The meter's words — the spec's three, exactly — with the English the accessible name carries. */
export const DISTANCE_WORDS: Readonly<Record<DistanceState, { readonly hi: string; readonly en: string }>> = {
  far: { hi: "बहुत दूर · पास लाएँ", en: "Too far — bring your palm closer" },
  ok: { hi: "सही दूरी ✓", en: "Right distance" },
  near: { hi: "बहुत पास · फोन थोड़ा पीछे करें", en: "Too close — move the phone back a little" },
};

/** The ink gauge's scale (G2.1): this fill at its left end, that one at its right. The band sits between. */
export const GAUGE_MIN_FILL = 0.2;
export const GAUGE_MAX_FILL = 1;

/** Where a fill sits along the gauge, 0 (left, far) to 1 (right, near), clamped. */
export function gaugePosition(fill: number): number {
  if (!Number.isFinite(fill)) return 0;
  return Math.min(1, Math.max(0, (fill - GAUGE_MIN_FILL) / (GAUGE_MAX_FILL - GAUGE_MIN_FILL)));
}

/**
 * The haptic tick on entering the band (G2.2) fires at most once in this long: a palm hovering at an edge
 * crosses it several times a second, and a phone that buzzes on every crossing is scolding, not guiding.
 */
export const BAND_TICK_MIN_INTERVAL_MS = 1500;

/** Whether this transition earns the tick: into the band, from anywhere else (or from no hand), not too soon. */
export function bandTickDue(previous: DistanceState | null, next: DistanceState | null, lastTickAtMs: number | null, nowMs: number): boolean {
  if (next !== "ok" || previous === "ok") return false;
  return lastTickAtMs === null || nowMs - lastTickAtMs >= BAND_TICK_MIN_INTERVAL_MS;
}
