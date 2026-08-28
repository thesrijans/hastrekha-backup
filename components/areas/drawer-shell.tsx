"use client";

/**
 * The right-side sheet, extracted so the source drawer and the citation drawer are one thing.
 *
 * `SourceDrawer` in reading-view.tsx already implemented this — backdrop, slide, Escape, focus —
 * and the citation drawer needs exactly the same shell with different contents. Copying it would
 * have left two focus traps to keep in sync, and a focus trap that drifts is an accessibility bug
 * nobody notices until someone is stuck in a dialog with a keyboard. So the shell moved here and
 * both callers use it.
 *
 * It lives under components/areas/ because that is where this step is allowed to add files; nothing
 * about it is area-specific, and it should move to a shared home the moment a third caller appears.
 *
 * **Stacking.** `level` picks the z-band. The area detail opens at "base" and a citation opens over
 * it at "over" — two sheets deep is the most this is designed for, and the second is small enough
 * that dismissing it returns you to the first with the context intact.
 */
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useEffect, useRef, type ReactNode } from "react";

/** Slide easing, matching the existing drawer and the step transitions in read-client.tsx. */
const SLIDE_EASE: readonly [number, number, number, number] = [0.32, 0.72, 0, 1];
const SLIDE_MS = 0.28;
const FADE_MS = 0.18;

const Z_BAND: Readonly<Record<"base" | "over", { readonly backdrop: string; readonly panel: string }>> = {
  base: { backdrop: "z-[60]", panel: "z-[61]" },
  over: { backdrop: "z-[70]", panel: "z-[71]" },
};

export function DrawerShell({
  open,
  onClose,
  titleId,
  eyebrow,
  title,
  closeLabel,
  level = "base",
  children,
}: {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly titleId: string;
  readonly eyebrow: string;
  readonly title: ReactNode;
  readonly closeLabel: string;
  readonly level?: "base" | "over";
  readonly children: ReactNode;
}) {
  const reduced = useReducedMotion() ?? false;
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const z = Z_BAND[level];

  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open ? (
        <>
          <motion.div
            key="backdrop"
            className={`fixed inset-0 ${z.backdrop} bg-night/80 backdrop-blur-sm`}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reduced ? 0 : FADE_MS }}
            onClick={onClose}
            aria-hidden="true"
          />
          <motion.aside
            key="drawer"
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            className={`fixed inset-y-0 right-0 ${z.panel} flex w-full max-w-md flex-col gap-5 overflow-y-auto border-l border-hairline bg-surface p-6`}
            initial={reduced ? { opacity: 0 } : { x: "100%" }}
            animate={reduced ? { opacity: 1 } : { x: 0 }}
            exit={reduced ? { opacity: 0 } : { x: "100%" }}
            transition={{ duration: reduced ? 0 : SLIDE_MS, ease: SLIDE_EASE }}
          >
            <div className="flex items-start justify-between gap-4">
              <div className="flex flex-col gap-1">
                <span className="font-display text-xs uppercase tracking-[0.22em] text-line-glow">{eyebrow}</span>
                <h2 id={titleId} className="font-display text-xl font-semibold tracking-tight text-ink">
                  {title}
                </h2>
              </div>
              <button
                ref={closeRef}
                type="button"
                onClick={onClose}
                aria-label={closeLabel}
                className="rounded-full border border-hairline p-2 text-ink transition-colors hover:border-mount-glow hover:text-mount-glow"
              >
                <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round">
                  <path d="M6 6l12 12M18 6L6 18" />
                </svg>
              </button>
            </div>
            {children}
          </motion.aside>
        </>
      ) : null}
    </AnimatePresence>
  );
}
