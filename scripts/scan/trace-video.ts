/**
 * S2.5b — the tracer on frames of the user's own scan recording.
 *
 * fixtures/private/video/scan-2026-09-21.mp4 is a screen recording of the
 * chamber: the user's hand in the camera feed, with the OLD overlay (the fitted
 * curves, gold) burned in. Frames are extracted at 1 fps
 * (captures/video-2026-09-21/all, gitignored — they are photographs of a hand
 * and a face), the burned-in gold overlay is inpainted away
 * (scripts/scan/video-clean.py — traced as recorded, the tracer followed the
 * dark gaps BETWEEN the old overlay's bright strokes), and the cleaned frames are
 * landmarked offline by scripts/scan/video-landmarks.py with
 * the app's own hand_landmarker.task; this script takes every frame the
 * landmarker could read, rectifies it through the app's own palmAnchors, runs
 * the worker-equivalent chain, extractLines and the valley tracer, and renders:
 *
 *   crop-<t>.png    the rectified crop and its valley map, fitted (blue) vs
 *                   traced (gold; 0.6 where it is pure extension)
 *   frame-<t>.png   the traced lines projected back onto the video frame
 *                   (cyan; the burned-in gold is the old fitted overlay),
 *                   fitted in magenta, beside the 06 s reference frame
 *
 *   npx tsx scripts/scan/trace-video.ts [--frames=captures/video-2026-09-21/clean]
 */
import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { alignFusion, emptyFusion, fuse, type FusionState } from "../../lib/scan/fusion";
import { extractLines } from "../../lib/scan/lines";
import { applyHomography, invertHomography, palmAnchors, rectifyPalm, type Matrix3 } from "../../lib/scan/rectify";
import { ValleyTracer, valleyDepth, type TracedPath } from "../../lib/scan/trace-valley";
import { MASK_SIZE, RECTIFIED_SIZE, type ActiveLineId, type Landmark3 } from "../../lib/scan/types";
import { loadImage, loadUnet, ReplayChain, WORK } from "./replay-chain";

/** Frames and their landmarks.json; default: the overlay-inpainted frames (scripts/scan/video-clean.py). */
const FRAMES = process.argv.find((a) => a.startsWith("--frames="))?.slice(9) ?? "captures/video-2026-09-21/clean";
/** --only=07s,46s runs just those frames. */
const ONLY = process.argv.find((a) => a.startsWith("--only="))?.slice(7).split(",");
const REFERENCE = "docs/reference/scan-video-06s-palm-flat-creases-visible.png";
const OUT = 512;
const LINES: readonly ActiveLineId[] = ["heart", "head", "life", "fate"];
const stamp = new Date().toISOString().replaceAll(":", "-").slice(0, 19);
const dir = path.resolve("captures/ui", `${stamp}-s2-video`);
mkdirSync(dir, { recursive: true });

const makeImageData = (w: number, h: number): ImageData =>
  ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4), colorSpace: "srgb" }) as ImageData;

interface FrameLandmarks {
  readonly width: number;
  readonly height: number;
  readonly handedness: string;
  readonly score: number;
  readonly landmarks: Landmark3[];
}

function pathKindsSvg(p: TracedPath, toXY: (q: number) => [number, number], color: string, width: number): string {
  const out: string[] = [];
  let run: number[] = [];
  let kind = p.kinds[0];
  const flush = (): void => {
    if (run.length < 2) return;
    out.push(
      `<polyline points="${run.map((q) => toXY(q).map((v) => v.toFixed(1)).join(",")).join(" ")}" fill="none" stroke="${color}" stroke-width="${width}" stroke-opacity="${kind === "extension" ? 0.6 : 1}" stroke-linecap="round" stroke-linejoin="round"/>`,
    );
  };
  p.pixels.forEach((q, i) => {
    if (p.kinds[i] !== kind) {
      flush();
      run = run.length > 0 ? [run[run.length - 1]!] : [];
      kind = p.kinds[i];
    }
    run.push(q);
  });
  flush();
  return out.join("");
}

/**
 * The recording's own gold overlay (the OLD fitted curves, the wheel, the leaders) as a mask on the
 * RAW frame, dilated by `radius` px — the same hue/saturation test video-clean.py inpaints with.
 * Used to measure whether a trace follows the crease or the overlay's remnants.
 */
