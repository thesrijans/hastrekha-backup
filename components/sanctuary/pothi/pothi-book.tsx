"use client";

/**
 * ============================================================================
 * <PothiBook> — the fifteen leaves, bound, and the one gesture that turns them.
 * ============================================================================
 *
 * WHAT THIS COMPONENT OWNS, AND WHAT IT DELIBERATELY DOES NOT.
 *
 * It owns the BINDING: which leaf is face-up, how a leaf gets from face-up to
 * face-down, and which of the two turn mechanics this device has earned. It
 * owns no policy about what a leaf may say. Every chapter's content-or-seal
 * decision comes from {@link resolvePothi} — one call, fifteen answers — and
 * this file contains no second copy of that logic, not even a shortcut for the
 * three chapters that are sealed at launch. A book that decided for itself that
 * chapter VII was sealed would keep saying so on the day mounts became
 * measurable, and nothing would fail.
 *
 * ══ THE TWO TURN MODES, AND WHY THE DEGRADE LATCHES ══
 *
 * `fold` is the real thing: `transform-style: preserve-3d`, a per-leaf
 * `rotateY` about the leaf's spine, a back face carrying the verso, and a
 * shadow gradient that tracks the fold. `crossfade` is one opacity
 * interpolation. {@link pothiTurnMode} chooses between them from two inputs and
 * nothing else — the measured {@link CapabilityTier}, and one latched boolean.
 *
 * The latch is the part worth defending. A rAF sampler
 * ({@link probeFrameMs}, reused rather than re-written — it already takes the
 * median of nine idle deltas so one GC pause cannot decide the session) runs
 * once per mount; if the median frame costs more than
 * {@link POTHI_TURN_MAX_FRAME_MS} the book drops to `crossfade` and STAYS
 * there. It can never climb back. A book that re-measured after each turn would
 * oscillate exactly where it hurts most — a device sitting on the threshold
 * would fold, stutter, fade, recover, fold again — and a reader would
 * experience that as the page turn being broken rather than as the page turn
 * being careful.
 *
 * `prefers-reduced-motion` is honoured twice, on purpose. Once through the
 * prop, because `useCapabilityTier()` already resolves a reduced-motion request
 * to FLOOR; and once in the stylesheet, unconditionally, because the tier is
 * measured at mount while the preference is a live query the reader can flip
 * without this tree re-rendering. The stylesheet's copy is the one that cannot
 * be bypassed by a caller passing a tier by hand.
 *
 * ══ ONE LEAF IN FLIGHT ══
 *
 * `inFlightRef` gates every entry point — button, click, key, swipe. Two leaves
 * mid-rotation is not a faster book; it is two sheets of the same manuscript
 * occupying the same air, and on a LOW device it is also two composited layers
 * nobody asked for. The gate opens again on a timer matched to the CSS
 * duration, so the two can never disagree about how long a turn takes: both
 * read {@link POTHI_TURN_DURATION_MS}, which the stylesheet receives as a
 * custom property rather than duplicating.
 *
 * ══ DRAG AND SWIPE ARE ONE MECHANISM, STATED RATHER THAN DOUBLED ══
 *
 * Pointer events, not a mouse path plus a touch path. `onPointerDown` /
 * `Move` / `Up` cover a mouse drag, a stylus and a finger swipe with one set of
 * handlers, and `touch-action: pan-y` in the stylesheet is what actually lets a
 * horizontal finger drag reach us while a vertical one still scrolls the leaf.
 * The pointer is captured only AFTER the gesture proves itself horizontal (see
 * {@link DRAG_ENGAGE_PX}) — capturing on `pointerdown` would swallow the
 * vertical scroll of a leaf that is taller than the stage, which is most of
 * them.
 *
 * ══ WHY "use client" ══
 *
 * State (which leaf, mid-drag angle), effects (the sampler, the flight timer)
 * and handlers (four pointer, one key, one click, two buttons). All three of
 * the things the rule asks about are genuinely here. The consequence is stated
 * rather than hidden: every component this file imports — <LeafPage>,
 * <SealedLeaf>, <PalmPlate> and the material primitives under them — is server
 * markup by nature but is pulled into the client bundle by this import, because
 * a client component's subtree is client code. That is the price of a book that
 * turns, and it is why nothing else was added to it.
 *
 * ══ WHAT THE ROUTE MUST PROVIDE ══
 *
 * `<SanctuaryDefs />`, mounted once, before this. Every leaf, every seal, every
 * ornament and the plate's neutral palm reference the shared filter sprite by
 * id, and a `url(#…)` that resolves to nothing renders unfiltered and silent.
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactElement,
} from "react";
import type { ReadingResponse } from "@/app/read/reading-types";
import { OrnamentalDivider, Parchment } from "@/components/sanctuary/material";
import {
  probeFrameMs,
  type CapabilityTier,
  type RafScheduler,
} from "@/components/sanctuary/use-capability-tier";
import {
  POTHI_CHAPTERS,
  resolvePothi,
  type ChapterState,
  type PothiChapter,
  type SealReason,
} from "@/lib/sanctuary/pothi-chapters";
import {
  POTHI_PLATE_LINE_IDS,
  toChapterGeometry,
  type PothiPlateLineId,
  type PothiSessionGeometry,
} from "@/lib/sanctuary/pothi-geometry";
import { chapterSeed, devanagariNumber, LeafPage } from "./leaf-page";
import { PalmPlate } from "./palm-plate";
import { SealedLeaf } from "./sealed-leaf";
import styles from "./pothi-book.module.css";

/* ============================== THE TWO MODES ============================= */

