/**
 * Part C's content, below the room — "a dark reading-chamber layout".
 *
 * One reading order for every width: the greeting, the one action, the
 * tradition's palm, the five paths, the verse, the colophon. The stylesheet lays
 * it out: stacked on a phone (a vertical scene — the plate needs the full width
 * for its names to stay legible), greeting beside the plate from 34rem, and the
 * whole block on a darker ground once the room is above it.
 */
import type { ReactElement } from "react";
import { BeginReadingCard } from "./begin-reading-card";
import { HomeColophon } from "./home-colophon";
import { HomeGreeting } from "./home-greeting";
import { PathCards } from "./path-cards";
import { TraditionPalm } from "./tradition-palm";
import { WisdomOfTheDay } from "./wisdom-of-the-day";
import styles from "./home.module.css";

/** The scroll cue and the skip-to-content target. */
export const HOME_CONTENT_ID = "snc-home-content";

export function HomeContent({ name }: { readonly name: string | null }): ReactElement {
  return (
    <div id={HOME_CONTENT_ID} className={styles.chamber}>
      <div className={styles.content}>
        <HomeGreeting name={name} className={styles.areaGreeting} />
        <BeginReadingCard className={styles.areaBegin} />
        <TraditionPalm className={styles.areaPlate} />
        <PathCards className={styles.areaPaths} />
        <WisdomOfTheDay className={styles.areaWisdom} />
        <HomeColophon className={styles.areaColophon} />
      </div>
    </div>
  );
}
