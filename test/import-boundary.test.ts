/* ============================================================================
 * IMPORT BOUNDARY — the first mechanical one
 *
 * Two directions, both load-bearing:
 *
 *  1. PRODUCTION → DEV: nothing under app/ (except app/dev), components/, or
 *     lib/ (except lib/scan/dev) may import from lib/scan/dev or app/dev. The
 *     capture/labeler harness must be unshippable by construction, not by
 *     NODE_ENV luck.
 *
 *  2. LABELER → DETECTOR (decision D1): the labeler files import none of the
 *     eight banned detector modules. The eval set stays blank-slate because
 *     the code physically cannot see detector output, not because nobody
 *     wired it up yet.
 *
 * Plus: both /dev pages 404 outside development — asserted by calling their
 * default exports and expecting Next's notFound throw.
 * ========================================================================== */
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

let assertions = 0;
const ok = (condition: boolean, message: string): void => {
  assert.ok(condition, message);
  assertions += 1;
};

const ROOT = path.resolve(__dirname, "..");

/** Directory roots whose contents are dev-only and must never be imported from production code. */
const DEV_ONLY_ROOTS: readonly string[] = [path.join(ROOT, "lib", "scan", "dev"), path.join(ROOT, "app", "dev")];

/** D1's ban list — detector modules the labeler must not touch. `segmenter` covers all three files. */
const BANNED_FOR_LABELER =
  /lib[\\/]+scan[\\/]+(segmenter[^\\/]*|ridge|frangi|fusion|stack|completion|lines|quality)(\.ts)?$/;

/* -------------------------------- File walking -------------------------------- */

function walk(dir: string, exclude: readonly string[]): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (exclude.some((banned) => full === banned || full.startsWith(banned + path.sep))) continue;
    if (entry === "node_modules" || entry === "generated") continue;
    if (statSync(full).isDirectory()) {
      out.push(...walk(full, exclude));
    } else if (/\.(ts|tsx)$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

/** Static imports, export-from, side-effect imports, and dynamic import() specifiers. */
function specifiersOf(source: string): string[] {
  const found: string[] = [];
  for (const pattern of [
    /(?:import|export)\s+[\s\S]*?from\s+["']([^"']+)["']/g,
    /import\s*\(\s*["']([^"']+)["']\s*\)/g,
    /^import\s+["']([^"']+)["']/gm,
  ]) {
    for (const match of source.matchAll(pattern)) found.push(match[1]);
  }
  return found;
}

/** Resolve relative and '@/' specifiers to absolute paths; bare package names return null. */
function resolveSpecifier(file: string, specifier: string): string | null {
  if (specifier.startsWith("@/")) return path.join(ROOT, specifier.slice(2));
  if (specifier.startsWith(".")) return path.resolve(path.dirname(file), specifier);
  return null;
}

/* ----------------------- IMPORT_BOUNDARY 1: prod → dev ----------------------- */

const productionFiles = [
  ...walk(path.join(ROOT, "app"), [path.join(ROOT, "app", "dev")]),
  ...walk(path.join(ROOT, "components"), []),
  ...walk(path.join(ROOT, "lib"), [path.join(ROOT, "lib", "scan", "dev")]),
];
{
  const violations: string[] = [];
  for (const file of productionFiles) {
    for (const specifier of specifiersOf(readFileSync(file, "utf8"))) {
      const resolved = resolveSpecifier(file, specifier);
      if (resolved === null) continue;
      if (DEV_ONLY_ROOTS.some((root) => resolved === root || resolved.startsWith(root + path.sep))) {
        violations.push(`${path.relative(ROOT, file)} -> ${specifier}`);
      }
    }
  }
  assert.deepEqual(violations, [], "no production file imports from lib/scan/dev or app/dev");
  assertions += 1;
}

/* --------------------- IMPORT_BOUNDARY 2: labeler → detector --------------------- */

const labelerFiles = [
  path.join(ROOT, "lib", "scan", "dev", "valley.ts"),
  path.join(ROOT, "lib", "scan", "dev", "enhance.ts"),
  path.join(ROOT, "lib", "scan", "dev", "livewire.ts"),
  ...walk(path.join(ROOT, "app", "dev", "label"), []),
];
{
  const violations: string[] = [];
  for (const file of labelerFiles) {
    for (const specifier of specifiersOf(readFileSync(file, "utf8"))) {
      const resolved = resolveSpecifier(file, specifier);
      if (resolved !== null && BANNED_FOR_LABELER.test(resolved)) {
        violations.push(`${path.relative(ROOT, file)} -> ${specifier}`);
      }
    }
  }
  assert.deepEqual(violations, [], "labeler files import none of the D1-banned detector modules");
  assertions += 1;
  ok(labelerFiles.length >= 5, `labeler boundary actually walked files (${labelerFiles.length})`);
}

/* ----------------------- /dev pages 404 outside development ----------------------- */

async function assertNotFoundThrow(importPage: () => Promise<{ default: () => unknown }>, name: string): Promise<void> {
  // Read-only in @types/node — the runtime assignment is legal and exactly the point of the test.
  (process.env as { NODE_ENV?: string }).NODE_ENV = "test";
  const page = await importPage();
  try {
    page.default();
    assert.fail(`${name} rendered outside development`);
  } catch (error) {
    const digest = String((error as { digest?: string }).digest ?? "");
    ok(
      digest.includes("NEXT_NOT_FOUND") || digest.includes("404") || digest.includes("NEXT_HTTP_ERROR"),
      `${name} throws Next's notFound outside development (digest: ${digest || "n/a"})`,
    );
  }
}

async function main(): Promise<void> {
  await assertNotFoundThrow(() => import("../app/dev/capture/page"), "/dev/capture");
  await assertNotFoundThrow(() => import("../app/dev/label/page"), "/dev/label");

  console.log(
    `  walked ${productionFiles.length} production files + ${labelerFiles.length} labeler files`,
  );
  console.log(`IMPORT BOUNDARY ASSERTIONS PASSED (${assertions})`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
