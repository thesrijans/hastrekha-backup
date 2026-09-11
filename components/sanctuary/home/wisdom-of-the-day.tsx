/**
 * C6 — Wisdom of the day, on a leaf.
 *
 * The verse in Tiro (as Sanskrit: `lang="sa"`, never letter-spaced), the English
 * in Cormorant's real italic (the deferred face in lib/sanctuary/fonts.ts, not a
 * slanted upright), the attribution, and the lotus at the right.
 *
 * [A2] ONE VERSE. lib/sanctuary/wisdom.ts holds the seed and the TODO for the
 * reviewed table; nothing here pretends to rotate.
 */
import type { ReactElement } from "react";
import { LotusDecoration, Parchment } from "@/components/sanctuary/material";
import { wisdomOfTheDay } from "@/lib/sanctuary/wisdom";
import styles from "./home.module.css";

export const WISDOM_TITLE = "Wisdom of the day";

export function WisdomOfTheDay({ className }: { readonly className?: string }): ReactElement {
  const verse = wisdomOfTheDay();
  return (
    <section className={className === undefined ? styles.wisdom : `${styles.wisdom} ${className}`} aria-label={WISDOM_TITLE}>
      <Parchment seed={2207} className={styles.wisdomLeaf}>
        <div className={styles.wisdomBody}>
          <div className={styles.wisdomText}>
            <h2 className={styles.wisdomTitle}>{WISDOM_TITLE}</h2>
            <p className={styles.verse} lang="sa">
              {verse.sanskrit[0]}
              <br />
              {verse.sanskrit[1]}
            </p>
            <p className={styles.translation}>{verse.translation}</p>
            <p className={styles.attribution}>— {verse.attribution}</p>
          </div>
          <LotusDecoration size={152} seed={5} opacity={0.95} className={styles.lotus} />
        </div>
      </Parchment>
    </section>
  );
}
