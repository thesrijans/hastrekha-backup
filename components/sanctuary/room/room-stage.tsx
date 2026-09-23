/**
 * B7 — the room as three CSS/SVG layers: the fallback, and the first paint.
 *
 * THE SAME COMPOSITION AS THE SCENE. Every plate is an SVG of the stage's own
 * 1600 × 900 viewBox, inside a "set" box that covers the hero the way
 * `object-fit: cover` covers an image, so a stage point is the same screen point
 * on every layer, at every width. The 3D room (U3b) reads the same table
 * (lib/sanctuary/room-composition.ts) and fades in over this one when it is
 * ready, so degrading — or never upgrading — changes nothing about the layout.
 *
 *   far   the wall, corridor, window, shelves, drapes; the light pools are its
 *         background, so the one warm source lights the wall behind everything
 *   mid   the floor, props, book and pedestal; the lifted leaf; the zodiac ring
 *         (HTML, so it can turn); the hologram's column, its hand (the P1 mesh,
 *         baked — public/plates/hand-hologram) and its two rings; the candles,
 *         and each candle's pool of light
 *   near  the haze, and three drifts of dust
 *
 * NOTHING MOVES INSIDE A PLATE. Every motion — the leaf, the hand, the rings,
 * the dust, the candles' light — is its own element laid exactly over the
 * plates by `region()`, so a moving thing damages its own small box instead of
 * a 1600 × 900 vector plate. What was measured, precisely: with the motions
 * inside the plates, a headless run under SOFTWARE compositing (SwiftShader)
 * gave 33 ms frames at 1440; the restructured room on the real GPU holds
 * 16.7 ms at p50 and p95. The old structure was never measured on the GPU, so
 * the gain is argued from repaint area, not claimed as a desktop number.
 *
 * TWO FRAMINGS. `room` fills a wide landscape hero with the whole plate and
 * carries B5's overlay and labels. `vignette` is the phone's — Part C's "compact
 * vignette (pedestal + hologram only)" — and it draws exactly that.
 *
 * EVERYTHING THAT MOVES IS OPT-IN BY TIER. The island writes `data-snc-tier` onto
 * the stage once the device has been measured; flicker, dust, drift and the
 * orbiting rings run only at MID and HIGH. Until then, and at LOW and FLOOR, the
 * room is a still engraving. The zodiac ring keeps its own 0.15°/s turn, which
 * its component already stops under reduced motion.
 */
import type { CSSProperties, ReactElement, ReactNode } from "react";
import { HandPlate } from "@/components/sanctuary/hand-plate";
import { CelestialRing } from "@/components/sanctuary/material";
import {
  HOLOGRAM_HAND_REGION,
  ROOM_ANCHORS,
  ROOM_CANDLES,
  ROOM_LAYER_DEPTH,
  ROOM_STAGE,
  roomPercent,
} from "@/lib/sanctuary/room-composition";
import {
  HOLOGRAM_ORBITS,
  HologramColumn,
  LIFTED_PAGE_REGION,
  LiftedPage,
  OrbitRing,
  Pedestal,
  RoomFar,
  RoomMidBack,
  RoomMidFront,
  orbitRegion,
  roomDust,
} from "./room-props";
import styles from "./room-stage.module.css";

const { width: W, height: H } = ROOM_STAGE;
const VIEWBOX = `0 0 ${W} ${H}`;

const percentOf = (value: number, of: number): string => `${((value / of) * 100).toFixed(3)}%`;

/** A rectangle of the stage, as the box and viewBox of an SVG laid exactly over the plates. */
function region(r: { readonly x: number; readonly y: number; readonly w: number; readonly h: number }): {
  readonly style: CSSProperties;
  readonly viewBox: string;
} {
  return {
    style: { left: percentOf(r.x, W), top: percentOf(r.y, H), width: percentOf(r.w, W), height: percentOf(r.h, H) },
    viewBox: `${r.x} ${r.y} ${r.w} ${r.h}`,
  };
}

const HAND = region(HOLOGRAM_HAND_REGION);
const PAGE = region(LIFTED_PAGE_REGION);
const ORBITS = HOLOGRAM_ORBITS.map((orbit) => ({ orbit, ...region(orbitRegion(orbit)) }));
const DUST = roomDust();
const DRIFT_CLASS = [styles.driftA, styles.driftB, styles.driftC] as const;
const DUST_CLASS = [styles.dustA, styles.dustB, styles.dustC] as const;

/** The zodiac ring's box: centred on the pedestal's top face, as wide as it, flattened onto it. */
const RING_POSITION: CSSProperties = { ...roomPercent(ROOM_ANCHORS.pedestal), width: percentOf(460, W) };

/** Each candle's pool of light, centred on its flame and flickering on its own period. */
const CANDLE_GLOWS = ROOM_CANDLES.map((candle) => ({
  id: candle.id,
  style: {
    ...roomPercent({ x: candle.x, y: candle.y - candle.height - 12 }),
    "--snc-flicker-period": `${candle.periodMs}ms`,
  } as CSSProperties,
}));

