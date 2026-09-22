"use client";

/**
 * ============================================================================
 * <RekhaMonitor> — the [A2] rule as a live surface (S1.4)
 * ============================================================================
 *
 * WHAT IT SHOWS, AND WHAT IT REFUSES TO. A canonical palm plate on which the
 * lines rekhaPersist has actually found are drawn as they are found, by the
 * state the evidence has reached:
 *
 *   CANDIDATE   1px at 0.35 — the secondary rung: something is there
 *   TRACKING    growing from 1px/0.35 toward 2px/1.0 as its log-odds climb
 *   CONFIRMED   2px at 1.0 with the active rung's glow — and its Devanagari
 *               name on a leader, the moment it is confirmed
 *
 * and a ledger beneath: हृदय ✓ · मस्तिष्क … · जीवन ✓ · शनि —. It is DETECTION
 * ONLY: there is no reading text on it anywhere, because what a line means is
 * the Pothi's to say, after the scan, from the whole session. And it never
 * draws a line below CANDIDATE — `RekhaSnapshot` does not carry one, so there is
 * nothing here to filter: a line nobody has evidence for cannot reach the plate.
 *
 * THE PLATE is the Pothi's neutral palm (NEUTRAL_PALM_PATH), which is registered
 * to the rectified crop's canonical frame — so a crease traced in mask space
 * lands on this hand where it lies on the reader's. It is drawn in the cool moon
 * token at the secondary rung: context, and a different hue from the gold of a
 * found line, so a candidate crease at the same weight is never mistaken for
 * the hand's own contour. (U3c replaces the plate with the reader's twin.)
 *
 * WHERE IT SITS. The right side of the chamber on a desktop; a pull-up sheet on
 * a phone, collapsed to the ledger, opened by tapping it.
 */
import { useState, type ReactElement } from "react";
import type { RekhaLine, RekhaSnapshot } from "@/lib/scan/rekha-persist";
import { ACTIVE_LINE_IDS, MASK_SIZE, type ActiveLineId } from "@/lib/scan/types";
import { NEUTRAL_PALM_PATH } from "@/components/sanctuary/pothi/palm-plate";
import { pothiPolylinePath } from "@/lib/sanctuary/pothi-geometry";
import styles from "./rekha-monitor.module.css";

/** The four creases, by the names the ledger and the leaders use. */
export const REKHA_NAMES: Readonly<Record<ActiveLineId, string>> = {
  heart: "हृदय",
  head: "मस्तिष्क",
  life: "जीवन",
  fate: "शनि",
};

/** English, for the accessible names only — never drawn. */
const ENGLISH: Readonly<Record<ActiveLineId, string>> = { heart: "Heart", head: "Head", life: "Life", fate: "Fate" };

/** The ledger's marks: confirmed ✓, still being gathered …, not yet seen —. */
export function ledgerMark(line: RekhaLine | undefined): "✓" | "…" | "—" {
  if (line === undefined) return "—";
  return line.state === "confirmed" ? "✓" : "…";
}

/** The ledger as one line of text, e.g. "हृदय ✓ · मस्तिष्क … · जीवन ✓ · शनि —". */
export function rekhaLedger(snapshot: RekhaSnapshot | null): string {
  return ACTIVE_LINE_IDS.map((id) => `${REKHA_NAMES[id]} ${ledgerMark(snapshot?.lines[id])}`).join(" · ");
}

/**
 * A line's stroke by its state. CANDIDATE and CONFIRMED are the two rungs of
 * the sanctuary ladder (app/sanctuary.css); TRACKING interpolates between them
 * by the line's confirmation progress, which is what makes a line visibly
 * "grow" as evidence arrives.
 */
export function rekhaStroke(line: RekhaLine): { readonly width: number; readonly opacity: number; readonly glow: boolean } {
  if (line.state === "confirmed") return { width: 2, opacity: 1, glow: true };
  if (line.state === "candidate") return { width: 1, opacity: 0.35, glow: false };
  const t = Math.min(1, Math.max(0, line.progress));
  return { width: 1 + t, opacity: 0.35 + 0.65 * t, glow: false };
}

/** A traced line's valley extension (S2) draws at this share of its observed stretches. */
export const REKHA_EXTENSION_OPACITY = 0.6;

/* ------------------------------- The leaders ------------------------------- */

/** Plate units: the palm is 0–100; the view adds margins either side for the names. */
const MARGIN = 28;
const VIEW = `${-MARGIN} -6 ${100 + 2 * MARGIN} 112`;
const LABEL_GAP = 9;

interface Leader {
  readonly id: ActiveLineId;
  readonly from: readonly [number, number];
  readonly side: "left" | "right";
  y: number;
}

/**
 * Where each confirmed line's name hangs: the heart and head from their ulnar
 * (right) ends, the life line from its radial curve and the fate line from its
 * top, each to the margin on its own side — then pushed apart so two names on
 * one side never overlap.
 */
