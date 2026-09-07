/* ============================================================================
 * POTHI DATA — what the fifteen leaves are allowed to say
 *
 * This suite exists to make A2 mechanical. The Pothi's failure mode is not a
 * crash; it is a beautiful page that quietly says nothing true. So the pins
 * here are all about REFUSAL:
 *
 *  1. The three launch seals cannot be argued open. VI, VII and XIV stay sealed
 *     against a maximal, everything-present response — the exact input that
 *     would tempt a resolver into rendering them.
 *
 *  2. "Not scored" and "not enough" are different words. An area missing from
 *     areas[] and an area whose band is INSUFFICIENT get different codes,
 *     because "we did not look" and "we looked and cannot say" are different
 *     promises to the reader.
 *
 *  3. Content is never empty. Every state that comes back "content", over every
 *     fixture in this file, must carry at least one non-empty string taken from
 *     the response. This is the assertion that makes a placeholder impossible.
 *
 *  4. Capture is a promise, so it is audited. No seal about mounts or about the
 *     RESERVED lines may carry a capture instruction — there is no producer for
 *     those keys, and "scan again" would be a lie the material makes look
 *     official.
 *
 *  5. R4 provenance. A source row appears only where that source really fired,
 *     and the struck names never appear at all — including for an input built
 *     specifically to smuggle them through a legitimate match.
 *
 * The derived tables (area feature roots, area labels, the line-attribution
 * predicate, the not-capturable key list) are checked against the committed
 * data and against lib/scan/features.ts, so a KB rebuild or a scan change fails
 * this suite instead of quietly making a seal cite keys that no longer exist.
 * ========================================================================== */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  AREA_FEATURE_ROOTS,
  CAPTURABLE_FEATURE_PREFIXES,
  HAND_RULE_PREFIX,
  HAND_RULE_TAG,
  LINE_RULE_PREFIXES,
  LINE_RULE_TAGS,
  NOT_CAPTURABLE_FEATURE_KEYS,
  POTHI_CHAPTERS,
  SEAL_CODES,
  birthWindowsOf,
  contentTexts,
  handRuleIds,
  lineRuleIds,
  resolveChapter,
  resolvePothi,
  type ChapterState,
  type PothiAreaId,
  type PothiGeometry,
  type PothiLineId,
} from "../lib/sanctuary/pothi-chapters";
import { STRUCK_SOURCE_NAMES, provenanceRows } from "../lib/sanctuary/pothi-provenance";
import type {
  AreaSource,
  PublicAreaEvidence,
  PublicAreaVerdict,
  PublicRule,
  ReadingResponse,
} from "../app/read/reading-types";

let assertions = 0;
const ok = (condition: boolean, message: string): void => {
  assert.ok(condition, message);
  assertions += 1;
};

/* ------------------------------ Real-shaped fixtures ----------------------- */

const CHEIRO: AreaSource = { text: "Cheiro — Palmistry for All", loc: "Ch.VII — the Line of Heart", year: 1916 };
const DALE: AreaSource = { text: "Dale — Indian Palmistry", loc: "Sec. 12 — the Line of Fate", year: 1895 };
/** Year is genuinely null in data/kb/hastrekha_kb.json; the type says number. Both are on the wire. */
const SAMUDRIKA = {
  text: "Samudrika tradition (cross-verification pending Hindi source pass)",
  loc: "bhagya rekha",
  year: null,
} as unknown as AreaSource;

function rule(over: Partial<PublicRule> = {}): PublicRule {
  return {
    rule_id: "PALM-HEART-003",
    category: "love",
    polarity: "positive",
    interpretation_hi_en: "Hriday rekha lambi hai — aap dil se judte hain.",
    weight: 0.8,
    source: "Cheiro — Palmistry for All (1916) — Ch.VII — the Line of Heart",
    tags: ["heart_line"],
    ...over,
  };
}

function evidence(over: Partial<PublicAreaEvidence> = {}): PublicAreaEvidence {
  return {
    rule_id: "PALM-HEART-003",
    role: "primary",
    polarity: "positive",
    contribution: 0.42,
    interpretation_hi_en: "Hriday rekha lambi hai — aap dil se judte hain.",
    sources: [CHEIRO],
    ...over,
  };
}

