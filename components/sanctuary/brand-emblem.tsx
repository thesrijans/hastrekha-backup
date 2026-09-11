/**
 * The brand mark — the Bhrigu Bodh emblem, at the four sizes the product uses.
 *
 * NOT A NEW DRAWING. `<TrishulEmblem>` in the material family already is the
 * mark from brand-bhrigu-bodh-logo-concept.png rebuilt as original vector —
 * staff, trident splay, the ring, the diamond finial and the stone at the join.
 * This component is the brand's use of it, and it adds only what the brand asks
 * for and the ornament does not: the ruby cabochon in place of the flat ink-red
 * bezel (A2: "the only saturated red outside wax"), and the struck beads outside
 * the ring. Both are opt-in props on the ornament, so every existing caller still
 * renders the flat mark it always did.
 *
 * FOUR SIZES, AND ONLY FOUR. 24 for the rail's smallest use, 40 in the bottom
 * bar and beside a wordmark, 64 over a masthead, 120 on the Threshold. A closed
 * set because the mark was checked at these sizes: the beads are dropped at 24,
 * where they blur into a halo, and nowhere else.
 *
 * Decorative. The control or heading beside it carries the name.
 */
import type { ReactElement } from "react";
import { TrishulEmblem } from "@/components/sanctuary/material";

export const BRAND_EMBLEM_SIZES = [24, 40, 64, 120] as const;
export type BrandEmblemSize = (typeof BRAND_EMBLEM_SIZES)[number];

/** One fixed waver, so the mark on the rail and the mark on the Threshold are the same mark. */
export const BRAND_EMBLEM_SEED = 0;

/** Below this size the beads are omitted. */
export const BRAND_EMBLEM_BEADS_MIN_SIZE = 40;

export interface BrandEmblemProps {
  readonly size: BrandEmblemSize;
  readonly className?: string;
}

export function BrandEmblem({ size, className }: BrandEmblemProps): ReactElement {
  return (
    <TrishulEmblem
      size={size}
      seed={BRAND_EMBLEM_SEED}
      cabochon
      beads={size >= BRAND_EMBLEM_BEADS_MIN_SIZE}
      className={className}
    />
  );
}
