/**
 * The scan → manuscript hand-off (U1.5).
 *
 * `/read/pothi` reads a finished reading and the traced geometry out of
 * `sessionStorage`; until this module existed nothing wrote either, so the route
 * rendered its closed-bundle empty state forever. This is the writer, and it is
 * deliberately ONE call so that both the existing `/scan` and the chamber add a
 * single line each rather than each growing their own copy of the marshalling.
 *
 * **Nothing here reaches a server.** `prisma/schema.prisma` says it in the
 * schema — *"sanitised feature bag exactly as evaluated (no images, ever)"* — and
 * `/scan` promises the user the same thing in its own copy. The crop lives in
 * `sessionStorage` for this tab and this session, and ruling R3 is what a
 * revisited reading falls back to: the same measured polyline on a neutral palm
 * diagram, with the margin note that the original image is not kept.
 *
 * **The space is passed, never defaulted.** `extractLines(merged, MASK_SIZE)`
 * emits its polylines in whatever grid it was handed, and a projection that
 * assumed 256 while holding 128-space points is a bug this repo has already paid
 * for once (fixed in 2db5c39; `test/scan.test.ts` pins both spans). Callers give
 * the number; this module refuses to guess it.
 */
import type { ReadingResponse } from "@/app/read/reading-types";
import { writePothiReading } from "@/lib/sanctuary/pothi-reading-store";
import {
  POTHI_CROP_MAX_CHARS,
  writePothiGeometry,
  type PothiGeometry,
  type PothiGeometryPoint,
  type PothiPlateLineId,
} from "@/lib/sanctuary/pothi-geometry";

/** The four creases the plate can draw. Anything else the extractor names is not carried. */
const PLATE_LINES: readonly PothiPlateLineId[] = ["heart", "head", "life", "fate"];

/**
 * A traced line as `lib/scan/lines.ts` hands it over: tuple points, in `space` units.
 * Structural rather than an import so this module stays out of the scan graph.
 */
export interface HandOffLine {
  readonly points: readonly (readonly [number, number])[];
}

export interface HandOffInput {
  readonly reading: ReadingResponse;
  /** `LineExtraction.lines` — keyed by line id, points in `space` units. */
  readonly lines: Partial<Record<string, HandOffLine | undefined>>;
  /** The grid the points were traced in. MASK_SIZE on both scan paths today. */
  readonly space: number;
  /** The rectified crop, already encoded. Omitted when encoding failed or was skipped. */
  readonly cropDataUrl?: string;
  readonly sessionId: string;
  readonly capturedAt: string;
}

export interface HandOffResult {
  readonly readingWritten: boolean;
  readonly geometryWritten: boolean;
  /** Which lines actually carried enough points to draw. Empty is a real answer. */
  readonly linesCarried: readonly PothiPlateLineId[];
  /** Set when a crop was offered but not carried, with the reason. */
  readonly cropSkipped?: "too-large" | "not-supplied";
}

/**
 * Narrow the extractor's line bag to the four the plate draws, dropping anything
 * too short to be a stroke.
 *
 * Two points is the floor because one point is not a line, and a plate that
 * renders a single dot would be claiming a crease it does not have — the same A2
 * rule the sealed leaf enforces, applied one layer earlier.
 */
function carriedLines(
  lines: Partial<Record<string, HandOffLine | undefined>>,
): Partial<Record<PothiPlateLineId, readonly PothiGeometryPoint[]>> {
  const out: Partial<Record<PothiPlateLineId, readonly PothiGeometryPoint[]>> = {};
  for (const id of PLATE_LINES) {
    const line = lines[id];
    if (line === undefined || line.points.length < 2) continue;
    out[id] = line.points.map(([x, y]) => [x, y] as PothiGeometryPoint);
  }
  return out;
}

/**
 * Write both halves of the hand-off. Best-effort by design: a storage failure
 * costs the manuscript its illustration, never the user their reading, so each
 * half reports separately and neither throws.
 */
