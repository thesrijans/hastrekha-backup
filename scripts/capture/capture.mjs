/**
 * The capture harness — what the loop harness measures with.
 *
 * docs/specs/loop-harness.md §1 says a part is done only when "real Chromium
 * captures (on the real GPU, per the saved method) are compared to the named
 * reference image", and §3 says "a capture and a number, or it is not done".
 * Before this file there was no saved method in the repository: the 16.7 ms
 * figure quoted in components/sanctuary/room/room-stage.tsx was produced by a
 * procedure that lived in somebody's shell history. This is that procedure,
 * written down and re-runnable.
 *
 * THREE THINGS IT REFUSES TO DO, each of which would produce a number that
 * looks like a measurement and is not:
 *
 *  1. Measure under SwiftShader. Headless Chromium on Windows picks software
 *     rasterisation unless it is handed ANGLE's D3D11 backend, and the two
 *     disagree by about a factor of two on this room. gpu-probe.mjs supplies
 *     the flags and the renderer string; if the string names a software
 *     backend the run aborts rather than reporting.
 *  2. Measure a development server. `next dev` carries HMR, an unminified
 *     React and no minified chunk graph, so its frame times describe the dev
 *     server rather than the room. The default target is a production build
 *     made with NEXT_PUBLIC_SANCTUARY=1, the flag the sanctuary routes open on.
 *  3. Report a percentile over too few frames. FRAME_MIN_SAMPLES mirrors
 *     lib/sanctuary/frame-cost.ts: a p95 over eight frames is the second-worst
 *     of eight.
 *
 * WHAT THE NUMBER MEANS. These are rAF deltas, not draw costs — the same
 * convention room-stage.tsx already quotes, where a healthy vsync-paced frame
 * reads 16.7 ms and never less. A p95 at 16.7 means no frame was dropped in
 * the window; it does not mean the room has no headroom. For headroom inside a
 * frame, lib/sanctuary/frame-cost.ts is the instrument, and it lives in the
 * page rather than here.
 *
 * USAGE
 *   node scripts/capture/capture.mjs --route /sanctuary --build
 *   node scripts/capture/capture.mjs --route /sanctuary --viewport 390 --cpu 4
 *   node scripts/capture/capture.mjs --route /sanctuary --base-url http://localhost:3000
 *
 * `--build` rebuilds with NEXT_PUBLIC_SANCTUARY=1 (and SNC_MEASURE=1 for
 * /dev/rekha-monitor) set, which is required rather than convenient: see
 * buildProduction() for why a build made without them serves a baked 404 that
 * the running server cannot reopen. Without --build the harness reuses
 * whatever is in .next, so pass it whenever you are unsure what that is.
 * `--base-url` measures a server it does not own — a preview deploy included —
 * and then neither builds nor starts anything.
 *
 * `--phone` (M1.1) is a mid-range Android: a mobile context (touch, the UA,
 * DPR 3) with deviceMemory 4 and hardwareConcurrency 4 stubbed, the device
 * the spec's "phones with WebGL2 and >= 4 cores" bar is written for. The
 * capability tier's own frame probe is left alone. With `--cpu N` the throttle
 * is applied AFTER the page has settled rather than before navigation: the
 * tier measures nine idle frames at mount, and a throttle applied first would
 * measure the throttle and refuse the room the bar is meant to measure. The
 * report records the tier the page settled on and whether a scene went live.
 */
import { spawn } from "node:child_process";
import { mkdir, writeFile, access } from "node:fs/promises";
import { join, resolve } from "node:path";
import { chromium } from "playwright";
import { GPU_ARGS, readRenderer, isSoftware } from "./gpu-probe.mjs";

const REPO = resolve(import.meta.dirname, "..", "..");

/**
 * The Threshold's memory (lib/sanctuary/threshold.ts). A fresh headless browser
 * is always a first visit, so /sanctuary shows the entrance over the room; a
 * capture of the ROOM has to arrive as a returning visitor. Restated rather
 * than imported because this is a plain .mjs script and that module is
 * TypeScript; test/capture-harness.test.ts asserts the two still agree.
 */
