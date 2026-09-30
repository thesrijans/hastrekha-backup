/**
 * G4b §6 — THE CHAKRA on the synthetic phone feeds (docs/specs/chakra-scan-g4.txt).
 *
 * Each feed plays as the phone's back camera through Chromium's fake capture device, one browser per feed, on
 * the real GPU (gpu-probe's flags), in the real-phone profile: Pixel 7 user agent, touch, 412×915 (or
 * --viewport), and Android's camera permission prompt (scripts/capture/phone-camera.mjs). The chamber runs its
 * real pipeline under ?cost=1, and a 200 ms sampler in the page records the ring as the chamber publishes it
 * (data-snc-chakra-overall, data-snc-chakra-held, the shutter's state, the best frame as it stands).
 *
 *   node scripts/capture/chakra-feeds.mjs [--build] [--label name] [--feeds dir] [--only tight-00,normal]
 *        [--viewport 390x844] [--scenario ring|shutter|loss2|loss8] [--seconds 150]
 *
 *   ring     the ring at 0%, ~40% and ~80%; the completion sweep; the result lined and plain; the picture saved
 *            and the saved PNG opened; why and on what the scan completed, the pose it was at, the lines against
 *            the overlay's drawing of that frame (±3 px), the frame cost.
 *   shutter  the shutter against the lines held, every sample; pressed the moment it wakes: the reason, and the
 *            frozen frame against the best frame published just before the press.
 *   loss2    the feed blanked 2 s once a line is held (the relay, phone-camera.mjs): the ring, the ✓ and the
 *            usable time before, during and after — kept.
 *   loss8    the feed blanked 8 s once three majors are held: the scan completes by itself (2c), and when.
 *
 * Writes captures/ui/<stamp>-<label>/ (git-ignored: the feeds are the reader's palm): the photographs and
 * chakra.json.
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
const scenario = arg("--scenario", "ring");
const label = arg("--label", `g4b-${scenario}`);
const seconds = Number(arg("--seconds", "150"));
const feedDir = resolve(arg("--feeds", join(REPO, "captures", "ui", "feeds", "tight")));
const only = argv.includes("--only") ? arg("--only").split(",") : null;
const [viewportWidth, viewportHeight] = arg("--viewport", "412x915").split("x").map(Number);
if (!["ring", "shutter", "loss2", "loss8"].includes(scenario)) throw new Error(`Unknown scenario ${scenario}`);

if (!existsSync(feedDir)) throw new Error(`No feeds at ${feedDir}`);
const feeds = readdirSync(feedDir)
  .filter((file) => file.endsWith(".y4m"))
  .filter((file) => only === null || only.includes(basename(file, ".y4m")))
  .sort();

/** Every navigator.vibrate call, timed. */
const VIBRATE_RECORDER = () => {
  const calls = [];
  window.__vibrations = calls;
  Object.defineProperty(navigator, "vibrate", { configurable: true, value: (pattern) => (calls.push({ at: Math.round(performance.now()), pattern }), true) });
};
/** The loss scenarios relay the camera through a canvas they can blank (phone-camera.mjs). */
const RELAY_ON = () => {
  window.__hrRelay = true;
};

/** In the page: the chamber as it publishes itself, every 200 ms from the tap. */
const SAMPLER = () => {
  const samples = [];
  window.__chakraSamples = samples;
  const t0 = performance.now();
  window.__chakraT0 = t0;
  setInterval(() => {
    const root = document.querySelector("[data-snc-phase]");
    const shutter = document.querySelector('[data-snc-control="shutter"]');
    const summary = document.querySelector("[data-snc-usable]");
    samples.push({
      t: Math.round(performance.now() - t0),
      phase: root?.getAttribute("data-snc-phase") ?? null,
      overall: Number(root?.getAttribute("data-snc-chakra-overall") ?? "0"),
      held: Number(root?.getAttribute("data-snc-chakra-held") ?? "0"),
      shutter: shutter === null ? null : shutter.getAttribute("data-snc-shutter"),
      shutterDisabled: shutter === null ? null : shutter.hasAttribute("disabled"),
      bestNow: root?.getAttribute("data-snc-best-now") ?? null,
      palmGone: root?.getAttribute("data-snc-palm-gone") ?? null,
      usable: summary === null ? null : Number(summary.getAttribute("data-snc-usable")),
      lines: [...document.querySelectorAll("[data-snc-detect]")].map((e) => `${e.getAttribute("data-snc-detect")[0]}${e.getAttribute("data-snc-progress")}`),
      hand: document.querySelector("canvas")?.dataset.sncHand ?? null,
    });
  }, 200);
};

