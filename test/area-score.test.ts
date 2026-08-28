/**
 * Life-area scoring: does an area verdict say what the hand actually said?
 *
 * Three things are being pinned, and they fail in different directions.
 *
 * That the maths *behaves* — a one-sided area leans, a split area refuses to, a secondary
 * membership counts half, and an area nobody fired in says INSUFFICIENT rather than presenting a
 * confident-looking neutral.
 *
 * That two **product guarantees** hold on a DOB-only reading, where a user has given a birth date
 * and no palm at all. Those are asserted explicitly in section 2 and explained there, because they
 * are the difference between "we can't say yet" and a fabricated money verdict.
 *
 * And that the output is **pinned exactly**. The scoring constants are all judgement calls; the
 * only thing stopping a later tweak from quietly moving every published verdict is a snapshot that
 * has to be re-baselined on purpose. Same discipline as test/golden.test.ts, same reason.
 */
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import {
  AREA_IDS,
  AREA_ENGINE_VERSION,
  evaluateRules,
  loadAreaMap,
  loadKnowledgeBase,
  scoreAreas,
  AreaMapValidationError,
  type AreaId,
  type AreaMap,
  type AreaVerdict,
  type FeatureBag,
  type FiredRule,
  type KbRule,
  type KnowledgeBase,
} from "../lib/hastrekha";

const KB: KnowledgeBase = loadKnowledgeBase(JSON.parse(readFileSync("data/kb/hastrekha_kb.json", "utf8")));
const MAP: AreaMap = loadAreaMap(KB);
const KB_BY_ID = new Map<string, KbRule>(KB.rules.map((rule) => [rule.rule_id, rule]));

/** Frozen so `meta.evaluatedAt` never reaches a snapshot. */
const FIXED_NOW = "2026-01-01T00:00:00.000Z";

/** A FiredRule built from a REAL KB rule — synthetic rules would prove nothing about the map. */
function fire(ruleId: string, effectiveWeight?: number): FiredRule {
  const rule = KB_BY_ID.get(ruleId);
  assert.ok(rule !== undefined, `fixture references a real KB rule (${ruleId})`);
  return {
    rule,
    effectiveWeight: effectiveWeight ?? rule.weight,
    reasons: ["full_match"],
    sourceTexts: [...new Set(rule.sources.map((source) => source.text))],
  };
}

const byArea = (verdicts: readonly AreaVerdict[]): Record<AreaId, AreaVerdict> =>
  Object.fromEntries(verdicts.map((v) => [v.area, v])) as Record<AreaId, AreaVerdict>;

/* ------------------------------- 1. Unit ---------------------------------- */

{
  /* Always five, always in the fixed order — a missing area would read as a rendering bug. */
  const verdicts = scoreAreas({ fired: [], providedFeatures: [] }, MAP);
  assert.deepEqual(
    verdicts.map((v) => v.area),
    [...AREA_IDS],
    "five verdicts in the canonical order",
  );

  /*
   * Nothing fired anywhere. Every area must say INSUFFICIENT and withhold BOTH derived claims —
   * a `direction` of "mishrit" here would be a fabricated hedge, not an observation.
   */
  for (const verdict of verdicts) {
    assert.equal(verdict.band, "INSUFFICIENT", `${verdict.area} is INSUFFICIENT on no evidence`);
    assert.equal(verdict.direction, null, `${verdict.area} withholds direction`);
    assert.equal(verdict.strength, null, `${verdict.area} withholds strength`);
    assert.equal(verdict.evidence.length, 0);
    assert.equal(verdict.meta.engine_version, AREA_ENGINE_VERSION);
  }
}

