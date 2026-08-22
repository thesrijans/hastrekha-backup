# HastRekha Core v0.1 — rules engine + grounded narrator + reading API

Drop-in for `hastrekha-lab` (Next.js 16 / React 19 / TS strict). Zero new dependencies.
Everything here is deterministic and tested; the LLM only narrates what the engine fired.

## What's in the bundle

| Path | Purpose |
|---|---|
| `lib/hastrekha/types.ts` | KB schema v1.0 types + engine I/O types (no `any`) |
| `lib/hastrekha/dob.ts` | DOB → birth-window resolver (core/minor ranges, Dec→Jan wrap, minor ×0.5) |
| `lib/hastrekha/engine.ts` | `evaluateRules(kb, features, opts)` → fired rules, clusters, cross-source agreement, coverage, confidence |
| `lib/hastrekha/kb-loader.ts` | runtime validation + merge (rule_id format, weight range, Devanagari, duplicates) |
| `lib/hastrekha/narrator.ts` | `narrateReading(result, {tier, question})` via OpenRouter→Haiku; rejects any uncited/ungrounded/Devanagari output → deterministic template fallback |
| `lib/hastrekha/sanitize.ts` | request sanitiser (group whitelist, 0–1 clamp, string caps, 16 KB limit) |
| `lib/hastrekha/rate-limit.ts` | in-memory sliding window (swap for shared KV later) |
| `app/api/reading/route.ts` | `POST /api/reading` — free tier for guests, premium/deep behind the auth seam |
| `scripts/merge_kb.py` | merges `data/kb/batches/hastrekha_kb_*.json` → `data/kb/hastrekha_kb.json` + `.features.json` + collision report |
| `test/*.ts` | engine / DOB / sanitiser / rate-limit tests (all passing against batch 5B) |

## Engine semantics (matches meta.conditions_semantics)

- Conditions AND-combine; ops `gte | lte | eq | in`. Missing feature ≠ false.
- `user.birth_window` is derived from `user.birth_date` (YYYY-MM-DD) using `meta.mount_birth_windows`.
- Positive DOB rules with missing mount data fire at ×0.7 (`dob_only_relaxed`) so a DOB-only free reading works before the palm scan.
- Minor window hits ×0.5. Multiple negative windows (Jan 21–Feb 18 overlap) → most-prominent mount wins, others ×0.8.
- `includeSensitive:false` for the free tier suppresses softened rules (count returned for the upsell copy).
- Clusters = category × polarity; `agreement` = distinct source books agreeing → +15 % score per extra book. This is the "Cheiro aur Benham dono" proof layer.
- `confidence` = 0.5·coverage + 0.5·min(1, weightMass/8). Show as "reading depth"; the `coverage.missing` list drives the "scan your palm to unlock" CTA.

## Request / response

```http
POST /api/reading
{ "tier": "free", "question": "career kab badlega?",
  "features": { "mounts": { "jupiter": 0.8, "sun": 0.9 }, "lines": { "head": { "quality": "good" } },
                "user": { "birth_date": "1994-03-25" } } }
```
Returns `narration` (one_liner, sections[{title, body, rule_ids}], disclaimer, engine: "llm"|"template"),
`rules` (3 visible on free, all on premium), `lockedRuleCount`, `clusters`, `confidence`, `coverage`, `birthWindows`.

## Env

```
OPENROUTER_API_KEY=...
OPENROUTER_MODEL=anthropic/claude-haiku-4.5   # optional
```

## Claude Code — STEP 1 (read-only)

```
STEP 1 — READ-ONLY RECON. Do NOT edit anything.
1. git status; git log --oneline -5; list top-level dirs; confirm tsconfig paths alias for "@/".
2. List data/kb/**/*.json (or wherever batch KB files live) with meta.rule_count each.
3. grep -rl "jose" app/api | head; print the exact export names of the session/auth helper used by existing API routes (e.g. getSession, requireUser) and the rate-limit helper if any.
4. Confirm whether resolveJsonModule is enabled in tsconfig.
5. Print the exact feature keys used by batch 1–5A rules for head line quality, hand quality, and thumb (grep '"feature"' | sort -u).
STOP and report. Wait for "confirmed".
```

## Claude Code — STEP 2 (after "confirmed")

```
STEP 2 — APPLY. Surgical adds only, nothing removed.
1. Copy lib/hastrekha/* , app/api/reading/route.ts, scripts/merge_kb.py from the bundle into the repo at the same paths.
2. Move all batch KB files into data/kb/batches/. Run:
   python scripts/merge_kb.py --in data/kb/batches --out data/kb/hastrekha_kb.json --version 0.2.0-cheiro-complete
   If it prints "possible feature-key collisions", STOP and show them.
3. In route.ts replace resolveUserId() body with the project's real session helper (from STEP 1 #3). Keep the signature.
4. Ensure tsconfig has "resolveJsonModule": true.
5. Run: npx tsc --noEmit. Show diff (git diff --stat). STOP.
Reminder: git status before and after.
```

## Commit block (PowerShell)

```powershell
# ---- REVIEW ----
cd C:\Projects\hastrekha-lab
git status
git diff --stat
npx tsc --noEmit
python scripts/merge_kb.py --in data/kb/batches --out data/kb/hastrekha_kb.json --version 0.2.0-cheiro-complete

# ---- COMMIT ----
git add lib/hastrekha app/api/reading scripts/merge_kb.py data/kb
git commit -m "feat(core): rules engine + grounded narrator + POST /api/reading (Cheiro KB merged, DOB windows, tiers)"
git push origin master
git push backup master
```

## Next (P1 continues)

1. `/read` page — DOB-first free reading (works today with zero camera), then manual palm sliders → premium.
2. Feature mapper `lib/hastrekha/cv-mapper.ts` — MediaPipe 21 landmarks → `mounts.*` prominence 0–1 (P2).
3. Benham KB batches → second source → agreement scores start lighting up.
