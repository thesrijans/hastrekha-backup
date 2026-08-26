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
}

export const DEFAULT_SCAN_FLAGS: ScanFlags = {
  cameraControl: false,
  photometric: false,
  hdrBracket: false,
};

export type ScanFlagName = keyof ScanFlags;

export const SCAN_FLAG_NAMES: readonly ScanFlagName[] = ["cameraControl", "photometric", "hdrBracket"];

/** Human labels for the HUD toggles, in the app's register. */
export const SCAN_FLAG_LABELS: Readonly<Record<ScanFlagName, string>> = {
  cameraControl: "Camera control",
  photometric: "Gehri scan (flash)",
  hdrBracket: "HDR bracket",
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
class FlagStore {
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

/** True when every flag is off — the state the identity test pins. */
export function allFlagsOff(flags: ScanFlags): boolean {
  return SCAN_FLAG_NAMES.every((name) => !flags[name]);
}
