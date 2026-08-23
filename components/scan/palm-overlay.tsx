"use client";

import { useEffect, useRef } from "react";
import { applyHomography, canonicalQuad, palmQuad, solveHomography, type Matrix3 } from "@/lib/scan/rectify";
import { palmBoundary } from "@/lib/scan/landmarks";
import { MOUNT_ZONES } from "@/lib/scan/zones";
import type { Poly } from "@/lib/scan/lines";
import { RECTIFIED_SIZE, type Landmark3, type Point2 } from "@/lib/scan/types";

const LINE_GLOW = "#ff9a3c";
const MOUNT_GLOW = "#35e0c8";
const SWEEP_PERIOD_MS = 2400;

export interface PalmOverlayProps {
  /** Live landmarks; the overlay re-projects onto these every frame. */
  readonly landmarks: readonly Landmark3[] | null;
  /** Traced lines in rectified crop space. Reused across frames while inference catches up. */
  readonly polys: readonly Poly[];
  /** Mount key → 0–1, for the cyan dot clusters. */
  readonly mounts: Record<string, number>;
  /** 0–1 fused confidence; below `warmupBelow` the sweep plays instead of solid strokes. */
  readonly confidence: number;
  readonly mirrored: boolean;
  readonly className?: string;
}

const WARMUP_BELOW = 0.35;

/**
 * Deterministic scatter for the mount clusters, in crop space. Seeded, so the dots do not crawl.
 */
function mountDots(): ReadonlyArray<{ zone: string; x: number; y: number; r: number }> {
  const out: Array<{ zone: string; x: number; y: number; r: number }> = [];
  let seed = 0x2f6e2b1;
  const random = (): number => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  for (const zone of MOUNT_ZONES) {
    for (let i = 0; i < 14; i += 1) {
      const angle = random() * Math.PI * 2;
      const radius = Math.sqrt(random()) * zone.r;
      out.push({
        zone: zone.id,
        x: (zone.cx + Math.cos(angle) * radius) * RECTIFIED_SIZE,
        y: (zone.cy + Math.sin(angle) * radius) * RECTIFIED_SIZE,
        r: 1 - radius / zone.r,
      });
    }
  }
  return out;
}

const MOUNT_DOTS = mountDots();

/**
 * The live palm overlay.
 *
 * **Why polylines and not the mask.** Re-warping a 65k-pixel probability field onto the video every
 * frame would cost more than the inference it is displaying. Instead the fused mask is traced into
 * polylines *once* per inference, and each frame only pushes a few dozen points through the current
 * crop→frame homography. That is why the strokes stay glued to a moving hand at 60fps while the
 * model underneath plods along at 5 — the geometry follows the landmarks, not the model.
 *
 * Glow is two passes over the same path: a wide blurred stroke underneath, a thin bright core on
 * top. `shadowBlur` alone smears the line; this keeps a crisp centre inside the bloom.
 */