/**
 * In the page: the moment the scan seals, wait `delay` ms and composite what is on screen — the frozen photograph's
 * canvas and, over it, the chamber's ring canvas — into one PNG. A screenshot from outside takes most of a second in
 * this rig and would land after the 600 ms sweep.
 */
const SWEEP_GRABBER = (delays) => {
  const root = document.querySelector("[data-snc-phase]");
  if (root === null) return;
  window.__sweepShots = [];
  /* Every animation frame's time, from the start: the longest gap after the completion is its jank. */
  const frames = [];
  window.__frameTimes = frames;
  const tick = (t) => {
    frames.push(Math.round(t - window.__chakraT0));
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  window.__sealCommitAt = null;
  /* A copy now (canvas to canvas, cheap), encoded later: an encode between the grabs would block the second. */
  const copies = [];
  const grab = (delay, sealStart) => {
    const photo = document.querySelector("[data-snc-result] canvas");
    const ring = document.querySelector("canvas[data-snc-ring]");
    if (photo === null) return;
    const out = document.createElement("canvas");
    out.width = photo.width;
    out.height = photo.height;
    const context = out.getContext("2d");
    context.fillStyle = "#000";
    context.fillRect(0, 0, out.width, out.height);
    context.drawImage(photo, 0, 0);
    if (ring !== null) context.drawImage(ring, 0, 0, out.width, out.height);
    copies.push({ delay, at: Math.round(performance.now() - window.__chakraT0), sinceFirstSealFrame: Math.round(performance.now() - sealStart), canvas: out, ring: ring !== null });
    if (copies.length === delays.length) {
      setTimeout(() => {
        window.__sweepShots = copies.map((copy) => ({ delay: copy.delay, at: copy.at, sinceFirstSealFrame: copy.sinceFirstSealFrame, ring: copy.ring, png: copy.canvas.toDataURL("image/png") }));
      }, 1500);
    }
  };
  const phaseWatch = new MutationObserver(() => {
    if (root.getAttribute("data-snc-phase") !== "sealing") return;
    phaseWatch.disconnect();
    window.__sealCommitAt = Math.round(performance.now() - window.__chakraT0);
    /* The seal's own clock: the ring canvas marks its first sealing frame (chamber-canvas.tsx data-snc-seal-start). */
    const poll = () => {
      const ring = document.querySelector("canvas[data-snc-ring]");
      const start = ring?.dataset.sncSealStart;
      if (start === undefined) return void setTimeout(poll, 10);
      const sealStart = Number(start);
      window.__firstSealFrameAt = Math.round(sealStart - window.__chakraT0);
      for (const delay of delays) setTimeout(() => grab(delay, sealStart), Math.max(0, sealStart + delay - performance.now()));
    };
    poll();
  });
  phaseWatch.observe(root, { attributes: true, attributeFilter: ["data-snc-phase"] });
};

/** The completion, as the chamber published it on its root. */
const COMPLETION = () => {
  const root = document.querySelector("[data-snc-phase]");
  if (root === null) return null;
  const a = (name) => root.getAttribute(name);
  return {
    phase: a("data-snc-phase"),
    reason: a("data-snc-completion-reason"),
    pose: a("data-snc-completion-pose"),
    best: a("data-snc-best"),
    shift: a("data-snc-freeze-shift"),
    deviation: a("data-snc-deviation"),
    deviationScreen: a("data-snc-deviation-screen"),
    fromLive: a("data-snc-from-live"),
    heldDeviation: a("data-snc-held-deviation"),
    heldThenDeviation: a("data-snc-held-then-deviation"),
    freezeMs: a("data-snc-freeze-ms"),
    readout: document.querySelector("[data-snc-budget]")?.textContent ?? null,
    result: document.querySelector("[data-snc-result]")?.getAttribute("data-snc-result") ?? null,
    legend: document.querySelector("[data-snc-legend]")?.textContent?.trim() ?? null,
    title: document.querySelector("[data-snc-result] p")?.textContent?.trim() ?? null,
    view: document.querySelector("[data-snc-result] canvas")?.dataset.sncView ?? null,
    saved: document.querySelector("[data-snc-result]")?.getAttribute("data-snc-saved") ?? null,
    lined: document.querySelector("[data-snc-result]")?.hasAttribute("data-snc-lined") ?? null,
    videoLive: [...document.querySelectorAll("video")].some((v) => v.srcObject !== null && v.srcObject.getVideoTracks().some((t) => t.readyState === "live")),
    leaf: (() => {
      const leaf = document.querySelector("[data-snc-legend]")?.closest("[class]")?.parentElement?.getBoundingClientRect();
      return leaf === undefined ? null : { top: Math.round(leaf.top), bottom: Math.round(leaf.bottom) };
    })(),
  };
};

/** The PNG's own size, from its IHDR. */
function pngSize(buffer) {
  if (buffer.length < 24 || buffer.toString("ascii", 1, 4) !== "PNG") return null;
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

/** The frame-cost readout's three numbers and the best frame's per-tick p95. */
function costOf(readout) {
  if (typeof readout !== "string") return null;
  const frame = readout.match(/p50 ([\d.]+) · p95 ([\d.]+) · worst ([\d.]+) ms/);
  const best = readout.match(/best p95 ([\d.]+) ms/);
  const pose = readout.match(/pose ([A-Z_]+)/);
  return {
    p50: frame === null ? null : Number(frame[1]),
    p95: frame === null ? null : Number(frame[2]),
    worst: frame === null ? null : Number(frame[3]),
    bestP95: best === null ? null : Number(best[1]),
    pose: pose === null ? null : pose[1],
  };
}

if (argv.includes("--build")) await buildProduction();
const server = await startServer();
const stamp = new Date().toISOString().replaceAll(":", "-").slice(0, 19);
const dir = join(REPO, "captures", "ui", `${stamp}-${label}`);
mkdirSync(dir, { recursive: true });
const report = { scenario, viewport: `${viewportWidth}x${viewportHeight}`, feedDir, renderer: null, feeds: [] };

try {
  for (const feed of feeds) {
    const name = basename(feed, ".y4m");
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
    const entry = { feed: name, notes: [] };
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
        viewport: { width: viewportWidth, height: viewportHeight },
        deviceScaleFactor: 2.625,
        isMobile: true,
        hasTouch: true,
        userAgent: ANDROID,
        colorScheme: "dark",
        permissions: ["camera"],
        acceptDownloads: true,
      });
      if (scenario === "loss2" || scenario === "loss8") await context.addInitScript(RELAY_ON);
      await context.addInitScript(ANDROID_CAMERA_STUB);
      await context.addInitScript(VIBRATE_RECORDER);
      const page = await context.newPage();
      const errors = [];
      page.on("console", (message) => message.type() === "error" && errors.push(message.text()));
      page.on("pageerror", (error) => errors.push(String(error)));
      await page.goto(`${server.base}/scan/chamber?cost=1`, { waitUntil: "load", timeout: 60_000 });
      await page.waitForTimeout(600);
      await page.tap("button:has-text('Kaksh mein pravesh')");
      await page.evaluate(SAMPLER);
      /* The pulse peaks at ~160 ms, the sweep is half round at 300 ms: one grab for each. */
      await page.evaluate(SWEEP_GRABBER, [150, 330]);
      /* The ?cost=1 readout is for the numbers; the photographs are taken without it over the room. */
      const shot = async (file) => {
        const hide = await page.addStyleTag({ content: "[data-snc-budget]{visibility:hidden !important}" });
        await page.screenshot({ path: join(dir, `${name}-${file}.png`) });
        await hide.evaluate((element) => element.remove());
      };
      const state = () => page.evaluate(() => window.__chakraSamples.at(-1) ?? null);
      const until = Date.now() + seconds * 1000;
      const waitFor = async (predicate, pollMs = 100) => {
        while (Date.now() < until) {
          const s = await state();
          if (s !== null && predicate(s)) return s;
          await page.waitForTimeout(pollMs);
        }
        return null;
      };

      entry.prompts = await page.evaluate(() => window.__camera?.prompts ?? null);
      const handAt = await waitFor((s) => s.hand !== null && s.hand !== "");
      entry.handAt = handAt?.t ?? null;
      if (handAt === null) throw new Error("no hand");

      if (scenario === "ring") {
        await shot("ring-00");
        entry.ring = { "00": (await state()).overall };
        /* ~40% and ~80%: triggered a little early, since a photograph from outside lands most of a second later. */
        for (const [key, level] of [["40", 0.38], ["80", 0.72]]) {
          const s = await waitFor((x) => x.overall >= level || x.phase !== "scanning", 60);
          if (s === null || s.phase !== "scanning") break;
          await shot(`ring-${key}`);
          entry.ring[key] = (await state()).overall;
        }
      }

      if (scenario === "shutter") {
        const woke = await waitFor((s) => s.shutter === "ready" || s.phase !== "scanning", 50);
        if (woke !== null && woke.shutter === "ready") {
          await shot("shutter-ready");
          const before = await page.evaluate(() => document.querySelector("[data-snc-phase]")?.getAttribute("data-snc-best-now") ?? null);
          await page.tap('[data-snc-control="shutter"]');
          entry.shutter = { wokeAt: woke.t, heldAtWake: woke.held, bestBefore: before };
        } else entry.notes.push("the shutter never woke before the scan completed");
      }

      if (scenario === "loss2") {
        const s = await waitFor((x) => x.held >= 1 || x.phase !== "scanning");
        if (s !== null && s.phase === "scanning") {
          /* The blank starts in the page, and every point below is read off the page's own 200 ms series by its time. */
          const blankAt = await page.evaluate(() => (window.__hrBlackout(2000), Math.round(performance.now() - window.__chakraT0)));
          await page.waitForTimeout(1000);
          await shot("loss2-during");
          await page.waitForTimeout(5000);
          await shot("loss2-after");
          entry.loss = { blankAt, blankMs: 2000 };
        } else entry.notes.push("no line held before the scan completed");
      }

      if (scenario === "loss8") {
        const s = await waitFor((x) => x.held >= 3 || x.phase !== "scanning");
        if (s !== null && s.phase === "scanning") {
          const blankAt = await page.evaluate(() => (window.__hrBlackout(8000), Math.round(performance.now() - window.__chakraT0)));
          await page.waitForTimeout(2000);
          await shot("loss8-during");
          const sealed = await waitFor((x) => x.phase !== "scanning", 50);
          entry.loss = { blankAt, blankMs: 8000, sealedAt: sealed?.t ?? null, palmGoneAtSeal: sealed?.palmGone ?? null };
        } else entry.notes.push("three majors were never held before the scan completed");
      }

      /* The completion: the sweep, the result lined and plain, the picture saved and opened. */
      const sealing = await waitFor((s) => s.phase !== "scanning", 50);
      if (sealing !== null) {
        entry.completedAt = sealing.t;
        const grabs = await page.waitForFunction(() => (window.__sweepShots?.length ?? 0) >= 2 ? window.__sweepShots : null, null, { timeout: 8000 }).then((handle) => handle.jsonValue()).catch(() => null);
        const timing = await page.evaluate(() => ({ commit: window.__sealCommitAt, firstFrame: window.__firstSealFrameAt, frames: window.__frameTimes ?? [] }));
        /* The jank at completion: the longest gap between animation frames in the two seconds after the commit. */
        const after = timing.frames.filter((t) => timing.commit !== null && t >= timing.commit - 50 && t <= timing.commit + 2000);
        let longest = 0;
        for (let i = 1; i < after.length; i += 1) longest = Math.max(longest, after[i] - after[i - 1]);
        entry.sealTiming = { commitToFirstSealFrame: timing.firstFrame === undefined || timing.commit === null ? null : timing.firstFrame - timing.commit, longestFrameGap: longest };
        if (grabs !== null) {
          for (const grab of grabs) writeFileSync(join(dir, `${name}-seal-${grab.delay}ms.png`), Buffer.from(grab.png.split(",")[1], "base64"));
          entry.sweep = { grabs: grabs.map((grab) => ({ delay: grab.delay, sinceFirstSealFrame: grab.sinceFirstSealFrame, ring: grab.ring })) };
        } else entry.notes.push("no seal grab");
        await page.waitForFunction(() => document.querySelector("[data-snc-phase]")?.getAttribute("data-snc-phase") === "complete", null, { timeout: 15_000 }).catch(() => undefined);
        await page.waitForTimeout(1300);
        entry.completion = await page.evaluate(COMPLETION);
        await shot("result-lined");
        if (scenario === "ring") {
          await page.tap('[data-snc-view-mode="plain"]');
          await page.waitForTimeout(350);
          await shot("result-plain");
          entry.plain = await page.evaluate(() => !document.querySelector("[data-snc-result]")?.hasAttribute("data-snc-lined"));
          await page.tap('[data-snc-view-mode="lined"]');
          await page.waitForTimeout(350);
          const download = page.waitForEvent("download", { timeout: 15_000 }).catch(() => null);
          await page.tap('[data-snc-action="save"]');
          const file = await download;
          if (file !== null) {
            const path = join(dir, `${name}-saved.png`);
            await file.saveAs(path);
            const bytes = readFileSync(path);
            entry.saved = { file: basename(path), suggested: file.suggestedFilename(), bytes: bytes.length, size: pngSize(bytes) };
            const viewer = await context.newPage();
            const size = entry.saved.size ?? { width: 720, height: 1280 };
            await viewer.setViewportSize({ width: Math.min(900, size.width), height: Math.min(1600, size.height) });
            await viewer.setContent(`<body style="margin:0;background:#111"><img src="data:image/png;base64,${bytes.toString("base64")}" style="display:block;max-width:100%;max-height:100vh"></body>`);
            await viewer.waitForTimeout(300);
            await viewer.screenshot({ path: join(dir, `${name}-saved-opened.png`) });
            await viewer.close();
          } else entry.notes.push("no download");
          await page.waitForTimeout(300);
          entry.savedState = await page.evaluate(() => document.querySelector("[data-snc-result]")?.getAttribute("data-snc-saved") ?? null);
        }
      } else entry.notes.push(`not complete in ${seconds} s`);

      entry.samples = await page.evaluate(() => window.__chakraSamples);
      entry.vibrations = await page.evaluate(() => window.__vibrations ?? []);
      entry.errors = errors;
      await context.close();
    } catch (error) {
      entry.notes.push(String(error));
    } finally {
      await browser.close();
    }
    report.feeds.push(entry);
    summariseEntry(entry);
  }
} finally {
  writeFileSync(join(dir, "chakra.json"), JSON.stringify(report, null, 2));
  server?.stop?.();
  server?.child?.kill?.();
}

