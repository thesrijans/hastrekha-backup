/**
 * ============================================================================
 * THE GEOMETRY HAND-OFF — ruling R3, expressed as one storage key and one
 * validator.
 * ============================================================================
 *
 * WHY THIS MODULE EXISTS AT ALL.
 *
 * The reading response carries NO geometry. `ReadingResponse` has no polyline,
 * no per-line confidence and no crop — a fact the data layer already encodes by
 * making `geometry` a second argument to `resolveChapter` rather than a field it
 * could read off the response. So chapters II–V can only draw the line the
 * scanner actually measured if the scan session hands it across separately, and
 * this file is the whole of that hand-off: the key, the shape, the reader, the
 * writer, and the projection that turns mask-space points into plate-space ink.
 *
 * WHY IT IS SESSION STORAGE AND NOT A COLUMN.
 *
 * `prisma/schema.prisma` says "no images, ever", and /scan makes the reader the
 * same promise in the same words. A rectified crop is an image of somebody's
 * hand; persisting it — even "just for the Pothi", even "just for a day" —
 * breaks a promise the product has already made out loud. `sessionStorage` is
 * the only store whose lifetime matches the promise: it dies with the tab, it
 * never travels to a server, and it is per-origin so nothing else can read it.
 * The consequence is designed for rather than papered over: a REVISITED reading
 * has no crop, and the left page says so in the margin instead of pretending.
 *
 * WHY `space` IS CARRIED AND NOT ASSUMED.
 *
 * This is the one number in the file with a scar behind it. The polylines /scan
 * produces are traced in MASK_SIZE (128) space, while the rectified crop they
 * were traced FROM is 256 — and a projection that hard-codes either constant
 * lands the ink at half or twice its true position. That exact confusion was a
 * live bug in this repo last week. So the writer states the space it measured
 * in, {@link pothiPolylinePath} divides by whatever it was handed, and neither
 * 128 nor 256 appears anywhere below as a literal. A hand-off that forgot to say
 * which space it used is malformed and reads as absent — which is the whole
 * point of the validator.
 *
 * WHAT IS DELIBERATELY NOT HERE.
 *
 * No React, no DOM node, no `window` at module scope. Everything below runs in
 * Node under `tsx` with no shims, which is what lets the storage contract and
 * the projection be tested as data rather than through a rendered component.
 */
import type { PothiGeometry as PothiChapterGeometry, PothiTracedLine } from "./pothi-chapters";

/* --------------------------------- Vocabulary ------------------------------ */

/**
 * The lines a hand-off may carry: exactly the four creases /scan extracts.
 *
 * Narrower than `PalmLineId` (ten ids) and narrower than `PothiLineId` (six)
 * on purpose. The other ids are RESERVED — no extractor exists for them, so a
 * polyline for `sun` or `marriage` cannot have been measured and could only have
 * been invented. Keeping them out of the type means a leaf cannot draw one by
 * accident, and chapter VI stays sealed for the reason the data layer gives.
 */
export type PothiPlateLineId = "heart" | "head" | "life" | "fate";

/**
 * The four ids in a fixed order.
 *
 * Fixed because two renders of the same hand-off must produce byte-identical
 * markup: `Object.keys` follows insertion order, so iterating the stored object
 * would let a writer's key order leak into the server HTML and disagree with the
 * hydrated client. Iterating this list instead makes the order a property of the
 * reader.
 */
export const POTHI_PLATE_LINE_IDS: readonly PothiPlateLineId[] = ["heart", "head", "life", "fate"];

/** One traced point, `[x, y]`, in the hand-off's own {@link PothiGeometry.space}. */
export type PothiGeometryPoint = readonly [number, number];

/**
 * What the scan session hands to the Pothi.
 *
 * `cropDataUrl` is optional and that optionality is the R3 contract in the type:
 * a hand-off with polylines and no crop is not damaged, it is a reading being
 * revisited, and the left page draws the same measured line on a neutral palm
 * diagram instead of on a photograph it is no longer allowed to have.
 */
export interface PothiGeometry {
  /** The scan session this came from. Carried so a stale blob can be told from the current one. */
  readonly sessionId: string;
  /** ISO 8601 instant of the capture. Must parse as a date; a string that does not is malformed. */
  readonly capturedAt: string;
  /** The rectified crop as a `data:image/…` URL. Absent on a revisited reading — see the header. */
  readonly cropDataUrl?: string;
  /** The traced creases. May be empty when only the crop survived. */
  readonly lines: Partial<Record<PothiPlateLineId, readonly PothiGeometryPoint[]>>;
  /** Side length of the square the points were traced in. See the header: never assumed. */
  readonly space: number;
}

