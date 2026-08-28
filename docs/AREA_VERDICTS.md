# Area verdicts — specification

A reading currently arrives as 377 rules' worth of findings sorted by weight. That is honest and
almost unusable: a person does not want a ranked list, they want to know how it went for the four
or five things they actually came to ask about. This is the layer that answers that.

**Status: C1 only.** The data layer exists — a rule-to-area map and the script that builds it.
Nothing scores, renders, or narrates yet. The scoring maths is deliberately NOT in this document;
it belongs to C2, and writing it down before the map's shape is settled would fix the wrong thing
first. See [Not yet built](#not-yet-built).

## The five areas

Ids are fixed. Every downstream layer keys on the id, never the label.

| id | label | what belongs in it |
|---|---|---|
| `dhan` | Paisa aur Samriddhi | Money as a subject: earning temperament, saving vs spending, risk appetite, speculation, windfall and loss signs. |
| `rishte` | Pyaar aur Rishte | Marriage, partnership, romance, children, family. The whole `PALM-MARR-*` family lives here regardless of what its `category` says. |
| `karm` | Career aur Kaam | Work, vocation, ambition, recognition, public standing, travel-as-livelihood. |
| `sehat` | Urja aur Sehat | Vitality, stamina, constitution, protective marks. **Not diagnosis** — the KB's safety policy already excludes illness and mortality claims, and this area inherits that without exception. |
| `swabhav` | Swabhav | Character: intellect, imagination, temperament, communication, self-control, resilience. The largest area by a wide margin, because `personality` is the largest category. |

Labels reuse the Hinglish register already established by `CATEGORY_LABEL_HI` in
`lib/hastrekha/narrator.ts`, so a user meets the same four words in the ticker and here.

## Mapping precedence

Built by `scripts/build_area_map.py` from `data/kb/hastrekha_kb.json` (read-only) plus
`data/areas/area-map.overrides.json`. **Exactly one of these decides a rule's primary area** —
highest wins, and once one fires the rest are not consulted.

| # | source | what it does |
|---|---|---|
| 1 | **override** | An explicit `rule_id` in the overrides file. **Final** — the prefix, category and tag tables are all skipped, so its `secondary_areas` must be written out in full. Every entry carries a mandatory `why`. |
| 2 | **prefix** | Keyed on the middle segment of `PALM-<PREFIX>-NNN`. One entry in v1: `MARR → rishte`. It earns a rule ahead of `category` because its 27 rules are scattered across `love` (21), `timing` (4) and `wealth` (2) — three categories, one subject. |
| 3 | **category** | `wealth→dhan` · `love→rishte` · `children→rishte` · `career→karm` · `travel→karm` · `vitality→sehat` · `protection→sehat` · `personality→swabhav`. Three categories get special dispositions, below. |
| 4 | **tag** | An **exact-match allow-list**. No substring, stemming or fuzzy matching anywhere — a tag either is in the table or it is not. For every category except `obstacles`, a tag may only **add a secondary area**; it can never change a primary. |

### The three special dispositions

**`obstacles` is a modifier, not an area.** An obstacle says something went wrong; it does not say
what it went wrong *in*. So these 26 rules have no category route at all and are placed only by
their tags — `money` sends one to `dhan`, `reputation` to `karm`, `pride` to `swabhav`. When an obstacles rule's tags name
more than one area the alphabetically first becomes primary and the rest secondary — arbitrary but
deterministic, and no rule in the shipped KB reaches it (all 19 tag-routed rules name exactly one
area). **A rule whose tags name no area is left unmapped.** It is never forced somewhere plausible: filing a
generic "island means a temporary dip" rule under an arbitrary area would put a warning in front
of a user about a part of their life the rule never mentioned.

**`reading_method` is excluded.** 12 rules about how to read a hand. They are never a finding about
a life, and they are not counted against coverage.

**`timing` is skipped — deliberately, and this is the one to read carefully.**

The 20 `timing` rules describe *when*: a phase, a period, an age band. There is nowhere to put
that. `lib/hastrekha/dob.ts` maps a **calendar birth date** (MM-DD) onto mount birth windows —
that is astrological-style banding, not a life chronology. **No age-range logic exists anywhere in
this repo**: there is no life-line age gauge, no date arithmetic beyond a day-of-year index, and no
type that represents "roughly your late thirties". Building a verdict that says *when* something
happens would mean inventing that machinery, and inventing it under a deadline is how a palmistry
app starts making datable predictions it cannot support.

So v1 states nothing about timing rather than guessing. The 4 `PALM-MARR-*` timing rules are the
exception, and only because the prefix rule and an explicit override rescue them **as relationship
rules**, on their subject — not on their dates. The remaining 16 are listed in
`data/areas/area-map.report.md` under `timing_skipped`, and C6 is where they get considered.

## Per-rule output

```jsonc
{
  "rule_id": "PALM-MVEN-005",
  "primary_area": "rishte",
  "secondary_areas": ["swabhav"],
  "polarity": "positive",        // COPIED from the KB, never re-derived
  "weight": 0.8,                 // copied from the KB
  "safety_class": "standard",
  "feature_roots": ["hand.overall_quality", "mounts.venus"],
  "mapped_by": "category"        // override | prefix | category | tag
}
```

`feature_roots` is the first two segments of each condition's dotted feature path, deduplicated.
Two segments is the right grain for the question C2 has to answer: **do two rules read the same
part of the hand?** `lines.heart.depth` and `lines.heart.chains` are one observation of one crease
seen twice, not two independent witnesses, and at this grain they collapse to the same root and
stop double-counting. It is the independence input, and it is why it lives in the map rather than
being recomputed downstream.

`mapped_by` is not decoration. A rule placed by `tag` reached its area through the weakest signal
in the chain — for `obstacles` rules it is the *only* signal — so C2 should treat it as
corroborating evidence rather than a headline finding. `override` marks a human decision.

## Per-area rollup

Each area carries `label_hi_en`, `rule_ids`, `feature_roots` (union) and `polarity_split`.

`rule_ids` includes every rule for which the area is **primary or secondary**, because that is the
area's evidence pool and the correct denominator for a coverage number. The report breaks out the
primary-only subset separately so a thin area cannot hide behind its secondaries.

## Determinism

Two runs over one KB produce a **byte-identical** file: every array sorted, every dict written with
sorted keys, weights copied rather than recomputed. `meta.generated_at` is the **source KB's
`extraction_date`**, not the wall clock — a build timestamp would make consecutive runs differ and
there would be no way to tell a real change from a re-run. Verified by `cmp`.

## Safety posture

`meta.safety_exclusions` in the KB records 69 deliberate redactions, with actions like *"not
encoded at all"* and *"DEFERRED — too emotionally heavy for automated output"*. The narrator's
standing instruction is *"agency-preserving. Tendencies and phases, not fixed fate."*

A per-area **verdict** pushes against that grain by construction — it compresses many hedged
findings into one confident-looking summary, and a number on a ring reads as a score whatever the
caption says. That tension is not resolved by this document and should not be resolved silently in
C2. It needs an explicit decision about what a verdict is allowed to assert, and `sehat` needs the
tightest wording of the five.

## Known state at C1

Full numbers in `data/areas/area-map.report.md`. Two findings that block a clean C2:

- **`dhan` is thin: 19 rules** (13 of them primary) against a 20-rule floor. This is structural,
  not a mapping bug — `category: "wealth"` holds only 15 rules in the whole KB, and two of those
  are marriage rules that belong in `rishte`. It is not fixable by loosening the tag table without
  filing non-money rules under money.
- **16 `timing` rules and 7 `obstacles` rules are unmapped**, by design in both cases.

## Not yet built

| step | scope |
|---|---|
| **C2** | Scoring. Per-area score from weight mass, polarity balance and `feature_roots` independence; how `mapped_by` discounts tag-placed evidence; what "confidence" means per area given that `buildCoverage` in `lib/hastrekha/engine.ts` is whole-KB and ignores `options.categories`. |
| **C3** | Conflict handling. The engine has **no** conflict resolution today — `buildClusters` keys on `${category}::${polarity}`, so a positive and a negative cluster in one category never meet and neither is flagged. An area verdict has to face both at once, so this is new ground, not an extension. |
| **C4** | API surface. A reading is persisted with a cuid `id` and `readingId` is returned, but **there is no GET route** and no dynamic segment anywhere in `app/`. Exposing areas per reading means building that first, including the ownership check — `getSessionUser` takes a `NextRequest` and cannot be called from a Server Component. |
| **C5** | UI. Area cards, an evidence list, a citation drawer. Note `DepthMeter` and `SourceDrawer` in `app/read/reading-view.tsx` already implement a radial ring and a modal drawer as file-local components; they want lifting out, not rebuilding. |
| **C6** | Timing. Only after an age/phase representation exists and has been justified on its own terms. Scope starts from the `timing_skipped` list in the build report. |

Sharing an area page publicly is out of scope for all of the above until `Reading` gains a share
token: there is no public/slug/visibility column on any Prisma model today, and the repo has no
migrations directory, so adding one is a manual Neon SQL Editor step.

---

## Scoring v1

Implemented in `lib/hastrekha/area-score.ts`. Input is `{ fired, providedFeatures }` — never a
FeatureBag. Re-reading the bag would mean re-deciding what fired, and there would then be two
answers to that question in the codebase.

### Per area

```text
  w(rule)  = effectiveWeight × ROLE_WEIGHT[role]      primary 1.0 · secondary 0.5
  pos      = Σ w over positive rules
  neg      = Σ w over negative rules
  neu      = Σ w over neutral rules                   in mass, NOT in direction
  mass     = pos + neg + neu

  raw      = (pos − neg) / (pos + neg + 1.5)          K = DIRECTION_SOFTENING
  conflict = (pos+neg) > 0 ? min(pos,neg)/(pos+neg) : 0

  direction   pos + neg == 0               → null         (neutral-only: nothing leans)
              conflict ≥ 0.30              → mishrit      (the gate wins over the lean)
              raw ≥ +0.15                  → anukool
              raw ≤ −0.15                  → sambhalke
              otherwise                    → mishrit

  independence = distinct feature roots across the fired evidence
  indepRatio   = min(1, independence / 4)
  coverage     = min(1, |providedRoots ∩ areaRoots| / min(|areaRoots|, 12))

  confidence = min(1, mass/3.0) × (0.5 + 0.5·indepRatio)
                                × (0.4 + 0.6·coverage)
                                × (1 − conflict×0.6)

  band       ≥0.55 HIGH · ≥0.30 MEDIUM · ≥0.12 LOW · else INSUFFICIENT
  strength   INSUFFICIENT ? null : round(100 × min(1, mass/3.0) × (0.6 + 0.4·indepRatio))
```

### Three decisions worth defending

**`strength` is direction-free.** It answers "how much signal", never "how good". A single signed
0–100 renders as a score out of a hundred for someone's marriage — a fixed-fate claim, which is what
the KB's 69 safety exclusions exist to refuse. `direction` and `strength` are never multiplied.

**Neutral rules add mass, not direction.** A neutral rule is a real observation and belongs in the
evidence list, but it says nothing about which way things lean. Its `contribution` is therefore
**0**, not `+w` — rendering it as a positive number would make an explicitly non-committal finding
read as good news. Sorting by contribution lands positives first, neutral observations in the
middle, cautions last.

**Neutral-only evidence claims no direction.** An area can reach a real band on neutral rules alone
— an ordinary bag gives `rishte` five neutral rules and band HIGH. With no directional weight both
`raw` and `conflict` are 0 and the fallthrough would return `mishrit`, publishing "the hand says both
things at once" beside `conflict: 0`. The mass is real, so `strength` and the evidence list stay; the
lean is not, so `direction` is null. Found by adversarial audit after the first implementation, and
pinned by a regression assertion.

**Conflict is measured, not resolved.** `buildClusters` in `engine.ts` keys on
`${category}::${polarity}`, so opposing clusters are built independently and neither is told about
the other. An area verdict faces both at once. v1 reports `conflict`, lets it force `mishrit`, and
damps confidence — it does not adjudicate. That is C3.

### The DOB-only ceiling

A birth-date-only reading can supply exactly **one** feature root (`user.birth_date`), so its
coverage is pinned at `1/12 = 0.083` no matter how much fires — a 55% haircut on confidence that no
amount of DOB evidence can lift. Measured: even 27 fired rules with mass 4.98 in `swabhav` reach
only LOW.

Firing is also strongly date-dependent, because the 14 birth windows are calendar bands and one date
hits three or four of them:

| birth date | rules fired | swabhav |
|---|---:|---|
| 1990-04-04 | 2 | INSUFFICIENT |
| 1994-07-10 | 3 | INSUFFICIENT |
| 1988-09-18 | 6 | INSUFFICIENT |
| 1994-03-25 | 7 | INSUFFICIENT |
| 1994-11-05 | 9 | LOW |
| 1994-01-25 | 27 | LOW |

Both halves are asserted in `test/area-score.test.ts`: a dense date must clear the floor, a sparse
one must refuse. **`dhan` is INSUFFICIENT on every date tested**, which is the safety guarantee — one
reachable DOB rule is not a money verdict.

One fix was needed to get here. `kbFeatureKeys` rewrites `user.birth_window` → `user.birth_date`
before reporting coverage, while the area map keeps the raw condition vocabulary. The two never
intersected, so DOB coverage measured 0.000 in every area on every date. `rootOf` now applies the
same rewrite to both sides.

### Pinned constants

Every number above is a judgement call, and all of them are frozen in `area-score.ts` and pinned by
three snapshots in `test/fixtures/area-golden/`. Any change that moves a published verdict fails
that test and has to be re-baselined on purpose with `AREA_GOLDEN_WRITE=1`. There is no auto-write
on mismatch — a snapshot that updates itself is one that can never fail.

---

## API surface v1

`POST /api/reading` gained an eleventh key. Nothing else about the response changed.

```jsonc
{
  "readingId": "...", "tier": "...", "narration": {...}, "rules": [...],
  "areas": [ /* always 5, in the order dhan · rishte · karm · sehat · swabhav */ ],
  "lockedRuleCount": 0, "clusters": [...], "confidence": 0.6,
  "coverage": {...}, "birthWindows": [...], "meta": {...}
}
```

One area:

```jsonc
{
  "area": "rishte",
  "label_hi_en": "Pyaar aur Rishte",
  "direction": "anukool",        // null exactly when band is INSUFFICIENT
  "strength": 90,                // 0-100, direction-free; null when INSUFFICIENT
  "band": "HIGH",
  "conflict": 0.2,               // 4dp
  "independence": 3,
  "coverage": 0.8333,            // 4dp, per-area — NOT the response's global coverage.ratio
  "evidence": [ { "rule_id": "...", "role": "primary", "polarity": "positive",
                  "contribution": 0.85,
                  "interpretation_hi_en": "...",     // absent on free
                  "sources": [ { "text": "...", "loc": "...", "year": 1916 } ] } ],
  "lockedEvidenceCount": 3,
  "meta": { "map_version": "1.0", "engine_version": "area-v1.0" }
}
```

### Tier gates

| tier | evidence rows per area | `interpretation_hi_en` | `sources` | sensitive rules |
|---|---|---|---|---|
| free | top 2 | **withheld** | full | excluded by the engine |
| premium | top 8 | full | full | included |
| deep | all | full | full | included |

`lockedEvidenceCount` is the exact number of rows the tier did not receive — the free tier's upsell
number, and asserted exact rather than decorative.

Free sees the **citation but not the reading**: enough to show the evidence is real, not enough to
be the product.

### Two positional decisions

**Areas are scored before the tier truncation.** `scoreAreas` is fed `result.fired` — the whole
evaluated set — not `visibleRules`. Scoring an area from three rules because the caller is on the
free tier would make the verdict a function of what they paid rather than of their hand. Measured on
the rich fixture: the free tier scores on 29 evidence rows and displays 9.

**Sensitive rules cannot be resurrected.** `evaluateRules` already excludes them for the free tier
via `includeSensitive`, and `scoreAreas` reads nothing but `result.fired`, so a rule the engine
withheld cannot reappear as area evidence. That is true by construction, and measured anyway:
`PALM-CHILD-001` (sensitive, rishte) is present on premium and absent from every free-tier area.

### Structured citations — where the B5 fix lives

`toPublicRule` pre-joins a rule's sources into one string and keeps only `sources[0]`. That
flattening is why a citation drawer cannot be built from the current response. Area evidence carries
`sources` as a structured array instead.

The old field is **deliberately left alone** — the current reading UI parses it, and C4 migrates
that. Two shapes for the same data is the cost of not breaking the client mid-flight.

### Not persisted

Areas are **response-computed only**. The `Reading` row is written exactly as before and carries no
area data. Persistence is C5, and it needs a decision first: a stored verdict pins `map_version` and
`engine_version` at write time, so a re-scored reading and a stored one can disagree. `meta` carries
both versions on the wire so that disagreement is at least detectable.

### The DOB ceiling is a CTA hook

A birth-date-only reading supplies one feature root, so per-area coverage is pinned at
`1/12 = 0.0833` and no area can exceed LOW however much fires. That is by design, not a bug to tune
away: it is the honest statement that a birthday is not a palm. It is also the natural place to put
the scan prompt — the gap between LOW and what a scan would give is the argument for scanning.

`dhan` is INSUFFICIENT on every DOB-only request on every tier, asserted at both the engine level
(`test/area-score.test.ts`) and the wire (`test/api-areas.test.ts`).

### Server-only by convention

`lib/hastrekha/area-map-loader.ts` statically imports the 111 KB area map and is **not** re-exported
from the `lib/hastrekha` barrel, because that barrel is imported by client components
(`app/scan/scan-client.tsx`, `components/scan/live-ticker.tsx`). Server callers import it by path.
The TYPE re-export stays: `export type` is erased at build and cannot pull JSON into a bundle.

No `server-only` package is used — this is convention plus a comment at the export site. Measured
before removing it: the map was not in fact reaching any client chunk (the bundler tree-shook the
unused loader), but it was one import away from doing so.