function goldMask(raw: ImageData, radius: number): Uint8Array {
  const { width, height, data } = raw;
  const gold = new Uint8Array(width * height);
  for (let i = 0; i < gold.length; i += 1) {
    const r = data[i * 4]! / 255;
    const g = data[i * 4 + 1]! / 255;
    const b = data[i * 4 + 2]! / 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const sat = max === 0 ? 0 : (max - min) / max;
    let hue = 0;
    if (max !== min) {
      if (max === r) hue = (60 * ((g - b) / (max - min)) + 360) % 360;
      else if (max === g) hue = 60 * ((b - r) / (max - min)) + 120;
      else hue = 60 * ((r - g) / (max - min)) + 240;
    }
    if (hue >= 24 && hue <= 76 && sat >= 70 / 255 && max >= 70 / 255) gold[i] = 1;
  }
  const out = new Uint8Array(gold.length);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (!gold[y * width + x]) continue;
      for (let dy = -radius; dy <= radius; dy += 1) {
        const yy = y + dy;
        if (yy < 0 || yy >= height) continue;
        for (let dx = -radius; dx <= radius; dx += 1) {
          const xx = x + dx;
          if (xx >= 0 && xx < width && dx * dx + dy * dy <= radius * radius) out[yy * width + xx] = 1;
        }
      }
    }
  }
  return out;
}

