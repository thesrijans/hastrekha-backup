/**
 * The snaps, made in the browser (scan-complete G4.2): from the frozen frame, the plain palm (its 512 canonical
 * crop), the raw frame it came from, and the crop with the held lines drawn in gold (snap-render.ts). PNG blobs
 * for the snap store — this session's, or the opt-in's growth session — and object URLs, revoked by
 * {@link revokeSnaps}. (G4b: the result screen shows the photograph itself, result-render.ts; these are what is
 * kept.) Nothing here leaves the device.
 */
import type { FreezeCandidate, FreezeLine } from "@/lib/scan/freeze-frame";
import { drawSnapLines, type SnapPalette } from "./snap-render";

export interface CompletionSnaps {
  readonly palm: Blob;
  readonly raw: Blob;
  readonly lines: Blob;
  readonly palmUrl: string;
  readonly rawUrl: string;
  readonly linesUrl: string;
}

/** The sanctuary tokens the snap is drawn in, read off an element — this file owns no colour. */
export function readSnapPalette(element: HTMLElement): SnapPalette {
  const style = getComputedStyle(element);
  const token = (name: string): string => style.getPropertyValue(name).trim();
  return {
    line: token("--color-snc-gold-400") || "#e3c47a",
    glow: token("--color-snc-flame-warm") || "#e08a2e",
    halo: token("--color-snc-stone-900") || "#15110d",
    font: token("--font-snc-devanagari") || style.fontFamily,
  };
}

function toBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob((blob) => (blob === null ? reject(new Error("toBlob returned null")) : resolve(blob)), "image/png"));
}

function canvasOf(image: ImageData): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = image.width;
  canvas.height = image.height;
  const context = canvas.getContext("2d");
  if (context === null) throw new Error("2d context unavailable");
  context.putImageData(image, 0, 0);
  return canvas;
}

/** Make the three pictures from the frozen frame and the lines carried onto it. */
export async function makeSnaps(frozen: FreezeCandidate, lines: readonly FreezeLine[], palette: SnapPalette): Promise<CompletionSnaps> {
  const palmCanvas = canvasOf(frozen.crop);
  const linesCanvas = canvasOf(frozen.crop);
  const context = linesCanvas.getContext("2d");
  if (context === null) throw new Error("2d context unavailable");
  /* The face must be loaded before canvas can draw with it; the chamber's own text has long since used it. */
  if (typeof document !== "undefined" && document.fonts !== undefined) {
    await document.fonts.load(`${Math.round(frozen.crop.width * 0.056)}px ${palette.font}`, "हृदय मस्तिष्क जीवन शनि").catch(() => undefined);
  }
  drawSnapLines(context, lines, frozen.crop.width, palette);
  const [palm, raw, linesBlob] = await Promise.all([toBlob(palmCanvas), toBlob(canvasOf(frozen.raw)), toBlob(linesCanvas)]);
  return {
    palm,
    raw,
    lines: linesBlob,
    palmUrl: URL.createObjectURL(palm),
    rawUrl: URL.createObjectURL(raw),
    linesUrl: URL.createObjectURL(linesBlob),
  };
}

/**
 * When the scan kept no best frame (G4b: every frame failed the palm-facing or in-frame checks, or the
 * accumulator never measured one): the latest rectified crop and the video's current frame, with the anchors of
 * the latest rectify tick — so the lines can still be drawn through the frame they were last projected on. Its
 * grade is unknown (score 0) and it carries no gray, so its lines are drawn unshifted. Null with no crop at all.
 */
export function fallbackFreeze(
  video: HTMLVideoElement | null,
  crop: ImageData | null,
  observation: { readonly landmarks: FreezeCandidate["landmarks"]; readonly handedness: FreezeCandidate["handedness"] } | null,
  projection: { readonly anchors: FreezeCandidate["anchors"]; readonly convention: number } | null,
): FreezeCandidate | null {
  if (crop === null) return null;
  let raw = crop;
  if (video !== null && video.videoWidth > 0 && video.videoHeight > 0) {
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const context = canvas.getContext("2d");
    if (context !== null) {
      context.drawImage(video, 0, 0);
      raw = context.getImageData(0, 0, canvas.width, canvas.height);
    }
  }
  const anchored = raw !== crop && projection !== null && projection.anchors.length === projection.convention;
  return {
    score: 0,
    vol: 0,
    held: 0,
    inBand: false,
    atMs: performance.now(),
    raw,
    anchors: anchored ? projection.anchors : [],
    convention: anchored ? projection.convention : 0,
    gray: new Float32Array(0),
    landmarks: observation?.landmarks ?? [],
    handedness: observation?.handedness ?? "Right",
    quality: { score: 0, ok: false, issues: [], luma: 0, clipped: 0, jitter: 0, sharpness: 0 },
    windingStrength: null,
    trackSettings: {},
    live: null,
    heldAtCapture: null,
    crop,
    cropVol: 0,
  };
}

export function revokeSnaps(snaps: CompletionSnaps | null): void {
  if (snaps === null) return;
  URL.revokeObjectURL(snaps.palmUrl);
  URL.revokeObjectURL(snaps.rawUrl);
  URL.revokeObjectURL(snaps.linesUrl);
}
