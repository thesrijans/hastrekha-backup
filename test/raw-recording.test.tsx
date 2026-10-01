/* ============================================================================
 * scan-perfect P1 — THE RAW RECORDING MODE
 *
 *   1. the choices: 30 s, a crease-keeping bitrate, WebM VP9 → VP8 → MP4, the
 *      fixtures' own file name, a one-line description
 *   2. the wiring: `?record=1` records the hook's camera stream exactly as
 *      opened — never the drawn canvas — holds completion while it records,
 *      and uploads nothing
 *   3. the mark: "● REC" while it records, then the file to download or share
 * ========================================================================== */
import assert from "node:assert/strict";
import Module from "node:module";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import {
  describeRecording,
  pickRecordingMime,
  recordingExtension,
  recordingFileName,
  RAW_RECORDING_BITS_PER_SECOND,
  RAW_RECORDING_MIME_PREFERENCE,
  RAW_RECORDING_MS,
  RAW_RECORDING_TIMESLICE_MS,
} from "../lib/scan/raw-recording";

let assertions = 0;
const ok = (condition: boolean, message: string): void => {
  assert.ok(condition, message);
  assertions += 1;
};

const CLASS_NAME_STUB: Record<string, string> = new Proxy({}, { get: (_t, key) => (typeof key === "string" ? key : "") });
interface CjsExtensionHost {
  _extensions: Record<string, (loaded: { exports: unknown }, filename: string) => void>;
}
(Module as unknown as CjsExtensionHost)._extensions[".css"] = (loaded): void => {
  loaded.exports = { __esModule: true, default: CLASS_NAME_STUB };
};
const ROOT = path.resolve(__dirname, "..");
const source = (...parts: string[]): string => readFileSync(path.join(ROOT, ...parts), "utf8");
const withoutComments = (text: string): string => text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

/* ============================ 1. The choices ================================= */

{
  ok(RAW_RECORDING_MS === 30_000, "a recording runs 30 s");
  ok(RAW_RECORDING_BITS_PER_SECOND >= 8_000_000, `the encoder is asked for ${RAW_RECORDING_BITS_PER_SECOND / 1e6} Mbps — a crease is a few pixels of low contrast`);
  ok(RAW_RECORDING_TIMESLICE_MS <= 1000, "chunks every second, so a recording cut short keeps what it had");

  const supports = (...types: string[]) => (mime: string): boolean => types.includes(mime);
  ok(pickRecordingMime(supports(...RAW_RECORDING_MIME_PREFERENCE)) === "video/webm;codecs=vp9", "VP9 in WebM first where the browser records it (Chrome on Android)");
  ok(pickRecordingMime(supports("video/webm;codecs=vp8", "video/mp4")) === "video/webm;codecs=vp8", "then VP8");
  ok(pickRecordingMime(supports("video/mp4;codecs=avc1", "video/mp4")) === "video/mp4;codecs=avc1", "MP4 (H.264) where only that records (Safari on iOS)");
  ok(pickRecordingMime(() => false) === "", "nothing supported: the browser's own default");
  ok(
    pickRecordingMime((mime) => {
      if (mime.includes("vp9")) throw new Error("no");
      return mime.includes("vp8");
    }) === "video/webm;codecs=vp8",
    "a browser that throws on a type is treated as not recording it",
  );

  ok(recordingExtension("video/webm;codecs=vp9") === "webm" && recordingExtension("video/mp4;codecs=avc1") === "mp4" && recordingExtension("") === "webm", "the extension follows the container");
  const name = recordingFileName("video/webm;codecs=vp9", new Date(2026, 9, 1, 9, 5, 3));
  ok(name === "raw-phone-2026-10-01T09-05-03.webm", `the file is named as the fixtures expect it: ${name}`);
  ok(/^raw-phone-.*\.mp4$/.test(recordingFileName("video/mp4", new Date())), "an MP4 is named .mp4");
  const description = describeRecording({ durationMs: 30_000, bytes: 41_234_567, mime: "video/webm;codecs=vp9", track: { width: 1280, height: 720, frameRate: 30, facingMode: "environment" } });
  ok(description === "30.0 s · 1280×720 · 30 fps · back camera · WEBM VP9 · 41.2 MB", `one line says what was recorded: ${description}`);
}

/* ============================ 2. The wiring ================================== */

