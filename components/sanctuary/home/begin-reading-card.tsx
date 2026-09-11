/**
 * C4 — Begin your reading.
 *
 * A double gold frame on a dark ground, the palm seal at the left, the circular
 * gold arrow at the right — the one major action on Home, drawn the way the
 * brief draws a major action: never a saturated pill.
 *
 * Hover, all at the card band (400–600 ms): the frame brightens, the seal lifts
 * to 1.02, the arrow turns 6°, and a few motes of gold rise from beside it. The
 * motes exist only while hovered and not at all under reduced motion.
 *
 * It goes to the chamber. `data-snc-camera="scanner"` lets Home push the room's
 * camera onto the pedestal first, when the room is on screen.
 */
import Link from "next/link";
import type { CSSProperties, ReactElement } from "react";
import { WaxSeal } from "@/components/sanctuary/material";
import { SanctuaryIcon } from "@/components/sanctuary/sanctuary-icons";
import { SANCTUARY_CHAMBER_HREF } from "@/lib/sanctuary/routes";
import { CardFrame } from "./card-frame";
import styles from "./home.module.css";

export const BEGIN_TITLE = "Begin your reading";
export const BEGIN_BODY = "Reveal your palm and unlock your insights.";

const MOTES = [0, 1, 2, 3, 4] as const;

export function BeginReadingCard({ className }: { readonly className?: string }): ReactElement {
  return (
    <Link
      href={SANCTUARY_CHAMBER_HREF}
      className={className === undefined ? styles.begin : `${styles.begin} ${className}`}
      data-snc-camera="scanner"
    >
      <CardFrame seed={61} />
      <span className={styles.beginSeal}>
        <WaxSeal size={84} emblem="palm" seed={1203} />
      </span>
      <span className={styles.beginText}>
        <span className={styles.beginTitle}>{BEGIN_TITLE}</span>
        <span className={styles.beginBody}>{BEGIN_BODY}</span>
      </span>
      <span className={`snc-medallion ${styles.beginArrow}`} aria-hidden="true">
        <SanctuaryIcon name="arrow" size={22} />
      </span>
      <span className={styles.motes} aria-hidden="true">
        {MOTES.map((mote) => (
          <span key={mote} className={styles.mote} style={{ "--snc-mote": mote } as CSSProperties} />
        ))}
      </span>
    </Link>
  );
}