function verdict(over: Partial<PublicAreaVerdict> = {}): PublicAreaVerdict {
  return {
    area: "rishte",
    label_hi_en: "Pyaar aur Rishte",
    direction: "anukool",
    strength: 71,
    band: "HIGH",
    conflict: 0.1,
    independence: 0.6,
    coverage: 0.4,
    evidence: [evidence()],
    lockedEvidenceCount: 0,
    meta: { map_version: "v1", engine_version: "1.0.0" },
    ...over,
  };
}

/** Every KB feature key an area could want, so a fixture can decide what is missing by subtraction. */
const ALL_MISSING: readonly string[] = [
  "lines.heart.origin",
  "lines.heart.length_norm",
  "lines.head.origin",
  "lines.life.arc",
  "lines.fate.origin",
  "lines.sun.present",
  "lines.marriage.count",
  "mounts.venus.prominence",
  "mounts.jupiter.prominence",
  "signs.star.on_mount",
  "geometry.quadrangle_shape",
  "nails.furrow_position",
  "fingers.mercury.length",
  "thumb.joint_top",
  "user.birth_date",
];

function reading(over: Partial<ReadingResponse> = {}): ReadingResponse {
  return {
    readingId: "rd_1",
    narration: {
      one_liner: "Aapka haath sthirta aur naye raaste dono dikhata hai.",
      sections: [
        { title: "Pyaar", body: "Hriday rekha par sanket saaf hain.", rule_ids: ["PALM-HEART-003"] },
        { title: "Karm", body: "Bhagya rekha Chandra parvat se uthti hai.", rule_ids: ["PALM-FATE-003"] },
      ],
      disclaimer: "Yeh paath manoranjan aur atma-chintan ke liye hai.",
      engine: "template",
      ...over.narration,
    },
    rules: [rule(), rule({ rule_id: "PALM-FATE-003", category: "career", tags: ["fate_line"], source: "Cheiro — Palmistry for All (1916) — Ch.V, Plate XI" })],
    clusters: [],
    areas: [verdict()],
    lockedRuleCount: 0,
    confidence: 0.62,
    coverage: { provided: ["lines.heart.origin"], missing: ALL_MISSING, ratio: 0.4 },
    ...over,
  };
}

/** The tempting input: everything present, every area HIGH, an LLM narration, geometry in hand. */
function maximalReading(): ReadingResponse {
  const areaIds: readonly PothiAreaId[] = ["dhan", "rishte", "karm", "sehat", "swabhav"];
  const labels: Record<PothiAreaId, string> = {
    dhan: "Paisa aur Samriddhi",
    rishte: "Pyaar aur Rishte",
    karm: "Career aur Kaam",
    sehat: "Urja aur Sehat",
    swabhav: "Swabhav",
  };
  const lineIds: readonly PothiLineId[] = ["heart", "head", "life", "fate", "sun", "health"];
  const rules: PublicRule[] = lineIds.map((line, index) =>
    rule({
      rule_id: `PALM-MAX-${index}`,
      tags: [LINE_RULE_TAGS[line][0]],
      interpretation_hi_en: `Rekha ${line} par sanket mila.`,
    }),
  );
  rules.push(rule({ rule_id: "PALM-HTYPE-001", tags: [HAND_RULE_TAG], interpretation_hi_en: "Haath ka aakaar square hai." }));

  const base = reading({
    rules,
    narration: {
      one_liner: "Sab kuch maujood hai.",
      sections: rules.map((item) => ({ title: item.rule_id, body: `Section for ${item.rule_id}.`, rule_ids: [item.rule_id] })),
      disclaimer: "Yeh paath manoranjan ke liye hai.",
      engine: "llm",
    },
    areas: areaIds.map((area) =>
      verdict({
        area,
        label_hi_en: labels[area],
        band: "HIGH",
        evidence: [evidence({ rule_id: "PALM-MAX-0", sources: [CHEIRO, DALE, SAMUDRIKA] })],
      }),
    ),
    coverage: { provided: ALL_MISSING, missing: [], ratio: 1 },
  });
  return { ...base, birthWindows: ["MARS_POS", "VENUS_POS"] } as ReadingResponse;
}

