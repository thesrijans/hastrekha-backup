"use client";

import { useEffect, useRef, useSyncExternalStore, type CSSProperties, type ReactElement } from "react";
import type { PlateLayer, PlateManifest } from "@/lib/sanctuary/plate-manifest";
/* [R6] The one `CapabilityTier` in the sanctuary, imported rather than redeclared. `import type`
 * erases at compile time, so this costs no bundle weight and creates no client-boundary coupling —
 * a second identical union would still have been a second thing to keep in step, and the whole
 * point of R6 is that there is exactly one spelling of this idea. */
import type { CapabilityTier } from "@/components/sanctuary/use-capability-tier";

/**
 * One pre-rendered parallax layer of a sanctuary scene.
 *
 * §6.2 builds the room out of stacked plates — far architecture, mid props, near candles, a dust
 * layer in front — with only the pedestal and the book alive. This component is that stack's unit:
 * a `<picture>` that serves AVIF with a WebP fallback across three densities (§10), drifts a few
 * pixels against pointer and device tilt (§9), and stops dead at the FLOOR tier.
 *
 * It renders no scenery of its own and holds no scene state. Everything it knows about the plate
 * comes out of a manifest the build script wrote (scripts/plates/build-plates.mjs), which is why
 * `lib/sanctuary/plate-manifest.ts` validates that manifest before anything reaches here.
 */

/** §9: desktop and tablet get pointer + device tilt, clamped to ±12 px. */
export const PARALLAX_MAX_DESKTOP_PX = 12;

/** §9: mobile parallax is tilt-driven and clamped harder, to ±8 px. */
export const PARALLAX_MAX_MOBILE_PX = 8;

/**
 * Which §9 clamp applies. Split by pointer coarseness rather than viewport width: a 1024px tablet
 * held in two hands is the mobile case, and a narrow desktop window is not.
 */
export type ParallaxSurface = "desktop" | "mobile";

/**
 * How much of the surface clamp each depth band actually spends.
 *
 * Parallax reads as depth only when the layers disagree — if every plate slid 12 px the stack would
 * look like one flat picture on a slow gimbal. Far architecture barely moves, the dust layer moves
 * the full budget, which is the same ordering §3 gives ("far architecture, mid props, near dust")
 * and the 0.02 px/frame drift it asks of the foreground.
 */
export const PLATE_DEPTH_FACTOR: Readonly<Record<PlateLayer, number>> = {
  far: 0.25,
  mid: 0.55,
  near: 0.85,
  dust: 1,
};

/**
 * Explicit stacking order per depth band.
 *
 * Paint order is not enough here. `/scan` mirrors its camera feed with
 * `transform: "scaleX(-1)"` (app/scan/scan-client.tsx:475), and a transformed element creates its
 * own stacking context — so a plate that merely appears earlier in the DOM can still land in front
 * of, or behind, the wrong thing once the Chamber composites over it. Every plate states its layer
 * number out loud instead, and the `z` prop lets one scene override without editing this table.
 */
export const PLATE_Z_INDEX: Readonly<Record<PlateLayer, number>> = {
  far: 0,
  mid: 10,
  near: 20,
  dust: 30,
};

/**
 * The plate is inset by the largest possible shift on every side, so the ±12 px drift can never
 * pull a hard edge into frame. Bleed rather than an overscale transform: scaling a plate resamples
 * it on the GPU and softens the 1px gold linework §3 is built on.
 */
const PARALLAX_BLEED_PX = PARALLAX_MAX_DESKTOP_PX;

/**
 * Exponential-follow time constant. Settles to ~95% in three constants (≈660 ms), inside §3's
 * 400–800 ms window. A follow, never a spring: a spring overshoots, and §3 says nothing bounces.
 */
const FOLLOW_TIME_CONSTANT_MS = 220;

/** Tilt in degrees that counts as full deflection. Beyond it the clamp holds the plate steady. */
const TILT_FULL_DEFLECTION_DEG = 24;

/** Phones are read at a slant, not flat on a table, so neutral `beta` is a lean, not zero. */
const TILT_NEUTRAL_BETA_DEG = 45;

/** Longest frame gap the damper will integrate, so a backgrounded tab does not snap on return. */
const MAX_FRAME_DT_MS = 64;

/** Inputs to the one place that decides how far a plate is allowed to move. */
export interface ParallaxClampInput {
  /** Raw, unclamped displacement in px, positive or negative, before depth is applied. */
  readonly offsetPx: number;
  /** Depth band of the plate being moved. */
  readonly layer: PlateLayer;
  /** Which §9 clamp applies. */
  readonly surface: ParallaxSurface;
  /** §10 tier; FLOOR pins the plate. */
  readonly capability: CapabilityTier;
}

