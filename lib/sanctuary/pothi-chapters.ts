/**
 * The fifteen chapters of the Pothi, and the one function that decides whether a leaf may speak.
 *
 * This module exists because of A2: a confident-looking empty state is the failure this build is
 * meant to prevent. Every leaf in the Pothi asks {@link resolveChapter} one question — "do I have
 * something real to print?" — and gets back either content assembled from the response, or a
 * {@link SealReason} that names the actual cause in the user's language. There is no third answer,
 * and there is no placeholder.
 *
 * Two design rules hold the honesty in place:
 *
 *  1. **Every seal is derived, never asserted.** A reason's `detail` quotes numbers taken from the
 *     response it was handed — how many keys are missing, how many areas came back, how many rules
 *     fired. A constant sentence would survive a change in the data and start lying; a derived one
 *     cannot. The three launch seals (VI, VII, XIV) are the exception in KIND, not in method: they
 *     are pinned to facts about the pipeline and the wire contract that no response can change, and
 *     their details still count this reading's own rules and keys.
 *
 *  2. **`capture` is a promise, so it is rare.** It appears only where a rescan can genuinely fill
 *     the gap — measured against what /scan actually emits (see {@link CAPTURABLE_FEATURE_PREFIXES}).
 *     Mounts, signs, geometry and nails have no producer at all, and the six RESERVED line ids have
 *     no extractor, so those seals carry no capture instruction. Telling a user to scan again for a
 *     thing the scanner cannot see is the same lie as inventing the reading.
 *
 * Nothing here renders. No JSX, no React, no DOM — so the whole policy is testable as data
 * (`test/pothi-data.test.ts`).
 */
import type {
  NarrationSection,
  PublicAreaVerdict,
  PublicRule,
  ReadingResponse,
} from "@/app/read/reading-types";

/* ------------------------------- Vocabulary -------------------------------- */

/**
 * The lines a chapter can be about.
 *
 * Deliberately narrower than `PalmLineId` in lib/scan/types.ts: the Pothi gives the four extracted
 * creases a chapter each, and folds Sun and Mercury (the health/liver line) into one sealed chapter
 * VI. `marriage`, `children`, `travel` and `intuition` have no chapter at all — a chapter that could
 * never open is worse than an honest omission.
 */
export type PothiLineId = "heart" | "head" | "life" | "fate" | "sun" | "health";

/** The five life areas, in the wire's fixed order. */
export type PothiAreaId = "dhan" | "rishte" | "karm" | "sehat" | "swabhav";

export interface PothiChapter {
  /** Roman numeral, I..XV — the chapter's identity, used to key the launch seals. */
  readonly numeral: string;
  /** ०१..१५ — the page number as it is inked on the leaf. */
  readonly devanagariNumeral: string;
  readonly titleHi: string;
  readonly titleEn: string;
  readonly kind: "line" | "area" | "structure" | "meta";
  readonly lineId?: PothiLineId;
  readonly areaId?: PothiAreaId;
}

/**
 * The fifteen chapters of spec v1.1 §6.4.
 *
 * The English titles of VIII–XII are the area labels the engine itself ships
 * (`data/areas/area-map.v1.json` → `label_hi_en`), not a second translation invented here — the
 * test pins them against that file so a relabelling in the map fails the suite instead of quietly
 * putting two different names for one area in front of the same reader.
 */
export const POTHI_CHAPTERS: readonly PothiChapter[] = [
  { numeral: "I", devanagariNumeral: "०१", titleHi: "हाथ का आकार", titleEn: "Shape of Your Hand", kind: "structure" },
  { numeral: "II", devanagariNumeral: "०२", titleHi: "हृदय रेखा", titleEn: "Heart", kind: "line", lineId: "heart" },
  { numeral: "III", devanagariNumeral: "०३", titleHi: "मस्तिष्क रेखा", titleEn: "Head", kind: "line", lineId: "head" },
  { numeral: "IV", devanagariNumeral: "०४", titleHi: "जीवन रेखा", titleEn: "Life", kind: "line", lineId: "life" },
  { numeral: "V", devanagariNumeral: "०५", titleHi: "शनि रेखा", titleEn: "Fate", kind: "line", lineId: "fate" },
  { numeral: "VI", devanagariNumeral: "०६", titleHi: "सूर्य व बुध रेखा", titleEn: "Sun and Mercury", kind: "line", lineId: "sun" },
  { numeral: "VII", devanagariNumeral: "०७", titleHi: "पर्वत", titleEn: "Mounts", kind: "structure" },
  { numeral: "VIII", devanagariNumeral: "०८", titleHi: "प्रेम व संबंध", titleEn: "Pyaar aur Rishte", kind: "area", areaId: "rishte" },
  { numeral: "IX", devanagariNumeral: "०९", titleHi: "कर्म व सफलता", titleEn: "Career aur Kaam", kind: "area", areaId: "karm" },
  { numeral: "X", devanagariNumeral: "१०", titleHi: "स्वभाव", titleEn: "Swabhav", kind: "area", areaId: "swabhav" },
  { numeral: "XI", devanagariNumeral: "११", titleHi: "धन व समृद्धि", titleEn: "Paisa aur Samriddhi", kind: "area", areaId: "dhan" },
  { numeral: "XII", devanagariNumeral: "१२", titleHi: "ऊर्जा व स्वास्थ्य", titleEn: "Urja aur Sehat", kind: "area", areaId: "sehat" },
  { numeral: "XIII", devanagariNumeral: "१३", titleHi: "जीवन दिशा", titleEn: "Life Direction", kind: "meta" },
  { numeral: "XIV", devanagariNumeral: "१४", titleHi: "आपके प्रश्न", titleEn: "Your Questions", kind: "meta" },
  { numeral: "XV", devanagariNumeral: "१५", titleHi: "पूर्ण पाठ", titleEn: "Your Complete Reading", kind: "meta" },
];