function summariseEntry(entry) {
  const samples = entry.samples ?? [];
  const c = entry.completion ?? null;
  const cost = costOf(c?.readout ?? null);
  const doubleTicks = (entry.vibrations ?? []).filter((v) => JSON.stringify(v.pattern) === "[14,90,14]").length;
  /* The shutter against the lines held: asleep below two, awake at two — every sample while scanning. */
  const scanning = samples.filter((s) => s.phase === "scanning" && s.shutter !== null);
  const shutterWrong = scanning.filter((s) => (s.held >= 2) !== (s.shutter === "ready") || (s.shutter === "ready") === s.shutterDisabled).length;
  /* Progress never walks back on one palm (the hold), and the usable time never falls (no reset). */
  let dips = 0;
  let resets = 0;
  for (let i = 1; i < samples.length; i += 1) {
    if (samples[i].phase !== "scanning" || samples[i - 1].phase !== "scanning") continue;
    if (samples[i].overall + 1e-9 < samples[i - 1].overall) dips += 1;
    if (samples[i].usable !== null && samples[i - 1].usable !== null && samples[i].usable < samples[i - 1].usable) resets += 1;
  }
  /* The hand loss, read off the series: the last sample before the blank, points inside it, the first after it. */
  let loss = null;
  if (entry.loss !== undefined && samples.length > 0) {
    const { blankAt, blankMs } = entry.loss;
    const near = (ms) => samples.reduce((best, s) => (Math.abs(s.t - ms) < Math.abs(best.t - ms) ? s : best));
    const before = [...samples].reverse().find((s) => s.t < blankAt) ?? null;
    const inside = samples.filter((s) => s.t > blankAt + 400 && s.t < blankAt + blankMs - 100);
    const pick = (s) => (s === null ? null : { t: s.t - blankAt, overall: s.overall, held: s.held, usable: s.usable, hand: s.hand, phase: s.phase });
    const drop = (key) => Math.max(0, ...samples.filter((s) => s.t >= blankAt && s.t <= blankAt + blankMs + 3000 && s.phase === "scanning").map((s) => (before?.[key] ?? 0) - (s[key] ?? 0)));
    loss = {
      blankMs,
      handGoneInside: inside.length > 0 && inside.every((s) => s.hand === "" || s.hand === null),
      before: pick(before),
      at1s: pick(near(blankAt + 1000)),
      at19s: blankMs > 1900 ? pick(near(blankAt + 1900)) : null,
      after: pick(near(blankAt + blankMs + 3000)),
      maxDrop: { overall: drop("overall"), held: drop("held"), usable: drop("usable") },
      sealedAfterMs: entry.loss.sealedAt === undefined || entry.loss.sealedAt === null ? null : entry.loss.sealedAt - blankAt,
      palmGoneAtSeal: entry.loss.palmGoneAtSeal ?? null,
    };
    entry.lossSummary = loss;
  }
  const parts = [
    `${entry.feed.padEnd(10)} ${scenario}`,
    `hand@${((entry.handAt ?? 0) / 1000).toFixed(1)}s prompts ${entry.prompts}`,
    entry.ring === undefined ? null : `ring ${Object.entries(entry.ring).map(([k, v]) => `${k}:${(v * 100).toFixed(0)}%`).join(" ")}`,
    entry.shutter === undefined ? null : `shutter woke@${(entry.shutter.wokeAt / 1000).toFixed(1)}s held ${entry.shutter.heldAtWake} best-before ${entry.shutter.bestBefore}`,
    loss === null ? null : `loss ${JSON.stringify(loss)}`,
    entry.completedAt === undefined ? null : `complete@${(entry.completedAt / 1000).toFixed(1)}s`,
    c === null ? null : `reason ${c.reason} pose ${c.pose} best ${c.best} shift ${c.shift} lines-vs-live [${c.deviation}] as-drawn ${c.fromLive} held-vs-live [${c.heldDeviation}] held-then-vs-live [${c.heldThenDeviation}] freeze ${c.freezeMs} ms legend "${c.legend}" title "${c.title}" camera ${c.videoLive ? "LIVE" : "stopped"}`,
    entry.sweep === undefined ? null : `seal grabbed at ${entry.sweep.grabs.map((grab) => `+${grab.sinceFirstSealFrame} ms (ring ${grab.ring ? "drawn" : "MISSING"})`).join(", ")} of its first frame`,
    entry.sealTiming === undefined ? null : `commit → first sealing frame ${entry.sealTiming.commitToFirstSealFrame} ms, longest frame gap ${entry.sealTiming.longestFrameGap} ms`,
    cost === null ? null : `draw p50 ${cost.p50} p95 ${cost.p95} worst ${cost.worst} ms · best p95 ${cost.bestP95} ms`,
    entry.saved === undefined ? null : `saved ${entry.saved.suggested} ${entry.saved.size?.width}x${entry.saved.size?.height} ${(entry.saved.bytes / 1024).toFixed(0)} KB (${entry.savedState})`,
    `double-tick ${doubleTicks}`,
    `shutter-vs-held mismatches ${shutterWrong}/${scanning.length}`,
    `dips ${dips} resets ${resets}`,
    entry.errors?.length ? `ERRORS ${entry.errors.length}: ${entry.errors.slice(0, 2).join(" | ")}` : null,
    entry.notes.length ? `NOTES ${entry.notes.join("; ")}` : null,
  ];
  console.log(parts.filter(Boolean).join("  ·  "));
}

console.log(`\nReport: ${join(dir, "chakra.json")}`);
