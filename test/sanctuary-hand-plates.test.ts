/* ============================================================================
 * M1.1 — THE REAL HAND, EVERYWHERE; THE DRAWN ONE, NOWHERE
 *
 * What is asserted:
 *
 *  1. The old SVG hands are gone from the tree: no source under app/,
 *     components/, lib/ or scripts/ names TRADITION_HAND_OUTLINE, its
 *     silhouette, its creases, NEUTRAL_PALM_PATH or <HologramHand>, and the
 *     two path signatures ("M66,258", "M 16.5 0") appear nowhere.
 *  2. The three baked plates exist, validate, and are what they say: every
 *     file present, every byte count true, 2x and 3x exact multiples, the
 *     hologram cut to HOLOGRAM_HAND_REGION, the plate square, the tradition
 *     plate the aspect of TRADITION_HAND_PLATE_BOX.
 *  3. The registration records hold the code: the plate's anchors ARE
 *     rectify.ts CANONICAL_ANCHORS; the tradition's landmarks and box ARE the
 *     module's; the hologram's region and camera ARE the room's; every bake
 *     was made from the committed mesh, by SHA-256.
 *  4. Every surface mounts its plate: the room and the vignette (hologram),
 *     the book's leaf (tradition, small), the tradition's palm (tradition),
 *     the Pothi's neutral plate and the Rekha Monitor (plate) — each as a
 *     <picture> with AVIF first, WebP after, three densities.
 *  5. The phone gets the room: the vignette carries Room3D at the phone
 *     profile; the canvas has that profile (DPR 1, no post, one frame in two);
 *     the gate loads only once the stage has been seen; the fade is 600 ms.
 *  6. Nothing under the bar: the bar is opaque, as tall as --snc-bar-height,
 *     and the column ends by that same number plus the safe-area inset.
 * ========================================================================== */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import Module, { createRequire } from "node:module";
import path from "node:path";
import { createElement, type ReactElement } from "react";
import { renderToString } from "react-dom/server";
import { HAND_PLATES } from "../lib/sanctuary/hand-plates";
import { isPlateManifest, PLATE_SCALES, plateSrcSet } from "../lib/sanctuary/plate-manifest";
import { HOLOGRAM_HAND_REGION } from "../lib/sanctuary/room-composition";
import { TRADITION_HAND_LANDMARKS, TRADITION_HAND_PLATE_BOX } from "../lib/sanctuary/tradition-hand";
import { CANONICAL_ANCHORS } from "../lib/scan/rectify";

let assertions = 0;
const ok = (condition: boolean, message: string): void => {
  assert.ok(condition, message);
  assertions += 1;
};

const CLASS_NAME_STUB: Record<string, string> = new Proxy({}, { get: (_t, key) => (typeof key === "string" ? key : "") });
interface CjsExtensionHost {
  _extensions: Record<string, (loaded: { exports: unknown }, filename: string) => void>;
}
(Module as unknown as CjsExtensionHost)._extensions[".css"] = (loaded): void => {
  loaded.exports = { __esModule: true, default: CLASS_NAME_STUB };
};

const ROOT = path.resolve(__dirname, "..");
const read = (...parts: string[]): string => readFileSync(path.join(ROOT, ...parts), "utf8");
const withoutComments = (text: string): string =>
  text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
type Component = (props: Record<string, unknown>) => ReactElement | null;
const require_ = createRequire(__filename);
const load = <T,>(rel: string): T => require_(rel) as T;
const render = (component: Component, props: Record<string, unknown> = {}): string =>
  renderToString(createElement(component, props)).replace(/<!-- -->/g, "");

/* ================= 1. The old SVG hands are referenced nowhere ============== */

{
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((entry) => {
      const full = path.join(dir, entry);
      if (entry === "node_modules" || entry === ".next") return [];
      if (statSync(full).isDirectory()) return walk(full);
      return /\.(ts|tsx|css|mjs|js)$/.test(entry) ? [full] : [];
    });
  const sources = ["app", "components", "lib", "scripts"].flatMap((dir) => walk(path.join(ROOT, dir)));
  ok(sources.length > 100, `the sweep sees the tree (${sources.length} files)`);
  const OLD_HAND = /TRADITION_HAND_OUTLINE|TRADITION_HAND_SILHOUETTE|TRADITION_HAND_CREASES|NEUTRAL_PALM_PATH|\bHologramHand\b|M66,258|M 16\.5 0/;
  const offenders = sources.filter((file) => OLD_HAND.test(readFileSync(file, "utf8")));
  ok(offenders.length === 0, `the old SVG hand is referenced nowhere under app/, components/, lib/ or scripts/${offenders.length ? `: ${offenders.map((f) => path.relative(ROOT, f)).join(", ")}` : ""}`);
  const tests = walk(path.join(ROOT, "test")).filter((file) => path.basename(file) !== path.basename(__filename));
  const testOffenders = tests.filter((file) => OLD_HAND.test(readFileSync(file, "utf8")));
  ok(testOffenders.length === 0, `…nor by any other test${testOffenders.length ? `: ${testOffenders.map((f) => path.relative(ROOT, f)).join(", ")}` : ""}`);
}

