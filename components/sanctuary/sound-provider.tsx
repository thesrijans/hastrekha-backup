"use client";

/* ============================================================================
 * SANCTUARY SOUND - section 5, the interface and the SILENCE PATH.
 *
 * This part ships no audio. Not one byte. What it ships is the guarantee that
 * someone who never touches the toggle pays nothing for the sound layer: no
 * network request, no decoded buffer, and no audio graph - constructing one
 * unprompted marks the tab with a speaker badge and, on iOS, wakes audio
 * hardware for a room that is supposed to be silent.
 *
 * The guarantee is structural rather than a promise:
 *   - this module statically imports `react` and NOTHING else, so bundling
 *     `SoundProvider` into a route cannot drag an engine in behind it;
 *   - the engine arrives through ONE dynamic `import()`, inside
 *     `defaultEngineLoader`, whose only call site is an effect that returns
 *     early while `enabled` is false;
 *   - `play()` asks `cueReachesEngine()` before it looks at anything else, so
 *     a cue fired by a component that has no idea the user is muted costs one
 *     boolean and returns.
 *
 * `test/sound-scaffold.test.ts` re-reads this file and fails if any of that
 * drifts, because the property is invisible in review: an innocent-looking
 * `import { createEngine } from "./audio-engine"` at the top would break it
 * while every visible behaviour stayed identical.
 * ========================================================================== */

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import type { JSX, ReactNode } from "react";

/* ------------------------------ the cue table ----------------------------- */

/**
 * The six cues the sound spec names. Ids, not filenames - the sanctuary asks
 * for a *moment* ("bell", the reveal) and the engine decides what that costs in
 * bytes, so the asset layout can change without touching a single call site.
 */
export type SoundCue = "drone" | "fire" | "scanner" | "bell" | "leafTurn" | "sealChime";

interface SoundCueBase {
  readonly cue: SoundCue;
  /** Spec 5, column 1, verbatim (its en dash written as a hyphen to keep this file ASCII). */
  readonly label: string;
  /** Spec 5, column 2, verbatim - the moment that is allowed to fire this cue. */
  readonly when: string;
  /** Spec 5, column 3, verbatim. Decibels relative to full scale, so always negative. */
  readonly levelDb: number;
}

/**
 * A bed that runs under the scene. Split from one-shots at the TYPE level so
 * that the spec's "never loop anything shorter than 8 s" cannot be forgotten:
 * a looping row without `minLoopSeconds` does not compile.
 */
export interface LoopingSoundCue extends SoundCueBase {
  readonly loop: true;
  readonly minLoopSeconds: number;
  readonly once?: never;
}

/** A single hit. `once` marks the cue the spec says fires one time and then never again. */
export interface OneShotSoundCue extends SoundCueBase {
  readonly loop: false;
  readonly once?: true;
  readonly minLoopSeconds?: never;
}

/** One row of the spec 5 cue table, carrying everything the engine needs to sound it. */
export type SoundCueRow = LoopingSoundCue | OneShotSoundCue;

/**
 * Spec 5: "Never loop anything shorter than 8 s."
 *
 * The reason is perceptual, not technical - a 3-second crackle loop announces
 * itself as a loop within twenty seconds and the room stops being a room. Every
 * bed below therefore declares a floor, and the shortest legal source asset is
 * this long.
 */
export const MIN_LOOP_SECONDS = 8;

/**
 * The spec 5 table as data, in the spec's order. Levels are quoted exactly
 * (-28, -30, -24, -18, -22, -26) because they were mixed against each other:
 * the bell sits 10 dB over the drone so it lands as an event, and raising the
 * drone to "make the room feel fuller" is what turns a sanctuary into a slot
 * machine.
 */
export const SOUND_CUES: readonly SoundCueRow[] = [
  {
    cue: "drone",
    label: "Low drone (60-120 Hz bed)",
    when: "Sanctuary idle",
    levelDb: -28,
    loop: true,
    minLoopSeconds: MIN_LOOP_SECONDS,
  },
  {
    cue: "fire",
    label: "Fire crackle",
    when: "Near candles, positional",
    levelDb: -30,
    loop: true,
    minLoopSeconds: MIN_LOOP_SECONDS,
  },
  {
    cue: "scanner",
    label: "Brass ring / scanner hum",
    when: "Scan active",
    levelDb: -24,
    loop: true,
    minLoopSeconds: MIN_LOOP_SECONDS,
  },
  {
    cue: "bell",
    label: "Single temple bell",
    when: "Reveal moment, title leaf",
    levelDb: -18,
    loop: false,
    once: true,
  },
  { cue: "leafTurn", label: "Leaf turn", when: "Each page", levelDb: -22, loop: false },
  { cue: "sealChime", label: "Soft chime", when: "Sealed leaf appears", levelDb: -26, loop: false },
];

