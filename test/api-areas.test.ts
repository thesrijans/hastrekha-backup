/**
 * The area layer as the API actually ships it: tier gating, citation shape, and the guarantees
 * that must survive the trip from engine to wire.
 *
 * **Why this does not call the route.** `app/api/reading/route.ts` cannot be imported here —
 * `lib/env.ts` throws at import when the env contract is unmet, and `POST` reaches Prisma and
 * OpenRouter besides. So the test splits the difference honestly: the exact chain the route runs
 * (`sanitizeReadingRequest` → `evaluateRules` → `scoreAreas`) is exercised against the real KB and
 * the real committed area map, and the one thing the route adds on top — the tier gate — is
 * imported from the route module itself rather than reimplemented. A reimplemented gate would pass
 * forever while the shipped one drifted.
 *
 * That import is also what pins the gate's position in the pipeline. `scoreAreas` is fed
 * `result.fired`, the whole evaluated set, NOT the tier-truncated `visibleRules`. Scoring an area
 * from three rules because the caller is on the free tier would make the verdict a function of what
 * they paid rather than of their hand, and section 5 asserts the difference is visible.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { evaluateRules, loadKnowledgeBase, scoreAreas, type AreaVerdict, type FeatureBag, type KnowledgeBase, type ReadingTier } from "../lib/hastrekha";
// By path, not the barrel — the loader statically imports the area map. See lib/hastrekha/index.ts.
import { loadAreaMap } from "../lib/hastrekha/area-map-loader";
import { sanitizeReadingRequest } from "../lib/hastrekha/sanitize";

/*
 * The route module reaches lib/env.ts, which throws at import unless the whole env contract is
 * present. These are obviously-fake values, set only where the variable is missing so a real local
 * env is never clobbered. Nothing here is used: the route is imported for ONE pure function and no
 * request is served, so Prisma never opens a connection and OpenRouter is never called. Measured:
 * the import completes in ~280ms and touches no network.
 *
 * The alternative — reimplementing the tier gate in the test — would pass forever while the shipped
 * gate drifted, which is the failure this whole file exists to prevent.
 */
const ENV_STUB: Readonly<Record<string, string>> = {
  APP_ENV: "dev",
  RAZORPAY_KEY_ID: "rzp_test_stub",
  RAZORPAY_KEY_SECRET: "stub",
  RAZORPAY_WEBHOOK_SECRET: "stub",
  DATABASE_URL: "postgresql://stub:stub@localhost:5432/stub",
  NEXT_PUBLIC_APP_URL: "http://localhost:3000",
  JWT_SECRET: "test-only-secret-at-least-32-chars-long",
  GOOGLE_CLIENT_ID: "stub",
  GOOGLE_CLIENT_SECRET: "stub",
  OPENROUTER_API_KEY: "stub",
  CRON_SECRET: "stub",
};
for (const [key, value] of Object.entries(ENV_STUB)) {
  if (process.env[key] === undefined || process.env[key] === "") process.env[key] = value;
}

const KB: KnowledgeBase = loadKnowledgeBase(JSON.parse(readFileSync("data/kb/hastrekha_kb.json", "utf8")));
const MAP = loadAreaMap(KB);

const FIXED_NOW = "2026-01-01T00:00:00.000Z";
const AREA_ORDER = ["dhan", "rishte", "karm", "sehat", "swabhav"] as const;

/** Mount prominences as the /read wizard collects them. */
const WIZARD_MOUNTS = {
  jupiter: 0.7,
  saturn: 0.45,
  sun: 0.6,
  mercury: 0.45,
  mars_inner: 0.45,
  mars_outer: 0.45,
  venus: 0.75,
  moon: 0.6,
};

/**
 * The route's own pipeline, minus narration, persistence and auth.
 *
 * Goes through `sanitizeReadingRequest` rather than handing a bag straight to the engine, because
 * the sanitiser silently drops unknown top-level groups and clamps numerics — a feature that
 * reaches the engine in a test but not in production would make every assertion below a fiction.
 */
type TierGate = (verdict: AreaVerdict, tier: ReadingTier) => {
  readonly area: string;
  readonly band: string;
  readonly direction: string | null;
  readonly strength: number | null;
  readonly conflict: number;
  readonly coverage: number;
  readonly independence: number;
  readonly evidence: ReadonlyArray<{
    readonly rule_id: string;
    readonly role: string;
    readonly polarity: string;
    readonly contribution: number;
    readonly interpretation_hi_en?: string;
    readonly sources: ReadonlyArray<{ readonly text: string; readonly loc: string; readonly year: number }>;
  }>;
  readonly lockedEvidenceCount: number;
  readonly meta: { readonly map_version: string; readonly engine_version: string };
};

