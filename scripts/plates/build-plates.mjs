/**
 * Encodes one Blender render into the three-density AVIF + WebP set a sanctuary plate needs,
 * and writes the manifest that lib/sanctuary/plate-manifest.ts validates.
 *
 * Why a script and not next/image: §6.2 plates are `<picture>` layers stacked behind live content
 * with per-layer parallax and z-index, and §10 wants `fetchpriority` on the current camera only.
 * The loader would hand us one <img> per plate with its own URL space and no say in which format
 * wins — so the encode happens once, at author time, and ships as static files.
 *
 * This script does NOT drive Blender. There is no Blender automation anywhere in reach — see
 * scripts/plates/README.md. It starts from a render someone exported by hand.
 *
 *   node scripts/plates/build-plates.mjs --in docs/renders/sanctuary-far.png
 *     --out public/plates/sanctuary-far --name sanctuary-far --layer far --width 960
 *     --alt "The library wall, arched window and moon behind shelved bundles."
 *
 * Idempotent: both encoders are deterministic, so a second run over the same source with the same
 * flags rewrites byte-identical files and an identical manifest. The source is never written to —
 * an --in that resolves inside --out is refused rather than silently re-encoded over itself.
 *
 * Placeholder mode (--placeholder, no --in) synthesises the source in memory instead of reading
 * one, so the component has something real to render before any render exists.
 */
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { parseArgs } from "node:util";
import path from "node:path";
import sharp from "sharp";

const root = process.cwd();
const publicDir = path.join(root, "public");

/** §10: three densities, ascending. Mirrors PLATE_SCALES in lib/sanctuary/plate-manifest.ts. */
const SCALES = [1, 2, 3];

/** §3: the four depth bands. Mirrors PLATE_LAYERS in lib/sanctuary/plate-manifest.ts. */
const LAYERS = ["far", "mid", "near", "dust"];

/**
 * 4:4:4 chroma on both formats. The sanctuary is gold linework on near-black stone (§3), and
 * subsampled chroma turns a 1px #C9A24B stroke into a muddy smear against #0D0B09 — the one
 * artefact this art direction cannot absorb. Costs bytes; buys the only colour that matters.
 */
const AVIF_OPTIONS = { quality: 58, effort: 6, chromaSubsampling: "4:4:4" };
const WEBP_OPTIONS = { quality: 82, effort: 6, smartSubsample: false };

function fail(message) {
  console.error(`[plates] ${message}`);
  process.exit(1);
}

/* Strict parsing, but reported as a sentence. A hand-run script that answers a typo with a V8
 * stack trace is telling the person who ran it that they broke node, not that they misspelled a flag. */
let values;
try {
  ({ values } = parseArgs({
    options: {
      in: { type: "string" },
      out: { type: "string" },
      name: { type: "string" },
      width: { type: "string" },
      layer: { type: "string", default: "far" },
      alt: { type: "string" },
      placeholder: { type: "boolean", default: false },
    },
    strict: true,
  }));
} catch (error) {
  fail(`${error instanceof Error ? error.message : String(error)}
         usage: --in <render> --out <dir under public/> --name <id> --width <1x px> --alt "…" [--layer far|mid|near|dust]
                --placeholder replaces --in with a synthesised stone ground.`);
}

/**
 * Synthesises a stone ground lit by exactly one warm point source, per §3's light discipline.
 * SVG rather than raw pixels because a radial gradient is three lines of markup and sharp
 * rasterises it deterministically, which keeps the placeholder as reproducible as a real render.
 */
function placeholderSource(width, height) {
  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">`,
    "  <defs>",
    '    <radialGradient id="candle" cx="34%" cy="62%" r="62%">',
    '      <stop offset="0%" stop-color="#E08A2E" stop-opacity="0.22"/>',
    '      <stop offset="55%" stop-color="#8A6A2A" stop-opacity="0.07"/>',
    '      <stop offset="100%" stop-color="#0D0B09" stop-opacity="0"/>',
    "    </radialGradient>",
    '    <radialGradient id="vignette" cx="50%" cy="50%" r="78%">',
    '      <stop offset="55%" stop-color="#0A0806" stop-opacity="0"/>',
    '      <stop offset="100%" stop-color="#0A0806" stop-opacity="0.85"/>',
    "    </radialGradient>",
    "  </defs>",
    '  <rect width="100%" height="100%" fill="#0D0B09"/>',
    '  <rect width="100%" height="100%" fill="url(#candle)"/>',
    '  <rect width="100%" height="100%" fill="url(#vignette)"/>',
    "</svg>",
  ].join("\n");
  return sharp(Buffer.from(svg)).png().toBuffer();
}

