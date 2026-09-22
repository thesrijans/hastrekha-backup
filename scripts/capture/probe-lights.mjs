/**
 * Print every light and every drape in the running room, in world space.
 *
 * A reading aid, like layout-print.ts, for the case where the scorer says a
 * light reaches nothing it should: it lists what the live scene actually
 * contains — each light's label, position, layers and intensity, and each
 * drape's bounds and layers — so a placement bug shows as a number.
 *
 *   node scripts/capture/probe-lights.mjs   (needs a NEXT_PUBLIC_SANCTUARY=1 build)
 */
import { chromium } from "playwright";
import { startServer, THRESHOLD_SEEN, THRESHOLD_STORAGE_KEY } from "./capture.mjs";
import { GPU_ARGS } from "./gpu-probe.mjs";

const server = await startServer();
const browser = await chromium.launch({ headless: true, args: GPU_ARGS });
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  await context.addInitScript(([k, v]) => window.localStorage.setItem(k, v), [THRESHOLD_STORAGE_KEY, THRESHOLD_SEEN]);
  const page = await context.newPage();
  await page.goto(`${server.base}/sanctuary?snc-measure=1`, { waitUntil: "load" });
  await page.waitForFunction(() => Boolean(window.__sncRoom), null, { timeout: 30_000 });
  const report = await page.evaluate(async () => {
    const { world } = window.__sncRoom;
    await world.settled;
    const f = (v) => `(${v.x.toFixed(2)}, ${v.y.toFixed(2)}, ${v.z.toFixed(2)})`;
    const lines = [];
    world.scene.updateMatrixWorld(true);
    world.scene.traverse((node) => {
      if (node.isLight) {
        const label = node.parent?.userData?.label ?? node.name ?? node.type;
        lines.push(`light ${node.type.padEnd(16)} ${String(label).padEnd(15)} at ${f(node.getWorldPosition(node.position.clone()))}  layers ${node.layers.mask}  I ${node.intensity.toFixed(2)}  reach ${node.distance ?? "-"}`);
      }
      if (node.name === "drape") {
        node.geometry.computeBoundingBox();
        const box = node.geometry.boundingBox.clone().applyMatrix4(node.matrixWorld);
        lines.push(`drape  ${f(box.min)} .. ${f(box.max)}  layers ${node.layers.mask}`);
      }
    });
    return lines;
  });
  for (const line of report) console.log(line);
} finally {
  await browser.close();
  server.child.kill();
}
