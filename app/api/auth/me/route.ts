import { NextResponse, type NextRequest } from "next/server";
import { getSessionUser } from "@/lib/auth/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/auth/me — the header uses this to decide between "Login" and "Logout". */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const user = await getSessionUser(request);
  if (user === null) return NextResponse.json({ error: "not signed in" }, { status: 401 });
  return NextResponse.json({ user });
}
