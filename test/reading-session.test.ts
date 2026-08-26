/**
 * The reading session: monotonic, or it is nothing.
 *
 * Everything the user watches during a scan is downstream of the rules below. If a feature can
 * silently degrade, cards flicker; if a value can flip on a coin toss between two near-equal
 * confidences, the ticker thrashes; and if the posted bag is not the accumulated one, the reading the
 * user receives is not the reading they watched build. Each of those is asserted here directly.
 */
import assert from "node:assert/strict";
import {
  depthOf,
  emptySession,
  flattenBag,
  isMeaningful,
  lineConfidence,
  observe,
  observeLines,
  sessionBag,
  unflattenBag,
  DEPTH_HALF_SUM,
  LINE_LOCKED_COPY,
  LINE_LOCK_CONFIDENCE,
  SUPERSEDE_MARGIN,
  type ReadingSession,
} from "../lib/scan/reading-session";
import { orderedStandings, emptyLatch, markGateFail, updateLatch, DEFAULT_LATCH_OPTIONS } from "../lib/scan/latch";
import { ACTIVE_LINE_IDS, type ActiveLineId } from "../lib/scan/types";
import type { CompletionResult, FittedLine } from "../lib/scan/completion";

/* ------------------------------- Flattening -------------------------------- */

{
  const bag = {
    lines: { heart: { present: true, depth: "deep" }, head: { quality: 0.8 } },
    geometry: { quadrangle_shape: "even" },
    user: { birth_date: "1994-03-25" },
  };
  const flat = flattenBag(bag);
  assert.equal(flat.get("lines.heart.present"), true, "nested booleans flatten");
  assert.equal(flat.get("lines.heart.depth"), "deep", "nested strings flatten");
  assert.equal(flat.get("lines.head.quality"), 0.8, "nested numbers flatten");
  assert.equal(flat.get("geometry.quadrangle_shape"), "even", "sibling groups flatten");
  assert.equal(flat.size, 5, "and nothing else appears");

  /* Round-tripping must be exact, or the rules engine sees a different bag than it did before. */
  assert.deepEqual(unflattenBag(flat), bag, "flatten and unflatten round-trip to the same shape");

  /* Arrays stay whole — the KB matches them by membership, so indexing them would break every rule. */
  const withArray = flattenBag({ marks: { symbols: ["star", "cross"] } });
  assert.deepEqual(withArray.get("marks.symbols"), ["star", "cross"], "arrays are kept as leaves");
  assert.deepEqual(unflattenBag(withArray), { marks: { symbols: ["star", "cross"] } }, "and round-trip");

  /* Undefined leaves are dropped rather than stored, so an absent feature stays absent. */
  assert.equal(flattenBag({ a: { b: undefined } }).size, 0, "undefined leaves never enter the bag");
}

/* ------------------------------- Monotonicity ------------------------------ */

const now = 1000;

{
  let session = emptySession();

  /* A first observation is simply accepted. */
  ({ session } = observe(session, { lines: { heart: { depth: "deep" } } }, {
    source: "line",
    nowMs: now,
    confidence: 0.5,
  }));
  assert.equal(session.features.get("lines.heart.depth")?.value, "deep", "an unseen feature is accepted");
  assert.equal(session.features.get("lines.heart.depth")?.confidence, 0.5, "with its confidence");

  /* The SAME value seen less clearly must not lower the belief — that is not evidence against it. */
  ({ session } = observe(session, { lines: { heart: { depth: "deep" } } }, {
    source: "line",
    nowMs: now + 1,
    confidence: 0.2,
  }));
  assert.equal(session.features.get("lines.heart.depth")?.confidence, 0.5, "a weaker repeat never lowers confidence");

  /* The same value seen MORE clearly is corroboration, and the belief rises. */
  const beforeSum = session.confidenceSum;
  ({ session } = observe(session, { lines: { heart: { depth: "deep" } } }, {
    source: "line",
    nowMs: now + 2,
    confidence: 0.7,
  }));
  assert.equal(session.features.get("lines.heart.depth")?.confidence, 0.7, "a stronger repeat raises confidence");
  assert.ok(session.confidenceSum > beforeSum, "and the session's total with it");

  /* A DIFFERENT value at marginally higher confidence is noise, and must not flip the feature. */
  ({ session } = observe(session, { lines: { heart: { depth: "thin" } } }, {
    source: "line",
    nowMs: now + 3,
    confidence: 0.7 + SUPERSEDE_MARGIN - 0.01,
  }));
  assert.equal(
    session.features.get("lines.heart.depth")?.value,
    "deep",
    "a marginally better competing value does NOT supersede — that is the anti-churn rule",
  );

  /* A different value at decisively higher confidence does replace it, and records what it replaced. */
  ({ session } = observe(session, { lines: { heart: { depth: "thin" } } }, {
    source: "capture",
    nowMs: now + 4,
    confidence: 0.7 + SUPERSEDE_MARGIN + 0.05,
  }));
  assert.equal(session.features.get("lines.heart.depth")?.value, "thin", "decisively better evidence supersedes");
  assert.equal(session.features.get("lines.heart.depth")?.source, "capture", "and the source is recorded");
  assert.deepEqual(session.superseded.get("lines.heart.depth"), ["deep"], "the replaced value is auditable");

  /* Zero-confidence observations are refused outright, not stored at zero. */
  const size = session.features.size;
  ({ session } = observe(session, { lines: { fate: { present: true } } }, {
    source: "line",
    nowMs: now + 5,
    confidence: 0,
  }));
  assert.equal(session.features.size, size, "a feature nothing believes in is not a feature");
}

