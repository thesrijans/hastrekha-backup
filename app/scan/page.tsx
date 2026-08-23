import type { Metadata } from "next";
import { ScanClient } from "./scan-client";

export const metadata: Metadata = {
  title: "Scan — HastRekha",
  description: "Hatheli ka live scan — poora on-device, tasveer kabhi upload nahi hoti.",
};

/**
 * Server shell for the live scan. All the work is in the client component, which is where the camera,
 * MediaPipe and the rules engine live.
 */
export default function ScanPage() {
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-8 px-4 py-10 sm:px-6 sm:py-14">
      <header className="flex flex-col gap-3">
        <span className="font-display text-xs uppercase tracking-[0.22em] text-mount-glow">Live scan · stage 1</span>
        <h1 className="font-display text-3xl font-semibold tracking-tight text-ink sm:text-4xl">Hatheli scan</h1>
        <p className="max-w-xl text-base leading-7 text-muted">
          Camera se haath ke landmarks padhe jaate hain aur rules turant fire hote dikhte hain. Sab kuch tumhare
          device par — koi tasveer server tak nahi jaati.
        </p>
      </header>

      <ScanClient />
    </main>
  );
}