/* --------------------------------- Seals ----------------------------------- */

/**
 * Why a leaf is sealed.
 *
 * `code` is for machines (analytics, tests, a leaf choosing an emblem). `hi` is the single ink line
 * the seal shows. `detail` is the honest paragraph underneath — it must say WHY in the reader's
 * language and quote the response. `capture` is present ONLY when a rescan would actually fix it.
 *
 * `hi` and `detail` are Hinglish in Latin script, matching the rest of the product's copy: the
 * narrator (lib/hastrekha/narrator.ts) rejects Devanagari in body text outright, so Devanagari in
 * this app is reserved for chapter titles and page numerals. A seal that spoke a different script
 * from the reading beside it would read as an error message rather than as part of the book.
 */
export type SealReason = {
  readonly code: string;
  readonly hi: string;
  readonly detail: string;
  readonly capture?: string;
};

/** Every seal this module can produce. Exported so a leaf can switch on them without string typos. */
export const SEAL_CODES = {
  /** VI — the sun/mercury line ids are RESERVED; no extractor exists. */
  lineReserved: "line_reserved",
  /** VII — mounts are never measured; /scan sends an empty mount bag. */
  mountsUnmeasured: "mounts_unmeasured",
  /** XIV — the question is input-only and never echoed on the response. */
  questionNotEchoed: "question_not_echoed",
  /** `areas` is absent entirely — a response cached from before area scoring. */
  areaNotScored: "area_not_scored",
  /** `areas` came back, but without this area. Not the same as "not enough evidence". */
  areaAbsent: "area_absent",
  /** The area was scored and the band is INSUFFICIENT. */
  areaInsufficient: "area_insufficient",
  /** A line chapter with neither a narration section nor a fired rule. */
  lineUnread: "line_unread",
  /** Chapter I with no hand.* rule fired at all. */
  handShapeUnread: "hand_shape_unread",
  /** Chapter I's partial seal: the shape VALUE never reaches the client. */
  handShapeValue: "hand_shape_value",
  /** II–V partial seal: there is no per-line confidence anywhere on the wire. */
  lineConfidence: "line_confidence",
  /** XIII — no birth windows on the response. */
  birthWindowsAbsent: "birth_windows_absent",
  /** XIII partial seal: window ids arrive, their date ranges stay in the KB. */
  birthWindowsUndeclared: "birth_windows_undeclared",
  /** Partial seal wherever the tier withheld rows. */
  lockedRules: "locked_rules",
  /** XV — the response carries no text at all. */
  readingEmpty: "reading_empty",
  /** The A2 backstop: content was assembled but contains no printable string. */
  nothingToPrint: "nothing_to_print",
} as const;

/** One point of a traced line, in the rectified crop's pixel space. */
export type PothiPoint = readonly [number, number];

/**
 * One measured crease, as the scan session hands it over.
 *
 * Mirrors `TracedLine` in lib/scan/types.ts minus its `confidence` field, and the omission is the
 * point: the Pothi shows no per-line confidence badge (see {@link SEAL_CODES.lineConfidence}), so
 * carrying the number here would invite a leaf to render a figure the response never agreed to.
 */
export interface PothiTracedLine {
  readonly id: PothiLineId;
  readonly points: readonly PothiPoint[];
  /** Fraction of arc length sitting on observed evidence; null when the hand-off did not carry it. */
  readonly observedFraction: number | null;
}

/**
 * The geometry hand-off.
 *
 * THE READING RESPONSE CARRIES NO GEOMETRY — no polyline, no crop, nothing. Chapters II–V can only
 * draw a line if the scan session handed one across separately, which is why this is a second
 * argument to {@link resolveChapter} and why `null` is an ordinary, expected value.
 */
export interface PothiGeometry {
  readonly lines: readonly PothiTracedLine[];
  /** Side length of the square the points live in (256 for the rectified crop). */
  readonly size: number;
}

