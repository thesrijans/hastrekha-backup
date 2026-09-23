/**
 * Part C's content, below the room — "a dark reading-chamber layout".
 *
 * One reading order for every width: the greeting, the one action, the
 * tradition's palm, the five paths, the verse, the colophon. The stylesheet lays
 * it out: on a phone the greeting beside the vignette (`hero` — the pedestal
 * and the hologram, as the target frames its hand beside the words; M1.1) and
 * the rest stacked, the plate at full width so its names stay legible; the
 * vignette a band across the top and the greeting beside the plate from 34rem;
 * and the whole block on a darker ground, with no vignette, once the room is
 * above it.
 */
import type { ReactElement, ReactNode } from "react";
import { BeginReadingCard } from "./begin-reading-card";
import { HomeColophon } from "./home-colophon";
import { HomeGreeting } from "./home-greeting";
import { PathCards } from "./path-cards";
import { TraditionPalm } from "./tradition-palm";
import { WisdomOfTheDay } from "./wisdom-of-the-day";
import styles from "./home.module.css";

/** The scroll cue and the skip-to-content target. */
export const HOME_CONTENT_ID = "snc-home-content";

export interface HomeContentProps {
  readonly name: string | null;
  /** The vertical scene's vignette, laid beside the greeting on a phone and hidden under the room. */
  readonly hero?: ReactNode;
}

export function HomeContent({ name, hero }: HomeContentProps): ReactElement {
  return (
    <div id={HOME_CONTENT_ID} className={styles.chamber}>
      <div className={styles.content}>
        <HomeGreeting name={name} className={styles.areaGreeting} />
        {hero === undefined ? null : <div className={`${styles.areaHero} ${styles.portraitOnly}`}>{hero}</div>}
        <BeginReadingCard className={styles.areaBegin} />
        <TraditionPalm className={styles.areaPlate} />
        <PathCards className={styles.areaPaths} />
        <WisdomOfTheDay className={styles.areaWisdom} />
        <HomeColophon className={styles.areaColophon} />
      </div>
    </div>
  );
}
