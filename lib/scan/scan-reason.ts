/**
 * THE LITANY'S ONE INSTRUCTION (scan-complete G2.3): the SPECIFIC thing stopping the scan, in plain words.
 *
 * Per frame, the reason is the gate's first failing check (quality.ts HINT_ORDER — the same one the funnel's
 * rejection histogram counts), refined by WHERE the problem is: which edge the palm leaves the frame by, which
 * way the pose wants the tilt. The leaf then shows the TOP reason of the last second (`ReasonWindow`) rather
 * than the latest frame's, so a reason that flickers for one frame never reaches the reader, and one that
 * blocks the hold does.
 *
 * Never a generic "poora haath": it asked for the whole hand while the gate now measures the palm, and on the
 * 2026-09-29 recordings it hid the real problem — too close — for 50 s
 * (docs/specs/phone-scan-2026-09-29-findings.md).
 *
 * Directions are the reader's, in DISPLAY space: a mirrored preview (the front camera) swaps left and right,
 * so "move it right" always means the reader's right. Tilts already are (quality.ts palmTilt).
 *
 * Pure, and outside the frozen core.
 */
import { DISTANCE_WORDS, LOST_NEAR_FILL } from "./distance";
import { palmFrameMargins, palmFramePoints, type FrameSize, type PoseProfile } from "./quality";
import type { Landmark3, QualityVerdict } from "./types";

export type FrameEdge = "top" | "bottom" | "left" | "right";

export type ReasonKey =
  | "no_hand"
  | "low_confidence"
  | "too_close"
  | "out_of_frame_top"
  | "out_of_frame_bottom"
  | "out_of_frame_left"
  | "out_of_frame_right"
  | "not_palm_up"
  | "tilt_left"
  | "tilt_right"
  | "fingers_curled"
  | "wrong_hand"
  | "too_far"
  | "too_dark"
  | "too_bright"
  | "unsteady"
  | "inconsistent";

/** The words, one line of ink each, and the English the accessible name carries. */
export const REASON_WORDS: Readonly<Record<ReasonKey, { readonly hi: string; readonly en: string }>> = {
  no_hand: { hi: "हथेली कैमरे के सामने लाएँ", en: "Bring your palm in front of the camera" },
  low_confidence: { hi: "हाथ साफ़ नहीं दिख रहा", en: "The hand is not clear" },
  too_close: DISTANCE_WORDS.near,
  out_of_frame_top: { hi: "हथेली ऊपर से बाहर · थोड़ा नीचे लाएँ", en: "The palm leaves the top — bring it down a little" },
  out_of_frame_bottom: { hi: "हथेली नीचे से बाहर · थोड़ा ऊपर लाएँ", en: "The palm leaves the bottom — bring it up a little" },
  out_of_frame_left: { hi: "हथेली बाएँ से बाहर · थोड़ा दाएँ लाएँ", en: "The palm leaves the left — move it right a little" },
  out_of_frame_right: { hi: "हथेली दाएँ से बाहर · थोड़ा बाएँ लाएँ", en: "The palm leaves the right — move it left a little" },
  not_palm_up: { hi: "हथेली कैमरे की ओर घुमाएँ", en: "Turn your palm to the camera" },
  tilt_left: { hi: "हथेली थोड़ी बाईं ओर झुकाएँ", en: "Tilt your palm a little to the left" },
  tilt_right: { hi: "हथेली थोड़ी दाईं ओर झुकाएँ", en: "Tilt your palm a little to the right" },
  fingers_curled: { hi: "उँगलियाँ खोलकर सीधी रखें", en: "Open your fingers and keep them straight" },
  wrong_hand: { hi: "अब दूसरा हाथ दिखाएँ", en: "Now show the other hand" },
  too_far: DISTANCE_WORDS.far,
  too_dark: { hi: "रोशनी कम है · उजाले में आएँ", en: "Too dark — move into the light" },
  too_bright: { hi: "रोशनी बहुत तेज़ · थोड़ा हटें", en: "Too bright — step out of the glare" },
  unsteady: { hi: "हाथ स्थिर रखें", en: "Hold your hand still" },
  inconsistent: { hi: "हाथ आगे-पीछे न करें", en: "Keep your hand at one distance" },
};

/** The edge whose margin a palm point is farthest past (display space), or null when none is past any. */
function palmEdgePast(landmarks: readonly Landmark3[], margins: { readonly x: number; readonly y: number }, mirrored: boolean): FrameEdge | null {
  const points = palmFramePoints(landmarks);
  if (points === null) return null;
  let worst = 0;
  let edge: FrameEdge | null = null;
  const consider = (past: number, side: FrameEdge): void => {
    if (past > worst) {
      worst = past;
      edge = side;
    }
  };
  for (const p of points) {
    consider(margins.y - p.y, "top");
    consider(p.y - (1 - margins.y), "bottom");
    consider(margins.x - p.x, "left");
    consider(p.x - (1 - margins.x), "right");
  }
  if (edge === null || !mirrored) return edge;
  return edge === "left" ? "right" : edge === "right" ? "left" : edge;
}

/**
 * The edge the palm leaves the frame by, in display space: of the palm points (quality.ts palmFramePoints) the
 * one farthest past the gate's margin, and on which side. Null when none is past it.
 */
export function palmExitEdge(landmarks: readonly Landmark3[], frame: FrameSize | undefined, mirrored: boolean): FrameEdge | null {
  return palmEdgePast(landmarks, palmFrameMargins(frame), mirrored);
}

