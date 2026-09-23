/**
 * Bakes the P1 hand mesh into the three hand plates (M1.1), and records how.
 *
 *   node scripts/plates/bake-hand.mjs            # all three
 *   node scripts/plates/bake-hand.mjs --only hand-plate
 *
 * What replaces the drawn "glove": public/models/hand.glb, rendered by the
 * room's own Three.js modules in headless Chromium on the real GPU
 * (scripts/plates/bake-hand.entry.ts, bundled here with esbuild), then encoded
 * by build-plates.mjs into AVIF + WebP at 1x/2x/3x with a manifest. Beside each
 * manifest this writes bake.json — the registration the render was made to
 * (which anchors, which pose, which camera) — so test/sanctuary-hand-plates
 * .test.ts can fail when the code moves and the plate did not follow.
 *
 * Three plates:
 *   hand-hologram   the scene's hand at rest through the room camera, cut to
 *                   HOLOGRAM_HAND_REGION (300 x 400 stage units → 1x 300 px)
 *   hand-plate      thumb-left, warped onto rectify.ts CANONICAL_ANCHORS
 *                   (a square; 1x 512 px)
 *   hand-tradition  thumb-right, fitted to TRADITION_HAND_LANDMARKS in the
 *                   216 x 290 hand box (1x 300 px)
 *
 * Deterministic on one machine; a different GPU's multisample resolve may
 * differ by a bit per edge pixel. The committed files are what ships.
 */
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { extname, join, resolve } from "node:path";
import { build } from "esbuild";
import { chromium } from "playwright";
import { GPU_ARGS, readRenderer } from "../capture/gpu-probe.mjs";

const REPO = resolve(import.meta.dirname, "..", "..");
const PUBLIC = join(REPO, "public");

const PLATES = [
  {
    id: "hand-hologram",
    width: 300,
    alt: "The hologram's hand — a gold-lit open right hand, palm forward, at rest above the pedestal.",
  },
  {
    id: "hand-plate",
    width: 512,
    alt: "An open palm in engraved gold, framed as a scan crop with the fingers running off the top — nobody's hand, the plate a measured line is drawn on.",
  },
  {
    id: "hand-tradition",
    width: 300,
    alt: "An open right hand in engraved gold, palm forward, the tradition's diagram hand.",
  },
];

const MIME = {
  ".js": "text/javascript",
  ".html": "text/html",
  ".json": "application/json",
  ".glb": "model/gltf-binary",
  ".png": "image/png",
  ".webp": "image/webp",
  ".avif": "image/avif",
};

const argv = process.argv.slice(2);
const only = argv.includes("--only") ? argv[argv.indexOf("--only") + 1].split(",") : PLATES.map((p) => p.id);

async function bundle() {
  const result = await build({
    entryPoints: [join(REPO, "scripts", "plates", "bake-hand.entry.ts")],
    bundle: true,
    write: false,
    format: "esm",
    platform: "browser",
    target: "es2022",
    tsconfig: join(REPO, "tsconfig.json"),
    logLevel: "error",
  });
  return result.outputFiles[0].text;
}

const PAGE = `<!doctype html><meta charset="utf-8"><title>bake</title><body style="margin:0;background:#000"><script type="module" src="/bake.js"></script>`;

/** Serve the bundle, the page, and public/ (the mesh, its landmarks, the zodiac texture). */
function serve(js) {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://bake");
    if (url.pathname === "/") return res.writeHead(200, { "content-type": MIME[".html"] }).end(PAGE);
    if (url.pathname === "/bake.js") return res.writeHead(200, { "content-type": MIME[".js"] }).end(js);
    const file = join(PUBLIC, url.pathname);
    if (!file.startsWith(PUBLIC) || !existsSync(file)) return res.writeHead(404).end();
    res.writeHead(200, { "content-type": MIME[extname(file)] ?? "application/octet-stream" }).end(await readFile(file));
  });
  return new Promise((done) => server.listen(0, "127.0.0.1", () => done({ server, base: `http://127.0.0.1:${server.address().port}` })));
}

function run(args) {
  return new Promise((done, fail) => {
    const child = spawn(process.execPath, args, { cwd: REPO, stdio: "inherit" });
    child.on("exit", (code) => (code === 0 ? done() : fail(new Error(`${args[0]} exited with ${code}`))));
  });
}

async function main() {
  const js = await bundle();
  const { server, base } = await serve(js);
  const browser = await chromium.launch({ headless: true, args: GPU_ARGS });
  const tmp = join(tmpdir(), `hastrekha-bake-${process.pid}`);
  await mkdir(tmp, { recursive: true });
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on("console", (msg) => msg.type() === "error" && errors.push(msg.text()));
    page.on("pageerror", (error) => errors.push(String(error)));
    const gpu = await readRenderer(page);
    console.log(`[bake] GPU: ${gpu.renderer ?? gpu.reason}`);
    await page.goto(`${base}/`, { waitUntil: "load" });
    await page.waitForFunction(() => window.__bake !== undefined || window.__bakeError !== undefined, null, { timeout: 180_000 });
    const failure = await page.evaluate(() => window.__bakeError ?? null);
    if (failure !== null) throw new Error(`bake failed in the page: ${failure}\n${errors.join("\n")}`);
    if (errors.length > 0) console.warn(`[bake] page console errors:\n${errors.join("\n")}`);

    const meshBytes = await readFile(join(PUBLIC, "models", "hand.glb"));
    const meshSha = createHash("sha256").update(meshBytes).digest("hex");
    const three = JSON.parse(await readFile(join(REPO, "node_modules", "three", "package.json"), "utf8")).version;

    for (const plate of PLATES) {
      if (!only.includes(plate.id)) continue;
      const result = await page.evaluate((id) => {
        const bake = window.__bake[id];
        return { png: bake.png, width: bake.width, height: bake.height, registration: bake.registration };
      }, plate.id);
      const source = join(tmp, `${plate.id}.png`);
      await writeFile(source, Buffer.from(result.png.slice(result.png.indexOf(",") + 1), "base64"));
      console.log(`[bake] ${plate.id}: rendered ${result.width}x${result.height} → ${source}`);
      const outDir = join("public", "plates", plate.id);
      await run([
        join(REPO, "scripts", "plates", "build-plates.mjs"),
        "--in", source, "--out", outDir, "--name", plate.id, "--layer", "mid", "--width", String(plate.width), "--alt", plate.alt,
      ]);
      const record = {
        id: plate.id,
        generator: "scripts/plates/bake-hand.mjs",
        source: { mesh: "public/models/hand.glb", sha256: meshSha, landmarks: "public/models/hand.landmarks.json" },
        three,
        gpu: gpu.renderer ?? null,
        rendered: { width: result.width, height: result.height },
        registration: result.registration,
      };
      await writeFile(join(REPO, outDir, "bake.json"), `${JSON.stringify(record, null, 2)}\n`, "utf8");
      console.log(`[bake] ${plate.id}: registration ${JSON.stringify(result.registration)}`);
    }
  } finally {
    await browser.close();
    server.close();
    await rm(tmp, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