/* ==================== 2. The three plates, as they say they are ============== */

const meshSha = createHash("sha256").update(readFileSync(path.join(ROOT, "public", "models", "hand.glb"))).digest("hex");

interface Bake {
  readonly id: string;
  readonly source: { readonly mesh: string; readonly sha256: string; readonly landmarks: string };
  readonly registration: Record<string, unknown>;
}

const bakes: Record<string, Bake> = {};

for (const [kind, manifest] of Object.entries(HAND_PLATES)) {
  const id = manifest.id;
  const dir = path.join(ROOT, "public", "plates", id);
  const raw: unknown = JSON.parse(readFileSync(path.join(dir, "manifest.json"), "utf8"));
  ok(isPlateManifest(raw) && JSON.stringify(raw) === JSON.stringify(manifest), `${id}: the committed manifest validates and is the one the code imports`);
  ok(manifest.densities.length === PLATE_SCALES.length, `${id}: three densities`);
  for (const density of manifest.densities) {
    const avif = statSync(path.join(ROOT, `public${density.avif}`), { throwIfNoEntry: false });
    const webp = statSync(path.join(ROOT, `public${density.webp}`), { throwIfNoEntry: false });
    ok(avif !== undefined && webp !== undefined, `${id} ${density.scale}x: both encodings exist on disk`);
    ok(avif?.size === density.bytes && (webp?.size ?? 0) > 0, `${id} ${density.scale}x: the recorded AVIF bytes (${density.bytes}) are the file's`);
    ok(density.avif.endsWith(`-${density.scale}x.avif`) && density.webp.endsWith(`-${density.scale}x.webp`), `${id} ${density.scale}x: the file names state their density`);
  }
  const [one, two, three] = manifest.densities;
  ok(two!.width === one!.width * 2 && three!.width === one!.width * 3, `${id}: 2x and 3x are exact multiples of 1x`);
  ok(manifest.alt.length > 20, `${id}: the alt text is a sentence`);
  const bake = JSON.parse(readFileSync(path.join(dir, "bake.json"), "utf8")) as Bake;
  bakes[kind] = bake;
  ok(bake.id === id && bake.source.mesh === "public/models/hand.glb" && bake.source.landmarks === "public/models/hand.landmarks.json", `${id}: baked from the P1 mesh and its landmarks`);
  ok(bake.source.sha256 === meshSha, `${id}: from the committed mesh, by SHA-256 — a new mesh means a re-bake`);
}

{
  const [one] = HAND_PLATES.hologram.densities;
  ok(one!.width === HOLOGRAM_HAND_REGION.w && one!.height === HOLOGRAM_HAND_REGION.h, `the hologram plate at 1x is the hand region, ${HOLOGRAM_HAND_REGION.w} x ${HOLOGRAM_HAND_REGION.h} stage units at one pixel each`);
  const [plate] = HAND_PLATES.plate.densities;
  ok(plate!.width === plate!.height, "the Pothi's plate is square, like the crop and the mask");
  const [tradition] = HAND_PLATES.tradition.densities;
  ok(
    Math.abs(tradition!.width / tradition!.height - TRADITION_HAND_PLATE_BOX.width / TRADITION_HAND_PLATE_BOX.height) < 0.01,
    "the tradition plate has the aspect of TRADITION_HAND_PLATE_BOX",
  );
}

/* ================ 3. The registration records hold the code ================= */

