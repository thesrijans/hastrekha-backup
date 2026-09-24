import type { NextConfig } from "next";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

/* ============================ The build stamp (M0) ============================
 *
 * Which build is this? Every sanctuary route's footer, the chamber and
 * GET /api/version answer with the same two values, inlined at `next build`
 * through the `env` key below (Next replaces `process.env.NEXT_PUBLIC_BUILD_SHA`
 * with the literal in server and client bundles alike; a dynamic lookup would
 * not be replaced, so the readers spell the names out). The key's docs page is
 * marked legacy but carries no deprecation, and it is the one mechanism whose
 * value wins over an env file — which is what "never set by hand" needs.
 *
 * The SHA, in order:
 *   1. VERCEL_GIT_COMMIT_SHA — Vercel's builder sets it for a Git-integration
 *      deploy. Taken only when non-empty: an env file pulled by the CLI can
 *      carry the name with nothing after the "=".
 *   2. NEXT_PUBLIC_BUILD_SHA given to the build — the D1.5 GitHub Actions job
 *      uploads a git-less export and passes the pushed commit's first seven
 *      characters with `--build-env`, because Vercel's builder has no git to
 *      ask there. Taken only when it looks like a SHA: the name is also listed
 *      empty in .env.example, and a copied env file must not win with "".
 *   3. `git rev-parse --short HEAD` — a checkout with .git.
 *   4. .git-archive-sha — a `git archive` export has no .git, but that file is
 *      marked `export-subst` in .gitattributes, so git writes the archived
 *      commit into it as it exports. In a checkout it still reads "$Format:%H$"
 *      and is skipped.
 *   5. "unknown" — never undefined: an undefined `env` value is dropped rather
 *      than inlined, which would leave the reads unreplaced.
 *
 * This runs wherever the config is loaded (build, `next start`, the dev server,
 * and test/deploy-gate.test.ts, which imports this file), so it must never
 * throw: git may be absent, and the export may be a plain directory.
 */
/*
 * The project directory. `__dirname` is what SWC's CommonJS transpile of this file provides; the guard
 * is for Next's opt-in native TypeScript loader (`--experimental-next-config-strip-types`), which
 * evaluates the file as ESM and has none. `typeof` on an undeclared name does not throw.
 */
const configDir = typeof __dirname === "string" ? __dirname : process.cwd();

function gitShortHead(): string | null {
  try {
    const out = execSync("git rev-parse --short HEAD", { cwd: configDir, stdio: ["ignore", "pipe", "ignore"], timeout: 5_000 })
      .toString()
      .trim();
    return /^[0-9a-f]{7,40}$/.test(out) ? out : null;
  } catch {
    return null;
  }
}

function archivedSha(): string | null {
  try {
    const stamp = readFileSync(path.join(configDir, ".git-archive-sha"), "utf8").trim();
    return /^[0-9a-f]{40}$/.test(stamp) ? stamp : null;
  } catch {
    return null;
  }
}

const vercelSha = (process.env.VERCEL_GIT_COMMIT_SHA ?? "").trim();
const givenSha = (process.env.NEXT_PUBLIC_BUILD_SHA ?? "").trim();
const buildSha = vercelSha !== "" ? vercelSha : /^[0-9a-f]{7,40}$/.test(givenSha) ? givenSha : (gitShortHead() ?? archivedSha() ?? "unknown");
const builtAt = new Date().toISOString();

/**
 * The front door (D1.1). A build made with NEXT_PUBLIC_SANCTUARY=1 — the flag
 * /sanctuary, /scan/chamber and /read/pothi open on — also sends "/" to the
 * sanctuary, so the deploy's root URL is the room and not the pre-sanctuary
 * home. Without the flag there is no redirect and "/" is the page it always
 * was. Temporary (307): it follows a flag, so nothing should cache it.
 *
 * Read when Next calls redirects(), which it does once, at build, after the
 * .env files are loaded — the same moment the pages' copy of the flag is
 * inlined, so the two can never disagree within a build.
 */
const nextConfig: NextConfig = {
  env: {
    NEXT_PUBLIC_BUILD_SHA: buildSha,
    NEXT_PUBLIC_BUILT_AT: builtAt,
  },
  async redirects() {
    if (process.env.NEXT_PUBLIC_SANCTUARY !== "1") return [];
    return [{ source: "/", destination: "/sanctuary", permanent: false }];
  },
};

export default nextConfig;