/**
 * Row lookup. Throws on an unknown id rather than returning undefined, because
 * every caller already holds a `SoundCue` and a miss therefore means the table
 * lost a row - a bug worth surfacing at the call site instead of degrading to
 * silence that nobody notices for a release.
 */
export function soundCueRow(cue: SoundCue): SoundCueRow {
  const row = SOUND_CUES.find((candidate) => candidate.cue === cue);
  if (row === undefined) {
    throw new Error(`sound cue missing from the spec 5 table: ${cue}`);
  }
  return row;
}

/**
 * Spec 5: "Total audio payload <= 400 KB, lazy, loaded only after the user
 * enables sound." 400 * 1024 = 409600 bytes, counted over every asset the
 * engine may fetch - beds included, since a bed is the largest file in the set.
 */
export const SOUND_BUDGET_BYTES = 400 * 1024;

/**
 * Whether a proposed asset manifest still fits the payload ceiling. Exists so
 * the budget is checkable in a build step rather than being a number in a
 * comment that everyone believes and nobody measures.
 */
export function fitsSoundBudget(totalBytes: number): boolean {
  return totalBytes <= SOUND_BUDGET_BYTES;
}

/* ------------------------------ the preference ---------------------------- */

/**
 * The one key this feature owns. Namespaced so the sanctuary's settings can
 * never collide with the scan flags or a future per-reading key.
 */
export const SOUND_STORAGE_KEY = "hastrekha:sanctuary:sound";

/** The ONLY stored value that means "on". Anything else - including "true" and "1" - is silence. */
export const SOUND_ENABLED_MARKER = "enabled";

/**
 * Recorded when someone turns sound off by hand. Read as silence exactly like a
 * missing key, but kept distinct so a later "would you like sound?" invitation
 * can tell never-asked from already-declined and not nag.
 */
export const SOUND_MUTED_MARKER = "muted";

/**
 * Spec 5: the ambient layer is OFF BY DEFAULT. Also the value the provider
 * mounts with, on the server and on the client, so the first paint is silent
 * and hydration has nothing to reconcile.
 */
export const SOUND_DEFAULT_ENABLED = false;

/** The slice of `Storage` this feature touches. Narrow, so a test can stub it in two lines. */
export interface SoundPreferenceStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/**
 * Read the persisted preference, defaulting to OFF.
 *
 * Every access is wrapped because Safari private mode and "block all cookies"
 * make `getItem` THROW rather than return null, and an unhandled throw here
 * would take the whole provider down - the sanctuary would fail to render over
 * a sound setting. Silence is the safe answer in every failure mode.
 */
export function readSoundPreference(storage: Pick<SoundPreferenceStorage, "getItem"> | null): boolean {
  if (storage === null) {
    return SOUND_DEFAULT_ENABLED;
  }
  try {
    return storage.getItem(SOUND_STORAGE_KEY) === SOUND_ENABLED_MARKER;
  } catch {
    return SOUND_DEFAULT_ENABLED;
  }
}

/**
 * Persist the preference. Failures are swallowed for the same reason as the
 * read: a browser that refuses storage should cost someone their setting
 * between visits, never their session.
 */
export function writeSoundPreference(
  storage: Pick<SoundPreferenceStorage, "setItem"> | null,
  enabled: boolean,
): void {
  if (storage === null) {
    return;
  }
  try {
    storage.setItem(SOUND_STORAGE_KEY, enabled ? SOUND_ENABLED_MARKER : SOUND_MUTED_MARKER);
  } catch {
    /* Storage unavailable - the toggle still works for this session. */
  }
}

/** `window.localStorage`, or null. Even the property access throws under some privacy settings. */
function browserStorage(): SoundPreferenceStorage | null {
  try {
    if (typeof window === "undefined") {
      return null;
    }
    return window.localStorage;
  } catch {
    return null;
  }
}

/* ---------------------- the preference as an external store --------------- */

/**
 * The preference lives in localStorage, which is an external system, so React
 * SUBSCRIBES to it instead of keeping a second copy in state. Two things fall
 * out of that. The server snapshot is unconditionally OFF, so hydration starts
 * silent and cannot mismatch a stored "on" - no first-render flicker and no
 * setState-in-an-effect to correct it afterwards. And a toggle in one tab
 * reaches every other tab, which is what "always mutable from any screen" has
 * to mean once someone has the sanctuary open twice.
 */
const preferenceListeners = new Set<() => void>();
let cachedPreference: boolean = SOUND_DEFAULT_ENABLED;
let cachedPreferenceValid = false;

function notifyPreferenceListeners(): void {
  for (const listener of preferenceListeners) {
    listener();
  }
}