const GEOMETRY: PothiGeometry = {
  size: 256,
  lines: [
    { id: "heart", points: [[10, 40], [120, 36], [230, 44]], observedFraction: 0.8 },
    { id: "sun", points: [[100, 200], [110, 120]], observedFraction: 0.2 },
  ],
};

const chapter = (numeral: string) => {
  const found = POTHI_CHAPTERS.find((entry) => entry.numeral === numeral);
  assert.ok(found !== undefined, `chapter ${numeral} exists`);
  return found;
};

/* ------------------------- 1. The book itself ------------------------------ */

{
  const ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII", "XIII", "XIV", "XV"];
  const DEVANAGARI = ["०१", "०२", "०३", "०४", "०५", "०६", "०७", "०८", "०९", "१०", "११", "१२", "१३", "१४", "१५"];

  ok(POTHI_CHAPTERS.length === 15, "the Pothi has exactly fifteen chapters");
  assert.deepEqual(POTHI_CHAPTERS.map((c) => c.numeral), ROMAN);
  assertions += 1;
  assert.deepEqual(POTHI_CHAPTERS.map((c) => c.devanagariNumeral), DEVANAGARI);
  assertions += 1;

  ok(
    POTHI_CHAPTERS.every((c) => c.titleHi.trim().length > 0 && c.titleEn.trim().length > 0),
    "every chapter is titled in both scripts",
  );
  ok(
    POTHI_CHAPTERS.every((c) => /[ऀ-ॿ]/.test(c.titleHi)),
    "the Hindi title is really Devanagari — the numerals and titles are the only Devanagari in the book",
  );
  ok(
    POTHI_CHAPTERS.filter((c) => c.kind === "area").length === 5 &&
      POTHI_CHAPTERS.filter((c) => c.kind === "line").length === 5,
    "five area chapters and five line chapters (VI folds sun and mercury into one)",
  );
  const areaIds = POTHI_CHAPTERS.filter((c) => c.areaId !== undefined).map((c) => c.areaId);
  assert.deepEqual([...areaIds].sort(), ["dhan", "karm", "rishte", "sehat", "swabhav"]);
  assertions += 1;
  console.log("  fifteen chapters, numerals I–XV / ०१–१५, five lines + five areas");
}

/* ---------------- 2. Derived tables agree with the committed data ---------- */

{
  const map = JSON.parse(readFileSync("data/areas/area-map.v1.json", "utf8")) as {
    areas: Record<string, { feature_roots: string[]; label_hi_en: string }>;
  };
  for (const [area, roots] of Object.entries(AREA_FEATURE_ROOTS)) {
    assert.deepEqual(
      [...roots].sort(),
      [...map.areas[area].feature_roots].sort(),
      `AREA_FEATURE_ROOTS.${area} must match the generated map — an INSUFFICIENT seal names these keys`,
    );
    assertions += 1;
  }
  for (const c of POTHI_CHAPTERS) {
    if (c.areaId === undefined) continue;
    ok(
      c.titleEn === map.areas[c.areaId].label_hi_en,
      `chapter ${c.numeral} carries the engine's own label for ${c.areaId} — one area, one name`,
    );
  }

  /* The not-capturable list is a copy of a scan constant; read the source rather than import it. */
  const featuresSrc = readFileSync("lib/scan/features.ts", "utf8");
  for (const key of NOT_CAPTURABLE_FEATURE_KEYS) {
    ok(
      featuresSrc.includes(`"${key}":`),
      `${key} is still listed in NOT_DERIVABLE_FROM_LANDMARKS — a camera cannot see it`,
    );
  }
  ok(featuresSrc.includes('"mounts.*":'), "mounts are still declared underivable from landmarks");
  ok(
    !CAPTURABLE_FEATURE_PREFIXES.some((prefix) => prefix.startsWith("mounts") || prefix.startsWith("signs")),
    "no mounts.* or signs.* prefix is ever claimed capturable",
  );
  console.log(`  feature roots + labels match area-map.v1.json; ${NOT_CAPTURABLE_FEATURE_KEYS.length} keys still underivable`);
}

