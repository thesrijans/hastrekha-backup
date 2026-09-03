/**
 * H12 — anchor jitter measured on a captured session (test/eval only).
 *
 * For every session directory with ≥ 5 stills carrying 21 landmarks: the per-anchor spread of
 * the four PALM_ANCHORS landmarks (0 wrist, 1 thumb CMC, 5 index MCP, 17 pinky MCP) across the
 * session's stills, in still pixels and in canonical crop pixels (each still's anchor pixels
 * projected through ONE reference homography solved from the component-wise MEDIAN anchor
 * positions — projecting through each still's own solve would be identically zero by
 * construction).
 *
 * HONEST CAVEAT, printed with the numbers: session stills are discrete captures seconds apart —
 * the hand repositions between them — so this is an UPPER BOUND on frame-to-frame tracking
 * jitter, not a measurement of it. A 30fps sequence fixture is what would measure H12 exactly.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { canonicalAnchors, solveHomography, applyHomography } from "../../lib/scan/rectify";
import { RECTIFIED_SIZE } from "../../lib/scan/types";
import { parseSessionMetadata } from "../../lib/scan/dev/session-types";

const ANCHOR_LANDMARKS = [
  { index: 0, name: "wrist" },
  { index: 1, name: "thumb CMC" },
  { index: 5, name: "index MCP" },
  { index: 17, name: "pinky MCP" },
] as const;

export interface AnchorJitter {
  readonly name: string;
  /** Radial std √(var x + var y), still pixels. */
  readonly stdStillPx: number;
  /** Same spread after projection through the session-median reference homography, canonical px. */
  readonly stdCanonicalPx: number;
}

export interface SessionJitter {
  readonly sessionId: string;
  readonly stills: number;
  readonly anchors: readonly AnchorJitter[];
  readonly meanStillPx: number;
  readonly meanCanonicalPx: number;
}

const median = (xs: number[]): number => {
  const sorted = [...xs].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
};

const radialStd = (points: readonly { x: number; y: number }[]): number => {
  const mx = points.reduce((s, p) => s + p.x, 0) / points.length;
  const my = points.reduce((s, p) => s + p.y, 0) / points.length;
  const variance = points.reduce((s, p) => s + (p.x - mx) ** 2 + (p.y - my) ** 2, 0) / points.length;
  return Math.sqrt(variance);
};

/** Measure every qualifying session under <root>/golden. */
export function measureJitter(root = "fixtures", repoRoot: string = path.resolve(__dirname, "..", "..")): SessionJitter[] {
  const goldenDir = path.join(repoRoot, root, "golden");
  if (!existsSync(goldenDir)) return [];
  const sessionDirs = existsSync(path.join(goldenDir, "metadata.json"))
    ? [goldenDir]
    : readdirSync(goldenDir)
        .map((entry) => path.join(goldenDir, entry))
        .filter((full) => statSync(full).isDirectory());

  const out: SessionJitter[] = [];
  for (const dir of sessionDirs) {
    const metaPath = path.join(dir, "metadata.json");
    if (!existsSync(metaPath)) continue;
    const metadata = parseSessionMetadata(readFileSync(metaPath, "utf8"));
    if (metadata === null || metadata.stills.length < 5) continue;

    // Anchor pixels per still, from the stored normalised landmarks × the still's own size.
    const perAnchorPx = ANCHOR_LANDMARKS.map(({ index }) =>
      metadata.stills.map((still) => ({
        x: still.landmarks[index].x * still.width,
        y: still.landmarks[index].y * still.height,
      })),
    );

    // Reference homography from the component-wise MEDIAN anchor positions.
    const medianAnchors = perAnchorPx.map((points) => ({
      x: median(points.map((p) => p.x)),
      y: median(points.map((p) => p.y)),
    }));
    const targets = canonicalAnchors(4, RECTIFIED_SIZE);
    const reference = targets === null ? null : solveHomography(medianAnchors, targets);

    const anchors: AnchorJitter[] = ANCHOR_LANDMARKS.map(({ name }, at) => {
      const stillPoints = perAnchorPx[at];
      const canonicalPoints =
        reference === null
          ? []
          : stillPoints
              .map((p) => applyHomography(reference, p))
              .filter((p): p is { x: number; y: number } => p !== null);
      return {
        name,
        stdStillPx: radialStd(stillPoints),
        stdCanonicalPx: canonicalPoints.length === stillPoints.length ? radialStd(canonicalPoints) : NaN,
      };
    });
    out.push({
      sessionId: metadata.sessionId,
      stills: metadata.stills.length,
      anchors,
      meanStillPx: anchors.reduce((s, a) => s + a.stdStillPx, 0) / anchors.length,
      meanCanonicalPx: anchors.reduce((s, a) => s + a.stdCanonicalPx, 0) / anchors.length,
    });
  }
  return out;
}
