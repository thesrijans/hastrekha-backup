/* ============================================================================
 * THE DEPLOY GATE (D1)
 *
 * What a deploy exposes is decided by one build-time flag and guarded by two
 * files, and every one of those decisions is asserted here so it cannot drift:
 *
 *  1. THE SANCTUARY FLAG. /sanctuary, /scan/chamber and /read/pothi open on
 *     NEXT_PUBLIC_SANCTUARY === "1" and on nothing else — inlined at `next
 *     build`, so a build without it bakes the three as 404s. /dev/* and the
 *     /sanctuary/materials bench keep the development gate: they are
 *     instruments, not rooms, and no flag opens them on a deploy.
 *  2. THE FRONT DOOR. With the flag, next.config.ts redirects "/" to
 *     /sanctuary (307); without it there is no redirect at all.
 *  3. .env.example lists every variable the app reads, by NAME and never by
 *     value — so it is the checklist for a new environment, not a leak.
 *  4. .vercelignore repeats .gitignore line for line. The Vercel CLI reads
 *     only .vercelignore, and without the mirror a CLI deploy would upload
 *     captures/ and fixtures/private/ — raw palm frames and a face recording.
 *  5. The prebuild generates the Prisma client (git-ignored, so absent on a
 *     clean builder) before the WASM is vendored.
 *
 * The gates themselves are asserted in source, as chamber-ui, pothi-book and
 * sanctuary-home already do: the pages import CSS modules and next/font, which
 * a node process cannot evaluate. Whether a real build includes or excludes
 * the routes is measured by building both ways (see the D1 commit), not here.
 * ========================================================================== */
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import nextConfig from "../next.config";

let assertions = 0;
const ok = (condition: boolean, message: string): void => {
  assert.ok(condition, message);
  assertions += 1;
};

const ROOT = path.resolve(__dirname, "..");
const read = (...parts: string[]): string => readFileSync(path.join(ROOT, ...parts), "utf8");
const withoutComments = (text: string): string =>
  text.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1");

const FLAG_GATE = 'if (process.env.NEXT_PUBLIC_SANCTUARY !== "1") notFound();';
const DEV_GATE = 'process.env.NODE_ENV !== "development"';

/* ----------------------------- 1. the sanctuary flag ----------------------------- */

for (const route of [
  ["app", "sanctuary", "page.tsx"],
  ["app", "scan", "chamber", "page.tsx"],
  ["app", "read", "pothi", "page.tsx"],
]) {
  const name = `/${route.slice(1, -1).join("/")}`;
  const code = withoutComments(read(...route));
  ok(code.split(FLAG_GATE).length === 2, `${name} gates on the sanctuary flag, exactly once`);
  ok(!code.includes("NODE_ENV") && !code.includes("SNC_MEASURE"), `${name} has no other key: the development gate and the measurement lift are gone`);
  ok(/robots:\s*\{\s*index:\s*false/.test(code), `${name} keeps noindex, so the preview deploys it opens on stay out of search`);
}

for (const route of [
  ["app", "dev", "capture", "page.tsx"],
  ["app", "dev", "label", "page.tsx"],
  ["app", "dev", "rekha-monitor", "page.tsx"],
  ["app", "sanctuary", "materials", "page.tsx"],
]) {
  const name = `/${route.slice(1, -1).join("/")}`;
  const code = withoutComments(read(...route));
  ok(code.includes(DEV_GATE) && code.includes("notFound()"), `${name} keeps the development gate`);
  ok(!code.includes("NEXT_PUBLIC_SANCTUARY"), `${name} is not opened by the sanctuary flag — a deploy never serves it`);
}

/* ------------------------------- 2. the front door ------------------------------- */

async function redirectsWith(value: string | undefined): Promise<unknown[]> {
  const saved = process.env.NEXT_PUBLIC_SANCTUARY;
  if (value === undefined) delete process.env.NEXT_PUBLIC_SANCTUARY;
  else process.env.NEXT_PUBLIC_SANCTUARY = value;
  try {
    assert.ok(nextConfig.redirects, "next.config.ts defines redirects()");
    return await nextConfig.redirects();
  } finally {
    if (saved === undefined) delete process.env.NEXT_PUBLIC_SANCTUARY;
    else process.env.NEXT_PUBLIC_SANCTUARY = saved;
  }
}

/* ------------------------------ 3. .env.example -------------------------------- */

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (entry === "node_modules" || entry === "generated") continue;
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (/\.(ts|tsx|mts|mjs|js)$/.test(entry)) out.push(full);
  }
  return out;
}

