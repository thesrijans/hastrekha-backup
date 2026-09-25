/**
 * The REAL-PHONE RIG (docs/specs/scan-rescue.txt §3.1): the chamber on Srijan's own phone, over USB,
 * measured by the STAGE FUNNEL (lib/scan/funnel.ts) and captured.
 *
 *   node scripts/phone-rig/rig.mjs check
 *   node scripts/phone-rig/rig.mjs run --url https://hastrekha-nine.vercel.app/scan/chamber --camera back,front --label live
 *   node scripts/phone-rig/rig.mjs run --url http://localhost:3210/scan/chamber --reverse 3210 --camera back --label head
 *   node scripts/phone-rig/rig.mjs stayon off
 *
 * `check`  adb present, the phone listed as `device` (or exactly what to tap), Chrome reachable
 *          through `adb forward` — and the screen kept on while on USB.
 * `run`    for each camera: `adb forward tcp:9222 localabstract:chrome_devtools_remote`, Playwright
 *          connectOverCDP, a NEW tab brought to the front (the camera stops in background tabs; other
 *          tabs are never read or touched), the chamber opened with ?cost=1, the gate tapped, the
 *          permission prompt waited for ("PHONE: tap Allow"), the palm protocol printed, the funnel
 *          polled until a hand has been present for 3 s, then 20 s recorded — screenshots at 5, 12
 *          and 20 s; the build stamp (and /api/version for a live URL); the camera's facing, label,
 *          getSettings() and getCapabilities(); the tier and profile; the funnel; console errors and
 *          failed requests. A hand that never comes in 90 s is a finding ("no hand seen"), not a
 *          retry. The front camera is reached with the chamber's own flip control.
 *          `--reverse <port>` first runs `adb reverse tcp:<port> tcp:<port>` so the phone can open a
 *          build served by this machine (localhost is a secure context; the camera works).
 *
 * Output: captures/phone/<ISO-timestamp>/ — gitignored, it holds his palm. Report paths only.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { chromium } from "playwright";

const REPO = resolve(import.meta.dirname, "..", "..");
const argv = process.argv.slice(2);
const command = argv[0];
const flag = (name, fallback) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : fallback);

/* ------------------------------------ adb ------------------------------------ */

function findAdb() {
  const candidates = [
    "adb",
    process.env.ANDROID_HOME && join(process.env.ANDROID_HOME, "platform-tools", "adb.exe"),
    process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, "Android", "Sdk", "platform-tools", "adb.exe"),
  ].filter(Boolean);
  for (const candidate of candidates) {
    const probe = spawnSync(candidate, ["version"], { encoding: "utf8" });
    if (probe.status === 0) return candidate;
  }
  return null;
}

const ADB = findAdb();
const adb = (...args) => execFileSync(ADB, args, { encoding: "utf8" }).trim();

/** The phone, or the exact thing to tap. */
function requireDevice() {
  if (ADB === null) {
    console.error("adb is not installed. Run: winget install Google.PlatformTools  — then plug the phone in.");
    process.exit(2);
  }
  const lines = adb("devices", "-l").split(/\r?\n/).slice(1).filter((line) => line.trim() !== "");
  if (lines.length === 0) {
    console.error("PHONE: no device listed. Plug the phone in over USB, unlock it, and set USB to 'File transfer' if the prompt appears; USB debugging must be on (Settings → Developer options).");
    process.exit(2);
  }
  const unauthorized = lines.find((line) => /\bunauthorized\b/.test(line));
  if (unauthorized) {
    console.error("PHONE: tap 'Allow' on the 'Allow USB debugging?' prompt (tick 'Always allow from this computer'), then run again.");
    process.exit(2);
  }
  const device = lines.find((line) => /\bdevice\b/.test(line));
  if (!device) {
    console.error(`PHONE: the device is not ready: ${lines.join(" | ")}`);
    process.exit(2);
  }
  return device.split(/\s+/)[0];
}

function stayOn(on) {
  adb("shell", "svc", "power", "stayon", on ? "usb" : "false");
}

/* ------------------------------------ check ------------------------------------ */

async function check() {
  const serial = requireDevice();
  const model = adb("shell", "getprop", "ro.product.model");
  const release = adb("shell", "getprop", "ro.build.version.release");
  console.log(`phone: ${model} (Android ${release}) serial ${serial}`);
  stayOn(true);
  console.log("screen: kept on while on USB (svc power stayon usb)");
  adb("forward", "tcp:9222", "localabstract:chrome_devtools_remote");
  try {
    const version = await (await fetch("http://127.0.0.1:9222/json/version")).json();
    console.log(`chrome: ${version.Browser} — reachable over adb forward`);
  } catch (error) {
    console.error(`chrome: not reachable on the phone (${error.message}). Open Chrome on the phone once, then run again.`);
    process.exit(2);
  }
  console.log("ok");
}

/* ------------------------------------- run ------------------------------------- */

