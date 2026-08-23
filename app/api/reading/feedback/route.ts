import { NextResponse, type NextRequest } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { guestKey, resolveGuest } from "@/lib/auth/guest";
import { checkRateLimit } from "@/lib/hastrekha/rate-limit";
import { clientIp } from "@/lib/http";
import { db } from "@/lib/db";
import type { FeedbackVerdict } from "@/lib/generated/prisma/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_REQUESTS = 30;
const MAX_RULE_IDS = 40;
const MAX_NOTE_CHARS = 500;
const RULE_ID = /^[A-Z0-9-]{3,40}$/;
const VERDICTS: ReadonlySet<string> = new Set<FeedbackVerdict>(["ACCURATE", "PARTLY", "WRONG"]);

interface FeedbackBody {
  readonly readingId: string;
  readonly ruleIds: readonly string[];
  readonly verdict: FeedbackVerdict;
  readonly note?: string;
}

type ParseOutcome = { readonly ok: true; readonly body: FeedbackBody } | { readonly ok: false; readonly error: string };

function parseBody(raw: unknown): ParseOutcome {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return { ok: false, error: "body must be an object" };
  const body = raw as Record<string, unknown>;

  const readingId = body.readingId;
  if (typeof readingId !== "string" || readingId === "" || readingId.length > 40) return { ok: false, error: "readingId required" };

  const verdict = body.verdict;
  if (typeof verdict !== "string" || !VERDICTS.has(verdict)) return { ok: false, error: "verdict must be ACCURATE, PARTLY or WRONG" };

  if (!Array.isArray(body.ruleIds)) return { ok: false, error: "ruleIds must be an array" };
  const ruleIds = [...new Set(body.ruleIds.filter((id): id is string => typeof id === "string" && RULE_ID.test(id)))].slice(0, MAX_RULE_IDS);
  if (ruleIds.length === 0) return { ok: false, error: "no valid ruleIds" };

  const note = typeof body.note === "string" ? body.note.trim().slice(0, MAX_NOTE_CHARS) : undefined;

  return { ok: true, body: { readingId, ruleIds, verdict: verdict as FeedbackVerdict, note: note || undefined } };
}

/**
 * POST /api/reading/feedback — per-section thumbs, one row per rule the section cited.
 *
 * Ownership is checked before anything is written: the reading must belong to the signed-in user, or
 * to the `hr_guest` cookie the browser is carrying. Without that, anyone with a reading id could
 * poison the calibration that `RuleStat` derives from these rows.
 *
 * Upsert, not create: changing your mind about a section overwrites the earlier verdict rather than
 * erroring on the `[readingId, ruleId]` unique index.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const limit = checkRateLimit(`feedback:${clientIp(request)}`, RATE_LIMIT_MAX_REQUESTS, RATE_LIMIT_WINDOW_MS);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Thoda ruk jao — bahut requests ho gayi." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
    );
  }

  let rawJson: unknown;
  try {
    rawJson = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }

  const parsed = parseBody(rawJson);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const { readingId, ruleIds, verdict, note } = parsed.body;

  const user = await getSessionUser(request);
  const guest = resolveGuest(request);

  try {
    const reading = await db.reading.findUnique({
      where: { id: readingId },
      select: { id: true, userId: true, guestKey: true },
    });
    // Same 404 for "no such reading" and "not yours" — do not confirm that an id exists.
    if (reading === null) return NextResponse.json({ error: "reading not found" }, { status: 404 });

    const ownedByUser = user !== null && reading.userId === user.id;
    const ownedByGuest = !guest.isNew && reading.guestKey === guestKey(guest.token);
    if (!ownedByUser && !ownedByGuest) return NextResponse.json({ error: "reading not found" }, { status: 404 });

    await db.$transaction(
      ruleIds.map((ruleId) =>
        db.ruleFeedback.upsert({
          where: { readingId_ruleId: { readingId, ruleId } },
          create: { readingId, ruleId, userId: user?.id ?? null, verdict, note },
          update: { verdict, note },
        }),
      ),
    );

    return NextResponse.json({ ok: true, recorded: ruleIds.length });
  } catch (error) {
    console.error("[feedback] write failed:", error);
    return NextResponse.json({ error: "could not save feedback" }, { status: 503 });
  }
}
