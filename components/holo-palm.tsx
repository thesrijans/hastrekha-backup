"use client";

import { useCallback, useId, useRef, useState } from "react";
import {
  HAND_OUTLINE,
  MOUNT_DOTS,
  MOUNTS,
  PALM_LINES,
  PALM_VIEWBOX,
  PALM_VIEWBOX_HEIGHT,
  polylineToPath,
  SCAN_BRACKETS,
} from "./palm-geometry";

/** Caller-supplied line geometry, e.g. polylines from a future on-device palm scan. */
export type PalmPolylines = Readonly<Record<string, readonly (readonly [number, number])[]>>;

interface HoloPalmProps {
  /** Mount key → 0–1 prominence. Missing keys read as 0. */
  readonly mounts: Record<string, number>;
  /** Override the idealised line paths with detected geometry, keyed by line id. */
  readonly lines?: PalmPolylines;
  /** Adds the radiogroup, hit targets and caption. Off by default: the palm is art unless asked. */
  readonly interactive?: boolean;
  readonly onSelectMount?: (key: string) => void;
  /** Which mount reads as chosen. */
  readonly selected?: string | null;
  /** Play the draw-on, dot-in, bracket and sweep animations. Reduced motion is handled in globals.css. */
  readonly animate?: boolean;
  readonly className?: string;
}

const LINE_STAGGER_MS = 200;
const DOT_BASE_DELAY_MS = 900;
const DOT_STAGGER_MS = 26;
const BRACKET_STAGGER_MS = 90;

/** 0 → a faint trace of the cluster, 1 → fully lit. Never zero, or the mount stops being a landmark. */
function dotOpacity(value: number): number {
  return 0.14 + Math.min(1, Math.max(0, value)) * 0.86;
}

/** Dot radius grows with the mount value, so a large mount reads as denser *and* heavier. */
function dotRadius(value: number, scale: number): number {
  return (0.9 + Math.min(1, Math.max(0, value)) * 2.1) * scale;
}

/**
 * The holographic palm.
 *
 * Interactive mode is a WAI-ARIA radiogroup: the group owns one tab stop, arrow keys move *and*
 * select (as the radio pattern specifies), and Home/End jump to the ends. Hover and focus feed the
 * same caption, so pointer and keyboard users read identical text.
 */
