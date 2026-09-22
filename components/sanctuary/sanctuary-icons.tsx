/**
 * The sanctuary's icons — one engraved language, drawn here and nowhere else.
 *
 * The brief is specific: "one engraved language, thin gold line, custom SVG. No
 * Lucide, no emoji." Every glyph below is original, drawn on the same 24-unit
 * grid, in one stroke weight, with round caps and joins, so a house in the bottom
 * bar and a compass on a path card look cut by the same hand.
 *
 * `currentColor`, NOT THE `#snc-g-gold` RAMP. The ornaments paint with the shared
 * metal ramp, and for them that is right: a divider or a corner is a struck
 * object. An icon is a control's face — it has to brighten on hover, turn
 * crimson-gold when active and dim when a destination is not built yet, and all
 * three are colour changes the surrounding CSS must be able to make. A gradient
 * reference cannot be recoloured by a parent, and the ramp is objectBoundingBox,
 * so a purely vertical or horizontal stroke (a hairline of zero width in one
 * axis) would paint nothing at all. So icons take the text colour of whatever
 * holds them, and that colour is always a sanctuary gold token.
 *
 * `vector-effect: non-scaling-stroke`: the line stays the same hairline at 20px in
 * the bar and 40px on a card, which is what "one weight" actually means.
 *
 * A server component with no state. Decorative by default (`aria-hidden`); the
 * control that holds an icon carries the accessible name.
 */
import type { ReactElement } from "react";

/** Every glyph the sanctuary may draw. Closed, so a misspelled icon is a compile error. */
export const SANCTUARY_ICON_NAMES = [
  "home",
  "hand",
  "leaf",
  "graha",
  "diya",
  "sunrise",
  "stylus",
  "yantra",
  "scroll",
  "hourglass",
  "meditation",
  "satchel",
  "hearts",
  "coins",
  "compass",
  "arrow",
  "profile",
  "chevron-down",
  "flip",
] as const;

export type SanctuaryIconName = (typeof SANCTUARY_ICON_NAMES)[number];

/** The one stroke weight, in CSS pixels. Slightly over 1 so it survives antialiasing on a 1x screen. */
export const SANCTUARY_ICON_STROKE_PX = 1.3;

/**
 * Path data per glyph, on a 24-unit grid with a 2-unit margin.
 *
 * Subpaths rather than separate elements, so each glyph is one `<path>`: one
 * node to paint, one to recolour. Two glyphs carry a small filled mark (the
 * yantra's bindu, the diya's wick) — listed separately in {@link ICON_DOTS}
 * because a filled dot is not a stroke and must not be stroked as one.
 */
