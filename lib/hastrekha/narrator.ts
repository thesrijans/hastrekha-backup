import type { FiredRule, ReadingCluster, ReadingResult, RuleCategory } from "./types";

/* ------------------------------- Constants ------------------------------- */

export type ReadingTier = "free" | "premium" | "deep";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const DEFAULT_MODEL = "anthropic/claude-haiku-4.5";
const LLM_TIMEOUT_MS = 25_000;
const LLM_MAX_TOKENS = 1_800;
const LLM_TEMPERATURE = 0.4;
const DEVANAGARI_PATTERN = /[\u0900-\u097F]/;

/** Rules exposed to the narrator per tier (free = teaser only). */
const TIER_RULE_LIMIT: Readonly<Record<ReadingTier, number>> = { free: 3, premium: 24, deep: 40 };
const TIER_SECTION_LIMIT: Readonly<Record<ReadingTier, number>> = { free: 1, premium: 6, deep: 9 };

const CATEGORY_LABEL_HI: Readonly<Record<RuleCategory, string>> = {
  career: "Career aur Kaam",
  love: "Pyaar aur Rishte",
  wealth: "Paisa aur Samriddhi",
  personality: "Swabhav",
  vitality: "Urja aur Sehat",
  timing: "Samay aur Phase",
  travel: "Yatra",
  obstacles: "Rukawatein aur Unke Upay",
  children: "Santan",
  protection: "Suraksha",
  reading_method: "Padhne ka Tareeka",
};

const DISCLAIMER_HI_EN =
  "Yeh reading classical palmistry texts par aadharit self-reflection hai — medical, legal ya financial salah nahi. Sehat ke sawaal ke liye doctor se milein.";

/* --------------------------------- Types --------------------------------- */

export interface NarrationSection {
  readonly title: string;
  readonly body: string;
  readonly rule_ids: readonly string[];
}

export interface Narration {
  readonly one_liner: string;
  readonly sections: readonly NarrationSection[];
  readonly disclaimer: string;
  /** "llm" when the model produced it, "template" when the deterministic fallback was used */
  readonly engine: "llm" | "template";
  readonly model?: string;
}

export interface NarrateOptions {
  readonly tier: ReadingTier;
  /** The user's own question, if any ("career kab badlega?") */
  readonly question?: string;
  readonly userName?: string;
  readonly apiKey?: string;
  readonly model?: string;
  readonly signal?: AbortSignal;
  readonly fetchImpl?: typeof fetch;
}

/* ----------------------------- Prompt building ----------------------------- */

function ruleLine(item: FiredRule): string {
  const source = item.rule.sources[0];
  const loc = source ? `${source.text}, ${source.loc}` : "source n/a";
  return `- [${item.rule.rule_id}] (${item.rule.category}/${item.rule.polarity}, w=${item.effectiveWeight.toFixed(2)}) ${item.rule.interpretation_hi_en} — ${loc}`;
}

function selectRules(result: ReadingResult, tier: ReadingTier): readonly FiredRule[] {
  const limit = TIER_RULE_LIMIT[tier];
  // Highlights first, then the rest by effective weight; de-duplicate by rule_id.
  const ordered = [...result.highlights, ...result.fired];
  const seen = new Set<string>();
  const picked: FiredRule[] = [];
  for (const item of ordered) {
    if (seen.has(item.rule.rule_id)) continue;
    seen.add(item.rule.rule_id);
    picked.push(item);
    if (picked.length >= limit) break;
  }
  return picked;
}

/** The grounding contract: the model narrates ONLY the supplied rules and cites every paragraph. */
export function buildSystemPrompt(): string {
  return [
    "You are HastRekha AI's narrator. You write warm, direct Hinglish (Roman script ONLY — never Devanagari).",
    "HARD RULES:",
    "1. Use ONLY the rules provided. Do not add any palmistry claim, prediction, date, or event that is not in a rule.",
    "2. Every section must list the rule_ids it is built from. Never invent a rule_id.",
    "3. Never mention death, lifespan, disease names, suicide, insanity, criminality, or addiction — even if the user asks.",
    "4. Tone: agency-preserving. Tendencies and phases, not fixed fate. Use 'yeh sanket deta hai', 'aksar', 'favour karta hai'.",
    "5. If the user's question is not covered by the rules, say so plainly and point to what IS covered.",
    "6. When two different source books agree, say so explicitly — that is our proof layer.",
    "OUTPUT: strict JSON only, no markdown fences: {\"one_liner\": string, \"sections\": [{\"title\": string, \"body\": string, \"rule_ids\": string[]}]}",
  ].join("\n");
}

export function buildUserPrompt(result: ReadingResult, rules: readonly FiredRule[], options: NarrateOptions): string {
  const agreement = result.clusters
    .filter((cluster) => cluster.agreement > 1)
    .map((cluster) => `${cluster.category}/${cluster.polarity}: ${cluster.agreement} sources agree`)
    .join("; ");
  return [
    options.userName ? `User name: ${options.userName}` : "",
    options.question ? `User question: ${options.question}` : "User question: (none — give a general reading)",
    `Tier: ${options.tier}. Max sections: ${TIER_SECTION_LIMIT[options.tier]}. Reading depth (0-1): ${result.confidence}.`,
    result.birthWindows.length > 0 ? `Birth windows matched: ${result.birthWindows.join(", ")}` : "",
    agreement ? `Cross-source agreement: ${agreement}` : "",
    "RULES (the only facts you may use):",
    ...rules.map(ruleLine),
  ]
    .filter((line) => line !== "")
    .join("\n");
}

