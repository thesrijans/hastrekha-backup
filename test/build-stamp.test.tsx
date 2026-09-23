/* ============================================================================
 * THE BUILD STAMP (M0)
 *
 * Which build is this? Three surfaces answer — the footer of every shelled
 * sanctuary route, the chamber's top row, and GET /api/version — and all three
 * must answer with the SAME two constants, resolved once by next.config.ts and
 * inlined at `next build`. What is pinned here:
 *
 *   1. next.config.ts exposes NEXT_PUBLIC_BUILD_SHA and NEXT_PUBLIC_BUILT_AT
 *      through `env`, shaped like a SHA and an ISO stamp, and never undefined
 *      (an undefined `env` value is dropped, not inlined).
 *   2. Every reader spells the names out — `process.env.NEXT_PUBLIC_BUILD_SHA`
 *      — because a dynamic lookup is not inlined; and .env.example lists them.
 *   3. The shell mounts the stamp once, after the route's content and before
 *      the phone bar; the chamber mounts it when the readout is not showing and
 *      folds the SHA into the readout when it is.
 *   4. /api/version returns { sha, builtAt } from those constants, imports
 *      nothing from lib/env (which throws at import), and is never cached.
 *   5. The `git archive` fallback is wired: .gitattributes marks
 *      .git-archive-sha export-subst and the checkout carries the placeholder.
 *
 * Rendered with the CSS-module require hook test/sanctuary-shell.test.tsx uses.
 * ========================================================================== */
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import Module, { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createElement, type ReactElement } from "react";
import { renderToString } from "react-dom/server";
import nextConfig from "../next.config";
import { BUILD_SHA, BUILD_SHA_SHORT, BUILT_AT, formatBuiltAt } from "../lib/build-stamp";

let assertions = 0;
const ok = (condition: boolean, message: string): void => {
  assert.ok(condition, message);
  assertions += 1;
};

const CLASS_NAME_STUB: Record<string, string> = new Proxy({}, { get: (_t, key) => (typeof key === "string" ? key : "") });
interface CjsExtensionHost {
  _extensions: Record<string, (loaded: { exports: unknown }, filename: string) => void>;
}
(Module as unknown as CjsExtensionHost)._extensions[".css"] = (loaded): void => {
  loaded.exports = { __esModule: true, default: CLASS_NAME_STUB };
};

const ROOT = path.resolve(__dirname, "..");
const read = (...parts: string[]): string => readFileSync(path.join(ROOT, ...parts), "utf8");
const withoutComments = (text: string): string =>
  text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const count = (haystack: string, needle: string): number => haystack.split(needle).length - 1;

type Component = (props: Record<string, unknown>) => ReactElement;
const require_ = createRequire(__filename);
const render = (component: Component, props: Record<string, unknown> = {}, children?: ReactElement): string =>
  renderToString(createElement(component, props, children)).replace(/<!-- -->/g, "");

const SHA_SHAPE = /^([0-9a-f]{7,40}|unknown)$/;
const ISO_SHAPE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

/* ----------------------- 1. resolved in the config, at build ----------------------- */

