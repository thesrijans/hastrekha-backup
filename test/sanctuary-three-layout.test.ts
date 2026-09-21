/* ============================================================================
 * THE 3D ROOM AND THE CSS ROOM ARE ONE ROOM
 *
 * The 3D room fades in over the CSS composition (§6.2 [R7]), and a device that
 * degrades goes the other way. Either way the two are on screen together for
 * the length of a crossfade, and if the pedestal is thirty pixels to the left
 * in one of them the room visibly lurches. Amendment 4 names this directly:
 * "the CSS plate fallback matches the 3D composition with no layout shift".
 *
 * components/sanctuary/room/three/layout.ts places nothing by eye. It casts the
 * camera ray through each anchor in lib/sanctuary/room-composition.ts and meets
 * it with the plane the object stands on. This test is the other half of that
 * argument: it projects every placed object BACK through the same camera and
 * checks it lands on the anchor it came from. A future edit that nudges a
 * height, moves the camera, or places something by hand fails here instead of
 * in a screenshot three passes later.
 * ========================================================================== */
import assert from "node:assert/strict";
import { Vector3 } from "three";
import { computeLayout, PEDESTAL_HEIGHT, PEDESTAL_STAGE_HALF_WIDTH } from "../components/sanctuary/room/three/layout";
import { makeRoomCamera, STAGE_ASPECT, worldToStage } from "../components/sanctuary/room/three/stage-projection";
import { MOON_RADIUS, MOON_X_FRACTION, rightDrapeWidth, WINDOW_WIDTH } from "../components/sanctuary/room/three/props";
import { ROOM_ANCHORS, ROOM_CANDLES, ROOM_SAFE_X, ROOM_STAGE } from "../lib/sanctuary/room-composition";

let assertions = 0;
const ok = (condition: boolean, message: string): void => {
  assert.ok(condition, message);
  assertions += 1;
};

/** How far a projected point may sit from its anchor, in stage units (of 1600). */
const TOLERANCE = 2;

const camera = makeRoomCamera();
const layout = computeLayout(camera);

const lands = (point: Vector3, anchor: { x: number; y: number }, what: string): void => {
  const at = worldToStage(camera, point);
  const off = Math.hypot(at.x - anchor.x, at.y - anchor.y);
  ok(off <= TOLERANCE, `${what} projects onto its anchor (${anchor.x}, ${anchor.y}); landed at (${at.x.toFixed(1)}, ${at.y.toFixed(1)}), ${off.toFixed(2)} units off`);
};

/* ============================ 1. The frame ================================ */

ok(Math.abs(STAGE_ASPECT - ROOM_STAGE.width / ROOM_STAGE.height) < 1e-9, "the camera's aspect is the stage's 16:9, the same box the SVG layers are drawn in");
ok(Math.abs(camera.aspect - 16 / 9) < 1e-9, "and the camera was built with it");

/* ========================= 2. Every anchor lands ========================== */

lands(layout.pedestal.centre, ROOM_ANCHORS.pedestal, "the pedestal's top face");
lands(layout.book.spine, ROOM_ANCHORS.book, "the book's spine");
lands(layout.window.centre, ROOM_ANCHORS.window, "the window");
lands(layout.library.centre, ROOM_ANCHORS.library, "the library");

const hologramMiddle = layout.hologram.base.clone().add(new Vector3(0, layout.hologram.height / 2, 0));
lands(hologramMiddle, ROOM_ANCHORS.hologram, "the hologram's middle");

for (const candle of layout.candles) {
  const anchor = ROOM_CANDLES.find((c) => c.id === candle.id);
  ok(anchor !== undefined, `candle ${candle.id} comes from the CSS room's own table`);
  if (anchor) lands(candle.base, { x: anchor.x, y: anchor.y }, `candle ${candle.id}'s base`);
}

/* ========================== 3. Sizes agree too ============================ */

{
  const { centre, radius } = layout.pedestal;
  const left = worldToStage(camera, new Vector3(centre.x - radius, PEDESTAL_HEIGHT, centre.z));
  const right = worldToStage(camera, new Vector3(centre.x + radius, PEDESTAL_HEIGHT, centre.z));
  const width = right.x - left.x;
  ok(
    Math.abs(width - 2 * PEDESTAL_STAGE_HALF_WIDTH) <= 2 * TOLERANCE,
    `the drum is as wide on screen as the CSS zodiac ring drawn over it (${width.toFixed(1)} of ${2 * PEDESTAL_STAGE_HALF_WIDTH} units)`,
  );
}

ok(
  layout.pedestal.radius * 2 > layout.pedestal.height * 2.5,
  `the pedestal is a low drum, not a plinth — the reference's is about 3:1 (${((layout.pedestal.radius * 2) / layout.pedestal.height).toFixed(2)}:1)`,
);

/* ======================== 4. The room is plausible ======================== */

ok(layout.candles.every((c) => c.height > 0.05 && c.height < 0.6), "every candle is candle-sized, between 5 and 60 cm");
ok(layout.window.centre.z < layout.pedestal.centre.z, "the window is behind the pedestal");
ok(layout.library.centre.x < layout.pedestal.centre.x, "the library is to the pedestal's left");
ok(layout.book.spine.x > layout.pedestal.centre.x, "and the book to its right, as in the reference");
{
  // "At the pedestal" means inside the hologram column standing on it: on the
  // drum's axis to within the column's radius, and between the drum's top and
  // the column's top. Iteration 1 pinned it within 0.6 m of the drum's centre,
  // which put it nearly on the metal; see KEY_COLUMN_FRACTION in layout.ts.
  const { key, pedestal, hologram } = layout;
  const offAxis = Math.hypot(key.x - pedestal.centre.x, key.z - pedestal.centre.z);
  ok(offAxis < pedestal.radius * 0.42, `the one warm key stands in the hologram column, ${offAxis.toFixed(3)} m off the drum's axis (§6.2 [R7])`);
  ok(
    key.y > pedestal.height && key.y < pedestal.height + hologram.height,
    `between the drum's top and the column's top (${key.y.toFixed(2)} m, column ${pedestal.height}..${(pedestal.height + hologram.height).toFixed(2)} m)`,
  );
}

/* ===================== 5. The right drape is composed ===================== */

{
  // P2 ruling 2: the drape right of the window used to hang at stage x 1478,
  // outside the safe band and half under the vignette. Its whole width must
  // now sit inside ROOM_SAFE_X, and it must stop short of the moon.
  const width = rightDrapeWidth(layout);
  const inner = worldToStage(camera, layout.rightDrape.clone().setX(layout.rightDrape.x - width / 2));
  const outer = worldToStage(camera, layout.rightDrape.clone().setX(layout.rightDrape.x + width / 2));
  ok(
    inner.x >= ROOM_SAFE_X.from && outer.x <= ROOM_SAFE_X.to,
    `the right drape spans stage x ${inner.x.toFixed(0)}..${outer.x.toFixed(0)}, wholly inside the safe band ${ROOM_SAFE_X.from}..${ROOM_SAFE_X.to}`,
  );
  const moonRight = layout.window.centre.x + WINDOW_WIDTH * MOON_X_FRACTION + MOON_RADIUS;
  ok(layout.rightDrape.x - width / 2 > moonRight, "and its inner edge stops short of the moon, which stays in view");
  ok(width >= 0.28, `at a width that still reads as cloth (${width.toFixed(3)} m)`);
}

console.log(`SANCTUARY THREE LAYOUT ASSERTIONS PASSED (${assertions})`);
