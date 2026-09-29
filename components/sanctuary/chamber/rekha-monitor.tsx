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
 * and a ledger beneath: हृदय ✓ · मस्तिष्क … · जीवन ✓ · शनि —. With the chamber's
 * detection progress (scan-complete G3, lib/scan/detection-progress.ts) each
 * line's mark is a thin gold ring filling toward CONFIRMED, its ✓ at 100%, and
 * "—" once the budget has marked it इस हाथ पर स्पष्ट नहीं; a second row carries
 * the one overall percentage. It is DETECTION
 * ONLY: there is no reading text on it anywhere, because what a line means is
 * the Pothi's to say, after the scan, from the whole session. And it never
 * draws a line below CANDIDATE — `RekhaSnapshot` does not carry one, so there is
 * nothing here to filter: a line nobody has evidence for cannot reach the plate.
 *
 * THE PLATE is the Pothi's neutral palm (public/plates/hand-plate, M1.1): the
 * P1 mesh baked into the rectified crop's canonical frame — so a crease traced
 * in mask space lands on this hand where it lies on the reader's. A picture
 * laid on the palm's own square of the view, under the SVG; the lines are
 * drawn in gold-400 over its engraved gold, so a candidate crease at the
 * secondary rung is a line ON a hand, never the hand's own contour. (U3c
 * replaces the plate with the reader's twin.)
 *
 * WHERE IT SITS. The right side of the chamber on a desktop; a pull-up sheet on
 * a phone, collapsed to the ledger, opened by tapping it.
 */
import { useState, type CSSProperties, type ReactElement } from "react";
import { HandPlate } from "@/components/sanctuary/hand-plate";
import { DETECTION_LINE_IDS, type DetectionState, type LineDetection } from "@/lib/scan/detection-progress";
import type { RekhaLine, RekhaSnapshot } from "@/lib/scan/rekha-persist";
import { ACTIVE_LINE_IDS, MASK_SIZE, type ActiveLineId } from "@/lib/scan/types";
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

/* ------------------------- Detection progress (G3) ------------------------- */

/** The mark for a line the scan budget has passed by: the spec's words, exactly. */
export const DETECTION_UNCLEAR_HI = "इस हाथ पर स्पष्ट नहीं";

/** The overall percentage's word: पहचान, the detection — the word G4's "पहचान पूरी" completes. */
export const DETECTION_OVERALL_HI = "पहचान";

/** 0–1 as a whole percentage, never rounding an unfinished detection up to 100. */
export function detectionPercent(fraction: number): number {
  const percent = Math.round(Math.min(1, Math.max(0, fraction)) * 100);
  return percent === 100 && fraction < 1 ? 99 : percent;
}

/** The ledger with progress, as one line of text — the `?cost=1` readout's: "हृदय ✓ · मस्तिष्क 64% · जीवन 12% · शनि — · पहचान 69%". */
export function detectionLedger(detection: DetectionState): string {
  const lines = DETECTION_LINE_IDS.map((id) => {
    const line = detection.lines[id];
    const mark = line.status === "confirmed" ? "✓" : line.status === "unclear" ? "—" : `${detectionPercent(line.progress)}%`;
    return `${REKHA_NAMES[id]} ${mark}`;
  });
  return `${lines.join(" · ")} · ${DETECTION_OVERALL_HI} ${detectionPercent(detection.overall)}%`;
}

/** The ring's radius in its 16-unit box. */
const RING_R = 6;

/**
 * The ring's filled arc, clockwise from the top, as an SVG path — an arc, not a dash pattern over a circle
 * (ui-sanctuary-spec §3: solid strokes only, never dashed, anywhere). Null at zero: an empty ring is its track.
 */
export function ringArcPath(progress: number): string | null {
  if (!(progress > 0)) return null;
  const theta = 2 * Math.PI * Math.min(progress, 0.9999);
  const x = 8 + RING_R * Math.sin(theta);
  const y = 8 - RING_R * Math.cos(theta);
  return `M 8 ${8 - RING_R} A ${RING_R} ${RING_R} 0 ${theta > Math.PI ? 1 : 0} 1 ${x.toFixed(3)} ${y.toFixed(3)}`;
}

/** What a line's ledger entry says to a screen reader: its status, never a percentage that changes five times a second. */
function detectionLabel(id: ActiveLineId, line: LineDetection): string {
  const status =
    line.status === "confirmed"
      ? "confirmed"
      : line.status === "unclear"
        ? "not clear on this hand"
        : line.progress > 0
          ? "being gathered"
          : "not yet seen";
  return `${ENGLISH[id]} line: ${status}`;
}

