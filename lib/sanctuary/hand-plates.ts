/**
 * The three baked hands (M1.1) — the manifests scripts/plates/bake-hand.mjs
 * wrote, validated once at import so a half-written plate fails the build
 * rather than rendering a broken picture on the one device that needed it.
 *
 * Each is the P1 mesh (public/models/hand.glb) rendered, not drawn: the
 * hologram's hand at rest through the room's own camera; the Pothi's and the
 * Rekha Monitor's plate registered to the rectifier's canonical crop; the
 * tradition's diagram hand fitted to the points its lines were drawn against.
 * bake.json beside each manifest records that registration, and
 * test/sanctuary-hand-plates.test.ts holds the code to it.
 */
import { isPlateManifest, type PlateManifest } from "./plate-manifest";
import hologram from "@/public/plates/hand-hologram/manifest.json";
import plate from "@/public/plates/hand-plate/manifest.json";
import tradition from "@/public/plates/hand-tradition/manifest.json";

function checked(value: unknown, name: string): PlateManifest {
  if (!isPlateManifest(value)) throw new Error(`public/plates/${name}/manifest.json is not a plate manifest — re-run scripts/plates/bake-hand.mjs`);
  return value;
}

/** The scene's hand at rest, cut to HOLOGRAM_HAND_REGION. Thumb on the viewer's right. */
export const HAND_HOLOGRAM_PLATE: PlateManifest = checked(hologram, "hand-hologram");

/** The palm as the rectified crop frames it: thumb LEFT, fingers running off the top, the four joints on CANONICAL_ANCHORS. */
export const HAND_PLATE_PLATE: PlateManifest = checked(plate, "hand-plate");

/** The whole hand, thumb on the viewer's right, in the tradition diagram's 216 × 290 box. */
export const HAND_TRADITION_PLATE: PlateManifest = checked(tradition, "hand-tradition");

export const HAND_PLATES = { hologram: HAND_HOLOGRAM_PLATE, plate: HAND_PLATE_PLATE, tradition: HAND_TRADITION_PLATE } as const;
export type HandPlateKind = keyof typeof HAND_PLATES;
