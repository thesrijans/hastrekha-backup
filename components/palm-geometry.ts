/**
 * Geometry for the holographic palm — an open right hand, palm toward the viewer.
 *
 * Palm-up means the thumb sits on the viewer's left (anatomical position: the thumb is lateral, so
 * a right hand facing you shows it on your left). Fingers run index → little, left to right, with
 * realistic relative lengths: middle longest, index and ring near-equal, little reaching about the
 * top joint of the ring.
 *
 * Pure data with no React import, so the interactive map, the reading report and the share-card
 * canvas all draw the same hand and the numbers only ever live in one place.
 */

export const PALM_VIEWBOX_WIDTH = 280;
export const PALM_VIEWBOX_HEIGHT = 390;
export const PALM_VIEWBOX = `0 0 ${PALM_VIEWBOX_WIDTH} ${PALM_VIEWBOX_HEIGHT}`;

/**
 * One closed silhouette: wrist → thumb → four fingers with webs dipping between them → back down
 * the little-finger side to the wrist.
 */
export const HAND_OUTLINE =
  "M 90 352 C 78 330 72 300 74 278 " +
  "C 60 268 36 248 28 228 C 22 216 30 202 44 208 C 58 216 76 236 86 250 " +
  "C 92 232 92 205 93 186 " +
  "C 94 150 98 100 100 80 C 102 62 122 62 123 80 C 124 104 124 150 125 178 " +
  "C 128 158 138 92 145 62 C 147 44 168 44 169 62 C 171 86 173 150 174 180 " +
  "C 178 152 186 90 189 72 C 191 55 211 56 212 74 C 213 98 212 155 211 184 " +
  "C 216 158 224 116 227 102 C 230 88 248 90 248 106 C 247 128 243 172 241 192 " +
  "C 250 220 254 280 244 316 C 236 338 220 352 204 356 Z";

export interface PalmLine {
  readonly id: string;
  readonly label: string;
  readonly d: string;
  /** Draw-on order; the component multiplies this by a 200ms stagger. */
  readonly order: number;
}

/** The four major lines, in the order a palmist reads them. */
export const PALM_LINES: readonly PalmLine[] = [
  { id: "heart", label: "Heart line", d: "M 238 212 C 210 190 172 186 132 202", order: 0 },
  { id: "head", label: "Head line", d: "M 96 224 C 126 240 172 252 210 258", order: 1 },
  { id: "life", label: "Life line", d: "M 94 212 C 76 244 76 296 92 330 C 98 342 106 349 114 353", order: 2 },
  { id: "fate", label: "Fate line", d: "M 152 348 C 150 306 152 250 151 212", order: 3 },
];

export interface MountSpec {
  /** Matches the engine feature key under `mounts.*`. */
  readonly key: string;
  readonly label: string;
  readonly helper: string;
  readonly cx: number;
  readonly cy: number;
  readonly rx: number;
  readonly ry: number;
  /** How many cyan dots render this mount — bigger mounts get denser clusters. */
  readonly dots: number;
}

/** The seven classical mounts, in the order a palmist walks them: across the fingers, then the base. */
export const MOUNTS: readonly MountSpec[] = [
  {
    key: "jupiter",
    label: "Jupiter",
    helper: "Index finger ke neeche — mahatvakanksha, netritva, apne aap par bharosa.",
    cx: 106,
    cy: 205,
    rx: 23,
    ry: 21,
    dots: 14,
  },
  {
    key: "saturn",
    label: "Saturn",
    helper: "Middle finger ke neeche — gambhirta, dhairya, akele kaam karne ki aadat.",
    cx: 150,
    cy: 198,
    rx: 23,
    ry: 21,
    dots: 14,
  },
  {
    key: "sun",
    label: "Sun (Apollo)",
    helper: "Ring finger ke neeche — kala, public pehchaan, chamakne ki ichha.",
    cx: 192,
    cy: 204,
    rx: 23,
    ry: 21,
    dots: 14,
  },
  {
    key: "mercury",
    label: "Mercury",
    helper: "Chhoti ungli ke neeche — baat-cheet, business sense, chaturai.",
    cx: 226,
    cy: 219,
    rx: 19,
    ry: 19,
    dots: 12,
  },
  {
    key: "mars_inner",
    label: "Mars (inner)",
    helper: "Angoothe aur life line ke beech — himmat, seedha muqabla karne ka dum.",
    cx: 120,
    cy: 258,
    rx: 21,
    ry: 21,
    dots: 13,
  },
  {
    key: "venus",
    label: "Venus",
    helper: "Angoothe ke neeche ka gadda — pyaar, garmahat, jeene ki urja.",
    cx: 110,
    cy: 302,
    rx: 32,
    ry: 34,
    dots: 20,
  },
  {
    key: "moon",
    label: "Moon (Luna)",
    helper: "Hatheli ka bahari-neecha hissa — kalpana, safar, andar ki awaaz.",
    cx: 206,
    cy: 294,
    rx: 30,
    ry: 32,
    dots: 18,
  },
];

export const MOUNT_KEYS: readonly string[] = MOUNTS.map((mount) => mount.key);