/**
 * The live client snapshot. Memoised because React calls a store's getSnapshot
 * on every render and localStorage is synchronous main-thread I/O; the cache is
 * dropped whenever anything can have changed the value.
 */
export function soundPreferenceSnapshot(): boolean {
  if (!cachedPreferenceValid) {
    cachedPreference = readSoundPreference(browserStorage());
    cachedPreferenceValid = true;
  }
  return cachedPreference;
}

/**
 * The server snapshot: OFF, always, with no lookup. The server cannot know the
 * preference and must not guess - guessing "on" would render a sanctuary that
 * claims to be making sound before any audio exists.
 */
export function soundPreferenceServerSnapshot(): boolean {
  return SOUND_DEFAULT_ENABLED;
}

function publishSoundPreference(next: boolean): void {
  cachedPreference = next;
  cachedPreferenceValid = true;
  writeSoundPreference(browserStorage(), next);
  notifyPreferenceListeners();
}

function subscribeToSoundPreference(onStoreChange: () => void): () => void {
  preferenceListeners.add(onStoreChange);
  const onStorage = (event: StorageEvent): void => {
    /* A null key means the whole store was cleared, which also drops this setting. */
    if (event.key !== null && event.key !== SOUND_STORAGE_KEY) {
      return;
    }
    cachedPreferenceValid = false;
    notifyPreferenceListeners();
  };
  if (typeof window !== "undefined") {
    window.addEventListener("storage", onStorage);
  }
  return () => {
    preferenceListeners.delete(onStoreChange);
    if (typeof window !== "undefined") {
      window.removeEventListener("storage", onStorage);
    }
  };
}

/* ------------------------------ the silence path -------------------------- */

/**
 * The single decision that keeps a muted sanctuary at zero bytes: may this cue
 * reach the engine at all?
 *
 * Pure, and exported, because it is THE property of this part and a property
 * that lives only inside a component body cannot be tested without a renderer.
 * `false` here means `play()` returns before it so much as reads the engine
 * ref, so nothing is fetched, constructed or scheduled.
 */
export function cueReachesEngine(params: {
  readonly enabled: boolean;
  readonly cue: SoundCue;
  readonly alreadyPlayed: ReadonlySet<SoundCue>;
}): boolean {
  if (!params.enabled) {
    return false;
  }
  const row = soundCueRow(params.cue);
  if (row.once === true && params.alreadyPlayed.has(params.cue)) {
    return false;
  }
  return true;
}

/* ------------------------------ the engine seam --------------------------- */

/** What the audio engine must offer. Declared here so this file owns the seam and not the reverse. */
export interface SoundEngine {
  play(row: SoundCueRow): void;
  stop(cue: SoundCue): void;
  dispose(): void;
}

/** Resolves the engine, or null when there is nothing to play. Never rejects into the UI. */
export type SoundEngineLoader = () => Promise<SoundEngine | null>;

interface SoundEngineModule {
  createSoundEngine: () => SoundEngine;
}

function isSoundEngineModule(value: unknown): value is SoundEngineModule {
  return (
    typeof value === "object" &&
    value !== null &&
    "createSoundEngine" in value &&
    typeof value.createSoundEngine === "function"
  );
}

/**
 * Where the engine will live. Held as a `string` rather than written inline
 * because that module does not exist yet: a literal specifier would fail the
 * type-check and the build today, while a value keeps the engine out of this
 * module's graph entirely. When the engine lands, this becomes a literal inside
 * the `import()` below - a literal is what lets the bundler cut the audio chunk
 * - and nothing else in this file changes.
 */
const AUDIO_ENGINE_MODULE: string = "@/lib/sanctuary/audio-engine";

/**
 * THE zero-bytes hinge. The one dynamic `import()` in this module, reached only
 * from the effect below, only after `enabled` has flipped true.
 *
 * A missing engine resolves to null instead of throwing: until the audio part
 * ships, enabling sound must leave the room quiet rather than break the screen.
 */
const defaultEngineLoader: SoundEngineLoader = async (): Promise<SoundEngine | null> => {
  try {
    const loaded: unknown = await import(AUDIO_ENGINE_MODULE);
    return isSoundEngineModule(loaded) ? loaded.createSoundEngine() : null;
  } catch {
    return null;
  }
};

/* ------------------------------ the context ------------------------------- */

/** What any screen gets from `useSound()`. The spec requires it be mutable from anywhere. */
export interface SoundContextValue {
  readonly enabled: boolean;
  setEnabled(next: boolean): void;
  play(cue: SoundCue): void;
  toggle(): void;
}

const SoundContext = createContext<SoundContextValue | null>(null);

/**
 * The sanctuary's sound state. Wrap the app once; the toggle is then reachable
 * from every screen, which the spec requires.
 *
 * `engineLoader` is injectable so a later part can swap the audio
 * implementation, and so a caller can prove the loader is never invoked while
 * sound is off - without that seam the zero-bytes claim is unfalsifiable.
 */
