"use client";

/**
 * Home's one behavioural island. It renders nothing; it does four small things
 * the server cannot:
 *
 *  1. writes the MEASURED capability tier onto each room, so the room's
 *     stylesheet decides what may move (flicker, dust, drift: MID and HIGH only);
 *  2. PARALLAX at MID and HIGH — one pointer listener and one tilt listener for
 *     every room, a damped follow on requestAnimationFrame that stops when it
 *     has arrived, and nothing at all while no room is on screen or the tab is
 *     hidden. Each layer's `translate` is written directly, scaled by its own
 *     depth and the token's clamp. It is NOT a custom property on the room:
 *     every SVG node in the room would inherit it and be restyled every frame;
 *  3. the CAMERA BEFORE THE ROUTE (B4): a click on anything
 *     marked `data-snc-camera` while a room is on screen pushes the room toward
 *     that object first — 1.4 s at MID/HIGH, a 0.7 s crossfade at LOW, nothing
 *     at FLOOR — and only then opens the route. A room that is not built still
 *     gets its look (the camera goes, the note says "जल्द आ रहा है") and the camera
 *     comes back;
 *  4. re-marks the path cards' reading presence, for arrivals by client-side
 *     navigation, where the inline pre-paint script does not run.
 *
 * The follow constants are the ones `<ScenePlate>` damps its plates with, so a
 * raster plate added later moves exactly like the drawn layers beside it.
 */
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useCapabilityTier } from "@/components/sanctuary/use-capability-tier";
import { POTHI_READING_SESSION_KEY } from "@/lib/sanctuary/pothi-reading-store";
import { READING_PRESENCE_ATTRIBUTE, readingPresenceOf } from "@/lib/sanctuary/reading-presence";
import {
  ROOM_CAMERA_ARRIVAL_GRACE_MS,
  ROOM_CAMERA_ARRIVED_EVENT,
  ROOM_CAMERA_MOVE_MS,
  ROOM_CSS_CAMERAS,
  roomCameraTransform,
  type RoomCssCamera,
} from "@/lib/sanctuary/room-composition";

/** The damped follow's time constant, and the longest frame it will integrate over. */
export const ROOM_FOLLOW_TIME_CONSTANT_MS = 220;
export const ROOM_MAX_FRAME_DT_MS = 64;
/** Device tilt: the angle that counts as full deflection, and the pitch a hand holds a phone at. */
export const ROOM_TILT_FULL_DEFLECTION_DEG = 24;
export const ROOM_TILT_NEUTRAL_BETA_DEG = 45;
/** LOW's crossfade is the transition band's floor; the push is the camera band's. */
export const ROOM_CROSSFADE_MS = 700;

function isCamera(value: string | undefined): value is RoomCssCamera {
  return value !== undefined && Object.prototype.hasOwnProperty.call(ROOM_CSS_CAMERAS, value);
}

/** At least half of the room (or of the viewport, for a room taller than it) is showing. */
function onScreen(element: HTMLElement): boolean {
  if (element.offsetParent === null) return false;
  const box = element.getBoundingClientRect();
  const shown = Math.min(box.bottom, window.innerHeight) - Math.max(box.top, 0);
  return shown > 0 && shown >= Math.min(box.height, window.innerHeight) * 0.5;
}

function roomsFor(ids: string): HTMLElement[] {
  return ids
    .split(" ")
    .map((id) => document.getElementById(id))
    .filter((element): element is HTMLElement => element !== null);
}

export interface SanctuaryHomeIslandProps {
  readonly roomIds: readonly string[];
  readonly pathsId: string;
}

