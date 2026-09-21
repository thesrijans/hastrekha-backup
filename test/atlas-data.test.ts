/* ============================================================================
 * ATLAS DATA — data/atlas/ and public/atlas/plates/ against the KB
 *
 * The atlas is generated in the lab and quotes the KB, so the failure it can
 * have is silent drift: a rule renamed, a plate deleted, a reading edited by
 * hand. It ships split — data/atlas/index.json plus one lines/<line>.json per
 * book — so it can be loaded a line at a time. This suite pins, against the
 * committed files:
 *
 *  1. The index agrees with the line files on disk (counts, bytes, sha256),
 *     and no single whole-atlas file is left behind.
 *  2. Every book loads through the real per-line loader and agrees with the
 *     KB: its ruleIds exist, its readings are its rules' own text (no new
 *     prose), its citations are the rules' own sources.
 *  3. Every plate reference resolves on disk: PNG and sidecar present, sidecar
 *     naming its own image, IHDR size matching, greyscale, under 120 kB.
 *  4. Load per line, never whole: no module imports a line file statically,
 *     and only lib/atlas/atlas-loader.ts may import one at all.
 *  5. The loader refuses corrupted copies, passed in as documents.
 * ========================================================================== */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { loadKnowledgeBase, type KnowledgeBase } from "../lib/hastrekha";
import {
  ATLAS_INDEX,
  ATLAS_LINE_IDS,
  AtlasValidationError,
  loadAtlasLine,
  parseAtlasLine,
  residualProse,
  validateAtlasLineAgainstKb,
  type AtlasLineBook,
  type AtlasLineId,
} from "../lib/atlas/atlas-loader";

let assertions = 0;
const ok = (condition: boolean, message: string): void => {
  assert.ok(condition, message);
  assertions += 1;
};

const ROOT = path.resolve(__dirname, "..");
const KB: KnowledgeBase = loadKnowledgeBase(JSON.parse(readFileSync("data/kb/hastrekha_kb.json", "utf8")));
const PLATE_BUDGET = 120_000;

