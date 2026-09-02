"use client";

/**
 * Ground-truth labeler (sprint Phase 0b, built in 0a-ii — dev-only, see page.tsx).
 *
 * BLANK-SLATE by construction, not by discipline: this file and everything it imports contain no
 * detector code — no segmenter, no ridge/Frangi, no fusion, no extraction (D1, enforced by
 * test/import-boundary.test.ts). What the human sees is the crop plus display-only enhancement
 * (enhance.ts); what the livewire snaps to is the same valley response the CREASE view tints
 * (valley.ts). The CORRECTION mode toggle exists but is locked until the eval set is frozen.
 *
 * Views: V cycles NATURAL → CONTRAST → CREASE · C cycles the gray channel · HOLD Space flips to
 * NATURAL while held (the sanity check against enhancement bias — a crease that vanishes in the
 * natural view earns 'faint', which is also the default confidence when committing from CREASE).
 * L toggles a 3× loupe. Wheel / + / − zoom 1×–8× about the cursor; Shift+drag pans.
 *
 * Tracing: click seeds the livewire; the seed→cursor path previews live in the TRACKING style;
 * a further click appends the simplified path and re-seeds; S toggles snap (off = straight
 * segment); Z undoes the last segment; Enter commits; Esc discards; A marks absent; 1–4 select
 * heart/head/life/fate; drag a vertex to adjust; Backspace deletes the selected vertex.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  CANONICAL_LABEL_SIZE,
  GRAY_CHANNELS,
  LABEL_CONFIDENCES,
  LABEL_LINE_IDS,
  VIEW_MODES,
  cropFileName,
  parseRekhaLabelFile,
  type GrayChannel,
  type LabelConfidence,
  type LabelLineId,
  type SessionMetadata,
  type ViewMode,
} from "@/lib/scan/dev/session-types";
import { openSessionStore, type SessionStore, type SessionSummary } from "@/lib/scan/dev/session-store";
import {
  buildLabelFile,
  emptyLabelerState,
  emptyLineState,
  isComplete,
  type LabelerLineState,
  type LabelerState,
} from "@/lib/scan/dev/labeler-file";
import { toGray, valleyResponse } from "@/lib/scan/dev/valley";
import { renderView } from "@/lib/scan/dev/enhance";
import { Livewire, LIVEWIRE_RADIUS_PX, buildCostMap, simplifyPolyline } from "@/lib/scan/dev/livewire";

/** Stage canvas size in device pixels; the 512 crop centres inside it at zoom 1. */
const STAGE_SIZE = 640;
const ZOOM_MIN = 1;
const ZOOM_MAX = 8;
/** Loupe: LOUPE_SIZE px window at LOUPE_FACTOR× magnification, following the cursor. */
const LOUPE_SIZE = 120;
const LOUPE_FACTOR = 3;
/** Above this measured full-grid seed cost, later seeds fall back to the bounded window. */
const SEED_BUDGET_MS = 60;
/** Antique gold from the brand references — the only stroke colour on the stage. */
const GOLD = "rgba(201, 162, 75, 1)";
const GOLD_DIM = "rgba(201, 162, 75, 0.35)";
/** Hindi display names, matching the app's register (hero art names graha lines; these are the anatomical four). */
const LINE_LABEL: Readonly<Record<LabelLineId, string>> = {
  heart: "हृदय रेखा · Heart",
  head: "मस्तिष्क रेखा · Head",
  life: "जीवन रेखा · Life",
  fate: "शनि रेखा · Fate",
};

interface TraceInProgress {
  /** Committed segments, each a list of [x, y] crop-pixel points. */
  readonly segments: readonly (readonly (readonly number[])[])[];
  /** Whether each segment came from the livewire (true) or a straight line (false). */
  readonly snapped: readonly boolean[];
  readonly seed: readonly [number, number] | null;
}

const EMPTY_TRACE: TraceInProgress = { segments: [], snapped: [], seed: null };

