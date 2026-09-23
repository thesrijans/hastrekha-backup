/**
 * The camera system: five named poses, a hand-rolled ease between them, a slow
 * breathing drift, and parallax from the pointer and from device tilt.
 *
 * FIVE POSES, EACH DERIVED FROM THE OBJECT IT FRAMES. §8 names them and says
 * what each shows:
 *
 *   sanctuary  wide, pedestal centre-left, book right
 *   scanner    pushed in on the pedestal, book out of frame
 *   book       the manuscript fills frame
 *   guru       three-quarter, scroll foreground  (reserved for U4)
 *   library    at the shelves
 *
 * `sanctuary` IS the P2 camera, untouched, so the 3D room still registers on
 * the CSS room at rest, where the two cross-fade. The others are computed from
 * the object's size and the fill §8 asks for — not copied from the CSS room's
 * zoom factors. A dolly that matched the CSS zoom (1.85x about stage 530,420)
 * was tried on paper and fails the spec: a dolly magnifies farther things less,
 * so the book would still sit at the right edge (stage x ~1579) where §8 wants
 * it out of frame. The CSS numbers are U3a's approximation for a flat set; a
 * real camera frames the real object.
 *
 * EVERY POSE IS LEVEL. The camera only ever yaws; framing is done with the
 * shift lens (stage-projection.ts `applyHorizon`), so the room's verticals —
 * the column, the candles, the shelves — stay upright through every move, not
 * only at rest.
 *
 * THE EASE IS THE SANCTUARY'S OWN. `--snc-ease` is cubic-bezier(.16, 1, .3, 1)
 * and the CSS camera moves on it; this solves the same curve by hand, so a move
 * in the 3D room and a move in the CSS room take the same shape in time. GSAP
 * was the spec's tool and was never installed: the chunk has no room for it
 * (spec [R9]) and one curve does not need a library.
 *
 * NAV BEFORE ROUTE. The island (app/sanctuary/home-island.tsx) owns the click:
 * it marks the room's set with `data-snc-camera`, waits ROOM_CAMERA_MOVE_MS and
 * only then opens the route. The canvas watches that attribute and moves this
 * rig over exactly that duration, so the camera arrives as the route opens.
 */
import { Vector3, type PerspectiveCamera } from "three";
import { ROOM_CAMERA_MOVE_MS, ROOM_CSS_CAMERAS } from "@/lib/sanctuary/room-composition";
import type { RoomLayout } from "./layout";
import { applyHorizon, CAMERA_SANCTUARY, STAGE_ASPECT, type StageWindow } from "./stage-projection";

export type RoomCameraName = keyof typeof ROOM_CSS_CAMERAS;
export const ROOM_CAMERA_NAMES = Object.keys(ROOM_CSS_CAMERAS) as RoomCameraName[];

export interface CameraPose {
  readonly position: Vector3;
  /** Rotation about the vertical, radians. 0 looks down -z, as the rest camera does. */
  readonly yaw: number;
  /** Where eye level falls on the stage, in stage units from the top (the shift lens). */
  readonly horizon: number;
}

/* ------------------------------------------------------------------------ */
/* THE EASE                                                                   */
/* ------------------------------------------------------------------------ */

/** `--snc-ease`, app/sanctuary.css. */
export const SNC_EASE = [0.16, 1, 0.3, 1] as const;

/**
 * cubic-bezier(x1, y1, x2, y2) at time t, solved the way browsers solve it:
 * Newton's method on x(s) = t, falling back to bisection where the slope is
 * flat, then y(s).
 */
export function cubicBezier(x1: number, y1: number, x2: number, y2: number): (t: number) => number {
  const cx = 3 * x1;
  const bx = 3 * (x2 - x1) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * y1;
  const by = 3 * (y2 - y1) - cy;
  const ay = 1 - cy - by;
  const x = (s: number): number => ((ax * s + bx) * s + cx) * s;
  const y = (s: number): number => ((ay * s + by) * s + cy) * s;
  const dx = (s: number): number => (3 * ax * s + 2 * bx) * s + cx;
  return (t: number): number => {
    if (t <= 0) return 0;
    if (t >= 1) return 1;
    let s = t;
    for (let i = 0; i < 8; i += 1) {
      const error = x(s) - t;
      if (Math.abs(error) < 1e-7) return y(s);
      const slope = dx(s);
      if (Math.abs(slope) < 1e-6) break;
      s -= error / slope;
    }
    let lo = 0;
    let hi = 1;
    s = t;
    for (let i = 0; i < 40; i += 1) {
      const value = x(s);
      if (Math.abs(value - t) < 1e-7) break;
      if (value < t) lo = s;
      else hi = s;
      s = (lo + hi) / 2;
    }
    return y(s);
  };
}

