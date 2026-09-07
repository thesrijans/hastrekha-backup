/* ============================================================================
 * SCENE PLATE — the plate manifest contract and the §9 parallax clamp
 *
 * Three things are pinned here, and each one is a promise rather than a detail.
 *
 * **The manifest is true.** A plate manifest is JSON written by a script a
 * human runs by hand after a manual Blender export (scripts/plates/README.md
 * — showcase3d has no Blender path, so there is no CI step that would notice a
 * stale entry). So the committed placeholder manifest is checked against the
 * actual files on disk: every path resolves, and every recorded `bytes` equals
 * the real AVIF size. A manifest that drifts from its files is a §10 budget
 * built on a number nobody re-measured.
 *
 * **The validator refuses what would render wrong on hardware nobody owns.**
 * Each malformed shape gets its own assertion, because the failures are not
 * interchangeable: a missing 3x entry is a blurry plate on a good phone, a
 * duplicated scale is the wrong file at the wrong density, an empty path is a
 * blank layer, and an unknown layer is a plate at the wrong depth AND the
 * wrong z-index. All of them are invisible in review and visible to users.
 *
 * **The clamp holds.** §9 caps plate drift at ±12 px on desktop and ±8 px on
 * mobile, and §10's FLOOR tier is static. Fed impossible pointer offsets, a
 * broken sensor's NaN, and ±Infinity, `clampParallaxOffset` must still never
 * exceed the budget, and FLOOR must return exactly 0 — not "almost zero". The
 * unclamped version of this bug swings a backdrop across the screen of someone
 * sitting still reading about their own life.
 *
 * Plus one SSR pass over <ScenePlate> itself: `renderToString` cannot run the
 * rAF loop, but it can prove the markup commits to AVIF-before-WebP, three
 * densities, an explicit z-index, and `fetchpriority` on the priority plate
 * only (§10).
 * ========================================================================== */
import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { PLATE_LAYERS, PLATE_SCALES, isPlateManifest, type PlateLayer, type PlateManifest } from "../lib/sanctuary/plate-manifest";
import {
  PARALLAX_MAX_DESKTOP_PX,
  PARALLAX_MAX_MOBILE_PX,
  PLATE_DEPTH_FACTOR,
  PLATE_Z_INDEX,
  ScenePlate,
  clampParallaxOffset,
  plateSrcSet,
} from "../components/sanctuary/scene-plate";
import type { CapabilityTier } from "../components/sanctuary/use-capability-tier";

let assertions = 0;
const ok = (condition: boolean, message: string): void => {
  assert.ok(condition, message);
  assertions += 1;
};

const MANIFEST_PATH = "public/plates/placeholder/manifest.json";

/* -------------------------------------------------------------------------
 * 1. The committed placeholder manifest parses and validates.
 * ---------------------------------------------------------------------- */

const raw: unknown = JSON.parse(readFileSync(MANIFEST_PATH, "utf8"));
ok(isPlateManifest(raw), "the committed placeholder manifest passes isPlateManifest");
if (!isPlateManifest(raw)) throw new Error("placeholder manifest is malformed; the rest cannot run");
const manifest: PlateManifest = raw;

ok(manifest.id === "placeholder", "manifest id is the plate id");
ok(manifest.layer === "far", "the placeholder is a far plate");
ok(manifest.alt.length > 20, "alt text is a sentence, not a filename");
ok(manifest.densities.length === PLATE_SCALES.length, "one entry per density");

/* -------------------------------------------------------------------------
 * 2. Every file it names exists, and every recorded byte count is the truth.
 * ---------------------------------------------------------------------- */

for (const density of manifest.densities) {
  /* Manifest paths are root-relative URLs; on disk they hang off public/. */
  const avifPath = `public${density.avif}`;
  const webpPath = `public${density.webp}`;

  const avifStat = statSync(avifPath, { throwIfNoEntry: false });
  const webpStat = statSync(webpPath, { throwIfNoEntry: false });
  ok(avifStat !== undefined, `${density.scale}x AVIF exists on disk: ${avifPath}`);
  ok(webpStat !== undefined, `${density.scale}x WebP exists on disk: ${webpPath}`);
  if (avifStat === undefined || webpStat === undefined) throw new Error(`missing plate file at ${density.scale}x`);

  ok(avifStat.size === density.bytes, `${density.scale}x recorded bytes (${density.bytes}) equal the real AVIF size (${avifStat.size})`);
  ok(webpStat.size > 0, `${density.scale}x WebP fallback is not an empty file`);

  /* The file stem must carry its own density, or a manifest edit can silently point 3x at the 1x file. */
  ok(density.avif.endsWith(`-${density.scale}x.avif`), `${density.scale}x AVIF filename states its density`);
  ok(density.webp.endsWith(`-${density.scale}x.webp`), `${density.scale}x WebP filename states its density`);
}

