"use client"; // Error boundaries must be Client Components.

import { useEffect } from "react";

/**
 * Error boundary for the reading route.
 *
 * `retry` (stable since Next 16.3) re-renders the segment. Production builds hand the client a
 * generic message plus a `digest` that matches the server log, so we surface the digest rather than
 * `error.message` — the message is meaningful in dev and deliberately empty of detail in live.
 */
export default function ReadError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useEffect(() => {
    console.error("[read] boundary caught:", error);
  }, [error]);

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col items-start gap-5 px-4 py-16 sm:px-6">
      <h1 className="font-display text-3xl font-semibold tracking-tight text-ink">Kuch gadbad ho gayi</h1>
      <p className="max-w-xl text-base leading-7 text-muted">
        Reading page load nahi ho paya. Ek baar phir koshish karo — tumhara data waise ka waisa hai.
      </p>
      {error.digest !== undefined ? (
        <p className="text-xs text-muted">Reference: {error.digest}</p>
      ) : null}
      <button
        type="button"
        onClick={() => retry()}
        className="flex h-11 items-center justify-center rounded-full bg-mount-glow px-6 font-display text-sm font-semibold text-night transition-opacity hover:opacity-90"
      >
        Dobara try karo
      </button>
    </main>
  );
}
