/**
 * The camera, and the rule that keeps the 3D room and the CSS room one room.
 *
 * lib/sanctuary/room-composition.ts places everything in a 1600 x 900 stage:
 * the pedestal's top face at (530, 588), the book's spine at (1292, 470), the
 * window at (1235, 300). The CSS composition draws its layers in exactly that
 * viewBox, inside a `.set` box that is 16:9 and covers the hero. This canvas
 * sits in the same `.set` box, so it is the same 16:9 frame, and a stage point
 * and a screen point are the same thing on both renderers.
 *
 * SO NO OBJECT IS PLACED BY EYE. Each is placed by casting the camera ray
 * through its stage anchor and intersecting it with the plane the object
 * stands on — the pedestal's top face, the book's lectern, the back wall. The
 * object then lands on the anchor's screen point by construction, and the two
 * rooms agree at the crossfade without a single metre being tuned to match.
 * That is Amendment 4's "the CSS plate fallback matches the 3D composition
 * with no layout shift", made structural rather than hoped for.
 *
 * Sizes follow the same rule where the CSS room already committed to one: the
 * pedestal is as wide on screen as the CSS zodiac ring (460 stage units),
 * because the ring is drawn over it and a mismatch would show at once.
 */
import { PerspectiveCamera, Plane, Ray, Vector2, Vector3, Raycaster } from "three";
import { ROOM_STAGE } from "@/lib/sanctuary/room-composition";

/** The canvas is the `.set` box, which is 16:9 by its own CSS. */
export const STAGE_ASPECT = ROOM_STAGE.width / ROOM_STAGE.height;

/**
 * CAM_SANCTUARY — the wide view, taken with a SHIFT LENS.
 *
 * The camera is LEVEL and the frame is shifted down to take in the desk, the
 * way an architectural photographer keeps a building's verticals upright. The
 * first version pitched the camera down at the pedestal instead, and that made
 * every vertical converge: test/sanctuary-three-layout.test.ts found the
 * hologram's middle landing at stage x 523 against the CSS room's 530, a lean
 * of about 14 units by the column's top, because the CSS room draws its column
 * perfectly upright. Pitch cannot be tuned away — any camera that looks down
 * makes an off-centre vertical lean. A level camera with a shifted frame keeps
 * every vertical in the room vertical on screen: the column, the candles, the
 * shelves, the window's mullions. That is also how the reference is drawn.
 *
 * `horizon` is where eye level falls on the stage, in stage units from the top.
 */
export const CAMERA_SANCTUARY = {
  position: new Vector3(0, 1.05, 4.6),
  fov: 36,
  horizon: 372,
} as const;

/** A rectangle of the stage, in stage units: the part of the frame a window camera renders. */
export interface StageWindow {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/**
 * Shift a level camera's frame so eye level lands on `horizon` — and, with a
 * `window`, cut the frame to that rectangle of the stage.
 *
 * In Three's projection matrix, element 9 is the frustum's vertical offset:
 * an on-axis point maps to NDC y = -m[9]. Setting it moves the horizon without
 * tilting the camera. Raycaster reads `projectionMatrixInverse`, so that is
 * refreshed too, or every stage ray would be cast through the unshifted frame.
 *
 * THE WINDOW IS THE SAME FRUSTUM, CUT (M1.1). The shifted frame is the frustum
 * top = t(1 - ndcY), bottom = -t(1 + ndcY), left/right = -/+ t·aspect, with
 * t = near·tan(fov/2); a window of the stage is each edge moved in by the
 * window's share of the frame. A stage point projects to the same place
 * through both — scripts/plates/bake-hand.mjs proves it to a hundredth of a
 * unit — so the phone's canvas (room-canvas.tsx), which renders only the part
 * of the stage its vignette shows, lands on the CSS composition's pixels
 * exactly, and everything outside the window is frustum-culled for free.
 *
 * Anything that calls updateProjectionMatrix() resets the shift, so the room
 * only ever builds its camera here; the canvas is 16:9 by its own CSS and never
 * needs its aspect changed.
 */
export function applyHorizon(camera: PerspectiveCamera, horizon: number, window: StageWindow | null = null): void {
  const ndcY = 1 - (horizon / ROOM_STAGE.height) * 2;
  if (window === null) {
    camera.updateProjectionMatrix();
    camera.projectionMatrix.elements[9] = -ndcY;
  } else {
    const t = camera.near * Math.tan((camera.fov * Math.PI) / 360);
    const top = t * (1 - ndcY);
    const bottom = -t * (1 + ndcY);
    const left = -t * STAGE_ASPECT;
    const right = t * STAGE_ASPECT;
    const { width: W, height: H } = ROOM_STAGE;
    camera.projectionMatrix.makePerspective(
      left + (window.x / W) * (right - left),
      left + ((window.x + window.w) / W) * (right - left),
      top - (window.y / H) * (top - bottom),
      top - ((window.y + window.h) / H) * (top - bottom),
      camera.near,
      camera.far,
    );
  }
  camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
}

export function makeRoomCamera(): PerspectiveCamera {
  const camera = new PerspectiveCamera(CAMERA_SANCTUARY.fov, STAGE_ASPECT, 0.1, 60);
  camera.position.copy(CAMERA_SANCTUARY.position);
  // Level: the target is at the camera's own height.
  camera.lookAt(new Vector3(0, CAMERA_SANCTUARY.position.y, 0));
  camera.updateMatrixWorld(true);
  applyHorizon(camera, CAMERA_SANCTUARY.horizon);
  return camera;
}

const caster = new Raycaster();
const ndc = new Vector2();

/** The camera ray through a stage point. */
export function stageRay(camera: PerspectiveCamera, x: number, y: number): Ray {
  ndc.set((x / ROOM_STAGE.width) * 2 - 1, 1 - (y / ROOM_STAGE.height) * 2);
  caster.setFromCamera(ndc, camera);
  return caster.ray.clone();
}

function hit(ray: Ray, plane: Plane, what: string): Vector3 {
  const point = ray.intersectPlane(plane, new Vector3());
  if (point === null) throw new Error(`stage ray for ${what} never meets its plane — the camera is looking away from it`);
  return point;
}

/** Where the ray through a stage point meets the horizontal plane at height `y`. */
export function onFloorAt(camera: PerspectiveCamera, x: number, y: number, height: number, what = "a floor point"): Vector3 {
  return hit(stageRay(camera, x, y), new Plane(new Vector3(0, 1, 0), -height), what);
}

/** Where the ray through a stage point meets the vertical plane z = `depth`. */
export function onWallAt(camera: PerspectiveCamera, x: number, y: number, depth: number, what = "a wall point"): Vector3 {
  return hit(stageRay(camera, x, y), new Plane(new Vector3(0, 0, 1), -depth), what);
}

/**
 * How many world units one stage unit spans, horizontally, at a given height
 * plane around a given anchor — what "460 stage units wide" means in metres
 * at the pedestal.
 */
export function worldPerStageX(camera: PerspectiveCamera, x: number, y: number, height: number, halfSpan: number): number {
  const left = onFloorAt(camera, x - halfSpan, y, height);
  const right = onFloorAt(camera, x + halfSpan, y, height);
  return left.distanceTo(right) / (2 * halfSpan);
}

/** Project a world point back to stage units. Used by the tests to prove the registration. */
export function worldToStage(camera: PerspectiveCamera, point: Vector3): { x: number; y: number } {
  const projected = point.clone().project(camera);
  return {
    x: ((projected.x + 1) / 2) * ROOM_STAGE.width,
    y: ((1 - projected.y) / 2) * ROOM_STAGE.height,
  };
}
