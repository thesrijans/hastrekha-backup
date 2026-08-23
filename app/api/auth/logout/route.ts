import { NextResponse, type NextRequest } from "next/server";
import { destroySession } from "@/lib/auth/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/auth/logout — revokes the session row and clears the cookie.
 *
 * POST rather than GET so a prefetch, an <img> tag or a link in an email cannot log a user out.
 * Always 204, even with no session: logging out is idempotent and reveals nothing.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  return destroySession(request, new NextResponse(null, { status: 204 }));
}
