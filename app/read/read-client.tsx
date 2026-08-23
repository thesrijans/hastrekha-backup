"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";

/* ------------------------------ API contract ------------------------------ */

interface PublicRule {
  readonly rule_id: string;
  readonly category: string;
  readonly polarity: string;
  readonly interpretation_hi_en: string;
  readonly weight: number;
  readonly source: string;
  readonly tags: readonly string[];
}

interface NarrationSection {
  readonly title: string;
  readonly body: string;
  readonly rule_ids: readonly string[];
}

interface Narration {
  readonly one_liner: string;
  readonly sections: readonly NarrationSection[];
  readonly disclaimer: string;
  readonly engine: "llm" | "template";
}

interface ReadingResponse {
  readonly readingId: string | null;
  readonly narration: Narration;
  readonly rules: readonly PublicRule[];
  readonly lockedRuleCount: number;
  readonly confidence: number;
  readonly coverage: {
    readonly provided: readonly string[];
    readonly missing: readonly string[];
    readonly ratio: number;
  };
}

/* -------------------------------- Constants ------------------------------- */

/** Anchored pricing shown on the upgrade card. Nothing is purchasable yet. */
const PRICE_ANCHOR_INR = 199;
const PRICE_NOW_INR = 99;

const MIN_BIRTH_DATE = "1920-01-01";
const MAX_QUESTION_CHARS = 500;
const NEUTRAL_MOUNT = 0.5;

const MOUNTS: ReadonlyArray<{ readonly key: string; readonly label: string; readonly helper: string }> = [
  { key: "jupiter", label: "Jupiter", helper: "Index finger ke neeche ka tekra — mahatvakanksha aur netritva." },
  { key: "saturn", label: "Saturn", helper: "Middle finger ke neeche — gambhirta, dhairya, akelapan." },
  { key: "sun", label: "Sun (Apollo)", helper: "Ring finger ke neeche — kala, pehchaan, chamak." },
  { key: "mercury", label: "Mercury", helper: "Chhoti ungli ke neeche — baat-cheet, business, chaturai." },
  { key: "moon", label: "Moon (Luna)", helper: "Hatheli ka bahari-neecha hissa — kalpana aur safar." },
  { key: "venus", label: "Venus", helper: "Angoothe ke neeche ka gadda — pyaar, urja, garmahat." },
];

const HAND_SHAPES: ReadonlyArray<{ readonly value: string; readonly label: string }> = [
  { value: "elementary", label: "Elementary — moti, kadak hatheli" },
  { value: "square", label: "Square — chaukor hatheli aur ungliyan" },
  { value: "spatulate", label: "Spatulate — ek sire par chaudi" },
  { value: "philosophic", label: "Philosophic — lambi, gaanth-daar ungliyan" },
  { value: "conic", label: "Conic — nukeeli, komal ungliyan" },
  { value: "psychic", label: "Psychic — patli, lambi, naazuk" },
  { value: "mixed", label: "Mixed — ek jaisi nahi" },
];

type Verdict = "ACCURATE" | "PARTLY" | "WRONG";

const VERDICTS: ReadonlyArray<{ readonly value: Verdict; readonly label: string }> = [
  { value: "ACCURATE", label: "Accurate" },
  { value: "PARTLY", label: "Partly" },
  { value: "WRONG", label: "Wrong" },
];

/* --------------------------------- State ---------------------------------- */

type Phase =
  | { readonly status: "idle" }
  | { readonly status: "loading" }
  | { readonly status: "error"; readonly message: string }
  | { readonly status: "done"; readonly reading: ReadingResponse };

type FeedbackState =
  | { readonly status: "saving" }
  | { readonly status: "done"; readonly verdict: Verdict }
  | { readonly status: "error" };

interface ReadingPayload {
  readonly tier: "free";
  readonly features: Record<string, unknown>;
  readonly question?: string;
  readonly userName?: string;
}

