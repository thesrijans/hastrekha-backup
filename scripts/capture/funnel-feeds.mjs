/**
 * scan-complete G1.3 — the STAGE FUNNEL (lib/scan/funnel.ts) on synthetic phone feeds.
 *
 * Each feed (a .y4m from scripts/capture/make-tight-feeds.py) plays as the phone's back camera through
 * Chromium's fake capture device, a launch argument, so one browser runs per feed. The chamber runs its
 * real pipeline on it in the real-phone profile: Pixel 7 user agent, touch, 412×915, Android's camera
 * permission model (scripts/capture/phone-camera.mjs). Once the hand is found the scan runs `--seconds`,
 * then the funnel is read back (`window.__hrFunnel`, created under ?cost=1) and summed over every window:
 * hand frames, frames through EVERY gate, the first failing gate of the rest, each gate's own failures,
 * extractions, lines proposed and held, and the palm's size by both of the readout's measures.
 *
 *   node scripts/capture/funnel-feeds.mjs [--build] [--label name] [--seconds 20] [--feeds dir] [--only tight-00,normal]
 *
 * Writes captures/ui/<stamp>-<label>/ (git-ignored: the feeds are the reader's palm): one screenshot per
 * feed and funnel.json. Real GPU (gpu-probe's flags) and no WebGPU, for the same reason
 * capture-chamber-phone.mjs gives: headless WebGPU never resolves the segmenter's session.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { chromium } from "playwright";
import { buildProduction, startServer } from "./capture.mjs";
import { GPU_ARGS, isSoftware, readRenderer } from "./gpu-probe.mjs";
import { ANDROID, ANDROID_CAMERA_STUB } from "./phone-camera.mjs";

const REPO = resolve(import.meta.dirname, "..", "..");
const argv = process.argv.slice(2);
const arg = (name, fallback) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : fallback);
const label = arg("--label", "g1-funnel");
const seconds = Number(arg("--seconds", "20"));
const feedDir = resolve(arg("--feeds", join(REPO, "captures", "ui", "feeds", "tight")));
const only = argv.includes("--only") ? arg("--only").split(",") : null;

if (!existsSync(feedDir)) throw new Error(`No feeds at ${feedDir} — run scripts/capture/make-tight-feeds.py first.`);
const feeds = readdirSync(feedDir)
  .filter((file) => file.endsWith(".y4m"))
  .filter((file) => only === null || only.includes(basename(file, ".y4m")))
  .sort();
const manifestPath = join(feedDir, "manifest.json");
const manifest = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, "utf8")) : { feeds: [] };
const expected = new Map(manifest.feeds.map((entry) => [entry.feed, entry]));

/** Every window of a snapshot, closed and open, summed into one record. */
function summarise(snapshot) {
  if (snapshot === null) return null;
  const windows = [...snapshot.windows, snapshot.current];
  const sum = (key) => windows.reduce((total, w) => total + (w[key] ?? 0), 0);
  const record = (key) => {
    const out = {};
    for (const w of windows) for (const [id, n] of Object.entries(w[key] ?? {})) out[id] = (out[id] ?? 0) + n;
    return out;
  };
  const gateFailures = {};
  for (const w of windows) for (const [gate, g] of Object.entries(w.gates ?? {})) gateFailures[gate] = (gateFailures[gate] ?? 0) + g.failed;
  const stat = (key) => {
    const present = windows.map((w) => w[key]).filter((s) => s !== null && s !== undefined);
    if (present.length === 0) return null;
    const n = present.reduce((total, s) => total + s.n, 0);
    /* The median of the window medians, weighted by their sample counts — the windows are ~10 s each. */
    const medians = present.flatMap((s) => Array.from({ length: s.n }, () => s.median)).sort((a, b) => a - b);
    return { n, min: Math.min(...present.map((s) => s.min)), median: medians[Math.floor(medians.length / 2)], max: Math.max(...present.map((s) => s.max)) };
  };
  const nonZero = (o) => Object.fromEntries(Object.entries(o).filter(([, n]) => n > 0));
  return {
    captured: sum("captured"),
    hand: sum("handFound"),
    palm: sum("palmAccepted"),
    gates: sum("gatesPassed"),
    rectified: sum("rectified"),
    extractions: sum("extractions"),
    drawn: sum("drawn"),
    rejections: nonZero(record("rejections")),
    gateFailures: nonZero(gateFailures),
    proposed: nonZero(record("proposed")),
    held: nonZero(record("held")),
    poses: record("poses"),
    posesPassed: record("posesPassed"),
    palmPx: stat("palmWidthPx"),
    palmQuad: stat("palmQuadWidthPx"),
  };
}

