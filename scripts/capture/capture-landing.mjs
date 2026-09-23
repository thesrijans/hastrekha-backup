/**
 * The landing page on a phone, measured — M1.1's saved method.
 *
 *   node scripts/capture/capture-landing.mjs [--label name] [--base-url URL] [--viewport 390,412] [--cpu 4] [--settle ms]
 *
 * For each width (a mobile context: touch, a Pixel's UA, DPR 3, a mid-range
 * phone's device signals — the same as capture.mjs --phone) it opens /sanctuary
 * as a returning visitor, waits for the vignette's scene to go live (or gives
 * up after 20 s and says so), and writes captures/ui/<stamp>-<label>/:
 *
 *   landing-<w>-top.png    the first screen
 *   landing-<w>-full.png   the whole page
 *   landing-<w>-end.png    the last screen, scrolled to the foot
 *   report.json            the numbers below, per width
 *
 * and prints, per width: the document height; the bar's box; every element
 * whose text is found in the bar's band at the page's end (content scrolling
 * under the nav — must be none); the top and height of the masthead, the
 * vignette, the greeting, the Begin card, the paths, the wisdom leaf, the
 * colophon and the build stamp; the tier the page settled on and whether the
 * scene went live; whether any drawn SVG hand remains and which hand plates
 * are in the DOM; and, with --cpu, the rAF frame summary under that throttle
 * applied after the page settled (capture.mjs explains why after).
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { chromium } from "playwright";
import { GPU_ARGS, readRenderer, isSoftware } from "./gpu-probe.mjs";
import { PHONE_UA, THRESHOLD_SEEN, THRESHOLD_STORAGE_KEY, startServer, summarise } from "./capture.mjs";

const REPO = resolve(import.meta.dirname, "..", "..");
const argv = process.argv.slice(2);
const flag = (name, fallback) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : fallback);
const label = flag("--label", "landing");
const baseUrl = flag("--base-url", null);
const viewports = flag("--viewport", "390,412").split(",").map(Number);
const cpu = Number(flag("--cpu", "1"));
const settle = Number(flag("--settle", "2500"));
const HEIGHT_FOR = (width) => (width >= 412 ? 915 : 844);
const SCENE = '[data-snc-room="vignette"] [data-snc-room-scene="live"]';
const FRAMES = 240;
const WARMUP = 20;

const PHONE_SIGNALS = () => {
  Object.defineProperty(navigator, "deviceMemory", { configurable: true, get: () => 4 });
  Object.defineProperty(navigator, "hardwareConcurrency", { configurable: true, get: () => 4 });
};

/** The page's own account of itself, in CSS pixels, with the document scrolled to the top. */
function measure() {
  const box = (el) => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { top: Math.round(r.top + scrollY), height: Math.round(r.height), left: Math.round(r.left), width: Math.round(r.width) };
  };
  const q = (s) => document.querySelector(s);
  const bar = [...document.querySelectorAll('nav[aria-label="Sanctuary rooms"]')].find((n) => getComputedStyle(n).position === "fixed" && getComputedStyle(n).display !== "none");
  const docHeight = document.documentElement.scrollHeight;
  const barRect = bar ? bar.getBoundingClientRect() : null;

  /* At the page's end, what lies in the bar's band? Anything with text that is not the bar itself. */
  window.scrollTo(0, docHeight);
  const under = [];
  if (bar && barRect) {
    const xs = [0.15, 0.5, 0.85].map((f) => innerWidth * f);
    const ys = [barRect.top + 2, barRect.top + barRect.height / 2];
    const hits = new Set();
    for (const x of xs) for (const y of ys) for (const el of document.elementsFromPoint(x, y)) hits.add(el);
    for (const el of hits) {
      if (bar.contains(el) || el === document.body || el === document.documentElement || getComputedStyle(el).position === "fixed") continue;
      const text = (el.textContent ?? "").trim();
      if (text && el.children.length === 0) under.push(`${el.tagName.toLowerCase()}: "${text.slice(0, 40)}"`);
    }
  }
  /* The last pixel of CONTENT — a leaf element with text or a picture — against the bar's top at
     the page's end; wrappers, whose boxes include the column's own padding, are not content. */
  let lastBottom = 0;
  for (const el of document.querySelectorAll("main *")) {
    if ((bar && bar.contains(el)) || getComputedStyle(el).position === "fixed" || (el.children.length > 0 && el.tagName !== "PICTURE")) continue;
    if (!(el.textContent ?? "").trim() && el.tagName !== "PICTURE" && el.tagName !== "IMG" && el.tagName !== "SVG") continue;
    const r = el.getBoundingClientRect();
    if (r.height > 0 && r.width > 0) lastBottom = Math.max(lastBottom, r.bottom);
  }
  const barTopAtEnd = barRect ? barRect.top : null;
  window.scrollTo(0, 0);

  const content = q("#snc-home-content");
  const greeting = content ? content.querySelector("section:not([aria-label])") : null;
  const begin = content ? content.querySelector('a[href="/scan/chamber"]') : null;
  const paths = q("#snc-home-paths") ?? (content ? content.querySelector("ul") : null);
  const wisdom = content ? content.querySelector('section[aria-label="Wisdom of the day"]') : null;
  const colophon = content ? content.querySelector("footer") : null;
  const vignette = q('[data-snc-room="vignette"]');
  const stage = vignette ? vignette.querySelector("[data-snc-room-set]") : null;
  const canvas = vignette ? vignette.querySelector("canvas") : null;
  return {
    viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio },
    docHeight,
    bar: barRect ? { top: Math.round(barRect.top), height: Math.round(barRect.height), opaque: getComputedStyle(bar).backgroundColor } : null,
    underBarAtEnd: under,
    lastContentBottomVsBarTopAtEnd: barTopAtEnd === null ? null : Math.round(lastBottom - barTopAtEnd),
    blocks: {
      masthead: box(q("main header")),
      vignette: box(vignette),
      greeting: box(greeting),
      begin: box(begin),
      paths: box(paths),
      wisdom: box(wisdom),
      colophon: box(colophon),
      stamp: box(q("[data-snc-build-stamp]")),
    },
    scene: {
      tier: vignette?.getAttribute("data-snc-tier") ?? null,
      live: vignette ? vignette.querySelector('[data-snc-room-scene="live"]') !== null : false,
      loading: vignette ? vignette.querySelector('[data-snc-room-scene="loading"]') !== null : false,
      canvas: canvas ? { width: canvas.width, height: canvas.height, cssWidth: Math.round(canvas.getBoundingClientRect().width), cssHeight: Math.round(canvas.getBoundingClientRect().height) } : null,
      set: stage ? box(stage) : null,
    },
    hands: {
      /* The hologram's floating element is a <div> now; a <path> in it would be a drawn hand. */
      drawnHand: document.querySelectorAll('div[data-snc-room-object="hologram"] path').length,
      plates: [...document.querySelectorAll("[data-snc-hand-plate]")].map((p) => ({ kind: p.getAttribute("data-snc-hand-plate"), src: p.querySelector("img")?.currentSrc ?? null, box: box(p) })),
    },
    bodyText: getComputedStyle(greeting?.querySelector("p:last-of-type") ?? document.body).fontSize,
    titleText: getComputedStyle(greeting?.querySelector("h2") ?? document.body).fontSize,
  };
}

