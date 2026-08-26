"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useEffect } from "react";

/**
 * The "we just found something" beat.
 *
 * These fire when a whole line locks — a moment worth marking, because it is the difference between
 * a progress bar creeping up and the scan visibly *learning something about you*. They are
 * deliberately rare: one per line, once per session, driven by a one-way latch in
 * `reading-session.ts` rather than by a threshold the confidence can wobble across. A toast that can
 * fire twice for the same finding stops meaning anything the second time.
 *
 * Queued rather than singular, because two lines can lock on the same extraction — the completion
 * stage fits all four at once — and swallowing the second would lose a real event.
 */
export interface EnhanceToast {
  readonly id: string;
  readonly text: string;
}

/** How long each toast stays. Long enough to read a short Hinglish sentence without blocking the view. */
const DWELL_MS = 3200;

export function EnhanceToasts({
  toasts,
  onDismiss,
}: {
  readonly toasts: readonly EnhanceToast[];
  readonly onDismiss: (id: string) => void;
}) {
  const reduced = useReducedMotion() ?? false;

  /*
   * One timer per toast, keyed on its id, so a second toast arriving does not restart the first
   * one's clock — which is what a single shared timeout would do, leaving the earlier message on
   * screen for twice its dwell.
   */
  useEffect(() => {
    const timers = toasts.map((toast) => window.setTimeout(() => onDismiss(toast.id), DWELL_MS));
    return () => {
      for (const timer of timers) window.clearTimeout(timer);
    };
  }, [toasts, onDismiss]);

  return (
    <div
      /*
       * `status` rather than `alert`: this is an accomplishment, not a problem, and `alert`
       * interrupts a screen reader mid-sentence. Polite means it is announced at the next pause.
       */
      role="status"
      aria-live="polite"
      className="pointer-events-none absolute inset-x-0 top-3 z-20 flex flex-col items-center gap-2 px-3"
    >
      <AnimatePresence initial={false}>
        {toasts.map((toast) => (
          <motion.div
            key={toast.id}
            initial={reduced ? { opacity: 0 } : { opacity: 0, y: -12, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={reduced ? { opacity: 0 } : { opacity: 0, y: -8 }}
            transition={{ duration: reduced ? 0 : 0.3, ease: [0.16, 1, 0.3, 1] }}
            className="hr-glow-chrome flex items-center gap-2 rounded-full border border-hairline bg-surface/95 px-4 py-2 text-xs text-ink shadow-lg backdrop-blur"
          >
            <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rounded-full bg-mount-glow" />
            {toast.text}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
