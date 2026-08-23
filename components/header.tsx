"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

interface MeUser {
  readonly id: string;
  readonly email: string;
  readonly name: string | null;
}

type AuthState = { readonly status: "loading" } | { readonly status: "guest" } | { readonly status: "user"; readonly user: MeUser };

/** Site header. Auth state comes from /api/auth/me so the session cookie stays httpOnly. */
export function Header() {
  const router = useRouter();
  const [auth, setAuth] = useState<AuthState>({ status: "loading" });
  const [busy, setBusy] = useState(false);
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    const controller = new AbortController();

    void (async () => {
      try {
        const response = await fetch("/api/auth/me", { signal: controller.signal, cache: "no-store" });
        if (!isMountedRef.current) return;
        if (!response.ok) {
          setAuth({ status: "guest" });
          return;
        }
        const payload = (await response.json()) as { user: MeUser };
        if (isMountedRef.current) setAuth({ status: "user", user: payload.user });
      } catch {
        // Abort on unmount, or the network is down — either way the header degrades to "signed out".
        if (isMountedRef.current) setAuth({ status: "guest" });
      }
    })();

    return () => {
      isMountedRef.current = false;
      controller.abort();
    };
  }, []);

  const logout = useCallback(async () => {
    setBusy(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
      if (!isMountedRef.current) return;
      setAuth({ status: "guest" });
      router.refresh();
    } finally {
      if (isMountedRef.current) setBusy(false);
    }
  }, [router]);

  return (
    <header className="border-b border-black/10 dark:border-white/15">
      <nav aria-label="Main" className="mx-auto flex w-full max-w-3xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
        <Link href="/" className="text-base font-semibold tracking-tight">
          HastRekha
        </Link>

        <div className="flex items-center gap-3 text-sm">
          <Link href="/read" className="rounded px-2 py-1 underline-offset-4 hover:underline">
            Reading
          </Link>

          {auth.status === "loading" ? (
            <span aria-live="polite" className="h-8 w-20 animate-pulse rounded bg-black/10 dark:bg-white/15" aria-label="Checking sign-in" />
          ) : auth.status === "user" ? (
            <>
              <span className="hidden max-w-[12rem] truncate text-black/60 sm:inline dark:text-white/60" title={auth.user.email}>
                {auth.user.name ?? auth.user.email}
              </span>
              <button
                type="button"
                onClick={() => void logout()}
                disabled={busy}
                className="rounded-full border border-black/15 px-3 py-1.5 font-medium hover:bg-black/5 disabled:opacity-50 dark:border-white/20 dark:hover:bg-white/10"
              >
                {busy ? "Logging out…" : "Logout"}
              </button>
            </>
          ) : (
            <Link
              href="/login"
              className="rounded-full bg-foreground px-3 py-1.5 font-medium text-background hover:opacity-90"
            >
              Login
            </Link>
          )}
        </div>
      </nav>
    </header>
  );
}
