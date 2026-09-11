/**
 * The sanctuary's frame — A1: one place that assembles every sanctuary route.
 *
 * Before this, each route mounted the sprite, the ground and the header itself,
 * in an order that was a contract written out three times. The shell writes it
 * once:
 *
 *   1. `<SanctuaryDefs />` FIRST and ONCE. Every torn leaf, seal, ornament and
 *      glyph ring below resolves `url(#snc-…)` against it; a reference to a
 *      filter that does not exist yet renders silently unfiltered, which looks
 *      like a design decision rather than a bug.
 *   2. `<SanctuaryGround />` — the stone the whole route stands on.
 *   3. The rail (wide screens) and the bar (phones). Both are always mounted and
 *      the stylesheet chooses, so the server never has to guess a viewport.
 *   4. The header, when the route wants one — wordmark and Login only, because
 *      the rail and the bar already name the rooms.
 *   5. The route's own content, in a column padded clear of the rail and the bar
 *      by the same custom property those two are sized by.
 *
 * THE FONT CLASS ARRIVES AS A PROP. `SANCTUARY_FONT_CLASS` lives in
 * lib/sanctuary/fonts.ts, which runs `next/font/google` at import — and that
 * throws outside the compiler. The header already refuses the import for this
 * reason; the shell does the same, so it can be rendered in a plain Node test,
 * and the route passes the class it already imports.
 *
 * NOT FOR THE CHAMBER. /scan/chamber is a camera in a dark room: no ground (the
 * room there is the reader's own), no bar over the viewfinder. It keeps its own
 * assembly, and its own test says why.
 *
 * A server component: nothing here has state.
 */
import type { ReactElement, ReactNode } from "react";
import { SanctuaryDefs, SanctuaryGround } from "@/components/sanctuary/material";
import { SanctuaryHeader } from "@/components/sanctuary/sanctuary-header";
import type { SanctuaryRouteHref } from "@/lib/sanctuary/nav";
import { BottomNav } from "./bottom-nav";
import { NavRail } from "./nav-rail";
import styles from "./sanctuary-shell.module.css";

export interface SanctuaryShellProps {
  /** The room this route is — lights it in the rail and the bar. */
  readonly activeHref: SanctuaryRouteHref | null;
  /** Seeds the ground's scratches, so each route's stone is its own and stable across renders. */
  readonly groundSeed: number;
  /** The route's `SANCTUARY_FONT_CLASS`, plus any layout classes for the outer box. */
  readonly className: string;
  /** Mount the wordmark-and-Login header above the content. Home draws its own masthead instead. */
  readonly header?: boolean;
  readonly children: ReactNode;
}

export function SanctuaryShell({
  activeHref,
  groundSeed,
  className,
  header = true,
  children,
}: SanctuaryShellProps): ReactElement {
  return (
    <main className={`${className} ${styles.shell}`}>
      <SanctuaryDefs />
      <SanctuaryGround seed={groundSeed} capability="HIGH" />
      <NavRail activeHref={activeHref} />
      <div className={styles.column}>
        {header ? <SanctuaryHeader links={false} /> : null}
        {children}
      </div>
      <BottomNav activeHref={activeHref} />
    </main>
  );
}
