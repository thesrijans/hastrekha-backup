/**
 * Build the pedestal's engraved zodiac from the real <CelestialRing>.
 *
 * Amendment 2: the pedestal carries an "engraved zodiac ring as an
 * emissive-mask texture generated from the <CelestialRing> SVG at build time".
 * The CSS room already draws that component over its pedestal, so the 3D
 * pedestal's engraving has to be the SAME ring or the two rooms disagree about
 * the one ornament they share.
 *
 * SO IT IS TAKEN FROM THE LIVE PAGE, NOT RE-IMPORTED. The component is a server
 * component whose linework depends on a CSS module and on gradient and filter
 * defs rendered elsewhere in the document. Importing it into a Node script
 * would lose both; rendering it through React on the server would lose the
 * stylesheet. The page already renders it correctly, so this clones the node
 * the room drew, with its classes intact, into a black full-screen stage in the
 * same document — where the same stylesheet and the same defs still apply —
 * and photographs it.
 *
 * TWO THINGS ARE UNDONE FOR THE TEXTURE, deliberately:
 *
 *  · the flattening. The CSS room squashes the ring to `scale: 1 0.26` so it
 *    lies on the pedestal's ellipse; the 3D top face is a true circle seen in
 *    perspective, so the texture must be round.
 *  · the hairline. The ring draws with non-scaling strokes, 1 px at any size.
 *    On a 1024 px texture laid across a drum that is ~400 px wide on screen, a
 *    1 px line would be 0.4 px and vanish, so strokes are allowed to scale with
 *    the ring's own 100-unit viewBox.
 *
 * A manual build step, like scripts/plates: it needs a running production build,
 * and its output is committed.
 *
 *   node scripts/textures/build-zodiac-mask.mjs          # uses the existing build
 *   node scripts/textures/build-zodiac-mask.mjs --build  # rebuilds with NEXT_PUBLIC_SANCTUARY=1
 */
import { mkdir, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { chromium } from "playwright";
import { buildProduction, startServer, THRESHOLD_SEEN, THRESHOLD_STORAGE_KEY } from "../capture/capture.mjs";
import { GPU_ARGS } from "../capture/gpu-probe.mjs";

const REPO = resolve(import.meta.dirname, "..", "..");
const OUT = join(REPO, "public", "textures", "zodiac-ring.png");

/** The texture's size. 1024 carries the sector glyphs cleanly at the drum's on-screen size. */
export const ZODIAC_TEXTURE_PX = 1024;

async function main() {
  if (process.argv.includes("--build")) await buildProduction();
  const server = await startServer();
  const browser = await chromium.launch({ headless: true, args: GPU_ARGS });
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1100 }, deviceScaleFactor: 1 });
    await context.addInitScript(([k, v]) => window.localStorage.setItem(k, v), [THRESHOLD_STORAGE_KEY, THRESHOLD_SEEN]);
    const page = await context.newPage();
    await page.goto(`${server.base}/sanctuary`, { waitUntil: "load", timeout: 60_000 });

    const found = await page.evaluate((px) => {
      const ring = document.querySelector('[data-snc-room-object="pedestal"] svg');
      if (!ring) return false;
      const clone = ring.cloneNode(true);
      const stage = document.createElement("div");
      stage.id = "snc-zodiac-capture";
      stage.style.cssText =
        "position:fixed;inset:0;z-index:2147483647;background:#000;display:grid;place-items:center";
      clone.setAttribute("width", String(px));
      clone.setAttribute("height", String(px));
      clone.style.cssText = `width:${px}px;height:${px}px;scale:none;rotate:none;translate:none;transform:none;animation:none;opacity:1`;
      stage.appendChild(clone);
      document.body.appendChild(stage);

      const style = document.createElement("style");
      // Let strokes scale with the viewBox, and stop the ring's slow turn so
      // the photograph is of the ring at rest.
      style.textContent = "#snc-zodiac-capture svg, #snc-zodiac-capture svg * { vector-effect: none !important; animation: none !important; }";
      document.head.appendChild(style);
      return true;
    }, ZODIAC_TEXTURE_PX);

    if (!found) throw new Error("No CelestialRing found under [data-snc-room-object=pedestal] — has the room's markup changed?");

    await page.waitForTimeout(400);
    await mkdir(join(REPO, "public", "textures"), { recursive: true });
    await page.locator("#snc-zodiac-capture svg").screenshot({ path: OUT, omitBackground: false });
    const { size } = await stat(OUT);
    console.log(`wrote ${OUT}  ${ZODIAC_TEXTURE_PX}x${ZODIAC_TEXTURE_PX}  ${(size / 1024).toFixed(1)} kB`);
  } finally {
    await browser.close();
    server.child.kill();
  }
}

main().catch((err) => {
  console.error(err.stack ?? err.message);
  process.exitCode = 1;
});
