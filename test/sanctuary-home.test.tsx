/* ============================================================================
 * HOME — Part C's content, B7's room, and the one island
 *
 * U3a: a complete Home with no WebGL. What is asserted:
 *
 *  1. The route: gated, noindex, on the shell, the Threshold first, the visitor
 *     greeted by name only when a session says so.
 *  2. C2–C6: the greeting speaks in the trust rule's voice; the tradition's palm
 *     carries exactly the brief's nine names and is visibly not a reading; the
 *     one action goes to the chamber; the five paths open their chapters, or the
 *     chamber when there is no reading; one verse, never a rotation.
 *  3. B7: the room is one composition — one table of numbers, three layers at
 *     the plate depths, the same viewBox everywhere — and nothing in it moves
 *     below MID. The phone's vignette draws the pedestal and the hologram only.
 *  4. [A2] The hologram's hand is a silhouette: not one line of the tradition's
 *     diagram is ever drawn on it.
 *  5. The island: the same follow constants as <ScenePlate>, a capture-phase
 *     camera that lets a Link stand down, and no WebGL anywhere in U3a.
 * ========================================================================== */
import assert from "node:assert/strict";
import Module, { createRequire } from "node:module";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { createElement, type ReactElement } from "react";
import { renderToString } from "react-dom/server";
import { HOME_PATHS } from "../lib/sanctuary/home-paths";
import { POTHI_CHAPTERS } from "../lib/sanctuary/pothi-chapters";
import { POTHI_CHAPTER_PARAM, pothiChapterHref, pothiChapterIndex } from "../lib/sanctuary/pothi-deep-link";
import { POTHI_READING_SESSION_KEY } from "../lib/sanctuary/pothi-reading-store";
import { READING_PRESENCE_ATTRIBUTE, readingPresencePrePaintScript } from "../lib/sanctuary/reading-presence";
import {
  ROOM_ANCHORS,
  ROOM_CAMERA_MOVE_MS,
  ROOM_CANDLES,
  ROOM_CSS_CAMERAS,
  ROOM_LAYER_DEPTH,
  ROOM_SAFE_X,
  ROOM_STAGE,
  roomCameraTransform,
} from "../lib/sanctuary/room-composition";
import { SANCTUARY_CHAMBER_HREF, SANCTUARY_POTHI_HREF } from "../lib/sanctuary/routes";
import {
  TRADITION_HAND_CREASES,
  TRADITION_HAND_SILHOUETTE,
  TRADITION_LABELS_HI,
  TRADITION_LINES,
} from "../lib/sanctuary/tradition-hand";
import { WISDOM_SEED_VERSE, WISDOM_VERSES, wisdomOfTheDay } from "../lib/sanctuary/wisdom";

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
const count = (haystack: string, needle: string): number => haystack.split(needle).length - 1;
/** Whether some opening `<tag …>` carries every one of `attrs`, in any order (Next's <Link> emits `href` last). */
const hasTag = (html: string, tag: string, ...attrs: string[]): boolean =>
  [...html.matchAll(new RegExp(`<${tag}\\b[^>]*>`, "g"))].some((m) => attrs.every((attr) => m[0].includes(attr)));

type Component = (props: Record<string, unknown>) => ReactElement;
const require_ = createRequire(__filename);
const load = <T,>(rel: string): T => require_(rel) as T;
const render = (component: Component, props: Record<string, unknown> = {}): string =>
  renderToString(createElement(component, props)).replace(/<!-- -->/g, "");

/** Every rule in a stylesheet, innermost first — a selector and its body. @keyframes steps are dropped. */
function rules(css: string): { selector: string; body: string }[] {
  const out: { selector: string; body: string }[] = [];
  for (const m of withoutComments(css).matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selector = m[1].trim();
    if (/^(from|to|[0-9.]+%)(\s*,\s*[0-9.]+%)*$/.test(selector)) continue;
    out.push({ selector, body: m[2] });
  }
  return out;
}

/* ================================ 1. The route ============================ */

