/**
 * ============================================================================
 * THE MATERIAL SYSTEM — one door into components/sanctuary/material/**.
 * ============================================================================
 *
 * WHY A BARREL AT ALL, GIVEN BARRELS HAVE A BAD NAME.
 *
 * The objection to a barrel is real and worth stating before answering it: an
 * `index` that re-exports a whole folder can drag every module in that folder
 * into a consumer's graph for the sake of one import, and in a client bundle
 * that is measured in kilobytes nobody asked for. Three facts make this one
 * safe, and they are properties of THIS folder rather than of barrels in
 * general:
 *
 *   1. Every component behind it is a SERVER component. Not one file in
 *      components/sanctuary/material carries `"use client"` — the leaf, the
 *      metal, the wax and all five ornaments are static markup computed from
 *      props. A server component that is imported and not rendered costs a
 *      consumer nothing at runtime; it is never serialised to the client at
 *      all.
 *   2. The two heaviest things in the system are not code. They are the shared
 *      `feTurbulence` sprite (mounted once, by `<SanctuaryDefs />`) and the CSS
 *      modules, both of which are paid for on render and not on import.
 *   3. `next build` tree-shakes the ES re-exports below, and the modules have
 *      no import side effects — the CSS modules are imported by the components
 *      that use them, never by this file.
 *
 * WHAT THE BARREL BUYS IN RETURN, WHICH IS THE PART THAT MATTERS.
 *
 * This is a *system*, and its parts have a contract with each other that is
 * invisible from any single module: a leaf without `<SanctuaryDefs />` loses its
 * tear silently, an ornament without the sprite loses its gold, the ground
 * needs both the sprite and a route root that opens no stacking context. A
 * caller who imports six paths has been handed six unrelated components. A
 * caller who imports one path has been handed a system, and the order below —
 * contract, determinism, sprite, room, leaf, metal, wax, ornament — is that
 * system read from the bottom up, so the file doubles as the assembly order for
 * a new sanctuary route.
 *
 * WHY THE RE-EXPORTS ARE NAMED AND NEVER `export *`.
 *
 * `./ornaments` deliberately re-exports `GoldRule` from `./gold-text` so the
 * ornament family can be imported whole. Two `export *` lines would therefore
 * both offer `GoldRule`, and an ambiguous star export is not an error — the
 * name is silently dropped from the namespace, and `GoldRule` would simply stop
 * existing here with nothing to read in the diff. Naming every symbol makes the
 * ambiguity impossible and makes this file the inventory of the system, which
 * is the second reason to read it.
 *
 * WHY `<SanctuaryHeader />` IS NOT HERE, THOUGH IT SHIPPED IN THE SAME PASS.
 *
 * It lives at components/sanctuary/sanctuary-header.tsx, one directory up, and
 * it is route furniture rather than material: it knows about four product
 * destinations and imports `next/link`. Re-exporting it would make a `material`
 * barrel reach upward out of its own folder and would put a router dependency
 * behind every import of a torn edge. Import it from its own module —
 * `@/components/sanctuary/sanctuary-header` — the way app/sanctuary/materials
 * does.
 *
 * PER-SYMBOL JSDOC IS DELIBERATELY ABSENT BELOW, AND THAT IS NOT A LAPSE. A
 * doc comment on a re-export does not attach to the symbol: editors and
 * `tsc` resolve the hover text to the original declaration, so a comment here
 * would be a second description that no tool shows and that drifts from the
 * one that is shown. Every symbol is documented where it is declared. What this
 * file documents instead — and what exists nowhere else — is the ORDER, and
 * each group below says why it sits where it does.
 */

