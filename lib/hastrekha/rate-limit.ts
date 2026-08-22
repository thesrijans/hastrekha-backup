/**
 * In-memory sliding-window rate limiter.
 * Per server instance (fine for launch on Vercel functions); replace `store` with a shared KV when needed.
 */

const MAX_TRACKED_KEYS = 10_000;
const store = new Map<string, number[]>();

export interface RateLimitDecision {
  readonly allowed: boolean;
  readonly remaining: number;
  readonly retryAfterSeconds: number;
}

function evictIfNeeded(): void {
  if (store.size < MAX_TRACKED_KEYS) return;
  const oldestKey = store.keys().next().value;
  if (oldestKey !== undefined) store.delete(oldestKey);
}

/** Returns whether `key` may proceed given `max` hits per `windowMs`. */
export function checkRateLimit(key: string, max: number, windowMs: number, now: number = Date.now()): RateLimitDecision {
  const cutoff = now - windowMs;
  const hits = (store.get(key) ?? []).filter((timestamp) => timestamp > cutoff);
  if (hits.length >= max) {
    const retryAfterSeconds = Math.max(1, Math.ceil((hits[0] + windowMs - now) / 1000));
    store.set(key, hits);
    return { allowed: false, remaining: 0, retryAfterSeconds };
  }
  hits.push(now);
  evictIfNeeded();
  store.set(key, hits);
  return { allowed: true, remaining: max - hits.length, retryAfterSeconds: 0 };
}

/** Test helper. */
export function resetRateLimits(): void {
  store.clear();
}
