/**
 * Ground-truth adapter for the eval harness (Phase 0d): walks BOTH label sources into one shape.
 *
 *  (a) legacy — test/fixtures/ground-truth/*.json, the hand-traced files golden-run.ts consumes.
 *      All three are loaded; `geometryValid: false` files become skip cases with the reason, so
 *      the report shows them instead of silently dropping them.
 *  (b) session — <root>/golden/<sessionId>/labels/label-*.json, the 0a-2 RekhaLabelFile exports
 *      from the /dev/label harness, paired with the same session's selected/ crop. Validated with
 *      the same `parseRekhaLabelFile` the labeler itself uses; invalid files become skip cases.
 *
 * Points stay 0–1 canonical fractions throughout — that is what makes 256-labeled legacy frames
 * and 512-labeled session crops comparable in one metric space.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import {
  LABEL_LINE_IDS,
  parseRekhaLabelFile,
  parseSessionMetadata,
  type LabelConfidence,
  type LabelLineId,
} from "../../lib/scan/dev/session-types";
import { RECTIFIED_SIZE, type Landmark3 } from "../../lib/scan/types";

export interface EvalLine {
  readonly points: readonly (readonly number[])[];
  readonly absent: boolean;
  readonly confidence?: LabelConfidence | string;
}

export interface EvalCase {
  readonly id: string;
  readonly source: "legacy" | "session";
  readonly hand: "left" | "right" | "unknown";
  /** Repo-relative or root-relative path to the image the pipeline should run on. */
  readonly imagePath: string;
  /** Native label resolution — metrics are still computed in the fixed EVAL_SIZE space. */
  readonly canonicalSize: number;
  /** Rectification anchors in imagePath pixel space. */
  readonly anchors: readonly (readonly number[])[];
  /** Only labeled ids appear; an id neither traced nor marked absent is unlabeled, not absent. */
  readonly lines: Partial<Record<LabelLineId, EvalLine>>;
  readonly skip?: string;
  readonly meta: { readonly subjectKey?: string; readonly exerciseLabel?: string; readonly notes?: string };
  /**
   * Session cases only, from metadata.json: the 21 raw MediaPipe landmarks (0–1 of the preview
   * frame, pre-One-Euro), the still's pixel size, and the raw full-frame still — everything the
   * 'unet-fullhand-*' rungs need. Legacy cases have none.
   */
  readonly landmarks?: readonly Landmark3[];
  readonly stillSize?: { readonly width: number; readonly height: number };
  readonly rawImagePath?: string;
  /** Still-pixel anchors from metadata (PALM_ANCHORS order) — the quad solve in raw-still space. */
  readonly stillAnchors?: readonly (readonly number[])[];
}

interface LegacyGt {
  readonly frame: string;
  readonly anchors: readonly (readonly number[])[];
  readonly geometryValid?: boolean;
  readonly note?: string;
  readonly lines: readonly { readonly id: string; readonly confidence?: string; readonly points: readonly (readonly number[])[] }[];
  readonly absent?: readonly string[];
}

const LINE_ID_SET = new Set<string>(LABEL_LINE_IDS);

function loadLegacy(repoRoot: string): EvalCase[] {
  const dir = path.join(repoRoot, "test", "fixtures", "ground-truth");
  if (!existsSync(dir)) return [];
  const cases: EvalCase[] = [];
  for (const entry of readdirSync(dir).sort()) {
    if (!entry.endsWith(".json")) continue;
    const gt = JSON.parse(readFileSync(path.join(dir, entry), "utf8")) as LegacyGt;
    const lines: Partial<Record<LabelLineId, EvalLine>> = {};
    for (const line of gt.lines) {
      if (LINE_ID_SET.has(line.id)) {
        lines[line.id as LabelLineId] = { points: line.points, absent: false, confidence: line.confidence };
      }
    }
    for (const id of gt.absent ?? []) {
      if (LINE_ID_SET.has(id)) lines[id as LabelLineId] = { points: [], absent: true };
    }
    const skip =
      gt.geometryValid === false
        ? "geometryValid: false — anchors are unreliable, rectification would score the warp, not the detector"
        : !existsSync(path.join(repoRoot, gt.frame))
          ? `frame missing: ${gt.frame}`
          : undefined;
    cases.push({
      id: entry.replace(/\.json$/, ""),
      source: "legacy",
      hand: "unknown", // legacy GT never recorded the hand — a per-hand breakdown gap the report shows
      imagePath: path.join(repoRoot, gt.frame),
      canonicalSize: RECTIFIED_SIZE,
      anchors: gt.anchors,
      lines,
      skip,
      meta: { notes: gt.note },
    });
  }
  return cases;
}

