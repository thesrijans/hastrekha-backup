/**
 * Where everything in the room stands, derived from the CSS room's anchors.
 *
 * Nothing here is a hand-placed metre. Each position is the camera ray through
 * an anchor in lib/sanctuary/room-composition.ts, met by the plane the object
 * stands on; each size is the CSS room's own size read back through the same
 * camera. test/sanctuary-three-layout.test.ts projects every result back to
 * the stage and fails if any lands more than a few stage units off its anchor.
 *
 * THE PEDESTAL IS A LOW DRUM. The reference (ui-scan-hologram-pedestal-
 * library.webp) shows a wide ornate drum roughly three times as wide as it is
 * tall, with the zodiac round its top rim and a plaque on its face. An earlier
 * slice of this file built a waist-high plinth and it read as a column; the
 * reference is the arbiter, so the height is fixed low and the width is taken
 * from the CSS ring that sits on it.
 */
import type { PerspectiveCamera } from "three";
import { Vector3 } from "three";
import { ROOM_ANCHORS, ROOM_CANDLES } from "@/lib/sanctuary/room-composition";
import { onFloorAt, onWallAt, worldPerStageX, worldToStage } from "./stage-projection";

/** The drum's height, metres. Its width is fixed by the CSS ring drawn over it (see PEDESTAL_STAGE_HALF_WIDTH), so this sets the proportion: at 0.46 it is about 3.3:1, the reference's. At 0.30 it measured 5.3:1 and read as a disc. */
export const PEDESTAL_HEIGHT = 0.46;

/** The CSS zodiac ring is 460 stage units wide (room-stage.tsx RING_POSITION); the drum matches it. */
export const PEDESTAL_STAGE_HALF_WIDTH = 230;

/** The lectern's top surface, where the book's spine rests. */
export const BOOK_HEIGHT = 0.6;

/**
 * Where the one warm key sits: inside the hologram column, this far up it, and
 * this far toward the camera from its axis.
 *
 * ITERATION 2. Iteration 1 read the key off the `key` anchor at (530, 560) —
 * just above the drum's top face — and left it almost touching the metal.
 * Under inverse-square falloff that one fact produced four failures: the drum
 * face took a hotspot that bloomed (52.6% of all bloom on lit surfaces), and
 * everything farther away took almost nothing — the book at 0.52%, the drapes
 * at 0.04% — so thinly that one candle near the lens out-lit the key across
 * the frame. Raised into the column, it is still "the one warm source at the
 * pedestal" (§6.2 [R7]) and physically what the reference shows: the hologram
 * lighting the room. The CSS room's anchor still marks where that light POOLS
 * on the drum's top, which is where it lands from up here.
 */
export const KEY_COLUMN_FRACTION = 0.42;
export const KEY_FORWARD = 0.12;

/**
 * Where the drape to the window's RIGHT hangs, in stage units.
 *
 * P2 RULING 2. It used to hang 1.35 m right of the window's centre, which put
 * it at stage x 1478 — outside ROOM_SAFE_X (230-1370) and half under the
 * vignette, so it was never composed; excluding it from the score would only
 * have hidden that. It is now placed inside the safe band, by the same rule as
 * everything else in the room: this stage point, read through the camera onto
 * the drape's plane. 1338 rather than just under 1370 so the drape's whole
 * width, not only its centre, is inside the band. The drape to the window's left was already inside (1019)
 * and is unchanged.
 */
export const RIGHT_DRAPE_STAGE_X = 1338;

/** The back wall and the plane the shelves stand against. */
export const BACK_WALL_Z = -3.8;

/** The window drapes hang 0.25 m in front of the back wall. */
export const DRAPE_Z = BACK_WALL_Z + 0.25;
export const SHELF_WALL_Z = -3.2;

export interface CandleLayout {
  readonly id: string;
  readonly base: Vector3;
  readonly height: number;
  readonly periodMs: number;
}

export interface RoomLayout {
  readonly pedestal: { readonly centre: Vector3; readonly radius: number; readonly height: number };
  readonly hologram: { readonly base: Vector3; readonly height: number };
  readonly key: Vector3;
  readonly book: { readonly spine: Vector3 };
  readonly window: { readonly centre: Vector3 };
  readonly library: { readonly centre: Vector3 };
  /** The drape right of the window, placed from RIGHT_DRAPE_STAGE_X. */
  readonly rightDrape: Vector3;
  readonly candles: readonly CandleLayout[];
}

export function computeLayout(camera: PerspectiveCamera): RoomLayout {
  const { pedestal, hologram, book, window: arch, library } = ROOM_ANCHORS;

  // The drum: its top face's centre is the anchor, on the plane of that face.
  const top = onFloorAt(camera, pedestal.x, pedestal.y, PEDESTAL_HEIGHT, "the pedestal");
  const radius =
    PEDESTAL_STAGE_HALF_WIDTH * worldPerStageX(camera, pedestal.x, pedestal.y, PEDESTAL_HEIGHT, PEDESTAL_STAGE_HALF_WIDTH);
  const centre = new Vector3(top.x, PEDESTAL_HEIGHT, top.z);

  // The hologram rises from the drum. Its middle is the anchor, read on the
  // vertical plane through the drum, so the column is exactly as tall as the
  // CSS room's column.
  const middle = onWallAt(camera, hologram.x, hologram.y, centre.z, "the hologram");
  const columnHeight = Math.max(0.6, 2 * (middle.y - PEDESTAL_HEIGHT));

  // The one warm key, inside the column (see KEY_COLUMN_FRACTION).
  const keyPoint = new Vector3(centre.x, PEDESTAL_HEIGHT + columnHeight * KEY_COLUMN_FRACTION, centre.z + KEY_FORWARD);

  const spine = onFloorAt(camera, book.x, book.y, BOOK_HEIGHT, "the book");
  const windowCentre = onWallAt(camera, arch.x, arch.y, BACK_WALL_Z, "the window");
  const shelves = onWallAt(camera, library.x, library.y, SHELF_WALL_Z, "the library");

  // Candles stand on the desk; their height is their stage height read back
  // through the camera at their own depth.
  const candles = ROOM_CANDLES.map((candle) => {
    const base = onFloorAt(camera, candle.x, candle.y, 0, `candle ${candle.id}`);
    const tip = onWallAt(camera, candle.x, candle.y - candle.height, base.z, `candle ${candle.id} tip`);
    return { id: candle.id, base, height: Math.max(0.05, tip.y - base.y), periodMs: candle.periodMs };
  });

  // Keep the drape's height where it was (0.3 m above the window's centre) and
  // move only its x, onto the stage point inside the safe band.
  const drapeHeight = windowCentre.y + 0.3;
  const atHeight = worldToStage(camera, new Vector3(windowCentre.x, drapeHeight, DRAPE_Z));
  const rightDrape = onWallAt(camera, RIGHT_DRAPE_STAGE_X, atHeight.y, DRAPE_Z, "the right drape");

  return {
    pedestal: { centre, radius, height: PEDESTAL_HEIGHT },
    rightDrape,
    hologram: { base: centre.clone(), height: columnHeight },
    key: keyPoint,
    book: { spine },
    window: { centre: windowCentre },
    library: { centre: shelves },
    candles,
  };
}