export interface RoomStageProps {
  readonly id: string;
  readonly variant: "room" | "vignette";
  readonly className?: string;
  /** B5's overlay — HTML in the set, so it stays registered to the room at every width. */
  readonly overlay?: ReactNode;
  /** Object labels, in the mid layer so they move with what they name. */
  readonly labels?: ReactNode;
  /** Things pinned to the hero rather than the room: the profile control, the scroll cue. */
  readonly chrome?: ReactNode;
  /**
   * The 3D room, on the tiers that get one (§6.2 [R7]).
   *
   * It mounts INSIDE the set and over the drawn layers, but under the shade and
   * the overlay, so the vignette still darkens it and B5's words still read
   * against it. Absolutely positioned and `aria-hidden`, so a device that never
   * qualifies loses nothing but the pixels: the layers below it are the same
   * room, already painted, and nothing reflows when the scene arrives or fails
   * to.
   */
  readonly scene?: ReactNode;
}

export function RoomStage({ id, variant, className, overlay, labels, chrome, scene }: RoomStageProps): ReactElement {
  const room = variant === "room";
  const classes = [styles.stageBox, room ? styles.room : styles.vignette, className].filter(Boolean).join(" ");
  return (
    <div id={id} className={classes} data-snc-room={variant}>
      <div className={styles.set} data-snc-room-set="">
        <div className={`${styles.layer} ${styles.far}`} data-snc-depth={ROOM_LAYER_DEPTH.far}>
          {room ? (
            <svg viewBox={VIEWBOX} className={styles.svg} aria-hidden="true" focusable="false">
              <RoomFar />
            </svg>
          ) : null}
        </div>

        <div className={`${styles.layer} ${styles.mid}`} data-snc-depth={ROOM_LAYER_DEPTH.mid}>
          <svg viewBox={VIEWBOX} className={styles.svg} aria-hidden="true" focusable="false">
            {room ? <RoomMidBack /> : <Pedestal />}
          </svg>
          {room ? (
            <svg
              viewBox={PAGE.viewBox}
              style={PAGE.style}
              className={`${styles.part} ${styles.flutter}`}
              data-snc-room-object="book"
              aria-hidden="true"
              focusable="false"
            >
              <LiftedPage />
            </svg>
          ) : null}
          <div className={styles.zodiac} style={RING_POSITION} data-snc-room-object="pedestal" aria-hidden="true">
            <CelestialRing size={460} seed={3} capabilityTier="HIGH" className={styles.zodiacRing} />
          </div>
          <svg viewBox={VIEWBOX} className={styles.svg} aria-hidden="true" focusable="false">
            {room ? <RoomMidFront leaders={labels !== undefined} /> : <HologramColumn />}
          </svg>
          {/* [A2] The hand: the P1 mesh at rest, baked from this scene through this camera
              (public/plates/hand-hologram, M1.1) — no line on it, ever. One element in its own box,
              so it floats without repainting the plates behind it; and the pixels the live scene
              fades in over are the scene's own. */}
          <div style={HAND.style} className={`${styles.part} ${styles.handFloat}`} data-snc-room-object="hologram" aria-hidden="true">
            <HandPlate kind="hologram" className={styles.handPlate} loading="eager" />
          </div>
          {ORBITS.map(({ orbit, style, viewBox }) => (
            <svg
              key={orbit.y}
              viewBox={viewBox}
              style={style}
              className={styles.part}
              data-snc-room-object="hologram"
              aria-hidden="true"
              focusable="false"
            >
              <OrbitRing orbit={orbit} />
            </svg>
          ))}
          {room
            ? CANDLE_GLOWS.map((glow) => (
                <div
                  key={glow.id}
                  className={`${styles.candleGlow} ${styles.flame}`}
                  style={glow.style}
                  data-snc-room-object={glow.id === "book" ? "book" : "pedestal"}
                  aria-hidden="true"
                />
              ))
            : null}
          {labels}
        </div>

        <div className={`${styles.layer} ${styles.near}`} data-snc-depth={ROOM_LAYER_DEPTH.near}>
          <div className={styles.haze} aria-hidden="true" />
          {room
            ? DUST.map((d, at) => (
                <svg
                  key={DRIFT_CLASS[at]}
                  viewBox={VIEWBOX}
                  className={`${styles.svg} ${DRIFT_CLASS[at]}`}
                  data-snc-room-object="dust"
                  aria-hidden="true"
                  focusable="false"
                >
                  <path d={d} className={`${styles.dust} ${DUST_CLASS[at]}`} />
                </svg>
              ))
            : null}
        </div>

        {scene}

        <div className={styles.shade} aria-hidden="true" />
        {overlay}
      </div>
      {room ? <div className={styles.fadeToPage} aria-hidden="true" /> : null}
      {chrome}
    </div>
  );
}
