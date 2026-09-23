/**
 * The tradition's hand — the classical lines, and where the real hand goes under them.
 *
 * Two places show this hand and neither may look like a reading:
 *
 *  · C3's plate on Home, which lays the classical lines and the nine रेखा
 *    names the brief lists over the baked hand — a diagram of what the
 *    tradition names, captioned "पारंपरिक चित्र";
 *  · the room's book, whose left leaf carries the same plate small, as the
 *    book's own drawing. [A2] The room's hologram is the SAME mesh with no
 *    line on it at all (public/plates/hand-hologram): a symbol of the scan
 *    that must not resemble a traced result.
 *
 * NOT THE POTHI'S HAND. The Pothi's plate (components/sanctuary/pothi/
 * palm-plate.tsx) is the same mesh baked into the scan crop's canonical frame —
 * a palm with the fingers cut off at the frame — because it sits under a real
 * reader's traced lines. A diagram of the tradition needs a whole hand, so it is
 * a separate bake, and keeping them separate is also what keeps the diagram
 * from ever being mistaken for somebody's result.
 *
 * GEOMETRY. A right hand, palm toward the viewer, thumb on the viewer's right —
 * the orientation the home reference draws. Units are a 216 x 290 box; the
 * wrist is at y 258 so the hand reads as reaching up out of the page.
 *
 * THE LINES ARE THE TRADITION'S, NOT A CLAIM. Placement follows the classical
 * diagrams (heart line across the top of the palm, head line below it, the life
 * line round the thenar mound, the fate line rising to the middle finger, and so
 * on). Rahu and Ketu are placed where Indian palmistry commonly locates them —
 * Rahu across the plain of Mars at the palm's centre, Ketu at the palm's root
 * above the wrist — and different schools draw them differently. That is why the
 * plate is captioned as a traditional diagram and never as anatomy.
 */

export const TRADITION_HAND_VIEWBOX = { width: 216, height: 290 } as const;

/**
 * THE HAND IS A BAKED RENDER, NOT A DRAWING (M1.1). public/plates/hand-tradition
 * is the P1 mesh (public/models/hand.glb) rendered palm-forward, fingers up,
 * thumb on the viewer's right, and registered into this 216 x 290 box so that
 * the mesh's own joints land on the three points below — where the outline the
 * lines were drawn against put them. The lines are unchanged; the hand under
 * them is the real one. scripts/plates/bake-hand.mjs reads these, and the
 * plate's bake.json records them, so a change here without a re-bake fails
 * test/sanctuary-hand-plates.test.ts rather than sliding the lines off the hand.
 */
export const TRADITION_HAND_LANDMARKS = {
  /** The middle of the wrist. */
  wrist: { x: 100, y: 258 },
  /** The index finger's knuckle — the joint centre, a little below the finger's base crease on the palm side. Thumb side, viewer's right. */
  indexMcp: { x: 134, y: 123 },
  /** The little finger's knuckle. Viewer's left. */
  littleMcp: { x: 65, y: 132 },
} as const;

/**
 * The box the tradition plate is baked into, in hand units. The real hand's
 * fingers are longer, against its palm, than the drawn outline's were, so with
 * its knuckles on the points above its fingertips reach past y 0; the plate
 * carries that overflow rather than cutting the fingers, and TraditionPalm lays
 * it so that this box's (0, 0)-(216, 290) is the drawing's own.
 */
export const TRADITION_HAND_PLATE_BOX = { x: 0, y: -22, width: 216, height: 312 } as const;

export type TraditionLineId =
  | "life"
  | "head"
  | "heart"
  | "fate"
  | "sun"
  | "mercury"
  | "venus"
  | "moon"
  | "mars"
  | "rahu"
  | "ketu";

export interface TraditionLine {
  readonly id: TraditionLineId;
  readonly d: string;
  /**
   * The रेखा name as C3 lists it, or `null` for a line drawn without a label.
   *
   * THE BRIEF NAMES NINE, and they are the nine set here verbatim. The two most
   * familiar lines of all — जीवन (life) and मस्तिष्क (head) — are not among them,
   * so they are drawn, because a palm without them is not a palm, and left
   * unlabelled rather than given names the brief did not ask for. Flagged for a
   * decision; adding them is two strings.
   */
  readonly labelHi: string | null;
  /** Where the leader leaves the line, in hand units. */
  readonly anchor: { readonly x: number; readonly y: number } | null;
  /** Where the label sits: which side of the hand, and at what height. */
  readonly label: { readonly side: "left" | "right" | "bottom"; readonly y: number } | null;
}

export const TRADITION_LINES: readonly TraditionLine[] = [
  { id: "life", d: "M147,141 C128,160 118,200 124,246", labelHi: null, anchor: null, label: null },
  { id: "head", d: "M147,141 C122,150 94,158 60,176", labelHi: null, anchor: null, label: null },
  { id: "heart", d: "M56,146 C80,152 104,142 130,122", labelHi: "हृदय रेखा", anchor: { x: 66, y: 149 }, label: { side: "left", y: 140 } },
  { id: "fate", d: "M104,250 C102,210 106,160 111,106", labelHi: "शनि रेखा", anchor: { x: 104, y: 244 }, label: { side: "bottom", y: 282 } },
  { id: "sun", d: "M90,200 C92,168 90,138 88,112", labelHi: "सूर्य रेखा", anchor: { x: 90, y: 130 }, label: { side: "left", y: 104 } },
  { id: "mercury", d: "M104,238 C90,206 76,166 67,126", labelHi: "बुध रेखा", anchor: { x: 80, y: 180 }, label: { side: "left", y: 178 } },
  { id: "venus", d: "M80,120 C92,134 114,134 126,118", labelHi: "शुक्र रेखा", anchor: { x: 121, y: 125 }, label: { side: "right", y: 96 } },
  { id: "moon", d: "M60,158 C74,186 74,218 66,244", labelHi: "चंद्र रेखा", anchor: { x: 71, y: 214 }, label: { side: "left", y: 216 } },
  { id: "mars", d: "M140,166 C130,184 128,210 131,232", labelHi: "मंगल रेखा", anchor: { x: 131, y: 196 }, label: { side: "right", y: 176 } },
  { id: "rahu", d: "M132,188 C120,190 108,194 98,200", labelHi: "राहु रेखा", anchor: { x: 112, y: 195 }, label: { side: "right", y: 214 } },
  { id: "ketu", d: "M86,246 C90,238 94,232 100,228", labelHi: "केतु रेखा", anchor: { x: 93, y: 236 }, label: { side: "right", y: 250 } },
];

/** The nine names C3 asks for, in the brief's order. The plate must set exactly these. */
export const TRADITION_LABELS_HI: readonly string[] = [
  "सूर्य रेखा",
  "बुध रेखा",
  "शनि रेखा",
  "हृदय रेखा",
  "शुक्र रेखा",
  "चंद्र रेखा",
  "मंगल रेखा",
  "राहु रेखा",
  "केतु रेखा",
];

/** Where the leaders end, just outside the hand's box on each side. */
export const TRADITION_LEADER_X = { left: -6, right: 222 } as const;
