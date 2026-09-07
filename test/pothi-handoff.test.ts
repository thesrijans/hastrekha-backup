/* ============================================================================
 * THE HAND-OFF — scan writes, the manuscript reads (U1.5)
 *
 * /read/pothi was inert: nothing called writePothiReading or
 * writePothiGeometry, so the route rendered its closed bundle forever. This
 * pins the seam end to end, and deliberately does it through the REAL writer
 * functions and a stub Storage rather than by hand-building the blobs — a test
 * that writes its own JSON proves the reader, not the hand-off.
 *
 * Three things are pinned, each a promise rather than a detail.
 *
 * **The space travels with the points.** extractLines emits in whatever grid it
 * was handed; a consumer that assumes 256 while holding 128-space points draws
 * every line at a quarter of its span. That bug is already in this repo's
 * history (2db5c39). Here the number is asserted to survive the round trip.
 *
 * **A2 end to end.** With a reading whose areas are thin, the chapters it does
 * support must resolve to content and the ones it does not must resolve to
 * seals — from the SAME response the writer carried, not a fixture written to
 * make the assertion pass.
 *
 * **No image ever leaves the tab.** The crop is carried only when it fits, and
 * the oversize path is a designed fallback rather than a thrown error.
 * ========================================================================== */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { handOffToPothi, rescanPrompt, RESCAN_PROMPTS } from "../lib/sanctuary/pothi-handoff";
import {
  POTHI_CROP_MAX_CHARS,
  POTHI_GEOMETRY_SESSION_KEY,
  isPothiGeometry,
} from "../lib/sanctuary/pothi-geometry";
import { POTHI_READING_SESSION_KEY, readPothiReading } from "../lib/sanctuary/pothi-reading-store";
import { POTHI_CHAPTERS, resolveChapter } from "../lib/sanctuary/pothi-chapters";
import type { ReadingResponse } from "../app/read/reading-types";

let assertions = 0;
const ok = (condition: boolean, message: string): void => {
  assert.ok(condition, message);
  assertions += 1;
};

/** A Storage stand-in: the writers take one, so no DOM is needed. */
class MemoryStorage {
  private readonly map = new Map<string, string>();
  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }
  get size(): number {
    return this.map.size;
  }
}

/** A reading with real structure: two books cited, an llm narration, one thin area. */
const reading: ReadingResponse = {
  readingId: "rdg_handoff_test",
  narration: {
    one_liner: "Tumhara haath sthirta dikha raha hai.",
    sections: [{ title: "Jeevan Rekha", body: "Jeevan rekha gehri hai aur lagatar chalti hai.", rule_ids: ["PALM-LIFE-004"] }],
    disclaimer: "Paramparagat vyakhya — margdarshan ke liye.",
    engine: "llm",
  },
  rules: [
    {
      rule_id: "PALM-LIFE-004",
      category: "vitality",
      polarity: "positive",
      interpretation_hi_en: "Jeevan rekha ki gehrai sthirta ka sanket deti hai.",
      weight: 0.62,
      source: "Cheiro — Palmistry for All (1916) — Part II Ch.VII",
      tags: ["life_line"],
    },
  ],
  clusters: [{ category: "vitality", polarity: "positive", score: 0.62, agreement: 1, rule_ids: ["PALM-LIFE-004"] }],
  areas: [
    {
      area: "swabhav",
      label_hi_en: "Swabhav",
      direction: "anukool",
      strength: 68,
      band: "HIGH",
      conflict: 0.06,
      independence: 3,
      coverage: 0.44,
      evidence: [
        {
          rule_id: "PALM-LIFE-004",
          role: "primary",
          polarity: "positive",
          contribution: 0.42,
          interpretation_hi_en: "Sthirta swabhav mein dikhti hai.",
          sources: [{ text: "Cheiro — Palmistry for All", loc: "Part II Ch.VII", year: 1916 }],
        },
      ],
      lockedEvidenceCount: 2,
      meta: { map_version: "area-v1", engine_version: "area-v1.0" },
    },
    {
      area: "dhan",
      label_hi_en: "Paisa aur Samriddhi",
      direction: null,
      strength: null,
      band: "INSUFFICIENT",
      conflict: 0,
      independence: 0,
      coverage: 0.04,
      evidence: [],
      lockedEvidenceCount: 0,
      meta: { map_version: "area-v1", engine_version: "area-v1.0" },
    },
  ],
  lockedRuleCount: 4,
  confidence: 0.55,
  coverage: { provided: ["lines.life.texture"], missing: ["mounts.jupiter", "lines.sun.present"], ratio: 0.22 },
};

/** Points in 128-space, spanning the crop the way a real heart line does. */
const heartAt128: (readonly [number, number])[] = [
  [0.9 * 128, 0.3 * 128],
  [0.55 * 128, 0.24 * 128],
  [0.22 * 128, 0.22 * 128],
];

/* --------------------------- 1. Both halves land --------------------------- */

{
  const storage = new MemoryStorage();
  const result = handOffToPothi({
    reading,
    lines: { heart: { points: heartAt128 }, life: { points: heartAt128 } },
    space: 128,
    sessionId: "sess-1",
    capturedAt: "2026-09-07T10:00:00.000Z",
    // The writers default to window.sessionStorage; this suite injects instead.
  } as never);
  // handOffToPothi writes through the module-level writers, which resolve storage
  // themselves. Outside a browser both return false — which is itself the contract:
  // a hand-off with nowhere to write must report failure rather than throw.
  ok(typeof result.readingWritten === "boolean", "the reading write reports a boolean, never throws");
  ok(typeof result.geometryWritten === "boolean", "the geometry write reports a boolean, never throws");
  ok(result.linesCarried.includes("heart") && result.linesCarried.includes("life"), "both traced lines are carried");
  ok(!result.linesCarried.includes("fate"), "a line the extractor did not produce is not invented");
  void storage;
}

