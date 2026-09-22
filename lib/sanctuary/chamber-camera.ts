/**
 * What the chamber says about its camera (M1.5) — written once, here, so the words can be tested.
 *
 * A refused camera is not fixed by a button, so the leaf gives DIRECTIONS: where this reader's own
 * browser keeps the setting, in that browser's own words — Chrome on Android's site-controls icon
 * beside the address, Safari's "aA" menu and its Website Settings, and a generic lock-icon path for
 * everything else. Each direction is a step the reader can follow with the leaf still open. The one
 * control the leaf offers afterwards says what it is for: the reader has changed the setting, and is
 * asking the chamber to try again.
 *
 * "No back camera" has no copy at all, by design: a laptop opening its only webcam is not a failure,
 * and the chamber says nothing about it (lib/scan/camera-select.ts falls back silently).
 *
 * The voice is the chamber's: one Devanagari line, then plain Hinglish for the steps. Setting names
 * are left in the browser's own English — a reader looks for "Permissions", not a translation of it.
 */
import type { BrowserFamily } from "@/lib/scan/camera-select";

export interface CameraDirections {
  /** The chamber's one line, in Devanagari. */
  readonly title: string;
  readonly lead: string;
  readonly steps: readonly string[];
  /** A second way round, where the browser has one. */
  readonly alternative: string | null;
  /** The label of the one control: "I have allowed it — open again". */
  readonly retry: string;
}

export const CAMERA_DENIED_TITLE = "कैमरे की इजाज़त नहीं मिली.";
export const CAMERA_RETRY_LABEL = "Allow kar diya — dobara kholo";

export function cameraDeniedDirections(family: BrowserFamily): CameraDirections {
  switch (family) {
    case "chrome-android":
      return {
        title: CAMERA_DENIED_TITLE,
        lead: "Chrome ne is page ko camera nahi diya. Aise kholo:",
        steps: [
          "Address bar mein URL ke baayein wala icon dabao",
          "Permissions → Camera → Allow",
          "Wapas aakar neeche dabao",
        ],
        alternative: "Ya: ⋮ menu → Settings → Site settings → Camera",
        retry: CAMERA_RETRY_LABEL,
      };
    case "safari-ios":
      return {
        title: CAMERA_DENIED_TITLE,
        lead: "Safari ne is page ko camera nahi diya. Aise kholo:",
        steps: ["Address bar mein aA dabao", "Website Settings → Camera → Allow", "Page reload karo, ya neeche dabao"],
        alternative: "Ya: iPhone Settings → Safari → Camera → Allow",
        retry: CAMERA_RETRY_LABEL,
      };
    case "other":
      return {
        title: CAMERA_DENIED_TITLE,
        lead: "Browser ne is page ko camera nahi diya. Aise kholo:",
        steps: ["Address bar mein lock icon dabao", "Camera → Allow", "Wapas aakar neeche dabao"],
        alternative: null,
        retry: CAMERA_RETRY_LABEL,
      };
  }
}

/**
 * The other ways a camera fails to open, by the DOMException the browser threw. A missing camera and a
 * camera already held by another app are facts the reader can act on, so each gets its own sentence;
 * anything else is the generic one.
 */
export function cameraFailureNote(errorName: string | null): string | null {
  switch (errorName) {
    case "NotFoundError":
    case "OverconstrainedError":
      return "Is device par koi camera nahi mila.";
    case "NotReadableError":
    case "AbortError":
      return "Camera kisi aur app mein khula hai. Use band karke dobara koshish karo.";
    default:
      return null;
  }
}
