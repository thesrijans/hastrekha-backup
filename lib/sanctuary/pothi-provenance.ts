/**
 * "Why Hastrekha says this" — the provenance rows, and the rule that they may only name a source
 * that actually fired.
 *
 * The reference composition (docs/reference/ui-reading-lifeline-explainability-card.png) shows three
 * medallions, two of which cite books this knowledge base does not contain. R4 strikes them: the KB
 * holds exactly three source texts — Cheiro's *Palmistry for All* (1916, 377 citations), Dale's
 * *Indian Palmistry* (1895, 171) and one Samudrika line — and a row for anything else would be a
 * fabricated citation printed under a real one. {@link STRUCK_SOURCE_NAMES} names what was struck so
 * the test can prove it never comes back.
 *
 * Three measured facts shape the implementation:
 *
 *  1. **Structured evidence is the only complete record.** `PublicRule.source` is pre-joined to
 *     `"Text (year) — loc"` AND drops everything after `sources[0]`. The single Samudrika citation
 *     lives at `sources[1]` of PALM-FATE-003, so it is INVISIBLE through the joined field and can
 *     only ever be found in `areas[].evidence[].sources`. Detection reads evidence first and falls
 *     back to the joined string only for rules no area evidence covers.
 *
 *  2. **The emitted strings are canonical, never echoed.** A row's `source` is built from this
 *     module's own constants, not from the text that matched it. Echoing would let a source reading
 *     "Cheiro / Brihat Samhita" print a struck name through a legitimate match. Matching is
 *     prefix-based on an allowlist, so an unrecognised text produces no row at all.
 *
 *  3. **`year` can be null on the wire.** `AreaSource.year` is typed `number`, but the Samudrika
 *     entry in `data/kb/hastrekha_kb.json` carries `null`. The canonical strings sidestep it; the
 *     matcher never reads `year` at all.
 *
 * Pure data in, pure rows out — no React, no fetch.
 */
import type { ReadingResponse } from "@/app/read/reading-types";

export interface ProvenanceRow {
  /** Stable machine key — safe as a React key and as an analytics label. */
  readonly key: string;
  /** The medallion's title, e.g. "Classical Palmistry". */
  readonly title: string;
  /** The parenthetical beneath it. Always canonical, never text echoed from the response. */
  readonly source: string;
  readonly emblem: "palm" | "lotus" | "trishul";
}

/**
 * Books the reference card cites that this KB does not contain. STRUCK — never renderable.
 *
 * Kept as an exported constant so `test/pothi-data.test.ts` can assert, across every input including
 * one that tries to smuggle these names in through a source text, that no emitted row contains them.
 */
export const STRUCK_SOURCE_NAMES: readonly string[] = ["Brihat Samhita", "Hastarekha Shastra"];

/**
 * The three texts the KB really holds, matched on the prefix of `AreaSource.text`.
 *
 * Prefixes, not equality: `loc` strings vary and a text may gain an edition suffix, but the leading
 * author token is what identifies the book. A prefix match on "Cheiro" cannot be reached by a string
 * that opens with a struck name.
 */
const CHEIRO_PREFIX = "Cheiro";
const DALE_PREFIX = "Dale";
const SAMUDRIKA_PREFIX = "Samudrika";

/**
 * Row definitions, in render order.
 *
 * Emblems follow the reference card: its "Palmistry Tradition" medallion carries the palm glyph, and
 * "AI Interpretation" the lotus. The trishul — the glyph the reference spent on the struck "Ancient
 * Texts" row — goes to the two rows that genuinely are the Indian lane, Dale and Samudrika. Sharing
 * one emblem across those two is deliberate: they are one tradition cited twice, not two brands.
 */
const CLASSICAL_ROW: ProvenanceRow = {
  key: "classical",
  title: "Classical Palmistry",
  source: "Cheiro — Palmistry for All, 1916",
  emblem: "palm",
};

const INDIAN_ROW: ProvenanceRow = {
  key: "indian",
  title: "Indian Palmistry",
  source: "Dale — Indian Palmistry, 1895",
  emblem: "trishul",
};