/** True when `absolutePath` is inside `public/` and therefore addressable as a root-relative URL. */
function isInsidePublic(absolutePath) {
  const relative = path.relative(publicDir, absolutePath);
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

/** Public URL for a file inside public/, with the separators a browser understands. */
function publicUrl(absolutePath) {
  return `/${path.relative(publicDir, absolutePath).split(path.sep).join("/")}`;
}

async function main() {
  const { name, out, alt, layer } = values;

  if (!name) fail("--name <plate-id> is required.");
  if (!out) fail("--out <dir> is required.");
  if (!alt) fail("--alt is required. A plate with no alt text is a room a screen reader cannot enter.");
  if (!LAYERS.includes(layer)) fail(`--layer must be one of ${LAYERS.join(" | ")}. Got: ${layer}`);

  const baseWidth = Number.parseInt(values.width ?? "", 10);
  if (!Number.isInteger(baseWidth) || baseWidth <= 0) {
    fail("--width <1x width in px> is required and must be a positive integer.");
  }

  const outDir = path.resolve(root, out);
  /* Checked before the directory is created, let alone written to. Deriving the URL at the end and
   * failing there would already have left a directory of encoded plates somewhere nothing serves. */
  if (!isInsidePublic(outDir)) {
    fail(`--out must live inside public/ so the plate has a URL. Got: ${outDir}`);
  }
  await mkdir(outDir, { recursive: true });

  let source;
  if (values.placeholder) {
    if (values.in) fail("--placeholder synthesises its own source; drop --in.");
    /* 16:9, authored at 3x so the largest density is a true render rather than an upscale. */
    source = await placeholderSource(baseWidth * 3, Math.round(baseWidth * 3 * (9 / 16)));
    console.log(`[plates] source synthesised in memory (${baseWidth * 3}px wide, stone-800 under one warm source)`);
  } else {
    if (!values.in) fail("--in <render.png|.tif> is required (or pass --placeholder).");
    const inPath = path.resolve(root, values.in);
    if (!existsSync(inPath)) fail(`missing source: ${inPath}`);
    if (!path.relative(outDir, inPath).startsWith("..")) {
      fail(`the source sits inside --out and would be overwritten: ${inPath}`);
    }
    source = await readFile(inPath);
    console.log(`[plates] source ${inPath} (${(await stat(inPath)).size.toLocaleString()} B, never written to)`);
  }

  const meta = await sharp(source).metadata();
  if (!meta.width || !meta.height) fail("could not read the source dimensions.");
  const aspect = meta.height / meta.width;

  const largest = baseWidth * SCALES[SCALES.length - 1];
  if (largest > meta.width) {
    fail(`3x needs ${largest}px but the source is only ${meta.width}px wide. Re-render wider, or lower --width.`);
  }

  const densities = [];
  for (const scale of SCALES) {
    const width = baseWidth * scale;
    const height = Math.round(width * aspect);
    const stem = `${name}-${scale}x`;
    const avifPath = path.join(outDir, `${stem}.avif`);
    const webpPath = path.join(outDir, `${stem}.webp`);

    const resized = sharp(source).resize(width, height, { kernel: "lanczos3", fit: "fill" });
    await resized.clone().avif(AVIF_OPTIONS).toFile(avifPath);
    await resized.clone().webp(WEBP_OPTIONS).toFile(webpPath);

    const avifBytes = (await stat(avifPath)).size;
    const webpBytes = (await stat(webpPath)).size;
    console.log(
      `[plates] ${stem}  ${width}x${height}  avif ${avifBytes.toLocaleString()} B  webp ${webpBytes.toLocaleString()} B`,
    );

    densities.push({ scale, width, height, avif: publicUrl(avifPath), webp: publicUrl(webpPath), bytes: avifBytes });
  }

  /* Cheap self-check so a broken manifest never reaches disk; the real gate is test/scene-plate.test.ts. */
  if (densities.length !== SCALES.length || densities.some((density, i) => density.scale !== SCALES[i])) {
    fail("internal: densities are not the three ascending scales.");
  }

  const manifest = { id: name, alt, layer, densities };
  const manifestPath = path.join(outDir, "manifest.json");
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  console.log(
    `[plates] manifest.json  ${(await stat(manifestPath)).size.toLocaleString()} B  → ${publicUrl(manifestPath)}`,
  );

  const total = densities.reduce((sum, density) => sum + density.bytes, 0);
  console.log(`[plates] ${name} done. AVIF across densities: ${total.toLocaleString()} B (only one is ever fetched).`);
}

await main();