/* ------------- 3. Line attribution, measured against the real KB ----------- */

{
  const kb = JSON.parse(readFileSync("data/kb/hastrekha_kb.json", "utf8")) as {
    rules: { rule_id: string; tags?: string[]; conditions?: { feature: string }[] }[];
  };
  const asWire = kb.rules.map((r) => rule({ rule_id: r.rule_id, tags: r.tags ?? [] }));
  const whole = reading({ rules: asWire });

  /** Floors, not equalities: the KB grows, and a predicate that only gets better must not fail. */
  const FLOORS: Readonly<Record<PothiLineId, { recall: number; precision: number }>> = {
    heart: { recall: 1.0, precision: 0.9 },
    head: { recall: 0.85, precision: 0.85 },
    life: { recall: 0.75, precision: 0.85 },
    fate: { recall: 0.8, precision: 0.9 },
    sun: { recall: 0.75, precision: 0.95 },
    health: { recall: 0.85, precision: 0.85 },
  };
  const report: string[] = [];
  for (const [line, floor] of Object.entries(FLOORS) as [PothiLineId, { recall: number; precision: number }][]) {
    const truth = new Set(
      kb.rules
        .filter((r) => (r.conditions ?? []).some((c) => c.feature === `lines.${line}` || c.feature.startsWith(`lines.${line}.`)))
        .map((r) => r.rule_id),
    );
    const predicted = new Set(lineRuleIds(whole, line));
    const hit = [...predicted].filter((id) => truth.has(id)).length;
    const recall = hit / truth.size;
    const precision = hit / predicted.size;
    ok(recall >= floor.recall, `${line}: recall ${recall.toFixed(2)} holds the floor ${floor.recall}`);
    ok(precision >= floor.precision, `${line}: precision ${precision.toFixed(2)} holds the floor ${floor.precision}`);
    report.push(`${line} r=${recall.toFixed(2)}/p=${precision.toFixed(2)}`);
  }

  const kbIds = new Set(kb.rules.map((r) => r.rule_id));
  for (const [line, prefixes] of Object.entries(LINE_RULE_PREFIXES) as [PothiLineId, readonly string[]][]) {
    ok(
      prefixes.every((prefix) => [...kbIds].some((id) => id.startsWith(prefix))),
      `${line}: every declared rule-id prefix still matches rules in the KB — a dead prefix silently seals a chapter`,
    );
    ok(LINE_RULE_TAGS[line].length > 0, `${line}: has at least one tag signal as well as a prefix`);
  }

  const handTruth = new Set(
    kb.rules
      .filter((r) => (r.conditions ?? []).some((c) => c.feature === "hand" || c.feature.startsWith("hand.")))
      .map((r) => r.rule_id),
  );
  const handPredicted = new Set(handRuleIds(whole));
  const handHit = [...handPredicted].filter((id) => handTruth.has(id)).length;
  ok(handHit === handPredicted.size, "every rule chapter I claims really reads hand.* — precision 1.00");
  ok(handPredicted.size > 0 && HAND_RULE_PREFIX.startsWith("PALM-"), "chapter I finds its rules at all");
  console.log(`  line attribution vs KB: ${report.join(" ")}`);
}

/* --------------- 4. The three launch seals cannot be argued open ----------- */

