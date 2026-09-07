import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { CSSProperties, ReactElement, ReactNode } from "react";
import { SanctuaryHeader } from "@/components/sanctuary/sanctuary-header";
import {
  AncientCorner,
  CELESTIAL_BEADS_DEFAULT,
  CELESTIAL_ROTATION_DEG_PER_SECOND,
  CELESTIAL_ROTATION_PERIOD_SECONDS,
  CELESTIAL_SECTORS_DEFAULT,
  CelestialRing,
  GOLD_FOIL_FLAT_CONTRAST_ON_STONE,
  GOLD_RAMP_BRIGHTEST_CONTRAST_ON_STONE,
  GOLD_RAMP_DARKEST_CONTRAST_ON_STONE,
  GOLD_TEXT_MIN_FONT_SIZE_PX,
  GOLD_TEXT_SIZES,
  GoldRule,
  GoldText,
  LotusDecoration,
  ORNAMENT_CORNERS,
  OrnamentalDivider,
  PARCHMENT_EDGE_POINT_COUNT,
  PARCHMENT_TEARS,
  PARCHMENT_TONES,
  Parchment,
  SANCTUARY_GROUND_SCRATCH_COUNT,
  SNC_TORN_BLEED_PX,
  SNC_TORN_ROUGH_BLEED_PX,
  SanctuaryDefs,
  SanctuaryGround,
  TrishulEmblem,
  WCAG_MIN_CONTRAST_BODY,
  WaxSeal,
  goldBorderClassName,
  sanctuaryGroundScratches,
  type GoldTextSize,
  type ParchmentTear,
  type ParchmentTone,
  type WaxEmblem,
} from "@/components/sanctuary/material";
import { SANCTUARY_FONT_CLASS } from "@/lib/sanctuary/fonts";
import { TokenSwatchStrip, WaxPressBench } from "./materials-client";

/**
 * Dev-only inspection surface for the sanctuary material system.
 *
 * `robots: { index: false, follow: false }` alongside the NODE_ENV gate below,
 * following app/dev/capture and app/dev/label: the gate is what actually stops
 * the route existing, and the metadata is the belt for the case where a build
 * of a preview branch is ever run with NODE_ENV=development.
 */
export const metadata: Metadata = {
  title: "Material bench — dev",
  robots: { index: false, follow: false },
};

/* ========================================================================== */
/* THE BENCH'S OWN TYPOGRAPHY                                                 */
/* ========================================================================== */

/*
 * The three sanctuary faces, as class strings rather than inline styles,
 * because two of the three land on <GoldText>, which takes a className and no
 * style. They resolve only under SANCTUARY_FONT_CLASS, which is applied once on
 * <main> — see lib/sanctuary/fonts.ts for why the root layout is left alone.
 */
const DISPLAY_FACE = "[font-family:var(--font-snc-display)]";
const SERIF_FACE = "[font-family:var(--font-snc-serif)]";
const DEVANAGARI_FACE = "[font-family:var(--font-snc-devanagari)]";

/*
 * The bench's two voices, and neither of them is gold display type.
 *
 * A LABEL names a specimen; it is letterspaced caps in the flat foil gold, at a
 * size far below GOLD_TEXT_MIN_FONT_SIZE_PX — which is exactly why it is NOT a
 * <GoldText>. The ramp's darkest stop measures under the body-text contrast
 * minimum, so shrinking struck metal to caption size is an accessibility defect
 * that happens to look expensive. Section headings are the only gold display
 * type on this page.
 *
 * A DETAIL is the literal prop list, monospaced, in the aged parchment edge —
 * warm enough to belong on the stone, quiet enough to stay under the specimen
 * it describes.
 */
const LABEL = "text-[0.7rem] tracking-[0.22em] text-snc-gold-400 uppercase";
const DETAIL = "font-mono text-[0.72rem] leading-6 text-snc-parch-edge";
const PROSE = "max-w-[46rem] text-[0.95rem] leading-8 text-snc-parch-edge";

/** Manuscript body text, for anything written on a leaf rather than on the stone. */
const INK_STYLE: CSSProperties = { color: "var(--color-snc-ink)" };

/** Marginalia and citations on a leaf — the same red the wax is poured from. */
const INK_RED_STYLE: CSSProperties = { color: "var(--color-snc-ink-red)" };

/* ========================================================================== */
/* LAYOUT PRIMITIVES OF THE BENCH ITSELF                                      */
/* ========================================================================== */

/**
 * One captioned specimen: the thing, then what it was given.
 *
 * A <figure> and not a card. There is no border, no fill, no radius and no
 * uniform padding anywhere in this component — a bench of boxed swatches is the
 * SaaS-card failure the whole pass exists to undo, and it would also lie about
 * the primitives, several of which are only correct when nothing is drawn
 * around them.
 */