export type ChapterState =
  | {
      readonly status: "content";
      readonly chapter: PothiChapter;
      /** Narration sections that cite at least one of this chapter's rules, in wire order. */
      readonly sections: readonly NarrationSection[];
      /** Fired rules attributed to this chapter, in wire order. */
      readonly rules: readonly PublicRule[];
      /** The area verdict, for area chapters only. */
      readonly area: PublicAreaVerdict | null;
      /** Every rule id this chapter rests on — the argument for `provenanceRows`. */
      readonly ruleIds: readonly string[];
      /** The measured crease, when the session handed geometry over. */
      readonly polyline: readonly PothiPoint[] | null;
      /** Birth window ids, chapter XIII only. */
      readonly birthWindows: readonly string[];
      /** Seals that apply to PART of an open chapter — a badge, a value, a withheld row. */
      readonly partialSeals: readonly SealReason[];
    }
  | { readonly status: "sealed"; readonly chapter: PothiChapter; readonly reason: SealReason };

/* --------------------------- Rule attribution ------------------------------ */

/**
 * Rule-id prefixes that belong to a line.
 *
 * The response drops a rule's `conditions`, so the client cannot ask "does this rule read
 * lines.heart.origin?" — the only line evidence left on the wire is the rule id and the tags. This
 * table plus {@link LINE_RULE_TAGS} reconstructs the attribution, and `test/pothi-data.test.ts`
 * measures the reconstruction against `data/kb/hastrekha_kb.json` so the numbers below are checked
 * rather than claimed: recall 0.77–1.00, precision 0.87–1.00 across the six lines.
 *
 * Both error directions were chosen deliberately. Under-attribution seals a chapter that had
 * something — the safe failure, since a sealed leaf names its reason and invents nothing.
 * Over-attribution can only pull in a neighbouring rule that genuinely mentions the line (a Dale
 * rule tagged `life_line` inside a health finding, say), never an unrelated one.
 */
export const LINE_RULE_PREFIXES: Readonly<Record<PothiLineId, readonly string[]>> = {
  heart: ["PALM-HEART-"],
  head: ["PALM-HEAD-"],
  life: ["PALM-LIFE-"],
  fate: ["PALM-FATE-"],
  sun: ["PALM-SUN-"],
  health: ["PALM-HLTH-"],
};

/** KB tags that name a line outright. Measured from the tag census over `hastrekha_kb.json`. */
export const LINE_RULE_TAGS: Readonly<Record<PothiLineId, readonly string[]>> = {
  heart: ["heart_line"],
  head: ["head_line", "head_line_combo"],
  life: ["life_line"],
  fate: ["fate_line", "saturn_line"],
  sun: ["sun_line"],
  health: ["health_line", "liver_line"],
};

/** Chapter I's attribution. Precision is 1.00 against the KB — every hit really reads `hand.*`. */
export const HAND_RULE_PREFIX = "PALM-HTYPE-";
export const HAND_RULE_TAG = "hand_type";

/** Rule ids in this reading that speak about a given line. Wire order preserved. */
export function lineRuleIds(reading: ReadingResponse, lineId: PothiLineId): readonly string[] {
  const prefixes = LINE_RULE_PREFIXES[lineId];
  const tags = LINE_RULE_TAGS[lineId];
  return reading.rules
    .filter(
      (rule) =>
        prefixes.some((prefix) => rule.rule_id.startsWith(prefix)) ||
        rule.tags.some((tag) => tags.includes(tag)),
    )
    .map((rule) => rule.rule_id);
}

/** Rule ids in this reading that speak about hand shape. */
export function handRuleIds(reading: ReadingResponse): readonly string[] {
  return reading.rules
    .filter((rule) => rule.rule_id.startsWith(HAND_RULE_PREFIX) || rule.tags.includes(HAND_RULE_TAG))
    .map((rule) => rule.rule_id);
}

/* ------------------------------ Coverage keys ------------------------------ */

/**
 * The KB feature roots each area is scored from, copied out of `data/areas/area-map.v1.json`.
 *
 * Copied rather than imported for the reason `AREA_RULE_POOL` in components/areas/area-vocab.ts is
 * copied: the map is 159 KB and the client must never load it. The test pins every entry against
 * the committed map, so a remap fails the suite instead of making an INSUFFICIENT seal name keys
 * that area no longer needs.
 */