/** How a leaf gets from face-up to face-down. There is no third. */
export type PothiTurnMode = "fold" | "crossfade";

/**
 * The frame rate below which the fold is withdrawn.
 *
 * 55 and not 60: a 60 Hz panel that is genuinely keeping up still logs the odd
 * 17.5 ms frame, and a threshold set at the refresh rate itself would demote
 * every device that ever hiccuped. 55 fps is the slowest a rotating, shadowed,
 * filtered sheet still reads as one continuous motion rather than as a sequence
 * of positions.
 */
export const POTHI_TURN_MIN_FPS = 55;

/** The same threshold as the sampler reports it: milliseconds per frame. */
export const POTHI_TURN_MAX_FRAME_MS = 1000 / POTHI_TURN_MIN_FPS;

/**
 * How long a turn takes, per mode, in milliseconds.
 *
 * Read by BOTH the flight gate below and the stylesheet (as
 * `--snc-turn-duration`), from this one table, because a CSS transition that
 * outlives its gate lets a second leaf start turning through the first.
 *
 * The fold is slow on purpose. A page turn is the one moment this product asks
 * the reader to feel the material, and 720 ms is roughly what a real sheet of
 * palm leaf takes to fall. The crossfade is 240 ms because a fade that lingers
 * reads as a slow app rather than as a heavy page — it is a different gesture,
 * not a cheaper copy of the same one.
 */
export const POTHI_TURN_DURATION_MS: Readonly<Record<PothiTurnMode, number>> = {
  fold: 720,
  crossfade: 240,
};

/**
 * Which mechanic this render uses. Pure, so the policy is testable without a
 * device.
 *
 * @param capabilityTier [R6] the measured rendering budget, spelled in full
 * @param degraded the latched result of the frame sampler; only ever true
 */
export function pothiTurnMode(capabilityTier: CapabilityTier, degraded: boolean): PothiTurnMode {
  return capabilityTier === "FLOOR" || degraded ? "crossfade" : "fold";
}

/* =============================== GEOMETRY ================================= */

/** A half-turn, in degrees. The only rotation this book performs. */
const HALF_TURN_DEG = 180;

/**
 * How far a drag must carry before it commits to a turn, as a fraction of the
 * stage's width.
 *
 * A quarter. Lower and a reader who merely brushed the page loses their place;
 * higher and the gesture feels like it is resisting them. The leaf springs back
 * from anything short of this, which is the honest feedback: the book did not
 * decide anything you did not.
 */
export const POTHI_TURN_COMMIT_FRACTION = 0.25;

/**
 * Horizontal travel, in CSS pixels, before a pointer gesture is treated as a
 * page turn at all.
 *
 * Below this the gesture still belongs to the leaf — which scrolls, because a
 * chapter is usually taller than the stage. Capturing the pointer on
 * `pointerdown` instead would make every attempt to scroll a leaf turn it.
 */
