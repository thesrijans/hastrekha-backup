/**
 * Google OAuth 2.0 authorization-code flow — server side only.
 *
 * No Google JavaScript SDK reaches the browser: the client only ever sees two redirects. The
 * client secret and the code exchange never leave the server, and the id_token is verified against
 * Google's published JWKS rather than trusted because it arrived over TLS.
 */
import { createRemoteJWKSet, jwtVerify } from "jose";
import { env } from "@/lib/env";

/** Short-lived CSRF cookie tying a callback back to the browser that started the flow. */
export const OAUTH_STATE_COOKIE = "hr_oauth_state";
export const OAUTH_STATE_TTL_SECONDS = 10 * 60;

const AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const JWKS_URL = "https://www.googleapis.com/oauth2/v3/certs";
/** Google has shipped both spellings over the years; accept either, nothing else. */
const ISSUERS = ["https://accounts.google.com", "accounts.google.com"];
const SCOPE = "openid email profile";
const TOKEN_TIMEOUT_MS = 10_000;

/** Cached across requests by jose, so a signing-key rotation costs one extra fetch, not one per login. */
const JWKS = createRemoteJWKSet(new URL(JWKS_URL));

/** Must match a redirect URI registered in the Google Cloud console for this client. */
export function googleRedirectUri(): string {
  return new URL("/api/auth/google/callback", env.appUrl).toString();
}

export function buildAuthorizationUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: env.googleClientId,
    redirect_uri: googleRedirectUri(),
    response_type: "code",
    scope: SCOPE,
    state,
    // We never call Google APIs on the user's behalf, so we do not want a refresh token.
    access_type: "online",
    prompt: "select_account",
  });
  return `${AUTH_ENDPOINT}?${params.toString()}`;
}

export interface GoogleIdentity {
  readonly sub: string;
  readonly email: string;
  readonly name: string | null;
}

/** Exchanges an authorization code for the id_token. Bounded by {@link TOKEN_TIMEOUT_MS}. */
async function exchangeCode(code: string): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TOKEN_TIMEOUT_MS);
  try {
    const response = await fetch(TOKEN_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
      body: new URLSearchParams({
        code,
        client_id: env.googleClientId,
        client_secret: env.googleClientSecret,
        redirect_uri: googleRedirectUri(),
        grant_type: "authorization_code",
      }),
      signal: controller.signal,
      cache: "no-store",
    });
    if (!response.ok) throw new Error(`google token endpoint returned ${response.status}`);
    const payload: unknown = await response.json();
    const idToken = (payload as { id_token?: unknown }).id_token;
    if (typeof idToken !== "string" || idToken === "") throw new Error("google token response carried no id_token");
    return idToken;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Turns an authorization code into a verified Google identity.
 *
 * `jwtVerify` enforces the JWKS signature plus `iss`, `aud` and `exp`. On top of that we require
 * `email_verified`: we link accounts by email, so an unverified address would be an account-takeover
 * path.
 *
 * @throws on any protocol, network, timeout, signature or claim failure — callers must treat every
 * throw identically and tell the user nothing beyond "sign-in failed".
 */
export async function identityFromCode(code: string): Promise<GoogleIdentity> {
  const idToken = await exchangeCode(code);
  const { payload } = await jwtVerify(idToken, JWKS, { issuer: ISSUERS, audience: env.googleClientId });

  const sub = payload.sub;
  const email = payload.email;
  const emailVerified = payload.email_verified;
  const name = payload.name;

  if (typeof sub !== "string" || sub === "") throw new Error("id_token has no sub");
  if (typeof email !== "string" || email === "") throw new Error("id_token has no email");
  if (emailVerified !== true) throw new Error("google email is not verified");

  return {
    sub,
    email: email.toLowerCase(),
    name: typeof name === "string" && name.trim() !== "" ? name.trim().slice(0, 60) : null,
  };
}