export function SoundProvider({
  children,
  engineLoader = defaultEngineLoader,
}: {
  readonly children: ReactNode;
  readonly engineLoader?: SoundEngineLoader;
}): JSX.Element {
  /**
   * The third argument is the whole hydration story: the server renders OFF, so
   * the first paint is silent whatever the browser has stored, and React swaps
   * in the real preference once it is on the client.
   */
  const enabled = useSyncExternalStore(subscribeToSoundPreference, soundPreferenceSnapshot, soundPreferenceServerSnapshot);
  const engineRef = useRef<SoundEngine | null>(null);
  const loadingRef = useRef<Promise<SoundEngine | null> | null>(null);
  const playedOnceRef = useRef<Set<SoundCue>>(new Set<SoundCue>());

  /**
   * Engine lifecycle. While `enabled` is false this returns before touching the
   * loader, which is why a muted visit issues no request and builds no audio
   * graph. Turning sound back off disposes the engine, so the graph is released
   * rather than left running silently, and clears the once-fired set so a
   * re-entered sanctuary can ring its bell again.
   */
  useEffect(() => {
    if (!enabled) {
      engineRef.current?.dispose();
      engineRef.current = null;
      loadingRef.current = null;
      playedOnceRef.current = new Set<SoundCue>();
      return;
    }
    let cancelled = false;
    const pending = engineLoader();
    loadingRef.current = pending;
    void pending
      .then((engine) => {
        if (cancelled) {
          engine?.dispose();
          return;
        }
        engineRef.current = engine;
      })
      .catch(() => {
        engineRef.current = null;
      });
    return () => {
      cancelled = true;
    };
  }, [enabled, engineLoader]);

  const setEnabled = useCallback((next: boolean): void => {
    publishSoundPreference(next);
  }, []);

  const play = useCallback(
    (cue: SoundCue): void => {
      if (!cueReachesEngine({ enabled, cue, alreadyPlayed: playedOnceRef.current })) {
        return;
      }
      const row = soundCueRow(cue);
      if (row.once === true) {
        playedOnceRef.current.add(cue);
      }
      const engine = engineRef.current;
      if (engine !== null) {
        engine.play(row);
        return;
      }
      /* Enabled, but the engine is still in flight - queue onto the same promise. */
      const pending = loadingRef.current;
      if (pending === null) {
        return;
      }
      void pending
        .then((loaded) => {
          loaded?.play(row);
        })
        .catch(() => {
          /* No engine, no sound. */
        });
    },
    [enabled],
  );

  const toggle = useCallback((): void => {
    setEnabled(!enabled);
  }, [enabled, setEnabled]);

  const value = useMemo<SoundContextValue>(
    () => ({ enabled, setEnabled, play, toggle }),
    [enabled, setEnabled, play, toggle],
  );

  return <SoundContext.Provider value={value}>{children}</SoundContext.Provider>;
}

/**
 * Read the sound state. Throws outside the provider rather than degrading to a
 * dummy, because a silently-dead toggle is the exact bug this file exists to
 * prevent.
 */
export function useSound(): SoundContextValue {
  const value = useContext(SoundContext);
  if (value === null) {
    throw new Error("useSound() must be called inside <SoundProvider>");
  }
  return value;
}

/* ------------------------------ haptics ----------------------------------- */

/**
 * The spec allows exactly two: "light tick on page turn, medium on reveal, none
 * elsewhere". The vocabulary is the type, so "none elsewhere" is enforced by
 * the compiler instead of by discipline - there is no id to pass for a hover.
 */
export type HapticCue = "pageTurn" | "reveal";

/** Milliseconds. Light and medium, the only two the spec names; far enough apart to feel different. */
export const HAPTIC_PATTERNS: Readonly<Record<HapticCue, number>> = {
  pageTurn: 8,
  reveal: 24,
};

/**
 * RULING - haptics are NOT gated on the sound toggle.
 *
 * They are a separate sense with separate reasons. Sound is off by default
 * because audio is intrusive in shared space; a page-turn tick is the opposite,
 * it is what someone keeps precisely because the room must stay quiet. Gating
 * touch on audio would mean muting in a meeting also deletes the only feedback
 * that survives the meeting. The real haptics switch is the OS one, and
 * `navigator.vibrate` already answers to it - so the only gate here is whether
 * the API exists at all (it does not on iOS Safari, or on desktop).
 */
export function haptic(cue: HapticCue): void {
  if (typeof navigator === "undefined" || typeof navigator.vibrate !== "function") {
    return;
  }
  navigator.vibrate(HAPTIC_PATTERNS[cue]);
}
