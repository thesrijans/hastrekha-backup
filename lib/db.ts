/**
 * Prisma client singleton for HastRekha.
 *
 * Prisma 7 no longer reads the connection string from `schema.prisma`; it is supplied at runtime
 * through a driver adapter. We use `PrismaPg` (node-postgres) over `env.databaseUrl`, so the same
 * env contract that guards the money path (see `lib/env.ts`) also guards which database we talk to.
 *
 * Server-only. Never import this from a client component.
 */
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/lib/generated/prisma/client";
import { env } from "@/lib/env";

/**
 * `next dev` hot-reloads server modules on every edit. Without a global cache each reload would
 * construct a fresh client and leak its pg connection pool until Neon refuses new connections.
 */
const globalForPrisma = globalThis as typeof globalThis & {
  __hastrekhaPrisma?: PrismaClient;
};

function createClient(): PrismaClient {
  return new PrismaClient({ adapter: new PrismaPg({ connectionString: env.databaseUrl }) });
}

/** The one Prisma client for this server instance. */
export const db: PrismaClient = globalForPrisma.__hastrekhaPrisma ?? createClient();

// Cache in dev only — in live each serverless instance gets exactly one client for its lifetime.
if (!env.isLive) globalForPrisma.__hastrekhaPrisma = db;
