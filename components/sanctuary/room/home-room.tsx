/**
 * The room on Home — B7's plate with B5's words over it.
 *
 * B5: the name, the name in its own script, "From the Vedas. Through time. For
 * you.", "Your palm holds a story.", and the two actions — BEGIN YOUR READING,
 * and EXPLORE THE LIBRARY, which is not built (U5) and so is a `<ComingSoon>`
 * control. HTML, not drawn text, in the upper centre, clear of the hologram and
 * the window. Two object labels on gold leaders name the rooms the reader can go
 * to: the pedestal (the chamber) and the book (their reading). Every one of those
 * carries `data-snc-camera`, so the camera moves to the object before the route
 * opens.
 *
 * The scroll cue at the foot leads to Part C.
 */
import Link from "next/link";
import type { CSSProperties, ReactElement, ReactNode } from "react";
import { SanctuaryIcon } from "@/components/sanctuary/sanctuary-icons";
import { SANCTUARY_WORDMARK_DEVANAGARI, SANCTUARY_WORDMARK_LATIN } from "@/components/sanctuary/sanctuary-header";
import { ComingSoon } from "@/components/sanctuary/shell/coming-soon";
import { roomPercent } from "@/lib/sanctuary/room-composition";
import { SANCTUARY_CHAMBER_HREF, SANCTUARY_POTHI_HREF } from "@/lib/sanctuary/routes";
import { HOME_CONTENT_ID } from "@/components/sanctuary/home/home-content";
import { ROOM_LABEL_POINTS } from "./room-props";
import { Room3D } from "./three/room-3d";
import { RoomStage } from "./room-stage";
import styles from "./room-stage.module.css";

export const ROOM_MOTTO = "From the Vedas. Through time. For you.";
export const ROOM_STORY = "Your palm holds a story.";

function labelStyle(point: { readonly x: number; readonly y: number; readonly side: "left" | "right" }): CSSProperties {
  const { left, top } = roomPercent(point);
  return point.side === "right" ? { left, top } : { right: `calc(100% - ${left})`, top };
}

export interface HomeRoomProps {
  readonly id: string;
  readonly className?: string;
  readonly profile: ReactNode;
}

export function HomeRoom({ id, className, profile }: HomeRoomProps): ReactElement {
  const overlay = (
    <div className={styles.overlay} data-snc-room-overlay="">
      <h1 className={`${styles.overlayWordmark} snc-gold-text`}>{SANCTUARY_WORDMARK_LATIN}</h1>
      <p className={styles.overlayHi} lang="hi">
        {SANCTUARY_WORDMARK_DEVANAGARI}
      </p>
      <p className={styles.overlayMotto}>{ROOM_MOTTO}</p>
      <p className={styles.overlayStory}>{ROOM_STORY}</p>
      <div className={styles.overlayActions}>
        <Link href={SANCTUARY_CHAMBER_HREF} className={`${styles.primary} snc-gold-border`} data-snc-camera="scanner">
          <span>Begin your reading</span>
          <span className={`snc-medallion ${styles.primaryArrow}`} aria-hidden="true">
            <SanctuaryIcon name="arrow" size={16} />
          </span>
        </Link>
        <ComingSoon id="room-library" label="The Library" placement="inline" camera="library" className={styles.secondary}>
          <SanctuaryIcon name="scroll" size={16} />
          <span>Explore the library</span>
        </ComingSoon>
      </div>
    </div>
  );

  const labels = (
    <>
      <Link
        href={SANCTUARY_CHAMBER_HREF}
        className={styles.objectLabel}
        style={labelStyle(ROOM_LABEL_POINTS.scanner)}
        data-snc-camera="scanner"
      >
        <span className={styles.objectLabelHi} lang="hi">
          हस्त
        </span>
        <span className={styles.objectLabelEn}>The Scanner</span>
      </Link>
      <Link
        href={SANCTUARY_POTHI_HREF}
        className={`${styles.objectLabel} ${styles.objectLabelEnd}`}
        style={labelStyle(ROOM_LABEL_POINTS.book)}
        data-snc-camera="book"
      >
        <span className={styles.objectLabelHi} lang="hi">
          पोथी
        </span>
        <span className={styles.objectLabelEn}>Your Reading</span>
      </Link>
    </>
  );

  const chrome = (
    <>
      <div className={styles.corner}>{profile}</div>
      <a href={`#${HOME_CONTENT_ID}`} className={styles.scrollCue}>
        <span>Scroll</span>
        <SanctuaryIcon name="chevron-down" size={18} className={styles.scrollChevron} />
      </a>
    </>
  );

  return (
    <RoomStage
      id={id}
      variant="room"
      className={className}
      overlay={overlay}
      labels={labels}
      chrome={chrome}
      scene={<Room3D roomId={id} />}
    />
  );
}
