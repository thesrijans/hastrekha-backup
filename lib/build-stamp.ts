/**
 * The build stamp (M0) — which build this is, as two constants.
 *
 * next.config.ts resolves them at `next build` and inlines them through its
 * `env` key, so these reads are literals by the time any bundle runs: the same
 * value on the server, in the browser and from GET /api/version, never a
 * request-time clock. They are read as spelled-out member accesses on purpose —
 * `process.env[name]` is not inlined.
 *
 * Outside a build (a plain Node test, the shell rendered in `tsx`) nothing has
 * been inlined and the fallbacks stand: "unknown" and null.
 */

/**
 * The full value next.config.ts resolved: Vercel's 40-char SHA, git's short one, the 40-char
 * `.git-archive-sha` of a `git archive` export, or "unknown".
 */
export const BUILD_SHA: string = process.env.NEXT_PUBLIC_BUILD_SHA ?? "unknown";

/** ISO 8601, taken when the config was evaluated for the build; null outside a build. */
export const BUILT_AT: string | null = process.env.NEXT_PUBLIC_BUILT_AT ?? null;

/** Seven characters, the shape `git rev-parse --short` gives, whichever source the SHA came from. */
export const BUILD_SHA_SHORT: string = BUILD_SHA.slice(0, 7);

/**
 * "2026-09-23 02:10Z" — the minute, in UTC, from an ISO stamp. Anything that is
 * not an ISO stamp comes back as given, so a footer never shows "Invalid Date".
 */
export function formatBuiltAt(iso: string): string {
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/.exec(iso);
  return match === null ? iso : `${match[1]} ${match[2]}Z`;
}
