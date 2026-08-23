export * from "./types";
export { resolveBirthWindows, birthWindowIds, mmddToDay, isoToMmdd, dayInRange } from "./dob";
export type { WindowHit, WindowHitKind } from "./dob";
export { evaluateRules, getFeature, kbFeatureKeys, BIRTH_DATE_FEATURE, BIRTH_WINDOW_FEATURE, BIRTH_DAY_OF_MONTH_FEATURE } from "./engine";
export { mergeKnowledgeBases, loadKnowledgeBase, validateRule, KbValidationError } from "./kb-loader";
export { narrateReading, templateNarration, buildSystemPrompt, buildUserPrompt } from "./narrator";
export type { Narration, NarrationSection, NarrateOptions, ReadingTier } from "./narrator";
