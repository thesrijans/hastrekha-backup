"use client";

/**
 * The gate in front of the scene: who gets it, and when it loads.
 *
 * This component is tiny and eager; the scene it may load is large and lazy.
 * §10 gives the Sanctuary 140 kB of initial JS and the 3D chunk a separate
 * 200 kB ceiling "lazy, after idle", so the cost of the room must not be
 * payable by a device that will never render it.
 *
 * FOUR CONDITIONS, ALL REQUIRED:
 *
 *  1. the measured capability tier is MID or HIGH (§6.2 [R7]);
 *  2. the browser actually gives us a WebGL2 context, asked once and released
 *     immediately (lib/sanctuary/webgl.ts);
 *  3. the browser is idle — the CSS composition has already painted, and the
 *     scene is an upgrade over a room that is already there;
 *  4. the room is on screen and the tab is visible.
 *
 * A PLAIN import(), NOT next/dynamic. The first version used next/dynamic and
 * it cost the Sanctuary's first load 1.8 kB gz of loadable wrapper, taking the
 * route from 138.9 to 140.7 kB against a 140 kB budget. The canvas only ever
 * mounts after an effect has run on the client, so there is nothing for
 * next/dynamic's server handling to do; a dynamic import() held in state is
 * split into its own chunk by the bundler exactly the same way.
 *
 * IT FADES IN ON ITS FIRST DRAWN FRAME, NOT ON MOUNT. §6.2: the composition
 * "paints first for everyone and the 3D scene fades over it when ready, so
 * there is no blank frame". Fading on mount would fade in a black canvas for
 * the few frames before the renderer has drawn anything.
 */
import { useEffect, useState, type ComponentType } from "react";
import { useCapabilityTier } from "@/components/sanctuary/use-capability-tier";
import { roomMayRenderScene } from "@/lib/sanctuary/webgl";
import type { RoomCanvasProps } from "./room-canvas";

/** How long after idle to wait before asking for the chunk, if requestIdleCallback is missing. */
export const ROOM_SCENE_IDLE_FALLBACK_MS = 1200;

/** How long the scene takes to fade over the composition. */
export const ROOM_SCENE_FADE_MS = 900;

export interface Room3DProps {
  /** The stage element's id, so the scene only runs while that room is on screen. */
  readonly roomId: string;
}

export function Room3D({ roomId }: Room3DProps): React.ReactElement | null {
  const tier = useCapabilityTier();
  const [Canvas, setCanvas] = useState<ComponentType<RoomCanvasProps> | null>(null);
  const [active, setActive] = useState(true);
  const [shown, setShown] = useState(false);
  const [lost, setLost] = useState(false);

  /* 1 + 2 + 3 — may we, and is the browser done with more important work? */
  useEffect(() => {
    if (!roomMayRenderScene(tier)) return undefined;

    let cancelled = false;
    const load = (): void => {
      void import("./room-canvas").then((module) => {
        if (!cancelled) setCanvas(() => module.default);
      });
    };

    if (typeof requestIdleCallback === "function") {
      const handle = requestIdleCallback(load, { timeout: ROOM_SCENE_IDLE_FALLBACK_MS });
      return () => {
        cancelled = true;
        cancelIdleCallback(handle);
      };
    }
    const timer = window.setTimeout(load, ROOM_SCENE_IDLE_FALLBACK_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [tier]);

  /* 4 — stop the loop when the room leaves the screen or the tab is hidden. */
  useEffect(() => {
    if (Canvas === null) return undefined;
    const room = document.getElementById(roomId);
    if (room === null) return undefined;

    let onScreen = true;
    const update = (): void => setActive(onScreen && document.visibilityState === "visible");
    const observer = new IntersectionObserver(
      ([entry]) => {
        onScreen = entry !== undefined && entry.isIntersecting;
        update();
      },
      { threshold: 0.1 },
    );
    observer.observe(room);
    document.addEventListener("visibilitychange", update);
    return () => {
      observer.disconnect();
      document.removeEventListener("visibilitychange", update);
    };
  }, [Canvas, roomId]);

  if (Canvas === null || lost) return null;

  return (
    <div
      aria-hidden="true"
      // "live" once the first frame is up: the island (home-island.tsx) reads it
      // to move the 3D camera instead of CSS-scaling a canvas that has its own.
      data-snc-room-scene={shown ? "live" : "loading"}
      style={{
        position: "absolute",
        inset: 0,
        opacity: shown ? 1 : 0,
        transition: `opacity ${ROOM_SCENE_FADE_MS}ms ease-out`,
        pointerEvents: "none",
      }}
    >
      <Canvas active={active} onFirstFrame={() => setShown(true)} onLost={() => setLost(true)} />
    </div>
  );
}