/** How near an edge — a share of the frame on each axis — a palm must be for its loss to read as leaving by it. */
export const LOST_EDGE_MARGIN = 0.08;

/** The edge the palm is within {@link LOST_EDGE_MARGIN} of (display space), the one it is nearest past; else null. */
export function palmNearEdge(landmarks: readonly Landmark3[], mirrored: boolean): FrameEdge | null {
  return palmEdgePast(landmarks, { x: LOST_EDGE_MARGIN, y: LOST_EDGE_MARGIN }, mirrored);
}

/** How long after the palm is lost its last whereabouts still name the reason; after it, plainly no hand. */
export const LOST_REASON_MS = 1500;

/** Where the palm was when last seen, so its loss can be given a specific reason. */
export interface LastSeenPalm {
  readonly atMs: number;
  /** The palm quad's fill of the short side (quality.ts palmQuadFill). */
  readonly fill: number;
  /** The edge it was within LOST_EDGE_MARGIN of, display space ({@link palmNearEdge}); null when clear. */
  readonly edge: FrameEdge | null;
}

export interface FrameReasonInput {
  readonly verdict: QualityVerdict;
  /** This frame's landmarks, or null without a hand. */
  readonly landmarks: readonly Landmark3[] | null;
  readonly frame?: FrameSize;
  /** The PREVIEW's mirror (true on the front camera), so directions come out in the reader's terms. */
  readonly mirrored: boolean;
  /** The guided pose in force, for the tilt's direction. */
  readonly pose: PoseProfile | null;
  /** Where the palm was last seen, and when (G2): a LOST palm is given the reason its whereabouts point to. */
  readonly lastSeen?: LastSeenPalm | null;
  readonly nowMs?: number;
}

/** This frame's reason, or null when every gate passed. */
export function frameReason(input: FrameReasonInput): ReasonKey | null {
  if (input.landmarks === null) {
    /*
     * A palm that has just gone is not "no hand" yet. Last seen at an edge, it left by it; last seen centred and
     * close, it most likely came nearer than the landmarker can follow — in emulation it lets go of a palm
     * between 0.50 and 0.56 of the width, long before the gate's 0.85 — and the reader should move back, not
     * be asked to bring a hand that is right there in front of the camera.
     */
    const seen = input.lastSeen ?? null;
    if (seen !== null && input.nowMs !== undefined && input.nowMs - seen.atMs <= LOST_REASON_MS) {
      if (seen.edge !== null) return `out_of_frame_${seen.edge}`;
      if (seen.fill >= LOST_NEAR_FILL) return "too_close";
    }
    return "no_hand";
  }
  const first = input.verdict.issues[0];
  if (first === undefined) return null;
  switch (first) {
    case "out_of_frame": {
      const edge = palmExitEdge(input.landmarks, input.frame, input.mirrored);
      return `out_of_frame_${edge ?? "bottom"}`;
    }
    case "tilt_direction":
      return input.pose?.tiltSign === 1 ? "tilt_right" : "tilt_left";
    default:
      return first;
  }
}

/** How much recent history the leaf's reason is the top of. */
export const REASON_WINDOW_MS = 1000;

/**
 * The share of the window's frames that must be rejected for a reason to be shown at all. Low on purpose:
 * the hold resets on ANY failing frame, so at a tenth of the frames failing the pose already completes only
 * about one attempt in ten (0.9^22 at 15 fps over the 1.5 s hold), which is a reason worth naming.
 */
export const REASON_MIN_SHARE = 0.1;

/**
 * The last second of reasons, and the one the leaf should show: the most frequent rejection in the window —
 * ties to the more recent — once rejections are at least {@link REASON_MIN_SHARE} of it; null otherwise.
 * A fixed-size ring, so a frame costs one write and no allocation.
 */
export class ReasonWindow {
  private readonly times: Float64Array;
  private readonly keys: (ReasonKey | null)[];
  private head = 0;
  private size = 0;

  constructor(private readonly windowMs: number = REASON_WINDOW_MS, capacity = 128) {
    this.times = new Float64Array(capacity);
    this.keys = new Array<ReasonKey | null>(capacity).fill(null);
  }

  record(atMs: number, key: ReasonKey | null): void {
    const capacity = this.times.length;
    this.times[this.head] = atMs;
    this.keys[this.head] = key;
    this.head = (this.head + 1) % capacity;
    this.size = Math.min(capacity, this.size + 1);
  }

  /** The reason to show as of `nowMs`, or null. */
  top(nowMs: number): ReasonKey | null {
    const capacity = this.times.length;
    const counts = new Map<ReasonKey, { n: number; last: number }>();
    let frames = 0;
    let rejected = 0;
    for (let i = 0; i < this.size; i += 1) {
      const at = (this.head - 1 - i + capacity) % capacity;
      if (nowMs - this.times[at]! > this.windowMs) break;
      frames += 1;
      const key = this.keys[at]!;
      if (key === null) continue;
      rejected += 1;
      const seen = counts.get(key);
      if (seen === undefined) counts.set(key, { n: 1, last: this.times[at]! });
      else seen.n += 1;
    }
    if (frames === 0 || rejected / frames < REASON_MIN_SHARE) return null;
    let best: ReasonKey | null = null;
    let bestN = 0;
    let bestLast = -Infinity;
    for (const [key, { n, last }] of counts) {
      if (n > bestN || (n === bestN && last > bestLast)) {
        best = key;
        bestN = n;
        bestLast = last;
      }
    }
    return best;
  }

  reset(): void {
    this.head = 0;
    this.size = 0;
  }
}
