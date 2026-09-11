/**
 * The visitor's control — the reference's profile medallion, top right.
 *
 * Signed out, it is a link to sign in, which is a real page. Signed in, it would
 * be the profile — and Profile is on the brief's do-not-build list (U4–U5) — so it
 * is a `<ComingSoon>` control rather than a link into a page that does not exist.
 */
import Link from "next/link";
import type { ReactElement } from "react";
import { SanctuaryIcon } from "@/components/sanctuary/sanctuary-icons";
import { ComingSoon } from "@/components/sanctuary/shell/coming-soon";
import { SANCTUARY_LOGIN_HREF } from "@/lib/sanctuary/routes";
import styles from "./home.module.css";

export interface ProfileControlProps {
  readonly signedIn: boolean;
  /** Unique on the page — Home draws this control twice, once per layout. */
  readonly id: string;
}

export function ProfileControl({ signedIn, id }: ProfileControlProps): ReactElement {
  const face = (
    <span className={`snc-medallion ${styles.profileMedallion}`}>
      <SanctuaryIcon name="profile" size={22} />
    </span>
  );
  if (signedIn) {
    return (
      <ComingSoon id={id} label="Profile" placement="inline" className={styles.profile}>
        {face}
      </ComingSoon>
    );
  }
  return (
    <Link href={SANCTUARY_LOGIN_HREF} className={styles.profile} aria-label="Sign in">
      {face}
    </Link>
  );
}
