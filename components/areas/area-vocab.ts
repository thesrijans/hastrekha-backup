/**
 * The words and numbers the area UI is allowed to use.
 *
 * Kept out of the components for two reasons. Copy this careful should be reviewable in one place
 * rather than hunted through JSX — every string here is a claim about someone's life, and the
 * difference between "yeh sanket deta hai" and a prediction is the whole product. And the rule-pool
 * counts are DERIVED DATA that must not silently drift from the generated map; a test asserts them
 * against `data/areas/area-map.v1.json` rather than trusting this file.
 *
 * Pure data and pure functions only — no React — so the test can exercise the logic without a DOM.
 */
import type { PublicAreaVerdict } from "@/app/read/reading-types";

/** Fixed render order. Matches AREA_IDS in lib/hastrekha/area-types.ts. */
export const AREA_ORDER: readonly string[] = ["dhan", "rishte", "karm", "sehat", "swabhav"];

/**
 * How many mapped rules exist per area — the ceiling a full scan could reach.
 *
 * Duplicated from `data/areas/area-map.v1.json` because the client never loads the 111 KB map, and
 * used ONLY to say "N aur sanket khul sakte hain". `test/area-ui.test.ts` asserts every number
 * against the committed map, so a rebuild that changes the pool fails the suite instead of quietly
 * making the scan CTA lie.
 */
export const AREA_RULE_POOL: Readonly<Record<string, number>> = {
  dhan: 67,
  rishte: 93,
  karm: 135,
  sehat: 57,
  swabhav: 218,
};

/**
 * Direction, in the app's voice.
 *
 * `sambhalke` is "handle with care", not "bad". The KB's safety policy softens its harsher sources
 * on purpose, and a chip reading "Bura" would undo that in one word.
 */
export const DIRECTION_COPY: Readonly<Record<string, string>> = {
  anukool: "Anukool",
  mishrit: "Mishrit",
  sambhalke: "Sambhal ke",
};

/** Band, in the app's voice. INSUFFICIENT has no phrase — that card says something else entirely. */
export const BAND_COPY: Readonly<Record<string, string>> = {
  HIGH: "Prabal sanket",
  MEDIUM: "Madhyam sanket",
  LOW: "Halke sanket",
};

/** Shown when the evidence is real but does not lean. Not a hedge — a refusal to invent one. */
export const NO_DIRECTION_COPY = "Sanket mile, jhukav saaf nahi";
/** Shown when there is not enough to say anything. Inviting, not apologetic — this is the CTA. */
export const NEED_MORE_COPY = "Itne se pakka nahi kaha ja sakta.";
/** Shown when an area's evidence points both ways. The tension is the finding, not a defect. */
export const CONFLICT_COPY = "Haath dono taraf ishara karta hai";

/** Above this share of opposing mass the detail view splits the evidence into two groups. */
export const CONFLICT_SPLIT_GATE = 0.3;

export type AreaCardState = "verdict" | "no-direction" | "need-more-data";

/**
 * Which of the three cards to draw.
 *
 * The states are not severity levels, they are different KINDS of answer: a verdict, an observation
 * without a lean, and an invitation to give the reading something to work with.
 */
export function cardStateFor(verdict: PublicAreaVerdict): AreaCardState {
  if (verdict.band === "INSUFFICIENT") return "need-more-data";
  if (verdict.direction === null) return "no-direction";
  return "verdict";
}

/**
 * Tailwind classes for the direction chip. The one place in this UI that is allowed to use colour
 * as meaning — orange for care, cyan for favourable, muted for mixed.
 */
export function directionChipClass(direction: string | null): string {
  const base = "rounded-full border px-2.5 py-0.5 font-display text-[0.65rem] uppercase tracking-[0.16em]";
  if (direction === "anukool") return `${base} border-mount-glow/40 bg-mount-glow/10 text-mount-glow`;
  if (direction === "sambhalke") return `${base} border-line-glow/40 bg-line-glow/10 text-line-glow`;
  return `${base} border-hairline text-muted`;
}

/** Every evidence row scored for this area, whatever the tier was allowed to show. */
export function totalEvidence(verdict: PublicAreaVerdict): number {
  return verdict.evidence.length + verdict.lockedEvidenceCount;
}

/**
 * How many more signs a scan could surface for this area.
 *
 * Pool minus what actually fired — and `totalEvidence`, not `evidence.length`, because the free
 * tier only receives two rows and would otherwise be promised the locked ones twice. Clamped at 0:
 * a negative "−3 aur sanket" would be worse than saying nothing.
 */
export function remainingSignals(verdict: PublicAreaVerdict): number {
  const pool = AREA_RULE_POOL[verdict.area] ?? 0;
  return Math.max(0, pool - totalEvidence(verdict));
}

/** "Cheiro (1916)" — the chip on an evidence row. Year is dropped when the source has none. */
export function citationChip(source: { readonly text: string; readonly year: number | null }): string {
  const book = source.text.split("—")[0].trim();
  return source.year === null ? book : `${book} (${source.year})`;
}
