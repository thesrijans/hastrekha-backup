import { NextResponse } from "next/server";
import { BUILD_SHA, BUILT_AT } from "@/lib/build-stamp";

/*
 * GET /api/version — which build is answering (M0).
 *
 * The same two constants the footers print, inlined at `next build`, so a phone
 * can be checked against a commit without reading a footer. Dynamic and
 * `no-store` so the answer is always the deployment's own: a probe that a cache
 * could answer with the previous build's value would be worse than none.
 *
 * Deliberately imports nothing from lib/env: that module throws at import when
 * the server contract is incomplete, and a version probe must answer on every
 * build, including one whose money and database keys are missing.
 */
export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  return NextResponse.json({ sha: BUILD_SHA, builtAt: BUILT_AT }, { headers: { "cache-control": "no-store" } });
}
