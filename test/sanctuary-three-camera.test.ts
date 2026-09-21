/* ============================================================================
 * THE CAMERA SYSTEM — five poses, one ease, a breath, and parallax
 *
 * §8 names five camera positions and says what each shows; U3b P3 builds them
 * in the 3D room with hand-rolled eases, a breathing drift, and parallax from
 * pointer and tilt. components/sanctuary/room/three/camera-rig.ts derives each
 * pose from the object it frames. This test holds each pose to what §8 says it
 * shows, measured through the camera itself, so a later tweak to a fill factor
 * or a layout constant that breaks a framing fails here, in numbers.
 * ========================================================================== */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { Vector3 } from "three";
import {
  CameraRig,
  cubicBezier,
  DRIFT,
  easeCamera,
  PARALLAX_M,
  POSE_FILL,
  ROOM_CAMERA_NAMES,
  roomCameraPoses,
  SNC_EASE,
} from "../components/sanctuary/room/three/camera-rig";
import { computeLayout } from "../components/sanctuary/room/three/layout";
import { CAMERA_SANCTUARY, makeRoomCamera, worldToStage } from "../components/sanctuary/room/three/stage-projection";
import { ROOM_CAMERA_MOVE_MS } from "../lib/sanctuary/room-composition";

let assertions = 0;
const ok = (condition: boolean, message: string): void => {
  assert.ok(condition, message);
  assertions += 1;
};

const ROOT = path.resolve(__dirname, "..");
const camera = makeRoomCamera();
const layout = computeLayout(camera);
const poses = roomCameraPoses(layout);

/** A fresh camera placed exactly at a pose. */
const at = (name: (typeof ROOM_CAMERA_NAMES)[number]): ReturnType<typeof makeRoomCamera> => {
  const cam = makeRoomCamera();
  const rig = new CameraRig(cam, layout);
  rig.goTo(name, 0, 1);
  // apply() sets the pose's horizon (the shift lens) — the thing a bug once
  // skipped — and adds breathing drift; the drift is taken back out below so
  // the pose is measured alone.
  rig.apply(10);
  const pose = rig.pose(10);
  cam.position.copy(pose.position);
  cam.rotation.set(0, pose.yaw, 0);
  cam.updateMatrixWorld(true);
  return cam;
};
const stage = (cam: ReturnType<typeof makeRoomCamera>, p: Vector3): { x: number; y: number } => worldToStage(cam, p);

/* ============================ 1. Five poses ================================ */

ok(ROOM_CAMERA_NAMES.length === 5 && ["sanctuary", "scanner", "book", "library", "guru"].every((n) => n in poses), "§8's five named poses exist, the Guru's reserved for U4");
ok(
  poses.sanctuary.position.distanceTo(CAMERA_SANCTUARY.position) < 1e-9 && poses.sanctuary.yaw === 0 && poses.sanctuary.horizon === CAMERA_SANCTUARY.horizon,
  "the resting pose IS the P2 camera, so the 3D room still registers on the CSS room where they cross-fade",
);
for (const name of ROOM_CAMERA_NAMES) {
  const cam = at(name);
  const up = new Vector3(0, 1, 0).applyQuaternion(cam.quaternion);
  const forward = new Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
  ok(Math.abs(up.y - 1) < 1e-9 && Math.abs(forward.y) < 1e-9, `${name} is level — the camera only yaws, so the room's verticals stay upright`);
}

/* ========================= 2. Each pose's framing ========================= */