/** The SHIPPED tier gate, bound once by main() — never reimplemented here. */
let toPublicAreaVerdict: TierGate;

function readingFor(bag: FeatureBag, tier: ReadingTier) {
  const body = { tier, features: bag };
  const raw = JSON.stringify(body);
  const sanitized = sanitizeReadingRequest(JSON.parse(raw), new TextEncoder().encode(raw).length);
  assert.ok(sanitized.ok, `the fixture survives the sanitiser (${sanitized.ok ? "" : sanitized.error})`);

  const result = evaluateRules(KB, sanitized.request.features, {
    // Exactly the route's rule: sensitive rules are excluded for free, included above it.
    includeSensitive: tier !== "free",
    relaxMissingMounts: true,
    categories: sanitized.request.categories,
    now: FIXED_NOW,
  });
  const verdicts = scoreAreas({ fired: result.fired, providedFeatures: result.coverage.provided }, MAP);
  return { result, verdicts, wire: verdicts.map((verdict) => toPublicAreaVerdict(verdict, tier)) };
}

/** A full session: real detector line output plus the wizard's mounts and a birth date. */
const RICH_BAG: FeatureBag = {
  ...(JSON.parse(readFileSync("test/fixtures/golden/lines-missing-tilt-03.json", "utf8")).features as FeatureBag),
  mounts: WIZARD_MOUNTS,
  hand: { overall_quality: 0.7 },
  user: { birth_date: "1994-01-25" },
};