{
  const plate = bakes.plate!.registration as { anchors: { x: number; y: number }[]; mirrored: boolean; worstResidualPx: number };
  ok(JSON.stringify(plate.anchors) === JSON.stringify(CANONICAL_ANCHORS), "the Pothi's plate was warped onto rectify.ts CANONICAL_ANCHORS — exactly those four, in that order");
  ok(plate.mirrored === true, "…mirrored, so the thumb is on the left as the rectified crop frames it");
  ok(plate.worstResidualPx < 0.05, `…with every joint landing within a twentieth of a pixel (${plate.worstResidualPx})`);

  const tradition = bakes.tradition!.registration as { landmarks: unknown; box: unknown; mirrored: boolean; worstResidualPx: number };
  ok(JSON.stringify(tradition.landmarks) === JSON.stringify(TRADITION_HAND_LANDMARKS), "the tradition plate was fitted to TRADITION_HAND_LANDMARKS — the points the classical lines were drawn against");
  ok(JSON.stringify(tradition.box) === JSON.stringify(TRADITION_HAND_PLATE_BOX), "…into TRADITION_HAND_PLATE_BOX, the box the component lays the drawing inside");
  ok(tradition.mirrored === false && tradition.worstResidualPx < 0.05, "…thumb on the viewer's right, to the pixel");

  const hologram = bakes.hologram!.registration as { region: unknown; pose: string; camera: { position: number[]; fov: number; horizon: number }; cameraAgreementStageUnits: number };
  ok(JSON.stringify(hologram.region) === JSON.stringify(HOLOGRAM_HAND_REGION), "the hologram plate was cut to HOLOGRAM_HAND_REGION");
  ok(/sway 0/.test(hologram.pose), "…at the resting pose, sway zero — the frame the live scene fades in over");
  const projection = withoutComments(read("components", "sanctuary", "room", "three", "stage-projection.ts"));
  ok(
    projection.includes(`position: new Vector3(${hologram.camera.position.join(", ")})`) && projection.includes(`fov: ${hologram.camera.fov},`) && projection.includes(`horizon: ${hologram.camera.horizon},`),
    "…through the room's own camera (CAMERA_SANCTUARY, read back from stage-projection.ts)",
  );
  ok(hologram.cameraAgreementStageUnits < 0.01, "…and the cut camera agreed with the room's to a hundredth of a stage unit");
}

/* ===================== 4. Every surface mounts its plate ===================== */

{
  const picture = (html: string, kind: string): boolean => {
    const at = html.indexOf(`data-snc-hand-plate="${kind}"`);
    if (at === -1) return false;
    /* React 19 emits the camel-cased attribute names it was given (srcSet, fetchPriority); the browser reads them case-insensitively. */
    const tag = html.slice(at, html.indexOf("</picture>", at)).replace(/srcSet=/g, "srcset=");
    const manifest = HAND_PLATES[kind as keyof typeof HAND_PLATES];
    return (
      tag.indexOf('type="image/avif"') < tag.indexOf('type="image/webp"') &&
      tag.includes(`srcset="${plateSrcSet(manifest, "avif")}"`) &&
      tag.includes(`srcset="${plateSrcSet(manifest, "webp")}"`) &&
      tag.includes(`width="${manifest.densities[0]!.width}"`)
    );
  };

  const { RoomStage } = load<{ RoomStage: Component }>("../components/sanctuary/room/room-stage");
  const room = render(RoomStage, { id: "r", variant: "room" });
  const vignette = render(RoomStage, { id: "v", variant: "vignette" });
  ok(picture(room, "hologram") && picture(vignette, "hologram"), "the room and the vignette carry the hologram plate: AVIF first, WebP after, three densities");
  ok(/data-snc-room-object="hologram"[^>]*>\s*<picture[^>]*data-snc-hand-plate="hologram"/.test(room), "…as the hologram's own floating element, over the column and under the rings");
  ok(!room.includes('data-snc-hand-plate="tradition"') && room.includes(HAND_PLATES.tradition.densities[0]!.webp), "the book's left leaf carries the tradition plate small, as its own drawing of the hand");
  ok(!room.includes("<path") || !/<path[^>]*class="[^"]*\bhand\b/.test(room), "and no drawn hand remains in the room");

  const { TraditionPalm } = load<{ TraditionPalm: Component }>("../components/sanctuary/home/tradition-palm");
  const palm = render(TraditionPalm);
  ok(picture(palm, "tradition"), "the tradition's palm carries the tradition plate");
  const box = TRADITION_HAND_PLATE_BOX;
  ok(
    palm.includes(`aspect-ratio:${box.width} / ${box.height}`) &&
      palm.includes(`top:${((-box.y / box.height) * 100).toFixed(3)}%`) &&
      palm.includes(`height:${((290 / box.height) * 100).toFixed(3)}%`),
    "…in the plate's box, with the drawing laid inside it at the drawing's own 216 x 290",
  );
  ok(palm.indexOf('data-snc-hand-plate="tradition"') < palm.indexOf("<svg"), "…under the lines, never over them");

  const { PalmPlate } = load<{ PalmPlate: Component }>("../components/sanctuary/pothi/palm-plate");
  const revisited = render(PalmPlate, { lineId: "heart", geometry: { space: 128, lines: { heart: [[10, 40], [100, 30]] } } });
  ok(picture(revisited, "plate") && /data-snc-part="neutral-palm"[^>]*>\s*<picture/.test(revisited), "the Pothi's neutral plate is the crop-registered plate");

  const { RekhaMonitor } = load<{ RekhaMonitor: Component }>("../components/sanctuary/chamber/rekha-monitor");
  const monitor = render(RekhaMonitor, { snapshot: null });
  ok(picture(monitor, "plate"), "the Rekha Monitor's plate is the same crop-registered plate");
  ok(/<picture[^>]*style="left:17\.949%;top:5\.357%;width:64\.103%;height:89\.286%"[^>]*data-snc-hand-plate="plate"/.test(monitor), "…laid on the palm's 0-100 square of the monitor's view (-28 -6 156 112)");
}

