/**
 * Whether this tab holds a reading — decided before Home's cards are painted.
 *
 * C5's cards open a chapter of the Pothi when there is a reading to open, and the
 * chamber when there is not ("the card is quiet and opens the chamber instead").
 * The only place a reading lives is this tab's sessionStorage (see
 * app/read/pothi/pothi-client.tsx for why), which the server cannot see.
 *
 * So each card carries both destinations, and a few bytes of inline script — run
 * as the HTML is parsed, before the cards are first painted — mark their
 * container `present` or `absent`. The stylesheet shows the matching link. No
 * card ever flashes the wrong state, and none of this is JavaScript in a bundle.
 *
 * It asks only whether the key is non-empty. Whether the reading inside is valid
 * is the book's question, and a reading the book cannot read opens as a sealed
 * leaf that says why — the honest answer, one tap further in.
 */
import { POTHI_READING_SESSION_KEY } from "@/lib/sanctuary/pothi-reading-store";

export const READING_PRESENCE_ATTRIBUTE = "data-snc-reading";
export type ReadingPresence = "present" | "absent";

/** The same decision as the script, for callers that run after hydration. */
export function readingPresenceOf(stored: string | null): ReadingPresence {
  return stored !== null && stored !== "" ? "present" : "absent";
}

/** The pre-paint script body for the element with `elementId`. Plain ES5: it runs before any bundle. */
export function readingPresencePrePaintScript(elementId: string): string {
  return [
    "(function(){",
    "var el=document.getElementById(" + JSON.stringify(elementId) + ");",
    "if(!el)return;",
    "var present=false;",
    "try{var raw=window.sessionStorage.getItem(" + JSON.stringify(POTHI_READING_SESSION_KEY) + ");present=raw!==null&&raw!=='';}catch(e){}",
    "el.setAttribute(" + JSON.stringify(READING_PRESENCE_ATTRIBUTE) + ",present?'present':'absent');",
    "})();",
  ].join("");
}
