"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

interface MeUser {
  readonly id: string;
  readonly email: string;
  readonly name: string | null;
}

type AuthState =
  | { readonly status: "loading" }
  | { readonly status: "guest" }
  | { readonly status: "user"; readonly user: MeUser };

const NAV: ReadonlyArray<{ readonly href: "/read" | "/scan" | "/privacy" | "/terms"; readonly label: string }> = [
  { href: "/read", label: "Reading" },
  { href: "/scan", label: "Scan" },
  { href: "/privacy", label: "Privacy" },
  { href: "/terms", label: "Terms" },
];

/**
 * Site header — glass over the ambient glow, with the current section marked.
 *
 * Auth state comes from /api/auth/me rather than a prop so the session cookie can stay httpOnly:
 * the browser never needs to read the token to know whether it is signed in.
 */
export function Header() {
  const router = useRouter();
  const pathname = usePathname();
  const [auth, setAuth] = useState<AuthState>({ status: "loading" });
  const [busy, setBusy] = useState(false);
  /**
   * Menu state is stored with the path it was opened on, so `menuOpen` is *derived*: any navigation
   * makes the stored path stale and the menu reads as closed. No effect, so nothing has to re-render
   * a second time just to tidy up after a route change.
   */
  const [menu, setMenu] = useState<{ readonly open: boolean; readonly path: string }>({ open: false, path: pathname });
  const menuOpen = menu.open && menu.path === pathname;
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
        // Aborted on unmount, or the network is down — either way the header degrades to signed out.
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
      setMenu({ open: false, path: pathname });
      router.refresh();
    } finally {
      if (isMountedRef.current) setBusy(false);
    }
  }, [router, pathname]);

  const linkClass = (href: string): string => {
    const isActive = pathname === href;
    return [
      "rounded-full px-3 py-1.5 font-display text-sm tracking-tight transition-colors",
      isActive ? "bg-mount-glow/10 text-mount-glow" : "text-muted hover:text-ink",
    ].join(" ");
  };

  return (
    <header className="sticky top-0 z-40 border-b border-hairline bg-night/70 backdrop-blur-xl">
      <nav aria-label="Main" className="mx-auto flex w-full max-w-5xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
        <Link href="/" className="font-display text-lg font-semibold tracking-tight text-ink">
          Hast<span className="text-mount-glow">Rekha</span>
        </Link>

        <div className="hidden items-center gap-1 sm:flex">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              aria-current={pathname === item.href ? "page" : undefined}
              className={linkClass(item.href)}
            >
              {item.label}
            </Link>
          ))}
          <span aria-hidden="true" className="mx-2 h-5 w-px bg-hairline" />
          <AuthControl auth={auth} busy={busy} onLogout={logout} />
        </div>

        <button
          type="button"
          onClick={() => setMenu({ open: !menuOpen, path: pathname })}
          aria-expanded={menuOpen}
          aria-controls="mobile-menu"
          aria-label={menuOpen ? "Menu band karo" : "Menu kholo"}
          className="rounded-full border border-hairline p-2 text-ink sm:hidden"
        >
          <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth={1.75}>
            {menuOpen ? (
              <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
            ) : (
              <path d="M4 7h16M4 12h16M4 17h16" strokeLinecap="round" />
            )}
          </svg>
        </button>
      </nav>

      {/* `hidden` rather than unmounting: no reflow of the page beneath when it toggles. */}
      <div id="mobile-menu" hidden={!menuOpen} className="border-t border-hairline sm:hidden">
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-1 px-4 py-3">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              aria-current={pathname === item.href ? "page" : undefined}
              className={`${linkClass(item.href)} text-left`}
            >
              {item.label}
            </Link>
          ))}
          <div className="pt-2">
            <AuthControl auth={auth} busy={busy} onLogout={logout} />
          </div>
        </div>
      </div>
    </header>
  );
}

function AuthControl({
  auth,
  busy,
  onLogout,
}: {
  readonly auth: AuthState;
  readonly busy: boolean;
  readonly onLogout: () => Promise<void>;
}) {
  if (auth.status === "loading") {
    // Same footprint as the resolved control, so nothing jumps when it settles.
    return <span aria-label="Sign-in check ho raha hai" className="block h-8 w-24 animate-pulse rounded-full bg-hairline" />;
  }

  if (auth.status === "user") {
    return (
      <span className="flex items-center gap-3">
        <span className="hidden max-w-[10rem] truncate text-sm text-muted md:inline" title={auth.user.email}>
          {auth.user.name ?? auth.user.email}
        </span>
        <button
          type="button"
          onClick={() => void onLogout()}
          disabled={busy}
          className="rounded-full border border-hairline px-3 py-1.5 font-display text-sm font-medium text-ink transition-colors hover:border-mount-glow disabled:opacity-50"
        >
          {busy ? "Logging out…" : "Logout"}
        </button>
      </span>
    );
  }

  return (
    <Link
      href="/login"
      className="rounded-full bg-mount-glow px-4 py-1.5 font-display text-sm font-semibold text-night transition-opacity hover:opacity-90"
    >
      Login
    </Link>
  );
}
