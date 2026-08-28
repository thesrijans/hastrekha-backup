/**
 * Loads and validates the generated area map.
 *
 * `data/areas/area-map.v1.json` is built by `scripts/build_area_map.py` from the KB, and the two
 * files drift the moment anyone edits one without re-running the other. That drift is silent and
 * expensive: a rule renamed in the KB simply stops contributing to its area, and the verdict gets
 * quieter rather than wronger, which is the hardest kind of bug to notice.
 *
 * So the map is validated against the KB at load, and a mismatch **throws**. That follows the
 * `lib/env.ts` precedent — a bad contract takes the process down at import rather than degrading
 * in production — and it is the right trade here because the map is a build artifact: if it is
 * wrong, it was wrong before the request arrived and no user should see the result.
 *
 * Polarity is checked, not copied, for the same reason `AreaEvidence` copies it from the KB at
 * scoring time: there must be exactly one source of truth for whether a rule is good news, and it
 * is the KB. The map carrying a stale duplicate is precisely the failure being guarded against.
 */
import areaMapDocument from "@/data/areas/area-map.v1.json";
import { AREA_IDS, type AreaId } from "./area-types";
import type { KnowledgeBase, Polarity, SafetyClass } from "./types";

/* ------------------------------- Constants ------------------------------- */

/** Map versions this loader understands. A major bump is a schema change, not a rebuild. */
const SUPPORTED_MAP_VERSIONS: ReadonlySet<string> = new Set(["1.0"]);
/** How many problems to name before truncating — enough to see a pattern, not a wall of text. */
const MAX_REPORTED_PROBLEMS = 8;

/* --------------------------------- Types --------------------------------- */

export interface AreaMapping {
  readonly rule_id: string;
  readonly primary_area: AreaId;
  readonly secondary_areas: readonly AreaId[];
  readonly polarity: Polarity;
  readonly weight: number;
  readonly safety_class: SafetyClass;
  readonly feature_roots: readonly string[];
  readonly mapped_by: "override" | "prefix" | "category" | "tag";
}

export interface AreaBlock {
  readonly label_hi_en: string;
  readonly rule_ids: readonly string[];
  readonly feature_roots: readonly string[];
  readonly polarity_split: Readonly<Record<Polarity, number>>;
}

export interface AreaMap {
  readonly mapVersion: string;
  readonly kbVersion: string;
  /** Every mapped rule, keyed by rule_id. Rules the map deliberately omits are simply absent. */
  readonly byRuleId: ReadonlyMap<string, AreaMapping>;
  readonly areas: Readonly<Record<AreaId, AreaBlock>>;
}

export class AreaMapValidationError extends Error {
  constructor(public readonly problems: readonly string[]) {
    super(
      `area map validation failed with ${problems.length} problem(s): ` +
        problems.slice(0, MAX_REPORTED_PROBLEMS).join(" | "),
    );
    this.name = "AreaMapValidationError";
  }
}

/* ------------------------------- Validation ------------------------------- */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const AREA_ID_SET: ReadonlySet<string> = new Set(AREA_IDS);

/**
 * Validate and index the map against `kb`.
 *
 * @param kb the knowledge base the map must agree with.
 * @param document defaults to the generated file. Passing one in is how the tests exercise a
 * corrupt map WITHOUT touching `data/areas/area-map.v1.json` on disk — a test that mutates a
 * committed build artifact to prove a throw is a test that can leave the repo broken.
 * @throws {AreaMapValidationError} on any structural problem or KB disagreement.
 */