{
  const raw = read("app", "sanctuary", "page.tsx");
  const page = withoutComments(raw);
  ok(page.includes('process.env.NODE_ENV !== "development"') && page.includes("notFound()"), "Home is behind the same hard development gate as every sanctuary route");
  ok(/robots:\s*\{\s*index:\s*false/.test(page), "with noindex beside it");
  ok(/viewportFit:\s*"cover"/.test(page), "and a viewport that extends under the home indicator, so the bar's safe-area padding is real");
  ok(!/["']use client["']/.test(raw), "the page itself is a server component");
  ok(
    /<SanctuaryShell[^>]*activeHref="\/sanctuary"[^>]*header=\{false\}/.test(page) && page.includes("className={SANCTUARY_FONT_CLASS}"),
    "it is assembled by the shell, lit as Home, without the header — Home draws its own masthead",
  );
  ok(
    page.indexOf("<Threshold") < page.indexOf("<HomeRoom") && page.indexOf("<HomeRoom") < page.indexOf("<HomeContent"),
    "the Threshold, then the room (or the vertical scene), then Part C",
  );
  ok(
    /try\s*{\s*return await getSessionUserFromCookies\(\);\s*}\s*catch\s*{\s*return null;\s*}/.test(page),
    "the visitor is read from the session cookie, and a database that cannot be reached falls back to the seeker rather than taking Home down",
  );
  const session = withoutComments(read("lib", "auth", "session.ts"));
  const helper = session.slice(session.indexOf("export async function getSessionUserFromCookies"));
  ok(
    helper.indexOf("if (claims === null) return null;") !== -1 &&
      helper.indexOf("if (claims === null) return null;") < helper.indexOf("resolveSessionUser(claims)"),
    "with no cookie the helper returns before touching the database",
  );
  ok(
    /export async function getSessionUser\(request: NextRequest\)[\s\S]*?return resolveSessionUser\(claims\);/.test(session),
    "and the request-based reader shares the same row checks, so the two cannot drift",
  );
}

/* ============================== 2. C1 + C2 ================================= */

{
  const { HomeGreeting, HOME_GREETING_BODY, HOME_GREETING_SEEKER } = load<{
    HomeGreeting: Component;
    HOME_GREETING_BODY: string;
    HOME_GREETING_SEEKER: string;
  }>("../components/sanctuary/home/home-greeting");
  const seeker = render(HomeGreeting, { name: null });
  ok(seeker.includes("नमस्ते,") && seeker.includes(HOME_GREETING_SEEKER) && HOME_GREETING_SEEKER === "साधक", "with no session the visitor is greeted as साधक");
  const named = render(HomeGreeting, { name: "Anant" });
  ok(named.includes("Anant") && !named.includes(HOME_GREETING_SEEKER), "with a session, by name — never a placeholder name");
  ok(render(HomeGreeting, { name: "   " }).includes(HOME_GREETING_SEEKER), "a blank name is no name");
  ok(named.includes("Your story begins here."), "the line under it is the reference's");
  ok(
    HOME_GREETING_BODY.includes("Traditional palmistry associates") && !/\b(will|reveals?|predicts?|guarantee|destiny)\b/i.test(HOME_GREETING_BODY),
    "the paragraph speaks in the trust rule's voice — what the tradition associates, never what a palm reveals",
  );

  const { HomeMasthead } = load<{ HomeMasthead: Component }>("../components/sanctuary/home/home-masthead");
  const masthead = render(HomeMasthead, { profile: null });
  ok(masthead.includes("<h1") && masthead.includes("HastRekha") && masthead.includes("॥ हस्तरेखा ॥"), "C1: the name struck in gold over its own script between dandas");
  ok(masthead.includes('width="64"') && masthead.includes('data-snc-part="beads"'), "…under the brand mark at 64px, beads and all");
}

/* ======================= 3. C3 — the tradition's palm ====================== */

{
  ok(
    JSON.stringify(TRADITION_LABELS_HI) ===
      JSON.stringify(["सूर्य रेखा", "बुध रेखा", "शनि रेखा", "हृदय रेखा", "शुक्र रेखा", "चंद्र रेखा", "मंगल रेखा", "राहु रेखा", "केतु रेखा"]),
    "the nine names are the brief's, verbatim and in its order",
  );
  const labelled = TRADITION_LINES.filter((line) => line.labelHi !== null);
  ok(
    labelled.length === 9 && new Set(labelled.map((line) => line.labelHi)).size === 9 && labelled.every((line) => TRADITION_LABELS_HI.includes(line.labelHi ?? "")),
    "every one of the nine is set on a line, each once",
  );
  ok(
    TRADITION_LINES.filter((line) => line.labelHi === null).map((line) => line.id).sort().join() === "head,life",
    "the life and head lines are drawn and left unlabelled — the brief's nine do not name them, and inventing names is not this file's to do",
  );

  const { TraditionPalm, TRADITION_CAPTION_HI } = load<{ TraditionPalm: Component; TRADITION_CAPTION_HI: string }>(
    "../components/sanctuary/home/tradition-palm",
  );
  const html = render(TraditionPalm);
  ok(TRADITION_LABELS_HI.every((name) => html.includes(name)), "all nine names are on the rendered plate");
  ok(count(html, "data-snc-tradition-line=") === TRADITION_LINES.length, "and every classical line is drawn");
  ok(html.includes(TRADITION_CAPTION_HI) && TRADITION_CAPTION_HI === "पारंपरिक चित्र" && html.includes("Traditional diagram"), "it says what it is: पारंपरिक चित्र, with the Latin beside it");
  ok(html.includes('data-snc-ornament="celestial-ring"'), "a faint wheel stands behind the hand");
  ok(!html.includes("snc-stroke-active"), "[A2] nothing on the plate uses the active stroke rung a traced result is drawn in");
  const css = withoutComments(read("components", "sanctuary", "home", "tradition-palm.module.css"));
  const width = (selector: string): number => Number(new RegExp(`\\${selector}\\s*{[^}]*stroke-width:\\s*([0-9.]+)`).exec(css)?.[1]);
  ok(width(".line") < 1 && width(".leader") < 1 && width(".crease") < 1 && width(".outline") <= 1, "[A2] every stroke is a sub-pixel hairline — thinner than any reading");
  ok(/--snc-tradition-ink:\s*color-mix\(in oklab, var\(--color-snc-gold-500\)[^;]*var\(--color-snc-moon\)\)/.test(css), "[A2] …and cooler: the gold pulled toward the moon's blue-grey");
  ok(!/filter|drop-shadow|glow/.test(css), "[A2] and nothing on it glows");
}

/* ===================== 4. C4 — the one action ============================= */

{
  const { BeginReadingCard, BEGIN_TITLE, BEGIN_BODY } = load<{ BeginReadingCard: Component; BEGIN_TITLE: string; BEGIN_BODY: string }>(
    "../components/sanctuary/home/begin-reading-card",
  );
  const html = render(BeginReadingCard);
  ok(
    html.startsWith("<a") && hasTag(html, "a", 'href="/scan/chamber"', 'data-snc-camera="scanner"'),
    "Begin your reading goes to the chamber, pushing the camera onto the pedestal when the room is on screen",
  );
  ok(html.includes(BEGIN_TITLE) && html.includes(BEGIN_BODY), "in the brief's words");
  ok(html.includes("snc-medallion") && html.includes('data-snc-icon="arrow"'), "with the circular gold arrow — the major action is never a saturated pill");
  ok(count(html, 'data-snc-ornament="corner"') === 4, "the frame's four corners are the material family's own ornament");
  const css = withoutComments(read("components", "sanctuary", "home", "home.module.css"));
  ok(/\.begin:hover \.beginSeal[^{]*{\s*scale:\s*1\.02/.test(css), "hover: the seal lifts to 1.02");
  ok(/\.begin:hover \.beginArrow[^{]*{\s*rotate:\s*6deg/.test(css), "…the arrow turns 6°");
  ok(/\.begin:hover \.frameOuter[^{]*{\s*filter:\s*brightness/.test(css), "…the frame brightens");
  ok(/\.begin:hover \.mote\s*{\s*animation:/.test(css) && /prefers-reduced-motion: reduce\)\s*{\s*\.motes\s*{\s*display:\s*none/.test(css), "…and gold rises — only while hovered, never under reduced motion");
  const cardDurations = [...css.matchAll(/(?:scale|rotate|filter|box-shadow) (\d+)ms/g)].map((m) => Number(m[1]));
  ok(cardDurations.length > 0 && cardDurations.every((ms) => ms >= 400 && ms <= 600), "every card transition sits in the brief's card band, 400–600 ms");
}

/* ======================= 5. C5 — the five paths =========================== */

{
  ok(
    HOME_PATHS.map((p) => `${p.label}:${p.numeral}:${p.icon}`).join(" ") ===
      "Personality:X:meditation Career:IX:satchel Relationships:VIII:hearts Wealth:XI:coins Life Path:XIII:compass",
    "the reference's five, each on its chapter, each with its engraved glyph",
  );
  for (const p of HOME_PATHS) {
    const chapter = POTHI_CHAPTERS.find((c) => c.numeral === p.numeral);
    ok(chapter !== undefined && p.labelHi === chapter.titleHi, `${p.label} opens a chapter the book has (${p.numeral}), titled from the chapter table`);
    ok(p.chapterHref === `${SANCTUARY_POTHI_HREF}?${POTHI_CHAPTER_PARAM}=${p.numeral}` && p.quietHref === SANCTUARY_CHAMBER_HREF, `${p.label} goes to its chapter with a reading, and to the chamber without one`);
  }
  ok(
    HOME_PATHS.filter((p) => p.numeral !== "XIII").every((p) => POTHI_CHAPTERS.find((c) => c.numeral === p.numeral)?.kind === "area"),
    "four are the life areas the backend genuinely scores; Life Path is chapter XIII",
  );

  const { PathCards, PATHS_LIST_ID } = load<{ PathCards: Component; PATHS_LIST_ID: string }>("../components/sanctuary/home/path-cards");
  const html = render(PathCards);
  ok(count(html, "<a ") === 10, "each card carries both of its destinations…");
  ok(hasTag(html, "ul", `id="${PATHS_LIST_ID}"`, `${READING_PRESENCE_ATTRIBUTE}="absent"`), "…the list starts as “no reading”, the one answer the server can honestly give");
  ok(html.indexOf(`id="${PATHS_LIST_ID}"`) < html.indexOf("<script"), "…and the presence script comes after the list, so it runs before the list is painted");
  const css = withoutComments(read("components", "sanctuary", "home", "home.module.css"));
  ok(
    /\.pathList\[data-snc-reading="absent"\] \.whenPresent,\s*\.pathList\[data-snc-reading="present"\] \.whenAbsent\s*{\s*display:\s*none/.test(css),
    "the stylesheet shows exactly one of the two",
  );

  const presence = (stored: string | null, throws = false): string | null => {
    let stamped: string | null = null;
    vm.runInNewContext(readingPresencePrePaintScript("list"), {
      document: { getElementById: (id: string) => (id === "list" ? { setAttribute: (_n: string, v: string) => (stamped = v) } : null) },
      window: {
        sessionStorage: {
          getItem: (key: string) => {
            if (throws) throw new Error("blocked");
            return key === POTHI_READING_SESSION_KEY ? stored : null;
          },
        },
      },
    });
    return stamped;
  };
  ok(presence('{"readingId":"r1"}') === "present", "a reading in the tab lights the cards");
  ok(presence(null) === "absent" && presence("") === "absent", "no reading leaves them quiet");
  ok(presence(null, true) === "absent", "and a store the browser refuses leaves them quiet rather than throwing");
}

/* ======================= 6. The deep link into the book =================== */

{
  ok(pothiChapterHref("IX") === "/read/pothi?chapter=IX", "a chapter is addressed by its numeral");
  ok(pothiChapterHref("XX") === SANCTUARY_POTHI_HREF, "an unknown numeral yields the plain book, never a broken link");
  ok([null, undefined, "", "ix", "XX"].every((value) => pothiChapterIndex(value) === 0), "anything the book cannot honour opens at leaf I, exactly as no parameter does");
  ok(POTHI_CHAPTERS.every((c, at) => pothiChapterIndex(c.numeral) === at), "every chapter's numeral round-trips to its own leaf");
  const book = withoutComments(read("components", "sanctuary", "pothi", "pothi-book.tsx"));
  ok(/initialIndex\s*>=\s*0\s*&&\s*initialIndex\s*<\s*POTHI_CHAPTERS\.length/.test(book), "the book clamps the requested leaf into itself");
  const client = withoutComments(read("app", "read", "pothi", "pothi-client.tsx"));
  ok(
    client.includes("initialIndex={pothiChapterIndex(chapterRaw)}") && client.includes("useSearchParams().get(POTHI_CHAPTER_PARAM)") && !client.includes("window.location"),
    "the island reads ?chapter= from the router, never from `location` — on a client-side arrival the address bar is written after the book takes its opening leaf, and the first capture opened chapter IX's card at leaf I",
  );
  ok(
    /<Suspense fallback=\{null\}>\s*<PothiClient \/>\s*<\/Suspense>/.test(withoutComments(read("app", "read", "pothi", "page.tsx"))),
    "…inside its own Suspense boundary, so the page stays prerendered and only the island — which renders nothing on the server anyway — is client-side",
  );
}

/* ============================ 7. C6 + the colophon ======================== */

{
  ok(WISDOM_VERSES.length === 1 && wisdomOfTheDay() === WISDOM_SEED_VERSE, "[A2] one verse, and the selector returns it every day — never a fabricated rotation");
  ok(
    WISDOM_SEED_VERSE.sanskrit[0] === "कराग्रे वसते लक्ष्मीः करमध्ये सरस्वती ।" &&
      WISDOM_SEED_VERSE.sanskrit[1] === "करमूले तु गोविन्दः प्रभाते करदर्शनम् ॥",
    "the seed is the karāgre verse, with its visargas and its dandas",
  );
  ok(read("lib", "sanctuary", "wisdom.ts").includes("TODO(verse-table)"), "and the table it will be drawn from is a marked TODO, not a guess");
  const { WisdomOfTheDay } = load<{ WisdomOfTheDay: Component }>("../components/sanctuary/home/wisdom-of-the-day");
  const html = render(WisdomOfTheDay);
  ok(html.includes('lang="sa"') && html.includes(WISDOM_SEED_VERSE.translation) && html.includes(WISDOM_SEED_VERSE.attribution), "the verse is marked as Sanskrit, with its translation and attribution");
  ok(html.includes('data-snc-ornament="lotus"'), "and the lotus beside it");
  const css = withoutComments(read("components", "sanctuary", "home", "home.module.css"));
  ok(/\.translation\s*{[^}]*font-family:\s*var\(--font-snc-serif-italic\)[^}]*font-style:\s*italic/.test(css), "the English is Cormorant's real italic — the deferred face, never a slanted upright");

  const { HomeColophon, HOME_DISCLAIMER } = load<{ HomeColophon: Component; HOME_DISCLAIMER: string }>("../components/sanctuary/home/home-colophon");
  const colophon = render(HomeColophon);
  ok(HOME_DISCLAIMER.startsWith("Traditional palmistry associates") && /never as prediction/.test(HOME_DISCLAIMER), "the disclaimer is the trust rule, elegantly: reflection, never prediction");
  ok(colophon.includes('href="/privacy"') && colophon.includes('href="/terms"') && colophon.includes('href="/sanctuary?entrance=replay"'), "privacy, terms, and the entrance replay (settings is U5, so it lives here until then)");
}

/* =========================== 8. B7 — one composition ====================== */

{
  const sceneSource = read("components", "sanctuary", "scene-plate.tsx");
  const plateDepth = (layer: string): number => Number(new RegExp(`\\b${layer}:\\s*([0-9.]+)`).exec(sceneSource.slice(sceneSource.indexOf("PLATE_DEPTH_FACTOR")))?.[1]);
  ok(
    (["far", "mid", "near"] as const).every((layer) => ROOM_LAYER_DEPTH[layer] === plateDepth(layer)),
    "the drawn layers travel at <ScenePlate>'s own depth factors, so a raster plate added later moves as one with them",
  );
  const tokens = read("app", "sanctuary.css");
  const token = (name: string): number => Number(new RegExp(`${name}:\\s*([0-9.]+)`).exec(tokens)?.[1]);
  const periods = ROOM_CANDLES.map((c) => c.periodMs);
  ok(ROOM_CANDLES.length === 3, "B3's three candles");
  ok(periods.every((ms) => ms >= token("--snc-flicker-period-min") && ms <= token("--snc-flicker-period-max")), "each flickers inside the token band (2–4 Hz)");
  ok(
    new Set(periods).size === 3 && periods.every((a) => periods.every((b) => a === b || (Math.max(a, b) % Math.min(a, b)) !== 0)),
    "on three periods none of which divides another, so the flames never keep time — “never rhythmic”",
  );
  ok(ROOM_CAMERA_MOVE_MS >= token("--snc-duration-camera-min") && ROOM_CAMERA_MOVE_MS <= token("--snc-duration-camera-max"), "a camera move lasts inside the 1.2–2.0 s camera band");
  ok(["sanctuary", "scanner", "book", "library", "guru"].every((name) => name in ROOM_CSS_CAMERAS), "B4's five camera positions exist, the Guru's reserved for U4");
  ok(roomCameraTransform("sanctuary").scale === 1, "the resting camera does not zoom");
  ok(ROOM_ANCHORS.key.x === ROOM_ANCHORS.pedestal.x, "the one warm source stands at the pedestal");
  ok(
    [ROOM_ANCHORS.pedestal, ROOM_ANCHORS.book, ROOM_ANCHORS.window, ROOM_ANCHORS.hologram].every((a) => a.x >= ROOM_SAFE_X.from && a.x <= ROOM_SAFE_X.to && a.y > 0 && a.y < ROOM_STAGE.height),
    "every object the reader must see stands inside the band that survives the tightest crop",
  );

  const { RoomStage } = load<{ RoomStage: Component }>("../components/sanctuary/room/room-stage");
  const room = render(RoomStage, { id: "r", variant: "room" });
  const vignette = render(RoomStage, { id: "v", variant: "vignette" });
  ok(count(room, 'viewBox="0 0 1600 900"') === 6, "the room's plates are all of the one stage viewBox (far, mid behind, mid in front, three dust drifts), so a stage point is the same point on every layer");
  ok(
    room.includes('data-snc-depth="0.25"') && room.includes('data-snc-depth="0.55"') && room.includes('data-snc-depth="0.85"'),
    "three layers, at the plate depths",
  );
  /* THE PERFORMANCE RULE. With the flicker, the drift, the float, the flutter and the orbit moving
     things INSIDE the full-stage plates, every frame damaged 1600 × 900 of vector; a headless run under
     software compositing measured 33 ms frames at 1440. Each motion is now its own element. */
  const plates = [...room.matchAll(/<svg[^>]*viewBox="0 0 1600 900"[^>]*>([\s\S]*?)<\/svg>/g)].map((m) => m[1]);
  ok(
    plates.length === 6 && plates.every((inner) => !/class="[^"]*\b(flame|handFloat|flutter|orbit|driftA|driftB|driftC)\b/.test(inner)),
    "nothing that moves lives inside a full-stage plate — every motion is its own element, so a frame moves a texture instead of repainting a plate",
  );
  for (const object of ["library", "window", "book", "drapes", "corridor", "pedestal", "hologram"]) {
    ok(room.includes(`data-snc-room-object="${object}"`), `the room draws the ${object}`);
  }
  ok(
    vignette.includes('data-snc-room-object="pedestal"') && vignette.includes('data-snc-room-object="hologram"') &&
      !/data-snc-room-object="(library|window|book|drapes|corridor)"/.test(vignette),
    "the phone's vignette is the pedestal and the hologram, and draws nothing it would only hide",
  );
  ok(vignette.length < room.length / 2, `…so a phone does not pay for a room it cannot see (${vignette.length} vs ${room.length} bytes)`);

  /* [A2] the hologram's hand is a silhouette, never a reading. */
  const hologram = vignette.slice(vignette.indexOf('data-snc-room-object="hologram"'));
  ok(hologram.includes(TRADITION_HAND_SILHOUETTE), "[A2] the hologram draws the hand's silhouette…");
  ok(
    TRADITION_LINES.every((line) => !room.includes(`d="${line.d}"`)) && !room.includes(TRADITION_HAND_CREASES),
    "[A2] …and not one of the tradition's lines, anywhere in the room: the hand is a symbol of the scan, not a traced result",
  );
  ok(!/cyan|mount-glow|line-glow/.test(room), "[A2] and it is gold light, never the cyan the reference draws");

  /* Motion is opt-in by tier. */
  const css = read("components", "sanctuary", "room", "room-stage.module.css");
  const moving = rules(css).filter((r) => /\banimation(-name)?\s*:/.test(r.body));
  ok(moving.length >= 6, "the room has its motions — flicker, dust, haze, orbit, breath, flutter");
  ok(moving.every((r) => r.selector.includes("data-snc-tier")), "and every one of them runs only where the measured tier allows it (MID, HIGH) — never before measurement, never at LOW or FLOOR");
  ok(
    !/will-change/.test(withoutComments(css)),
    "and no layer is promoted: measured on the real GPU, promotion bought nothing at p50/p95 and only worsened the worst frame",
  );
  ok(/@keyframes sncRoomFlicker[\s\S]*var\(--snc-flicker-opacity-delta\)/.test(css), "the flicker's depth is the token's ±4%");
  ok(/data-snc-tier="LOW"\] \.set\[data-snc-camera\]\s*{[^}]*opacity:\s*0/.test(withoutComments(css)), "at LOW a camera move is a crossfade, not a push");
  ok(!/<linearGradient|<radialGradient|<filter/.test(read("components", "sanctuary", "room", "room-props.tsx")), "the room declares no gradient or filter of its own: light is CSS, metal is the sprite's ramp");

  /* B5 — the words over the room. */
  const { HomeRoom, ROOM_MOTTO, ROOM_STORY } = load<{ HomeRoom: Component; ROOM_MOTTO: string; ROOM_STORY: string }>(
    "../components/sanctuary/room/home-room",
  );
  const home = render(HomeRoom, { id: "room", profile: null });
  ok(
    home.includes("HastRekha") && home.includes("॥ हस्तरेखा ॥") && ROOM_MOTTO === "From the Vedas. Through time. For you." && home.includes(ROOM_MOTTO) && ROOM_STORY === "Your palm holds a story." && home.includes(ROOM_STORY),
    "B5: the name, its script, the motto and the line, as HTML over the room",
  );
  ok(
    hasTag(home, "a", 'href="/scan/chamber"', 'data-snc-camera="scanner"', "snc-gold-border") && home.includes("Begin your reading"),
    "BEGIN YOUR READING is the primary action — a gold-edged link, not a pill — and moves the camera onto the pedestal first",
  );
  ok(
    hasTag(home, "button", 'aria-disabled="true"', 'data-snc-camera="library"') && home.includes("Explore the library"),
    "EXPLORE THE LIBRARY is disabled until U5 — the camera still looks, the note says why",
  );
  ok(count(home, "objectLabel") >= 2 && home.includes("The Scanner") && home.includes("Your Reading"), "two object labels name the rooms on their gold leaders");
  ok(home.includes('href="#snc-home-content"'), "and the scroll cue leads down to Part C");
}

/* ============================== 9. The island ============================= */

{
  const scene = read("components", "sanctuary", "scene-plate.tsx");
  const constant = (name: string): number => Number(new RegExp(`const ${name} = ([0-9.]+);`).exec(scene)?.[1]);
  const island = load<Record<string, number>>("../app/sanctuary/home-island");
  ok(
    island.ROOM_FOLLOW_TIME_CONSTANT_MS === constant("FOLLOW_TIME_CONSTANT_MS") &&
      island.ROOM_MAX_FRAME_DT_MS === constant("MAX_FRAME_DT_MS") &&
      island.ROOM_TILT_FULL_DEFLECTION_DEG === constant("TILT_FULL_DEFLECTION_DEG") &&
      island.ROOM_TILT_NEUTRAL_BETA_DEG === constant("TILT_NEUTRAL_BETA_DEG"),
    "the parallax follows with <ScenePlate>'s own constants",
  );
  const code = withoutComments(read("app", "sanctuary", "home-island.tsx"));
  ok(code.includes('addEventListener("click", onClick, true)'), "the camera listens in the capture phase, ahead of a Link's own click, so the Link can stand down");
  ok(/if \(href !== null\) {\s*event\.preventDefault\(\);/.test(code), "it takes over only real links — a not-yet-built room's note still opens natively");
  ok(code.includes('if (tier === "FLOOR") return;'), "and it does nothing at FLOOR, which is also where reduced motion lands");
  ok(code.includes('if (tier !== "HIGH" && tier !== "MID") return;'), "parallax runs at MID and HIGH only");
  ok(code.includes("IntersectionObserver") && code.includes("document.hidden"), "and never while the room is off screen or the tab is hidden");
  ok(/frame = 0;\s*last = 0;/.test(code), "the follow loop stops when it arrives, instead of running every frame for ever");
  ok(
    code.includes("element.style.translate =") && !code.includes('setProperty("--snc-room-px"'),
    "each layer's translate is written directly — a custom property on the room would restyle every SVG node in it on every frame",
  );

  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((entry) => {
      const full = path.join(dir, entry);
      return statSync(full).isDirectory() ? walk(full) : /\.(ts|tsx)$/.test(entry) ? [full] : [];
    });
  const u3a = [...walk(path.join(ROOT, "components", "sanctuary")), ...walk(path.join(ROOT, "app", "sanctuary"))];
  const webgl = u3a.filter((file) => /from\s+["'](three|@react-three\/[^"']+)["']|import\(\s*["'](three|@react-three)/.test(readFileSync(file, "utf8")));
  ok(webgl.length === 0, `U3a is a complete Home with NO WebGL — nothing in the sanctuary imports three or @react-three yet (${webgl.map((f) => path.relative(ROOT, f)).join(", ")})`);
}

console.log(`SANCTUARY HOME ASSERTIONS PASSED (${assertions})`);
