/**
 * The whole room, assembled — and the one light it is lit by.
 *
 * EXACTLY ONE WARM KEY. Amendment 4's first line, and §6.2 [R7]'s "ONE warm
 * point source at the pedestal". It is a point light at the anchor
 * room-composition.ts calls `key`, with decay 2 and no cutoff, so the inverse
 * square law — not a tuned radius — decides how the room falls away from it.
 * The candles are flickers beside it and the moon is a cold shaft through the
 * window onto the far shelves (P2 ruling 3); neither is allowed to become a
 * second key, and scripts/capture/score-room.mjs measures that.
 *
 * FOG MAKES THE BACK OF THE ROOM RECEDE. FogExp2, in the stone's own darkest
 * colour, so the shelves and the window fade into the room's dark rather than
 * into a grey haze — Amendment 4 asks that "shelves recede into fog rather than
 * sitting flat", and a fog the colour of the walls is what makes that read as
 * depth rather than as murk.
 *
 * THE HAND AND THE ZODIAC ARRIVE LATE, AND THE ROOM DOES NOT WAIT. Both are
 * fetched; the room renders the moment its procedural geometry exists, and
 * each piece appears when it lands. A slow network costs the reader the hand
 * for a moment, never the room.
 */
import { AmbientLight, Color, FogExp2, PointLight, Scene, SRGBColorSpace, TextureLoader, type PerspectiveCamera } from "three";
import { buildAtmosphere } from "./atmosphere";
import { buildHologram } from "./hologram";
import { computeLayout, type RoomLayout } from "./layout";
import { FLAME_WARM, GOLD_600, STONE_900 } from "./palette";
import {
  applyZodiacMask,
  buildBook,
  buildCandles,
  buildDrapes,
  buildGround,
  buildLibrary,
  buildPedestal,
  buildWindow,
  type Built,
} from "./props";
import { DRAPE_LAYER } from "./post";
import { makeRoomCamera } from "./stage-projection";

/**
 * The key's intensity, candela. Decay 2, no cutoff: the square law shapes the room.
 *
 * ITERATION 2: 9 -> 16, because the key moved up into the column (layout.ts
 * KEY_COLUMN_FRACTION) and now stands ~0.6 m from the drum rather than ~0.1 m.
 * ITERATION 4: 16 -> 22, so it lights the frame at least twice as much as any
 * candle (it was 0.81x of the nearest one).
 */
export const KEY_INTENSITY = 22;

/** Barely any: the room is lit, not filled. Enough that the far wall is not pure black. */
export const AMBIENT_INTENSITY = 0.05;

/** How fast the room falls into its own dark with distance. */
export const FOG_DENSITY = 0.1;

/** Built at build time from <CelestialRing> by scripts/textures/build-zodiac-mask.mjs. */
export const ZODIAC_MASK_URL = "/textures/zodiac-ring.png";

export interface RoomWorld {
  readonly scene: Scene;
  readonly camera: PerspectiveCamera;
  readonly layout: RoomLayout;
  readonly key: PointLight;
  readonly tick: (seconds: number) => void;
  /** Resolves when the late pieces (the hand, the zodiac) have arrived or failed. */
  readonly settled: Promise<void>;
  readonly dispose: () => void;
}

export function buildWorld(): RoomWorld {
  const camera = makeRoomCamera();
  const layout = computeLayout(camera);

  const scene = new Scene();
  scene.background = new Color(STONE_900);
  scene.fog = new FogExp2(STONE_900, FOG_DENSITY);

  scene.add(new AmbientLight(GOLD_600, AMBIENT_INTENSITY));

  const key = new PointLight(FLAME_WARM, KEY_INTENSITY, 0, 2);
  key.position.copy(layout.key);
  key.name = "key";
  scene.add(key);

  const windowBuilt = buildWindow(layout);
  scene.add(windowBuilt.moonlight, windowBuilt.moonlight.target);

  const pedestal = buildPedestal(layout, null);
  const hologram = buildHologram(layout);

  const parts: Built[] = [
    buildGround(layout),
    pedestal,
    buildCandles(layout),
    buildBook(layout),
    buildLibrary(layout),
    windowBuilt,
    buildDrapes(layout),
    hologram,
    buildAtmosphere(layout),
  ];
  for (const part of parts) scene.add(part.object);

  // [R11] Every light but the moon also lights the flagged drapes' layer.
  scene.traverse((node) => {
    if ("isLight" in node && node.isLight && node !== windowBuilt.moonlight) node.layers.enable(DRAPE_LAYER);
  });

  // The zodiac: optional. If the texture is missing the drum is still brass.
  let zodiacTexture: { dispose: () => void } | null = null;
  const zodiac = new TextureLoader()
    .loadAsync(ZODIAC_MASK_URL)
    .then((texture) => {
      // A colour map: its bytes are sRGB. Left untagged, Three treats it as
      // linear and the engraving comes out washed pale.
      texture.colorSpace = SRGBColorSpace;
      zodiacTexture = texture;
      applyZodiacMask(pedestal.object, texture);
    })
    .catch(() => {
      /* No mask: the pedestal renders without its engraving rather than failing. */
    });

  const settled = Promise.allSettled([hologram.ready, zodiac]).then(() => undefined);

  return {
    scene,
    camera,
    layout,
    key,
    settled,
    tick: (seconds) => {
      for (const part of parts) part.tick?.(seconds);
    },
    dispose: () => {
      for (const part of parts) part.dispose();
      zodiacTexture?.dispose();
    },
  };
}