{
  // Scanner: "pushed in on the pedestal, book out of frame".
  const cam = at("scanner");
  const base = stage(cam, new Vector3(layout.pedestal.centre.x, 0, layout.pedestal.centre.z));
  const top = stage(cam, new Vector3(layout.pedestal.centre.x, layout.pedestal.height + layout.hologram.height, layout.pedestal.centre.z));
  const fill = (base.y - top.y) / 900;
  ok(fill >= POSE_FILL.scanner - 0.03, `scanner: drum and column fill ${(fill * 100).toFixed(1)}% of the frame's height`);
  ok(Math.abs((base.x + top.x) / 2 - 800) < 40, `and stand centred (x ${((base.x + top.x) / 2).toFixed(0)} of 1600)`);
  ok(
    Math.abs((base.y + top.y) / 2 - 450) < 40,
    `vertically too (y ${((base.y + top.y) / 2).toFixed(0)} of 900) — the shift lens is applied per pose; a NaN guard once kept every pose on the rest camera's horizon`,
  );
  // The pages: the book group is turned -0.34 rad about y at the spine; pages span x +/-0.61, z +/-0.39.
  const corners = [-0.61, 0.61].flatMap((x) =>
    [-0.39, 0.39].map((z) => {
      const c = Math.cos(-0.34);
      const s = Math.sin(-0.34);
      return new Vector3(layout.book.spine.x + x * c + z * s, layout.book.spine.y + 0.1, layout.book.spine.z - x * s + z * c);
    }),
  );
  const xs = corners.map((p) => stage(cam, p).x);
  ok(xs.every((x) => x > 1600), `and the book is out of frame — every page corner right of the edge (min x ${Math.min(...xs).toFixed(0)})`);
}
{
  // Book: "the manuscript fills frame".
  const cam = at("book");
  const c = Math.cos(-0.34);
  const s = Math.sin(-0.34);
  const edge = (x: number): Vector3 => new Vector3(layout.book.spine.x + x * c, layout.book.spine.y + 0.1, layout.book.spine.z - x * s);
  const left = stage(cam, edge(-0.61));
  const right = stage(cam, edge(0.61));
  const fill = (right.x - left.x) / 1600;
  ok(fill >= POSE_FILL.book - 0.05, `book: the open pages fill ${(fill * 100).toFixed(1)}% of the frame's width`);
  ok(Math.abs((left.x + right.x) / 2 - 800) < 60 && Math.abs(stage(cam, layout.book.spine).y - 450) < 60, "and sit centred");
}
{
  // Library: the shelves fill the frame.
  const cam = at("library");
  const top = stage(cam, layout.library.centre.clone().add(new Vector3(0, 1.15, 0)));
  const bottom = stage(cam, layout.library.centre.clone().add(new Vector3(0, -1.15, 0)));
  const fill = (bottom.y - top.y) / 900;
  ok(fill >= POSE_FILL.library - 0.03, `library: the shelves fill ${(fill * 100).toFixed(1)}% of the frame's height`);
}
{
  // Guru: three-quarter, reserved — kept inside the room.
  const g = poses.guru.position;
  ok(g.z > -3.8 + 1 && Math.abs(g.x) < 5 && Math.abs(poses.guru.yaw) > 0.3, "guru: a three-quarter view from inside the room");
}

/* ================================ 3. The ease ============================== */

{
  const css = readFileSync(path.join(ROOT, "app", "sanctuary.css"), "utf8");
  const token = /--snc-ease:\s*cubic-bezier\(([^)]+)\)/.exec(css)?.[1]?.split(",").map((v) => Number(v.trim()));
  ok(token !== undefined && token.every((v, i) => Math.abs(v - SNC_EASE[i]!) < 1e-9), "the 3D camera's ease is the sanctuary's own --snc-ease, read from the stylesheet");

  // An independent solve, by bisection only, to check the Newton solver.
  const reference = (t: number): number => {
    const [x1, y1, x2, y2] = SNC_EASE;
    const bez = (a: number, b: number, s: number): number => 3 * (1 - s) ** 2 * s * a + 3 * (1 - s) * s ** 2 * b + s ** 3;
    let lo = 0;
    let hi = 1;
    for (let i = 0; i < 60; i += 1) {
      const mid = (lo + hi) / 2;
      if (bez(x1, x2, mid) < t) lo = mid;
      else hi = mid;
    }
    return bez(y1, y2, (lo + hi) / 2);
  };
  let worst = 0;
  for (let i = 0; i <= 20; i += 1) worst = Math.max(worst, Math.abs(easeCamera(i / 20) - reference(i / 20)));
  ok(worst < 2e-4, `and solves it correctly (worst error ${worst.toExponential(1)} against a bisection solve)`);

  let monotonic = true;
  let previous = 0;
  for (let i = 0; i <= 1000; i += 1) {
    const v = easeCamera(i / 1000);
    if (v < previous - 1e-9 || v < 0 || v > 1 + 1e-9) monotonic = false;
    previous = v;
  }
  ok(easeCamera(0) === 0 && easeCamera(1) === 1 && monotonic, "it runs 0 to 1 without overshoot or reversal — a camera that backs up reads as a stumble");
  ok(cubicBezier(0.25, 0.1, 0.25, 1)(0.5) > 0.7 && cubicBezier(0.25, 0.1, 0.25, 1)(0.5) < 0.9, "the solver agrees with CSS `ease` at its midpoint (a second curve, as a sanity check)");
}

/* ================================ 4. A move =============================== */