/* Dimensions scale exactly with the density descriptor: 2x really is twice 1x. */
const [one, two, three] = manifest.densities;
ok(two.width === one.width * 2 && two.height === one.height * 2, "2x is exactly twice 1x");
ok(three.width === one.width * 3 && three.height === one.height * 3, "3x is exactly three times 1x");

/* -------------------------------------------------------------------------
 * 3. isPlateManifest rejects each malformed shape. One assertion each.
 * ---------------------------------------------------------------------- */

type MutableDensity = Record<string, unknown>;
interface MutableManifest {
  id: unknown;
  alt: unknown;
  layer: unknown;
  densities: MutableDensity[];
}

/** A fresh mutable copy of the good manifest, so each malformation starts from a valid document. */
const bend = (mutate: (draft: MutableManifest) => void): unknown => {
  const draft = JSON.parse(JSON.stringify(manifest)) as MutableManifest;
  mutate(draft);
  return draft;
};

ok(!isPlateManifest(bend((d) => d.densities.splice(2, 1))), "rejects a missing density (no 3x)");
ok(!isPlateManifest(bend((d) => { d.densities[2].scale = 2; })), "rejects a duplicate scale (two 2x entries)");
ok(!isPlateManifest(bend((d) => { d.densities[1].avif = ""; })), "rejects an empty avif path");
ok(!isPlateManifest(bend((d) => { d.densities[0].width = 0; })), "rejects a zero width");
ok(!isPlateManifest(bend((d) => { d.layer = "middle"; })), "rejects an unknown layer");

/* The neighbouring failures, each one line, because they are all one typo away from the above. */
ok(!isPlateManifest(bend((d) => { d.densities.reverse(); })), "rejects descending densities");
ok(!isPlateManifest(bend((d) => { d.densities[2].webp = ""; })), "rejects an empty webp path");
ok(!isPlateManifest(bend((d) => { d.densities[1].bytes = 0; })), "rejects a zero byte count");
ok(!isPlateManifest(bend((d) => { d.densities[0].height = -360; })), "rejects a negative height");
ok(!isPlateManifest(bend((d) => { d.densities[0].avif = "plates/x-1x.avif"; })), "rejects a path with no leading slash");
ok(!isPlateManifest(bend((d) => { d.alt = ""; })), "rejects empty alt text");
ok(!isPlateManifest(bend((d) => { d.id = ""; })), "rejects an empty id");
ok(!isPlateManifest(bend((d) => { delete (d.densities[1] as { width?: unknown }).width; })), "rejects a density missing width");
ok(!isPlateManifest(null), "rejects null");
ok(!isPlateManifest(manifest.densities), "rejects an array in place of the manifest object");
ok(!isPlateManifest({ ...manifest, densities: "three" }), "rejects densities that are not an array");

/* And the four real layer names are all accepted, so the rejection above is about the value. */
for (const layer of PLATE_LAYERS) {
  ok(isPlateManifest({ ...manifest, layer }), `accepts layer "${layer}"`);
}

/* -------------------------------------------------------------------------
 * 4. The §9 parallax clamp.
 * ---------------------------------------------------------------------- */

const EXTREMES = [1e6, -1e6, 9999, -9999, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NaN];
const TIERS_THAT_MOVE: readonly CapabilityTier[] = ["HIGH", "MID", "LOW"];

for (const capability of TIERS_THAT_MOVE) {
  for (const layer of PLATE_LAYERS) {
    for (const offsetPx of EXTREMES) {
      const desktop = clampParallaxOffset({ offsetPx, layer, surface: "desktop", capability });
      const mobile = clampParallaxOffset({ offsetPx, layer, surface: "mobile", capability });
      ok(
        Number.isFinite(desktop) && Math.abs(desktop) <= PARALLAX_MAX_DESKTOP_PX,
        `${capability}/${layer}: desktop offset ${offsetPx} clamps inside ±${PARALLAX_MAX_DESKTOP_PX} px (got ${desktop})`,
      );
      ok(
        Number.isFinite(mobile) && Math.abs(mobile) <= PARALLAX_MAX_MOBILE_PX,
        `${capability}/${layer}: mobile offset ${offsetPx} clamps inside ±${PARALLAX_MAX_MOBILE_PX} px (got ${mobile})`,
      );
    }
  }
}

/* FLOOR is static: exactly zero, every layer, every surface, every input. §10. */
for (const layer of PLATE_LAYERS) {
  for (const surface of ["desktop", "mobile"] as const) {
    for (const offsetPx of [...EXTREMES, 0, 3, -3]) {
      const out = clampParallaxOffset({ offsetPx, layer, surface, capability: "FLOOR" });
      ok(out === 0 && Object.is(out, 0), `FLOOR/${layer}/${surface}: offset ${offsetPx} yields exactly 0`);
    }
  }
}

/* A broken sensor reads NaN. It must mean "no movement", not "move by NaN" (which erases the transform). */
ok(clampParallaxOffset({ offsetPx: Number.NaN, layer: "dust", surface: "desktop", capability: "HIGH" }) === 0, "NaN reads as no movement");

