/**
 * scan-perfect P1 — the raw recording mode, verified in the real-phone profile.
 *
 * Two sessions on the same fake back camera (a feed from captures/ui/feeds, a launch argument, so one browser each):
 *
 *   baseline  /scan/chamber?cost=1             — the chamber as it scans, its frame cost read at 28 s
 *   record    /scan/chamber?record=1&cost=1    — the same, recording: the "● REC" mark photographed, the frame cost
 *             read at 28 s, the finished card photographed, the file downloaded
 *
 * Then the file itself: ffprobe's codec, size, frames and duration; one frame decoded (at 10 s) and compared with the
 * camera's own frame — mean and worst 16×16-block difference, PSNR — which is what says the recording is the RAW
 * stream (an overlay line or ring would be a block far off); every request the page made, so nothing was uploaded;
 * and the recording converted to a feed (recording-to-feed.mjs) and played back as the camera, the chamber finding
 * the hand in it — the loop the later parts measure on.
 *
 *   node scripts/capture/record-mode.mjs [--feed captures/ui/feeds/tight/tight-00.y4m] [--label p1-record] [--cpu 1]
 *
 * Needs the gate-open build (NEXT_PUBLIC_SANCTUARY=1 SNC_MEASURE=1 npm run build) and ffmpeg/ffprobe on PATH.
 * Writes captures/ui/<stamp>-<label>/ (git-ignored: the feed is the reader's palm).
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { chromium } from "playwright";
import sharp from "sharp";
import { startServer } from "./capture.mjs";
import { GPU_ARGS, isSoftware, readRenderer } from "./gpu-probe.mjs";
import { probeVideo } from "./recording-to-feed.mjs";
import { ANDROID, ANDROID_CAMERA_STUB } from "./phone-camera.mjs";

const REPO = resolve(import.meta.dirname, "..", "..");
const argv = process.argv.slice(2);
const arg = (name, fallback) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : fallback);
const feed = resolve(arg("--feed", join(REPO, "captures", "ui", "feeds", "tight", "tight-00.y4m")));
const label = arg("--label", "p1-record");
const cpu = Number(arg("--cpu", "1"));
if (!existsSync(feed)) throw new Error(`No feed at ${feed}`);

const stamp = new Date().toISOString().replaceAll(":", "-").slice(0, 19);
const dir = join(REPO, "captures", "ui", `${stamp}-${label}`);
mkdirSync(dir, { recursive: true });
const report = { feed: feed.replace(REPO, ""), cpu, renderer: null, sessions: {}, file: null, frame: null, uploads: null, playback: null };

/** The chamber's ?cost=1 frame readout: "p50 0.50 · p95 0.90 · worst 4.50 ms (240 frames)". */
const readCost = async (page) =>
  page.evaluate(() => {
    const text = document.querySelector("[data-snc-budget]")?.textContent ?? "";
    const m = /p50 ([\d.]+) · p95 ([\d.]+) · worst ([\d.]+) ms \((\d+) frames\)/.exec(text);
    return m === null ? null : { p50: Number(m[1]), p95: Number(m[2]), worst: Number(m[3]), frames: Number(m[4]) };
  });

async function session(server, browser, path, onRun) {
  const context = await browser.newContext({
    viewport: { width: 412, height: 915 },
    deviceScaleFactor: 2.625,
    isMobile: true,
    hasTouch: true,
    userAgent: ANDROID,
    colorScheme: "dark",
    permissions: ["camera"],
    acceptDownloads: true,
  });
  await context.addInitScript(ANDROID_CAMERA_STUB);
  const page = await context.newPage();
  if (cpu > 1) await (await context.newCDPSession(page)).send("Emulation.setCPUThrottlingRate", { rate: cpu });
  const requests = [];
  page.on("request", (request) => {
    const body = request.postDataBuffer();
    requests.push({ method: request.method(), url: new URL(request.url()).pathname, bytes: body === null ? 0 : body.length });
  });
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  await page.goto(`${server.base}${path}`, { waitUntil: "load", timeout: 60_000 });
  await page.waitForTimeout(600);
  await page.tap("button:has-text('Kaksh mein pravesh')");
  const enteredAt = Date.now();
  const shot = async (file) => {
    const hide = await page.addStyleTag({ content: "[data-snc-budget]{visibility:hidden !important}" });
    await page.screenshot({ path: join(dir, file) });
    await hide.evaluate((element) => element.remove());
  };
  const result = await onRun({ page, enteredAt, shot });
  await context.close();
  return { ...result, errors, requests };
}

