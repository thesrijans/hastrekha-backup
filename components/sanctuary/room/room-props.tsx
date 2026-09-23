/**
 * The room's objects, drawn — B7's layers as an engraved plate.
 *
 * WHY DRAWN, AND WHY IN THIS LANGUAGE. There is no Blender path to render
 * plates from (see the spec's [R7]), so the fallback room is authored here, and
 * it is authored the way the rest of the sanctuary is: dark forms, gold hairline
 * where an edge faces the light, and HATCHING — the engraver's shading — where
 * it does not. No gradient is declared anywhere in these files: the light is
 * CSS pools laid over the wall (room-stage.module.css), and the metal reuses the
 * sprite's one gold ramp, `#snc-g-gold`.
 *
 * ONE CANDLE. Every object is lit from the pedestal: rims on the side that faces
 * it, hatching on the side that does not, and brightness falling off with
 * distance. The window is the only other light, and it is cold and small.
 *
 * Every point is in the stage's 1600 × 900 units from lib/sanctuary/room-composition.ts,
 * so the scene (U3b) and this plate agree about where everything stands.
 *
 * Server markup: shapes and numbers, no state. Deterministic — the shelves are
 * scattered by a fixed seed, so every render is the same room.
 */
import type { CSSProperties, ReactElement } from "react";
import { defUrl, seededRandom, SNC_GRADIENT_GOLD } from "@/components/sanctuary/material";
import { ROOM_ANCHORS, ROOM_CANDLES } from "@/lib/sanctuary/room-composition";
import { HAND_TRADITION_PLATE } from "@/lib/sanctuary/hand-plates";
import styles from "./room-stage.module.css";

const GOLD = defUrl(SNC_GRADIENT_GOLD);

/* ------------------------------------------------------------------------ */
/* Helpers                                                                   */
/* ------------------------------------------------------------------------ */

/** An ellipse as one path, so a set of rings is one element. */
function ellipse(cx: number, cy: number, rx: number, ry: number): string {
  return `M${cx - rx},${cy}a${rx},${ry} 0 1,0 ${rx * 2},0a${rx},${ry} 0 1,0 ${-rx * 2},0`;
}

/** The front (lower) half of an ellipse, left to right. */
function frontArc(cx: number, cy: number, rx: number, ry: number): string {
  return `M${cx - rx},${cy}A${rx},${ry} 0 0,0 ${cx + rx},${cy}`;
}

/** Vertical hatching between two x's, denser toward `denseAt`. */
function hatch(x0: number, x1: number, y0: number, y1: number, count: number, denseAt: "start" | "end"): string {
  let d = "";
  for (let i = 1; i <= count; i += 1) {
    const t = (i / (count + 1)) ** 1.6;
    const x = denseAt === "start" ? x0 + (x1 - x0) * t : x1 - (x1 - x0) * t;
    d += `M${x.toFixed(1)},${y0}V${y1}`;
  }
  return d;
}

/** Tied leaf bundles along one shelf: bodies, cords, and the rim facing the candle. */
function bundles(
  rand: () => number,
  x0: number,
  x1: number,
  shelfY: number,
  rimSide: "left" | "right",
): { readonly bodies: string; readonly cords: string; readonly rims: string } {
  let bodies = "";
  let cords = "";
  let rims = "";
  let x = x0 + 4 + rand() * 6;
  while (x < x1 - 30) {
    const w = Math.min(46 + rand() * 20, x1 - 4 - x);
    if (w < 26) break;
    const stack = 1 + Math.floor(rand() * 3);
    let top = shelfY;
    for (let s = 0; s < stack; s += 1) {
      const h = 9 + rand() * 4;
      const inset = s === 0 ? 0 : rand() * 5 - 2.5;
      const bx = x + inset;
      bodies += `M${bx.toFixed(1)},${top.toFixed(1)}h${w.toFixed(1)}v${(-h).toFixed(1)}h${(-w).toFixed(1)}Z`;
      cords += `M${(bx + w * 0.26).toFixed(1)},${top.toFixed(1)}v${(-h).toFixed(1)}M${(bx + w * 0.74).toFixed(1)},${top.toFixed(1)}v${(-h).toFixed(1)}`;
      const rx = rimSide === "right" ? bx + w : bx;
      rims += `M${rx.toFixed(1)},${top.toFixed(1)}v${(-h).toFixed(1)}`;
      top -= h + 0.6;
    }
    x += w + 5 + rand() * 9;
  }
  return { bodies, cords, rims };
}

