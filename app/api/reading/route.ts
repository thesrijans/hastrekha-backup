import { NextResponse, type NextRequest } from "next/server";
import kbDocument from "@/data/kb/hastrekha_kb.json";
import { evaluateRules, loadKnowledgeBase, narrateReading, type FiredRule, type KnowledgeBase } from "@/lib/hastrekha";
import { sanitizeReadingRequest } from "@/lib/hastrekha/sanitize";
import { checkRateLimit } from "@/lib/hastrekha/rate-limit";
import { getSessionUser } from "@/lib/auth/session";
import { env } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_REQUESTS = 12;
const FREE_TIER_VISIBLE_RULES = 3;

/** Parsed once per server instance; throws at boot if the KB is malformed (fail fast, not per request). */
const KB: KnowledgeBase = loadKnowledgeBase(kbDocument);

interface PublicRule {
  readonly rule_id: string;
  readonly category: string;
  readonly polarity: string;
  readonly interpretation_hi_en: string;
  readonly weight: number;
  readonly source: string;
  readonly tags: readonly string[];
}

function toPublicRule(item: FiredRule): PublicRule {
  const source = item.rule.sources[0];
  return {
    rule_id: item.rule.rule_id,
    category: item.rule.category,
    polarity: item.rule.polarity,
    interpretation_hi_en: item.rule.interpretation_hi_en,
    weight: Number(item.effectiveWeight.toFixed(3)),
    source: source ? `${source.text} (${source.year}) — ${source.loc}` : "",
    tags: item.rule.tags,
  };
}

function clientKey(request: NextRequest): string {
  const forwarded = request.headers.get("x-forwarded-for");
  return forwarded ? forwarded.split(",")[0].trim() : "anonymous";
}

/** Returns the signed-in user's id for premium/deep tiers; null for guests. */
async function resolveUserId(request: NextRequest): Promise<string | null> {
  const user = await getSessionUser(request);
  return user === null ? null : user.id;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const limit = checkRateLimit(clientKey(request), RATE_LIMIT_MAX_REQUESTS, RATE_LIMIT_WINDOW_MS);
  if (!limit.allowed) {
    return NextResponse.json({ error: "Thoda ruk jao — bahut requests ho gayi. 1 minute baad try karo." }, { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } });
  }

  let rawText: string;
  try {
    rawText = await request.text();
  } catch {
    return NextResponse.json({ error: "unreadable body" }, { status: 400 });
  }
  let rawJson: unknown;
  try {
    rawJson = JSON.parse(rawText);
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }
  const sanitized = sanitizeReadingRequest(rawJson, new TextEncoder().encode(rawText).length);
  if (!sanitized.ok) return NextResponse.json({ error: sanitized.error }, { status: 400 });

  const { features, tier, question, userName, categories } = sanitized.request;
  const userId = await resolveUserId(request);
  if (tier !== "free" && userId === null) {
    return NextResponse.json({ error: "login required for premium reading", upgrade: true }, { status: 401 });
  }

  const result = evaluateRules(KB, features, {
    includeSensitive: tier !== "free",
    relaxMissingMounts: true,
    categories,
  });

  const narration = await narrateReading(result, {
    tier,
    question,
    userName,
    apiKey: env.openRouterApiKey,
    model: env.openRouterModel,
    signal: request.signal,
  });

  const visibleRules = tier === "free" ? result.fired.slice(0, FREE_TIER_VISIBLE_RULES) : result.fired;

  return NextResponse.json({
    tier,
    narration,
    rules: visibleRules.map(toPublicRule),
    lockedRuleCount: Math.max(0, result.fired.length - visibleRules.length),
    clusters: result.clusters.map((cluster) => ({
      category: cluster.category,
      polarity: cluster.polarity,
      score: Number(cluster.score.toFixed(3)),
      agreement: cluster.agreement,
      rule_ids: cluster.rules.map((item) => item.rule.rule_id),
    })),
    confidence: result.confidence,
    coverage: result.coverage,
    birthWindows: result.birthWindows,
    meta: result.meta,
  });
}