const server = await startServer({ offline: true });
try {
  const launch = (cameraFile) =>
    chromium.launch({
      headless: true,
      args: [
        ...GPU_ARGS,
        "--disable-features=WebGPU,WebGPUService,Vulkan",
        "--use-fake-device-for-media-stream=device-count=2",
        "--use-fake-ui-for-media-stream",
        `--use-file-for-fake-video-capture=${cameraFile}`,
      ],
    });

  /* 1. Baseline: the chamber scanning, no recording. */
  {
    const browser = await launch(feed);
    try {
      const gpu = await readRenderer(await browser.newPage());
      if (!gpu.ok || isSoftware(gpu.renderer)) throw new Error(`Refusing to measure on a software renderer: ${gpu.renderer ?? gpu.reason}`);
      report.renderer = gpu.renderer;
      console.log(`GPU: ${gpu.renderer}`);
      report.sessions.baseline = await session(server, browser, "/scan/chamber?cost=1", async ({ page, enteredAt, shot }) => {
        await page.waitForTimeout(Math.max(0, 28_000 - (Date.now() - enteredAt)));
        const cost = await readCost(page);
        await shot("baseline-28s.png");
        return { cost };
      });
    } finally {
      await browser.close();
    }
  }

  /* 2. Recording: the mark, the cost while it records, the card, the file. */
  {
    const browser = await launch(feed);
    try {
      report.sessions.record = await session(server, browser, "/scan/chamber?record=1&cost=1", async ({ page, enteredAt, shot }) => {
        await page.waitForSelector('[data-snc-rec="recording"]', { timeout: 30_000 });
        const recAt = Date.now() - enteredAt;
        const mime = await page.getAttribute('[data-snc-rec="recording"]', "data-snc-rec-mime");
        await page.waitForTimeout(3000);
        await shot("record-mark.png");
        await page.waitForTimeout(Math.max(0, 28_000 - (Date.now() - enteredAt)));
        const cost = await readCost(page);
        /* Nothing completes while it records: the camera must still be live at 28 s. */
        const cameraLive = await page.evaluate(() => [...document.querySelectorAll("video")].some((v) => v.srcObject !== null && v.srcObject.getVideoTracks().some((t) => t.readyState === "live")));
        await page.waitForSelector('[data-snc-rec="done"]', { timeout: 45_000 });
        const doneAt = Date.now() - enteredAt;
        await shot("record-card.png");
        const card = await page.evaluate(() => {
          const el = document.querySelector('[data-snc-rec="done"]');
          return {
            file: el.getAttribute("data-snc-rec-file"),
            bytes: Number(el.getAttribute("data-snc-rec-bytes")),
            durationMs: Number(el.getAttribute("data-snc-rec-duration")),
            width: Number(el.getAttribute("data-snc-rec-width")),
            height: Number(el.getAttribute("data-snc-rec-height")),
            cut: el.getAttribute("data-snc-rec-cut") === "1",
            text: el.textContent,
            share: el.querySelector('[data-snc-rec-action="share"]') !== null,
          };
        });
        const [download] = await Promise.all([page.waitForEvent("download", { timeout: 15_000 }), page.click('[data-snc-rec-action="download"]')]);
        const saved = join(dir, download.suggestedFilename());
        await download.saveAs(saved);
        /* After the recording, the scan goes on and may complete as ever. */
        await page.waitForTimeout(2000);
        const phase = await page.evaluate(() => document.querySelector("[data-snc-phase]")?.getAttribute("data-snc-phase") ?? null);
        return { recAt, doneAt, mime, cost, cameraLiveAt28s: cameraLive, card, saved, phaseAfter: phase };
      });
    } finally {
      await browser.close();
    }
  }

  /* 3. The file: ffprobe, one frame against the camera's own, and what the page sent. */
  const saved = report.sessions.record.saved;
  const facts = probeVideo(saved);
  report.file = { name: basename(saved), bytes: report.sessions.record.card.bytes, ...facts };
  const stream = { width: facts.width, height: facts.height };
  const recFrame = join(dir, "frame-recorded-10s.png");
  const srcFrame = join(dir, "frame-camera.png");
  execFileSync("ffmpeg", ["-y", "-v", "error", "-ss", "10", "-i", saved, "-frames:v", "1", recFrame]);
  execFileSync("ffmpeg", ["-y", "-v", "error", "-i", feed, "-frames:v", "1", "-vf", `scale=${stream.width}:${stream.height}`, srcFrame]);
  const raw = async (file) => sharp(file).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const a = await raw(recFrame);
  const b = await raw(srcFrame);
  let sum = 0;
  let sq = 0;
  const n = Math.min(a.data.length, b.data.length);
  for (let i = 0; i < n; i += 1) {
    const d = Math.abs(a.data[i] - b.data[i]);
    sum += d;
    sq += d * d;
  }
  const w = a.info.width;
  const h = a.info.height;
  let worstBlock = 0;
  for (let by = 0; by + 16 <= h; by += 16) {
    for (let bx = 0; bx + 16 <= w; bx += 16) {
      let blockSum = 0;
      for (let y = by; y < by + 16; y += 1) for (let x = bx; x < bx + 16; x += 1) for (let c = 0; c < 3; c += 1) blockSum += Math.abs(a.data[(y * w + x) * 3 + c] - b.data[(y * w + x) * 3 + c]);
      worstBlock = Math.max(worstBlock, blockSum / (16 * 16 * 3));
    }
  }
  const mse = sq / n;
  report.frame = { meanAbsDiff: Math.round((sum / n) * 100) / 100, worstBlock16: Math.round(worstBlock * 100) / 100, psnrDb: Math.round((mse === 0 ? 99 : 10 * Math.log10((255 * 255) / mse)) * 10) / 10 };
  const all = report.sessions.record.requests;
  report.uploads = { requests: all.length, withBody: all.filter((r) => r.bytes > 0).length, largestBodyBytes: Math.max(0, ...all.map((r) => r.bytes)), bodies: all.filter((r) => r.bytes > 0).map((r) => `${r.method} ${r.url} ${r.bytes}`) };

  /* 4. The recording as the camera: converted, played back, the hand found in it. */
  // Into this run's own folder: a recording of the fake camera is not the reader's phone, and must never sit among them.
  execFileSync("node", [join(REPO, "scripts", "capture", "recording-to-feed.mjs"), "--file", saved, "--out", dir], { stdio: "inherit" });
  const playbackFeed = join(dir, `${basename(saved).replace(/\.(webm|mp4)$/, "")}.mjpeg`);
  {
    const browser = await launch(playbackFeed);
    try {
      report.playback = await session(server, browser, "/scan/chamber?cost=1", async ({ page, enteredAt, shot }) => {
        const handSeen = await page
          .waitForFunction(() => document.querySelector("canvas")?.dataset.sncHand, null, { timeout: 45_000 })
          .then(() => (Date.now() - enteredAt) / 1000)
          .catch(() => null);
        await page.waitForTimeout(6000);
        await shot("playback.png");
        const settings = await page.evaluate(() => {
          const track = [...document.querySelectorAll("video")].map((v) => v.srcObject?.getVideoTracks?.()[0]).find((t) => t !== undefined);
          const s = track?.getSettings?.() ?? {};
          return { width: s.width ?? null, height: s.height ?? null, frameRate: s.frameRate ?? null };
        });
        return { feed: basename(playbackFeed), handSeenAtS: handSeen, cameraSettings: settings };
      });
    } finally {
      await browser.close();
    }
  }
} finally {
  writeFileSync(join(dir, "record.json"), JSON.stringify(report, null, 2));
  server?.stop?.();
  server?.child?.kill?.();
}

