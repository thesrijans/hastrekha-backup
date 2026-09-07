/* ============================================================================
 * SOUND SCAFFOLD - the spec 5 cue table as data, and the zero-bytes guarantee
 * pinned mechanically.
 *
 * There is no React renderer in this repo's test harness, so this file tests
 * the pure exports of `components/sanctuary/sound-provider.tsx` plus one thing
 * that is not testable any other way: that a muted sanctuary fetches nothing.
 *
 * Why a SOURCE-level pin. "No audio bytes while sound is off" is a property of
 * the module graph, not of any value the module returns. Adding
 * `import { createEngine } from "./audio-engine"` at the top of the provider
 * would leave every behaviour below identical and every assertion below green,
 * while quietly shipping the decoder to every visitor who never wanted sound.
 * The only place that regression is visible is the import block itself, so the
 * import block is what gets read and asserted on.
 *
 * The numbers here are quoted from spec section 5 and are deliberately brittle:
 * -28, -30, -24, -18, -22, -26 dB were mixed against one another, the 8 s loop
 * floor is what stops a bed from announcing itself as a loop, and 400 KB is the
 * whole audio payload. A change to any of them should fail here and be
 * re-approved on purpose, not slip in behind a "tuning" commit.
 * ========================================================================== */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  HAPTIC_PATTERNS,
  MIN_LOOP_SECONDS,
  SOUND_BUDGET_BYTES,
  SOUND_CUES,
  SOUND_DEFAULT_ENABLED,
  SOUND_ENABLED_MARKER,
  SOUND_MUTED_MARKER,
  SOUND_STORAGE_KEY,
  cueReachesEngine,
  fitsSoundBudget,
  readSoundPreference,
  soundCueRow,
  soundPreferenceServerSnapshot,
  soundPreferenceSnapshot,
  writeSoundPreference,
  type HapticCue,
  type SoundCue,
  type SoundPreferenceStorage,
} from "../components/sanctuary/sound-provider";

let assertions = 0;
const ok = (condition: boolean, message: string): void => {
  assert.ok(condition, message);
  assertions += 1;
};

const SOURCE_PATH = "components/sanctuary/sound-provider.tsx";
const SOURCE = readFileSync(SOURCE_PATH, "utf8");

/* ------------------------- the cue table is the spec ---------------------- */

{
  /** Spec section 5, transcribed: cue id, level in dB, and the moment that fires it. */
  const SPEC_TABLE: ReadonlyArray<readonly [SoundCue, number, string]> = [
    ["drone", -28, "Sanctuary idle"],
    ["fire", -30, "Near candles, positional"],
    ["scanner", -24, "Scan active"],
    ["bell", -18, "Reveal moment, title leaf"],
    ["leafTurn", -22, "Each page"],
    ["sealChime", -26, "Sealed leaf appears"],
  ];

  ok(SOUND_CUES.length === 6, "the cue table has exactly six rows - the spec names six and no screen may invent a seventh");
  ok(SPEC_TABLE.length === SOUND_CUES.length, "the transcription and the table agree on row count");

  for (const [cue, levelDb, when] of SPEC_TABLE) {
    const row = soundCueRow(cue);
    ok(row.cue === cue, `${cue}: the row is keyed by its own id`);
    ok(row.levelDb === levelDb, `${cue}: level is exactly ${levelDb} dB, as mixed`);
    ok(row.when === when, `${cue}: fires on "${when}" and nothing else`);
    ok(row.levelDb < 0, `${cue}: dBFS is always below full scale`);
  }

  for (let index = 0; index < SPEC_TABLE.length; index += 1) {
    ok(SOUND_CUES[index].cue === SPEC_TABLE[index][0], `row ${index} keeps the spec's own ordering`);
  }

  ok(
    soundCueRow("bell").levelDb - soundCueRow("drone").levelDb === 10,
    "the bell sits 10 dB over the drone - that gap is what makes the reveal land as an event",
  );
}

/* ------------------------- nothing short loops ---------------------------- */

{
  ok(MIN_LOOP_SECONDS === 8, 'spec 5: "never loop anything shorter than 8 s"');

  const looping = SOUND_CUES.filter((row) => row.loop);
  ok(looping.length === 3, "three beds loop: the drone, the fire and the scanner hum");

  for (const row of SOUND_CUES) {
    if (row.loop) {
      ok(
        row.minLoopSeconds >= MIN_LOOP_SECONDS,
        `${row.cue}: a bed shorter than ${MIN_LOOP_SECONDS} s reads as a loop and the room stops being a room`,
      );
    } else {
      ok(row.minLoopSeconds === undefined, `${row.cue}: a one-shot carries no loop floor`);
    }
  }

  ok(soundCueRow("bell").once === true, 'spec 5 marks the temple bell "once"');
  ok(soundCueRow("leafTurn").once === undefined, "a leaf turn fires on every page, so it is not a once-cue");
  ok(soundCueRow("sealChime").once === undefined, "every sealed leaf gets its chime");
}