{
  /* One-sided positive evidence in karm: it should lean, and say so. */
  const fired = [fire("PALM-FATE-002"), fire("PALM-FATE-008"), fire("PALM-FATE-010"), fire("PALM-FATE-011")];
  const karm = byArea(scoreAreas({ fired, providedFeatures: ["lines.fate.present", "lines.sun.present"] }, MAP)).karm;

  assert.equal(karm.direction, "anukool", "four positive career rules lean favourable");
  assert.equal(karm.conflict, 0, "with nothing pulling the other way");
  assert.ok(karm.band !== "INSUFFICIENT", `and clear the floor (${karm.band})`);
  assert.ok(karm.strength !== null && karm.strength > 0);
  assert.equal(karm.evidence.length, 4, "every rule is listed as evidence");
  assert.ok(
    karm.evidence.every((e) => e.contribution > 0),
    "positive rules contribute positively",
  );
  /* Evidence is sorted by contribution descending — the UI reads top-down. */
  const contributions = karm.evidence.map((e) => e.contribution);
  assert.deepEqual(contributions, [...contributions].sort((a, b) => b - a), "evidence is sorted");
}

{
  /*
   * Balanced positive and negative mass. The conflict gate must win over the arithmetic lean:
   * reporting a direction here would hide the half of the hand that says otherwise.
   */
  const fired = [
    fire("PALM-FATE-002"), // positive 0.85
    fire("PALM-FATE-008"), // positive 0.85
    fire("PALM-FATE-013"), // negative 0.75
    fire("PALM-SIGN-010"), // negative 0.6
  ];
  const karm = byArea(scoreAreas({ fired, providedFeatures: ["lines.fate.present"] }, MAP)).karm;

  assert.ok(karm.conflict >= 0.3, `the area is genuinely split (conflict ${karm.conflict})`);
  assert.equal(karm.direction, "mishrit", "so the verdict is mishrit, whichever way the sum leans");
  assert.ok(karm.conflict <= 0.5, "conflict is a share of the smaller side, so it cannot exceed 0.5");
}

{
  /*
   * A secondary membership counts exactly half. PALM-FATE-003 is a career rule about a spouse's
   * material support: karm is its subject, dhan is a consequence, and dhan must not hear it as
   * loudly as karm does.
   */
  const fired = [fire("PALM-FATE-003")];
  const verdicts = byArea(scoreAreas({ fired, providedFeatures: [] }, MAP));
  const primary = verdicts.karm.evidence.find((e) => e.rule_id === "PALM-FATE-003");
  const secondary = verdicts.dhan.evidence.find((e) => e.rule_id === "PALM-FATE-003");

  assert.ok(primary !== undefined && secondary !== undefined, "the rule appears in both areas");
  assert.equal(primary.role, "primary");
  assert.equal(secondary.role, "secondary");
  assert.equal(secondary.contribution, primary.contribution * 0.5, "secondary contributes exactly half");
}

{
  /*
   * Neutral rules are real observations — they must make an area better attested — but they say
   * nothing about which way it leans, so they must not move the direction ratio.
   *
   * Same positive rule twice, once alone and once alongside two neutrals. Mass and independence
   * rise; the direction must not.
   */
  const provided = ["lines.fate.present", "lines.sun.present", "fingers.jupiter", "mounts.moon"];
  const positives = [fire("PALM-FATE-002"), fire("PALM-FATE-008"), fire("PALM-FATE-010")];
  const alone = byArea(scoreAreas({ fired: positives, providedFeatures: provided }, MAP)).karm;
  const withNeutrals = byArea(
    scoreAreas(
      { fired: [...positives, fire("PALM-FINGR-002"), fire("PALM-MMOO-008")], providedFeatures: provided },
      MAP,
    ),
  ).karm;

  /* Both must clear the floor, or "direction unchanged" would be comparing two nulls. */
  assert.ok(alone.direction !== null && withNeutrals.direction !== null, "both cases name a direction");

  assert.equal(withNeutrals.conflict, alone.conflict, "neutrals do not create conflict");
  assert.ok(
    withNeutrals.independence > alone.independence,
    `neutrals broaden the evidence (${alone.independence} → ${withNeutrals.independence})`,
  );
  assert.ok(
    (withNeutrals.strength ?? 0) > (alone.strength ?? 0),
    `and raise strength (${alone.strength} → ${withNeutrals.strength})`,
  );
  assert.equal(withNeutrals.direction, alone.direction, "but leave the direction exactly where it was");
  assert.ok(
    withNeutrals.evidence.some((e) => e.contribution === 0),
    "a neutral rule contributes zero signed weight while still being listed",
  );
}

