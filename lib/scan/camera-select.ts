/**
 * Camera selection (M1.1) — which camera the chamber opens, and the ONE mirror flag that follows it.
 *
 * ── THE FLAG ──
 *
 * `mirroredFor(facing)` is the only place a mirror is decided. A front camera's preview is mirrored,
 * because the reader expects a mirror when they look at themselves; a back camera's is not, because
 * it sees what the reader sees. Everything that is about the SCREEN reads that one value and nothing
 * else: the CSS flip on the <video>, the overlay's cover transform, and the tilt direction a pose asks
 * for (`palmTilt`, which is written in what the reader sees).
 *
 * ── WHAT DOES NOT READ IT, AND WHY ──
 *
 * The palm-facing gate. MediaPipe is always handed the RAW camera frame — whichever camera took it,
 * the pipeline never flips pixels — and a back camera's photograph of a palm is the same kind of image
 * as a front camera's: the palmar surface, seen from in front of it. Measured on the 15 raw session
 * stills of a right hand (front camera): thumb on the image's RIGHT, MediaPipe's label "Right" (0.97),
 * winding negative — and a back camera looking at the same palm from the reader's side sees the same.
 * So the label and the winding pair up identically through either camera, and the gate's pairing
 * (lib/scan/quality.ts) is a property of the pipeline's input, not of the preview. Keyed to the preview
 * flag, as it was while only the front camera existed, it would have expected the opposite winding on
 * the back camera and failed every confidently-labelled palm as the back of a hand.
 *
 * Pure: no DOM, no MediaDevices. The hook gathers the signals and calls these.
 */

export type CameraFacing = "user" | "environment";

/** THE mirror flag: the front camera's preview is a mirror, the back camera's never is. */
export function mirroredFor(facing: CameraFacing): boolean {
  return facing === "user";
}

/** The other camera. */
export function flipTarget(facing: CameraFacing): CameraFacing {
  return facing === "user" ? "environment" : "user";
}

/* --------------------------------- The device --------------------------------- */

/** What the hook can read about the device, as plain values so the decision can be tested anywhere. */
export interface PhoneSignals {
  readonly userAgent: string;
  /** `navigator.userAgentData.mobile` — Chromium only; null where the browser does not say. */
  readonly uaDataMobile: boolean | null;
}

/**
 * Whether this is a phone — the device on which the back camera is the natural way to read a palm.
 *
 * Tablets are deliberately NOT phones here: a tablet's back camera means holding a slab over your own
 * hand, and its front camera is where a reader already looks. Client hints decide when the browser
 * offers them (Chromium sets `mobile` for phones and not for tablets); otherwise the user agent's own
 * mobile token does. A laptop with a touchscreen answers false on both.
 */
export function isPhone(signals: PhoneSignals): boolean {
  if (signals.uaDataMobile !== null) return signals.uaDataMobile;
  const ua = signals.userAgent;
  if (/iPhone|iPod/.test(ua)) return true;
  if (/Android/.test(ua)) return /Mobile/.test(ua);
  return /Mobi|Windows Phone/.test(ua);
}

/** Where the chamber starts: the back camera on a phone, the front camera everywhere else. */
export function preferredFacing(phone: boolean): CameraFacing {
  return phone ? "environment" : "user";
}

/**
 * Which way the camera that actually opened is facing.
 *
 * Asked for, not assumed: `facingMode: { ideal: "environment" }` on a laptop quietly opens the only
 * webcam there is, and the mirror must follow the camera that opened, not the one that was requested.
 * `getSettings().facingMode` answers on phones; where it is absent (most desktop webcams) the label
 * decides — Android labels its cameras "…facing back", iOS "Back Camera". Anything else — a front
 * camera, a laptop webcam, a virtual or fake device, a camera with no label yet — is treated as
 * facing the reader, which is what every camera this app opened was, before M1: mirrored.
 */
export function resolveFacing(reported: string | undefined, label: string): CameraFacing {
  if (reported === "user" || reported === "environment") return reported;
  return /\b(back|rear|environment|world)\b/i.test(label) ? "environment" : "user";
}

/** How many cameras the device offers. Labels need permission; the count does not. */
export function videoInputCount(devices: readonly { readonly kind: string }[]): number {
  return devices.filter((device) => device.kind === "videoinput").length;
}

/* ------------------------------- The constraints ------------------------------- */

export interface CaptureSize {
  readonly captureWidth: number;
  readonly captureHeight: number;
}

/**
 * What to ask `getUserMedia` for.
 *
 * `ideal`, never `exact`, for the first open: a laptop with no back camera must fall back to its front
 * one SILENTLY (M1.5), and `exact` would turn that ordinary absence into an OverconstrainedError the
 * reader is shown. A named device (the flip's second attempt) is asked for exactly, because it was
 * listed a moment ago.
 */
export function cameraConstraints(facing: CameraFacing, size: CaptureSize, deviceId?: string): MediaTrackConstraints {
  const resolution = { width: { ideal: size.captureWidth }, height: { ideal: size.captureHeight } };
  return deviceId === undefined ? { facingMode: { ideal: facing }, ...resolution } : { deviceId: { exact: deviceId }, ...resolution };
}

/** The flip asks for the other camera by name first; `exact` so a device with one camera says so instead of reopening it. */
export function flipConstraints(target: CameraFacing, size: CaptureSize): MediaTrackConstraints {
  return { facingMode: { exact: target }, width: { ideal: size.captureWidth }, height: { ideal: size.captureHeight } };
}

/* ------------------------------ Permission copy ------------------------------ */

/** The browsers whose camera settings are worded differently enough to need their own directions. */
export type BrowserFamily = "chrome-android" | "safari-ios" | "other";

/**
 * Which directions to give a reader who refused the camera.
 *
 * Every browser on iOS is WebKit and keeps camera permission per site in Safari's own "Website
 * Settings" — but Chrome and Firefox on iOS keep theirs in the iOS Settings app, so only Safari gets
 * Safari's wording. iPadOS reports a desktop Mac user agent; touch points give it away.
 */
export function browserFamily(userAgent: string, maxTouchPoints: number): BrowserFamily {
  const ios = /iPhone|iPad|iPod/.test(userAgent) || (/Macintosh/.test(userAgent) && maxTouchPoints > 1);
  if (ios) return /CriOS|FxiOS|EdgiOS|OPiOS/.test(userAgent) ? "other" : "safari-ios";
  if (/Android/.test(userAgent) && /Chrome\//.test(userAgent) && !/EdgA|OPR|SamsungBrowser|Firefox|YaBrowser/.test(userAgent)) {
    return "chrome-android";
  }
  return "other";
}