/**
 * The same interface under a name that cannot collide.
 *
 * `lib/sanctuary/pothi-chapters.ts` also exports a `PothiGeometry` — a different
 * shape for a different job (what the resolver reads) — and the Pothi route
 * legitimately needs both at once. Rather than make every such caller invent an
 * `import { PothiGeometry as … }` alias of its own, one is published here, and
 * {@link toChapterGeometry} converts between the two so nobody has to hand-roll
 * the mapping and get `space` versus `size` wrong.
 */
export type PothiSessionGeometry = PothiGeometry;

/* -------------------------------- The key ---------------------------------- */

/**
 * The documented sessionStorage key.
 *
 * Namespaced, and versioned in the key itself rather than in a field inside the
 * blob. A version field would have to be read, understood and migrated by a
 * reader that has no way to know what it is looking at; a version in the KEY
 * means an old writer and a new reader simply never meet — the new reader finds
 * nothing, the leaf falls back to the neutral diagram, and the honest fallback
 * that already exists covers the upgrade for free. Bump the suffix whenever
 * {@link isPothiGeometry} would start rejecting what the previous writer wrote —
 * adding a fifth line id, for instance.
 */
export const POTHI_GEOMETRY_SESSION_KEY = "hastrekha:pothi-geometry:v1";

/**
 * The side of the square the plate draws in.
 *
 * A round 100 so a path coordinate reads as a percentage of the leaf at a
 * glance, and so the projection below is the only place a scale factor exists.
 * The plate is square because the crop is: both the rectified crop and the mask
 * the creases are traced in are squares, and a non-square plate would need a
 * letterbox that no polyline could be scaled through honestly.
 */
export const POTHI_PLATE_SIZE = 100;

/**
 * The largest `cropDataUrl` this module will accept, in characters.
 *
 * A rectified 256² crop encoded as JPEG is tens of kilobytes; a megabyte of it
 * is not a crop, it is a mistake or a wedged writer, and the browser's own
 * ~5 MB session quota would then reject every later write with no visible
 * symptom. Rejecting at the boundary keeps that failure loud and local.
 */
export const POTHI_CROP_MAX_CHARS = 1_500_000;

/** The only URL scheme a crop may use. Anything else would fetch from the network — see {@link isPothiGeometry}. */
const CROP_URL_PREFIX = "data:image/";

/* ------------------------------- Validation -------------------------------- */

/** A finite number — the guard every coordinate, every bound and `space` itself must pass. */
function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/** A non-empty string. Empty ids and empty timestamps are absent data wearing a present type. */
function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/** One `[x, y]` pair of finite numbers, and nothing else — a third element means a different contract. */
function isPoint(value: unknown): value is PothiGeometryPoint {
  return Array.isArray(value) && value.length === 2 && isFiniteNumber(value[0]) && isFiniteNumber(value[1]);
}

/**
 * A drawable polyline: at least two valid points.
 *
 * Two, not one. A single point is not a line — it cannot be projected into a
 * path, and a leaf that accepted it would render an `M` with no `L` after it,
 * which paints nothing at all while every surrounding assertion still passes.
 */
function isPolyline(value: unknown): value is readonly PothiGeometryPoint[] {
  return Array.isArray(value) && value.length >= 2 && value.every(isPoint);
}

/**
 * The strict validator: is this unknown thing a hand-off we may draw?
 *
 * STRICT IS THE FEATURE, not the pedantry. This runs on a blob that arrived from
 * a previous page load, possibly written by a previous deploy, possibly edited
 * by hand in devtools. The failure it exists to prevent is not a crash — it is a
 * HALF-DRAWN HAND: a line whose points ran out, a crop that is really a network
 * URL, a `space` of zero that projects every coordinate to infinity. Each of
 * those renders something plausible, and a plausible wrong hand is precisely the
 * A2 failure the whole Pothi is built against. So every branch below rejects the
 * WHOLE blob rather than repairing part of it, and the caller then gets the one
 * honest answer available: absent.
 *
 * Two rejections are worth naming because they look over-strict and are not:
 *
 *  - **An unknown key under `lines`.** The four ids are the only creases with an
 *    extractor. A fifth means writer and reader disagree about the contract, and
 *    the fix is a key bump (see {@link POTHI_GEOMETRY_SESSION_KEY}), not a
 *    silent drop that would leave the reader confidently drawing three of five.
 *  - **A crop that is not `data:image/`.** An `http(s)` crop would make the leaf
 *    fetch a picture of a hand from somewhere, which is the exact promise R3
 *    exists to keep. `data:` cannot leave the tab.
 */