/* -------------------------------------------------------------------------- */
/* 1. THE SPRITE CONTRACT — ./ids                                             */
/*                                                                            */
/* First because everything else in the system references it and because it is */
/* the one module with no imports of its own. A filter id spelled by hand is   */
/* the system's signature silent failure: `url(#snc-f-tron)` renders an        */
/* unfiltered element with no warning, and a leaf that quietly lost its tear   */
/* looks like a design decision. `defUrl` and the closed `SanctuaryDefId` are  */
/* what turn that into a compile error.                                        */
/* -------------------------------------------------------------------------- */
export {
  SNC_FILTER_TORN,
  SNC_FILTER_TORN_ROUGH,
  SNC_FILTER_GRAIN,
  SNC_FILTER_EMBOSS,
  SNC_GRADIENT_GOLD,
  SNC_GRADIENT_WAX,
  SNC_GRADIENT_RULE,
  SANCTUARY_DEF_IDS,
  defUrl,
  SNC_TORN_BASE_FREQUENCY,
  SNC_TORN_OCTAVES,
  SNC_TORN_DISPLACEMENT_SCALE,
  SNC_TORN_ROUGH_DISPLACEMENT_SCALE,
  SNC_TORN_BLEED_PX,
  SNC_TORN_ROUGH_BLEED_PX,
  SNC_TORN_TURBULENCE_SEED,
  SNC_TORN_ROUGH_TURBULENCE_SEED,
  SNC_GRAIN_BASE_FREQUENCY,
  SNC_GRAIN_OCTAVES,
  SNC_EMBOSS_DY,
  SNC_EMBOSS_STD_DEVIATION,
  SNC_EMBOSS_FLOOD_OPACITY,
  SNC_GOLD_RAMP_ANGLE_DEG,
} from "./ids";
export type { SanctuaryDefId } from "./ids";

/* -------------------------------------------------------------------------- */
/* 2. DETERMINISM — ./rng                                                     */
/*                                                                            */
/* Second because it is the other thing every irregular shape depends on, and  */
/* because reading it before the components explains why they all take a       */
/* required `seed`. Irregularity here is *addressed*, never random: the same   */
/* seed is the same torn edge on the server and in the hydrated client, which  */
/* is the difference between a material and a leaf that re-tears itself on     */
/* every navigation.                                                          */
/* -------------------------------------------------------------------------- */
export { seededRandom, seededJitter } from "./rng";

/* -------------------------------------------------------------------------- */
/* 3. THE SPRITE ITSELF — ./sanctuary-defs                                    */
/*                                                                            */
/* Mounted ONCE per sanctuary route, before anything that references it.       */
/* `feTurbulence` is evaluated per filter element rather than per reference, so */
/* ten torn leaves sharing one `#snc-f-torn` is one noise field and ten inlined */
/* copies is ten — the whole frame budget on a LOW device. Without it every    */
/* primitive below still renders, just wrong, and quietly.                     */
/* -------------------------------------------------------------------------- */
export { SanctuaryDefs } from "./sanctuary-defs";

/* -------------------------------------------------------------------------- */
/* 4. THE ROOM — ./sanctuary-ground                                           */
/*                                                                            */
/* Before the primitives because it is what they are all lying ON, and because */
/* several of them (the burnt rim, the warm shadow under a seal, the emboss    */
/* under a medallion) are only correct over warm near-black. Judging a leaf on */
/* a white page is judging a different component.                             */
/* -------------------------------------------------------------------------- */
export {
  SanctuaryGround,
  sanctuaryGroundScratches,
  SANCTUARY_GROUND_SCRATCH_COUNT,
  SANCTUARY_GROUND_ORNAMENT_TILT_DEG,
} from "./sanctuary-ground";
export type { SanctuaryGroundProps, SanctuaryGroundScratch } from "./sanctuary-ground";

/* -------------------------------------------------------------------------- */
/* 5. THE LEAF — ./parchment                                                  */
/*                                                                            */
/* The first primitive, because it is the surface the other three are applied  */
/* to and because it carries the observation the whole pass exists to fix:     */
/* parchment is never a flat fill. `parchmentEdgePolygon` is exported beside   */
/* the component so any future torn primitive tears by the same rule rather    */
/* than inventing a second one.                                               */
/* -------------------------------------------------------------------------- */
export {
  Parchment,
  parchmentEdgePolygon,
  PARCHMENT_TONES,
  PARCHMENT_TEARS,
  PARCHMENT_EDGE_POINT_COUNT,
} from "./parchment";
export type { ParchmentProps, ParchmentTone, ParchmentTear, ParchmentElement } from "./parchment";

