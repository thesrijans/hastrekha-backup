/**
 * M1 — the phone chamber, captured and measured on a synthetic camera feed.
 *
 * Real-GPU Chromium (gpu-probe's ANGLE/D3D11 flags) with Chromium's fake capture device playing a
 * portrait palm feed (scripts/capture/make-phone-feed.py → captures/ui/feeds/palm-portrait.y4m). The
 * pipeline is the real one — MediaPipe, rectification, extraction, the Monitor — running on those
 * frames. What a desktop cannot give, an init script EMULATES, and only that: an Android phone's user
 * agent and client hints, a second camera, the facing each open reports, and a torch on the back camera.
 * The frames are always the feed's; the real-device check is the owner's.
 *
 * Scenarios (each at its own viewport, DPR and user agent):
 *   phone-390 / phone-412   the layout checklist, M1.3 — back camera, lite profile (tier forced to MID)
 *                           — then the torch (M1.2) and the flip to the front camera (M1.1), and the
 *                           Monitor's sheet opened
 *   short-390               390×664, a phone with its browser bars showing — the layout checklist again
 *   high-390                tier left alone (this machine is HIGH) — the full profile's ?cost=1 line
 *   denied-android / -ios   camera refused — the M1.5 leaf in Chrome's and Safari's words
 *
 *   node scripts/capture/capture-chamber-phone.mjs [--build] [--label name] [--only a,b] [--settle ms] [--cpu 4] [--no-cost] [--base-url URL]
 *
 * Writes captures/ui/<stamp>-<label>/ (git-ignored): PNGs, report.json, and a scored checklist.
 */
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { chromium } from "playwright";
import { buildProduction, startServer } from "./capture.mjs";
import { GPU_ARGS, readRenderer, isSoftware } from "./gpu-probe.mjs";

const REPO = resolve(import.meta.dirname, "..", "..");
const FEED = join(REPO, "captures", "ui", "feeds", "palm-portrait.y4m");
const argv = process.argv.slice(2);
const label = argv.includes("--label") ? argv[argv.indexOf("--label") + 1] : "m1-phone";
const only = argv.includes("--only") ? argv[argv.indexOf("--only") + 1].split(",") : null;
/** How long to let the scan run before measuring; long enough, with --settle 30000, for extractions to land. */
const settle = argv.includes("--settle") ? Number(argv[argv.indexOf("--settle") + 1]) : 7000;
/** CPU slowdown (CDP) for a phone-like reading of the CPU stages; the GPU is this machine's either way. */
const cpu = argv.includes("--cpu") ? Number(argv[argv.indexOf("--cpu") + 1]) : 1;
/** M0: without `?cost=1` the chamber shows its build stamp instead of the readout; `--no-cost` measures that path. */
const withCost = !argv.includes("--no-cost");
/** A server this run does not own — a deployment — instead of a local build. The camera stub is an init script, so it works on any origin. */
const baseUrl = argv.includes("--base-url") ? argv[argv.indexOf("--base-url") + 1] : null;

const ANDROID = "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36";
const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";

