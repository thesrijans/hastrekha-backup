/**
 * "Explore your path" — Home's five cards, and the chapter each one opens.
 *
 * The five come from the home reference (Personality · Career · Relationships ·
 * Wealth · Life Path), and every one of them is a chapter the Pothi already has:
 * four are the life areas the backend genuinely scores (VIII–XI), and Life Path
 * is chapter XIII, Life Direction. Nothing here invents a sixth destination or
 * a chapter the book does not contain — a card that opened onto nothing would be
 * the empty-promise failure A2 exists to prevent.
 *
 * WITH NO READING YET, the card opens the Chamber instead. A chapter of a book
 * that has not been written can only be a sealed leaf, and sending a reader to a
 * seal from the front door is sending them to "no" when the honest answer is
 * "not yet — begin here".
 */
import type { SanctuaryIconName } from "@/components/sanctuary/sanctuary-icons";
import { POTHI_CHAPTERS } from "@/lib/sanctuary/pothi-chapters";
import { pothiChapterHref } from "@/lib/sanctuary/pothi-deep-link";
import { SANCTUARY_CHAMBER_HREF } from "@/lib/sanctuary/routes";

export interface HomePath {
  readonly id: "personality" | "career" | "relationships" | "wealth" | "life-path";
  /** The card's label, in the reference's own words. */
  readonly label: string;
  /** The chapter's title in Devanagari, read from the chapter table rather than retyped. */
  readonly labelHi: string;
  readonly icon: SanctuaryIconName;
  /** The Pothi chapter this card opens. */
  readonly numeral: string;
  /** Where the card goes when a reading exists in this tab. */
  readonly chapterHref: string;
  /** Where it goes when none does. */
  readonly quietHref: string;
}

const PATHS: readonly (readonly [HomePath["id"], string, SanctuaryIconName, string])[] = [
  ["personality", "Personality", "meditation", "X"],
  ["career", "Career", "satchel", "IX"],
  ["relationships", "Relationships", "hearts", "VIII"],
  ["wealth", "Wealth", "coins", "XI"],
  ["life-path", "Life Path", "compass", "XIII"],
];

/** The five cards, in the reference's order. */
export const HOME_PATHS: readonly HomePath[] = PATHS.map(([id, label, icon, numeral]) => {
  const chapter = POTHI_CHAPTERS.find((entry) => entry.numeral === numeral);
  if (chapter === undefined) throw new Error(`home path ${id} names chapter ${numeral}, which the Pothi does not have`);
  return {
    id,
    label,
    labelHi: chapter.titleHi,
    icon,
    numeral,
    chapterHref: pothiChapterHref(numeral),
    quietHref: SANCTUARY_CHAMBER_HREF,
  };
});