export function loadAreaMap(kb: KnowledgeBase, document: unknown = areaMapDocument): AreaMap {
  const problems: string[] = [];

  if (!isRecord(document) || !isRecord(document.meta) || !isRecord(document.areas) || !Array.isArray(document.rules)) {
    throw new AreaMapValidationError(["map is not { meta, areas, rules }"]);
  }
  const meta = document.meta;
  const mapVersion = String(meta.map_version ?? "");
  if (!SUPPORTED_MAP_VERSIONS.has(mapVersion)) {
    problems.push(`map_version ${mapVersion || "<missing>"} is not supported`);
  }
  if (meta.kb_version !== kb.meta.kb_version) {
    problems.push(`kb_version mismatch: map built from ${String(meta.kb_version)}, loaded KB is ${kb.meta.kb_version}`);
  }

  const areaKeys = Object.keys(document.areas).sort();
  const expectedKeys = [...AREA_IDS].sort();
  if (areaKeys.length !== expectedKeys.length || areaKeys.some((key, i) => key !== expectedKeys[i])) {
    problems.push(`areas must be exactly [${expectedKeys.join(", ")}], got [${areaKeys.join(", ")}]`);
  }

  const kbById = new Map(kb.rules.map((rule) => [rule.rule_id, rule]));
  const byRuleId = new Map<string, AreaMapping>();
  for (const entry of document.rules) {
    if (!isRecord(entry)) {
      problems.push("rules[] holds a non-object");
      continue;
    }
    const ruleId = String(entry.rule_id ?? "");
    const rule = kbById.get(ruleId);
    if (rule === undefined) {
      problems.push(`${ruleId || "<no id>"}: mapped rule is not in the KB`);
      continue;
    }
    if (byRuleId.has(ruleId)) {
      problems.push(`${ruleId}: mapped twice`);
      continue;
    }
    if (!AREA_ID_SET.has(String(entry.primary_area))) {
      problems.push(`${ruleId}: primary_area ${String(entry.primary_area)}`);
    }
    const secondary = Array.isArray(entry.secondary_areas) ? entry.secondary_areas.map(String) : [];
    for (const area of secondary) {
      if (!AREA_ID_SET.has(area)) problems.push(`${ruleId}: secondary_area ${area}`);
      if (area === entry.primary_area) problems.push(`${ruleId}: secondary_area repeats the primary`);
    }
    // The KB is the only source of truth for polarity; a stale copy here is the drift we are hunting.
    if (entry.polarity !== rule.polarity) {
      problems.push(`${ruleId}: map polarity ${String(entry.polarity)} != KB ${rule.polarity}`);
    }
    if (entry.weight !== rule.weight) {
      problems.push(`${ruleId}: map weight ${String(entry.weight)} != KB ${rule.weight}`);
    }
    if (entry.safety_class !== rule.safety_class) {
      problems.push(`${ruleId}: map safety_class ${String(entry.safety_class)} != KB ${rule.safety_class}`);
    }

    byRuleId.set(ruleId, {
      rule_id: ruleId,
      primary_area: entry.primary_area as AreaId,
      secondary_areas: secondary as readonly AreaId[],
      polarity: rule.polarity,
      weight: rule.weight,
      safety_class: rule.safety_class,
      feature_roots: Array.isArray(entry.feature_roots) ? entry.feature_roots.map(String) : [],
      mapped_by: entry.mapped_by as AreaMapping["mapped_by"],
    });
  }

  const areas = {} as Record<AreaId, AreaBlock>;
  for (const area of AREA_IDS) {
    const block = (document.areas as Record<string, unknown>)[area];
    if (!isRecord(block)) {
      problems.push(`areas.${area} is missing`);
      continue;
    }
    areas[area] = {
      label_hi_en: String(block.label_hi_en ?? ""),
      rule_ids: Array.isArray(block.rule_ids) ? block.rule_ids.map(String) : [],
      feature_roots: Array.isArray(block.feature_roots) ? block.feature_roots.map(String) : [],
      polarity_split: (isRecord(block.polarity_split)
        ? block.polarity_split
        : { positive: 0, neutral: 0, negative: 0 }) as unknown as Readonly<Record<Polarity, number>>,
    };
  }

  if (problems.length > 0) throw new AreaMapValidationError(problems);

  return { mapVersion, kbVersion: String(meta.kb_version), byRuleId, areas };
}

/** The union of feature roots every rule in this area reads — the denominator for its coverage. */
export function areaRoots(map: AreaMap, area: AreaId): readonly string[] {
  return map.areas[area].feature_roots;
}
