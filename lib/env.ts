/**
 * Environment contract for HastRekha.
 *
 * APP_ENV decides the money path:
 *   dev  → Razorpay TEST keys only, Neon "dev" branch, fake-money allowed, verbose logs
 *   live → Razorpay LIVE keys only, Neon "main" branch, every money route enforced
 *
 * The module throws at import time on a bad contract so a misconfigured deploy never serves a request.
 * Import only from server code (never from client components).
 */

export type AppEnv = "dev" | "live";

const RAZORPAY_TEST_PREFIX = "rzp_test_";
const RAZORPAY_LIVE_PREFIX = "rzp_live_";

interface RawEnv {
  readonly [key: string]: string | undefined;
}

function read(raw: RawEnv, key: string): string | undefined {
  const value = raw[key];
  return value === undefined || value.trim() === "" ? undefined : value.trim();
}

function need(raw: RawEnv, key: string, problems: string[]): string {
  const value = read(raw, key);
  if (value === undefined) problems.push(`missing ${key}`);
  return value ?? "";
}

export interface Env {
  readonly appEnv: AppEnv;
  readonly isLive: boolean;
  readonly appUrl: string;
  readonly databaseUrl: string;
  readonly jwtSecret: string;
  readonly googleClientId: string;
  readonly googleClientSecret: string;
  readonly razorpayKeyId: string;
  readonly razorpayKeySecret: string;
  readonly razorpayWebhookSecret: string;
  readonly openRouterApiKey: string;
  readonly openRouterModel: string;
  readonly resendApiKey: string;
  readonly cronSecret: string;
  /** true only in dev — lets /api/dev/* simulate paid orders without Razorpay */
  readonly allowFakeMoney: boolean;
}

export function buildEnv(raw: RawEnv): Env {
  const problems: string[] = [];
  const appEnvRaw = read(raw, "APP_ENV");
  if (appEnvRaw !== "dev" && appEnvRaw !== "live") problems.push(`APP_ENV must be "dev" or "live" (got ${String(appEnvRaw)})`);
  const appEnv: AppEnv = appEnvRaw === "live" ? "live" : "dev";
  const isLive = appEnv === "live";

  const razorpayKeyId = need(raw, "RAZORPAY_KEY_ID", problems);
  if (isLive && !razorpayKeyId.startsWith(RAZORPAY_LIVE_PREFIX)) problems.push("live env requires a rzp_live_ key");
  if (!isLive && !razorpayKeyId.startsWith(RAZORPAY_TEST_PREFIX)) problems.push("dev env requires a rzp_test_ key — never point dev at live money");

  const databaseUrl = need(raw, "DATABASE_URL", problems);
  if (isLive && /dev|preview|test/i.test(databaseUrl.split("@")[1] ?? "")) problems.push("live env is pointing at a non-main database host");

  const env: Env = {
    appEnv,
    isLive,
    appUrl: need(raw, "NEXT_PUBLIC_APP_URL", problems),
    databaseUrl,
    jwtSecret: need(raw, "JWT_SECRET", problems),
    googleClientId: need(raw, "GOOGLE_CLIENT_ID", problems),
    googleClientSecret: need(raw, "GOOGLE_CLIENT_SECRET", problems),
    razorpayKeyId,
    razorpayKeySecret: need(raw, "RAZORPAY_KEY_SECRET", problems),
    razorpayWebhookSecret: need(raw, "RAZORPAY_WEBHOOK_SECRET", problems),
    openRouterApiKey: need(raw, "OPENROUTER_API_KEY", problems),
    openRouterModel: read(raw, "OPENROUTER_MODEL") ?? "anthropic/claude-haiku-4.5",
    resendApiKey: isLive ? need(raw, "RESEND_API_KEY", problems) : read(raw, "RESEND_API_KEY") ?? "",
    cronSecret: need(raw, "CRON_SECRET", problems),
    allowFakeMoney: !isLive && read(raw, "ALLOW_FAKE_MONEY") === "true",
  };

  if (env.jwtSecret.length > 0 && env.jwtSecret.length < 32) problems.push("JWT_SECRET must be ≥ 32 chars");
  if (isLive && read(raw, "ALLOW_FAKE_MONEY") === "true") problems.push("ALLOW_FAKE_MONEY cannot be set in live — remove it from the Production scope");

  if (problems.length > 0) {
    throw new Error(`[env] invalid configuration for APP_ENV=${appEnv}:\n - ${problems.join("\n - ")}`);
  }
  return env;
}

/** Singleton, evaluated once per server instance. */
export const env: Env = buildEnv(typeof process === "undefined" ? {} : process.env);

/** Call at the top of every route that moves money. Throws in dev unless fake money is explicitly enabled. */
export function assertMoneyPath(): void {
  if (env.isLive) return;
  if (!env.allowFakeMoney) {
    throw new Error("[money] dev environment: set ALLOW_FAKE_MONEY=true to exercise payment routes with test keys");
  }
}