/** A line's mark in the ledger: its ring while gathering, ✓ once confirmed, — once the budget marks it unclear. */
function DetectionMark({ line }: { readonly line: LineDetection }): ReactElement {
  if (line.status === "confirmed") {
    return (
      <span className={styles.tick} aria-hidden="true">
        ✓
      </span>
    );
  }
  if (line.status === "unclear") return <span aria-hidden="true">—</span>;
  const arc = ringArcPath(line.progress);
  return (
    <svg className={styles.ring} viewBox="0 0 16 16" aria-hidden="true" focusable="false" data-snc-ring="">
      <circle className={styles.ringTrack} cx="8" cy="8" r={RING_R} vectorEffect="non-scaling-stroke" />
      {arc === null ? null : <path className={styles.ringArc} d={arc} vectorEffect="non-scaling-stroke" />}
    </svg>
  );
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
const VIEW_TOP = 6;
const VIEW_HEIGHT = 112;
const VIEW = `${-MARGIN} ${-VIEW_TOP} ${100 + 2 * MARGIN} ${VIEW_HEIGHT}`;
const LABEL_GAP = 9;

/** Where the palm's 0-100 square sits in the view, for the baked hand laid under the SVG. */
const PALM_BOX: CSSProperties = {
  left: `${((MARGIN / (100 + 2 * MARGIN)) * 100).toFixed(3)}%`,
  top: `${((VIEW_TOP / VIEW_HEIGHT) * 100).toFixed(3)}%`,
  width: `${((100 / (100 + 2 * MARGIN)) * 100).toFixed(3)}%`,
  height: `${((100 / VIEW_HEIGHT) * 100).toFixed(3)}%`,
};

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
  /**
   * scan-complete G3: the chamber's detection progress. Given, the ledger draws a ring per line, its ✓, the
   * unclear mark and the overall percentage; absent, the S1.4 marks (✓ … —) straight off the snapshot.
   */
  readonly detection?: DetectionState | null;
  /** Hidden without unmounting, so the sheet can slide away rather than vanish. */
  readonly visible?: boolean;
  readonly className?: string;
}

export function RekhaMonitor({ snapshot, detection = null, visible = true, className }: RekhaMonitorProps): ReactElement {
  const [open, setOpen] = useState(false);
  const lines = ACTIVE_LINE_IDS.map((id) => snapshot?.lines[id]).filter((line): line is RekhaLine => line !== undefined);
  const leaders = leadersFor(lines);
  const anyUnclear = detection !== null && DETECTION_LINE_IDS.some((id) => detection.lines[id].status === "unclear");

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
            const progress = detection?.lines[id];
            if (progress !== undefined) {
              return (
                <span
                  key={id}
                  className={styles.entry}
                  data-snc-state={line?.state ?? "none"}
                  data-snc-detect={progress.status}
                  data-snc-progress={progress.progress.toFixed(2)}
                >
                  {index > 0 ? <span className={styles.dot} aria-hidden="true"> · </span> : null}
                  <span lang="hi" aria-label={detectionLabel(id, progress)}>
                    {REKHA_NAMES[id]} <DetectionMark line={progress} />
                  </span>
                </span>
              );
            }
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
        {/* G3: the one overall percentage, and — once the budget has passed a line by — what its "—" means.
            Outside the live region: a percentage that moves five times a second is not an announcement. */}
        {detection === null ? null : (
          <span
            className={styles.summary}
            lang="hi"
            data-snc-overall={detection.overall.toFixed(3)}
            data-snc-usable={Math.round(detection.usableMs)}
            data-snc-complete={detection.complete ? "" : undefined}
          >
            {`${DETECTION_OVERALL_HI} ${detectionPercent(detection.overall)}%`}
            {anyUnclear ? <span className={styles.unclearNote}>{` · — ${DETECTION_UNCLEAR_HI}`}</span> : null}
          </span>
        )}
      </button>

      <div className={styles.plateBox}>
        <HandPlate kind="plate" className={styles.palm} style={PALM_BOX} />
      <svg className={styles.plate} viewBox={VIEW} role="img" aria-label="The palm, with the lines found so far" focusable="false">
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
      </div>
    </section>
  );
}