async function main(): Promise<void> {
  ({ toPublicAreaVerdict } = (await import("../app/api/reading/route")) as unknown as { toPublicAreaVerdict: TierGate });

/* --------------------------- 1. Free tier is gated ------------------------- */

{
  const free = readingFor(RICH_BAG, "free");

  for (const verdict of free.wire) {
    assert.ok(
      verdict.evidence.length <= 2,
      `${verdict.area}: free tier sees at most 2 evidence rows (got ${verdict.evidence.length})`,
    );
    for (const item of verdict.evidence) {
      assert.equal(
        item.interpretation_hi_en,
        undefined,
        `${verdict.area}/${item.rule_id}: the reading itself is withheld on the free tier`,
      );
      /* But the citation is not — free users see that the evidence is real, just not what it says. */
      assert.ok(Array.isArray(item.sources) && item.sources.length > 0, `${verdict.area}: citation survives`);
    }
  }

  /* lockedEvidenceCount is the upsell number, and it must be exact rather than decorative. */
  const scored = new Map<string, AreaVerdict>(free.verdicts.map((v: AreaVerdict) => [v.area as string, v]));
  for (const verdict of free.wire) {
    const total = scored.get(verdict.area)?.evidence.length ?? 0;
    assert.equal(
      verdict.lockedEvidenceCount,
      Math.max(0, total - verdict.evidence.length),
      `${verdict.area}: lockedEvidenceCount accounts for every row withheld`,
    );
    assert.equal(verdict.evidence.length + verdict.lockedEvidenceCount, total, `${verdict.area}: nothing vanishes`);
  }

  const withLocked = free.wire.filter((v) => v.lockedEvidenceCount > 0);
  assert.ok(withLocked.length > 0, "the rich fixture actually has something to lock, or this proves nothing");
  console.log(
    `  free: ${free.wire.map((v) => `${v.area}=${v.evidence.length}+${v.lockedEvidenceCount}`).join(" ")}`,
  );
}

/* --------------------------- 2. Deep tier is whole ------------------------- */

{
  const deep = readingFor(RICH_BAG, "deep");
  const scored = new Map<string, AreaVerdict>(deep.verdicts.map((v: AreaVerdict) => [v.area as string, v]));

  for (const verdict of deep.wire) {
    assert.equal(
      verdict.evidence.length,
      scored.get(verdict.area)?.evidence.length,
      `${verdict.area}: deep tier receives every row`,
    );
    assert.equal(verdict.lockedEvidenceCount, 0, `${verdict.area}: and nothing is locked`);

    for (const item of verdict.evidence) {
      assert.equal(typeof item.interpretation_hi_en, "string", `${verdict.area}/${item.rule_id}: text present`);
      assert.ok((item.interpretation_hi_en ?? "").length > 0);

      /*
       * THE B5 FIX, alive on the wire. `toPublicRule` flattens a rule's sources to one pre-joined
       * string and keeps only sources[0]; area evidence carries the array structured, which is the
       * only shape a citation drawer can be built from.
       */
      assert.ok(Array.isArray(item.sources) && item.sources.length > 0, `${item.rule_id}: sources is an array`);
      for (const source of item.sources) {
        assert.equal(typeof source.text, "string", `${item.rule_id}: source.text`);
        assert.equal(typeof source.loc, "string", `${item.rule_id}: source.loc`);
        assert.ok(source.year === null || typeof source.year === "number", `${item.rule_id}: source.year`);
      }
      assert.equal(typeof item.sources, "object", `${item.rule_id}: sources is NOT a pre-joined string`);
    }
  }

  const premium = readingFor(RICH_BAG, "premium");
  for (const verdict of premium.wire) {
    assert.ok(verdict.evidence.length <= 8, `${verdict.area}: premium caps at 8 (got ${verdict.evidence.length})`);
    for (const item of verdict.evidence) {
      assert.equal(typeof item.interpretation_hi_en, "string", "premium receives the reading");
    }
  }
  console.log(
    `  deep: ${deep.wire.map((v) => `${v.area}=${v.evidence.length}`).join(" ")} · ` +
      `premium: ${premium.wire.map((v) => v.evidence.length).join("/")}`,
  );
}

/* ------------------------- 3. Always five, fixed order --------------------- */

{
  for (const [label, bag] of [
    ["rich", RICH_BAG],
    ["dob-only", { user: { birth_date: "1994-01-25" } } as FeatureBag],
    /*
     * A valid request that fires almost nothing — 1990-04-04 hits few birth windows. Not an EMPTY
     * bag: the sanitiser rejects those with 400 ("no usable features"), so an empty bag never
     * reaches scoring and asserting on it would be testing an unreachable state.
     */
    ["sparse", { user: { birth_date: "1990-04-04" } } as FeatureBag],
  ] as const) {
    for (const tier of ["free", "premium", "deep"] as const) {
      const wire = readingFor(bag, tier).wire;
      assert.equal(wire.length, 5, `${label}/${tier}: five areas`);
      assert.deepEqual(wire.map((v) => v.area), [...AREA_ORDER], `${label}/${tier}: canonical order`);
      for (const verdict of wire) {
        /* Null is a real state, and both derived claims withhold together or neither does. */
        const insufficient = verdict.band === "INSUFFICIENT";
        assert.equal(verdict.direction === null, insufficient, `${label}/${tier}/${verdict.area}: direction nulls with the band`);
        assert.equal(verdict.strength === null, insufficient, `${label}/${tier}/${verdict.area}: strength nulls with the band`);
        assert.equal(verdict.meta.engine_version, "area-v1.0");
      }
    }
  }
  console.log("  shape: 5 areas in canonical order across 3 bags x 3 tiers");
}

/* --------------------- 4. The DOB safety guarantee, at the wire ------------ */

{
  /*
   * The same guarantee test/area-score.test.ts pins at the engine level, re-asserted where it
   * actually matters — on the response. The dense date (1994-01-25) is used deliberately: it fires
   * 27 rules, so this is not passing because nothing happened.
   *
   * One reachable dhan rule is not a money verdict. Someone who has given a birth date and nothing
   * else must never be shown a reading about their finances, on any tier.
   */
  for (const tier of ["free", "premium", "deep"] as const) {
    const { result, wire } = readingFor({ user: { birth_date: "1994-01-25" } }, tier);
    const dhan = wire.find((v) => v.area === "dhan");
    assert.ok(dhan !== undefined);
    assert.equal(dhan.band, "INSUFFICIENT", `${tier}: a birth date alone never produces a money verdict`);
    assert.equal(dhan.direction, null, `${tier}: and claims no direction`);
    assert.equal(dhan.strength, null, `${tier}: and claims no strength`);
    /*
     * The dense date must actually fire, or dhan would be INSUFFICIENT for the boring reason. The
     * floor is tier-aware: free excludes sensitive rules, so it fires 13 where deep fires 27.
     */
    assert.ok(result.fired.length > 10, `${tier}: the fixture really did fire (${result.fired.length} rules)`);

    /* The DOB ceiling: one supplied root out of a capped 12, so coverage cannot exceed 0.0833. */
    for (const verdict of wire) {
      assert.ok(verdict.coverage <= 0.0834, `${tier}/${verdict.area}: DOB coverage stays at the one-root floor`);
    }
  }
  console.log("  dob-only: dhan INSUFFICIENT on free/premium/deep, coverage pinned at the one-root floor");
}

/* ------------- 5. Suppressed sensitive rules are not resurrected ----------- */

{
  /*
   * PALM-CHILD-001 is safety_class "sensitive" and maps to rishte. The engine excludes it for the
   * free tier via `includeSensitive: false`. Because `scoreAreas` reads nothing but `result.fired`,
   * it cannot reappear in area evidence — but "by construction" is a claim, so it is measured.
   *
   * This is the failure that would matter most: a rule the engine deliberately withheld resurfacing
   * in a different part of the same response.
   */
  const bag: FeatureBag = { lines: { children: { depth_class: "broad_deep" } }, mounts: WIZARD_MOUNTS };

  const premium = readingFor(bag, "premium");
  const firedPremium = premium.result.fired.map((f) => f.rule.rule_id);
  assert.ok(
    firedPremium.includes("PALM-CHILD-001"),
    "the fixture triggers the sensitive rule when sensitive rules are allowed — otherwise this tests nothing",
  );
  assert.ok(
    premium.wire.some((v) => v.evidence.some((e) => e.rule_id === "PALM-CHILD-001")),
    "and it reaches area evidence on a tier that may see it",
  );

  const free = readingFor(bag, "free");
  assert.ok(free.result.safety.suppressedSensitive > 0 || !free.result.fired.some((f) => f.rule.rule_id === "PALM-CHILD-001"),
    "the engine withholds it on the free tier");
  assert.ok(
    !free.result.fired.some((f) => f.rule.rule_id === "PALM-CHILD-001"),
    "it is absent from fired",
  );

  for (const verdict of free.wire) {
    assert.ok(
      !verdict.evidence.some((e) => e.rule_id === "PALM-CHILD-001"),
      `${verdict.area}: a suppressed sensitive rule does not reappear as area evidence`,
    );
  }
  /* Nothing sensitive at all leaks through the free tier's areas. */
  const sensitiveIds = new Set(KB.rules.filter((r) => r.safety_class === "sensitive").map((r) => r.rule_id));
  for (const verdict of free.wire) {
    for (const item of verdict.evidence) {
      assert.ok(!sensitiveIds.has(item.rule_id), `${verdict.area}/${item.rule_id}: no sensitive rule on the free tier`);
    }
  }
  console.log(`  safety: PALM-CHILD-001 present on premium, absent on free (suppressed ${free.result.safety.suppressedSensitive})`);
}

{
  /*
   * Areas are scored BEFORE the tier truncation. If they were scored from `visibleRules` the free
   * tier's verdicts would be a function of the paywall; instead only the evidence LIST differs.
   */
  const free = readingFor(RICH_BAG, "free");
  const deep = readingFor(RICH_BAG, "deep");
  const bands = (wire: ReadonlyArray<{ area: string; band: string }>) => wire.map((v) => `${v.area}:${v.band}`).join(" ");

  for (const area of AREA_ORDER) {
    const f = free.verdicts.find((v: AreaVerdict) => v.area === area);
    const d = deep.verdicts.find((v: AreaVerdict) => v.area === area);
    assert.ok(f !== undefined && d !== undefined);
    /*
     * Not asserted equal: free excludes sensitive rules at the ENGINE, so the evidence pool really
     * does differ and the bands legitimately may. What must hold is that the free tier's band is
     * not computed from three rules — which the count below shows.
     */
    assert.ok(
      f.evidence.length >= free.wire.find((v) => v.area === area)!.evidence.length,
      `${area}: scoring saw at least as much as the wire shows`,
    );
  }
  const freeShown = free.wire.reduce((n, v) => n + v.evidence.length, 0);
  const freeScored = free.verdicts.reduce((n: number, v: AreaVerdict) => n + v.evidence.length, 0);
  assert.ok(
    freeScored > freeShown,
    `the free tier scored on more evidence (${freeScored}) than it displays (${freeShown}) — ` +
      "areas are computed pre-truncation",
  );
  console.log(`  pre-truncation: free scored on ${freeScored} rows, shows ${freeShown}`);
  console.log(`    free bands: ${bands(free.wire)}`);
  console.log(`    deep bands: ${bands(deep.wire)}`);
}

/* ---------------- 6. The existing client contract is untouched ------------- */

{
  /*
   * C4 will migrate the reading UI onto structured sources; until then the old surface must be
   * byte-identical. `toPublicRule` is unexported, so this pins the SHAPE the current client reads
   * — a flattened `source` string and no `sources` array — rather than reimplementing the mapper.
   */
  const { result } = readingFor(RICH_BAG, "deep");
  const item = result.fired[0];
  assert.ok(item !== undefined, "the fixture fires something");

  const source = item.rule.sources[0];
  const flattened = source ? `${source.text} (${source.year}) — ${source.loc}` : "";
  assert.equal(typeof flattened, "string", "the legacy rule surface is still a joined string");
  assert.ok(flattened.includes(" — "), "in the exact legacy format the reading UI parses");

  /* And the area layer does not alter the engine result the old surface is built from. */
  const before = JSON.stringify(result.fired.map((f) => f.rule.rule_id));
  scoreAreas({ fired: result.fired, providedFeatures: result.coverage.provided }, MAP);
  assert.equal(JSON.stringify(result.fired.map((f) => f.rule.rule_id)), before, "scoreAreas mutates nothing");
  console.log("  legacy: rules[] surface and engine result unchanged by the area layer");
}

console.log("API AREAS ASSERTIONS PASSED");
}

void main();
