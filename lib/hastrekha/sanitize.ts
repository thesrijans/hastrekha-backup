import type { FeatureBag, FeatureScalar, RuleCategory } from "./types";
import type { ReadingTier } from "./narrator";

const MAX_PAYLOAD_BYTES = 16 * 1024;
const MAX_QUESTION_CHARS = 500;
const MAX_NAME_CHARS = 60;
const MAX_KEYS_PER_GROUP = 64;
const MAX_KEY_CHARS = 48;
const MAX_STRING_VALUE_CHARS = 40;
const CONTROL_CHARS = /[\u0000-\u001F\u007F]/g;
const SAFE_KEY = /^[a-z][a-z0-9_]*$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Top-level feature groups the engine understands. Anything else is dropped silently. */
const ALLOWED_GROUPS: ReadonlySet<string> = new Set([
  "mounts", "lines", "hand", "fingers", "thumb", "nails", "signs", "marks", "skin", "context", "reading",
]);
const TIERS: ReadonlySet<string> = new Set<ReadingTier>(["free", "premium", "deep"]);
const CATEGORIES: ReadonlySet<string> = new Set<RuleCategory>([
  "career", "love", "wealth", "personality", "vitality", "timing", "travel", "obstacles", "children", "protection", "reading_method",
]);

export interface ReadingRequest {
  readonly features: FeatureBag;
  readonly tier: ReadingTier;
  readonly question?: string;
  readonly userName?: string;
  readonly categories?: readonly RuleCategory[];
}

export type SanitizeOutcome =
  | { readonly ok: true; readonly request: ReadingRequest }
  | { readonly ok: false; readonly error: string };

function cleanString(value: string, max: number): string {
  return value.replace(CONTROL_CHARS, "").trim().slice(0, max);
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

function sanitizeScalar(value: unknown): FeatureScalar | null {
  if (typeof value === "number") return clamp01(value);
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const cleaned = cleanString(value, MAX_STRING_VALUE_CHARS);
    return cleaned === "" ? null : cleaned;
  }
  return null;
}

/** Recursively sanitise a feature group (depth ≤ 3, e.g. lines.head.quality). */
function sanitizeGroup(value: unknown, depth: number): FeatureBag | null {
  if (typeof value !== "object" || value === null || Array.isArray(value) || depth > 3) return null;
  const out: Record<string, FeatureScalar | FeatureBag | readonly FeatureScalar[]> = {};
  let count = 0;
  for (const [rawKey, rawValue] of Object.entries(value as Record<string, unknown>)) {
    if (count >= MAX_KEYS_PER_GROUP) break;
    const key = rawKey.slice(0, MAX_KEY_CHARS);
    if (!SAFE_KEY.test(key)) continue;
    if (Array.isArray(rawValue)) {
      const items = rawValue.map(sanitizeScalar).filter((item): item is FeatureScalar => item !== null);
      if (items.length > 0) { out[key] = items; count += 1; }
      continue;
    }
    const scalar = sanitizeScalar(rawValue);
    if (scalar !== null) { out[key] = scalar; count += 1; continue; }
    const nested = sanitizeGroup(rawValue, depth + 1);
    if (nested && Object.keys(nested).length > 0) { out[key] = nested; count += 1; }
  }
  return out;
}

/**
 * Validate and sanitise a raw JSON body for POST /api/reading.
 * `user` is rebuilt from scratch — only birth_date (YYYY-MM-DD) is accepted from the client.
 */
export function sanitizeReadingRequest(raw: unknown, rawByteLength: number): SanitizeOutcome {
  if (rawByteLength > MAX_PAYLOAD_BYTES) return { ok: false, error: "payload too large" };
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return { ok: false, error: "body must be an object" };
  const body = raw as Record<string, unknown>;

  const tier = typeof body.tier === "string" && TIERS.has(body.tier) ? (body.tier as ReadingTier) : "free";

  const features: Record<string, FeatureBag> = {};
  if (typeof body.features === "object" && body.features !== null && !Array.isArray(body.features)) {
    for (const [group, value] of Object.entries(body.features as Record<string, unknown>)) {
      if (!ALLOWED_GROUPS.has(group)) continue;
      const cleaned = sanitizeGroup(value, 1);
      if (cleaned && Object.keys(cleaned).length > 0) features[group] = cleaned;
    }
    const user = (body.features as Record<string, unknown>).user;
    if (typeof user === "object" && user !== null) {
      const birthDate = (user as Record<string, unknown>).birth_date;
      if (typeof birthDate === "string" && ISO_DATE.test(birthDate)) {
        features.user = { birth_date: birthDate };
      }
    }
  }
  if (Object.keys(features).length === 0) return { ok: false, error: "no usable features (send mounts/lines/hand or user.birth_date)" };

  const question = typeof body.question === "string" ? cleanString(body.question, MAX_QUESTION_CHARS) : undefined;
  const userName = typeof body.userName === "string" ? cleanString(body.userName, MAX_NAME_CHARS) : undefined;
  const categories = Array.isArray(body.categories)
    ? body.categories.filter((item): item is RuleCategory => typeof item === "string" && CATEGORIES.has(item))
    : undefined;

  return {
    ok: true,
    request: {
      features,
      tier,
      question: question || undefined,
      userName: userName || undefined,
      categories: categories && categories.length > 0 ? categories : undefined,
    },
  };
}