export const THRESHOLD_STORAGE_KEY = "hastrekha:threshold:v1";
export const THRESHOLD_SEEN = "seen";

/** `--phone`: a Pixel 7's Chrome, as capture-chamber-phone.mjs also states it. */
export const PHONE_UA = "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36";

/** `--phone`: the device signals of a mid-range phone, so the capability tier can reach MID. */
const PHONE_SIGNALS = () => {
  Object.defineProperty(navigator, "deviceMemory", { configurable: true, get: () => 4 });
  Object.defineProperty(navigator, "hardwareConcurrency", { configurable: true, get: () => 4 });
};

/** The four widths the E pass names (Amendment 4). */
export const DEFAULT_VIEWPORTS = [390, 430, 768, 1440];

/** Height paired with each width. Phones are tall; the desktop is 16:9. */
const HEIGHT_FOR = (width) => (width <= 430 ? 844 : width <= 768 ? 1024 : 900);

/** Frames sampled per viewport, and the floor below which percentiles are not reported. */
export const FRAME_WINDOW = 240;
export const FRAME_MIN_SAMPLES = 30;

/** Frames discarded at the start: the first rAF after navigation is not a steady-state frame. */
const WARMUP_FRAMES = 20;

/** The port the harness owns. Deliberately not 3000, so a running `next dev` is never measured by accident. */
const PORT = 3210;

/** Nearest-rank percentile, the same arithmetic as lib/sanctuary/frame-cost.ts. */
function percentile(sorted, p) {
  if (sorted.length === 0) return Number.NaN;
  const rank = Math.max(1, Math.ceil(p * sorted.length));
  return sorted[Math.min(rank, sorted.length) - 1];
}

/** Summarise a window of rAF deltas. Returns null below the sample floor. */
export function summarise(samples) {
  if (samples.length < FRAME_MIN_SAMPLES) return null;
  const sorted = [...samples].sort((a, b) => a - b);
  const sum = samples.reduce((acc, ms) => acc + ms, 0);
  return {
    count: samples.length,
    p50: Number(percentile(sorted, 0.5).toFixed(2)),
    p95: Number(percentile(sorted, 0.95).toFixed(2)),
    worst: Number(sorted[sorted.length - 1].toFixed(2)),
    mean: Number((sum / samples.length).toFixed(2)),
    fpsAtP95: Number((1000 / percentile(sorted, 0.95)).toFixed(1)),
  };
}

/** Minimal flag parsing — no dependency for six options. */
function parseArgs(argv) {
  const out = {
    route: "/sanctuary",
    viewports: DEFAULT_VIEWPORTS,
    cpu: 1,
    frames: FRAME_WINDOW,
    baseUrl: null,
    headed: false,
    label: null,
    build: false,
    waitFor: null,
    settle: 2500,
    storage: [],
    phone: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => argv[(i += 1)];
    if (arg === "--route") out.route = normaliseRoute(next());
    else if (arg === "--viewport") out.viewports = next().split(",").map(Number);
    else if (arg === "--cpu") out.cpu = Number(next());
    else if (arg === "--frames") out.frames = Number(next());
    else if (arg === "--base-url") out.baseUrl = next();
    else if (arg === "--headed") out.headed = true;
    else if (arg === "--label") out.label = next();
    else if (arg === "--build") out.build = true;
    else if (arg === "--wait-for") out.waitFor = next();
    else if (arg === "--settle") out.settle = Number(next());
    else if (arg === "--storage") {
      const [key, ...rest] = next().split("=");
      out.storage.push([key, rest.join("=")]);
    } else if (arg === "--returning") out.storage.push([THRESHOLD_STORAGE_KEY, THRESHOLD_SEEN]);
    else if (arg === "--phone") out.phone = true;
    else if (arg === "--help") out.help = true;
  }
  return out;
}