const text = (record) => Object.entries(record).map(([id, n]) => `${id} ${n}`).join(" ") || "none";
const range = (s) => (s === null ? "–" : `${s.median} (${s.min}–${s.max})`);
const pct = (part, whole) => (whole === 0 ? "–" : `${((100 * part) / whole).toFixed(1)}%`);

if (argv.includes("--build")) await buildProduction();
const server = await startServer();
const stamp = new Date().toISOString().replaceAll(":", "-").slice(0, 19);
const dir = join(REPO, "captures", "ui", `${stamp}-${label}`);
mkdirSync(dir, { recursive: true });
const report = { feedDir, seconds, renderer: null, feeds: [] };

try {
  for (const feed of feeds) {
    const browser = await chromium.launch({
      headless: true,
      args: [
        ...GPU_ARGS,
        "--disable-features=WebGPU,WebGPUService,Vulkan",
        "--use-fake-device-for-media-stream=device-count=2",
        "--use-fake-ui-for-media-stream",
        `--use-file-for-fake-video-capture=${join(feedDir, feed)}`,
      ],
    });
    try {
      if (report.renderer === null) {
        const probe = await browser.newPage();
        const gpu = await readRenderer(probe);
        await probe.close();
        if (!gpu.ok || isSoftware(gpu.renderer)) throw new Error(`Refusing to measure on a software renderer: ${gpu.renderer ?? gpu.reason}`);
        report.renderer = gpu.renderer;
        console.log(`GPU: ${gpu.renderer}\n`);
      }
      const context = await browser.newContext({
        viewport: { width: 412, height: 915 },
        deviceScaleFactor: 2.625,
        isMobile: true,
        hasTouch: true,
        userAgent: ANDROID,
        colorScheme: "dark",
        permissions: ["camera"],
      });
      await context.addInitScript(ANDROID_CAMERA_STUB);
      const page = await context.newPage();
      const errors = [];
      const failedRequests = [];
      page.on("console", (message) => message.type() === "error" && errors.push(message.text()));
      page.on("pageerror", (error) => errors.push(String(error)));
      page.on("response", (response) => response.status() >= 400 && failedRequests.push(`${response.status()} ${new URL(response.url()).pathname}`));
      await page.goto(`${server.base}/scan/chamber?cost=1`, { waitUntil: "load", timeout: 60_000 });
      await page.waitForTimeout(600);
      await page.tap("button:has-text('Kaksh mein pravesh')");
      const handSeen = await page
        .waitForFunction(() => document.querySelector("canvas")?.dataset.sncHand, null, { timeout: 45_000 })
        .then(() => true)
        .catch(() => false);
      await page.waitForTimeout(seconds * 1000);
      const snapshot = await page.evaluate(() => (typeof window.__hrFunnel === "function" ? window.__hrFunnel() : null));
      const readout = await page.evaluate(() => document.querySelector("[data-snc-budget]")?.textContent ?? null);
      const litany = await page.evaluate(() => [...document.querySelectorAll('[data-snc-litany="in"] p')].map((p) => p.textContent.trim()));
      const name = basename(feed, ".y4m");
      await page.screenshot({ path: join(dir, `${name}.png`) });
      const entry = { feed: name, expected: expected.get(feed) ?? null, handSeen, errors, failedRequests, litany, readout, funnel: summarise(snapshot) };
      report.feeds.push(entry);
      const f = entry.funnel;
      console.log(
        f === null
          ? `${name}: no funnel (?cost=1 not honoured)`
          : `${name.padEnd(10)} hand ${String(f.hand).padStart(4)}  gates ${String(f.gates).padStart(4)} ${pct(f.gates, f.hand).padStart(6)}  ` +
              `first-fail [${text(f.rejections)}]  each-gate [${text(f.gateFailures)}]  extractions ${f.extractions}  ` +
              `proposed [${text(f.proposed)}]  held [${text(f.held)}]  palm px ${range(f.palmPx)}  quad px ${range(f.palmQuad)}  ` +
              `pose [${text(f.poses)}] passed [${text(f.posesPassed ?? {})}]  hint "${litany.slice(1).join(" / ")}"` +
              `${errors.length ? `  ERRORS ${errors.length}` : ""}${failedRequests.length ? ` [${[...new Set(failedRequests)].join(", ")}]` : ""}`,
      );
      await context.close();
    } finally {
      await browser.close();
    }
  }
} finally {
  writeFileSync(join(dir, "funnel.json"), JSON.stringify(report, null, 2));
  server?.stop?.();
  server?.child?.kill?.();
}

