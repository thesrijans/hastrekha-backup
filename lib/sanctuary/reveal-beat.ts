/**
 * The reveal beat — the three and a half seconds between the last stage and the
 * bundle arriving.
 *
 * §6.3 writes it as a score rather than as a spec:
 *
 *     "रेखाएँ खींची जा चुकी हैं."        The lines have been traced.
 *             ── 1.2 s silence ──
 *     "पैटर्न पढ़े जा चुके हैं."          The patterns have been studied.
 *             ── 1.6 s silence ──
 *             screen darkens to black
 *             ── 0.6 s ──
 *             the bundle arrives
 *
 * and closes with the sentence the whole beat exists to obey: "Mystery comes
 * from silence and darkness, never from jump-scares."
 *
 * THE SILENCES ARE THE CONTENT. Every instinct in interface work says to fill
 * 1.6 seconds with something — a spinner, a shimmer, a progress bar finishing.
 * Each of those turns a held breath into a wait. The two lines stay on screen
 * through their silences and nothing else happens in them, which is what makes
 * the darkening land.
 *
 * Pure and time-in, phase-out, so the sequence can be tested at the
 * millisecond rather than watched. The component does nothing but render what
 * this returns.
 */

/** When the second line joins the first. The 1.2 s silence is the gap before it. */
export const REVEAL_SECOND_AT_MS = 1200;

/** When the screen begins to darken. The 1.6 s silence is the gap before this. */
export const REVEAL_DARKEN_AT_MS = 2800;

/** How long the darkening takes. */
export const REVEAL_DARK_MS = 600;

/** When the bundle arrives, and the only moment a navigation is allowed to happen. */
export const REVEAL_ARRIVE_AT_MS = REVEAL_DARKEN_AT_MS + REVEAL_DARK_MS;

/** The two lines, verbatim. Devanagari, with the English for the accessible name. */
export const REVEAL_LINES = [
  { hi: "रेखाएँ खींची जा चुकी हैं.", en: "The lines have been traced." },
  { hi: "पैटर्न पढ़े जा चुके हैं.", en: "The patterns have been studied." },
] as const;

export type RevealPhase = "first" | "second" | "darkening" | "arrive";

export interface RevealState {
  readonly phase: RevealPhase;
  /** How many of the two lines are on screen. Never decreases: a line already read does not un-read. */
  readonly linesShown: 0 | 1 | 2;
  /** 0–1 of the darkening. 0 until it begins, 1 when the screen is black. */
  readonly darkness: number;
  /** True only at the end, and it is what the route watches to leave. */
  readonly arrived: boolean;
}

/**
 * The beat at one moment.
 *
 * `elapsedMs` is measured from the moment the beat began, not from the scan's
 * start — the beat is a fixed score and must play identically whether the scan
 * before it took four seconds or forty.
 */
export function revealAt(elapsedMs: number): RevealState {
  const t = Number.isFinite(elapsedMs) ? Math.max(0, elapsedMs) : 0;

  if (t < REVEAL_SECOND_AT_MS) {
    return { phase: "first", linesShown: 1, darkness: 0, arrived: false };
  }
  if (t < REVEAL_DARKEN_AT_MS) {
    return { phase: "second", linesShown: 2, darkness: 0, arrived: false };
  }
  if (t < REVEAL_ARRIVE_AT_MS) {
    /* Linear, and deliberately not eased. An eased fade to black has a moment
       where it appears to stop, and that reads as the screen having frozen —
       which is the one thing a dark screen must not read as. */
    const darkness = (t - REVEAL_DARKEN_AT_MS) / REVEAL_DARK_MS;
    return { phase: "darkening", linesShown: 2, darkness, arrived: false };
  }
  return { phase: "arrive", linesShown: 2, darkness: 1, arrived: true };
}

/**
 * The beat with motion withdrawn.
 *
 * Under `prefers-reduced-motion` the fade is not shortened, it is removed: both
 * lines are on screen from the first frame and the screen is already black.
 * The route still waits out {@link REVEAL_ARRIVE_AT_MS} before navigating,
 * because the reader still has two sentences to read — reduced motion is a
 * request about movement, never a request to be hurried.
 */
export function revealReduced(elapsedMs: number): RevealState {
  const arrived = revealAt(elapsedMs).arrived;
  return { phase: arrived ? "arrive" : "second", linesShown: 2, darkness: arrived ? 1 : 0, arrived };
}
