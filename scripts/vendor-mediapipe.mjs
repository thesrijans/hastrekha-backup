/**
 * Copies MediaPipe's vision WASM out of node_modules into public/mediapipe/wasm.
 *
 * The alternative is loading it from Google's CDN at scan time. This product tells users their palm
 * never leaves the device, and a runtime fetch to a third party — even for a binary, even harmless —
 * is the wrong shape for that promise. Vendoring also makes builds reproducible when the CDN moves.
 *
 * The hand landmark model itself is NOT vendored: Google does not ship `hand_landmarker.task` in the
 * npm package. Download it and put it at public/models/hand_landmarker.task.
 *
 *   node scripts/vendor-mediapipe.mjs
 */
import { cp, mkdir, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

const SOURCE = path.join(process.cwd(), "node_modules", "@mediapipe", "tasks-vision", "wasm");
const TARGET = path.join(process.cwd(), "public", "mediapipe", "wasm");

if (!existsSync(SOURCE)) {
  console.error(`[vendor-mediapipe] not found: ${SOURCE}\nRun "npm i @mediapipe/tasks-vision" first.`);
  process.exit(1);
}

await mkdir(TARGET, { recursive: true });
await cp(SOURCE, TARGET, { recursive: true });

const copied = await readdir(TARGET);
console.log(`[vendor-mediapipe] copied ${copied.length} files → public/mediapipe/wasm`);
console.log("[vendor-mediapipe] still needed: public/models/hand_landmarker.task (download from Google)");
