/**
 * C5 — Explore your path: five engraved panels, one family.
 *
 * Each card is the same frame, the same glyph weight and the same label, so the
 * five read as one set cut from one plate. Each opens its chapter of the Pothi
 * (lib/sanctuary/home-paths.ts) — when there is a reading in this tab. When there
 * is not, the card is QUIET: dimmer, and it opens the chamber instead, because a
 * chapter of a book that has not been written can only be a sealed leaf, and the
 * front door should say "begin here", not "no".
 *
 * BOTH DESTINATIONS ARE IN THE MARKUP, and the inline script after the list —
 * run before the list is painted — marks it `present` or `absent`; the
 * stylesheet shows the matching link. See lib/sanctuary/reading-presence.ts.
 * The list's attribute is the one thing the script changes, which is why it alone
 * carries `suppressHydrationWarning`.
 */
import Link from "next/link";
import type { ReactElement } from "react";
import { GoldText } from "@/components/sanctuary/material";
import { SanctuaryIcon } from "@/components/sanctuary/sanctuary-icons";
import { HOME_PATHS, type HomePath } from "@/lib/sanctuary/home-paths";
import { READING_PRESENCE_ATTRIBUTE, readingPresencePrePaintScript } from "@/lib/sanctuary/reading-presence";
import { CardFrame } from "./card-frame";
import styles from "./home.module.css";

/** The list's id — the pre-paint script and Home's island both find it by this. */
export const PATHS_LIST_ID = "snc-home-paths";

export const PATHS_TITLE = "Explore your path";

function PathFace({ path, seed }: { readonly path: HomePath; readonly seed: number }): ReactElement {
  return (
    <>
      <CardFrame seed={seed} cornerSize={10} />
      <SanctuaryIcon name={path.icon} size={44} className={styles.pathIcon} />
      <span className={styles.pathLabel}>{path.label}</span>
    </>
  );
}

export function PathCards({ className }: { readonly className?: string }): ReactElement {
  const presence = { [READING_PRESENCE_ATTRIBUTE]: "absent" };
  return (
    <section className={className === undefined ? styles.paths : `${styles.paths} ${className}`} aria-label={PATHS_TITLE}>
      <GoldText as="h2" size="subtitle" className={styles.pathsTitle}>
        {PATHS_TITLE}
      </GoldText>
      <ul id={PATHS_LIST_ID} className={styles.pathList} {...presence} suppressHydrationWarning>
        {HOME_PATHS.map((path, at) => (
          <li key={path.id} className={styles.pathItem}>
            <Link
              href={path.chapterHref}
              className={`${styles.pathCard} ${styles.whenPresent}`}
              aria-label={`${path.label} — chapter ${path.numeral}, ${path.labelHi}`}
            >
              <PathFace path={path} seed={140 + at * 7} />
            </Link>
            <Link
              href={path.quietHref}
              className={`${styles.pathCard} ${styles.pathQuiet} ${styles.whenAbsent}`}
              aria-label={`${path.label} — begin with a reading`}
              data-snc-camera="scanner"
            >
              <PathFace path={path} seed={140 + at * 7} />
            </Link>
          </li>
        ))}
      </ul>
      {/* Runs as the HTML is parsed, before the list above is first painted. */}
      <script dangerouslySetInnerHTML={{ __html: readingPresencePrePaintScript(PATHS_LIST_ID) }} />
    </section>
  );
}