/**
 * The §9 clamp, as a pure function so it can be tested without a browser.
 *
 * Every pixel of plate movement in the sanctuary passes through here. That matters because the
 * failure it prevents is not cosmetic: an unclamped tilt reading on a phone in a moving car swings
 * a backdrop across the screen, and this product is shown to people sitting still and reading about
 * their own lives. FLOOR returns exactly 0 — not "almost zero" — so the static tier is provably
 * static, and a non-finite reading from a broken sensor is treated as no movement at all.
 */
export function clampParallaxOffset({ offsetPx, layer, surface, capability }: ParallaxClampInput): number {
  if (capability === "FLOOR") return 0;
  if (!Number.isFinite(offsetPx)) return 0;
  const max = surface === "mobile" ? PARALLAX_MAX_MOBILE_PX : PARALLAX_MAX_DESKTOP_PX;
  return Math.min(max, Math.max(-max, offsetPx * PLATE_DEPTH_FACTOR[layer]));
}

/**
 * `srcSet` for one format across all three densities.
 *
 * Density descriptors rather than widths: a plate is a full-bleed backdrop whose CSS size is the
 * stage, so the browser's only real question is how many device pixels that stage has.
 */
export function plateSrcSet(manifest: PlateManifest, format: "avif" | "webp"): string {
  return manifest.densities.map((density) => `${density[format]} ${density.scale}x`).join(", ");
}

/* Subscribe/snapshot pairs, matching the useSyncExternalStore idiom already used in
 * components/scan/deep-scan-flash.tsx: a live browser query mirrored into state by an effect is
 * both a lint error and the wrong shape, and this gets the server snapshot right for free. */

function subscribeQuery(query: string, onChange: () => void): () => void {
  if (typeof window === "undefined") return () => undefined;
  const media = window.matchMedia(query);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";
const COARSE_POINTER_QUERY = "(pointer: coarse)";

function subscribeReducedMotion(onChange: () => void): () => void {
  return subscribeQuery(REDUCED_MOTION_QUERY, onChange);
}

function getReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia(REDUCED_MOTION_QUERY).matches;
}

function subscribeSurface(onChange: () => void): () => void {
  return subscribeQuery(COARSE_POINTER_QUERY, onChange);
}

function getSurface(): ParallaxSurface {
  if (typeof window === "undefined") return "desktop";
  return window.matchMedia(COARSE_POINTER_QUERY).matches ? "mobile" : "desktop";
}

function serverSurface(): ParallaxSurface {
  return "desktop";
}

function serverReducedMotion(): boolean {
  return false;
}

/** Props for one plate in a scene stack. */
export interface ScenePlateProps {
  /** The validated manifest for this plate. Carries its own alt text, layer and densities. */
  readonly manifest: PlateManifest;
  /** [R6] §10 capability tier. Never named `tier`, never abbreviated. */
  readonly capability: CapabilityTier;
  /**
   * True only for plates of the camera the user is looking at right now. §10 puts `fetchpriority`
   * on the current camera only; marking every plate high-priority is the same as marking none.
   */
  readonly priority?: boolean;
  /** Overrides the layer's default stacking number when one scene needs a different order. */
  readonly z?: number;
  /** Extra classes for the positioning wrapper. */
  readonly className?: string;
}

/**
 * Renders a plate and, above FLOOR, drifts it.
 *
 * Reduced motion is checked here directly rather than left to app/globals.css. That global block
 * zeroes `animation-duration` and `transition-duration`, and this component uses neither — the
 * drift is a transform written straight onto the node from a rAF loop, which CSS cannot switch off.
 * A plate that ignored the preference would keep sliding on exactly the machine that asked it not
 * to, so the preference is enforced where the movement is: no listeners, no loop, no transform.
 */
