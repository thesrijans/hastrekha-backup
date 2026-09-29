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
 * THE REAL-PHONE PROFILE (F1). Android does not label its cameras — or count them — until the reader
 * has answered the permission prompt: before it, enumerateDevices() returns one entry with no label
 * and no id. The stub below behaves exactly so: the list is label-less until the first getUserMedia
 * is granted (after a prompt's delay), and the checklist proves the chamber asked for the back camera
 * BEFORE any list could have told it otherwise. A scenario that passes only on a permissive list does
 * not count. `fakeui-412` goes further: no stub at all, Chromium's own fake cameras and its own
 * permission prompt (auto-accepted by --use-fake-ui-for-media-stream), with the permission state read
 * before and after.
 *
 * Scenarios (each at its own viewport, DPR and user agent):
 *   android-412             THE real-phone profile: Pixel 7, touch, 412×915, label-less list before
 *                           permission — back camera first, the flip always there, flipped to the
 *                           front and back and front again (four captures), the torch, the sheet
 *   fakeui-412              Chromium's real prompt and fake devices, no stub — the code path under a
 *                           browser's own permission gate
 *   phone-390 / phone-412   the layout checklist, M1.3 — back camera, lite profile (tier forced to MID)
 *                           — then the torch (M1.2) and the flip to the front camera (M1.1), and the
 *                           Monitor's sheet opened
 *   short-390               390×664, a phone with its browser bars showing — the layout checklist again
 *   high-390                tier left alone (this machine is HIGH) — the full profile's ?cost=1 line
 *   denied-android / -ios   camera refused — the M1.5 leaf in Chrome's and Safari's words
 *
 *   node scripts/capture/capture-chamber-phone.mjs [--build] [--label name] [--only a,b] [--settle ms] [--cpu 4] [--no-cost] [--base-url URL] [--feed path.y4m]
 *
 * Writes captures/ui/<stamp>-<label>/ (git-ignored): PNGs, report.json, and a scored checklist.
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { chromium } from "playwright";
import { buildProduction, startServer } from "./capture.mjs";
import { GPU_ARGS, readRenderer, isSoftware } from "./gpu-probe.mjs";
import { ANDROID, ANDROID_CAMERA_STUB, MID_TIER_STUB } from "./phone-camera.mjs";

const REPO = resolve(import.meta.dirname, "..", "..");
const argv = process.argv.slice(2);
/** R1 A/B: another feed — the palm's mirror image, or a tilted palm — for the same scenarios. */
const FEED = argv.includes("--feed") ? resolve(argv[argv.indexOf("--feed") + 1]) : join(REPO, "captures", "ui", "feeds", "palm-portrait.y4m");
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

const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";

/**
 * No emulation at all — only a RECORDER around Chromium's own getUserMedia / enumerateDevices, so the
 * fakeui scenario can show the order of calls and the permission state under the browser's own gate.
 */
const RECORDER_STUB = () => {
  const media = navigator.mediaDevices;
  const realOpen = media.getUserMedia.bind(media);
  const realList = media.enumerateDevices.bind(media);
  const state = { opens: [], enumerations: [], torch: [], permission: [] };
  window.__camera = state;
  const note = async (when) => {
    try {
      const status = await navigator.permissions.query({ name: "camera" });
      state.permission.push({ when, state: status.state });
    } catch {
      state.permission.push({ when, state: "unqueryable" });
    }
  };
  void note("load");
  media.enumerateDevices = async () => {
    const list = await realList();
    state.enumerations.push({ count: list.filter((d) => d.kind === "videoinput").length, labelled: list.filter((d) => d.kind === "videoinput" && d.label !== "").length, beforeAnyOpen: state.opens.length === 0 });
    return list;
  };
  media.getUserMedia = async (constraints) => {
    await note("before-open");
    const asked = constraints?.video;
    const stream = await realOpen(constraints);
    await note("after-open");
    const track = stream.getVideoTracks()[0];
    state.opens.push({ asked: asked && typeof asked === "object" ? { facingMode: asked.facingMode ?? null, deviceId: asked.deviceId ?? null } : asked, device: track?.getSettings().deviceId, label: track?.label, facing: track?.getSettings().facingMode ?? null, enumerationsBefore: state.enumerations.length });
    return stream;
  };
};

const SCENARIOS = [
  /* F1 — the real-phone profile: Android's permission model, four camera states, the torch, the sheet. */
  { id: "android-412", width: 412, height: 915, dpr: 2.625, ua: ANDROID, tier: "MID", steps: ["torch", "flip", "flip2", "flip3", "sheet"], android: true },
  /* R1 A/B — the SAME feed on the back camera (unmirrored) and, with only a front camera, mirrored. */
  { id: "ab-back-412", width: 412, height: 915, dpr: 2.625, ua: ANDROID, tier: "MID", steps: [], android: true, ab: true },
  { id: "ab-front-412", width: 412, height: 915, dpr: 2.625, ua: ANDROID, tier: "MID", steps: [], android: true, ab: true, frontOnly: true },
  /* F1 — Chromium's own prompt and fake devices, nothing emulated: two fake cameras, the fake UI grants. */
  { id: "fakeui-412", width: 412, height: 915, dpr: 2.625, ua: ANDROID, tier: "MID", steps: ["flip"], fakeui: true },
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
/**
 * scan-complete G2: every instruction the leaf can carry — each reason and each of the distance meter's three —
 * read from their source, so the tallest-leaf check can never be run against a string the chamber no longer shows.
 */
const HINT_CANDIDATES = [
  ...new Set(
    ["scan-reason.ts", "distance.ts"].flatMap((file) =>
      [...readFileSync(join(REPO, "lib", "scan", file), "utf8").matchAll(/hi: "([^"]+)"/g)].map((match) => match[1]),
    ),
  ),
];

/** G2.2's target fill and the guide's quad aspect, read from their source so this check can never drift from them. */
const constantOf = (file, name) => Number(readFileSync(join(REPO, file), "utf8").match(new RegExp(`export const ${name} = ([0-9.]+);`))?.[1]);
const GUIDE_TARGET_FILL = constantOf("lib/scan/distance.ts", "PALM_QUAD_TARGET_FILL");
const GUIDE_ASPECT = constantOf("components/sanctuary/chamber/palm-guide.ts", "GUIDE_QUAD_ASPECT");

async function tallestLeafTop(page) {
  return page.evaluate((hints) => {
    const dock = document.querySelector('[data-snc-litany="in"]');
    if (!dock) return null;
    /* G2: the instruction is tried in the leaf's REAL hint line, ink gauge and all, when one is showing; the
       stage line's larger face stands in for it (the old, conservative way) when none is. */
    const build = (hint) => {
      const twin = dock.cloneNode(true);
      twin.setAttribute("data-snc-twin", "");
      twin.style.zIndex = "7";
      const leaf = twin.firstElementChild;
      const paragraphs = [...leaf.querySelectorAll("p")];
      const stage = paragraphs[0];
      const realHint = leaf.querySelector("[data-snc-hint]");
      const empty = stage.cloneNode(false);
      empty.textContent = "इस बार नहीं मिला";
      let hintLine;
      if (realHint) {
        hintLine = realHint.cloneNode(true);
        /* Set as the leaf sets it (scan-litany.tsx hintParts): each half an inline-block, the break at "·". */
        const template = hintLine.querySelector("[data-snc-hint-part]");
        const holder = template?.parentElement ?? null;
        if (template && holder) {
          const parts = hint.split(" · ");
          holder.replaceChildren();
          parts.forEach((part, i) => {
            if (i > 0) holder.append(" ");
            const node = template.cloneNode(false);
            node.textContent = i < parts.length - 1 ? `${part} ·` : part;
            holder.append(node);
          });
        } else hintLine.textContent = hint;
      } else {
        hintLine = stage.cloneNode(false);
        hintLine.textContent = hint;
      }
      stage.textContent = "पारंपरिक पाठ से मिलान…";
      for (const extra of paragraphs.slice(1)) extra.remove();
      stage.after(empty, hintLine);
      dock.parentElement.appendChild(twin);
      return { twin, top: leaf.getBoundingClientRect().top, withGauge: realHint !== null };
    };
    let tallest = null;
    for (const hint of hints) {
      const { twin, top, withGauge } = build(hint);
      twin.remove();
      if (tallest === null || top < tallest.top) tallest = { top, hint, withGauge };
    }
    /* The tallest stays for the screenshot; removeTwin takes it away after. */
    if (tallest !== null) build(tallest.hint);
    return tallest;
  }, HINT_CANDIDATES);
}

async function removeTwin(page) {
  await page.evaluate(() => document.querySelector("[data-snc-twin]")?.remove());
}

/** rAF deltas over `total` frames (after `skip` warm-up frames): the page's frame time as the reader's device sees it. */
async function sampleFrames(page, total = 240, skip = 20) {
  const samples = await page.evaluate(
    ([n, warm]) =>
      new Promise((done) => {
        const out = [];
        let last = performance.now();
        let seen = 0;
        const tick = (now) => {
          out.push(now - last);
          last = now;
          seen += 1;
          if (seen <= warm) out.length = 0;
          if (out.length >= n) done(out);
          else requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }),
    [total, skip],
  );
  const sorted = [...samples].sort((a, b) => a - b);
  const at = (p) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1))];
  return { n: sorted.length, p50: Number(at(0.5).toFixed(2)), p95: Number(at(0.95).toFixed(2)), worst: Number(sorted.at(-1).toFixed(2)) };
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
      flipFacing: document.querySelector('[data-snc-control="flip"]')?.getAttribute("data-snc-facing") ?? null,
      flipLabel: document.querySelector('[data-snc-control="flip"]')?.getAttribute("aria-label") ?? null,
      /* F1: what a tap at the flip's centre lands on — the flip itself, whatever is open. */
      flipHit: (() => {
        const flip = document.querySelector('[data-snc-control="flip"]');
        if (!flip) return null;
        const r = flip.getBoundingClientRect();
        const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return flip.contains(hit);
      })(),
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
      /* scan-complete G2: the leaf's instruction, the ink gauge's state, the guide's published geometry, the feed's size. */
      hintText: document.querySelector("[data-snc-hint]")?.textContent?.trim() ?? null,
      gaugeState: document.querySelector("[data-snc-gauge]")?.getAttribute("data-snc-distance") ?? null,
      guide: (canvas?.dataset.sncGuide ?? "").split(",").filter(Boolean),
      videoSize: video ? { width: video.videoWidth, height: video.videoHeight } : null,
      pageText: document.body.innerText,
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
      "open sheet covers the leaf; the flip stays above it (F1)",
      sheetOpen.hitsSheet.length > 0 && sheetOpen.hitsSheet[0] === true && sheetOpen.flipHit === true,
      `tap at the leaf lands on the sheet: ${sheetOpen.hitsSheet[0]}; tap at the flip lands on the flip: ${sheetOpen.flipHit}`,
    );
  }

  const reach = (b) => b && (b.top + b.bottom) / 2 >= 0.6 * H && b.left >= 8 && b.right <= W - 8 && b.width >= 44 && b.height >= 44;
  /* The torch is offered only where the track has one (F1); its absence is not a failure. */
  add("flip (+ torch, where the camera has one) reachable one-handed", reach(m.flip) && (m.torch === null || reach(m.torch)), `flip ${m.flip ? `${((m.flip.top + m.flip.bottom) / 2 / H).toFixed(2)}·H ${m.flip.width}px` : "absent"}, torch ${m.torch ? `${((m.torch.top + m.torch.bottom) / 2 / H).toFixed(2)}·H ${m.torch.width}px` : "absent"}`);

  const ringBox = { left: ring.cx - ring.r, right: ring.cx + ring.r, top: ring.cy - ring.r, bottom: ring.cy + ring.r };
  const ui = { back: m.back, flip: m.flip, torch: m.torch, leaf: m.leaf, monitor: m.monitor, stamp: m.stamp };
  const hits = [];
  for (const [name, rect] of Object.entries(ui)) if (intersects(rect, ringBox)) hits.push(`${name}×ring`);
  const names = Object.keys(ui);
  for (let i = 0; i < names.length; i += 1) for (let j = i + 1; j < names.length; j += 1) if (intersects(ui[names[i]], ui[names[j]])) hits.push(`${names[i]}×${names[j]}`);
  add("nothing overlapping the feed (ring clear, no UI on UI)", hits.length === 0, hits.length === 0 ? `ring ${ring.cy - ring.r | 0}–${ring.cy + ring.r | 0} clear of ${Object.keys(ui).filter((k) => ui[k]).join(", ")}` : hits.join(", "));

  /* scan-complete G2: the guide on the ring's REST centre at the meter's target size (scan-ring.ts ringGeometry
     with no hand; palm-guide.ts palmGuideGeometry), and an instruction the chamber really has. */
  if (m.videoSize && m.videoSize.width > 0) {
    const portrait = H > W;
    const phone = portrait && W <= 899;
    const largest = Math.min(W, H) * 0.42;
    const top = phone ? 64 : 0;
    const bottom = phone ? H - 268 : H;
    const cap = phone ? Math.max(0, Math.min(largest, (bottom - top) / 2)) : largest;
    const thumb = H * (portrait ? 0.58 : 0.5);
    const restCy = phone ? Math.min(Math.max(thumb, top + cap), Math.max(top + cap, bottom - cap)) : thumb;
    const { width: vw, height: vh } = m.videoSize;
    const scale = Math.max(W / vw, H / vh);
    const quad = (GUIDE_TARGET_FILL * Math.min(vw, vh) * scale) / (vw > vh ? GUIDE_ASPECT : 1);
    const [alpha, gx, gy, gq] = m.guide.map(Number);
    add(
      "G2 guide: on the ring's rest centre, at the target size",
      m.guide.length >= 4 && Math.abs(gx - W / 2) <= 1 && Math.abs(gy - restCy) <= 1 && Math.abs(gq - quad) <= 1.5,
      m.guide.length >= 4 ? `centre ${gx},${gy} vs ${Math.round(W / 2)},${Math.round(restCy)}; quad ${gq}px vs ${quad.toFixed(1)}; alpha ${alpha}` : "no guide published",
    );
  }
  add(
    "G2 instruction: one the chamber has, never 'poora haath'",
    (m.hintText === null || HINT_CANDIDATES.some((hint) => m.hintText.endsWith(hint))) && !/poora haath/i.test(m.pageText ?? ""),
    `"${m.hintText}" (gauge ${m.gaugeState})`,
  );
  return rows;
}

