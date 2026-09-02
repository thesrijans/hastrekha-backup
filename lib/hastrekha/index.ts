export * from "./types";
export { resolveBirthWindows, birthWindowIds, mmddToDay, isoToMmdd, dayInRange } from "./dob";
export type { WindowHit, WindowHitKind } from "./dob";
export { evaluateRules, getFeature, kbFeatureKeys, BIRTH_DATE_FEATURE, BIRTH_WINDOW_FEATURE, BIRTH_DAY_OF_MONTH_FEATURE } from "./engine";
export { mergeKnowledgeBases, loadKnowledgeBase, validateRule, KbValidationError } from "./kb-loader";
export { narrateReading, templateNarration, buildSystemPrompt, buildUserPrompt } from "./narrator";
export type { Narration, NarrationSection, NarrateOptions, ReadingTier } from "./narrator";
export * from "./area-types";
// `area-map-loader` is deliberately NOT re-exported here — it statically imports the 159 KB
// area map, and this barrel is imported by client components (app/scan/scan-client.tsx,
// components/scan/live-ticker.tsx). Server callers import it by path. The TYPE re-export below is
// safe: `export type` is erased at build and cannot pull the JSON into a bundle.
export type { AreaMap, AreaMapping, AreaBlock } from "./area-map-loader";
export { scoreAreas } from "./area-score";
export type { AreaScoreInput } from "./area-score";