export const AREA_FEATURE_ROOTS: Readonly<Record<PothiAreaId, readonly string[]>> = {
  dhan: [
    "fingers.fingerprint_type", "fingers.jupiter_vs_apollo", "fingers.mercury", "fingers.saturn", "fingers.sun",
    "geometry.quadrangle_shape", "hand.shape", "lines.fate", "lines.head", "lines.health", "lines.heart",
    "lines.life", "lines.marriage", "lines.quality", "lines.sun", "lines.via_lasciva", "mounts.jupiter",
    "mounts.mercury", "mounts.moon", "mounts.saturn", "mounts.sun", "nails.furrow_position", "signs.bracelets",
    "signs.circle", "signs.cross", "signs.island", "signs.samudrika", "signs.star", "thumb.cramped_to_palm",
    "thumb.joint_top", "thumb.set", "user.birth_window",
  ],
  rishte: [
    "fingers.fingerprint_type", "fingers.mercury", "hand.overall_quality", "lines.children", "lines.fate",
    "lines.head", "lines.heart", "lines.influence", "lines.life", "lines.marriage", "lines.sun",
    "mounts.jupiter", "mounts.mars_inner", "mounts.mercury", "mounts.moon", "mounts.sun", "mounts.venus",
    "signs.circle", "signs.cross", "signs.girdle_of_venus", "signs.island", "signs.star",
    "thumb.base_phalange_long", "user.birth_window",
  ],
  karm: [
    "fingers.fingerprint_type", "fingers.joints", "fingers.jupiter", "fingers.jupiter_vs_apollo",
    "fingers.mercury", "fingers.sun", "geometry.quadrangle_shape", "hand.shape", "hand.shape_detail",
    "lines.fate", "lines.head", "lines.heart", "lines.influence", "lines.life", "lines.quality", "lines.sun",
    "lines.travel", "lines.via_lasciva", "mounts.jupiter", "mounts.mars_inner", "mounts.mercury", "mounts.moon",
    "mounts.saturn", "mounts.sun", "mounts.venus", "signs.bracelets", "signs.circle", "signs.croix_mystique",
    "signs.cross", "signs.island", "signs.samudrika", "signs.square", "signs.star", "user.birth_window",
  ],
  sehat: [
    "lines.head", "lines.health", "lines.heart", "lines.life", "lines.mars", "lines.quality", "lines.sun",
    "lines.travel", "mounts.mars_inner", "mounts.mercury", "mounts.saturn", "mounts.venus",
    "nails.furrow_position", "nails.white_flecks_many", "signs.bracelets", "signs.cross", "signs.island",
    "signs.spot", "signs.square", "signs.star", "user.birth_window",
  ],
  swabhav: [
    "fingers.curve", "fingers.joints", "fingers.jupiter_vs_apollo", "fingers.length_vs_palm", "fingers.mercury",
    "fingers.saturn", "fingers.spacing", "fingers.sun", "geometry.quadrangle_shape", "geometry.triangle_large",
    "geometry.triangle_upper_angle_acute", "hand.overall_quality", "hand.shape", "hand.shape_detail",
    "lines.fate", "lines.head", "lines.head_heart_blended_single", "lines.health", "lines.heart",
    "lines.influence", "lines.intuition", "lines.life", "lines.marriage", "lines.mars", "lines.quality",
    "lines.sun", "lines.travel", "lines.via_lasciva", "mounts.jupiter", "mounts.mars_inner", "mounts.mercury",
    "mounts.moon", "mounts.overall_prominence", "mounts.saturn", "mounts.sun", "mounts.venus",
    "signs.bracelets", "signs.croix_mystique", "signs.cross", "signs.girdle_of_venus", "signs.grille",
    "signs.ring_of_saturn", "signs.ring_of_solomon", "signs.samudrika", "signs.star",
    "thumb.base_phalange_long", "thumb.clubbed", "thumb.joint_middle_supple", "thumb.joint_top",
    "thumb.nail_phalange_long", "thumb.straight_full", "thumb.waist_like", "thumb.will_phalange",
    "user.birth_window",
  ],
};

/**
 * Feature roots one of the area maps names but coverage reports under another key.
 *
 * `buildCoverage` in lib/hastrekha/engine.ts folds `user.birth_window` and `user.birth_day_of_month`
 * into `user.birth_date` before listing coverage, so the area map's root would otherwise never match
 * a missing key and a DOB-shaped hole would go unnamed.
 */
const COVERAGE_KEY_ALIASES: Readonly<Record<string, readonly string[]>> = {
  "user.birth_window": ["user.birth_date"],
};

/**
 * Feature roots /scan can actually produce today.
 *
 * Measured, not assumed: lib/scan/features.ts writes only `fingers.*`, `thumb.*`, `hand.*` and
 * `reading.*` from 21 landmarks, and lib/scan/lines.ts writes only the four extracted creases plus
 * `lines.quality` and `lines.head_heart_blended_single`. Every `mounts.*`, `signs.*`, `geometry.*`
 * and `nails.*` key, and every RESERVED line id, has no producer at all — which is exactly why a
 * seal about them must not carry a capture instruction.
 */
export const CAPTURABLE_FEATURE_PREFIXES: readonly string[] = [
  "lines.heart",
  "lines.head",
  "lines.life",
  "lines.fate",
  "lines.quality",
  "lines.head_heart_blended_single",
  "fingers.",
  "thumb.",
  "hand.",
];

/**
 * Keys inside a capturable namespace that a camera still cannot see.
 *
 * Mirrors `NOT_DERIVABLE_FROM_LANDMARKS` in lib/scan/features.ts — flexion tests, tactile firmness
 * and silhouette thickness. The test reads that file and asserts this list still agrees with it.
 */