{
  /* Structured sources survive the trip — this is the flattening bug the reading route still has. */
  const dhan = byArea(scoreAreas({ fired: [fire("PALM-FATE-003")], providedFeatures: [] }, MAP)).dhan;
  const evidence = dhan.evidence[0];
  assert.ok(Array.isArray(evidence.sources) && evidence.sources.length > 0, "sources is an array");
  assert.equal(typeof evidence.sources[0].text, "string");
  assert.equal(typeof evidence.sources[0].loc, "string");
  assert.deepEqual(
    evidence.sources,
    KB_BY_ID.get("PALM-FATE-003")?.sources,
    "and it is the KB's sources verbatim — not flattened, not truncated to sources[0]",
  );
}

{
  /*
   * NEUTRAL-ONLY EVIDENCE MUST NOT CLAIM A DIRECTION.
   *
   * An area can reach a real band on neutral rules alone — an ordinary bag gives rishte five
   * neutral rules and band HIGH. With no positive or negative weight, `raw` and `conflict` are both
   * 0, and before this was guarded the fallthrough returned "mishrit": the published object then
   * said "the hand says both things at once" directly beside `conflict: 0`.
   *
   * The mass is real, so `strength` and the evidence list stay. The lean is not, so `direction`
   * is withheld. Found by adversarial audit; nothing in the suite caught it, which is why it is
   * asserted here rather than only fixed.
   */
  const neutrals = [fire("PALM-CHILD-001"), fire("PALM-HEART-002"), fire("PALM-MARR-002")];
  const rishte = byArea(
    scoreAreas({ fired: neutrals, providedFeatures: ["lines.children.present", "lines.heart.origin", "lines.marriage.presence"] }, MAP),
  ).rishte;

  assert.ok(
    rishte.evidence.length === 3 && rishte.evidence.every((e) => e.polarity === "neutral"),
    "the fixture really is neutral-only",
  );
  assert.equal(rishte.conflict, 0, "nothing pulls either way");
  assert.equal(rishte.direction, null, "so no direction is claimed — not even 'mishrit'");
  assert.ok(rishte.strength !== null, "but the mass those observations carry is still reported");
  assert.ok(rishte.evidence.every((e) => e.contribution === 0), "and each contributes zero signed weight");
}

console.log("  unit: direction, conflict gate, role weighting, neutral-only guard, structured sources");

/* -------------------- 2. The DOB-only product guarantees ------------------- */

