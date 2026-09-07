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

import type { ReactElement } from "react";
import { Parchment } from "@/components/sanctuary/material";
import { CHAMBER_EMPTY_LINE, type ChamberLitanyLine } from "@/lib/sanctuary/chamber-stages";
import styles from "./scan-litany.module.css";

/** The leaf's own seed. Constant: the chamber has one leaf, and it does not re-tear as the scan runs. */
const LITANY_SEED = 4127;

export interface ScanLitanyProps {
  /** The stage being worked on, from `chamberCurrentLine`. */
  readonly line: ChamberLitanyLine;
  /**
   * The pose hint the quality gate is currently giving, or null.
   *
   * The gate's own words, unedited. It is the one piece of copy on this screen
   * that changes because of something the READER can do, so it is set apart
   * from the stage line rather than concatenated with it.
   */
  readonly hint: string | null;
  /** Hidden once the reveal beat begins: the beat owns the screen from that point. */
  readonly visible: boolean;
}

export function ScanLitany({ line, hint, visible }: ScanLitanyProps): ReactElement {
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

        {hint === null ? null : <p className={styles.hint}>{hint}</p>}
      </Parchment>
    </div>
  );
}
