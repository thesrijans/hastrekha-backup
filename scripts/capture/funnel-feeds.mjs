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
 *   node scripts/capture/funnel-feeds.mjs [--build] [--label name] [--seconds 20] [--feeds dir] [--only tight-00,normal] [--shots]
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
/** G2: a screenshot each time the leaf's instruction changes (at most eight a feed), for the visual review. */
const shots = argv.includes("--shots");
/** G4: the phone's viewport (DPR stays 2.625), e.g. 390x664 for the short screen. */
const [viewportWidth, viewportHeight] = arg("--viewport", "412x915").split("x").map(Number);
/** G4 (G4b): run until the result appears ("पहचान पूरी · Scan complete") or `--seconds` runs out, and photograph it. */
const untilComplete = argv.includes("--until-complete");
/** G4: tap the leaf's one-tap action ("रोशनी चालू करें") the first time it appears. */
const tapAction = argv.includes("--tap-action");
/** G4: once complete, switch the opt-in on and off, counting the growth sessions in IndexedDB after each. */
const toggleGrowth = argv.includes("--toggle-growth");

/** In the page: the snap store's records by kind — IndexedDB `hastrekha-snaps`, read directly. */
const SNAP_RECORD_KINDS = () =>
  new Promise((resolve) => {
    const open = indexedDB.open("hastrekha-snaps");
    open.onerror = () => resolve(null);
    open.onsuccess = () => {
      const db = open.result;
      if (!db.objectStoreNames.contains("records")) return resolve({ growth: 0, session: 0 });
      const all = db.transaction("records", "readonly").objectStore("records").getAll();
      all.onsuccess = () => {
        const kinds = { growth: 0, session: 0 };
        for (const record of all.result) kinds[record.kind] = (kinds[record.kind] ?? 0) + 1;
        resolve(kinds);
      };
      all.onerror = () => resolve(null);
    };
  });

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
    /* G2 renamed the funnel's field (palmQuadWidthPx -> palmQuadPx, the short side's extent); older reports keep the old one. */
    palmQuad: stat("palmQuadPx") ?? stat("palmQuadWidthPx"),
  };
}

const text = (record) => Object.entries(record).map(([id, n]) => `${id} ${n}`).join(" ") || "none";

/** scan-complete G2: every navigator.vibrate call, timed — the band's haptic tick is counted, not assumed. */
const VIBRATE_RECORDER = () => {
  const calls = [];
  window.__vibrations = calls;
  Object.defineProperty(navigator, "vibrate", { configurable: true, value: (pattern) => (calls.push({ at: Math.round(performance.now()), pattern }), true) });
};

/**
 * G2 over time, sampled in the page every 200 ms from the tap: the leaf's instruction, the ink gauge's state
 * and dot, and the guide's published alpha/geometry (canvas data-snc-guide) — then folded into transitions.
 */
function summariseG2(samples, vibrations) {
  const hints = [];
  for (const s of samples) if (hints.length === 0 || hints.at(-1).hint !== s.hint) hints.push({ t: s.t, hint: s.hint });
  const states = {};
  for (const s of samples) states[s.distance ?? "none"] = (states[s.distance ?? "none"] ?? 0) + 1;
  const guide = samples.map((s) => (s.guide ? s.guide.split(",") : null)).filter(Boolean);
  const alphas = guide.map((g) => Number(g[0]));
  const firstOk = samples.find((s) => s.distance === "ok");
  const faded = firstOk === undefined ? undefined : samples.find((s) => s.t >= firstOk.t && s.guide && Number(s.guide.split(",")[0]) < 0.02);
  const okEntries = samples.filter((s, i) => s.distance === "ok" && (i === 0 || samples[i - 1].distance !== "ok")).length;
  return {
    hints,
    states,
    guide: guide.length === 0 ? null : { first: guide[0], alphaMin: Math.min(...alphas), alphaMax: Math.max(...alphas), fadeMs: faded === undefined ? null : faded.t - firstOk.t },
    vibrations: vibrations.length,
    vibrationPatterns: [...new Set(vibrations.map((v) => JSON.stringify(v.pattern)))],
    okEntries,
  };
}
/**
 * G3 over time, from the same 200 ms samples: each line's ledger status and ring (data-snc-detect /
 * data-snc-progress, heart head life fate), the overall percentage and the usable time the budget counts.
 * Folded into: when each line was first confirmed, whether any ring ever walked backwards on one palm (a
 * reset — the usable time falling back, a new palm — excepted), when and after how much usable time lines were marked unclear,
 * and the line ticks (navigator.vibrate(14)) against the confirmations.
 */