function Specimen({
  label,
  detail,
  children,
}: {
  readonly label: string;
  readonly detail?: string;
  readonly children: ReactNode;
}): ReactElement {
  return (
    <figure className="m-0 flex min-w-0 flex-col gap-4">
      <div className="min-w-0">{children}</div>
      <figcaption className="flex flex-col gap-1.5">
        <span className={LABEL}>{label}</span>
        {detail === undefined ? null : <code className={DETAIL}>{detail}</code>}
      </figcaption>
    </figure>
  );
}

/**
 * A row of specimens with air between them.
 *
 * `items-end` so a row of one primitive at three sizes sits on a common
 * baseline instead of being centred — three ornaments floating at three
 * different heights read as three unrelated marks, which defeats the point of
 * putting them side by side.
 */
function Bench({ children }: { readonly children: ReactNode }): ReactElement {
  return <div className="flex flex-wrap items-end gap-x-16 gap-y-12">{children}</div>;
}

/**
 * A major division of the bench: a centred ornament to break the column, an
 * ordinal, a gold heading and a lede, then the specimens.
 *
 * The ordinal is not decoration — this page is long, and a reviewer comparing
 * it against docs/reference needs to be able to say "section IV" out loud.
 */
function Section({
  ordinal,
  title,
  seed,
  lede,
  children,
}: {
  readonly ordinal: string;
  readonly title: string;
  readonly seed: number;
  readonly lede: ReactNode;
  readonly children: ReactNode;
}): ReactElement {
  return (
    <section className="flex flex-col gap-12 pt-24">
      <header className="flex flex-col gap-6">
        <OrnamentalDivider width={520} seed={seed} />
        <div className="flex flex-col gap-4 pt-6">
          <span className={LABEL}>{ordinal}</span>
          <GoldText as="h2" size="subtitle" caps className={DISPLAY_FACE}>
            {title}
          </GoldText>
          <div className={PROSE}>{lede}</div>
        </div>
      </header>
      {children}
    </section>
  );
}

/** A subdivision inside a section: a quiet caps label and its specimens, so a long section still has landmarks. */
function Group({
  heading,
  note,
  children,
}: {
  readonly heading: string;
  readonly note?: string;
  readonly children: ReactNode;
}): ReactElement {
  return (
    <div className="flex flex-col gap-8 pt-6">
      <div className="flex flex-col gap-3">
        <span className={LABEL}>{heading}</span>
        {note === undefined ? null : <p className={PROSE}>{note}</p>}
      </div>
      {children}
    </div>
  );
}

/* ========================================================================== */
/* SPECIMEN DATA                                                              */
/* ========================================================================== */

/** Distinct primes, so no two leaves on the page share an outline, a mottle or a stain count. */
const LEAF_SEEDS: readonly number[] = [11, 23, 37, 53, 71, 89, 101, 127, 149, 163];

/** The three dies, in the order the wax section stamps them. */
const WAX_EMBLEMS: readonly WaxEmblem[] = ["palm", "lotus", "trishul"];

/** Three sizes that cover the real range: a marginal stamp, a signature and a hero. */
const WAX_SIZES: readonly number[] = [48, 88, 140];

/** The ground's seed. One number for the whole route, so the scratch field printed in section I is the one actually behind the page. */
const GROUND_SEED = 1607;

/*
 * The reference card's provenance rows, RE-SOURCED to the books the knowledge base actually
 * contains. The PNG says "Ancient Texts ( Brihat Samhita, Hastarekha Shastra )"; ruling R4 strikes
 * that row because neither text is in the KB, whose 548 rules cite Cheiro (377), Dale (171) and one
 * Samudrika entry. A material bench is where a team learns the product's vocabulary, so shipping
 * the struck wording here — even as a type specimen rather than a claim — would teach the exact
 * thing A2 forbids. The layout it demonstrates is unchanged; only the words are honest.
 */
const PROVENANCE_ROWS: ReadonlyArray<{ readonly title: string; readonly source: string }> = [
  { title: "Classical Palmistry", source: "( Cheiro — Palmistry for All, 1916 )" },
  { title: "Palmistry Tradition", source: "( Classical palmistry principles )" },
  { title: "AI Interpretation", source: "( Pattern matching + contextual analysis )" },
];

/** Rounds a scratch coordinate for display without pretending to more precision than the generator has. */
function fixed(value: number): string {
  return value.toFixed(1);
}

/* ========================================================================== */
/* THE PAGE                                                                   */
/* ========================================================================== */

