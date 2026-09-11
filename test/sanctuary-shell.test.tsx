/* ============================================================================
 * THE SHELL — A1–A4: the frame, the brand mark, the rail, the bar, the glyphs
 *
 * What U3a's Part A promises, asserted on rendered markup and on the sheets:
 *
 *  · ONE FRAME. <SanctuaryShell> mounts the sprite once, the ground, the rail,
 *    the bar and (optionally) the wordmark-and-Login header, in that order.
 *  · NEVER A DEAD LINK (A4). A room that is not built is a button that says
 *    "जल्द आ रहा है"; every link the navigation renders goes to a room that exists.
 *  · THE BRAND MARK (A2) at exactly four sizes, with the ruby cabochon, and the
 *    beads where they read.
 *  · ONE ENGRAVED LANGUAGE for the icons: custom paths, currentColor, one
 *    hairline weight, no Lucide, no emoji.
 *  · THE MATERIAL RULES hold in every new file: tokens only, no cold accent, no
 *    radius but the medallion's disc and the doorway's arch.
 * ========================================================================== */
import assert from "node:assert/strict";
import Module, { createRequire } from "node:module";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { createElement, type ReactElement, type ReactNode } from "react";
import { renderToString } from "react-dom/server";
import { SANCTUARY_BAR_CENTRE, SANCTUARY_BAR_SIDES, SANCTUARY_RAIL } from "../lib/sanctuary/nav";
import {
  SANCTUARY_CHAMBER_HREF,
  SANCTUARY_COMING_SOON_HI,
  SANCTUARY_HOME_HREF,
  SANCTUARY_POTHI_HREF,
} from "../lib/sanctuary/routes";

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
/**
 * Whether some opening `<tag …>` carries every one of `attrs`, in any order. Next's <Link> emits
 * `href` after the element's other attributes, so an assertion that assumed an order would be
 * testing the framework's serialiser rather than this code.
 */
const hasTag = (html: string, tag: string, ...attrs: string[]): boolean =>
  [...html.matchAll(new RegExp(`<${tag}\\b[^>]*>`, "g"))].some((m) => attrs.every((attr) => m[0].includes(attr)));

type Component = (props: Record<string, unknown>) => ReactElement;
const require_ = createRequire(__filename);
const load = <T,>(rel: string): T => require_(rel) as T;
const render = (component: Component, props: Record<string, unknown> = {}, children?: ReactNode): string =>
  renderToString(createElement(component, props, children)).replace(/<!-- -->/g, "");

const { SanctuaryIcon, SANCTUARY_ICON_NAMES, SANCTUARY_ICON_STROKE_PX } = load<{
  SanctuaryIcon: Component;
  SANCTUARY_ICON_NAMES: readonly string[];
  SANCTUARY_ICON_STROKE_PX: number;
}>("../components/sanctuary/sanctuary-icons");
const { BrandEmblem, BRAND_EMBLEM_SIZES } = load<{ BrandEmblem: Component; BRAND_EMBLEM_SIZES: readonly number[] }>(
  "../components/sanctuary/brand-emblem",
);
const { NavRail } = load<{ NavRail: Component }>("../components/sanctuary/shell/nav-rail");
const { BottomNav } = load<{ BottomNav: Component }>("../components/sanctuary/shell/bottom-nav");
const { SanctuaryShell } = load<{ SanctuaryShell: Component }>("../components/sanctuary/shell/sanctuary-shell");
const { SanctuaryHeader } = load<{ SanctuaryHeader: Component }>("../components/sanctuary/sanctuary-header");

/* ============================ 1. The glyphs =============================== */

{
  const REQUIRED = ["home", "hand", "leaf", "graha", "diya", "sunrise", "stylus", "yantra", "scroll", "hourglass", "meditation", "satchel", "hearts", "coins", "compass", "arrow"];
  ok(REQUIRED.every((name) => SANCTUARY_ICON_NAMES.includes(name)), "every glyph the rail, the bar and the five paths need is drawn");
  ok(new Set(SANCTUARY_ICON_NAMES).size === SANCTUARY_ICON_NAMES.length, "and each is drawn once");
  for (const name of SANCTUARY_ICON_NAMES) {
    const html = render(SanctuaryIcon, { name });
    const d = /<path d="([^"]+)"/.exec(html)?.[1] ?? "";
    ok(
      d.length > 10 && /^[MLHVCSQTAZmlhvcsqtaz0-9.,\s-]+$/.test(d) &&
        html.includes('stroke="currentColor"') &&
        html.includes('vector-effect="non-scaling-stroke"') &&
        html.includes(`stroke-width="${SANCTUARY_ICON_STROKE_PX}"`) &&
        html.includes('aria-hidden="true"') &&
        !html.includes("url(#"),
      `"${name}" is one engraved hairline in the colour of whatever holds it — never a gradient, which a parent could not recolour`,
    );
  }
  ok(SANCTUARY_ICON_STROKE_PX > 1 && SANCTUARY_ICON_STROKE_PX < 1.5, "one weight for every glyph: a hairline, just over a pixel so it survives a 1x screen");
}

