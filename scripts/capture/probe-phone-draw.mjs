/**
 * What does one draw of the room cost the PHONE's main thread? (M1.1)
 *
 *   node scripts/capture/probe-phone-draw.mjs [--cpu 4] [--viewport 390] [--base-url URL]
 *
 * Opens /sanctuary?snc-measure as a mid-range phone (capture.mjs --phone's
 * context and signals), waits for the vignette's scene to go live, pauses its
 * loop through window.__sncRoom, applies the CPU throttle, and times N draws
 * two ways: the JavaScript alone (tick + render, no gl.finish — what the main
 * thread pays per frame) and with gl.finish (the GPU's share, for reference).
 * The p95 of the first is the number the 30 fps cap has to fit twice inside a
 * 33 ms frame with room to spare; a p95 near 16 ms is a dropped frame waiting
 * to happen. Also lists every 4xx/5xx the page fetched, by URL.
 */
import { chromium } from "playwright";
import { GPU_ARGS, readRenderer } from "./gpu-probe.mjs";
import { PHONE_UA, THRESHOLD_SEEN, THRESHOLD_STORAGE_KEY, startServer } from "./capture.mjs";

const argv = process.argv.slice(2);
const flag = (name, fallback) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : fallback);
const cpu = Number(flag("--cpu", "4"));
const width = Number(flag("--viewport", "390"));
const baseUrl = flag("--base-url", null);
const DRAWS = 120;

const percentile = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1))];
const summary = (samples) => {
  const sorted = [...samples].sort((a, b) => a - b);
  return { n: samples.length, p50: percentile(sorted, 0.5).toFixed(2), p95: percentile(sorted, 0.95).toFixed(2), worst: sorted.at(-1).toFixed(2), mean: (samples.reduce((a, b) => a + b, 0) / samples.length).toFixed(2) };
};

const server = baseUrl ? null : await startServer();
const base = baseUrl ?? server.base;
const browser = await chromium.launch({ headless: true, args: GPU_ARGS });
try {
  const context = await browser.newContext({ viewport: { width, height: width >= 412 ? 915 : 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, userAgent: PHONE_UA, colorScheme: "dark" });
  await context.addInitScript(() => {
    Object.defineProperty(navigator, "deviceMemory", { configurable: true, get: () => 4 });
    Object.defineProperty(navigator, "hardwareConcurrency", { configurable: true, get: () => 4 });
  });
  await context.addInitScript(([k, v]) => window.localStorage.setItem(k, v), [THRESHOLD_STORAGE_KEY, THRESHOLD_SEEN]);
  const page = await context.newPage();
  const failed = [];
  page.on("response", (r) => r.status() >= 400 && failed.push(`${r.status()} ${r.url()}`));
  console.log(`GPU: ${(await readRenderer(page)).renderer}`);
  await page.goto(`${base}/sanctuary?snc-measure`, { waitUntil: "load", timeout: 60_000 });
  await page.waitForSelector('[data-snc-room="vignette"] [data-snc-room-scene="live"]', { timeout: 30_000, state: "attached" });
  await page.waitForTimeout(2000);
  const cdp = await context.newCDPSession(page);
  if (cpu > 1) await cdp.send("Emulation.setCPUThrottlingRate", { rate: cpu });
  await page.waitForTimeout(300);

  const result = await page.evaluate((draws) => {
    const room = window.__sncRoom;
    room.pause();
    const gl = room.renderer.getContext();
    const scene = room.world.scene;
    let objects = 0;
    let visible = 0;
    scene.traverse((o) => { if (o.isMesh || o.isPoints || o.isLine) { objects += 1; if (o.visible) visible += 1; } });
    const js = [];
    for (let i = 0; i < draws; i += 1) {
      const t0 = performance.now();
      room.renderAt(i / 30);
      js.push(performance.now() - t0);
    }
    const gpu = [];
    for (let i = 0; i < 30; i += 1) {
      const t0 = performance.now();
      room.renderAt(i / 30);
      gl.finish();
      gpu.push(performance.now() - t0);
    }
    const info = room.renderer.info;
    room.renderAt(0);
    const calls = info.render.calls;
    const triangles = info.render.triangles;
    const canvas = room.renderer.domElement;
    room.resume();
    return { js, gpu, objects, visible, calls, triangles, canvas: { w: canvas.width, h: canvas.height }, dpr: room.renderer.getPixelRatio() };
  }, DRAWS);

  console.log(`\n${width} phone cpu${cpu}x — ${result.objects} drawables (${result.visible} visible), ${result.calls} draw calls, ${result.triangles} triangles, canvas ${result.canvas.w}×${result.canvas.h} @ DPR ${result.dpr}`);
  console.log(`  JS per draw (tick + render):  ${JSON.stringify(summary(result.js))}`);
  console.log(`  with gl.finish (GPU included): ${JSON.stringify(summary(result.gpu))}`);
  if (failed.length) console.log(`  failed fetches: ${[...new Set(failed)].join(" | ")}`);
} finally {
  await browser.close();
  server?.child.kill();
}
