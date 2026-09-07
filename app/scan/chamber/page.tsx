import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { ReactElement } from "react";
import { SanctuaryDefs } from "@/components/sanctuary/material";
import { SANCTUARY_FONT_CLASS } from "@/lib/sanctuary/fonts";
import { ChamberClient } from "./chamber-client";

/**
 * ============================================================================
 * /scan/chamber — the scanning ritual, behind the dev gate.
 * ============================================================================
 *
 * THE GATE IS THE ONE app/dev/capture, app/dev/label, /sanctuary/materials AND
 * /read/pothi ALL USE: a hard 404 before the client bundle is even referenced,
 * on any NODE_ENV other than development. THE EXISTING /scan ROUTE IS UNTOUCHED
 * AND STAYS LIVE. This is a second surface over the same hook, not a
 * replacement, and nothing about the live scan changes while it is behind the
 * gate.
 *
 * ══ WHY THIS PAGE IS ALMOST EMPTY ══
 *
 * Every other sanctuary route builds a masthead, a ground and a column of
 * content around its island. This one deliberately does not: §9 says the
 * Chamber is FULL-BLEED CAMERA, so the room is the camera feed and the canvas
 * over it. A masthead here would be chrome floating over somebody's hand.
 *
 * Two things are still the server's, and both for the reasons the pothi's page
 * gives at length:
 *
 *  1. `<SanctuaryDefs />` FIRST and ONCE — the shared `feTurbulence` sprite the
 *     litany's leaf and the gate's leaf both reference by id. Missing, it fails
 *     silently: every leaf renders with square edges, looking like a decision.
 *  2. The font class, which is what makes `var(--font-snc-*)` resolve at all —
 *     including for the CANVAS, which reads its Devanagari family off the
 *     element's own computed style because canvas cannot see a CSS variable.
 *
 * There is NO <SanctuaryGround /> here, and that absence is load-bearing rather
 * than an omission: the ground paints a stone room at `z-index: -1`, and the
 * room in this route is a photograph of the reader's own. Two rooms at once is
 * a texture over a camera feed.
 */
export const metadata: Metadata = {
  title: "Chamber — dev",
  robots: { index: false, follow: false },
};

/** Where the bundle arrives when the reveal beat finishes. */
const READ_HREF = "/read/pothi";

/** Where the back mark returns to. */
const BACK_HREF = "/read";

export default function ChamberPage(): ReactElement {
  if (process.env.NODE_ENV !== "development") notFound();

  return (
    <main className={SANCTUARY_FONT_CLASS}>
      <SanctuaryDefs />
      <ChamberClient readHref={READ_HREF} backHref={BACK_HREF} />
    </main>
  );
}