{
  /*
   * The property the whole module exists for, checked as a property rather than a case: over an
   * arbitrary sequence of observations, the session's total confidence never decreases.
   */
  let session = emptySession();
  let previousSum = 0;
  let previousDepth = 0;
  let seed = 7;
  const rnd = (): number => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  const values = ["deep", "thin", "broad_shallow"];

  for (let i = 0; i < 400; i += 1) {
    ({ session } = observe(
      session,
      {
        lines: {
          heart: { depth: values[Math.floor(rnd() * 3)] },
          head: { quality: Math.round(rnd() * 10) / 10 },
        },
        geometry: { quadrangle_shape: values[Math.floor(rnd() * 3)] },
      },
      { source: "line", nowMs: now + i, confidence: rnd() },
    ));
    assert.ok(session.confidenceSum >= previousSum - 1e-9, `confidence sum never falls (step ${i})`);
    assert.ok(session.depth >= previousDepth - 1e-9, `depth never falls (step ${i})`);
    previousSum = session.confidenceSum;
    previousDepth = session.depth;
  }
  assert.ok(session.depth > 0, "and it did actually climb");
  assert.ok(session.depth < 1, "without ever claiming a finished reading");
}

/* --------------------------------- Depth ----------------------------------- */

{
  assert.equal(depthOf(0), 0, "no evidence is no depth");
  assert.ok(Math.abs(depthOf(DEPTH_HALF_SUM) - 0.5) < 1e-9, "the half-sum reads exactly one half");
  assert.ok(depthOf(1e6) < 1, "and it is asymptotic — a reading is never finished");
  for (let sum = 0; sum < 40; sum += 0.7) {
    assert.ok(depthOf(sum + 0.7) > depthOf(sum), `depth is strictly increasing at ${sum.toFixed(1)}`);
  }
}

/* ------------------------- Line confidence and locking --------------------- */

const fakeLine = (observedEnergy: number, observedFraction: number): FittedLine => ({
  id: "life",
  points: [{ x: 0, y: 0 }],
  segments: [{ from: 0, to: 1, observed: true }],
  observedFraction,
  energy: observedEnergy,
  observedEnergy,
  seedCount: 1,
  lengthPx: 100,
});

function completionWith(entries: Partial<Record<ActiveLineId, FittedLine>>): CompletionResult {
  const reports = Object.fromEntries(
    ACTIVE_LINE_IDS.map((id) => [
      id,
      {
        id,
        seedCount: entries[id] === undefined ? 0 : 1,
        observedFraction: entries[id]?.observedFraction ?? 0,
        energy: entries[id]?.energy ?? 0,
        accepted: entries[id] !== undefined,
        reject: entries[id] === undefined ? ("no_seeds" as const) : null,
      },
    ]),
  ) as CompletionResult["reports"];
  return { lines: entries, reports };
}

{
  const strong = completionWith({ life: fakeLine(0.8, 0.9) });
  assert.ok(Math.abs(lineConfidence(strong, "life") - 0.72) < 1e-9, "confidence is energy times coverage");
  assert.equal(lineConfidence(strong, "heart"), 0, "an absent line has no confidence");

  /* Neither high energy on a stub nor full coverage on nothing is a line worth staking a rule on. */
  assert.ok(lineConfidence(completionWith({ life: fakeLine(0.95, 0.2) }), "life") < LINE_LOCK_CONFIDENCE,
    "a strong stub does not lock");
  assert.ok(lineConfidence(completionWith({ life: fakeLine(0.2, 0.95) }), "life") < LINE_LOCK_CONFIDENCE,
    "nor does a faint full-length curve");
}