const HAND_HOLD_MS = 3000;
const HAND_TIMEOUT_MS = 90_000;
const RECORD_MS = 20_000;
const SHOTS_AT_MS = [5000, 12_000, 20_000];

async function run() {
  const url = flag("--url", null);
  if (!url) {
    console.error("--url is required (…/scan/chamber)");
    process.exit(2);
  }
  const cameras = flag("--camera", "back").split(",");
  const label = flag("--label", "run");
  const reverse = flag("--reverse", null);
  requireDevice();
  stayOn(true);
  if (reverse) {
    adb("reverse", `tcp:${reverse}`, `tcp:${reverse}`);
    console.log(`adb reverse tcp:${reverse} — the phone reaches this machine's :${reverse} as localhost`);
  }
  adb("forward", "tcp:9222", "localabstract:chrome_devtools_remote");

  const stamp = new Date().toISOString().replaceAll(":", "-").slice(0, 19);
  const dir = join(REPO, "captures", "phone", `${stamp}-${label}`);
  mkdirSync(dir, { recursive: true });
  const report = { url, label, startedAt: new Date().toISOString(), runs: {} };

  const browser = await chromium.connectOverCDP("http://127.0.0.1:9222");
  try {
    const context = browser.contexts()[0] ?? (await browser.newContext());
    const page = await context.newPage();
    await page.bringToFront();
    const consoleErrors = [];
    const failedRequests = [];
    page.on("console", (message) => message.type() === "error" && consoleErrors.push(message.text()));
    page.on("pageerror", (error) => consoleErrors.push(String(error)));
    page.on("requestfailed", (request) => failedRequests.push(`${request.failure()?.errorText ?? "failed"} ${request.url()}`));
    page.on("response", (response) => response.status() >= 400 && failedRequests.push(`${response.status()} ${response.url()}`));

    const target = new URL(url);
    target.searchParams.set("cost", "1");
    console.log(`opening ${target.href}`);
    await page.goto(target.href, { waitUntil: "load", timeout: 90_000 });
    await page.waitForTimeout(800);

    /* The gate. */
    const gate = page.locator("button", { hasText: /Kaksh mein pravesh|प्रवेश/ }).first();
    await gate.waitFor({ state: "visible", timeout: 30_000 });
    await gate.tap();
    console.log("PHONE: if Chrome asks for the camera, tap Allow");
    await page.waitForFunction(
      () => {
        const video = document.querySelector("video");
        const stream = video?.srcObject;
        return Boolean(stream && stream.getVideoTracks().some((track) => track.readyState === "live")) || document.querySelector("ol") !== null;
      },
      null,
      { timeout: 180_000 },
    );

    for (const camera of cameras) {
      if (camera === "front") {
        const flip = page.locator('[data-snc-control="flip"]');
        await flip.waitFor({ state: "visible", timeout: 30_000 });
        await flip.tap();
        await page.waitForFunction(() => document.querySelector('[data-snc-control="flip"]')?.getAttribute("data-snc-facing") === "user", null, { timeout: 30_000 }).catch(() => {});
        await page.waitForTimeout(1500);
      }
      const facingNow = await page.evaluate(() => document.querySelector('[data-snc-control="flip"]')?.getAttribute("data-snc-facing") ?? null);
      console.log(`\n[${camera}] camera facing ${facingNow}. PALM UNDER THE ${camera === "front" ? "FRONT" : "BACK"} CAMERA — ~25 cm, fingers up, torch off`);
      consoleErrors.length = 0;
      failedRequests.length = 0;

      /* Wait for a hand held for HAND_HOLD_MS, up to HAND_TIMEOUT_MS. */
      const t0 = Date.now();
      let heldSince = null;
      let handSeen = false;
      while (Date.now() - t0 < HAND_TIMEOUT_MS) {
        const hand = await page.evaluate(() => Boolean(document.querySelector("canvas")?.dataset.sncHand));
        if (hand) {
          heldSince ??= Date.now();
          if (Date.now() - heldSince >= HAND_HOLD_MS) {
            handSeen = true;
            break;
          }
        } else heldSince = null;
        await page.waitForTimeout(250);
      }
      const run = { camera, facing: facingNow, handSeen, waitedMs: Date.now() - t0, shots: [] };
      if (!handSeen) console.log(`[${camera}] no hand seen in ${HAND_TIMEOUT_MS / 1000} s — recorded as a finding`);
      else console.log(`[${camera}] hand held ${HAND_HOLD_MS / 1000} s — recording ${RECORD_MS / 1000} s`);

      /* Record. */
      const recordStart = Date.now();
      let shot = 0;
      while (Date.now() - recordStart < RECORD_MS) {
        const elapsed = Date.now() - recordStart;
        if (shot < SHOTS_AT_MS.length && elapsed >= SHOTS_AT_MS[shot] - 100) {
          const path = join(dir, `${camera}-${SHOTS_AT_MS[shot] / 1000}s.png`);
          await page.screenshot({ path });
          run.shots.push(path);
          shot += 1;
        }
        await page.waitForTimeout(100);
      }
      if (shot < SHOTS_AT_MS.length) {
        const path = join(dir, `${camera}-${SHOTS_AT_MS[SHOTS_AT_MS.length - 1] / 1000}s.png`);
        await page.screenshot({ path });
        run.shots.push(path);
      }

      /* What the page can say. */
      Object.assign(
        run,
        await page.evaluate(() => {
          const video = document.querySelector("video");
          const track = video?.srcObject?.getVideoTracks?.()[0] ?? null;
          const cost = document.querySelector("[data-snc-budget]")?.textContent ?? null;
          const funnel = typeof window.__hrFunnel === "function" ? window.__hrFunnel() : null;
          /* The last raw observation (label, winding, world normal): the conventions the tilt gate rests on, read off a REAL frame. */
          const observation = typeof window.__hrObservation === "function" ? window.__hrObservation() : null;
          return {
            stamp: document.querySelector("[data-snc-build-stamp]")?.textContent ?? (cost?.match(/build [0-9a-f]+/)?.[0] ?? null),
            track: track
              ? { label: track.label, settings: track.getSettings(), capabilities: typeof track.getCapabilities === "function" ? track.getCapabilities() : null }
              : null,
            video: video ? { width: video.videoWidth, height: video.videoHeight } : null,
            costLine: cost,
            profile: cost?.match(/profile \S+ \([A-Z]+\)/)?.[0] ?? null,
            funnel,
            observation,
            ledger: document.querySelector('section[aria-label^="Rekha monitor"] button')?.textContent ?? null,
          };
        }),
      );
      run.consoleErrors = [...consoleErrors];
      run.failedRequests = [...failedRequests];
      if (/^https:/.test(url)) {
        try {
          run.apiVersion = await (await fetch(new URL("/api/version", url).href, { cache: "no-store" })).json();
        } catch (error) {
          run.apiVersion = { error: error.message };
        }
      }
      report.runs[camera] = run;

      const w = run.funnel?.windows?.at(-1) ?? run.funnel?.current ?? null;
      console.log(`[${camera}] stamp ${run.stamp} · track ${run.track?.label ?? "?"} facing ${run.track?.settings?.facingMode ?? "?"} ${run.track?.settings?.width}×${run.track?.settings?.height}@${run.track?.settings?.frameRate ?? "?"} · caps torch ${run.track?.capabilities?.torch ?? "?"} focus ${JSON.stringify(run.track?.capabilities?.focusMode ?? null)} zoom ${JSON.stringify(run.track?.capabilities?.zoom ?? null)}`);
      console.log(`[${camera}] ${run.profile ?? "profile ?"} · ledger ${run.ledger ?? "?"}`);
      if (w) console.log(`[${camera}] last window: captured ${w.captured} hand ${w.handFound} palm ${w.palmAccepted} gates ${w.gatesPassed} rectified ${w.rectified} extractions ${w.extractions} proposed ${JSON.stringify(w.proposed)} held ${JSON.stringify(w.held)} drawn ${w.drawn} · rejections ${JSON.stringify(Object.fromEntries(Object.entries(w.rejections).filter(([, n]) => n > 0)))} · palm ${JSON.stringify(w.palmWidthPx)} · pose ${JSON.stringify(w.poses ?? {})} · tilt ${JSON.stringify(w.tilt)}`);
      else console.log(`[${camera}] no funnel on the page (build without ?cost=1 support?)`);
      const o = run.observation;
      if (o) console.log(`[${camera}] observation: label ${o.handedness} ${o.score.toFixed(2)} · thumb ${o.landmarks[4].x < o.landmarks[20].x ? "image-left" : "image-right"} · winding ${o.winding.toFixed(4)} · normal ${o.normal ? `(${o.normal.x.toFixed(3)}, ${o.normal.y.toFixed(3)}, ${o.normal.z.toFixed(3)})` : "–"}`);
      console.log(`[${camera}] console errors ${run.consoleErrors.length}, failed requests ${run.failedRequests.length}${run.failedRequests.length ? `: ${run.failedRequests.slice(0, 4).join(" | ")}` : ""}`);
      console.log(`[${camera}] shots: ${run.shots.join(", ")}`);
    }
    await page.close();
  } finally {
    await browser.close().catch(() => {});
    writeFileSync(join(dir, "report.json"), JSON.stringify(report, null, 2));
    console.log(`\nReport: ${join(dir, "report.json")}`);
    stayOn(false);
  }
}

/* ------------------------------------ main ------------------------------------ */

if (command === "check") await check();
else if (command === "run") await run();
else if (command === "stayon") {
  requireDevice();
  stayOn(argv[1] !== "off");
  console.log(`screen stay-on: ${argv[1] !== "off" ? "on (usb)" : "off"}`);
} else {
  console.log("usage: node scripts/phone-rig/rig.mjs check | run --url <chamber url> [--camera back,front] [--label name] [--reverse <port>] | stayon on|off");
  process.exit(existsSync(REPO) ? 2 : 1);
}
