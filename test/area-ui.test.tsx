/**
 * The area UI, rendered.
 *
 * `react-dom/server` and `framer-motion` both already ship, so this renders the real components to
 * HTML and reads the markup — no jsdom, no testing-library, no new dependency. What it cannot do is
 * click: `renderToString` produces one static pass, so drawers (which open on state) render closed
 * and the assertions below are about what the grid COMMITS TO before any interaction.
 *
 * Three things are pinned, and each is a promise rather than a detail.
 *
 * **The copy.** Every string here is a claim about someone's life. "Sanket ki prabalta" must not
 * drift into "score", the disclaimer must stay exact, and the empty state must stay an invitation
 * rather than an error. A wording change should fail a test and be re-approved on purpose.
 *
 * **The paywall.** The free tier must not leak an interpretation into the markup. Blurring text in
 * CSS while shipping it in the HTML would be a paywall in appearance only — the string must be
 * absent from the document, not merely hidden.
 *
 * **The derived pool counts.** `AREA_RULE_POOL` is copied out of the generated map so the client
 * never loads it. That copy is checked against `data/areas/area-map.v1.json` here, so a rebuild
 * that moves the numbers fails the suite instead of quietly making the scan CTA lie.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { renderToString } from "react-dom/server";
import { AreaGrid } from "../components/areas/area-grid";
import { AreaCard } from "../components/areas/area-card";
import { EvidenceList } from "../components/areas/evidence-list";
import { StrengthBar, STRENGTH_LABEL } from "../components/areas/strength-bar";
import {
  AREA_ORDER,
  AREA_RULE_POOL,
  CONFLICT_SPLIT_GATE,
  NEED_MORE_COPY,
  NO_DIRECTION_COPY,
  cardStateFor,
  citationChip,
  directionChipClass,
  remainingSignals,
  totalEvidence,
} from "../components/areas/area-vocab";
import type { PublicAreaEvidence, PublicAreaVerdict } from "../app/read/reading-types";

/**
 * SSR output with React's text-node separators removed.
 *
 * `renderToString` writes `<!-- -->` between adjacent text nodes so hydration can tell them apart,
 * which turns "+19 sanket" into "+<!-- -->19<!-- --> sanket". Asserting on the raw string would
 * mean either matching that noise or weakening the assertion; stripping it lets the tests say what
 * they mean about the text a reader sees.
 */
function text(html: string): string {
  return html.replace(/<!-- -->/g, "");
}

const SOURCE = { text: "Cheiro — Palmistry for All", loc: "Ch.VII — origin: centre of Mount of Jupiter", year: 1916 };

function evidence(over: Partial<PublicAreaEvidence> = {}): PublicAreaEvidence {
  return {
    rule_id: "PALM-HEART-003",
    role: "primary",
    polarity: "positive",
    contribution: 0.85,
    interpretation_hi_en: "Hriday rekha Guru parvat ke kendra se uthti hai.",
    sources: [SOURCE],
    ...over,
  };
}

function verdict(over: Partial<PublicAreaVerdict> = {}): PublicAreaVerdict {
  return {
    area: "rishte",
    label_hi_en: "Pyaar aur Rishte",
    direction: "anukool",
    strength: 90,
    band: "HIGH",
    conflict: 0.2,
    independence: 3,
    coverage: 0.8333,
    evidence: [evidence()],
    lockedEvidenceCount: 0,
    meta: { map_version: "1.0", engine_version: "area-v1.0" },
    ...over,
  };
}

/** The shape a DOB-only reading actually produces for dhan — measured in test/api-areas.test.ts. */
const DHAN_DOB: PublicAreaVerdict = verdict({
  area: "dhan",
  label_hi_en: "Paisa aur Samriddhi",
  direction: null,
  strength: null,
  band: "INSUFFICIENT",
  conflict: 0,
  independence: 1,
  coverage: 0.0833,
  evidence: [],
  lockedEvidenceCount: 0,
});

/* --------------------- 1. The derived pool counts are honest --------------- */