const SAMUDRIKA_ROW: ProvenanceRow = {
  key: "samudrika",
  title: "Samudrika Shastra",
  source: "Samudrika tradition — one rule, Hindi source pass pending",
  emblem: "trishul",
};

/**
 * The narration row.
 *
 * Appears ONLY when `narration.engine === "llm"` — a template narration is assembled from the
 * clusters by lib/hastrekha/narrator.ts and no model wrote a word of it, so crediting one would be
 * backwards. The subtitle says what the model was allowed to do: write from rules that already
 * fired, never add a claim of its own.
 */
const AI_ROW: ProvenanceRow = {
  key: "ai",
  title: "AI Interpretation",
  source: "Narration written from the fired rules",
  emblem: "lotus",
};

/** True when any source text on these rules starts with the given author token. */
function citesText(texts: readonly string[], prefix: string): boolean {
  return texts.some((text) => text.trimStart().startsWith(prefix));
}

/**
 * Source texts behind a set of rule ids.
 *
 * Area evidence first, because it is structured and complete. For rule ids no area covered, the
 * joined `rules[].source` is split back at its `" ("` year separator — a lossy fallback that can only
 * ever reveal `sources[0]`, which is precisely why it is the fallback.
 */
function sourceTexts(reading: ReadingResponse, ruleIds: readonly string[]): readonly string[] {
  const wanted = new Set(ruleIds);
  if (wanted.size === 0) return [];

  const texts: string[] = [];
  const covered = new Set<string>();

  for (const area of reading.areas ?? []) {
    for (const item of area.evidence) {
      if (!wanted.has(item.rule_id)) continue;
      covered.add(item.rule_id);
      for (const source of item.sources) {
        if (typeof source.text === "string" && source.text.length > 0) texts.push(source.text);
      }
    }
  }

  for (const rule of reading.rules) {
    if (!wanted.has(rule.rule_id) || covered.has(rule.rule_id)) continue;
    if (rule.source.length === 0) continue;
    const cut = rule.source.indexOf(" (");
    texts.push(cut > 0 ? rule.source.slice(0, cut) : rule.source);
  }

  return texts;
}

/** Defence in depth: an emitted row may never carry a struck name, however it got there. */
function isClean(row: ProvenanceRow): boolean {
  return !STRUCK_SOURCE_NAMES.some((struck) => row.title.includes(struck) || row.source.includes(struck));
}

/**
 * The provenance rows a leaf may show for the rules it is built from.
 *
 * A row is emitted only where the underlying source is really present in THIS response: Cheiro when
 * a cited text starts with Cheiro, Dale when one starts with Dale, Samudrika when the Samudrika
 * source fired, and the narration row only when an LLM wrote a section citing one of these rules.
 * An empty result is a correct answer — the leaf then shows no provenance rather than a plausible
 * one, which is the whole of R4.
 *
 * @param reading the response the leaf is rendering
 * @param ruleIds the rules this leaf rests on — `ChapterState.ruleIds` from pothi-chapters.ts
 */
export function provenanceRows(reading: ReadingResponse, ruleIds: readonly string[]): readonly ProvenanceRow[] {
  const texts = sourceTexts(reading, ruleIds);
  const rows: ProvenanceRow[] = [];

  if (citesText(texts, CHEIRO_PREFIX)) rows.push(CLASSICAL_ROW);
  if (citesText(texts, DALE_PREFIX)) rows.push(INDIAN_ROW);
  if (citesText(texts, SAMUDRIKA_PREFIX)) rows.push(SAMUDRIKA_ROW);

  /*
   * The narration row is about text on the page, not about a book. It needs the model to have
   * actually written about THESE rules: an LLM narration citing none of them wrote some other leaf.
   */
  const wanted = new Set(ruleIds);
  const llmWroteHere =
    reading.narration.engine === "llm" &&
    reading.narration.sections.some((section) => section.rule_ids.some((id) => wanted.has(id)));
  if (llmWroteHere) rows.push(AI_ROW);

  return rows.filter(isClean);
}