/* -------------------------------------------------------------------------- */
/* 6. THE METAL — ./gold-text                                                 */
/*                                                                            */
/* Every gold in the system comes from here or from `#snc-g-gold`, which is    */
/* the same six stops. The measured contrast constants travel with the         */
/* component on purpose: `GOLD_TEXT_MIN_FONT_SIZE_PX` is not a style rule but  */
/* the consequence of a 3.91:1 dark stop, and a caller who shrinks GoldText    */
/* has shipped an accessibility defect that happens to look expensive.         */
/*                                                                            */
/* `GoldRule` is taken from HERE and not from ./ornaments, which re-exports    */
/* it — one implementation, one import site, no fork.                          */
/* -------------------------------------------------------------------------- */
export {
  GoldText,
  GoldRule,
  goldBorderClassName,
  GOLD_TEXT_SIZES,
  GOLD_TEXT_ELEMENTS,
  GOLD_TEXT_MIN_FONT_SIZE_PX,
  GOLD_RAMP_DARKEST_CONTRAST_ON_STONE,
  GOLD_RAMP_BRIGHTEST_CONTRAST_ON_STONE,
  GOLD_FOIL_FLAT_CONTRAST_ON_STONE,
  WCAG_MIN_CONTRAST_BODY,
  WCAG_MIN_CONTRAST_LARGE,
} from "./gold-text";
export type { GoldTextProps, GoldRuleProps, GoldTextSize, GoldTextElement } from "./gold-text";

/* -------------------------------------------------------------------------- */
/* 7. THE WAX — ./wax-seal                                                    */
/*                                                                            */
/* The mark that closes a reading, and the one primitive with a motion of its  */
/* own — a 200 ms press that the FLOOR tier and `prefers-reduced-motion` both  */
/* remove while every layer of material stays. `waxSealPath` and               */
/* `waxEmblemGeometry` are React-free so the outline and the emblems can be    */
/* asserted without rendering anything.                                        */
/* -------------------------------------------------------------------------- */
export {
  WaxSeal,
  waxSealPath,
  waxEmblemGeometry,
  WAX_SEAL_VIEWBOX,
  WAX_SEAL_BASE_RADIUS,
  WAX_SEAL_RADIUS_JITTER,
  WAX_SEAL_LOBE_MIN,
  WAX_SEAL_LOBE_MAX,
  WAX_SEAL_PRESS_DURATION_MS,
} from "./wax-seal";
export type { WaxSealProps, WaxEmblem, WaxEmblemGeometry } from "./wax-seal";

/* -------------------------------------------------------------------------- */
/* 8. THE ORNAMENTS — ./ornaments                                             */
/*                                                                            */
/* Last because an ornament is the thing you add once the material underneath  */
/* is right, and because §7's restraint is easiest to break here. Five marks    */
/* sharing one hairline: 1px, `#snc-g-gold`, non-scaling, round-capped, with no */
/* second weight anywhere in the family.                                       */
/* -------------------------------------------------------------------------- */
export {
  OrnamentalDivider,
  AncientCorner,
  LotusDecoration,
  CelestialRing,
  TrishulEmblem,
  ORNAMENTAL_DIVIDER_HEIGHT_PX,
  ORNAMENT_CORNERS,
  CELESTIAL_SECTORS_DEFAULT,
  CELESTIAL_BEADS_DEFAULT,
  CELESTIAL_ROTATION_DEG_PER_SECOND,
  CELESTIAL_ROTATION_PERIOD_SECONDS,
  TRISHUL_PARTS,
} from "./ornaments";
export type {
  OrnamentalDividerProps,
  AncientCornerProps,
  LotusDecorationProps,
  CelestialRingProps,
  TrishulEmblemProps,
  OrnamentCorner,
  TrishulPart,
} from "./ornaments";