export const NOT_CAPTURABLE_FEATURE_KEYS: readonly string[] = [
  "thumb.joint_top",
  "thumb.joint_middle_supple",
  "thumb.clubbed",
  "thumb.waist_like",
  "thumb.base_phalange_long",
  "thumb.will_phalange",
  "fingers.joints",
  "hand.shape_detail.conic_firmness",
  "hand.shape_detail.spatulate_wider_at",
];

/** True when the key sits under a root, either exactly or as `root.something`. */
function underRoot(key: string, root: string): boolean {
  return key === root || key.startsWith(`${root}.`);
}

/** Missing coverage keys that fall under any of the given roots, aliases applied. */
function missingUnderRoots(reading: ReadingResponse, roots: readonly string[]): readonly string[] {
  const expanded = roots.flatMap((root) => [root, ...(COVERAGE_KEY_ALIASES[root] ?? [])]);
  return reading.coverage.missing.filter((key) => expanded.some((root) => underRoot(key, root)));
}

/** Whether a rescan could fill this key — the gate on every `capture` instruction. */
function isCapturable(key: string): boolean {
  if (NOT_CAPTURABLE_FEATURE_KEYS.some((banned) => underRoot(key, banned))) return false;
  return CAPTURABLE_FEATURE_PREFIXES.some((prefix) =>
    prefix.endsWith(".") ? key.startsWith(prefix) : underRoot(key, prefix),
  );
}

/** "a, b, c aur 9 aur" — names real keys, then admits how many it did not name. */
function nameKeys(keys: readonly string[], max = 4): string {
  if (keys.length === 0) return "koi nahi";
  const shown = keys.slice(0, max).join(", ");
  const rest = keys.length - Math.min(max, keys.length);
  return rest > 0 ? `${shown} aur ${rest} aur` : shown;
}

/* ------------------------------ Wire helpers ------------------------------- */

/**
 * Birth window ids, read off a key the response type does not declare.
 *
 * `app/api/reading/route.ts` puts `birthWindows` on the wire; `ReadingResponse` predates it and does
 * not list it. Rather than widen a type owned elsewhere, this reads the key defensively — an older
 * cached response simply yields an empty list, which chapter XIII then seals over honestly.
 */
export function birthWindowsOf(reading: ReadingResponse): readonly string[] {
  const carrier = reading as ReadingResponse & { readonly birthWindows?: unknown };
  if (!Array.isArray(carrier.birthWindows)) return [];
  return carrier.birthWindows.filter((entry): entry is string => typeof entry === "string" && entry.length > 0);
}

/** Narration sections citing at least one of these rule ids. Wire order preserved. */
function sectionsCiting(reading: ReadingResponse, ids: ReadonlySet<string>): readonly NarrationSection[] {
  if (ids.size === 0) return [];
  return reading.narration.sections.filter((section) => section.rule_ids.some((id) => ids.has(id)));
}

/** Fired rules with these ids. Wire order preserved. */
function rulesWithIds(reading: ReadingResponse, ids: ReadonlySet<string>): readonly PublicRule[] {
  if (ids.size === 0) return [];
  return reading.rules.filter((rule) => ids.has(rule.rule_id));
}

/** The measured crease for a line, when the session handed one over. */
function polylineFor(geometry: PothiGeometry | null, lineId: PothiLineId | undefined): readonly PothiPoint[] | null {
  if (geometry === null || lineId === undefined) return null;
  const traced = geometry.lines.find((line) => line.id === lineId);
  if (traced === undefined || traced.points.length < 2) return null;
  return traced.points;
}

/** Every string this state would put in front of a reader, all of it taken from the response. */
export function contentTexts(state: ChapterState): readonly string[] {
  if (state.status === "sealed") return [];
  const texts: string[] = [];
  for (const section of state.sections) texts.push(section.title, section.body);
  for (const rule of state.rules) texts.push(rule.interpretation_hi_en);
  if (state.area !== null) {
    texts.push(state.area.label_hi_en);
    for (const item of state.area.evidence) {
      if (item.interpretation_hi_en !== undefined) texts.push(item.interpretation_hi_en);
      for (const source of item.sources) texts.push(source.text);
    }
  }
  texts.push(...state.birthWindows);
  return texts.filter((text) => text.trim().length > 0);
}

/* -------------------------------- Partials --------------------------------- */

/** Free-tier withholding, stated as a number rather than implied by a gap. */
function lockedSeal(reading: ReadingResponse, area: PublicAreaVerdict | null): SealReason | null {
  const lockedEvidence = area?.lockedEvidenceCount ?? 0;
  const total = reading.lockedRuleCount + lockedEvidence;
  if (total <= 0) return null;
  const parts = [`${reading.lockedRuleCount} rule`];
  if (lockedEvidence > 0) parts.push(`${lockedEvidence} evidence row`);
  return {
    code: SEAL_CODES.lockedRules,
    hi: `${total} sanket is tier par band hain.`,
    detail: `Is tier par ${parts.join(" aur ")} response se hi hata diye jaate hain — wo yahan chhupaye nahi gaye, bheje hi nahi gaye.`,
  };
}