/* ========================== 2. The brand mark (A2) ======================== */

{
  ok(JSON.stringify(BRAND_EMBLEM_SIZES) === "[24,40,64,120]", "the mark exists at exactly the four sizes the brief names");
  for (const size of BRAND_EMBLEM_SIZES) {
    const html = render(BrandEmblem, { size });
    ok(html.includes(`width="${size}"`), `it renders at ${size}px`);
    ok(
      count(html, "var(--color-snc-ruby)") >= 2 && !html.includes("var(--color-snc-ink-red)"),
      `…with the ruby cabochon (body and lit crown), not the flat ink-red bezel, at ${size}px`,
    );
    ok(
      html.includes('data-snc-part="beads"') === size >= 40,
      size >= 40 ? `…and the struck beads outside the ring at ${size}px` : "…and no beads at 24px, where they would blur into a halo",
    );
  }
  ok(render(BrandEmblem, { size: 40 }) === render(BrandEmblem, { size: 40 }), "one fixed waver: the mark on the rail and on the Threshold are the same mark");

  /* The ruby is the only saturated red outside wax: in any stylesheet it appears only mixed down. */
  const sheets = [
    read("components", "sanctuary", "shell", "bottom-nav.module.css"),
    read("components", "sanctuary", "shell", "nav-rail.module.css"),
    read("components", "sanctuary", "home", "home.module.css"),
    read("components", "sanctuary", "room", "room-stage.module.css"),
  ].map(withoutComments);
  const bare = sheets.flatMap((sheet) => [...sheet.matchAll(/([^;{]*)var\(--color-snc-ruby\)/g)].filter((m) => !/color-mix\(/.test(m[1])));
  ok(bare.length === 0, "outside the emblem the ruby is never a paint of its own — only mixed into the bar's crimson-gold, never a saturated red");
}

/* ===================== 3. Where the navigation can go ====================== */

{
  ok(
    JSON.stringify(SANCTUARY_RAIL.map((d) => d.hi)) === JSON.stringify(["गृह", "हस्त", "पत्र", "ग्रह", "गुरु", "दिशा", "लेखा", "यंत्र"]),
    "the rail's eight rooms are A4's, in A4's order",
  );
  ok(
    JSON.stringify(SANCTUARY_RAIL.map((d) => d.en)) ===
      JSON.stringify(["Home", "Scan", "My Reading", "Horoscope", "Ask the Guru", "Daily Guidance", "Journal", "Settings"]),
    "…with A4's Latin names",
  );
  ok(
    JSON.stringify(SANCTUARY_RAIL.filter((d) => d.href !== null).map((d) => d.href)) ===
      JSON.stringify([SANCTUARY_HOME_HREF, SANCTUARY_CHAMBER_HREF, SANCTUARY_POTHI_HREF]),
    "exactly three are built — Home, the chamber, the book — and the other five are not links",
  );
  ok(
    [...SANCTUARY_BAR_SIDES.left, ...SANCTUARY_BAR_SIDES.right].map((d) => d.en).join(" ") === "Home Readings Library Timeline" &&
      SANCTUARY_BAR_CENTRE.href === SANCTUARY_CHAMBER_HREF,
    "the bar is A3's: Home · Readings · [emblem → chamber] · Library · Timeline",
  );
  const every = [...SANCTUARY_RAIL, ...SANCTUARY_BAR_SIDES.left, ...SANCTUARY_BAR_SIDES.right, SANCTUARY_BAR_CENTRE];
  ok(
    every.every((d) => d.href === null || existsSync(path.join(ROOT, "app", ...d.href.split("/").filter(Boolean), "page.tsx"))),
    "every destination that is a link has a page.tsx behind it — a room that is listed and not built is a 404, which is what A4 forbids",
  );
}

/* ================================ 4. The rail ============================= */

{
  const html = render(NavRail, { activeHref: SANCTUARY_HOME_HREF });
  const hrefs = [...html.matchAll(/<a[^>]*href="([^"]+)"/g)].map((m) => m[1]);
  ok(hrefs.length === 4, "four links: the brand mark home, and the three built rooms");
  ok(
    hrefs.every((href) => [SANCTUARY_HOME_HREF, SANCTUARY_CHAMBER_HREF, SANCTUARY_POTHI_HREF].includes(href)),
    "…and every one of them goes to a room that exists",
  );
  ok(count(html, 'aria-disabled="true"') === 5, "the five unbuilt rooms are disabled controls…");
  /* React 19 serialises the prop as `popoverTarget`; HTML attribute names are case-insensitive, so the
     parser reads it as `popovertarget`. Matched case-insensitively for that reason. */
  const targets = [...html.matchAll(/popovertarget="([^"]+)"/gi)].map((m) => m[1]);
  ok(
    targets.length === 5 && targets.every((id) => html.includes(`id="${id}"`)) && count(html, 'popover="auto"') === 5,
    "…each opening its own note through the Popover API, so the rail ships no JavaScript to say so",
  );
  ok(count(html, SANCTUARY_COMING_SOON_HI) >= 10, "and every one of them says “जल्द आ रहा है” — on hover in the rail and in its note");
  ok(!/<button[^>]*href=/.test(html), "a disabled room is never a link in disguise");
  ok(count(html, 'aria-current="page"') === 1 && hasTag(html, "a", 'href="/sanctuary"', 'aria-current="page"'), "the room the reader is in is marked — once");
  ok(!render(NavRail, { activeHref: null }).includes('aria-current="page"'), "a route the rail does not list lights nothing");
  ok(
    hasTag(html, "a", 'href="/scan/chamber"', 'data-snc-camera="scanner"') && hasTag(html, "a", 'href="/read/pothi"', 'data-snc-camera="book"'),
    "Scan and My Reading carry their camera targets, so Home's room moves before the route opens (B4)",
  );
  const css = withoutComments(read("components", "sanctuary", "shell", "nav-rail.module.css"));
  ok(
    /\.itemActive\s*{[^}]*inset[^}]*var\(--color-snc-flame-warm\)/.test(css) && !/\.itemActive\s*{[^}]*background-color/.test(css),
    "the active room is lit from behind the stone — a warm inset glow, never a filled pill",
  );
  ok(/\.rail\s*{\s*display:\s*none;?\s*}/.test(css) && /@media \(min-width: 48rem\)\s*{\s*\.rail/.test(css), "the rail exists from 48rem up, and not on a phone");
}

/* ================================ 5. The bar ============================== */

{
  const html = render(BottomNav, { activeHref: SANCTUARY_POTHI_HREF });
  const order = ["Home", "Readings", 'aria-label="Scan — begin your reading"', "Library", "Timeline"].map((needle) => html.indexOf(needle));
  ok(order.every((at, i) => at !== -1 && (i === 0 || at > order[i - 1])), "the bar reads Home · Readings · [emblem] · Library · Timeline, left to right");
  ok(
    hasTag(html, "a", 'href="/scan/chamber"', 'aria-label="Scan — begin your reading"') && html.includes('data-snc-ornament="trishul"'),
    "the centre is the brand emblem, and it opens the chamber",
  );
  ok(count(html, 'aria-current="page"') === 1 && hasTag(html, "a", 'href="/read/pothi"', 'aria-current="page"'), "the current room is marked, once");
  ok(count(html, 'aria-disabled="true"') === 2, "Library and Timeline are not built, and say so rather than linking");
  const css = withoutComments(read("components", "sanctuary", "shell", "bottom-nav.module.css"));
  ok(css.includes("env(safe-area-inset-bottom"), "the bar pads itself clear of the home indicator");
  ok(/\.slotActive\s*{[^}]*color-mix\(in oklab, var\(--color-snc-gold-500\)[^)]*var\(--color-snc-ruby\)\)/.test(css), "the active room is crimson-gold: the gold mixed toward the ruby");
  ok(/\.centre\s*{[^}]*margin-top:\s*-/.test(css), "the emblem floats above the bar's edge");
  ok(/@media \(min-width: 48rem\)\s*{\s*\.bar\s*{\s*display:\s*none/.test(css), "the bar is a phone's, and leaves at 48rem where the rail takes over");
  const shellCss = withoutComments(read("components", "sanctuary", "shell", "sanctuary-shell.module.css"));
  ok(shellCss.includes("env(safe-area-inset-bottom") && shellCss.includes("var(--snc-rail-width)"), "the page is padded clear of the bar and of the rail by the same numbers they are sized by");
}

/* =============================== 6. The frame ============================= */

{
  const html = render(
    SanctuaryShell,
    { activeHref: SANCTUARY_POTHI_HREF, groundSeed: 7, className: "FONT-CLASS" },
    createElement("p", null, "the route's own content"),
  );
  ok(html.startsWith("<main") && /^<main[^>]*class="FONT-CLASS/.test(html), "the shell is the route's <main>, carrying the font class the route hands it");
  ok(count(html, 'id="snc-f-torn"') === 1, "the filter sprite is mounted once");
  ok(count(html, 'aria-label="Sanctuary rooms"') === 2, "both navigations are mounted — the stylesheet, not the server, chooses the rail or the bar");
  ok(html.includes('href="/login"') && !html.includes("navLink"), "the header keeps Login and drops its four links, because the rail and the bar already name the rooms");
  ok(html.includes("the route&#x27;s own content") || html.includes("the route's own content"), "and the route's content is inside it");
  ok(!render(SanctuaryShell, { activeHref: SANCTUARY_HOME_HREF, groundSeed: 7, className: "F", header: false }).includes('href="/login"'), "a route that draws its own masthead can leave the header out");

  const code = withoutComments(read("components", "sanctuary", "shell", "sanctuary-shell.tsx"));
  ok(code.indexOf("<SanctuaryDefs") < code.indexOf("<SanctuaryGround"), "the sprite is mounted before the ground and everything that references it");
  ok(!/from\s+["']@\/lib\/sanctuary\/fonts["']/.test(code), "the shell does not import the font module — next/font throws outside the compiler");
  const shellRule = /\.shell\s*{([^}]*)}/.exec(withoutComments(read("components", "sanctuary", "shell", "sanctuary-shell.module.css")))?.[1] ?? "";
  ok(!/background|isolation|z-index/.test(shellRule), "the shell's <main> has no background, no isolation and no z-index — the ground paints at -1 and must show through");
  for (const file of ["sanctuary-shell.tsx", "nav-rail.tsx", "bottom-nav.tsx", "coming-soon.tsx"]) {
    const source = read("components", "sanctuary", "shell", file);
    ok(!/["']use client["']/.test(source) && !/\buse[A-Z]\w*\(/.test(withoutComments(source)), `${file} is a server component: the whole shell ships no JavaScript of its own`);
  }
}

/* ============================ 7. The header's links ======================== */

{
  const off = render(SanctuaryHeader, { links: false });
  ok(!off.includes("navLink") && !off.includes("<nav") && off.includes('href="/login"'), "with links off the header is the wordmark and Login — and no empty navigation landmark");
  ok(count(render(SanctuaryHeader, {}), "navLink") === 4, "with links on, as every existing caller has it, all four destinations render");
}

/* ======================== 8. The material rules, in every new file ======== */

{
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((entry) => {
      const full = path.join(dir, entry);
      return statSync(full).isDirectory() ? walk(full) : [full];
    });
  const files = [
    ...["shell", "home", "room", "threshold"].flatMap((dir) => walk(path.join(ROOT, "components", "sanctuary", dir))),
    path.join(ROOT, "components", "sanctuary", "brand-emblem.tsx"),
    path.join(ROOT, "components", "sanctuary", "sanctuary-icons.tsx"),
    path.join(ROOT, "app", "sanctuary", "page.tsx"),
    path.join(ROOT, "app", "sanctuary", "home-island.tsx"),
  ];
  ok(files.length >= 25, `U3a's files are being checked (${files.length})`);
  const offenders = { hex: [] as string[], cold: [] as string[], foreign: [] as string[], radius: [] as string[], icons: [] as string[] };
  for (const file of files) {
    const code = withoutComments(readFileSync(file, "utf8"));
    const name = path.relative(ROOT, file);
    if (/#[0-9a-fA-F]{3,8}\b/.test(code)) offenders.hex.push(name);
    if (/cyan|mount-glow|line-glow/.test(code)) offenders.cold.push(name);
    if (/var\(--color-(?!snc-)/.test(code)) offenders.foreign.push(name);
    if (/lucide|react-icons|heroicons/i.test(code) || /\p{Extended_Pictographic}/u.test(code)) offenders.icons.push(name);
    for (const m of code.matchAll(/border-radius:\s*([^;]+);/g)) {
      if (!/^50%(\s+50%\s+0\s+0\s*\/\s*28%\s+28%\s+0\s+0)?$/.test(m[1].trim())) offenders.radius.push(`${name}: ${m[1]}`);
    }
  }
  ok(offenders.hex.length === 0, `no colour literal anywhere — every paint is a token (${offenders.hex.join(", ")})`);
  ok(offenders.cold.length === 0, `no cold instrument accent (${offenders.cold.join(", ")})`);
  ok(offenders.foreign.length === 0, `no colour from the product palette (${offenders.foreign.join(", ")})`);
  ok(offenders.icons.length === 0, `no Lucide, no icon library, no emoji — one engraved language (${offenders.icons.join(", ")})`);
  ok(offenders.radius.length === 0, `no radius but a disc's 50% and the doorway's arch — never a default rounding (${offenders.radius.join(" | ")})`);
}

console.log(`SANCTUARY SHELL ASSERTIONS PASSED (${assertions})`);
