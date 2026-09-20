/**
 * Does Emulation.setCPUThrottlingRate actually bite?
 *
 * capture.mjs reports frame numbers labelled "cpu4x". If the throttle were
 * silently ignored those numbers would be ordinary numbers wearing a label
 * that makes them look like a measurement of a slow phone. This times a fixed
 * busy loop at each rate; the ratio is the evidence.
 */
import { chromium } from "playwright";
import { GPU_ARGS } from "./gpu-probe.mjs";

/** Spin for a fixed amount of arithmetic and report how long the page took. */
const BUSY = () => {
  const started = performance.now();
  let acc = 0;
  for (let i = 0; i < 8_000_000; i += 1) acc += Math.sqrt(i);
  return { ms: performance.now() - started, acc };
};

const browser = await chromium.launch({ headless: true, args: GPU_ARGS });
try {
  for (const rate of [1, 4, 8]) {
    const context = await browser.newContext();
    const page = await context.newPage();
    if (rate > 1) {
      const cdp = await context.newCDPSession(page);
      await cdp.send("Emulation.setCPUThrottlingRate", { rate });
    }
    const { ms } = await page.evaluate(BUSY);
    console.log(`rate ${rate}x -> busy loop ${ms.toFixed(0)} ms`);
    await context.close();
  }
} finally {
  await browser.close();
}
