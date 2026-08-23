"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { HoloPalm } from "@/components/holo-palm";
import { emptyMounts, levelForValue, MOUNT_LEVELS, MOUNTS } from "@/components/palm-geometry";
import { ReadingView } from "./reading-view";
import type { FeedbackState, ReadingPayload, ReadingResponse, Verdict } from "./reading-types";

const MIN_BIRTH_DATE = "1920-01-01";
const MAX_QUESTION_CHARS = 500;
const DEFAULT_HEAD_QUALITY = 0.45;

const HAND_SHAPES: ReadonlyArray<{ readonly value: string; readonly label: string }> = [
  { value: "elementary", label: "Elementary — moti, kadak hatheli" },
  { value: "square", label: "Square — chaukor hatheli aur ungliyan" },
  { value: "spatulate", label: "Spatulate — ek sire par chaudi" },
  { value: "philosophic", label: "Philosophic — lambi, gaanth-daar ungliyan" },
  { value: "conic", label: "Conic — nukeeli, komal ungliyan" },
  { value: "psychic", label: "Psychic — patli, lambi, naazuk" },
  { value: "mixed", label: "Mixed — ek jaisi nahi" },
];

/** Same 0–1 scale as the mounts, described the way a head line actually looks. */
const HEAD_LEVELS: ReadonlyArray<{ readonly id: string; readonly label: string; readonly value: number }> = [
  { id: "faint", label: "Dhundhli", value: 0.15 },
  { id: "normal", label: "Normal", value: 0.45 },
  { id: "clear", label: "Saaf", value: 0.72 },
  { id: "deep", label: "Gehri", value: 0.95 },
];

const STEPS: readonly string[] = ["Janam", "Mounts", "Hatheli", "Sawaal", "Scan"];
const RESULT_STEP = STEPS.length - 1;

type Phase =
  | { readonly status: "idle" }
  | { readonly status: "loading" }
  | { readonly status: "error"; readonly message: string }
  | { readonly status: "done"; readonly reading: ReadingResponse };

