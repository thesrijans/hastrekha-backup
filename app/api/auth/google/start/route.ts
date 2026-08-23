import { randomBytes } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { buildAuthorizationUrl, OAUTH_STATE_COOKIE, OAUTH_STATE_TTL_SECONDS } from "@/lib/auth/google";
import { checkRateLimit } from "@/lib/hastrekha/rate-limit";
import { clientIp } from "@/lib/http";
import { env } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_REQUESTS = 10;
const STATE_BYTES = 32;

/**
 * GET /api/auth/google/start — begins the OAuth code flow.
 *
 * Mints a random `state`, parks it in a short-lived httpOnly cookie, and redirects to Google. The
 * callback only proceeds if the returned `state` matches that cookie, which is what stops a third
 * party from feeding us their own authorization code.
 *
 * `sameSite: "lax"` is required here — a `strict` cookie would not be sent on the top-level
 * navigation back from accounts.google.com, breaking every sign-in.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const limit = checkRateLimit(`oauth-start:${clientIp(request)}`, RATE_LIMIT_MAX_REQUESTS, RATE_LIMIT_WINDOW_MS);
  if (!limit.allowed) {
    const throttled = NextResponse.redirect(new URL("/login?error=rate_limit", env.appUrl));
    throttled.headers.set("Retry-After", String(limit.retryAfterSeconds));
    return throttled;
  }

  const state = randomBytes(STATE_BYTES).toString("base64url");
  const response = NextResponse.redirect(buildAuthorizationUrl(state));
  response.cookies.set(OAUTH_STATE_COOKIE, state, {
    httpOnly: true,
    secure: env.isLive,
    sameSite: "lax",
    path: "/",
    maxAge: OAUTH_STATE_TTL_SECONDS,
  });
  return response;
}