/**
 * A user who gives only a birth date and never scans a palm.
 *
 * Two guarantees, in opposite directions, and one of them turned out to be conditional.
 *
 * **dhan MUST be INSUFFICIENT — unconditionally.** The C1 map measured exactly one dhan rule
 * reachable from `user.*` alone. One rule is not a money verdict. Someone who has told us their
 * birthday and nothing else must never be shown a reading about their finances; this is the
 * fabrication the whole INSUFFICIENT band exists to prevent, and it is the assertion most likely to
 * be quietly broken by a future constant tweak. Asserted on both a sparse and a dense birth date.
 *
 * **swabhav clears the floor — but only on a date that actually fires rules.** The C1 report's "17
 * swabhav DOB rules" is the POOL, not what any one date fires: the 14 birth windows are calendar
 * bands, so a given date hits three or four of them. Measured across six dates, DOB-only firing
 * ranges from 2 rules to 27:
 *
 * ```text
 *   1990-04-04   2 fired   swabhav INSUFFICIENT   (1 rule, mass 0.45)
 *   1994-07-10   3 fired   swabhav INSUFFICIENT
 *   1988-09-18   6 fired   swabhav INSUFFICIENT
 *   1994-03-25   7 fired   swabhav INSUFFICIENT   (4 rules, mass 1.18)
 *   1994-11-05   9 fired   swabhav LOW
 *   1994-01-25  27 fired   swabhav LOW            (14 rules, mass 4.98)
 * ```
 *
 * So the guarantee is asserted on a dense date, and the sparse date is asserted to REFUSE — because
 * that refusal is the correct behaviour, not a gap. Four rules reading two parts of the hand is not
 * a character reading, and pretending otherwise is the failure mode this layer exists to avoid.
 *
 * Worth knowing for C3: a DOB-only reading can supply at most ONE feature root
 * (`user.birth_date`), so its coverage is pinned at 1/ROOT_CAP = 0.083 whatever fires. That is a
 * 55% haircut on confidence that no amount of DOB evidence can lift — which is why even 27 fired
 * rules and mass 4.98 reach only LOW.
 */
{
  /** Hits several birth windows — the DOB path with something actually in it. */
  const DENSE_DOB = "1994-01-25";
  /** Hits few — the same path on a quiet calendar day. */
  const SPARSE_DOB = "1990-04-04";

  const scoreDob = (birthDate: string) => {
    const result = evaluateRules(KB, { user: { birth_date: birthDate } } as FeatureBag, {
      includeSensitive: true,
      relaxMissingMounts: true,
      now: FIXED_NOW,
    });
    return { result, verdicts: byArea(scoreAreas({ fired: result.fired, providedFeatures: result.coverage.provided }, MAP)) };
  };

  const dense = scoreDob(DENSE_DOB);
  const sparse = scoreDob(SPARSE_DOB);

  /* The safety guarantee — holds on every date, or it is not a guarantee. */
  for (const [label, scored] of [["dense", dense], ["sparse", sparse]] as const) {
    assert.equal(
      scored.verdicts.dhan.band,
      "INSUFFICIENT",
      `a birth date alone must never produce a money verdict (${label}: got ` +
        `${scored.verdicts.dhan.band}, ${scored.verdicts.dhan.evidence.length} rules)`,
    );
    assert.equal(scored.verdicts.dhan.direction, null, `${label}: and no direction with it`);
    assert.equal(scored.verdicts.dhan.strength, null, `${label}: and no strength`);
  }

  /* The usefulness guarantee — on a date that fires, character must survive the floor. */
  assert.notEqual(
    dense.verdicts.swabhav.band,
    "INSUFFICIENT",
    `on a dense birth date character must survive the floor (${dense.result.fired.length} rules fired, ` +
      `${dense.verdicts.swabhav.evidence.length} in swabhav, independence ${dense.verdicts.swabhav.independence})`,
  );

  /* And the other side of it: a nearly-empty date must refuse rather than stretch. */
  assert.equal(
    sparse.verdicts.swabhav.band,
    "INSUFFICIENT",
    `a birth date that fires ${sparse.result.fired.length} rules must refuse, not stretch`,
  );

  /* Coverage is structurally pinned on this path — recorded so a change to ROOT_CAP is noticed. */
  for (const verdict of Object.values(dense.verdicts)) {
    assert.ok(verdict.coverage <= 0.1, `DOB-only coverage stays at the one-root floor (${verdict.coverage})`);
  }

  console.log(
    `  dob-only dense(${DENSE_DOB}, ${dense.result.fired.length} fired): ` +
      `dhan=${dense.verdicts.dhan.band} swabhav=${dense.verdicts.swabhav.band}/${dense.verdicts.swabhav.direction}`,
  );
  console.log(
    `  dob-only sparse(${SPARSE_DOB}, ${sparse.result.fired.length} fired): ` +
      `dhan=${sparse.verdicts.dhan.band} swabhav=${sparse.verdicts.swabhav.band}`,
  );
}

/* ----------------------------- 3. Golden pins ------------------------------ */

/**
 * The three fixtures span the shapes the scorer has to survive: no palm at all, a full session, and
 * a hand that contradicts itself.
 *
 * The rich-palm bag's `lines` come from `test/fixtures/golden/lines-missing-tilt-03.json` — the
 * real detector output, produced by test/golden-run.ts from the hand-traced ground truth, rather
 * than a bag invented here. Its `mounts` are the wizard's contribution: the scan reads creases, the
 * user answers for mounts, and a real session carries both.
 */
const GOLDEN_DIR = "test/fixtures/area-golden";
const SCAN_LINES_PIN = "test/fixtures/golden/lines-missing-tilt-03.json";

