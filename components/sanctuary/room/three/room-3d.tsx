"use client";

/**
 * The gate in front of the scene: who gets it, when it loads, and how it draws.
 *
 * This component is tiny and eager; the scene it may load is large and lazy.
 * §10 gives the Sanctuary 140 kB of initial JS and the 3D chunk a separate
 * 200 kB ceiling "lazy, after idle", so the cost of the room must not be
 * payable by a device that will never render it.
 *
 * FIVE CONDITIONS, ALL REQUIRED:
 *
 *  1. the measured capability tier is MID or HIGH (§6.2 [R7]) — on a phone
 *     that is four cores, four gigabytes and an idle frame under 26 ms;
 *  2. the browser actually gives us a WebGL2 context, asked once and released
 *     immediately (lib/sanctuary/webgl.ts);
 *  3. the stage has been ON SCREEN. Home renders two stages — the room for a
 *     wide landscape screen, the vignette for everything else — and the
 *     stylesheet hides one. An IntersectionObserver never reports a box-less
 *     element intersecting, so the hidden stage never asks for the chunk: a
 *     phone downloads Three.js once, for the vignette it can see (M1.1);
 *  4. the browser is idle — the CSS composition has already painted, and the
 *     scene is an upgrade over a room that is already there;
 *  5. the loop runs only while the stage is on screen and the tab is visible.
 *
 * TWO PROFILES (room-canvas.tsx): `full` for the room — DPR up to 2 and the
 * post stack; `phone` for the vignette — DPR 1, no post, one frame in two.
 *
 * A PLAIN import(), NOT next/dynamic. The first version used next/dynamic and
 * it cost the Sanctuary's first load 1.8 kB gz of loadable wrapper, taking the
 * route from 138.9 to 140.7 kB against a 140 kB budget. The canvas only ever
 * mounts after an effect has run on the client, so there is nothing for
 * next/dynamic's server handling to do; a dynamic import() held in state is
 * split into its own chunk by the bundler exactly the same way.
 *
 * IT FADES IN ON ITS FIRST COMPLETE FRAME, NOT ON MOUNT. §6.2: the composition
 * "paints first for everyone and the 3D scene fades over it when ready, so
 * there is no blank frame". The canvas reports its first frame only once the
 * hand and the zodiac have arrived and been drawn; the plate underneath was
 * baked from this same scene at rest (public/plates/hand-hologram), so the
 * 600 ms crossfade is between two pictures of the same thing.
 */
import { useEffect, useState, type ComponentType } from "react";
import { useCapabilityTier } from "@/components/sanctuary/use-capability-tier";
import { roomMayRenderScene } from "@/lib/sanctuary/webgl";
import type { RoomCanvasProps, RoomProfile } from "./room-canvas";

/** How long after idle to wait before asking for the chunk, if requestIdleCallback is missing. */
export const ROOM_SCENE_IDLE_FALLBACK_MS = 1200;

/** How long the scene takes to fade over the composition. */
export const ROOM_SCENE_FADE_MS = 600;

export interface Room3DProps {
  /** The stage element's id, so the scene loads once that stage is seen and runs only while it is. */
  readonly roomId: string;
  readonly profile?: RoomProfile;
}

export function Room3D({ roomId, profile = "full" }: Room3DProps): React.ReactElement | null {
  const tier = useCapabilityTier();
  const [Canvas, setCanvas] = useState<ComponentType<RoomCanvasProps> | null>(null);
  const [active, setActive] = useState(true);
  const [shown, setShown] = useState(false);
  const [lost, setLost] = useState(false);

  /* 1 + 2 — may we? 3 + 4 — once the stage has been seen, and the browser is idle, load.
     5 — stop the loop while the stage is off screen or the tab is hidden. */
  useEffect(() => {
    if (!roomMayRenderScene(tier)) return undefined;
    const room = document.getElementById(roomId);
    if (room === null) return undefined;

    let cancelled = false;
    let onScreen = false;
    let asked = false;
    let idle: number | null = null;
    let idleIsTimer = false;

    const load = (): void => {
      idle = null;
      void import("./room-canvas").then((module) => {
        if (!cancelled) setCanvas(() => module.default);
      });
    };
    const askWhenIdle = (): void => {
      if (asked) return;
      asked = true;
      if (typeof requestIdleCallback === "function") {
        idle = requestIdleCallback(load, { timeout: ROOM_SCENE_IDLE_FALLBACK_MS });
      } else {
        idleIsTimer = true;
        idle = window.setTimeout(load, ROOM_SCENE_IDLE_FALLBACK_MS);
      }
    };
    const update = (): void => setActive(onScreen && document.visibilityState === "visible");
    const observer = new IntersectionObserver(
      ([entry]) => {
        onScreen = entry !== undefined && entry.isIntersecting;
        if (onScreen) askWhenIdle();
        update();
      },
      { threshold: 0.1 },
    );
    observer.observe(room);
    document.addEventListener("visibilitychange", update);
    return () => {
      cancelled = true;
      observer.disconnect();
      document.removeEventListener("visibilitychange", update);
      if (idle !== null) {
        if (idleIsTimer) window.clearTimeout(idle);
        else cancelIdleCallback(idle);
      }
    };
  }, [tier, roomId]);

  if (Canvas === null || lost) return null;

  return (
    <div
      aria-hidden="true"
      // "live" once the first complete frame is up: the island (home-island.tsx)
      // reads it to move the 3D camera instead of CSS-scaling a canvas that has its own.
      data-snc-room-scene={shown ? "live" : "loading"}
      style={{
        position: "absolute",
        inset: 0,
        opacity: shown ? 1 : 0,
        transition: `opacity ${ROOM_SCENE_FADE_MS}ms ease-out`,
        pointerEvents: "none",
      }}
    >
      <Canvas profile={profile} active={active} onFirstFrame={() => setShown(true)} onLost={() => setLost(true)} />
    </div>
  );
}