const DRAG_ENGAGE_PX = 12;

/** Where on the stage a plain click means "forward" or "back", as a fraction of its width. */
const CLICK_EDGE_FRACTION = 0.3;

/** Elements a click or a drag must never be stolen from — every control a leaf can carry. */
const INTERACTIVE_SELECTOR = "a, button, input, select, textarea, summary, [contenteditable]";

/* ================================ THE COPY ================================ */

/**
 * The seal on a book with no reading behind it.
 *
 * NOT in `SEAL_CODES`, and the exclusion is the same one <LeafPage> makes for
 * its Source Wisdom panel: that table holds seals the DATA layer derives from a
 * response, and this one is a fact about a tab that has no response at all.
 * Exported so the route, a test and an analytics label read one string.
 */
export const POTHI_NO_READING_SEAL_CODE = "reading_not_made";

/**
 * Why an empty Pothi is empty, as a real {@link SealReason}.
 *
 * Derived from nothing, because there is nothing to derive from — which is
 * precisely the condition it describes, and the one case where a fixed detail
 * is honest. It follows the launch seals' method: it states a fact about the
 * PIPELINE (no reading in this tab, no endpoint to fetch one from) rather than
 * a fact about a reader's hand, and it carries a `capture` because a scan
 * genuinely is what fills this gap — so <SealedLeaf> renders the /scan link and
 * the invitation is true.
 */
const NO_READING_REASON: SealReason = {
  code: POTHI_NO_READING_SEAL_CODE,
  hi: "Is tab mein abhi koi paath bana hi nahi.",
  detail:
    "Pothi apna paath us scan se uthati hai jo isi tab mein chala tha — reading kabhi server par " +
    "id se maangi nahi ja sakti, kyunki backend mein use wapas dene wala koi GET endpoint hai hi " +
    "nahi. Isliye yahan dikhane ko na koi rekha hai, na koi rule, na koi kshetra.",
  capture: "Pehle scan chalaayein — paath bante hi yeh pothi apne aap khul jaayegi.",
};

/**
 * The word before the numerals on a folio.
 *
 * A mirror of <LeafPage>'s own `PAGE_NUMBER_WORD`, which is private to that
 * module. Mirrored rather than imported deliberately: exporting it would make a
 * private layout detail of one component into a contract two components have to
 * keep. `test/pothi-book.test.ts` reads leaf-page.tsx and asserts the two
 * strings still agree, so a divergence fails the suite instead of printing two
 * different folio formats in one book.
 */
const FOLIO_WORD = "पृष्ठ";

/** The book's own accessible name, and the roledescription that says what kind of thing it is. */
const BOOK_LABEL = "Pothi — pandrah adhyaay";
const BOOK_ROLEDESCRIPTION = "pothi";

const PREV_LABEL = "Pichhla patta";
const NEXT_LABEL = "Agla patta";

/* ============================== SMALL PIECES ============================== */

/** Icon geometry lives in a 24-unit box — the size the sanctuary's marks are drawn at. */
const ACTION_ICON_VIEWBOX = 24;

/** One weight for every line icon in the sanctuary; `non-scaling-stroke` keeps it one CSS pixel. */
const HAIRLINE_STROKE = 1;

/** A chevron, mirrored by the stylesheet for the forward control so one path serves both. */
const CHEVRON_PATH = "M 14.6 4.8 L 7.4 12 L 14.6 19.2";

/** How far the verso's seed is moved off its recto's, so one sheet does not tear twice the same way. */
const VERSO_SEED_OFFSET = 313;

/** The verso's rule, narrower than the leaf's own so the two do not rhyme. */
const VERSO_DIVIDER_WIDTH = 180;

/**
 * The folio, in the format <LeafPage> already inks it in.
 *
 * Both the total and the numeral come from chapter data — `POTHI_CHAPTERS.length`
 * rather than a typed "१५", so a sixteenth chapter cannot leave every leaf
 * claiming to be one of fifteen with nothing failing.
 */
