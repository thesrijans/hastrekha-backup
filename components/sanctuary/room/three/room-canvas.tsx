"use client";

/**
 * The canvas the room is drawn on. This module is the CHUNK BOUNDARY.
 *
 * Everything the 3D room costs is reached from here and from nothing else:
 * the renderer, the world, the post stack. room-3d.tsx reaches it through a
 * dynamic import(), so a device that never qualifies for a scene never
 * downloads any of it. Written against Three.js directly, not React Three Fiber — R3F's
 * own floor is 227.6 kB gz against a 200 kB ceiling (spec [R9]).
 *
 * DPR IS CAPPED AT 2. A phone at devicePixelRatio 3 would render 2.25x the
 * pixels of the same scene at 2 for a difference nobody sees at arm's length,
 * and it is the single cheapest thing that keeps a mid-range Android at 30 fps.
 *
 * THE LOOP STOPS WHEN THE ROOM IS NOT SEEN. `active` goes false when the room
 * scrolls away or the tab hides; the frame loop then does not run at all
 * rather than rendering frames no one sees.
 *
 * A LOST CONTEXT DEGRADES, IT DOES NOT BREAK. The CSS composition is still in
 * the DOM beneath this canvas and still painted. On `webglcontextlost` the loop
 * stops and the gate fades the canvas out, leaving that composition showing.
 */
import { useEffect, useRef } from "react";
import { ACESFilmicToneMapping, FloatType, SRGBColorSpace, WebGLRenderer, WebGLRenderTarget } from "three";
import { buildPost } from "./post";
import { buildWorld } from "./world";

export const ROOM_MAX_DPR = 2;

export interface RoomCanvasProps {
  /** Whether the loop runs. Off under a hidden tab or an off-screen room. */
  readonly active: boolean;
  /** Called once the room has drawn its first frame, so the gate can fade it in. */
  readonly onFirstFrame?: () => void;
  /** Called if the GL context is lost, so the gate can fall back. */
  readonly onLost?: () => void;
}

export default function RoomCanvas({ active, onFirstFrame, onLost }: RoomCanvasProps): React.ReactElement {
  const host = useRef<HTMLDivElement>(null);
  const activeRef = useRef(active);
  const wake = useRef<(() => void) | null>(null);
  const callbacks = useRef({ onFirstFrame, onLost });

  // Kept current from an effect, never during render: the frame loop reads the
  // latest callbacks without the room being rebuilt when a parent re-renders.
  useEffect(() => {
    callbacks.current = { onFirstFrame, onLost };
  }, [onFirstFrame, onLost]);

  useEffect(() => {
    activeRef.current = active;
    if (active) wake.current?.();
  }, [active]);

  useEffect(() => {
    const element = host.current;
    if (element === null) return undefined;

    const renderer = new WebGLRenderer({ antialias: true, powerPreference: "high-performance", alpha: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, ROOM_MAX_DPR));
    renderer.toneMapping = ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    renderer.outputColorSpace = SRGBColorSpace;
    renderer.domElement.style.display = "block";
    renderer.domElement.style.width = "100%";
    renderer.domElement.style.height = "100%";
    element.appendChild(renderer.domElement);

    const world = buildWorld();
    const size = (): { w: number; h: number } => ({
      w: Math.max(1, element.clientWidth),
      h: Math.max(1, element.clientHeight),
    });
    const initial = size();
    renderer.setSize(initial.w, initial.h, false);
    const post = buildPost(renderer, world.scene, world.camera, initial.w, initial.h);

    // The canvas is the 16:9 `.set` box by its own CSS; resizing it changes
    // resolution, never the camera's aspect, so the stage registration holds.
    const observer = new ResizeObserver(() => {
      const { w, h } = size();
      renderer.setSize(w, h, false);
      post.setSize(w, h);
    });
    observer.observe(element);

    const started = performance.now();
    let frame = 0;
    let first = true;
    let lost = false;

    const draw = (): void => {
      const seconds = (performance.now() - started) / 1000;
      world.tick(seconds);
      post.render(seconds);
      if (first) {
        first = false;
        callbacks.current.onFirstFrame?.();
      }
    };

    const loop = (): void => {
      if (lost) return;
      draw();
      frame = activeRef.current ? requestAnimationFrame(loop) : 0;
    };

    wake.current = () => {
      if (frame === 0 && !lost) frame = requestAnimationFrame(loop);
    };

    const onContextLost = (event: Event): void => {
      event.preventDefault();
      lost = true;
      cancelAnimationFrame(frame);
      callbacks.current.onLost?.();
    };
    renderer.domElement.addEventListener("webglcontextlost", onContextLost);

    // The measurement hook, for scripts/capture/score-room.mjs and nothing else.
    //
    // The loop harness scores each art-direction item "with the measurement
    // that decided it", and several of Amendment 4's cannot be read off a
    // screenshot: whether bloom stays on the flames needs the room rendered
    // with and without it; whether the key is the only warm key needs the
    // lights themselves. So when the URL carries `snc-measure`, the room hands
    // its renderer to the page. It exposes nothing that page script could not
    // already reach, it is absent from every URL a reader follows, and it
    // costs the chunk a few hundred bytes.
    const measuring = new URLSearchParams(window.location.search).has("snc-measure");
    if (measuring) {
      (window as unknown as { __sncRoom?: unknown }).__sncRoom = {
        renderer,
        world,
        post,
        /** Stop the loop, so a measurement owns every frame it reads. */
        pause: () => {
          activeRef.current = false;
          cancelAnimationFrame(frame);
          frame = 0;
        },
        /** Render the room as it is at `seconds`, deterministically. */
        renderAt: (seconds: number) => {
          world.tick(seconds);
          post.render(seconds);
        },
        /**
         * A float target for reading LINEAR HDR — what the bloom pass sees.
         * Three tone-maps only what is drawn to the screen, so a render into
         * this is the scene before any curve, where "brighter than the bloom
         * threshold" is a real number rather than a clipped byte.
         */
        hdrTarget: (width: number, height: number) => new WebGLRenderTarget(width, height, { type: FloatType }),
      };
    }

    frame = requestAnimationFrame(loop);
    // Late arrivals (the hand, the zodiac) get a frame even if the loop is paused.
    void world.settled.then(() => {
      if (!lost && !activeRef.current) draw();
    });

    return () => {
      lost = true;
      cancelAnimationFrame(frame);
      observer.disconnect();
      renderer.domElement.removeEventListener("webglcontextlost", onContextLost);
      post.dispose();
      world.dispose();
      renderer.dispose();
      renderer.domElement.remove();
      wake.current = null;
    };
  }, []);

  return <div ref={host} style={{ position: "absolute", inset: 0 }} />;
}