/* The budget is actually reachable — a clamp nothing ever hits is a clamp that was never tested. */
ok(
  clampParallaxOffset({ offsetPx: 1e6, layer: "dust", surface: "desktop", capability: "HIGH" }) === PARALLAX_MAX_DESKTOP_PX,
  "the dust layer spends the full ±12 px desktop budget",
);
ok(
  clampParallaxOffset({ offsetPx: -1e6, layer: "dust", surface: "mobile", capability: "HIGH" }) === -PARALLAX_MAX_MOBILE_PX,
  "the dust layer spends the full ±8 px mobile budget, signed",
);

/* Depth reads because the layers disagree. Far moves least, dust moves most (§3). */
const probe = (layer: PlateLayer): number =>
  clampParallaxOffset({ offsetPx: 10, layer, surface: "desktop", capability: "HIGH" });
ok(probe("far") < probe("mid") && probe("mid") < probe("near") && probe("near") < probe("dust"), "far < mid < near < dust at the same input");
ok(PLATE_DEPTH_FACTOR.far > 0, "even the far layer moves — a motionless far plate is a flat backdrop");

/* Sign is preserved: the plate follows the input direction rather than snapping to a corner. */
ok(clampParallaxOffset({ offsetPx: 4, layer: "mid", surface: "desktop", capability: "MID" }) > 0, "a positive offset stays positive");
ok(clampParallaxOffset({ offsetPx: -4, layer: "mid", surface: "desktop", capability: "MID" }) < 0, "a negative offset stays negative");

/* Stacking is explicit and strictly ordered far → dust, because paint order cannot be trusted
 * next to the mirrored /scan video (app/scan/scan-client.tsx:475 creates a stacking context). */
ok(
  PLATE_Z_INDEX.far < PLATE_Z_INDEX.mid && PLATE_Z_INDEX.mid < PLATE_Z_INDEX.near && PLATE_Z_INDEX.near < PLATE_Z_INDEX.dust,
  "z-index rises strictly from far to dust",
);

/* -------------------------------------------------------------------------
 * 5. The rendered markup commits to the §10 plate contract.
 * ---------------------------------------------------------------------- */

ok(
  plateSrcSet(manifest, "avif") === `${one.avif} 1x, ${two.avif} 2x, ${three.avif} 3x`,
  "srcSet lists all three densities with density descriptors",
);

/**
 * React 19 serialises `srcSet` and `fetchPriority` with their JSX casing. HTML attribute names are
 * ASCII case-insensitive, so the parser still reads `srcset` and `fetchpriority` — but an assertion
 * that cared about the casing would be testing React's serialiser, not our contract.
 */
const emits = (html: string, attribute: string): boolean => html.toLowerCase().includes(attribute.toLowerCase());

const html = renderToString(createElement(ScenePlate, { manifest, capability: "MID", priority: true }));
ok(html.includes('type="image/avif"'), "an AVIF source is emitted");
ok(html.includes('type="image/webp"'), "a WebP source is emitted");
ok(html.indexOf('type="image/avif"') < html.indexOf('type="image/webp"'), "AVIF is offered before WebP, so it wins where supported");
ok(html.includes("<img"), "an <img> fallback closes the <picture>");
ok(html.includes(`src="${one.webp}"`), "the <img> fallback src is the 1x WebP, the format with the widest support");
ok(emits(html, `srcset="${plateSrcSet(manifest, "avif")}"`), "the AVIF source carries all three densities");
ok(html.includes(`alt="${manifest.alt}"`), "the manifest's alt text reaches the markup");
ok(html.includes(`width="${one.width}"`) && html.includes(`height="${one.height}"`), "intrinsic dimensions are stated, so the plate cannot shift layout");
ok(emits(html, 'fetchpriority="high"'), "the current camera's plate is fetchpriority=high (§10)");
ok(html.includes('loading="eager"'), "the priority plate is not lazy");
ok(html.includes("z-index:0"), "the far plate states z-index 0 explicitly rather than trusting paint order");
ok(html.includes("will-change:transform"), "a moving plate is promoted to its own compositor layer");

const floorHtml = renderToString(createElement(ScenePlate, { manifest, capability: "FLOOR" }));
ok(!emits(floorHtml, "fetchpriority"), "a non-priority plate carries no fetchpriority attribute at all");
ok(floorHtml.includes('loading="lazy"'), "a non-priority plate loads lazily");
ok(!floorHtml.includes("will-change"), "FLOOR does not promote a layer it will never move");
ok(!floorHtml.includes("translate3d"), "FLOOR renders with no transform");

const overrideHtml = renderToString(createElement(ScenePlate, { manifest, capability: "MID", z: 99 }));
ok(overrideHtml.includes("z-index:99"), "the z prop overrides the layer's default stacking number");

console.log(`SCENE PLATE ASSERTIONS PASSED (${assertions})`);
