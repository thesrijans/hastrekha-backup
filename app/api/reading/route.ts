import { NextResponse, type NextRequest } from "next/server";
import kbDocument from "@/data/kb/hastrekha_kb.json";
import { evaluateRules, loadKnowledgeBase, narrateReading, type FiredRule, type KnowledgeBase } from "@/lib/hastrekha";
import { sanitizeReadingRequest } from "@/lib/hastrekha/sanitize";
import { checkRateLimit } from "@/lib/hastrekha/rate-limit";
import { getSessionUser } from "@/lib/auth/session";
import { attachGuestCookie, guestKey, resolveGuest } from "@/lib/auth/guest";
import { clientIp } from "@/lib/http";
import { db } from "@/lib/db";
import type { Prisma, ReadingSource, ReadingTier as DbReadingTier } from "@/lib/generated/prisma/client";
import type { FeatureBag, ReadingResult } from "@/lib/hastrekha";
import type { Narration, ReadingTier } from "@/lib/hastrekha";
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
  return clientIp(request);
}

const TIER_TO_DB: Readonly<Record<ReadingTier, DbReadingTier>> = { free: "FREE", premium: "PREMIUM", deep: "DEEP" };

/** Palm data present means the user filled the manual form; DOB alone is the numerology-only path. */
function readingSource(features: FeatureBag): ReadingSource {
  return Object.keys(features).some((group) => group !== "user") ? "MANUAL_FORM" : "DOB_ONLY";
}

/**
 * Writes the reading and one row per fired rule — this is what makes the KB learnable, and what
 * per-rule feedback later attaches to.
 *
 * Persistence is best-effort on purpose: a database hiccup must not cost the user the reading they
 * just waited for. On failure we log, return null, and the client simply renders without thumbs.
 */
async function persistReading(args: {
  readonly userId: string | null;
  readonly guestKeyHash: string;
  readonly tier: ReadingTier;
  readonly features: FeatureBag;
  readonly source: ReadingSource;
  readonly question: string | undefined;
  readonly result: ReadingResult;
  readonly narration: Narration;
  readonly visibleRuleIds: ReadonlySet<string>;
}): Promise<string | null> {
  try {
    const reading = await db.reading.create({
      data: {
        userId: args.userId,
        guestKey: args.guestKeyHash,
        tier: TIER_TO_DB[args.tier],
        source: args.source,
        kbVersion: args.result.meta.kbVersion,
        features: args.features as unknown as Prisma.InputJsonValue,
        question: args.question,
        confidence: args.result.confidence,
        coverageRatio: args.result.coverage.ratio,
        birthWindows: [...args.result.birthWindows],
        narration: args.narration as unknown as Prisma.InputJsonValue,
        narrationEngine: args.narration.engine,
        rules: {
          create: args.result.fired.map((item) => ({
            ruleId: item.rule.rule_id,
            category: item.rule.category,
            polarity: item.rule.polarity,
            effectiveWeight: item.effectiveWeight,
            reasons: [...item.reasons],
            shownToUser: args.visibleRuleIds.has(item.rule.rule_id),
          })),
        },
      },
      select: { id: true },
    });
    return reading.id;
  } catch (error) {
    console.error("[reading] persist failed:", error);
    return null;
  }
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

  const { features, tier, question, userName, categories, source } = sanitized.request;
  const userId = await resolveUserId(request);
  const guest = resolveGuest(request);
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

  const readingId = await persistReading({
    userId,
    guestKeyHash: guestKey(guest.token),
    tier,
    features,
    // A camera scan cannot be inferred from the bag, so the client declares it; anything else is derived.
    source: source ?? readingSource(features),
    question,
    result,
    narration,
    visibleRuleIds: new Set(visibleRules.map((item) => item.rule.rule_id)),
  });

  const response = NextResponse.json({
    readingId,
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

  if (guest.isNew) attachGuestCookie(response, guest.token);
  return response;
}