export function SanctuaryHomeIsland({ roomIds, pathsId }: SanctuaryHomeIslandProps): null {
  const tier = useCapabilityTier();
  const router = useRouter();
  const ids = roomIds.join(" ");

  /* 1 — the tier, onto the rooms. */
  useEffect(() => {
    for (const room of roomsFor(ids)) room.setAttribute("data-snc-tier", tier);
  }, [tier, ids]);

  /* 4 — reading presence, again, for client-side arrivals. */
  useEffect(() => {
    const list = document.getElementById(pathsId);
    if (list === null) return;
    let stored: string | null = null;
    try {
      stored = window.sessionStorage.getItem(POTHI_READING_SESSION_KEY);
    } catch {
      stored = null;
    }
    list.setAttribute(READING_PRESENCE_ATTRIBUTE, readingPresenceOf(stored));
  }, [pathsId]);

  /* 2 — parallax. */
  useEffect(() => {
    if (tier !== "HIGH" && tier !== "MID") return;
    const rooms = roomsFor(ids);
    if (rooms.length === 0) return;

    /* Every layer, its depth, and its room's clamp in px (the token, resolved once). */
    const layers = rooms.flatMap((room) => {
      const clampPx = Number.parseFloat(getComputedStyle(room).getPropertyValue("--snc-room-parallax")) || 0;
      return [...room.querySelectorAll<HTMLElement>("[data-snc-depth]")].map((element) => ({
        element,
        reach: clampPx * (Number(element.dataset.sncDepth) || 0),
      }));
    });

    const showing = new Set<Element>();
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) showing.add(entry.target);
        else showing.delete(entry.target);
      }
    });
    for (const room of rooms) observer.observe(room);

    let targetX = 0;
    let targetY = 0;
    let x = 0;
    let y = 0;
    let frame = 0;
    let last = 0;
    const clamp = (value: number): number => Math.max(-1, Math.min(1, value));

    const step = (now: number): void => {
      const dt = last === 0 ? 16 : Math.min(now - last, ROOM_MAX_FRAME_DT_MS);
      last = now;
      const k = 1 - Math.exp(-dt / ROOM_FOLLOW_TIME_CONSTANT_MS);
      x += (targetX - x) * k;
      y += (targetY - y) * k;
      /* Opposite to the pointer: the room is looked around, not dragged. */
      for (const { element, reach } of layers) {
        element.style.translate = `${(-x * reach).toFixed(2)}px ${(-y * reach).toFixed(2)}px`;
      }
      if (Math.abs(targetX - x) > 0.0005 || Math.abs(targetY - y) > 0.0005) {
        frame = window.requestAnimationFrame(step);
      } else {
        frame = 0;
        last = 0;
      }
    };
    const wake = (): void => {
      if (frame !== 0 || document.hidden || showing.size === 0) return;
      frame = window.requestAnimationFrame(step);
    };
    const onPointer = (event: PointerEvent): void => {
      if (event.pointerType === "touch") return;
      targetX = clamp((event.clientX / window.innerWidth) * 2 - 1);
      targetY = clamp((event.clientY / window.innerHeight) * 2 - 1);
      wake();
    };
    const onTilt = (event: DeviceOrientationEvent): void => {
      if (event.gamma === null || event.beta === null) return;
      targetX = clamp(event.gamma / ROOM_TILT_FULL_DEFLECTION_DEG);
      targetY = clamp((event.beta - ROOM_TILT_NEUTRAL_BETA_DEG) / ROOM_TILT_FULL_DEFLECTION_DEG);
      wake();
    };

    window.addEventListener("pointermove", onPointer, { passive: true });
    window.addEventListener("deviceorientation", onTilt, { passive: true });
    return () => {
      window.removeEventListener("pointermove", onPointer);
      window.removeEventListener("deviceorientation", onTilt);
      observer.disconnect();
      if (frame !== 0) window.cancelAnimationFrame(frame);
      for (const { element } of layers) element.style.translate = "";
    };
  }, [tier, ids]);

  /* 3 — the camera before the route. Capture phase, so it runs before a Link's own click. */
  useEffect(() => {
    if (tier === "FLOOR") return;
    const rooms = roomsFor(ids);
    const timers: number[] = [];

    /* When the camera is there. The CSS push is a compositor transition of
       exactly `travel`, so a timer is its clock. A live scene moves in frames,
       and a late frame (a GPU shared with other windows) once left the timer
       routing with the camera drawn at 93% of its move — so over a scene the
       island waits for the scene's own word, with a timer only as the fallback
       for a scene lost mid-move. The word must name this camera: a look that
       is still coming home says "sanctuary" when it gets there. */
    const whenArrived = (set: HTMLElement, camera: RoomCssCamera, live: boolean, travel: number, then: () => void): void => {
      const settle = (): void => {
        set.removeEventListener(ROOM_CAMERA_ARRIVED_EVENT, onArrived);
        window.clearTimeout(fallback);
        then();
      };
      const onArrived = (event: Event): void => {
        if ((event as CustomEvent<{ camera: string }>).detail.camera === camera) settle();
      };
      if (live) set.addEventListener(ROOM_CAMERA_ARRIVED_EVENT, onArrived);
      const fallback = window.setTimeout(settle, live ? travel + ROOM_CAMERA_ARRIVAL_GRACE_MS : travel);
      timers.push(fallback);
    };

    const onClick = (event: MouseEvent): void => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const trigger = event.target instanceof Element ? event.target.closest<HTMLElement>("[data-snc-camera]") : null;
      if (trigger === null) return;
      const camera = trigger.dataset.sncCamera;
      if (!isCamera(camera)) return;
      const room = rooms.find(onScreen);
      const set = room?.querySelector<HTMLElement>("[data-snc-room-set]") ?? null;
      if (set === null || set.dataset.sncCamera !== undefined) return;

      set.dataset.sncCamera = camera;
      /* The 3D room (U3b P3) moves its own camera when it sees this mark, so a
         set carrying a live scene is not scaled: a CSS zoom on top would blur
         the canvas and double the push. Otherwise the CSS camera pushes. */
      const live = set.querySelector('[data-snc-room-scene="live"]') !== null;
      if (!live) {
        const { originX, originY, scale } = roomCameraTransform(camera);
        set.style.transformOrigin = `${originX} ${originY}`;
        set.style.scale = String(scale);
      }

      const href = trigger instanceof HTMLAnchorElement ? trigger.getAttribute("href") : null;
      const travel = tier === "LOW" ? ROOM_CROSSFADE_MS : ROOM_CAMERA_MOVE_MS;
      if (href !== null) {
        /* The Link sees this and stands down; the route opens when the camera arrives. */
        event.preventDefault();
        whenArrived(set, camera, live, travel, () => router.push(href));
      } else {
        /* Not built: the note opens on its own; the camera looks, then comes home. */
        whenArrived(set, camera, live, travel, () => {
          timers.push(
            window.setTimeout(() => {
              delete set.dataset.sncCamera;
              set.style.scale = "";
            }, 1200),
          );
        });
      }
    };

    document.addEventListener("click", onClick, true);
    return () => {
      document.removeEventListener("click", onClick, true);
      for (const timer of timers) window.clearTimeout(timer);
    };
  }, [tier, ids, router]);

  return null;
}
