/**
 * Labeler state → RekhaLabelFile (0a-ii). Pure and shared: the label client calls this to save,
 * and test/labeler.test.ts calls the SAME function, so the file the tests validate is the file
 * the client writes — not a hand-built lookalike.
 */
import {
  CANONICAL_LABEL_SIZE,
  ENHANCEMENT_VERSION,
  LABEL_LINE_IDS,
  cropFileName,
  type GrayChannel,
  type LabelConfidence,
  type LabelLineId,
  type LabelMethod,
  type LabelerMode,
  type RekhaLabelFile,
  type RekhaLabelLine,
  type SessionMetadata,
  type ViewMode,
} from "./session-types";
import { canonicalAnchors } from "../rectify";

/** Working state for one line in the labeler UI. */
export interface LabelerLineState {
  /** Committed polyline, 0–1 canonical-crop fractions. Empty while untouched or absent. */
  readonly points: readonly (readonly number[])[];
  readonly absent: boolean;
  readonly confidence: LabelConfidence;
  /** 'livewire' when any committed segment snapped; 'manual' otherwise. */
  readonly method: LabelMethod;
  readonly viewAtCommit: ViewMode;
  /** True once the line was explicitly committed (Enter) or marked absent. */
  readonly done: boolean;
}

/** The whole labeler working state that matters to the exported file. */
export interface LabelerState {
  readonly lines: Readonly<Record<LabelLineId, LabelerLineState>>;
  readonly mode: LabelerMode;
  readonly channel: GrayChannel;
}

export function emptyLineState(): LabelerLineState {
  return { points: [], absent: false, confidence: "clear", method: "manual", viewAtCommit: "NATURAL", done: false };
}

export function emptyLabelerState(channel: GrayChannel = "LUMA"): LabelerState {
  return {
    lines: { heart: emptyLineState(), head: emptyLineState(), life: emptyLineState(), fate: emptyLineState() },
    mode: "blank_slate",
    channel,
  };
}

/** True when every line is either committed with points or marked absent — Save's gate. */
export function isComplete(state: LabelerState): boolean {
  return LABEL_LINE_IDS.every((id) => {
    const line = state.lines[id];
    return line.done && (line.absent ? line.points.length === 0 : line.points.length >= 2);
  });
}

/**
 * Build the 0a-2 label file.
 *
 * `anchors` are `canonicalAnchors(4, CANONICAL_LABEL_SIZE)` — the crop's own canonical quad in
 * crop pixels, NEVER preview-frame anchors: golden-run.ts re-warps the 512 crop through
 * `rectifyPalm(crop, anchors, 256)`, and only crop-space anchors make that transform correct.
 *
 * @throws when the state is incomplete — the client disables Save until {@link isComplete}.
 */
export function buildLabelFile(
  state: LabelerState,
  session: SessionMetadata,
  stillIndex: number,
  labelerId: string,
  labeledAt: string,
): RekhaLabelFile {
  if (!isComplete(state)) throw new Error("label state incomplete — every line must be committed or absent");
  const still = session.stills.find((s) => s.index === stillIndex);
  if (still === undefined) throw new Error(`still ${stillIndex} is not in session ${session.sessionId}`);
  const anchors = canonicalAnchors(4, CANONICAL_LABEL_SIZE);
  if (anchors === null) throw new Error("canonical anchors unavailable");

  const lines: RekhaLabelLine[] = LABEL_LINE_IDS.map((id) => {
    const line = state.lines[id];
    return {
      id,
      points: line.absent ? [] : line.points.map((p) => [Number(p[0].toFixed(4)), Number(p[1].toFixed(4))]),
      absent: line.absent,
      confidence: line.confidence,
      method: line.method,
      viewAtCommit: line.viewAtCommit,
    };
  });

  return {
    schemaVersion: "0a-2",
    sessionId: session.sessionId,
    stillIndex,
    frame: `selected/${cropFileName(stillIndex)}`,
    anchors: anchors.map((p) => [Number(p.x.toFixed(2)), Number(p.y.toFixed(2))]),
    canonicalSize: CANONICAL_LABEL_SIZE,
    hand: session.hand,
    lines,
    absent: lines.filter((line) => line.absent).map((line) => line.id),
    mode: state.mode,
    labeler: labelerId,
    labelerId,
    enhancement: { version: ENHANCEMENT_VERSION, channel: state.channel },
    capturedAt: still.capturedAt,
    labeledAt,
  };
}