/* ------------------------- the payload ceiling ---------------------------- */

{
  ok(SOUND_BUDGET_BYTES === 409600, "spec 5: 400 KB total audio payload = 400 * 1024 bytes");
  ok(fitsSoundBudget(SOUND_BUDGET_BYTES), "a manifest exactly at the ceiling still ships");
  ok(!fitsSoundBudget(SOUND_BUDGET_BYTES + 1), "one byte over the ceiling is over the ceiling");
  ok(fitsSoundBudget(0), "the current payload - nothing at all - fits");
}

/* ------------------------- off by default, and survivable ----------------- */

{
  ok(SOUND_DEFAULT_ENABLED === false, "spec 5: the ambient layer is OFF BY DEFAULT");
  ok(
    soundPreferenceServerSnapshot() === false,
    "the server snapshot is silence with no lookup, so the first paint cannot claim to be making sound",
  );
  ok(
    soundPreferenceSnapshot() === false,
    "and where there is no storage at all - this process, a locked-down browser - the live snapshot is silence too",
  );
  ok(
    SOURCE.includes(
      "useSyncExternalStore(subscribeToSoundPreference, soundPreferenceSnapshot, soundPreferenceServerSnapshot)",
    ),
    "the OFF server snapshot is wired as the hydration value rather than a state mirror that has to be corrected in an effect",
  );

  ok(readSoundPreference(null) === false, "no storage at all (server render, blocked cookies) reads as silence");

  const throwingStorage: Pick<SoundPreferenceStorage, "getItem"> = {
    getItem(): string {
      throw new Error("SecurityError: the operation is insecure");
    },
  };
  ok(
    readSoundPreference(throwingStorage) === false,
    "Safari private mode THROWS from getItem - the reader absorbs it and stays silent instead of taking the provider down",
  );

  const stored = (value: string | null): Pick<SoundPreferenceStorage, "getItem"> => ({
    getItem: (key: string): string | null => (key === SOUND_STORAGE_KEY ? value : null),
  });
  ok(readSoundPreference(stored(SOUND_ENABLED_MARKER)) === true, "the explicit marker, and only it, means on");
  ok(readSoundPreference(stored(null)) === false, "an absent key means never asked, which means off");
  ok(readSoundPreference(stored(SOUND_MUTED_MARKER)) === false, "an explicit opt-out means off");
  ok(readSoundPreference(stored("true")) === false, '"true" is not the marker - a stray value never turns sound on');
  ok(readSoundPreference(stored("1")) === false, '"1" is not the marker either');
  ok(readSoundPreference(stored("")) === false, "an empty value is not the marker");
  ok(
    readSoundPreference({ getItem: (): string | null => SOUND_ENABLED_MARKER }) === true,
    "the marker is read from one key only, so no other setting can flip audio on",
  );

  const written: Array<readonly [string, string]> = [];
  const recorder: Pick<SoundPreferenceStorage, "setItem"> = {
    setItem(key: string, value: string): void {
      written.push([key, value]);
    },
  };
  writeSoundPreference(recorder, true);
  writeSoundPreference(recorder, false);
  ok(written.length === 2, "both writes landed");
  ok(written.every(([key]) => key === SOUND_STORAGE_KEY), "one documented key, namespaced to the sanctuary");
  ok(written[0][1] === SOUND_ENABLED_MARKER, "enabling writes the marker the reader looks for");
  ok(written[1][1] === SOUND_MUTED_MARKER, "declining is recorded distinctly, so a later invitation can avoid nagging");

  writeSoundPreference(null, true);
  writeSoundPreference(
    {
      setItem(): void {
        throw new Error("QuotaExceededError");
      },
    },
    true,
  );
  ok(true, "a refusing or absent storage never throws out of the writer - the toggle still works for the session");
}

/* ------------------------- the silence path ------------------------------- */

{
  const nothingPlayed: ReadonlySet<SoundCue> = new Set<SoundCue>();

  for (const row of SOUND_CUES) {
    ok(
      cueReachesEngine({ enabled: false, cue: row.cue, alreadyPlayed: nothingPlayed }) === false,
      `${row.cue}: while sound is off the cue never reaches the engine - this is the zero-bytes property in pure form`,
    );
    ok(
      cueReachesEngine({ enabled: true, cue: row.cue, alreadyPlayed: nothingPlayed }) === true,
      `${row.cue}: once sound is on the cue is allowed through`,
    );
  }

  const bellRung: ReadonlySet<SoundCue> = new Set<SoundCue>(["bell"]);
  ok(
    cueReachesEngine({ enabled: true, cue: "bell", alreadyPlayed: bellRung }) === false,
    'the temple bell is "once" - a second reveal in the same session does not ring it again',
  );
  ok(
    cueReachesEngine({ enabled: true, cue: "leafTurn", alreadyPlayed: bellRung }) === true,
    "a once-cue that has fired does not mute the rest of the table",
  );
  ok(
    cueReachesEngine({ enabled: false, cue: "bell", alreadyPlayed: bellRung }) === false,
    "the enabled gate is checked first, so a muted session never even consults the once-set",
  );
}