/** Whether `git` answers on this machine: the spec's second source, and the one this checkout relies on. */
const gitPresent = ((): boolean => {
  try {
    execSync("git --version", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

{
  const env = nextConfig.env ?? {};
  ok(typeof env.NEXT_PUBLIC_BUILD_SHA === "string" && SHA_SHAPE.test(env.NEXT_PUBLIC_BUILD_SHA), `next.config.ts resolves NEXT_PUBLIC_BUILD_SHA to a SHA or "unknown" (got ${String(env.NEXT_PUBLIC_BUILD_SHA)})`);
  /* Only where git can answer: a machine without it legitimately falls through to the archive stamp or "unknown". */
  if (gitPresent) ok(env.NEXT_PUBLIC_BUILD_SHA !== "unknown", "and where git answers it is a real SHA — the fallbacks are for a builder without git");
  ok(typeof env.NEXT_PUBLIC_BUILT_AT === "string" && ISO_SHAPE.test(env.NEXT_PUBLIC_BUILT_AT), "NEXT_PUBLIC_BUILT_AT is an ISO 8601 stamp");
  ok(Math.abs(Date.now() - Date.parse(env.NEXT_PUBLIC_BUILT_AT!)) < 60_000, "taken when the config was evaluated, not stored anywhere");

  const config = withoutComments(read("next.config.ts"));
  ok(/vercelSha !== "" \? vercelSha : \(gitShortHead\(\) \?\? archivedSha\(\) \?\? "unknown"\)/.test(config), "resolved in that order: Vercel's SHA, then git, then the archive stamp, then \"unknown\"");
  ok(config.includes('execSync("git rev-parse --short HEAD"') && config.includes('".git-archive-sha"'), "and those are the git command and the archive file the spec names");
  ok(/execSync\([^)]*\)[\s\S]*catch/.test(config) && count(config, "catch") >= 2, "and both lookups are guarded — the config runs at `next start`, in the dev server and in this test, where git or the file may be missing");
  ok(/\(process\.env\.VERCEL_GIT_COMMIT_SHA \?\? ""\)\.trim\(\)/.test(config), "a Vercel SHA counts only when non-empty: a pulled env file can carry the name with nothing after it");
  ok(/export default nextConfig;/.test(config) && /async redirects\(\)/.test(config), "the export stays an object with redirects() — deploy-gate calls it");
}

/* ------------------------------ 2. read as literals ------------------------------ */

{
  const lib = withoutComments(read("lib", "build-stamp.ts"));
  ok(lib.includes("process.env.NEXT_PUBLIC_BUILD_SHA") && lib.includes("process.env.NEXT_PUBLIC_BUILT_AT"), "lib/build-stamp.ts reads both names as spelled-out member accesses");
  ok(!/process\.env\[/.test(lib) && !/\bconst\s*\{[^}]*\}\s*=\s*process\.env/.test(lib), "never a dynamic lookup or a destructure, which Next would not inline");
  ok(BUILD_SHA === "unknown" && BUILT_AT === null, "outside a build nothing is inlined and the fallbacks stand");
  ok(BUILD_SHA_SHORT === "unknown".slice(0, 7), "the short form is the first seven characters");
  ok(formatBuiltAt("2026-09-23T02:10:44.123Z") === "2026-09-23 02:10Z", "the footer shows the minute in UTC");
  ok(formatBuiltAt("not a date") === "not a date", "and never \"Invalid Date\"");

  const example = read(".env.example").split(/\r?\n/).map((l) => l.trim());
  for (const name of ["NEXT_PUBLIC_BUILD_SHA", "NEXT_PUBLIC_BUILT_AT", "VERCEL_GIT_COMMIT_SHA"]) {
    ok(example.includes(`${name}=`), `.env.example lists ${name}, by name only`);
  }
}

/* --------------------------- 3. the two mounts --------------------------- */

{
  const { SanctuaryShell } = require_("../components/sanctuary/shell/sanctuary-shell") as { SanctuaryShell: Component };
  const html = render(SanctuaryShell, { activeHref: "/sanctuary", groundSeed: 7, className: "FONT-CLASS", header: false }, createElement("p", null, "the route's own content"));
  const stamp = html.indexOf("data-snc-build-stamp=");
  const content = html.indexOf("the route");
  const bar = html.lastIndexOf('aria-label="Sanctuary rooms"');
  ok(count(html, "data-snc-build-stamp=") === 1, "the shell mounts the stamp exactly once");
  ok(stamp > content && stamp < bar, "after the route's content and before the phone bar, inside the padded column");
  ok(html.includes("build unknown"), "and it prints the build it was made from");
  ok(!/<time/.test(html), "with no time when none was inlined — a footer never shows \"Invalid Date\"");

  const stampSource = read("components", "sanctuary", "shell", "build-stamp.tsx");
  ok(!/["']use client["']/.test(stampSource) && !/\buse[A-Z]\w*\(/.test(withoutComments(stampSource)), "the stamp is a server component: the shell still ships no JavaScript of its own");
  const stampCss = withoutComments(read("components", "sanctuary", "shell", "build-stamp.module.css"));
  ok(!/margin|padding|position|inset|z-index/.test(stampCss), "its stylesheet owns the type only — placement is the host's, so the two never write one property");
  ok(!/#[0-9a-fA-F]{3,8}\b/.test(stampCss) && /var\(--color-snc-/.test(stampCss), "no colour literal: every paint is a token");

  const shellCss = withoutComments(read("components", "sanctuary", "shell", "sanctuary-shell.module.css"));
  ok(/\.stamp\s*{[^}]*margin:\s*auto 0 0/.test(shellCss), "the shell pins it to the column's foot on a short page");

  const chamber = withoutComments(read("app", "scan", "chamber", "chamber-client.tsx"));
  ok(/showCost \? null : <BuildStamp className=\{styles\.buildStamp\} \/>/.test(chamber), "the chamber mounts it unless the ?cost=1 readout is showing");
  ok(/` · build \$\{BUILD_SHA_SHORT\}`/.test(chamber), "and folds the SHA into the readout when it is, so the two never share the row");
  const chamberCss = withoutComments(read("app", "scan", "chamber", "chamber.module.css"));
  const rule = /\.buildStamp\s*{([^}]*)}/.exec(chamberCss)?.[1] ?? "";
  ok(/position:\s*absolute/.test(rule) && /inset-block-start:\s*calc\(max\(0\.75rem, env\(safe-area-inset-top\)\)/.test(rule) && /pointer-events:\s*none/.test(rule), "on the back mark's row, safe-area aware, watched and never touched");
  ok(/z-index:\s*3/.test(rule), "at the marks' rung — under the gate leaves, the open sheet and the readout");
}

/* --------------------------------- 4. the probe --------------------------------- */

async function probe(): Promise<void> {
  const routeSource = withoutComments(read("app", "api", "version", "route.ts"));
  ok(!/lib\/env/.test(routeSource), "/api/version imports nothing from lib/env, which throws at import when the contract is incomplete");
  ok(/export const dynamic = "force-dynamic";/.test(routeSource) && /"cache-control": "no-store"/.test(routeSource), "and is never cached: the answer is always the answering deployment's own");
  const { GET } = (await import("../app/api/version/route")) as { GET: () => Promise<Response> };
  const response = await GET();
  const body = (await response.json()) as { sha?: unknown; builtAt?: unknown };
  ok(response.status === 200 && response.headers.get("cache-control") === "no-store", "GET /api/version answers 200, no-store");
  ok(body.sha === BUILD_SHA && body.builtAt === BUILT_AT, `with exactly the stamp's constants { sha, builtAt } (got ${JSON.stringify(body)})`);
  ok(Object.keys(body).sort().join(",") === "builtAt,sha", "and nothing else");
}

/* ------------------------------ 5. the archive path ------------------------------ */

{
  const attributes = read(".gitattributes").split(/\r?\n/).map((l) => l.trim());
  ok(attributes.includes(".git-archive-sha export-subst"), ".gitattributes marks .git-archive-sha export-subst, so `git archive` writes the commit into it");
  ok(read(".git-archive-sha").trim() === "$Format:%H$", "and the checkout carries the placeholder, which next.config.ts skips");
  ok(read(".github", "workflows", "vercel-deploy.yml").includes("vercel deploy --prebuilt --prod"), "D1.4's workflow is present");
}

probe()
  .then(() => console.log(`BUILD STAMP ASSERTIONS PASSED (${assertions})`))
  .catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