/**
 * II–V always carry this: there is exactly ONE confidence number on the wire, for the whole reading.
 * A per-line badge would have to be invented, so the badge is sealed and the global depth is quoted.
 */
function lineConfidenceSeal(reading: ReadingResponse): SealReason {
  return {
    code: SEAL_CODES.lineConfidence,
    hi: "Is rekha ka apna bharosa-number nahi aata.",
    detail: `Response par ek hi confidence hai — poore paath ki gehrai ${reading.confidence} — per-line koi number wire par maujood hi nahi. Isliye yahan badge ki jagah yeh muhar hai.`,
  };
}

/* ------------------------------- Resolution -------------------------------- */

function sealed(chapter: PothiChapter, reason: SealReason): ChapterState {
  return { status: "sealed", chapter, reason };
}

interface ContentDraft {
  readonly sections: readonly NarrationSection[];
  readonly rules: readonly PublicRule[];
  readonly area: PublicAreaVerdict | null;
  readonly ruleIds: readonly string[];
  readonly polyline: readonly PothiPoint[] | null;
  readonly birthWindows: readonly string[];
  readonly partialSeals: readonly SealReason[];
}

/**
 * The A2 gate. Content only leaves this module if it actually carries a printable string from the
 * response; otherwise it becomes a seal that says so. Every other path in this file is careful, and
 * this is the backstop for the path nobody thought of.
 */
function content(chapter: PothiChapter, draft: ContentDraft): ChapterState {
  const state: ChapterState = { status: "content", chapter, ...draft };
  if (contentTexts(state).length > 0) return state;
  return sealed(chapter, {
    code: SEAL_CODES.nothingToPrint,
    hi: "Is adhyaay mein chhaapne layak koi vaakya nahi mila.",
    detail: `Is adhyaay se ${draft.ruleIds.length} rule id jude, magar unme se kisi ke saath koi likha hua vaakya response mein nahi aaya — na section, na interpretation.`,
  });
}

/** VI: the RESERVED lines. The count comes from this reading, so the seal stays specific. */
function reservedLineSeal(reading: ReadingResponse): SealReason {
  const waiting = new Set([...lineRuleIds(reading, "sun"), ...lineRuleIds(reading, "health")]).size;
  return {
    code: SEAL_CODES.lineReserved,
    hi: "Surya aur Budh rekha abhi naapi hi nahi jaati.",
    detail:
      `Scan ke line contract mein sun aur health dono RESERVED hain — inke liye koi extractor maujood nahi, ` +
      `isliye inka polyline ban hi nahi sakta. Is paath ke ${waiting} rule inhi rekhaon se jude hain aur ` +
      `apni rekha ka intezaar kar rahe hain.`,
  };
}

/** VII: mounts. A rescan cannot help, so this seal deliberately carries no capture instruction. */
function mountsSeal(reading: ReadingResponse): SealReason {
  const missing = reading.coverage.missing.filter((key) => key.startsWith("mounts.")).length;
  return {
    code: SEAL_CODES.mountsUnmeasured,
    hi: "Parvat naape hi nahi gaye.",
    detail:
      `Parvat ka ubhaar chhaya se dikhta hai, joint positions se nahi — /scan khaali mount bag bhejta hai. ` +
      `Is paath mein ${missing} mounts.* keys khaali padi hain, aur dobara scan karne se bhi wo nahi bharengi.`,
  };
}

/** XIV: the question. It is input-only; echoing it would mean printing something we did not get back. */
function questionSeal(reading: ReadingResponse): SealReason {
  return {
    code: SEAL_CODES.questionNotEchoed,
    hi: "Aapka sawaal yahan wapas nahi aata.",
    detail:
      `Sawaal sirf reading banane ke liye bheja jaata hai; response mein wo lautaya nahi jaata. ` +
      `Jo laut kar aaya wo ${reading.rules.length} fired rule aur ${reading.narration.sections.length} section hain — ` +
      `sawaal ka koi nishaan unme nahi.`,
  };
}