async function main(): Promise<void> {
  /* ------------------------------ 1. the index ------------------------------ */

  ok(!existsSync("data/atlas/atlas.json"), "no whole-atlas file ships beside the split one");
  ok(JSON.stringify(ATLAS_INDEX.lines.map((l) => l.id)) === JSON.stringify(ATLAS_LINE_IDS), "the index lists the nine lines in book order");
  ok(statSync("data/atlas/index.json").size < 32_000, `the index stays small (${statSync("data/atlas/index.json").size} bytes)`);
  for (const entry of ATLAS_INDEX.lines) {
    const file = `data/atlas/${entry.file}`;
    ok(existsSync(file), `${entry.id}: ${file} exists`);
    const bytes = readFileSync(file);
    ok(bytes.length === entry.bytes, `${entry.id}: ${bytes.length} bytes as the index says`);
    ok(createHash("sha256").update(bytes).digest("hex") === entry.sha256, `${entry.id}: sha256 matches the index`);
  }
  const onDisk = readdirSync("data/atlas/lines").filter((f) => f.endsWith(".json")).sort();
  ok(JSON.stringify(onDisk) === JSON.stringify([...ATLAS_LINE_IDS].map((id) => `${id}.json`).sort()), "exactly the nine line files are on disk");

  /* ---------------------- 2. every book, against the KB ---------------------- */

  const kbIds = new Set(KB.rules.map((r) => r.rule_id));
  const kbById = new Map(KB.rules.map((r) => [r.rule_id, r]));
  const books = new Map<AtlasLineId, AtlasLineBook>();
  const seen = new Set<string>();
  for (const line of ATLAS_LINE_IDS) {
    const book = await loadAtlasLine(line);
    books.set(line, book);
    validateAtlasLineAgainstKb(KB, book);
    const entry = ATLAS_INDEX.lines.find((l) => l.id === line)!;
    ok(book.variations.length === entry.variations && book.variations.length > 0, `${line}: ${book.variations.length} variations as indexed`);
    ok(book.variations.filter((v) => v.reachable).length === entry.measurable, `${line}: measurable count matches the index`);
    for (const v of book.variations) {
      ok(!seen.has(v.id), `${v.id}: variation ids are unique across books`);
      seen.add(v.id);
      ok(v.ruleIds.every((id) => kbIds.has(id)), `${v.id}: every ruleId is in the KB`);
      const merged = v.readingScope === "variation" ? v.rules.filter((r) => r.extraConditions.length === 0).map((r) => r.id) : v.ruleIds;
      ok(residualProse(v.reading_hi, merged.map((id) => kbById.get(id)!.interpretation_hi_en)) === "", `${v.id}: reading_hi is its rules' own text`);
      if (v.reachable) ok(v.reachability.roundTrip === true, `${v.id}: measurable, and its drawing round-tripped through lib/scan`);
      else ok(v.reachability.blocking.length > 0, `${v.id}: not measurable today, and says what blocks it`);
    }
  }

  /* ----------------------------- 3. plates on disk ----------------------------- */

  function pngInfo(file: string): { width: number; height: number; colorType: number; greyPalette: boolean } {
    const bytes = readFileSync(file);
    assert.deepEqual([...bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10], `${file} is a PNG`);
    let greyPalette = true;
    for (let offset = 8; offset < bytes.length; ) {
      const length = bytes.readUInt32BE(offset);
      if (bytes.toString("ascii", offset + 4, offset + 8) === "PLTE") {
        for (let i = 0; i < length; i += 3) {
          const at = offset + 8 + i;
          if (bytes[at] !== bytes[at + 1] || bytes[at] !== bytes[at + 2]) greyPalette = false;
        }
      }
      offset += 12 + length;
    }
    return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20), colorType: bytes[25], greyPalette };
  }

  let plateRefs = 0;
  for (const plate of ATLAS_INDEX.plates) {
    const png = `public${plate.src}`;
    const sidecarPath = `public${plate.sidecar}`;
    ok(existsSync(png) && existsSync(sidecarPath), `${plate.id}: PNG and sidecar exist`);
    const sidecar = JSON.parse(readFileSync(sidecarPath, "utf8")) as { id: string; image: string; caption: string };
    ok(sidecar.id === plate.id && sidecar.image === `${plate.id}.png`, `${plate.id}: the sidecar names its own image`);
    ok(sidecar.caption.length > 0 && sidecar.caption === plate.caption, `${plate.id}: caption present and matching`);
    const info = pngInfo(png);
    ok(info.width === plate.width && info.height === plate.height, `${plate.id}: PNG is ${info.width}x${info.height} as recorded`);
    ok(info.colorType === 0 || (info.colorType === 3 && info.greyPalette), `${plate.id}: greyscale (colour type ${info.colorType})`);
    ok(statSync(png).size <= PLATE_BUDGET, `${plate.id}: ${statSync(png).size} bytes <= ${PLATE_BUDGET}`);
  }
  for (const book of books.values()) {
    for (const v of book.variations) {
      for (const ref of v.plates) {
        plateRefs += 1;
        const plate = book.plateById.get(ref.plate);
        ok(plate !== undefined && existsSync(`public${plate.src}`), `${v.id}: plate ${ref.plate} resolves on disk`);
      }
    }
  }

  /* -------------------- 4. load per line, never the whole -------------------- */

  const LOADER = path.join(ROOT, "lib", "atlas", "atlas-loader.ts");
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((entry) => {
      const full = path.join(dir, entry);
      if (entry === "node_modules" || entry === "generated") return [];
      return statSync(full).isDirectory() ? walk(full) : /\.(ts|tsx|mts|js|mjs)$/.test(entry) ? [full] : [];
    });
  const sources = ["app", "components", "lib"].flatMap((dir) => walk(path.join(ROOT, dir)));
  const STATIC_LINE = /(?:^|\n)\s*import[^;]*?from\s+["'][^"']*data\/atlas\/lines\/[^"']*["']/;
  const ANY_LINE = /["'][^"']*data\/atlas\/lines\/[^"']*["']/;
  const WHOLE = /["'][^"']*data\/atlas\/atlas\.json["']/;
  for (const file of sources) {
    const text = readFileSync(file, "utf8");
    const rel = path.relative(ROOT, file);
    ok(!STATIC_LINE.test(text), `${rel}: no static import of an atlas line file`);
    ok(!WHOLE.test(text), `${rel}: nothing imports a whole-atlas file`);
    if (file !== LOADER) ok(!ANY_LINE.test(text), `${rel}: only the atlas loader touches line files`);
  }
  const loaderText = readFileSync(LOADER, "utf8");
  const staticData = [...loaderText.matchAll(/import\s+\w+\s+from\s+["']([^"']*data\/[^"']+)["']/g)].map((m) => m[1]);
  ok(JSON.stringify(staticData) === JSON.stringify(["@/data/atlas/index.json"]), `the loader's only static data import is the index (${staticData.join(", ")})`);
  ok(ATLAS_LINE_IDS.every((id) => loaderText.includes(`import("@/data/atlas/lines/${id}.json")`)), "each line has its own dynamic import()");

  /* --------------------------- 5. corrupted copies --------------------------- */

  const raw = (line: AtlasLineId): Record<string, unknown> => JSON.parse(readFileSync(`data/atlas/lines/${line}.json`, "utf8")) as Record<string, unknown>;
  const refuses = (run: () => unknown, fragment: string, label: string): void => {
    let thrown: unknown = null;
    try {
      run();
    } catch (error) {
      thrown = error;
    }
    ok(thrown instanceof AtlasValidationError && thrown.problems.some((p) => p.includes(fragment)), label);
  };
  refuses(() => parseAtlasLine("head", raw("heart")), "the file holds line heart", "a book served for the wrong line is refused");
  {
    const doc = raw("fate");
    (doc.variations as unknown[]).pop();
    refuses(() => parseAtlasLine("fate", doc), "index says", "a book that disagrees with the index is refused");
  }
  {
    const doc = raw("head");
    (doc.variations as Array<{ plates: Array<{ plate: string }> }>).find((v) => v.plates.length > 0)!.plates[0].plate = "cheiro-plate-lost";
    refuses(() => parseAtlasLine("head", doc), "is not in the plate list", "a variation pointing at a missing plate is refused");
  }
  {
    const doc = raw("life");
    const v = (doc.variations as Array<{ ruleIds: string[]; rules: Array<{ id: string; extraConditions: unknown[] }> }>)[0];
    v.ruleIds.push("PALM-XXXX-999");
    v.rules.push({ id: "PALM-XXXX-999", extraConditions: [] } as never);
    refuses(() => validateAtlasLineAgainstKb(KB, parseAtlasLine("life", doc)), "is not in the KB", "a variation citing a rule the KB lacks is refused");
  }
  {
    const doc = raw("heart");
    (doc.variations as Array<{ reading_hi: string }>)[0].reading_hi += " Yeh ek naya vaakya hai.";
    refuses(() => validateAtlasLineAgainstKb(KB, parseAtlasLine("heart", doc)), "not its rules' own text", "a reading with added words is refused");
  }
  {
    const doc = raw("sun");
    const v = (doc.variations as Array<{ qualified: Array<{ text_hi: string }> }>).find((x) => x.qualified.length > 0)!;
    v.qualified[0].text_hi = v.qualified[0].text_hi.replace(/\.\s*$/, "") + " — bilkul pakka.";
    refuses(() => validateAtlasLineAgainstKb(KB, parseAtlasLine("sun", doc)), "text is not the KB's", "a qualified rule whose text was edited is refused");
  }
  refuses(
    () => validateAtlasLineAgainstKb({ ...KB, meta: { ...KB.meta, kb_version: "0.0.0" } }, books.get("girdle")!),
    "kb version mismatch",
    "a book checked against another KB is refused",
  );

  const byLine = ATLAS_INDEX.lines.map((l) => `${l.id} ${l.variations}`).join(", ");
  const total = ATLAS_INDEX.lines.reduce((n, l) => n + l.variations, 0);
  const measurable = ATLAS_INDEX.lines.reduce((n, l) => n + l.measurable, 0);
  console.log(`  ${total} variations in 9 books (${byLine}); ${measurable} measurable today; ${ATLAS_INDEX.plates.length} plates, ${plateRefs} plate refs; ${sources.length} source files scanned for line-file imports`);
  console.log(`ATLAS DATA ASSERTIONS PASSED (${assertions})`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
