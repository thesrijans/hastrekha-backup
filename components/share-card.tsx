"use client";

import { useCallback, useRef, useState } from "react";
import {
  HAND_OUTLINE,
  MOUNT_DOTS,
  MOUNTS,
  PALM_LINES,
  PALM_VIEWBOX_HEIGHT,
  PALM_VIEWBOX_WIDTH,
  SCAN_BRACKETS,
} from "./palm-geometry";

/** Story-format canvas. Never mounted in the DOM — it exists only to export a PNG. */
const CARD_WIDTH = 1080;
const CARD_HEIGHT = 1920;
const FILE_NAME = "hastrekha-scan.png";

const NIGHT = "#06090d";
const LINE_GLOW = "#ff9a3c";
const MOUNT_GLOW = "#35e0c8";
const INK = "#eaf2f4";
const MUTED = "#8fa3ab";
const HAIRLINE = "#1b2a33";

interface ShareCardProps {
  /** The line worth sharing — usually the top highlight. */
  readonly headline: string;
  /** e.g. "Cheiro, Language of the Hand (1900)". Rendered small, under the headline. */
  readonly source: string;
  /** The reader's own mount values, so the shared palm is their scan. */
  readonly mounts: Record<string, number>;
}

type Status = "idle" | "working" | "shared" | "downloaded" | "error";

/** Reads a CSS custom property off the document, so the canvas uses the same face as the page. */
function fontStack(variable: string, fallback: string): string {
  if (typeof window === "undefined") return fallback;
  const value = getComputedStyle(document.documentElement).getPropertyValue(variable).trim();
  return value === "" ? fallback : `${value}, ${fallback}`;
}

/** Greedy wrap. Returns the lines; the caller decides where to start drawing. */
function wrap(context: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const words = text.split(/\s+/).filter((word) => word !== "");
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current === "" ? word : `${current} ${word}`;
    if (context.measureText(candidate).width <= maxWidth || current === "") {
      current = candidate;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current !== "") lines.push(current);
  return lines;
}

/** Canvas equivalent of the CSS layered drop-shadow glow. */
function withGlow(context: CanvasRenderingContext2D, colour: string, draw: () => void): void {
  context.save();
  context.shadowColor = colour;
  context.shadowBlur = 26;
  draw();
  context.shadowBlur = 10;
  draw();
  context.restore();
}

/**
 * The same palm as the live component, drawn to canvas.
 *
 * Geometry comes from `palm-geometry`, so the shared image can never drift from what the user saw
 * on screen — there is one hand in this codebase, not two.
 */
function drawHoloPalm(context: CanvasRenderingContext2D, mounts: Record<string, number>, scale: number, x: number, y: number): void {
  context.save();
  context.translate(x, y);
  context.scale(scale, scale);

  const outline = new Path2D(HAND_OUTLINE);
  context.fillStyle = "rgba(12,18,24,0.75)";
  context.fill(outline);
  context.strokeStyle = HAIRLINE;
  context.lineWidth = 1.5;
  context.stroke(outline);

  context.strokeStyle = MOUNT_GLOW;
  context.lineWidth = 1.5;
  context.lineCap = "square";
  withGlow(context, MOUNT_GLOW, () => {
    for (const bracket of SCAN_BRACKETS) context.stroke(new Path2D(bracket.d));
  });

  context.fillStyle = MOUNT_GLOW;
  for (const mount of MOUNTS) {
    const value = Math.min(1, Math.max(0, mounts[mount.key] ?? 0));
    context.globalAlpha = 0.14 + value * 0.86;
    withGlow(context, MOUNT_GLOW, () => {
      for (const dot of MOUNT_DOTS[mount.key] ?? []) {
        context.beginPath();
        context.arc(dot.cx, dot.cy, (0.9 + value * 2.1) * dot.scale, 0, Math.PI * 2);
        context.fill();
      }
    });
  }
  context.globalAlpha = 1;

  context.strokeStyle = LINE_GLOW;
  context.lineWidth = 2;
  context.lineCap = "round";
  withGlow(context, LINE_GLOW, () => {
    for (const line of PALM_LINES) context.stroke(new Path2D(line.d));
  });

  context.restore();
}

