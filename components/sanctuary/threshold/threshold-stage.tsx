"use client";

/**
 * The Threshold's one island — it decides nothing the pre-paint script has not
 * already decided, and it owns the three ways out.
 *
 * WHY THE DECISION IS AN EXTERNAL STORE. Whether the entrance plays depends on
 * localStorage, the address bar and a media query: three things the server
 * cannot see. On a full load the inline script after this element has already
 * stamped the answer onto the DOM before first paint; React hydrates with the
 * server's "playing" (suppressHydrationWarning on this element's own attribute),
 * then re-renders with the client's answer — the same answer, so nothing moves.
 * On a client-side navigation into Home there is no script run and no
 * hydration: React renders straight from the client snapshot, so a returning
 * visitor never sees a frame of black.
 *
 * THE WAYS OUT. The Enter button pushes through the doorway (§6.1, 1.8 s). Any
 * other tap, the Skip control, or any key skips — "skippable with any key or
 * tap". Either way the visit is remembered. There is no third way: nothing here
 * ever advances on a timer.
 *
 * The scene itself is server markup passed in as children, so this file ships
 * the behaviour and none of the drawing.
 */
import {
  useCallback,
  useEffect,
  useState,
  useSyncExternalStore,
  type MouseEvent,
  type ReactElement,
  type ReactNode,
} from "react";
import { REDUCED_MOTION_QUERY } from "@/components/sanctuary/use-capability-tier";
import {
  THRESHOLD_PUSH_MS,
  THRESHOLD_REPLAY_PARAM,
  THRESHOLD_REPLAY_VALUE,
  THRESHOLD_SEEN,
  THRESHOLD_STORAGE_KEY,
  thresholdShouldPlay,
} from "@/lib/sanctuary/threshold";

/** How long the skip fade lasts: the card band's lower edge, fast enough to feel obeyed. */
export const THRESHOLD_SKIP_MS = 400;

type Decision = "playing" | "skipped";
type Phase = "auto" | "entering" | "skipping" | "done";

const subscribeToNothing = (): (() => void) => () => {};

function clientDecision(): Decision {
  try {
    const play = thresholdShouldPlay({
      stored: window.localStorage.getItem(THRESHOLD_STORAGE_KEY),
      reducedMotion: window.matchMedia(REDUCED_MOTION_QUERY).matches,
      replay: new URLSearchParams(window.location.search).get(THRESHOLD_REPLAY_PARAM) === THRESHOLD_REPLAY_VALUE,
    });
    return play ? "playing" : "skipped";
  } catch {
    return "skipped";
  }
}

const serverDecision = (): Decision => "playing";

/** Remember the visit, and drop a replay request from the address so a reload does not replay. */
function remember(): void {
  try {
    window.localStorage.setItem(THRESHOLD_STORAGE_KEY, THRESHOLD_SEEN);
  } catch {
    /* A blocked store means the entrance plays again next time — the honest consequence. */
  }
  const url = new URL(window.location.href);
  if (url.searchParams.has(THRESHOLD_REPLAY_PARAM)) {
    url.searchParams.delete(THRESHOLD_REPLAY_PARAM);
    window.history.replaceState(window.history.state, "", url);
  }
}

export interface ThresholdStageProps {
  readonly id: string;
  readonly className: string;
  readonly children: ReactNode;
}

export function ThresholdStage({ id, className, children }: ThresholdStageProps): ReactElement {
  const decision = useSyncExternalStore(subscribeToNothing, clientDecision, serverDecision);
  const [phase, setPhase] = useState<Phase>("auto");
  const state = phase === "auto" ? decision : phase;

  const leave = useCallback((how: "enter" | "skip") => {
    remember();
    setPhase((current) => (current === "auto" ? (how === "enter" ? "entering" : "skipping") : current));
  }, []);

  /* The push and the fade each end the entrance once their CSS has run. */
  useEffect(() => {
    if (phase !== "entering" && phase !== "skipping") return;
    const timer = window.setTimeout(() => setPhase("done"), phase === "entering" ? THRESHOLD_PUSH_MS : THRESHOLD_SKIP_MS);
    return () => window.clearTimeout(timer);
  }, [phase]);

  /* Any key skips — except the keys that move focus, and the keys that press the focused Enter button. */
  useEffect(() => {
    if (state !== "playing") return;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Tab" || event.key === "Shift" || event.metaKey || event.ctrlKey || event.altKey) return;
      const onEnter = document.activeElement?.closest("[data-snc-threshold-action='enter']") !== null &&
        document.activeElement?.closest("[data-snc-threshold-action='enter']") !== undefined;
      if (onEnter && (event.key === "Enter" || event.key === " ")) return;
      event.preventDefault();
      leave("skip");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [state, leave]);

  const onClick = (event: MouseEvent<HTMLDivElement>): void => {
    if (state !== "playing") return;
    const target = event.target instanceof Element ? event.target : null;
    const action = target?.closest("[data-snc-threshold-action]")?.getAttribute("data-snc-threshold-action");
    leave(action === "enter" ? "enter" : "skip");
  };

  return (
    <div
      id={id}
      className={className}
      data-snc-threshold={state}
      onClick={onClick}
      role="dialog"
      aria-modal={state === "playing" ? true : undefined}
      aria-label="The Threshold — the entrance to the Sanctuary"
      suppressHydrationWarning
    >
      {children}
    </div>
  );
}