export function pothiFolio(chapter: PothiChapter): string {
  return `${FOLIO_WORD} ${chapter.devanagariNumeral} / ${devanagariNumber(POTHI_CHAPTERS.length)}`;
}

/** Where a leaf is in the stack. Drives visibility, depth and rotation, all from one word. */
type LeafPosition = "back" | "turned" | "current" | "next" | "ahead";

/** The leaf's position relative to the one being read. */
function leafPosition(index: number, current: number): LeafPosition {
  if (index === current) return "current";
  if (index === current - 1) return "turned";
  if (index === current + 1) return "next";
  return index < current ? "back" : "ahead";
}

/**
 * Paint order.
 *
 * Two piles, not one ramp: the leaves still to be read stack downward from the
 * current one (so the current leaf is the top of the right-hand pile), and the
 * leaves already turned stack upward (so the most recently turned is the top of
 * the left-hand pile). The leaf in flight is lifted above both, because for
 * three quarters of a second it belongs to neither.
 */
function leafDepth(index: number, current: number, inFlight: boolean): number {
  const total = POTHI_CHAPTERS.length;
  if (inFlight) return total * 3;
  return index < current ? index + 1 : total * 2 - index;
}

/**
 * The angle a leaf is held at, in degrees, drag included.
 *
 * Zero is face-up on the right; -180 is face-down on the left. A drag moves
 * exactly one leaf: dragging left turns the CURRENT leaf away, dragging right
 * brings the PREVIOUS leaf back — which is what a reader's hand is doing in
 * each case, and why the two are not the same leaf.
 *
 * @param drag pointer travel as a signed fraction of the stage, or null
 */
function leafAngleDeg(index: number, current: number, drag: number | null): number {
  const settled = index < current ? -HALF_TURN_DEG : 0;
  if (drag === null) return settled;
  if (drag < 0 && index === current) return drag * HALF_TURN_DEG;
  if (drag > 0 && index === current - 1) return -HALF_TURN_DEG + drag * HALF_TURN_DEG;
  return settled;
}

/**
 * How dark the fold is, 0 to 1.
 *
 * Peaks when the sheet is edge-on and vanishes at both rests, which is what a
 * real leaf's shadow does: the crease is darkest where the sheet is closest to
 * perpendicular to the light. Computed here rather than in CSS because `abs()`
 * is not yet safe to rely on in a stylesheet, and because during a drag this
 * number has to track the pointer frame by frame.
 */
function foldShadow(angleDeg: number): number {
  const turned = Math.min(Math.abs(angleDeg) / HALF_TURN_DEG, 1);
  return 1 - Math.abs(turned - 0.5) * 2;
}

/** The custom properties a leaf is positioned with. Numbers and angles only — never a colour. */
interface PothiLeafStyle extends CSSProperties {
  "--snc-leaf-turn"?: string;
  "--snc-leaf-shadow"?: string;
}

/** The custom property the stage hands the stylesheet so one duration governs both sides. */
interface PothiStageStyle extends CSSProperties {
  "--snc-turn-duration"?: string;
}

/** Joins class names, dropping the absent ones. */
function cx(...names: readonly (string | undefined)[]): string {
  return names.filter((name): name is string => name !== undefined && name.length > 0).join(" ");
}

/** The four creases a plate can draw, narrowed from the six a chapter can be about. */
function plateLineId(chapter: PothiChapter): PothiPlateLineId | null {
  const lineId = chapter.lineId;
  if (lineId === undefined) return null;
  return (POTHI_PLATE_LINE_IDS as readonly string[]).includes(lineId) ? (lineId as PothiPlateLineId) : null;
}

/* ================================ THE VERSO =============================== */

/**
 * The back of a leaf.
 *
 * It carries the chapter's own numeral, its Devanagari name and a rule —
 * chapter DATA, every character of it — and no reading. That restraint is the
 * whole design: a verso is what you see for the half-second a sheet is passing
 * your eye, and filling it with a summary of the chapter you just read would
 * mean writing a sentence nobody's response produced.
 */
