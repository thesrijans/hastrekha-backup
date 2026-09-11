/**
 * The brief's card anatomy, outermost first: outer frame → inner frame →
 * texture → content → ornament.
 *
 *  · the outer frame is the token layer's `.snc-gold-border` — the metal ramp as
 *    a border-image, so the edge varies along its length like struck metal;
 *  · the inner frame is a hairline of old gold set a few pixels inside it;
 *  · the texture is the stone itself, seen through the card's dark panel — the
 *    ground's scratches already carry the grain, so no second noise is laid on;
 *  · the content is the card's own;
 *  · the ornament is `<AncientCorner>` in all four corners.
 *
 * Decorative and absolutely positioned: the card that holds it sets
 * `position: relative` and draws its content above.
 */
import type { ReactElement } from "react";
import { AncientCorner, ORNAMENT_CORNERS } from "@/components/sanctuary/material";
import styles from "./home.module.css";

const CORNER_CLASS = {
  tl: styles.cornerTl,
  tr: styles.cornerTr,
  bl: styles.cornerBl,
  br: styles.cornerBr,
} as const;

export function CardFrame({ seed, cornerSize = 18 }: { readonly seed: number; readonly cornerSize?: number }): ReactElement {
  return (
    <span className={styles.frame} aria-hidden="true">
      <span className={`${styles.frameOuter} snc-gold-border`} />
      <span className={styles.frameInner} />
      {ORNAMENT_CORNERS.map((corner, at) => (
        <AncientCorner key={corner} corner={corner} size={cornerSize} seed={seed + at} className={CORNER_CLASS[corner]} />
      ))}
    </span>
  );
}