/** Mount prominences as the /read wizard collects them — a normal, unremarkable hand. */
const WIZARD_MOUNTS: FeatureBag = {
  jupiter: 0.7,
  saturn: 0.45,
  sun: 0.6,
  mercury: 0.45,
  mars_inner: 0.45,
  mars_outer: 0.45,
  venus: 0.75,
  moon: 0.6,
};

function scanLines(): FeatureBag | null {
  if (!existsSync(SCAN_LINES_PIN)) return null;
  const pinned = JSON.parse(readFileSync(SCAN_LINES_PIN, "utf8")) as { features?: FeatureBag };
  return pinned.features ?? null;
}

function fixtureBags(): ReadonlyArray<readonly [string, FeatureBag]> {
  const bags: Array<readonly [string, FeatureBag]> = [
    /* The DENSE date — a fixture of five INSUFFICIENTs would pin almost nothing. */
    ["dob-only", { user: { birth_date: "1994-01-25" } }],
  ];

  const lines = scanLines();
  if (lines !== null) {
    bags.push([
      "rich-palm",
      { ...lines, mounts: WIZARD_MOUNTS, hand: { overall_quality: 0.7 }, user: { birth_date: "1994-03-25" } },
    ]);
  }

  /*
   * Deliberately contradictory: a clear deep marriage line (MARR-001, positive) with an upturned
   * shape (MARR-006, negative) and an island at its middle (MARR-009, negative), plus a deep heart
   * line (HEART-001, positive). A real hand can say all four at once, and rishte has to report the
   * split rather than average it away.
   */
  bags.push([
    "conflict-rishte",
    {
      lines: {
        marriage: { presence: "clear_deep", shape: "upturn", marks: "island_middle" },
        heart: { depth: "deep", present: true },
      },
      mounts: WIZARD_MOUNTS,
      user: { birth_date: "1994-03-25" },
    },
  ]);

  return bags;
}

