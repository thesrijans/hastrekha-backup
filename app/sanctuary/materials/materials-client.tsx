"use client";

/**
 * ============================================================================
 * THE TWO PIECES OF THE MATERIAL BENCH THAT CANNOT BE SERVER-RENDERED.
 * ============================================================================
 *
 * WHY THIS FILE IS AS SMALL AS IT IS.
 *
 * Every primitive in components/sanctuary/material is a server component and
 * costs zero client JavaScript, and the bench is built to keep it that way:
 * the page itself has no `"use client"`, and the tone/tear/size/emblem matrices
 * are all rendered statically rather than driven by a control panel. A tier
 * switcher and a props playground were both considered and both rejected —
 * they would have turned an inspection surface into an app, and every specimen
 * they generated would have been one the reviewer had to configure before they
 * could see it. Rendering FLOOR and HIGH side by side says the same thing with
 * no state at all.
 *
 * What is left are exactly two things a server render cannot do.
 *
 *   1. READ THE LIVE VALUE OF A DESIGN TOKEN. `--color-snc-*` is a CSS custom
 *      property; its value exists in the CSSOM at runtime and nowhere in the
 *      module graph. See {@link TokenSwatchStrip} for why printing the value
 *      rather than a hard-coded hex is the entire point of the strip.
 *   2. REPLAY A 200 ms ANIMATION THAT RUNS ON MOUNT. See
 *      {@link WaxPressBench}.
 *
 * NO COLOUR LITERAL APPEARS BELOW. The swatches are painted with
 * `var(--color-snc-<name>)` composed from the token NAME, so this file names
 * fifteen tokens and defines none of them.
 */

import { useState, useSyncExternalStore, type CSSProperties, type ReactElement } from "react";
import { goldBorderClassName } from "@/components/sanctuary/material/gold-text";
import { WaxSeal, type WaxEmblem } from "@/components/sanctuary/material/wax-seal";

/* ========================================================================== */
/* THE TOKEN STRIP                                                            */
/* ========================================================================== */

/**
 * The fifteen colours §3 names, in the order app/sanctuary.css declares them:
 * ground, gold, leaf, light. Names only — a hex here would be a second copy of
 * the token layer and the strip would then be checking itself against itself.
 */
const SANCTUARY_COLOUR_TOKENS: readonly string[] = [
  "stone-900",
  "stone-800",
  "stone-700",
  "obsidian",
  "gold-400",
  "gold-500",
  "gold-600",
  "gold-dust",
  "parchment",
  "parch-edge",
  "ink",
  "ink-red",
  "moon",
  "flame",
  "flame-warm",
];

/**
 * The three stops the material foundation added to compose `--snc-gold-metal`.
 * Kept as a separate row rather than merged into the fifteen, so the strip
 * still answers "are the spec colours intact?" without the answer being
 * diluted by later additions.
 */
const SANCTUARY_RAMP_TOKENS: readonly string[] = [
  "gold-ramp-bronze",
  "gold-ramp-bright",
  "gold-ramp-pale",
];

/** What a swatch shows before the CSSOM has been read. Never blank: an empty cell reads as a missing token rather than as a pending one. */
const UNRESOLVED = "—";

/** Both rows in one list, because the CSSOM is read as a single snapshot; the component slices it back apart. */
const ALL_TOKENS: readonly string[] = [...SANCTUARY_COLOUR_TOKENS, ...SANCTUARY_RAMP_TOKENS];

/** The one line separator used to pack the snapshot. No token value can contain it; a hex, an rgba() and an oklch() are all single-line. */
const SNAPSHOT_SEPARATOR = "\n";

/**
 * Reads the live computed value of one `--color-snc-*` custom property.
 *
 * `document.documentElement` and not the strip's own element: Tailwind's
 * `@theme static` block emits the tokens on `:root`, and resolving them from
 * the root is what makes a value printed here the value every component in the
 * tree is actually painting with — rather than something a local override on
 * this page could have shadowed without anyone noticing.
 */
function readToken(name: string): string {
  const raw = getComputedStyle(document.documentElement).getPropertyValue(`--color-snc-${name}`);
  return raw.trim() === "" ? UNRESOLVED : raw.trim();
}

