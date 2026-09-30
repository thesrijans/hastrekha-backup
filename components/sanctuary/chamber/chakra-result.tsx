"use client";

/**
 * "पहचान पूरी · Scan complete" — YOUR HAND, YOUR LINES (chakra spec §4).
 *
 * Full screen: the frozen photograph of the reader's own hand — the scan's best frame — with the held lines in
 * gold, each named in Devanagari on a thin leader, observed stretches solid and bridged ones faint
 * (result-render.ts, which draws them with the live overlay's own code, through that frame's own homography).
 * Lines not found are not drawn; the legend lists them: found ✓, not found —.
 *
 * "साधारण · रेखाएँ" flips between the plain photograph and the lined one. The ways on: "चित्र सहेजें" saves the
 * lined picture to the device (the Web Share API with the file where the device offers it — Android — else a
 * download), "दोबारा स्कैन" starts again, "पाठ खोलें · Open reading" writes the hand-off and opens the pothi.
 *
 * NOTHING IS UPLOADED. The pictures stay in this browsing session's own IndexedDB (lib/scan/snap-store.ts); the
 * opt-in — OFF, and saying what it does before it is touched — keeps them as a growth session, and off again
 * deletes it.
 *
 * TWO STAGES. "sealing": the photograph at the live view's framing and the room's dim, the lines on it, while the
 * chamber's ring closes over it (§2) — no chrome. "result": the chrome comes in, the photograph eases to the hand's
 * framing between the title and the leaf, and the room's dim lifts: it is a photograph now.
 *
 * Ink on a torn leaf like every other leaf in the chamber: the buttons are struck rules under words, never
 * filled pills (chamber.module.css .gateButton, the one control's precedent).
 */
import { useCallback, useEffect, useRef, useState, type ReactElement } from "react";
import { Parchment } from "@/components/sanctuary/material";
import type { FreezeLine } from "@/lib/scan/freeze-frame";
import { CHAKRA_WORDS } from "@/lib/scan/chakra";
import type { ActiveLineId, Landmark3, Point2 } from "@/lib/scan/types";
import { readPalette, type Palette } from "./chamber-canvas";
import {
  coverView,
  drawResult,
  handFocus,
  lerpView,
  palmView,
  renderComposite,
  RESULT_FRAMING_MS,
  RESULT_LOOK,
  ROOM_LOOK,
  type PhotoView,
  type ResultScene,
} from "./result-render";
import styles from "./chakra-result.module.css";

/** The screen's words, exactly as the spec prints them. */
export const RESULT_WORDS = {
  title: CHAKRA_WORDS.complete,
  titleEn: CHAKRA_WORDS.completeEn,
  plain: "साधारण",
  lined: "रेखाएँ",
  open: "पाठ खोलें",
  openEn: "Open reading",
  retake: "दोबारा स्कैन",
  save: "चित्र सहेजें",
  saved: "सहेजा गया",
  growth: "मेरी हथेली से HastRekha को बेहतर बनाने में मदद करें",
} as const;

/** The note under the opt-in: what happens to the pictures, before and after it is switched on. */
export const GROWTH_NOTE = {
  off: "तस्वीरें केवल इस डिवाइस पर · कभी अपलोड नहीं",
  on: "सहेजा गया · केवल इस डिवाइस पर · बंद करते ही हट जाएगा",
} as const;

/** The leaf's own seed: one leaf, torn once. */
const RESULT_SEED = 5381;

/** The saved picture's file name: the day it was taken, never anything about the reader. */
export function compositeFileName(date: Date): string {
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `hastrekha-hatheli-${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}.png`;
}

export type SaveOutcome = "idle" | "saving" | "shared" | "downloaded" | "failed";

/** One legend entry: a major line, found (✓) or not (—). */
export interface LegendEntry {
  readonly id: ActiveLineId;
  readonly name: string;
  readonly found: boolean;
}

export interface ChakraResultProps {
  /** The frozen frame: its raw pixels, the anchors it was rectified through, its landmarks. */
  readonly frozen: { readonly raw: ImageData; readonly anchors: readonly Point2[]; readonly convention: number; readonly landmarks: readonly Landmark3[] };
  /** The held lines, carried onto the frozen frame's crop (MASK_SIZE space). */
  readonly lines: readonly FreezeLine[];
  /** The preview was mirrored: the photograph is shown — and saved — as the reader saw it. */
  readonly mirrored: boolean;
  readonly legend: readonly LegendEntry[];
  readonly stage: "sealing" | "result";
  /** The opt-in growth save. */
  readonly growth: boolean;
  readonly growthBusy: boolean;
  /** False where the device cannot keep it (no IndexedDB, or no anchors to replay): the opt-in is not offered. */
  readonly growthAvailable: boolean;
  readonly onGrowthChange: (on: boolean) => void;
  readonly onRetake: () => void;
  readonly onOpenReading: () => void;
  /** True once the reading has been asked for: every way on then waits. */
  readonly opening: boolean;
}

function toBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob((blob) => (blob === null ? reject(new Error("toBlob returned null")) : resolve(blob)), "image/png"));
}

export function ChakraResult({
  frozen,
  lines,
  mirrored,
  legend,
  stage,
  growth,
  growthBusy,
  growthAvailable,
  onGrowthChange,
  onRetake,
  onOpenReading,
  opening,
}: ChakraResultProps): ReactElement {
  const [lined, setLined] = useState(true);
  const [save, setSave] = useState<SaveOutcome>("idle");
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const topRef = useRef<HTMLDivElement | null>(null);
  const leafRef = useRef<HTMLDivElement | null>(null);
  /* The photograph, once, as a canvas the draws copy from. */
  const photoRef = useRef<HTMLCanvasElement | null>(null);
  const paletteRef = useRef<Palette | null>(null);
  /* The saved picture, rendered ahead of the tap: a share must be called while the tap still counts. */
  const compositeRef = useRef<Promise<Blob> | null>(null);
  const stateRef = useRef({ lined, stage });
  useEffect(() => {
    stateRef.current = { lined, stage };
  }, [lined, stage]);

  const scene = useCallback((): ResultScene | null => {
    let photo = photoRef.current;
    if (photo === null) {
      photo = document.createElement("canvas");
      photo.width = frozen.raw.width;
      photo.height = frozen.raw.height;
      photo.getContext("2d")?.putImageData(frozen.raw, 0, 0);
      photoRef.current = photo;
    }
    return { photo, anchors: frozen.anchors, convention: frozen.convention, lines };
  }, [frozen, lines]);

  /*
   * The drawing: a frame whenever something changed — the stage, the toggle, the size — and a chain of them only
   * while the photograph eases to the hand's framing. A still picture is not redrawn sixty times a second.
   */
  const requestDrawRef = useRef<(() => void) | null>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return;
    const context = canvas.getContext("2d");
    if (context === null) return;
    paletteRef.current = readPalette(canvas);
    let box = { width: 1, height: 1 };
    let dpr = 1;
    let raf = 0;
    let resultAt: number | null = null;
    let from: PhotoView | null = null;

    const draw = (timestamp: number): void => {
      raf = 0;
      const current = scene();
      const palette = paletteRef.current;
      if (current === null || palette === null) return;
      const { lined: showLines, stage: now } = stateRef.current;
      const cover = coverView(current.photo, box, mirrored);
      let view = cover;
      let look: { dim: number; vignette: number } = ROOM_LOOK;
      let easing = false;
      let labelBottom: number | undefined;
      if (now === "result") {
        const top = topRef.current?.getBoundingClientRect().bottom ?? 0;
        const bottom = leafRef.current?.getBoundingClientRect().top ?? box.height;
        const target = palmView(current.photo, box, handFocus(frozen.landmarks, current.photo), { top, bottom }, mirrored);
        resultAt ??= timestamp;
        from ??= cover;
        const t = (timestamp - resultAt) / RESULT_FRAMING_MS;
        view = lerpView(from, target, t);
        const k = Math.min(1, Math.max(0, t));
        look = { dim: ROOM_LOOK.dim + (RESULT_LOOK.dim - ROOM_LOOK.dim) * k, vignette: ROOM_LOOK.vignette + (RESULT_LOOK.vignette - ROOM_LOOK.vignette) * k };
        easing = t < 1;
        /* The names hang above the leaf, never under it. */
        labelBottom = bottom - 6;
      }
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      drawResult(context, box, current, view, palette, { lined: showLines, look, labelBottom });
      canvas.dataset.sncView = `${view.scale.toFixed(4)},${view.dx.toFixed(1)},${view.dy.toFixed(1)}`;
      if (easing) raf = requestAnimationFrame(draw);
    };
    const request = (): void => {
      if (raf === 0) raf = requestAnimationFrame(draw);
    };
    const resize = (): void => {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      const rect = canvas.getBoundingClientRect();
      canvas.width = Math.max(1, Math.round(rect.width * dpr));
      canvas.height = Math.max(1, Math.round(rect.height * dpr));
      box = { width: rect.width, height: rect.height };
      paletteRef.current = readPalette(canvas);
      request();
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    requestDrawRef.current = request;
    return () => {
      requestDrawRef.current = null;
      cancelAnimationFrame(raf);
      observer.disconnect();
    };
  }, [scene, mirrored, frozen.landmarks]);
  useEffect(() => {
    requestDrawRef.current?.();
  }, [lined, stage]);

  /* The saved picture, made once the result is up, off the tap's path. */
  const composite = useCallback((): Promise<Blob> => {
    if (compositeRef.current !== null) return compositeRef.current;
    const current = scene();
    const palette = paletteRef.current;
    if (current === null || palette === null) return Promise.reject(new Error("no photograph"));
    compositeRef.current = (async () => {
      /* The face must be loaded before canvas can draw with it; the chamber's own text has long since used it. */
      if (document.fonts !== undefined) await document.fonts.load(`14px ${palette.font}`, "हृदय मस्तिष्क जीवन शनि रेखा").catch(() => undefined);
      const target = document.createElement("canvas");
      renderComposite(target, current, palette, mirrored);
      return toBlob(target);
    })();
    compositeRef.current.catch(() => {
      compositeRef.current = null;
    });
    return compositeRef.current;
  }, [scene, mirrored]);
  useEffect(() => {
    if (stage !== "result") return;
    const timer = window.setTimeout(() => void composite().catch(() => undefined), 700);
    return () => window.clearTimeout(timer);
  }, [stage, composite]);

  /* "चित्र सहेजें": the file shared where the device can share files (Android), else downloaded. */
  const onSave = useCallback(() => {
    setSave("saving");
    void (async () => {
      try {
        const blob = await composite();
        const name = compositeFileName(new Date());
        const file = typeof File === "function" ? new File([blob], name, { type: "image/png" }) : null;
        if (file !== null && typeof navigator.share === "function" && navigator.canShare?.({ files: [file] }) === true) {
          try {
            await navigator.share({ files: [file], title: "HastRekha" });
            setSave("shared");
            return;
          } catch (shareError) {
            /* The reader closed the sheet: nothing to do, and nothing to say. Anything else falls to a download. */
            if (shareError instanceof DOMException && shareError.name === "AbortError") {
              setSave("idle");
              return;
            }
          }
        }
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = name;
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
        setSave("downloaded");
      } catch (saveError) {
        console.error("[chamber] save:", saveError);
        setSave("failed");
      }
    })();
  }, [composite]);

  const found = legend.filter((entry) => entry.found).length;

  return (
    <div className={styles.result} data-snc-result={stage} data-snc-lined={lined ? "" : undefined} data-snc-saved={save}>
      <canvas ref={canvasRef} className={styles.photo} role="img" aria-label={lined ? "Your palm, with the lines found in gold" : "Your palm"} />

      {stage === "result" ? (
        <>
          <div ref={topRef} className={styles.top}>
            <p className={styles.title} lang="hi" aria-live="polite">
              {RESULT_WORDS.title} <span className={styles.titleEn} lang="en">· {RESULT_WORDS.titleEn}</span>
            </p>
            <div className={styles.toggle} role="group" aria-label="Plain photo or with lines">
              <button type="button" className={styles.toggleWord} aria-pressed={!lined} onClick={() => setLined(false)} lang="hi" data-snc-view-mode="plain">
                {RESULT_WORDS.plain}
              </button>
              <span className={styles.toggleDot} aria-hidden="true">
                ·
              </span>
              <button type="button" className={styles.toggleWord} aria-pressed={lined} onClick={() => setLined(true)} lang="hi" data-snc-view-mode="lined">
                {RESULT_WORDS.lined}
              </button>
            </div>
          </div>

          <div ref={leafRef} className={styles.dock}>
            <Parchment tone="aged" tear="rough" seed={RESULT_SEED} className={styles.leaf}>
              <p className={styles.legend} lang="hi" data-snc-legend={`${found}/${legend.length}`}>
                {legend.map((entry, index) => (
                  <span key={entry.id} className={entry.found ? styles.found : styles.missing} data-snc-legend-line={entry.id} data-snc-found={entry.found ? "" : undefined}>
                    {index > 0 ? <span aria-hidden="true"> · </span> : null}
                    {entry.name} <span aria-label={entry.found ? "found" : "not found"}>{entry.found ? "✓" : "—"}</span>
                  </span>
                ))}
              </p>
              <p className={styles.minors} lang="hi">
                {CHAKRA_WORDS.minors}
              </p>

              {growthAvailable ? (
                <>
                  <label className={styles.growth}>
                    <input
                      type="checkbox"
                      className={styles.check}
                      checked={growth}
                      disabled={growthBusy || opening}
                      onChange={(event) => onGrowthChange(event.currentTarget.checked)}
                      data-snc-growth=""
                    />
                    <span lang="hi">{RESULT_WORDS.growth}</span>
                  </label>
                  <p className={styles.note} lang="hi" data-snc-growth-note="">
                    {growth ? GROWTH_NOTE.on : GROWTH_NOTE.off}
                  </p>
                </>
              ) : null}

              <div className={styles.actions}>
                <button type="button" className={styles.action} lang="hi" onClick={onSave} disabled={opening || save === "saving"} data-snc-action="save">
                  {save === "shared" || save === "downloaded" ? `${RESULT_WORDS.save} ✓` : RESULT_WORDS.save}
                </button>
                <button type="button" className={styles.action} lang="hi" onClick={onRetake} disabled={opening} data-snc-action="retake">
                  {RESULT_WORDS.retake}
                </button>
              </div>
              <button type="button" className={`${styles.action} ${styles.primary}`} onClick={onOpenReading} disabled={opening} data-snc-action="open">
                <span lang="hi">{RESULT_WORDS.open}</span> · <span lang="en">{RESULT_WORDS.openEn}</span>
              </button>
            </Parchment>
          </div>
        </>
      ) : null}
    </div>
  );
}
