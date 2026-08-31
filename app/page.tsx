import type { Metadata } from "next";
import Link from "next/link";
import { HoloPalm } from "@/components/holo-palm";

export const metadata: Metadata = {
  title: "HastRekha — classical palmistry, bina dar ke",
  description: "1900s ke classical palmistry texts se cited reading. Koi maut ya bimari ki bhavishyavani nahi.",
};

/** Hero scan: lit unevenly so the palm reads as a real reading, not a uniform diagram. */
const HERO_MOUNTS: Record<string, number> = {
  jupiter: 0.78,
  saturn: 0.42,
  sun: 0.92,
  mercury: 0.55,
  mars_inner: 0.48,
  venus: 0.74,
  moon: 0.62,
};

const TRUST_POINTS: ReadonlyArray<{
  readonly title: string;
  readonly body: string;
  readonly icon: "book" | "shield" | "device";
}> = [
  {
    icon: "book",
    title: "Cited from 1900s classical texts",
    body: "Har baat ke saath uska source — Cheiro aur doosre classical texts, page tak.",
  },
  {
    icon: "shield",
    title: "No death or disease predictions",
    body: "Dar bechne wala kaam nahi. Sirf wahi jo tumhe aage badhne mein kaam aaye.",
  },
  {
    icon: "device",
    title: "Palm images never leave your device",
    body: "Scan tumhare phone par hi chalta hai — server tak sirf feature scores aate hain.",
  },
];

const STEPS: ReadonlyArray<{ readonly title: string; readonly body: string }> = [
  {
    title: "DOB do",
    body: "Sirf date of birth se ek poori reading ban jaati hai — birth-window rules turant lag jaate hain.",
  },
  {
    title: "Mounts scan karo",
    body: "Palm par mount tap karo, phir flat / normal / developed / large chuno. Depth meter live upar jaata hai.",
  },
  {
    title: "Scan report lo",
    body: "Har section ke neeche uske citation chips. Chip par tap karo, poora rule aur uska page khul jaata hai.",
  },
];

function TrustIcon({ name }: { readonly name: "book" | "shield" | "device" }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className="hr-glow-chrome h-5 w-5 text-mount-glow"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {name === "book" ? (
        <>
          <path d="M4 5.5A1.5 1.5 0 0 1 5.5 4H19v14H5.5A1.5 1.5 0 0 0 4 19.5z" />
          <path d="M19 18v2H5.5A1.5 1.5 0 0 1 4 18.5" />
          <path d="M8 8h7M8 11h7" />
        </>
      ) : name === "shield" ? (
        <>
          <path d="M12 3l7 3v5.5c0 4-3 7.5-7 9-4-1.5-7-5-7-9V6z" />
          <path d="M9 12l2 2 4-4" />
        </>
      ) : (
        <>
          <rect x="7" y="2.5" width="10" height="19" rx="2.5" />
          <path d="M11 18.5h2" />
        </>
      )}
    </svg>
  );
}

export default function Home() {
  return (
    <>
      <main className="flex flex-1 flex-col">
        {/* --------------------------------- Hero --------------------------------- */}
        <section className="mx-auto grid w-full max-w-6xl items-center gap-14 px-4 pb-20 pt-12 sm:px-6 md:grid-cols-[1.05fr_0.95fr] md:gap-10 md:pt-20">
          <div className="flex flex-col items-start gap-7">
            <span className="flex items-center gap-2 rounded-full border border-hairline px-3 py-1 font-display text-[0.7rem] uppercase tracking-[0.22em] text-mount-glow">
              <span aria-hidden="true" className="hr-glow-chrome h-1.5 w-1.5 rounded-full bg-mount-glow" />
              548 cited rules
            </span>

            <h1 className="font-display text-[2.25rem] font-semibold leading-[1.06] tracking-tight text-ink sm:text-5xl md:text-[3.5rem]">
              Apni hatheli scan karo — classical texts se, <span className="text-line-glow">bina dar ke.</span>
            </h1>

            <p className="max-w-xl text-lg leading-8 text-muted">
              Sirf date of birth se shuru karo. Mounts add karoge to scan aur gehra hota jaayega — har baat ke saath
              uska source, hamesha.
            </p>

            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <Link
                href="/read"
                className="flex h-12 items-center justify-center rounded-full bg-mount-glow px-8 font-display text-base font-semibold tracking-tight text-night transition-opacity hover:opacity-90"
              >
                Free reading shuru karo
              </Link>
              <span className="text-sm text-muted">Login ki zaroorat nahi.</span>
            </div>
          </div>

          <div className="relative mx-auto w-full max-w-md">
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-8 -z-10 rounded-full bg-mount-glow/10 blur-3xl"
            />
            <HoloPalm mounts={HERO_MOUNTS} animate />
          </div>
        </section>

        {/* ------------------------------- Trust row ------------------------------- */}
        <section aria-labelledby="trust-heading" className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-16 sm:px-6">
          <h2 id="trust-heading" className="font-display text-xs uppercase tracking-[0.22em] text-muted">
            Kyun bharosa karo
          </h2>
          {/* gap-px over a hairline background paints the dividers — one border, no double lines. */}
          <ul className="grid gap-px overflow-hidden rounded-2xl border border-hairline bg-hairline sm:grid-cols-3">
            {TRUST_POINTS.map((point) => (
              <li key={point.title} className="flex flex-col gap-3 bg-night p-6">
                <TrustIcon name={point.icon} />
                <h3 className="font-display text-lg font-semibold leading-6 text-ink">{point.title}</h3>
                <p className="text-sm leading-6 text-muted">{point.body}</p>
              </li>
            ))}
          </ul>
        </section>

        {/* ------------------------------ How it works ----------------------------- */}
        <section aria-labelledby="how-heading" className="mx-auto flex w-full max-w-6xl flex-col gap-10 px-4 py-16 sm:px-6">
          <h2 id="how-heading" className="font-display text-2xl font-semibold tracking-tight text-ink sm:text-3xl">
            Kaise chalta hai
          </h2>
          <ol className="grid gap-8 sm:grid-cols-3">
            {STEPS.map((step, index) => (
              <li key={step.title} className="flex flex-col gap-3 border-t border-hairline pt-6">
                <span className="flex items-baseline gap-2 font-display text-xs uppercase tracking-[0.22em] text-mount-glow">
                  <span aria-hidden="true">▸</span>
                  {`STEP ${String(index + 1).padStart(2, "0")}`}
                </span>
                <h3 className="font-display text-xl font-semibold text-ink">{step.title}</h3>
                <p className="text-sm leading-6 text-muted">{step.body}</p>
              </li>
            ))}
          </ol>
          <Link
            href="/read"
            className="self-start rounded-full border border-hairline px-6 py-3 font-display text-sm font-medium text-ink transition-colors hover:border-mount-glow hover:text-mount-glow"
          >
            Chalo scan karte hain
          </Link>
        </section>
      </main>

      <footer className="border-t border-hairline">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-3 px-4 py-8 text-sm text-muted sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <p>Entertainment aur self-reflection ke liye. Medical ya financial salah nahi.</p>
          <nav aria-label="Legal" className="flex gap-4">
            <Link href="/privacy" className="underline underline-offset-4 hover:text-ink">
              Privacy
            </Link>
            <Link href="/terms" className="underline underline-offset-4 hover:text-ink">
              Terms
            </Link>
          </nav>
        </div>
      </footer>
    </>
  );
}