/**
 * Undo MSYS path mangling, and accept a route with or without its leading slash.
 *
 * Git Bash rewrites any argument that starts with `/` into a Windows path, so
 * `--route /sanctuary` arrives as `C:/Program Files/Git/sanctuary` and the
 * navigation fails with a URL that is baffling to read. Rather than make every
 * caller remember MSYS_NO_PATHCONV=1, the mangling is recognised here and the
 * route recovered from its last segment.
 */
export function normaliseRoute(route) {
  let value = String(route ?? "").replaceAll("\\", "/");
  if (/^[A-Za-z]:\//.test(value)) value = value.slice(value.lastIndexOf("/") + 1);
  return `/${value.replace(/^\/+/, "")}`;
}

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Build with the gates already open.
 *
 * NEXT_PUBLIC_SANCTUARY is inlined at build time, so it opens /sanctuary,
 * /scan/chamber and /read/pothi for this build or not at all: with the flag
 * unset app/sanctuary/page.tsx calls notFound() before it touches cookies,
 * Next finds nothing dynamic on the route, prerenders it, and bakes the 404
 * into a static page that no amount of runtime environment can reopen — the
 * route prints as `○ /sanctuary` instead of `ƒ`. With the flag set the page
 * reaches the session cookie, becomes dynamic, and is rendered per request as
 * the measurement needs. SNC_MEASURE=1 is the separate lift on
 * /dev/rekha-monitor, which keeps its development gate; it too is read at build.
 */
export async function buildProduction() {
  const nextBin = join(REPO, "node_modules", "next", "dist", "bin", "next");
  await new Promise((done, fail) => {
    const child = spawn(process.execPath, [nextBin, "build"], {
      cwd: REPO,
      env: { ...process.env, NEXT_PUBLIC_SANCTUARY: "1", SNC_MEASURE: "1" },
      stdio: "inherit",
    });
    child.on("exit", (code) => (code === 0 ? done() : fail(new Error(`next build exited with ${code}`))));
  });
}

/** Start `next start` on the gate-open build, and resolve once it answers. */
export async function startServer() {
  if (!(await exists(join(REPO, ".next")))) {
    throw new Error("No production build found at .next — run with --build, or `NEXT_PUBLIC_SANCTUARY=1 SNC_MEASURE=1 npm run build` first.");
  }
  // Run Next's bin through this same node rather than through `npx` in a shell:
  // a shell spawn on Windows concatenates arguments instead of escaping them
  // (DEP0190) and buys nothing here.
  const nextBin = join(REPO, "node_modules", "next", "dist", "bin", "next");
  const child = spawn(process.execPath, [nextBin, "start", "--port", String(PORT)], {
    cwd: REPO,
    env: { ...process.env, NEXT_PUBLIC_SANCTUARY: "1", SNC_MEASURE: "1", NODE_ENV: "production" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const base = `http://localhost:${PORT}`;
  const deadline = Date.now() + 60_000;
  let lastError = "";
  child.stderr.on("data", (buf) => {
    lastError = String(buf);
  });
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`next start exited with ${child.exitCode}. ${lastError}`);
    }
    try {
      // The timeout is load-bearing: without it a socket that connects and
      // never answers parks this await forever and the deadline above is never
      // re-read, which is a hang rather than the honest failure it should be.
      const res = await fetch(base, { method: "HEAD", signal: AbortSignal.timeout(3000) });
      if (res.status < 500) return { child, base };
    } catch {
      /* not listening yet, or not answering yet */
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  child.kill();
  throw new Error(`next start did not answer on ${base} within 60s. ${lastError}`);
}

/** Sample rAF deltas in the page and return the raw window. */
async function sampleFrames(page, frames, warmup) {
  return page.evaluate(
    ([total, skip]) =>
      new Promise((done) => {
        const samples = [];
        let last = performance.now();
        let seen = 0;
        const tick = (now) => {
          const delta = now - last;
          last = now;
          seen += 1;
          if (seen > skip) samples.push(delta);
          if (samples.length >= total) done(samples);
          else requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }),
    [frames, warmup],
  );
}

/** One route, one width: navigate, settle, sample, shoot. */
async function captureOne(browser, { base, route, width, cpu, frames, outDir, waitFor, settle, storage, phone }) {
  const context = await browser.newContext({
    viewport: { width, height: HEIGHT_FOR(width) },
    deviceScaleFactor: phone ? 3 : 1,
    isMobile: phone,
    hasTouch: phone,
    ...(phone ? { userAgent: PHONE_UA } : {}),
    colorScheme: "dark",
  });
  if (phone) await context.addInitScript(PHONE_SIGNALS);
  // A Vercel deploy behind Deployment Protection: trade the project's
  // automation-bypass secret for its cookie once, on the deploy's own origin.
  // Never as a context-wide extra header, which would carry the secret along
  // on every third-party request the page makes.
  const bypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
  if (bypass) {
    await context.request.get(`${base}${route}`, {
      headers: { "x-vercel-protection-bypass": bypass, "x-vercel-set-bypass-cookie": "true" },
      maxRedirects: 0,
    });
  }
  // Seed localStorage before any page script runs, so the pre-paint script
  // that decides whether to show the Threshold sees a returning visitor.
  if (storage.length > 0) {
    await context.addInitScript((pairs) => {
      for (const [key, value] of pairs) window.localStorage.setItem(key, value);
    }, storage);
  }
  const page = await context.newPage();
  const consoleErrors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });

  // The throttle: before navigation on a desktop run; after the page has
  // settled on a phone run, so the capability tier measures the device and
  // the throttle measures the room (see the header).
  const cdp = cpu > 1 ? await context.newCDPSession(page) : null;
  if (cdp !== null && !phone) await cdp.send("Emulation.setCPUThrottlingRate", { rate: cpu });

  // "load", not "networkidle". A room that animates keeps requesting frames and
  // an App Router page can hold a connection open, so networkidle is a coin
  // flip that resolves late or never; the fixed settle below is what actually
  // buys a steady state, and it is the same wait for every capture.
  const response = await page.goto(`${base}${route}`, { waitUntil: "load", timeout: 60_000 });
  const status = response?.status() ?? 0;
  if (status >= 400) {
    await context.close();
    return {
      width,
      cpu,
      status,
      error:
        `HTTP ${status}. The sanctuary routes open on NEXT_PUBLIC_SANCTUARY=1 at BUILD time (and /dev/rekha-monitor on SNC_MEASURE=1); ` +
        "setting it for the server alone does nothing. Re-run with --build, or `NEXT_PUBLIC_SANCTUARY=1 SNC_MEASURE=1 npm run build`. " +
        "A build made without it prints `○ /sanctuary` and serves a baked 404; on a deploy, set it in the project's environment and redeploy.",
    };
  }

  // Wait for the thing being measured to exist, not for a guessed duration.
  // The 3D room loads after idle, fetches a chunk and a mesh, draws a first
  // frame and only then fades in, so a fixed wait either wastes time or
  // photographs the CSS room underneath and calls it the scene.
  let waited = null;
  if (waitFor) {
    const t0 = Date.now();
    try {
      await page.waitForSelector(waitFor, { timeout: 30_000, state: "attached" });
      waited = Date.now() - t0;
    } catch {
      waited = -1;
    }
  }
  // Then let the fade finish and fonts settle.
  await page.waitForTimeout(settle);

  // What the page decided about itself: the measured tier, and whether a scene went live.
  const decided = await page.evaluate(() => ({
    tier: document.querySelector("[data-snc-tier]")?.getAttribute("data-snc-tier") ?? null,
    scene: document.querySelector('[data-snc-room-scene="live"]') !== null,
  }));

  if (cdp !== null && phone) {
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: cpu });
    await page.waitForTimeout(400);
  }

  const gpu = await readRenderer(page);

  // Proof that the throttle bit, carried in the report beside the number it
  // qualifies. A frame time labelled "cpu4x" on a page where the throttle was
  // silently ignored is exactly the confident lie §11 of the spec exists to
  // prevent, and the only way to tell the two apart is to time something known.
  // Expect roughly `cpu` times the 1x figure; scripts/capture/throttle-check.mjs
  // measured 20 / 78 / 171 ms at 1x / 4x / 8x on this machine.
  const cpuCalibrationMs = await page.evaluate(() => {
    const started = performance.now();
    let acc = 0;
    for (let i = 0; i < 8_000_000; i += 1) acc += Math.sqrt(i);
    return acc > 0 ? Number((performance.now() - started).toFixed(0)) : -1;
  });

  const samples = await sampleFrames(page, frames, WARMUP_FRAMES);
  const frame = summarise(samples);

  const shot = join(outDir, `${route.replaceAll("/", "_") || "_root"}-${width}${phone ? "-phone" : ""}${cpu > 1 ? `-cpu${cpu}x` : ""}.png`);
  await page.screenshot({ path: shot, fullPage: false });

  await context.close();
  return { width, cpu, phone, status, gpu, frame, cpuCalibrationMs, waitFor, waitedMs: waited, tier: decided.tier, sceneLive: decided.scene, screenshot: shot, consoleErrors };
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    console.log("node scripts/capture/capture.mjs [--route /sanctuary] [--viewport 390,1440] [--cpu 4] [--frames 240] [--base-url URL] [--headed] [--label name] [--build] [--wait-for selector] [--settle ms] [--returning] [--storage key=value] [--phone]");
    return;
  }

  const stamp = new Date().toISOString().replaceAll(":", "-").slice(0, 19);
  // captures/ is already gitignored, but its comment reserves it for raw palm
  // frames, which are biometric data. UI captures are neither sensitive nor
  // precious, so they get their own subtree rather than sitting beside scans.
  const outDir = join(REPO, "captures", "ui", opts.label ? `${stamp}-${opts.label}` : stamp);
  await mkdir(outDir, { recursive: true });

  let server = null;
  let base = opts.baseUrl;
  if (!base) {
    if (opts.build) await buildProduction();
    server = await startServer();
    base = server.base;
  }

  const browser = await chromium.launch({ headless: !opts.headed, args: GPU_ARGS });
  const results = [];
  try {
    // One up-front refusal, before any frame is timed.
    const probePage = await browser.newPage();
    const gpu = await readRenderer(probePage);
    await probePage.close();
    if (!gpu.ok || isSoftware(gpu.renderer)) {
      throw new Error(
        `Refusing to measure: renderer is "${gpu.renderer ?? gpu.reason}". ` +
          "A software backend would report roughly double the real frame time. " +
          "Run `node scripts/capture/gpu-probe.mjs` to see what this machine offers.",
      );
    }
    console.log(`GPU: ${gpu.renderer}`);

    for (const width of opts.viewports) {
      const result = await captureOne(browser, {
        base,
        route: opts.route,
        width,
        cpu: opts.cpu,
        frames: opts.frames,
        outDir,
        waitFor: opts.waitFor,
        settle: opts.settle,
        storage: opts.storage,
        phone: opts.phone,
      });
      results.push(result);
      const f = result.frame;
      console.log(
        f
          ? `${opts.route} @ ${width}${opts.phone ? " phone" : ""}${opts.cpu > 1 ? ` cpu${opts.cpu}x` : ""}  p50 ${f.p50}ms  p95 ${f.p95}ms  worst ${f.worst}ms  (${f.fpsAtP95} fps at p95)  [busy-loop ${result.cpuCalibrationMs}ms; tier ${result.tier ?? "?"}, scene ${result.sceneLive ? "live" : "none"}]`
          : `${opts.route} @ ${width}  ${result.error ?? "no frame summary"}`,
      );
    }

    const report = { stamp, route: opts.route, cpu: opts.cpu, phone: opts.phone, frames: opts.frames, gpu, results };
    await writeFile(join(outDir, "report.json"), JSON.stringify(report, null, 2));
    console.log(`\nReport: ${join(outDir, "report.json")}`);
  } finally {
    await browser.close();
    if (server) server.child.kill();
  }
}

if (import.meta.filename === process.argv[1]) {
  main().catch((err) => {
    console.error(err.message);
    process.exitCode = 1;
  });
}