async function sampleFrames(page) {
  return page.evaluate(
    ([total, skip]) =>
      new Promise((done) => {
        const samples = [];
        let last = performance.now();
        let seen = 0;
        const tick = (now) => {
          samples.push(now - last);
          last = now;
          seen += 1;
          if (seen <= skip) samples.length = 0;
          if (samples.length >= total) done(samples);
          else requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }),
    [FRAMES, WARMUP],
  );
}

async function main() {
  const server = baseUrl ? null : await startServer();
  const base = baseUrl ?? server.base;
  const stamp = new Date().toISOString().replaceAll(":", "-").slice(0, 19);
  const dir = join(REPO, "captures", "ui", `${stamp}-${label}`);
  await mkdir(dir, { recursive: true });
  const browser = await chromium.launch({ headless: true, args: GPU_ARGS });
  const report = { stamp, base, cpu, viewports: {} };
  try {
    const probe = await browser.newPage();
    const gpu = await readRenderer(probe);
    await probe.close();
    if (!gpu.ok || isSoftware(gpu.renderer)) throw new Error(`Refusing to measure on "${gpu.renderer ?? gpu.reason}"`);
    report.gpu = gpu.renderer;
    console.log(`GPU: ${gpu.renderer}`);

    for (const width of viewports) {
      const context = await browser.newContext({
        viewport: { width, height: HEIGHT_FOR(width) },
        deviceScaleFactor: 3,
        isMobile: true,
        hasTouch: true,
        userAgent: PHONE_UA,
        colorScheme: "dark",
      });
      await context.addInitScript(PHONE_SIGNALS);
      await context.addInitScript(([k, v]) => { try { window.localStorage.setItem(k, v); } catch { /* private mode */ } }, [THRESHOLD_STORAGE_KEY, THRESHOLD_SEEN]);
      const bypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
      if (bypass) await context.request.get(`${base}/sanctuary`, { headers: { "x-vercel-protection-bypass": bypass, "x-vercel-set-bypass-cookie": "true" }, maxRedirects: 0 });
      const page = await context.newPage();
      const errors = [];
      page.on("console", (msg) => msg.type() === "error" && errors.push(msg.text()));
      page.on("pageerror", (error) => errors.push(String(error)));
      page.on("response", (r) => r.status() >= 400 && errors.push(`${r.status()} ${r.url()}`));
      await page.goto(`${base}/sanctuary`, { waitUntil: "load", timeout: 60_000 });
      let sceneWaitMs = -1;
      const t0 = Date.now();
      try {
        await page.waitForSelector(SCENE, { timeout: 20_000, state: "attached" });
        sceneWaitMs = Date.now() - t0;
      } catch {
        /* reported as -1: no scene went live */
      }
      await page.waitForTimeout(settle);
      const m = await page.evaluate(measure);
      m.sceneWaitMs = sceneWaitMs;
      m.consoleErrors = errors;

      await page.screenshot({ path: join(dir, `landing-${width}-top.png`) });
      await page.screenshot({ path: join(dir, `landing-${width}-full.png`), fullPage: true });
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      await page.waitForTimeout(400);
      await page.screenshot({ path: join(dir, `landing-${width}-end.png`) });
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.waitForTimeout(300);

      if (cpu > 1) {
        const cdp = await context.newCDPSession(page);
        await cdp.send("Emulation.setCPUThrottlingRate", { rate: cpu });
        await page.waitForTimeout(400);
        const calibration = await page.evaluate(() => {
          const started = performance.now();
          let acc = 0;
          for (let i = 0; i < 8_000_000; i += 1) acc += Math.sqrt(i);
          return acc > 0 ? Math.round(performance.now() - started) : -1;
        });
        m.frames = { cpu, busyLoopMs: calibration, ...summarise(await sampleFrames(page)) };
      }
      report.viewports[width] = m;
      await context.close();

      const b = m.blocks;
      const blk = (name) => (b[name] ? `${name} ${b[name].top}+${b[name].height}` : `${name} ∅`);
      console.log(`\n${width}×${HEIGHT_FOR(width)}  doc ${m.docHeight}px  bar top ${m.bar?.top} h ${m.bar?.height} (${m.bar?.opaque})`);
      console.log(`  under the bar at the end: ${m.underBarAtEnd.length ? m.underBarAtEnd.join(" | ") : "nothing"}; last content bottom − bar top = ${m.lastContentBottomVsBarTopAtEnd}px`);
      console.log(`  ${["masthead", "vignette", "greeting", "begin", "paths", "wisdom", "colophon", "stamp"].map(blk).join("  ")}`);
      console.log(`  scene: tier ${m.scene.tier}, live ${m.scene.live} (${sceneWaitMs} ms), canvas ${m.scene.canvas ? `${m.scene.canvas.width}×${m.scene.canvas.height} px in ${m.scene.canvas.cssWidth}×${m.scene.canvas.cssHeight} css` : "none"}`);
      console.log(`  hands: drawn ${m.hands.drawnHand}, plates ${m.hands.plates.map((p) => `${p.kind}@${p.box?.width}×${p.box?.height}`).join(", ")}; title ${m.titleText}, body ${m.bodyText}`);
      if (m.frames) console.log(`  frames cpu${cpu}x: p50 ${m.frames.p50} p95 ${m.frames.p95} worst ${m.frames.worst} mean ${m.frames.mean} (busy-loop ${m.frames.busyLoopMs} ms)`);
      if (errors.length) console.log(`  console errors: ${errors.join(" | ")}`);
    }
    await writeFile(join(dir, "report.json"), JSON.stringify(report, null, 2));
    console.log(`\nReport: ${join(dir, "report.json")}`);
  } finally {
    await browser.close();
    server?.child.kill();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
