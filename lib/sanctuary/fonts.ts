/* ============================================================================
 * SANCTUARY TYPEFACES — spec §4, under ruling [R1]
 *
 * Three faces, declared once, at module scope. next/font's SWC transform reads
 * the literal call site at build time, so these cannot be wrapped in a factory,
 * assembled from a config object, or re-declared per route — every option below
 * has to be a literal or the build refuses it.
 *
 * [R1] is a byte ruling, not a taste ruling. Measured 7 Sep 2026 against live
 * fonts.gstatic.com under next/font's own pinned user agent (woff2):
 *
 *   Cinzel                 latin, static 600       14.9 KB   preloaded
 *   Cormorant Garamond     latin, variable normal  36.9 KB   preloaded
 *   Tiro Devanagari Hindi  devanagari, 400         62.1 KB   NOT preloaded
 *
 * New preloaded bytes on a sanctuary route: 14.9 + 36.9 = 51.8 KB, inside the
 * 90 KB ceiling. Adding Tiro to that set makes it 113.9 KB and blows it.
 *
 * The root layout is deliberately untouched. Inter (47.1 KB) and Space Grotesk
 * (22.0 KB) keep their current declarations and preloads — 69.1 KB already
 * spent on EVERY route — because reclaiming preload budget by editing the root
 * layout would change what every existing route ships, which A1 forbids. The
 * sanctuary pays for itself out of the 90 KB it was given. This module imports
 * nothing from the root layout and must never be made to.
 *
 * The consequence, stated honestly: Devanagari swaps in a beat late on first
 * paint. Chapter titles and रेखा names are the visible cost, and the fallback
 * stack below is what the reader actually sees for that beat. If it reads badly
 * on a real device, the next lever is self-subsetting Tiro through
 * next/font/local against the glyphs the KB actually uses — NOT preloading it
 * at the Latin body face's expense.
 * ========================================================================== */
import { Cinzel, Cormorant_Garamond, Tiro_Devanagari_Hindi } from "next/font/google";

/**
 * Per-role fallback stacks for the `display: "swap"` window.
 *
 * WHY this exists as an export as well as inline at each call site: next/font
 * only accepts literal arguments, so these arrays cannot be passed by reference
 * into the font calls — the literals there are mirrors of these, and the test
 * pins the mirror. Consumers that write a raw `font-family` (rather than
 * `var(--font-snc-*)`, which already carries the stack) should append the
 * matching role so the swap window falls back to the same faces.
 *
 * WHY each stack: Palatino/Book Antiqua are the ubiquitous humanist old-style
 * faces, the closest common relatives of Cinzel's inscriptional caps and
 * Cormorant's Garamond colour. Georgia sits in the body stack specifically
 * because it is the only near-universal face with old-style figures, and §4
 * puts old-style figures on every leaf — so numerals do not flip to lining and
 * back across the swap. The Devanagari stack is the one that matters most,
 * because `preload: false` guarantees it gets used: Nirmala UI and Mangal cover
 * Windows, Kohinoor Devanagari and Devanagari MT cover Apple, Noto Sans
 * Devanagari covers Android/Linux/ChromeOS. It ends in `sans-serif`, not
 * `serif`, because Devanagari has no meaningful serif generic and `serif`
 * resolves to a Latin face with no Devanagari coverage on most systems.
 */
export const SANCTUARY_FONT_FALLBACKS: Readonly<
  Record<"serifDisplay" | "serifBody" | "devanagari", readonly string[]>
> = {
  serifDisplay: ["Palatino Linotype", "Book Antiqua", "Palatino", "Times New Roman", "serif"],
  serifBody: ["Iowan Old Style", "Palatino Linotype", "Palatino", "Georgia", "Times New Roman", "serif"],
  devanagari: ["Nirmala UI", "Kohinoor Devanagari", "Devanagari MT", "Noto Sans Devanagari", "Mangal", "sans-serif"],
};

/**
 * Display Latin — wordmarks, chapter titles, "ENTER THE SANCTUARY" (§4).
 *
 * 14.9 KB, preloaded. WHY the static 600 cut and not the variable axis: the
 * variable latin cut measures 25.3 KB, and this face is only ever set at one
 * weight in one register (letter-spaced caps), so the extra 10.4 KB would buy
 * an axis nothing on a sanctuary screen moves. Preloaded because it is in the
 * first painted frame of the Threshold entrance — a swap here is the wordmark
 * visibly changing shape, the one place §4 cannot afford it.
 */
