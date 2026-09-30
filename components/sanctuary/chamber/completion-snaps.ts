/**
 * The completion screen's pictures, made in the browser (scan-complete G4.2): from the frozen frame, the plain
 * palm (its 512 canonical crop), the raw frame it came from, and the crop with the held lines drawn in gold
 * (snap-render.ts). PNG blobs for the snap store, object URLs for the leaf — revoked by {@link revokeSnaps}.
 * Nothing here leaves the device.
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
 * When no crop was ever offered to the keep-ring (super-resolution off, or never an anchored frame): the latest
 * rectified crop and the video's current frame. Its grade is unknown (VoL 0) and it has no anchors, so its
 * lines are drawn unshifted (that crop IS the accumulator's newest frame) and it is not offered as a growth
 * still — a still without its anchors cannot be replayed. Null with no crop at all.
 */
export function fallbackFreeze(
  video: HTMLVideoElement | null,
  crop: ImageData | null,
  observation: { readonly landmarks: FreezeCandidate["landmarks"]; readonly handedness: FreezeCandidate["handedness"] } | null,
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
  return {
    vol: 0,
    atMs: performance.now(),
    crop,
    raw,
    anchors: [],
    convention: 0,
    landmarks: observation?.landmarks ?? [],
    handedness: observation?.handedness ?? "Right",
    quality: { score: 0, ok: false, issues: [], luma: 0, clipped: 0, jitter: 0, sharpness: 0 },
    windingStrength: null,
    trackSettings: {},
  };
}

export function revokeSnaps(snaps: CompletionSnaps | null): void {
  if (snaps === null) return;
  URL.revokeObjectURL(snaps.palmUrl);
  URL.revokeObjectURL(snaps.rawUrl);
  URL.revokeObjectURL(snaps.linesUrl);
}