/**
 * The token layer, modelled as the external store it actually is.
 *
 * WHY `useSyncExternalStore` AND NOT AN EFFECT THAT SETS STATE.
 *
 * Because a CSS custom property is not React state and never becomes React
 * state: it lives in the CSSOM, it is written by a stylesheet, and reading it is
 * a subscription to something outside the tree. The effect-plus-setState version
 * of this reads correctly, renders twice, and is rejected outright by
 * `react-hooks/set-state-in-effect` — the compiler is right, and the hook below
 * is what the rule is pointing at.
 *
 * NO CACHE, DELIBERATELY. `getSnapshot` must be referentially stable between
 * calls or React re-renders forever, which is normally what forces a memo — but
 * this snapshot is a STRING, and two strings with the same characters are
 * already `Object.is`-equal. Recomputing it is a handful of `getComputedStyle`
 * calls on a development bench, and it buys the strip the property that matters
 * most here: it reports what the stylesheet says right now, with no stale copy
 * of the palette anywhere in this file.
 */
function subscribeToTokens(): () => void {
  /* The palette cannot change without a reload, so there is nothing to subscribe to and nothing to
     tear down. React still requires the unsubscribe, and returning a no-op is how a genuinely
     static external store says so. */
  return () => {};
}

/** The live values, packed into one string so the store's snapshot compares by value. */
function tokenSnapshot(): string {
  return ALL_TOKENS.map(readToken).join(SNAPSHOT_SEPARATOR);
}

/** The server has no CSSOM, so it renders placeholders — and so does the client's hydration pass, which is what keeps the two markups identical. */
function serverTokenSnapshot(): string {
  return ALL_TOKENS.map(() => UNRESOLVED).join(SNAPSHOT_SEPARATOR);
}

/** The chip: a square of the token with a hairline of the shared metal around it, so stone-900 on stone-800 is still a visible object. */
function swatchStyle(name: string): CSSProperties {
  return { backgroundColor: `var(--color-snc-${name})` };
}

/** One row of chips plus their names and their live values. */
function SwatchRow({ tokens, values }: { tokens: readonly string[]; values: readonly string[] }): ReactElement {
  return (
    <ul className="grid list-none grid-cols-2 gap-x-6 gap-y-8 p-0 sm:grid-cols-3 lg:grid-cols-5">
      {tokens.map((name, index) => (
        <li key={name} className="flex flex-col gap-2">
          <span aria-hidden="true" className={goldBorderClassName("block h-14 w-full")} style={swatchStyle(name)} />
          <span className="text-[0.68rem] tracking-[0.16em] text-snc-gold-400 uppercase">{name}</span>
          <code className="font-mono text-[0.7rem] text-snc-parch-edge">{values[index] ?? UNRESOLVED}</code>
        </li>
      ))}
    </ul>
  );
}

/**
 * Every sanctuary colour token as a painted chip beside the value the browser
 * actually resolved for it.
 *
 * WHY THE VALUE IS READ AT RUNTIME AND NOT TYPED IN.
 *
 * A strip whose captions were hard-coded hexes would be a *second declaration*
 * of the palette living outside the token layer — the exact thing the material
 * pass forbids — and it would be the copy that rots, because nothing forces the
 * two to agree. Worse, it could not detect the failure it exists to detect: if
 * `--color-snc-parchment` drifted, the chip would move and the caption would
 * not, and a reviewer would have no way to tell which of the two was lying.
 *
 * Reading the CSSOM inverts that. The caption IS the token, so the chip and its
 * value can never disagree, and the reviewer compares one number against the
 * spec instead of two numbers against each other. It also means the strip keeps
 * working the day a token is re-expressed in another colour space, which a
 * table of hexes would silently fail at.
 *
 * WHY THE VALUES ARRIVE THROUGH A STORE AND NOT A RENDER-TIME READ.
 * `getComputedStyle` does not exist on the server, and a value read during the
 * client's first render would differ from the server's markup and cost a
 * hydration mismatch. `useSyncExternalStore` is built for exactly this shape:
 * the server render and the hydration pass both use
 * {@link serverTokenSnapshot} and therefore agree, and React swaps in the real
 * {@link tokenSnapshot} on the pass immediately after.
 */