export const sanctuaryDisplay = Cinzel({
  weight: ["600"],
  subsets: ["latin"],
  display: "swap",
  preload: true,
  variable: "--font-snc-display",
  // Literal mirror of SANCTUARY_FONT_FALLBACKS.serifDisplay — next/font needs literals.
  fallback: ["Palatino Linotype", "Book Antiqua", "Palatino", "Times New Roman", "serif"],
});

/**
 * Body serif — manuscript text on leaves (§4).
 *
 * 36.9 KB, preloaded. WHY `weight: "variable"` and no weight list: 36.9 KB is
 * the measured cost of exactly this cut (latin, variable, normal), and it is
 * the larger half of the 51.8 KB the ruling spends. next/font ships one file
 * per static weight, so any list of two or more static cuts trades the
 * continuous 300–700 axis for two fixed stops AND puts the budgeted 36.9 KB at
 * risk — a bad trade for the one face that has to hold both 14 px leaf body and
 * drop-cap-scale headings, where optical weight correction across sizes is the
 * whole point of the axis. Italic is deliberately not requested (`style`
 * defaults to normal): each extra style is another whole file, and marginalia
 * italic has not earned its bytes yet.
 */
export const sanctuarySerif = Cormorant_Garamond({
  weight: "variable",
  subsets: ["latin"],
  display: "swap",
  preload: true,
  variable: "--font-snc-serif",
  // Literal mirror of SANCTUARY_FONT_FALLBACKS.serifBody — next/font needs literals.
  fallback: ["Iowan Old Style", "Palatino Linotype", "Palatino", "Georgia", "Times New Roman", "serif"],
});

/**
 * Display AND body Devanagari — रेखा names, verse headings, Hindi/Hinglish
 * reading text (§4). 400 is the only weight the family has.
 *
 * 62.1 KB, and `preload: false` is the ruling, not an oversight: preloading it
 * would put a sanctuary route at 113.9 KB of new bytes against a 90 KB ceiling.
 * It streams in the second wave instead, so Devanagari swaps in a beat late on
 * first paint and the reader sees SANCTUARY_FONT_FALLBACKS.devanagari until it
 * lands. That is the accepted cost; the escape hatch if it reads badly is
 * self-subsetting through next/font/local, never flipping this flag to true.
 *
 * (62.1 KB is next/font's own user agent. Chrome's UA gets 96.5 KB of the same
 * subset — worth knowing before anyone re-measures with a browser and concludes
 * the ruling was optimistic.)
 */
export const sanctuaryDevanagari = Tiro_Devanagari_Hindi({
  weight: ["400"],
  subsets: ["devanagari"],
  display: "swap",
  preload: false,
  variable: "--font-snc-devanagari",
  // Literal mirror of SANCTUARY_FONT_FALLBACKS.devanagari — next/font needs literals.
  fallback: ["Nirmala UI", "Kohinoor Devanagari", "Devanagari MT", "Noto Sans Devanagari", "Mangal", "sans-serif"],
});

/**
 * All three `.variable` classes in one string, for a future sanctuary layout to
 * drop on a single element.
 *
 * WHY: the three CSS custom properties only exist on elements carrying these
 * classes, so a caller who applies two of the three gets a silently unstyled
 * third role. Joining them here means no consumer has to know the set, the
 * order, or that Tiro is the one that is not preloaded — they apply one
 * className and every `var(--font-snc-*)` below it resolves.
 */
export const SANCTUARY_FONT_CLASS: string = [
  sanctuaryDisplay.variable,
  sanctuarySerif.variable,
  sanctuaryDevanagari.variable,
].join(" ");

/**
 * The measured woff2 figures [R1] rests on, in KB, as data rather than prose.
 *
 * WHY as code: the ruling is arithmetic, and arithmetic in a comment rots
 * silently. Anyone tempted to add a face, a weight, or a preload can check the
 * sum here first, and the test asserts it — the preloaded set is
 * `displayPreloaded + serifPreloaded` and nothing else.
 */
export const SANCTUARY_FONT_BUDGET_KB = {
  /** Cinzel, latin, static 600 — preloaded. */
  displayPreloaded: 14.9,
  /** Cormorant Garamond, latin, variable normal — preloaded. */
  serifPreloaded: 36.9,
  /** Tiro Devanagari Hindi, devanagari 400 — second wave, NOT in the preload sum. */
  devanagariDeferred: 62.1,
  /** Inter + Space Grotesk, already spent on every route by the untouched root layout. */
  rootLayoutBaseline: 69.1,
  /** [R1] ceiling on NEW preloaded bytes for a sanctuary route. */
  newPreloadedCeiling: 90,
} as const;