async function main(): Promise<void> {
  const all = JSON.parse(readFileSync(`${FRAMES}/landmarks.json`, "utf8")) as Record<string, FrameLandmarks | null>;
  const unet = await loadUnet();
  const tracer = new ValleyTracer();
  const reference = await sharp(REFERENCE).png().toBuffer();
  const refMeta = await sharp(reference).metadata();
  for (const [name, lm] of Object.entries(all)) {
    if (lm === null) continue;
    const t = name.replace(/^f-|\.png$/g, "");
    if (ONLY !== undefined && !ONLY.includes(t)) continue;
    const source = await loadImage(`${FRAMES}/${name}`);
    const anchors = palmAnchors(lm.landmarks, source.width, source.height);
    if (anchors === null) {
      console.log(`${t}: no anchors`);
      continue;
    }
    const chain = new ReplayChain(unet);
    let fusion: FusionState = emptyFusion(WORK);
    let last = null as Awaited<ReturnType<ReplayChain["frame"]>>;
    for (let f = 1; f <= 12; f += 1) {
      const fr = await chain.frame(source, anchors.src);
      if (fr === null) break;
      fusion = alignFusion(fusion, fr.toCrop, fr.convention).state;
      fusion = fuse(fusion, { width: WORK, height: WORK, all: fr.plane, resolves: [], inferenceMs: 0, backend: "replay" }, 1000 + f * 200);
      last = fr;
    }
    if (last === null) continue;
    const found = extractLines(fusion.ema, MASK_SIZE);
    const traced = tracer.trace(found, last.luma, last.inside);

    /* crop panel */
    const cropXY = (q: number): [number, number] => [(((q % RECTIFIED_SIZE) + 0.5) / RECTIFIED_SIZE) * OUT, ((((q / RECTIFIED_SIZE) | 0) + 0.5) / RECTIFIED_SIZE) * OUT];
    let cropLayers = "";
    for (const id of LINES) {
      const fl = found.completion.lines[id];
      if (fl !== undefined) cropLayers += `<polyline points="${fl.points.map((p) => `${((p.x + 0.5) / MASK_SIZE) * OUT},${((p.y + 0.5) / MASK_SIZE) * OUT}`).join(" ")}" fill="none" stroke="#4ea1ff" stroke-width="1.4"/>`;
      const tp = traced.paths[id];
      if (tp !== undefined) cropLayers += pathKindsSvg(tp, cropXY, "#f2c14e", 2.4);
    }
    const gray = Buffer.alloc(RECTIFIED_SIZE * RECTIFIED_SIZE);
    for (let i = 0; i < gray.length; i += 1) gray[i] = Math.round(Math.min(1, Math.max(0, last.luma[i]!)) * 255);
    const depth = valleyDepth(last.luma);
    const p99 = Float32Array.from(depth).sort()[Math.floor(depth.length * 0.99)]! || 1;
    const dmap = Buffer.alloc(gray.length);
    for (let i = 0; i < dmap.length; i += 1) dmap[i] = Math.round(Math.min(1, depth[i]! / p99) * 255);
    const svgCrop = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${OUT}" height="${OUT}">${cropLayers}</svg>`);
    const panel = async (buf: Buffer): Promise<Buffer> =>
      sharp(await sharp(buf, { raw: { width: RECTIFIED_SIZE, height: RECTIFIED_SIZE, channels: 1 } }).resize(OUT, OUT, { kernel: "nearest" }).png().toBuffer())
        .composite([{ input: svgCrop }])
        .png()
        .toBuffer();
    await sharp({ create: { width: OUT * 2, height: OUT, channels: 3, background: "#000" } })
      .composite([
        { input: await panel(gray), left: 0, top: 0 },
        { input: await panel(dmap), left: OUT, top: 0 },
      ])
      .png()
      .toFile(path.join(dir, `crop-${t}.png`));

    /* frame panel: crop px → frame px through the inverse of the rectification */
    const toFrame: Matrix3 | null = invertHomography(last.toCrop);
    if (toFrame === null) continue;
    const frameXY = (x: number, y: number): [number, number] => {
      const p = applyHomography(toFrame, { x, y });
      return p === null ? [0, 0] : [p.x, p.y];
    };
    let frameLayers = "";
    for (const id of LINES) {
      const fl = found.completion.lines[id];
      if (fl !== undefined) {
        const pts = fl.points.map((p) => frameXY(((p.x + 0.5) / MASK_SIZE) * RECTIFIED_SIZE, ((p.y + 0.5) / MASK_SIZE) * RECTIFIED_SIZE));
        frameLayers += `<polyline points="${pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ")}" fill="none" stroke="#ff3fb4" stroke-width="2.5"/>`;
      }
      const tp = traced.paths[id];
      if (tp !== undefined) frameLayers += pathKindsSvg(tp, (q) => frameXY((q % RECTIFIED_SIZE) + 0.5, ((q / RECTIFIED_SIZE) | 0) + 0.5), "#29e0ff", 3.2);
    }
    // Palm quad outline, for orientation.
    frameLayers += `<polygon points="${anchors.src.map((a) => `${a.x.toFixed(0)},${a.y.toFixed(0)}`).join(" ")}" fill="none" stroke="#ffffff" stroke-opacity="0.35" stroke-width="1"/>`;
    const svgFrame = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${source.width}" height="${source.height}">${frameLayers}</svg>`);
    const framePng = await sharp(`${FRAMES}/${name}`).composite([{ input: svgFrame }]).png().toBuffer();
    // Side by side with the 06 s reference, both scaled to 900 px tall.
    const H = 886;
    const left = await sharp(reference).resize({ height: H }).png().toBuffer();
    const right = await sharp(framePng).resize({ height: H }).png().toBuffer();
    const lw = Math.round(((refMeta.width ?? 1918) * H) / (refMeta.height ?? 886));
    const rw = Math.round((source.width * H) / source.height);
    await sharp({ create: { width: lw + rw + 16, height: H, channels: 3, background: "#111" } })
      .composite([
        { input: left, left: 0, top: 0 },
        { input: right, left: lw + 16, top: 0 },
      ])
      .png()
      .toFile(path.join(dir, `frame-${t}.png`));

    // Palm zoom at 2x for judging by eye: the clean palm, and the same palm with the lines.
    {
      const xs = anchors.src.map((a) => a.x);
      const ys = anchors.src.map((a) => a.y);
      const margin = 40;
      const left0 = Math.max(0, Math.floor(Math.min(...xs) - margin));
      const top0 = Math.max(0, Math.floor(Math.min(...ys) - margin));
      const width0 = Math.min(source.width - left0, Math.ceil(Math.max(...xs) - Math.min(...xs) + 2 * margin));
      const height0 = Math.min(source.height - top0, Math.ceil(Math.max(...ys) - Math.min(...ys) + 2 * margin));
      const region = { left: left0, top: top0, width: width0, height: height0 };
      const plain = await sharp(`${FRAMES}/${name}`).extract(region).resize({ width: width0 * 2 }).png().toBuffer();
      const lined = await sharp(framePng).extract(region).resize({ width: width0 * 2 }).png().toBuffer();
      const zh = (await sharp(plain).metadata()).height ?? height0 * 2;
      await sharp({ create: { width: width0 * 4 + 12, height: zh, channels: 3, background: "#111" } })
        .composite([
          { input: plain, left: 0, top: 0 },
          { input: lined, left: width0 * 2 + 12, top: 0 },
        ])
        .png()
        .toFile(path.join(dir, `zoom-${t}.png`));
    }

    // Overlay coincidence: the share of each traced path lying within 4 px of the recording's own
    // gold overlay, against the share of the palm quad that overlay covers (chance).
    const raw = await loadImage(`captures/video-2026-09-21/all/${name}`);
    const nearGold = goldMask(raw, 4);
    const quadXs = anchors.src.map((a) => a.x);
    const quadYs = anchors.src.map((a) => a.y);
    let quadPx = 0;
    let quadGold = 0;
    for (let y = Math.floor(Math.min(...quadYs)); y < Math.max(...quadYs); y += 2) {
      for (let x = Math.floor(Math.min(...quadXs)); x < Math.max(...quadXs); x += 2) {
        quadPx += 1;
        quadGold += nearGold[y * raw.width + x] ?? 0;
      }
    }
    const coincide: string[] = [];
    for (const id of LINES) {
      const tp = traced.paths[id];
      if (tp === undefined) continue;
      let on = 0;
      for (const q of tp.pixels) {
        const [fx, fy] = frameXY((q % RECTIFIED_SIZE) + 0.5, ((q / RECTIFIED_SIZE) | 0) + 0.5);
        on += nearGold[Math.round(fy) * raw.width + Math.round(fx)] ?? 0;
      }
      coincide.push(`${id} ${((100 * on) / tp.pixels.length).toFixed(0)}%`);
    }
    console.log(`     on the old overlay (±4 px): ${coincide.join(", ") || "—"}  vs chance ${((100 * quadGold) / Math.max(1, quadPx)).toFixed(0)}% of the palm quad`);

    const life = traced.paths.life;
    const lifeTxt =
      life === undefined
        ? "no life line"
        : (() => {
            const a = life.pixels[0]!;
            const b = life.pixels[life.pixels.length - 1]!;
            const fa = frameXY((a % RECTIFIED_SIZE) + 0.5, ((a / RECTIFIED_SIZE) | 0) + 0.5);
            const fb = frameXY((b % RECTIFIED_SIZE) + 0.5, ((b / RECTIFIED_SIZE) | 0) + 0.5);
            const xs = life.pixels.map((q) => (q % RECTIFIED_SIZE) / RECTIFIED_SIZE);
            return `crop (${((a % RECTIFIED_SIZE) / RECTIFIED_SIZE).toFixed(3)}, ${(((a / RECTIFIED_SIZE) | 0) / RECTIFIED_SIZE).toFixed(3)}) → (${((b % RECTIFIED_SIZE) / RECTIFIED_SIZE).toFixed(3)}, ${(((b / RECTIFIED_SIZE) | 0) / RECTIFIED_SIZE).toFixed(3)}), x-range ${Math.min(...xs).toFixed(3)}–${Math.max(...xs).toFixed(3)}; frame (${fa[0].toFixed(0)}, ${fa[1].toFixed(0)}) → (${fb[0].toFixed(0)}, ${fb[1].toFixed(0)}); ends ${life.stops.join("/")}`;
          })();
    console.log(`${t}  ${lm.handedness} ${lm.score.toFixed(2)}  fitted [${LINES.filter((id) => found.completion.lines[id]).join(",")}]  traced [${LINES.filter((id) => traced.lines[id]).join(",")}]  ${traced.ms.toFixed(1)} ms`);
    console.log(`     life: ${lifeTxt}`);
  }
  console.log(`\n${dir}`);
}

void main();

export { makeImageData, rectifyPalm };
