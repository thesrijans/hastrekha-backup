/**
 * Wisdom of the day — C6's verse, and the table it will one day be drawn from.
 *
 * [A2] ONE VERSE, AND IT SAYS SO. The brief asks for a single public-domain
 * verse "marked as the seed", and "never a fabricated rotation": a card that
 * appeared to change daily while really cycling a list somebody typed from
 * memory would be the exact confident-looking falsehood A2 forbids. So there is
 * one entry, the selector returns it every day, and nothing pretends otherwise.
 *
 * THE VERSE is the morning prayer recited on first looking at one's hands — the
 * one verse in the tradition that is about the palm itself, which is why it is
 * the seed. It is traditional and anonymous, and the English is a plain
 * rendering written for this card rather than quoted from a translator.
 *
 * TODO(verse-table): replace the single seed with a reviewed table — each verse
 * with its source text, a checked transliteration and a translator credit — and
 * a selector keyed to the calendar date. Until that table exists and has been
 * reviewed, this stays one verse.
 */

export interface WisdomVerse {
  readonly id: string;
  /** The two half-verses, each ending in its own danda. Set in Tiro, never letter-spaced. */
  readonly sanskrit: readonly [string, string];
  readonly translation: string;
  readonly attribution: string;
}

export const WISDOM_SEED_VERSE: WisdomVerse = {
  id: "karagre-vasate-lakshmih",
  sanskrit: ["कराग्रे वसते लक्ष्मीः करमध्ये सरस्वती ।", "करमूले तु गोविन्दः प्रभाते करदर्शनम् ॥"],
  translation:
    "At the fingertips dwells Lakshmi, at the palm’s centre Saraswati, and at its root Govinda — so, at dawn, look upon your hands.",
  attribution: "Traditional Sanskrit verse, recited on waking",
};

export const WISDOM_VERSES: readonly WisdomVerse[] = [WISDOM_SEED_VERSE];

/** Today's verse. One verse exists, so it is always that one. */
export function wisdomOfTheDay(): WisdomVerse {
  return WISDOM_VERSES[0];
}
