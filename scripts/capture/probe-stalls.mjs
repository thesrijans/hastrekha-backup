/**
 * Which part of the draw stalls the GPU?
 *
 * A reading aid: pause the room's own loop, then drive the renderer from a
 * loop of this script's for a few seconds per variant — the whole draw, the
 * draw followed by gl.flush(), the draw without bloom, the bare scene, the
 * bare scene without shadows, nothing — and count the rAF intervals over
 * 25 ms in each. Also reports renderer.info, so a resource that grows frame
 * over frame shows up as a number that grows.
 *
 * It found U3b P3's stall: "full" dropped 5-7 frames of ~200 ms in every 4 s
 * and "full+flush" none, alternating three times — which is why
 * room-canvas.tsx flushes each frame. (probe-trace.mjs pointed there first:
 * tracing the disabled-by-default-gpu.service/.device categories, which make
 * the GPU service flush as it traces, made the stall vanish.)
 *
 *   node scripts/capture/probe-stalls.mjs [seconds-per-variant] [--variants=full,full+flush,full]
 */
import { chromium } from "playwright";
import { startServer, THRESHOLD_SEEN, THRESHOLD_STORAGE_KEY } from "./capture.mjs";
import { GPU_ARGS } from "./gpu-probe.mjs";

const seconds = Number(process.argv.slice(2).find((a) => /^[0-9.]+$/.test(a)) ?? 4);
// --variants=a,b,a runs those, in that order (repeats allowed).
const chosen = process.argv.find((a) => a.startsWith("--variants="))?.slice("--variants=".length).split(",");
const server = await startServer();
const browser = await chromium.launch({ headless: true, args: GPU_ARGS });
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, colorScheme: "dark" });
  await context.addInitScript(([k, v]) => window.localStorage.setItem(k, v), [THRESHOLD_STORAGE_KEY, THRESHOLD_SEEN]);
  const page = await context.newPage();
  await page.goto(`${server.base}/sanctuary?snc-measure=1`, { waitUntil: "load", timeout: 60_000 });
  await page.waitForSelector('[data-snc-room-scene="live"]', { timeout: 30_000 });
  await page.waitForFunction(() => Boolean(window.__sncRoom?.rig), null, { timeout: 30_000 });
  await page.waitForTimeout(1500);
  await page.evaluate(() => window.__sncRoom.pause());

  const variants = chosen ?? ["full", "no-bloom", "scene", "scene-no-shadows", "scene-no-flicker", "clear"];
  for (const variant of variants) {
    const r = await page.evaluate(
      ([variant, ms]) =>
        new Promise((resolve) => {
          const { renderer, world, post } = window.__sncRoom;
          const shadows = renderer.shadowMap.enabled;
          const bloom = post.bloom.enabled;
          if (variant === "no-bloom") post.bloom.enabled = false;
          if (variant === "scene-no-shadows") renderer.shadowMap.autoUpdate = false;
          const intervals = [];
          const infoBefore = JSON.stringify(renderer.info.memory) + ` programs ${renderer.info.programs?.length}`;
          const started = performance.now();
          let last = null;
          const tick = (t) => {
            if (last !== null) intervals.push(Math.round(t - last));
            last = t;
            const s = (t - started) / 1000;
            if (variant === "full" || variant === "no-bloom") {
              world.tick(s);
              post.render(s);
            } else if (variant === "full+flush") {
              world.tick(s);
              post.render(s);
              renderer.getContext().flush();
            } else if (variant === "scene" || variant === "scene-no-shadows") {
              world.tick(s);
              renderer.setRenderTarget(null);
              renderer.render(world.scene, world.camera);
            } else if (variant === "scene-no-flicker") {
              renderer.setRenderTarget(null);
              renderer.render(world.scene, world.camera);
            } else {
              renderer.setRenderTarget(null);
              renderer.clear();
            }
            if (t - started < ms) requestAnimationFrame(tick);
            else {
              post.bloom.enabled = bloom;
              renderer.shadowMap.enabled = shadows;
              renderer.shadowMap.autoUpdate = true;
              resolve({ intervals, infoBefore, infoAfter: JSON.stringify(renderer.info.memory) + ` programs ${renderer.info.programs?.length}`, shadowLights: world.scene.children.length });
            }
          };
          requestAnimationFrame(tick);
        }),
      [variant, seconds * 1000],
    );
    const slow = r.intervals.filter((v) => v > 25);
    const mean = r.intervals.reduce((a, b) => a + b, 0) / r.intervals.length;
    console.log(`${variant.padEnd(17)} ${String(r.intervals.length).padStart(4)} frames  mean ${mean.toFixed(1)} ms  ${slow.length} over 25 ms: ${slow.join(" ")}`);
    console.log(`${"".padEnd(17)} info ${r.infoBefore} -> ${r.infoAfter}`);
  }
  const counts = await page.evaluate(() => {
    const { world, renderer } = window.__sncRoom;
    let lights = 0;
    let shadowLights = 0;
    let meshes = 0;
    world.scene.traverse((n) => {
      if (n.isLight) {
        lights += 1;
        if (n.castShadow) shadowLights += 1;
      }
      if (n.isMesh) meshes += 1;
    });
    return { lights, shadowLights, meshes, shadowType: renderer.shadowMap.type, pixelRatio: renderer.getPixelRatio(), size: [renderer.domElement.width, renderer.domElement.height] };
  });
  console.log(JSON.stringify(counts));
} finally {
  await browser.close();
  server.child.kill();
}
