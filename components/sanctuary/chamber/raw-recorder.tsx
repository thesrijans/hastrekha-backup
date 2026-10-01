"use client";

/**
 * @file The raw recording mode's browser half (scan-perfect P1, lib/scan/raw-recording.ts): a MediaRecorder on the
 * chamber's own camera stream, and the one mark it adds to the room.
 *
 * `useRawRecorder(stream)` starts the moment the camera is live and stops after RAW_RECORDING_MS, or early if the
 * camera's track ends (a flip, a lost camera) — keeping what it had. The chamber holds completion while it runs: a
 * completion stops the camera, and the recording is the whole 30 s.
 *
 * `<RawRecorderMark>` is all it draws: "● REC 12 s" while it records, then the file — its length, the camera's
 * resolution, the size — to download or share. Nothing is uploaded: the bytes go from the recorder to an object URL
 * on this device and nowhere else.
 *
 * The default export is what the chamber loads, and only under `?record=1` (next/dynamic): a test tool costs a
 * reader's scan nothing.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  describeRecording,
  pickRecordingMime,
  recordingFileName,
  RAW_RECORDING_BITS_PER_SECOND,
  RAW_RECORDING_MS,
  RAW_RECORDING_TIMESLICE_MS,
  type RecordedTrack,
} from "@/lib/scan/raw-recording";
import styles from "./raw-recorder.module.css";

export type RawRecorderState =
  | { readonly kind: "idle" }
  | { readonly kind: "unsupported"; readonly reason: string }
  | { readonly kind: "recording"; readonly startedAt: number; readonly track: RecordedTrack; readonly mime: string }
  | {
      readonly kind: "done";
      readonly url: string;
      readonly file: File;
      readonly description: string;
      readonly durationMs: number;
      readonly track: RecordedTrack;
      /** Ended before RAW_RECORDING_MS — the camera's track stopped. */
      readonly cut: boolean;
    }
  | { readonly kind: "failed"; readonly reason: string };

const trackOf = (track: MediaStreamTrack): RecordedTrack => {
  const settings = track.getSettings?.() ?? {};
  return {
    width: typeof settings.width === "number" ? settings.width : null,
    height: typeof settings.height === "number" ? settings.height : null,
    frameRate: typeof settings.frameRate === "number" ? settings.frameRate : null,
    facingMode: typeof settings.facingMode === "string" ? settings.facingMode : null,
  };
};

/**
 * Record `stream` (the chamber's camera, as opened) once it is live: video only, the preferred container at
 * RAW_RECORDING_BITS_PER_SECOND, for RAW_RECORDING_MS. `again()` drops the finished file and records anew.
 */
export function useRawRecorder(stream: MediaStream | null): { readonly state: RawRecorderState; readonly again: () => void } {
  const [state, setState] = useState<RawRecorderState>({ kind: "idle" });
  const stateRef = useRef<RawRecorderState>(state);
  /** Bumped by `again()`: the only other thing, besides a new stream, that may start a recording. */
  const [generation, setGeneration] = useState(0);
  const mountedRef = useRef(true);
  const update = useCallback((next: RawRecorderState) => {
    stateRef.current = next;
    if (mountedRef.current) setState(next);
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      const current = stateRef.current;
      if (current.kind === "done") URL.revokeObjectURL(current.url);
    };
  }, []);

  useEffect(() => {
    if (stream === null || stateRef.current.kind !== "idle") return;
    const track = stream.getVideoTracks()[0];
    if (track === undefined || track.readyState !== "live") return;
    if (typeof MediaRecorder === "undefined") {
      update({ kind: "unsupported", reason: "Is browser mein video record nahi hota." });
      return;
    }
    const mime = pickRecordingMime((type) => MediaRecorder.isTypeSupported(type));
    let recorder: MediaRecorder;
    try {
      recorder = new MediaRecorder(new MediaStream([track]), {
        ...(mime === "" ? {} : { mimeType: mime }),
        videoBitsPerSecond: RAW_RECORDING_BITS_PER_SECOND,
      });
    } catch (error) {
      update({ kind: "failed", reason: error instanceof Error ? error.message : String(error) });
      return;
    }
    const chunks: Blob[] = [];
    const recordedTrack = trackOf(track);
    const startedAt = performance.now();
    let timedOut = false;
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunks.push(event.data);
    };
    recorder.onstop = () => {
      if (!mountedRef.current) return; // the chamber is gone: nothing to offer, nothing to keep
      const type = recorder.mimeType || mime || "video/webm";
      const blob = new Blob(chunks, { type });
      if (blob.size === 0) {
        update({ kind: "failed", reason: "Recording khaali aayi." });
        return;
      }
      const durationMs = Math.min(RAW_RECORDING_MS, performance.now() - startedAt);
      const file = new File([blob], recordingFileName(type, new Date()), { type });
      update({
        kind: "done",
        url: URL.createObjectURL(blob),
        file,
        description: describeRecording({ durationMs, bytes: blob.size, mime: type, track: recordedTrack }),
        durationMs,
        track: recordedTrack,
        cut: !timedOut,
      });
    };
    recorder.onerror = () => update({ kind: "failed", reason: "Recorder ruk gaya." });
    const stopRecording = (): void => {
      if (recorder.state !== "inactive") recorder.stop();
    };
    const timer = window.setTimeout(() => {
      timedOut = true;
      stopRecording();
    }, RAW_RECORDING_MS);
    // The camera's own end (unplugged, revoked); a flip or the chamber's own stop arrives as a new stream below.
    track.addEventListener("ended", stopRecording);
    recorder.start(RAW_RECORDING_TIMESLICE_MS);
    update({ kind: "recording", startedAt, track: recordedTrack, mime: recorder.mimeType || mime });
    return () => {
      // A new stream (a flip), or the chamber leaving: what was recorded is kept, cut where it stopped.
      window.clearTimeout(timer);
      track.removeEventListener("ended", stopRecording);
      stopRecording();
    };
  }, [stream, generation, update]);

  const again = useCallback(() => {
    const current = stateRef.current;
    if (current.kind === "done") URL.revokeObjectURL(current.url);
    update({ kind: "idle" });
    setGeneration((g) => g + 1);
  }, [update]);

  return { state, again };
}

