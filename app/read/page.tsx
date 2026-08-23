import type { Metadata } from "next";
import { ReadClient } from "./read-client";

export const metadata: Metadata = {
  title: "Reading — HastRekha",
  description: "DOB se shuru karo, hatheli ke details add karo, aur cited reading paao.",
};

/**
 * Server wrapper for the reading flow. The form itself is a Client Component because it is entirely
 * interactive; keeping the shell on the server means the page metadata and static copy still render
 * without shipping them through React state.
 */
export default function ReadPage() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-10 px-4 py-12 sm:px-6 sm:py-16">
      <header className="flex flex-col gap-3">
        <span className="font-display text-xs uppercase tracking-[0.22em] text-mount-glow">Free scan</span>
        <h1 className="font-display text-3xl font-semibold tracking-tight text-ink sm:text-4xl">Apni hatheli scan karo</h1>
        <p className="max-w-xl text-base leading-7 text-muted">
          Sirf DOB se bhi chalega. Mounts jitne bharoge, scan utna gehra hoga.
        </p>
      </header>

      <ReadClient />
    </main>
  );
}