export function PalmOverlay({ landmarks, polys, mounts, confidence, mirrored, className }: PalmOverlayProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rafRef = useRef<number | null>(null);
  // Latest props, read by the animation loop without restarting it. Synced in an effect rather than
  // during render: a render that React discards must not leave a mutated ref behind.
  const stateRef = useRef({ landmarks, polys, mounts, confidence, mirrored });
  useEffect(() => {
    stateRef.current = { landmarks, polys, mounts, confidence, mirrored };
  }, [landmarks, polys, mounts, confidence, mirrored]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return;
    const context = canvas.getContext("2d");
    if (context === null) return;

    const reduceMotion =
      typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const draw = (timestamp: number) => {
      const { landmarks: marks, polys: traces, mounts: mountValues, confidence: fused, mirrored: flip } = stateRef.current;

      const parent = canvas.parentElement;
      const width = parent?.clientWidth ?? canvas.width;
      const height = parent?.clientHeight ?? canvas.height;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
        canvas.width = Math.round(width * dpr);
        canvas.height = Math.round(height * dpr);
      }

      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      context.clearRect(0, 0, width, height);

      if (marks === null || marks.length < 21) {
        rafRef.current = requestAnimationFrame(draw);
        return;
      }

      // The preview is CSS-mirrored, so mirror the overlay in the same way rather than negating
      // every coordinate — one transform is far easier to keep in step than scattered sign flips.
      if (flip) {
        context.translate(width, 0);
        context.scale(-1, 1);
      }

      /*
       * The palm boundary is drawn straight from landmarks, not through the homography: it is
       * already in image space, and routing it via the crop would put it at the mercy of the very
       * rectification it exists to sanity-check.
       */
      const boundary = palmBoundary(marks);
      if (boundary !== null) {
        context.save();
        context.strokeStyle = MOUNT_GLOW;
        context.shadowColor = MOUNT_GLOW;
        context.shadowBlur = 8;
        context.globalAlpha = 0.35;
        context.lineWidth = 1.5;
        context.lineJoin = "round";
        context.lineCap = "round";
        context.beginPath();
        boundary.forEach((point, index) => {
          const x = point.x * width;
          const y = point.y * height;
          if (index === 0) context.moveTo(x, y);
          else context.lineTo(x, y);
        });
        context.stroke();
        context.restore();
      }

      const quad = palmQuad(marks, width, height);
      const cropToFrame: Matrix3 | null = quad === null ? null : solveHomography(canonicalQuad(RECTIFIED_SIZE), quad);
      if (cropToFrame === null) {
        context.setTransform(dpr, 0, 0, dpr, 0, 0);
        rafRef.current = requestAnimationFrame(draw);
        return;
      }

      const project = (point: Point2): Point2 | null => applyHomography(cropToFrame, point);

      /* ------------------------------ Mount dots ------------------------------ */
      context.save();
      context.fillStyle = MOUNT_GLOW;
      context.shadowColor = MOUNT_GLOW;
      context.shadowBlur = 6;
      for (const dot of MOUNT_DOTS) {
        const value = mountValues[dot.zone] ?? 0;
        if (value <= 0.01) continue;
        const projected = project({ x: dot.x, y: dot.y });
        if (projected === null) continue;
        context.globalAlpha = 0.1 + value * 0.5;
        context.beginPath();
        context.arc(projected.x, projected.y, 0.8 + value * 1.8 * dot.r, 0, Math.PI * 2);
        context.fill();
      }
      context.restore();

      /* -------------------------------- Lines --------------------------------- */
      const warming = fused < WARMUP_BELOW || traces.length === 0;

      if (!warming) {
        const strokePaths = () => {
          for (const poly of traces) {
            if (poly.length < 2) continue;
            context.beginPath();
            let started = false;
            for (const point of poly) {
              const projected = project(point);
              if (projected === null) continue;
              if (!started) {
                context.moveTo(projected.x, projected.y);
                started = true;
              } else {
                context.lineTo(projected.x, projected.y);
              }
            }
            context.stroke();
          }
        };

        context.save();
        context.lineCap = "round";
        context.lineJoin = "round";
        context.strokeStyle = LINE_GLOW;

        // Pass 1: wide, blurred, low alpha — the bloom.
        context.shadowColor = LINE_GLOW;
        context.shadowBlur = 6;
        context.globalAlpha = 0.45;
        context.lineWidth = 6;
        strokePaths();

        // Pass 2: thin, bright — the core that keeps the line legible inside the bloom.
        context.shadowBlur = 0;
        context.globalAlpha = Math.min(1, 0.5 + fused * 0.5);
        context.lineWidth = 1.5;
        strokePaths();
        context.restore();
      } else {
        /* Warming up: sweep the palm region so the feed never looks dead while the model loads. */
        const phase = reduceMotion ? 0.5 : ((timestamp % SWEEP_PERIOD_MS) / SWEEP_PERIOD_MS);
        const bandY = phase * RECTIFIED_SIZE;
        const left = project({ x: 0, y: bandY });
        const right = project({ x: RECTIFIED_SIZE, y: bandY });
        if (left !== null && right !== null) {
          context.save();
          const gradient = context.createLinearGradient(left.x, left.y, right.x, right.y);
          gradient.addColorStop(0, "rgba(53,224,200,0)");
          gradient.addColorStop(0.5, "rgba(53,224,200,0.7)");
          gradient.addColorStop(1, "rgba(53,224,200,0)");
          context.strokeStyle = gradient;
          context.shadowColor = MOUNT_GLOW;
          context.shadowBlur = 10;
          context.lineWidth = 2;
          context.beginPath();
          context.moveTo(left.x, left.y);
          context.lineTo(right.x, right.y);
          context.stroke();
          context.restore();
        }
      }

      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      rafRef.current = requestAnimationFrame(draw);
    };

    rafRef.current = requestAnimationFrame(draw);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    };
  }, []);

  return <canvas ref={canvasRef} aria-hidden="true" className={className ?? "pointer-events-none absolute inset-0 h-full w-full"} />;
}