/**
 * THE MATERIAL BENCH — every primitive in the sanctuary material system, at
 * several sizes, over the ground it is designed to sit on.
 *
 * WHY THIS ROUTE EXISTS, AND WHY IT IS DEV-ONLY.
 *
 * The failure this whole pass corrects was invisible in code review: /privacy
 * shipped correct token VALUES arranged as a flat fill with uniform padding and
 * a radius, and nothing in the diff said so. Material is judged by looking, and
 * looking needs a surface where every prop of every primitive is visible at
 * once beside the reference photographs. That surface is a development tool,
 * not a product page — so it 404s outside development, exactly as
 * app/dev/capture and app/dev/label do, and carries noindex besides.
 *
 * HOW TO USE IT. Open docs/reference/ui-reading-lifeline-explainability-card.png
 * and docs/reference/ui-nadi-pothi-candlelight-photo.png beside this page. The
 * questions worth asking, in order: does any parchment read as a flat fill when
 * you squint at it; is there a single solid gold bar anywhere; does the gold
 * vary along its own length; is any shadow grey; does anything glow.
 *
 * THE ONE THING ON SCREEN THAT IS NOT PART OF THE SKIN. The product header from
 * app/layout.tsx is still mounted above everything here — it is the root
 * layout's, it belongs to the instrument palette, and this pass does not touch
 * it. <SanctuaryHeader /> is the specimen; the glass bar above it is not.
 *
 * ZERO CLIENT JAVASCRIPT EXCEPT WHERE IT IS UNAVOIDABLE. This page is a server
 * component and so is every primitive on it. Two islands are not: the token
 * strip, which has to read the live CSSOM, and the press bench, which has to be
 * able to replay a 200 ms mount animation. Both are in ./materials-client.
 */