const ICON_PATHS: Readonly<Record<SanctuaryIconName, string>> = {
  /* गृह — a shrine: a pitched roof, walls, and an arched door. */
  home: "M3 11 L12 3.5 L21 11 M5.5 9.3 V20.5 H18.5 V9.3 M10 20.5 V15.8 A2 2 0 0 1 14 15.8 V20.5",
  /* हस्त — an open hand, palm out: four fingers of four lengths and the thumb swung away. */
  hand:
    "M8.6 12 V5.8 A1 1 0 0 1 10.6 5.8 V11 M10.6 11 V4.2 A1 1 0 0 1 12.6 4.2 V11 " +
    "M12.6 11 V5.2 A1 1 0 0 1 14.6 5.2 V11.6 M14.6 11.6 V7.4 A1 1 0 0 1 16.6 7.4 V14.4 " +
    "C16.6 18.4 14.6 21 11.6 21 C9.2 21 7.7 19.6 6.7 17.7 L4.7 13.9 C4.2 12.9 5.3 12.1 6.1 12.9 L8.6 15.4 V12",
  /* पत्र — an open book, both leaves rising from the spine, two lines of ink on each. */
  leaf:
    "M3.5 6 C6.6 5 9.5 5.3 12 7 C14.5 5.3 17.4 5 20.5 6 V18.6 C17.4 17.6 14.5 17.9 12 19.6 " +
    "C9.5 17.9 6.6 17.6 3.5 18.6 Z M12 7 V19.6 M6 9.4 H9.6 M6 12 H9.6 M14.4 9.4 H18 M14.4 12 H18",
  /* ग्रह — a planet in its ring, and one star. */
  graha:
    "M16.5 12 A4.5 4.5 0 1 1 7.5 12 A4.5 4.5 0 1 1 16.5 12 Z " +
    "M3.1 14.6 C1.9 12.6 6.3 9.9 11.8 8.9 C17.3 7.9 22 8.6 21.3 10.8 C20.8 12.4 17.4 14.1 12.9 15 " +
    "M19.2 3.4 V6.2 M17.8 4.8 H20.6",
  /* गुरु — a diya: the bowl, its spout, and the flame standing above it. */
  diya:
    "M4.5 14 C5 17.6 8 19.2 12 19.2 C16 19.2 19 17.6 19.5 14 Z M19.5 14 L21.3 12.7 " +
    "M12 12.4 C10.2 10.7 10.5 8.5 12 5.8 C13.5 8.5 13.8 10.7 12 12.4 Z M9.5 21.3 H14.5",
  /* दिशा — the sun rising on the horizon: the way a day is read. */
  sunrise:
    "M3 17 H21 M7 17 A5 5 0 0 1 17 17 M12 6.4 V8.6 M5.4 9.4 L6.9 10.9 M18.6 9.4 L17.1 10.9 " +
    "M3.4 13.6 H5.4 M18.6 13.6 H20.6 M8 20 H16",
  /* लेखा — a palm leaf with its string hole and two lines of writing, and the stylus across it. */
  stylus:
    "M3.5 8.8 H20.5 V15.2 H3.5 Z M7.4 12 A0.9 0.9 0 1 1 5.6 12 A0.9 0.9 0 1 1 7.4 12 Z " +
    "M9.2 11 H17.8 M9.2 13.2 H15 M14.6 21 L21 3.4",
  /* यंत्र — a yantra: the square, the circle, two interlocked triangles and the bindu. */
  yantra:
    "M3.5 3.5 H20.5 V20.5 H3.5 Z M18.5 12 A6.5 6.5 0 1 1 5.5 12 A6.5 6.5 0 1 1 18.5 12 Z " +
    "M12 6.3 L16.9 14.8 H7.1 Z M12 17.7 L7.1 9.2 H16.9 Z",
  /* The Library — a scroll between its two rollers, with its lines. */
  scroll:
    "M6.6 6.2 H17.4 V17.8 H6.6 Z M5.4 4.3 H18.6 A1.4 1.4 0 0 1 18.6 7.1 H5.4 A1.4 1.4 0 0 1 5.4 4.3 Z " +
    "M5.4 16.9 H18.6 A1.4 1.4 0 0 1 18.6 19.7 H5.4 A1.4 1.4 0 0 1 5.4 16.9 Z M9.2 10.2 H14.8 M9.2 12.8 H14.8",
  /* The Timeline — an hourglass, older than the clock the reference drew. */
  hourglass:
    "M6.6 3.5 H17.4 M6.6 20.5 H17.4 M8 3.5 C8 8.2 12 9.8 12 12 C12 14.2 8 15.8 8 20.5 " +
    "M16 3.5 C16 8.2 12 9.8 12 12 C12 14.2 16 15.8 16 20.5 M10.2 18.6 C11 17.6 13 17.6 13.8 18.6",
  /* Personality — a seated figure in meditation. */
  meditation:
    "M14.2 5.4 A2.2 2.2 0 1 1 9.8 5.4 A2.2 2.2 0 1 1 14.2 5.4 Z " +
    "M9 13.6 C9 10.1 10.3 8.4 12 8.4 C13.7 8.4 15 10.1 15 13.6 M9.1 10.9 C7.6 12.4 6.8 13.9 6.5 15.4 " +
    "M14.9 10.9 C16.4 12.4 17.2 13.9 17.5 15.4 M3.8 18.6 C6.4 16 9 15.5 12 16.5 C15 15.5 17.6 16 20.2 18.6 " +
    "C16.6 19.9 7.4 19.9 3.8 18.6 Z",
  /* Career — a satchel with its handle, flap and clasp. */
  satchel:
    "M4.5 8 H19.5 A1.2 1.2 0 0 1 20.7 9.2 V18.8 A1.2 1.2 0 0 1 19.5 20 H4.5 A1.2 1.2 0 0 1 3.3 18.8 V9.2 " +
    "A1.2 1.2 0 0 1 4.5 8 Z M9 8 V6 C9 5.2 9.6 4.6 10.4 4.6 H13.6 C14.4 4.6 15 5.2 15 6 V8 " +
    "M3.3 12.4 H20.7 M10.9 11.2 H13.1 V13.8 H10.9 Z",
  /* Relationships — two hearts, one drawn through the other. */
  hearts:
    "M9.4 18.6 C5.2 15.6 3.2 12.9 3.2 10 C3.2 7.7 4.9 6.1 6.9 6.1 C8.2 6.1 9.2 6.8 9.8 7.9 " +
    "C10.4 6.8 11.4 6.1 12.7 6.1 C14.7 6.1 16.4 7.7 16.4 10 C16.4 12.9 14.4 15.6 9.8 18.6 " +
    "M13.6 20 C17.9 17.2 20.8 14.6 20.8 11.6 C20.8 9.5 19.2 8 17.3 8 C16.4 8 15.6 8.3 15 8.9",
  /* Wealth — a stack of four coins. */
  coins:
    "M18.5 6.4 A6.5 2.3 0 1 1 5.5 6.4 A6.5 2.3 0 1 1 18.5 6.4 Z M5.5 6.4 V17.6 M18.5 6.4 V17.6 " +
    "M5.5 10.1 A6.5 2.3 0 0 0 18.5 10.1 M5.5 13.8 A6.5 2.3 0 0 0 18.5 13.8 M5.5 17.6 A6.5 2.3 0 0 0 18.5 17.6",
  /* Life Path — a compass rose inside its ring. */
  compass:
    "M20.5 12 A8.5 8.5 0 1 1 3.5 12 A8.5 8.5 0 1 1 20.5 12 Z " +
    "M12 3.2 L13.5 10.5 L20.8 12 L13.5 13.5 L12 20.8 L10.5 13.5 L3.2 12 L10.5 10.5 Z",
  /* The major action's arrow. */
  arrow: "M5 12 H18.6 M13.6 7 L18.6 12 L13.6 17",
  /* The visitor — a bust. The circle it sits in is the button's own border. */
  profile: "M15.2 9 A3.2 3.2 0 1 1 8.8 9 A3.2 3.2 0 1 1 15.2 9 Z M5.8 18.8 C7 15.8 9.3 14.3 12 14.3 C14.7 14.3 17 15.8 18.2 18.8",
  /* Down, into the rest of the page. */
  "chevron-down": "M6 9.5 L12 15.5 L18 9.5",
  /* The chamber's other camera (M1.1) — a lens between two arcs that turn it round. */
  flip:
    "M15 12 A3 3 0 1 1 9 12 A3 3 0 1 1 15 12 Z M4.4 10.2 A7.8 7.8 0 0 1 18.7 8.3 M18.7 8.3 L19.1 4.9 " +
    "M18.7 8.3 L15.4 7.5 M19.6 13.8 A7.8 7.8 0 0 1 5.3 15.7 M5.3 15.7 L4.9 19.1 M5.3 15.7 L8.6 16.5",
};