export function isPothiGeometry(value: unknown): value is PothiGeometry {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;

  if (!isNonEmptyString(candidate.sessionId)) return false;
  if (!isNonEmptyString(candidate.capturedAt) || Number.isNaN(Date.parse(candidate.capturedAt))) return false;
  if (!isFiniteNumber(candidate.space) || candidate.space <= 0) return false;

  if (candidate.cropDataUrl !== undefined) {
    if (typeof candidate.cropDataUrl !== "string") return false;
    if (!candidate.cropDataUrl.startsWith(CROP_URL_PREFIX)) return false;
    if (candidate.cropDataUrl.length > POTHI_CROP_MAX_CHARS) return false;
  }

  const lines = candidate.lines;
  if (typeof lines !== "object" || lines === null || Array.isArray(lines)) return false;
  for (const [key, polyline] of Object.entries(lines as Record<string, unknown>)) {
    if (!(POTHI_PLATE_LINE_IDS as readonly string[]).includes(key)) return false;
    if (polyline === undefined) continue;
    if (!isPolyline(polyline)) return false;
  }

  /* A hand-off with neither a crop nor a single line carries nothing to draw.
   * Calling that "present" would hand the leaf an empty plate and let it render
   * a frame around nothing; calling it absent lets the caller seal the leaf with
   * a reason, which is the honest half of the same fact. */
  return candidate.cropDataUrl !== undefined || Object.keys(lines as object).length > 0;
}

/* -------------------------------- Storage ---------------------------------- */

/**
 * The slice of `Storage` this module uses.
 *
 * Narrowed to two methods so a test can hand over four lines of object — one
 * that returns null, one that returns rubbish, one that throws — without
 * standing up a whole Web Storage implementation, and so nothing here can
 * quietly start calling `clear()` on the user's session.
 */
export type PothiGeometryStorage = Pick<Storage, "getItem" | "setItem">;

/**
 * `window.sessionStorage`, or null.
 *
 * The property ACCESS itself throws under some privacy settings — Safari's
 * private mode and "block all cookies" both raise a SecurityError before any
 * method is called — so the guard has to be a try/catch and not a `typeof`
 * check. On the server there is no `window` at all, which is the ordinary case
 * during SSR rather than an error.
 */
function sessionStorageOrNull(): PothiGeometryStorage | null {
  try {
    if (typeof window === "undefined") return null;
    return window.sessionStorage;
  } catch {
    return null;
  }
}

/**
 * The scan session's geometry, or null.
 *
 * NULL IS AN ORDINARY ANSWER, not an error path: it is what a revisited reading,
 * a private-mode browser, a fresh tab and a corrupted blob all produce, and the
 * left page has an honest rendering for every one of them. Nothing here logs,
 * throws or reports — a decoration that crashed the page it decorates would be a
 * worse outcome than a missing picture.
 *
 * @param storage injectable for tests; defaults to `window.sessionStorage`
 */
export function readPothiGeometry(storage: PothiGeometryStorage | null = sessionStorageOrNull()): PothiGeometry | null {
  if (storage === null) return null;
  let raw: string | null;
  try {
    raw = storage.getItem(POTHI_GEOMETRY_SESSION_KEY);
  } catch {
    return null;
  }
  if (raw === null) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  return isPothiGeometry(parsed) ? parsed : null;
}

/**
 * Hand geometry to the Pothi. Returns whether it was actually stored.
 *
 * VALIDATED BEFORE WRITING, which looks redundant next to {@link readPothiGeometry}
 * and is not: a blob our own reader would reject is a blob that will silently
 * become "no geometry" on the next page, and the writer is the only place that
 * still knows enough to notice. Failing here is a bug at the scanner; failing
 * there is a mystery at the leaf.
 *
 * A `false` return is not always a bug, though — a full quota and a private-mode
 * tab both land here — so the caller should treat it as "the Pothi will show the
 * neutral diagram", never as an exception.
 *
 * @param storage injectable for tests; defaults to `window.sessionStorage`
 */
