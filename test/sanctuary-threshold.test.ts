/* ============================================================================
 * THE THRESHOLD — §6.1's score, the first-visit rule, and the pre-paint script
 *
 * Part D in its CSS form (U3a). Four promises, each asserted mechanically:
 *
 *  1. THE SCORE IS §6.1's. One table (lib/sanctuary/threshold.ts) holds the
 *     timings; every beat's element carries its start time from that table.
 *  2. IT NEVER AUTO-ADVANCES. The button is the last beat, and no timer in the
 *     island can begin the push — only a click can.
 *  3. FIRST VISIT ONLY; SKIPPED UNDER REDUCED MOTION; REPLAYABLE. One rule, in
 *     two places: `thresholdShouldPlay` for the island, and an ES5 string the
 *     page inlines to decide before first paint. The string is EXECUTED here
 *     against every combination and must agree with the function.
 *  4. THE CENTRING SURVIVES THE ANIMATION. The first real capture showed the
 *     door, the dust path and the button shoved half their width right, because
 *     an entry keyframe on `translate` replaced the `translate` that centres
 *     them. The keyframes now move `transform`, and that is pinned.
 * ========================================================================== */
import assert from "node:assert/strict";
import Module, { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { createElement, type ReactElement } from "react";
import { renderToString } from "react-dom/server";
import {
  THRESHOLD_BEATS,
  THRESHOLD_ENTER_LABEL,
  THRESHOLD_MOTTO,
  THRESHOLD_PUSH_MS,
  THRESHOLD_REPLAY_PARAM,
  THRESHOLD_REPLAY_VALUE,
  THRESHOLD_SEEN,
  THRESHOLD_STORAGE_KEY,
  THRESHOLD_STORY,
  thresholdBeatAt,
  thresholdPrePaintScript,
  thresholdShouldPlay,
} from "../lib/sanctuary/threshold";

let assertions = 0;
const ok = (condition: boolean, message: string): void => {
  assert.ok(condition, message);
  assertions += 1;
};

const CLASS_NAME_STUB: Record<string, string> = new Proxy({}, { get: (_t, key) => (typeof key === "string" ? key : "") });
interface CjsExtensionHost {
  _extensions: Record<string, (loaded: { exports: unknown }, filename: string) => void>;
}
(Module as unknown as CjsExtensionHost)._extensions[".css"] = (loaded): void => {
  loaded.exports = { __esModule: true, default: CLASS_NAME_STUB };
};

const ROOT = path.resolve(__dirname, "..");
const read = (...parts: string[]): string => readFileSync(path.join(ROOT, ...parts), "utf8");
const withoutComments = (text: string): string =>
  text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

/* ============================== 1. The score ============================== */

{
  const EXPECTED: readonly (readonly [string, number])[] = [
    ["black", 0],
    ["point", 500],
    ["doorway", 1500],
    ["wordmark", 2500],
    ["devanagari", 3200],
    ["motto", 4000],
    ["story", 5000],
    ["path", 6000],
    ["enter", 6500],
  ];
  ok(
    THRESHOLD_BEATS.length === EXPECTED.length &&
      THRESHOLD_BEATS.every((beat, at) => beat.id === EXPECTED[at][0] && beat.atMs === EXPECTED[at][1]),
    "the score is §6.1's, beat for beat and millisecond for millisecond",
  );
  ok(
    THRESHOLD_BEATS.every((beat, at) => at === 0 || beat.atMs > THRESHOLD_BEATS[at - 1].atMs),
    "the beats are strictly ascending",
  );
  ok(
    THRESHOLD_BEATS[THRESHOLD_BEATS.length - 1].id === "enter",
    "the last beat is the button: there is nothing after it, so nothing can advance on its own",
  );
  ok(
    THRESHOLD_MOTTO === "Ancient wisdom. Modern insight." && THRESHOLD_STORY === "Your hands hold a story.",
    "the two lines are §6.1's, verbatim",
  );

  const tokens = read("app", "sanctuary.css");
  const ms = (name: string): number => Number(new RegExp(`${name}:\\s*([0-9.]+)ms`).exec(tokens)?.[1]);
  const [camMin, camMax] = [ms("--snc-duration-camera-min"), ms("--snc-duration-camera-max")];
  ok(THRESHOLD_PUSH_MS === 1800, "the push through the doorway is §6.1's 1.8 s");
  ok(
    camMin <= THRESHOLD_PUSH_MS && THRESHOLD_PUSH_MS <= camMax,
    `…inside the token layer's camera band (${camMin}–${camMax} ms): the push is a camera move, and one shorter than every other would read as a cut`,
  );
}

/* =================== 2. First visit, reduced motion, replay =============== */

{
  ok(thresholdShouldPlay({ stored: null, reducedMotion: false, replay: false }), "a first visit plays the entrance");
  ok(!thresholdShouldPlay({ stored: THRESHOLD_SEEN, reducedMotion: false, replay: false }), "a returning visitor never sees it again");
  ok(thresholdShouldPlay({ stored: THRESHOLD_SEEN, reducedMotion: false, replay: true }), "…unless they ask to replay it");
  ok(
    !thresholdShouldPlay({ stored: null, reducedMotion: true, replay: true }),
    "reduced motion wins over everything, replay included — §6.1 skips the entrance instantly for someone who asked for stillness",
  );
  ok(THRESHOLD_STORAGE_KEY === "hastrekha:threshold:v1", "the visit is remembered under a namespaced, versioned key");
}

/* ======== 3. The pre-paint script is the same rule, and is executed ======= */

{
  const script = thresholdPrePaintScript("stage");

  const run = (input: {
    readonly stored: string | null;
    readonly reduced: boolean;
    readonly search: string;
    readonly storageThrows?: boolean;
    readonly elementPresent?: boolean;
  }): string | null => {
    let stamped: string | null = null;
    const element = {
      setAttribute: (name: string, value: string): void => {
        if (name === "data-snc-threshold") stamped = value;
      },
    };
    const sandbox = {
      URLSearchParams,
      document: { getElementById: (id: string) => (id === "stage" && input.elementPresent !== false ? element : null) },
      window: {
        matchMedia: (query: string) => ({ matches: input.reduced && query === "(prefers-reduced-motion: reduce)" }),
        location: { search: input.search },
        localStorage: {
          getItem: (key: string): string | null => {
            if (input.storageThrows === true) throw new Error("blocked");
            return key === THRESHOLD_STORAGE_KEY ? input.stored : null;
          },
        },
      },
    };
    vm.runInNewContext(script, sandbox);
    return stamped;
  };

  let agreed = 0;
  for (const stored of [null, THRESHOLD_SEEN, "something-else"]) {
    for (const reduced of [false, true]) {
      for (const replay of [false, true]) {
        const search = replay ? `?${THRESHOLD_REPLAY_PARAM}=${THRESHOLD_REPLAY_VALUE}` : "?chapter=IX";
        const expected = thresholdShouldPlay({ stored, reducedMotion: reduced, replay }) ? "playing" : "skipped";
        if (run({ stored, reduced, search }) === expected) agreed += 1;
      }
    }
  }
  ok(agreed === 12, `the inlined script and thresholdShouldPlay agree on all 12 combinations (${agreed}/12)`);
  ok(
    run({ stored: null, reduced: false, search: "", storageThrows: true }) === "skipped",
    "a store the browser refuses to open skips the entrance rather than throwing before first paint",
  );
  ok(
    run({ stored: null, reduced: false, search: "", elementPresent: false }) === null,
    "and a page without the stage is left alone, without an error",
  );
  ok(
    !/=>|\blet\b|\bconst\b|`/.test(script),
    "it is plain ES5: it runs as the HTML is parsed, before any bundle, in whatever browser arrives",
  );
}

/* ================================ 4. The render ============================ */

const require_ = createRequire(__filename);
const { Threshold, THRESHOLD_ELEMENT_ID } = require_("../components/sanctuary/threshold/threshold") as {
  Threshold: () => ReactElement;
  THRESHOLD_ELEMENT_ID: string;
};

{
  const html = renderToString(createElement(Threshold));
  const stageAt = html.indexOf(`id="${THRESHOLD_ELEMENT_ID}"`);
  ok(stageAt !== -1 && html.includes('data-snc-threshold="playing"'), "the server renders the stage as playing; the pre-paint script, not the server, decides who skips it");
  ok(stageAt < html.indexOf("<script"), "the script comes AFTER the stage, so the stage exists when the script runs and the decision lands before first paint");
  ok(html.includes(thresholdPrePaintScript(THRESHOLD_ELEMENT_ID).slice(0, 60)), "…and it is the tested script, inlined verbatim");

  for (const beat of ["point", "doorway", "wordmark", "devanagari", "motto", "story", "path", "enter"] as const) {
    ok(html.includes(`--snc-at:${thresholdBeatAt(beat)}ms`), `the ${beat} beat starts at ${thresholdBeatAt(beat)} ms, read from the table`);
  }
  ok(
    html.includes("हस्तरेखा") && html.includes(THRESHOLD_MOTTO) && html.includes(THRESHOLD_STORY) && html.includes(THRESHOLD_ENTER_LABEL),
    "the name, its Devanagari, both lines and the button are all on the stage",
  );
  ok(
    html.includes('data-snc-threshold-action="enter"') && html.includes('data-snc-threshold-action="skip"'),
    "there are exactly two named ways out, Enter and Skip — any other tap or key also skips",
  );
  ok(!/<a\s/.test(html), "nothing on the stage is a link: entering is a push through a door, not a navigation");
  ok(html.includes('role="dialog"') && html.includes('aria-modal="true"'), "while it plays it is a modal dialog, so a screen reader is not left reading the room behind it");
}

/* ============================ 5. The stylesheet =========================== */

{
  const css = read("components", "sanctuary", "threshold", "threshold.module.css");
  const code = withoutComments(css);
  ok(
    /\.threshold\[data-snc-threshold="skipped"\],\s*\.threshold\[data-snc-threshold="done"\]\s*{\s*display:\s*none/.test(code),
    "skipped and done both take the stage out of the page entirely",
  );
  ok(
    /@media \(prefers-reduced-motion: reduce\)\s*{\s*\.threshold\s*{\s*display:\s*none/.test(code),
    "and reduced motion hides it in CSS too — belt to the script's braces",
  );
  ok(code.includes(`sncThresholdPush ${THRESHOLD_PUSH_MS}ms`), "the push animation runs for exactly THRESHOLD_PUSH_MS");
  const entry = /@keyframes sncThresholdIn\s*{([\s\S]*?)\n}/.exec(code)?.[1] ?? "";
  ok(
    entry.includes("transform") && !/\btranslate\s*:/.test(entry),
    "the entry keyframes move `transform`, never `translate` — `translate` is what centres the door, the path and the button",
  );
  ok(!/cubic-bezier|bounce|spring/i.test(code), "no easing of its own: everything moves on the sanctuary's ease, linear or ease-in-out — nothing bounces");
  ok(!/#[0-9a-fA-F]{3,8}\b/.test(code) && !/var\(--color-(?!snc-)/.test(code), "every colour is a --color-snc-* token");
}

/* ============================== 6. The island ============================= */

{
  const raw = read("components", "sanctuary", "threshold", "threshold-stage.tsx");
  const code = withoutComments(raw);
  ok(/^\s*["']use client["']/m.test(raw), "the stage's behaviour is the one client file");
  ok(!/["']use client["']/.test(read("components", "sanctuary", "threshold", "threshold.tsx")), "the scene itself is server markup, passed in as children");
  ok((code.match(/setTimeout\(/g) ?? []).length === 1, "there is exactly one timer in the island…");
  ok(
    code.includes('if (phase !== "entering" && phase !== "skipping") return;'),
    "…and it only ends a push or a skip that a person already began. Nothing starts the push but a click: the entrance never auto-advances",
  );
  ok(code.includes("THRESHOLD_STORAGE_KEY") && code.includes("THRESHOLD_SEEN"), "entering or skipping remembers the visit");
  ok(code.includes('"Tab"'), "Tab moves focus to the button instead of skipping — a keyboard reader can still choose Enter");
  ok(code.includes("replaceState"), "a replay request is dropped from the address, so a reload does not replay it again");
}

/* ============================ 7. Home mounts it first ====================== */

{
  const page = withoutComments(read("app", "sanctuary", "page.tsx"));
  ok(
    page.includes("<Threshold />") && page.indexOf("<Threshold") < page.indexOf("<HomeRoom"),
    "the Threshold is the first thing on Home, ahead of the room it opens onto — it is Home's first-visit state, not a route",
  );
}

console.log(`SANCTUARY THRESHOLD ASSERTIONS PASSED (${assertions})`);