/* ------------------------------------------------------------------------ */
/* FAR — the wall, the corridor, the window, the shelves, the drapes         */
/* ------------------------------------------------------------------------ */

function Bookcase({ x0, x1, top, bottom, seed, rimSide }: {
  readonly x0: number;
  readonly x1: number;
  readonly top: number;
  readonly bottom: number;
  readonly seed: number;
  readonly rimSide: "left" | "right";
}): ReactElement {
  const rand = seededRandom(seed);
  const shelves: number[] = [];
  for (let y = top + 88; y <= bottom - 6; y += 94) shelves.push(y);
  let bodies = "";
  let cords = "";
  let rims = "";
  for (const y of shelves) {
    const row = bundles(rand, x0 + 16, x1 - 16, y, rimSide);
    bodies += row.bodies;
    cords += row.cords;
    rims += row.rims;
  }
  const boards = shelves.map((y) => `M${x0 + 12},${y}H${x1 - 12}`).join("");
  return (
    <g data-snc-room-object="library">
      <rect x={x0} y={top} width={x1 - x0} height={bottom - top} fill="var(--color-snc-stone-900)" />
      <path d={`M${x0},${top}h14v${bottom - top}h-14ZM${x1 - 14},${top}h14v${bottom - top}h-14Z`} fill="var(--color-snc-stone-700)" />
      <path d={bodies} fill="color-mix(in oklab, var(--color-snc-gold-600) 30%, var(--color-snc-stone-800))" />
      <path d={cords} className={styles.cord} />
      <path d={rims} className={styles.bundleRim} />
      <path d={boards} className={styles.shelfBoard} />
      <path
        d={rimSide === "right" ? `M${x1},${top}V${bottom}` : `M${x0},${top}V${bottom}`}
        className={styles.caseRim}
      />
    </g>
  );
}

