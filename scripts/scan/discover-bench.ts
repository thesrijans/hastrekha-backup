/**
 * S3.7d — what one discovery costs in a BROWSER, alone: lib/scan/discover.ts bundled (esbuild) into a blank Chromium
 * page and run on real rectified crops (the golden session's stills, rectified here in Node), warm, at 1× and under
 * CDP's 4× CPU throttle. The chamber's own number (scripts/capture/funnel-feeds.mjs, `window.__hrDrawn`) is the
 * same work with the camera, the landmarker and the segmenter running beside it; this one says what is the
 * algorithm's.
 *
 *   npx tsx scripts/scan/discover-bench.ts [--rounds 20]
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { build } from "esbuild";
import { chromium } from "playwright";
import { rectifyPalm } from "../../lib/scan/rectify";
import type { Point2 } from "../../lib/scan/types";
import { loadImage } from "./replay-chain";

const SESSION_DIR = "fixtures/golden/session-2026-09-02T16-16-28-716Z";
const rounds = Number(process.argv.includes("--rounds") ? process.argv[process.argv.indexOf("--rounds") + 1] : "20");
const makeImageData = (w: number, h: number): ImageData => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4), colorSpace: "srgb" }) as ImageData;

async function main(): Promise<void> {
  const bundle = await build({
    entryPoints: [path.resolve("lib/scan/discover.ts")],
    bundle: true,
    format: "iife",
    globalName: "S3",
    write: false,
    target: "es2022",
    minify: true,
  });
  const code = bundle.outputFiles[0]!.text;
  const meta = JSON.parse(readFileSync(`${SESSION_DIR}/metadata.json`, "utf8")) as { stills: { rawFile: string; anchors: number[][] }[] };
  const crops: { luma: number[]; inside: number[] }[] = [];
  for (const still of meta.stills) {
    const source = await loadImage(`${SESSION_DIR}/raw/${still.rawFile}`);
    const warped = rectifyPalm(source, still.anchors.map(([x = 0, y = 0]) => ({ x, y })) as Point2[], 256, makeImageData);
    if (warped === null) continue;
    const luma: number[] = [];
    for (let k = 0; k < 256 * 256; k += 1) luma.push((0.2126 * warped.image.data[k * 4]! + 0.7152 * warped.image.data[k * 4 + 1]! + 0.0722 * warped.image.data[k * 4 + 2]!) / 255);
    crops.push({ luma, inside: Array.from(warped.inside) });
  }
  const browser = await chromium.launch();
  try {
    for (const cpu of [1, 4]) {
      const page = await browser.newPage();
      if (cpu > 1) await (await page.context().newCDPSession(page)).send("Emulation.setCPUThrottlingRate", { rate: cpu });
      await page.addScriptTag({ content: code });
      const times = await page.evaluate(
        ({ crops, rounds }) => {
          const api = (window as unknown as { S3: typeof import("../../lib/scan/discover") }).S3;
          const discoverer = new api.Discoverer(256);
          const inputs = crops.map((c) => ({ luma: Float32Array.from(c.luma), inside: Uint8Array.from(c.inside) }));
          for (const input of inputs) discoverer.discover(input.luma, input.inside); // warm
          const out: number[] = [];
          const phases: number[][] = [];
          for (let r = 0; r < rounds; r += 1)
            for (const input of inputs) {
              const result = discoverer.discover(input.luma, input.inside);
              out.push(result.ms);
              const b = result.timings.bands;
              phases.push([
                result.timings.valley,
                b.heart.cost + b.head.cost + b.life.cost + b.fate.cost,
                b.heart.search + b.head.search + b.life.search + b.fate.search,
                b.heart.finish + b.head.finish + b.life.finish + b.fate.finish,
              ]);
            }
          return { out, phases };
        },
        { crops, rounds: cpu > 1 ? Math.max(2, Math.floor(rounds / 4)) : rounds },
      );
      const phases = times.phases;
      const med = (k: number): string => {
        const v = phases.map((row) => row[k]!).sort((a, b) => a - b);
        return v[v.length >> 1]!.toFixed(2);
      };
      console.log(`   phases (median ms): valley+palm ${med(0)} · band costs ${med(1)} · Dijkstra (4 bands) ${med(2)} · finishing (4 bands) ${med(3)}`);
      const all = times.out.sort((a, b) => a - b);
      const q = (p: number): number => all[Math.min(all.length - 1, Math.floor(p * all.length))]!;
      console.log(`${cpu}× CPU: ${all.length} discoveries on ${crops.length} stills — median ${q(0.5).toFixed(1)} ms, p95 ${q(0.95).toFixed(1)} ms, worst ${all[all.length - 1]!.toFixed(1)} ms`);
      await page.close();
    }
  } finally {
    await browser.close();
  }
}

void main();
