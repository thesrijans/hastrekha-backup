/**
 * SEEDED RANDOMNESS — the only source of variation in the material system.
 *
 * WHY `Math.random` IS BANNED HERE, NOT MERELY DISCOURAGED.
 *
 * Every irregular thing in this design language is irregular in a way the server
 * has to agree with: a torn edge is a `clip-path` computed from offsets, a wax
 * seal is a lobed polygon, a stain sits at a position. All of that is markup.
 * `renderToString` runs on the server, hydration re-runs the same component in
 * the browser, and if the two disagree by one decimal React discards the server
 * HTML for that subtree and re-renders it — so a `Math.random()` torn edge costs
 * a hydration mismatch warning, a visible re-paint of the panel, and a shape
 * that changes every time the page is refreshed. A leaf that re-tears itself on
 * every navigation is not a material.
 *
 * So variation is addressed instead: a component takes a `seed: number`, and the
 * same seed produces the same shape forever, on both sides of the wire. The seed
 * is usually something the caller already has — a chapter index, a reading id
 * hashed down, the position in a bundle — which is also how two leaves next to
 * each other are guaranteed to differ.
 *
 * WHY MULBERRY32.
 *
 * It is eleven lines, has no state beyond one 32-bit integer, passes gjrand and
 * the small-crush suites at this size, and — the property that actually matters
 * here — it is defined entirely in terms of `|0`, `>>>` and `Math.imul`, which
 * are exact in every JavaScript engine. A generator written with floating-point
 * arithmetic could drift between V8 and JavaScriptCore in the last bits, and the
 * last bits are exactly what a 4px jitter is made of.
 */

/** 2^32, the divisor that turns the generator's unsigned 32-bit output into a fraction below 1. */
const UINT32_RANGE = 4294967296;

/**
 * Any number in, a usable 32-bit integer seed out.
 *
 * Callers pass whatever they have — an index, a timestamp, a hash, occasionally
 * a `NaN` from a parse that failed upstream — and none of those should be able
 * to produce a generator that returns `NaN` forever. `Math.imul` on a non-finite
 * value yields 0, so an unnormalised NaN seed degrades to *one* fixed sequence
 * silently; normalising here makes that explicit and keeps fractional seeds
 * (2.5) from being a different stream than their truncation, which no caller
 * would expect.
 */
function normaliseSeed(seed: number): number {
  return Number.isFinite(seed) ? Math.trunc(seed) | 0 : 0;
}

/**
 * A deterministic pseudo-random stream: the same seed yields the same sequence,
 * in this process, in the next one, and on the server and the client.
 *
 * Returns a generator rather than a `nth(seed, i)` function on purpose. The
 * shapes this drives — a torn edge, a lobed blob — are sequences of related
 * draws, and a stateless indexed API invites callers to reuse index 0 in two
 * places and wonder why two ornaments line up.
 *
 * The result is always in `[0, 1)`, never 1, so `Math.floor(r() * n)` is a safe
 * index and `r() * amplitude` never exceeds the amplitude.
 */
export function seededRandom(seed: number): () => number {
  let state = normaliseSeed(seed);
  return (): number => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / UINT32_RANGE;
  };
}

/**
 * `count` signed offsets in `[-amplitude, +amplitude]`, stable for a given seed.
 *
 * This is the shared primitive under both irregular shapes in the system. A torn
 * edge is a run of points along a straight line, each nudged off it by one of
 * these; a wax seal is a ring of 8–12 points, each nudged off the circle by one
 * of these. Both need the same three things: symmetry about zero (a one-sided
 * jitter grows or shrinks the shape instead of roughening it), a hard bound (the
 * caller reserves padding for exactly this much travel — see
 * `SNC_TORN_BLEED_PX`), and stability across renders.
 *
 * Defensive edges rather than throws, because this runs during render on both
 * the server and the client, and a thrown exception in a decoration is a blank
 * page instead of a slightly wrong ornament: a non-positive or non-finite
 * `count` produces an empty array (an ornament with no points renders nothing),
 * and a negative or non-finite `amplitude` is treated as zero (offsets of zero
 * produce the clean shape, which is a graceful thing to fall back to and can
 * never exceed a bound).
 */
export function seededJitter(seed: number, count: number, amplitude: number): number[] {
  if (!Number.isFinite(count) || count <= 0) return [];
  const bound = Number.isFinite(amplitude) && amplitude > 0 ? amplitude : 0;
  const next = seededRandom(seed);
  const offsets: number[] = [];
  for (let i = 0; i < Math.floor(count); i += 1) {
    offsets.push((next() * 2 - 1) * bound);
  }
  return offsets;
}
