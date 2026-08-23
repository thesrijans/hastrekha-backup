/**
 * Session auth for HastRekha.
 *
 * Shape: an httpOnly cookie holding a jose-signed HS256 JWT of `{ sid, uid }`, backed by a `Session`
 * row. The JWT is the bearer proof; the row is the revocation switch — deleting it logs the user out
 * everywhere immediately, which a stateless JWT alone cannot do. `Session.tokenHash` is the sha256 of
 * a random token generated at login and never transmitted; it gives each row an unguessable unique
 * identity so rows cannot be enumerated or forged from anything the client holds.
 *
 * Server-only. Never import this from a client component.
 */
import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { SignJWT, jwtVerify, type JWTPayload } from "jose";
import type { NextRequest, NextResponse } from "next/server";
import type { UserRole } from "@/lib/generated/prisma/client";
import { db } from "@/lib/db";
import { env } from "@/lib/env";

/** Cookie that carries the signed session JWT. */
export const SESSION_COOKIE = "hr_session";
/** How long a session stays valid, in days. Cookie lifetime and `Session.expiresAt` share this. */
export const SESSION_TTL_DAYS = 30;

const SESSION_TTL_SECONDS = SESSION_TTL_DAYS * 24 * 60 * 60;
const SESSION_TTL_MS = SESSION_TTL_SECONDS * 1000;
const JWT_ALG = "HS256";
const TOKEN_BYTES = 32;

/** `env.jwtSecret` is validated at import time (≥ 32 chars), so this is safe to derive once. */
const SECRET_KEY = new TextEncoder().encode(env.jwtSecret);

/** The slice of `User` every authenticated route is allowed to see. Never widen this casually. */
export interface SessionUser {
  readonly id: string;
  readonly email: string;
  readonly name: string | null;
  readonly role: UserRole;
  readonly persona: string;
  readonly locale: string;
  /** ISO date (YYYY-MM-DD) or null. Lets the scan seed `user.birth_date` without asking again. */
  readonly birthDate: string | null;
}

/** Thrown by {@link requireUser}. Carries the HTTP status a route should reply with. */
export class AuthError extends Error {
  readonly status: number;

  constructor(message = "login required", status = 401) {
    super(message);
    this.name = "AuthError";
    this.status = status;
  }
}

interface SessionClaims {
  /** `Session.id` — the revocable handle. */
  readonly sid: string;
  /** `User.id` — cross-checked against the row so a stale JWT cannot be re-pointed. */
  readonly uid: string;
}

function isSessionClaims(payload: JWTPayload): payload is JWTPayload & SessionClaims {
  return typeof payload.sid === "string" && typeof payload.uid === "string";
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

interface CookieOptions {
  readonly httpOnly: true;
  readonly secure: boolean;
  readonly sameSite: "lax";
  readonly path: "/";
  readonly maxAge: number;
}

/** `secure` is off in dev so the cookie survives plain-http localhost; always on in live. */
function cookieOptions(maxAgeSeconds: number): CookieOptions {
  return { httpOnly: true, secure: env.isLive, sameSite: "lax", path: "/", maxAge: maxAgeSeconds };
}

/**
 * Writes the session cookie directly onto an outgoing response.
 *
 * {@link createSession} already sets it through `next/headers`, which is the right mechanism when a
 * handler returns `NextResponse.json(...)`. When a handler instead returns a *redirect* it must also
 * attach the cookie here, so the browser is guaranteed to carry it to the next page. Setting the same
 * name/value twice is harmless.
 */
export function attachSessionCookie(response: NextResponse, jwt: string): void {
  response.cookies.set(SESSION_COOKIE, jwt, cookieOptions(SESSION_TTL_SECONDS));
}

/** Expires the session cookie on an outgoing response. */
export function clearSessionCookie(response: NextResponse): void {
  response.cookies.set(SESSION_COOKIE, "", cookieOptions(0));
}

/** Reads and verifies the session JWT on an incoming request. Returns null for absent/forged/expired. */
async function readClaims(request: NextRequest): Promise<SessionClaims | null> {
  const raw = request.cookies.get(SESSION_COOKIE)?.value;
  if (raw === undefined || raw === "") return null;
  try {
    const { payload } = await jwtVerify(raw, SECRET_KEY, { algorithms: [JWT_ALG] });
    return isSessionClaims(payload) ? { sid: payload.sid, uid: payload.uid } : null;
  } catch {
    // Bad signature, wrong alg, or past `exp` — all of these mean "not logged in", never an error.
    return null;
  }
}

/**
 * Starts a session for `userId`: writes the `Session` row and sets the httpOnly cookie.
 * Must be called from a Route Handler or Server Function — nowhere else may set cookies.
 *
 * @returns the signed JWT that was placed in the cookie.
 */
export async function createSession(userId: string): Promise<string> {
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  const session = await db.session.create({
    data: {
      userId,
      tokenHash: hashToken(randomBytes(TOKEN_BYTES).toString("base64url")),
      expiresAt,
    },
    select: { id: true },
  });

  const jwt = await new SignJWT({ sid: session.id, uid: userId })
    .setProtectedHeader({ alg: JWT_ALG })
    .setIssuedAt()
    .setExpirationTime(Math.floor(expiresAt.getTime() / 1000))
    .sign(SECRET_KEY);

  const store = await cookies();
  store.set(SESSION_COOKIE, jwt, cookieOptions(SESSION_TTL_SECONDS));
  return jwt;
}

/**
 * Resolves the caller of `request` to a user, or null when there is no usable session.
 *
 * Null covers every failure the same way on purpose — missing cookie, bad signature, revoked row,
 * expired row, soft-deleted user. Callers get "not logged in" and nothing that helps an attacker
 * tell those cases apart.
 */
export async function getSessionUser(request: NextRequest): Promise<SessionUser | null> {
  const claims = await readClaims(request);
  if (claims === null) return null;

  const session = await db.session.findUnique({
    where: { id: claims.sid },
    select: {
      userId: true,
      expiresAt: true,
      user: {
        select: {
          id: true,
          email: true,
          name: true,
          role: true,
          persona: true,
          locale: true,
          birthDate: true,
          deletedAt: true,
        },
      },
    },
  });

  if (session === null) return null; // revoked or never existed
  if (session.userId !== claims.uid) return null; // JWT and row disagree — treat as forged
  if (session.expiresAt.getTime() <= Date.now()) return null; // row expired even if the JWT has not
  if (session.user.deletedAt !== null) return null; // account deleted under DPDP erasure

  const { id, email, name, role, persona, locale, birthDate } = session.user;
  return {
    id,
    email,
    name,
    role,
    persona,
    locale,
    // Stored as a DATE column; the client only ever needs the calendar day.
    birthDate: birthDate === null ? null : birthDate.toISOString().slice(0, 10),
  };
}

/** {@link getSessionUser} for routes where anonymous access is not an option. */
export async function requireUser(request: NextRequest): Promise<SessionUser> {
  const user = await getSessionUser(request);
  if (user === null) throw new AuthError();
  return user;
}

/**
 * Ends the session: deletes the `Session` row and clears the cookie on `response`.
 *
 * The cookie is cleared even when the JWT is unverifiable, so a client holding a junk cookie can
 * always log itself out.
 *
 * @returns the same `response`, so callers can `return destroySession(request, response)`.
 */
export async function destroySession(request: NextRequest, response: NextResponse): Promise<NextResponse> {
  const claims = await readClaims(request);
  // deleteMany, not delete: logging out twice is not an error worth throwing over.
  if (claims !== null) await db.session.deleteMany({ where: { id: claims.sid } });
  clearSessionCookie(response);
  return response;
}
