/**
 * Score the camera system (U3b P3) in the running room, with numbers.
 *
 * test/sanctuary-three-camera.test.ts holds each pose, the ease, the drift and
 * the parallax to their numbers in Node. This drives the real page — the real
 * island, the real canvas, a real click — and measures what only the page can:
 *
 *   camera before route  the camera starts moving at the click, the route opens
 *                        only after the whole move, and the camera has arrived
 *   no CSS zoom          over a live scene the island marks the set but does
 *                        not scale it (a zoom on top would blur the canvas)
 *   60 fps in motion     frame intervals during a move, p95
 *   look and come home   a room not built yet: the camera goes, then returns
 *   parallax, tilt       the pointer and the device tilt each move the camera,
 *                        the same way the CSS room's layers move
 *   breathing            at rest, the camera is never quite still
 *
 * AT REST TOO. The six seconds of rest that open the run are scored on their
 * own: no frame over 25 ms. A move's p95 alone let a stall the room has
 * standing still pass as long as it was rarer than one frame in twenty — the
 * P2 capture read p95 16.8 ms with a 216.8 ms worst frame — and it was this
 * row that found the cause: the room never flushed its frame, and on
 * ANGLE/D3D11 it stalled ~200 ms every half second (see room-canvas.tsx).
 *
 * Thresholds are fixed here, before the first run. A per-frame sampler buffers
 * in the page — so the measurement does not cost the frames it measures — and
 * flushes to Node when the route changes, before a navigation can discard it.
 *
 *   node scripts/capture/score-camera.mjs            # uses the existing build
 *   node scripts/capture/score-camera.mjs --build    # rebuilds with NEXT_PUBLIC_SANCTUARY=1
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { chromium } from "playwright";
import { buildProduction, startServer, THRESHOLD_SEEN, THRESHOLD_STORAGE_KEY } from "./capture.mjs";
import { GPU_ARGS, isSoftware, readRenderer } from "./gpu-probe.mjs";

const REPO = resolve(import.meta.dirname, "..", "..");

/** lib/sanctuary/room-composition.ts ROOM_CAMERA_MOVE_MS; camera-rig.ts PARALLAX_M; restated for a plain .mjs. */
const MOVE_MS = 1400;
const PARALLAX_M = 0.0225;
/** lib/sanctuary/room-composition.ts ROOM_CSS_CAMERAS.scanner, and the stage it is drawn on. */
const SCANNER_CSS = { x: 530, y: 420, zoom: 1.85 };
const STAGE = { width: 1600, height: 900 };

export const THRESHOLDS = {
  startLatencyMs: 50, //     the camera is moving within ~3 frames of the click
  routeEarlyMs: 34, //       the route may open at most 2 frames before the move's end
  arrivedAtRoute: 0.98, //   the camera has done at least 98% of its move when the route opens
  motionP95Ms: 16.8, //      60 fps held during a move (rAF interval, as the capture harness measures)
  restStallMs: 25, //        at rest, no frame interval over this (a dropped frame and a half)
  parallaxRatio: [0.6, 1.4], // measured slide within 60-140% of PARALLAX_M x deflection (drift adds noise)
  breathMinM: 0.0005, //     at rest the camera moves at least half a millimetre in six seconds
  wordsPx: 4, //             the words end within 4 px of where the CSS push would have taken them
};

const frames = [];
const events = [];

async function main() {
  if (process.argv.includes("--build")) await buildProduction();
  const server = await startServer();
  const browser = await chromium.launch({ headless: true, args: GPU_ARGS });
  try {
    const { rows, gpu } = await measure(browser, server);
    const pad = Math.max(...rows.map((r) => r.item.length));
    console.log(`GPU: ${gpu.renderer}\n`);
    for (const row of rows) console.log(`${row.pass ? "PASS" : "FAIL"}  ${row.item.padEnd(pad)}  ${row.measurement}`);
    const fails = rows.filter((r) => !r.pass).length;
    console.log(`\n${rows.length - fails}/${rows.length} pass, ${fails} FAIL`);

    const dir = join(REPO, "captures", "ui", "scores");
    await mkdir(dir, { recursive: true });
    const stamp = new Date().toISOString().replaceAll(":", "-").slice(0, 19);
    await writeFile(join(dir, `camera-${stamp}.json`), JSON.stringify({ gpu: gpu.renderer, thresholds: THRESHOLDS, rows, events, frames }, null, 2));
    process.exitCode = fails === 0 ? 0 : 1;
  } finally {
    await browser.close();
    server.child.kill();
  }
}

