/**
 * What does one draw of the room cost the GPU, headless and headed?
 *
 * A reading aid for probe-stalls.mjs: with the room's loop paused, time N
 * draws each bracketed by gl.finish() — so the number is the GPU's time for
 * the frame, not a rAF interval that also contains the compositor, the page
 * and vsync. Run once headless and once in a headed window, at the canvas's
 * shipped resolution and at half of it, for the whole draw and the bare scene.
 *
 *   node scripts/capture/probe-cost.mjs [draws]
 */
import { chromium } from "playwright";
import { startServer, THRESHOLD_SEEN, THRESHOLD_STORAGE_KEY } from "./capture.mjs";
import { GPU_ARGS } from "./gpu-probe.mjs";

const draws = Number(process.argv[2] ?? 60);
const server = await startServer();
try {
  for (const headless of [true, false]) {
    const browser = await chromium.launch({ headless, args: GPU_ARGS });
    try {
      const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, colorScheme: "dark" });
      await context.addInitScript(([k, v]) => window.localStorage.setItem(k, v), [THRESHOLD_STORAGE_KEY, THRESHOLD_SEEN]);
      const page = await context.newPage();
      await page.goto(`${server.base}/sanctuary?snc-measure=1`, { waitUntil: "load", timeout: 60_000 });
      await page.waitForSelector('[data-snc-room-scene="live"]', { timeout: 30_000 });
      await page.waitForFunction(() => Boolean(window.__sncRoom?.rig), null, { timeout: 30_000 });
      await page.waitForTimeout(1500);
      const rows = await page.evaluate(async (draws) => {
        const { renderer, world, post, pause } = window.__sncRoom;
        pause();
        const gl = renderer.getContext();
        const canvas = renderer.domElement;
        const full = [canvas.width, canvas.height];
        const out = [];
        const time = (label, fn) => {
          for (let i = 0; i < 5; i += 1) fn(i);
          gl.finish();
          const each = [];
          for (let i = 0; i < draws; i += 1) {
            const t0 = performance.now();
            fn(i);
            gl.finish();
            each.push(performance.now() - t0);
          }
          each.sort((a, b) => a - b);
          out.push(`${label.padEnd(26)} median ${each[Math.floor(each.length / 2)].toFixed(2)} ms  p95 ${each[Math.ceil(0.95 * each.length) - 1].toFixed(2)} ms`);
        };
        const whole = (i) => {
          world.tick(i / 60);
          post.render(i / 60);
        };
        const bare = (i) => {
          world.tick(i / 60);
          renderer.setRenderTarget(null);
          renderer.render(world.scene, world.camera);
        };
        time(`whole draw ${full.join("x")}`, whole);
        time(`bare scene ${full.join("x")}`, bare);
        const cw = canvas.clientWidth;
        const ch = canvas.clientHeight;
        renderer.setPixelRatio(0.5);
        renderer.setSize(cw, ch, false);
        post.setSize(cw * 0.5, ch * 0.5);
        time(`whole draw ${canvas.width}x${canvas.height}`, whole);
        time(`bare scene ${canvas.width}x${canvas.height}`, bare);
        renderer.setPixelRatio(1);
        renderer.setSize(cw, ch, false);
        post.setSize(cw, ch);
        return out;
      }, draws);
      console.log(headless ? "HEADLESS" : "HEADED");
      for (const r of rows) console.log(`  ${r}`);
    } finally {
      await browser.close();
    }
  }
} finally {
  server.child.kill();
}