{
  const chamber = withoutComments(source("app", "scan", "chamber", "chamber-client.tsx"));
  const hook = withoutComments(source("components", "scan", "use-hand-scan.ts"));
  const recorder = withoutComments(source("components", "sanctuary", "chamber", "raw-recorder.tsx"));
  const choices = withoutComments(source("lib", "scan", "raw-recording.ts"));

  ok(
    /get\("record"\) === "1"/.test(chamber) && /\{recordMode && RawRecorder !== null \? <RawRecorder stream=\{cameraStream\}/.test(chamber),
    "`?record=1`, and only it, turns the mode on, recording the hook's camera stream — its mark is all it adds to the room",
  );
  ok(
    /if \(!recordMode\) return;[\s\S]{0,80}import\("@\/components\/sanctuary\/chamber\/raw-recorder"\)/.test(chamber) && !/^import (?!type).*raw-recorder/m.test(chamber),
    "and it is fetched only then: a test tool costs a reader's scan nothing",
  );
  ok(
    /streamRef\.current = stream;\s*setCameraStream\(stream\);/.test(hook) && /streamRef\.current = next;\s*setCameraStream\(next\);/.test(hook),
    "…which is the stream exactly as a scan opens it (the same getUserMedia call and constraints), and the flipped one after a flip",
  );
  ok(/new MediaRecorder\(new MediaStream\(\[track\]\)/.test(recorder) && !/captureStream/.test(recorder), "the recorder takes the camera's own track — never a canvas, so no overlay is ever in it");
  ok(!/fetch\(|XMLHttpRequest|sendBeacon|WebSocket/.test(recorder + choices), "and nothing in it sends anything anywhere: the file goes to an object URL on this device");
  ok(
    /detection\.complete && !recording/.test(chamber) && /!recordingRef\.current && completionReason\(/.test(chamber) && /!recordingRef\.current && shutterReady\(/.test(chamber),
    "nothing completes while it records — a completion stops the camera — and each trigger fires as usual once it is done",
  );
  ok(/RAW_RECORDING_MS\)/.test(recorder) && /addEventListener\("ended", stopRecording\)/.test(recorder), "it stops at 30 s, or early when the camera's track ends, keeping what it had");
}

/* ============================ 3. The mark ==================================== */

{
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { RawRecorderMark } = require("../components/sanctuary/chamber/raw-recorder") as typeof import("../components/sanctuary/chamber/raw-recorder");
  const render = (state: Parameters<typeof RawRecorderMark>[0]["state"]): string => renderToString(createElement(RawRecorderMark, { state, onAgain: () => undefined }));
  ok(render({ kind: "idle" }) === "", "before the camera is live, nothing");
  const recording = render({ kind: "recording", startedAt: 0, mime: "video/webm;codecs=vp9", track: { width: 720, height: 1280, frameRate: 30, facingMode: "environment" } });
  ok(/data-snc-rec="recording"/.test(recording) && /REC/.test(recording) && !/Download/.test(recording), "while it records: the small REC mark only");
  const file = new File([new Uint8Array(8)], "raw-phone-2026-10-01T09-05-03.webm", { type: "video/webm" });
  const done = render({ kind: "done", url: "blob:x", file, description: "30.0 s · 720×1280 · 30 fps · back camera · WEBM VP9 · 3.4 MB", durationMs: 30_000, track: { width: 720, height: 1280, frameRate: 30, facingMode: "environment" }, cut: false });
  ok(/data-snc-rec="done"/.test(done) && /download="raw-phone-2026-10-01T09-05-03\.webm"/.test(done) && /href="blob:x"/.test(done), "then the file, to download under its fixtures name");
  ok(/720×1280/.test(done) && /kabhi upload nahi/.test(done), "with what it is, and that it stays on the device");
  ok(/data-snc-rec-action="again"/.test(done), "and a way to record again");
  const cut = render({ kind: "done", url: "blob:y", file, description: "12.0 s", durationMs: 12_000, track: { width: null, height: null, frameRate: null, facingMode: null }, cut: true });
  ok(/data-snc-rec-cut="1"/.test(cut) && /ruk gaya/.test(cut), "a recording the camera cut short says so");
  ok(/data-snc-rec="unsupported"/.test(render({ kind: "unsupported", reason: "x" })), "a browser that cannot record says so");
}

console.log(`RAW RECORDING ASSERTIONS PASSED (${assertions})`);
