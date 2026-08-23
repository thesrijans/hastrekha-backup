/**
 * Prisma 7 CLI configuration.
 *
 * Prisma 7 removed `datasource.url` from `schema.prisma`; the connection string now lives here
 * (for CLI commands: `db pull`, `db execute`, `studio`) and is passed to `PrismaClient` at runtime
 * via the `PrismaPg` driver adapter — see `lib/db.ts`.
 *
 * `migrations` is deliberately NOT configured: the DB-change policy for this project is
 * raw SQL in the Neon SQL Editor → `npx prisma db pull` → `npx prisma generate`.
 * We never run `prisma migrate dev`, so there is no migrations directory to point at.
 *
 * Note: the Prisma CLI does not read Next.js' `.env.local`. Export DATABASE_URL into the shell
 * (or use `node --env-file=.env.local`) before running CLI commands that touch the database.
 * `prisma validate` and `prisma generate` do not need it.
 */
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  datasource: {
    url: process.env.DATABASE_URL,
  },
});
