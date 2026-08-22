import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import kbDocument from "@/data/kb/hastrekha_kb.json";
import { loadKnowledgeBase } from "@/lib/hastrekha";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const KB = loadKnowledgeBase(kbDocument);

/** GET /api/health — deploy smoke test. Never leaks secrets; confirms env mode + KB version. */
export async function GET(): Promise<NextResponse> {
  return NextResponse.json({
    ok: true,
    appEnv: env.appEnv,
    moneyMode: env.isLive ? "LIVE" : env.allowFakeMoney ? "FAKE" : "BLOCKED",
    kbVersion: KB.meta.kb_version,
    kbRules: KB.meta.rule_count,
    time: new Date().toISOString(),
  });
}
