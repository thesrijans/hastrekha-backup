import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { identityFromCode, OAUTH_STATE_COOKIE, type GoogleIdentity } from "@/lib/auth/google";
import { attachSessionCookie, createSession } from "@/lib/auth/session";
import { clientIp } from "@/lib/http";
import { db } from "@/lib/db";
import { env } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Bumped when the wording of the terms or privacy policy changes; old rows stay for the audit trail. */
const CONSENT_VERSION = "v1";
const POST_LOGIN_PATH = "/read";

/** Constant-time compare so the state cookie cannot be probed a character at a time. */
function statesMatch(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

/**
 * Finds or creates the local account for a verified Google identity.
 *
 * Match order is `googleSub` first, then email. The email fallback links an account created by some
 * other means (or a re-created Google account) instead of silently producing a duplicate — and it is
 * only safe because `identityFromCode` refuses unverified emails.
 */
async function resolveUser(identity: GoogleIdentity): Promise<{ id: string }> {
  const bySub = await db.user.findUnique({ where: { googleSub: identity.sub }, select: { id: true } });
  if (bySub !== null) return bySub;

  const byEmail = await db.user.findUnique({ where: { email: identity.email }, select: { id: true, name: true } });
  if (byEmail !== null) {
    return db.user.update({
      where: { id: byEmail.id },
      data: { googleSub: identity.sub, name: byEmail.name ?? identity.name },
      select: { id: true },
    });
  }

  return db.user.create({
    data: { email: identity.email, name: identity.name, googleSub: identity.sub },
    select: { id: true },
  });
}

/**
 * Records DPDP consent for the terms and privacy policy.
 *
 * `skipDuplicates` against the `[userId, kind, version]` unique index makes this write exactly once —
 * on first sign-in — without us having to track "is this a new user" separately, and it self-heals if
 * an earlier attempt died between creating the user and recording consent.
 */
async function recordSignInConsent(userId: string, ip: string): Promise<void> {
  await db.consent.createMany({
    data: [
      { userId, kind: "TERMS", version: CONSENT_VERSION, ip },
      { userId, kind: "PRIVACY", version: CONSENT_VERSION, ip },
    ],
    skipDuplicates: true,
  });
}

/**
 * GET /api/auth/google/callback — completes the OAuth code flow and starts a session.
 *
 * Every failure path — bad state, network trouble, a forged id_token, a database error — lands on the
 * same `/login?error=oauth`. The reason is logged server-side and never rendered, so the redirect
 * cannot be used to probe which accounts exist or how verification failed.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const failure = NextResponse.redirect(new URL("/login?error=oauth", env.appUrl));
  failure.cookies.delete(OAUTH_STATE_COOKIE);

  const code = request.nextUrl.searchParams.get("code");
  const state = request.nextUrl.searchParams.get("state");
  const expectedState = request.cookies.get(OAUTH_STATE_COOKIE)?.value;

  if (code === null || state === null || expectedState === undefined) return failure;
  if (!statesMatch(state, expectedState)) return failure;

  try {
    const identity = await identityFromCode(code);
    const user = await resolveUser(identity);
    await recordSignInConsent(user.id, clientIp(request));
    const jwt = await createSession(user.id);

    const success = NextResponse.redirect(new URL(POST_LOGIN_PATH, env.appUrl));
    attachSessionCookie(success, jwt);
    success.cookies.delete(OAUTH_STATE_COOKIE);
    return success;
  } catch (error) {
    console.error("[auth] google callback failed:", error);
    return failure;
  }
}