export const easeCamera = cubicBezier(...SNC_EASE);

/* ------------------------------------------------------------------------ */
/* THE POSES                                                                  */
/* ------------------------------------------------------------------------ */

/** How far right of the rest camera's line the scanner pose comes in, radians. */
export const SCANNER_APPROACH = (12 * Math.PI) / 180;

/** How much of the frame each subject fills (§8's "pushed in", "fills frame"). */
export const POSE_FILL = { scanner: 0.94, book: 0.8, library: 0.82 } as const;

const TAN_HALF_V = Math.tan((CAMERA_SANCTUARY.fov * Math.PI) / 360);
const TAN_HALF_H = TAN_HALF_V * STAGE_ASPECT;
/** Stage units per unit of tan(angle) — the focal length on the 900-unit stage. */
const FOCAL_STAGE = 450 / TAN_HALF_V;

/** Frame a point from a direction, level, at a distance, with the point centred. */
function frame(target: Vector3, from: Vector3, distance: number, lift = 0): CameraPose {
  const direction = new Vector3(from.x, 0, from.z).normalize();
  const position = target.clone().addScaledVector(direction, distance);
  position.y = target.y + lift;
  // Looking back along -direction, horizontally.
  const yaw = Math.atan2(direction.x, direction.z);
  // With the camera `lift` above the target, the target sits (lift/distance) of
  // the focal length below eye level; move eye level up by that much to centre it.
  const horizon = 450 - (lift / distance) * FOCAL_STAGE;
  return { position, yaw, horizon };
}

/** The five poses, from the room's own layout. */
export function roomCameraPoses(layout: RoomLayout): Record<RoomCameraName, CameraPose> {
  const rest: CameraPose = {
    position: CAMERA_SANCTUARY.position.clone(),
    yaw: 0,
    horizon: CAMERA_SANCTUARY.horizon,
  };
  const { pedestal, hologram, book, library } = layout;

  // Scanner: the drum and the whole column, floor to canopy, fill the height,
  // approached from a little RIGHT of the rest camera's line (SCANNER_APPROACH):
  // the book stands behind and right of the pedestal, and from straight down
  // the rest line its nearest page corner stayed in frame at stage x 1552 even
  // with the column filling 94% of the height. Held on the pedestal, a camera
  // that moves right carries the farther book right with it, out of frame —
  // §8's "book out of frame". (Coming in from the left was tried first and
  // pulled the corner in, to 1353.)
  const scannerHeight = pedestal.height + hologram.height;
  const scannerTarget = new Vector3(pedestal.centre.x, scannerHeight / 2, pedestal.centre.z);
  const toRest = rest.position.clone().sub(scannerTarget);
  const approach = toRest.applyAxisAngle(new Vector3(0, 1, 0), SCANNER_APPROACH);
  const scanner = frame(scannerTarget, approach, scannerHeight / (2 * TAN_HALF_V * POSE_FILL.scanner));

  // Book: the open pages (1.22 m) fill the width, seen square-on — the book is
  // turned 0.34 rad toward the pedestal (props.ts), so is the camera — and from
  // a little above, since the lectern leans the pages up toward a reader.
  const bookFacing = new Vector3(Math.sin(-0.34), 0, Math.cos(-0.34));
  const bookDistance = 1.22 / (2 * TAN_HALF_H * POSE_FILL.book);
  const bookPose = frame(book.spine, bookFacing, bookDistance, 0.32);

  // Library: the shelves (2.3 m tall) fill the height, seen square-on — the
  // shelf wall is turned 0.55 rad into the room (props.ts).
  const shelvesFacing = new Vector3(Math.sin(0.55), 0, Math.cos(0.55));
  const libraryPose = frame(library.centre, shelvesFacing, 2.3 / (2 * TAN_HALF_V * POSE_FILL.library));

  // Guru (reserved for U4): a three-quarter view — the room seen from 28°
  // round to the right of the rest camera, a little closer, still level.
  const orbit = 28 * (Math.PI / 180);
  const pivot = new Vector3(pedestal.centre.x, rest.position.y, pedestal.centre.z);
  const arm = rest.position.clone().sub(pivot).multiplyScalar(0.8);
  const guruPosition = pivot.clone().add(new Vector3(arm.x * Math.cos(orbit) + arm.z * Math.sin(orbit), 0, -arm.x * Math.sin(orbit) + arm.z * Math.cos(orbit)));
  const guru: CameraPose = { position: guruPosition, yaw: orbit, horizon: rest.horizon };

  return { sanctuary: rest, scanner, book: bookPose, library: libraryPose, guru };
}

