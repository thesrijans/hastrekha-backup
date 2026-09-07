"use client";

/**
 * The reveal beat, rendered.
 *
 * The score is in lib/sanctuary/reveal-beat.ts and this file does nothing but
 * play it: one rAF loop, one state, no timing of its own. Two reasons, and the
 * second is the real one. A component that owned its own setTimeout chain would
 * be a sequence nobody could test without waiting three and a half seconds per
 * assertion — and a chain of timeouts drifts, so the darkening would begin at a
 * slightly different moment on a busy device than on an idle one.
 *
 * The beat does not own the navigation. It reports that it has arrived and the
 * route decides what that means, because "the bundle arrives" is a fact about
 * the product's flow rather than about this animation, and an animation that
 * navigates is an animation that can navigate at the wrong time.
 */

import { useEffect, useRef, useState, type ReactElement } from "react";
import { REVEAL_LINES, revealAt, revealReduced, type RevealState } from "@/lib/sanctuary/reveal-beat";
import styles from "./reveal-beat.module.css";

export interface RevealBeatProps {
  /** Fires once, when the beat has finished. The route navigates; this component does not. */
  readonly onArrived: () => void;
}

export function RevealBeat({ onArrived }: RevealBeatProps): ReactElement {
  const [state, setState] = useState<RevealState>(() => revealAt(0));
  const arrivedRef = useRef(false);
  const onArrivedRef = useRef(onArrived);
  useEffect(() => {
    onArrivedRef.current = onArrived;
  }, [onArrived]);

  useEffect(() => {
    const reduced =
      typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const score = reduced ? revealReduced : revealAt;

    let raf = 0;
    let started = 0;
    const frame = (timestamp: number): void => {
      if (started === 0) started = timestamp;
      const next = score(timestamp - started);
      setState(next);
      if (next.arrived) {
        /* Once, and guarded by a ref rather than by state: the frame after the
           one that arrives would otherwise fire it again before React has
           re-rendered, and a navigation called twice is a history entry
           nobody asked for. */
        if (!arrivedRef.current) {
          arrivedRef.current = true;
          onArrivedRef.current();
        }
        return;
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div className={styles.beat} data-snc-reveal={state.phase} role="status" aria-live="polite">
      {/*
        Both lines are in the DOM from the first frame and the second is hidden
        by opacity rather than by mounting. A screen reader announcing a live
        region twice is a small cost; a sentence that arrives in the
        accessibility tree 1.2 s after it was announced is a jump-scare in the
        one medium where the spec's "no jump-scares" is easiest to break.
      */}
      {REVEAL_LINES.map((line, index) => (
        <p
          key={line.en}
          className={styles.line}
          lang="hi"
          aria-label={line.en}
          data-snc-shown={index < state.linesShown ? "true" : "false"}
        >
          {line.hi}
        </p>
      ))}

      {/*
        THE DARKNESS IS AN ELEMENT, NOT A BACKGROUND. It has to cover the camera
        feed, the canvas and the leaf all at once, and a background colour on
        this box would sit under the two lines it is meant to take away with it.
      */}
      <span className={styles.dark} aria-hidden="true" style={{ opacity: state.darkness }} />
    </div>
  );
}