function loadSessions(repoRoot: string, root: string): EvalCase[] {
  const goldenDir = path.join(repoRoot, root, "golden");
  if (!existsSync(goldenDir)) return [];
  const cases: EvalCase[] = [];
  for (const sessionId of readdirSync(goldenDir).sort()) {
    const sessionDir = path.join(goldenDir, sessionId);
    if (!statSync(sessionDir).isDirectory()) continue;
    const labelsDir = path.join(sessionDir, "labels");
    if (!existsSync(labelsDir)) continue;
    for (const entry of readdirSync(labelsDir).sort()) {
      if (!entry.endsWith(".json")) continue;
      const id = `${sessionId}/${entry.replace(/\.json$/, "")}`;
      const label = parseRekhaLabelFile(readFileSync(path.join(labelsDir, entry), "utf8"));
      if (label === null) {
        cases.push({
          id,
          source: "session",
          hand: "unknown",
          imagePath: "",
          canonicalSize: 0,
          anchors: [],
          lines: {},
          skip: "label failed parseRekhaLabelFile — not a valid 0a-1/0a-2 file",
          meta: { subjectKey: sessionId },
        });
        continue;
      }
      const imagePath = path.join(sessionDir, label.frame);
      const lines: Partial<Record<LabelLineId, EvalLine>> = {};
      for (const line of label.lines) {
        lines[line.id] = { points: line.points, absent: line.absent, confidence: line.confidence };
      }
      // metadata.json sits beside labels/ — exportSession writes it last, so it is present in any
      // complete export. Its still record carries the landmarks the full-hand rungs need.
      let landmarks: readonly Landmark3[] | undefined;
      let stillSize: { width: number; height: number } | undefined;
      let rawImagePath: string | undefined;
      let stillAnchors: readonly (readonly number[])[] | undefined;
      const metaPath = path.join(sessionDir, "metadata.json");
      if (existsSync(metaPath)) {
        const metadata = parseSessionMetadata(readFileSync(metaPath, "utf8"));
        const still = metadata?.stills.find((entry) => entry.index === label.stillIndex);
        if (still !== undefined) {
          landmarks = still.landmarks; // validated 21-exactly by isSessionMetadata's isLandmarkArray
          stillSize = { width: still.width, height: still.height };
          rawImagePath = path.join(sessionDir, "raw", still.rawFile);
          stillAnchors = still.anchors;
        }
      }
      cases.push({
        id,
        source: "session",
        hand: label.hand,
        imagePath,
        canonicalSize: label.canonicalSize,
        anchors: label.anchors,
        lines,
        skip: existsSync(imagePath) ? undefined : `crop missing: ${label.frame}`,
        meta: { subjectKey: label.sessionId, exerciseLabel: label.mode },
        landmarks,
        stillSize,
        rawImagePath: rawImagePath !== undefined && existsSync(rawImagePath) ? rawImagePath : undefined,
        stillAnchors,
      });
    }
  }
  return cases;
}

/** Walk both sources. `root` is the session-fixture root (default "fixtures"), repo-relative. */
export function loadGroundTruth(root = "fixtures", repoRoot: string = path.resolve(__dirname, "..", "..")): EvalCase[] {
  return [...loadLegacy(repoRoot), ...loadSessions(repoRoot, root)];
}
