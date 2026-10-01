/**
 * scan-perfect P1 — a raw phone recording becomes the rig's camera.
 *
 * `/scan/chamber?record=1` records the chamber's own camera stream, raw, for 30 s, and the reader saves it as
 * fixtures/private/video/raw-phone-*.webm|mp4. This turns each one into a feed Chromium's fake camera plays
 * (`--use-file-for-fake-video-capture`), so every later measurement runs on the reader's real phone, real hand and
 * real light instead of a synthetic crop:
 *
 *   captures/ui/feeds/raw/<name>.mjpeg   every frame, at the recording's own resolution and rate, JPEG quality 2
 *                                        (a 30 s Y4M at 1080p would be ~2.8 GB; MJPEG at q2 is ~1/20 of that)
 *   captures/ui/feeds/raw/manifest.json  per feed: the source, its ffprobe facts (codec, size, rate, duration, frames)
 *
 * Both directories are git-ignored: these are the reader's palm. Needs ffmpeg/ffprobe on PATH.
 *
 *   node scripts/capture/recording-to-feed.mjs [--file path] [--out dir] [--y4m]
 *
 * `--out` writes elsewhere — a synthetic recording (record-mode.mjs records Chromium's fake camera) must never land
 * among the reader's real ones. `--y4m` writes .y4m instead (for a short clip, or a Chromium that will not play MJPEG). The feeds are picked up by
 * funnel-feeds.mjs and chakra-feeds.mjs with `--feeds captures/ui/feeds/raw`.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { basename, extname, join, resolve } from "node:path";

const REPO = resolve(import.meta.dirname, "..", "..");
const argv = process.argv.slice(2);
const arg = (name, fallback) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : fallback);
const asY4m = argv.includes("--y4m");
const VIDEO_DIR = join(REPO, "fixtures", "private", "video");
const OUT = resolve(arg("--out", join(REPO, "captures", "ui", "feeds", "raw")));

const direct = process.argv[1] !== undefined && resolve(process.argv[1]) === resolve(import.meta.filename);
const sources = !direct
  ? []
  : argv.includes("--file")
  ? [resolve(arg("--file"))]
  : existsSync(VIDEO_DIR)
    ? readdirSync(VIDEO_DIR)
        .filter((file) => /^raw-phone-.*\.(webm|mp4)$/i.test(file))
        .sort()
        .map((file) => join(VIDEO_DIR, file))
    : [];
if (direct && sources.length === 0) {
  console.log(`No raw phone recordings at ${VIDEO_DIR} (raw-phone-*.webm|mp4). Record one at /scan/chamber?record=1 and save it there.`);
  process.exit(0);
}

/**
 * ffprobe's facts about a recording's video. A WebM from MediaRecorder carries no duration and a 1000 Hz timebase
 * (avg_frame_rate 0/0, r_frame_rate 1000/1 — taken at face value, "1000 fps" exhausted ffmpeg's memory), so the
 * rate and the length come from the packets' own timestamps: frames − 1 over the span between the first and last.
 */
export function probeVideo(file) {
  const out = JSON.parse(execFileSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=codec_name,width,height:format=format_name", "-of", "json", file], { encoding: "utf8" }));
  const stream = out.streams?.[0] ?? {};
  const times = execFileSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "packet=pts_time", "-of", "csv=p=0", file], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
    .split(/\r?\n/)
    .map(Number)
    .filter((t) => Number.isFinite(t))
    .sort((a, b) => a - b);
  const frames = times.length;
  const span = frames > 1 ? times[frames - 1] - times[0] : 0;
  const fps = span > 0 ? (frames - 1) / span : 0;
  return {
    container: out.format?.format_name ?? null,
    codec: stream.codec_name ?? null,
    width: stream.width ?? null,
    height: stream.height ?? null,
    fps: Math.round(fps * 100) / 100,
    frames,
    durationS: Math.round((span + (fps > 0 ? 1 / fps : 0)) * 100) / 100,
  };
}

if (direct) mkdirSync(OUT, { recursive: true });
const manifest = { generatedAt: new Date().toISOString(), feeds: [] };
for (const source of sources) {
  const name = basename(source, extname(source));
  const facts = probeVideo(source);
  const target = join(OUT, `${name}.${asY4m ? "y4m" : "mjpeg"}`);
  // Constant frame rate at the recording's own average (MediaRecorder writes variable timestamps), native size.
  const fps = facts.fps > 0 ? String(facts.fps) : "30";
  const args = ["-y", "-v", "error", "-i", source, "-an", "-vf", `fps=${fps}`];
  if (asY4m) args.push("-pix_fmt", "yuv420p", "-f", "yuv4mpegpipe", target);
  else args.push("-q:v", "2", "-f", "mjpeg", target);
  execFileSync("ffmpeg", args, { stdio: "inherit" });
  const entry = { feed: basename(target), source: source.replace(REPO, "").replaceAll("\\", "/").replace(/^\//, ""), ...facts, feedBytes: statSync(target).size };
  manifest.feeds.push(entry);
  console.log(`${entry.feed}: ${facts.codec} ${facts.width}x${facts.height} @ ${facts.fps} fps, ${facts.durationS} s, ${facts.frames} frames -> ${(entry.feedBytes / 1e6).toFixed(1)} MB`);
}
if (direct) {
  writeFileSync(join(OUT, "manifest.json"), JSON.stringify(manifest, null, 2));
  console.log(`Feeds: ${OUT}`);
}