{
  const map = JSON.parse(readFileSync("data/areas/area-map.v1.json", "utf8")) as {
    areas: Record<string, { rule_ids: string[] }>;
  };
  for (const area of AREA_ORDER) {
    assert.equal(
      AREA_RULE_POOL[area],
      map.areas[area].rule_ids.length,
      `AREA_RULE_POOL.${area} must match the generated map — the scan CTA promises this number`,
    );
  }
  assert.deepEqual(Object.keys(AREA_RULE_POOL).sort(), [...AREA_ORDER].sort(), "no area is missing a pool count");
  console.log(`  pool counts match the map: ${AREA_ORDER.map((a) => `${a}=${AREA_RULE_POOL[a]}`).join(" ")}`);
}

/* ------------------------- 2. Card state selection ------------------------- */

{
  assert.equal(cardStateFor(verdict()), "verdict");
  assert.equal(cardStateFor(verdict({ direction: null, band: "LOW", strength: 40 })), "no-direction");
  assert.equal(cardStateFor(DHAN_DOB), "need-more-data");

  /* INSUFFICIENT wins even if a direction somehow survived — the band is the gate. */
  assert.equal(cardStateFor(verdict({ band: "INSUFFICIENT" })), "need-more-data");

  /* Direction colour is the ONE place colour carries meaning; neutral must not borrow either accent. */
  assert.match(directionChipClass("anukool"), /mount-glow/);
  assert.match(directionChipClass("sambhalke"), /line-glow/);
  assert.doesNotMatch(directionChipClass("mishrit"), /mount-glow|line-glow/);
  assert.doesNotMatch(directionChipClass(null), /mount-glow|line-glow/);

  /* The scan promise counts EVERY scored row, not just the ones this tier was shown. */
  const gated = verdict({ area: "dhan", evidence: [evidence()], lockedEvidenceCount: 4 });
  assert.equal(totalEvidence(gated), 5);
  assert.equal(remainingSignals(gated), AREA_RULE_POOL.dhan - 5, "pool minus everything scored, not minus what is shown");
  assert.equal(remainingSignals(verdict({ area: "dhan", evidence: [], lockedEvidenceCount: 999 })), 0, "never negative");

  assert.equal(citationChip(SOURCE), "Cheiro (1916)");
  assert.equal(citationChip({ text: "Samudrika tradition", year: null }), "Samudrika tradition", "a yearless source drops the parens");
  console.log("  card states, chip colours, and the scan promise arithmetic");
}

/* ---------------------------- 3. The grid renders -------------------------- */

{
  const areas: PublicAreaVerdict[] = [
    DHAN_DOB,
    verdict({ area: "rishte", label_hi_en: "Pyaar aur Rishte" }),
    verdict({ area: "karm", label_hi_en: "Career aur Kaam", direction: "sambhalke", band: "MEDIUM", strength: 55 }),
    verdict({ area: "sehat", label_hi_en: "Urja aur Sehat", direction: null, band: "LOW", strength: 30 }),
    verdict({ area: "swabhav", label_hi_en: "Swabhav", direction: "mishrit", band: "HIGH", strength: 100, conflict: 0.39 }),
  ];
  const raw = renderToString(<AreaGrid areas={areas} readingId="rd_test" />);
  const html = text(raw);

  for (const area of areas) {
    assert.ok(html.includes(area.label_hi_en), `${area.area}: its label is on the page`);
  }
  /* Order is the response's, not re-sorted by strength — a report, not a scoreboard. */
  const positions = areas.map((a) => html.indexOf(a.label_hi_en));
  assert.deepEqual(positions, [...positions].sort((x, y) => x - y), "cards render in the response's fixed order");

  assert.ok(html.includes(NEED_MORE_COPY), "the INSUFFICIENT card says so plainly");
  assert.ok(html.includes("Hatheli scan karo"), "and offers the scan");
  assert.ok(html.includes(`+${remainingSignals(DHAN_DOB)} sanket`), "with the measured number of further signals");
  assert.ok(html.includes(NO_DIRECTION_COPY), "the no-direction card refuses to invent a lean");
  assert.ok(html.includes(STRENGTH_LABEL), "strength is labelled as signal, not score");

  /* The words that would turn this into a prediction must never appear. */
  for (const banned of ["score", "Score", "rating", "bhavishyavani karte", "guarantee"]) {
    assert.ok(!html.includes(banned), `the grid never uses the word "${banned}"`);
  }

  /* An empty areas array renders nothing at all rather than an empty shell. */
  assert.equal(renderToString(<AreaGrid areas={[]} readingId={null} />), "", "no areas renders nothing");

  /* Drawers are closed in a static render — the grid commits to no open dialog. */
  assert.ok(!html.includes('role="dialog"'), "no dialog is open before interaction");
  console.log(`  grid: 5 cards in order, ${areas.filter((a) => a.band === "INSUFFICIENT").length} need-more-data`);
}

