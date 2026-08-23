/**
 * Guest identity for readings taken before sign-in.
 *
 * A random opaque token lives in an httpOnly cookie; only its sha256 ever reaches the database
 * (`Reading.guestKey`). That lets a guest come back to their own readings and leave feedback, lets
 * us merge those readings into a real account on signup, and means a database leak yields hashes
 * rather than working device credentials.
 *
 * Server-only.
 */
import { createHash, randomBytes } from "node:crypto";
import type { NextRequest, NextResponse } from "next/server";
import { env } from "@/lib/env";

export const GUEST_COOKIE = "hr_guest";
/** Long-lived on purpose: a guest who returns in three months should still own their readings. */
export const GUEST_TTL_DAYS = 180;

const GUEST_TTL_SECONDS = GUEST_TTL_DAYS * 24 * 60 * 60;
const TOKEN_BYTES = 24;

export interface Guest {
  readonly token: string;
  /** True when the caller must call {@link attachGuestCookie} on the outgoing response. */
  readonly isNew: boolean;
}

/** Returns the caller's guest token, minting one if they have never been here. */
export function resolveGuest(request: NextRequest): Guest {
  const existing = request.cookies.get(GUEST_COOKIE)?.value;
  if (existing !== undefined && existing !== "") return { token: existing, isNew: false };
  return { token: randomBytes(TOKEN_BYTES).toString("base64url"), isNew: true };
}

/** The value stored in `Reading.guestKey`. Never store the raw token. */
export function guestKey(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function attachGuestCookie(response: NextResponse, token: string): void {
  response.cookies.set(GUEST_COOKIE, token, {
    httpOnly: true,
    secure: env.isLive,
    sameSite: "lax",
    path: "/",
    maxAge: GUEST_TTL_SECONDS,
  });
}