/** The phone the desktop cannot be: facing per open, a second camera, a torch on the back one, client hints. */
const PHONE_CAMERA_STUB = () => {
  const media = navigator.mediaDevices;
  const realOpen = media.getUserMedia.bind(media);
  const realList = media.enumerateDevices.bind(media);
  const facingOf = (constraints) => {
    const video = constraints?.video;
    const facing = video && typeof video === "object" ? video.facingMode : undefined;
    if (facing === undefined) return null;
    return typeof facing === "string" ? facing : (facing.exact ?? facing.ideal ?? null);
  };
  window.__camera = { opens: [], torch: [] };
  media.getUserMedia = async (constraints) => {
    if (window.__refuseCamera) throw new DOMException("Permission denied", "NotAllowedError");
    const facing = facingOf(constraints) ?? "user";
    const video = typeof constraints.video === "object" ? { ...constraints.video } : constraints.video;
    if (video && typeof video === "object") {
      delete video.facingMode;
      delete video.deviceId;
      /* A phone held upright delivers PORTRAIT frames for a landscape request (the sensor's modes are
         landscape; the browser rotates). Chromium's fake device does not rotate, so the request is. */
      if (window.innerHeight > window.innerWidth && video.width && video.height) {
        [video.width, video.height] = [video.height, video.width];
      }
    }
    const stream = await realOpen({ ...constraints, video });
    for (const track of stream.getVideoTracks()) {
      const settings = track.getSettings.bind(track);
      track.getSettings = () => ({ ...settings(), facingMode: facing });
      const capabilities = track.getCapabilities ? track.getCapabilities.bind(track) : () => ({});
      track.getCapabilities = () => ({ ...capabilities(), torch: facing === "environment" });
      const apply = track.applyConstraints.bind(track);
      track.applyConstraints = async (next) => {
        const advanced = next?.advanced?.[0];
        if (advanced && "torch" in advanced) {
          window.__camera.torch.push(advanced.torch);
          const rest = { ...advanced };
          delete rest.torch;
          if (Object.keys(rest).length === 0) return;
          return apply({ advanced: [rest] });
        }
        return apply(next);
      };
    }
    window.__camera.opens.push({ facing, width: stream.getVideoTracks()[0]?.getSettings().width, height: stream.getVideoTracks()[0]?.getSettings().height });
    return stream;
  };
  media.enumerateDevices = async () => {
    const list = await realList();
    if (list.filter((d) => d.kind === "videoinput").length >= 2) return list;
    return [...list, { kind: "videoinput", deviceId: "emulated-front", groupId: "", label: "camera2 1, facing front", toJSON() { return this; } }];
  };
  Object.defineProperty(navigator, "userAgentData", { configurable: true, get: () => ({ mobile: true, platform: "Android", brands: [] }) });
};

/** Force the capability tier's device signals to a mid-range phone's, so the lite profile runs. */
const MID_TIER_STUB = () => {
  Object.defineProperty(navigator, "deviceMemory", { configurable: true, get: () => 4 });
  Object.defineProperty(navigator, "hardwareConcurrency", { configurable: true, get: () => 4 });
};

const SCENARIOS = [
  { id: "phone-390", width: 390, height: 844, dpr: 3, ua: ANDROID, tier: "MID", steps: ["torch", "flip", "sheet"] },
  { id: "phone-412", width: 412, height: 915, dpr: 2.625, ua: ANDROID, tier: "MID", steps: [] },
  { id: "short-390", width: 390, height: 664, dpr: 3, ua: ANDROID, tier: "MID", steps: [] },
  { id: "high-390", width: 390, height: 844, dpr: 3, ua: ANDROID, tier: null, steps: [] },
  /* Refused exactly as a phone refuses: getUserMedia rejects with a NotAllowedError. */
  { id: "denied-android", width: 390, height: 844, dpr: 3, ua: ANDROID, denied: true },
  { id: "denied-ios", width: 390, height: 844, dpr: 3, ua: IPHONE, denied: true },
].filter((s) => only === null || only.includes(s.id));

/* ------------------------------- measurement ------------------------------- */

/**
 * The leaf at its TALLEST: the longest stage line, the "found nothing" note under it and the longest
 * gate hint. Measured on a CLONE of the litany's dock appended beside it — same parent, so the same
 * custom properties and the same fixed position — never by rewriting the leaf React owns (which
 * crashes React's next reconcile). The clone stays for the screenshot and is removed after.
 * Its top must stay below the ring: the band's bottom reserve (scan-ring.ts) is sized for this leaf.
 */
async function tallestLeafTop(page) {
  return page.evaluate(() => {
    const dock = document.querySelector('[data-snc-litany="in"]');
    if (!dock) return null;
    const twin = dock.cloneNode(true);
    twin.setAttribute("data-snc-twin", "");
    twin.style.zIndex = "7";
    const leaf = twin.firstElementChild;
    const paragraphs = [...leaf.querySelectorAll("p")];
    const stage = paragraphs[0];
    const line = (text) => {
      const node = stage.cloneNode(false);
      node.textContent = text;
      return node;
    };
    stage.textContent = "पारंपरिक पाठ से मिलान…";
    for (const extra of paragraphs.slice(1)) extra.remove();
    stage.after(line("इस बार नहीं मिला"), line("Bahut tez roshni — thoda hatt jao"));
    dock.parentElement.appendChild(twin);
    return leaf.getBoundingClientRect().top;
  });
}