{
  ok(ROOM_CAMERA_MOVE_MS >= 1200 && ROOM_CAMERA_MOVE_MS <= 2000, "a move lasts inside the 1.2-2.0 s camera band — the same duration the island waits before it routes");
  const cam = makeRoomCamera();
  const rig = new CameraRig(cam, layout);
  rig.goTo("scanner", 1000);
  ok(rig.pose(1000).position.distanceTo(poses.sanctuary.position) < 1e-9, "a move starts exactly where the camera was");
  ok(rig.pose(1000 + ROOM_CAMERA_MOVE_MS).position.distanceTo(poses.scanner.position) < 1e-9, "and arrives exactly on time, as the route opens");
  // Retarget mid-move: no jump.
  const mid = 1000 + ROOM_CAMERA_MOVE_MS * 0.4;
  const before = rig.pose(mid).position.clone();
  rig.goTo("sanctuary", mid);
  ok(rig.pose(mid).position.distanceTo(before) < 1e-9, "turning back mid-move starts from where the camera is, with no jump");
}

/* ============================ 5. Breath and parallax ====================== */

{
  const cam = makeRoomCamera();
  const rig = new CameraRig(cam, layout);
  const anchor = layout.pedestal.centre.clone();
  const rest = stage(makeRoomCamera(), anchor);
  let worst = 0;
  for (let t = 0; t <= 60_000; t += 50) {
    rig.apply(t);
    const p = stage(cam, anchor);
    worst = Math.max(worst, Math.hypot(p.x - rest.x, p.y - rest.y));
  }
  ok(worst > 0.5 && worst <= 3, `the room breathes: over a minute at rest the pedestal drifts at most ${worst.toFixed(2)} stage units`);
  ok(Math.min(...DRIFT.periodsS) >= 8, "slowly — its shortest period is 8 s or more, far from the candles' 2-4 Hz");
}
{
  const cam = makeRoomCamera();
  const rig = new CameraRig(cam, layout);
  const candle = layout.candles.reduce((near, c) => (c.base.distanceTo(cam.position) < near.base.distanceTo(cam.position) ? c : near));
  const nearPoint = candle.base.clone();
  const farPoint = layout.window.centre.clone();
  rig.rest();
  const nearRest = stage(cam, nearPoint);
  const farRest = stage(cam, farPoint);
  // Full deflection, settled; drift removed by measuring against apply at the
  // same instant with no deflection.
  const settle = (x: number, y: number): { near: { x: number; y: number }; far: { x: number; y: number } } => {
    const c = makeRoomCamera();
    const r = new CameraRig(c, layout);
    r.look(x, y);
    for (let t = 1; t <= 3000; t += 16) r.apply(t);
    return { near: stage(c, nearPoint), far: stage(c, farPoint) };
  };
  const still = settle(0, 0);
  const moved = settle(1, 1);
  const nearShift = Math.hypot(moved.near.x - still.near.x, moved.near.y - still.near.y) / Math.SQRT2;
  const farShift = Math.hypot(moved.far.x - still.far.x, moved.far.y - still.far.y) / Math.SQRT2;
  ok(nearRest.x > 0 && farRest.x > 0, "the nearest candle and the window are both in view at rest");
  ok(
    nearShift > 0 && nearShift <= 12 * 0.85 + 0.5,
    `parallax: full deflection moves the nearest candle ${nearShift.toFixed(1)} stage units per axis — within the near layer's clamp (12 x 0.85), which is css px at 1440 wide`,
  );
  ok(farShift < nearShift, `and the back of the room less (${farShift.toFixed(1)}): depth, from distance rather than from a table`);
  // Direction: the CSS room translates its layers by -x * reach, so a pointer
  // at the left carries the near layer RIGHT and a pointer at the top carries
  // it DOWN. The 3D room must move the same way, or the two disagree at the
  // crossfade and the room feels reversed on every device that swaps between them.
  const toLeftTop = settle(-1, -1);
  ok(
    toLeftTop.near.x > still.near.x && toLeftTop.near.y > still.near.y,
    `and the same way as the CSS room: pointer top-left moves the nearest candle right (${(toLeftTop.near.x - still.near.x).toFixed(1)}) and down (${(toLeftTop.near.y - still.near.y).toFixed(1)}), as the near layer's translate(-x * reach) does`,
  );
  ok(PARALLAX_M > 0, "the camera slides, it does not turn, so parallax never tilts a vertical");
}

console.log(`SANCTUARY THREE CAMERA ASSERTIONS PASSED (${assertions})`);
