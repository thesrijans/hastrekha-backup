/**
 * Capture the room from each of the camera's five positions (U3b P3).
 *
 * The loop harness asks for real-GPU captures of every finished part. For the
 * camera system the capture is the five poses themselves — what the reader
 * sees when a move ends — so this pauses the room's loop through its
 * measurement hook, puts the rig at each destination with the move already
 * complete, renders one frame, and screenshots the page at 1440 × 900.
 *
 *   node scripts/capture/capture-poses.mjs [--label name]
 *
 * Writes captures/ui/<stamp>-<label>/pose-<name>-1440.png. Needs a build made
 * with NEXT_PUBLIC_SANCTUARY=1 (capture.mjs --build, or score-camera.mjs --build).
 */
import { mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { chromium } from "playwright";
import { startServer, THRESHOLD_SEEN, THRESHOLD_STORAGE_KEY } from "./capture.mjs";
import { GPU_ARGS, isSoftware, readRenderer } from "./gpu-probe.mjs";

const REPO = resolve(import.meta.dirname, "..", "..");
const POSES = ["sanctuary", "scanner", "book", "library", "guru"];
const labelIndex = process.argv.indexOf("--label");
const label = labelIndex > 0 ? process.argv[labelIndex + 1] : "poses";

const stamp = new Date().toISOString().replaceAll(":", "-").slice(0, 19);
const dir = join(REPO, "captures", "ui", `${stamp}-${label}`);
await mkdir(dir, { recursive: true });

const server = await startServer();
const browser = await chromium.launch({ headless: true, args: GPU_ARGS });
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, colorScheme: "dark" });
  await context.addInitScript(([k, v]) => window.localStorage.setItem(k, v), [THRESHOLD_STORAGE_KEY, THRESHOLD_SEEN]);
  const page = await context.newPage();
  const gpu = await readRenderer(page);
  if (!gpu.ok || isSoftware(gpu.renderer)) throw new Error(`Refusing to capture on a software renderer: ${gpu.renderer}`);
  await page.goto(`${server.base}/sanctuary?snc-measure=1`, { waitUntil: "load", timeout: 60_000 });
  await page.waitForSelector('[data-snc-room-scene="live"]', { timeout: 30_000 });
  await page.waitForFunction(() => Boolean(window.__sncRoom?.rig), null, { timeout: 30_000 });
  await page.waitForTimeout(2500);
  console.log(`GPU: ${gpu.renderer}`);
  for (const name of POSES) {
    await page.evaluate((name) => {
      const room = window.__sncRoom;
      room.pause();
      const now = performance.now();
      // A move that started two durations ago has arrived; no pointer, no tilt.
      room.rig.goTo(name, now - 5000);
      room.rig.apply(now);
      room.renderAt(3.0);
      room.renderer.getContext().flush();
    }, name);
    await page.waitForTimeout(250);
    const file = join(dir, `pose-${name}-1440.png`);
    await page.screenshot({ path: file });
    console.log(`${name.padEnd(10)} ${file}`);
  }

  // And one move end to end, by a real click on a fresh page — as a reader
  // would, with nothing paused or driven by the hook. The library is not built,
  // so the camera looks and holds for 1.2 s with no route to open: the one
  // arrival that can be photographed. The words should have left with it.
  await page.close(); // one tab at a time: a background tab's room stops drawing
  const fresh = await context.newPage();
  await fresh.goto(`${server.base}/sanctuary`, { waitUntil: "load", timeout: 60_000 });
  await fresh.waitForSelector('[data-snc-room-scene="live"]', { timeout: 30_000 });
  await fresh.waitForTimeout(2500);
  await fresh.evaluate(() => {
    const set = document.querySelector("#snc-room [data-snc-room-set]");
    window.__arrived = new Promise((done) => set.addEventListener("snc-room-camera-arrived", () => done(), { once: true }));
  });
  await fresh.click('#snc-room [data-snc-camera="library"]', { force: true }); // aria-disabled: not built, but it still looks
  const arrived = await fresh.evaluate(() => Promise.race([window.__arrived.then(() => true), new Promise((done) => setTimeout(() => done(false), 8000))]));
  if (!arrived) throw new Error("the camera never said it arrived at the library (8 s)");
  await fresh.waitForTimeout(120);
  const look = join(dir, "move-library-arrived-1440.png");
  await fresh.screenshot({ path: look });
  console.log(`${"library ↗".padEnd(10)} ${look}  (a real click on a fresh page, on arrival)`);
} finally {
  await browser.close();
  server.child.kill();
}