/* ------------------------------------------------------------------------ */
/* DRIFT AND PARALLAX                                                         */
/* ------------------------------------------------------------------------ */

/**
 * The breathing drift: two incommensurate slow sines per axis. At rest it moves
 * the pedestal on screen by under three stage units — a room breathing, not a
 * camera shaking — and its periods are 11.3 s and 17.9 s, far slower than the
 * candles' 2-4 Hz, so the eye reads them as two different things.
 *
 * The yaw term is kept smallest: a turn moves everything in frame by the same
 * angle, near and far alike, so it reads as the camera swinging rather than as
 * depth. At 0.0022 rad it alone moved the pedestal ~3 units and the total
 * reached 5.72; these amplitudes hold the whole breath under 3.
 */
export const DRIFT = { x: 0.0055, y: 0.004, yaw: 0.0006, periodsS: [11.3, 17.9] as const } as const;

/**
 * Parallax: how far the camera slides for a full pointer or tilt deflection.
 * Chosen so the nearest thing in the room (the candle at the pedestal's right,
 * ~3.2 m away) moves at most the near layer's clamp at 1440 wide — 12 px x
 * 0.85 — and the back of the room (~8.5 m) about the far layer's 3 px: the same
 * depths the CSS layers parallax by, arrived at from distance instead of from
 * a table. (0.024 m, sized for 3.3 m, measured 10.9 px on that candle.)
 */
export const PARALLAX_M = 0.0225;

/**
 * The follow and the tilt, restated from components/sanctuary/scene-plate.tsx
 * (the island restates them too); test/sanctuary-home.test.tsx holds all three
 * copies together. Imported rather than restated they would drag a React
 * component into the 3D chunk.
 */
export const FOLLOW_TIME_CONSTANT_MS = 220;
export const MAX_FRAME_DT_MS = 64;
export const TILT_FULL_DEFLECTION_DEG = 24;
export const TILT_NEUTRAL_BETA_DEG = 45;

/* ------------------------------------------------------------------------ */
/* THE RIG                                                                    */
/* ------------------------------------------------------------------------ */

export class CameraRig {
  readonly poses: Record<RoomCameraName, CameraPose>;
  private from: CameraPose;
  private to: CameraPose;
  private started = -Infinity;
  private duration = ROOM_CAMERA_MOVE_MS;
  private aim: RoomCameraName = "sanctuary";
  private targetX = 0;
  private targetY = 0;
  private px = 0;
  private py = 0;
  private last = 0;
  private horizonApplied = NaN;

  constructor(
    private readonly camera: PerspectiveCamera,
    layout: RoomLayout,
    /** The phone renders a window of the stage (stage-projection.ts applyHorizon); every pose keeps to it. */
    private window: StageWindow | null = null,
  ) {
    this.poses = roomCameraPoses(layout);
    this.from = this.poses.sanctuary;
    this.to = this.poses.sanctuary;
  }

  /** Where the camera is headed. */
  get destination(): RoomCameraName {
    return this.aim;
  }

  /** Move to a named pose over `duration`, from wherever the camera is now. */
  goTo(name: RoomCameraName, now: number, duration = ROOM_CAMERA_MOVE_MS): void {
    this.from = this.pose(now);
    this.to = this.poses[name];
    this.started = now;
    this.duration = duration;
    this.aim = name;
  }

