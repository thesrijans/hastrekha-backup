/**
 * Vendors third-party WASM out of node_modules into public/.
 *
 * The alternative is loading it from a CDN at scan time. This product tells users their palm never
 * leaves the device, and a runtime fetch to a third party — even for a binary, even harmless — is
 * the wrong shape for that promise. Vendoring also makes builds reproducible when a CDN moves.
 *
 * Copies:
 *   @mediapipe/tasks-vision/wasm  → public/mediapipe/wasm   (hand landmarks)
 *   onnxruntime-web/dist/*.wasm   → public/ort              (line segmentation)
 *
 * Neither model file is vendored — they are not in npm:
 *   public/models/hand_landmarker.task   download from Google
 *   public/models/palm-lines.onnx        exported from the palmistry-main checkpoint
 *
 *   node scripts/vendor-mediapipe.mjs
 */
import { copyFile, cp, mkdir, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

const root = process.cwd();

async function vendorMediapipe() {
  const source = path.join(root, "node_modules", "@mediapipe", "tasks-vision", "wasm");
  const target = path.join(root, "public", "mediapipe", "wasm");
  if (!existsSync(source)) {
    console.error(`[vendor] missing ${source}. Run "npm i @mediapipe/tasks-vision".`);
    process.exitCode = 1;
    return;
  }
  await mkdir(target, { recursive: true });
  await cp(source, target, { recursive: true });
  console.log(`[vendor] mediapipe → public/mediapipe/wasm (${(await readdir(target)).length} files)`);
}

/**
 * ORT ships one .wasm per feature combination plus an .mjs loader beside each. Only the pair the
 * runtime picks is ever fetched, so copying all of them costs disk, not bandwidth.
 */
async function vendorOnnxRuntime() {
  const source = path.join(root, "node_modules", "onnxruntime-web", "dist");
  const target = path.join(root, "public", "ort");
  if (!existsSync(source)) {
    console.error(`[vendor] missing ${source}. Run "npm i onnxruntime-web".`);
    process.exitCode = 1;
    return;
  }
  await mkdir(target, { recursive: true });

  const entries = await readdir(source);
  const wanted = entries.filter((name) => /^ort-wasm.*\.(wasm|mjs)$/.test(name));
  for (const name of wanted) {
    await copyFile(path.join(source, name), path.join(target, name));
  }
  console.log(`[vendor] onnxruntime → public/ort (${wanted.length} files)`);
}

await vendorMediapipe();
await vendorOnnxRuntime();

console.log("[vendor] still needed by hand:");
console.log("         public/models/hand_landmarker.task  (Google MediaPipe models page)");
console.log("         public/models/palm-lines.onnx       (exported from checkpoint_aug_epoch70.pth)");
