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
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-8 px-4 py-12 sm:px-6">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Apni reading banao</h1>
        <p className="text-base leading-7 text-black/70 dark:text-white/70">
          Sirf DOB se bhi chalega. Hatheli ke details jitne bharoge, reading utni gehri hogi.
        </p>
      </header>

      <ReadClient />
    </main>
  );
}
