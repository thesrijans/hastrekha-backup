/**
 * Synthetic hand fixtures shared by the scan tests.
 *
 * Image coordinates are normalised 0–1; world coordinates are metres with the wrist at the origin
 * and the palm lying in the z = 0 plane, so the palm normal points straight at the camera.
 */
import { LM } from "../lib/scan/landmark-index";
import type { Landmark3 } from "../lib/scan/types";

export interface HandFixture {
  readonly image: Landmark3[];
  readonly world: Landmark3[];
}

/** An open right hand, palm toward the camera, comfortably inside every gate band. */
export function syntheticHand(): HandFixture {
  const image: Landmark3[] = new Array(21).fill(null).map(() => ({ x: 0.5, y: 0.5, z: 0 }));
  const world: Landmark3[] = new Array(21).fill(null).map(() => ({ x: 0, y: 0, z: 0 }));
  const put = (index: number, ix: number, iy: number, wx: number, wy: number) => {
    image[index] = { x: ix, y: iy, z: 0 };
    world[index] = { x: wx, y: wy, z: 0 };
  };

  put(LM.WRIST, 0.5, 0.9, 0, 0);
  put(LM.THUMB_CMC, 0.34, 0.78, -0.035, 0.022);
  put(LM.THUMB_MCP, 0.27, 0.68, -0.055, 0.042);
  put(LM.THUMB_IP, 0.22, 0.6, -0.07, 0.058);
  put(LM.THUMB_TIP, 0.18, 0.54, -0.082, 0.07);
  put(LM.INDEX_MCP, 0.38, 0.45, -0.032, 0.093);
  put(LM.INDEX_PIP, 0.36, 0.33, -0.034, 0.126);
  put(LM.INDEX_DIP, 0.35, 0.26, -0.036, 0.146);
  put(LM.INDEX_TIP, 0.345, 0.2, -0.037, 0.163);
  put(LM.MIDDLE_MCP, 0.5, 0.44, 0, 0.096);
  put(LM.MIDDLE_PIP, 0.5, 0.31, 0, 0.133);
  put(LM.MIDDLE_DIP, 0.5, 0.23, 0, 0.156);
  put(LM.MIDDLE_TIP, 0.5, 0.16, 0, 0.176);
  put(LM.RING_MCP, 0.61, 0.45, 0.03, 0.093);
  put(LM.RING_PIP, 0.62, 0.33, 0.032, 0.128);
  put(LM.RING_DIP, 0.625, 0.26, 0.033, 0.148);
  put(LM.RING_TIP, 0.63, 0.2, 0.034, 0.166);
  put(LM.PINKY_MCP, 0.71, 0.49, 0.058, 0.084);
  put(LM.PINKY_PIP, 0.73, 0.39, 0.062, 0.112);
  put(LM.PINKY_DIP, 0.74, 0.33, 0.064, 0.128);
  put(LM.PINKY_TIP, 0.75, 0.28, 0.066, 0.142);
  return { image, world };
}

/** Every finger curled toward the camera — the pose that hides the very lines being read. */
export function curledHand(): HandFixture {
  const { image, world } = syntheticHand();
  for (const finger of [
    { mcp: LM.INDEX_MCP, pip: LM.INDEX_PIP, dip: LM.INDEX_DIP, tip: LM.INDEX_TIP },
    { mcp: LM.MIDDLE_MCP, pip: LM.MIDDLE_PIP, dip: LM.MIDDLE_DIP, tip: LM.MIDDLE_TIP },
    { mcp: LM.RING_MCP, pip: LM.RING_PIP, dip: LM.RING_DIP, tip: LM.RING_TIP },
    { mcp: LM.PINKY_MCP, pip: LM.PINKY_PIP, dip: LM.PINKY_DIP, tip: LM.PINKY_TIP },
  ]) {
    const base = world[finger.mcp];
    // Curl out of the palm plane: the tip comes back toward the knuckle but sits far along +z.
    world[finger.pip] = { x: base.x, y: base.y + 0.03, z: 0.01 };
    world[finger.dip] = { x: base.x, y: base.y + 0.03, z: 0.03 };
    world[finger.tip] = { x: base.x, y: base.y + 0.01, z: 0.045 };
  }
  return { image, world };
}

/** Mirrors a hand across the vertical axis — turns the right-hand fixture into a left-hand one. */
export function mirrorHand(landmarks: readonly Landmark3[]): Landmark3[] {
  return landmarks.map((point) => ({ ...point, x: 1 - point.x }));
}
