/**
 * The colophon — where a manuscript names its terms, and where the brief puts
 * the disclaimer: "elegant, in About/methodology/settings". About and settings
 * are not built, so the trust line lives here, at the foot of Home, in the same
 * voice as everything above it.
 *
 * "Replay the entrance" is here for the same reason: §6.1 puts it in settings,
 * which is U5. It is a full page load, not a client transition, so the Threshold
 * decides afresh exactly as it does on any visit.
 */
import Link from "next/link";
import type { ReactElement } from "react";
import { OrnamentalDivider } from "@/components/sanctuary/material";
import { SANCTUARY_HOME_HREF, SANCTUARY_PRIVACY_HREF, SANCTUARY_TERMS_HREF } from "@/lib/sanctuary/routes";
import { THRESHOLD_REPLAY_PARAM, THRESHOLD_REPLAY_VALUE } from "@/lib/sanctuary/threshold";
import styles from "./home.module.css";

export const HOME_DISCLAIMER =
  "Traditional palmistry associates the lines of the hand with character and with the course of a life. HastRekha offers those associations for reflection — never as prediction, diagnosis or advice.";

const REPLAY_HREF = `${SANCTUARY_HOME_HREF}?${THRESHOLD_REPLAY_PARAM}=${THRESHOLD_REPLAY_VALUE}`;

export function HomeColophon({ className }: { readonly className?: string }): ReactElement {
  return (
    <footer className={className === undefined ? styles.colophon : `${styles.colophon} ${className}`}>
      <OrnamentalDivider width={260} seed={83} />
      <p className={styles.disclaimer}>{HOME_DISCLAIMER}</p>
      <nav aria-label="About HastRekha" className={styles.colophonLinks}>
        <Link href={SANCTUARY_PRIVACY_HREF}>Privacy</Link>
        <span aria-hidden="true">·</span>
        <Link href={SANCTUARY_TERMS_HREF}>Terms</Link>
        <span aria-hidden="true">·</span>
        {/* A document load, not a client transition: the entrance must decide afresh. */}
        <a href={REPLAY_HREF}>Replay the entrance</a>
      </nav>
    </footer>
  );
}
