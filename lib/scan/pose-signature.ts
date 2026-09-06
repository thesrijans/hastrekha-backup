/**
 * Pose signature and the pose-duplicate guard — moved here from lib/scan/dev/still-capture.ts
 * (capture lane B) so production code can apply the SAME rule. The dev module re-exports these
 * names unchanged, so every capture-harness caller and test is untouched.
 *
 * Why production needs it: multi-frame super-resolution (`superres.ts`) may only fuse frames of
 * ONE pose. Rectification maps every frame of a palm onto the same canonical crop, but a palm is
 * not a plane — across a real tilt the residual misregistration is several canonical pixels in
 * places, which fusion would turn into blur. The guard that already decides "same pose, re-shot"
 * for the eval set is exactly the admission rule the live frame ring needs.
 *
 * Pure. Imports nothing.
 */

/** Centroid distance under this fraction of the still width counts as the same pose… */
export const POSE_DUP_RADIUS = 0.04;

/** …when the palm scale also matches within this relative tolerance. */
export const POSE_DUP_SCALE_TOLERANCE = 0.05;

export interface PoseSignature {
  /** Anchor centroid, still px. */
  readonly cx: number;
  readonly cy: number;
  /** Mean anchor distance from the centroid — the palm's apparent size, still px. */
  readonly scale: number;
}

/** Pose signature of one still's crop anchors (`[x, y]` pairs in still px). */
export function poseSignature(anchors: readonly (readonly number[])[]): PoseSignature {
  let cx = 0;
  let cy = 0;
  for (const [x, y] of anchors) {
    cx += x;
    cy += y;
  }
  cx /= anchors.length;
  cy /= anchors.length;
  let scale = 0;
  for (const [x, y] of anchors) scale += Math.hypot(x - cx, y - cy);
  return { cx, cy, scale: scale / anchors.length };
}

/**
 * Index of the first accepted still the candidate near-duplicates, or null. Near-duplicate =
 * centroid within {@link POSE_DUP_RADIUS} of the still width AND scale within
 * {@link POSE_DUP_SCALE_TOLERANCE} relative — one hand held in one pose, re-shot. Duplicates are
 * MARKED, never blocked: the labeler and eval need to know, the person capturing does not need to
 * be interrupted.
 */
export function findPoseDuplicate(
  existing: readonly { readonly index: number; readonly signature: PoseSignature }[],
  candidate: PoseSignature,
  stillWidth: number,
): number | null {
  for (const prior of existing) {
    const centroidPx = Math.hypot(candidate.cx - prior.signature.cx, candidate.cy - prior.signature.cy);
    const scaleBase = Math.max(prior.signature.scale, 1e-6);
    const scaleDelta = Math.abs(candidate.scale - prior.signature.scale) / scaleBase;
    if (centroidPx <= POSE_DUP_RADIUS * stillWidth && scaleDelta <= POSE_DUP_SCALE_TOLERANCE) {
      return prior.index;
    }
  }
  return null;
}