export function handOffToPothi(input: HandOffInput): HandOffResult {
  const readingWritten = writePothiReading(input.reading);

  const lines = carriedLines(input.lines);
  const oversized = input.cropDataUrl !== undefined && input.cropDataUrl.length > POTHI_CROP_MAX_CHARS;
  const geometry: PothiGeometry = {
    sessionId: input.sessionId,
    capturedAt: input.capturedAt,
    ...(input.cropDataUrl !== undefined && !oversized ? { cropDataUrl: input.cropDataUrl } : {}),
    lines,
    space: input.space,
  };
  const geometryWritten = writePothiGeometry(geometry);

  return {
    readingWritten,
    geometryWritten,
    linesCarried: Object.keys(lines) as PothiPlateLineId[],
    ...(oversized ? { cropSkipped: "too-large" as const } : {}),
    ...(input.cropDataUrl === undefined ? { cropSkipped: "not-supplied" as const } : {}),
  };
}

/**
 * Encode an already-rectified crop as a PNG data URL.
 *
 * Kept here rather than in the scan client so the chamber and `/scan` cannot
 * drift on the encoding, and returns null rather than throwing: on a browser
 * that refuses the canvas (or a tainted one, which cannot happen from a same-origin
 * `ImageData` but is cheap to survive) the manuscript falls back to R3's neutral
 * diagram, which is a designed state rather than a failure.
 */
export function encodeCrop(image: ImageData): string | null {
  try {
    const canvas = document.createElement("canvas");
    canvas.width = image.width;
    canvas.height = image.height;
    const context = canvas.getContext("2d");
    if (context === null) return null;
    context.putImageData(image, 0, 0);
    return canvas.toDataURL("image/png");
  } catch {
    return null;
  }
}

/* ------------------------------ The rescan ask ------------------------------ */

/**
 * What a sealed leaf asked for when it sent the reader back to the camera.
 *
 * The button on a sealed leaf carries `?rescan=<id>`; until now that was
 * provenance and nothing read it. A2's promise is that every gap becomes an
 * invitation, and an invitation the camera ignores is not one — so the scan
 * routes read this and open with the instruction as their first gate prompt.
 */
export const RESCAN_PARAM = "rescan";

/** The ids a sealed leaf can ask to be re-measured, and the ink each opens with. */
export const RESCAN_PROMPTS: Readonly<Record<string, string>> = {
  heart: "हृदय रेखा साफ़ नहीं दिखी — खिड़की के पास दोबारा.",
  head: "मस्तिष्क रेखा साफ़ नहीं दिखी — खिड़की के पास दोबारा.",
  life: "जीवन रेखा साफ़ नहीं दिखी — खिड़की के पास दोबारा.",
  fate: "शनि रेखा साफ़ नहीं दिखी — हथेली सीधी रखो.",
  sun: "सूर्य रेखा साफ़ नहीं दिखी — खिड़की के पास दोबारा.",
  health: "बुध रेखा साफ़ नहीं दिखी — खिड़की के पास दोबारा.",
  dhan: "धन का संकेत कम मिला — पूरा हाथ फ़्रेम में लाओ.",
  rishte: "रिश्तों का संकेत कम मिला — पूरा हाथ फ़्रेम में लाओ.",
  karm: "कर्म का संकेत कम मिला — पूरा हाथ फ़्रेम में लाओ.",
  sehat: "सेहत का संकेत कम मिला — पूरा हाथ फ़्रेम में लाओ.",
  swabhav: "स्वभाव का संकेत कम मिला — पूरा हाथ फ़्रेम में लाओ.",
};

/**
 * The prompt for a rescan request, or null when there is no request or the id is
 * not one we can act on. Unknown ids return null rather than a generic line: a
 * prompt that does not name the thing it is asking for is noise, and the scan
 * already has its own gate copy for the general case.
 */
export function rescanPrompt(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  return RESCAN_PROMPTS[value] ?? null;
}