function leadersFor(lines: readonly RekhaLine[]): Leader[] {
  const scale = 100 / MASK_SIZE;
  const out: Leader[] = [];
  for (const line of lines) {
    if (line.state !== "confirmed" || line.points.length === 0) continue;
    const pts = line.points.map(([x, y]) => [x * scale, y * scale] as const);
    let from: readonly [number, number];
    let side: "left" | "right";
    if (line.id === "heart" || line.id === "head") {
      from = pts.reduce((a, b) => (b[0] > a[0] ? b : a));
      side = "right";
    } else if (line.id === "life") {
      from = pts[Math.floor(pts.length * 0.6)] ?? pts[0]!;
      side = "left";
    } else {
      from = pts.reduce((a, b) => (b[1] < a[1] ? b : a));
      side = "left";
    }
    out.push({ id: line.id, from, side, y: Math.min(96, Math.max(4, from[1])) });
  }
  for (const side of ["left", "right"] as const) {
    const group = out.filter((l) => l.side === side).sort((a, b) => a.y - b.y);
    for (let i = 1; i < group.length; i += 1) group[i]!.y = Math.max(group[i]!.y, group[i - 1]!.y + LABEL_GAP);
  }
  return out;
}

/* -------------------------------- The monitor ------------------------------ */

export interface RekhaMonitorProps {
  /** The hook's rekhaPersist snapshot; null before the first frame (the plate shows only the hand). */
  readonly snapshot: RekhaSnapshot | null;
  /** Hidden without unmounting, so the sheet can slide away rather than vanish. */
  readonly visible?: boolean;
  readonly className?: string;
}

export function RekhaMonitor({ snapshot, visible = true, className }: RekhaMonitorProps): ReactElement {
  const [open, setOpen] = useState(false);
  const lines = ACTIVE_LINE_IDS.map((id) => snapshot?.lines[id]).filter((line): line is RekhaLine => line !== undefined);
  const leaders = leadersFor(lines);

  return (
    <section
      className={[styles.monitor, className].filter(Boolean).join(" ")}
      data-snc-monitor={visible ? "in" : "out"}
      data-snc-sheet={open ? "open" : "closed"}
      aria-label="Rekha monitor — the lines found so far"
    >
      <button
        type="button"
        className={styles.ledger}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <span className={styles.ledgerLine} aria-live="polite">
          {ACTIVE_LINE_IDS.map((id, index) => {
            const line = snapshot?.lines[id];
            const mark = ledgerMark(line);
            return (
              <span key={id} className={styles.entry} data-snc-state={line?.state ?? "none"}>
                {index > 0 ? <span className={styles.dot} aria-hidden="true"> · </span> : null}
                <span lang="hi" aria-label={`${ENGLISH[id]} line: ${mark === "✓" ? "confirmed" : mark === "…" ? "being gathered" : "not yet seen"}`}>
                  {REKHA_NAMES[id]} <span aria-hidden="true">{mark}</span>
                </span>
              </span>
            );
          })}
        </span>
      </button>

      <svg className={styles.plate} viewBox={VIEW} role="img" aria-label="The palm, with the lines found so far" focusable="false">
        <path d={NEUTRAL_PALM_PATH} className={styles.palm} vectorEffect="non-scaling-stroke" />
        {lines.map((line) => {
          const stroke = rekhaStroke(line);
          /* A traced line (S2) draws its observed stretches at its state's stroke and its valley
             extension at 0.6 of it; a fitted line draws whole, as before. */
          const segments = line.traced === true ? (line.segments ?? []) : [];
          if (segments.length > 1 || segments.some((segment) => !segment.observed)) {
            return (
              <g key={line.id} data-snc-line={line.id} data-snc-state={line.state} data-snc-held={line.held ? "" : undefined}>
                {segments.map((segment, index) => {
                  const d = pothiPolylinePath(line.points.slice(segment.from, segment.to + 1), MASK_SIZE);
                  if (d === null) return null;
                  return (
                    <path
                      key={index}
                      d={d}
                      className={stroke.glow ? `${styles.line} ${styles.confirmed}` : styles.line}
                      data-snc-extension={segment.observed ? undefined : ""}
                      strokeWidth={stroke.width}
                      strokeOpacity={stroke.opacity * (segment.observed ? 1 : REKHA_EXTENSION_OPACITY)}
                      vectorEffect="non-scaling-stroke"
                    />
                  );
                })}
              </g>
            );
          }
          const d = pothiPolylinePath(line.points, MASK_SIZE);
          if (d === null) return null;
          return (
            <path
              key={line.id}
              d={d}
              className={stroke.glow ? `${styles.line} ${styles.confirmed}` : styles.line}
              data-snc-line={line.id}
              data-snc-state={line.state}
              data-snc-held={line.held ? "" : undefined}
              strokeWidth={stroke.width}
              strokeOpacity={stroke.opacity}
              vectorEffect="non-scaling-stroke"
            />
          );
        })}
        {leaders.map((leader) => {
          const edge = leader.side === "right" ? 100 : 0;
          const textX = leader.side === "right" ? 104 : -4;
          return (
            <g key={leader.id} className={styles.leader} data-snc-leader={leader.id}>
              <polyline
                points={`${leader.from[0]},${leader.from[1]} ${edge},${leader.y} ${leader.side === "right" ? 102 : -2},${leader.y}`}
                className={styles.leaderLine}
                vectorEffect="non-scaling-stroke"
              />
              <text x={textX} y={leader.y} textAnchor={leader.side === "right" ? "start" : "end"} dominantBaseline="middle" lang="hi" className={styles.name}>
                {REKHA_NAMES[leader.id]}
              </text>
            </g>
          );
        })}
      </svg>
    </section>
  );
}