function areaState(chapter: PothiChapter, areaId: PothiAreaId, reading: ReadingResponse): ChapterState {
  if (reading.areas === undefined) {
    return sealed(chapter, {
      code: SEAL_CODES.areaNotScored,
      hi: "Is paath mein jeevan-kshetra naape hi nahi gaye.",
      detail:
        `Yeh reading area verdicts se pehle ki hai — response mein areas key hai hi nahi. ` +
        `Yeh "kam sanket" nahi hai; is paath par sawaal poocha hi nahi gaya tha.`,
      capture: "Naya scan chalaayein — nayi reading paanchon kshetra ke saath aati hai.",
    });
  }

  const verdict = reading.areas.find((entry) => entry.area === areaId);
  if (verdict === undefined) {
    const present = reading.areas.map((entry) => entry.area);
    return sealed(chapter, {
      code: SEAL_CODES.areaAbsent,
      hi: `${chapter.titleEn} ka koi verdict hi nahi aaya.`,
      detail:
        `Response mein ${present.length} kshetra aaye — ${present.join(", ") || "koi nahi"} — magar ${areaId} unme nahi tha. ` +
        `Yeh "sanket kam the" se alag baat hai: is kshetra par is paath mein faisla liya hi nahi gaya.`,
    });
  }

  if (verdict.band === "INSUFFICIENT") {
    const missing = missingUnderRoots(reading, AREA_FEATURE_ROOTS[areaId]);
    const capturable = missing.filter(isCapturable);
    return sealed(chapter, {
      code: SEAL_CODES.areaInsufficient,
      hi: `${verdict.label_hi_en} par kehne layak sanket nahi mile.`,
      detail:
        `${verdict.label_hi_en}: ${verdict.evidence.length} sanket mile, magar band INSUFFICIENT raha — direction aur ` +
        `strength dono null hain, matlab dekha gaya aur kaha nahi ja saka. Is kshetra ki ${missing.length} keys abhi ` +
        `khaali hain: ${nameKeys(missing)}.`,
      capture:
        capturable.length > 0
          ? `Dobara scan karein — ${nameKeys(capturable, 3)} isi scan se aati hain.`
          : undefined,
    });
  }

  const ids = verdict.evidence.map((item) => item.rule_id);
  const idSet = new Set(ids);
  const partialSeals: SealReason[] = [];
  const locked = lockedSeal(reading, verdict);
  if (locked !== null) partialSeals.push(locked);

  return content(chapter, {
    sections: sectionsCiting(reading, idSet),
    rules: rulesWithIds(reading, idSet),
    area: verdict,
    ruleIds: ids,
    polyline: null,
    birthWindows: [],
    partialSeals,
  });
}

function lineState(chapter: PothiChapter, lineId: PothiLineId, reading: ReadingResponse, geometry: PothiGeometry | null): ChapterState {
  const ids = lineRuleIds(reading, lineId);
  const idSet = new Set(ids);
  const sections = sectionsCiting(reading, idSet);
  const rules = rulesWithIds(reading, idSet);

  if (sections.length === 0 && rules.length === 0) {
    const missing = missingUnderRoots(reading, [`lines.${lineId}`]);
    const capturable = missing.filter(isCapturable);
    return sealed(chapter, {
      code: SEAL_CODES.lineUnread,
      hi: `${chapter.titleHi} par is paath mein kuch nahi aaya.`,
      detail:
        `Na koi narration section is rekha ke rules ka zikr karta hai, na koi rule fire hua. ` +
        `Coverage mein is rekha ki ${missing.length} keys khaali hain: ${nameKeys(missing)}.`,
      capture:
        capturable.length > 0
          ? "Dobara scan karein — hatheli seedhi, ungliyan khuli, taki crease saaf dikhe."
          : undefined,
    });
  }

  const partialSeals: SealReason[] = [lineConfidenceSeal(reading)];
  const locked = lockedSeal(reading, null);
  if (locked !== null) partialSeals.push(locked);

  return content(chapter, {
    sections,
    rules,
    area: null,
    ruleIds: ids,
    polyline: polylineFor(geometry, lineId),
    birthWindows: [],
    partialSeals,
  });
}

function handShapeState(chapter: PothiChapter, reading: ReadingResponse): ChapterState {
  const ids = handRuleIds(reading);
  if (ids.length === 0) {
    const missing = missingUnderRoots(reading, ["hand.shape", "hand.overall_quality"]);
    const capturable = missing.filter(isCapturable);
    return sealed(chapter, {
      code: SEAL_CODES.handShapeUnread,
      hi: "Haath ka aakaar is paath mein tay hi nahi hua.",
      detail:
        `Ek bhi hand.* rule fire nahi hua, aur ${missing.length} hand keys coverage mein khaali hain: ` +
        `${nameKeys(missing)}. Aakaar ka andaza lagana yahan aasaan hota — isliye nahi lagaya gaya.`,
      capture:
        capturable.length > 0
          ? "Dobara scan karein — poora haath frame mein, ungliyan thodi khuli."
          : undefined,
    });
  }

  const idSet = new Set(ids);
  const partialSeals: SealReason[] = [
    {
      code: SEAL_CODES.handShapeValue,
      hi: "Aakaar ka naam yahan chhap hi nahi sakta.",
      detail:
        `Shape ki value client tak aati hi nahi — response par sirf fire hue rules hain, feature bag nahi. ` +
        `Neeche wahi ${ids.length} rule hain jo aapke haath ke aakaar par fire hue; unka naam khud kahin nahi likha.`,
    },
  ];
  const locked = lockedSeal(reading, null);
  if (locked !== null) partialSeals.push(locked);

  return content(chapter, {
    sections: sectionsCiting(reading, idSet),
    rules: rulesWithIds(reading, idSet),
    area: null,
    ruleIds: ids,
    polyline: null,
    birthWindows: [],
    partialSeals,
  });
}