/** The measurement, in a fresh context: phases A-E, then the verdicts. */
async function measure(browser, server) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, colorScheme: "dark" });
  try {
    await context.addInitScript(([k, v]) => window.localStorage.setItem(k, v), [THRESHOLD_STORAGE_KEY, THRESHOLD_SEEN]);
    const page = await context.newPage();
    const gpu = await readRenderer(page);
    if (!gpu.ok || isSoftware(gpu.renderer)) throw new Error(`Refusing to score on a software renderer: ${gpu.renderer}`);
    await page.exposeFunction("__camFlush", (batch) => frames.push(...batch));
    await page.exposeFunction("__camEvent", (event) => events.push(event));

    await page.goto(`${server.base}/sanctuary?snc-measure=1`, { waitUntil: "load", timeout: 60_000 });
    await page.waitForSelector('[data-snc-room-scene="live"]', { timeout: 30_000 });
    await page.waitForFunction(() => Boolean(window.__sncRoom?.rig), null, { timeout: 30_000 });
    await page.waitForTimeout(1500);

    await page.evaluate(() => {
      const room = window.__sncRoom;
      const cam = room.world.camera;
      const set = document.querySelector("#snc-room [data-snc-room-set]");
      const words = document.querySelector("#snc-room [data-snc-room-overlay]");
      const rect = (el) => {
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return [r.left, r.top, r.right, r.bottom];
      };
      const buffer = [];
      let lastPath = location.pathname;
      window.__camFlushNow = () => {
        if (buffer.length) window.__camFlush(buffer.splice(0));
      };
      window.addEventListener("click", () => window.__camEvent({ kind: "click", t: performance.now() }), true);
      window.addEventListener("pagehide", () => window.__camFlushNow());
      const tick = (t) => {
        buffer.push({
          t,
          x: cam.position.x,
          y: cam.position.y,
          z: cam.position.z,
          yaw: cam.rotation.y,
          progress: room.rig.progress(t),
          dest: room.rig.destination,
          scale: set ? getComputedStyle(set).scale : null,
          words: rect(words),
          set: rect(set),
          path: location.pathname,
        });
        if (location.pathname !== lastPath || buffer.length >= 240) {
          lastPath = location.pathname;
          window.__camFlushNow();
        }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    const flush = () => page.evaluate(() => window.__camFlushNow?.()).catch(() => {});
    const mark = (kind) => page.evaluate((k) => window.__camEvent({ kind: k, t: performance.now() }), kind);
    const rest = await page.evaluate(() => {
      const p = window.__sncRoom.rig.poses.sanctuary;
      return { x: p.position.x, y: p.position.y, z: p.position.z };
    });

    /* A — breathing, six seconds at rest */
    await mark("breath-start");
    await page.waitForTimeout(6000);
    await mark("breath-end");
    await flush();

    /* B — parallax: pointer to the top-left, then back to the centre */
    await page.mouse.move(20, 20);
    await page.waitForTimeout(1600);
    await mark("pointer-settled");
    await page.waitForTimeout(500);
    await mark("pointer-end");
    await page.mouse.move(720, 450);
    await page.waitForTimeout(1600);

    /* C — tilt: the device rolled fully right, pitch neutral */
    await page.evaluate(() => window.dispatchEvent(new DeviceOrientationEvent("deviceorientation", { alpha: 0, beta: 45, gamma: 24 })));
    await page.waitForTimeout(1600);
    await mark("tilt-settled");
    await page.waitForTimeout(500);
    await mark("tilt-end");
    await page.evaluate(() => window.dispatchEvent(new DeviceOrientationEvent("deviceorientation", { alpha: 0, beta: 45, gamma: 0 })));
    await page.waitForTimeout(1600);
    await flush();

    /* D — a room not built yet: the camera looks, then comes home */
    await mark("library-start");
    await page.click('#snc-room [data-snc-camera="library"]', { force: true }); // aria-disabled: not built yet, but a reader's click still makes the camera look
    await page.waitForTimeout(MOVE_MS + 1200 + MOVE_MS + 800);
    await mark("library-end");
    await flush();
    await page.keyboard.press("Escape").catch(() => {});
    await page.waitForTimeout(400);

    /* E — the camera before the route */
    await mark("scanner-start");
    await page.click('#snc-room a[data-snc-camera="scanner"]');
    const deadline = Date.now() + 8000;
    while (Date.now() < deadline && !frames.some((f) => f.path !== "/sanctuary")) {
      await flush();
      await page.waitForTimeout(100);
    }
    await flush();

    return { gpu, rows: verdicts(rest) };
  } finally {
    await context.close();
  }
}

function verdicts(rest) {
  const t = THRESHOLDS;
  const rows = [];
  const add = (item, pass, measurement) => rows.push({ item, pass, measurement });
  const at = (kind, n = 0) => events.filter((e) => e.kind === kind)[n]?.t;
  const between = (a, b) => frames.filter((f) => f.t >= a && f.t <= b);
  const clicks = events.filter((e) => e.kind === "click").map((e) => e.t);
  const p95 = (values) => {
    const s = [...values].sort((x, y) => x - y);
    return s.length ? s[Math.min(s.length - 1, Math.ceil(0.95 * s.length) - 1)] : NaN;
  };
  const mean = (list, key) => list.reduce((sum, f) => sum + f[key], 0) / Math.max(1, list.length);

  /* camera before the route */
  const scannerStart = at("scanner-start");
  const click = clicks.find((c) => c >= scannerStart);
  const after = frames.filter((f) => f.t >= click);
  const firstMove = after.find((f) => f.dest === "scanner" && f.progress > 0);
  const navIndex = after.findIndex((f) => f.path !== "/sanctuary");
  const beforeNav = navIndex > 0 ? after[navIndex - 1] : null;
  const nav = navIndex >= 0 ? after[navIndex] : null;
  const latency = firstMove ? firstMove.t - click : Infinity;
  const routeAfter = nav ? nav.t - click : NaN;
  add("the camera starts moving at the click", latency <= t.startLatencyMs, `first moving frame ${latency.toFixed(1)} ms after the click (max ${t.startLatencyMs})`);
  add(
    "the route opens only after the whole move",
    nav !== null && routeAfter >= MOVE_MS - t.routeEarlyMs,
    nav ? `route opened ${routeAfter.toFixed(0)} ms after the click (move ${MOVE_MS} ms)` : "the route never opened",
  );
  add(
    "and the camera has arrived when it does",
    beforeNav !== null && beforeNav.progress >= t.arrivedAtRoute,
    beforeNav ? `move ${(beforeNav.progress * 100).toFixed(1)}% done on the last frame before the route (need ${(t.arrivedAtRoute * 100).toFixed(0)}%)` : "no frame before the route",
  );
  const moving = nav ? after.slice(0, navIndex) : after;
  const scaled = moving.filter((f) => f.scale !== null && f.scale !== "none" && f.scale !== "1");
  add("over a live scene the island does not CSS-zoom the canvas", moving.length > 0 && scaled.length === 0, `${scaled.length} of ${moving.length} frames with the set scaled (${[...new Set(moving.map((f) => f.scale))].join(", ")})`);
  const intervals = moving.slice(1).map((f, i) => f.t - moving[i].t);
  // At capture.mjs's resolution (2 dp): rAF stamps are 0.1 ms apart, and an
  // on-time frame reads 16.800000000002910 ms — over 16.8 by float noise alone.
  const motion = Number(p95(intervals).toFixed(2));
  add("60 fps held during a camera move", intervals.length > 30 && motion <= t.motionP95Ms, `p95 ${motion.toFixed(2)} ms over ${intervals.length} frames of the move (max ${t.motionP95Ms}), worst ${Math.max(...intervals).toFixed(1)} ms`);
  const still = between(at("breath-start"), at("breath-end"));
  const restIntervals = still.slice(1).map((f, i) => f.t - still[i].t);
  const stalls = restIntervals.filter((v) => v > t.restStallMs);
  add(
    "and at rest no frame is dropped",
    restIntervals.length > 300 * 0.5 && stalls.length === 0,
    `${stalls.length} of ${restIntervals.length} frames over ${t.restStallMs} ms in six seconds at rest${stalls.length ? ` (${stalls.map((v) => v.toFixed(0)).join(", ")} ms)` : ""}, worst ${Math.max(...restIntervals).toFixed(1)} ms`,
  );

  /* the words leave as the CSS push took them: P + s(r0 - P), corner by corner */
  const before = frames.filter((f) => f.t < click).at(-1);
  if (before?.words && before?.set && beforeNav?.words) {
    const [sl, st, sr, sb] = before.set;
    const px = sl + (SCANNER_CSS.x / STAGE.width) * (sr - sl);
    const py = st + (SCANNER_CSS.y / STAGE.height) * (sb - st);
    const s = SCANNER_CSS.zoom;
    const [l, tp, r, b] = before.words;
    const expected = [px + s * (l - px), py + s * (tp - py), px + s * (r - px), py + s * (b - py)];
    const error = Math.max(...expected.map((v, i) => Math.abs(v - beforeNav.words[i])));
    const moved = Math.max(...before.words.map((v, i) => Math.abs(v - beforeNav.words[i])));
    add(
      "the words over the room leave with the camera, as the CSS push took them",
      error <= t.wordsPx && moved > 100,
      `on arrival the words' box is ${error.toFixed(1)} px from the CSS push's (max ${t.wordsPx}); it travelled ${moved.toFixed(0)} px`,
    );
  } else {
    add("the words over the room leave with the camera, as the CSS push took them", false, "no words box sampled around the click");
  }

  /* look and come home */
  const libStart = at("library-start");
  const lib = between(libStart, at("library-end"));
  const reached = lib.some((f) => f.dest === "library" && f.progress >= 0.99);
  const cameBack = lib.some((f, i) => f.dest === "sanctuary" && f.progress >= 0.99 && lib.slice(0, i).some((g) => g.dest === "library"));
  add("a room not built yet: the camera looks, then comes home", reached && cameBack, `reached the library pose: ${reached}; returned to rest: ${cameBack}`);

  /* parallax and tilt: measured against the rest pose, averaged over half a second to beat the drift */
  const slide = (from, to) => {
    const window = between(at(from), at(to));
    return { dx: mean(window, "x") - rest.x, dy: mean(window, "y") - rest.y, n: window.length };
  };
  const pointer = slide("pointer-settled", "pointer-end");
  const px = (20 / 1440) * 2 - 1;
  const py = (20 / 900) * 2 - 1;
  const expectX = px * PARALLAX_M;
  const expectY = -py * PARALLAX_M;
  const [lo, hi] = t.parallaxRatio;
  const inRange = (value, expected) => value / expected >= lo && value / expected <= hi;
  add(
    "the pointer moves the camera, as the CSS room's layers move",
    pointer.n > 10 && inRange(pointer.dx, expectX) && inRange(pointer.dy, expectY),
    `pointer top-left: camera ${(pointer.dx * 1000).toFixed(1)} mm across, ${(pointer.dy * 1000).toFixed(1)} mm up (expected ${(expectX * 1000).toFixed(1)}, ${(expectY * 1000).toFixed(1)})`,
  );
  const tilt = slide("tilt-settled", "tilt-end");
  add(
    "device tilt moves it the same way",
    tilt.n > 10 && inRange(tilt.dx, PARALLAX_M) && Math.abs(tilt.dy) < PARALLAX_M * 0.4,
    `rolled fully right: camera ${(tilt.dx * 1000).toFixed(1)} mm across, ${(tilt.dy * 1000).toFixed(1)} mm up (expected ${(PARALLAX_M * 1000).toFixed(1)}, 0)`,
  );

  /* breathing */
  const breath = between(at("breath-start"), at("breath-end"));
  const range = (key) => Math.max(...breath.map((f) => f[key])) - Math.min(...breath.map((f) => f[key]));
  const moved = Math.hypot(range("x"), range("y"), range("z"));
  add("at rest the room breathes", breath.length > 100 && moved >= t.breathMinM, `camera travelled a ${(moved * 1000).toFixed(2)} mm envelope over ${breath.length} frames (min ${(t.breathMinM * 1000).toFixed(1)} mm)`);
  return rows;
}

main().catch((err) => {
  console.error(err.stack ?? err.message);
  process.exitCode = 2;
});