function todayIso(): string {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

/** "Today" never changes underneath us mid-session, so there is nothing to subscribe to. */
const noSubscribe = (): (() => void) => () => {};

const inputClass =
  "w-full rounded-lg border border-black/15 bg-transparent px-3 py-2 text-base outline-none focus:border-black/40 dark:border-white/20 dark:focus:border-white/50";

export function ReadClient() {
  /* Step 1 */
  const [birthDate, setBirthDate] = useState("");
  const [userName, setUserName] = useState("");
  const [question, setQuestion] = useState("");

  /* Step 2 (optional) */
  const [palmOpen, setPalmOpen] = useState(false);
  const [mounts, setMounts] = useState<Record<string, number>>(() =>
    Object.fromEntries(MOUNTS.map((mount) => [mount.key, NEUTRAL_MOUNT])),
  );
  const [handShape, setHandShape] = useState("");
  const [headQuality, setHeadQuality] = useState(NEUTRAL_MOUNT);

  const [formError, setFormError] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>({ status: "idle" });
  const [feedback, setFeedback] = useState<Record<number, FeedbackState>>({});
  /**
   * The server's "today" and the browser's "today" disagree across timezones, so rendering it during
   * SSR would be a hydration mismatch. `useSyncExternalStore` is React's answer to exactly that: the
   * server snapshot is empty (no `max` attribute) and the client fills it in on hydration.
   */
  const maxBirthDate = useSyncExternalStore(noSubscribe, todayIso, () => "");

  const isMountedRef = useRef(true);
  const abortRef = useRef<AbortController | null>(null);
  const lastPayloadRef = useRef<ReadingPayload | null>(null);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      abortRef.current?.abort();
    };
  }, []);

  const runReading = useCallback(async (payload: ReadingPayload) => {
    // A second submit supersedes the first, so the stale response must never overwrite the new one.
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    lastPayloadRef.current = payload;
    setFeedback({});
    setPhase({ status: "loading" });

    try {
      const response = await fetch("/api/reading", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      if (!isMountedRef.current || controller.signal.aborted) return;

      if (!response.ok) {
        const detail = (await response.json().catch(() => null)) as { error?: string } | null;
        if (!isMountedRef.current || controller.signal.aborted) return;
        setPhase({ status: "error", message: detail?.error ?? `Reading nahi ban payi (${response.status}).` });
        return;
      }

      const reading = (await response.json()) as ReadingResponse;
      if (!isMountedRef.current || controller.signal.aborted) return;
      setPhase({ status: "done", reading });
    } catch {
      if (!isMountedRef.current || controller.signal.aborted) return;
      setPhase({ status: "error", message: "Network thoda dagmaga gaya. Dobara try karo." });
    }
  }, []);

  const onSubmit = useCallback(
    (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (birthDate === "") {
        setFormError("Date of birth zaroori hai — reading wahi se shuru hoti hai.");
        return;
      }
      if (birthDate < MIN_BIRTH_DATE || (maxBirthDate !== "" && birthDate > maxBirthDate)) {
        setFormError("Date of birth 1920 ke baad aur aaj se pehle honi chahiye.");
        return;
      }
      setFormError(null);

      const features: Record<string, unknown> = { user: { birth_date: birthDate } };
      if (palmOpen) {
        features.mounts = { ...mounts };
        features.lines = { head: { quality: headQuality } };
        if (handShape !== "") features.hand = { shape: handShape };
      }

      void runReading({
        tier: "free",
        features,
        question: question.trim() === "" ? undefined : question.trim(),
        userName: userName.trim() === "" ? undefined : userName.trim(),
      });
    },
    [birthDate, maxBirthDate, palmOpen, mounts, headQuality, handShape, question, userName, runReading],
  );

  const retry = useCallback(() => {
    const payload = lastPayloadRef.current;
    if (payload !== null) void runReading(payload);
  }, [runReading]);

  const sendFeedback = useCallback(
    async (readingId: string, sectionIndex: number, ruleIds: readonly string[], verdict: Verdict) => {
      setFeedback((previous) => ({ ...previous, [sectionIndex]: { status: "saving" } }));
      try {
        const response = await fetch("/api/reading/feedback", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ readingId, ruleIds, verdict }),
        });
        if (!isMountedRef.current) return;
        setFeedback((previous) => ({
          ...previous,
          [sectionIndex]: response.ok ? { status: "done", verdict } : { status: "error" },
        }));
      } catch {
        if (isMountedRef.current) setFeedback((previous) => ({ ...previous, [sectionIndex]: { status: "error" } }));
      }
    },
    [],
  );

  return (
    <div className="flex flex-col gap-12">
      <form onSubmit={onSubmit} className="flex flex-col gap-8" noValidate>
        {/* ------------------------------- Step 1 ------------------------------- */}
        <fieldset className="flex flex-col gap-5 rounded-xl border border-black/10 p-5 dark:border-white/15">
          <legend className="px-2 text-lg font-semibold">Step 1 — DOB se shuru karo</legend>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="birthDate" className="text-sm font-medium">
              Date of birth <span aria-hidden="true">*</span>
            </label>
            <input
              id="birthDate"
              name="birthDate"
              type="date"
              required
              min={MIN_BIRTH_DATE}
              max={maxBirthDate === "" ? undefined : maxBirthDate}
              value={birthDate}
              onChange={(event) => setBirthDate(event.target.value)}
              aria-describedby="birthDate-help"
              className={inputClass}
            />
            <p id="birthDate-help" className="text-xs text-black/55 dark:text-white/55">
              Format YYYY-MM-DD. Sirf isse bhi ek poori reading ban jaati hai.
            </p>
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="userName" className="text-sm font-medium">
              Naam <span className="font-normal text-black/50 dark:text-white/50">(optional)</span>
            </label>
            <input
              id="userName"
              name="userName"
              type="text"
              maxLength={60}
              value={userName}
              onChange={(event) => setUserName(event.target.value)}
              className={inputClass}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="question" className="text-sm font-medium">
              Koi sawaal? <span className="font-normal text-black/50 dark:text-white/50">(optional)</span>
            </label>
            <textarea
              id="question"
              name="question"
              rows={3}
              maxLength={MAX_QUESTION_CHARS}
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              aria-describedby="question-count"
              className={`${inputClass} resize-y`}
            />
            <p id="question-count" aria-live="polite" className="text-xs text-black/55 dark:text-white/55">
              {question.length} / {MAX_QUESTION_CHARS}
            </p>
          </div>
        </fieldset>

        {/* ------------------------------- Step 2 ------------------------------- */}
        <fieldset className="flex flex-col gap-5 rounded-xl border border-black/10 p-5 dark:border-white/15">
          <legend className="px-2 text-lg font-semibold">Step 2 — Hatheli ke baare mein batao (optional)</legend>

          <button
            type="button"
            onClick={() => setPalmOpen((open) => !open)}
            aria-expanded={palmOpen}
            aria-controls="palm-details"
            className="self-start rounded-full border border-black/15 px-4 py-2 text-sm font-medium hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/10"
          >
            {palmOpen ? "Palm details hata do" : "Palm details bharo — reading gehri hogi"}
          </button>

          <div id="palm-details" hidden={!palmOpen} className="flex flex-col gap-6">
            {MOUNTS.map((mount) => (
              <div key={mount.key} className="flex flex-col gap-1.5">
                <label htmlFor={`mount-${mount.key}`} className="flex items-baseline justify-between text-sm font-medium">
                  <span>{mount.label} mount</span>
                  <span className="tabular-nums text-black/55 dark:text-white/55">{mounts[mount.key].toFixed(2)}</span>
                </label>
                <input
                  id={`mount-${mount.key}`}
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={mounts[mount.key]}
                  onChange={(event) =>
                    setMounts((previous) => ({ ...previous, [mount.key]: Number(event.target.value) }))
                  }
                  aria-describedby={`mount-${mount.key}-help`}
                  className="w-full"
                />
                <p id={`mount-${mount.key}-help`} className="text-xs text-black/55 dark:text-white/55">
                  {mount.helper} 0 = bilkul flat, 1 = saaf ubhra hua.
                </p>
              </div>
            ))}

            <div className="flex flex-col gap-1.5">
              <label htmlFor="handShape" className="text-sm font-medium">
                Hand shape
              </label>
              <select
                id="handShape"
                value={handShape}
                onChange={(event) => setHandShape(event.target.value)}
                className={inputClass}
              >
                <option value="">Pata nahi — chhod do</option>
                {HAND_SHAPES.map((shape) => (
                  <option key={shape.value} value={shape.value}>
                    {shape.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex flex-col gap-1.5">
              <label htmlFor="headQuality" className="flex items-baseline justify-between text-sm font-medium">
                <span>Head line quality</span>
                <span className="tabular-nums text-black/55 dark:text-white/55">{headQuality.toFixed(2)}</span>
              </label>
              <input
                id="headQuality"
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={headQuality}
                onChange={(event) => setHeadQuality(Number(event.target.value))}
                aria-describedby="headQuality-help"
                className="w-full"
              />
              <p id="headQuality-help" className="text-xs text-black/55 dark:text-white/55">
                Hatheli ke beech se jaati line. 0 = tootti, dhundhli. 1 = saaf, gehri, seedhi.
              </p>
            </div>
          </div>
        </fieldset>

        {formError !== null ? (
          <p
            role="alert"
            className="rounded-lg border border-red-600/30 bg-red-600/10 px-4 py-3 text-sm text-red-900 dark:text-red-200"
          >
            {formError}
          </p>
        ) : null}

        <button
          type="submit"
          disabled={phase.status === "loading"}
          className="flex h-12 items-center justify-center rounded-full bg-foreground px-8 text-base font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {phase.status === "loading" ? "Reading ban rahi hai…" : "Free reading dekho"}
        </button>
      </form>

      {/* -------------------------------- Result -------------------------------- */}
      <section aria-live="polite" aria-busy={phase.status === "loading"} className="flex flex-col gap-6">
        {phase.status === "loading" ? <ReadingSkeleton /> : null}

        {phase.status === "error" ? (
          <div role="alert" className="flex flex-col items-start gap-4 rounded-xl border border-red-600/30 bg-red-600/10 p-5">
            <p className="text-base text-red-900 dark:text-red-200">{phase.message}</p>
            <button
              type="button"
              onClick={retry}
              className="rounded-full border border-red-600/40 px-4 py-2 text-sm font-medium text-red-900 hover:bg-red-600/10 dark:text-red-200"
            >
              Dobara try karo
            </button>
          </div>
        ) : null}

        {phase.status === "done" ? (
          <ReadingView reading={phase.reading} feedback={feedback} onFeedback={sendFeedback} />
        ) : null}
      </section>
    </div>
  );
}

/* -------------------------------- Subviews -------------------------------- */

function ReadingSkeleton() {
  return (
    <div className="flex flex-col gap-4" aria-hidden="true">
      <div className="h-24 animate-pulse rounded-xl bg-black/10 dark:bg-white/10" />
      <div className="h-40 animate-pulse rounded-xl bg-black/10 dark:bg-white/10" />
      <div className="h-40 animate-pulse rounded-xl bg-black/10 dark:bg-white/10" />
    </div>
  );
}

function ReadingView({
  reading,
  feedback,
  onFeedback,
}: {
  readonly reading: ReadingResponse;
  readonly feedback: Record<number, FeedbackState>;
  readonly onFeedback: (
    readingId: string,
    sectionIndex: number,
    ruleIds: readonly string[],
    verdict: Verdict,
  ) => Promise<void>;
}) {
  const rulesById = useMemo(
    () => new Map(reading.rules.map((rule) => [rule.rule_id, rule] as const)),
    [reading.rules],
  );
  const depthPercent = Math.round(reading.confidence * 100);
  const missingCount = reading.coverage.missing.length;
  const { readingId } = reading;

  return (
    <div className="flex flex-col gap-6">
      <article className="rounded-xl border border-black/10 bg-black/[.03] p-6 dark:border-white/15 dark:bg-white/[.04]">
        <h2 className="text-xl font-semibold leading-8 sm:text-2xl">{reading.narration.one_liner}</h2>
      </article>

      <div className="flex flex-col gap-2">
        <div className="flex items-baseline justify-between text-sm">
          <span className="font-medium">Reading depth</span>
          <span className="tabular-nums text-black/60 dark:text-white/60">{depthPercent}%</span>
        </div>
        <div
          role="progressbar"
          aria-valuenow={depthPercent}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Reading depth"
          className="h-2 w-full overflow-hidden rounded-full bg-black/10 dark:bg-white/15"
        >
          <div className="h-full rounded-full bg-foreground" style={{ width: `${depthPercent}%` }} />
        </div>
      </div>

      {reading.narration.sections.map((section, index) => {
        const state = feedback[index];
        return (
          <article
            key={`${section.title}-${index}`}
            className="flex flex-col gap-3 rounded-xl border border-black/10 p-5 dark:border-white/15"
          >
            <h3 className="text-lg font-semibold">{section.title}</h3>
            <p className="text-base leading-7 text-black/80 dark:text-white/80">{section.body}</p>

            {section.rule_ids.length > 0 ? (
              <ul className="flex flex-wrap gap-2">
                {section.rule_ids.map((ruleId) => {
                  const rule = rulesById.get(ruleId);
                  if (rule === undefined || rule.source === "") return null;
                  return (
                    <li
                      key={ruleId}
                      className="rounded-full border border-black/10 px-3 py-1 text-xs text-black/60 dark:border-white/15 dark:text-white/60"
                    >
                      Source: {rule.source}
                    </li>
                  );
                })}
              </ul>
            ) : null}

            {readingId !== null ? (
              <div className="flex flex-wrap items-center gap-2 border-t border-black/10 pt-3 dark:border-white/15">
                <span id={`verdict-${index}`} className="text-xs text-black/55 dark:text-white/55">
                  Yeh kitna sahi laga?
                </span>
                {VERDICTS.map((option) => {
                  const chosen = state?.status === "done" && state.verdict === option.value;
                  return (
                    <button
                      key={option.value}
                      type="button"
                      aria-describedby={`verdict-${index}`}
                      aria-pressed={chosen}
                      disabled={state?.status === "saving"}
                      onClick={() => void onFeedback(readingId, index, section.rule_ids, option.value)}
                      className={`rounded-full border px-3 py-1 text-xs font-medium disabled:opacity-50 ${
                        chosen
                          ? "border-transparent bg-foreground text-background"
                          : "border-black/15 hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/10"
                      }`}
                    >
                      {option.label}
                    </button>
                  );
                })}
                {state?.status === "saving" ? (
                  <span className="text-xs text-black/55 dark:text-white/55">Save ho raha hai…</span>
                ) : null}
                {state?.status === "done" ? (
                  <span className="text-xs text-black/55 dark:text-white/55">Shukriya.</span>
                ) : null}
                {state?.status === "error" ? (
                  <span role="alert" className="text-xs text-red-700 dark:text-red-300">
                    Save nahi hua — dobara try karo.
                  </span>
                ) : null}
              </div>
            ) : null}
          </article>
        );
      })}

      {missingCount > 0 ? (
        <article className="flex flex-col items-start gap-3 rounded-xl border border-dashed border-black/20 p-5 dark:border-white/25">
          <h3 className="text-lg font-semibold">Palm scan se +{missingCount} features unlock</h3>
          <p className="text-sm leading-6 text-black/65 dark:text-white/65">
            Tumhari hatheli ka scan {missingCount} aur features bhar dega — reading utni hi gehri hoti jaayegi. Scan
            tumhare device par hi chalega.
          </p>
          <button
            type="button"
            disabled
            className="cursor-not-allowed rounded-full border border-black/15 px-4 py-2 text-sm font-medium opacity-60 dark:border-white/20"
          >
            Palm scan — coming soon
          </button>
        </article>
      ) : null}

      {reading.lockedRuleCount > 0 ? (
        <article className="flex flex-col items-start gap-3 rounded-xl border border-black/15 bg-black/[.03] p-5 dark:border-white/20 dark:bg-white/[.04]">
          <h3 className="text-lg font-semibold">{reading.lockedRuleCount} aur rules tumhare liye nikle hain</h3>
          <p className="text-sm leading-6 text-black/65 dark:text-white/65">
            Premium reading mein har category khulti hai — career, rishte, paisa, timing — har baat ke source ke saath.
          </p>
          <p className="text-base">
            <s className="text-black/45 dark:text-white/45">₹{PRICE_ANCHOR_INR}</s>{" "}
            <span className="text-xl font-semibold">₹{PRICE_NOW_INR}</span>
          </p>
          <button
            type="button"
            disabled
            className="cursor-not-allowed rounded-full bg-foreground px-4 py-2 text-sm font-medium text-background opacity-60"
          >
            Premium — coming soon
          </button>
        </article>
      ) : null}

      <p className="text-xs leading-6 text-black/55 dark:text-white/55">
        {reading.narration.disclaimer}{" "}
        <Link href="/terms" className="underline underline-offset-4">
          Terms
        </Link>
        .
      </p>
    </div>
  );
}
