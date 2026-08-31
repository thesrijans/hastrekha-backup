# Area-golden re-pin — KB `0.2.0-cheiro-complete` → `0.3.0-dale-merged`

The three pins in this directory were regenerated with
`AREA_GOLDEN_WRITE=1 npx tsx test/area-score.test.ts` when the Dale batch
(`PALM-DALE-001..171`, *Indian Palmistry*, 1895) took the KB from 377 rules to 548.

**Two independent things moved, and they are easy to confuse.** Both are recorded here because a
band change with two candidate causes is not evidence of either one until they are separated.

## Cause 1 — the evidence pool grew

`scoreAreas` divides by the area's mapped-rule pool and by its distinct feature roots, so both the
denominator and what can fill it changed:

| area | pool before | pool after | feature roots after |
|---|---:|---:|---:|
| `dhan` | 19 | **67** | 32 |
| `rishte` | 82 | 93 | 24 |
| `karm` | 87 | 135 | 34 |
| `sehat` | 43 | 57 | 21 |
| `swabhav` | 169 | 218 | 54 |

`dhan` is the one that matters. It was the thin area — 19 rules against a 20-rule floor, called
"structural" in `docs/AREA_VERDICTS.md` — and Dale is a wealth-heavy source (44 of its 171 rules).
On `rich-palm`, `dhan` goes `INSUFFICIENT → LOW/mishrit`: the first time a scanned palm produces a
money verdict at all.

## Cause 2 — cross-book agreement went live, for the first time

`buildClusters` (`lib/hastrekha/engine.ts`) counts the **set of distinct source titles** in a
cluster and pays `AGREEMENT_BONUS_PER_SOURCE` (15%) per extra book:

```ts
const agreement = Math.max(1, sources.size);
const score = mass * (1 + AGREEMENT_BONUS_PER_SOURCE * (agreement - 1));
```

Before the merge this was dead code in practice — 377 of the KB's 378 source entries were the same
Cheiro volume, so `agreement` was 1 almost everywhere. Measured on the `rich-palm` bag after the
merge, **3 of 13 clusters now carry `agreement: 2`** (`personality/positive`, `love/positive`,
`career/positive`), each taking the 15% bonus. Those clusters gained score without gaining a rule.

### The trap this nearly walked into

The bonus keys on the raw source **string**, so one book under two titles manufactures agreement
that does not exist. The lab batch shipped exactly that: 164 rules cited `Indian Palmistry` and the
7 chunk-012 re-extraction rules (`PALM-DALE-165..171`) cited `Dale — Indian Palmistry`. Left alone,
any cluster holding rules from both groups would have scored a fictitious `agreement: 2` — and
`165..171` span vitality, career, wealth, personality and obstacles, so it would have hit real
readings. All 171 were normalised to `Dale — Indian Palmistry` (the KB's existing
`Cheiro — Palmistry for All` Author — Title convention) before merging; see
`data/kb/batches/hastrekha_kb_batch7_dale.json` → `meta.source_title_note`.

The three `agreement: 2` clusters above are therefore real Cheiro-plus-Dale corroboration, not an
artefact of the merge.

## What actually changed in the pins

`dob-only` is **unchanged in every band, direction, strength and evidence count**. That is the
control: Dale added no birth-window rules, so a DOB-only reading must not move, and it does not.

| fixture | area | change |
|---|---|---|
| `rich-palm` | `dhan` | `INSUFFICIENT → LOW/mishrit` · strength —→35 · coverage 0.25→0.92 · evidence 0→2 |
| | `karm` | `MEDIUM → HIGH` · strength 37→98 · coverage 0.75→1.0 |
| | `rishte` `sehat` `swabhav` | bands hold; coverage and conflict shift |
| `conflict-rishte` | `rishte` | `MEDIUM → HIGH`, still `mishrit` — the designed contradiction survives |
| | `karm` | `LOW → HIGH` · strength 23→77 |
| | `swabhav` | `MEDIUM → HIGH` · **direction `mishrit` → `anukool`** · conflict 0.39→0.18 |
| `dob-only` | all five | unchanged |

`rulesFired` 20→29 (`rich-palm`) and 13→21 (`conflict-rishte`); 27→27 (`dob-only`).

**The one to keep an eye on** is `conflict-rishte / swabhav`. That fixture exists to prove an area
reports a split rather than averaging it away, and its `swabhav` direction flipped `mishrit →
anukool` because three new positive Dale rules diluted the conflict from 0.39 to 0.18. The
*designed* contradiction is in `rishte`, and that one still reads `mishrit` — so the fixture still
tests what it was built to test. But `swabhav` is no longer a second conflict case, and if one is
wanted there, it needs new contradictory features rather than the ones that happen to be in this
bag.