/** The back wall and everything on it. */
export function RoomFar(): ReactElement {
  const rand = seededRandom(419);
  let stars = "";
  for (let i = 0; i < 18; i += 1) {
    const x = 1162 + rand() * 146;
    const y = 190 + rand() * 250;
    const r = 0.6 + rand() * 1.1;
    stars += `M${(x - r).toFixed(1)},${y.toFixed(1)}a${r.toFixed(2)},${r.toFixed(2)} 0 1,0 ${(r * 2).toFixed(2)},0a${r.toFixed(2)},${r.toFixed(2)} 0 1,0 ${(-r * 2).toFixed(2)},0`;
  }
  /* Masonry: courses and staggered joints, barely there. */
  let masonry = "";
  for (let row = 0; row < 6; row += 1) {
    const y = 120 + row * 96;
    masonry += `M0,${y}H1600`;
    for (let x = row % 2 === 0 ? 60 : 130; x < 1600; x += 140) masonry += `M${x},${y}v96`;
  }
  const w = ROOM_ANCHORS.window;
  return (
    <>
      <path d={masonry} className={styles.masonry} />

      {/* The corridor behind the pedestal — a darker arch, a few far candles in it. */}
      <g data-snc-room-object="corridor">
        <path d="M380,700V330A150,150 0 0,1 680,330V700Z" fill="var(--color-snc-stone-900)" />
        <path d="M380,700V330A150,150 0 0,1 680,330V700" className={styles.archTrim} />
        <path d="M366,700V326A164,164 0 0,1 694,326V700" className={styles.archTrimOuter} />
        <path d="M410,610h240M410,520h240M410,430h240" className={styles.corridorShelves} />
        {[
          [436, 604],
          [602, 514],
          [468, 424],
          [590, 604],
        ].map(([x, y]) => (
          <g key={`${x}-${y}`}>
            <circle cx={x} cy={y} r={9} fill="color-mix(in oklab, var(--color-snc-flame-warm) 16%, transparent)" />
            <circle cx={x} cy={y} r={1.8} fill="var(--color-snc-flame)" />
          </g>
        ))}
      </g>

      {/* The window: night outside, a moon, a distant spire. Cold, small, and the only other light. */}
      <g data-snc-room-object="window">
        <path
          d={`M${w.x - 90},470V250A90,90 0 0,1 ${w.x + 90},250V470Z`}
          fill="color-mix(in oklab, var(--color-snc-moon) 72%, var(--color-snc-stone-900))"
        />
        <path d={stars} fill="color-mix(in oklab, var(--color-snc-parchment) 70%, var(--color-snc-moon))" opacity={0.55} />
        <circle cx={w.x + 40} cy={214} r={25} fill="color-mix(in oklab, var(--color-snc-parchment) 58%, var(--color-snc-moon))" opacity={0.9} />
        <circle cx={w.x + 51} cy={208} r={22} fill="color-mix(in oklab, var(--color-snc-moon) 72%, var(--color-snc-stone-900))" opacity={0.85} />
        <path
          d={`M${w.x - 60},470L${w.x - 52},440L${w.x - 44},452L${w.x - 34},404L${w.x - 28},392L${w.x - 22},404L${w.x - 12},452L${w.x - 2},436L${w.x + 10},470Z`}
          fill="var(--color-snc-stone-900)"
        />
        <path d={`M${w.x},250V470M${w.x - 90},340H${w.x + 90}`} className={styles.mullion} />
        <path d={`M${w.x - 90},470V250A90,90 0 0,1 ${w.x + 90},250V470`} className={styles.windowSurround} />
        <path d={`M${w.x - 98},472V248A98,98 0 0,1 ${w.x + 98},248V472`} className={styles.archTrim} />
      </g>

      <Bookcase x0={52} x1={334} top={96} bottom={700} seed={73} rimSide="right" />
      <Bookcase x0={1418} x1={1592} top={110} bottom={700} seed={131} rimSide="left" />

      {/* The drapes, framing the top corners — wine-dark, never bright. */}
      <g data-snc-room-object="drapes">
        <path
          d="M0,0H300C282,60 250,120 214,178C170,250 108,320 40,410C26,430 12,446 0,452Z"
          fill="color-mix(in oklab, var(--color-snc-ink-red) 40%, var(--color-snc-stone-900))"
        />
        <path d="M60,0C80,120 70,260 22,420M130,0C140,90 120,190 90,300M200,0C196,60 180,120 150,190" className={styles.fold} />
        <path
          d="M1600,0H1330C1346,70 1382,150 1430,226C1480,302 1540,372 1600,430Z"
          fill="color-mix(in oklab, var(--color-snc-ink-red) 36%, var(--color-snc-stone-900))"
        />
        <path d="M1540,0C1528,120 1540,260 1580,400M1470,0C1460,100 1480,200 1520,300M1400,0C1404,60 1420,120 1444,180" className={styles.fold} />
      </g>

      {/* The floor meets the wall. */}
      <rect x={0} y={700} width={1600} height={200} fill="var(--color-snc-stone-900)" />
      <path d="M0,700H1600" className={styles.floorLine} />
    </>
  );
}

/* ------------------------------------------------------------------------ */
/* MID (behind the hologram) — floor mandala, the pedestal, the book, props  */
/* ------------------------------------------------------------------------ */

function FloorMandala(): ReactElement {
  const cx = ROOM_ANCHORS.pedestal.x;
  const cy = 850;
  const rings = [
    [600, 54],
    [470, 42],
    [340, 31],
  ] as const;
  let spokes = "";
  for (let i = 0; i < 24; i += 1) {
    const a = (i / 24) * Math.PI * 2;
    spokes += `M${(cx + 340 * Math.cos(a)).toFixed(1)},${(cy + 31 * Math.sin(a)).toFixed(1)}L${(cx + 600 * Math.cos(a)).toFixed(1)},${(cy + 54 * Math.sin(a)).toFixed(1)}`;
  }
  return (
    <g data-snc-room-object="floor">
      <path d={rings.map(([rx, ry]) => ellipse(cx, cy, rx, ry)).join("")} className={styles.mandala} />
      <path d={spokes} className={styles.mandalaSpokes} />
    </g>
  );
}