/** F1's checklist: the order of the camera's opening, and the four states. */
function scoreCamera(entry, s) {
  const rows = [];
  const add = (item, pass, measured) => rows.push({ item, verdict: pass ? "PASS" : "FAIL", measured });
  const cam = entry.back?.camera ?? null;
  const first = cam?.opens?.[0] ?? null;
  const idealBack = first?.asked?.facingMode && JSON.stringify(first.asked.facingMode) === JSON.stringify({ ideal: "environment" });
  add("first getUserMedia asks for the back camera as ideal", Boolean(idealBack), first ? `asked ${JSON.stringify(first.asked)}` : "no open recorded");
  add("…before any enumerateDevices() could decide it", first !== null && first.enumerationsBefore === 0, first ? `${first.enumerationsBefore} enumeration(s) before the first open` : "no open");
  if (s.android) {
    add("the permission prompt was exercised on that first call", first !== null && first.promptsSoFar === 1, first ? `${first.promptsSoFar} prompt(s) before the first open` : "no open");
    const after = (cam?.enumerations ?? []).filter((e) => !e.beforeAnyOpen);
    add("the device list is read only after permission, and is labelled then", after.length > 0 && after.every((e) => e.granted && e.labelled >= 2), `${after.length} enumeration(s) after the open: ${JSON.stringify(after.map((e) => `${e.labelled}/${e.count} labelled`))}`);
    add("first frame from the back camera, not mirrored", first?.facing === "environment" && entry.back?.videoTransform === "none", `facing ${first?.facing}, video transform ${entry.back?.videoTransform}`);
  } else {
    /* Nothing was pre-granted (the context carries no permission; the state reads "prompt" at load and
       at the call), and the open still succeeded: Chromium's own prompt answered it (the fake UI accepts).
       The fake UI does not persist a grant, so the state after is not asserted. */
    const perm = cam?.permission ?? [];
    add("Chromium's own prompt answered the first open — nothing pre-granted", perm.some((p) => p.when === "load" && p.state === "prompt") && perm.some((p) => p.when === "before-open" && p.state === "prompt") && first !== null, JSON.stringify(perm));
    add("the device list is read only after the open", (cam?.enumerations ?? []).length > 0 && (cam?.enumerations ?? []).every((e) => !e.beforeAnyOpen), JSON.stringify(cam?.enumerations ?? []));
  }
  const flip = entry.back?.flip;
  add("flip visible while scanning, 48px, in a bottom corner", flip && flip.width >= 48 && flip.height >= 48 && flip.bottom > 0.85 * s.height, flip ? `${flip.width}×${flip.height} at ${flip.left.toFixed(0)},${flip.top.toFixed(0)}` : "absent");
  add("flip labelled कैमरा बदलें", entry.back?.flipLabel === "कैमरा बदलें", `aria-label ${entry.back?.flipLabel}`);
  if (s.android) {
    add("torch beside the flip while the back camera is up", Boolean(entry.back?.torch), entry.back?.torch ? `torch at ${entry.back.torch.left.toFixed(0)},${entry.back.torch.top.toFixed(0)}` : "absent");
    const states = ["front", "back2", "front2"].map((k) => entry[k]).filter(Boolean);
    const expect = ["user", "environment", "user"];
    add("flip → front, mirrored; → back, unmirrored; → front, mirrored", states.length === 3 && states.every((m, i) => m.camera.opens.at(-1)?.facing === expect[i] && (expect[i] === "user" ? /matrix\(-1/.test(m.videoTransform) : m.videoTransform === "none")), states.map((m, i) => `${expect[i]}: facing ${m.camera.opens.at(-1)?.facing}, transform ${m.videoTransform}`).join(" | ") || "no flips");
    add("the flip stays visible through every state", states.every((m) => m.flip && m.flip.width >= 48), states.map((m) => (m.flip ? "visible" : "absent")).join(", "));
    add("torch only on the camera that has one", states.every((m, i) => (expect[i] === "environment") === Boolean(m.torch)), states.map((m, i) => `${expect[i]}: ${m.torch ? "torch" : "no torch"}`).join(", "));
  } else {
    /* Chromium's file-backed fake capture exposes ONE camera: the laptop case. The flip is still offered
       (touch), asks for the other camera exactly, is told there is none, and quietly reopens the only one;
       the mirror follows that track (no facingMode reported → the reader's side → mirrored). */
    const front = entry.front;
    const opens = front?.camera.opens ?? [];
    add("a one-camera device: the flip reopens its only camera and the mirror follows the track", front && opens.length >= 2 && opens.at(-1).device === opens[0].device && /matrix\(-1/.test(front.videoTransform), front ? `${opens.length} opens, devices ${JSON.stringify([...new Set(opens.map((o) => o.device))])}, transform ${front.videoTransform}` : "no flip");
  }
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
    "--use-fake-device-for-media-stream=device-count=2",
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
      /* The fakeui scenario leaves the permission to Chromium's own prompt (the fake UI accepts it). */
      ...(s.fakeui ? {} : { permissions: ["camera"] }),
    });
    if (s.frontOnly) await context.addInitScript(() => (window.__frontOnly = true));
    await context.addInitScript(s.fakeui ? RECORDER_STUB : ANDROID_CAMERA_STUB);
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
    /* R1: the frame time with the readout (and so the funnel) ON, and the funnel's own line. */
    scanning.frames = await sampleFrames(page);
    scanning.funnel = await page.evaluate(() => (typeof window.__hrFunnel === "function" ? window.__hrFunnel() : null));
    scanning.funnelLine = await page.evaluate(() => document.querySelector("[data-snc-funnel]")?.textContent ?? null);
    /* R1 A/B: the last raw observation — the landmarker's label, the winding, the world normal — and the
       conventions read off it: which side the thumb is on, which way world y and z run. */
    scanning.observation = await page.evaluate(() => (typeof window.__hrObservation === "function" ? window.__hrObservation() : null));
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
    for (const [step, key, shot] of [["flip", "front", "front"], ["flip2", "back2", "back-again"], ["flip3", "front2", "front-again"]]) {
      if (!s.steps.includes(step)) continue;
      await page.tap('[data-snc-control="flip"]').catch(() => {});
      await page.waitForFunction(() => document.querySelector("canvas")?.dataset.sncHand, null, { timeout: 30_000 }).catch(() => {});
      await page.waitForTimeout(step === "flip" ? 5000 : 2500);
      entry[key] = await measure(page);
      await page.screenshot({ path: join(dir, `${s.id}-${shot}.png`) });
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
    /* R1: the same scan with the readout OFF — the funnel must cost nothing it is not asked for. */
    await page.tap("button:has-text('Kaksh mein pravesh')").catch(() => {});
    await page.waitForFunction(() => document.querySelector("canvas")?.dataset.sncHand, null, { timeout: 45_000 }).catch(() => {});
    await page.waitForTimeout(Math.min(settle, 4000));
    entry.framesReadoutOff = await sampleFrames(page);
    entry.funnelOff = await page.evaluate(() => typeof window.__hrFunnel);
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
        verdict: tallest !== null && tallest.top >= ringBottom ? "PASS" : "FAIL",
        measured: tallest === null ? "no leaf" : `tallest leaf top ${tallest.top.toFixed(0)} vs ring bottom ${ringBottom.toFixed(0)} (instruction "${tallest.hint}"${tallest.withGauge ? " with the gauge" : ", stage face"})`,
      });
    }
    report.scenarios[s.id] = entry;

    console.log(`\n${s.id} (${entry.viewport}, tier ${entry.tier})`);
    for (const row of entry.checklist) console.log(`  ${row.verdict}  ${row.item} — ${row.measured}`);
    console.log(withCost ? `  ?cost=1  ${scanning.cost}` : `  stamp (pipeline)  ${JSON.stringify(scanning.stamp)} "${scanning.stampText}"`);
    if ((s.android || s.fakeui) && !s.ab) {
      entry.cameraChecklist = scoreCamera(entry, s);
      for (const row of entry.cameraChecklist) console.log(`  ${row.verdict}  ${row.item} — ${row.measured}`);
    }
    if (s.ab) {
      /* R1 A/B: every funnel window, in order — the pose in force, the gates, the tilt gate's rejections, the tilt itself. */
      const windows = [...(scanning.funnel?.windows ?? []), scanning.funnel?.current].filter(Boolean);
      console.log(`  feed ${FEED.split(/[\\/]/).pop()} · camera ${scanning.camera?.opens?.[0]?.facing ?? "?"} · mirrored ${scanning.videoTransform !== "none"}`);
      const o = scanning.observation;
      if (o) {
        /* Conventions, from the frame itself: the thumb's side in the image; world y against image y
           (down or up); world z against image z (the landmarker documents image z as "smaller = nearer"). */
        const thumbSide = o.landmarks[4].x < o.landmarks[20].x ? "image-left" : "image-right";
        const yDown = Math.sign(o.world[12].y - o.world[0].y) === Math.sign(o.landmarks[12].y - o.landmarks[0].y) ? "down (as image y)" : "UP (opposite to image y)";
        const iz = o.landmarks.map((l) => l.z), wz = o.world.map((l) => l.z);
        const mean = (a) => a.reduce((t, v) => t + v, 0) / a.length;
        const mi = mean(iz), mw = mean(wz);
        const cov = iz.reduce((t, v, i) => t + (v - mi) * (wz[i] - mw), 0);
        const corr = cov / Math.sqrt(iz.reduce((t, v) => t + (v - mi) ** 2, 0) * wz.reduce((t, v) => t + (v - mw) ** 2, 0) || 1);
        const n = o.normal;
        console.log(`  observation: label ${o.handedness} ${o.score.toFixed(2)} · thumb ${thumbSide} · winding ${o.winding > 0 ? "+" : "−"}${Math.abs(o.winding).toFixed(4)} · normal ${n ? `(${n.x.toFixed(3)}, ${n.y.toFixed(3)}, ${n.z.toFixed(3)})` : "–"} · world y ${yDown} · corr(image z, world z) ${corr.toFixed(2)}`);
      }
      for (const w of windows) {
        const poses = Object.entries(w.poses ?? {}).map(([pose, n]) => `${pose} ${n}`).join(" ");
        console.log(`  window ${Math.round(w.startMs / 1000)}s: hand ${w.handFound} gates ${w.gatesPassed} tilt_direction rejected ${w.rejections?.tilt_direction ?? 0} · pose ${poses} · tilt ${w.tilt ? `${w.tilt.median} (${w.tilt.min}…${w.tilt.max})` : "–"}`);
      }
    }
    console.log(`  video transform (back): ${scanning.videoTransform}; opens: ${JSON.stringify((scanning.camera?.opens ?? []).map((o) => o.facing ?? o.label))}`);
    if (scanning.funnelLine) console.log(`  ${scanning.funnelLine.trim().replace(/^· /, "")}`);
    if (scanning.frames && entry.framesReadoutOff) console.log(`  frames: readout ON p50 ${scanning.frames.p50} p95 ${scanning.frames.p95} worst ${scanning.frames.worst} · readout OFF p50 ${entry.framesReadoutOff.p50} p95 ${entry.framesReadoutOff.p95} worst ${entry.framesReadoutOff.worst} (window.__hrFunnel ${entry.funnelOff})`);
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