{
  const inputs: readonly ReadingResponse[] = [reading(), maximalReading(), reading({ areas: undefined })];
  for (const numeral of ["VI", "VII", "XIV"]) {
    for (const input of inputs) {
      for (const geometry of [null, GEOMETRY]) {
        const state = resolveChapter(chapter(numeral), input, geometry);
        ok(state.status === "sealed", `chapter ${numeral} is sealed at launch, whatever the response carries`);
        if (state.status !== "sealed") continue;
        ok(state.reason.detail.trim().length > 0, `chapter ${numeral} says WHY it is sealed`);
        ok(
          state.reason.capture === undefined,
          `chapter ${numeral} promises no rescan — nothing a camera does can open it`,
        );
      }
    }
  }
  const six = resolveChapter(chapter("VI"), reading(), GEOMETRY);
  const seven = resolveChapter(chapter("VII"), reading(), null);
  const fourteen = resolveChapter(chapter("XIV"), reading(), null);
  ok(six.status === "sealed" && six.reason.code === SEAL_CODES.lineReserved, "VI seals as RESERVED, not as 'no data'");
  ok(seven.status === "sealed" && seven.reason.code === SEAL_CODES.mountsUnmeasured, "VII seals as never-measured");
  ok(
    fourteen.status === "sealed" && fourteen.reason.code === SEAL_CODES.questionNotEchoed,
    "XIV seals because the question is input-only",
  );
  /* VI is handed a sun polyline on purpose: geometry must not be able to unseal a RESERVED line. */
  ok(
    GEOMETRY.lines.some((line) => line.id === "sun"),
    "the fixture really does offer VI a polyline, so the seal is doing work",
  );
  console.log("  VI / VII / XIV: sealed against a maximal response, and none of them promises a rescan");
}

/* ------------------ 5. Area chapters: three different silences ------------- */

{
  const eight = chapter("VIII");

  const high = resolveChapter(eight, reading(), null);
  ok(high.status === "content", "a HIGH area opens");
  ok(high.status === "content" && high.area?.area === "rishte", "and carries its own verdict");

  const insufficient = resolveChapter(
    eight,
    reading({ areas: [verdict({ band: "INSUFFICIENT", direction: null, strength: null })] }),
    null,
  );
  ok(insufficient.status === "sealed", "an INSUFFICIENT area seals");
  ok(
    insufficient.status === "sealed" && insufficient.reason.code === SEAL_CODES.areaInsufficient,
    "with the 'we looked and cannot say' code",
  );
  if (insufficient.status === "sealed") {
    const named = AREA_FEATURE_ROOTS.rishte.some((root) => insufficient.reason.detail.includes(root.split(".")[0]));
    ok(named, "and names real KB keys from that area's own roots");
    ok(
      insufficient.reason.detail.includes("Pyaar aur Rishte"),
      "and calls the area by the name the reader saw on the card",
    );
  }

  const notScored = resolveChapter(eight, reading({ areas: undefined }), null);
  ok(notScored.status === "sealed", "an absent areas[] seals");
  ok(
    notScored.status === "sealed" && notScored.reason.code === SEAL_CODES.areaNotScored,
    "with its own code — a response that never scored areas is not a response short of evidence",
  );

  const absent = resolveChapter(eight, reading({ areas: [verdict({ area: "dhan", label_hi_en: "Paisa aur Samriddhi" })] }), null);
  ok(
    absent.status === "sealed" && absent.reason.code === SEAL_CODES.areaAbsent,
    "an area missing from a populated areas[] seals with yet another code",
  );

  const codes = new Set(
    [insufficient, notScored, absent].map((state) => (state.status === "sealed" ? state.reason.code : "content")),
  );
  ok(codes.size === 3, "insufficient / not-scored / absent are three distinct codes, never blurred into one");

  /* Whether a rescan is offered depends on whether the missing keys have a producer at all. */
  const mountsOnly = resolveChapter(
    eight,
    reading({
      areas: [verdict({ band: "INSUFFICIENT", direction: null, strength: null })],
      coverage: { provided: [], missing: ["mounts.venus.prominence", "signs.star.on_mount"], ratio: 0 },
    }),
    null,
  );
  ok(
    mountsOnly.status === "sealed" && mountsOnly.reason.capture === undefined,
    "an area short only of mounts and signs is NOT told to scan again — nothing produces those keys",
  );
  const linesMissing = resolveChapter(
    eight,
    reading({
      areas: [verdict({ band: "INSUFFICIENT", direction: null, strength: null })],
      coverage: { provided: [], missing: ["lines.heart.origin", "lines.head.origin"], ratio: 0 },
    }),
    null,
  );
  ok(
    linesMissing.status === "sealed" && (linesMissing.reason.capture ?? "").length > 0,
    "an area short of crease keys IS told to scan again — those the scan really produces",
  );
  console.log("  areas: HIGH opens; insufficient / not-scored / absent seal with three distinct codes");
}