/** The brass pedestal: plinth, body, bands, the plaque. Its top face carries the zodiac ring (HTML, above). */
export function Pedestal(): ReactElement {
  const { x: cx, y: top } = ROOM_ANCHORS.pedestal;
  const rx = 230;
  const ry = 60;
  const bottom = 770;
  const body = `M${cx - rx},${top}V${bottom}A${rx},${ry} 0 0,0 ${cx + rx},${bottom}V${top}A${rx},${ry} 0 0,1 ${cx - rx},${top}Z`;
  const plinth = `M${cx - 262},800V826A262,66 0 0,0 ${cx + 262},826V800A262,66 0 0,1 ${cx - 262},800Z`;
  return (
    <g data-snc-room-object="pedestal">
      <path d={plinth} fill="var(--color-snc-stone-700)" />
      <path d={ellipse(cx, 800, 262, 66)} fill="var(--color-snc-stone-800)" />
      <path d={frontArc(cx, 800, 262, 66)} className={styles.brassEdgeDim} />
      <path d={body} fill="color-mix(in oklab, var(--color-snc-gold-600) 34%, var(--color-snc-stone-900))" />
      {/* The shadowed flanks of the cylinder, cut in by hatching. */}
      <path d={hatch(cx - rx + 4, cx - rx + 74, top + 30, bottom + 6, 9, "start")} className={styles.hatch} />
      <path d={hatch(cx + rx - 74, cx + rx - 4, top + 30, bottom + 6, 9, "end")} className={styles.hatch} />
      <path d={frontArc(cx, top + 14, rx, ry)} className={styles.brassBand} />
      <path d={frontArc(cx, top + 32, rx - 2, ry)} className={styles.brassBandDim} />
      <path d={frontArc(cx, bottom - 26, rx, ry)} className={styles.brassBandDim} />
      <path d={`M${cx - rx},${top}V${bottom}M${cx + rx},${top}V${bottom}`} className={styles.brassEdgeDim} />
      {/* The plaque, and the three words B2 engraves on the base. */}
      <rect x={cx - 142} y={top + 88} width={284} height={40} fill="color-mix(in oklab, var(--color-snc-stone-900) 88%, transparent)" />
      <rect x={cx - 142} y={top + 88} width={284} height={40} className={styles.plaqueFrame} />
      <text x={cx} y={top + 114} textAnchor="middle" className={styles.plaqueText}>
        PAST · PRESENT · FUTURE
      </text>
      {/* The top face; the ring is laid over it in HTML so it can turn. */}
      <path d={ellipse(cx, top, rx, ry)} fill="var(--color-snc-stone-800)" />
      <path d={ellipse(cx, top, rx, ry)} fill="none" stroke={GOLD} strokeWidth={1.6} vectorEffect="non-scaling-stroke" />
    </g>
  );
}

/** The open book on its stand, the lifted page, the lectern. */
function Book(): ReactElement {
  /* The book's own diagram of the hand: the baked tradition plate (216 × 290 hand units) at 0.44, its
     centre at (1196, 468) on the left leaf. One density is enough for a drawing 95 stage units wide. */
  const leafHand = HAND_TRADITION_PLATE.densities[0];
  return (
    <g data-snc-room-object="book">
      {/* The lectern. */}
      <path d="M1150,650L1128,860H1146L1176,650ZM1438,640L1466,860H1484L1458,640Z" fill="var(--color-snc-stone-700)" />
      <path d="M1098,640L1486,606L1494,628L1106,664Z" fill="var(--color-snc-stone-700)" />
      <path d="M1098,640L1486,606" className={styles.brassEdgeDim} />
      {/* The binding under the leaves. */}
      <path d="M1100,630L1292,616L1484,598L1480,614L1292,632L1104,648Z" fill="color-mix(in oklab, var(--color-snc-ink-red) 42%, var(--color-snc-stone-900))" />
      {/* The two leaves, lit by the candle below them. */}
      <path
        d="M1292,614C1232,594 1162,596 1112,616L1124,402C1172,382 1242,380 1292,400Z"
        fill="color-mix(in oklab, var(--color-snc-parchment) 58%, var(--color-snc-stone-800))"
      />
      <path
        d="M1292,614C1350,592 1420,586 1478,600L1466,382C1410,368 1340,372 1292,400Z"
        fill="color-mix(in oklab, var(--color-snc-parchment) 50%, var(--color-snc-stone-800))"
      />
      <path d="M1292,400V614" className={styles.spine} />
      <path d={hatch(1266, 1290, 404, 610, 5, "end")} className={styles.pageHatch} />
      <path d={hatch(1294, 1318, 404, 610, 5, "start")} className={styles.pageHatch} />
      {/* The left leaf carries a small drawing of the tradition's hand — the book's own diagram. */}
      <image
        href={leafHand.webp}
        x={1196 - 108 * 0.44}
        y={468 - 150 * 0.44}
        width={216 * 0.44}
        height={290 * 0.44}
        preserveAspectRatio="none"
        className={styles.pageHand}
      />
      <path
        d="M1140,560Q1210,550 1278,556M1142,578Q1210,568 1278,574M1144,596Q1210,588 1278,592"
        className={styles.pageInk}
      />
      <path
        d="M1330,424Q1400,414 1450,418M1330,462Q1396,452 1452,456M1330,500Q1396,490 1454,494M1330,538Q1396,528 1456,532M1330,576Q1396,566 1458,570"
        className={styles.pageInk}
      />
      <path d={`${ellipse(1318, 424, 4, 4)}${ellipse(1318, 462, 4, 4)}${ellipse(1318, 500, 4, 4)}${ellipse(1318, 538, 4, 4)}${ellipse(1318, 576, 4, 4)}`} className={styles.pageInk} />
      {/* The lifted leaf is <LiftedPage>, in its own small box, so its flutter never repaints this plate. */}
    </g>
  );
}

