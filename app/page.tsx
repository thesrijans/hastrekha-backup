import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "HastRekha — classical palmistry, bina dar ke",
  description: "1900s ke classical palmistry texts se cited reading. Koi maut ya bimari ki bhavishyavani nahi.",
};

const TRUST_POINTS: ReadonlyArray<{ readonly title: string; readonly body: string }> = [
  {
    title: "Cited from 1900s classical texts",
    body: "Har line ke saath uska source — Cheiro aur doosre classical texts, page tak.",
  },
  {
    title: "No death or disease predictions",
    body: "Dar bechne wala kaam nahi. Sirf wahi jo tumhe aage badhne mein kaam aaye.",
  },
  {
    title: "Palm images never leave your device",
    body: "Scan tumhare phone par hi chalta hai — server tak sirf feature scores aate hain.",
  },
];

export default function Home() {
  return (
    <>
      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-16 px-4 py-16 sm:px-6 sm:py-24">
        <section className="flex flex-col items-start gap-6">
          <h1 className="max-w-2xl text-3xl font-semibold leading-tight tracking-tight sm:text-5xl">
            Apni hatheli padho — classical texts se, bina dar ke.
          </h1>
          <p className="max-w-xl text-lg leading-8 text-black/70 dark:text-white/70">
            Sirf apni date of birth se shuru karo. Hatheli ke details add karoge to reading aur gehri hoti jaayegi —
            har baat ke saath uska source.
          </p>
          <Link
            href="/read"
            className="flex h-12 items-center justify-center rounded-full bg-foreground px-8 text-base font-medium text-background transition-opacity hover:opacity-90"
          >
            Free reading shuru karo
          </Link>
        </section>

        <section aria-labelledby="trust-heading" className="flex flex-col gap-6">
          <h2 id="trust-heading" className="text-sm font-medium uppercase tracking-wide text-black/50 dark:text-white/50">
            Kyun bharosa karo
          </h2>
          <ul className="grid gap-4 sm:grid-cols-3">
            {TRUST_POINTS.map((point) => (
              <li
                key={point.title}
                className="rounded-xl border border-black/10 p-5 dark:border-white/15"
              >
                <h3 className="text-base font-medium">{point.title}</h3>
                <p className="mt-2 text-sm leading-6 text-black/65 dark:text-white/65">{point.body}</p>
              </li>
            ))}
          </ul>
        </section>
      </main>

      <footer className="border-t border-black/10 dark:border-white/15">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-3 px-4 py-8 text-sm text-black/60 sm:flex-row sm:items-center sm:justify-between sm:px-6 dark:text-white/60">
          <p>Entertainment aur self-reflection ke liye. Medical ya financial salah nahi.</p>
          <nav aria-label="Legal" className="flex gap-4">
            <Link href="/privacy" className="underline underline-offset-4">Privacy</Link>
            <Link href="/terms" className="underline underline-offset-4">Terms</Link>
          </nav>
        </div>
      </footer>
    </>
  );
}