const r = report.sessions.record;
console.log(
  `RECORD: REC at ${(r.recAt / 1000).toFixed(1)} s, done at ${(r.doneAt / 1000).toFixed(1)} s, ${r.mime}; camera live at 28 s: ${r.cameraLiveAt28s}; phase after: ${r.phaseAfter}\n` +
    `  card "${r.card.text}" share button: ${r.card.share}\n` +
    `  file ${report.file.name}: ${report.file.container} ${report.file.codec} ${report.file.width}x${report.file.height} @ ${report.file.fps} fps, ${report.file.frames} frames, ${report.file.durationS?.toFixed?.(2)} s, ${(report.file.bytes / 1e6).toFixed(1)} MB\n` +
    `  frame at 10 s vs the camera's: mean |diff| ${report.frame.meanAbsDiff}, worst 16x16 block ${report.frame.worstBlock16}, PSNR ${report.frame.psnrDb} dB\n` +
    `  requests ${report.uploads.requests}, with a body ${report.uploads.withBody}, largest body ${report.uploads.largestBodyBytes} B ${report.uploads.bodies.join(" | ")}\n` +
    `  frame cost at 28 s: baseline ${JSON.stringify(report.sessions.baseline.cost)} vs recording ${JSON.stringify(r.cost)}\n` +
    `PLAYBACK: ${report.playback.feed} as the camera ${JSON.stringify(report.playback.cameraSettings)}, hand found at ${report.playback.handSeenAtS ?? "never"} s\n` +
    `Report: ${join(dir, "record.json")}`,
);