/** Sorted keys and 4dp floats, so the pin records behaviour rather than the last bit of a float. */
function stable(value: unknown): unknown {
  if (typeof value === "number") return Number.isInteger(value) ? value : Number(value.toFixed(4));
  if (Array.isArray(value)) return value.map(stable);
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      out[key] = stable((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}

function snapshotFor(bag: FeatureBag): unknown {
  const result = evaluateRules(KB, bag, { includeSensitive: true, relaxMissingMounts: true, now: FIXED_NOW });
  const verdicts = scoreAreas({ fired: result.fired, providedFeatures: result.coverage.provided }, MAP);
  return stable({ rulesFired: result.fired.length, verdicts });
}

const BAGS = fixtureBags();
const summary: string[] = [];
let pinned = 0;

for (const [name, bag] of BAGS) {
  const at = `${GOLDEN_DIR}/${name}.json`;
  const actual = snapshotFor(bag);
  const rendered = JSON.stringify(actual, null, 2);

  const verdicts = (actual as { verdicts: AreaVerdict[] }).verdicts;
  summary.push(
    `  ${name.padEnd(16)} ` +
      verdicts.map((v) => `${v.area}=${v.band}/${v.direction ?? "—"}`).join("  "),
  );

  /*
   * Re-baselining is explicit and opt-in. There is no auto-write on mismatch: a snapshot that
   * silently updates itself is a snapshot that never fails, which is the one thing it must be able
   * to do. `AREA_GOLDEN_WRITE=1 npx tsx test/area-score.test.ts` regenerates, and the before/after
   * bands belong in the commit message.
   */
  if (process.env.AREA_GOLDEN_WRITE === "1") {
    mkdirSync(GOLDEN_DIR, { recursive: true });
    writeFileSync(at, `${rendered}
`, "utf8");
    console.log(`  ${name}: pin written to ${at}`);
    pinned += 1;
    continue;
  }
  if (!existsSync(at)) {
    console.log(`  ${name}: no pin at ${at} — run with AREA_GOLDEN_WRITE=1 to create it`);
    continue;
  }

  /*
   * Compared as formatted JSON rather than deepStrictEqual: when this fails the useful thing is a
   * readable diff of two documents, not a structural-equality complaint about a wall of nesting.
   */
  const expected = JSON.stringify(JSON.parse(readFileSync(at, "utf8")), null, 2);
  if (rendered !== expected) {
    const now = rendered.split("\n");
    const before = expected.split("\n");
    const diffs: string[] = [];
    for (let i = 0; i < Math.max(now.length, before.length) && diffs.length < 12; i += 1) {
      if (now[i] !== before[i]) {
        diffs.push(`    line ${i + 1}:\n      pinned: ${before[i] ?? "—"}\n      now:    ${now[i] ?? "—"}`);
      }
    }
    assert.fail(
      `${name}: the area verdicts no longer match ${at}\n${diffs.join("\n")}\n` +
        `  If this change is intended, re-baseline with AREA_GOLDEN_WRITE=1 and put the before/after ` +
        `bands in the commit message. Re-baselining silently is what this pin exists to prevent.`,
    );
  }
  pinned += 1;
}

console.log("  golden bands:");
for (const line of summary) console.log(line);

/* ----------------------------- 4. Determinism ------------------------------ */

{
  /* The same input three times. Anything that varies here — set iteration, unstable sort, a clock
   * reaching the output — would make the pins above meaningless. */
  for (const [name, bag] of BAGS) {
    const runs = [snapshotFor(bag), snapshotFor(bag), snapshotFor(bag)].map((r) => JSON.stringify(r));
    assert.equal(runs[0], runs[1], `${name} is stable across runs`);
    assert.equal(runs[1], runs[2], `${name} is stable across runs`);
  }
  console.log(`  determinism: ${BAGS.length} fixtures × 3 runs identical`);
}

/* --------------------------- 5. Map integrity ------------------------------ */

{
  /*
   * The loader must refuse a map that disagrees with the KB. Proved by injecting a bad entry into
   * an IN-MEMORY copy of the document — mutating data/areas/area-map.v1.json to test a throw is how
   * a test leaves the repo broken when it fails halfway.
   */
  const document = JSON.parse(readFileSync("data/areas/area-map.v1.json", "utf8")) as {
    rules: Array<Record<string, unknown>>;
  };

  const withGhost = structuredClone(document);
  withGhost.rules.push({
    rule_id: "PALM-GHOST-999",
    primary_area: "dhan",
    secondary_areas: [],
    polarity: "positive",
    weight: 0.6,
    safety_class: "standard",
    feature_roots: ["mounts.venus"],
    mapped_by: "category",
  });
  assert.throws(
    () => loadAreaMap(KB, withGhost),
    (error: unknown) =>
      error instanceof AreaMapValidationError &&
      error.problems.some((p) => p.includes("PALM-GHOST-999") && p.includes("not in the KB")),
    "a mapped rule_id absent from the KB is refused",
  );

  /* Stale polarity is the drift that would otherwise flip a verdict silently. */
  const withStalePolarity = structuredClone(document);
  const target = withStalePolarity.rules.find((r) => r.rule_id === "PALM-FATE-002");
  assert.ok(target !== undefined);
  target.polarity = target.polarity === "positive" ? "negative" : "positive";
  assert.throws(
    () => loadAreaMap(KB, withStalePolarity),
    (error: unknown) =>
      error instanceof AreaMapValidationError && error.problems.some((p) => p.includes("map polarity")),
    "a polarity that disagrees with the KB is refused",
  );

  /* And a map built from a different KB version. */
  const wrongVersion = structuredClone(document) as unknown as { meta: Record<string, unknown> };
  wrongVersion.meta.kb_version = "0.0.0-not-this-one";
  assert.throws(
    () => loadAreaMap(KB, wrongVersion),
    (error: unknown) => error instanceof AreaMapValidationError && error.problems.some((p) => p.includes("kb_version")),
    "a map built from another KB version is refused",
  );

  /* The real map still loads — the guard must not be so strict it rejects the shipped artifact. */
  assert.equal(loadAreaMap(KB).byRuleId.size, document.rules.length, "the committed map loads cleanly");
  console.log(`  map integrity: 3 corruptions refused, ${MAP.byRuleId.size} mapped rules load`);
}

console.log(`AREA SCORE ASSERTIONS PASSED (${pinned}/${BAGS.length} golden pins matched)`);
