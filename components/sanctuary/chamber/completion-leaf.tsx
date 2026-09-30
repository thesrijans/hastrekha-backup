"use client";

/**
 * "पहचान पूरी" — the chamber's last leaf before the reading (scan-complete G4).
 *
 * Detection is complete: each of the four major lines is confirmed or marked "इस हाथ पर स्पष्ट नहीं". The
 * camera has frozen on the sharpest recent frame, and this leaf shows the two snaps made from it, side by
 * side — "आपकी हथेली", the plain palm, with the raw frame it came from in its corner, and "आपकी रेखाएँ", the
 * same crop with the held lines in gold — then the one opt-in, and the two ways on: again, or the reading.
 *
 * THE OPT-IN IS OFF, and says what it does before it is touched: the pair stays on this device either way;
 * on, it is kept as a growth session for the lines to be corrected by hand later; off again, it is deleted.
 * Nothing on this leaf uploads anything.
 *
 * Ink on a torn leaf like every other leaf in the chamber: the buttons are struck rules under words, never
 * filled pills (chamber.module.css .gateButton, the one control's precedent).
 */
import type { ReactElement } from "react";
import { Parchment } from "@/components/sanctuary/material";
import styles from "./completion-leaf.module.css";

/** The leaf's words, exactly as the spec prints them. */
export const COMPLETION_WORDS = {
  title: "पहचान पूरी",
  titleEn: "Detection complete",
  palm: "आपकी हथेली",
  lines: "आपकी रेखाएँ",
  growth: "मेरी हथेली से HastRekha को बेहतर बनाने में मदद करें",
  retake: "दोबारा स्कैन",
  open: "पाठ खोलें",
  openEn: "Open reading",
} as const;

/** The note under the opt-in: what happens to the pair, before and after it is switched on. */
export const GROWTH_NOTE = {
  off: "तस्वीरें केवल इस डिवाइस पर · कभी अपलोड नहीं",
  on: "सहेजा गया · केवल इस डिवाइस पर · बंद करते ही हट जाएगा",
} as const;

/** The leaf's own seed: one leaf, torn once. */
const COMPLETION_SEED = 5381;

export interface CompletionLeafProps {
  /** The plain palm: the frozen frame's rectified crop (an object URL). */
  readonly palmSrc: string;
  /** The raw frame it was rectified from, shown small in the palm snap's corner; null if it could not be kept. */
  readonly rawSrc: string | null;
  /** The crop with the held lines drawn in gold. */
  readonly linesSrc: string;
  /** The opt-in growth save. */
  readonly growth: boolean;
  /** True while the growth save or its deletion is in flight. */
  readonly growthBusy: boolean;
  /** False where the device cannot keep it (no IndexedDB): the opt-in is not offered at all. */
  readonly growthAvailable: boolean;
  readonly onGrowthChange: (on: boolean) => void;
  readonly onRetake: () => void;
  readonly onOpenReading: () => void;
  /** True once the reading has been asked for: both ways on then wait. */
  readonly opening: boolean;
}

export function CompletionLeaf({
  palmSrc,
  rawSrc,
  linesSrc,
  growth,
  growthBusy,
  growthAvailable,
  onGrowthChange,
  onRetake,
  onOpenReading,
  opening,
}: CompletionLeafProps): ReactElement {
  return (
    <div className={styles.dock} data-snc-completion="">
      <Parchment tone="aged" tear="rough" seed={COMPLETION_SEED} className={styles.leaf}>
        <p className={styles.title} lang="hi" aria-live="polite">
          {COMPLETION_WORDS.title} <span className={styles.titleEn} lang="en">· {COMPLETION_WORDS.titleEn}</span>
        </p>

        <div className={styles.snaps}>
          <figure className={styles.snap} data-snc-snap="palm">
            <span className={styles.frame}>
              {/* eslint-disable-next-line @next/next/no-img-element -- an object URL of a local canvas, never a remote image */}
              <img src={palmSrc} alt="Your palm, rectified" className={styles.picture} />
              {rawSrc === null ? null : (
                /* eslint-disable-next-line @next/next/no-img-element -- the raw frame, an object URL */
                <img src={rawSrc} alt="The frame it was taken from" className={styles.raw} data-snc-snap-raw="" />
              )}
            </span>
            <figcaption className={styles.caption} lang="hi">
              {COMPLETION_WORDS.palm}
            </figcaption>
          </figure>
          <figure className={styles.snap} data-snc-snap="lines">
            <span className={styles.frame}>
              {/* eslint-disable-next-line @next/next/no-img-element -- an object URL of a local canvas */}
              <img src={linesSrc} alt="Your palm with the lines found, in gold" className={styles.picture} />
            </span>
            <figcaption className={styles.caption} lang="hi">
              {COMPLETION_WORDS.lines}
            </figcaption>
          </figure>
        </div>

        {growthAvailable ? (
          <>
            <label className={styles.growth}>
              <input
                type="checkbox"
                className={styles.check}
                checked={growth}
                disabled={growthBusy || opening}
                onChange={(event) => onGrowthChange(event.currentTarget.checked)}
                data-snc-growth=""
              />
              <span lang="hi">{COMPLETION_WORDS.growth}</span>
            </label>
            <p className={styles.note} lang="hi" data-snc-growth-note="">
              {growth ? GROWTH_NOTE.on : GROWTH_NOTE.off}
            </p>
          </>
        ) : null}

        <div className={styles.actions}>
          <button type="button" className={styles.action} lang="hi" onClick={onRetake} disabled={opening} data-snc-action="retake">
            {COMPLETION_WORDS.retake}
          </button>
          <button type="button" className={`${styles.action} ${styles.primary}`} onClick={onOpenReading} disabled={opening} data-snc-action="open">
            <span lang="hi">{COMPLETION_WORDS.open}</span> · <span lang="en">{COMPLETION_WORDS.openEn}</span>
          </button>
        </div>
      </Parchment>
    </div>
  );
}
