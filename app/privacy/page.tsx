import type { Metadata } from "next";
import type { ReactElement } from "react";
import { SANCTUARY_FONT_CLASS } from "@/lib/sanctuary/fonts";
import styles from "./privacy.module.css";

export const metadata: Metadata = {
  title: "Privacy — HastRekha",
  description: "Kaunsa data hum rakhte hain aur kaunsa kabhi nahi.",
};

/**
 * Placeholder. The DPDP-compliant text is drafted separately and swapped in before launch.
 *
 * WHY THIS ROUTE CARRIES THE SANCTUARY SKIN AND NO OTHER: it is the proof page for the
 * token layer (there is no settings page in this app). Every word of the copy is the same
 * as before; only the surface changed. /terms is the byte-identical twin and is deliberately
 * left on the holographic palette, so the two routes side by side ARE the before/after.
 *
 * WHY SANCTUARY_FONT_CLASS SITS ON <main> AND NOT IN THE ROOT LAYOUT: next/font emits its
 * preload links for the routes whose module graph reaches the font call. Importing it here
 * means Cinzel and Cormorant are preloaded on /privacy alone — 51.8 KB of new bytes on one
 * route, which is what makes [R1]'s 90 KB ceiling a measurable claim instead of an
 * aspiration, and it leaves every other route shipping exactly what it shipped yesterday
 * (A1). The root layout is untouched.
 */
export default function PrivacyPage(): ReactElement {
  return (
    <main className={`${SANCTUARY_FONT_CLASS} relative isolate w-full flex-1 bg-snc-stone-800`}>
      {/*
        The two depth strata over the stone ground. Decorative and inert: aria-hidden, no
        pointer events, and behind the content via the stacking context `isolate` opens on
        <main>, so the negative z-index cannot escape upward into the header.
      */}
      <div aria-hidden="true" className={`${styles.haze} pointer-events-none absolute inset-0 -z-10`} />
      <div aria-hidden="true" className={`${styles.vignette} pointer-events-none absolute inset-0 -z-10`} />

      <div className="mx-auto w-full max-w-2xl px-4 py-16 sm:px-6">
        <h1 className={`${styles.title} ${styles.riseTitle} text-3xl text-snc-gold-400 sm:text-4xl`}>Privacy Policy</h1>

        {/*
          The page's one piece of linework, drawn as a real stroke so it can carry the
          ladder's own class from app/sanctuary.css rather than a look-alike border:
          1px @ 0.35, solid, gold-500 ("primary gold — all linework"). vector-effect keeps
          it exactly 1 device px after preserveAspectRatio stretches the viewBox to the
          column width, and .snc-stroke-secondary re-asserts stroke-dasharray: none, which
          is what stops any dash pattern in this tree ever reaching it.
        */}
        <svg
          aria-hidden="true"
          viewBox="0 0 100 1"
          preserveAspectRatio="none"
          fill="none"
          className={`${styles.riseTitle} mt-6 block h-px w-full`}
        >
          <line
            className="snc-stroke-secondary"
            x1="0"
            y1="0.5"
            x2="100"
            y2="0.5"
            stroke="var(--color-snc-gold-500)"
            vectorEffect="non-scaling-stroke"
          />
        </svg>

        <div className={`${styles.leaf} ${styles.riseLeaf} mt-10 bg-snc-parchment px-6 py-7 text-snc-ink sm:px-9 sm:py-9`}>
          <p className={`${styles.headNote} text-base text-snc-ink-red`}>Draft — launch se pehle final hoga.</p>
          <ul className={`${styles.leafList} mt-6 flex flex-col text-lg leading-8`}>
            <li>Palm images tumhare device par hi process hote hain — sirf feature scores server par aate hain.</li>
            <li>Hum email, naam aur reading history rakhte hain taaki tum apni readings dobara dekh sako.</li>
            <li>Consent ka record rakha jaata hai, aur tum use kabhi bhi wapas le sakte ho.</li>
          </ul>
        </div>
      </div>
    </main>
  );
}
