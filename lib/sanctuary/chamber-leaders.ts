/**
 * The line labels, and where they are allowed to sit.
 *
 * §6.3: "Detected lines illuminate progressively, as they are actually found —
 * each with its Devanagari name on a thin gold leader line, exactly like the
 * reference. A line that is not found never gets a label."
 *
 * The reference this is drawn from is the home hero: Devanagari names set small,
 * in gold, DIRECTLY ON THE GROUND — no pill, no plate, no box behind any of them
 * — stacked in a left and a right column beside the hand, each connected to what
 * it names. A boxed label would be a tooltip, and a tooltip is a piece of
 * software interface arriving in the middle of a ceremony.
 *
 * Everything here is pure and in canvas pixels. The projection from mask space
 * to canvas is the overlay's job and is nobody's business here; this module only
 * decides, given points that have already landed on the canvas, where a name may
 * be written so that it can be read and does not sit on top of another one.
 */

/** A point in canvas pixels. Structural, so this module stays out of the scan graph. */
export interface LeaderPoint {
  readonly x: number;
  readonly y: number;
}

/** Every line the chamber can name, and its name. */
export const CHAMBER_LINE_NAMES = {
  heart: "हृदय रेखा",
  head: "मस्तिष्क रेखा",
  life: "जीवन रेखा",
  fate: "शनि रेखा",
  sun: "सूर्य रेखा",
  health: "बुध रेखा",
  marriage: "विवाह रेखा",
  girdle_of_venus: "शुक्र मेखला",
  bracelets: "मणिबंध",
} as const satisfies Readonly<Record<string, string>>;

export type ChamberLineId = keyof typeof CHAMBER_LINE_NAMES;

/** The name for a line, or null for a class the chamber does not name. */
export function chamberLineName(id: string): string | null {
  return Object.prototype.hasOwnProperty.call(CHAMBER_LINE_NAMES, id)
    ? CHAMBER_LINE_NAMES[id as ChamberLineId]
    : null;
}

export type LeaderSide = "left" | "right";

export interface LeaderPlacement {
  readonly id: string;
  readonly name: string;
  /** Where the leader touches the line it names. */
  readonly anchor: LeaderPoint;
  /** Where the leader turns, out in the gutter. Two straight segments, never a curve. */
  readonly elbow: LeaderPoint;
  /** The text's baseline origin. */
  readonly label: LeaderPoint;
  readonly side: LeaderSide;
}

export interface LeaderBox {
  readonly width: number;
  readonly height: number;
}

/** How far in from the canvas edge a name is set. Enough that it is never clipped on a phone. */
export const LEADER_GUTTER_PX = 14;

/** The shortest vertical distance two names may sit at before one is moved. Roughly two line heights. */
export const LEADER_MIN_GAP_PX = 26;

/** A leader shorter than this is not drawn: a name touching the thing it names needs no line to it. */
export const LEADER_MIN_RUN_PX = 18;

/**
 * The point on a polyline a name should be attached to.
 *
 * The endpoint furthest from the hand's own centre, which is where a line is
 * least likely to be crowded by the other three. Picking the midpoint instead —
 * the obvious choice — puts every leader into the middle of the palm, exactly
 * where all four creases already are.
 */
function outerEnd(points: readonly LeaderPoint[], box: LeaderBox): LeaderPoint {
  const cx = box.width / 2;
  const cy = box.height / 2;
  const first = points[0];
  const last = points[points.length - 1];
  const d = (p: LeaderPoint): number => (p.x - cx) ** 2 + (p.y - cy) ** 2;
  return d(first) >= d(last) ? first : last;
}

/**
 * Lay out one name per line, in two columns, without collisions.
 *
 * The order matters and is the caller's: lines are passed in the order they were
 * FOUND, and a name that is already on screen never moves to make room for a
 * later one. A label that jumped every time the pipeline reported something new
 * would be the busiest thing in a scene whose whole argument is stillness.
 *
 * Names that cannot be placed without overlapping are dropped rather than
 * squeezed. A dropped name is a line the reader still sees illuminated and
 * simply not captioned, which is a smaller loss than two names written over each
 * other — and on the four major creases, at the sizes this is drawn at, it does
 * not arise.
 */
export function placeLeaders(
  lines: readonly { readonly id: string; readonly points: readonly LeaderPoint[] }[],
  box: LeaderBox,
): readonly LeaderPlacement[] {
  const placed: LeaderPlacement[] = [];
  /* One occupied-row list per side, so a left name and a right name at the same
     height are not treated as a collision — they are two columns, not one. */
  const taken: Record<LeaderSide, number[]> = { left: [], right: [] };

  for (const line of lines) {
    if (line.points.length < 2) continue;
    const name = chamberLineName(line.id);
    if (name === null) continue;

    const anchor = outerEnd(line.points, box);
    const side: LeaderSide = anchor.x < box.width / 2 ? "left" : "right";
    const gutterX = side === "left" ? LEADER_GUTTER_PX : box.width - LEADER_GUTTER_PX;

    /* The leader is horizontal, so the name sits at the height of the thing it
       names — the reference's own arrangement, and the only one where a reader
       does not have to work out which caption belongs to which line. */
    let y = anchor.y;
    let attempts = 0;
    while (taken[side].some((other) => Math.abs(other - y) < LEADER_MIN_GAP_PX)) {
      /* Downward first, because a name pushed up off the top of a phone is gone
         while one pushed down is still beside the hand. */
      y += LEADER_MIN_GAP_PX;
      attempts += 1;
      if (y > box.height - LEADER_GUTTER_PX || attempts > lines.length) break;
    }
    if (taken[side].some((other) => Math.abs(other - y) < LEADER_MIN_GAP_PX)) continue;
    if (y > box.height - LEADER_GUTTER_PX || y < LEADER_GUTTER_PX) continue;
    if (Math.abs(gutterX - anchor.x) < LEADER_MIN_RUN_PX) continue;

    taken[side].push(y);
    placed.push({
      id: line.id,
      name,
      anchor,
      /* The elbow shares the anchor's height and the gutter's column: the leader
         leaves the line horizontally and turns once, never twice. */
      elbow: { x: gutterX, y: anchor.y },
      label: { x: gutterX, y },
      side,
    });
  }

  return placed;
}
