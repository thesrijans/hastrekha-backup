/* ============================================================================
 * NO DOOR OUT OF THE SANCTUARY
 *
 * The sanctuary is a second skin over the same product: /read/pothi is the
 * reading, /scan/chamber is the scanner, and both consume exactly the same
 * pipeline and the same response as the pre-sanctuary /read and /scan. Because
 * the two sets of routes are so nearly interchangeable, a link written from
 * memory lands on the wrong one and nothing breaks — the reader simply steps
 * out of the room they were standing in, into the cyan instrument chrome, and
 * the whole material argument ends mid-gesture.
 *
 * That is not hypothetical. Every one of these was live until this pass:
 *
 *   · the sealed leaf's rescan button, which is the ONE control a sealed leaf
 *     offers, pointed at /scan
 *   · the sanctuary header's own nav pointed "Reading" at /read and "Scan" at
 *     /scan, so the navigation on a sanctuary page was a set of exits from it
 *   · both back arrows, the book's and the chamber's, pointed at /read
 *
 * So this walks the sanctuary source and asserts the rule mechanically. It is
 * deliberately a source walk rather than a render: a destination that only
 * appears under a state this suite does not construct is exactly the one that
 * would be missed, and the constants are all statically written.
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

/** Every tree that renders sanctuary chrome. A new sanctuary surface must be added here. */
const SANCTUARY_ROOTS = [
  path.join(ROOT, "app", "read", "pothi"),
  path.join(ROOT, "app", "scan", "chamber"),
  path.join(ROOT, "app", "sanctuary"),
  path.join(ROOT, "components", "sanctuary"),
];

/** The pre-sanctuary surfaces. Reaching either of these from inside the skin is the defect. */
const PRE_SANCTUARY = ["/read", "/scan"];

/** Their sanctuary counterparts, which is where a sanctuary link is supposed to go. */
const SANCTUARY_ROUTES = ["/read/pothi", "/scan/chamber", "/sanctuary"];

function walk(dir: string): string[] {
  let out: string[] = [];
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) out = out.concat(walk(full));
    else if (/\.tsx?$/.test(full)) out.push(full);
  }
  return out;
}

/**
 * Source with comments removed.
 *
 * Load-bearing: these files explain their own routing at length, and several of
 * them name `/scan` and `/read` in prose precisely BECAUSE they no longer link
 * there. A check that read the comments would fail on the very sentences that
 * record the fix.
 */
const withoutComments = (text: string): string =>
  text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

/**
 * Every literal destination in a file.
 *
 * Four shapes, because the codebase legitimately uses four: a JSX `href="…"`, a
 * `href={…}` expression, a `href: "…"` entry in a nav table, and a `*_HREF`
 * constant that is passed down to a component that renders it. `router.push` is
 * included for the same reason — a programmatic navigation is a link.
 *
 * `activeHref` is DELIBERATELY matched too. It is not a destination, but it
 * names one, and a header told it is on `/read` while linking to `/read/pothi`
 * would silently stop marking the active item — a real defect that this caught
 * once already, through the type system, on the day the nav table changed.
 */
function destinations(source: string): string[] {
  const code = withoutComments(source);
  const found: string[] = [];
  const patterns = [
    /href=\{?["'`](\/[^"'`\s{}]*)["'`]\}?/g,
    /href:\s*["'`](\/[^"'`\s]*)["'`]/g,
    /\b[A-Z_]*HREF[A-Za-z]*\s*=\s*["'`](\/[^"'`\s]*)["'`]/g,
    /router\.(?:push|replace)\(\s*["'`](\/[^"'`\s]*)["'`]/g,
    /activeHref=\{?["'`](\/[^"'`\s{}]*)["'`]\}?/g,
    /RESCAN_PATH\s*=\s*["'`](\/[^"'`\s]*)["'`]/g,
  ];
  for (const pattern of patterns) {
    let m: RegExpExecArray | null;
    while ((m = pattern.exec(code)) !== null) found.push(m[1]);
  }
  return found;
}

/* ------------------- 1. The walk finds something to check ----------------- */

const files = SANCTUARY_ROOTS.flatMap(walk);
const table = files.flatMap((file) => destinations(readFileSync(file, "utf8")).map((href) => ({ file, href })));

{
  ok(files.length >= 12, `the sanctuary tree is being walked (${files.length} files) — a check over nothing passes for the wrong reason`);
  ok(table.length >= 6, `and real destinations were extracted (${table.length}) — an extractor that finds none cannot fail`);
  ok(
    files.some((f) => f.endsWith("sealed-leaf.tsx")) && files.some((f) => f.endsWith("sanctuary-header.tsx")),
    "including the two files that were actually wrong: the sealed leaf and the header",
  );
}

/* -------------------- 2. THE RULE: no door out of the skin ---------------- */

{
  const escapes = table.filter((entry) => PRE_SANCTUARY.includes(entry.href));
  ok(
    escapes.length === 0,
    escapes.length === 0
      ? "no sanctuary surface links to the pre-sanctuary /scan or /read"
      : `these sanctuary destinations lead out of the sanctuary: ${escapes.map((e) => `${path.relative(ROOT, e.file)} → ${e.href}`).join(", ")}`,
  );
}

/* -------- 3. And the ones that matter point where they should point ------- */

{
  const hrefsIn = (needle: string): string[] =>
    table.filter((entry) => entry.file.endsWith(needle)).map((entry) => entry.href);

  ok(
    hrefsIn("sealed-leaf.tsx").includes("/scan/chamber"),
    "the sealed leaf's rescan button — the one control a sealed leaf offers — goes to the chamber",
  );
  const nav = hrefsIn("sanctuary-header.tsx");
  ok(
    nav.includes("/read/pothi") && nav.includes("/scan/chamber"),
    "the header's own nav points Reading at the book and Scan at the chamber",
  );
  ok(
    nav.includes("/privacy") && nav.includes("/terms"),
    "…and leaves privacy and terms alone, because they have no sanctuary counterpart and a fabricated one would be worse than a shared page",
  );
  ok(
    hrefsIn(path.join("read", "pothi", "page.tsx")).every((href) => SANCTUARY_ROUTES.some((r) => href === r || href.startsWith(`${r}/`)) || href === "/privacy" || href === "/terms"),
    "every destination the book's own route names is a sanctuary room",
  );
  ok(
    hrefsIn(path.join("scan", "chamber", "page.tsx")).every((href) => SANCTUARY_ROUTES.some((r) => href === r || href.startsWith(`${r}/`))),
    "and so is every destination the chamber's route names",
  );
}

/* ---- 4. The rescan parameter survives the move, which is the whole point -- */

{
  const sealed = withoutComments(readFileSync(path.join(ROOT, "components", "sanctuary", "pothi", "sealed-leaf.tsx"), "utf8"));
  ok(
    /RESCAN_PATH\}\?\$\{[A-Z_]*RESCAN_PARAM\}=/.test(sealed.replace(/\s+/g, "")) ||
      /\$\{SEALED_LEAF_RESCAN_PATH\}\?\$\{SEALED_LEAF_RESCAN_PARAM\}=/.test(sealed),
    "the href is still built from the path AND the parameter, so moving the destination did not quietly drop the ask the seal was making",
  );
  ok(
    !sealed.includes('"/scan"'),
    "and the old path is gone from the file rather than left behind as a second constant nobody notices",
  );
}

console.log(`SANCTUARY ROUTES ASSERTIONS PASSED (${assertions})`);