export function LabelClient() {
  /* --------------------------------- Stores --------------------------------- */
  const storeRef = useRef<SessionStore | null>(null);
  const isMountedRef = useRef(false);

  const [sessions, setSessions] = useState<readonly SessionSummary[]>([]);
  const [session, setSession] = useState<SessionMetadata | null>(null);
  const [labeled, setLabeled] = useState<ReadonlySet<number>>(new Set());
  const [stillIndex, setStillIndex] = useState<number | null>(null);
  const [note, setNote] = useState<string | null>(null);

  /* ------------------------------ Stage + image ------------------------------ */
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const loupeRef = useRef<HTMLCanvasElement | null>(null);
  const baseCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const stillDataRef = useRef<{
    rgba: Uint8ClampedArray;
    valley: Float32Array;
    livewire: Livewire;
  } | null>(null);
  const viewCacheRef = useRef<Map<string, ImageData>>(new Map());
  const rafRef = useRef(0);
  const loopRef = useRef<(() => void) | null>(null);

  const [view, setView] = useState<ViewMode>("NATURAL");
  const [channel, setChannel] = useState<GrayChannel>("LUMA");
  const [spaceHeld, setSpaceHeld] = useState(false);
  const [loupeOn, setLoupeOn] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [seedCostMs, setSeedCostMs] = useState<number | null>(null);
  const panRef = useRef<{ x: number; y: number }>({ x: (STAGE_SIZE - CANONICAL_LABEL_SIZE) / 2, y: (STAGE_SIZE - CANONICAL_LABEL_SIZE) / 2 });
  const zoomRef = useRef(1);
  const cursorRef = useRef<{ x: number; y: number } | null>(null);
  const boundedSeedsRef = useRef(false);
  const panningRef = useRef<{ startX: number; startY: number; panX: number; panY: number } | null>(null);
  const draggingVertexRef = useRef<number | null>(null);

  /* -------------------------------- Labeling -------------------------------- */
  const [lines, setLines] = useState<Readonly<Record<LabelLineId, LabelerLineState>>>(emptyLabelerState().lines);
  const [activeId, setActiveId] = useState<LabelLineId>("heart");
  const [selectedVertex, setSelectedVertex] = useState<number | null>(null);
  const [snapOn, setSnapOn] = useState(true);
  const [dirty, setDirty] = useState(false);
  // Lazy read: localStorage is a dev convenience; SSR and blocked storage both fall back to "".
  const [labelerId, setLabelerId] = useState(() => {
    try {
      return typeof window === "undefined" ? "" : (window.localStorage.getItem("hastrekha-labeler-id") ?? "");
    } catch {
      return "";
    }
  });
  const traceRef = useRef<TraceInProgress>(EMPTY_TRACE);
  const livePathRef = useRef<number[]>([]);
  const linesRef = useRef(lines);
  const activeIdRef = useRef(activeId);
  const viewRef = useRef(view);
  const spaceHeldRef = useRef(spaceHeld);
  const channelRef = useRef(channel);
  const snapRef = useRef(snapOn);
  const selectedVertexRef = useRef(selectedVertex);
  // The rAF draw loop reads through refs so it never closes over stale state; synced post-render.
  useEffect(() => {
    linesRef.current = lines;
    activeIdRef.current = activeId;
    viewRef.current = view;
    spaceHeldRef.current = spaceHeld;
    channelRef.current = channel;
    snapRef.current = snapOn;
    selectedVertexRef.current = selectedVertex;
  }, [lines, activeId, view, spaceHeld, channel, snapOn, selectedVertex]);

  /* ------------------------------ Store lifecycle ------------------------------ */

  useEffect(() => {
    isMountedRef.current = true;
    void (async () => {
      const store = await openSessionStore();
      storeRef.current = store;
      if (isMountedRef.current) setSessions(await store.listSessions());
    })();
    return () => {
      isMountedRef.current = false;
      cancelAnimationFrame(rafRef.current);
    };
  }, []);

  const persistLabelerId = useCallback((value: string): void => {
    setLabelerId(value);
    try {
      window.localStorage.setItem("hastrekha-labeler-id", value);
    } catch {
      /* dev convenience only */
    }
  }, []);

  /* ------------------------------- Still loading ------------------------------- */

  const openStill = useCallback(async (meta: SessionMetadata, index: number): Promise<void> => {
    const store = storeRef.current;
    if (store === null) return;
    const blob = await store.getBlob(meta.sessionId, `selected/${cropFileName(index)}`);
    if (blob === null) {
      setNote(`crop ${index} is not staged — capture se dobara export karo`);
      return;
    }
    const bitmap = await createImageBitmap(blob);
    const canvas = document.createElement("canvas");
    canvas.width = CANONICAL_LABEL_SIZE;
    canvas.height = CANONICAL_LABEL_SIZE;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (context === null) return;
    context.drawImage(bitmap, 0, 0, CANONICAL_LABEL_SIZE, CANONICAL_LABEL_SIZE);
    bitmap.close();
    const rgba = context.getImageData(0, 0, CANONICAL_LABEL_SIZE, CANONICAL_LABEL_SIZE).data;

    // The shared operator: the CREASE view and the livewire cost are this same plane.
    const gray = toGray(rgba, CANONICAL_LABEL_SIZE, channelRef.current);
    const valley = valleyResponse(gray, CANONICAL_LABEL_SIZE);
    const livewire = new Livewire(buildCostMap(valley, CANONICAL_LABEL_SIZE), CANONICAL_LABEL_SIZE);

    stillDataRef.current = { rgba, valley, livewire };
    viewCacheRef.current.clear();
    traceRef.current = EMPTY_TRACE;
    livePathRef.current = [];
    boundedSeedsRef.current = false;

    // Restore a staged label for this still, or start clean.
    const existing = await store.getLabel(meta.sessionId, index);
    if (existing !== null) {
      const restored: Record<LabelLineId, LabelerLineState> = {
        heart: emptyLineState(),
        head: emptyLineState(),
        life: emptyLineState(),
        fate: emptyLineState(),
      };
      for (const line of existing.lines) {
        restored[line.id] = {
          points: line.points,
          absent: line.absent,
          confidence: line.confidence ?? "clear",
          method: line.method ?? "manual",
          viewAtCommit: line.viewAtCommit ?? "NATURAL",
          done: true,
        };
      }
      setLines(restored);
    } else {
      setLines(emptyLabelerState().lines);
    }
    setStillIndex(index);
    setSelectedVertex(null);
    setDirty(false);
    setSeedCostMs(null);
    setNote(null);
  }, []);

  const openSession = useCallback(
    async (sessionId: string): Promise<void> => {
      const store = storeRef.current;
      if (store === null) return;
      const meta = await store.getSession(sessionId);
      if (meta === null) return;
      setSession(meta);
      setLabeled(new Set(await store.listLabels(sessionId)));
      setStillIndex(null);
      stillDataRef.current = null;
      if (meta.stills.length > 0) void openStill(meta, meta.stills[0].index);
    },
    [openStill],
  );

  /* ------------------------------ View rendering ------------------------------ */

  const currentViewImage = useCallback((): ImageData | null => {
    const still = stillDataRef.current;
    if (still === null) return null;
    const mode: ViewMode = spaceHeldRef.current ? "NATURAL" : viewRef.current;
    const key = `${mode}|${channelRef.current}`;
    const cache = viewCacheRef.current;
    let image = cache.get(key);
    if (image === undefined) {
      image = renderView(still.rgba, CANONICAL_LABEL_SIZE, mode, channelRef.current, still.valley);
      cache.set(key, image);
    }
    return image;
  }, []);

  /* --------------------------------- Drawing --------------------------------- */

  const draw = useCallback((): void => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (canvas === undefined || canvas === null || context === null || context === undefined) {
      rafRef.current = requestAnimationFrame(() => loopRef.current?.());
      return;
    }
    const scale = zoomRef.current;
    const pan = panRef.current;
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.fillStyle = "#0d0b09";
    context.fillRect(0, 0, STAGE_SIZE, STAGE_SIZE);

    const image = currentViewImage();
    if (image !== null) {
      let base = baseCanvasRef.current;
      if (base === null) {
        base = document.createElement("canvas");
        base.width = CANONICAL_LABEL_SIZE;
        base.height = CANONICAL_LABEL_SIZE;
        baseCanvasRef.current = base;
      }
      base.getContext("2d")?.putImageData(image, 0, 0);
      context.imageSmoothingEnabled = scale > 1;
      context.imageSmoothingQuality = "high";
      context.setTransform(scale, 0, 0, scale, pan.x, pan.y);
      context.drawImage(base, 0, 0);

      /*
       * Stroke ladder (spec §1 + the six brand references): SOLID only, gold on near-black.
       * Committed unselected 1px/0.35 · active line and live path 2px/1.0 with a soft glow.
       */
      const drawPoly = (pts: readonly (readonly number[])[], emphasised: boolean, fractions: boolean): void => {
        if (pts.length < 2) return;
        context.beginPath();
        for (let i = 0; i < pts.length; i += 1) {
          const px = fractions ? pts[i][0] * CANONICAL_LABEL_SIZE : pts[i][0];
          const py = fractions ? pts[i][1] * CANONICAL_LABEL_SIZE : pts[i][1];
          if (i === 0) context.moveTo(px, py);
          else context.lineTo(px, py);
        }
        context.strokeStyle = emphasised ? GOLD : GOLD_DIM;
        context.lineWidth = (emphasised ? 2 : 1) / scale;
        context.shadowColor = emphasised ? "rgba(201, 162, 75, 0.6)" : "transparent";
        context.shadowBlur = emphasised ? 6 / scale : 0;
        context.stroke();
        context.shadowBlur = 0;
      };

      const state = linesRef.current;
      for (const id of LABEL_LINE_IDS) {
        const line = state[id];
        if (line.absent || line.points.length < 2) continue;
        drawPoly(line.points, id === activeIdRef.current, true);
      }

      // Active line vertices — draggable, selected one filled.
      const active = state[activeIdRef.current];
      if (!active.absent && active.points.length > 0) {
        for (let i = 0; i < active.points.length; i += 1) {
          const px = active.points[i][0] * CANONICAL_LABEL_SIZE;
          const py = active.points[i][1] * CANONICAL_LABEL_SIZE;
          context.beginPath();
          context.arc(px, py, 3 / scale, 0, Math.PI * 2);
          context.fillStyle = i === selectedVertexRef.current ? GOLD : "rgba(201, 162, 75, 0.5)";
          context.fill();
        }
      }

      // In-progress trace: committed segments + live seed→cursor path, TRACKING style.
      const trace = traceRef.current;
      for (const segment of trace.segments) drawPoly(segment, true, false);
      if (trace.seed !== null) {
        const live = livePathRef.current;
        if (live.length >= 4) {
          const pts: number[][] = [];
          for (let i = 0; i < live.length; i += 2) pts.push([live[i], live[i + 1]]);
          drawPoly(pts, true, false);
        }
        context.beginPath();
        context.arc(trace.seed[0], trace.seed[1], 4 / scale, 0, Math.PI * 2);
        context.strokeStyle = GOLD;
        context.lineWidth = 1.5 / scale;
        context.stroke();
      }
    }

    // Loupe — 3× of the composited stage, following the cursor.
    const loupe = loupeRef.current;
    const cursor = cursorRef.current;
    if (loupe !== null) {
      if (loupeOn && cursor !== null && canvas !== null) {
        loupe.style.display = "block";
        loupe.style.left = `${cursor.x * scale + pan.x + 16}px`;
        loupe.style.top = `${cursor.y * scale + pan.y + 16}px`;
        const lctx = loupe.getContext("2d");
        if (lctx !== null) {
          const window = LOUPE_SIZE / LOUPE_FACTOR;
          lctx.setTransform(1, 0, 0, 1, 0, 0);
          lctx.imageSmoothingEnabled = false;
          lctx.clearRect(0, 0, LOUPE_SIZE, LOUPE_SIZE);
          lctx.drawImage(
            canvas,
            cursor.x * scale + pan.x - window / 2,
            cursor.y * scale + pan.y - window / 2,
            window,
            window,
            0,
            0,
            LOUPE_SIZE,
            LOUPE_SIZE,
          );
        }
      } else {
        loupe.style.display = "none";
      }
    }

    rafRef.current = requestAnimationFrame(() => loopRef.current?.());
  }, [currentViewImage, loupeOn]);

  useEffect(() => {
    loopRef.current = draw;
  }, [draw]);

  useEffect(() => {
    rafRef.current = requestAnimationFrame(() => loopRef.current?.());
    return () => cancelAnimationFrame(rafRef.current);
  }, []);

  /* ------------------------------- Interactions ------------------------------- */

  const toImage = useCallback((event: { clientX: number; clientY: number }): { x: number; y: number } | null => {
    const canvas = canvasRef.current;
    if (canvas === null) return null;
    const rect = canvas.getBoundingClientRect();
    const x = ((event.clientX - rect.left) * (STAGE_SIZE / rect.width) - panRef.current.x) / zoomRef.current;
    const y = ((event.clientY - rect.top) * (STAGE_SIZE / rect.height) - panRef.current.y) / zoomRef.current;
    if (x < 0 || y < 0 || x >= CANONICAL_LABEL_SIZE || y >= CANONICAL_LABEL_SIZE) return null;
    return { x, y };
  }, []);

  const reseed = useCallback((x: number, y: number): void => {
    const still = stillDataRef.current;
    if (still === null) return;
    if (boundedSeedsRef.current) {
      still.livewire.setSeed(x, y, LIVEWIRE_RADIUS_PX);
    } else {
      still.livewire.setSeed(x, y);
      // Spec: full grid while it stays under budget; bound the window once it measures slower.
      if (still.livewire.seedCostMs > SEED_BUDGET_MS) boundedSeedsRef.current = true;
    }
    setSeedCostMs(still.livewire.seedCostMs);
  }, []);

  const updateLine = useCallback((id: LabelLineId, patch: Partial<LabelerLineState>): void => {
    setLines((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));
    setDirty(true);
  }, []);

  const handlePointerDown = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>): void => {
      const point = toImage(event);
      if (point === null) return;
      if (event.shiftKey) {
        panningRef.current = { startX: event.clientX, startY: event.clientY, panX: panRef.current.x, panY: panRef.current.y };
        return;
      }
      // Vertex grab on the active committed line first.
      const active = linesRef.current[activeIdRef.current];
      if (!active.absent && active.points.length > 0 && traceRef.current.seed === null) {
        const scale = zoomRef.current;
        for (let i = 0; i < active.points.length; i += 1) {
          const px = active.points[i][0] * CANONICAL_LABEL_SIZE;
          const py = active.points[i][1] * CANONICAL_LABEL_SIZE;
          if (Math.hypot(px - point.x, py - point.y) < 6 / scale + 3) {
            setSelectedVertex(i);
            draggingVertexRef.current = i;
            return;
          }
        }
      }
      // Trace: first click seeds; further clicks append the current path and re-seed.
      const trace = traceRef.current;
      if (trace.seed === null) {
        traceRef.current = { segments: [], snapped: [], seed: [point.x, point.y] };
        reseed(point.x, point.y);
      } else {
        const still = stillDataRef.current;
        let segment: number[][];
        let snapped = false;
        if (snapRef.current && still !== null && still.livewire.covers(point.x, point.y)) {
          const flat = livePathRef.current;
          const pts: number[][] = [];
          for (let i = 0; i < flat.length; i += 2) pts.push([flat[i], flat[i + 1]]);
          segment = simplifyPolyline(pts);
          snapped = true;
        } else {
          segment = [
            [trace.seed[0], trace.seed[1]],
            [point.x, point.y],
          ];
        }
        traceRef.current = {
          segments: [...trace.segments, segment],
          snapped: [...trace.snapped, snapped],
          seed: [point.x, point.y],
        };
        reseed(point.x, point.y);
      }
      livePathRef.current = [];
    },
    [reseed, toImage],
  );

  const handlePointerMove = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>): void => {
      const panning = panningRef.current;
      if (panning !== null) {
        const canvas = canvasRef.current;
        if (canvas === null) return;
        const rect = canvas.getBoundingClientRect();
        const factor = STAGE_SIZE / rect.width;
        panRef.current = {
          x: panning.panX + (event.clientX - panning.startX) * factor,
          y: panning.panY + (event.clientY - panning.startY) * factor,
        };
        return;
      }
      const point = toImage(event);
      if (point === null) return;
      cursorRef.current = point;
      const dragging = draggingVertexRef.current;
      if (dragging !== null) {
        const id = activeIdRef.current;
        const points = linesRef.current[id].points.map((p, i) =>
          i === dragging ? [point.x / CANONICAL_LABEL_SIZE, point.y / CANONICAL_LABEL_SIZE] : p,
        );
        updateLine(id, { points });
        return;
      }
      const trace = traceRef.current;
      const still = stillDataRef.current;
      if (trace.seed !== null && still !== null) {
        if (snapRef.current && still.livewire.covers(point.x, point.y)) {
          still.livewire.pathTo(point.x, point.y, livePathRef.current);
        } else {
          livePathRef.current = [trace.seed[0], trace.seed[1], point.x, point.y];
        }
      }
    },
    [toImage, updateLine],
  );

  const handlePointerUp = useCallback((): void => {
    panningRef.current = null;
    draggingVertexRef.current = null;
  }, []);

  const applyZoom = useCallback((next: number, aboutX: number, aboutY: number): void => {
    const clamped = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, next));
    const previous = zoomRef.current;
    if (clamped === previous) return;
    // Keep the point under the cursor stationary while the scale changes.
    panRef.current = {
      x: panRef.current.x - aboutX * (clamped - previous),
      y: panRef.current.y - aboutY * (clamped - previous),
    };
    zoomRef.current = clamped;
    setZoom(clamped);
  }, []);

  const handleWheel = useCallback(
    (event: React.WheelEvent<HTMLCanvasElement>): void => {
      const point = toImage(event);
      const about = point ?? { x: CANONICAL_LABEL_SIZE / 2, y: CANONICAL_LABEL_SIZE / 2 };
      applyZoom(zoomRef.current * (event.deltaY < 0 ? 1.2 : 1 / 1.2), about.x, about.y);
    },
    [applyZoom, toImage],
  );

  /* ------------------------------- Line actions ------------------------------- */

  const commitActive = useCallback((): void => {
    const trace = traceRef.current;
    if (trace.seed === null || trace.segments.length === 0) return;
    const merged: number[][] = [];
    for (const segment of trace.segments) {
      for (const p of segment) {
        const last = merged[merged.length - 1];
        if (last === undefined || last[0] !== p[0] || last[1] !== p[1]) merged.push([p[0], p[1]]);
      }
    }
    if (merged.length < 2) return;
    const id = activeIdRef.current;
    const committedView: ViewMode = viewRef.current;
    updateLine(id, {
      points: merged.map((p) => [p[0] / CANONICAL_LABEL_SIZE, p[1] / CANONICAL_LABEL_SIZE]),
      absent: false,
      // CREASE-committed lines default to 'faint': the enhanced view shows what the natural view
      // may not support, and the Space-flip check is exactly for upgrading this by eye.
      confidence: committedView === "CREASE" ? "faint" : "clear",
      method: trace.snapped.some(Boolean) ? "livewire" : "manual",
      viewAtCommit: committedView,
      done: true,
    });
    traceRef.current = EMPTY_TRACE;
    livePathRef.current = [];
  }, [updateLine]);

  const discardTrace = useCallback((): void => {
    traceRef.current = EMPTY_TRACE;
    livePathRef.current = [];
  }, []);

  const undoSegment = useCallback((): void => {
    const trace = traceRef.current;
    if (trace.segments.length === 0) return;
    const remaining = trace.segments.slice(0, -1);
    const last = remaining[remaining.length - 1];
    traceRef.current = {
      segments: remaining,
      snapped: trace.snapped.slice(0, -1),
      seed: last !== undefined ? [last[last.length - 1][0], last[last.length - 1][1]] : trace.seed,
    };
    if (traceRef.current.seed !== null) reseed(traceRef.current.seed[0], traceRef.current.seed[1]);
  }, [reseed]);

  const toggleAbsent = useCallback((id: LabelLineId): void => {
    const line = linesRef.current[id];
    if (line.absent) updateLine(id, { absent: false, done: false });
    else updateLine(id, { absent: true, points: [], done: true });
    discardTrace();
  }, [discardTrace, updateLine]);

  const deleteVertex = useCallback((): void => {
    const at = selectedVertexRef.current;
    const id = activeIdRef.current;
    const line = linesRef.current[id];
    if (at === null || line.points.length <= 2) return;
    updateLine(id, { points: line.points.filter((_, i) => i !== at) });
    setSelectedVertex(null);
  }, [updateLine]);

  /* --------------------------------- Hotkeys --------------------------------- */

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement) return;
      if (event.code === "Space") {
        event.preventDefault();
        setSpaceHeld(true);
        return;
      }
      const digit = Number.parseInt(event.key, 10);
      if (digit >= 1 && digit <= 4) {
        setActiveId(LABEL_LINE_IDS[digit - 1]);
        discardTrace();
        return;
      }
      switch (event.key.toLowerCase()) {
        case "v":
          setView((prev) => VIEW_MODES[(VIEW_MODES.indexOf(prev) + 1) % VIEW_MODES.length]);
          break;
        case "c":
          setChannel((prev) => {
            const next = GRAY_CHANNELS[(GRAY_CHANNELS.indexOf(prev) + 1) % GRAY_CHANNELS.length];
            // The valley plane depends on the channel; rebuild lazily by reopening the still.
            const meta = session;
            const index = stillIndex;
            if (meta !== null && index !== null) {
              window.setTimeout(() => void openStill(meta, index), 0);
            }
            return next;
          });
          break;
        case "s":
          setSnapOn((prev) => !prev);
          break;
        case "l":
          setLoupeOn((prev) => !prev);
          break;
        case "z":
          undoSegment();
          break;
        case "a":
          toggleAbsent(activeIdRef.current);
          break;
        case "enter":
          commitActive();
          break;
        case "escape":
          discardTrace();
          break;
        case "backspace":
          event.preventDefault();
          deleteVertex();
          break;
        case "+":
        case "=":
          applyZoom(zoomRef.current * 1.2, CANONICAL_LABEL_SIZE / 2, CANONICAL_LABEL_SIZE / 2);
          break;
        case "-":
          applyZoom(zoomRef.current / 1.2, CANONICAL_LABEL_SIZE / 2, CANONICAL_LABEL_SIZE / 2);
          break;
        default:
          break;
      }
    };
    const onKeyUp = (event: KeyboardEvent): void => {
      if (event.code === "Space") setSpaceHeld(false);
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [applyZoom, commitActive, deleteVertex, discardTrace, openStill, session, stillIndex, toggleAbsent, undoSegment]);

  /* ------------------------------- Save / export ------------------------------- */

  const complete = isComplete({ lines, mode: "blank_slate", channel });

  const save = useCallback(async (): Promise<void> => {
    const store = storeRef.current;
    const meta = session;
    if (store === null || meta === null || stillIndex === null || labelerId.length === 0) return;
    try {
      const state: LabelerState = { lines: linesRef.current, mode: "blank_slate", channel: channelRef.current };
      const file = buildLabelFile(state, meta, stillIndex, labelerId, new Date().toISOString());
      // The client never trusts its own construction: the same validator the loader uses gates it.
      if (parseRekhaLabelFile(JSON.stringify(file)) === null) throw new Error("built label failed validation");
      await store.addLabel(meta.sessionId, stillIndex, file);
      setLabeled(new Set(await store.listLabels(meta.sessionId)));
      setDirty(false);
      setNote(`label ${stillIndex} staged`);
    } catch (saveError) {
      setNote(saveError instanceof Error ? saveError.message : "save failed");
    }
  }, [labelerId, session, stillIndex]);

  const exportSession = useCallback(async (): Promise<void> => {
    const store = storeRef.current;
    const meta = session;
    if (store === null || meta === null) return;
    setNote("Export chal raha hai…");
    try {
      let dir = await store.storedExportDirectory();
      if (dir === null) dir = await store.pickExportDirectory();
      if (dir === null) {
        setNote("File System Access API nahi hai — Chrome/Edge use karo.");
        return;
      }
      const files = await store.exportSession(meta.sessionId, dir);
      setNote(`Saved — ${files} files (labels + stills) + metadata.json`);
    } catch (exportError) {
      setNote(exportError instanceof Error ? exportError.message : "export failed");
    }
  }, [session]);

  /* ----------------------------------- View ----------------------------------- */

  const shownView: ViewMode = spaceHeld ? "NATURAL" : view;

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-7xl flex-col gap-4 px-4 py-6">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h1 className="font-display text-2xl text-ink">Labeler</h1>
          <p className="text-sm text-muted">Blank-slate ground truth — detector output yahan kabhi render nahi hota.</p>
        </div>
        <div className="flex items-center gap-3 text-xs" role="radiogroup" aria-label="Labeler mode">
          <label className="flex items-center gap-1.5 text-ink">
            <input type="radio" name="mode" checked readOnly /> EVAL (blank slate)
          </label>
          <label className="flex items-center gap-1.5 text-muted" title="locked until eval set is frozen">
            <input type="radio" name="mode" disabled /> CORRECTION{" "}
            <span className="rounded-full border border-hairline px-2 py-0.5">locked until eval set is frozen</span>
          </label>
        </div>
      </header>

      <div className="grid gap-4 lg:grid-cols-[220px_minmax(0,1fr)_260px]">
        {/* Left: sessions + still strip. */}
        <aside className="flex flex-col gap-3" aria-label="Sessions">
          <label className="flex flex-col gap-1 text-xs text-muted">
            Labeler id
            <input
              value={labelerId}
              onChange={(event) => persistLabelerId(event.target.value)}
              placeholder="srijan"
              className="rounded-lg border border-hairline bg-transparent px-2 py-1 text-sm text-ink"
            />
          </label>
          <ul className="flex flex-col gap-1 text-xs" aria-label="Staged sessions">
            {sessions.map((summary) => (
              <li key={summary.sessionId}>
                <button
                  type="button"
                  onClick={() => void openSession(summary.sessionId)}
                  className={`w-full rounded-lg border px-2 py-1.5 text-left transition-colors hover:border-mount-glow ${
                    session?.sessionId === summary.sessionId ? "border-mount-glow text-mount-glow" : "border-hairline text-ink"
                  }`}
                >
                  {summary.sessionId}
                  <span className="block text-muted">
                    {summary.hand} · {summary.stillCount} stills
                  </span>
                </button>
              </li>
            ))}
            {sessions.length === 0 ? <li className="text-muted">Kuch staged nahi — pehle /dev/capture.</li> : null}
          </ul>
          {session !== null ? (
            <ul className="flex flex-col gap-1 text-xs" aria-label="Stills">
              {session.stills.map((still) => (
                <li key={still.index}>
                  <button
                    type="button"
                    onClick={() => void openStill(session, still.index)}
                    className={`flex w-full items-center justify-between rounded-lg border px-2 py-1 transition-colors hover:border-mount-glow ${
                      stillIndex === still.index ? "border-mount-glow text-mount-glow" : "border-hairline text-ink"
                    }`}
                  >
                    <span>#{still.index}</span>
                    <span className={labeled.has(still.index) ? "text-mount-glow" : "text-muted"}>
                      {labeled.has(still.index) ? "labelled" : "—"}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </aside>

        {/* Centre: the stage. */}
        <section aria-label="Labeling stage" className="relative flex flex-col gap-2">
          <canvas
            ref={canvasRef}
            width={STAGE_SIZE}
            height={STAGE_SIZE}
            aria-label="Canonical palm crop for labeling"
            className="w-full max-w-[640px] cursor-crosshair rounded-2xl border border-hairline bg-black"
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onWheel={handleWheel}
          />
          <canvas
            ref={loupeRef}
            width={LOUPE_SIZE}
            height={LOUPE_SIZE}
            aria-hidden="true"
            className="pointer-events-none absolute rounded-full border border-mount-glow"
            style={{ display: "none" }}
          />
          {/* HUD */}
          <dl aria-label="Stage readout" className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
            <div>still <span className="text-ink">{stillIndex ?? "—"}</span></div>
            <div>zoom <span className="tabular-nums text-ink">{zoom.toFixed(1)}×</span></div>
            <div>view <span className="text-ink">{shownView}{spaceHeld ? " (held)" : ""}</span></div>
            <div>channel <span className="text-ink">{channel}</span></div>
            <div>snap <span className="text-ink">{snapOn ? "on" : "off"}</span></div>
            <div>seed <span className="tabular-nums text-ink">{seedCostMs === null ? "—" : `${seedCostMs.toFixed(0)} ms`}</span></div>
            <div>lines <span className="tabular-nums text-ink">{LABEL_LINE_IDS.filter((id) => lines[id].done).length}/4</span></div>
            {dirty ? <div className="text-line-glow">unsaved</div> : null}
          </dl>
          <p className="text-[0.7rem] leading-5 text-muted">
            1–4 line · click seed/append · S snap · Z undo · Enter commit · Esc cancel · A absent · V view · C channel ·
            Space hold = natural · L loupe · wheel/± zoom · Shift+drag pan · Backspace delete vertex
          </p>
        </section>

        {/* Right: line panel. */}
        <aside className="flex flex-col gap-2" aria-label="Lines">
          {LABEL_LINE_IDS.map((id, index) => {
            const line = lines[id];
            return (
              <section
                key={id}
                aria-label={LINE_LABEL[id]}
                className={`rounded-2xl border p-3 ${id === activeId ? "border-mount-glow" : "border-hairline"}`}
              >
                <button type="button" onClick={() => setActiveId(id)} className="flex w-full items-baseline justify-between text-left">
                  <span className={id === activeId ? "text-mount-glow" : "text-ink"}>
                    {index + 1} · {LINE_LABEL[id]}
                  </span>
                  <span className="text-xs text-muted">
                    {line.absent ? "ABSENT" : line.done ? `${line.points.length} pts` : "—"}
                  </span>
                </button>
                <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                  <label className="flex items-center gap-1 text-muted">
                    <input type="checkbox" checked={line.absent} onChange={() => toggleAbsent(id)} /> absent
                  </label>
                  <label className="flex items-center gap-1 text-muted">
                    confidence
                    <select
                      value={line.confidence}
                      onChange={(event) => updateLine(id, { confidence: event.target.value as LabelConfidence })}
                      disabled={line.absent}
                      className="rounded border border-hairline bg-transparent px-1 py-0.5 text-ink"
                    >
                      {LABEL_CONFIDENCES.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>
                  </label>
                  {line.done && !line.absent ? (
                    <span className="text-muted">
                      {line.method} · {line.viewAtCommit}
                    </span>
                  ) : null}
                </div>
              </section>
            );
          })}
          <div className="mt-2 flex flex-col gap-2">
            <button
              type="button"
              onClick={() => void save()}
              disabled={!complete || labelerId.length === 0 || stillIndex === null}
              className="rounded-full border border-hairline px-4 py-2 text-sm text-ink transition-colors hover:border-mount-glow hover:text-mount-glow disabled:opacity-40"
            >
              Save label
            </button>
            <button
              type="button"
              onClick={() => void exportSession()}
              disabled={session === null}
              className="rounded-full border border-hairline px-4 py-2 text-sm text-ink transition-colors hover:border-mount-glow hover:text-mount-glow disabled:opacity-40"
            >
              Export session
            </button>
            <span aria-live="polite" className="text-xs text-muted">
              {note}
            </span>
          </div>
        </aside>
      </div>
    </main>
  );
}