/* ------------------------- zero bytes, pinned in the source --------------- */

{
  /** Every static `import ... from "x"` in the provider, in order. */
  const staticSpecifiers = [...SOURCE.matchAll(/^import\s[^(][^;]*?from\s+"([^"]+)";/gm)].map((match) => match[1]);

  ok(staticSpecifiers.length === 2, "the provider has exactly two static imports (react values, react types)");
  ok(staticSpecifiers.every((specifier) => specifier === "react"), "and both are react - nothing else is in the graph");

  const AUDIO_SHAPED = /audio|sound-engine|howler|tone|wavesurfer|\.mp3|\.ogg|\.wav|\.webm|\.m4a/i;
  ok(
    !staticSpecifiers.some((specifier) => AUDIO_SHAPED.test(specifier)),
    "NO static import of an audio module: bundling SoundProvider into a route cannot pull a decoder or an asset in behind it",
  );

  /* `import()` in prose has empty parens; a real call has an argument. */
  const dynamicCalls = SOURCE.match(/import\([^)]/g) ?? [];
  ok(dynamicCalls.length === 1, "exactly one dynamic import() call exists - one door in, easy to guard");

  const callIndex = SOURCE.search(/import\([^)]/);
  const loaderStart = SOURCE.indexOf("const defaultEngineLoader");
  const loaderEnd = SOURCE.indexOf("\n};", loaderStart);
  ok(loaderStart > 0, "the engine loader is where the pin expects it");
  ok(loaderEnd > loaderStart, "the loader's body is delimited");
  ok(
    callIndex > loaderStart && callIndex < loaderEnd,
    "the dynamic import sits INSIDE defaultEngineLoader, so the engine is only requested when that loader is called",
  );

  const effectStart = SOURCE.indexOf("if (!enabled) {");
  ok(effectStart > 0, "the engine effect opens by returning early while sound is off");
  ok(effectStart < SOURCE.indexOf("const pending = engineLoader();"), "and that early return precedes the only call to the loader");

  ok(!/new\s+(?:webkit)?AudioContext/.test(SOURCE), "the provider never constructs an audio context - that belongs to the engine, which only exists after opt-in");
  ok(!/new\s+Audio\(/.test(SOURCE), "no HTMLAudioElement either, for the same reason");
  ok(!SOURCE.includes("fetch("), "and the provider fetches nothing itself");

  const playStart = SOURCE.indexOf("const play = useCallback(");
  ok(playStart > 0, "play() is where the pin expects it");
  const playOnwards = SOURCE.slice(playStart);
  ok(
    playOnwards.indexOf("cueReachesEngine") < playOnwards.indexOf("engineRef"),
    "play() consults the silence gate BEFORE it reads the engine ref - a cue fired by a muted screen costs one boolean",
  );
}

/* ------------------------- haptics are a separate sense ------------------- */

{
  const cues: readonly HapticCue[] = ["pageTurn", "reveal"];
  ok(Object.keys(HAPTIC_PATTERNS).length === 2, 'spec 5 allows two haptics and "none elsewhere" - the vocabulary is closed');
  ok(cues.every((cue) => typeof HAPTIC_PATTERNS[cue] === "number"), "both named cues carry a duration");
  ok(
    HAPTIC_PATTERNS.pageTurn < HAPTIC_PATTERNS.reveal,
    "light tick on page turn, medium on reveal - the reveal must be the heavier of the two",
  );
  ok(HAPTIC_PATTERNS.pageTurn > 0, "a tick with no duration is not a tick");

  const hapticStart = SOURCE.indexOf("export function haptic(");
  const hapticBody = SOURCE.slice(hapticStart, SOURCE.indexOf("\n}", hapticStart));
  ok(hapticStart > 0, "haptic() is exported on its own, not smuggled into the sound context value");
  ok(
    !hapticBody.includes("enabled"),
    "RULING pinned: haptics are a separate sense and the sound toggle does not gate them - muting in a meeting must not delete the only feedback that survives the meeting",
  );
  ok(
    hapticBody.includes("navigator.vibrate"),
    "the one gate is whether the Vibration API exists at all; the user's real switch is the OS one",
  );
}

console.log(`SOUND SCAFFOLD ASSERTIONS PASSED (${assertions})`);
