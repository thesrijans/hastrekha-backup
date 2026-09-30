"use client";

/**
 * What the chamber is doing, written as ink on a small leaf.
 *
 * §6.3: "Gate prompts rendered as ink on a small leaf sliding in from the
 * bottom, never as toasts." A toast is the correct component for this job in
 * every other product and the wrong one here, for a reason worth stating: a
 * toast is a notification, and a notification is something a system sends you
 * about itself. This is a person being told what is happening to their hand.
 *
 * The leaf carries exactly two lines and never more. The litany's other six
 * stages are real and are built — the reveal beat prints them — but a reader
 * mid-scan is holding a pose, and a seven-row checklist in front of them is an
 * installer. One line of ink is what a person reading over your shoulder would
 * say.
 */

import { Fragment, type ReactElement } from "react";
import { Parchment } from "@/components/sanctuary/material";
import { CHAMBER_EMPTY_LINE, type ChamberLitanyLine } from "@/lib/sanctuary/chamber-stages";
import type { DistanceReading } from "@/lib/scan/distance";
import { DistanceGauge } from "./distance-gauge";
import styles from "./scan-litany.module.css";

/** The leaf's one instruction: Devanagari ink, and the English its accessible name carries. */
export interface LitanyHint {
  readonly hi: string;
  readonly en: string;
}

/**
 * The instruction's halves — what is wrong · what to do — each set as one unit, so a line too long for the
 * leaf breaks at the "·" and never strands the remedy's last word on a line of its own. The text is unedited.
 */
function hintParts(text: string): ReactElement[] {
  const parts = text.split(" · ");
  return parts.map((part, i) => (
    <Fragment key={i}>
      {i > 0 ? " " : null}
      <span className={styles.hintPart} data-snc-hint-part="">
        {i < parts.length - 1 ? `${part} ·` : part}
      </span>
    </Fragment>
  ));
}

/** The leaf's own seed. Constant: the chamber has one leaf, and it does not re-tear as the scan runs. */
const LITANY_SEED = 4127;

export interface ScanLitanyProps {
  /** The stage being worked on, from `chamberCurrentLine`. */
  readonly line: ChamberLitanyLine;
  /**
   * The one instruction on the leaf's second line (scan-complete G2.3), or null: the SPECIFIC thing stopping
   * the scan — the top rejection of the last second, in plain words (lib/scan/scan-reason.ts) — or, when
   * nothing is, the distance meter's own words (lib/scan/distance.ts).
   *
   * It is the one piece of copy on this screen that changes because of something the READER can do, so it
   * is set apart from the stage line rather than concatenated with it.
   */
  readonly hint: LitanyHint | null;
  /**
   * G2.1: the distance meter's live reading. Given while a palm is in view, and the ink gauge then heads the
   * instruction's line — inside it, never as a line of its own (the leaf's height is the ring's reserve).
   */
  readonly distance?: { readonly current: DistanceReading | null } | null;
  /**
   * G4: a one-tap action at the head of the instruction's line, in the gauge's place — "रोशनी चालू करें" when the
   * picture is blurred and the back camera has a torch. The line keeps its two rows either way: the leaf's
   * height is the ring's reserve.
   */
  readonly action?: { readonly hi: string; readonly en: string; readonly onPress: () => void } | null;
  /** Hidden once the reveal beat begins: the beat owns the screen from that point. */
  readonly visible: boolean;
}

export function ScanLitany({ line, hint, visible, distance = null, action = null }: ScanLitanyProps): ReactElement {
  const empty = line.status === "empty";

  return (
    <div className={styles.dock} data-snc-litany={visible ? "in" : "out"}>
      <Parchment tone="aged" tear="rough" seed={LITANY_SEED} className={styles.leaf}>
        {/*
          `aria-live="polite"` and not "assertive": the stage line is worth
          announcing when it changes and is never worth interrupting a reader
          mid-sentence for. The English name rides along as the accessible label
          because a screen reader set to English would otherwise spell the
          Devanagari out one letter at a time.
        */}
        <p className={styles.stage} lang="hi" aria-live="polite" aria-label={line.stage.en}>
          {line.stage.hi}
        </p>

        {empty ? (
          <p className={styles.empty} lang="hi">
            {CHAMBER_EMPTY_LINE}
          </p>
        ) : null}

        {/* Polite, like the stage line: the reason is the top of a whole second, so it changes a few times a
            scan, and each change is something the reader can act on. */}
        {hint === null ? null : (
          <p className={styles.hint} lang="hi" aria-live="polite" aria-label={hint.en} data-snc-hint="">
            {action !== null ? (
              <button type="button" className={styles.hintAction} lang="hi" aria-label={action.en} onClick={action.onPress} data-snc-hint-action="">
                {action.hi}
              </button>
            ) : distance === null ? null : (
              <DistanceGauge reading={distance} />
            )}
            <span>{hintParts(hint.hi)}</span>
          </p>
        )}
      </Parchment>
    </div>
  );
}
