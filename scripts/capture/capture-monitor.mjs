/**
 * S1.4 — capture the Rekha Monitor with two lines confirmed and one tracking.
 *
 * The snapshot is a real one, written by
 *   npx tsx scripts/scan/replay-persist.ts --nulls=0.22 --monitor-state
 * (the first moment of the golden-session replay with two lines CONFIRMED and
 * one TRACKING). It is injected before hydration into /dev/rekha-monitor, which
 * renders the chamber's own <RekhaMonitor> over the chamber's stone, and
 * photographed at 1440 (the right-side panel) and 390 (the pull-up sheet,
 * opened by tapping its ledger). What the DOM draws — each line's state and
 * stroke, the ledger text, the names on leaders — is printed beside the paths.
 *
 *   node scripts/capture/capture-monitor.mjs [state.json] [--build]
 */
import { readFileSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { chromium } from "playwright";
import { buildProduction, startServer } from "./capture.mjs";
import { GPU_ARGS, readRenderer } from "./gpu-probe.mjs";

const REPO = resolve(import.meta.dirname, "..", "..");
const stateFile = process.argv.slice(2).find((a) => a.endsWith(".json")) ?? join(REPO, "captures", "ui", "scores", "rekha-monitor-state@0.22.json");
const state = JSON.parse(readFileSync(stateFile, "utf8"));

if (process.argv.includes("--build")) await buildProduction();
const server = await startServer();
const browser = await chromium.launch({ headless: true, args: GPU_ARGS });
const stamp = new Date().toISOString().replaceAll(":", "-").slice(0, 19);
const dir = join(REPO, "captures", "ui", `${stamp}-s1-monitor`);
mkdirSync(dir, { recursive: true });
try {
  for (const [width, height] of [
    [1440, 900],
    [390, 844],
  ]) {
    const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1, colorScheme: "dark" });
    await context.addInitScript((s) => {
      window.__REKHA_MONITOR_STATE__ = s;
    }, state);
    const page = await context.newPage();
    if (width === 1440) console.log(`GPU: ${(await readRenderer(page)).renderer}`);
    await page.goto(`${server.base}/dev/rekha-monitor`, { waitUntil: "load", timeout: 60_000 });
    await page.waitForSelector('[data-snc-monitor-ready="yes"]', { timeout: 20_000 });
    if (width < 900) {
      await page.click('section[aria-label^="Rekha monitor"] button');
    }
    await page.waitForTimeout(900);
    const drawn = await page.evaluate(() => {
      const lines = [...document.querySelectorAll("[data-snc-line]")].map((el) => ({
        id: el.getAttribute("data-snc-line"),
        state: el.getAttribute("data-snc-state"),
        width: el.getAttribute("stroke-width"),
        opacity: el.getAttribute("stroke-opacity"),
        glow: getComputedStyle(el).filter !== "none",
      }));
      const names = [...document.querySelectorAll("[data-snc-leader] text")].map((t) => t.textContent);
      const ledger = document.querySelector('section[aria-label^="Rekha monitor"] button')?.textContent?.replace(/\s+/g, " ").trim();
      return { lines, names, ledger };
    });
    const file = join(dir, `monitor-${width}.png`);
    await page.screenshot({ path: file });
    console.log(`\n${width}px: ${file}`);
    console.log(`  ledger: ${drawn.ledger}`);
    for (const l of drawn.lines) console.log(`  ${l.id.padEnd(6)} ${l.state.padEnd(10)} ${l.width}px @ ${l.opacity}${l.glow ? " + glow" : ""}`);
    console.log(`  names on leaders: ${drawn.names.join(", ") || "none"}`);
    await context.close();
  }
} finally {
  await browser.close();
  server.child.kill();
}
