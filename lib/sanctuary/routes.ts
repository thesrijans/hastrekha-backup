/**
 * The sanctuary's own routes, named once.
 *
 * U2.1 found five links that had drifted to the pre-sanctuary `/scan` and
 * `/read` because the two sets of paths are nearly interchangeable and were
 * typed from memory at each call site. New sanctuary code reaches for these
 * constants instead, so a destination is a name the compiler checks rather than
 * a string a reader has to recognise. test/sanctuary-routes.test.ts walks the
 * source and fails on any escape either way.
 *
 * Deliberately a plain module with no imports: it is read by server components,
 * client islands and Node tests alike, and a constants file that pulled in a
 * component would drag a CSS module into every one of them.
 */

/** The sanctuary's home — the room, and the first-visit Threshold that precedes it. */
export const SANCTUARY_HOME_HREF = "/sanctuary";

/** Where a reading is made. The same pipeline as `/scan`, in the sanctuary's own room. */
export const SANCTUARY_CHAMBER_HREF = "/scan/chamber";

/** Where a reading is read. */
export const SANCTUARY_POTHI_HREF = "/read/pothi";

/** Sign-in. Not a sanctuary room — shared with the product, as privacy and terms are. */
export const SANCTUARY_LOGIN_HREF = "/login";

/** The two legal pages. They have no sanctuary counterpart and a fabricated one would be worse than a shared page. */
export const SANCTUARY_PRIVACY_HREF = "/privacy";
export const SANCTUARY_TERMS_HREF = "/terms";

/**
 * What every not-yet-built destination says instead of linking anywhere.
 *
 * "Coming soon", in the reader's own script. Rendered on hover, focus and tap
 * by the navigation, never as a link: a route that does not exist must not be
 * something a reader can follow into a 404.
 */
export const SANCTUARY_COMING_SOON_HI = "जल्द आ रहा है";

/** The same, for the accessible name — a screen reader set to English would otherwise spell the Devanagari out. */
export const SANCTUARY_COMING_SOON_EN = "Coming soon";
