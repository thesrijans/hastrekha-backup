"use client";

import { Fragment, useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { LandmarkMetrics } from "@/lib/scan/features";
import type { RectifyResult } from "@/lib/scan/rectify";
import { ALL_CHECKS } from "@/lib/scan/quality";
import type { CompletionResult } from "@/lib/scan/completion";
import { firstStall, TELEMETRY_STAGES, TELEMETRY_WINDOW_MS, type TelemetryStage } from "@/lib/scan/telemetry";
import { scanFlags, SCAN_FLAG_LABELS, SCAN_FLAG_NAMES } from "@/lib/scan/flags";
import { LUMA_TARGET_HIGH, LUMA_TARGET_LOW, type CameraControlState } from "@/lib/scan/camera-control";
import type { SegmenterDiagnostics } from "@/lib/scan/segmenter";
import { RECTIFIED_SIZE, type FrameStats, type QualityVerdict } from "@/lib/scan/types";

type MaskView = "crop" | "fused" | "unet" | "ridge" | "frangi" | "median" | "photometric";

/**
 * One toggle per evidence channel, in pipeline order.
 *
 * Comparing channels on the same frame is how the merge weights get tuned and how a broken stage is
 * caught: the classical ridge field is the ground the UNet has to beat, Frangi is what should be
 * *cleaner* than ridge rather than merely different, and a photometric channel that lights up
 * anywhere but along existing lines means its mask or its gate is wrong.
 */
const VIEWS: ReadonlyArray<{ readonly id: MaskView; readonly label: string }> = [
  { id: "crop", label: "Crop" },
  { id: "fused", label: "Fused" },
  { id: "ridge", label: "Ridge" },
  { id: "frangi", label: "Frangi" },
  { id: "median", label: "Median" },
  { id: "photometric", label: "Photo" },
  { id: "unet", label: "UNet" },
];

/** Displayed per-stage timing keys, in pipeline order. */
const TIMING_KEYS: readonly string[] = ["fast", "clahe", "blackhat", "gabor", "unet", "fullhandWarp", "fullhandRemap", "total"];

export interface DebugPanelProps {
  readonly rectified: RectifyResult | null;
  /** Fused (EMA) probability field. */
  readonly fused: Float32Array | null;
  /** Raw per-detector fields from the last inference. */
  readonly stageMasks: {
    readonly unet: Float32Array | null;
    readonly ridge: Float32Array;
    readonly frangi: Float32Array | null;
    readonly median: Float32Array | null;
    readonly photometric: Float32Array | null;
  } | null;
  readonly stageTimings: Readonly<Record<string, number>> | null;
  readonly metrics: LandmarkMetrics | null;
  readonly quality: QualityVerdict;
  readonly stats: FrameStats;
  readonly fps: number;
  readonly backend: string;
  readonly inferenceMs: number;
  /** Segmenter startup + failure trail. Null before the segmenter is created. */
  readonly diagnostics: SegmenterDiagnostics | null;
  readonly fusedConfidence: number;
  readonly traceCount: number;
  readonly branchPoints: number;
  /** Milliseconds from scan start to the first drawable trace — the headline latency number. */
  readonly timeToFirstTraceMs: number | null;
  /** `performance.now()` of the last extraction that produced traces; the HUD shows its age. */
  readonly traceEvidenceAtMs: number;
  /** What the last crop-space alignment decision was. */
  readonly alignment: { readonly outcome: string; readonly displacement: number; readonly warps: number } | null;
  /** Photometric channel progress: poses folded in, tilt span observed, weight earned. */
  readonly photometric: { readonly samples: number; readonly weight: number; readonly tiltSpan: number } | null;
  /** Per-line completion outcome, so a refused line says why. */
  readonly completion: CompletionResult | null;
  /** Rolling per-stage frame counts. The first zero after a non-zero is where frames are lost. */
  readonly telemetry: Readonly<Record<TelemetryStage, number>>;
  /** Polylines actually stroked onto the canvas — measured at the draw, not inferred from state. */
  readonly polylinesDrawn: number;
  /** Camera-control state, or null while the flag is off. */
  readonly camera: CameraControlState | null;
  /** Mean detector response over the palm interior — whether any of this measurably helped. */
  readonly contrast: number;
  /** Frames gathered by the exposure bracket, when that flag is on and exposure is settable. */
  readonly bracketFrames: number;
  /**
   * True when landmarks fall outside the frame.
   *
   * The scan keeps accumulating evidence — a partly-clipped palm still shows real creases — but no
   * line features are emitted, because the crop was fitted partly to landmarks MediaPipe guessed and
   * a line placed from guessed geometry is worse than no line.
   */
  readonly degraded: boolean;
  /** Captures the raw frame plus its derived geometry. Null result means nothing was ready. */
  readonly onExportFrame: () => Promise<{ png: Blob; json: Blob; stamp: string } | null>;
  /** Lane E: stage the current frame as a labelable eval-case session. Null when unavailable. */
  readonly onExportEvalCase?: () => Promise<string | null>;
  /** Live PALM_EDGE_PEAK used by the overlay, and its setter. Dev-only tuning. */
  readonly edgePeak: number;
  readonly onEdgePeak: (value: number) => void;
}

/** Paints a probability field as a colour ramp on black, so faint responses stay visible. */
function paintField(
  context: CanvasRenderingContext2D,
  field: Float32Array,
  ramp: readonly [number, number, number],
): void {
  // Sized from the field itself: the detector channels and the crop are at different resolutions,
  // and painting one into the other's box silently shows a quarter of the data stretched over all of it.
  const side = Math.round(Math.sqrt(field.length));
  const image = context.createImageData(side, side);
  for (let i = 0; i < field.length; i += 1) {
    const value = Math.max(0, Math.min(1, field[i]));
    const at = i * 4;
    image.data[at] = Math.round(ramp[0] * value);
    image.data[at + 1] = Math.round(ramp[1] * value);
    image.data[at + 2] = Math.round(ramp[2] * value);
    image.data[at + 3] = 255;
  }
  context.putImageData(image, 0, 0);
}

/**
 * Scan debug view.
 *
 * The mask viewer cycles four states over the same 256² box: the rectified crop, the fused EMA the
 * pipeline consumes, and the two raw detector fields (UNet, ridge) from the last inference.
 * Comparing UNet against ridge on the same frame is how the fusion weights get tuned — and how a
 * bad model export gets caught, because the ridge field is the classical ground the model must beat.
 *
 * Every gate check renders individually because the user-facing HUD shows only one hint at a time —
 * without this breakdown a mis-signed palm-facing test looks like a distance problem.
 */
export function DebugPanel({
  rectified,
  fused,
  stageMasks,
  stageTimings,
  metrics,
  quality,
  stats,
  fps,
  backend,
  inferenceMs,
  diagnostics,
  fusedConfidence,
  traceCount,
  branchPoints,
  timeToFirstTraceMs,
  traceEvidenceAtMs,
  alignment,
  photometric,
  completion,
  telemetry,
  polylinesDrawn,
  camera,
  contrast,
  bracketFrames,
  degraded,
  onExportFrame,
  onExportEvalCase,
  edgePeak,
  onEdgePeak,
}: DebugPanelProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [view, setView] = useState<MaskView>("crop");
  const [exportState, setExportState] = useState<"idle" | "working" | "done" | "empty">("idle");
  const [evalCaseNote, setEvalCaseNote] = useState<string | null>(null);

  /**
   * Two files per press, not a zip: a zip needs a dependency, and two Blob downloads land in the
   * same folder with a shared timestamp, which is all the fixture loader needs to pair them.
   */
  const download = (blob: Blob, name: string): void => {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = name;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const exportFrame = async (): Promise<void> => {
    setExportState("working");
    const result = await onExportFrame();
    if (result === null) {
      setExportState("empty");
      return;
    }
    download(result.png, `frame-${result.stamp}.png`);
    download(result.json, `frame-${result.stamp}.json`);
    setExportState("done");
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return;
    const context = canvas.getContext("2d");
    if (context === null) return;

    if (view === "crop") {
      if (rectified === null) context.clearRect(0, 0, RECTIFIED_SIZE, RECTIFIED_SIZE);
      else context.putImageData(rectified.image, 0, 0);
      return;
    }
    if (view === "fused") {
      if (fused === null) context.clearRect(0, 0, RECTIFIED_SIZE, RECTIFIED_SIZE);
      else paintField(context, fused, [255, 154, 60]); // orange — the field the pipeline consumes
      return;
    }
    // Each channel keeps its own hue, so a glance at the canvas says which one is being looked at.
    const channel: Record<string, readonly [Float32Array | null, readonly [number, number, number]]> = {
      unet: [stageMasks?.unet ?? null, [234, 242, 244]], // ink-white — the learned detector
      ridge: [stageMasks?.ridge ?? null, [53, 224, 200]], // cyan — black-hat + Gabor
      frangi: [stageMasks?.frangi ?? null, [140, 200, 255]], // blue — vesselness
      median: [stageMasks?.median ?? null, [200, 200, 160]], // sand — the temporal composite
      photometric: [stageMasks?.photometric ?? null, [255, 120, 200]], // magenta — multi-pose variance
    };
    const picked = channel[view];
    if (picked === undefined || picked[0] === null) context.clearRect(0, 0, RECTIFIED_SIZE, RECTIFIED_SIZE);
    else paintField(context, picked[0], picked[1]);
    // `fused` is mutated in place, so its identity never changes — confidence is the change signal.
  }, [rectified, fused, fusedConfidence, stageMasks, view]);

  const emptyText: Record<MaskView, string> = {
    crop: "Gate pass hote hi crop yahan aayega.",
    fused: "Mask abhi nahi bana.",
    unet: backend === "ridge-only" ? "UNet model nahi hai — ridge-only mode." : "UNet abhi chala nahi.",
    ridge: "Ridge output abhi nahi aaya.",
    frangi: "Frangi output abhi nahi aaya.",
    median: "Temporal stack abhi bhar raha hai.",
    photometric: "Do pose tilt ke baad hi banega.",
  };
  const isEmpty =
    view === "crop"
      ? rectified === null
      : view === "fused"
        ? fused === null
        : view === "unet"
          ? stageMasks?.unet == null
          : view === "frangi"
            ? stageMasks?.frangi == null
            : view === "median"
              ? stageMasks?.median == null
              : view === "photometric"
                ? stageMasks?.photometric == null
                : stageMasks === null;

  /*
   * A slow tick purely so the evidence-age readout advances. Everything else in this panel is
   * re-rendered by the scan loop; age is the one value that changes when nothing else does, and a
   * frozen "0.0 s" while the traces visibly fade would be the misleading opposite of the truth.
   */
  const [now, setNow] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setNow(performance.now()), 250);
    return () => window.clearInterval(id);
  }, []);

  const stall = firstStall({ ...telemetry, polylinesDrawn });
  /*
   * Subscribed rather than mirrored into state: the frame loop reads these dozens of times a second
   * and must never re-render anything to do so, while this panel must re-render when they change.
   */
  const flags = useSyncExternalStore(scanFlags.subscribe, scanFlags.snapshot, scanFlags.snapshot);
  const lumaText = `${(stats.luma * 255).toFixed(0)} · clip ${(stats.clipped * 100).toFixed(2)}%`;

  const facingReadout = quality.facingReadout;
  /** Highlighted red: a trusted label whose winding disagrees is the exact "palm rejected" symptom. */
  const windingMismatch =
    facingReadout !== null &&
    facingReadout.trusted &&
    facingReadout.windingReadable &&
    facingReadout.windingSign !== facingReadout.expectedSign;

  const rows: ReadonlyArray<readonly [string, string]> =
    metrics === null
      ? []
      : [
          ["palm aspect (w/l)", metrics.palmAspect.toFixed(3)],
          ["middle / palm", metrics.middleOverPalm.toFixed(3)],
          ["index / middle", metrics.indexOverMiddle.toFixed(3)],
          ["ring / middle", metrics.ringOverMiddle.toFixed(3)],
          ["pinky reach on ring", metrics.pinkyReachOnRing.toFixed(3)],
          ["thumb abduction", `${metrics.thumbAbductionDeg.toFixed(1)}°`],
          ["finger spacing", metrics.fingerSpacing.toFixed(3)],
        ];

  return (
    <details className="rounded-xl border border-hairline bg-surface/60">
      <summary className="cursor-pointer px-4 py-3 font-display text-xs uppercase tracking-[0.22em] text-muted">
        Debug — pipeline &amp; gate
      </summary>

      <div className="grid gap-6 border-t border-hairline p-4 lg:grid-cols-[auto_1fr]">
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-1" role="group" aria-label="Mask view">
            {VIEWS.map((option) => (
              <button
                key={option.id}
                type="button"
                onClick={() => setView(option.id)}
                aria-pressed={view === option.id}
                className={`rounded-full border px-2.5 py-1 text-[0.7rem] transition-colors ${
                  view === option.id
                    ? "border-mount-glow text-mount-glow"
                    : "border-hairline text-muted hover:border-mount-glow/50 hover:text-ink"
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
          {/* Fixed box whether or not there is anything to draw, so toggling never shifts the page. */}
          <div className="relative h-[256px] w-[256px] overflow-hidden rounded-lg border border-hairline bg-night">
            {/* The crop is the largest thing drawn here; the smaller channel fields paint top-left
                at their own scale, which is honest about the resolution they were computed at. */}
            <canvas ref={canvasRef} width={RECTIFIED_SIZE} height={RECTIFIED_SIZE} className="h-full w-full" />
            {isEmpty ? (
              <p className="absolute inset-0 flex items-center justify-center px-4 text-center text-xs text-muted">
                {emptyText[view]}
              </p>
            ) : null}
          </div>
          {rectified !== null && view === "crop" ? (
            <span className="font-display text-xs tabular-nums text-muted">
              coverage {(rectified.coverage * 100).toFixed(1)}% · {rectified.usedPercussion ? "5" : "4"} anchors
            </span>
          ) : null}
          {stageTimings !== null ? (
            <span className="font-display text-xs tabular-nums text-muted">
              {TIMING_KEYS.filter((key) => stageTimings[key] !== undefined)
                .map((key) => `${key} ${stageTimings[key].toFixed(1)}`)
                .join(" · ")}{" "}
              ms
            </span>
          ) : null}
        </div>

        <div className="flex flex-col gap-4">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
            <dt className="text-muted">backend</dt>
            <dd className="text-ink">{backend}</dd>
            <dt className="text-muted">inference</dt>
            <dd className="tabular-nums text-ink">{inferenceMs.toFixed(1)} ms</dd>
            <dt className="text-muted">camera fps</dt>
            <dd className="tabular-nums text-ink">{fps.toFixed(1)}</dd>
            <dt className="text-muted">fused confidence</dt>
            <dd className="tabular-nums text-ink">{fusedConfidence.toFixed(3)}</dd>
            <dt className="text-muted">traces / branches</dt>
            <dd className="tabular-nums text-ink">
              {traceCount} / {branchPoints}
            </dd>
            <dt className="text-muted">gate score</dt>
            <dd className="tabular-nums text-ink">{quality.score.toFixed(3)}</dd>
            <dt className="text-muted">luma / clipped</dt>
            <dd className="tabular-nums text-ink">
              {stats.luma.toFixed(3)} / {stats.clipped.toFixed(3)}
            </dd>
          </dl>

          {/*
           * Feature flags and what turning them on did.
           *
           * Live toggles rather than a build constant, because the comparison worth making is
           * before-and-after on the SAME hand in the SAME light, seconds apart — a page reload loses
           * both. Crease contrast is printed beside them so the effect is a number rather than an
           * impression; it is a read-only reduction over a field the worker already produced, so it
           * cannot itself change what the pipeline does.
           */}
          <div className="flex flex-col gap-2 border-t border-hairline pt-4">
            <div className="flex items-baseline justify-between gap-3">
              <span className="font-display text-[0.7rem] uppercase tracking-[0.18em] text-muted">
                Experiments
              </span>
              <span className="font-display text-xs tabular-nums text-ink">
                crease {contrast.toFixed(4)}
              </span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {SCAN_FLAG_NAMES.map((name) => {
                const on = flags[name];
                return (
                  <button
                    key={name}
                    type="button"
                    aria-pressed={on}
                    onClick={() => scanFlags.toggle(name)}
                    className={`rounded-full border px-2.5 py-1 font-display text-[0.7rem] uppercase tracking-[0.14em] transition-colors ${
                      on
                        ? "border-mount-glow/60 bg-mount-glow/10 text-mount-glow"
                        : "border-hairline text-muted hover:text-ink"
                    }`}
                  >
                    {SCAN_FLAG_LABELS[name]}
                  </button>
                );
              })}
            </div>

            {camera !== null ? (
              <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 pt-1 text-xs">
                <dt className="text-muted">exposure bias</dt>
                <dd className="tabular-nums text-ink">
                  {camera.bias.toFixed(2)}
                  {camera.gamma > 1 ? ` · gamma ${camera.gamma.toFixed(2)}` : ""}
                </dd>
                <dt className="text-muted">crop luma</dt>
                <dd className="tabular-nums text-ink">
                  {lumaText}
                  <span className="text-muted"> (target {LUMA_TARGET_LOW}–{LUMA_TARGET_HIGH})</span>
                </dd>
                <dt className="text-muted">bracket</dt>
                <dd className="tabular-nums text-ink">{bracketFrames} / 3 frames</dd>
                <dt className="text-muted">accepted</dt>
                <dd className={camera.applied.length > 0 ? "text-ink" : "text-line-glow"}>
                  {camera.applied.length > 0 ? camera.applied.join(", ") : "none — software fallback"}
                </dd>
                {camera.unsupported.length > 0 ? (
                  <>
                    <dt className="text-muted">unsupported</dt>
                    <dd className="break-words text-muted">{camera.unsupported.join(", ")}</dd>
                  </>
                ) : null}
                {camera.lastError !== null ? (
                  <>
                    <dt className="text-muted">camera error</dt>
                    <dd className="break-words text-line-glow">{camera.lastError}</dd>
                  </>
                ) : null}
              </dl>
            ) : null}
          </div>

          {/*
           * The stage counter, and the most useful thing on this panel.
           *
           * Read it left to right: the counts are in pipeline order, so the FIRST zero that follows a
           * non-zero is the stage losing frames, and everything before it is working. Two separate
           * blackouts were diagnosed from scratch before this existed, both of them plumbing between
           * stages that each passed their own tests.
           */}
          <div className="flex flex-col gap-1.5 border-t border-hairline pt-4">
            {degraded ? (
              <p className="rounded-lg border border-dashed border-line-glow/50 px-3 py-2 text-xs leading-5 text-line-glow">
                Degraded — haath frame se bahar hai. Evidence jama ho rahi hai, par koi line feature
                nahi bheji ja rahi: crop ka ek hissa aise landmarks se bana hai jo dikhe hi nahi.
              </p>
            ) : null}
            <div className="flex items-baseline justify-between gap-3">
              <span className="font-display text-[0.7rem] uppercase tracking-[0.18em] text-muted">
                Pipeline · last {(TELEMETRY_WINDOW_MS / 1000).toFixed(0)}s
              </span>
              {stall === null ? (
                <span className="font-display text-[0.7rem] uppercase tracking-[0.18em] text-mount-glow">flowing</span>
              ) : (
                <span className="font-display text-[0.7rem] uppercase tracking-[0.18em] text-line-glow">
                  stall · {stall}
                </span>
              )}
            </div>
            <ol className="flex flex-col gap-0.5">
              {TELEMETRY_STAGES.map((stage) => {
                const value = stage === "polylinesDrawn" ? polylinesDrawn : telemetry[stage];
                const isStall = stage === stall;
                return (
                  <li
                    key={stage}
                    className={`flex items-baseline justify-between gap-3 text-xs ${
                      isStall ? "text-line-glow" : value > 0 ? "text-ink" : "text-muted"
                    }`}
                  >
                    <span className="truncate">
                      {isStall ? "▸ " : "  "}
                      {stage}
                    </span>
                    <span className="tabular-nums">{value}</span>
                  </li>
                );
              })}
            </ol>
          </div>

          {/*
           * Persistence and latency — the two numbers this step is judged on.
           *
           * Time-to-first-trace answers "how long before the user sees anything", and evidence age
           * answers "is what they are seeing still being confirmed, or is it coasting on the fade".
           * Alignment says whether the crop space moved and what was done about it: `aligned` on a
           * moving hand is the CORRECT outcome, not a skipped step — rectified space is already
           * motion-compensated, so only an anchor-convention change needs a remap.
           */}
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 border-t border-hairline pt-4 text-xs">
            <dt className="text-muted">first trace</dt>
            <dd className="tabular-nums text-ink">
              {timeToFirstTraceMs === null ? "—" : `${(timeToFirstTraceMs / 1000).toFixed(2)} s`}
            </dd>
            <dt className="text-muted">evidence age</dt>
            <dd className="tabular-nums text-ink">
              {traceEvidenceAtMs === 0 ? "—" : `${((now - traceEvidenceAtMs) / 1000).toFixed(1)} s`}
            </dd>
            <dt className="text-muted">alignment</dt>
            <dd className="text-ink">
              {alignment === null
                ? "—"
                : `${alignment.outcome}${
                    alignment.displacement > 0 ? ` · ${alignment.displacement.toFixed(1)} px` : ""
                  } · ${alignment.warps} remaps`}
            </dd>
            <dt className="text-muted">photometric</dt>
            <dd className="tabular-nums text-ink">
              {photometric === null
                ? "0 poses"
                : `${photometric.samples} poses · tilt ${photometric.tiltSpan.toFixed(2)} · w ${photometric.weight.toFixed(2)}`}
            </dd>
          </dl>

          {/*
           * Per-line completion. A refused line is not a bug to be hidden — it is the honest answer
           * when the evidence did not reach the bar, and the reason says which bar it missed.
           */}
          {completion !== null ? (
            <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 border-t border-hairline pt-4 text-xs">
              {(["heart", "head", "life", "fate"] as const).map((id) => {
                const report = completion.reports[id];
                return (
                  <Fragment key={id}>
                    <dt className="text-muted">{id}</dt>
                    <dd className={report.accepted ? "tabular-nums text-ink" : "tabular-nums text-muted"}>
                      {report.accepted
                        ? `${report.seedCount} seeds · ${(report.observedFraction * 100).toFixed(0)}% seen · E ${report.energy.toFixed(2)}`
                        : `— ${report.reject ?? "none"}`}
                    </dd>
                  </Fragment>
                );
              })}
            </dl>
          ) : null}

          {/*
           * Segmenter startup trail.
           *
           * Every one of these lines exists because that failure once presented as "no lines and no
           * explanation": a model served as the app-shell HTML, wasm files vendored under names ORT
           * does not ask for, a provider that refuses the graph, an export whose output tensor is
           * named something else. The worker cannot show a stack trace, so it reports state instead.
           */}
          {diagnostics !== null ? (
            <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 border-t border-hairline pt-4 text-xs">
              <dt className="text-muted">segmenter</dt>
              <dd className={diagnostics.phase === "failed" ? "text-line-glow" : "text-ink"}>
                {diagnostics.phase}
                {diagnostics.executionProvider !== null ? ` · EP ${diagnostics.executionProvider}` : ""}
                {diagnostics.providersTried.length > 0 && diagnostics.executionProvider === null
                  ? ` · tried ${diagnostics.providersTried.join(", ")}`
                  : ""}
              </dd>
              <dt className="text-muted">model</dt>
              <dd className={diagnostics.modelOk ? "text-ink" : "text-line-glow"}>
                {diagnostics.modelStatus === null
                  ? "not probed"
                  : `${diagnostics.modelStatus}${
                      diagnostics.modelBytes === null
                        ? ""
                        : ` · ${(diagnostics.modelBytes / 1e6).toFixed(1)} MB`
                    }${diagnostics.modelOk ? "" : " · MISSING"}`}
                <span className="block text-muted">
                  {diagnostics.modelPath}
                  {diagnostics.modelContentType === null ? "" : ` (${diagnostics.modelContentType})`}
                </span>
              </dd>
              <dt className="text-muted">ort wasm</dt>
              <dd className={diagnostics.wasmProbe?.startsWith("ok") === false ? "text-line-glow" : "text-ink"}>
                {diagnostics.wasmProbe ?? "not probed"}
                <span className="block text-muted">{diagnostics.wasmPath}</span>
              </dd>
              <dt className="text-muted">warmup / first</dt>
              <dd className="tabular-nums text-ink">
                {diagnostics.warmupMs === null ? "—" : `${diagnostics.warmupMs.toFixed(0)} ms`} /{" "}
                {diagnostics.firstInferenceMs === null ? "—" : `${diagnostics.firstInferenceMs.toFixed(0)} ms`}
              </dd>
              <dt className="text-muted">inferences / dropped</dt>
              <dd className="tabular-nums text-ink">
                {diagnostics.inferences} / {diagnostics.dropped}
              </dd>
              {diagnostics.lastError !== null ? (
                <>
                  <dt className="text-muted">last error</dt>
                  <dd className="break-words text-line-glow">{diagnostics.lastError}</dd>
                </>
              ) : null}
            </dl>
          ) : null}

          {/*
           * The palm/dorsum decision, laid out so the sign convention can be confirmed on a real
           * device rather than argued about: show a palm and `winding` must equal `expected`. If a
           * device disagrees, MEDIAPIPE_ASSUMES_MIRRORED_INPUT in quality.ts is the one thing to flip.
           */}
          {facingReadout !== null ? (
            <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 border-t border-hairline pt-4 text-xs">
              <dt className="text-muted">handedness</dt>
              <dd className="text-ink">
                {facingReadout.handedness} ({facingReadout.handednessScore.toFixed(2)}) → phys {facingReadout.physical}
                {facingReadout.trusted ? "" : " · untrusted"}
              </dd>
              <dt className="text-muted">winding / expected</dt>
              <dd className={`tabular-nums ${windingMismatch ? "text-line-glow" : "text-ink"}`}>
                {facingReadout.windingSign >= 0 ? "+" : "−"} / {facingReadout.expectedSign >= 0 ? "+" : "−"}
                <span className="text-muted">
                  {" "}
                  ({facingReadout.winding.toFixed(4)} · strength {facingReadout.windingStrength.toFixed(3)}
                  {facingReadout.windingReadable ? "" : " · unreadable, sign ignored"})
                </span>
              </dd>
              <dt className="text-muted">normal z</dt>
              <dd className="tabular-nums text-ink">
                {facingReadout.normalZ.toFixed(3)}
                <span className="text-muted"> · facing {facingReadout.facing.toFixed(3)}</span>
              </dd>
            </dl>
          ) : null}

          {/*
           * Fixture capture + live edge tuning.
           *
           * The palm-edge constants cannot be settled from code: the only ground truth is a real
           * hand with the boundary drawn over it. Export writes that frame and everything derived
           * from it to disk for `test/fixtures/real/`; the slider moves the bulge live so the right
           * value can be read off the screen instead of guessed.
           */}
          <div className="flex flex-col gap-3 border-t border-hairline pt-4">
            <span className="font-display text-[0.7rem] uppercase tracking-[0.18em] text-muted">
              Fixtures &amp; edge tuning
            </span>
            {/* Raw-frame export is a debug affordance; a raw palm frame is biometric data, so the
                button never ships — same gate as the tuning slider below. */}
            {process.env.NODE_ENV !== "production" ? (
              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={() => void exportFrame()}
                  disabled={exportState === "working"}
                  className="rounded-full border border-hairline px-3 py-1.5 text-[0.7rem] text-ink transition-colors hover:border-mount-glow hover:text-mount-glow disabled:opacity-50"
                >
                  {exportState === "working" ? "Exporting…" : "Export frame"}
                </button>
                <span aria-live="polite" className="text-[0.7rem] text-muted">
                  {exportState === "done" ? "Saved PNG + JSON — drop both into test/fixtures/real/" : null}
                  {exportState === "empty" ? "No frame yet — start the camera first." : null}
                </span>
                {flags.scanDiagnostics && onExportEvalCase !== undefined ? (
                  <button
                    type="button"
                    onClick={() => {
                      setEvalCaseNote("staging…");
                      void onExportEvalCase()
                        .then((sessionId) =>
                          setEvalCaseNote(
                            sessionId === null
                              ? "no frame/hand to stage"
                              : sessionId + " staged — label it in /dev/label",
                          ),
                        )
                        .catch((error: unknown) =>
                          setEvalCaseNote(error instanceof Error ? error.message : "staging failed"),
                        );
                    }}
                    className="rounded-full border border-hairline px-3 py-1.5 text-[0.7rem] text-ink transition-colors hover:border-mount-glow hover:text-mount-glow"
                  >
                    Export eval case
                  </button>
                ) : null}
                {evalCaseNote !== null ? (
                  <span aria-live="polite" className="text-[0.7rem] text-muted">
                    {evalCaseNote}
                  </span>
                ) : null}
              </div>
            ) : null}

            {process.env.NODE_ENV !== "production" ? (
              <div className="flex flex-col gap-1.5">
                <label htmlFor="edge-peak" className="flex items-baseline justify-between text-[0.7rem] text-muted">
                  <span>PALM_EDGE_PEAK (× palm width)</span>
                  <span className="tabular-nums text-mount-glow">{edgePeak.toFixed(3)}</span>
                </label>
                <input
                  id="edge-peak"
                  type="range"
                  min={0.2}
                  max={1.6}
                  step={0.01}
                  value={edgePeak}
                  onChange={(event) => onEdgePeak(Number(event.target.value))}
                  className="w-full accent-[var(--color-mount-glow)]"
                />
                <p className="text-[0.7rem] leading-5 text-muted">
                  Drag until the cyan boundary sits on the fleshy outer edge, then copy the value into
                  <span className="text-ink"> PALM_EDGE_PEAK</span> in lib/scan/landmarks.ts. Range brackets the
                  0.86 calibrated from docs/reference/edge-target-standard.webp.
                </p>
              </div>
            ) : null}
          </div>

          <div className="flex flex-col gap-2 border-t border-hairline pt-4">
            <span className="font-display text-[0.7rem] uppercase tracking-[0.18em] text-muted">Gate checks</span>
            <ul className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-3">
              {ALL_CHECKS.map((check) => {
                const passed = quality.checks[check] ?? true;
                return (
                  <li key={check} className="flex items-center gap-1.5">
                    <span
                      aria-hidden="true"
                      className={`h-1.5 w-1.5 shrink-0 rounded-full ${passed ? "bg-mount-glow" : "bg-line-glow"}`}
                    />
                    <span className={passed ? "text-muted" : "text-line-glow"}>{check}</span>
                  </li>
                );
              })}
            </ul>
          </div>

          {rows.length > 0 ? (
            <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 border-t border-hairline pt-4 text-xs">
              {rows.map(([label, value]) => (
                <div key={label} className="contents">
                  <dt className="text-muted">{label}</dt>
                  <dd className="tabular-nums text-ink">{value}</dd>
                </div>
              ))}
            </dl>
          ) : null}
        </div>
      </div>
    </details>
  );
}
