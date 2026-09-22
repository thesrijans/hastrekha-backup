/* ============================================================================
 * M1 — THE PHONE CHAMBER: which camera, the one mirror flag, the torch, the
 * lite profile, and what the chamber says when the camera will not open.
 *
 * The assertion M1.1 asks for by name is in §2: BACK-CAMERA FRAMES ARE NEVER
 * DE-MIRRORED AND FRONT FRAMES ALWAYS ARE. "De-mirroring" is what the display
 * does to a pipeline coordinate so it lands under the reader's hand on a
 * mirrored preview — the CSS flip on the <video>, the overlay's cover
 * transform, the tilt direction a pose asks for. All three must read one flag,
 * and that flag must follow the camera. §3 pins the other half: the PIXELS are
 * never flipped, so the palm-facing gate reads a palm the same way through
 * either camera.
 * ========================================================================== */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  browserFamily,
  cameraConstraints,
  flipConstraints,
  flipTarget,
  isPhone,
  mirroredFor,
  preferredFacing,
  resolveFacing,
  videoInputCount,
  type CameraFacing,
} from "../lib/scan/camera-select";
import { coverTransform, videoNormToCanvas } from "../lib/scan/view-transform";
import { gradeFrame, palmTilt, physicalHandedness } from "../lib/scan/quality";
import { FULL_SCAN_PROFILE, LITE_SCAN_PROFILE, scanProfileFor } from "../lib/scan/scan-profile";
import { CAMERA_RETRY_LABEL, cameraDeniedDirections, cameraFailureNote } from "../lib/sanctuary/chamber-camera";
import { HAND_LANDMARKER_LITE_MODEL_PATH, HAND_LANDMARKER_MODEL_PATH } from "../lib/scan/landmarks";
import { syntheticHand } from "./hand-fixture";

let assertions = 0;
const ok = (condition: boolean, message: string): void => {
  assert.ok(condition, message);
  assertions += 1;
};

const ROOT = path.resolve(__dirname, "..");
const source = (...parts: string[]): string => readFileSync(path.join(ROOT, ...parts), "utf8");
const withoutComments = (text: string): string =>
  text.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1");

const hook = withoutComments(source("components", "scan", "use-hand-scan.ts"));
const chamber = withoutComments(source("app", "scan", "chamber", "chamber-client.tsx"));

/* ------------------------------- 1. The flag ------------------------------- */

ok(mirroredFor("user") === true, "the front camera's preview is a mirror");
ok(mirroredFor("environment") === false, "the back camera's never is");
ok(flipTarget("user") === "environment" && flipTarget("environment") === "user", "the flip goes to the other camera and back");

/* -------- 2. Back frames are never de-mirrored; front frames always are -------- */

