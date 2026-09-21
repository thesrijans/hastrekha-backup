/**
 * What runs during a stalled frame? A Chrome trace, summarised.
 *
 * A reading aid for probe-stalls.mjs: record a few seconds of the room at rest
 * with the GPU, viz, compositor and toplevel trace categories, then list every
 * slice longer than a threshold with its process, thread and name — the long
 * ones are what a 200 ms frame is waiting on. The raw trace is kept under
 * captures/ui/traces/ for chrome://tracing or ui.perfetto.dev.
 *
 *   node scripts/capture/probe-trace.mjs [seconds] [minSliceMs] [--no-trace] [--burn]
 *
 * --no-trace runs the identical measurement without tracing (tracing itself
 * busies the browser and GPU processes); --burn keeps one CPU core busy in a
 * Worker while measuring — together they test whether a stall is a power-state
 * effect rather than work.
 */
import { mkdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { chromium } from "playwright";
import { startServer, THRESHOLD_SEEN, THRESHOLD_STORAGE_KEY } from "./capture.mjs";
import { GPU_ARGS } from "./gpu-probe.mjs";

const REPO = resolve(import.meta.dirname, "..", "..");
const numbers = process.argv.slice(2).filter((a) => /^[0-9.]+$/.test(a)).map(Number);
const seconds = numbers[0] ?? 4;
const minMs = numbers[1] ?? 40;
const tracing = !process.argv.includes("--no-trace");
const burn = process.argv.includes("--burn");
// --categories=a,b traces only those (to find which one changes the behaviour).
const only = process.argv.find((a) => a.startsWith("--categories="))?.slice("--categories=".length).split(",");
const ALL_CATEGORIES = [
  "toplevel",
  "gpu",
  "viz",
  "cc",
  "blink",
  "ipc",
  "v8",
  "disabled-by-default-gpu.service",
  "disabled-by-default-gpu.device",
  "disabled-by-default-devtools.timeline",
  "disabled-by-default-devtools.timeline.frame",
];
const CATEGORIES = only ?? ALL_CATEGORIES;

const server = await startServer();
const browser = await chromium.launch({ headless: true, args: GPU_ARGS });
const dir = join(REPO, "captures", "ui", "traces");
await mkdir(dir, { recursive: true });
const file = join(dir, `stall-${new Date().toISOString().replaceAll(":", "-").slice(0, 19)}.json`);
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, colorScheme: "dark" });
  await context.addInitScript(([k, v]) => window.localStorage.setItem(k, v), [THRESHOLD_STORAGE_KEY, THRESHOLD_SEEN]);
  const page = await context.newPage();
  await page.goto(`${server.base}/sanctuary?snc-measure=1`, { waitUntil: "load", timeout: 60_000 });
  await page.waitForSelector('[data-snc-room-scene="live"]', { timeout: 30_000 });
  await page.waitForTimeout(2000);
  if (burn) {
    await page.evaluate(() => {
      const src = "let x = 0; for (;;) { x = (x * 1103515245 + 12345) % 2147483648; }";
      window.__burner = new Worker(URL.createObjectURL(new Blob([src], { type: "text/javascript" })));
    });
  }
  if (tracing) await browser.startTracing(page, { path: file, categories: CATEGORIES });
  const intervals = await page.evaluate(
    (ms) =>
      new Promise((done) => {
        const out = [];
        let last = null;
        const end = performance.now() + ms;
        const tick = (t) => {
          if (last !== null) out.push(Math.round(t - last));
          last = t;
          if (t < end) requestAnimationFrame(tick);
          else done(out);
        };
        requestAnimationFrame(tick);
      }),
    seconds * 1000,
  );
  if (tracing) await browser.stopTracing();
  console.log(`${tracing ? `traced [${CATEGORIES.join(",")}]` : "untraced"}${burn ? ", one core burning" : ""}  rAF: ${intervals.length} frames, over 25 ms: ${intervals.filter((v) => v > 25).join(" ")}`);
} finally {
  await browser.close();
  server.child.kill();
}

if (!tracing) process.exit(0);
const trace = JSON.parse(await readFile(file, "utf8"));
const events = trace.traceEvents ?? trace;
const names = new Map();
for (const e of events) {
  if (e.ph === "M" && e.name === "thread_name") names.set(`${e.pid}:${e.tid}`, e.args.name);
  if (e.ph === "M" && e.name === "process_name") names.set(`${e.pid}`, e.args.name);
}
const long = events
  .filter((e) => e.ph === "X" && e.dur >= minMs * 1000)
  .map((e) => ({ ms: e.dur / 1000, at: e.ts / 1000, proc: names.get(`${e.pid}`) ?? e.pid, thread: names.get(`${e.pid}:${e.tid}`) ?? e.tid, name: e.name, cat: e.cat }));
const byKey = new Map();
for (const s of long) {
  const key = `${s.proc} / ${s.thread} / ${s.name}`;
  const v = byKey.get(key) ?? { n: 0, total: 0, max: 0 };
  v.n += 1;
  v.total += s.ms;
  v.max = Math.max(v.max, s.ms);
  byKey.set(key, v);
}
console.log(`\nslices >= ${minMs} ms, by process / thread / name (count, total, max):`);
for (const [key, v] of [...byKey].sort((a, b) => b[1].total - a[1].total).slice(0, 40)) {
  console.log(`  ${String(v.n).padStart(3)}  ${v.total.toFixed(0).padStart(6)} ms  max ${v.max.toFixed(0).padStart(4)}  ${key}`);
}
console.log(`\ntrace: ${file}`);
