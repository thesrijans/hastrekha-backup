/**
 * The reading half of the Pothi hand-off store.
 *
 * Lifted out of `app/read/pothi/pothi-client.tsx` so it can be imported without
 * dragging React and a CSS-module graph behind it: the scan client writes here,
 * the manuscript reads here, and `test/pothi-handoff.test.ts` exercises both
 * ends under plain `tsx`, which cannot parse a stylesheet. The route file
 * re-exports every symbol, so nothing that imported them before has moved.
 *
 * `sessionStorage`, never the server. prisma/schema.prisma refuses images by
 * design and `/scan` promises the same in its own copy; ruling R3 is what a
 * revisited reading falls back to.
 */
import type { Narration, PublicRule, ReadingResponse } from "@/app/read/reading-types";

export const POTHI_READING_SESSION_KEY = "hastrekha:pothi-reading:v1";

/* ============================== VALIDATION ================================ */

/** A string, with content. An empty title is absent data wearing a present type. */
function isString(value: unknown): value is string {
  return typeof value === "string";
}

/** A finite number. NaN and Infinity are a broken producer, not a low score. */
function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/** An array of strings, and nothing else. */
function isStringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every(isString);
}

/** A plain object — not null, not an array, which `typeof` alone would both call "object". */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** One narration section: a title, a body, and the rule ids it rests on. */
function isSection(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return isString(value.title) && isString(value.body) && isStringArray(value.rule_ids);
}

/** The narration block, engine included — the field R4 gates the "AI Interpretation" row on. */
function isNarration(value: unknown): value is Narration {
  if (!isRecord(value)) return false;
  if (!isString(value.one_liner) || !isString(value.disclaimer)) return false;
  if (value.engine !== "llm" && value.engine !== "template") return false;
  return Array.isArray(value.sections) && value.sections.every(isSection);
}

/** One fired rule, in the shape the leaf and the provenance rows both read. */
function isRule(value: unknown): value is PublicRule {
  if (!isRecord(value)) return false;
  return (
    isString(value.rule_id) &&
    isString(value.category) &&
    isString(value.polarity) &&
    isString(value.interpretation_hi_en) &&
    isFiniteNumber(value.weight) &&
    isString(value.source) &&
    isStringArray(value.tags)
  );
}

/**
 * Is this unknown blob a reading the Pothi may open?
 *
 * STRICT IS THE FEATURE, and the failure it prevents is not a crash. A
 * half-valid response renders a HALF-BOOK: chapters that resolve, chapters that
 * throw halfway through a map, seals whose derived detail quotes `undefined`.
 * Every one of those looks like a finished page, and a plausible wrong page is
 * exactly what this build exists to prevent. So every branch rejects the WHOLE
 * blob rather than repairing part of it, and the caller then gets the one
 * honest answer available: absent.
 *
 * `areas` is checked for SHAPE ONLY — it is optional on `ReadingResponse` (an
 * older cached response predates area scoring) and the data layer already seals
 * every chapter that needs it and does not find it. Requiring it here would
 * turn a reading that legitimately has none into no reading at all.
 */
export function isReadingResponse(value: unknown): value is ReadingResponse {
  if (!isRecord(value)) return false;

  if (value.readingId !== null && !isString(value.readingId)) return false;
  if (!isNarration(value.narration)) return false;
  if (!Array.isArray(value.rules) || !value.rules.every(isRule)) return false;
  if (!Array.isArray(value.clusters)) return false;
  if (!isFiniteNumber(value.lockedRuleCount) || !isFiniteNumber(value.confidence)) return false;
  if (value.areas !== undefined && !Array.isArray(value.areas)) return false;

  const coverage = value.coverage;
  if (!isRecord(coverage)) return false;
  if (!isStringArray(coverage.provided) || !isStringArray(coverage.missing)) return false;
  return isFiniteNumber(coverage.ratio);
}

/* ================================ STORAGE ================================= */

/**
 * The slice of `Storage` this module uses.
 *
 * Narrowed to two methods for the reason pothi-geometry.ts narrows it: a test
 * can hand over four lines of object — one that returns null, one that returns
 * rubbish, one that throws — and nothing here can quietly start calling
 * `clear()` on the reader's session.
 */
export type PothiReadingStorage = Pick<Storage, "getItem" | "setItem">;

/**
 * `window.sessionStorage`, or null.
 *
 * The property ACCESS itself throws under some privacy settings — Safari's
 * private mode and "block all cookies" both raise a SecurityError before any
 * method is called — so the guard has to be a try/catch and not a `typeof`
 * check. On the server there is no `window` at all, which is the ordinary case
 * during SSR rather than an error.
 */
export function sessionStorageOrNull(): PothiReadingStorage | null {
  try {
    if (typeof window === "undefined") return null;
    return window.sessionStorage;
  } catch {
    return null;
  }
}

/**
 * The reading this tab is holding, or null.
 *
 * NULL IS AN ORDINARY ANSWER: a fresh tab, a private-mode browser, a reading
 * made before this key existed and a corrupted blob all produce it, and the
 * book has an honest rendering for every one. Nothing here logs, throws or
 * reports — a decoration that crashed the page it decorates would be a worse
 * outcome than a sealed bundle.
 *
 * @param storage injectable for tests; defaults to `window.sessionStorage`
 */
export function readPothiReading(
  storage: PothiReadingStorage | null = sessionStorageOrNull(),
): ReadingResponse | null {
  if (storage === null) return null;
  let raw: string | null;
  try {
    raw = storage.getItem(POTHI_READING_SESSION_KEY);
  } catch {
    return null;
  }
  if (raw === null) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  return isReadingResponse(parsed) ? parsed : null;
}

/**
 * Hand a reading to the Pothi. Returns whether it was actually stored.
 *
 * THE MISSING CALLER IS THE POINT. Nothing in this repo calls this yet, because
 * the two places that hold a fresh response — app/read/read-client.tsx and
 * app/scan/scan-client.tsx — are owned elsewhere in this build. It is exported
 * so that wiring is one import and one line rather than a second, subtly
 * different, serialisation written at each site.
 *
 * VALIDATED BEFORE WRITING, which looks redundant beside
 * {@link readPothiReading} and is not: a blob our own reader would reject is a
 * blob that silently becomes "no reading" on the next page. Failing here is a
 * bug at the producer; failing there is a mystery at the book.
 *
 * A `false` return is not always a bug — a full quota and a private-mode tab
 * both land here — so treat it as "the Pothi will show the sealed bundle",
 * never as an exception.
 */
export function writePothiReading(
  reading: ReadingResponse,
  storage: PothiReadingStorage | null = sessionStorageOrNull(),
): boolean {
  if (storage === null || !isReadingResponse(reading)) return false;
  try {
    storage.setItem(POTHI_READING_SESSION_KEY, JSON.stringify(reading));
    return true;
  } catch {
    /* QuotaExceededError, and Safari's private mode which throws on any write. */
    return false;
  }
}