/** "● REC 12 s", ticking on its own clock so the chamber is not re-rendered four times a second for it. */
function Elapsed({ startedAt }: { readonly startedAt: number }) {
  const [now, setNow] = useState(() => performance.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(performance.now()), 250);
    return () => window.clearInterval(timer);
  }, []);
  return <>{Math.min(RAW_RECORDING_MS / 1000, Math.floor((now - startedAt) / 1000))} s</>;
}

/** The recording mode's only mark on the room, and — once the file exists — its download and share. */
export function RawRecorderMark({ state, onAgain }: { readonly state: RawRecorderState; readonly onAgain: () => void }) {
  const file = state.kind === "done" ? state.file : null;
  // A file exists only after a recording on this device — never in a server render — so this is read in render.
  const canShare = useMemo(
    () => file !== null && typeof navigator !== "undefined" && typeof navigator.canShare === "function" && navigator.canShare({ files: [file] }),
    [file],
  );
  const share = useCallback(() => {
    if (file === null) return;
    void navigator.share({ files: [file], title: file.name }).catch(() => undefined);
  }, [file]);

  if (state.kind === "idle") return null;
  if (state.kind === "recording") {
    return (
      <p className={styles.mark} data-snc-rec="recording" data-snc-rec-mime={state.mime} role="status">
        <span className={styles.dot} aria-hidden="true" />
        REC <Elapsed startedAt={state.startedAt} />
      </p>
    );
  }
  if (state.kind === "done") {
    return (
      <div
        className={styles.card}
        data-snc-rec="done"
        data-snc-rec-file={state.file.name}
        data-snc-rec-bytes={state.file.size}
        data-snc-rec-duration={Math.round(state.durationMs)}
        data-snc-rec-width={state.track.width ?? ""}
        data-snc-rec-height={state.track.height ?? ""}
        data-snc-rec-cut={state.cut ? "1" : "0"}
      >
        <p className={styles.title}>कच्ची रिकॉर्डिंग तैयार · Raw recording</p>
        <p className={styles.detail}>{state.description}</p>
        {state.cut ? <p className={styles.detail}>Camera beech mein ruk gaya — jitna mila, utna.</p> : null}
        <p className={styles.detail}>Sirf is device par · kabhi upload nahi.</p>
        <div className={styles.actions}>
          <a className={styles.action} href={state.url} download={state.file.name} data-snc-rec-action="download">
            सहेजें · Download
          </a>
          {canShare ? (
            <button type="button" className={styles.action} onClick={share} data-snc-rec-action="share">
              भेजें · Share
            </button>
          ) : null}
          <button type="button" className={styles.action} onClick={onAgain} data-snc-rec-action="again">
            फिर से · Again
          </button>
        </div>
      </div>
    );
  }
  return (
    <p className={styles.mark} data-snc-rec={state.kind}>
      REC — {state.reason}
    </p>
  );
}

/**
 * The recording mode as one piece, for the chamber to load on demand: it records `stream` and draws its mark, and
 * tells the chamber whether it is recording — while it is, nothing completes (a completion stops the camera).
 */
export default function RawRecorder({ stream, onRecordingChange }: { readonly stream: MediaStream | null; readonly onRecordingChange: (recording: boolean) => void }) {
  const { state, again } = useRawRecorder(stream);
  const recording = state.kind === "recording";
  useEffect(() => {
    onRecordingChange(recording);
  }, [recording, onRecordingChange]);
  return <RawRecorderMark state={state} onAgain={again} />;
}