{
  let session: ReadingSession = emptySession();
  const bag = { lines: { life: { arc: "wide_into_palm" } } };

  /* Below the bar: no lock, no beat. */
  let delta;
  ({ session, delta } = observeLines(session, bag, completionWith({ life: fakeLine(0.4, 0.5) }), "line", now));
  assert.deepEqual(delta.locked, [], "a weak line does not lock");
  assert.equal(session.lockedLines.size, 0, "and nothing is recorded");

  /* Over the bar: locks once, and reports it once. */
  ({ session, delta } = observeLines(session, bag, completionWith({ life: fakeLine(0.85, 0.9) }), "line", now + 1));
  assert.deepEqual(delta.locked, ["life"], "a confident line locks and reports the beat");

  /* Seen again: still locked, but the beat does NOT fire twice. */
  ({ session, delta } = observeLines(session, bag, completionWith({ life: fakeLine(0.9, 0.95) }), "line", now + 2));
  assert.deepEqual(delta.locked, [], "the enhance beat is one-time");
  assert.ok(session.lockedLines.has("life"), "and the lock persists");

  /* And it survives a later worse observation — the evidence happened, so the claim stands. */
  ({ session } = observeLines(session, bag, completionWith({}), "line", now + 3));
  assert.ok(session.lockedLines.has("life"), "a lock is one-way: a bad frame cannot un-find a line");

  for (const id of ACTIVE_LINE_IDS) {
    assert.ok(LINE_LOCKED_COPY[id].length > 0, `${id} has enhance copy`);
    assert.ok(LINE_LOCKED_COPY[id].includes("reading update"), `${id}'s copy says what happened`);
  }
}

{
  /* Two lines locking on one extraction must both be reported — the fitter does all four at once. */
  const { delta } = observeLines(
    emptySession(),
    { lines: {} },
    completionWith({ life: fakeLine(0.8, 0.9), heart: fakeLine(0.8, 0.9) }),
    "line",
    now,
  );
  assert.equal(delta.locked.length, 2, "both locks are reported, not just the first");
}

{
  /* Cross-line features take the WEAKEST contributing line, not the strongest. */
  let session: ReadingSession = emptySession();
  ({ session } = observeLines(
    session,
    { geometry: { quadrangle_shape: "even" }, lines: { heart: { present: true } } },
    completionWith({ heart: fakeLine(0.9, 0.9), head: fakeLine(0.4, 0.5) }),
    "line",
    now,
  ));
  const derived = session.features.get("geometry.quadrangle_shape");
  const direct = session.features.get("lines.heart.present");
  assert.ok(derived !== undefined && direct !== undefined);
  assert.ok(
    derived.confidence < direct.confidence,
    "a derived measurement is only as good as its shakiest input",
  );
}

/* ---------------------------- The posted bag ------------------------------- */

{
  let session: ReadingSession = emptySession();
  ({ session } = observe(session, { mounts: { jupiter: 0.8 } }, { source: "landmark", nowMs: now, confidence: 0.9 }));
  ({ session } = observe(session, { lines: { heart: { present: true } } }, { source: "line", nowMs: now, confidence: 0.6 }));

  const bag = sessionBag(session);
  assert.deepEqual(bag, { mounts: { jupiter: 0.8 }, lines: { heart: { present: true } } },
    "the posted bag is the plain nested bag the engine expects — no evidence metadata leaks into it");

  /* And it is exactly what was accumulated, which is the point of posting the session at all. */
  assert.equal(flattenBag(bag as Record<string, unknown>).size, session.features.size,
    "every accumulated leaf reaches the bag");
}

{
  assert.equal(isMeaningful({ added: [], replaced: [], reinforced: [], locked: [], depthBefore: 0, depthAfter: 0 }), false,
    "an empty delta is not worth a re-render");
  assert.equal(isMeaningful({ added: ["a"], replaced: [], reinforced: [], locked: [], depthBefore: 0, depthAfter: 0 }), true,
    "a new feature is");
}

/* --------------------------- Stable ticker order --------------------------- */

{
  /*
   * Cards must not move once placed. The old ordering grouped by standing, so a batch demotion — which
   * happens to every confirmed rule at once the moment the gate drops for two seconds — rearranged the
   * whole list under the user's eyes.
   */
  let latch = emptyLatch();
  for (let i = 0; i < DEFAULT_LATCH_OPTIONS.confirmAfter; i += 1) latch = updateLatch(latch, ["A", "B"]);
  for (let i = 0; i < DEFAULT_LATCH_OPTIONS.confirmAfter; i += 1) latch = updateLatch(latch, ["A", "B", "C"]);

  const before = orderedStandings(latch, ["A", "B", "C"]).map((s) => s.ruleId);
  assert.deepEqual(before, ["C", "B", "A"], "newest confirmation sits at the top");

  /* Now demote everything, as a sustained gate failure does. */
  latch = markGateFail(latch, 10_000);
  latch = markGateFail(latch, 10_000 + DEFAULT_LATCH_OPTIONS.decayAfterMs + 1);
  const after = orderedStandings(latch, []).map((s) => s.ruleId);
  assert.deepEqual(after, before, "a batch demotion does not move a single card");

  /* A new rule after the demotion still enters at the top, above everything already placed. */
  latch = updateLatch(latch, ["D"]);
  const withNew = orderedStandings(latch, ["D"]).map((s) => s.ruleId);
  assert.equal(withNew[0], "D", "and a genuinely new rule enters at the top");
  assert.deepEqual(withNew.slice(1), before, "with the existing order untouched beneath it");
}

console.log("READING SESSION ASSERTIONS PASSED");