/* ------------------------------ Output validation ------------------------------ */

interface RawSection {
  readonly title?: unknown;
  readonly body?: unknown;
  readonly rule_ids?: unknown;
}

function parseNarration(text: string, allowedIds: ReadonlySet<string>, tier: ReadingTier): Pick<Narration, "one_liner" | "sections"> | null {
  const cleaned = text.replace(/```json|```/g, "").trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const record = parsed as { one_liner?: unknown; sections?: unknown };
  if (typeof record.one_liner !== "string" || !Array.isArray(record.sections)) return null;
  if (DEVANAGARI_PATTERN.test(record.one_liner)) return null;

  const sections: NarrationSection[] = [];
  for (const raw of record.sections as RawSection[]) {
    if (typeof raw.title !== "string" || typeof raw.body !== "string" || !Array.isArray(raw.rule_ids)) return null;
    if (DEVANAGARI_PATTERN.test(raw.title) || DEVANAGARI_PATTERN.test(raw.body)) return null;
    const ids = raw.rule_ids.filter((id): id is string => typeof id === "string" && allowedIds.has(id));
    if (ids.length === 0) return null; // uncited paragraph = ungrounded = reject
    sections.push({ title: raw.title, body: raw.body, rule_ids: ids });
  }
  if (sections.length === 0) return null;
  return { one_liner: record.one_liner, sections: sections.slice(0, TIER_SECTION_LIMIT[tier]) };
}

/* ------------------------------ Template fallback ------------------------------ */

function clusterBody(cluster: ReadingCluster, limit: number): string {
  return cluster.rules
    .slice(0, limit)
    .map((item) => item.rule.interpretation_hi_en)
    .join(" ");
}

/** Deterministic narration from clusters — used when the LLM is unavailable or ungrounded. */
export function templateNarration(result: ReadingResult, tier: ReadingTier): Narration {
  const sectionLimit = TIER_SECTION_LIMIT[tier];
  const perSection = tier === "free" ? 1 : 3;
  const sections: NarrationSection[] = result.clusters.slice(0, sectionLimit).map((cluster) => ({
    title: CATEGORY_LABEL_HI[cluster.category],
    body: clusterBody(cluster, perSection) + (cluster.agreement > 1 ? ` (${cluster.agreement} classical sources is baat par sehmat hain.)` : ""),
    rule_ids: cluster.rules.slice(0, perSection).map((item) => item.rule.rule_id),
  }));
  const top = result.highlights[0] ?? result.fired[0];
  return {
    one_liner: top ? top.rule.interpretation_hi_en : "Abhi itne features se poori reading nahi ban paayi — palm scan add karein.",
    sections,
    disclaimer: DISCLAIMER_HI_EN,
    engine: "template",
  };
}

/* ----------------------------------- API ----------------------------------- */

/** Runtime-agnostic env lookup (Node, Edge, tests). Routes should pass apiKey explicitly. */
function readEnv(name: string): string | undefined {
  const runtime = globalThis as { process?: { env?: Record<string, string | undefined> } };
  return runtime.process?.env?.[name];
}

interface OpenRouterResponse {
  readonly choices?: ReadonlyArray<{ readonly message?: { readonly content?: unknown } }>;
}

/**
 * Narrate an engine result. Falls back to the template on any failure (network, parse, ungrounded output).
 * Never throws for LLM-side problems; throws only on programmer error (no rules at all).
 */
export async function narrateReading(result: ReadingResult, options: NarrateOptions): Promise<Narration> {
  const rules = selectRules(result, options.tier);
  if (rules.length === 0) return templateNarration(result, options.tier);

  const apiKey = options.apiKey ?? readEnv("OPENROUTER_API_KEY");
  if (!apiKey) return templateNarration(result, options.tier);

  const model = options.model ?? readEnv("OPENROUTER_MODEL") ?? DEFAULT_MODEL;
  const fetchImpl = options.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), LLM_TIMEOUT_MS);
  const onOuterAbort = (): void => controller.abort();
  options.signal?.addEventListener("abort", onOuterAbort, { once: true });

  try {
    const response = await fetchImpl(OPENROUTER_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        max_tokens: LLM_MAX_TOKENS,
        temperature: LLM_TEMPERATURE,
        messages: [
          { role: "system", content: buildSystemPrompt() },
          { role: "user", content: buildUserPrompt(result, rules, options) },
        ],
      }),
      signal: controller.signal,
    });
    if (!response.ok) return templateNarration(result, options.tier);
    const payload = (await response.json()) as OpenRouterResponse;
    const content = payload.choices?.[0]?.message?.content;
    if (typeof content !== "string") return templateNarration(result, options.tier);

    const allowed = new Set(rules.map((item) => item.rule.rule_id));
    const parsed = parseNarration(content, allowed, options.tier);
    if (!parsed) return templateNarration(result, options.tier);
    return { ...parsed, disclaimer: DISCLAIMER_HI_EN, engine: "llm", model };
  } catch {
    return templateNarration(result, options.tier);
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener("abort", onOuterAbort);
  }
}
