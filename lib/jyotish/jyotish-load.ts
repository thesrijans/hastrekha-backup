/**
 * The only module that imports data/jyotish/*.json and data/concordance.json. Server-side: the rules are
 * a few hundred kB and the client never needs them. Everything else lives in jyotish-data.ts, which is pure.
 */
import rulesDocument from "@/data/jyotish/rules.json";
import verseIndexDocument from "@/data/jyotish/verse-index.json";
import grammarDocument from "@/data/jyotish/grammar.json";
import concordanceDocument from "@/data/concordance.json";
import { parseConcordance, parseJyotishData, type Concordance, type JyotishData } from "./jyotish-data";

let cached: { data: JyotishData; concordance: Concordance } | null = null;

/** Parses and validates once per process; throws JyotishValidationError if the committed data is malformed. */
export function loadJyotish(): { data: JyotishData; concordance: Concordance } {
  if (cached === null) {
    const data = parseJyotishData(rulesDocument, verseIndexDocument, grammarDocument);
    cached = { data, concordance: parseConcordance(concordanceDocument, data) };
  }
  return cached;
}