  /** Pointer or tilt, each axis in -1..1. */
  look(x: number, y: number): void {
    this.targetX = Math.max(-1, Math.min(1, x));
    this.targetY = Math.max(-1, Math.min(1, y));
  }

  /** 0 at the start of a move, 1 when it has arrived. */
  progress(now: number): number {
    return Math.max(0, Math.min(1, (now - this.started) / this.duration));
  }

  /** The eased pose at `now`, before drift and parallax. */
  pose(now: number): CameraPose {
    const k = easeCamera(this.progress(now));
    return {
      position: this.from.position.clone().lerp(this.to.position, k),
      yaw: this.from.yaw + (this.to.yaw - this.from.yaw) * k,
      horizon: this.from.horizon + (this.to.horizon - this.from.horizon) * k,
    };
  }

  /**
   * The camera exactly at rest — the sanctuary pose, no drift, no parallax.
   * For measurement: P2's scores are taken from this camera and must not move
   * with the breathing.
   */
  rest(): void {
    this.from = this.poses.sanctuary;
    this.to = this.poses.sanctuary;
    this.started = -Infinity;
    this.aim = "sanctuary";
    this.px = 0;
    this.py = 0;
    this.targetX = 0;
    this.targetY = 0;
    const pose = this.poses.sanctuary;
    this.camera.position.copy(pose.position);
    this.camera.rotation.set(0, pose.yaw, 0);
    this.camera.updateMatrixWorld(true);
    applyHorizon(this.camera, pose.horizon, this.window);
    this.horizonApplied = pose.horizon;
  }

  /** A new window of the stage (the vignette was resized): the next apply() cuts the frame to it. */
  setWindow(window: StageWindow | null): void {
    this.window = window;
    this.horizonApplied = NaN;
  }

  /** Put the camera where it belongs at `now` (ms) — pose, then drift, then parallax. */
  apply(now: number): void {
    const dt = this.last === 0 ? 16 : Math.min(now - this.last, MAX_FRAME_DT_MS);
    this.last = now;
    const k = 1 - Math.exp(-dt / FOLLOW_TIME_CONSTANT_MS);
    this.px += (this.targetX - this.px) * k;
    this.py += (this.targetY - this.py) * k;

    const pose = this.pose(now);
    const seconds = now / 1000;
    const [a, b] = DRIFT.periodsS;
    const breathe = (period: number, phase: number): number => Math.sin((seconds / period) * Math.PI * 2 + phase);
    const driftX = DRIFT.x * (0.6 * breathe(a, 0) + 0.4 * breathe(b, 1.3));
    const driftY = DRIFT.y * (0.6 * breathe(b, 0.7) + 0.4 * breathe(a, 2.1));
    const driftYaw = DRIFT.yaw * breathe(b * 1.37, 0.4);

    const yaw = pose.yaw + driftYaw;
    // Parallax slides the camera across its own view, WITH the pointer. The CSS
    // room moves its layers opposite to the pointer (translate = -x * reach), so
    // a pointer to the left carries the near layers right on screen; a camera
    // gets that same picture by stepping left, because stepping left is what
    // slides near things right. (The first version stepped opposite to the
    // pointer and parallaxed the 3D room the reverse way to the CSS room.)
    // Pointer y runs down the screen; the camera rises for a pointer near the top.
    const right = new Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
    const position = pose.position
      .clone()
      .addScaledVector(right, driftX + this.px * PARALLAX_M)
      .add(new Vector3(0, driftY - this.py * PARALLAX_M, 0));

    this.camera.position.copy(position);
    this.camera.rotation.set(0, yaw, 0);
    this.camera.updateMatrixWorld(true);
    // `!(x <= tol)` rather than `x > tol`: the first frame compares against NaN,
    // and every comparison with NaN is false — written the obvious way, the
    // horizon was never applied at all and every pose kept the rest camera's.
    if (!(Math.abs(pose.horizon - this.horizonApplied) <= 1e-4)) {
      applyHorizon(this.camera, pose.horizon, this.window);
      this.horizonApplied = pose.horizon;
    }
  }
}
