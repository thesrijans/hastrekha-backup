/**
 * The bar at the foot of a phone — A3: Home · Readings · [emblem] · Library · Timeline.
 *
 * A dark brown bar under one fading gold rule, four engraved glyphs with serif
 * labels, and the brand emblem in a medallion at the centre, larger than the
 * rest and floating above the bar's edge — the reference's proportions. The
 * emblem opens the chamber: on a phone, beginning a reading is the one action
 * that is always a thumb away.
 *
 * THE ACTIVE ROOM IS CRIMSON-GOLD: the gold mixed toward the ruby, with a low
 * crimson glow beneath it — the colour the reference's lit "Home" is drawn in,
 * and the only place outside the emblem that the ruby shows.
 *
 * Library and Timeline are not built (U5), so they are `<ComingSoon>` controls: a
 * tap opens "जल्द आ रहा है" over the bar, and there is no link to follow.
 *
 * `env(safe-area-inset-bottom)` pads the bar clear of the home indicator; the
 * shell pads the page by the same amount so nothing sits under it.
 */
import Link from "next/link";
import type { ReactElement } from "react";
import { BrandEmblem } from "@/components/sanctuary/brand-emblem";
import { SanctuaryIcon } from "@/components/sanctuary/sanctuary-icons";
import {
  SANCTUARY_BAR_CENTRE,
  SANCTUARY_BAR_SIDES,
  isActiveDestination,
  type SanctuaryDestination,
  type SanctuaryRouteHref,
} from "@/lib/sanctuary/nav";
import { ComingSoon } from "./coming-soon";
import styles from "./bottom-nav.module.css";

export interface BottomNavProps {
  readonly activeHref: SanctuaryRouteHref | null;
}

function Slot({
  destination,
  activeHref,
}: {
  readonly destination: SanctuaryDestination;
  readonly activeHref: SanctuaryRouteHref | null;
}): ReactElement {
  const face = (
    <>
      <SanctuaryIcon name={destination.icon} size={22} />
      <span className={styles.slotLabel}>{destination.en}</span>
    </>
  );
  if (destination.href === null) {
    return (
      <ComingSoon
        id={`bar-${destination.id}`}
        label={destination.en}
        placement="bar"
        camera={destination.camera}
        className={`${styles.slot} ${styles.slotSoon}`}
      >
        {face}
      </ComingSoon>
    );
  }
  const active = isActiveDestination(destination, activeHref);
  return (
    <Link
      href={destination.href}
      aria-current={active ? "page" : undefined}
      className={active ? `${styles.slot} ${styles.slotActive}` : styles.slot}
      data-snc-camera={destination.camera ?? undefined}
    >
      {face}
    </Link>
  );
}

export function BottomNav({ activeHref }: BottomNavProps): ReactElement {
  const [homeSide, readingSide] = SANCTUARY_BAR_SIDES.left;
  const [librarySide, timelineSide] = SANCTUARY_BAR_SIDES.right;
  return (
    <nav aria-label="Sanctuary rooms" className={styles.bar}>
      <div className={`snc-gold-rule ${styles.rule}`} aria-hidden="true" />
      <Slot destination={homeSide} activeHref={activeHref} />
      <Slot destination={readingSide} activeHref={activeHref} />
      <Link
        href={SANCTUARY_BAR_CENTRE.href ?? "/"}
        className={`snc-medallion ${styles.centre}`}
        aria-label="Scan — begin your reading"
        data-snc-camera={SANCTUARY_BAR_CENTRE.camera ?? undefined}
      >
        <BrandEmblem size={40} />
      </Link>
      <Slot destination={librarySide} activeHref={activeHref} />
      <Slot destination={timelineSide} activeHref={activeHref} />
    </nav>
  );
}
