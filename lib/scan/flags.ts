/**
 * Scan feature flags.
 *
 * Everything added for camera control and active illumination is opt-in, and the reason is not
 * caution for its own sake: the detection path currently works, and it took four steps and two total
 * blackouts to get there. A change that improves the average frame while occasionally destroying a
 * good one is a bad trade against that history, and the only way to know which it is on real hands is
 * to be able to turn each piece on and off live, on the same palm, seconds apart.
 *
 * The contract these flags carry is stronger than "off by default": with every flag off, **not one
 * byte of the pipeline's output changes**. Not "changes very little" — the new code is not called at
 * all. `test/flags-identity.test.ts` asserts it against a real photograph, comparing polylines
 * coordinate by coordinate.
 *
 * A live store rather than a build-time constant, because the comparison that matters is
 * before-and-after on the *same* hand in the *same* light, and a page reload loses both.
 */

export interface ScanFlags {
  /**
   * Drive the camera: exposure bias, focus distance, white balance, torch — plus a closed loop that
   * steps the bias from what the rectified crop actually measures.
   */
  readonly cameraControl: boolean;
  /**
   * Screen-as-flash. Four quadrant flashes, one frame each; the per-pixel range across them is
   * evidence about surface relief that no single exposure contains.
   */
  readonly photometric: boolean;
  /** Three-frame exposure bracket merged for the detectors. Requires settable exposure. */
  readonly hdrBracket: boolean;
  /**
   * UNet sees a full-hand canonical warp (its training framing, H2/H2b) instead of the palm-quad
   * crop; the probability map is remapped back to palm-quad space before fusion. Classical stages
   * and the accumulator are untouched either way.
   */
  readonly unetFullHand: boolean;
  /** Emit KB features for classifier-named minor lines (sun/health/marriage/bracelets/girdle). */
  readonly emitMinorLines: boolean;
  /** Audit-§4 vocabulary fixes: pale band, tight arc, head-line fate origin, quadrangle v2, explicit wavy=false, fate double. */
  readonly featureVocabV2: boolean;
  /** /scan diagnostic overlay (dev harness lane D): layer cycling + field readout on the overlay. */
  readonly scanDiagnostics: boolean;
  /** H9 field contract: extraction reads the calibrated P(crease) plane instead of the legacy field. */
  readonly fieldContract: boolean;
  /** Corridor minimal-path fill-in for a missing fate line and un-emitted minor classes. */
  readonly corridorSearch: boolean;
  /**
   * Multi-frame super-resolution: the sharpest same-pose 512 crops are registered and fused onto a
   * 2× grid, and extraction detects ONCE on that fusion. Resolution from real frames, never
   * invented — no single-image upscaler anywhere on this path.
   */
  readonly superRes: boolean;
  /**
   * Rekha persistence (S1): evidence accumulates across frames and a confirmed line is HELD.
   *
   * Every accepted frame's field — the contract plane when fieldContract is on, else the legacy
   * `mask.all` — is folded into `EvidenceAccumulator` (per-pixel log-odds, decay, deadband,
   * CANDIDATE → TRACKING → CONFIRMED hysteresis, translation compensation on), weighted by the
   * frame's sharpness; its probability map replaces the per-frame field as extraction input, and
   * `RekhaLineHold` keeps a CONFIRMED major line through short losses. Corridor search waits for
   * the first confirmed line. See lib/scan/rekha-persist.ts.
   *
   * CALIBRATION, measured (scripts/scan/calibrate-rekha-null.ts, worker-equivalent chain, UNet on
   * every 6th frame as the worker runs it). Creaseless skin in the per-frame legacy field:
   *   lines-current-02       p50 0.083 · p95 0.483 (classical frames p95 0.538, UNet 0.296)
   *   lines-missing-tilt-03  p50 0.102 · p95 0.576 (classical 0.648, UNet 0.371)
   *   session still 0        p50 0.058 · p95 0.169 (classical 0.177, UNet 0.108)
   *   pooled, equal weight   p90 0.266 · p95 0.427
   * The library default (0.06) sat under the MEDIAN of that skin: nearly every pixel would have
   * argued for a crease. The null is `REKHA_PERSIST_NULL_LEVEL` (lib/scan/rekha-persist.ts),
   * chosen on the S1.5 replay (scripts/scan/replay-persist.ts) — see that constant for the sweep.
   *
   * Frame weight is sharpness on the capture harness's palm box at camera resolution (palm-box
   * VoL): 395 and 426 on the two sharp fixtures (weight 1), 50 on the overexposed legacy frame
   * (weight 0 — skipped as unusable). On the rectified crop the same frames measured 14–17 and
   * would all have weighed zero.
   */
  readonly rekhaPersist: boolean;
  /**
   * Trace, don't fit (S2): the DRAWN geometry of each line extractLines accepts is traced through
   * the black-hat valley of the rectified crop at 256 — seeded by the line's observed fragments,
   * extended along the valley until the crease fades — instead of completion's fitted curve, which
   * is kept only for features. See lib/scan/trace-valley.ts for the method and its measurements.
   */
  readonly rekhaTrace: boolean;
}