/** Every variable name the app's own code reads — app/, lib/, components/ and the two root configs. */
function namesTheAppReads(): Set<string> {
  const files = [
    ...["app", "lib", "components"].flatMap((dir) => walk(path.join(ROOT, dir))),
    path.join(ROOT, "next.config.ts"),
    path.join(ROOT, "prisma.config.ts"),
  ];
  const names = new Set<string>();
  const patterns = [
    /process\.env\.([A-Z_][A-Z0-9_]*)/g,
    /process\.env\[["']([A-Z_][A-Z0-9_]*)["']\]/g,
    // lib/env.ts reads through a local helper: read(raw, "NAME") / need(raw, "NAME", …)
    /\b(?:read|need)\(raw,\s*"([A-Z_][A-Z0-9_]*)"/g,
  ];
  for (const file of files) {
    const code = withoutComments(readFileSync(file, "utf8"));
    for (const pattern of patterns) for (const match of code.matchAll(pattern)) names.add(match[1]!);
  }
  names.delete("NODE_ENV"); // set by Next itself, never by an environment file
  return names;
}

/* ---------------------------------- main ---------------------------------- */

async function main(): Promise<void> {
  ok((await redirectsWith(undefined)).length === 0, "without the flag there is no redirect: / is the original home");
  ok((await redirectsWith("true")).length === 0, 'the flag must be the literal "1" — "true" opens nothing');
  const open = await redirectsWith("1");
  ok(
    open.length === 1 && JSON.stringify(open[0]) === JSON.stringify({ source: "/", destination: "/sanctuary", permanent: false }),
    "with the flag, / redirects to /sanctuary, temporary (307) because it follows a flag",
  );

  const example = read(".env.example");
  const entries = example
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== "" && !line.startsWith("#"));
  const listed = new Set<string>();
  for (const line of entries) {
    const match = /^([A-Z_][A-Z0-9_]*)=(.*)$/.exec(line);
    ok(match !== null, `.env.example line is NAME= (got "${line.split("=")[0]}=…")`);
    ok(match![2] === "", `.env.example carries no value for ${match![1]}`);
    listed.add(match![1]!);
  }
  const readByApp = namesTheAppReads();
  for (const name of readByApp) ok(listed.has(name), `.env.example lists ${name}, which the app reads`);
  for (const name of listed) ok(readByApp.has(name), `.env.example lists only what the app reads — ${name} is read somewhere`);
  ok(listed.has("NEXT_PUBLIC_SANCTUARY"), "the sanctuary flag is on the checklist");

  const gitignore = read(".gitignore").split(/\r?\n/).map((line) => line.trim()).filter((line) => line !== "" && !line.startsWith("#"));
  const vercelignore = new Set(read(".vercelignore").split(/\r?\n/).map((line) => line.trim()));
  for (const pattern of gitignore) ok(vercelignore.has(pattern), `.vercelignore repeats .gitignore's "${pattern}"`);
  for (const privatePath of ["captures/", "fixtures/private/", "scan-sessions/", "*.session.zip", ".env*"]) {
    ok(vercelignore.has(privatePath), `and so a CLI deploy never uploads ${privatePath}`);
  }
  ok(gitignore.includes(".vercel"), "the per-machine project link (.vercel) is git-ignored");

  const scripts = (JSON.parse(read("package.json")) as { scripts: Record<string, string> }).scripts;
  ok(
    /^prisma generate && node scripts\/vendor-mediapipe\.mjs$/.test(scripts.prebuild ?? ""),
    "prebuild generates the git-ignored Prisma client, then vendors the WASM — a clean builder has neither",
  );

  console.log(`DEPLOY GATE ASSERTIONS PASSED (${assertions})`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