function LeafVerso({ chapter, seed }: { readonly chapter: PothiChapter; readonly seed: number }): ReactElement {
  return (
    <Parchment tone="aged" tear="subtle" seed={seed + VERSO_SEED_OFFSET} className={styles.versoLeaf}>
      <div className={styles.versoBody}>
        <span className={cx(styles.versoNumeral, "snc-gold-text")} lang="hi">
          {chapter.devanagariNumeral}
        </span>
        <OrnamentalDivider width={VERSO_DIVIDER_WIDTH} seed={seed + VERSO_SEED_OFFSET} />
        <span className={styles.versoTitle} lang="hi">
          {chapter.titleHi}
        </span>
      </div>
    </Parchment>
  );
}

/* ================================= PROPS ================================== */

export interface PothiBookProps {
  /**
   * The response this tab is holding, or null.
   *
   * NULL IS AN ORDINARY VALUE. A tab that never ran a scan, a tab reopened from
   * history, a browser that refused session storage: all three land here, and
   * all three get the sealed bundle rather than a book of empty leaves.
   */
  readonly reading: ReadingResponse | null;
  /**
   * The scan session's geometry hand-off, or null.
   *
   * Taken in the SESSION shape (`space`, an optional crop) rather than the
   * resolver's shape, because the book needs both: {@link toChapterGeometry}
   * converts it for `resolvePothi`, and <PalmPlate> reads the original. A
   * caller that had to convert it itself would be the caller most likely to get
   * `space` versus `size` wrong.
   */
  readonly geometry?: PothiSessionGeometry | null;
  /**
   * [R6] The device's measured rendering budget, spelled in full and never as a
   * bare `tier` — `ReadingTier` (free | premium | deep) already means something
   * else and the Pothi renders both at once.
   *
   * FLOOR selects the crossfade outright; every other tier folds unless the
   * frame sampler says otherwise.
   */
  readonly capabilityTier: CapabilityTier;
  /** Stamped into each leaf's wax. Without it the seal is decoration rather than a mark. */
  readonly sessionId?: string;
  /** Where a leaf's back arrow goes. Omitted ⇒ no arrow is drawn, because a dead control is worse than none. */
  readonly backHref?: string;
  /** Classes for the book's outer box. The stylesheet is in @layer components, so a utility still wins. */
  readonly className?: string;
}

/* ================================ THE BOOK ================================ */

/**
 * Fifteen leaves, one of them face-up.
 *
 * @returns the bound book, or — with no reading in the tab — one sealed leaf
 * saying so and pointing at /scan.
 */