/**
 * The four rectification anchors — wrist, thumb CMC, index MCP, little MCP — in this viewBox, in the
 * same order as `lib/scan/rectify.ts`'s `PALM_ANCHORS`.
 *
 * These let a homography carry polylines traced in the 256² rectified crop onto the replica hand, so
 * the reading can show the user's *own* lines rather than the idealised ones.
 */
export const HOLO_PALM_ANCHORS: ReadonlyArray<{ readonly x: number; readonly y: number }> = [
  { x: 150, y: 350 }, // wrist
  { x: 86, y: 250 }, // thumb CMC
  { x: 104, y: 180 }, // index MCP
  { x: 232, y: 196 }, // little MCP
];

/* --------------------------------- Levels --------------------------------- */

export interface MountLevel {
  readonly id: string;
  readonly label: string;
  /** Fed straight into the engine's `mounts.*` 0–1 conditions. */
  readonly value: number;
}

/**
 * Four named levels instead of a raw slider.
 *
 * People cannot honestly report "0.63 prominent", but they can tell flat from developed, and the
 * classical texts describe mounts in exactly these terms. The values are spaced to land either side
 * of the gte/lte thresholds the KB rules actually use.
 */
export const MOUNT_LEVELS: readonly MountLevel[] = [
  { id: "flat", label: "Flat", value: 0.15 },
  { id: "normal", label: "Normal", value: 0.45 },
  { id: "developed", label: "Developed", value: 0.72 },
  { id: "large", label: "Large", value: 0.95 },
];

export const DEFAULT_MOUNT_VALUE = 0.45;

export function emptyMounts(): Record<string, number> {
  return Object.fromEntries(MOUNTS.map((mount) => [mount.key, DEFAULT_MOUNT_VALUE]));
}

/** The level whose value is closest to `value` — used to mark the active chip. */
export function levelForValue(value: number): MountLevel {
  let best = MOUNT_LEVELS[0];
  for (const level of MOUNT_LEVELS) {
    if (Math.abs(level.value - value) < Math.abs(best.value - value)) best = level;
  }
  return best;
}

/* ---------------------------------- Dots ---------------------------------- */

export interface MountDot {
  readonly cx: number;
  readonly cy: number;
  /** 0–1 position within the cluster; scales dot size so clusters do not look stamped. */
  readonly scale: number;
}

/**
 * Deterministic PRNG (mulberry32).
 *
 * Dot positions must be identical on the server and in the browser or hydration mismatches, so
 * `Math.random` is not an option. Seeding per mount index gives every mount its own stable scatter.
 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Uniform-in-ellipse scatter: sqrt on the radius, or every cluster clumps at its centre. */
function scatter(mount: MountSpec, seed: number): readonly MountDot[] {
  const random = mulberry32(seed);
  const dots: MountDot[] = [];
  for (let index = 0; index < mount.dots; index += 1) {
    const angle = random() * Math.PI * 2;
    const radius = Math.sqrt(random());
    dots.push({
      cx: Number((mount.cx + Math.cos(angle) * radius * mount.rx).toFixed(2)),
      cy: Number((mount.cy + Math.sin(angle) * radius * mount.ry).toFixed(2)),
      // Dots nearer the centre read as the peak of the mount, so they stay the largest.
      scale: Number((1 - radius * 0.45).toFixed(3)),
    });
  }
  return dots;
}

/** Precomputed once at module load; every render of every palm reuses the same scatter. */
export const MOUNT_DOTS: Readonly<Record<string, readonly MountDot[]>> = Object.fromEntries(
  MOUNTS.map((mount, index) => [mount.key, scatter(mount, 0x9e37 + index * 977)]),
);

/* --------------------------------- Chrome --------------------------------- */

export interface ScanBracket {
  readonly id: string;
  readonly d: string;
}

const BRACKET_INSET = 10;
const BRACKET_ARM = 26;

/** Four corner brackets framing the scan area. */
export const SCAN_BRACKETS: readonly ScanBracket[] = (() => {
  const left = BRACKET_INSET;
  const right = PALM_VIEWBOX_WIDTH - BRACKET_INSET;
  const top = BRACKET_INSET;
  const bottom = PALM_VIEWBOX_HEIGHT - BRACKET_INSET;
  return [
    { id: "tl", d: `M ${left} ${top + BRACKET_ARM} L ${left} ${top} L ${left + BRACKET_ARM} ${top}` },
    { id: "tr", d: `M ${right - BRACKET_ARM} ${top} L ${right} ${top} L ${right} ${top + BRACKET_ARM}` },
    { id: "br", d: `M ${right} ${bottom - BRACKET_ARM} L ${right} ${bottom} L ${right - BRACKET_ARM} ${bottom}` },
    { id: "bl", d: `M ${left + BRACKET_ARM} ${bottom} L ${left} ${bottom} L ${left} ${bottom - BRACKET_ARM}` },
  ];
})();

/** Converts caller-supplied polyline points into an SVG path. */
export function polylineToPath(points: readonly (readonly [number, number])[]): string {
  if (points.length === 0) return "";
  return points.map(([x, y], index) => `${index === 0 ? "M" : "L"} ${x} ${y}`).join(" ");
}