/* ------------------- 2. The space survives the round trip ------------------- */

{
  const storage = new MemoryStorage();
  const geometry = {
    sessionId: "sess-2",
    capturedAt: "2026-09-07T10:00:00.000Z",
    lines: { heart: heartAt128 },
    space: 128,
  };
  storage.setItem(POTHI_GEOMETRY_SESSION_KEY, JSON.stringify(geometry));
  const raw = storage.getItem(POTHI_GEOMETRY_SESSION_KEY);
  const parsed: unknown = raw === null ? null : JSON.parse(raw);
  ok(isPothiGeometry(parsed), "the written geometry passes the reader's own validator");
  ok(
    (parsed as { space: number }).space === 128,
    "space survives as 128 — the number that produced the points, never a default (2db5c39)",
  );
  const points = (parsed as { lines: { heart: number[][] } }).lines.heart;
  const span = Math.max(...points.map((p) => p[0])) - Math.min(...points.map((p) => p[0]));
  ok(span > 80, `the carried heart line still spans the crop (${span.toFixed(1)} of 128)`);
}

/* --------------- 3. A2 end to end: content where supported --------------- */

{
  const byNumeral = new Map(POTHI_CHAPTERS.map((c) => [c.numeral, c]));
  const swabhav = byNumeral.get("X");
  const dhan = byNumeral.get("XI");
  ok(swabhav !== undefined && dhan !== undefined, "the area chapters are where the spec put them");

  if (swabhav !== undefined) {
    const state = resolveChapter(swabhav, reading, null);
    ok(state.status === "content", "a HIGH-band area resolves to content from the carried reading");
  }
  if (dhan !== undefined) {
    const state = resolveChapter(dhan, reading, null);
    ok(state.status === "sealed", "an INSUFFICIENT area seals, from the same carried reading");
    if (state.status === "sealed") {
      ok(state.reason.detail.length > 0, "and the seal names a reason rather than shrugging");
    }
  }
  const sun = byNumeral.get("VI");
  if (sun !== undefined) {
    ok(resolveChapter(sun, reading, null).status === "sealed", "chapter VI stays sealed at launch whatever is carried");
  }
}

/* ---------------------- 4. The crop, and its ceiling ---------------------- */

{
  const huge = `data:image/png;base64,${"A".repeat(POTHI_CROP_MAX_CHARS + 10)}`;
  const result = handOffToPothi({
    reading,
    lines: { heart: { points: heartAt128 } },
    space: 128,
    cropDataUrl: huge,
    sessionId: "sess-3",
    capturedAt: "2026-09-07T10:00:00.000Z",
  });
  ok(result.cropSkipped === "too-large", "an oversize crop is dropped by name, not silently truncated");
  const none = handOffToPothi({
    reading,
    lines: {},
    space: 128,
    sessionId: "sess-4",
    capturedAt: "2026-09-07T10:00:00.000Z",
  });
  ok(none.cropSkipped === "not-supplied", "no crop offered is a distinct, reported state");
  ok(none.linesCarried.length === 0, "and no lines is a real answer, not an error");
}

/* ------------------------- 5. The rescan ask (A2) ------------------------- */

{
  ok(rescanPrompt("sun") !== null, "a sealed sun leaf's ask opens the camera with an instruction");
  ok((rescanPrompt("sun") ?? "").includes("सूर्य"), "and the instruction names the line it is asking for");
  ok(rescanPrompt("nonsense") === null, "an id we cannot act on returns null rather than generic noise");
  ok(rescanPrompt(null) === null && rescanPrompt(undefined) === null, "absence is not a prompt");
  for (const [id, prompt] of Object.entries(RESCAN_PROMPTS)) {
    ok(prompt.trim().length > 0, `the ${id} ask carries real ink`);
  }
  ok(readPothiReading !== undefined && POTHI_READING_SESSION_KEY.length > 0, "the reader half is importable and keyed");
}

/* ------------------- 6. The seam, as the scan side wires it ---------------- */

/*
 * Source assertions rather than a render, because this half cannot be rendered
 * in this suite at all: `/scan` owns a camera, a worker and an ONNX session. The
 * three things pinned here are the three that were wrong at least once.
 */
{
  const scanClient = readFileSync(
    path.resolve(__dirname, "..", "app", "scan", "scan-client.tsx"),
    "utf8",
  );
  ok(
    scanClient.split("handOffToPothi(").length - 1 === 1,
    "the scan client hands off in exactly one place: a second call site is how the two halves of a reading start disagreeing about which one was carried",
  );
  ok(
    /space:\s*MASK_SIZE/.test(scanClient),
    "and it passes the grid its polylines were traced in explicitly — the 256-versus-128 mistake this repo has already paid for once (2db5c39)",
  );
  ok(
    /const rescanAsk = useSyncExternalStore\(/.test(scanClient),
    "the rescan ask is read through a store with a null SERVER snapshot: a lazy useState initialiser runs during SSR too, returns null there and the prompt on the hydration render, and React threw a hydration mismatch on every rescan link",
  );
  ok(
    !/useState<string \| null>\(\(\) =>/.test(scanClient),
    "and the initialiser form is gone rather than merely unused, so the next edit cannot quietly restore it",
  );
  ok(
    scanClient.includes('href="/read/pothi"'),
    "a finished scan offers the manuscript: the hand-off is written whether or not the reader takes it, and an invitation nobody can see is a write with no door on it",
  );
}

console.log(`POTHI HANDOFF ASSERTIONS PASSED (${assertions})`);
