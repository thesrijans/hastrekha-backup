"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { FLASH_DWELL_MS, FLASH_QUADRANTS, type FlashQuadrant } from "@/lib/scan/illumination-active";

/**
 * Screen-as-flash: four quadrant lights, one camera frame each.
 *
 * The screen is the only light source this app controls, and moving it a few centimetres between
 * frames is enough to make a groove behave differently from a stain. Lighting one quadrant at a time
 * shifts the effective source corner to corner; `photometricEvidence` reads the per-pixel range and
 * the direction-consistency across the four.
 *
 * **Never automatic.** This takes over the screen with bright white panels for about three quarters
 * of a second, and doing that to someone without being asked would be unpleasant at best. It runs on
 * an explicit press, it can be refused permanently, and it respects the reduced-motion preference by
 * cross-fading instead of cutting — a hard cut between white panels is exactly the kind of stimulus
 * that setting exists to avoid, and a fade carries the same illumination change.
 *
 * Overlaid on the preview rather than replacing it, so the user can still see their hand and keep it
 * still — which is the entire requirement for the sequence to be worth capturing.
 */

/** Subscribe/snapshot pair for the reduced-motion query, so no effect has to mirror it into state. */
function subscribeReducedMotion(onChange: () => void): () => void {
  if (typeof window === "undefined") return () => undefined;
  const query = window.matchMedia("(prefers-reduced-motion: reduce)");
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

function getReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

const QUADRANT_POSITION: Readonly<Record<FlashQuadrant, string>> = {
  tl: "top-0 left-0",
  tr: "top-0 right-0",
  br: "bottom-0 right-0",
  bl: "bottom-0 left-0",
};

export interface DeepScanFlashProps {
  /** True while a sequence should be running. The parent owns the trigger. */
  readonly active: boolean;
  /** Fires as each quadrant lights, so the frame loop can grab exactly one frame under it. */
  readonly onQuadrant: (quadrant: FlashQuadrant) => void;
  /** Fires once the last quadrant has had its dwell. */
  readonly onComplete: () => void;
  /** User's standing refusal. When true the sequence never runs, whatever the flag says. */
  readonly disabled: boolean;
}

export function DeepScanFlash({ active, onQuadrant, onComplete, disabled }: DeepScanFlashProps) {
  const [index, setIndex] = useState(-1);
  /*
   * Read through an external store rather than mirrored into state by an effect. The query is a live
   * browser value, and syncing it with `setState` inside an effect is both a lint error here and the
   * wrong shape — the subscribe/snapshot pair is what `useSyncExternalStore` exists for, and it gets
   * the server snapshot right for free.
   */
  const reduced = useSyncExternalStore(subscribeReducedMotion, getReducedMotion, () => false);
  // Held in a ref so the stepping effect does not restart every time the parent re-renders.
  const callbacksRef = useRef({ onQuadrant, onComplete });
  useEffect(() => {
    callbacksRef.current = { onQuadrant, onComplete };
  }, [onQuadrant, onComplete]);

  /**
   * The whole sequence, driven by one effect and its own timers.
   *
   * State is only ever set from inside a timer or an animation-frame callback, never from the effect
   * body: setting it directly would make this effect a render-phase side effect in disguise, and
   * React's lint rule is right to refuse it. It also happens to be what the sequence needs — every
   * transition here is genuinely time-driven.
   */
  useEffect(() => {
    if (!active || disabled) return;

    let cancelled = false;
    let timer = 0;
    let frame = 0;

    const step = (position: number): void => {
      if (cancelled) return;
      if (position >= FLASH_QUADRANTS.length) {
        setIndex(-1);
        callbacksRef.current.onComplete();
        return;
      }
      setIndex(position);
      /*
       * Ask for the frame one paint AFTER the panel goes up. Requesting it immediately samples the
       * previous quadrant's light with the next quadrant's label attached — the one error that would
       * make the whole channel measure noise while appearing to work perfectly.
       */
      frame = requestAnimationFrame(() => {
        frame = requestAnimationFrame(() => {
          if (!cancelled) callbacksRef.current.onQuadrant(FLASH_QUADRANTS[position]);
        });
      });
      timer = window.setTimeout(() => step(position + 1), FLASH_DWELL_MS);
    };

    frame = requestAnimationFrame(() => step(0));

    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
      window.clearTimeout(timer);
      setIndex(-1);
    };
  }, [active, disabled]);

  if (index < 0) return null;
  const quadrant = FLASH_QUADRANTS[index];

  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 z-10 overflow-hidden">
      {FLASH_QUADRANTS.map((corner) => (
        <div
          key={corner}
          className={`absolute h-1/2 w-1/2 bg-white ${QUADRANT_POSITION[corner]}`}
          style={{
            opacity: corner === quadrant ? 0.92 : 0,
            // Reduced motion: cross-fade over most of the dwell rather than cutting between panels.
            transition: reduced ? `opacity ${Math.round(FLASH_DWELL_MS * 0.8)}ms linear` : "none",
          }}
        />
      ))}
    </div>
  );
}

/** The trigger, kept beside the component that consumes it so the copy and the behaviour stay together. */
export function DeepScanButton({
  onPress,
  running,
  disabled,
  progress = 0,
}: {
  readonly onPress: () => void;
  readonly running: boolean;
  readonly disabled: boolean;
  /** Frames captured so far, so a slow sequence shows movement rather than appearing to hang. */
  readonly progress?: number;
}) {
  const press = useCallback(() => {
    if (!running && !disabled) onPress();
  }, [disabled, onPress, running]);

  return (
    <button
      type="button"
      onClick={press}
      disabled={running || disabled}
      className="rounded-full border border-hairline px-4 py-2 font-display text-xs uppercase tracking-[0.16em] text-ink transition-colors hover:border-mount-glow/60 hover:text-mount-glow disabled:cursor-not-allowed disabled:text-muted"
    >
      {running ? `Gehri scan… ${progress}/${FLASH_QUADRANTS.length}` : "Gehri scan"}
    </button>
  );
}