/* --------------- 6. Line chapters, chapter I, XIII and XV ------------------ */

{
  const two = resolveChapter(chapter("II"), reading(), GEOMETRY);
  ok(two.status === "content", "a heart chapter with a section and a fired rule opens");
  if (two.status === "content") {
    ok(two.polyline !== null && two.polyline.length === 3, "and draws the measured crease from the hand-off");
    ok(
      two.partialSeals.some((seal) => seal.code === SEAL_CODES.lineConfidence),
      "while sealing the per-line confidence badge — there is no such number on the wire",
    );
    ok(
      two.partialSeals.some((seal) => seal.detail.includes("0.62")),
      "and quoting the ONE confidence the response does carry",
    );
  }
  const twoNoGeometry = resolveChapter(chapter("II"), reading(), null);
  ok(
    twoNoGeometry.status === "content" && twoNoGeometry.polyline === null,
    "the same chapter opens without geometry and simply has no line to draw",
  );

  const bare = reading({ rules: [], narration: { one_liner: "x", sections: [], disclaimer: "d", engine: "template" } });
  const three = resolveChapter(chapter("III"), bare, null);
  ok(
    three.status === "sealed" && three.reason.code === SEAL_CODES.lineUnread,
    "a line with neither a section nor a fired rule seals",
  );

  const one = resolveChapter(chapter("I"), reading({ rules: [rule({ rule_id: "PALM-HTYPE-002", tags: ["hand_type"] })] }), null);
  ok(one.status === "content", "chapter I opens when a hand.* rule fired");
  ok(
    one.status === "content" && one.partialSeals.some((seal) => seal.code === SEAL_CODES.handShapeValue),
    "but seals the shape VALUE, which never reaches the client",
  );
  const oneEmpty = resolveChapter(chapter("I"), bare, null);
  ok(
    oneEmpty.status === "sealed" && oneEmpty.reason.code === SEAL_CODES.handShapeUnread,
    "with no hand rule at all the whole chapter seals",
  );

  const thirteen = resolveChapter(chapter("XIII"), reading(), null);
  ok(
    thirteen.status === "sealed" && thirteen.reason.code === SEAL_CODES.birthWindowsAbsent,
    "XIII seals without a birth date, and asks for one rather than for a scan",
  );
  ok(
    thirteen.status === "sealed" && (thirteen.reason.capture ?? "").includes("Janm-tithi"),
    "the instruction names the birth date, because no camera can measure it",
  );
  const thirteenOpen = resolveChapter(chapter("XIII"), maximalReading(), null);
  ok(thirteenOpen.status === "content", "XIII opens when birthWindows really is on the wire");
  ok(
    thirteenOpen.status === "content" && thirteenOpen.birthWindows.includes("MARS_POS"),
    "carrying the undeclared key's real values",
  );
  ok(
    thirteenOpen.status === "content" &&
      thirteenOpen.partialSeals.some((seal) => seal.code === SEAL_CODES.birthWindowsUndeclared),
    "and sealing the date ranges, which stay in the KB",
  );
  ok(birthWindowsOf(reading()).length === 0, "a response without the undeclared key reads as no windows, not a throw");
  ok(
    birthWindowsOf({ ...reading(), birthWindows: [1, "OK", ""] } as unknown as ReadingResponse).length === 1,
    "and non-string junk on that undeclared key is filtered rather than rendered",
  );

  const fifteen = resolveChapter(chapter("XV"), reading(), null);
  ok(fifteen.status === "content" && fifteen.rules.length === 2, "XV carries the whole response");
  const fifteenEmpty = resolveChapter(
    chapter("XV"),
    reading({ rules: [], narration: { one_liner: "", sections: [], disclaimer: "", engine: "template" } }),
    null,
  );
  ok(
    fifteenEmpty.status === "sealed" && fifteenEmpty.reason.code === SEAL_CODES.readingEmpty,
    "and seals when the response carries no text at all",
  );

  const lockedState = resolveChapter(chapter("XV"), reading({ lockedRuleCount: 7 }), null);
  ok(
    lockedState.status === "content" && lockedState.partialSeals.some((seal) => seal.detail.includes("7 rule")),
    "withheld rows are stated as a number, not implied by a gap",
  );
  console.log("  lines / I / XIII / XV: partial seals name the missing part instead of hiding it");
}

