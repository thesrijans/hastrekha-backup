import Link from "next/link";
import type { ReactElement } from "react";
import styles from "./sanctuary-header.module.css";

/**
 * NOTE THE ABSENCE OF `"use client"`, AND THE TWO THINGS IT COST.
 *
 * components/header.tsx is a client component for good reasons of its own: it
 * fetches `/api/auth/me`, it owns a mobile disclosure menu, and it reads
 * `usePathname()`. This variant gives up all three and stays on the server,
 * which is why it ships zero client JavaScript.
 *
 *  - The active route arrives as the `activeHref` prop instead of from
 *    `usePathname()`. That hook is the entire reason a header becomes a client
 *    component, and paying for it here would mean shipping the wordmark, the
 *    Devanagari and four links to every device in order to run one string
 *    comparison the server already knows the answer to.
 *  - The mobile menu is gone; the nav wraps. A disclosure needs state, and
 *    state is the same bill again — for a button whose only job is to hide four
 *    short words.
 *  - Auth-aware controls (the signed-in name, Logout) are NOT reimplemented
 *    here. That is a real difference from the existing header, stated plainly
 *    rather than hidden: this is the sanctuary's title page, and a route that
 *    needs a live session control should keep rendering the product header.
 *    Adding an auth fetch here would make it a client component and undo
 *    everything above.
 *
 * IT ALSO IMPORTS NOTHING FROM lib/sanctuary/fonts.ts, WHICH IS DELIBERATE.
 * The faces are read as `var(--font-snc-*)` in the stylesheet. Those custom
 * properties exist only under an element carrying `SANCTUARY_FONT_CLASS`, so
 * the route must apply that class — the same contract every other sanctuary
 * component has. Importing the module to be self-sufficient would execute
 * `next/font/google` outside the compiler, which throws, and would make this
 * component impossible to render in a test.
 */

/**
 * The four destinations, in the order components/header.tsx already puts them.
 *
 * Exported as data because the sanctuary skin is a change of material and not a
 * change of information architecture: the day a fifth destination is added to
 * the product header it must be added here too, and a reader comparing the two
 * files should be able to see the correspondence without reading any JSX.
 *
 * THE FIRST TWO POINT INTO THE SANCTUARY, and until this pass they did not.
 * "Reading" went to /read and "Scan" to /scan — the pre-sanctuary surfaces —
 * so the nav on a sanctuary page was a set of doors out of it. The information
 * architecture is unchanged, which is exactly the point: the same four
 * destinations, each resolved to the room this skin actually has. Privacy and
 * Terms have no sanctuary counterpart and are left alone rather than given a
 * fabricated one.
 */
export const SANCTUARY_NAV = [
  { href: "/read/pothi", label: "Reading" },
  { href: "/scan/chamber", label: "Scan" },
  { href: "/privacy", label: "Privacy" },
  { href: "/terms", label: "Terms" },
] as const;

/** The routes the sanctuary nav can point at, derived from the table so the two can never disagree. */
export type SanctuaryNavHref = (typeof SANCTUARY_NAV)[number]["href"];

/**
 * The name in Devanagari, between two dandas.
 *
 * The mark is U+0965 DEVANAGARI DOUBLE DANDA — the real typographic bracket a
 * manuscript uses around an invocation, and what the brief's ASCII `||` stands
 * for. Two ASCII pipes in a line of Devanagari fall back to a Latin face
 * mid-word, so they would print at the wrong weight and the wrong height beside
 * the script they are meant to frame.
 *
 * Exported so a route that needs the same string — a page title, an og:image —
 * cannot retype it with the wrong bracket or a broken conjunct.
 */
export const SANCTUARY_WORDMARK_DEVANAGARI = "॥ हस्तरेखा ॥";

/** The Latin wordmark, kept letter for letter from the product header so the brand does not fork. */
export const SANCTUARY_WORDMARK_LATIN = "HastRekha";

/** What the header needs from the route, which is one string. */
export interface SanctuaryHeaderProps {
  /**
   * The destination the reader is currently on, or `null` when they are
   * somewhere the nav does not list (the home page, `/login`).
   *
   * A prop rather than `usePathname()` — see the note at the top of this file
   * for what that buys. A page knows its own route at build time, so the caller
   * always has this for free.
   */
  readonly activeHref?: SanctuaryNavHref | null;
}

/**
 * The sanctuary's header: a gold wordmark over its Devanagari echo, four
 * engraved links, a dark gold-edged Login, and one gold rule that fades out at
 * both ends.
 *
 * FOR SANCTUARY ROUTES ONLY. components/header.tsx is untouched and remains the
 * header on every other route; this is a variant, not a replacement. It is
 * built to sit on `<SanctuaryGround />` and paints no background of its own, so
 * on any other ground it will simply show whatever is behind it.
 *
 * NOT ONE COLD ACCENT. The product header's active pill and its filled Login
 * are drawn from the instrument palette, which goes acid against candlelight —
 * that clash is the reason this file exists. Every colour here resolves to a
 * --color-snc-* token in the stylesheet, and the test asserts the rendered
 * markup and that stylesheet carry no trace of the instrument accents.
 */
export function SanctuaryHeader({ activeHref = null }: SanctuaryHeaderProps): ReactElement {
  return (
    <header className={styles.header}>
      <div className={styles.bar}>
        <Link href="/" className={styles.wordmark}>
          {/* `.snc-gold-text` from the token layer clips the 105deg metal ramp to the glyphs and
              carries the raised emboss. The module class beside it sets type only — see its note
              on the five properties it must never set. */}
          <span className={`${styles.wordmarkLatin} snc-gold-text`}>{SANCTUARY_WORDMARK_LATIN}</span>
          {/* `lang` so a screen reader switches voice, and so the browser picks the Devanagari
              face out of the fallback stack while Tiro is still in flight — it is deliberately
              not preloaded, so this is the one wordmark that is briefly set in a fallback. */}
          <span className={styles.wordmarkDevanagari} lang="hi">
            {SANCTUARY_WORDMARK_DEVANAGARI}
          </span>
        </Link>

        {/* "Sanctuary", not "Main": the product header is still mounted by the root layout, and
            two navigation landmarks sharing one accessible name is worse than either name being
            slightly indirect. */}
        <nav aria-label="Sanctuary" className={styles.nav}>
          {SANCTUARY_NAV.map((item) => {
            const isActive = item.href === activeHref;
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={isActive ? "page" : undefined}
                className={isActive ? `${styles.navLink} ${styles.navLinkActive}` : styles.navLink}
              >
                {item.label}
              </Link>
            );
          })}
          {/* A dark panel with a gold edge, never a solid gold fill: `.snc-gold-border` is a
              border-image of the same metal ramp as the wordmark, so the button is struck from
              the same alloy as the name. */}
          <Link href="/login" className={`${styles.login} snc-gold-border`}>
            Login
          </Link>
        </nav>
      </div>

      {/* The only thing separating the header from the page, and it is not a border: a rule
          brightest at its centre and gone at both ends. There is not one solid gold bar anywhere
          in the references, and `.snc-gold-rule` in the token layer is where that stays true. */}
      <div className="snc-gold-rule" aria-hidden="true" />
    </header>
  );
}