/** The lifted leaf's own box, in stage units — it turns in a draught as one element. */
export const LIFTED_PAGE_REGION = { x: 1280, y: 390, w: 80, h: 232 } as const;

/** The leaf lifting off the right-hand page. It moves only at MID and above. */
export function LiftedPage(): ReactElement {
  return (
    <>
      <path
        d="M1292,612C1308,566 1322,494 1342,408C1324,404 1307,401 1292,400Z"
        fill="color-mix(in oklab, var(--color-snc-parchment) 66%, var(--color-snc-stone-800))"
      />
      <path d="M1292,612C1308,566 1322,494 1342,408" className={styles.pageEdge} />
    </>
  );
}

/** An astrolabe on the stacked books, a crystal by the book candle, the books themselves. */
function Props(): ReactElement {
  return (
    <>
      <g data-snc-room-object="books">
        <path d="M10,812L304,800L312,842L18,856Z" fill="color-mix(in oklab, var(--color-snc-ink-red) 30%, var(--color-snc-stone-800))" />
        <path d="M24,776L296,766L302,800L30,812Z" fill="var(--color-snc-stone-700)" />
        <path d="M40,744L286,736L292,766L46,776Z" fill="color-mix(in oklab, var(--color-snc-moon) 22%, var(--color-snc-stone-800))" />
        <path d="M18,856L312,842L316,900H14Z" fill="var(--color-snc-stone-800)" />
        <path d="M24,776L296,766M40,744L286,736M10,812L304,800M18,856L312,842" className={styles.brassEdgeDim} />
        <path d="M60,792H110M60,828H130M70,760H120" className={styles.bookTitle} />
      </g>
      <g data-snc-room-object="astrolabe">
        <path d={ellipse(246, 736, 38, 8)} fill="var(--color-snc-stone-700)" />
        <rect x={244} y={690} width={4} height={46} fill={GOLD} />
        <path d={ellipse(246, 640, 50, 50)} fill="none" stroke={GOLD} strokeWidth={2} vectorEffect="non-scaling-stroke" />
        <path d={`${ellipse(246, 640, 38, 38)}${ellipse(246, 640, 50, 15)}`} className={styles.brassBandDim} />
        <path d="M196,640H296M246,590V690M211,605L281,675" className={styles.brassBandDim} />
        <circle cx={246} cy={640} r={3} fill={GOLD} />
      </g>
      <g data-snc-room-object="crystal">
        <path d="M1066,842L1074,796L1088,780L1102,800L1098,842Z" fill="color-mix(in oklab, var(--color-snc-moon) 34%, var(--color-snc-stone-700))" opacity={0.85} />
        <path d="M1074,796L1090,812L1088,780M1090,812L1098,842M1090,812L1066,842" className={styles.facet} />
        <circle cx={1084} cy={792} r={1.6} fill="var(--color-snc-gold-ramp-pale)" />
      </g>
    </>
  );
}