const G3_IDS = ["heart", "head", "life", "fate"];
function summariseG3(samples, vibrations) {
  const rows = samples.filter((s) => s.g3 !== null && s.g3 !== undefined);
  if (rows.length === 0) return null;
  const confirmedAt = {};
  const unclearAt = {};
  let backwards = 0;
  let resets = 0;
  let confirmations = 0;
  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i];
    const previous = rows[i - 1];
    /* A new palm: the usable time only grows on one palm, so a drop means the evidence was reset under it. */
    const isReset = previous !== undefined && Number(row.g3.usable) < Number(previous.g3.usable);
    if (isReset) resets += 1;
    G3_IDS.forEach((id, k) => {
      const status = row.g3.lines[k][0];
      const value = Number(row.g3.lines[k].slice(1));
      if (status === "c" && confirmedAt[id] === undefined) confirmedAt[id] = row.t;
      if (status === "u" && unclearAt[id] === undefined) unclearAt[id] = { t: row.t, usableMs: Number(row.g3.usable) };
      if (previous !== undefined && !isReset) {
        const before = previous.g3.lines[k];
        if (before[0] === "c" && status !== "c") backwards += 1;
        else if (value + 1e-9 < Number(before.slice(1))) backwards += 1;
        if (before[0] !== "c" && status === "c") confirmations += 1;
      } else if (previous === undefined && status === "c") confirmations += 1;
    });
  }
  const last = rows.at(-1);
  const lineTicks = vibrations.filter((v) => JSON.stringify(v.pattern) === "14").length;
  const completeAt = rows.find((r) => r.g3.complete)?.t ?? null;
  return { confirmedAt, unclearAt, backwards, resets, confirmations, lineTicks, final: last.g3, completeAt };
}

/**
 * G4 from the same samples: when the chamber completed (its phase), whether the double tick fired
 * (navigator.vibrate([14, 90, 14])), when the blur's words and the torch's one-tap action appeared, and the
 * torch after the tap — with the completion leaf as measured at the end.
 */
