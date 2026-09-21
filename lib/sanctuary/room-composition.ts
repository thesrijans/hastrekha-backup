/**
 * The room, as numbers — one composition for the CSS layers now and the scene later.
 *
 * B7's rule is absolute: the fallback is "the SAME composition", so a device that
 * degrades from the 3D room to the CSS one never sees the layout move. The only
 * way two renderers agree about where the pedestal stands is for neither of them
 * to decide it. This table decides it, in the reference's own framing
 * (ui-scan-hologram-pedestal-library.webp, 16:9): the pedestal centre-left with
 * the hologram rising from it, the open book on its stand at right, the arched
 * window behind and above the book, shelves of tied leaf bundles on both walls.
 *
 * UNITS. A 1600 × 900 stage. The CSS composition draws every layer in an SVG of
 * exactly this viewBox, and sizes the stage to COVER the hero (like
 * `object-fit: cover`), so a point here is the same point on every layer at every
 * width. Anything important is kept inside {@link ROOM_SAFE_X}: at the narrowest
 * landscape the room is shown at (4:3, beside the glyph rail), the stage is
 * cropped to roughly that band.
 *
 * A plain module — numbers and names, no React — so the scene, the stylesheet's
 * custom properties and a Node test all read the same values.
 */

export const ROOM_STAGE = { width: 1600, height: 900 } as const;

/** The horizontal band that survives the tightest crop. Nothing the reader must see sits outside it. */
export const ROOM_SAFE_X = { from: 230, to: 1370 } as const;

/** B7's three layers, back to front. */
export const ROOM_LAYERS = ["far", "mid", "near"] as const;
export type RoomLayer = (typeof ROOM_LAYERS)[number];

/**
 * How far each layer travels under the pointer, as a fraction of the parallax
 * clamp (`--snc-parallax-max-desktop`, 12 px; 8 px on a phone).
 *
 * The same factors `<ScenePlate>` gives its far/mid/near plates, so a raster
 * plate added later and a drawn layer beside it move as one. The test asserts
 * the equality rather than trusting it.
 */
export const ROOM_LAYER_DEPTH: Readonly<Record<RoomLayer, number>> = { far: 0.25, mid: 0.55, near: 0.85 };

/** Where the room's objects stand, in stage units. The labels and the camera both aim at these. */
export const ROOM_ANCHORS = {
  /** The top face of the pedestal — the zodiac ring's centre. */
  pedestal: { x: 530, y: 588 },
  /** The middle of the hologram column. */
  hologram: { x: 530, y: 330 },
  /** The spine of the open book. */
  book: { x: 1292, y: 470 },
  /** The left wall's shelves. */
  library: { x: 215, y: 360 },
  /** The arched window's centre. */
  window: { x: 1235, y: 300 },
  /** The one warm source. Every other light in the room falls off from here. */
  key: { x: 530, y: 560 },
} as const;

export type RoomAnchor = keyof typeof ROOM_ANCHORS;

/**
 * B4's camera positions, as the CSS composition can express them: a point to
 * push toward and how far. The scene (U3b) owns real 3D positions for the same
 * five names; these are the flat equivalents, so a nav action moves the CSS room
 * and the 3D room toward the same object.
 */
export const ROOM_CSS_CAMERAS = {
  sanctuary: { x: 800, y: 450, zoom: 1 },
  scanner: { x: 530, y: 420, zoom: 1.85 },
  book: { x: 1292, y: 470, zoom: 2.05 },
  library: { x: 215, y: 380, zoom: 1.75 },
  /** Reserved for the Guru (U4). The position exists; nothing moves there yet. */
  guru: { x: 1010, y: 460, zoom: 1.3 },
} as const;

export type RoomCssCamera = keyof typeof ROOM_CSS_CAMERAS;

/** How long a camera move lasts: inside the token layer's 1.2–2.0 s camera band. */
export const ROOM_CAMERA_MOVE_MS = 1400;

/**
 * The 3D room's word that its camera has arrived, dispatched on the set (the
 * element carrying `data-snc-room-set`) with `{ camera }` as its detail, from
 * the first frame that draws the camera at its destination.
 *
 * Home's island routes on it rather than on a timer when a live scene is
 * present (U3b P3). A timer is right for the CSS push, whose transition runs on
 * the compositor for exactly ROOM_CAMERA_MOVE_MS; the scene's move runs in
 * frames, and a frame that comes late — a GPU shared with other windows — left
 * the timer opening the route with the camera drawn at 93% of its move.
 */
export const ROOM_CAMERA_ARRIVED_EVENT = "snc-room-camera-arrived";

/** How long past ROOM_CAMERA_MOVE_MS the island waits for that word before routing anyway (a scene lost mid-move). */
export const ROOM_CAMERA_ARRIVAL_GRACE_MS = 600;

/**
 * The three candles (B3): where each stands and its flicker period.
 *
 * Periods inside the token band (250–500 ms, i.e. 2–4 Hz) and pairwise
 * incommensurate, so the three flames never fall into step — §3 asks for flicker
 * that is "never rhythmic", and three flames on one period would be a metronome.
 */
export const ROOM_CANDLES: readonly {
  readonly id: "pedestal-left" | "pedestal-right" | "book";
  readonly x: number;
  readonly y: number;
  readonly height: number;
  readonly periodMs: number;
}[] = [
  { id: "pedestal-left", x: 318, y: 842, height: 56, periodMs: 310 },
  { id: "pedestal-right", x: 744, y: 850, height: 46, periodMs: 370 },
  { id: "book", x: 1168, y: 826, height: 60, periodMs: 433 },
];

/** The flat camera transform for a named position, as CSS reads it: an origin and a scale. */
export function roomCameraTransform(camera: RoomCssCamera): { readonly originX: string; readonly originY: string; readonly scale: number } {
  const { x, y, zoom } = ROOM_CSS_CAMERAS[camera];
  return {
    originX: `${((x / ROOM_STAGE.width) * 100).toFixed(3)}%`,
    originY: `${((y / ROOM_STAGE.height) * 100).toFixed(3)}%`,
    scale: zoom,
  };
}

/** A stage point as percentages of the stage box, for HTML laid over the SVG layers. */
export function roomPercent(point: { readonly x: number; readonly y: number }): { readonly left: string; readonly top: string } {
  return {
    left: `${((point.x / ROOM_STAGE.width) * 100).toFixed(3)}%`,
    top: `${((point.y / ROOM_STAGE.height) * 100).toFixed(3)}%`,
  };
}
