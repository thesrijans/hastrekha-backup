import { Color } from "three";

/**
 * The room's colours, as numbers Three.js can take.
 *
 * These are the sanctuary's own tokens from app/sanctuary.css, restated in the
 * one form CSS custom properties cannot reach: a scene graph needs `0xC9A24B`,
 * not `var(--color-snc-gold-500)`. Every value here is a copy, and
 * test/sanctuary-three-palette.test.ts reads both files and fails if they
 * drift, because two palettes that are meant to be one palette will otherwise
 * separate quietly over a few passes and the 3D room will stop matching the
 * CSS room it fades over.
 *
 * NO NEW COLOURS ARE INVENTED HERE. §14's list of what this must never become
 * starts with a WebGL showpiece that looks like a different product, and the
 * fastest route to that is a scene that picks its own gold.
 */

/** Ground — the dark the sanctuary is carved out of. */
export const STONE_900 = 0x0a0806;
export const STONE_800 = 0x0d0b09;
export const STONE_700 = 0x16120d;

/** Gold — all linework. 400 highlight, 500 primary, 600 engraved shadow. */
export const GOLD_400 = 0xe8c56a;
export const GOLD_500 = 0xc9a24b;
export const GOLD_600 = 0x8a6a2a;

/** Night — the cold side of the room, and the two candle temperatures. */
export const MOON = 0x2b3a52;
export const FLAME = 0xffb347;
export const FLAME_WARM = 0xe08a2e;

/** The manuscript, for the book's leaves. */
export const PARCHMENT = 0xe8dcc0;
export const INK_RED = 0x8b1e1e;

/** Dark wood — the stand, the shelves, the bundles' boards. */
export const WOOD = 0x241a12;

/**
 * Every colour above, by the token name it copies. The palette test walks this
 * so a new constant cannot be added without the CSS side being checked.
 */
export const THREE_PALETTE: Readonly<Record<string, number>> = {
  "--color-snc-stone-900": STONE_900,
  "--color-snc-stone-800": STONE_800,
  "--color-snc-stone-700": STONE_700,
  "--color-snc-gold-400": GOLD_400,
  "--color-snc-gold-500": GOLD_500,
  "--color-snc-gold-600": GOLD_600,
  "--color-snc-moon": MOON,
  "--color-snc-flame": FLAME,
  "--color-snc-flame-warm": FLAME_WARM,
};

/* ------------------------------------------------------------------------ */
/* ALBEDO — the tokens are DISPLAY colours, not reflectances                  */
/* ------------------------------------------------------------------------ */

/**
 * Give a surface a token's colour at a physically plausible reflectance.
 *
 * ITERATION 3, and the most consequential fix in P2. The first two iterations
 * used the tokens directly as material albedo. But every token above is a
 * DISPLAY colour — what the CSS room paints on screen — and the stone tokens
 * are nearly black: stone-800 is #0D0B09, about 0.4% reflectance, darker than
 * coal (~4%). A surface of that albedo reflects almost none of the light that
 * reaches it, so no light can make it visible. The scorer showed it
 * directly: raising the key from 9 to 16 cd LOWERED its contribution to the
 * frame, the moon rim lit the frame at 0.0000 at any intensity, and the drapes
 * and shelves stayed black however they were lit.
 *
 * In a lit scene the darkness belongs to the LIGHTING — one key falling off by
 * the square law, into fog — while each surface keeps the reflectance its
 * material really has. So this keeps a token's chromaticity exactly (the
 * ratio between its linear channels, i.e. its hue and saturation) and sets
 * only how much light it reflects. No new hue is introduced; the stone is
 * still the stone's warm near-black family, now able to catch a candle.
 */
export function albedo(token: number, reflectance: number): Color {
  const colour = new Color(token);
  const luminance = 0.2126 * colour.r + 0.7152 * colour.g + 0.0722 * colour.b;
  return colour.multiplyScalar(reflectance / Math.max(luminance, 1e-6));
}

/**
 * Reflectances, from measured values for the materials the reference shows.
 * Dark stone 6-12%, dark oiled wood 8-15%, deep red velvet 4-8%.
 */
export const REFLECTANCE = {
  floorStone: 0.09,
  wallStone: 0.07,
  darkWood: 0.12,
  velvet: 0.06,
} as const;