{
  const video = { width: 1280, height: 720 };
  const canvas = { width: 390, height: 844 };
  const probe = { x: 0.3, y: 0.5 };
  const place = (facing: CameraFacing) => {
    const transform = coverTransform(video.width, video.height, canvas.width, canvas.height, mirroredFor(facing));
    assert.ok(transform !== null);
    return videoNormToCanvas(transform, probe);
  };
  const raw = coverTransform(video.width, video.height, canvas.width, canvas.height, false)!;
  const unflipped = videoNormToCanvas(raw, probe);
  const back = place("environment");
  const front = place("user");
  ok(back.x === unflipped.x && back.y === unflipped.y, "a back-camera point is drawn exactly where the raw frame has it — never de-mirrored");
  ok(Math.abs(front.x - (canvas.width - unflipped.x)) < 1e-9 && front.y === unflipped.y, "a front-camera point is always de-mirrored, across the vertical axis and nothing else");

  /* The tilt a pose asks for is in what the reader SEES: raw through the back camera, negated through the front. */
  const { world } = syntheticHand();
  const leaning = world.map((p) => ({ x: p.x * Math.cos(0.6) + p.z * Math.sin(0.6), y: p.y, z: -p.x * Math.sin(0.6) + p.z * Math.cos(0.6) }));
  ok(palmTilt(leaning, mirroredFor("environment")) === palmTilt(leaning, false), "the back camera's tilt is the raw one — not de-mirrored");
  ok(palmTilt(leaning, mirroredFor("user")) === -palmTilt(leaning, false), "the front camera's is always de-mirrored");

  /* And every display site reads the ONE flag the hook derives from the camera that opened. */
  ok(/mirrored = autoCamera \? mirroredFor\(cameraFacing\) :/.test(hook), "the hook's flag IS mirroredFor(the camera that opened) whenever it chooses the camera");
  ok(/style=\{mirrored \? \{ transform: "scaleX\(-1\)" \} : undefined\}/.test(chamber), "the chamber's CSS flip on the <video> reads that flag");
  ok(/<ChamberCanvas[\s\S]*?mirrored=\{mirrored\}/.test(chamber), "the overlay's projection reads that flag");
  ok(/gradeFrame\(\{[\s\S]*?mirrored,/.test(hook) && /palmTilt\(next\.world, mirrored\)/.test(hook), "and so do the gate's tilt check and the photometric tilt");
  ok(/cameraSelection: "auto"/.test(chamber), "the chamber is the route that lets the hook choose");
}

/* -------------- 3. The pixels are never flipped; the hand is the hand -------------- */

{
  ok(!/scale\(\s*-1|scaleX\(-1\)|setTransform\(\s*-1/.test(hook), "the hook never flips a pixel: MediaPipe, rectification and the exports all get the raw frame");
  /* The same raw palm frame — what either camera delivers — carrying its label in the gate's convention. */
  const { image, world } = syntheticHand();
  for (const facing of ["user", "environment"] as const) {
    const verdict = gradeFrame({
      landmarks: image,
      world,
      handedness: "Left",
      mirrored: mirroredFor(facing),
      stats: { luma: 0.5, clipped: 0 },
      jitter: 0,
      score: 0.95,
      spanHistory: [0.6, 0.6, 0.6, 0.6, 0.6],
    });
    ok(verdict.facingReadout?.physical === "Right", `${facing} camera: the same hand is named`);
    ok(verdict.ok && verdict.checks.not_palm_up, `${facing} camera: and the palm passes the palm-facing gate`);
  }
  ok(physicalHandedness("Left") === "Right" && physicalHandedness.length === 1, "the pairing takes no camera argument at all — it is a property of the pipeline's input");
}

/* ------------------------ 4. Which camera, and the fallback ------------------------ */

{
  const ANDROID_PHONE = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36";
  const ANDROID_TABLET = "Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36";
  const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
  const IPAD_AS_MAC = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15";
  const DESKTOP = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36";

  ok(isPhone({ userAgent: ANDROID_PHONE, uaDataMobile: null }), "an Android phone is a phone");
  ok(isPhone({ userAgent: IPHONE, uaDataMobile: null }), "an iPhone is a phone");
  ok(!isPhone({ userAgent: ANDROID_TABLET, uaDataMobile: null }), "an Android tablet is not");
  ok(!isPhone({ userAgent: IPAD_AS_MAC, uaDataMobile: null }), "nor an iPad");
  ok(!isPhone({ userAgent: DESKTOP, uaDataMobile: null }), "nor a laptop");
  ok(isPhone({ userAgent: DESKTOP, uaDataMobile: true }) && !isPhone({ userAgent: ANDROID_PHONE, uaDataMobile: false }), "client hints win where the browser offers them");
  ok(preferredFacing(true) === "environment" && preferredFacing(false) === "user", "a phone starts on the BACK camera, everything else on the front");

  ok(resolveFacing("environment", "") === "environment" && resolveFacing("user", "") === "user", "the track's own facingMode decides when it reports one");
  ok(resolveFacing(undefined, "camera2 0, facing back") === "environment", "Android's label names the back camera");
  ok(resolveFacing(undefined, "Back Dual Wide Camera") === "environment", "and so does iOS's");
  for (const label of ["FaceTime HD Camera", "HD WebCam (04f2:b6dd)", "fake_device_0", "camera2 1, facing front", ""]) {
    ok(resolveFacing(undefined, label) === "user", `"${label}" is treated as facing the reader — the laptop that has no back camera falls back to its front one, mirrored`);
  }
  ok(videoInputCount([{ kind: "videoinput" }, { kind: "audioinput" }, { kind: "videoinput" }]) === 2, "the flip counts cameras only");

  const size = { captureWidth: 854, captureHeight: 480 };
  const first = cameraConstraints("environment", size);
  ok(JSON.stringify(first.facingMode) === JSON.stringify({ ideal: "environment" }), "the first open asks for the back camera as IDEAL — so no back camera means the front one, silently, never an error");
  ok(JSON.stringify(first.width) === JSON.stringify({ ideal: 854 }) && JSON.stringify(first.height) === JSON.stringify({ ideal: 480 }), "at the profile's size");
  ok(JSON.stringify(cameraConstraints("user", size, "abc").deviceId) === JSON.stringify({ exact: "abc" }), "a named device is asked for exactly");
  ok(JSON.stringify(flipConstraints("user", size).facingMode) === JSON.stringify({ exact: "user" }), "the flip asks for the other camera exactly, so a one-camera device says so instead of reopening itself");
}

/* ------------------------------- 5. The torch ------------------------------- */

{
  const control = withoutComments(source("lib", "scan", "camera-control.ts"));
  const dev = withoutComments(source("lib", "scan", "dev", "still-capture.ts"));
  ok(/export async function setTorch\(/.test(control), "the torch switch lives in production code");
  ok(/export \{ setTorch \} from "\.\.\/camera-control";/.test(dev) && !/applyConstraints\(\{ advanced: \[\{ torch/.test(dev), "and the dev sequence capture uses that very switch — one capability, one implementation");
  ok(/if \(await setTorch\(track, want\)\)/.test(hook), "the chamber's toggle goes through it");
  ok(/applyPlan\([^)]*torchOnRef\.current\)/.test(hook.replace(/\s+/g, " ")), "and camera control re-asks for a lit torch whenever it replaces the constraint set");
  ok(/canTorch = scanning && torch !== "unsupported"/.test(chamber), "the toggle shows only on a track that can light one");
  ok(/aria-pressed=\{torch === "on"\}/.test(chamber), "and says whether it is lit");
}

/* ------------------------------ 6. The profile ------------------------------ */

{
  ok(scanProfileFor("HIGH") === FULL_SCAN_PROFILE, "HIGH keeps the full profile");
  for (const tier of ["MID", "LOW", "FLOOR"] as const) ok(scanProfileFor(tier) === LITE_SCAN_PROFILE, `${tier} runs the lite profile`);
  ok(
    FULL_SCAN_PROFILE.landmarker === "full" && FULL_SCAN_PROFILE.captureWidth === 1280 && FULL_SCAN_PROFILE.captureHeight === 720 && FULL_SCAN_PROFILE.extractIntervalMs === 700,
    "the full profile is exactly what /scan has always run: full model, 1280×720, 700 ms",
  );
  ok(
    LITE_SCAN_PROFILE.landmarker === "lite" && LITE_SCAN_PROFILE.captureHeight === 480 && LITE_SCAN_PROFILE.extractIntervalMs === 900,
    "the lite profile is M1.4's: the lite model, 480p, extraction every 900 ms",
  );
  ok(/\{ facingMode, width: \{ ideal: 1280 \}, height: \{ ideal: 720 \} \}/.test(hook), "a caller that does not choose (/scan) still opens the camera with its original constraints, verbatim");
  ok(/const requestedProfile = options\.profile \?\? FULL_SCAN_PROFILE;/.test(hook), "and runs the full profile");
  ok(/activeProfileRef\.current\.extractIntervalMs/.test(hook) && !/EXTRACT_INTERVAL_MS/.test(hook), "the extraction cadence is the profile's");
  ok(/profile\.landmarker === "lite" \? \{ modelPath: HAND_LANDMARKER_LITE_MODEL_PATH \} : \{\}/.test(hook), "and so is the landmark model");

  const bundle = (name: string) => readFileSync(path.join(ROOT, "public", name));
  const lite = bundle(HAND_LANDMARKER_LITE_MODEL_PATH.slice(1));
  const full = bundle(HAND_LANDMARKER_MODEL_PATH.slice(1));
  ok(lite.subarray(0, 4).toString("latin1") === "PK", "the lite bundle is a MediaPipe task zip");
  ok(lite.includes(Buffer.from("hand_detector.tflite")) && lite.includes(Buffer.from("hand_landmarks_detector.tflite")), "with the two entries the Tasks runtime looks for");
  ok(lite.length < full.length * 0.6, `and is the lighter bundle (${lite.length} vs ${full.length} bytes)`);
}

/* ------------------------- 7. When the camera will not open ------------------------- */

{
  const CHROME_ANDROID = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36";
  const SAMSUNG = "Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/25.0 Chrome/121.0 Mobile Safari/537.36";
  const SAFARI_IOS = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
  const CHROME_IOS = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/129.0 Mobile/15E148 Safari/604.1";
  const IPAD = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15";

  ok(browserFamily(CHROME_ANDROID, 5) === "chrome-android", "Chrome on Android gets Chrome's words");
  ok(browserFamily(SAMSUNG, 5) === "other", "Samsung Internet, which only claims to be Chrome, does not");
  ok(browserFamily(SAFARI_IOS, 5) === "safari-ios", "Safari on iOS gets Safari's");
  ok(browserFamily(IPAD, 5) === "safari-ios" && browserFamily(IPAD, 0) === "other", "an iPad reporting a Mac is found by its touch points; a real Mac is not an iPad");
  ok(browserFamily(CHROME_IOS, 5) === "other", "Chrome on iOS keeps its camera setting elsewhere, so not Safari's words");

  const chrome = cameraDeniedDirections("chrome-android");
  ok(chrome.steps.some((step) => step.includes("Permissions → Camera")), "Chrome's path goes through the site-controls icon's Permissions → Camera");
  ok(chrome.alternative !== null && chrome.alternative.includes("Site settings → Camera"), "with the menu's Site settings as the second way round");
  const safari = cameraDeniedDirections("safari-ios");
  ok(safari.steps.some((step) => step.includes("aA")) && safari.steps.some((step) => step.includes("Website Settings → Camera")), "Safari's goes through aA → Website Settings → Camera");
  ok(safari.alternative !== null && safari.alternative.includes("Settings → Safari → Camera"), "with the Settings app as the second");
  for (const family of ["chrome-android", "safari-ios", "other"] as const) {
    const directions = cameraDeniedDirections(family);
    ok(directions.retry === CAMERA_RETRY_LABEL && directions.steps.length >= 2, `${family}: steps first, and the one control is for after following them`);
  }
  ok(/directions === null \? null :/.test(chamber) && /directions\.steps\.map/.test(chamber), "the chamber renders the reader's own browser's steps on the refused-camera leaf");

  ok(cameraFailureNote("NotFoundError") === "Is device par koi camera nahi mila.", "a device with no camera is told so");
  ok(cameraFailureNote("NotReadableError")?.includes("kisi aur app") === true, "a camera held by another app is told so");
  ok(cameraFailureNote("NotAllowedError") === null && cameraFailureNote(null) === null, "the refusal has its own leaf, and the rest the generic sentence");
  const copy = source("lib", "sanctuary", "chamber-camera.ts") + source("app", "scan", "chamber", "chamber-client.tsx");
  ok(!/back camera nahi|peeche ka camera nahi|no back camera/i.test(withoutComments(copy)), "and a missing BACK camera has no sentence at all — the laptop falls back to its front camera silently");
}

console.log(`CAMERA SELECT ASSERTIONS PASSED (${assertions})`);
