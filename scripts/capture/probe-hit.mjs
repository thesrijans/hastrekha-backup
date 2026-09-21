/**
 * What does a click at an element's centre actually land on?
 *
 * A reading aid: given a selector, report the element under its centre point
 * (document.elementFromPoint) and the pointer-events, z-index and stacking of
 * everything on that point, top to bottom — for the case where a test tool
 * says something else would receive the click, and the question is whether a
 * reader's click would be stolen too.
 *
 *   node scripts/capture/probe-hit.mjs '#snc-room a[data-snc-camera="scanner"]'
 */
import { chromium } from "playwright";
import { startServer, THRESHOLD_SEEN, THRESHOLD_STORAGE_KEY } from "./capture.mjs";
import { GPU_ARGS } from "./gpu-probe.mjs";

const selector = process.argv[2] ?? '#snc-room a[data-snc-camera="scanner"]';
const server = await startServer();
const browser = await chromium.launch({ headless: true, args: GPU_ARGS });
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  await context.addInitScript(([k, v]) => window.localStorage.setItem(k, v), [THRESHOLD_STORAGE_KEY, THRESHOLD_SEEN]);
  const page = await context.newPage();
  await page.goto(`${server.base}/sanctuary`, { waitUntil: "load" });
  await page.waitForTimeout(4000);
  const report = await page.evaluate((sel) => {
    const target = document.querySelector(sel);
    if (!target) return { error: `no element for ${sel}` };
    const r = target.getBoundingClientRect();
    const x = r.left + r.width / 2;
    const y = r.top + r.height / 2;
    const describe = (el) => {
      const cs = getComputedStyle(el);
      return `${el.tagName.toLowerCase()}${el.dataset.sncRoomObject ? `[room-object=${el.dataset.sncRoomObject}]` : ""}${el.dataset.sncDepth ? `[depth=${el.dataset.sncDepth}]` : ""}  pointer-events:${cs.pointerEvents} z:${cs.zIndex} pos:${cs.position} opacity:${cs.opacity}`;
    };
    return {
      point: [Math.round(x), Math.round(y)],
      top: describe(document.elementFromPoint(x, y)),
      stack: document.elementsFromPoint(x, y).slice(0, 8).map(describe),
      targetIsTop: document.elementFromPoint(x, y) === target || target.contains(document.elementFromPoint(x, y)),
    };
  }, selector);
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser.close();
  server.child.kill();
}