/* ------------------- 7. THE A2 PIN: content is never empty ----------------- */

{
  const inputs: readonly ReadingResponse[] = [
    reading(),
    maximalReading(),
    reading({ areas: undefined }),
    reading({ rules: [], narration: { one_liner: "", sections: [], disclaimer: "", engine: "template" } }),
    reading({ areas: [verdict({ band: "INSUFFICIENT", direction: null, strength: null, evidence: [] })] }),
    reading({ coverage: { provided: [], missing: [], ratio: 0 } }),
  ];
  let opened = 0;
  let sealedCount = 0;
  for (const input of inputs) {
    for (const geometry of [null, GEOMETRY]) {
      for (const state of resolvePothi(input, geometry)) {
        if (state.status === "content") {
          opened += 1;
          ok(
            contentTexts(state).length > 0,
            `chapter ${state.chapter.numeral} returned content — it must carry a real string from the response`,
          );
          ok(
            contentTexts(state).every((text) => text.trim().length > 0),
            `chapter ${state.chapter.numeral} carries no blank string`,
          );
        } else {
          sealedCount += 1;
          ok(state.reason.code.length > 0, `chapter ${state.chapter.numeral} seal is machine-readable`);
          ok(state.reason.hi.trim().length > 0, `chapter ${state.chapter.numeral} seal has an ink line`);
          ok(state.reason.detail.trim().length > 0, `chapter ${state.chapter.numeral} seal says why`);
        }
      }
    }
  }
  ok(opened > 0 && sealedCount > 0, "the fixtures really exercise both outcomes");
  console.log(`  A2: ${opened} content states all carry real text; ${sealedCount} seals all name a reason`);
}

/* ------------------------ 8. R4 provenance, exactly ------------------------ */

