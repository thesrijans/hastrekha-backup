/**
 * Print where each camera pose puts the object it frames, in stage units.
 * A reading aid for tuning camera-rig.ts, as layout-print.ts is for layout.ts.
 *
 *   npx tsx scripts/capture/pose-print.ts
 */
import { Vector3 } from "three";
import { CameraRig, ROOM_CAMERA_NAMES } from "../../components/sanctuary/room/three/camera-rig";
import { computeLayout } from "../../components/sanctuary/room/three/layout";
import { makeRoomCamera, worldToStage } from "../../components/sanctuary/room/three/stage-projection";

const layout = computeLayout(makeRoomCamera());
for (const name of ROOM_CAMERA_NAMES) {
  const cam = makeRoomCamera();
  const rig = new CameraRig(cam, layout);
  rig.goTo(name, 0, 1);
  rig.apply(10);
  const pose = rig.pose(10);
  cam.position.copy(pose.position);
  cam.rotation.set(0, pose.yaw, 0);
  cam.updateMatrixWorld(true);
  const s = (p: Vector3): string => {
    const q = worldToStage(cam, p);
    return `(${q.x.toFixed(0)}, ${q.y.toFixed(0)})`;
  };
  const c = Math.cos(-0.34);
  const sn = Math.sin(-0.34);
  const page = (x: number): Vector3 => new Vector3(layout.book.spine.x + x * c, layout.book.spine.y + 0.1, layout.book.spine.z - x * sn);
  console.log(
    `${name.padEnd(10)} pos (${pose.position.x.toFixed(2)}, ${pose.position.y.toFixed(2)}, ${pose.position.z.toFixed(2)}) yaw ${((pose.yaw * 180) / Math.PI).toFixed(1)} horizon ${pose.horizon.toFixed(0)}` +
      `  | pedestal ${s(layout.pedestal.centre)}  book spine ${s(layout.book.spine)} pages ${s(page(-0.61))}..${s(page(0.61))}  shelves ${s(layout.library.centre)}`,
  );
}
