/**
 * The rail — A4, carved into the dark stone at the left of a wide screen.
 *
 * Eight rooms in the brief's order, each an engraved glyph in a dark medallion
 * with its Devanagari name over its Latin one. Three exist (गृह, हस्त, पत्र) and
 * are links; five do not yet and are `<ComingSoon>` controls — dim, focusable,
 * and saying "जल्द आ रहा है" on hover, focus or tap. Never a dead link.
 *
 * TWO WIDTHS. From 48rem the rail is a column of glyphs, and a room's names
 * appear beside it on hover and focus; from 80rem there is room for the names to
 * stand in the rail itself. The width is one custom property the shell owns
 * (`--snc-rail-width`), so the content beside the rail moves over by exactly the
 * rail and never by a second, hand-copied number.
 *
 * THE ACTIVE ROOM IS LIT FROM BEHIND. The same lamp-behind-the-stone the
 * sanctuary header already uses for its current page: a warm inset glow rising
 * from below, never a filled pill.
 *
 * A server component: the active room arrives as a prop from a route that knows
 * where it is, exactly as the header's does.
 */
import Link from "next/link";
import type { ReactElement } from "react";
import { BrandEmblem } from "@/components/sanctuary/brand-emblem";
import { SanctuaryIcon } from "@/components/sanctuary/sanctuary-icons";
import { SANCTUARY_RAIL, isActiveDestination, type SanctuaryDestination, type SanctuaryRouteHref } from "@/lib/sanctuary/nav";
import { SANCTUARY_COMING_SOON_HI, SANCTUARY_HOME_HREF } from "@/lib/sanctuary/routes";
import { ComingSoon } from "./coming-soon";
import styles from "./nav-rail.module.css";

export interface NavRailProps {
  readonly activeHref: SanctuaryRouteHref | null;
}

/** The glyph and the two names — the face every rail item wears, built or not. */
function RailFace({ destination, soon }: { readonly destination: SanctuaryDestination; readonly soon: boolean }): ReactElement {
  return (
    <>
      <span className={`snc-medallion ${styles.medallion}`}>
        <SanctuaryIcon name={destination.icon} size={20} />
      </span>
      <span className={styles.labels}>
        <span className={styles.hi} lang="hi">
          {destination.hi}
        </span>
        <span className={styles.en}>{destination.en}</span>
        {soon ? (
          <span className={styles.soonHint} lang="hi">
            {SANCTUARY_COMING_SOON_HI}
          </span>
        ) : null}
      </span>
    </>
  );
}

export function NavRail({ activeHref }: NavRailProps): ReactElement {
  return (
    <nav aria-label="Sanctuary rooms" className={styles.rail}>
      <Link href={SANCTUARY_HOME_HREF} className={styles.brand} aria-label="HastRekha — the Sanctuary">
        <BrandEmblem size={40} />
      </Link>
      <ul className={styles.list}>
        {SANCTUARY_RAIL.map((destination) => {
          if (destination.href === null) {
            return (
              <li key={destination.id} className={styles.row}>
                <ComingSoon
                  id={`rail-${destination.id}`}
                  label={destination.en}
                  placement="rail"
                  camera={destination.camera}
                  className={`${styles.item} ${styles.itemSoon}`}
                >
                  <RailFace destination={destination} soon />
                </ComingSoon>
              </li>
            );
          }
          const active = isActiveDestination(destination, activeHref);
          return (
            <li key={destination.id} className={styles.row}>
              <Link
                href={destination.href}
                aria-current={active ? "page" : undefined}
                className={active ? `${styles.item} ${styles.itemActive}` : styles.item}
                data-snc-camera={destination.camera ?? undefined}
              >
                <RailFace destination={destination} soon={false} />
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