export function RoomMidBack(): ReactElement {
  return (
    <>
      <FloorMandala />
      <Props />
      <Book />
      <Pedestal />
    </>
  );
}

/* ------------------------------------------------------------------------ */
/* MID (in front) — the hologram, and the three candles                      */
/* ------------------------------------------------------------------------ */

/*
 * B2's hologram: a column of warm light rising from the pedestal with an open
 * hand inside it. [A2] The hand is a silhouette and nothing else — no line on
 * it, ever — and it is gold, not cyan: a symbol of the scan, not a result.
 *
 * IN THREE PARTS, AND THAT IS A PERFORMANCE DECISION. The column is still and
 * lives in the full-stage plate. The hand floats and the rings turn, so each is
 * drawn in its own small SVG laid exactly over the plate (room-stage.tsx): a
 * motion inside the shared plate damages all 1600 × 900 of it every frame. See
 * room-stage.tsx for exactly what was measured, and on which renderer.
 */

/** Where the column's crown sits, in stage units. */
const HOLOGRAM_TOP = 128;

/** The still part of the hologram: the column, its edges, the crown and the two emitters. */
export function HologramColumn(): ReactElement {
  const { x: cx, y: base } = ROOM_ANCHORS.pedestal;
  const top = HOLOGRAM_TOP;
  return (
    <g data-snc-room-object="hologram" className={styles.hologram}>
      <path d={`M${cx - 150},${base - 2}V${top}A150,26 0 0,1 ${cx + 150},${top}V${base - 2}A150,26 0 0,1 ${cx - 150},${base - 2}Z`} className={styles.column} />
      <path d={`M${cx - 150},${base - 2}V${top}M${cx + 150},${base - 2}V${top}`} className={styles.columnEdge} />
      {/* The crown the light rises into. */}
      <path d={`M${cx - 166},${top - 22}V${top - 4}A166,30 0 0,0 ${cx + 166},${top - 4}V${top - 22}A166,30 0 0,1 ${cx - 166},${top - 22}Z`} fill="color-mix(in oklab, var(--color-snc-gold-600) 30%, var(--color-snc-stone-900))" />
      <path d={ellipse(cx, top - 22, 166, 30)} fill="none" stroke={GOLD} strokeWidth={1.4} vectorEffect="non-scaling-stroke" />
      <path d={ellipse(cx, top, 150, 26)} className={styles.emitter} />
      <path d={ellipse(cx, base - 2, 150, 26)} className={styles.emitter} />
      <path d={ellipse(cx, base - 2, 108, 18)} className={styles.emitterCore} />
    </g>
  );
}

/** How flat a ring looks, seen edge-on. */
const ORBIT_SQUASH = 0.17;

/** The two rings orbiting the hand: where each sits, its radius, and how long one turn takes. */
export const HOLOGRAM_ORBITS: readonly { readonly y: number; readonly r: number; readonly turnS: number; readonly reverse: boolean }[] = [
  { y: 300, r: 176, turnS: 26, reverse: false },
  { y: 452, r: 158, turnS: 33, reverse: true },
];

/** One ring's own box, in stage units: as wide as the ring, as tall as its edge-on ellipse, with room for the beads. */
export function orbitRegion(orbit: (typeof HOLOGRAM_ORBITS)[number]): { readonly x: number; readonly y: number; readonly w: number; readonly h: number } {
  const ry = orbit.r * ORBIT_SQUASH;
  return { x: ROOM_ANCHORS.pedestal.x - orbit.r - 8, y: orbit.y - ry - 8, w: orbit.r * 2 + 16, h: ry * 2 + 16 };
}

/** A ring and its three beads, turning, seen edge-on — drawn in stage units inside its own small box. */
export function OrbitRing({ orbit }: { readonly orbit: (typeof HOLOGRAM_ORBITS)[number] }): ReactElement {
  return (
    <g transform={`translate(${ROOM_ANCHORS.pedestal.x} ${orbit.y}) scale(1 ${ORBIT_SQUASH})`}>
      <g
        className={styles.orbit}
        style={{ animationDuration: `${orbit.turnS}s`, animationDirection: orbit.reverse ? "reverse" : "normal" } as CSSProperties}
      >
        <circle r={orbit.r} className={styles.orbitRing} />
        {[0, 120, 240].map((deg) => (
          <circle
            key={deg}
            cx={orbit.r * Math.cos((deg * Math.PI) / 180)}
            cy={orbit.r * Math.sin((deg * Math.PI) / 180)}
            r={5}
            className={styles.orbitBead}
          />
        ))}
      </g>
    </g>
  );
}

