import type { BirthWindow, DateRange, MountBirthWindows } from "./types";

/** Day-of-year index (1..366) for an MM-DD string using a leap-year calendar so 02-29 resolves. */
const CUMULATIVE_DAYS: readonly number[] = [0, 31, 60, 91, 121, 152, 182, 213, 244, 274, 305, 335];
const DAYS_IN_LEAP_YEAR = 366;
const MMDD_PATTERN = /^(\d{2})-(\d{2})$/;
const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})/;

export type WindowHitKind = "core" | "minor";

export interface WindowHit {
  readonly window: BirthWindow;
  readonly kind: WindowHitKind;
  /** 1.0 for core, minor_weight_multiplier for minor */
  readonly multiplier: number;
}

/**
 * Convert MM-DD to day index. Returns null on malformed input.
 * @example mmddToDay("03-21") === 81
 */
export function mmddToDay(mmdd: string): number | null {
  const match = MMDD_PATTERN.exec(mmdd);
  if (!match) return null;
  const month = Number(match[1]);
  const day = Number(match[2]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return CUMULATIVE_DAYS[month - 1] + day;
}

/** Accepts "YYYY-MM-DD" (or a full ISO timestamp) and returns "MM-DD", or null. */
export function isoToMmdd(iso: string): string | null {
  const match = ISO_DATE_PATTERN.exec(iso);
  if (!match) return null;
  return `${match[2]}-${match[3]}`;
}

/** Inclusive range test that handles ranges crossing Dec 31 → Jan 1. */
export function dayInRange(day: number, range: DateRange): boolean {
  const start = mmddToDay(range.start);
  const end = mmddToDay(range.end);
  if (start === null || end === null) return false;
  if (start <= end) return day >= start && day <= end;
  // wraps the year boundary (e.g. 12-21 → 01-20)
  return day >= start || day <= end;
}

/**
 * Resolve a birth date to every window whose core OR minor range contains it.
 * Core hits take precedence over minor hits for the same window.
 */
export function resolveBirthWindows(
  birthDate: string,
  table: MountBirthWindows,
): readonly WindowHit[] {
  const mmdd = isoToMmdd(birthDate) ?? (MMDD_PATTERN.test(birthDate) ? birthDate : null);
  if (!mmdd) return [];
  const day = mmddToDay(mmdd);
  if (day === null || day > DAYS_IN_LEAP_YEAR) return [];

  const hits: WindowHit[] = [];
  for (const window of table.windows) {
    if (dayInRange(day, window.core)) {
      hits.push({ window, kind: "core", multiplier: 1 });
    } else if (dayInRange(day, window.minor)) {
      hits.push({ window, kind: "minor", multiplier: table.minor_weight_multiplier });
    }
  }
  return hits;
}

/** Convenience: just the window_ids (what user.birth_window conditions test against). */
export function birthWindowIds(hits: readonly WindowHit[]): readonly string[] {
  return hits.map((hit) => hit.window.window_id);
}
