/**
 * The scan's pipeline profile (M1.4) — how much work one device is asked to do per second.
 *
 * Three knobs, all chosen once when the camera opens and held for the session:
 *
 *   landmarker   MediaPipe's full hand-landmark model, or its lite sibling. The lite bundle
 *                (public/models/hand_landmarker_lite.task, built by
 *                scripts/models/build-hand-landmarker-lite.py) swaps in the LITE landmark model and
 *                keeps the FULL palm detector: in VIDEO mode the detector runs only when tracking is
 *                lost, so the per-frame cost is the landmark model's alone, and the lite detector was
 *                what cost accuracy — on the 15 session stills, lite+lite landmarks sat 9.2 px (max
 *                47) off the full model's, lite landmarks behind the full detector 6.0 px (max 15),
 *                at the same 11 ms against the full model's 33 (CPU, 1280-wide frames).
 *   capture      1280×720, or 480p. Every per-frame read-back — the luma sample, rectification's
 *                bilinear pull, the landmarker's own resize — scales with the frame.
 *   extraction   how often lines are thinned, traced and completed: the most expensive CPU step, and
 *                one that does not need to keep pace with inference.
 *
 * HIGH keeps exactly what /scan has always run (FULL_SCAN_PROFILE is the hook's default, so a caller
 * that passes no profile is byte-identical). MID, LOW and FLOOR get the lite profile. FLOOR is also the
 * reduced-motion tier, so a reader who asked for stillness on a fast device gets the lighter scan too:
 * the tier cannot tell those two apart, and the safe direction is the lighter one.
 */
import type { CapabilityTier } from "@/components/sanctuary/use-capability-tier";

export interface ScanProfile {
  readonly name: "full" | "lite";
  readonly landmarker: "full" | "lite";
  readonly captureWidth: number;
  readonly captureHeight: number;
  readonly extractIntervalMs: number;
}

/** What /scan has always run, and what HIGH keeps. The hook's EXTRACT_INTERVAL_MS and ideal size, unchanged. */
export const FULL_SCAN_PROFILE: ScanProfile = {
  name: "full",
  landmarker: "full",
  captureWidth: 1280,
  captureHeight: 720,
  extractIntervalMs: 700,
};

/** MID and below: the lite landmark model, 480p (16:9, like the full profile, so the cover crop is the same shape), 900 ms. */
export const LITE_SCAN_PROFILE: ScanProfile = {
  name: "lite",
  landmarker: "lite",
  captureWidth: 854,
  captureHeight: 480,
  extractIntervalMs: 900,
};

export function scanProfileFor(capabilityTier: CapabilityTier): ScanProfile {
  return capabilityTier === "HIGH" ? FULL_SCAN_PROFILE : LITE_SCAN_PROFILE;
}