function summariseG4(samples, vibrations, leaf) {
  const completeAt = samples.find((s) => s.phase === "sealing" || s.phase === "complete")?.t ?? null;
  const blurAt = samples.find((s) => typeof s.hint === "string" && s.hint.includes("तस्वीर धुंधली है"))?.t ?? null;
  const actionAt = samples.find((s) => s.action !== null && s.action !== undefined)?.t ?? null;
  const torchAfter = samples.at(-1)?.torch ?? null;
  const doubleTicks = vibrations.filter((v) => JSON.stringify(v.pattern) === "[14,90,14]").length;
  return { completeAt, blurAt, actionAt, torchAfter, doubleTicks, leaf };
}

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
        viewport: { width: viewportWidth, height: viewportHeight },
        deviceScaleFactor: 2.625,
        isMobile: true,
        hasTouch: true,
        userAgent: ANDROID,
        colorScheme: "dark",
        permissions: ["camera"],
      });
      await context.addInitScript(ANDROID_CAMERA_STUB);
      await context.addInitScript(VIBRATE_RECORDER);
      const page = await context.newPage();
      const errors = [];
      const failedRequests = [];
      page.on("console", (message) => message.type() === "error" && errors.push(message.text()));
      page.on("pageerror", (error) => errors.push(String(error)));
      page.on("response", (response) => response.status() >= 400 && failedRequests.push(`${response.status()} ${new URL(response.url()).pathname}`));
      await page.goto(`${server.base}/scan/chamber?cost=1`, { waitUntil: "load", timeout: 60_000 });
      await page.waitForTimeout(600);
      await page.tap("button:has-text('Kaksh mein pravesh')");
      await page.evaluate(() => {
        const samples = [];
        window.__g2samples = samples;
        const t0 = performance.now();
        setInterval(() => {
          const hint = document.querySelector("[data-snc-hint]");
          const gauge = document.querySelector("[data-snc-gauge]");
          samples.push({
            t: Math.round(performance.now() - t0),
            hint: hint?.textContent?.trim() ?? null,
            distance: gauge?.getAttribute("data-snc-distance") ?? null,
            dot: gauge?.querySelector("circle")?.getAttribute("cx") ?? null,
            guide: document.querySelector("canvas")?.dataset.sncGuide ?? null,
            /* G4: the phase, the one-tap action, the torch. */
            phase: document.querySelector("[data-snc-phase]")?.getAttribute("data-snc-phase") ?? null,
            action: document.querySelector("[data-snc-hint-action]")?.textContent?.trim() ?? null,
            torch: document.querySelector('[data-snc-control="torch"]')?.getAttribute("aria-pressed") ?? null,
            /* G3: the ledger's rings, status initial + progress per line, and its summary. */
            g3: (() => {
              const entries = [...document.querySelectorAll("[data-snc-detect]")];
              const summary = document.querySelector("[data-snc-overall]");
              if (entries.length === 0 || summary === null) return null;
              return {
                lines: entries.map((e) => `${e.getAttribute("data-snc-detect")[0]}${e.getAttribute("data-snc-progress")}`),
                overall: summary.getAttribute("data-snc-overall"),
                usable: summary.getAttribute("data-snc-usable"),
                complete: summary.hasAttribute("data-snc-complete"),
              };
            })(),
          });
        }, 200);
      });
      const handSeen = await page
        .waitForFunction(() => document.querySelector("canvas")?.dataset.sncHand, null, { timeout: 45_000 })
        .then(() => true)
        .catch(() => false);
      if (shots) {
        /* Poll the instruction from here and photograph each new one — the moments G2 is about. */
        const until = Date.now() + seconds * 1000;
        let last = "";
        let taken = 0;
        while (Date.now() < until) {
          const hint = await page.evaluate(() => document.querySelector("[data-snc-hint]")?.textContent?.trim() ?? "");
          if (hint !== "" && hint !== last && taken < 8) {
            last = hint;
            taken += 1;
            await page.screenshot({ path: join(dir, `${basename(feed, ".y4m")}-shot-${taken}.png`) });
          }
          await page.waitForTimeout(250);
        }
      } else if (untilComplete || tapAction) {
        /* G4: poll for the completion leaf (and the one-tap action, tapped once), up to `--seconds`. */
        const until = Date.now() + seconds * 1000;
        let tapped = false;
        while (Date.now() < until) {
          if (tapAction && !tapped && (await page.locator("[data-snc-hint-action]").count()) > 0) {
            tapped = true;
            await page.screenshot({ path: join(dir, `${basename(feed, ".y4m")}-action-before.png`) });
            await page.tap("[data-snc-hint-action]").catch(() => undefined);
            await page.screenshot({ path: join(dir, `${basename(feed, ".y4m")}-action.png`) });
          }
          if (untilComplete && (await page.locator('[data-snc-result="result"]').count()) > 0) {
            /* Let the photograph ease to the hand's framing and the leaf come in, then photograph it. */
            await page.waitForTimeout(1300);
            await page.screenshot({ path: join(dir, `${basename(feed, ".y4m")}-complete.png`) });
            break;
          }
          await page.waitForTimeout(250);
        }
      } else {
        await page.waitForTimeout(seconds * 1000);
      }
      /* G4 (G4b): the result, as it stands — or null when the scan did not complete in time. */
      const g4leaf = await page.evaluate(() => {
        const result = document.querySelector('[data-snc-result="result"]');
        if (result === null) return null;
        const root = document.querySelector("[data-snc-phase]");
        const leaf = document.querySelector("[data-snc-legend]")?.parentElement?.getBoundingClientRect() ?? null;
        const growth = document.querySelector("[data-snc-growth]");
        const buttons = [...document.querySelectorAll("[data-snc-action]")].map((b) => ({ action: b.getAttribute("data-snc-action"), text: b.textContent.trim(), bottom: Math.round(b.getBoundingClientRect().bottom) }));
        return {
          title: result.querySelector("p")?.textContent?.trim() ?? null,
          reason: root?.getAttribute("data-snc-completion-reason") ?? null,
          best: root?.getAttribute("data-snc-best") ?? null,
          shift: root?.getAttribute("data-snc-freeze-shift") ?? null,
          legend: document.querySelector("[data-snc-legend]")?.textContent?.trim() ?? null,
          growth: growth === null ? "absent" : growth.checked ? "on" : "off",
          buttons,
          leafTop: leaf === null ? null : Math.round(leaf.top),
          leafBottom: leaf === null ? null : Math.round(leaf.bottom),
          viewport: { width: window.innerWidth, height: window.innerHeight },
          videoLive: [...document.querySelectorAll("video")].some((v) => v.srcObject !== null && v.srcObject.getVideoTracks().some((t) => t.readyState === "live")),
        };
      });
      const snapshot = await page.evaluate(() => (typeof window.__hrFunnel === "function" ? window.__hrFunnel() : null));
      const g2raw = await page.evaluate(() => ({ samples: window.__g2samples ?? [], vibrations: window.__vibrations ?? [] }));
      const readout = await page.evaluate(() => document.querySelector("[data-snc-budget]")?.textContent ?? null);
      const litany = await page.evaluate(() => [...document.querySelectorAll('[data-snc-litany="in"] p')].map((p) => p.textContent.trim()));
      const name = basename(feed, ".y4m");
      await page.screenshot({ path: join(dir, `${name}.png`) });
      /* G4.3 in a real browser: the pair kept for the session, the opt-in saving and then deleting its session. */
      let growthCheck = null;
      if (toggleGrowth && g4leaf !== null) {
        const before = await page.evaluate(SNAP_RECORD_KINDS);
        await page.click("[data-snc-growth]");
        await page.waitForFunction(() => document.querySelector("[data-snc-growth]")?.checked === true && !document.querySelector("[data-snc-growth]")?.disabled, null, { timeout: 10_000 }).catch(() => undefined);
        await page.waitForTimeout(500);
        const on = await page.evaluate(SNAP_RECORD_KINDS);
        await page.screenshot({ path: join(dir, `${basename(feed, ".y4m")}-growth-on.png`) });
        await page.click("[data-snc-growth]");
        await page.waitForFunction(() => document.querySelector("[data-snc-growth]")?.checked === false && !document.querySelector("[data-snc-growth]")?.disabled, null, { timeout: 10_000 }).catch(() => undefined);
        await page.waitForTimeout(500);
        const off = await page.evaluate(SNAP_RECORD_KINDS);
        growthCheck = { before, on, off };
      }
      const g4 = { ...summariseG4(g2raw.samples, g2raw.vibrations, g4leaf), growthCheck };
      const entry = { feed: name, expected: expected.get(feed) ?? null, handSeen, errors, failedRequests, litany, readout, funnel: summarise(snapshot), g2: summariseG2(g2raw.samples, g2raw.vibrations), g3: summariseG3(g2raw.samples, g2raw.vibrations), g4, g2samples: g2raw.samples };
      report.feeds.push(entry);
      const f = entry.funnel;
      const g = entry.g2;
      console.log(
        `${name.padEnd(10)} G2  hints [${g.hints.map((h) => `${(h.t / 1000).toFixed(1)}s ${h.hint}`).join(" | ")}]  states ${JSON.stringify(g.states)}  ` +
          `guide ${g.guide === null ? "none" : `α ${g.guide.alphaMin.toFixed(3)}–${g.guide.alphaMax.toFixed(3)} at ${g.guide.first.slice(1).join(",")} fade ${g.guide.fadeMs ?? "–"} ms`}  ` +
          `vibrate ${g.vibrations}× ${g.vibrationPatterns.join(",")} for ${g.okEntries} band entr${g.okEntries === 1 ? "y" : "ies"}`,
      );
      console.log(
        `${name.padEnd(10)} G4  ${g4.completeAt === null ? "not complete" : `complete@${(g4.completeAt / 1000).toFixed(1)}s`}` +
          (g4.leaf === null
            ? ""
            : `  ${g4.leaf.reason} best ${g4.leaf.best} shift ${g4.leaf.shift}  legend "${g4.leaf.legend}"  opt-in ${g4.leaf.growth}  buttons [${g4.leaf.buttons.map((b) => b.text).join(" | ")}]  leaf ${g4.leaf.leafTop}–${g4.leaf.leafBottom} of ${g4.leaf.viewport.height}  camera ${g4.leaf.videoLive ? "LIVE" : "stopped"}  title "${g4.leaf.title}"`) +
          `  double-tick ${g4.doubleTicks}  blur ${g4.blurAt === null ? "never" : `@${(g4.blurAt / 1000).toFixed(1)}s`}  action ${g4.actionAt === null ? "never" : `@${(g4.actionAt / 1000).toFixed(1)}s`}  torch ${g4.torchAfter ?? "–"}` +
          (g4.growthCheck === null ? "" : `  snap store before ${JSON.stringify(g4.growthCheck.before)} opt-in on ${JSON.stringify(g4.growthCheck.on)} off ${JSON.stringify(g4.growthCheck.off)}`),
      );
      const g3 = entry.g3;
      console.log(
        g3 === null
          ? `${name.padEnd(10)} G3  no ledger`
          : `${name.padEnd(10)} G3  confirmed [${G3_IDS.map((id) => `${id} ${g3.confirmedAt[id] === undefined ? "–" : `${(g3.confirmedAt[id] / 1000).toFixed(1)}s`}`).join(" ")}]  ` +
              `unclear [${Object.entries(g3.unclearAt).map(([id, u]) => `${id} ${(u.t / 1000).toFixed(1)}s @${(u.usableMs / 1000).toFixed(1)}s usable`).join(" ") || "none"}]  ` +
              `final ${g3.final.lines.join(" ")} overall ${(Number(g3.final.overall) * 100).toFixed(0)}% usable ${(Number(g3.final.usable) / 1000).toFixed(1)}s${g3.completeAt === null ? "" : ` complete@${(g3.completeAt / 1000).toFixed(1)}s`}  ` +
              `backwards ${g3.backwards} resets ${g3.resets}  ticks ${g3.lineTicks} for ${g3.confirmations} confirmation${g3.confirmations === 1 ? "" : "s"}`,
      );
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