export function TokenSwatchStrip(): ReactElement {
  const packed = useSyncExternalStore(subscribeToTokens, tokenSnapshot, serverTokenSnapshot);
  const values = packed.split(SNAPSHOT_SEPARATOR);
  const spec = values.slice(0, SANCTUARY_COLOUR_TOKENS.length);
  const ramp = values.slice(SANCTUARY_COLOUR_TOKENS.length);

  return (
    <div className="flex flex-col gap-14">
      <SwatchRow tokens={SANCTUARY_COLOUR_TOKENS} values={spec} />
      <div className="flex flex-col gap-6">
        <p className="max-w-prose text-sm leading-7 text-snc-parch-edge">
          The three stops the material foundation added, out of which
          <code className="mx-1 font-mono text-snc-gold-400">--snc-gold-metal</code>
          is composed. They are the alloy, not the palette.
        </p>
        <SwatchRow tokens={SANCTUARY_RAMP_TOKENS} values={ramp} />
      </div>
    </div>
  );
}

/* ========================================================================== */
/* THE PRESS BENCH                                                            */
/* ========================================================================== */

/**
 * The three dies, stamped together so the press can be compared across emblems
 * rather than judged one at a time. The seeds are far enough apart that the
 * three outlines share no lobe count and no jitter run.
 */
const PRESS_BENCH_DIES: ReadonlyArray<{ readonly emblem: WaxEmblem; readonly seed: number }> = [
  { emblem: "palm", seed: 409 },
  { emblem: "lotus", seed: 811 },
  { emblem: "trishul", seed: 1223 },
];

/**
 * The three seals, stamped on demand.
 *
 * WHY THIS IS THE ONE CONTROL ON THE PAGE. `<WaxSeal pressed>` runs a 200 ms
 * animation ONCE, on mount. On a static page that means the only way to watch
 * the press is to reload the route and catch it — which is not an inspection,
 * it is a reflex test, and it makes the single piece of motion in the material
 * system the one thing nobody can actually review. Bumping a key remounts the
 * three seals and replays it on demand.
 *
 * The remount is the mechanism on purpose: it is exactly what a real caller
 * does when a reading is signed, so what the bench replays is the production
 * code path rather than a bespoke animation added for the demo.
 *
 * FLOOR IS NOT WIRED TO THIS BUTTON. The tier's behaviour is shown next to the
 * bench as its own static specimen, because "press disabled" is a state you
 * compare against a press, not one you toggle into.
 */
export function WaxPressBench(): ReactElement {
  const [stamp, setStamp] = useState(0);

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-wrap items-end gap-x-12 gap-y-8">
        {PRESS_BENCH_DIES.map((die) => (
          <figure key={die.emblem} className="m-0 flex flex-col gap-3">
            <WaxSeal
              /* The key is the whole mechanism: a new key is a new element, and a new element
                 mounts, and a mount is what plays the press. */
              key={`${die.emblem}-${stamp}`}
              size={112}
              emblem={die.emblem}
              seed={die.seed + stamp}
              pressed
              capability="HIGH"
              label="HR-2026-0907"
            />
            <figcaption className="font-mono text-xs leading-6 text-snc-parch-edge">
              emblem=&quot;{die.emblem}&quot; pressed capability=&quot;HIGH&quot;
              <br />
              seed={die.seed + stamp}
            </figcaption>
          </figure>
        ))}
      </div>

      <div>
        <button
          type="button"
          onClick={() => setStamp((previous) => previous + 1)}
          className={goldBorderClassName(
            "cursor-pointer bg-snc-stone-700 px-6 py-3 text-xs tracking-[0.2em] text-snc-gold-400 uppercase",
          )}
        >
          Strike again
        </button>
        <p className="mt-4 max-w-prose text-sm leading-7 text-snc-parch-edge">
          Each strike also advances the seed, so the outline is a different pour of the same wax —
          which is the fastest way to see that no two seals share a lobe count.
        </p>
      </div>
    </div>
  );
}
