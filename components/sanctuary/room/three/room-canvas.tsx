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
 * THE CAMERA FOLLOWS THE ISLAND. app/sanctuary/home-island.tsx owns the click
 * that moves the camera before a route opens: it marks the room's set with
 * `data-snc-camera`. This canvas watches that attribute, moves its rig
 * (camera-rig.ts) over ROOM_CAMERA_MOVE_MS, and from the frame that draws the
 * camera at its destination dispatches ROOM_CAMERA_ARRIVED_EVENT on the set —
 * which is what the island routes on, so the route never opens over a camera
 * still short of where it was going. Pointer and tilt drive the rig's parallax
 * with the island's own mapping.
 *
 * A LOST CONTEXT DEGRADES, IT DOES NOT BREAK. The CSS composition is still in
 * the DOM beneath this canvas and still painted. On `webglcontextlost` the loop
 * stops and the gate fades the canvas out, leaving that composition showing.
 */
import { useEffect, useRef } from "react";
import { ACESFilmicToneMapping, FloatType, SRGBColorSpace, WebGLRenderer, WebGLRenderTarget } from "three";
import { CameraRig, ROOM_CAMERA_NAMES, TILT_FULL_DEFLECTION_DEG, TILT_NEUTRAL_BETA_DEG, type RoomCameraName } from "./camera-rig";
import { buildPost } from "./post";
import { buildWorld } from "./world";
import { ROOM_CAMERA_ARRIVED_EVENT, roomCameraTransform } from "@/lib/sanctuary/room-composition";

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
    const gl = renderer.getContext();

    const world = buildWorld();
    const size = (): { w: number; h: number } => ({
      w: Math.max(1, element.clientWidth),
      h: Math.max(1, element.clientHeight),
    });
    const initial = size();
    renderer.setSize(initial.w, initial.h, false);
    const post = buildPost(renderer, world.scene, world.camera, initial.w, initial.h);
    const rig = new CameraRig(world.camera, world.layout);

    /* The camera before the route: follow the island's mark on the set. */
    const set = element.closest<HTMLElement>("[data-snc-room-set]");
    const isName = (value: string | undefined): value is RoomCameraName =>
      value !== undefined && (ROOM_CAMERA_NAMES as string[]).includes(value);
    /* The words over the room are HTML, not scene: with no CSS push over a
       live scene they would only fade in place (`.set[data-snc-camera]
       .overlay`) while the room moved behind them. So the scene pushes them as
       the CSS camera would have — scaled about the same stage point, over the
       same move — and they leave the frame as they do in the drawn room. The
       origin is that point in their own box, from layout offsets (which no
       transform moves): the stage point, less their offset, less their own
       translate — read once here, as a fraction of their box, while still. */
    const words = set?.querySelector<HTMLElement>("[data-snc-room-overlay]") ?? null;
    const shift =
      set && words
        ? {
            x: (words.getBoundingClientRect().left - set.getBoundingClientRect().left - words.offsetLeft) / words.offsetWidth,
            y: (words.getBoundingClientRect().top - set.getBoundingClientRect().top - words.offsetTop) / words.offsetHeight,
          }
        : null;
    const pushWords = (name: RoomCameraName): void => {
      if (!set || !words || !shift) return;
      if (name === "sanctuary") {
        words.style.scale = "";
        return;
      }
      const { originX, originY, scale } = roomCameraTransform(name);
      const x = (parseFloat(originX) / 100) * set.offsetWidth - words.offsetLeft - shift.x * words.offsetWidth;
      const y = (parseFloat(originY) / 100) * set.offsetHeight - words.offsetTop - shift.y * words.offsetHeight;
      words.style.transformOrigin = `${x}px ${y}px`;
      words.style.scale = String(scale);
    };

    let arriving: RoomCameraName | null = null;
    const follow = (): void => {
      const name = set?.dataset.sncCamera;
      rig.goTo(isName(name) ? name : "sanctuary", performance.now());
      pushWords(rig.destination);
      arriving = rig.destination;
      wake.current?.();
    };
    const marks = set ? new MutationObserver(follow) : null;
    if (set && marks) marks.observe(set, { attributes: true, attributeFilter: ["data-snc-camera"] });

    /* Parallax, as the island maps it: pointer (not touch), and device tilt. */
    const onPointer = (event: PointerEvent): void => {
      if (event.pointerType === "touch") return;
      rig.look((event.clientX / window.innerWidth) * 2 - 1, (event.clientY / window.innerHeight) * 2 - 1);
    };
    const onTilt = (event: DeviceOrientationEvent): void => {
      if (event.gamma === null || event.beta === null) return;
      rig.look(event.gamma / TILT_FULL_DEFLECTION_DEG, (event.beta - TILT_NEUTRAL_BETA_DEG) / TILT_FULL_DEFLECTION_DEG);
    };
    window.addEventListener("pointermove", onPointer, { passive: true });
    window.addEventListener("deviceorientation", onTilt, { passive: true });

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
      const now = performance.now();
      const seconds = (now - started) / 1000;
      rig.apply(now);
      world.tick(seconds);
      post.render(seconds);
      // Hand the frame to the GPU now. Without this the commands of a frame's
      // six passes waited in the command buffer, and on ANGLE/D3D11 the room
      // stalled for ~200 ms every half second — at rest and in motion alike,
      // 5-7 stalls in every 4 s, where the same loop with this flush dropped
      // none in three alternating runs (scripts/capture/probe-stalls.mjs,
      // "full" vs "full+flush"). Found in U3b P3; the P2 capture's 216.8 ms
      // worst frame was this.
      gl.flush();
      if (arriving !== null && rig.progress(now) >= 1) {
        const camera = arriving;
        arriving = null;
        set?.dispatchEvent(new CustomEvent(ROOM_CAMERA_ARRIVED_EVENT, { detail: { camera } }));
      }
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
        rig,
        /** Stop the loop, and put the camera exactly at rest, so a measurement owns every frame it reads. */
        pause: () => {
          activeRef.current = false;
          cancelAnimationFrame(frame);
          frame = 0;
          rig.rest();
        },
        /** Run the loop again (a camera measurement needs the real frames). */
        resume: () => {
          activeRef.current = true;
          wake.current?.();
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
      marks?.disconnect();
      if (words) words.style.scale = "";
      window.removeEventListener("pointermove", onPointer);
      window.removeEventListener("deviceorientation", onTilt);
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
