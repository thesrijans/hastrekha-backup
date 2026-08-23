/**
 * Named indices into MediaPipe's 21-point hand landmark model.
 *
 * The raw numbers appear all over the geometry code; naming them once means a wrong index is a
 * compile error rather than a subtly wrong palm.
 *
 * Layout: 0 = wrist, then thumb (1–4), index (5–8), middle (9–12), ring (13–16), little (17–20),
 * each running base → tip.
 */
export const LM = {
  WRIST: 0,

  THUMB_CMC: 1,
  THUMB_MCP: 2,
  THUMB_IP: 3,
  THUMB_TIP: 4,

  INDEX_MCP: 5,
  INDEX_PIP: 6,
  INDEX_DIP: 7,
  INDEX_TIP: 8,

  MIDDLE_MCP: 9,
  MIDDLE_PIP: 10,
  MIDDLE_DIP: 11,
  MIDDLE_TIP: 12,

  RING_MCP: 13,
  RING_PIP: 14,
  RING_DIP: 15,
  RING_TIP: 16,

  PINKY_MCP: 17,
  PINKY_PIP: 18,
  PINKY_DIP: 19,
  PINKY_TIP: 20,
} as const;

export const LANDMARK_COUNT = 21;

/** Palmistry names for the four fingers, in the order the classical texts use. */
export const FINGER_MOUNTS = {
  jupiter: { mcp: LM.INDEX_MCP, pip: LM.INDEX_PIP, dip: LM.INDEX_DIP, tip: LM.INDEX_TIP },
  saturn: { mcp: LM.MIDDLE_MCP, pip: LM.MIDDLE_PIP, dip: LM.MIDDLE_DIP, tip: LM.MIDDLE_TIP },
  sun: { mcp: LM.RING_MCP, pip: LM.RING_PIP, dip: LM.RING_DIP, tip: LM.RING_TIP },
  mercury: { mcp: LM.PINKY_MCP, pip: LM.PINKY_PIP, dip: LM.PINKY_DIP, tip: LM.PINKY_TIP },
} as const;

export type FingerName = keyof typeof FINGER_MOUNTS;
export const FINGER_NAMES = ["jupiter", "saturn", "sun", "mercury"] as const satisfies readonly FingerName[];
