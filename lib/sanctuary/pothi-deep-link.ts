/**
 * Opening the Pothi at a named chapter.
 *
 * Home's five "Explore your path" cards each belong to one chapter of the book,
 * and until now the book could only ever open at leaf I: `PothiBook` started its
 * index at zero and nothing outside it could say otherwise. This is the whole of
 * the mechanism — a query parameter carrying the chapter's Roman numeral, and a
 * pure function turning it back into a leaf index — kept out of the components so
 * a Node test can pin it without a browser.
 *
 * THE NUMERAL, NOT THE AREA ID OR AN INDEX. The numeral is the chapter's identity
 * everywhere else in the product (the launch seals are keyed by it, the folio
 * prints it), an index would silently point at the wrong leaf the day a chapter
 * is inserted, and an area id cannot name the structural chapters at all.
 */
import { POTHI_CHAPTERS } from "@/lib/sanctuary/pothi-chapters";
import { SANCTUARY_POTHI_HREF } from "@/lib/sanctuary/routes";

/** The query parameter the chapter travels on. */
export const POTHI_CHAPTER_PARAM = "chapter";

/** `/read/pothi?chapter=X` for a chapter numeral. An unknown numeral still produces the plain route. */
export function pothiChapterHref(numeral: string): string {
  const known = POTHI_CHAPTERS.some((chapter) => chapter.numeral === numeral);
  return known ? `${SANCTUARY_POTHI_HREF}?${POTHI_CHAPTER_PARAM}=${encodeURIComponent(numeral)}` : SANCTUARY_POTHI_HREF;
}

/**
 * The leaf index a `?chapter=` value asks for.
 *
 * Anything unrecognised — absent, empty, lower-case, a numeral the book does not
 * have — opens at leaf I, which is where the book opens with no parameter at
 * all. A link that cannot be honoured degrades to the ordinary front of the book
 * rather than to an error or to a guess at what was meant.
 */
export function pothiChapterIndex(value: string | null | undefined): number {
  if (value === null || value === undefined || value === "") return 0;
  const index = POTHI_CHAPTERS.findIndex((chapter) => chapter.numeral === value);
  return index < 0 ? 0 : index;
}
