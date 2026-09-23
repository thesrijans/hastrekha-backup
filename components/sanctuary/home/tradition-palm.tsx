/**
 * C3 — the tradition's palm: the real hand, engraved with the tradition's lines,
 * captioned as a diagram.
 *
 * [A2] THIS MUST NEVER BE MISTAKEN FOR THE READER'S PALM, and three things make
 * sure it is not:
 *
 *  1. It is a whole hand — the P1 mesh baked into the diagram's own box
 *     (public/plates/hand-tradition, lib/sanctuary/tradition-hand.ts) — not the
 *     scan-registered plate the Pothi draws a real reader's lines on.
 *  2. Its lines are THINNER AND COOLER than a traced result. A reading's lines
 *     are the active rung of the stroke ladder in warm gold; these are sub-pixel
 *     hairlines — engraved dark into the gold where they cross the hand, and a
 *     gold pulled toward the moon's blue-grey on the leaders outside it — so
 *     beside a real result they read as a print, not as a finding.
 *  3. It says what it is: "पारंपरिक चित्र" under it, with the Latin beside it.
 *
 * THE NINE NAMES are the brief's, verbatim, on thin leaders with a dot where
 * each leaves its line. The life and head lines are drawn unlabelled — see the
 * note on `TraditionLine.labelHi`.
 *
 * THE HAND'S BOX IS TALLER THAN THE DRAWING'S. The mesh's fingers are longer,
 * against its palm, than the outline the lines were drawn on, so the plate is
 * baked into TRADITION_HAND_PLATE_BOX, which reaches above the drawing's
 * 216 × 290 box; `.drawing` is laid inside it at exactly the drawing's box, so
 * the lines and the labels keep the coordinates they were authored in.
 *
 * "IN SMALL CAPS" is honoured in the Latin half only. Devanagari has no case and
 * must never be letter-spaced, so पारंपरिक चित्र is set plainly in Tiro and the
 * small-capital treatment goes to "Traditional diagram" beside it.
 *
 * The labels are HTML over the SVG, not SVG text, so they stay the same size on a
 * phone and a desktop while the drawing scales between them.
 *
 * A server component: a picture, a drawing and nine words.
 */
import type { CSSProperties, ReactElement } from "react";
import { HandPlate } from "@/components/sanctuary/hand-plate";
import { CelestialRing } from "@/components/sanctuary/material";
import {
  TRADITION_HAND_PLATE_BOX,
  TRADITION_HAND_VIEWBOX,
  TRADITION_LEADER_X,
  TRADITION_LINES,
  type TraditionLine,
} from "@/lib/sanctuary/tradition-hand";
import styles from "./tradition-palm.module.css";

export const TRADITION_CAPTION_HI = "पारंपरिक चित्र";
export const TRADITION_CAPTION_EN = "Traditional diagram";

const { width: W, height: H } = TRADITION_HAND_VIEWBOX;
const BOX = TRADITION_HAND_PLATE_BOX;

const pct = (fraction: number): string => `${(fraction * 100).toFixed(3)}%`;

/** The plate's box, as the hand box's own aspect. */
const PLATE_STYLE: CSSProperties = { aspectRatio: `${BOX.width} / ${BOX.height}` };

/** Where the drawing's 216 × 290 box sits inside the plate's box. */
const DRAWING_STYLE: CSSProperties = {
  left: pct(-BOX.x / BOX.width),
  top: pct(-BOX.y / BOX.height),
  width: pct(W / BOX.width),
  height: pct(H / BOX.height),
};

/** A labelled line: its anchor and label are both present. */
type LabelledLine = TraditionLine & {
  readonly labelHi: string;
  readonly anchor: { readonly x: number; readonly y: number };
  readonly label: { readonly side: "left" | "right" | "bottom"; readonly y: number };
};

const LABELLED: readonly LabelledLine[] = TRADITION_LINES.filter(
  (line): line is LabelledLine => line.labelHi !== null && line.anchor !== null && line.label !== null,
);

/** The leader: out from the line, a knee, then level to the edge of the drawing. */
function leaderPath(line: LabelledLine): string {
  const { x, y } = line.anchor;
  if (line.label.side === "bottom") return `M${x},${y} L${x},${line.label.y - 9}`;
  const edge = line.label.side === "left" ? TRADITION_LEADER_X.left : TRADITION_LEADER_X.right;
  const knee = line.label.side === "left" ? edge + 12 : edge - 12;
  return `M${x},${y} L${knee},${line.label.y} L${edge},${line.label.y}`;
}

/** Where the label's HTML sits, as percentages of the drawing's box. */
function labelPosition(line: LabelledLine): CSSProperties {
  const top = `${((line.label.y / H) * 100).toFixed(2)}%`;
  if (line.label.side === "bottom") return { left: `${((line.anchor.x / W) * 100).toFixed(2)}%`, top };
  if (line.label.side === "left") return { right: `${(100 - (TRADITION_LEADER_X.left / W) * 100).toFixed(2)}%`, top };
  return { left: `${((TRADITION_LEADER_X.right / W) * 100).toFixed(2)}%`, top };
}

const SIDE_CLASS = { left: styles.labelLeft, right: styles.labelRight, bottom: styles.labelBottom } as const;

export interface TraditionPalmProps {
  readonly className?: string;
}

export function TraditionPalm({ className }: TraditionPalmProps): ReactElement {
  return (
    <figure className={className === undefined ? styles.plate : `${styles.plate} ${className}`}>
      <div className={styles.stage}>
        <div className={styles.handBox} style={PLATE_STYLE}>
          <HandPlate kind="tradition" className={styles.handImage} />
          <div className={styles.drawing} style={DRAWING_STYLE}>
            {/* The wheel behind the hand — the same ring the brand uses, faint, so the diagram sits
                inside the tradition's own cosmology rather than on a blank page. */}
            <CelestialRing size={360} seed={9} capabilityTier="HIGH" className={styles.ring} />
            <svg viewBox={`0 0 ${W} ${H}`} className={styles.hand} aria-hidden="true" focusable="false">
              {TRADITION_LINES.map((line) => (
                <path key={line.id} d={line.d} className={styles.line} data-snc-tradition-line={line.id} />
              ))}
              {LABELLED.map((line) => (
                <g key={line.id} className={styles.leaderGroup}>
                  <path d={leaderPath(line)} className={styles.leader} />
                  <circle cx={line.anchor.x} cy={line.anchor.y} r={1.5} className={styles.anchorDot} />
                </g>
              ))}
            </svg>
            {LABELLED.map((line) => (
              <span
                key={line.id}
                className={`${styles.lineName} ${SIDE_CLASS[line.label.side]}`}
                style={labelPosition(line)}
                lang="hi"
              >
                {line.labelHi}
              </span>
            ))}
          </div>
        </div>
      </div>
      <figcaption className={styles.caption}>
        <span className={styles.captionHi} lang="hi">
          {TRADITION_CAPTION_HI}
        </span>
        <span className={styles.captionEn}>{TRADITION_CAPTION_EN}</span>
      </figcaption>
    </figure>
  );
}