/*
 * The DoD's numbers: the tight crops together, and the two controls on their own. "In FLAT" is the like-for-
 * like figure — the phone recordings never left FLAT, and a static feed can pass FLAT but never a TILT pose
 * (it cannot tilt), so once FLAT commits every later frame fails tilt_direction whatever the frame gate does.
 * Builds without the funnel's per-pose pass count (before scan-complete G1) have it inferred only when every
 * hand frame was FLAT.
 */
const inFlat = (f) => ({
  hand: f.poses.FLAT ?? 0,
  passed: f.posesPassed?.FLAT ?? (Object.keys(f.poses).every((pose) => pose === "FLAT") ? f.gates : null),
});
const group = (prefix) => report.feeds.filter((e) => e.feed.startsWith(prefix) && e.funnel !== null);
const tight = group("tight-");
if (tight.length > 0) {
  const hand = tight.reduce((t, e) => t + e.funnel.hand, 0);
  const gates = tight.reduce((t, e) => t + e.funnel.gates, 0);
  const flat = tight.map((e) => inFlat(e.funnel));
  const flatHand = flat.reduce((t, f) => t + f.hand, 0);
  const flatPassed = flat.every((f) => f.passed !== null) ? flat.reduce((t, f) => t + f.passed, 0) : null;
  const flowing = tight.filter((e) => e.funnel.extractions > 0).length;
  const rejections = {};
  for (const e of tight) for (const [gate, n] of Object.entries(e.funnel.rejections)) rejections[gate] = (rejections[gate] ?? 0) + n;
  console.log(
    `\nTIGHT (${tight.length} feeds): in FLAT ${flatPassed ?? "?"}/${flatHand} = ${flatPassed === null ? "?" : pct(flatPassed, flatHand)} · ` +
      `all poses ${gates}/${hand} = ${pct(gates, hand)} · extractions in ${flowing}/${tight.length} feeds (${tight.reduce((t, e) => t + e.funnel.extractions, 0)} runs) · first-fail [${text(rejections)}]`,
  );
}
for (const control of ["normal", "wrist-cut"]) {
  const e = report.feeds.find((entry) => entry.feed === control && entry.funnel !== null);
  if (!e) continue;
  const flat = inFlat(e.funnel);
  console.log(`${control.toUpperCase()}: in FLAT ${flat.passed ?? "?"}/${flat.hand} · all poses ${e.funnel.gates}/${e.funnel.hand} = ${pct(e.funnel.gates, e.funnel.hand)} · first-fail [${text(e.funnel.rejections)}]`);
}
console.log(`\nReport: ${join(dir, "funnel.json")}`);