async function removeTwin(page) {
  await page.evaluate(() => document.querySelector("[data-snc-twin]")?.remove());
}

async function measure(page) {
  return page.evaluate(() => {
    const box = (el) => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
    };
    const video = document.querySelector("video");
    const canvas = document.querySelector("canvas");
    const [cx, cy, r] = (canvas?.dataset.sncRing ?? "0,0,0").split(",").map(Number);
    const monitor = document.querySelector('section[aria-label^="Rekha monitor"]');
    const monitorBox = box(monitor);
    const H = window.innerHeight;
    return {
      viewport: { width: window.innerWidth, height: H },
      video: box(video),
      videoTransform: video ? getComputedStyle(video).transform : null,
      ring: { cx, cy, r },
      hand: canvas?.dataset.sncHand ? Number(canvas.dataset.sncHand) : null,
      back: box(document.querySelector('a[aria-label="Wapas"]')),
      flip: box(document.querySelector('[data-snc-control="flip"]')),
      torch: box(document.querySelector('[data-snc-control="torch"]')),
      torchPressed: document.querySelector('[data-snc-control="torch"]')?.getAttribute("aria-pressed") ?? null,
      /* M0: the build stamp on the back mark's row (absent under ?cost=1, when the readout carries the SHA). */
      stamp: box(document.querySelector("[data-snc-build-stamp]")),
      stampText: document.querySelector("[data-snc-build-stamp]")?.textContent ?? null,
      leaf: box(document.querySelector('[data-snc-litany="in"] > *')),
      /* Only the part of the sheet that is on screen is "the Monitor" for overlap purposes. */
      monitor: monitorBox === null ? null : { ...monitorBox, top: Math.max(monitorBox.top, 0), bottom: Math.min(monitorBox.bottom, H), height: Math.min(monitorBox.bottom, H) - Math.max(monitorBox.top, 0) },
      monitorOpen: monitor?.getAttribute("data-snc-sheet") === "open",
      /* What a tap at the leaf's centre and at each mark would land on — the open sheet, or the thing under it. */
      hitsSheet: (() => {
        const leaf = document.querySelector('[data-snc-litany="in"] > *') ?? document.querySelector("[data-snc-litany] > *");
        const points = [leaf, document.querySelector('[data-snc-control="flip"]'), document.querySelector('[data-snc-control="torch"]')]
          .filter(Boolean)
          .map((el) => {
            const r = el.getBoundingClientRect();
            return [r.left + r.width / 2, r.top + r.height / 2];
          });
        return points.map(([x, y]) => monitor?.contains(document.elementFromPoint(x, y)) ?? false);
      })(),
      cost: document.querySelector("[data-snc-budget]")?.textContent ?? null,
      camera: window.__camera ?? null,
    };
  });
}

const intersects = (a, b) => a && b && a.left < b.right - 0.5 && b.left < a.right - 0.5 && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5;

