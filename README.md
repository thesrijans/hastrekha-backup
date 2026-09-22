This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy

The app deploys to the Vercel project **hastrekha** (scope `srijansharma05091998-7571`).
SETUP.md §0 and §3 hold the dev/live environment model; this is the mechanics.

**Preview** — `vercel deploy` from a linked checkout (`vercel link` once per
machine; the `.vercel/` link is git-ignored). **Production** is a separate,
deliberate `vercel --prod` and is never part of an automated step.

### Environment

`.env.example` lists every variable the app reads, by name only —
`test/deploy-gate.test.ts` fails if the code reads one it does not list. Set
each in Project → Settings → Environment Variables, per scope. `lib/env.ts`
validates the server contract when it is imported, so a missing or
contradictory value fails the build instead of a request.

| Variable | When it is read | What it does |
|---|---|---|
| `NEXT_PUBLIC_SANCTUARY=1` | at `next build` (inlined) | Opens `/sanctuary`, `/scan/chamber` and `/read/pothi`, and redirects `/` → `/sanctuary` (307). Unset, those routes are a baked 404 and `/` is the original home. Changing it needs a **redeploy**, not a restart. |
| `APP_ENV`, `DATABASE_URL`, keys… | at server start (`lib/env.ts`) | The dev/live contract — see SETUP.md §0. |
| `SNC_MEASURE=1` | at `next build` | Measurement harness only (opens `/dev/rekha-monitor` on a production build). Never set it on a deploy. |

`/dev/*` and `/sanctuary/materials` stay development-only whatever the flag
says. To see the sanctuary under `npm run dev`, put `NEXT_PUBLIC_SANCTUARY=1`
in `.env.local` and restart the dev server.

### Build

`npm run build` runs `prebuild` first:

1. `prisma generate` — the client is generated into `lib/generated/prisma`,
   which is git-ignored, so a clean builder has to make it.
2. `node scripts/vendor-mediapipe.mjs` — copies the MediaPipe and
   onnxruntime WASM out of `node_modules` into `public/mediapipe/wasm` and
   `public/ort` (git-ignored, ~34 MB), so no runtime fetch ever goes to a CDN.
   It is plain `fs` copying: Node 20+, no native code. The two model files it
   does not vendor (`public/models/hand_landmarker.task`,
   `public/models/palm-lines.onnx`) are committed.

### What is uploaded

The Vercel CLI reads `.vercelignore`, **not** `.gitignore`. `.vercelignore`
repeats `.gitignore` line for line (the deploy-gate test enforces it), so a CLI
deploy uploads what a git deploy would and nothing more: `captures/`,
`fixtures/private/` and scan sessions are biometric and never leave the machine.
Anything private that is not git-ignored goes below the mirror in `.vercelignore`.

### After a deploy

- `GET /api/health` → `{ appEnv, moneyMode, kbVersion }`.
- Frame capture against the deploy, without building locally:
  `node scripts/capture/capture.mjs --base-url <url> --route /sanctuary --viewport 390,1440`.
- `vercel.json` schedules a nightly cron (`/api/cron/rule-stats`); Vercel runs
  crons on production deployments only.