function paint(canvas: HTMLCanvasElement, headline: string, source: string, mounts: Record<string, number>): void {
  const context = canvas.getContext("2d");
  if (context === null) throw new Error("canvas 2d context unavailable");

  const display = fontStack("--font-space-grotesk", "system-ui, sans-serif");
  const sans = fontStack("--font-inter", "system-ui, sans-serif");

  context.fillStyle = NIGHT;
  context.fillRect(0, 0, CARD_WIDTH, CARD_HEIGHT);

  const glow = context.createRadialGradient(CARD_WIDTH / 2, 620, 0, CARD_WIDTH / 2, 620, 820);
  glow.addColorStop(0, "rgba(53,224,200,0.16)");
  glow.addColorStop(1, "rgba(53,224,200,0)");
  context.fillStyle = glow;
  context.fillRect(0, 0, CARD_WIDTH, CARD_HEIGHT);

  const margin = 96;
  const maxWidth = CARD_WIDTH - margin * 2;

  context.fillStyle = MOUNT_GLOW;
  context.font = `600 34px ${display}`;
  context.letterSpacing = "8px";
  context.fillText("HASTREKHA", margin, 190);
  context.letterSpacing = "0px";

  const palmScale = 1.9;
  drawHoloPalm(
    context,
    mounts,
    palmScale,
    (CARD_WIDTH - PALM_VIEWBOX_WIDTH * palmScale) / 2,
    280,
  );

  let y = 280 + PALM_VIEWBOX_HEIGHT * palmScale + 130;

  context.fillStyle = INK;
  context.font = `600 68px ${display}`;
  for (const line of wrap(context, headline, maxWidth)) {
    context.fillText(line, margin, y);
    y += 88;
  }

  if (source !== "") {
    context.fillStyle = LINE_GLOW;
    context.font = `400 30px ${sans}`;
    for (const line of wrap(context, source, maxWidth)) {
      y += 50;
      context.fillText(line, margin, y);
    }
  }

  context.strokeStyle = HAIRLINE;
  context.lineWidth = 2;
  context.beginPath();
  context.moveTo(margin, CARD_HEIGHT - 230);
  context.lineTo(CARD_WIDTH - margin, CARD_HEIGHT - 230);
  context.stroke();

  context.fillStyle = MUTED;
  context.font = `400 30px ${sans}`;
  context.fillText("Apni hatheli scan karo — bina dar ke.", margin, CARD_HEIGHT - 170);
  context.fillStyle = INK;
  context.font = `500 30px ${display}`;
  context.fillText("hastrekha.app", margin, CARD_HEIGHT - 120);
}

function toBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob === null) reject(new Error("canvas produced no blob"));
      else resolve(blob);
    }, "image/png");
  });
}

/**
 * Renders the reading's top line to a 1080×1920 PNG and hands it to the OS share sheet.
 *
 * `navigator.share` with files is the good path on mobile. Most desktop browsers expose `share` but
 * cannot take files, so we check `canShare({ files })` rather than `share` alone and fall back to a
 * download instead of throwing a "not allowed" at the user.
 */
export function ShareCard({ headline, source, mounts }: ShareCardProps) {
  const [status, setStatus] = useState<Status>("idle");
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const share = useCallback(async () => {
    setStatus("working");
    try {
      const canvas = canvasRef.current ?? document.createElement("canvas");
      canvasRef.current = canvas;
      canvas.width = CARD_WIDTH;
      canvas.height = CARD_HEIGHT;

      // Wait for next/font to settle, otherwise the canvas paints in the fallback face.
      if (typeof document !== "undefined" && "fonts" in document) await document.fonts.ready;
      paint(canvas, headline, source, mounts);

      const blob = await toBlob(canvas);
      const file = new File([blob], FILE_NAME, { type: "image/png" });

      if (typeof navigator.canShare === "function" && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: "HastRekha" });
        setStatus("shared");
        return;
      }

      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = FILE_NAME;
      anchor.click();
      URL.revokeObjectURL(url);
      setStatus("downloaded");
    } catch (error) {
      // Dismissing the share sheet rejects with AbortError — that is not a failure.
      if (error instanceof DOMException && error.name === "AbortError") {
        setStatus("idle");
        return;
      }
      console.error("[share] card failed:", error);
      setStatus("error");
    }
  }, [headline, source, mounts]);

  return (
    <div className="flex flex-wrap items-center gap-3">
      <button
        type="button"
        onClick={() => void share()}
        disabled={status === "working"}
        className="flex items-center gap-2 rounded-full border border-hairline px-4 py-2 font-display text-sm font-medium text-ink transition-colors hover:border-mount-glow hover:text-mount-glow disabled:opacity-50"
      >
        <svg
          viewBox="0 0 24 24"
          className="h-4 w-4"
          aria-hidden="true"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.75}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M12 15V4M12 4L8 8M12 4l4 4" />
          <path d="M5 14v4.5A1.5 1.5 0 0 0 6.5 20h11a1.5 1.5 0 0 0 1.5-1.5V14" />
        </svg>
        {status === "working" ? "Card ban raha hai…" : "Share"}
      </button>
      <span aria-live="polite" className="text-xs text-muted">
        {status === "shared" ? "Share sheet khul gayi." : null}
        {status === "downloaded" ? "PNG download ho gaya." : null}
        {status === "error" ? "Card nahi ban paya — dobara try karo." : null}
      </span>
    </div>
  );
}
