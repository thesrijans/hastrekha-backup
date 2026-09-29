"use client";

/**
 * THE INK GAUGE (scan-complete G2.1): the distance meter's live reading, drawn as a small measuring rule in
 * ink at the head of the leaf's instruction line.
 *
 * A hairline scale — far on the left, near on the right — with the band the meter asks for inked heavier, and
 * a dot where the palm is now. It lives INSIDE the instruction's line, not on a line of its own: the leaf's
 * height is what the ring's bottom reserve was measured against (scan-ring.ts RING_PHONE_RESERVE_BOTTOM), and a
 * third row would push the leaf into the wheel.
 *
 * LIVE WITHOUT RENDERS. The reading changes every frame; the leaf must not. The dot is moved by its own
 * animation frame from the hook's ref, one attribute write when it has actually moved — the same reason the
 * chamber's canvas reads its props through a ref.
 *
 * Ink, not gold: it is written on the leaf, and the leaf's language is ink (spec A3 keeps the hologram's gold
 * in the scanner). No colour appears here; the stylesheet's tokens colour it.
 */

import { useEffect, useRef, type ReactElement } from "react";
import { gaugePosition, PALM_QUAD_MIN_FILL, type DistanceReading } from "@/lib/scan/distance";
import { PALM_QUAD_MAX_FILL } from "@/lib/scan/quality";
import styles from "./scan-litany.module.css";

/** The rule's length in its own units — the SVG is sized in CSS to the same number of pixels. */
export const GAUGE_LENGTH = 44;

/** How far the dot must move, in rule units, before it is redrawn. */
const GAUGE_EPSILON = 0.25;

export interface DistanceGaugeProps {
  /** The hook's live reading; null while no palm is in view. */
  readonly reading: { readonly current: DistanceReading | null };
}

export function DistanceGauge({ reading }: DistanceGaugeProps): ReactElement {
  const rootRef = useRef<SVGSVGElement | null>(null);
  const dotRef = useRef<SVGCircleElement | null>(null);

  useEffect(() => {
    let raf = 0;
    let lastX = Number.NaN;
    let lastState = "";
    const tick = (): void => {
      const now = reading.current;
      const root = rootRef.current;
      const dot = dotRef.current;
      if (root !== null && dot !== null) {
        const state = now?.state ?? "none";
        if (state !== lastState) {
          root.dataset.sncDistance = state;
          lastState = state;
        }
        const x = now === null ? Number.NaN : gaugePosition(now.fill) * GAUGE_LENGTH;
        if (Number.isNaN(x) !== Number.isNaN(lastX) || Math.abs(x - lastX) > GAUGE_EPSILON) {
          if (!Number.isNaN(x)) dot.setAttribute("cx", x.toFixed(2));
          lastX = x;
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [reading]);

  const bandFrom = gaugePosition(PALM_QUAD_MIN_FILL) * GAUGE_LENGTH;
  const bandTo = gaugePosition(PALM_QUAD_MAX_FILL) * GAUGE_LENGTH;
  return (
    <svg
      ref={rootRef}
      className={styles.gauge}
      viewBox={`-2 0 ${GAUGE_LENGTH + 4} 10`}
      aria-hidden="true"
      data-snc-gauge=""
      data-snc-distance="none"
    >
      <line className={styles.gaugeRule} x1={0} y1={5} x2={GAUGE_LENGTH} y2={5} />
      <line className={styles.gaugeBand} x1={bandFrom} y1={5} x2={bandTo} y2={5} />
      <line className={styles.gaugeTick} x1={bandFrom} y1={2.5} x2={bandFrom} y2={7.5} />
      <line className={styles.gaugeTick} x1={bandTo} y1={2.5} x2={bandTo} y2={7.5} />
      <circle ref={dotRef} className={styles.gaugeDot} cx={0} cy={5} r={2.1} />
    </svg>
  );
}