export function HoloPalm({
  mounts,
  lines,
  interactive = false,
  onSelectMount,
  selected = null,
  animate = false,
  className,
}: HoloPalmProps) {
  const uid = useId();
  const [hovered, setHovered] = useState<string | null>(null);
  const nodeRefs = useRef<Array<SVGGElement | null>>([]);

  const active = hovered ?? selected;
  const activeSpec = MOUNTS.find((mount) => mount.key === active) ?? null;

  const selectedIndex = MOUNTS.findIndex((mount) => mount.key === selected);
  /** Roving tabindex: exactly one mount is reachable by Tab, the rest by arrow keys. */
  const tabIndexFor = (index: number): number => {
    if (!interactive) return -1;
    if (selectedIndex === -1) return index === 0 ? 0 : -1;
    return index === selectedIndex ? 0 : -1;
  };

  const move = useCallback(
    (index: number) => {
      onSelectMount?.(MOUNTS[index].key);
      nodeRefs.current[index]?.focus();
    },
    [onSelectMount],
  );

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<SVGGElement>, index: number) => {
      if (!interactive) return;
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        onSelectMount?.(MOUNTS[index].key);
        return;
      }
      const last = MOUNTS.length - 1;
      let next: number | null = null;
      if (event.key === "ArrowRight" || event.key === "ArrowDown") next = index === last ? 0 : index + 1;
      else if (event.key === "ArrowLeft" || event.key === "ArrowUp") next = index === 0 ? last : index - 1;
      else if (event.key === "Home") next = 0;
      else if (event.key === "End") next = last;
      if (next === null) return;
      event.preventDefault();
      move(next);
    },
    [interactive, move, onSelectMount],
  );

  return (
    <div className={className}>
      {/* Decorative unless interactive: the copy beside it already says everything it shows. */}
      <svg
        viewBox={PALM_VIEWBOX}
        className="w-full"
        role={interactive ? "radiogroup" : undefined}
        aria-label={interactive ? "Hatheli ke mounts — ek chuno" : undefined}
        aria-hidden={interactive ? undefined : true}
        focusable="false"
      >
        <defs>
          <linearGradient id={`${uid}-sweep`} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="var(--color-mount-glow)" stopOpacity="0" />
            <stop offset="50%" stopColor="var(--color-mount-glow)" stopOpacity="0.75" />
            <stop offset="100%" stopColor="var(--color-mount-glow)" stopOpacity="0" />
          </linearGradient>
          <linearGradient id={`${uid}-skin`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--color-surface)" stopOpacity="0.85" />
            <stop offset="100%" stopColor="var(--color-surface)" stopOpacity="0.35" />
          </linearGradient>
        </defs>

        {/* Scan brackets */}
        <g
          fill="none"
          stroke="var(--color-mount-glow)"
          strokeWidth={1.5}
          strokeLinecap="square"
          className="hr-glow-chrome"
        >
          {SCAN_BRACKETS.map((bracket, index) => (
            <path
              key={bracket.id}
              d={bracket.d}
              className={animate ? "hr-bracket-in" : undefined}
              style={animate ? ({ "--delay": `${index * BRACKET_STAGGER_MS}ms` } as React.CSSProperties) : undefined}
            />
          ))}
        </g>

        <path
          d={HAND_OUTLINE}
          fill={`url(#${uid}-skin)`}
          stroke="var(--color-hairline)"
          strokeWidth={1.5}
          strokeLinejoin="round"
        />

        {/* Mount dot clusters — under the lines, so a dense mount never washes out a line. */}
        <g fill="var(--color-mount-glow)" className="hr-glow-mount">
          {MOUNTS.map((mount, mountIndex) => {
            const value = mounts[mount.key] ?? 0;
            const isActive = active === mount.key;
            return (
              <g key={`${mount.key}-dots`} opacity={dotOpacity(value)}>
                {(MOUNT_DOTS[mount.key] ?? []).map((dot, dotIndex) => (
                  <circle
                    key={`${mount.key}-${dotIndex}`}
                    cx={dot.cx}
                    cy={dot.cy}
                    r={dotRadius(value, dot.scale) * (isActive ? 1.35 : 1)}
                    className={animate ? "hr-dot-in" : undefined}
                    style={
                      animate
                        ? ({
                            "--delay": `${DOT_BASE_DELAY_MS + (mountIndex * mount.dots + dotIndex) * DOT_STAGGER_MS}ms`,
                          } as React.CSSProperties)
                        : undefined
                    }
                  />
                ))}
              </g>
            );
          })}
        </g>

        {/* Major lines */}
        <g fill="none" strokeLinecap="round" className="hr-glow-line">
          {PALM_LINES.map((line) => {
            const override = lines?.[line.id];
            const d = override !== undefined && override.length > 1 ? polylineToPath(override) : line.d;
            return (
              <path
                key={line.id}
                d={d}
                pathLength={1}
                stroke="var(--color-line-glow)"
                strokeWidth={2}
                className={animate ? "hr-draw" : undefined}
                style={
                  animate
                    ? ({ "--dash": 1, "--delay": `${line.order * LINE_STAGGER_MS}ms` } as React.CSSProperties)
                    : undefined
                }
              />
            );
          })}
        </g>

        {/* Scan sweep — one pass on mount, then gone. */}
        {animate ? (
          <g
            className="hr-sweep"
            style={{ "--sweep-distance": `${PALM_VIEWBOX_HEIGHT}px` } as React.CSSProperties}
            aria-hidden="true"
          >
            <rect x={10} y={0} width={260} height={2} fill={`url(#${uid}-sweep)`} />
          </g>
        ) : null}

        {/* Hit targets last, so nothing paints over them. */}
        {interactive ? (
          <g>
            {MOUNTS.map((mount, index) => {
              const isSelected = selected === mount.key;
              const isActive = active === mount.key;
              return (
                <g
                  key={mount.key}
                  ref={(node) => {
                    nodeRefs.current[index] = node;
                  }}
                  role="radio"
                  aria-checked={isSelected}
                  aria-label={`${mount.label} mount`}
                  tabIndex={tabIndexFor(index)}
                  onClick={() => onSelectMount?.(mount.key)}
                  onKeyDown={(event) => onKeyDown(event, index)}
                  onMouseEnter={() => setHovered(mount.key)}
                  onMouseLeave={() => setHovered(null)}
                  onFocus={() => setHovered(mount.key)}
                  onBlur={() => setHovered(null)}
                  className="cursor-pointer outline-none"
                >
                  <ellipse
                    cx={mount.cx}
                    cy={mount.cy}
                    rx={mount.rx + 3}
                    ry={mount.ry + 3}
                    fill="transparent"
                    stroke={isActive ? "var(--color-mount-glow)" : "var(--color-hairline)"}
                    strokeWidth={isSelected ? 1.75 : 1}
                    strokeDasharray={isSelected ? undefined : "2 5"}
                  />
                  <text
                    x={mount.cx}
                    y={mount.cy + 3.5}
                    textAnchor="middle"
                    fontSize={9}
                    letterSpacing="0.08em"
                    fill="var(--color-ink)"
                    fillOpacity={isActive ? 0.95 : 0.45}
                    className="pointer-events-none select-none uppercase"
                  >
                    {mount.label.split(" ")[0]}
                  </text>
                </g>
              );
            })}
          </g>
        ) : null}
      </svg>

      {interactive ? (
        // Fixed min-height: the caption swaps text without ever moving the layout beneath it.
        <p aria-live="polite" className="mt-4 min-h-[3.5rem] text-sm leading-6 text-muted">
          {activeSpec === null ? (
            "Kisi bhi mount par tap karo — ya arrow keys se ghumo."
          ) : (
            <>
              <span className="font-display font-medium uppercase tracking-wider text-mount-glow">
                {activeSpec.label}
              </span>{" "}
              — {activeSpec.helper}
            </>
          )}
        </p>
      ) : null}
    </div>
  );
}