/** The M1.3 checklist, each item PASS/FAIL with the number that decided it. */
function score(m, sheetOpen = null) {
  const W = m.viewport.width;
  const H = m.viewport.height;
  const rows = [];
  const add = (item, pass, measured) => rows.push({ item, verdict: pass ? "PASS" : "FAIL", measured });

  const v = m.video;
  add("feed full-bleed", v && Math.abs(v.left) < 1 && Math.abs(v.top) < 1 && Math.abs(v.width - W) < 1 && Math.abs(v.height - H) < 1, v ? `${v.left},${v.top} ${v.width}×${v.height} in ${W}×${H}` : "no video");

  /* The ring's contract (scan-ring.ts): the hand's extent, clamped to [0.45, 1] of the free band's cap. */
  const ring = m.ring;
  const band = Math.min(Math.min(W, H) * 0.42, W <= 899 && H > W ? (H - 268 - 64) / 2 : Infinity);
  const expected = m.hand === null ? null : Math.min(band, Math.max(band * 0.45, m.hand));
  add(
    "ring sized to the hand",
    expected !== null && Math.abs(ring.r - expected) <= 6,
    expected === null ? "no hand seen" : `ring r ${ring.r} vs hand extent ${m.hand}${m.hand > band ? ` (clamped to the band's ${band.toFixed(0)})` : ""}`,
  );

  const leaf = m.leaf;
  const handleTop = m.monitor ? m.monitor.top : H;
  const leafCentre = leaf ? (leaf.top + leaf.bottom) / 2 : null;
  add("litany at thumb height", leaf && leafCentre >= 0.6 * H && leafCentre <= 0.92 * H && leaf.bottom <= handleTop + 0.5, leaf ? `leaf centre ${(leafCentre / H).toFixed(2)}·H, bottom ${leaf.bottom.toFixed(0)} ≤ handle ${handleTop.toFixed(0)}` : "no leaf");

  const mon = m.monitor;
  add("Monitor as pull-up sheet (collapsed)", mon && mon.height >= 40 && mon.height <= 60 && Math.abs(mon.bottom - H) < 1, mon ? `${mon.height.toFixed(0)}px visible at the bottom edge` : "no monitor");
  if (sheetOpen !== null) {
    const open = sheetOpen.monitor;
    add(
      "Monitor sheet opens on its handle, wholly on screen",
      sheetOpen.monitorOpen && open && open.top >= 0 && Math.abs(open.bottom - H) < 1 && open.height >= 3 * 48,
      open ? `open: ${open.top.toFixed(0)}–${open.bottom.toFixed(0)} (${open.height.toFixed(0)}px)` : "no monitor",
    );
    add(
      "open sheet unobstructed (leaf and marks under it)",
      sheetOpen.hitsSheet.length > 0 && sheetOpen.hitsSheet.every(Boolean),
      `taps at leaf/marks land on the sheet: ${JSON.stringify(sheetOpen.hitsSheet)}`,
    );
  }

  const reach = (b) => b && (b.top + b.bottom) / 2 >= 0.6 * H && b.left >= 8 && b.right <= W - 8 && b.width >= 44 && b.height >= 44;
  add("flip + torch reachable one-handed", reach(m.flip) && reach(m.torch), `flip ${m.flip ? `${((m.flip.top + m.flip.bottom) / 2 / H).toFixed(2)}·H ${m.flip.width}px` : "absent"}, torch ${m.torch ? `${((m.torch.top + m.torch.bottom) / 2 / H).toFixed(2)}·H ${m.torch.width}px` : "absent"}`);

  const ringBox = { left: ring.cx - ring.r, right: ring.cx + ring.r, top: ring.cy - ring.r, bottom: ring.cy + ring.r };
  const ui = { back: m.back, flip: m.flip, torch: m.torch, leaf: m.leaf, monitor: m.monitor, stamp: m.stamp };
  const hits = [];
  for (const [name, rect] of Object.entries(ui)) if (intersects(rect, ringBox)) hits.push(`${name}×ring`);
  const names = Object.keys(ui);
  for (let i = 0; i < names.length; i += 1) for (let j = i + 1; j < names.length; j += 1) if (intersects(ui[names[i]], ui[names[j]])) hits.push(`${names[i]}×${names[j]}`);
  add("nothing overlapping the feed (ring clear, no UI on UI)", hits.length === 0, hits.length === 0 ? `ring ${ring.cy - ring.r | 0}–${ring.cy + ring.r | 0} clear of ${Object.keys(ui).filter((k) => ui[k]).join(", ")}` : hits.join(", "));
  return rows;
}

/* --------------------------------- driver --------------------------------- */

if (!existsSync(FEED)) throw new Error(`No feed at ${FEED} — run scripts/capture/make-phone-feed.py first.`);
if (argv.includes("--build") && baseUrl === null) await buildProduction();
const server = baseUrl === null ? await startServer() : null;
const base = baseUrl ?? server.base;
const stamp = new Date().toISOString().replaceAll(":", "-").slice(0, 19);
const dir = join(REPO, "captures", "ui", `${stamp}-${label}`);
mkdirSync(dir, { recursive: true });
const report = { feed: FEED, scenarios: {} };

/*
 * WebGPU OFF, for the segmenter's sake. The ONNX worker asks for the WebGPU execution provider first
 * whenever `navigator.gpu` exists, and in headless Chromium that session never resolves: the worker
 * never becomes ready, every crop goes unanswered (telemetry: "STALL AT workerReplies", on /scan as on
 * the chamber, before M1 as after), and no line is ever extracted. Without WebGPU the worker takes its
 * wasm provider and the whole chain runs. A real device picks its own provider; this is the capture's.
 */
const live = await chromium.launch({
  headless: true,
  args: [
    ...GPU_ARGS,
    "--disable-features=WebGPU,WebGPUService,Vulkan",
    "--use-fake-device-for-media-stream",
    "--use-fake-ui-for-media-stream",
    `--use-file-for-fake-video-capture=${FEED}`,
  ],
});

try {
  const probe = await live.newPage();
  const gpu = await readRenderer(probe);
  await probe.close();
  if (!gpu.ok || isSoftware(gpu.renderer)) throw new Error(`Refusing to capture on a software renderer: ${gpu.renderer ?? gpu.reason}`);
  report.gpu = gpu.renderer;
  console.log(`GPU: ${gpu.renderer}`);

  for (const s of SCENARIOS) {
    const context = await live.newContext({
      viewport: { width: s.width, height: s.height },
      deviceScaleFactor: s.dpr,
      isMobile: true,
      hasTouch: true,
      userAgent: s.ua,
      colorScheme: "dark",
      permissions: ["camera"],
    });
    await context.addInitScript(PHONE_CAMERA_STUB);
    if (s.denied) await context.addInitScript(() => (window.__refuseCamera = true));
    if (s.tier === "MID") await context.addInitScript(MID_TIER_STUB);
    const page = await context.newPage();
    if (cpu > 1) await (await context.newCDPSession(page)).send("Emulation.setCPUThrottlingRate", { rate: cpu });
    const errors = [];
    page.on("console", (msg) => msg.type() === "error" && errors.push(msg.text()));
    page.on("pageerror", (error) => errors.push(String(error)));
    await page.goto(`${base}/scan/chamber${withCost ? "?cost=1" : ""}`, { waitUntil: "load", timeout: 60_000 });
    await page.waitForTimeout(600);
    await page.tap("button:has-text('Kaksh mein pravesh')");
    const entry = { viewport: `${s.width}×${s.height}@${s.dpr}`, ua: s.ua.includes("iPhone") ? "iOS Safari" : "Android Chrome", tier: s.tier ?? "unforced", cpu, errors };

    if (s.denied) {
      await page.waitForSelector("ol", { timeout: 15_000 }).catch(() => {});
      await page.waitForTimeout(800);
      entry.leaf = await page.evaluate(() => [...document.querySelectorAll("p, li, button")].map((n) => n.textContent.trim()).filter(Boolean));
      await page.screenshot({ path: join(dir, `${s.id}.png`) });
      report.scenarios[s.id] = entry;
      console.log(`\n${s.id}: ${entry.leaf.join(" | ")}`);
      await context.close();
      continue;
    }

    /* Scanning: wait for a hand, then let the ring ease in and a few extractions land. */
    await page.waitForFunction(() => document.querySelector("canvas")?.dataset.sncHand, null, { timeout: 45_000 }).catch(() => {});
    await page.waitForTimeout(settle);
    const scanning = await measure(page);
    await page.screenshot({ path: join(dir, `${s.id}-back.png`) });
    entry.back = scanning;
    const tallest = await tallestLeafTop(page);
    await page.screenshot({ path: join(dir, `${s.id}-tallest-leaf.png`) });
    await removeTwin(page);

    let sheet = null;
    if (s.steps.includes("torch")) {
      await page.tap('[data-snc-control="torch"]').catch(() => {});
      await page.waitForTimeout(600);
      entry.torch = await measure(page);
      await page.screenshot({ path: join(dir, `${s.id}-torch.png`) });
    }
    if (s.steps.includes("flip")) {
      await page.tap('[data-snc-control="flip"]').catch(() => {});
      await page.waitForFunction(() => document.querySelector("canvas")?.dataset.sncHand, null, { timeout: 30_000 }).catch(() => {});
      await page.waitForTimeout(5000);
      entry.front = await measure(page);
      await page.screenshot({ path: join(dir, `${s.id}-front.png`) });
    }
    if (s.steps.includes("sheet")) {
      await page.tap('section[aria-label^="Rekha monitor"] button').catch(() => {});
      await page.waitForTimeout(900);
      sheet = await measure(page);
      await page.screenshot({ path: join(dir, `${s.id}-sheet.png`) });
    }
    /* M0: the build stamp lives where the readout is not. The default run loads `?cost=1`, under which the
       stamp is unmounted by design, so it is scored on one more plain load — a null stamp FAILS a row
       rather than passing the overlap rows vacuously. (--no-cost runs the whole pipeline on that path.) */
    await page.goto(`${base}/scan/chamber`, { waitUntil: "load", timeout: 60_000 });
    await page.waitForTimeout(600);
    entry.stampOnPlainLoad = await page.evaluate(() => {
      const box = (el) => {
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
      };
      const stamp = document.querySelector("[data-snc-build-stamp]");
      return { stamp: box(stamp), text: stamp?.textContent ?? null, back: box(document.querySelector('a[aria-label="Wapas"]')) };
    });
    entry.checklist = score(scanning, sheet);
    {
      const { stamp, text, back } = entry.stampOnPlainLoad;
      entry.checklist.push({
        item: "build stamp shown without ?cost=1",
        verdict: stamp !== null && /^build ([0-9a-f]{7}|unknown)/.test(text ?? "") ? "PASS" : "FAIL",
        measured: stamp === null ? "no [data-snc-build-stamp]" : `"${text}"`,
      });
      const clear = stamp !== null && back !== null && stamp.left >= back.right && stamp.bottom <= 64;
      entry.checklist.push({
        item: "stamp on the back mark's row, clear of the mark and the ring band",
        verdict: clear ? "PASS" : "FAIL",
        measured: stamp === null ? "no stamp" : `stamp x ${stamp.left.toFixed(0)}–${stamp.right.toFixed(0)} y ${stamp.top.toFixed(0)}–${stamp.bottom.toFixed(0)}; back mark right ${back?.right.toFixed(0)}; band top 64`,
      });
    }
    {
      const ringBottom = scanning.ring.cy + scanning.ring.r;
      entry.checklist.push({
        item: "leaf at its tallest stays clear of the ring",
        verdict: tallest !== null && tallest >= ringBottom ? "PASS" : "FAIL",
        measured: tallest === null ? "no leaf" : `tallest leaf top ${tallest.toFixed(0)} vs ring bottom ${ringBottom.toFixed(0)}`,
      });
    }
    report.scenarios[s.id] = entry;

    console.log(`\n${s.id} (${entry.viewport}, tier ${entry.tier})`);
    for (const row of entry.checklist) console.log(`  ${row.verdict}  ${row.item} — ${row.measured}`);
    console.log(withCost ? `  ?cost=1  ${scanning.cost}` : `  stamp (pipeline)  ${JSON.stringify(scanning.stamp)} "${scanning.stampText}"`);
    console.log(`  video transform (back): ${scanning.videoTransform}; opens: ${JSON.stringify(scanning.camera?.opens)}`);
    if (entry.torch) console.log(`  torch: aria-pressed ${entry.torch.torchPressed}; constraint sent: ${JSON.stringify(entry.torch.camera?.torch)}`);
    if (entry.front) console.log(`  after flip: video transform ${entry.front.videoTransform}; ?cost=1 ${entry.front.cost}; opens ${JSON.stringify(entry.front.camera?.opens)}`);
    if (errors.length) console.log(`  console errors: ${errors.slice(0, 4).join(" || ")}`);
    await context.close();
  }
} finally {
  writeFileSync(join(dir, "report.json"), JSON.stringify(report, null, 2));
  await live.close();
  server?.stop?.();
  server?.child?.kill?.();
  console.log(`\nReport: ${join(dir, "report.json")}`);
}
