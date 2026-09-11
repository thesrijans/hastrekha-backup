/**
 * The Threshold — the first-visit entrance, as a score.
 *
 * §6.1 writes it as timings, and the timings are the design:
 *
 *     0.0 s  black
 *     0.5 s  a single gold point appears, centre, breathing
 *     1.5 s  the point resolves into a distant doorway; dust drifts through it
 *     2.5 s  HASTREKHA
 *     3.2 s  हस्तरेखा
 *     4.0 s  "Ancient wisdom. Modern insight."
 *     5.0 s  "Your hands hold a story."
 *     6.0 s  a lit path of gold dust leads toward the doorway
 *     6.5 s  [ ENTER THE SANCTUARY ] — never auto-advances
 *
 * The CSS form (U3a) plays this entirely with keyframes: each beat's start time is
 * written onto its element as a custom property from THIS table, so the
 * stylesheet and the test read one set of numbers and cannot drift apart. No
 * timer runs in JavaScript at all, which is what makes the sequence instant on a
 * cold load and free on a returning one.
 *
 * NEVER AUTO-ADVANCES. There is no beat after the button. The reader enters or
 * skips; the room does not open itself.
 */

export type ThresholdBeatId =
  | "black"
  | "point"
  | "doorway"
  | "wordmark"
  | "devanagari"
  | "motto"
  | "story"
  | "path"
  | "enter";

export interface ThresholdBeat {
  readonly id: ThresholdBeatId;
  /** When the beat begins, in ms from the moment the Threshold is shown. */
  readonly atMs: number;
}

/** §6.1, verbatim in milliseconds. Ascending, and the last beat is the button. */
export const THRESHOLD_BEATS: readonly ThresholdBeat[] = [
  { id: "black", atMs: 0 },
  { id: "point", atMs: 500 },
  { id: "doorway", atMs: 1500 },
  { id: "wordmark", atMs: 2500 },
  { id: "devanagari", atMs: 3200 },
  { id: "motto", atMs: 4000 },
  { id: "story", atMs: 5000 },
  { id: "path", atMs: 6000 },
  { id: "enter", atMs: 6500 },
];

/** A beat's start time, for writing onto its element. */
export function thresholdBeatAt(id: ThresholdBeatId): number {
  return THRESHOLD_BEATS.find((beat) => beat.id === id)?.atMs ?? 0;
}

/** The two lines, verbatim from §6.1. */
export const THRESHOLD_MOTTO = "Ancient wisdom. Modern insight.";
export const THRESHOLD_STORY = "Your hands hold a story.";
export const THRESHOLD_ENTER_LABEL = "Enter the Sanctuary";

/**
 * How long the push through the doorway lasts once the reader clicks.
 *
 * §6.1's 1.8 s, which sits inside the camera band the token layer names
 * (`--snc-duration-camera-min/max`, 1.2–2.0 s): the push IS a camera move, and a
 * push that were shorter than every other camera move would read as a cut.
 */
export const THRESHOLD_PUSH_MS = 1800;

/**
 * Where "this visitor has entered before" is remembered.
 *
 * localStorage, not sessionStorage: §6.1 makes the entrance first-visit only, and
 * a visit is not a tab. Versioned, so a later Threshold can be shown once to
 * people who have only seen this one.
 */
export const THRESHOLD_STORAGE_KEY = "hastrekha:threshold:v1";

/** The value written once the visitor has entered or skipped. */
export const THRESHOLD_SEEN = "seen";

/**
 * The query parameter that replays the entrance. §6.1 puts "replay entrance" in
 * settings; settings is U5, so until then the colophon on Home carries the link.
 */
export const THRESHOLD_REPLAY_PARAM = "entrance";
export const THRESHOLD_REPLAY_VALUE = "replay";

export interface ThresholdDecisionInput {
  /** What localStorage holds under {@link THRESHOLD_STORAGE_KEY}, or null. */
  readonly stored: string | null;
  /** `prefers-reduced-motion: reduce`. */
  readonly reducedMotion: boolean;
  /** The visitor asked to see it again. */
  readonly replay: boolean;
}

/**
 * Whether the Threshold plays on this load.
 *
 * Reduced motion wins over everything, replay included: §6.1 says the entrance is
 * "skipped instantly" for someone who asked for stillness, and a replay link is
 * not that person changing their mind about their vestibular system. Otherwise a
 * replay always plays, and a first visit plays; a returning visitor never does.
 */
export function thresholdShouldPlay({ stored, reducedMotion, replay }: ThresholdDecisionInput): boolean {
  if (reducedMotion) return false;
  if (replay) return true;
  return stored !== THRESHOLD_SEEN;
}

/**
 * The pre-paint decision, as a self-contained script body.
 *
 * Inlined into the page right after the Threshold's markup so it runs before
 * that markup is first painted: a returning visitor must never see a frame of
 * black they did not ask for, and a first-time visitor must never see a frame of
 * room before the entrance covers it. It is the same rule as
 * {@link thresholdShouldPlay}, restated in plain ES5 because it runs before any
 * bundle has loaded — and test/sanctuary-threshold.test.ts executes this string
 * against the same inputs to prove the two agree.
 */
export function thresholdPrePaintScript(elementId: string): string {
  return [
    "(function(){",
    "var el=document.getElementById(" + JSON.stringify(elementId) + ");",
    "if(!el)return;",
    "var play=true;",
    "try{",
    "var reduced=window.matchMedia&&window.matchMedia('(prefers-reduced-motion: reduce)').matches;",
    "var replay=new URLSearchParams(window.location.search).get(" +
      JSON.stringify(THRESHOLD_REPLAY_PARAM) +
      ")===" +
      JSON.stringify(THRESHOLD_REPLAY_VALUE) +
      ";",
    "var stored=window.localStorage.getItem(" + JSON.stringify(THRESHOLD_STORAGE_KEY) + ");",
    "play=reduced?false:(replay?true:stored!==" + JSON.stringify(THRESHOLD_SEEN) + ");",
    "}catch(e){play=false;}",
    "el.setAttribute('data-snc-threshold',play?'playing':'skipped');",
    "})();",
  ].join("");
}
