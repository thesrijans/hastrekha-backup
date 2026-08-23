import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Login — HastRekha",
  description: "Google se sign in karke apni poori reading unlock karo.",
};

/** Codes come from our own redirects only; anything else falls back to the generic message. */
const ERROR_COPY: Readonly<Record<string, string>> = {
  oauth: "Sign-in poora nahi ho paya. Ek baar phir koshish karo.",
  rate_limit: "Bahut saari koshishein ho gayi. Ek minute ruk kar try karo.",
};

export default async function LoginPage(props: PageProps<"/login">) {
  const params = await props.searchParams;
  const rawError = params.error;
  const code = typeof rawError === "string" ? rawError : undefined;
  const message = code === undefined ? undefined : (ERROR_COPY[code] ?? ERROR_COPY.oauth);

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-8 px-4 py-16 sm:px-6">
      <div className="flex flex-col gap-3">
        <h1 className="font-display text-3xl font-semibold tracking-tight text-ink sm:text-4xl">Sign in</h1>
        <p className="text-base leading-7 text-muted">
          Apni hatheli, classical texts, aur zero dar-wali reading.
        </p>
      </div>

      {message !== undefined ? (
        <div
          role="alert"
          className="rounded-lg border border-line-glow/40 bg-line-glow/10 px-4 py-3 text-sm leading-6 text-ink"
        >
          {message}
        </div>
      ) : null}

      <a
        href="/api/auth/google/start"
        className="flex h-12 w-full items-center justify-center gap-3 rounded-full bg-mount-glow px-5 font-display text-base font-semibold text-night transition-opacity hover:opacity-90"
      >
        <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5" focusable="false">
          <path
            fill="currentColor"
            d="M21.35 11.1h-9.17v2.98h5.27c-.23 1.37-1.6 4.02-5.27 4.02-3.17 0-5.76-2.62-5.76-5.85s2.59-5.85 5.76-5.85c1.8 0 3.01.77 3.7 1.43l2.52-2.43C16.78 3.9 14.7 3 12.18 3 7.03 3 2.85 7.17 2.85 12.25s4.18 9.25 9.33 9.25c5.39 0 8.96-3.79 8.96-9.13 0-.61-.07-1.08-.16-1.53z"
          />
        </svg>
        Continue with Google
      </a>

      <p className="text-xs leading-6 text-muted">
        Sign in karne par tum hamari <Link href="/terms" className="underline underline-offset-4 hover:text-ink">Terms</Link> aur{" "}
        <Link href="/privacy" className="underline underline-offset-4 hover:text-ink">Privacy Policy</Link> se sehmat ho.
      </p>
    </main>
  );
}