export function writePothiGeometry(
  geometry: PothiGeometry,
  storage: PothiGeometryStorage | null = sessionStorageOrNull(),
): boolean {
  if (storage === null || !isPothiGeometry(geometry)) return false;
  try {
    storage.setItem(POTHI_GEOMETRY_SESSION_KEY, JSON.stringify(geometry));
    return true;
  } catch {
    /* QuotaExceededError, and Safari's private mode which throws on any write. */
    return false;
  }
}

/* ------------------------------- Projection -------------------------------- */

/** Two decimals: sub-tenth-of-a-percent of the plate, and it keeps the emitted path short and diffable. */
const PATH_PRECISION = 2;

/** Trailing zeros removed, so `50.00` is written `50` and two renders of one hand-off stay byte-identical. */
function coordinate(value: number, scale: number): string {
  return Number((value * scale).toFixed(PATH_PRECISION)).toString();
}

/**
 * A traced polyline as an SVG `d`, projected from its own space into the plate.
 *
 * THIS IS THE FUNCTION THE 128-VERSUS-256 BUG LIVED IN. The scale factor is
 * `plateSize / space` and `space` comes from the hand-off — never from a
 * constant, never from `MASK_SIZE`, never from the crop's own side. Feeding
 * mask-space points with `space` set to the crop's 256 draws the whole hand at
 * half size in the top-left quadrant, which looks like a small hand rather than
 * like a bug, and that is exactly why `test/pothi-palm-plate.test.ts` pins both
 * directions instead of only the correct one.
 *
 * Straight `L` segments rather than a smoothing spline: these points are
 * measurements. A curve fitted through them would be a nicer-looking claim than
 * the scanner made, and at plate scale the segments are well under a pixel
 * apart anyway.
 *
 * @returns the path, or null when there is nothing honest to draw
 */
export function pothiPolylinePath(
  points: readonly PothiGeometryPoint[] | undefined,
  space: number,
  plateSize: number = POTHI_PLATE_SIZE,
): string | null {
  if (!isPolyline(points)) return null;
  if (!isFiniteNumber(space) || space <= 0) return null;
  if (!isFiniteNumber(plateSize) || plateSize <= 0) return null;

  const scale = plateSize / space;
  const [first, ...rest] = points;
  const head = `M ${coordinate(first[0], scale)} ${coordinate(first[1], scale)}`;
  const tail = rest.map((point) => `L ${coordinate(point[0], scale)} ${coordinate(point[1], scale)}`);
  return [head, ...tail].join(" ");
}

/**
 * Every line in a hand-off, projected, in {@link POTHI_PLATE_LINE_IDS} order.
 *
 * Returns entries rather than a record so the caller can render in a stable
 * order without re-deriving one, and so a line that failed validation is simply
 * absent from the list instead of present with a null path that every consumer
 * would then have to remember to skip.
 */
export function pothiPlatePaths(
  geometry: PothiGeometry,
  plateSize: number = POTHI_PLATE_SIZE,
): readonly { readonly id: PothiPlateLineId; readonly d: string }[] {
  const paths: { readonly id: PothiPlateLineId; readonly d: string }[] = [];
  for (const id of POTHI_PLATE_LINE_IDS) {
    const d = pothiPolylinePath(geometry.lines[id], geometry.space, plateSize);
    if (d !== null) paths.push({ id, d });
  }
  return paths;
}

/* -------------------------------- Adapter ---------------------------------- */

/**
 * The session hand-off as the shape `resolveChapter` reads.
 *
 * Two modules ended up with two `PothiGeometry` types because they answer two
 * questions — "what did the tab keep?" and "may this chapter draw?" — and the
 * conversion between them has exactly two traps, both handled here so no caller
 * meets either. `space` becomes `size` (the same number under the other file's
 * name), and `observedFraction` becomes null rather than being invented: the
 * hand-off does not carry it, and a fabricated 1.0 would tell the resolver every
 * millimetre of the trace sat on observed evidence.
 */
export function toChapterGeometry(geometry: PothiGeometry): PothiChapterGeometry {
  const lines: PothiTracedLine[] = [];
  for (const id of POTHI_PLATE_LINE_IDS) {
    const points = geometry.lines[id];
    if (isPolyline(points)) lines.push({ id, points, observedFraction: null });
  }
  return { lines, size: geometry.space };
}
