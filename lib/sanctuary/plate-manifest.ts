/**
 * The contract between the plate build script and the runtime that paints plates.
 *
 * Sanctuary backdrops are pre-rendered images, not geometry (§6.2: layers 4/2/1 are plates; only
 * the pedestal and the book are live). Nothing at runtime can look at a `.avif` on disk and work
 * out its intrinsic size, its density sibling, or which parallax layer it belongs to — so the build
 * script writes those facts down once, and this module is the only place that decides whether a
 * written-down manifest is trustworthy.
 *
 * The validator exists because the manifest crosses a trust boundary: it is JSON on disk, produced
 * by a script a human runs by hand after a manual Blender export (see scripts/plates/README.md).
 * A half-written manifest must fail loudly at load, not silently render a broken <img> with a
 * missing 3x source on the one device that needed it.
 */

/**
 * Parallax depth bands from §3 ("far architecture, mid props, near dust") and §6.2's layer list.
 * Exported as a value, not just a type, because both the validator and the component's z-index and
 * depth-factor tables have to iterate the same four names in the same far→near order.
 */
export const PLATE_LAYERS = ["far", "mid", "near", "dust"] as const;

/** One of the four §3 parallax depth bands. */
export type PlateLayer = (typeof PLATE_LAYERS)[number];

/**
 * The three densities §10 requires ("AVIF with WebP fallback, 3 densities"). Ascending, and used
 * as the canonical order — a manifest whose densities disagree with this list is rejected, so the
 * component can index by position without re-sorting on every render.
 */
export const PLATE_SCALES = [1, 2, 3] as const;

/** Device pixel ratio bucket a plate encoding targets. */
export type PlateScale = (typeof PLATE_SCALES)[number];

/** One density of one plate, in both shipped formats. */
export interface PlateDensity {
  /** 1, 2 or 3 — the `1x`/`2x`/`3x` descriptor this entry supplies to `srcSet`. */
  readonly scale: PlateScale;
  /** Intrinsic pixel width of the encoded files. Present so `<img>` can reserve space and never shift layout. */
  readonly width: number;
  /** Intrinsic pixel height of the encoded files. */
  readonly height: number;
  /** Public URL of the AVIF encoding, e.g. `/plates/placeholder/placeholder-2x.avif`. */
  readonly avif: string;
  /** Public URL of the WebP fallback at the same pixel size. */
  readonly webp: string;
  /**
   * Byte size of the AVIF file — the payload a real user actually downloads, because AVIF is the
   * first `<source>` and WebP only serves browsers that cannot decode it. This is the number the
   * §10 plate budget is spent against; the build script prints the WebP size too, but budgeting
   * the fallback would double-count a transfer that never happens.
   */
  readonly bytes: number;
}

/** Everything the runtime needs to paint one parallax plate at any density. */
export interface PlateManifest {
  /** Stable plate id, also the output directory and file stem. */
  readonly id: string;
  /**
   * Alt text. Required and non-empty even though plates are scenery: a screen reader user is
   * entitled to know the sanctuary they are standing in, and §11's honesty rule applies to what we
   * describe as much as to what we claim.
   */
  readonly alt: string;
  /** Which §3 depth band this plate occupies — drives both parallax amount and z-index. */
  readonly layer: PlateLayer;
  /** Exactly one entry per `PLATE_SCALES` value, in ascending order. */
  readonly densities: readonly PlateDensity[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

/**
 * Encoded plates live under `public/`, so their manifest paths are root-relative URLs. A path
 * without the leading slash would resolve against whatever route is mounted and 404 on every page
 * but one, which is exactly the kind of failure that only shows up in production.
 */
function isPublicPath(value: unknown): value is string {
  return isNonEmptyString(value) && value.startsWith("/");
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function isPlateDensityAt(value: unknown, expectedScale: PlateScale): value is PlateDensity {
  if (!isRecord(value)) return false;
  if (value.scale !== expectedScale) return false;
  if (!isPositiveInteger(value.width) || !isPositiveInteger(value.height)) return false;
  if (!isPublicPath(value.avif) || !isPublicPath(value.webp)) return false;
  if (!isPositiveInteger(value.bytes)) return false;
  return true;
}

/**
 * Structural gate for a manifest read off disk or over the wire.
 *
 * Strict on purpose. A manifest missing its 3x entry, or carrying two 1x entries, or naming an
 * empty AVIF path, is not a degraded plate — it is a plate that will render blank or blurry on
 * exactly the hardware we could not test, and a boolean here is cheaper than that bug.
 */
export function isPlateManifest(value: unknown): value is PlateManifest {
  if (!isRecord(value)) return false;
  if (!isNonEmptyString(value.id)) return false;
  if (!isNonEmptyString(value.alt)) return false;
  if (!isNonEmptyString(value.layer)) return false;
  if (!(PLATE_LAYERS as readonly string[]).includes(value.layer)) return false;

  const densities = value.densities;
  if (!Array.isArray(densities)) return false;
  if (densities.length !== PLATE_SCALES.length) return false;

  /* Positional check: entry i must be scale PLATE_SCALES[i]. This rejects a missing scale, a
   * duplicated scale and an out-of-order list in one pass, because any of those breaks the
   * position↔scale correspondence somewhere. */
  return PLATE_SCALES.every((scale, index) => isPlateDensityAt(densities[index], scale));
}
