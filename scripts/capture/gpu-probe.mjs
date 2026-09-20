/**
 * Which GPU is headless Chromium actually using?
 *
 * The loop harness (docs/specs/loop-harness.md, §1) will not accept a frame
 * number measured under software rasterisation, because SwiftShader and a real
 * GPU disagree by roughly a factor of two on this room: room-stage.tsx records
 * 33 ms frames at 1440 under SwiftShader against 16.7 ms on the GPU. A harness
 * that silently fell back to software would produce numbers that look like
 * measurements and are not.
 *
 * So this probe runs first and the capture refuses to proceed if the renderer
 * string names a software backend. Run it directly to see what this machine
 * offers: `node scripts/capture/gpu-probe.mjs`.
 */
import { chromium } from "playwright";

/**
 * Flags that ask Windows Chromium for the real adapter through ANGLE's D3D11
 * backend. Headless Chromium defaults to SwiftShader on Windows unless it is
 * told otherwise, which is the whole reason this file exists.
 */
export const GPU_ARGS = [
  "--use-angle=d3d11",
  "--use-gl=angle",
  "--enable-gpu",
  "--ignore-gpu-blocklist",
  "--enable-gpu-rasterization",
  "--disable-software-rasterizer",
];

/** Renderer strings that mean "no GPU took part in this". */
const SOFTWARE = /swiftshader|llvmpipe|software|basic render/i;

/** Ask a live page what backend its WebGL context landed on. */
export async function readRenderer(page) {
  return page.evaluate(() => {
    const canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl2") ?? canvas.getContext("webgl");
    if (!gl) return { ok: false, reason: "no WebGL context" };
    const dbg = gl.getExtension("WEBGL_debug_renderer_info");
    return {
      ok: true,
      api: gl.getParameter(gl.VERSION),
      vendor: dbg ? gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL) : "(masked)",
      renderer: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : "(masked)",
      maxTextureSize: gl.getParameter(gl.MAX_TEXTURE_SIZE),
    };
  });
}

/** True when the renderer string names a software backend. */
export function isSoftware(renderer) {
  return SOFTWARE.test(String(renderer ?? ""));
}

/** Launch with GPU flags, report the backend, close. */
export async function probe({ headless = true, args = GPU_ARGS } = {}) {
  const browser = await chromium.launch({ headless, args });
  try {
    const info = await readRenderer(await browser.newPage());
    return { ...info, software: info.ok ? isSoftware(info.renderer) : true };
  } finally {
    await browser.close();
  }
}

const isMain = import.meta.filename === process.argv[1];
if (isMain) {
  const cases = [
    ["headless, no flags", true, []],
    ["headless, ANGLE/D3D11", true, GPU_ARGS],
    ["headed, ANGLE/D3D11", false, GPU_ARGS],
  ];
  for (const [label, headless, args] of cases) {
    try {
      const info = await probe({ headless, args });
      console.log(`\n--- ${label} ---`);
      console.log(JSON.stringify(info, null, 2));
      console.log(info.software ? ">>> SOFTWARE — harness would refuse" : ">>> REAL GPU — acceptable");
    } catch (err) {
      console.log(`\n--- ${label} ---\nFAILED: ${err.message}`);
    }
  }
}
