/**
 * May this device run the room as a scene rather than as a composition?
 *
 * §6.2 [R7] gives the rule: the room is Three.js "on `HIGH`, and on `MID` where
 * WebGL2 is available", and everything else gets the CSS layers. The capability
 * tier answers the first half — it measures memory, cores and a frame sample —
 * but it deliberately never touches a GL context, because creating one costs a
 * context on a device that may be about to hand the GPU to MediaPipe.
 *
 * So the question is asked here instead, once, at the moment something is about
 * to mount a canvas, and the answer is cached for the session. A device that
 * cannot give us WebGL2 falls back to the layers that were already painted,
 * which is why the fallback is never a blank frame.
 *
 * THE SCAN ROUTES ARE NOT NEGOTIABLE. §6.2 and §6.3 both say it: zero WebGL on
 * any route while the camera is scanning, because MediaPipe owns the GPU there.
 * That is enforced by the room simply not existing on those routes, and by
 * test/sanctuary-webgl.test.ts walking the scan trees for any import of this
 * module or of three.
 */
import type { CapabilityTier } from "@/components/sanctuary/use-capability-tier";

/** Tiers that may mount a scene at all, before WebGL2 is even asked about. */
export const WEBGL_TIERS: readonly CapabilityTier[] = ["MID", "HIGH"];

let cached: boolean | null = null;

/**
 * Does this browser give us a WebGL2 context?
 *
 * The probe context is released immediately via `WEBGL_lose_context`. Browsers
 * cap the number of live contexts per page (commonly 8–16) and silently drop
 * the oldest when the cap is passed, so a probe that kept its context could
 * cost the room the one it is about to ask for.
 */
export function hasWebGL2(): boolean {
  if (cached !== null) return cached;
  if (typeof document === "undefined") return false;
  try {
    const canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl2");
    if (gl === null) {
      cached = false;
      return false;
    }
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    cached = true;
    return true;
  } catch {
    cached = false;
    return false;
  }
}

/** Reset the cached answer. Tests only — a real session's answer cannot change. */
export function resetWebGL2Cache(): void {
  cached = null;
}

/**
 * The whole gate: tier allows a scene AND the context exists AND motion is wanted.
 *
 * `prefers-reduced-motion` is already folded into the tier (it forces FLOOR),
 * so it is not re-read here; doing so in two places is how the two answers
 * drift apart.
 */
export function roomMayRenderScene(tier: CapabilityTier): boolean {
  return WEBGL_TIERS.includes(tier) && hasWebGL2();
}
