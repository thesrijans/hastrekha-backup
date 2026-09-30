/**
 * matchRemedies: the deterministic matcher, a port of the lab's upay/match.py. The two must return the same
 * ids in the same order; test/upay-data.test.ts runs the lab's parity vectors.
 *
 * A rule is ELIGIBLE when it shares the reader's declared problem tag, or a weak life area, or a fired palm
 * feature. A rule that requires a kundli (it is tied to a planet) is eligible only when a chart exists and
 * only through a planet the chart reading names. Eligible rules are ordered by, in turn: declared-tag match;
 * explicit before inferred; ok before review; cited text before folk custom; shared planets; shared palm
 * features; shared weak areas; id. No randomness and no tunable scores.
 *
 * Free-text questions go through the embedding index first (hastrekha_upay.index.json `embedding`), which
 * only proposes candidate ids; pass them as `candidateIds` and the same ordering applies.
 */
import type { UpayRule } from "./upay-data";

export interface RemedyContext {
  problemTag?: string | null;
  weakAreas?: string[];
  palmFeatures?: string[];
  grahas?: string[];
  hasKundli?: boolean;
  includeReview?: boolean;
  limit?: number;
  /** When given (from the embedding index), only these rules are considered and each counts as eligible. */
  candidateIds?: string[];
}

export interface RemedyMatch {
  id: string;
  why: { tag: boolean; grahas: string[]; palmFeatures: string[]; areas: string[] };
}

function shared(a: ReadonlySet<string>, b: readonly string[]): string[] {
  return b.filter((value) => a.has(value)).sort();
}

export function matchRemedies(rules: readonly UpayRule[], context: RemedyContext): RemedyMatch[] {
  const tag = context.problemTag ?? null;
  const weak = new Set(context.weakAreas ?? []);
  const palm = new Set(context.palmFeatures ?? []);
  const grahas = new Set(context.hasKundli ? (context.grahas ?? []) : []);
  const includeReview = context.includeReview ?? true;
  const limit = context.limit ?? 5;
  const candidates = context.candidateIds ? new Set(context.candidateIds) : null;

  const ranked: { key: (number | string)[]; match: RemedyMatch }[] = [];
  for (const rule of rules) {
    if (rule.safety === "review" && !includeReview) continue;
    if (candidates && !candidates.has(rule.id)) continue;
    const tagMatch = tag !== null && rule.trigger.problemTags.includes(tag);
    const sharedGrahas = shared(grahas, rule.trigger.grahas);
    const sharedPalm = shared(palm, rule.trigger.palmFeatures);
    const sharedAreas = shared(weak, rule.trigger.areas);
    if (rule.requires === "kundli") {
      if (sharedGrahas.length === 0) continue;
    } else if (!candidates && !(tagMatch || sharedAreas.length > 0 || sharedPalm.length > 0)) {
      continue;
    }
    ranked.push({
      key: [
        tagMatch ? 0 : 1,
        rule.confidence === "explicit" ? 0 : 1,
        rule.safety === "ok" ? 0 : 1,
        rule.tradition === "folk" ? 1 : 0,
        -sharedGrahas.length,
        -sharedPalm.length,
        -sharedAreas.length,
        rule.id,
      ],
      match: { id: rule.id, why: { tag: tagMatch, grahas: sharedGrahas, palmFeatures: sharedPalm, areas: sharedAreas } },
    });
  }
  ranked.sort((a, b) => {
    for (let i = 0; i < a.key.length; i += 1) {
      if (a.key[i] < b.key[i]) return -1;
      if (a.key[i] > b.key[i]) return 1;
    }
    return 0;
  });
  return ranked.slice(0, limit).map((entry) => entry.match);
}

/**
 * Nearest remedies to a query vector. `vectors` is the index's base64 int8 matrix decoded to an Int8Array
 * (row-major, `dim` per row); `query` is the L2-normalised embedding of "query: <text>" from the same model.
 */
export function nearestRemedyIds(ids: readonly string[], vectors: Int8Array, dim: number, query: Float32Array, k: number): string[] {
  const scores: { id: string; score: number }[] = [];
  for (let row = 0; row < ids.length; row += 1) {
    let score = 0;
    const base = row * dim;
    for (let j = 0; j < dim; j += 1) score += vectors[base + j] * query[j];
    scores.push({ id: ids[row], score });
  }
  scores.sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : 1));
  return scores.slice(0, k).map((entry) => entry.id);
}
