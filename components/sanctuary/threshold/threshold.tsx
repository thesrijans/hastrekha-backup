/**
 * PART D — the Threshold, in its CSS form.
 *
 * §6.1's score, played by the stylesheet: black; a gold point breathing; the
 * point resolving into a distant doorway with dust drifting through it; the name,
 * then the name in its own script; the two lines; a lit path of gold dust toward
 * the door; and the button, which waits. Every beat's start time is written onto
 * its element from `THRESHOLD_BEATS`, so the timings live in one table that the
 * stylesheet, this file and the test all read.
 *
 * NO WEBGL, NO TIMER. The sequence is keyframes with delays. On click, the push
 * through the doorway is a CSS scale and a bloom crossfade — the fallback-tier
 * push. [R8] allows the HIGH tier to push through a real doorway in the 3D room;
 * that is U3b, and it will replace only the push, never the score.
 *
 * FIRST VISIT ONLY, AND NEVER FOR SOMEONE WHO ASKED FOR STILLNESS. The inline
 * script right after the stage runs before the stage is painted and hides it for
 * a returning visitor or under `prefers-reduced-motion`; the island (see
 * threshold-stage.tsx) keeps that answer and owns Enter and Skip.
 */
import type { CSSProperties, ReactElement } from "react";
import { BrandEmblem } from "@/components/sanctuary/brand-emblem";
import { SanctuaryIcon } from "@/components/sanctuary/sanctuary-icons";
import { SANCTUARY_WORDMARK_LATIN } from "@/components/sanctuary/sanctuary-header";
import {
  THRESHOLD_ENTER_LABEL,
  THRESHOLD_MOTTO,
  THRESHOLD_STORY,
  thresholdBeatAt,
  thresholdPrePaintScript,
  type ThresholdBeatId,
} from "@/lib/sanctuary/threshold";
import { ThresholdStage } from "./threshold-stage";
import styles from "./threshold.module.css";

/** The stage's id — the pre-paint script finds it by this. */
export const THRESHOLD_ELEMENT_ID = "snc-threshold";

/** The name in its own script, without the dandas: on the Threshold it stands alone. */
const THRESHOLD_DEVANAGARI = "हस्तरेखा";

/** A beat's start time, as the custom property the stylesheet delays its animation by. */
function at(beat: ThresholdBeatId): CSSProperties {
  return { "--snc-at": `${thresholdBeatAt(beat)}ms` } as CSSProperties;
}

/** Dust drifting through the doorway: offsets and durations, fixed so every visit is the same visit. */
const DOOR_MOTES: readonly { readonly x: number; readonly delay: number; readonly dur: number }[] = [
  { x: 22, delay: 0, dur: 5200 },
  { x: 38, delay: 900, dur: 6100 },
  { x: 55, delay: 300, dur: 4700 },
  { x: 67, delay: 1500, dur: 5600 },
  { x: 81, delay: 600, dur: 6600 },
  { x: 47, delay: 2100, dur: 5000 },
];

export function Threshold(): ReactElement {
  return (
    <>
      <ThresholdStage id={THRESHOLD_ELEMENT_ID} className={styles.threshold}>
        <div className={styles.bloom} aria-hidden="true" />

        <div className={styles.point} style={at("point")} aria-hidden="true" />

        <div className={`${styles.door} ${styles.beat}`} style={at("doorway")} aria-hidden="true">
          <div className={styles.doorLight} />
          <div className={styles.doorMotes}>
            {DOOR_MOTES.map((mote) => (
              <span
                key={mote.x}
                className={styles.doorMote}
                style={
                  {
                    left: `${mote.x}%`,
                    "--snc-mote-delay": `${thresholdBeatAt("doorway") + mote.delay}ms`,
                    "--snc-mote-dur": `${mote.dur}ms`,
                  } as CSSProperties
                }
              />
            ))}
          </div>
          <svg viewBox="0 0 100 180" className={styles.doorFrame} focusable="false">
            <path d="M6,178 V58 A44,44 0 0,1 94,58 V178" />
            <path d="M14,178 V60 A36,36 0 0,1 86,60 V178" className={styles.doorInner} />
          </svg>
        </div>

        <div className={styles.titles}>
          <div className={`${styles.emblem} ${styles.beat}`} style={at("wordmark")} aria-hidden="true">
            <BrandEmblem size={64} />
          </div>
          <p className={`${styles.thresholdName} snc-gold-text ${styles.beat}`} style={at("wordmark")}>
            {SANCTUARY_WORDMARK_LATIN}
          </p>
          <p className={`${styles.thresholdNameHi} ${styles.beat}`} style={at("devanagari")} lang="hi">
            {THRESHOLD_DEVANAGARI}
          </p>
          <p className={`${styles.motto} ${styles.beat}`} style={at("motto")}>
            {THRESHOLD_MOTTO}
          </p>
          <p className={`${styles.story} ${styles.beat}`} style={at("story")}>
            {THRESHOLD_STORY}
          </p>
        </div>

        <div className={`${styles.path} ${styles.beat}`} style={at("path")} aria-hidden="true" />

        <button
          type="button"
          className={`${styles.enter} snc-gold-border ${styles.beat}`}
          style={at("enter")}
          data-snc-threshold-action="enter"
        >
          <span className={styles.enterLabel}>{THRESHOLD_ENTER_LABEL}</span>
          <span className={`snc-medallion ${styles.enterArrow}`} aria-hidden="true">
            <SanctuaryIcon name="arrow" size={18} />
          </span>
        </button>

        <button type="button" className={styles.skip} data-snc-threshold-action="skip">
          Skip
        </button>
      </ThresholdStage>
      {/* Runs as the HTML is parsed, before the stage above is first painted. */}
      <script dangerouslySetInnerHTML={{ __html: thresholdPrePaintScript(THRESHOLD_ELEMENT_ID) }} />
    </>
  );
}
