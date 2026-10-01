/**
 * @file The raw recording mode (scan-perfect P1): `/scan/chamber?record=1` turns the reader's phone into the test rig.
 *
 * The chamber opens its camera exactly as a scan does — the same getUserMedia call, the same constraints, the same
 * resolution (use-hand-scan.ts `cameraStream`) — and a MediaRecorder records THAT stream for
 * {@link RAW_RECORDING_MS}: the camera's own frames, with no overlay, no ring, no lines drawn into them (the overlay is a
 * separate canvas; the recorder never sees it). The file is offered as a download or a share and is never uploaded.
 * Saved as fixtures/private/video/raw-phone-*.webm|mp4, it plays back as Chromium's fake camera
 * (scripts/capture/recording-to-feed.mjs) for every later measurement.
 *
 * Pure: the choices (container, bitrate, name, description) live here; the browser work is in
 * components/sanctuary/chamber/raw-recorder.tsx.
 */

/** How long one recording runs: a whole scan's worth of a palm in front of the camera. */
export const RAW_RECORDING_MS = 30_000;

/**
 * Bits per second asked of the encoder. A crease is a few pixels of low contrast; at a phone's default (~2.5 Mbps
 * for 720p) the encoder smooths exactly that away. 12 Mbps keeps 1080p30 close to what the camera delivered; the
 * browser clamps it to what its encoder supports.
 */
export const RAW_RECORDING_BITS_PER_SECOND = 12_000_000;

/** Chunks are collected every second, so a recording cut short (a flip, a lost camera) still keeps what it had. */
export const RAW_RECORDING_TIMESLICE_MS = 1000;

/**
 * Containers in order of preference: WebM (VP9, then VP8) where the browser records it — Chrome on Android — and
 * MP4 (H.264) where it records only that — Safari on iOS. ffmpeg reads both (scripts/capture/recording-to-feed.mjs).
 */
export const RAW_RECORDING_MIME_PREFERENCE: readonly string[] = [
  "video/webm;codecs=vp9",
  "video/webm;codecs=vp8",
  "video/webm",
  "video/mp4;codecs=avc1.640028",
  "video/mp4;codecs=avc1",
  "video/mp4",
];

/** The first preferred container the browser can record, or "" to let it choose its own default. */
export function pickRecordingMime(isTypeSupported: (mime: string) => boolean): string {
  for (const mime of RAW_RECORDING_MIME_PREFERENCE) {
    try {
      if (isTypeSupported(mime)) return mime;
    } catch {
      // A browser that throws on the question cannot record that type either.
    }
  }
  return "";
}

/** The file's extension for a recorded type: mp4 for MP4, webm otherwise (WebM is every other recorder's default). */
export function recordingExtension(mime: string): "mp4" | "webm" {
  return /mp4/i.test(mime) ? "mp4" : "webm";
}

/**
 * The download's name: `raw-phone-<local date and time>.<ext>` — exactly the fixtures name the measurements look for
 * (fixtures/private/video/raw-phone-*.webm|mp4), so the file can be dropped in as it comes off the phone.
 */
export function recordingFileName(mime: string, at: Date): string {
  const pad = (n: number): string => String(n).padStart(2, "0");
  const stamp = `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}T${pad(at.getHours())}-${pad(at.getMinutes())}-${pad(at.getSeconds())}`;
  return `raw-phone-${stamp}.${recordingExtension(mime)}`;
}

/** What the camera delivered, read off the recorded track (MediaTrackSettings), for the description and the record. */
export interface RecordedTrack {
  readonly width: number | null;
  readonly height: number | null;
  readonly frameRate: number | null;
  readonly facingMode: string | null;
}

/** One line describing a finished recording: length, the camera's resolution and rate, the container, the size. */
export function describeRecording(input: { readonly durationMs: number; readonly bytes: number; readonly mime: string; readonly track: RecordedTrack }): string {
  const parts = [`${(input.durationMs / 1000).toFixed(1)} s`];
  if (input.track.width !== null && input.track.height !== null) parts.push(`${input.track.width}×${input.track.height}`);
  if (input.track.frameRate !== null) parts.push(`${Math.round(input.track.frameRate)} fps`);
  if (input.track.facingMode !== null) parts.push(input.track.facingMode === "environment" ? "back camera" : input.track.facingMode === "user" ? "front camera" : input.track.facingMode);
  const codec = /codecs=([^;]+)/.exec(input.mime)?.[1]?.split(".")[0];
  parts.push(`${recordingExtension(input.mime).toUpperCase()}${codec === undefined ? "" : ` ${codec.toUpperCase()}`}`);
  parts.push(`${(input.bytes / 1_000_000).toFixed(1)} MB`);
  return parts.join(" · ");
}
