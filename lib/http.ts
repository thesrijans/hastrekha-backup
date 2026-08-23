/**
 * Small HTTP helpers shared by route handlers.
 */
import type { NextRequest } from "next/server";

/**
 * Best-effort client IP for rate-limit keys and consent records.
 *
 * `x-forwarded-for` is a client-controllable header, so this is a throttling/audit hint — never an
 * identity. Vercel puts the real edge IP first, which is what we take.
 */
export function clientIp(request: NextRequest): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded !== null && forwarded !== "") return forwarded.split(",")[0].trim();
  return request.headers.get("x-real-ip") ?? "anonymous";
}