function todayIso(): string {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

/** "Today" cannot change under us mid-session, so there is nothing to subscribe to. */
const noSubscribe = (): (() => void) => () => {};

const fieldClass =
  "w-full rounded-lg border border-hairline bg-surface px-3 py-2.5 text-base text-ink outline-none transition-colors focus:border-mount-glow";

function chipClass(active: boolean): string {
  return [
    "rounded-full border px-4 py-2 font-display text-sm font-medium tracking-tight transition-colors",
    active
      ? "border-mount-glow bg-mount-glow/12 text-mount-glow"
      : "border-hairline text-muted hover:border-mount-glow/50 hover:text-ink",
  ].join(" ");
}

export function ReadClient() {
  const reduced = useReducedMotion() ?? false;

  const [step, setStep] = useState(0);
  const [birthDate, setBirthDate] = useState("");
  const [userName, setUserName] = useState("");
  const [question, setQuestion] = useState("");

  /**
   * Palm data is opt-in by touch, not by checkbox: picking any level flips this on. Leaving the palm
   * steps untouched keeps the reading honestly DOB-only, and coverage reports it that way.
   */
  const [palmTouched, setPalmTouched] = useState(false);
  const [mounts, setMounts] = useState<Record<string, number>>(() => emptyMounts());
  const [selectedMount, setSelectedMount] = useState<string>(MOUNTS[0].key);
  const [handShape, setHandShape] = useState("");
  const [headQuality, setHeadQuality] = useState(DEFAULT_HEAD_QUALITY);

  const [formError, setFormError] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>({ status: "idle" });
  const [feedback, setFeedback] = useState<Record<number, FeedbackState>>({});

  /**
   * The server's "today" and the browser's "today" disagree across timezones, so rendering it during
   * SSR would be a hydration mismatch. `useSyncExternalStore` is React's answer: the server snapshot
   * is empty (no `max` attribute) and the client fills it in on hydration.
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

  const buildPayload = useCallback((): ReadingPayload => {
    const features: Record<string, unknown> = { user: { birth_date: birthDate } };
    if (palmTouched) {
      features.mounts = { ...mounts };
      features.lines = { head: { quality: headQuality } };
      if (handShape !== "") features.hand = { shape: handShape };
    }
    return {
      tier: "free",
      features,
      question: question.trim() === "" ? undefined : question.trim(),
      userName: userName.trim() === "" ? undefined : userName.trim(),
    };
  }, [birthDate, palmTouched, mounts, headQuality, handShape, question, userName]);

  const validateBirthDate = useCallback((): boolean => {
    if (birthDate === "") {
      setFormError("Date of birth zaroori hai — scan wahi se shuru hota hai.");
      return false;
    }
    if (birthDate < MIN_BIRTH_DATE || (maxBirthDate !== "" && birthDate > maxBirthDate)) {
      setFormError("Date of birth 1920 ke baad aur aaj se pehle honi chahiye.");
      return false;
    }
    setFormError(null);
    return true;
  }, [birthDate, maxBirthDate]);

  const setMountLevel = useCallback((key: string, value: number) => {
    setPalmTouched(true);
    setMounts((previous) => ({ ...previous, [key]: value }));
  }, []);

  const goNext = useCallback(() => {
    if (step === 0 && !validateBirthDate()) return;
    if (step === RESULT_STEP - 1) {
      setStep(RESULT_STEP);
      void runReading(buildPayload());
      return;
    }
    setStep((current) => Math.min(RESULT_STEP, current + 1));
  }, [step, validateBirthDate, runReading, buildPayload]);

  const goBack = useCallback(() => {
    setFormError(null);
    setStep((current) => Math.max(0, current - 1));
  }, []);

  const restart = useCallback(() => {
    abortRef.current?.abort();
    setPhase({ status: "idle" });
    setFeedback({});
    setStep(0);
  }, []);

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

  const selectedSpec = MOUNTS.find((mount) => mount.key === selectedMount) ?? MOUNTS[0];
  const selectedLevel = levelForValue(mounts[selectedSpec.key] ?? 0);

  /** Reduced motion drops the travel and duration but keeps the same mount/unmount structure. */
  const slide = {
    initial: reduced ? { opacity: 0 } : { opacity: 0, x: 24 },
    animate: reduced ? { opacity: 1 } : { opacity: 1, x: 0 },
    exit: reduced ? { opacity: 0 } : { opacity: 0, x: -24 },
    transition: { duration: reduced ? 0 : 0.26, ease: [0.32, 0.72, 0, 1] as const },
  };

  return (
    <div className="flex flex-col gap-8">
      {/* ------------------------------ Progress HUD ----------------------------- */}
      <div className="flex flex-col gap-3">
        <div className="flex items-baseline justify-between font-display text-xs uppercase tracking-[0.22em]">
          <span className="text-mount-glow">
            {`STEP ${String(step + 1).padStart(2, "0")} / ${String(STEPS.length).padStart(2, "0")}`}
          </span>
          <span className="text-muted">{STEPS[step]}</span>
        </div>
        <div
          role="progressbar"
          aria-valuenow={step + 1}
          aria-valuemin={1}
          aria-valuemax={STEPS.length}
          aria-label={`Step ${step + 1} of ${STEPS.length}: ${STEPS[step]}`}
          className="flex gap-1.5"
        >
          {STEPS.map((label, index) => (
            <motion.span
              key={label}
              aria-hidden="true"
              className={`h-0.5 flex-1 rounded-full ${index <= step ? "bg-mount-glow" : "bg-hairline"}`}
              initial={false}
              animate={{ opacity: index <= step ? 1 : 0.6 }}
              transition={{ duration: reduced ? 0 : 0.3 }}
            />
          ))}
        </div>
      </div>

      {/* --------------------------------- Steps --------------------------------- */}
      <AnimatePresence mode="wait" initial={false}>
        {step === 0 ? (
          <motion.section key="step-dob" {...slide} aria-labelledby="step-dob-heading" className="flex flex-col gap-6">
            <div className="flex flex-col gap-2">
              <h2 id="step-dob-heading" className="font-display text-2xl font-semibold tracking-tight text-ink">
                Kab paida hue the?
              </h2>
              <p className="text-sm leading-6 text-muted">
                Sirf isse bhi ek poori reading ban jaati hai — birth-window rules turant lag jaate hain.
              </p>
            </div>

            <div className="flex flex-col gap-1.5">
              <label htmlFor="birthDate" className="font-display text-sm font-medium text-ink">
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
                className={fieldClass}
              />
              <p id="birthDate-help" className="text-xs text-muted">
                Format YYYY-MM-DD.
              </p>
            </div>

            <div className="flex flex-col gap-1.5">
              <label htmlFor="userName" className="font-display text-sm font-medium text-ink">
                Naam <span className="font-normal text-muted">(optional)</span>
              </label>
              <input
                id="userName"
                name="userName"
                type="text"
                maxLength={60}
                value={userName}
                onChange={(event) => setUserName(event.target.value)}
                className={fieldClass}
              />
            </div>
          </motion.section>
        ) : null}

        {step === 1 ? (
          <motion.section key="step-mounts" {...slide} aria-labelledby="step-mounts-heading" className="flex flex-col gap-6">
            <div className="flex flex-col gap-2">
              <h2 id="step-mounts-heading" className="font-display text-2xl font-semibold tracking-tight text-ink">
                Mounts scan karo
              </h2>
              <p className="text-sm leading-6 text-muted">
                Optional — chhod bhi sakte ho. Palm par mount tap karo, phir uska ubhaar chuno.
              </p>
            </div>

            <div className="grid gap-8 md:grid-cols-2">
              <HoloPalm
                mounts={mounts}
                interactive
                selected={selectedMount}
                onSelectMount={setSelectedMount}
              />

              <div className="flex flex-col gap-5">
                <fieldset className="flex flex-col gap-3">
                  <legend className="font-display text-sm font-medium uppercase tracking-[0.18em] text-mount-glow">
                    {selectedSpec.label}
                  </legend>
                  <p className="text-sm leading-6 text-muted">{selectedSpec.helper}</p>
                  <div className="flex flex-wrap gap-2" role="group" aria-label={`${selectedSpec.label} mount kitna ubhra hai`}>
                    {MOUNT_LEVELS.map((level) => {
                      const active = palmTouched && selectedLevel.id === level.id;
                      return (
                        <button
                          key={level.id}
                          type="button"
                          aria-pressed={active}
                          onClick={() => setMountLevel(selectedSpec.key, level.value)}
                          className={chipClass(active)}
                        >
                          {level.label}
                        </button>
                      );
                    })}
                  </div>
                </fieldset>

                <p className="border-t border-hairline pt-4 text-xs leading-6 text-muted">
                  Flat = bilkul chapta. Large = saaf, ubhra, haath mein mehsoos hone wala.
                  {palmTouched ? null : " Abhi tak koi mount set nahi — reading DOB se hi banegi."}
                </p>
              </div>
            </div>
          </motion.section>
        ) : null}

        {step === 2 ? (
          <motion.section key="step-hand" {...slide} aria-labelledby="step-hand-heading" className="flex flex-col gap-6">
            <div className="flex flex-col gap-2">
              <h2 id="step-hand-heading" className="font-display text-2xl font-semibold tracking-tight text-ink">
                Haath aur head line
              </h2>
              <p className="text-sm leading-6 text-muted">Dono optional — pata na ho to chhod do.</p>
            </div>

            <div className="flex flex-col gap-1.5">
              <label htmlFor="handShape" className="font-display text-sm font-medium text-ink">
                Hand shape
              </label>
              <select
                id="handShape"
                value={handShape}
                onChange={(event) => {
                  setHandShape(event.target.value);
                  if (event.target.value !== "") setPalmTouched(true);
                }}
                className={fieldClass}
              >
                <option value="">Pata nahi — chhod do</option>
                {HAND_SHAPES.map((shape) => (
                  <option key={shape.value} value={shape.value}>
                    {shape.label}
                  </option>
                ))}
              </select>
            </div>

            <fieldset className="flex flex-col gap-3">
              <legend className="font-display text-sm font-medium text-ink">Head line kaisi hai?</legend>
              <p id="head-help" className="text-sm leading-6 text-muted">
                Hatheli ke beech se jaati line — kitni saaf aur gehri dikhti hai.
              </p>
              <div className="flex flex-wrap gap-2" role="group" aria-describedby="head-help" aria-label="Head line quality">
                {HEAD_LEVELS.map((level) => {
                  const active = palmTouched && Math.abs(headQuality - level.value) < 0.01;
                  return (
                    <button
                      key={level.id}
                      type="button"
                      aria-pressed={active}
                      onClick={() => {
                        setPalmTouched(true);
                        setHeadQuality(level.value);
                      }}
                      className={chipClass(active)}
                    >
                      {level.label}
                    </button>
                  );
                })}
              </div>
            </fieldset>
          </motion.section>
        ) : null}

        {step === 3 ? (
          <motion.section key="step-question" {...slide} aria-labelledby="step-question-heading" className="flex flex-col gap-6">
            <div className="flex flex-col gap-2">
              <h2 id="step-question-heading" className="font-display text-2xl font-semibold tracking-tight text-ink">
                Kuch poochna hai?
              </h2>
              <p className="text-sm leading-6 text-muted">
                Optional. Sawaal doge to reading usi ke aas-paas bunni jaayegi.
              </p>
            </div>

            <div className="flex flex-col gap-1.5">
              <label htmlFor="question" className="font-display text-sm font-medium text-ink">
                Tumhara sawaal
              </label>
              <textarea
                id="question"
                name="question"
                rows={5}
                maxLength={MAX_QUESTION_CHARS}
                value={question}
                onChange={(event) => setQuestion(event.target.value)}
                aria-describedby="question-count"
                placeholder="Career kab badlega?"
                className={`${fieldClass} resize-y placeholder:text-muted/60`}
              />
              <p id="question-count" aria-live="polite" className="text-xs tabular-nums text-muted">
                {question.length} / {MAX_QUESTION_CHARS}
              </p>
            </div>
          </motion.section>
        ) : null}

        {step === RESULT_STEP ? (
          <motion.section key="step-reading" {...slide} aria-live="polite" aria-busy={phase.status === "loading"}>
            {phase.status === "loading" ? <ScanSkeleton /> : null}

            {phase.status === "error" ? (
              <div role="alert" className="flex flex-col items-start gap-4 rounded-2xl border border-line-glow/40 bg-line-glow/10 p-6">
                <p className="text-base text-ink">{phase.message}</p>
                <div className="flex flex-wrap gap-3">
                  <button
                    type="button"
                    onClick={retry}
                    className="rounded-full bg-mount-glow px-5 py-2 font-display text-sm font-semibold text-night transition-opacity hover:opacity-90"
                  >
                    Dobara try karo
                  </button>
                  <button
                    type="button"
                    onClick={restart}
                    className="rounded-full border border-hairline px-5 py-2 font-display text-sm font-medium text-muted transition-colors hover:text-ink"
                  >
                    Shuru se
                  </button>
                </div>
              </div>
            ) : null}

            {phase.status === "done" ? (
              <ReadingView
                reading={phase.reading}
                mounts={palmTouched ? mounts : {}}
                feedback={feedback}
                onFeedback={sendFeedback}
                onRestart={restart}
              />
            ) : null}
          </motion.section>
        ) : null}
      </AnimatePresence>

      {formError !== null ? (
        <p role="alert" className="rounded-lg border border-line-glow/40 bg-line-glow/10 px-4 py-3 text-sm text-ink">
          {formError}
        </p>
      ) : null}

      {/* ------------------------------ Step controls ----------------------------- */}
      {step < RESULT_STEP ? (
        <div className="flex items-center justify-between gap-4 border-t border-hairline pt-6">
          <button
            type="button"
            onClick={goBack}
            disabled={step === 0}
            className="rounded-full border border-hairline px-5 py-2.5 font-display text-sm font-medium text-muted transition-colors hover:text-ink disabled:opacity-40"
          >
            Peeche
          </button>
          <button
            type="button"
            onClick={goNext}
            className="rounded-full bg-mount-glow px-7 py-2.5 font-display text-sm font-semibold text-night transition-opacity hover:opacity-90"
          >
            {step === RESULT_STEP - 1 ? "Scan chalao" : "Aage"}
          </button>
        </div>
      ) : null}
    </div>
  );
}

function ScanSkeleton() {
  return (
    <div className="flex flex-col gap-6" aria-hidden="true">
      <div className="h-4 w-32 animate-pulse rounded-full bg-hairline" />
      <div className="mx-auto h-64 w-48 animate-pulse rounded-2xl bg-hairline" />
      <div className="h-20 animate-pulse rounded-2xl bg-hairline" />
      <div className="h-32 animate-pulse rounded-2xl bg-hairline" />
      <div className="h-32 animate-pulse rounded-2xl bg-hairline" />
    </div>
  );
}
