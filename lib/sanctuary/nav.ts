/**
 * Where the sanctuary's navigation can go — every destination, once.
 *
 * Two surfaces read this: the rail carved into the stone at the left on wide
 * screens (A4, eight rooms) and the bar at the foot of a phone (A3, four rooms
 * and the emblem between them). They list different subsets in different orders
 * because the references do, but a room is the same room on both, so its name,
 * its glyph and — above all — whether it exists are written here and nowhere
 * else.
 *
 * `href: null` MEANS THE ROOM IS NOT BUILT YET, and the surfaces render it as a
 * disabled control that says "जल्द आ रहा है" when asked. Never a link: a
 * destination that does not exist must not be something a reader can follow
 * into a 404. Building a room is then a one-line change here, and every surface
 * lights it at once.
 *
 * A plain module with no React and no CSS, so a Node test can read it.
 */
import type { SanctuaryIconName } from "@/components/sanctuary/sanctuary-icons";
import { SANCTUARY_CHAMBER_HREF, SANCTUARY_HOME_HREF, SANCTUARY_POTHI_HREF } from "@/lib/sanctuary/routes";

/** The three rooms that exist. A route not in this union cannot be an active nav item. */
export type SanctuaryRouteHref = typeof SANCTUARY_HOME_HREF | typeof SANCTUARY_CHAMBER_HREF | typeof SANCTUARY_POTHI_HREF;

/**
 * Where the room's camera goes before a destination opens (B4).
 *
 * Named here, beside the destination, so U3b's scene and U3a's CSS composition
 * move to the same place for the same click. `null` for destinations the room
 * has no object for.
 */
export type SanctuaryCameraTarget = "scanner" | "book" | "library";

export interface SanctuaryDestination {
  readonly id: "home" | "scan" | "reading" | "horoscope" | "guru" | "guidance" | "journal" | "settings" | "library" | "timeline";
  /** The Latin label, as the rail sets it under the glyph. */
  readonly en: string;
  /** The one Devanagari word the rail sets beside it — the room's own name, not a translation of the Latin. */
  readonly hi: string;
  readonly icon: SanctuaryIconName;
  /** The room, or `null` while it is not built. */
  readonly href: SanctuaryRouteHref | null;
  readonly camera: SanctuaryCameraTarget | null;
}

const HOME: SanctuaryDestination = { id: "home", en: "Home", hi: "गृह", icon: "home", href: SANCTUARY_HOME_HREF, camera: null };
const SCAN: SanctuaryDestination = { id: "scan", en: "Scan", hi: "हस्त", icon: "hand", href: SANCTUARY_CHAMBER_HREF, camera: "scanner" };
const READING: SanctuaryDestination = { id: "reading", en: "My Reading", hi: "पत्र", icon: "leaf", href: SANCTUARY_POTHI_HREF, camera: "book" };

/** A4, in the brief's order: गृह · हस्त · पत्र · ग्रह · गुरु · दिशा · लेखा · यंत्र. */
export const SANCTUARY_RAIL: readonly SanctuaryDestination[] = [
  HOME,
  SCAN,
  READING,
  { id: "horoscope", en: "Horoscope", hi: "ग्रह", icon: "graha", href: null, camera: null },
  { id: "guru", en: "Ask the Guru", hi: "गुरु", icon: "diya", href: null, camera: null },
  { id: "guidance", en: "Daily Guidance", hi: "दिशा", icon: "sunrise", href: null, camera: null },
  { id: "journal", en: "Journal", hi: "लेखा", icon: "stylus", href: null, camera: null },
  { id: "settings", en: "Settings", hi: "यंत्र", icon: "yantra", href: null, camera: null },
];

/**
 * A3: Home · Readings · [emblem] · Library · Timeline.
 *
 * The bar's labels are its own — "Readings", where the rail says "My Reading" —
 * because the home reference sets them that way and a bar has a fifth of the
 * room a rail has. The centre is not in this list: it is the emblem, and it goes
 * to the chamber.
 */
export const SANCTUARY_BAR_SIDES: {
  readonly left: readonly [SanctuaryDestination, SanctuaryDestination];
  readonly right: readonly [SanctuaryDestination, SanctuaryDestination];
} = {
  left: [HOME, { ...READING, en: "Readings" }],
  right: [
    { id: "library", en: "Library", hi: "ग्रंथालय", icon: "scroll", href: null, camera: "library" },
    { id: "timeline", en: "Timeline", hi: "कालरेखा", icon: "hourglass", href: null, camera: null },
  ],
};

/** The emblem at the centre of the bar opens the chamber. */
export const SANCTUARY_BAR_CENTRE: SanctuaryDestination = SCAN;

/** Whether `destination` is the room the reader is standing in. */
export function isActiveDestination(destination: SanctuaryDestination, activeHref: SanctuaryRouteHref | null): boolean {
  return destination.href !== null && destination.href === activeHref;
}
