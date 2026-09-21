/**
 * What the routes and the lazy chunks actually cost, gzipped.
 *
 * §10 of the spec states every budget in kB gzipped, and Next 16 with
 * Turbopack prints no size column at all — which is why [R2] had to recover
 * the baselines from `.next/diagnostics/route-bundle-stats.json` by hand. That
 * file gives first-load chunk PATHS and an UNCOMPRESSED byte count, so the
 * gzipped number every budget is written in has to be computed. This does it.
 *
 * IT ALSO FINDS THE LAZY CHUNKS, which the diagnostics file cannot: the R3F
 * room is behind next/dynamic, so none of its bytes appear in any route's
 * first load, and its 200 kB ceiling would otherwise be unmeasurable. Chunks
 * are identified by what they contain — a Three.js chunk carries the
 * library's own revision string — rather than by filename, because Turbopack's
 * names are content hashes that change every build.
 *
 * GZIP AND NOT BROTLI, deliberately, because that is the unit §10's numbers
 * are already written in and a budget compared against a different compressor
 * is not a comparison.
 *
 *   node scripts/capture/bundle-report.mjs
 *   node scripts/capture/bundle-report.mjs --route /sanctuary
 */
import { gzipSync } from "node:zlib";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve, basename } from "node:path";

const REPO = resolve(import.meta.dirname, "..", "..");
const CHUNK_DIR = join(REPO, ".next", "static", "chunks");
const STATS = join(REPO, ".next", "diagnostics", "route-bundle-stats.json");

/** §10's ceilings, so the report marks its own verdicts. */
export const BUDGETS = {
  "/sanctuary": { firstLoadKb: 140, label: "Sanctuary initial JS" },
  r3fChunkKb: { target: 180, ceiling: 200, label: "3D chunk" },
};

const kb = (bytes) => Number((bytes / 1024).toFixed(1));

function gzipOf(path) {
  try {
    return gzipSync(readFileSync(path), { level: 9 }).length;
  } catch {
    return 0;
  }
}

/** Every emitted chunk, with raw and gzipped size. */
function allChunks() {
  const walk = (dir) => {
    const out = [];
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) out.push(...walk(full));
      else if (entry.endsWith(".js")) out.push(full);
    }
    return out;
  };
  return walk(CHUNK_DIR).map((path) => ({
    path,
    name: basename(path),
    raw: statSync(path).size,
    gz: gzipOf(path),
  }));
}

/**
 * Markers that identify what a chunk carries.
 *
 * Three.js stamps its revision into the build; R3F names its own internals.
 * Matching on content survives the content-hashed filenames Turbopack emits.
 */
const MARKERS = [
  ["three", /REVISION\s*=\s*["']\d{3}["']|WebGLRenderer|BufferGeometry/],
  // Literal package strings only. An earlier version also matched
  // /createRoot.*reconciler/, which is react-dom's own code, so every route's
  // shared floor was reported as carrying R3F and the lazy boundary looked
  // broken when it was not.
  ["r3f", /@react-three\/fiber|react-three-fiber/],
  ["room-scene", /brushedBrassRoughness|engravedStoneNormal|RoomScene/],
];

function identify(path) {
  const text = readFileSync(path, "utf8");
  return MARKERS.filter(([, pattern]) => pattern.test(text)).map(([name]) => name);
}

function main() {
  const args = process.argv.slice(2);
  const only = args.includes("--route") ? args[args.indexOf("--route") + 1] : null;

  const chunks = allChunks();
  const totalGz = chunks.reduce((sum, c) => sum + c.gz, 0);
  console.log(`${chunks.length} chunks emitted, ${kb(totalGz)} kB gz in total\n`);

  /* ---- First load, per route ---------------------------------------- */
  let stats = [];
  try {
    stats = JSON.parse(readFileSync(STATS, "utf8"));
  } catch {
    console.log("No route-bundle-stats.json — run `npm run build` first.\n");
  }

  console.log("ROUTE FIRST LOAD (gz)");
  for (const entry of stats) {
    if (only && entry.route !== only) continue;
    const gz = entry.firstLoadChunkPaths.reduce((sum, rel) => sum + gzipOf(join(REPO, rel.replaceAll("\\", "/"))), 0);
    const budget = BUDGETS[entry.route];
    const verdict = budget ? (kb(gz) <= budget.firstLoadKb ? ` PASS <= ${budget.firstLoadKb}` : ` FAIL > ${budget.firstLoadKb}`) : "";
    console.log(`  ${entry.route.padEnd(22)} ${String(kb(gz)).padStart(7)} kB gz   (${kb(entry.firstLoadUncompressedJsBytes)} kB raw)${verdict}`);
  }

  /* ---- The lazy 3D chunks ------------------------------------------- */
  const firstLoad = new Set(
    stats.flatMap((entry) => entry.firstLoadChunkPaths.map((rel) => basename(rel.replaceAll("\\", "/")))),
  );

  const tagged = chunks
    .map((chunk) => ({ ...chunk, tags: identify(chunk.path) }))
    .filter((chunk) => chunk.tags.length > 0);

  console.log("\nTHREE / R3F CHUNKS");
  if (tagged.length === 0) {
    console.log("  none found — no chunk carries Three.js or R3F");
  } else {
    let lazyGz = 0;
    for (const chunk of tagged.sort((a, b) => b.gz - a.gz)) {
      const lazy = !firstLoad.has(chunk.name);
      if (lazy) lazyGz += chunk.gz;
      console.log(
        `  ${chunk.name.padEnd(30)} ${String(kb(chunk.gz)).padStart(7)} kB gz  ${String(kb(chunk.raw)).padStart(8)} kB raw  [${chunk.tags.join(", ")}]${lazy ? "" : "  IN FIRST LOAD"}`,
      );
    }
    const { target, ceiling } = BUDGETS.r3fChunkKb;
    const verdict = kb(lazyGz) <= target ? "PASS (within target)" : kb(lazyGz) <= ceiling ? "PASS (over target, under ceiling)" : "FAIL";
    console.log(`\n  3D chunk total, lazy only: ${kb(lazyGz)} kB gz   target ${target} / ceiling ${ceiling} -> ${verdict}`);

    const leaked = tagged.filter((chunk) => firstLoad.has(chunk.name));
    if (leaked.length > 0) {
      console.log(`\n  WARNING: ${leaked.length} chunk(s) carrying three/R3F are in a route's FIRST LOAD.`);
      console.log("  The lazy boundary is broken — something imports the canvas eagerly.");
    }
  }
}

if (import.meta.filename === process.argv[1]) main();