export const DEFAULT_SCAN_FLAGS: ScanFlags = {
  cameraControl: false,
  photometric: false,
  hdrBracket: false,
  unetFullHand: false,
  emitMinorLines: false,
  featureVocabV2: false,
  scanDiagnostics: false,
  fieldContract: false,
  corridorSearch: false,
  superRes: false,
  rekhaPersist: false,
  rekhaTrace: false,
};

export type ScanFlagName = keyof ScanFlags;

export const SCAN_FLAG_NAMES: readonly ScanFlagName[] = ["cameraControl", "photometric", "hdrBracket", "unetFullHand", "emitMinorLines", "featureVocabV2", "scanDiagnostics", "fieldContract", "corridorSearch", "superRes", "rekhaPersist", "rekhaTrace"];

/** Human labels for the HUD toggles, in the app's register. */
export const SCAN_FLAG_LABELS: Readonly<Record<ScanFlagName, string>> = {
  cameraControl: "Camera control",
  photometric: "Gehri scan (flash)",
  hdrBracket: "HDR bracket",
  unetFullHand: "UNet full-hand framing",
  emitMinorLines: "Minor-line features",
  featureVocabV2: "Vocabulary v2",
  scanDiagnostics: "Diagnostics overlay",
  fieldContract: "Field contract",
  corridorSearch: "Corridor search",
  superRes: "Super-resolution",
  rekhaPersist: "Rekha persistence",
  rekhaTrace: "Trace, don't fit",
};

type Listener = (flags: ScanFlags) => void;

/**
 * A tiny store, deliberately not React state.
 *
 * The frame loop reads these dozens of times a second and must never re-render anything to do so;
 * the HUD needs to re-render when they change. A subscribe/snapshot pair serves both, and
 * `useSyncExternalStore` on the HUD side gets the React half right without a `useEffect` that
 * mirrors state into a ref.
 */
export class FlagStore {
  private flags: ScanFlags = DEFAULT_SCAN_FLAGS;
  private readonly listeners = new Set<Listener>();

  snapshot = (): ScanFlags => this.flags;

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  set = (name: ScanFlagName, value: boolean): void => {
    if (this.flags[name] === value) return;
    this.flags = { ...this.flags, [name]: value };
    for (const listener of this.listeners) listener(this.flags);
  };

  toggle = (name: ScanFlagName): void => {
    this.set(name, !this.flags[name]);
  };

  reset = (): void => {
    this.flags = DEFAULT_SCAN_FLAGS;
    for (const listener of this.listeners) listener(this.flags);
  };
}

export const scanFlags = new FlagStore();

/**
 * The flags the chamber runs with, and only the chamber: persistence, the corridor fill-in it
 * releases, and the super-resolution fusion that feeds it sharper evidence (S1.1), and the valley
 * tracer that draws what was found (S2). /scan keeps every default.
 */
export const CHAMBER_SCAN_FLAGS: readonly ScanFlagName[] = ["rekhaPersist", "corridorSearch", "superRes", "rekhaTrace"];

/**
 * Switch `names` on and return the undo, which puts each flag back to the value it had BEFORE — not
 * to off. A flag a developer had already switched on in /scan's HUD is still on after visiting the
 * chamber, and one they had off is off again.
 */
export function withScanFlags(names: readonly ScanFlagName[], store: FlagStore = scanFlags): () => void {
  const before = names.map((name) => [name, store.snapshot()[name]] as const);
  for (const name of names) store.set(name, true);
  return () => {
    for (const [name, value] of before) store.set(name, value);
  };
}

/** True when every flag is off — the state the identity test pins. */
export function allFlagsOff(flags: ScanFlags): boolean {
  return SCAN_FLAG_NAMES.every((name) => !flags[name]);
}
