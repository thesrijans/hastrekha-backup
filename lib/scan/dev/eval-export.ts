/**
 * Stage the CURRENT /scan frame as an eval case (dev harness lane E, flag `scanDiagnostics`).
 *
 * A bad reading in the wild becomes a labelable fixture in one tap: the raw frame + landmarks +
 * anchors are packaged into the SAME session format /dev/capture stages — a one-still session in
 * the SessionStore — so /dev/label and the eval harness pick it up with zero new plumbing. The
 * writer is reused, never duplicated.
 *
 * This module is dynamically imported from `use-hand-scan` behind the flag — the ONE sanctioned
 * production→dev edge, allowlisted by name in test/import-boundary.test.ts. The dynamic import
 * keeps it out of the initial bundle; the flag (default false) keeps it out of runtime.
 */
import { palmAnchors, rectifyPalm } from "../rectify";
import { LM } from "../landmark-index";
import type { HandObservation, QualityVerdict } from "../types";
import { stillVolOfCrop } from "./still-capture";
import { CANONICAL_LABEL_SIZE, cropFileName, rawFileName, type CaptureStillRecord } from "./session-types";
import { openSessionStore } from "./session-store";

export interface EvalCaseInput {
  /** The raw, unmirrored video frame. */
  readonly frame: ImageData;
  readonly observation: HandObservation;
  readonly quality: QualityVerdict | null;
  /** Cheap frame stats from the scan loop, if it has them. */
  readonly stats?: { readonly luma: number; readonly clipped: number };
}

/**
 * Stage one frame as a one-still session. Returns the new sessionId, or throws with a reason the
 * caller can surface (no anchors, rectify failed, canvas unavailable).
 */
export async function stageEvalCase(input: EvalCaseInput): Promise<string> {
  const { frame, observation, quality } = input;
  const anchorSet = palmAnchors(observation.landmarks, frame.width, frame.height);
  if (anchorSet === null) throw new Error("anchors unavailable on this frame");
  const rectified = rectifyPalm(frame, anchorSet.src, CANONICAL_LABEL_SIZE);
  if (rectified === null) throw new Error("rectification failed on this frame");

  const toBlob = async (image: ImageData): Promise<Blob> => {
    const canvas = document.createElement("canvas");
    canvas.width = image.width;
    canvas.height = image.height;
    const context = canvas.getContext("2d");
    if (context === null) throw new Error("2d context unavailable");
    context.putImageData(image, 0, 0);
    return new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((b) => (b !== null ? resolve(b) : reject(new Error("toBlob null"))), "image/png");
    });
  };

  const chordDx = observation.landmarks[LM.PINKY_MCP].x - observation.landmarks[LM.INDEX_MCP].x;
  const chordDy = observation.landmarks[LM.PINKY_MCP].y - observation.landmarks[LM.INDEX_MCP].y;
  const record: CaptureStillRecord = {
    index: 0,
    rawFile: rawFileName(0),
    cropFile: cropFileName(0),
    // The frame comes off the preview stream — provenance-wise this IS the canvas grab path.
    capturePath: "canvas-fallback",
    width: frame.width,
    height: frame.height,
    landmarks: observation.landmarks,
    anchors: anchorSet.src.map((p) => [Number(p.x.toFixed(2)), Number(p.y.toFixed(2))] as const),
    quality: {
      score: quality?.score ?? 0,
      ok: quality?.ok ?? false,
      issues: quality?.issues ?? [],
      luma: input.stats?.luma ?? 0,
      clipped: input.stats?.clipped ?? 0,
      jitter: 0,
      sharpness: 0,
    },
    poseAngle: {
      rollDeg: Number(((Math.atan2(chordDy, chordDx) * 180) / Math.PI).toFixed(1)),
      windingStrength: quality?.facingReadout?.windingStrength ?? null,
    },
    trackSettings: {},
    capturedAt: new Date().toISOString(),
    stillVol: Number(stillVolOfCrop(rectified.image).toFixed(1)),
    attempts: 1,
  };

  const store = await openSessionStore();
  const hand = observation.handedness === "Left" ? "left" : "right";
  const session = await store.createSession(hand, CANONICAL_LABEL_SIZE);
  await store.addStill(session, record, await toBlob(frame), await toBlob(rectified.image));
  return session.sessionId;
}
