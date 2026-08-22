# HastRekha — Project Bootstrap (website #2, separate from Physenta)

**Path:** `C:\Projects\hastrekha`  **Repo:** `hastrekha` (new; `hastrekha-lab` stays as the research/KB lab)
**Stack:** Next.js (App Router, TS strict, Tailwind) · Prisma + Neon · jose JWT · Razorpay · Resend · OpenRouter→Haiku · Vercel · Capacitor later

## 0. Environment model — decided once, enforced by code

| | **dev** | **live** |
|---|---|---|
| `APP_ENV` | `dev` | `live` |
| URL | `localhost:3000` + Vercel **Preview** (`dev.hastrekha.*`) | Vercel **Production** (`hastrekha.com`) |
| Neon branch | `dev` | `main` |
| Razorpay | `rzp_test_*` only | `rzp_live_*` only |
| Money routes | blocked unless `ALLOW_FAKE_MONEY=true` | always real, always webhook-verified |
| Logs | verbose | structured, no PII |

`lib/env.ts` **throws at boot** if: live has a test key, dev has a live key, live DB host looks like dev, `ALLOW_FAKE_MONEY` in live, `JWT_SECRET` < 32 chars. A wrong deploy cannot serve a single request.
Every `Order` row stores `appEnv` — dev and live money can never be confused in reports.

## 1. Bootstrap (PowerShell)

```powershell
cd C:\Projects
npx create-next-app@latest hastrekha --typescript --tailwind --eslint --app --no-src-dir --import-alias "@/*" --use-npm
cd C:\Projects\hastrekha
npm i @prisma/client jose razorpay resend
npm i -D prisma

# Unzip hastrekha-scaffold.zip INTO this folder (it adds lib/, app/api/, prisma/, scripts/, data/, .env.example, vercel.json; merge .gitignore)

Copy-Item .env.example .env.local      # fill dev values only
python scripts/merge_kb.py --in data/kb/batches --out data/kb/hastrekha_kb.json --version 0.2.0-cheiro-complete

git init; git add .; git commit -m "chore: bootstrap hastrekha (env contract, prisma v0, core engine, reading api)"
git remote add origin <new-github-repo>
git remote add backup <backup-remote>
git push -u origin master; git push backup master
```

tsconfig must have `"resolveJsonModule": true` (create-next-app sets it).

## 2. Neon

1. New project `hastrekha` (Singapore). Default branch = `main` = **live**. Create branch `dev` from it.
2. Neon SQL Editor on **dev** → paste `prisma/schema.sql` equivalent: run `npx prisma db push` **against dev only** for the very first table creation (policy afterwards: raw SQL → `db pull` → `generate`).
3. Same DDL applied to `main` when you go live — via SQL Editor, never from the laptop.

## 3. Vercel

1. Import repo. Framework Next.js.
2. **Environment Variables** — set per scope:
   - **Production**: `APP_ENV=live`, live Razorpay keys, `main` DB, `RESEND_API_KEY`, `ALLOW_FAKE_MONEY` **unset**.
   - **Preview + Development**: `APP_ENV=dev`, test keys, `dev` DB, `ALLOW_FAKE_MONEY=true`.
3. Domains: `hastrekha.com` → Production; `dev.hastrekha.com` → branch `dev` (Preview).
4. Branch strategy: `master` = live, `dev` = dev. Feature work merges into `dev` → test on `dev.hastrekha.com` with fake money → PR to `master`.
5. Smoke test after every deploy: `GET /api/health` → `{ appEnv, moneyMode: "LIVE" | "FAKE" | "BLOCKED", kbVersion }`.

## 4. Razorpay

- Create the HastRekha account under DocSynject **separately** from Physenta's.
- Category framing at signup: *self-knowledge / personality insights / digital content* — not "astrology/occult". Same lesson as the telemedicine strip.
- Webhooks: `/api/webhooks/razorpay` (`payment.captured`, `payment.failed`, `refund.processed`), secret differs per env.
- Dev flow: `ALLOW_FAKE_MONEY=true` → `POST /api/dev/grant` creates an `Order(status=PAID, appEnv=dev)` + `Entitlement` without Razorpay; route returns 404 in live.

## 5. Folder map (what the scaffold adds)

```
lib/env.ts                     env contract + assertMoneyPath()
lib/hastrekha/*                rules engine, DOB, narrator, sanitiser, rate limit
app/api/reading/route.ts       POST reading (free for guests, premium/deep auth-gated)
app/api/health/route.ts        deploy smoke test
prisma/schema.prisma           v0: User/Session/Consent, Reading/ReadingRule/RuleFeedback/RuleStat, Order/Payment/Entitlement, AuditLog
scripts/merge_kb.py            KB batches → data/kb/hastrekha_kb.json
data/kb/batches/               put ALL Cheiro batch files here (1–5B)
vercel.json                    nightly rule-stats cron
```

## 6. Build order (P1 → P3)

1. **P1 Auth + free reading** — Google sign-in (jose session), `/read` DOB-first page, guest readings with `guestKey`, merge-on-signup.
2. **P2 Money** — products table, Razorpay order + webhook, Entitlement consume, price anchoring (strikethrough everywhere), admin grants.
3. **P3 Camera** — on-device MediaPipe hand landmarker → `cv-mapper.ts` → `mounts.*` 0–1. Images never leave the device (DPDP + BIPA-safe by design).
4. **P4 Bot** — conversational layer over the engine; asks for DOB/palm when needed; Remedy KB + Gem KB.
5. **P5 Global persona** — `persona=global` narrator + English UI + compatibility.

## 7. Claude Code — STEP 1 (read-only, run after bootstrap)

```
STEP 1 — READ-ONLY. Do NOT edit.
1. git status; git log --oneline -3; print tsconfig compilerOptions.paths and resolveJsonModule.
2. Confirm these exist: lib/env.ts, lib/hastrekha/index.ts, app/api/reading/route.ts, app/api/health/route.ts, prisma/schema.prisma, data/kb/hastrekha_kb.json (print meta.rule_count and meta.by_prefix).
3. Run: npx tsc --noEmit — paste the full output (expect errors only about missing .env/next types if any).
4. Run: npx prisma validate — paste output.
5. Print .env.local variable NAMES only (no values).
STOP and report. Wait for "confirmed".
```

## 8. Claude Code — STEP 2 (after "confirmed")

```
STEP 2 — APPLY. Surgical; add only.
1. Fix any tsc errors from STEP 1 that are import-path or next-types related. Do not touch engine logic.
2. Create lib/auth/session.ts: jose HS256 sign/verify, httpOnly cookie "hr_session", 30-day expiry, helpers getSessionUser(req) and requireUser(req). Reuse the Physenta pattern you know; no any types; JSDoc.
3. In app/api/reading/route.ts implement resolveUserId() using getSessionUser. Keep the signature.
4. Run npx tsc --noEmit and npx prisma validate. Show git diff --stat. STOP.
```

## Commit block (PowerShell)

```powershell
# ---- REVIEW ----
cd C:\Projects\hastrekha; git status; git add -u; git add .; git --no-pager diff --cached > diff.txt; code diff.txt
# ---- COMMIT ----
taskkill /F /IM node.exe; npx tsc --noEmit; npm run build; git commit -m "<msg>"; git push origin dev; git push backup dev
```
(`master` receives only merges from `dev` after a green `dev.hastrekha.com` test with fake money.)