/* --------------------- 4. The free tier leaks nothing ---------------------- */

{
  const secret = "Yeh sirf premium me dikhna chahiye.";
  const paid = evidence({ interpretation_hi_en: secret });
  const free: PublicAreaEvidence = {
    rule_id: paid.rule_id,
    role: paid.role,
    polarity: paid.polarity,
    contribution: paid.contribution,
    sources: [{ ...SOURCE, loc: "Ch.VII…" }],
  };

  const freeHtml = text(renderToString(<EvidenceList evidence={[free]} onCite={() => {}} />));
  assert.ok(!freeHtml.includes(secret), "a withheld interpretation is ABSENT from the markup, not merely blurred");
  assert.ok(freeHtml.includes("Premium me khulta hai"), "the row says why it is locked");
  assert.ok(freeHtml.includes("Cheiro (1916)"), "but the citation is still shown — the finding is real");
  assert.ok(freeHtml.includes("blur-"), "and the placeholder is visibly a placeholder");

  const paidHtml = text(renderToString(<EvidenceList evidence={[paid]} onCite={() => {}} />));
  assert.ok(paidHtml.includes(secret), "a paid tier does receive the reading");
  assert.ok(!paidHtml.includes("Premium me khulta hai"), "and is not told to upgrade");

  assert.ok(
    text(renderToString(<EvidenceList evidence={[]} onCite={() => {}} />)).includes("koi sanket nahi mila"),
    "an empty list says so",
  );
  console.log("  free tier: interpretation absent from markup, citation present");
}

/* ------------------- 5. Strength is never a verdict ------------------------ */

{
  const html = text(renderToString(<StrengthBar strength={90} />));
  assert.ok(html.includes(STRENGTH_LABEL));
  assert.ok(html.includes('role="progressbar"') && html.includes('aria-valuenow="90"'), "accessible as a meter");
  assert.ok(html.includes("aria-valuemin=\"0\"") && html.includes("aria-valuemax=\"100\""));
  /* The fill is neutral by construction — colour lives on the direction chip alone. */
  assert.doesNotMatch(html, /bg-mount-glow|bg-line-glow/, "the bar itself carries no direction colour");
  assert.equal(renderToString(<StrengthBar strength={null} />), "", "no strength renders no bar");
  assert.ok(text(renderToString(<StrengthBar strength={999} />)).includes('aria-valuenow="100"'), "clamped high");
  assert.ok(text(renderToString(<StrengthBar strength={-5} />)).includes('aria-valuenow="0"'), "clamped low");
  console.log("  strength bar: labelled, accessible, direction-free");
}

/* -------------------- 6. The conflict split is reachable ------------------- */

{
  /*
   * The split itself lives inside the detail sheet, which a static render cannot open. What IS
   * assertable here is the gate that decides it, and that the card carrying a split verdict still
   * renders a direction of "mishrit" rather than pretending to lean.
   */
  const torn = verdict({ conflict: 0.39, direction: "mishrit", band: "MEDIUM" });
  assert.ok(torn.conflict >= CONFLICT_SPLIT_GATE, "the fixture is genuinely split");
  const html = text(renderToString(<AreaCard verdict={torn} onOpen={() => {}} />));
  assert.ok(html.includes("Mishrit"), "a split area is labelled mixed on its card");
  assert.doesNotMatch(html, /Anukool|Sambhal ke/, "and does not also claim a lean");
  console.log(`  conflict: gate at ${CONFLICT_SPLIT_GATE}, split card reads Mishrit`);
}

console.log("AREA UI ASSERTIONS PASSED");
