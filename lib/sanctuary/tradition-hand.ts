/**
 * The tradition's hand — an original open right hand, and the classical lines on it.
 *
 * Two places draw this hand and neither may look like a reading:
 *
 *  · C3's plate on Home, which draws the outline, the classical lines and the
 *    nine रेखा names the brief lists — a diagram of what the tradition names,
 *    captioned "पारंपरिक चित्र";
 *  · the room's hologram (B2), which draws the OUTLINE ONLY. [A2] That hand is a
 *    symbol of the scan and must not resemble a traced result, so it never
 *    receives a line.
 *
 * NOT THE POTHI'S HAND. components/sanctuary/pothi/palm-plate.tsx has
 * `NEUTRAL_PALM_PATH`, but that outline is registered to a scan crop — an open
 * palm with the fingers cut off at the frame — because it sits under a real
 * reader's traced lines. A diagram of the tradition needs a whole hand, so this is
 * a separate drawing, and keeping them separate is also what keeps the diagram
 * from ever being mistaken for somebody's result.
 *
 * GEOMETRY. A right hand, palm toward the viewer, thumb on the viewer's right —
 * the orientation the home reference draws. Fingers of four lengths (middle
 * longest, little shortest), slightly spread; the thumb swung out from the
 * thenar mound. Units are a 216 × 290 box; the wrist is left open at y 258 so
 * the hand reads as reaching up out of the page rather than as a cut-out.
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

/** The outline, open at the wrist. */
export const TRADITION_HAND_OUTLINE =
  "M66,258 C62,232 55,200 54,168 C54,154 54,142 55,135 C56,129 57,125 57.2,121.9 " +
  "L43.2,63.9 A8,8 0 0,1 58.8,60.1 L72.8,118.1 Q75.5,112 78.5,108.4 " +
  "L75,30.4 A9,9 0 0,1 93,29.6 L96.5,107.6 Q99,104 101.5,101.8 " +
  "L103.5,15.8 A9.5,9.5 0 0,1 122.5,16.2 L120.5,102.2 Q123,106 125.6,109.7 " +
  "L136.1,36.7 A9,9 0 0,1 153.9,39.3 L143.4,112.3 C145,125 148,138 151,148 " +
  "C152,156 153,162 153.8,166.9 L182.8,114.9 A10.5,10.5 0 0,1 201.2,125.1 L172.2,177.1 " +
  "C172,200 152,232 134,258";

/** The same outline closed across the wrist — for a filled silhouette. */
export const TRADITION_HAND_SILHOUETTE = `${TRADITION_HAND_OUTLINE} Z`;

/**
 * The finger joints: two short creases on each finger and one on the thumb.
 * Only the plate draws them — an engraver's detail that makes a diagram a hand.
 */
export const TRADITION_HAND_CREASES =
  "M49,88 Q55,86 61,88 M47,76 Q52,74 58,75 " +
  "M78,64 Q84,63 90,64 M77,48 Q83,47 89,48 " +
  "M104,52 Q112,51 120,53 M104,34 Q112,33 120,35 " +
  "M131,72 Q139,72 147,75 M133,56 Q140,56 148,58 " +
  "M170,150 Q176,153 182,150";

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