export default function SanctuaryMaterialsPage(): ReactElement {
  if (process.env.NODE_ENV !== "development") notFound();

  const scratches = sanctuaryGroundScratches(GROUND_SEED, SANCTUARY_GROUND_SCRATCH_COUNT);

  return (
    /*
     * NO BACKGROUND AND NO `isolate` ON THIS ELEMENT, AND BOTH ABSENCES ARE
     * LOAD-BEARING. <SanctuaryGround /> paints at `z-index: -1`, and in a
     * stacking context a negative-z descendant is painted BEFORE the in-flow
     * block backgrounds — so a `bg-snc-stone-800` here would cover the entire
     * ground with a flat fill and leave the page looking like the failure it
     * exists to fix. `isolate` would seal the ground into this box instead of
     * the viewport. The ground's own note states the same contract from the
     * other side.
     */
    <main className={`${SANCTUARY_FONT_CLASS} relative w-full flex-1`}>
      {/* Mounted ONCE for the route, before anything that references it: one
          feTurbulence field for every torn leaf and every grained surface on the
          page rather than one per component. */}
      <SanctuaryDefs />
      <SanctuaryGround seed={GROUND_SEED} capability="HIGH" />

      <div className="mx-auto w-full max-w-[72rem] px-6 pb-40 sm:px-10">
        <SanctuaryHeader />

        {/* ---------------------------------------------------------------- */}
        {/* MASTHEAD                                                          */}
        {/* ---------------------------------------------------------------- */}
        <div className="flex flex-col items-center gap-6 pt-24 pb-4 text-center">
          <span className={LABEL}>Development bench</span>
          <GoldText as="h1" size="hero" className={DISPLAY_FACE}>
            Material Bench
          </GoldText>
          <p className={`${SERIF_FACE} max-w-[38rem] text-xl leading-9 text-snc-parch-edge`}>
            Every primitive of the sanctuary material system, at inspection scale, over the warm
            near-black it was drawn for.
          </p>
          <OrnamentalDivider width={420} seed={5} />
        </div>

        <div className={`${PROSE} mx-auto pt-6 text-center`}>
          <p>
            Nothing on this page is random. Every irregular shape is addressed by a
            <code className="mx-1 font-mono text-snc-gold-400">seed</code>
            prop, so the same seed is the same tear, the same lobe count and the same mottle on the
            server and in the hydrated browser. Reload as often as you like; only the wax under
            <em className="not-italic text-snc-gold-400"> Strike again </em>
            ever changes.
          </p>
        </div>

        {/* ================================================================ */}
        {/* I. THE GROUND                                                     */}
        {/* ================================================================ */}
        <Section
          ordinal="I"
          title="The Ground"
          seed={11}
          lede={
            <>
              <p>
                There is no specimen in this section because the specimen is behind the whole page.
                Six strata, back to front — base, stone, grain, scratches, vignette, watermark —
                each tagged <code className="font-mono text-snc-gold-400">data-snc-layer</code> so
                the stack is legible in devtools rather than being six anonymous divs. The engraved
                sprig sits in the upper right, as in the reference card.
              </p>
              <p className="pt-4">
                Nothing here animates at any tier, which is why the FLOOR device renders this file
                byte for byte: what FLOOR withholds is motion, never material.
              </p>
            </>
          }
        >
          <Group
            heading="The scratch field, for this route's seed"
            note="Seven scored hairlines on the secondary rung of the stroke ladder, in viewBox units. Printed rather than drawn, because the point of a deterministic generator is that you can check it."
          >
            <ul className={`${DETAIL} grid list-none grid-cols-1 gap-x-12 gap-y-1 p-0 sm:grid-cols-2`}>
              {scratches.map((scratch, index) => (
                <li key={index}>
                  {`${index + 1}. (${fixed(scratch.x1)}, ${fixed(scratch.y1)}) → (${fixed(scratch.x2)}, ${fixed(scratch.y2)})`}
                </li>
              ))}
            </ul>
            <code className={DETAIL}>
              {`<SanctuaryGround seed={${GROUND_SEED}} capability="HIGH" />`}
            </code>
          </Group>
        </Section>

        {/* ================================================================ */}
        {/* II. PARCHMENT                                                     */}
        {/* ================================================================ */}
        <Section
          ordinal="II"
          title="Parchment"
          seed={23}
          lede={
            <>
              <p>
                Five layers of material under an irregular boundary: a broad luminance mottle,
                two or three soft stains, an optional crease, a corner-weighted burnt rim, and
                fibre grain over all of it. The outline is a seeded polygon, never a radius — the
                corners are the darkest point on the leaf and the edge is bitten.
              </p>
              <p className="pt-4">
                {`The tear travels outside the element box by design: ±${SNC_TORN_BLEED_PX}px on the subtle tear and ±${SNC_TORN_ROUGH_BLEED_PX}px on the rough one, over ${PARCHMENT_EDGE_POINT_COUNT} outline points. Never wrap a leaf in overflow: hidden.`}
              </p>
            </>
          }
        >
          <Group
            heading="Every tone against every tear"
            note="Brightest tone first, weakest tear first, driven off PARCHMENT_TONES and PARCHMENT_TEARS so this grid cannot drift from the unions."
          >
            <div className="grid grid-cols-1 gap-x-12 gap-y-14 sm:grid-cols-2 lg:grid-cols-3">
              {PARCHMENT_TONES.flatMap((tone: ParchmentTone, toneIndex: number) =>
                PARCHMENT_TEARS.map((tear: ParchmentTear, tearIndex: number) => {
                  const seed = LEAF_SEEDS[toneIndex * PARCHMENT_TEARS.length + tearIndex] ?? 0;
                  return (
                    <Specimen
                      key={`${tone}-${tear}`}
                      label={`${tone} · ${tear}`}
                      detail={`tone="${tone}" tear="${tear}" seed={${seed}}`}
                    >
                      <Parchment tone={tone} tear={tear} seed={seed} className="min-h-[13rem]">
                        <p className={`${SERIF_FACE} text-lg leading-8`} style={INK_STYLE}>
                          Even in times of adversity, his courage is his life&rsquo;s strength.
                        </p>
                      </Parchment>
                    </Specimen>
                  );
                }),
              )}
            </div>
          </Group>

          <Group
            heading="At reading scale"
            note="The same component with room to breathe. The block start is tighter than the block end, the way a hand lays out a leaf — not a uniform card padding."
          >
            <div className="grid grid-cols-1 gap-x-14 gap-y-16 lg:grid-cols-2">
              <Specimen
                label="Built-in corner marks"
                detail={`tone="aged" tear="subtle" seed={${LEAF_SEEDS[6] ?? 0}} corners`}
              >
                <Parchment tone="aged" tear="subtle" seed={LEAF_SEEDS[6] ?? 0} corners>
                  <h3 className={`${SERIF_FACE} text-3xl leading-tight`} style={INK_STYLE}>
                    Life Line
                  </h3>
                  <p className={`${SERIF_FACE} pt-5 text-lg leading-8`} style={INK_STYLE}>
                    Your life line shows a period of transition in your 30s, with strong recovery
                    and renewed energy. The markings suggest you have a deep sense of resilience and
                    inner strength.
                  </p>
                  <p className={`${SERIF_FACE} pt-6 text-base`} style={INK_RED_STYLE}>
                    — Dale — Indian Palmistry, 1895 —
                  </p>
                </Parchment>
              </Specimen>

              <Specimen
                label="Folded, rough-torn"
                detail={`tone="light" tear="rough" seed={${LEAF_SEEDS[7] ?? 0}} fold`}
              >
                <Parchment tone="light" tear="rough" seed={LEAF_SEEDS[7] ?? 0} fold>
                  <p className={`${DEVANAGARI_FACE} text-xl leading-relaxed`} lang="hi" style={INK_STYLE}>
                    विपत्तिकालेऽपि धैर्यं तस्य जीवने बलम् ।
                  </p>
                  <p className={`${SERIF_FACE} pt-6 text-lg leading-8`} style={INK_STYLE}>
                    A spread, not a card: one crease down the middle with a faint lift on its left
                    where the ridge catches the single warm source. Look along the fold, then along
                    the outer edge — the bite is deeper here than on the subtle tear beside it.
                  </p>
                </Parchment>
              </Specimen>
            </div>
          </Group>

          <Group
            heading="The corner slot, filled by the ornament family"
            note="The corners prop takes any node. Passing four <AncientCorner /> pieces is the composition the reference card's Source Wisdom box uses; passing `true` gets the leaf's own hairline arms instead."
          >
            <Specimen
              label="corners={<AncientCorner … />}"
              detail={`corners={ORNAMENT_CORNERS.map(…)} size={44} seed={${LEAF_SEEDS[8] ?? 0}}`}
            >
              <Parchment
                tone="aged"
                tear="subtle"
                seed={LEAF_SEEDS[8] ?? 0}
                className="max-w-[38rem]"
                corners={ORNAMENT_CORNERS.map((corner, index) => (
                  <AncientCorner
                    key={corner}
                    corner={corner}
                    size={44}
                    seed={index * 31 + 7}
                    className={`absolute ${corner === "tl" || corner === "tr" ? "top-4" : "bottom-4"} ${
                      corner === "tl" || corner === "bl" ? "left-4" : "right-4"
                    }`}
                  />
                ))}
              >
                <p className={`${SERIF_FACE} text-lg leading-8`} style={INK_STYLE}>
                  Four cuts of one stylus, mirrored in their coordinates rather than by a transform
                  — so the light stays where it is and the right-hand corners are not lit from the
                  right.
                </p>
              </Parchment>
            </Specimen>
          </Group>

          <Group
            heading="A leaf on a leaf — the Source Wisdom case"
            note="A darker, rough-torn leaf laid on an aged one. Two different noise seeds are what stop the inner sheet reading as a magnified copy of the outer; isolation on each sheet is what stops the inner one's multiply blends darkening the leaf it lies on."
          >
            <Specimen
              label="Parchment inside Parchment"
              detail={`outer: tone="aged" seed={${LEAF_SEEDS[9] ?? 0}} · inner: tone="dark" tear="rough" seed={211}`}
            >
              <Parchment tone="aged" tear="subtle" seed={LEAF_SEEDS[9] ?? 0} className="max-w-[44rem]" corners>
                <div className="flex items-center gap-4">
                  <TrishulEmblem size={30} seed={4} />
                  <h3 className={`${SERIF_FACE} text-2xl`} style={INK_STYLE}>
                    Source Wisdom
                  </h3>
                </div>

                <Parchment tone="dark" tear="rough" seed={211} className="mt-7">
                  <p className={`${DEVANAGARI_FACE} text-xl leading-relaxed`} lang="hi" style={INK_STYLE}>
                    यः पुनरुत्थानं करोति, स एव जीवति ॥
                  </p>
                  <p className={`${SERIF_FACE} pt-5 text-lg leading-8 italic`} style={INK_STYLE}>
                    He who rises again, truly lives.
                  </p>
                  <p className={`${SERIF_FACE} pt-5 text-base`} style={INK_RED_STYLE}>
                    — Dale — Indian Palmistry, 1895 —
                  </p>
                  <div className="pt-6">
                    <LotusDecoration size={110} seed={9} />
                  </div>
                </Parchment>
              </Parchment>
            </Specimen>
          </Group>
        </Section>

        {/* ================================================================ */}
        {/* III. GOLD                                                         */}
        {/* ================================================================ */}
        <Section
          ordinal="III"
          title="Gold"
          seed={37}
          lede={
            <>
              <p>
                Struck metal, not yellow text. A six-stop ramp at 105° — dark bronze, bronze,
                bright, pale, mid, dark bronze — clipped to the glyphs, with a warm near-black lip
                below and a pale hairline above. Read one heading from left to right: if the colour
                is the same at both ends, the metal has been lost.
              </p>
              <p className="pt-4">
                {`The ramp's darkest stop measures ${GOLD_RAMP_DARKEST_CONTRAST_ON_STONE}:1 on stone and its brightest ${GOLD_RAMP_BRIGHTEST_CONTRAST_ON_STONE}:1, which is why nothing below ${GOLD_TEXT_MIN_FONT_SIZE_PX}px may be struck metal: ${GOLD_RAMP_DARKEST_CONTRAST_ON_STONE} is under the ${WCAG_MIN_CONTRAST_BODY}:1 body-text floor. Small gold is flat foil at ${GOLD_FOIL_FLAT_CONTRAST_ON_STONE}:1.`}
              </p>
            </>
          }
        >
          <Group
            heading="The display ladder, over stone"
            note="Every rung, normal and then letterspaced caps. The tracking is the register both references set their titles in."
          >
            <div className="flex flex-col gap-12">
              {GOLD_TEXT_SIZES.map((size: GoldTextSize) => (
                <div key={size} className="flex flex-col gap-8 sm:flex-row sm:items-baseline sm:gap-16">
                  <Specimen label={size} detail={`size="${size}"`}>
                    <GoldText as="p" size={size} className={DISPLAY_FACE}>
                      Hastarekha
                    </GoldText>
                  </Specimen>
                  <Specimen label={`${size} · caps`} detail={`size="${size}" caps`}>
                    <GoldText as="p" size={size} caps className={DISPLAY_FACE}>
                      Hastarekha
                    </GoldText>
                  </Specimen>
                </div>
              ))}
            </div>
          </Group>

          <Group
            heading="Over parchment"
            note="Included because the contract has to be checkable on both grounds, not because gold is the right ink for a leaf — on parchment the reference writes in ink and keeps gold for linework and medallions. What to look for here is the emboss: the dark lip below each glyph is tuned for stone and reads heavier on a light sheet."
          >
            <Parchment tone="aged" tear="subtle" seed={307} className="max-w-[42rem]">
              <GoldText as="p" size="display" className={DISPLAY_FACE}>
                Life Line
              </GoldText>
              <GoldText as="p" size="subtitle" caps className={`${DISPLAY_FACE} pt-4`}>
                Stability · Health · Vitality
              </GoldText>
              <p className={`${SERIF_FACE} pt-6 text-lg leading-8`} style={INK_STYLE}>
                And the same line as manuscript ink, for comparison: Stability, Health, Vitality.
              </p>
            </Parchment>
          </Group>

          <Group
            heading="The size floor, stated in specimens"
            note="Left: the smallest legal struck metal. Right: what a caption must use instead. They are not interchangeable, and the difference is measured rather than felt."
          >
            <Bench>
              <Specimen label="Legal" detail={`<GoldText size="subtitle"> — ${GOLD_TEXT_MIN_FONT_SIZE_PX}px floor`}>
                <GoldText as="p" size="subtitle" className={DISPLAY_FACE}>
                  Ancient Texts
                </GoldText>
              </Specimen>
              <Specimen label="Flat foil" detail={`text-snc-gold-400 — ${GOLD_FOIL_FLAT_CONTRAST_ON_STONE}:1`}>
                <p className={`${SERIF_FACE} text-base text-snc-gold-400`}>
                  ( Cheiro — Palmistry for All, 1916 )
                </p>
              </Specimen>
            </Bench>
          </Group>

          <Group
            heading="The fading rule"
            note="Four rules, and not one of them is a solid bar. Each is brightest at its centre and gone at both ends; the last is the rare one that is a real thematic break rather than an ornament."
          >
            <div className="flex max-w-[42rem] flex-col gap-12">
              <Specimen label="Full width" detail="<GoldRule />">
                <GoldRule />
              </Specimen>
              <Specimen label="Sized, self-centring" detail={'<GoldRule width="14rem" />'}>
                <GoldRule width="14rem" />
              </Specimen>
              <Specimen label="Inset" detail={'<GoldRule inset="8rem" />'}>
                <GoldRule inset="8rem" />
              </Specimen>
              <Specimen label="A real separator" detail="<GoldRule decorative={false} />">
                <GoldRule decorative={false} />
              </Specimen>
            </div>
          </Group>

          <Group
            heading="The gold edge"
            note="border-image from the same ramp, at the secondary rung of the stroke ladder — so a frame varies along its length instead of being a flat rectangle of one gold. A helper rather than a wrapper component, because a frame is a property of a box that already exists."
          >
            <div className={goldBorderClassName("max-w-[42rem] px-8 py-7")}>
              <p className={`${SERIF_FACE} text-lg leading-8 text-snc-parch-edge`}>
                {"className={goldBorderClassName(\"px-8 py-7\")} — follow the frame around its own corner and the metal turns with it."}
              </p>
            </div>
          </Group>
        </Section>

        {/* ================================================================ */}
        {/* IV. WAX                                                           */}
        {/* ================================================================ */}
        <Section
          ordinal="IV"
          title="Wax"
          seed={53}
          lede={
            <>
              <p>
                Eight to twelve lobes at eight percent radial jitter, joined by a closed spline —
                never a circle, and no radius anywhere in the component. Over it: a crown lit from
                the upper left, a warm shadow thrown down and to the right, and an emblem that is
                darker than its surround with a hairline of lit wax on one wall. Pressed in, never
                printed on.
              </p>
            </>
          }
        >
          <Group
            heading="Every die at every size"
            note="Three emblems across, three sizes down, a different seed in every cell. Compare any two cells in a row: the outline must differ, because a seal that repeats is a sticker."
          >
            <div className="flex flex-col gap-14">
              {WAX_SIZES.map((size, sizeIndex) => (
                <Bench key={size}>
                  {WAX_EMBLEMS.map((emblem, emblemIndex) => {
                    const seed = 97 * (sizeIndex + 1) + 13 * (emblemIndex + 1);
                    return (
                      <Specimen
                        key={emblem}
                        label={`${emblem} · ${size}px`}
                        detail={`emblem="${emblem}" size={${size}} seed={${seed}}`}
                      >
                        <WaxSeal size={size} emblem={emblem} seed={seed} label={`HR-${seed}`} />
                      </Specimen>
                    );
                  })}
                </Bench>
              ))}
            </div>
          </Group>

          <Group
            heading="The press"
            note="The system's only motion, and it lasts 200 ms on mount. Strike again to replay it; each strike also advances the seed."
          >
            <WaxPressBench />
          </Group>

          <Group
            heading="What FLOOR takes away"
            note="The press, and only the press. Every layer of material is identical to the seals above — the seal simply arrives already stamped. prefers-reduced-motion removes it a second time, in the stylesheet, for the machine that measured HIGH and belongs to someone who cannot use it."
          >
            <Bench>
              <Specimen label="FLOOR, pressed" detail={'size={140} pressed capability="FLOOR"'}>
                <WaxSeal size={140} emblem="lotus" seed={571} pressed capability="FLOOR" label="HR-FLOOR" />
              </Specimen>
              <Specimen label="Unlabelled — decoration" detail="no label prop: aria-hidden, no title">
                <WaxSeal size={140} emblem="palm" seed={643} />
              </Specimen>
            </Bench>
          </Group>
        </Section>

        {/* ================================================================ */}
        {/* V. ORNAMENT                                                       */}
        {/* ================================================================ */}
        <Section
          ordinal="V"
          title="Ornament"
          seed={71}
          lede={
            <>
              <p>
                Five marks sharing one hairline: 1px, painted from the shared gold ramp,
                non-scaling, round-capped. There is no second weight in the family. Nothing is
                perfectly straight — every rule, stem and spoke carries a sub-pixel seeded waver,
                which is both what makes them read as engraved and what keeps an
                objectBoundingBox gradient from collapsing on a zero-height box.
              </p>
              <p className="pt-4">
                Each mark is shown on stone and then on parchment, because a hairline that reads on
                near-black can vanish on a light sheet and the family has to survive both.
              </p>
            </>
          }
        >
          <Group heading="Ornamental divider" note="Centre diamond, two pips, two tapering rules, tiny diamond terminals. The rules are filled slivers rather than strokes, so they lose weight as well as alpha toward each end.">
            <div className="flex max-w-[42rem] flex-col gap-12">
              {[160, 240, 420].map((width, index) => (
                <Specimen key={width} label={`${width}px`} detail={`width={${width}} seed={${index + 1}}`}>
                  <OrnamentalDivider width={width} seed={index + 1} />
                </Specimen>
              ))}
            </div>
            <Parchment tone="light" tear="subtle" seed={419} className="mt-4 max-w-[42rem]">
              <p className={`${SERIF_FACE} text-lg leading-8`} style={INK_STYLE}>
                The same divider between two blocks of manuscript text, which is where it belongs.
              </p>
              <div className="py-7">
                <OrnamentalDivider width={320} seed={12} />
              </div>
              <p className={`${SERIF_FACE} text-lg leading-8`} style={INK_STYLE}>
                On parchment the gold sits down into the sheet rather than lifting off it.
              </p>
            </Parchment>
          </Group>

          <Group heading="Ancient corner" note="Hairline bracket, inner companion line, curled flourish, diamond at the join. All four corners are the same object seen four ways, mirrored in the coordinates so the light never flips.">
            <Bench>
              {[28, 48, 72].map((size) => (
                <Specimen key={size} label={`tl · ${size}px`} detail={`corner="tl" size={${size}} seed={3}`}>
                  <AncientCorner corner="tl" size={size} seed={3} />
                </Specimen>
              ))}
            </Bench>
            <Bench>
              {ORNAMENT_CORNERS.map((corner, index) => (
                <Specimen key={corner} label={corner} detail={`corner="${corner}" size={56} seed={${index}}`}>
                  <AncientCorner corner={corner} size={56} seed={index} />
                </Specimen>
              ))}
            </Bench>
          </Group>

          <Group heading="Lotus" note="Seven outer petals, three inner, a calyx, a curved stem, two leaves and four sparkles — at 0.55 opacity by default, because in the reference it is a watermark on the leaf rather than an illustration.">
            <Bench>
              {[64, 120, 200].map((size, index) => (
                <Specimen key={size} label={`${size}px`} detail={`size={${size}} seed={${index * 7 + 2}}`}>
                  <LotusDecoration size={size} seed={index * 7 + 2} />
                </Specimen>
              ))}
              <Specimen label="opacity 1" detail="size={120} opacity={1}">
                <LotusDecoration size={120} seed={2} opacity={1} />
              </Specimen>
            </Bench>
            <Parchment tone="aged" tear="subtle" seed={433} className="mt-4 max-w-[36rem]">
              <div className="flex items-center justify-between gap-8">
                <p className={`${SERIF_FACE} text-lg leading-8`} style={INK_STYLE}>
                  Where the reference puts it: tucked into the lower right of a quotation, at its
                  default weight.
                </p>
                <LotusDecoration size={150} seed={2} />
              </div>
            </Parchment>
          </Group>

          <Group
            heading="Celestial ring"
            note={`Rim, bead ring, band, radial spokes, minor ticks, hub — ${CELESTIAL_SECTORS_DEFAULT} sectors and ${CELESTIAL_BEADS_DEFAULT} beads by default, turning at ${CELESTIAL_ROTATION_DEG_PER_SECOND} deg/s, one revolution every ${CELESTIAL_ROTATION_PERIOD_SECONDS} seconds. It is the slowest thing in the product; if you can see it move, something is wrong.`}
          >
            <Bench>
              {[96, 180, 280].map((size, index) => (
                <Specimen key={size} label={`${size}px`} detail={`size={${size}} seed={${index + 1}}`}>
                  <CelestialRing size={size} seed={index + 1} />
                </Specimen>
              ))}
            </Bench>
            <Bench>
              <Specimen label="8 sectors, 24 beads" detail="sectors={8} beads={24}">
                <CelestialRing size={180} seed={6} sectors={8} beads={24} />
              </Specimen>
              <Specimen label="FLOOR — still" detail={'capabilityTier="FLOOR"'}>
                <CelestialRing size={180} seed={6} capabilityTier="FLOOR" />
              </Specimen>
            </Bench>
          </Group>

          <Group heading="Trishul" note="Arc, trident, staff, diamond finial and an embossed ruby — the only element in the family that is not gold, and the one place the emboss filter is used at glyph scale.">
            <Bench>
              {[64, 120, 180].map((size, index) => (
                <Specimen key={size} label={`${size}px`} detail={`size={${size}} seed={${index + 3}}`}>
                  <TrishulEmblem size={size} seed={index + 3} />
                </Specimen>
              ))}
            </Bench>
          </Group>
        </Section>

        {/* ================================================================ */}
        {/* VI. THE MEDALLION                                                 */}
        {/* ================================================================ */}
        <Section
          ordinal="VI"
          title="The Medallion"
          seed={89}
          lede={
            <p>
              A near-black disc lit from the upper left, a 1px gold ring, an engraved glyph, and a
              warm shadow beneath — never a grey one. It is a class in the token layer rather than a
              component, because what it holds differs at every call site. The three provenance rows
              of the reference card are its canonical use.
            </p>
          }
        >
          <Group heading="On stone, at three sizes" note="The ring is the linework gold and the glyph inherits it through currentColor, so a medallion and the rule beside it are the same alloy.">
            <Bench>
              <Specimen label="44px" detail='className="snc-medallion w-11"'>
                <span className="snc-medallion w-11">
                  <TrishulEmblem size={24} seed={1} />
                </span>
              </Specimen>
              <Specimen label="72px" detail='className="snc-medallion w-18"'>
                <span className="snc-medallion w-18">
                  <LotusDecoration size={40} seed={5} opacity={0.9} />
                </span>
              </Specimen>
              <Specimen label="112px" detail='className="snc-medallion w-28"'>
                <span className="snc-medallion w-28">
                  <CelestialRing size={64} seed={8} sectors={8} beads={24} />
                </span>
              </Specimen>
            </Bench>
          </Group>

          <Group heading="The provenance rows, on a leaf" note="Held against docs/reference/ui-reading-lifeline-explainability-card.png this is the passage to check first: the discs must sit ON the parchment, which is what the two-layer warm shadow does, and the shadow must never go grey.">
            <Parchment tone="aged" tear="subtle" seed={487} className="max-w-[40rem]">
              <GoldText as="h3" size="subtitle" className={DISPLAY_FACE}>
                Why Hastrekha says this
              </GoldText>
              <ul className="flex list-none flex-col gap-7 p-0 pt-7">
                {PROVENANCE_ROWS.map((row, index) => (
                  <li key={row.title} className="flex items-center gap-5">
                    <span className="snc-medallion w-14 shrink-0">
                      {index === 0 ? <TrishulEmblem size={28} seed={index + 1} /> : null}
                      {index === 1 ? <CelestialRing size={32} seed={index + 1} sectors={8} beads={24} /> : null}
                      {index === 2 ? <LotusDecoration size={30} seed={index + 1} opacity={0.9} /> : null}
                    </span>
                    <span className="flex min-w-0 flex-col gap-1">
                      <span className={`${SERIF_FACE} text-xl leading-7`} style={INK_STYLE}>
                        {row.title}
                      </span>
                      <span className={`${SERIF_FACE} text-base leading-7`} style={INK_STYLE}>
                        {row.source}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            </Parchment>
          </Group>
        </Section>

        {/* ================================================================ */}
        {/* VII. THE PALETTE                                                  */}
        {/* ================================================================ */}
        <Section
          ordinal="VII"
          title="The Palette"
          seed={101}
          lede={
            <p>
              The fifteen colours the spec names, plus the three ramp stops the material foundation
              added. Every value beside a chip is READ from the live CSSOM rather than typed in — so
              the swatch and its caption can never disagree, and drift shows up as a number that no
              longer matches the spec instead of as two labels arguing.
            </p>
          }
        >
          <TokenSwatchStrip />
        </Section>

        {/* ---------------------------------------------------------------- */}
        {/* COLOPHON                                                          */}
        {/* ---------------------------------------------------------------- */}
        <div className="flex flex-col items-center gap-6 pt-28 text-center">
          <OrnamentalDivider width={340} seed={17} />
          <p className={`${SERIF_FACE} max-w-[34rem] text-lg leading-8 text-snc-parch-edge`}>
            If any of this ever looks rendered rather than photographed, the candlelight reference
            is the correction. Luxury is spacing, material and typography — never more glow.
          </p>
          <WaxSeal size={72} emblem="trishul" seed={733} label="Material bench" />
        </div>
      </div>
    </main>
  );
}
