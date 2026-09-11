/**
 * C1 — the masthead on a vertical screen: the emblem, the name struck in gold,
 * and the name again in its own script between two dandas, flanked by rules.
 *
 * On a wide landscape screen the room's own overlay carries the name and this is
 * hidden; the page's stylesheet decides which, so the server never has to guess
 * a viewport. The two are never shown together, so there is one page heading at
 * a time.
 */
import type { ReactElement, ReactNode } from "react";
import { BrandEmblem } from "@/components/sanctuary/brand-emblem";
import { GoldRule, GoldText } from "@/components/sanctuary/material";
import { SANCTUARY_WORDMARK_DEVANAGARI, SANCTUARY_WORDMARK_LATIN } from "@/components/sanctuary/sanctuary-header";
import styles from "./home.module.css";

export interface HomeMastheadProps {
  /** The visitor's control at the top right — sign in, or their (not yet built) profile. */
  readonly profile: ReactNode;
  readonly className?: string;
}

export function HomeMasthead({ profile, className }: HomeMastheadProps): ReactElement {
  return (
    <header className={className === undefined ? styles.masthead : `${styles.masthead} ${className}`}>
      <div className={styles.mastheadProfile}>{profile}</div>
      <BrandEmblem size={64} className={styles.mastheadEmblem} />
      <GoldText as="h1" size="display" className={styles.mastheadName}>
        {SANCTUARY_WORDMARK_LATIN}
      </GoldText>
      <div className={styles.mastheadMotto}>
        <GoldRule width="3.25rem" decorative />
        <span className={styles.mastheadNameHi} lang="hi">
          {SANCTUARY_WORDMARK_DEVANAGARI}
        </span>
        <GoldRule width="3.25rem" decorative />
      </div>
    </header>
  );
}