{
  const cheiroOnly = reading({ areas: [verdict({ evidence: [evidence({ sources: [CHEIRO] })] })] });
  let rows = provenanceRows(cheiroOnly, ["PALM-HEART-003"]);
  assert.deepEqual(rows.map((r) => r.key), ["classical"]);
  assertions += 1;

  const withDale = reading({ areas: [verdict({ evidence: [evidence({ sources: [CHEIRO, DALE] })] })] });
  rows = provenanceRows(withDale, ["PALM-HEART-003"]);
  assert.deepEqual(rows.map((r) => r.key), ["classical", "indian"]);
  assertions += 1;
  ok(rows[1].source.includes("1895"), "Dale is cited with the year the KB actually carries");

  const daleOnly = reading({ areas: [verdict({ evidence: [evidence({ sources: [DALE] })] })] });
  ok(
    provenanceRows(daleOnly, ["PALM-HEART-003"]).every((r) => r.key !== "classical"),
    "Cheiro does not appear when Cheiro did not fire",
  );

  /* Samudrika lives at sources[1] in the KB, so ONLY structured evidence can ever reveal it. */
  const samudrika = reading({ areas: [verdict({ evidence: [evidence({ rule_id: "PALM-FATE-003", sources: [CHEIRO, SAMUDRIKA] })] })] });
  rows = provenanceRows(samudrika, ["PALM-FATE-003"]);
  ok(rows.some((r) => r.key === "samudrika"), "the one Samudrika rule earns its row");
  const joinedOnly = reading({
    areas: undefined,
    rules: [rule({ rule_id: "PALM-FATE-003", source: "Cheiro — Palmistry for All (1916) — Ch.V, Plate XI position 3, p.51" })],
  });
  ok(
    provenanceRows(joinedOnly, ["PALM-FATE-003"]).every((r) => r.key !== "samudrika"),
    "and the joined rules[].source cannot reveal it — that field keeps sources[0] only",
  );
  ok(
    provenanceRows(joinedOnly, ["PALM-FATE-003"]).some((r) => r.key === "classical"),
    "while the joined field still recovers the first source, so a pre-areas response is not blank",
  );

  /* The AI row tracks the narrator, not the books. */
  ok(
    provenanceRows(cheiroOnly, ["PALM-HEART-003"]).every((r) => r.key !== "ai"),
    "a template narration never credits an AI",
  );
  const llm = reading({
    narration: {
      one_liner: "x",
      sections: [{ title: "Pyaar", body: "b", rule_ids: ["PALM-HEART-003"] }],
      disclaimer: "d",
      engine: "llm",
    },
  });
  ok(provenanceRows(llm, ["PALM-HEART-003"]).some((r) => r.key === "ai"), "an llm narration does");
  ok(
    provenanceRows(llm, ["PALM-FATE-003"]).every((r) => r.key !== "ai"),
    "but only on the leaf whose rules it actually wrote about",
  );

  ok(provenanceRows(reading(), []).length === 0, "no rules means no rows — an empty answer is a correct answer");

  /* The smuggling attempt: struck names ride in on texts that would otherwise match. */
  const smuggled = reading({
    areas: [
      verdict({
        evidence: [
          evidence({
            sources: [
              { text: "Cheiro — Palmistry for All / Brihat Samhita", loc: "x", year: 1916 },
              { text: "Brihat Samhita", loc: "y", year: 500 },
              { text: "Hastarekha Shastra", loc: "z", year: 1900 },
              { text: "Dale — Indian Palmistry, after Hastarekha Shastra", loc: "w", year: 1895 },
            ],
          }),
        ],
      }),
    ],
    rules: [rule({ source: "Hastarekha Shastra (1900) — smuggled" })],
  });
  const smuggledRows = provenanceRows(smuggled, ["PALM-HEART-003"]);
  for (const struck of STRUCK_SOURCE_NAMES) {
    ok(
      smuggledRows.every((r) => !r.title.includes(struck) && !r.source.includes(struck)),
      `${struck} is STRUCK and never reaches a row, even through a matching source text`,
    );
  }
  ok(
    smuggledRows.map((r) => r.key).join(",") === "classical,indian",
    "the legitimate halves still resolve — to canonical strings, not to the smuggled text",
  );

  const everyInput: readonly ReadingResponse[] = [reading(), maximalReading(), smuggled, cheiroOnly, joinedOnly];
  for (const input of everyInput) {
    for (const state of resolvePothi(input, GEOMETRY)) {
      const ids = state.status === "content" ? state.ruleIds : [];
      for (const row of provenanceRows(input, ids)) {
        ok(
          STRUCK_SOURCE_NAMES.every((struck) => !row.source.includes(struck) && !row.title.includes(struck)),
          "no chapter of any fixture can print a struck name",
        );
        ok(
          ["classical", "indian", "samudrika", "ai"].includes(row.key),
          "and no row exists outside the four the KB can justify",
        );
      }
    }
  }
  console.log("  R4: Cheiro/Dale/Samudrika only when cited, AI only when engine is llm, struck names unreachable");
}

/* -------------------- 9. Every chapter resolves, for real ------------------ */

{
  const states: readonly ChapterState[] = resolvePothi(maximalReading(), GEOMETRY);
  ok(states.length === 15, "resolvePothi returns the whole book");
  ok(
    states.every((state) => state.chapter.numeral.length > 0),
    "every state carries its chapter, so a leaf never has to look one up",
  );
  const open = states.filter((state) => state.status === "content").map((state) => state.chapter.numeral);
  ok(!open.includes("VI") && !open.includes("VII") && !open.includes("XIV"), "and the launch seals hold at the top level");
  ok(open.length >= 10, `a maximal response opens most of the book (${open.length}/15: ${open.join(" ")})`);
  console.log(`  maximal response opens ${open.length}/15 chapters: ${open.join(" ")}`);
}

console.log(`POTHI DATA ASSERTIONS PASSED (${assertions})`);
