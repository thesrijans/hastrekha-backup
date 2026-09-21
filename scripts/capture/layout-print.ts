/**
 * Print the room's derived layout: where each object stands, in metres, and
 * where it lands back on the stage. A reading aid for tuning the camera, which
 * is the only free parameter in the composition — everything else is derived.
 *
 *   npx tsx scripts/capture/layout-print.ts
 */
import { computeLayout } from "../../components/sanctuary/room/three/layout";
import { makeRoomCamera, worldToStage } from "../../components/sanctuary/room/three/stage-projection";
import { MOON_RADIUS, MOON_X_FRACTION, WINDOW_WIDTH } from "../../components/sanctuary/room/three/props";

const camera = makeRoomCamera();
const layout = computeLayout(camera);
const m = (v: { x: number; y: number; z: number }): string => `(${v.x.toFixed(2)}, ${v.y.toFixed(2)}, ${v.z.toFixed(2)}) m`;
const s = (v: { x: number; y: number; z: number }): string => {
  const at = worldToStage(camera, v as never);
  return `stage (${at.x.toFixed(0)}, ${at.y.toFixed(0)})`;
};
const dist = (v: { x: number; y: number; z: number }): string => `${camera.position.distanceTo(v as never).toFixed(2)} m from camera`;

console.log(`camera   ${m(camera.position)}`);
console.log(`pedestal ${m(layout.pedestal.centre)}  r ${layout.pedestal.radius.toFixed(3)}  h ${layout.pedestal.height}  ${s(layout.pedestal.centre)}  ${dist(layout.pedestal.centre)}`);
console.log(`hologram column height ${layout.hologram.height.toFixed(3)} m`);
console.log(`key      ${m(layout.key)}`);
console.log(`book     ${m(layout.book.spine)}  ${s(layout.book.spine)}  ${dist(layout.book.spine)}`);
console.log(`window   ${m(layout.window.centre)}  ${s(layout.window.centre)}  ${dist(layout.window.centre)}`);
console.log(`library  ${m(layout.library.centre)}  ${s(layout.library.centre)}  ${dist(layout.library.centre)}`);
for (const c of layout.candles) console.log(`candle   ${c.id.padEnd(15)} ${m(c.base)}  h ${c.height.toFixed(3)} m  ${dist(c.base)}`);
{
  const moonRight = layout.window.centre.x + WINDOW_WIDTH * MOON_X_FRACTION + MOON_RADIUS + 0.03;
  const width = Math.min(0.9, Math.max(0.28, 2 * (layout.rightDrape.x - moonRight)));
  console.log(`right drape ${m(layout.rightDrape)}  ${s(layout.rightDrape)}  width ${width.toFixed(3)} m (unclamped ${(2 * (layout.rightDrape.x - moonRight)).toFixed(3)})`);
  const inner = layout.rightDrape.clone();
  inner.x -= width / 2;
  const outer = layout.rightDrape.clone();
  outer.x += width / 2;
  console.log(`  spans stage x ${worldToStage(camera, inner as never).x.toFixed(0)} .. ${worldToStage(camera, outer as never).x.toFixed(0)}; moon's right edge at x ${moonRight.toFixed(3)} m`);
}