function lifeDirectionState(chapter: PothiChapter, reading: ReadingResponse): ChapterState {
  const windows = birthWindowsOf(reading);
  if (windows.length === 0) {
    return sealed(chapter, {
      code: SEAL_CODES.birthWindowsAbsent,
      hi: "Jeevan-disha ke liye janm-tithi chahiye.",
      detail:
        `Is response par ek bhi birth window nahi aaya. Janm-tithi naapi nahi jaati — wo aap batate hain — ` +
        `isliye camera se yeh khaana kabhi nahi bharega.`,
      capture: "Janm-tithi darj karein — DOB ke bina yeh adhyaay khulta hi nahi.",
    });
  }

  return content(chapter, {
    sections: [],
    rules: [],
    area: null,
    ruleIds: [],
    polyline: null,
    birthWindows: windows,
    partialSeals: [
      {
        code: SEAL_CODES.birthWindowsUndeclared,
        hi: "Window ke naam aate hain, unki tareekhein nahi.",
        detail:
          `birthWindows wire par maujood hai magar ReadingResponse type par declare nahi — isliye sirf ${windows.length} ` +
          `window id (${nameKeys(windows, 3)}) aate hain. Inke date range KB ke andar rehte hain, client tak nahi aate.`,
      },
    ],
  });
}

function completeReadingState(chapter: PothiChapter, reading: ReadingResponse): ChapterState {
  const ids = reading.rules.map((rule) => rule.rule_id);
  const partialSeals: SealReason[] = [];
  const locked = lockedSeal(reading, null);
  if (locked !== null) partialSeals.push(locked);

  const state = content(chapter, {
    sections: reading.narration.sections,
    rules: reading.rules,
    area: null,
    ruleIds: ids,
    polyline: null,
    birthWindows: [],
    partialSeals,
  });
  if (state.status === "content") return state;

  return sealed(chapter, {
    code: SEAL_CODES.readingEmpty,
    hi: "Is paath mein chhaapne ko kuch nahi hai.",
    detail:
      `Na koi section, na ek bhi fire hua rule. Coverage ${reading.coverage.provided.length} keys par ruka — ` +
      `itne se koi vaakya nahi banta.`,
    capture: "Dobara scan karein — is baar rukein jab tak rekhaayein lock na ho jaayein.",
  });
}

/**
 * Decide what one chapter may honestly show.
 *
 * The order of the branches is the policy. Launch seals first, because no response may talk chapters
 * VI, VII or XIV open. Then the kind-specific resolvers, each of which prefers a seal it can justify
 * over content it would have to pad. The `content()` gate has the last word.
 *
 * @param chapter one of {@link POTHI_CHAPTERS}
 * @param reading the response as the client received it — `areas` may legitimately be absent
 * @param geometry the scan session's hand-off, or null; the response itself carries no geometry
 */
export function resolveChapter(
  chapter: PothiChapter,
  reading: ReadingResponse,
  geometry: PothiGeometry | null,
): ChapterState {
  /* Sealed at launch, whatever the response says. Each reason is pipeline fact, not response state. */
  if (chapter.numeral === "VI") return sealed(chapter, reservedLineSeal(reading));
  if (chapter.numeral === "VII") return sealed(chapter, mountsSeal(reading));
  if (chapter.numeral === "XIV") return sealed(chapter, questionSeal(reading));

  if (chapter.numeral === "I") return handShapeState(chapter, reading);
  if (chapter.numeral === "XIII") return lifeDirectionState(chapter, reading);
  if (chapter.numeral === "XV") return completeReadingState(chapter, reading);

  if (chapter.kind === "area" && chapter.areaId !== undefined) {
    return areaState(chapter, chapter.areaId, reading);
  }
  if (chapter.kind === "line" && chapter.lineId !== undefined) {
    return lineState(chapter, chapter.lineId, reading, geometry);
  }

  /* Unreachable for POTHI_CHAPTERS, and still a named seal rather than an invented page. */
  return sealed(chapter, {
    code: SEAL_CODES.nothingToPrint,
    hi: "Is adhyaay ka koi source nahi hai.",
    detail: `Chapter ${chapter.numeral} kind "${chapter.kind}" hai aur uske liye koi resolver nahi — isliye yahan kuch nahi chhapta.`,
  });
}

/** The whole book, resolved in order. Convenience for a route that renders all fifteen leaves. */
export function resolvePothi(reading: ReadingResponse, geometry: PothiGeometry | null): readonly ChapterState[] {
  return POTHI_CHAPTERS.map((chapter) => resolveChapter(chapter, reading, geometry));
}