export function ScenePlate({ manifest, capability, priority = false, z, className }: ScenePlateProps): ReactElement {
  const frameRef = useRef<HTMLDivElement | null>(null);
  const reduced = useSyncExternalStore(subscribeReducedMotion, getReducedMotion, serverReducedMotion);
  const surface = useSyncExternalStore(subscribeSurface, getSurface, serverSurface);

  const { layer, alt, densities } = manifest;
  const base = densities[0];
  const isStatic = capability === "FLOOR" || reduced;

  useEffect(() => {
    const node = frameRef.current;
    if (node === null) return;

    /* FLOOR and reduced motion take the same exit: nothing is attached, nothing is written. */
    if (isStatic) {
      node.style.transform = "";
      return;
    }

    const maxPx = surface === "mobile" ? PARALLAX_MAX_MOBILE_PX : PARALLAX_MAX_DESKTOP_PX;
    const pointer = { x: 0, y: 0 };
    const tilt = { x: 0, y: 0 };
    const target = { x: 0, y: 0 };
    const current = { x: 0, y: 0 };
    let frame = 0;
    let previous = 0;

    const unit = (value: number): number => Math.min(1, Math.max(-1, value));

    const retarget = (): void => {
      /* §9: mobile is tilt-only; desktop and tablet add the pointer. The sum is deliberately
       * allowed to exceed one unit — the clamp below is the authority on how far a plate goes. */
      const unitX = surface === "mobile" ? tilt.x : pointer.x + tilt.x;
      const unitY = surface === "mobile" ? tilt.y : pointer.y + tilt.y;
      /* Negated: the room counter-moves against the viewer, which is what reads as depth. */
      target.x = clampParallaxOffset({ offsetPx: -unitX * maxPx, layer, surface, capability });
      target.y = clampParallaxOffset({ offsetPx: -unitY * maxPx, layer, surface, capability });
    };

    const onPointerMove = (event: PointerEvent): void => {
      const { innerWidth, innerHeight } = window;
      if (innerWidth === 0 || innerHeight === 0) return;
      pointer.x = unit((event.clientX / innerWidth) * 2 - 1);
      pointer.y = unit((event.clientY / innerHeight) * 2 - 1);
      retarget();
    };

    /* iOS 13+ gates deviceorientation behind a permission call that only a user gesture may make.
     * Attaching regardless is correct and silent: no events arrive until something else in the app
     * has asked, and the pointer path already carries desktop. */
    const onOrientation = (event: DeviceOrientationEvent): void => {
      tilt.x = unit((event.gamma ?? 0) / TILT_FULL_DEFLECTION_DEG);
      tilt.y = unit(((event.beta ?? 0) - TILT_NEUTRAL_BETA_DEG) / TILT_FULL_DEFLECTION_DEG);
      retarget();
    };

    const tick = (now: number): void => {
      const dt = previous === 0 ? MAX_FRAME_DT_MS : Math.min(now - previous, MAX_FRAME_DT_MS);
      previous = now;
      /* Frame-rate independent damped follow. No spring term, so it cannot overshoot (§3). */
      const k = 1 - Math.exp(-dt / FOLLOW_TIME_CONSTANT_MS);
      current.x += (target.x - current.x) * k;
      current.y += (target.y - current.y) * k;
      node.style.transform = `translate3d(${current.x.toFixed(2)}px, ${current.y.toFixed(2)}px, 0)`;
      frame = window.requestAnimationFrame(tick);
    };

    if (surface === "desktop") window.addEventListener("pointermove", onPointerMove, { passive: true });
    window.addEventListener("deviceorientation", onOrientation, { passive: true });
    frame = window.requestAnimationFrame(tick);

    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("deviceorientation", onOrientation);
      node.style.transform = "";
    };
  }, [isStatic, surface, layer, capability]);

  const style: CSSProperties = {
    position: "absolute",
    inset: `${-PARALLAX_BLEED_PX}px`,
    zIndex: z ?? PLATE_Z_INDEX[layer],
    /* Only promote to a compositor layer where something will actually move. */
    willChange: isStatic ? undefined : "transform",
    pointerEvents: "none",
  };

  return (
    <div ref={frameRef} style={style} className={className} data-plate={manifest.id} data-layer={layer}>
      <picture>
        <source type="image/avif" srcSet={plateSrcSet(manifest, "avif")} />
        <source type="image/webp" srcSet={plateSrcSet(manifest, "webp")} />
        {/* A bare <img>, not next/image: the loader cannot emit a multi-format <picture>, and §10
            pins AVIF-with-WebP-fallback at three densities as the plate contract. The files are
            already sized, encoded and byte-measured by scripts/plates/build-plates.mjs, so the
            optimiser would have nothing left to do but re-host them. */}
        <img
          src={base.webp}
          srcSet={plateSrcSet(manifest, "webp")}
          width={base.width}
          height={base.height}
          alt={alt}
          decoding="async"
          draggable={false}
          loading={priority ? "eager" : "lazy"}
          fetchPriority={priority ? "high" : undefined}
          style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
        />
      </picture>
    </div>
  );
}
