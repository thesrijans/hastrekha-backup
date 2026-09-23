/**
 * <HandPlate> — one of the baked hands (lib/sanctuary/hand-plates.ts) as a
 * <picture>: AVIF first, WebP for the browser that cannot, three densities.
 *
 * A server component with no JavaScript, so it can sit in the CSS room, the
 * tradition's plate and the Pothi's leaf without a client boundary; the Rekha
 * Monitor, itself a client component, renders it as ordinary markup. A bare
 * <img>, not next/image, for the reason scene-plate.tsx gives: the files are
 * already sized, encoded and byte-measured by scripts/plates/build-plates.mjs.
 *
 * `alt` defaults to "" — everywhere this is mounted the surface around it
 * already says what it is (the ink layer's label, the figure's caption, the
 * room's own words), and a second announcement of "a hand" is noise.
 */
import type { CSSProperties, ReactElement } from "react";
import { HAND_PLATES, type HandPlateKind } from "@/lib/sanctuary/hand-plates";
import { plateSrcSet } from "@/lib/sanctuary/plate-manifest";

export interface HandPlateProps {
  readonly kind: HandPlateKind;
  readonly className?: string;
  readonly style?: CSSProperties;
  readonly alt?: string;
  /** `eager` for the hand above the fold (the vignette's, the room's); lazy elsewhere. */
  readonly loading?: "eager" | "lazy";
}

export function HandPlate({ kind, className, style, alt = "", loading = "lazy" }: HandPlateProps): ReactElement {
  const manifest = HAND_PLATES[kind];
  const base = manifest.densities[0];
  return (
    <picture className={className} style={style} data-snc-hand-plate={kind}>
      <source type="image/avif" srcSet={plateSrcSet(manifest, "avif")} />
      <source type="image/webp" srcSet={plateSrcSet(manifest, "webp")} />
      <img
        src={base.webp}
        srcSet={plateSrcSet(manifest, "webp")}
        width={base.width}
        height={base.height}
        alt={alt}
        decoding="async"
        draggable={false}
        loading={loading}
        fetchPriority={loading === "eager" ? "high" : undefined}
      />
    </picture>
  );
}