export function PothiBook({
  reading,
  geometry = null,
  capabilityTier,
  sessionId,
  backHref,
  className,
}: PothiBookProps): ReactElement {
  const [index, setIndex] = useState(0);
  const [drag, setDrag] = useState<number | null>(null);
  const [flightLeaf, setFlightLeaf] = useState<number | null>(null);
  const [degraded, setDegraded] = useState(false);

  const indexRef = useRef(0);
  const inFlightRef = useRef(false);
  const flightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sampledRef = useRef(false);
  const gestureRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    width: number;
    engaged: boolean;
  } | null>(null);
  const suppressClickRef = useRef(false);

  const mode = pothiTurnMode(capabilityTier, degraded);
  const durationMs = POTHI_TURN_DURATION_MS[mode];

  /* ------------------------------ resolution ----------------------------- */

  const chapterGeometry = useMemo(
    () => (geometry === null ? null : toChapterGeometry(geometry)),
    [geometry],
  );
  const states: readonly ChapterState[] = useMemo(
    () => (reading === null ? [] : resolvePothi(reading, chapterGeometry)),
    [reading, chapterGeometry],
  );

  /* --------------------------- the frame sampler ------------------------- */

  /*
   * Runs once per mount, and only while there is still something to withdraw:
   * a book already crossfading has nothing to learn from the measurement, and
   * spending nine frames of a FLOOR device's budget to confirm it is a FLOOR
   * device would be the joke telling itself.
   */
  useEffect(() => {
    if (mode === "crossfade") return;
    if (sampledRef.current) return;
    sampledRef.current = true;

    let alive = true;
    let handle: number | null = null;
    const scheduler: RafScheduler = (callback) => {
      const next = window.requestAnimationFrame(callback);
      handle = next;
      return next;
    };

    void probeFrameMs(scheduler, () => performance.now()).then((frameMs) => {
      if (!alive) return;
      /* One direction only. `setDegraded(false)` appears nowhere in this file. */
      if (frameMs > POTHI_TURN_MAX_FRAME_MS) setDegraded(true);
    });

    return () => {
      alive = false;
      if (handle !== null) {
        window.cancelAnimationFrame(handle);
        /* That chain is dead, so React 19's StrictMode re-run may start a fresh one. */
        sampledRef.current = false;
      }
    };
  }, [mode]);

  useEffect(
    () => () => {
      if (flightTimerRef.current !== null) clearTimeout(flightTimerRef.current);
    },
    [],
  );

  /* ------------------------------- turning ------------------------------- */

  const goTo = useCallback(
    (next: number): void => {
      if (inFlightRef.current) return;
      const last = POTHI_CHAPTERS.length - 1;
      const clamped = next < 0 ? 0 : next > last ? last : next;
      const from = indexRef.current;
      if (clamped === from) {
        setDrag(null);
        return;
      }

      indexRef.current = clamped;
      inFlightRef.current = true;
      /* The sheet actually rotating is the one between the two positions: going
         forward it is the leaf you are leaving, going back it is the one
         returning. Naming it lets the stylesheet animate the fold's shadow
         through its peak, which a transition between two rest states cannot. */
      setFlightLeaf(clamped > from ? from : clamped);
      setIndex(clamped);
      setDrag(null);

      if (flightTimerRef.current !== null) clearTimeout(flightTimerRef.current);
      flightTimerRef.current = setTimeout(() => {
        flightTimerRef.current = null;
        inFlightRef.current = false;
        setFlightLeaf(null);
      }, durationMs);
    },
    [durationMs],
  );

  const goNext = useCallback((): void => goTo(indexRef.current + 1), [goTo]);
  const goPrev = useCallback((): void => goTo(indexRef.current - 1), [goTo]);

  /* ------------------------------ the pointer ---------------------------- */

  const handlePointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>): void => {
    if (inFlightRef.current) return;
    /* Secondary buttons belong to the context menu, not to the book. */
    if (event.button !== 0 && event.pointerType === "mouse") return;
    const target = event.target;
    if (target instanceof Element && target.closest(INTERACTIVE_SELECTOR) !== null) return;

    const width = event.currentTarget.getBoundingClientRect().width;
    gestureRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      width: width > 0 ? width : 1,
      engaged: false,
    };
  }, []);

  const handlePointerMove = useCallback((event: ReactPointerEvent<HTMLDivElement>): void => {
    const gesture = gestureRef.current;
    if (gesture === null || gesture.pointerId !== event.pointerId) return;

    const dx = event.clientX - gesture.startX;
    const dy = event.clientY - gesture.startY;

    if (!gesture.engaged) {
      /* A gesture that is mostly vertical is the reader scrolling a leaf that
         is taller than the stage. It never becomes a page turn, however far it
         eventually travels sideways. */
      if (Math.abs(dx) < DRAG_ENGAGE_PX || Math.abs(dx) <= Math.abs(dy)) return;
      gesture.engaged = true;
      event.currentTarget.setPointerCapture(event.pointerId);
    }

    const fraction = Math.max(-1, Math.min(1, dx / gesture.width));
    setDrag(fraction);
  }, []);

  const endGesture = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>, commit: boolean): void => {
      const gesture = gestureRef.current;
      if (gesture === null || gesture.pointerId !== event.pointerId) return;
      gestureRef.current = null;

      if (!gesture.engaged) return;
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      /* The pointerup that ends a drag also fires a click. Without this the
         release would turn the leaf twice. */
      suppressClickRef.current = true;

      const fraction = Math.max(-1, Math.min(1, (event.clientX - gesture.startX) / gesture.width));
      if (commit && fraction <= -POTHI_TURN_COMMIT_FRACTION) goNext();
      else if (commit && fraction >= POTHI_TURN_COMMIT_FRACTION) goPrev();
      else setDrag(null);
    },
    [goNext, goPrev],
  );

  const handlePointerUp = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>): void => endGesture(event, true),
    [endGesture],
  );

  const handlePointerCancel = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>): void => endGesture(event, false),
    [endGesture],
  );

  /* ------------------------------- the click ----------------------------- */

  const handleClick = useCallback((event: ReactMouseEvent<HTMLDivElement>): void => {
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      return;
    }
    const target = event.target;
    if (target instanceof Element && target.closest(INTERACTIVE_SELECTOR) !== null) return;

    const box = event.currentTarget.getBoundingClientRect();
    if (box.width <= 0) return;
    const fraction = (event.clientX - box.left) / box.width;
    /* The middle of the page does nothing, so selecting a sentence or
       double-tapping a word never costs the reader their place. */
    if (fraction >= 1 - CLICK_EDGE_FRACTION) goNext();
    else if (fraction <= CLICK_EDGE_FRACTION) goPrev();
  }, [goNext, goPrev]);

  /* ------------------------------ the keyboard --------------------------- */

  const handleKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>): void => {
      const target = event.target;
      if (target instanceof Element && target.closest(INTERACTIVE_SELECTOR) !== null) return;

      switch (event.key) {
        case "ArrowRight":
        case "PageDown":
          event.preventDefault();
          goNext();
          return;
        case "ArrowLeft":
        case "PageUp":
          event.preventDefault();
          goPrev();
          return;
        case "Home":
          event.preventDefault();
          goTo(0);
          return;
        case "End":
          event.preventDefault();
          goTo(POTHI_CHAPTERS.length - 1);
          return;
        default:
      }
    },
    [goNext, goPrev, goTo],
  );

  /* ------------------------------ the empty book ------------------------- */

  /*
   * No response, so no leaves — not fifteen sealed ones. Fifteen seals would be
   * fifteen different explanations of one fact, and a reader would read the
   * first, learn nothing new from the next fourteen, and be left with the
   * impression that their reading was mostly failures. One closed bundle says
   * the true thing once.
   */
  if (reading === null) {
    return (
      <div
        className={cx(styles.book, styles.emptyBook, className)}
        data-snc-book="empty"
        data-snc-turn-mode={mode}
        data-snc-capability={capabilityTier}
      >
        {/* The emblem is <SealedLeaf>'s own default lotus and is deliberately
            not overridden: the open palm is this product's mark for a hand that
            was READ, and pressing it on a bundle that holds no reading would put
            our sign on an absence. */}
        <SealedLeaf reason={NO_READING_REASON} seed={0} capability={capabilityTier} className={styles.emptyLeaf} />
      </div>
    );
  }

  const current = POTHI_CHAPTERS[index];
  const stageStyle: PothiStageStyle = { "--snc-turn-duration": `${durationMs}ms` };

  return (
    <div
      className={cx(styles.book, mode === "fold" ? styles.fold : styles.crossfade, className)}
      data-snc-book="open"
      data-snc-turn-mode={mode}
      data-snc-capability={capabilityTier}
      /* A group rather than a listbox or a tablist: those roles promise a
         selection model this is not. `tabIndex` is what makes the arrow keys
         reachable at all without a mouse. */
      role="group"
      aria-roledescription={BOOK_ROLEDESCRIPTION}
      aria-label={BOOK_LABEL}
      tabIndex={0}
      onKeyDown={handleKeyDown}
    >
      <div
        className={styles.stage}
        style={stageStyle}
        data-snc-dragging={drag === null ? undefined : "true"}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
        onClick={handleClick}
      >
        {POTHI_CHAPTERS.map((chapter, position) => {
          const state = states[position];
          const seed = chapterSeed(chapter);
          const where = leafPosition(position, index);
          const inFlight = flightLeaf === position;
          const angle = leafAngleDeg(position, index, drag);
          const plateId = plateLineId(chapter);
          const leafStyle: PothiLeafStyle = {
            "--snc-leaf-turn": `${angle}deg`,
            "--snc-leaf-shadow": foldShadow(angle).toFixed(3),
            zIndex: leafDepth(position, index, inFlight),
          };

          return (
            <div
              key={chapter.numeral}
              className={styles.leaf}
              style={leafStyle}
              data-snc-leaf={chapter.numeral}
              data-snc-leaf-state={where}
              data-snc-turning={inFlight ? "true" : undefined}
              /* Only the leaf being read is in the accessibility tree: fifteen
                 chapters announced at once is not a book, it is a wall. */
              aria-hidden={where === "current" ? undefined : true}
            >
              <div className={cx(styles.face, styles.recto)} data-snc-leaf-face="recto">
                {state !== undefined && state.status === "content" ? (
                  <div className={styles.spread} data-snc-face-content="leaf">
                    {/* `:empty` in the stylesheet removes this slot when
                        <PalmPlate> returns null — which it does whenever the
                        hand-off carries neither a crop nor a drawable line, so
                        an unmeasured chapter never gets a frame around nothing. */}
                    <div className={styles.plateSlot}>
                      {plateId === null ? null : (
                        <PalmPlate lineId={plateId} geometry={geometry} capabilityTier={capabilityTier} />
                      )}
                    </div>
                    <LeafPage
                      state={state}
                      reading={reading}
                      sessionId={sessionId}
                      backHref={backHref}
                      capability={capabilityTier}
                    />
                  </div>
                ) : (
                  <div className={styles.sealedSlot} data-snc-face-content="sealed">
                    <SealedLeaf
                      reason={
                        state !== undefined && state.status === "sealed" ? state.reason : NO_READING_REASON
                      }
                      seed={seed}
                      capability={capabilityTier}
                      className={styles.sealedLeaf}
                    />
                    {/* <LeafPage> inks its own folio outside its sheet; a sealed
                        leaf has none, so the book supplies one here — same word,
                        same numerals, same chapter data, and never both on one
                        face. */}
                    <p className={styles.folio} lang="hi" data-snc-folio={chapter.devanagariNumeral}>
                      {pothiFolio(chapter)}
                    </p>
                  </div>
                )}
              </div>

              <div className={cx(styles.face, styles.verso)} data-snc-leaf-face="verso" aria-hidden="true">
                <LeafVerso chapter={chapter} seed={seed} />
                <p className={styles.folio} lang="hi" data-snc-folio={chapter.devanagariNumeral}>
                  {pothiFolio(chapter)}
                </p>
              </div>

              <span className={styles.foldShadow} aria-hidden="true" data-snc-layer="fold" />
            </div>
          );
        })}
      </div>

      <nav className={styles.controls} aria-label={BOOK_LABEL}>
        <button
          type="button"
          className={styles.control}
          onClick={goPrev}
          disabled={index === 0}
          aria-label={PREV_LABEL}
        >
          <svg
            className={styles.controlGlyph}
            viewBox={`0 0 ${ACTION_ICON_VIEWBOX} ${ACTION_ICON_VIEWBOX}`}
            aria-hidden="true"
            focusable="false"
          >
            <path
              d={CHEVRON_PATH}
              fill="none"
              stroke="currentColor"
              strokeWidth={HAIRLINE_STROKE}
              strokeLinecap="round"
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
            />
          </svg>
        </button>

        {/* The position readout, not a second folio: it names WHERE the reader
            is (numeral and chapter), which is what an announcement after a turn
            has to say. The folio itself stays on the leaf. */}
        <p className={styles.readout} aria-live="polite" data-snc-readout={current.numeral}>
          <span className={cx(styles.readoutNumeral, "snc-gold-text")} lang="hi">
            {current.devanagariNumeral}
          </span>
          <span className={styles.readoutTitle} lang="hi">
            {current.titleHi}
          </span>
        </p>

        <button
          type="button"
          className={cx(styles.control, styles.controlNext)}
          onClick={goNext}
          disabled={index === POTHI_CHAPTERS.length - 1}
          aria-label={NEXT_LABEL}
        >
          <svg
            className={styles.controlGlyph}
            viewBox={`0 0 ${ACTION_ICON_VIEWBOX} ${ACTION_ICON_VIEWBOX}`}
            aria-hidden="true"
            focusable="false"
          >
            <path
              d={CHEVRON_PATH}
              fill="none"
              stroke="currentColor"
              strokeWidth={HAIRLINE_STROKE}
              strokeLinecap="round"
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
            />
          </svg>
        </button>
      </nav>
    </div>
  );
}