/** The two filled marks — the yantra's bindu and the diya's wick. */
const ICON_DOTS: Readonly<Partial<Record<SanctuaryIconName, readonly (readonly [number, number, number])[]>>> = {
  yantra: [[12, 12, 0.85]],
  diya: [[12, 13.3, 0.6]],
};

export interface SanctuaryIconProps {
  readonly name: SanctuaryIconName;
  /** Rendered size in CSS pixels. The glyph is square. */
  readonly size?: number;
  readonly className?: string;
}

/** One engraved glyph, in the colour of whatever holds it. */
export function SanctuaryIcon({ name, size = 24, className }: SanctuaryIconProps): ReactElement {
  const dots = ICON_DOTS[name] ?? [];
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      aria-hidden="true"
      focusable="false"
      className={className}
      data-snc-icon={name}
    >
      <path
        d={ICON_PATHS[name]}
        fill="none"
        stroke="currentColor"
        strokeWidth={SANCTUARY_ICON_STROKE_PX}
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
      {dots.map(([cx, cy, r]) => (
        <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r={r} fill="currentColor" />
      ))}
    </svg>
  );
}

/** The raw path data, for the one place that draws a glyph inside a larger SVG of its own. */
export function sanctuaryIconPath(name: SanctuaryIconName): string {
  return ICON_PATHS[name];
}