/* ===================== 5. The phone gets the room ============================ */

{
  const page = withoutComments(read("app", "sanctuary", "page.tsx"));
  ok(/<RoomStage\s+id=\{VIGNETTE_ID\}\s+variant="vignette"[\s\S]*?scene=\{<Room3D roomId=\{VIGNETTE_ID\} profile="phone" \/>\}/.test(page), "the vignette carries Room3D at the phone profile");
  ok(/<HomeContent[\s\S]*?hero=\{/.test(page), "…as Home's hero, beside the greeting");
  const gate = withoutComments(read("components", "sanctuary", "room", "three", "room-3d.tsx"));
  ok(/export const ROOM_SCENE_FADE_MS = 600;/.test(gate), "the scene crossfades in over 600 ms");
  ok(gate.indexOf("new IntersectionObserver") < gate.indexOf('import("./room-canvas")') || /if \(onScreen\) askWhenIdle\(\);/.test(gate), "the chunk is asked for only once the stage has been on screen — a hidden stage never loads it");
  const canvas = withoutComments(read("components", "sanctuary", "room", "three", "room-canvas.tsx"));
  ok(/export const ROOM_PHONE_FRAME_MS = 1000 \/ 30;/.test(canvas) && /now - lastDrawn >= ROOM_PHONE_FRAME_MS - 1/.test(canvas), "the phone profile draws one frame in two");
  ok(/renderer\.setPixelRatio\(phone \? 1 :/.test(canvas), "…at DPR 1");
  ok(/const post = phone \? null : buildPost\(/.test(canvas) && /drawFlagged\(renderer, world\.scene, world\.camera\)/.test(canvas), "…with no post stack, the scene drawn straight to the canvas in [R11]'s two draws");
  ok(/if \(first && settled\) \{\s*first = false;\s*callbacks\.current\.onFirstFrame\?\.\(\);/.test(canvas), "…and reports its first frame only once the hand has arrived, so the crossfade is between two pictures of the same hand");
  const hologram = withoutComments(read("components", "sanctuary", "room", "three", "hologram.ts"));
  ok(hologram.includes("#include <tonemapping_fragment>") && hologram.includes("#include <colorspace_fragment>"), "the hologram's shader tone-maps and converts its own colour, so the no-post path matches the desktop's");
  ok(/uShade/.test(hologram) && /max\(dot\(n, normalize\(uKey - vWorld\)\), 0\.0\)/.test(hologram), "…and the hand's interior is softly shaded toward the key");
}

/* ===================== 6. Nothing under the bar ============================== */

{
  const bar = withoutComments(read("components", "sanctuary", "shell", "bottom-nav.module.css"));
  ok(/\.bar\s*{[^}]*background-color:\s*var\(--color-snc-obsidian\);/.test(bar), "the bar is opaque obsidian — nothing shows through it");
  ok(/\.bar\s*{[^}]*height:\s*calc\(var\(--snc-bar-height, 4\.25rem\) \+ env\(safe-area-inset-bottom, 0px\)\)/.test(bar), "…as tall as --snc-bar-height plus the safe-area inset");
  ok(/\.centre\s*{[^}]*margin-top:\s*-0\.7rem/.test(bar) && /\.centre\s*{[^}]*width:\s*3\.4rem/.test(bar), "the emblem overhangs the bar by a little, as the target draws it");
  const shell = withoutComments(read("components", "sanctuary", "shell", "sanctuary-shell.module.css"));
  ok(/\.shell\s*{[^}]*--snc-bar-height:\s*4\.25rem;/.test(shell), "the shell declares the bar's height once");
  ok(/\.column\s*{[^}]*padding-bottom:\s*calc\(var\(--snc-bar-height\) \+ env\(safe-area-inset-bottom, 0px\)\);/.test(shell), "…and the content column ends by exactly that plus the inset");
  const home = withoutComments(read("components", "sanctuary", "home", "home.module.css"));
  ok(/"greeting hero"/.test(home) && /"hero hero"/.test(home), "on a phone the greeting sits beside the vignette; from 34rem the vignette is a band");
}

console.log(`SANCTUARY HAND PLATES ASSERTIONS PASSED (${assertions})`);