/**
 * A candle and its flame, drawn still. What flickers is the candle's pool of light — a soft radial in
 * the stage's HTML (room-stage.tsx), on this candle's own period. An opacity change on its own
 * element is composited; a flicker drawn in here would repaint the whole plate several times a second.
 */
function Candle({ id, x, y, height }: (typeof ROOM_CANDLES)[number]): ReactElement {
  const top = y - height;
  return (
    <g data-snc-room-object={id === "book" ? "book" : "pedestal"} data-snc-candle={id}>
      <path d={ellipse(x, y + 2, 20, 5)} fill="color-mix(in oklab, var(--color-snc-gold-600) 50%, var(--color-snc-stone-900))" />
      <rect x={x - 7} y={top} width={14} height={height} fill="color-mix(in oklab, var(--color-snc-parchment) 62%, var(--color-snc-stone-700))" />
      <rect x={x + 2} y={top} width={5} height={height} fill="color-mix(in oklab, var(--color-snc-parchment) 78%, var(--color-snc-flame))" opacity={0.55} />
      <g>
        <path d={`M${x},${top}C${x - 6},${top - 8} ${x - 5},${top - 18} ${x},${top - 28}C${x + 5},${top - 18} ${x + 6},${top - 8} ${x},${top}Z`} fill="var(--color-snc-flame)" />
        <path d={`M${x},${top - 2}C${x - 3},${top - 6} ${x - 2.5},${top - 12} ${x},${top - 17}C${x + 2.5},${top - 12} ${x + 3},${top - 6} ${x},${top - 2}Z`} fill="var(--color-snc-gold-ramp-pale)" />
      </g>
    </g>
  );
}

export function RoomMidFront({ leaders }: { readonly leaders: boolean }): ReactElement {
  return (
    <>
      <HologramColumn />
      {ROOM_CANDLES.map((candle) => (
        <Candle key={candle.id} {...candle} />
      ))}
      {leaders ? (
        <g data-snc-room-object="labels">
          <path d="M758,612L824,652H838" className={styles.leader} />
          <circle cx={758} cy={612} r={3} className={styles.leaderDot} />
          <path d="M1120,504L1074,470H1062" className={styles.leader} />
          <circle cx={1120} cy={504} r={3} className={styles.leaderDot} />
        </g>
      ) : null}
    </>
  );
}

/** The labels' HTML positions, matched to the leaders above (stage units). */
export const ROOM_LABEL_POINTS = {
  scanner: { x: 840, y: 652, side: "right" },
  book: { x: 1060, y: 470, side: "left" },
} as const;

/* ------------------------------------------------------------------------ */
/* NEAR — dust in the light                                                  */
/* ------------------------------------------------------------------------ */

/**
 * The dust, as three drifts — returned as path data, because each drift is drawn in its own
 * full-stage SVG that moves as one composited element (room-stage.tsx). Drifting a group inside one
 * shared SVG repainted the whole near plate every frame.
 */
export function roomDust(): readonly [string, string, string] {
  const rand = seededRandom(977);
  const groups: [string, string, string] = ["", "", ""];
  for (let i = 0; i < 42; i += 1) {
    /* Mostly in the pedestal's cone of light, a few drifting by the book. */
    const byBook = i % 7 === 0;
    const x = byBook ? 1120 + rand() * 300 : 250 + rand() * 640;
    const y = byBook ? 360 + rand() * 300 : 90 + rand() * 640;
    const r = 0.8 + rand() * 1.8;
    groups[i % 3] += `M${(x - r).toFixed(1)},${y.toFixed(1)}a${r.toFixed(2)},${r.toFixed(2)} 0 1,0 ${(r * 2).toFixed(2)},0a${r.toFixed(2)},${r.toFixed(2)} 0 1,0 ${(-r * 2).toFixed(2)},0`;
  }
  return groups;
}
