/* ============================================================================
 * scan-complete G4 — THE FREEZE FRAME AND THE SNAP STORE (pure)
 *
 *  1. which frame: the sharpest recent crop, VoL ≥ 100 — the keep-ring's floor,
 *     the still regrade's floor;
 *  2. the held lines carried onto it: the shift's sign, measured on a pattern
 *     moved by a known amount; only CONFIRMED lines; observed/bridged kept;
 *  3. the prelabel: 0–1 fractions, valid by the DEV validator;
 *  4. the schema: only TYPES moved to lib/; the values production restates are
 *     pinned here to the dev constants; a growth document passes the dev
 *     validator, a malformed prelabel does not;
 *  5. the store: session-only pairs purged by the next session, growth sessions
 *     kept until deleted, deletable one by one and all at once;
 *  6. never uploaded; the dev labeler imports FROM it, production never imports dev.
 * ========================================================================== */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  FREEZE_RECENT_MS,
  FREEZE_VOL_FLOOR,
  cropLuma,
  estimateFreezeShift,
  freezeReady,
  freezeReplaces,
  heldLinesOn,
  prelabelOf,
  type FreezeCandidate,
} from "../lib/scan/freeze-frame";
import {
  GROWTH_CANONICAL_SIZE,
  GROWTH_CROP_PATH,
  GROWTH_RAW_PATH,
  GROWTH_SCHEMA_VERSION,
  SNAP_SESSION_TOKEN_KEY,
  SnapStore,
  growthSessionMetadata,
  growthStillOf,
  handOf,
  memorySnapBackend,
  sessionToken,
  type SnapPair,
} from "../lib/scan/snap-store";
import {
  CANONICAL_LABEL_SIZE,
  SESSION_SCHEMA_VERSION,
  cropFileName,
  isSessionMetadata,
  rawFileName,
} from "../lib/scan/dev/session-types";
import { STILL_VOL_FLOOR } from "../lib/scan/dev/still-capture";
import { revealSetFromPrelabel } from "../lib/scan/dev/reveal";
import { SUPERRES_CROP_SIZE, SUPERRES_VOL_FLOOR } from "../lib/scan/superres";
import type { RekhaLine, RekhaSnapshot } from "../lib/scan/rekha-persist";
import { MASK_SIZE, type ActiveLineId, type Landmark3 } from "../lib/scan/types";

let assertions = 0;
const ok = (condition: boolean, message: string): void => {
  assert.ok(condition, message);
  assertions += 1;
};

/* ------------------------------- 1. which frame ------------------------------- */

{
  ok(FREEZE_VOL_FLOOR === 100 && FREEZE_VOL_FLOOR === SUPERRES_VOL_FLOOR && FREEZE_VOL_FLOOR === STILL_VOL_FLOOR, "VoL ≥ 100: the keep-ring's floor, which is the still regrade's (G4.1)");
  ok(freezeReplaces(null, { vol: 20, atMs: 0 }), "nothing kept: the first crop is kept, however soft");
  ok(freezeReplaces({ vol: 120, atMs: 0 }, { vol: 140, atMs: 100 }) && !freezeReplaces({ vol: 120, atMs: 0 }, { vol: 110, atMs: 100 }), "a sharper crop replaces the kept one; a softer one does not");
  ok(freezeReplaces({ vol: 300, atMs: 0 }, { vol: 50, atMs: FREEZE_RECENT_MS + 1 }), `"recent": a kept frame older than ${FREEZE_RECENT_MS} ms gives way to any newer one`);
  ok(!freezeReady(null) && !freezeReady({ vol: 99.9, atMs: 0 }) && freezeReady({ vol: 100, atMs: 0 }), "ready to freeze only at the floor");
  ok(SUPERRES_CROP_SIZE === CANONICAL_LABEL_SIZE, "the frozen crop is the keep-ring's 512 — the labeler's canonical size, so a growth still needs no resampling");
}

/* ---------------------------- 2. the lines carried ---------------------------- */

const S = 512;
const pattern = (x: number, y: number): number =>
  0.5 + 0.2 * Math.sin(x / 9) * Math.cos(y / 13) + 0.15 * Math.sin((x + 2 * y) / 21) + 0.1 * Math.cos((3 * x - y) / 17);
const frozenLuma = new Float32Array(S * S);
for (let y = 0; y < S; y += 1) for (let x = 0; x < S; x += 1) frozenLuma[y * S + x] = pattern(x, y);
/** The accumulator's gray: the frozen content moved by (mx, my) MASK pixels (its feature at p sits at p + m). */
function accumulatorMovedBy(mx: number, my: number): Float32Array {
  const out = new Float32Array(MASK_SIZE * MASK_SIZE);
  const f = S / MASK_SIZE;
  for (let y = 0; y < MASK_SIZE; y += 1) {
    for (let x = 0; x < MASK_SIZE; x += 1) {
      let sum = 0;
      for (let j = 0; j < f; j += 1) for (let i = 0; i < f; i += 1) sum += pattern(f * (x - mx) + i, f * (y - my) + j);
      out[y * MASK_SIZE + x] = sum / (f * f);
    }
  }
  return out;
}

{
  for (const [mx, my] of [[-3, 2], [1, 1], [0, 0], [2.5, -1.5]] as const) {
    const shift = estimateFreezeShift(frozenLuma, S, accumulatorMovedBy(mx, my));
    ok(
      shift !== null && Math.abs(shift.dx + mx) < 0.15 && Math.abs(shift.dy + my) < 0.15,
      `the accumulator's content moved by (${mx}, ${my}) since the frozen frame: the lines go back by (${shift?.dx.toFixed(2)}, ${shift?.dy.toFixed(2)})`,
    );
  }
  ok(estimateFreezeShift(frozenLuma, 500, accumulatorMovedBy(0, 0)) === null, "a crop that is not a whole multiple of the mask is not guessed at");

  const line = (id: ActiveLineId, state: RekhaLine["state"], segments?: RekhaLine["segments"]): RekhaLine => ({
    id,
    state,
    points: [[10, 20], [30, 22], [60, 30]],
    progress: 1,
    held: true,
    ...(segments === undefined ? {} : { segments }),
  });
  const snapshot: RekhaSnapshot = {
    lines: {
      heart: line("heart", "confirmed", [{ from: 0, to: 1, observed: true }, { from: 1, to: 2, observed: false }]),
      head: line("head", "tracking"),
      life: line("life", "confirmed"),
    },
    anyConfirmed: true,
    flicker: { heart: 0, head: 0, life: 0, fate: 0 },
    firstConfirmedMs: { heart: 1, head: null, life: 1, fate: null },
    frames: 40,
    costMs: 1,
  };
  /* The accumulator moved (-3, 2) since the frozen frame: its line at (10, 20) sits at (13, 18) on the frozen crop. */
  const lines = heldLinesOn(snapshot, estimateFreezeShift(frozenLuma, S, accumulatorMovedBy(-3, 2)));
  ok(lines.map((l) => l.id).join() === "heart,life", "only CONFIRMED lines go on the photograph — the tracking head line does not");
  ok(Math.abs(lines[0]!.points[0]![0] - 13) < 0.2 && Math.abs(lines[0]!.points[0]![1] - 18) < 0.2, `carried onto the frozen crop: (10, 20) → (${lines[0]!.points[0]!.map((v) => v.toFixed(2)).join(", ")})`);
  ok(lines[0]!.segments.length === 2 && lines[0]!.segments[1]!.observed === false, "the observed and bridged stretches travel with the line");
  ok(lines[1]!.segments.length === 1 && lines[1]!.segments[0]!.observed && lines[1]!.segments[0]!.to === 2, "a line with no segment record is one observed stretch");
  ok(heldLinesOn(null, null).length === 0, "no evidence, no lines");

  /* The hold let the heart line go after the ledger showed it ✓: its last confirmed geometry is drawn. */
  const dropped: RekhaSnapshot = { ...snapshot, lines: { life: snapshot.lines.life, head: snapshot.lines.head } };
  const remembered = { heart: snapshot.lines.heart! };
  ok(
    heldLinesOn(dropped, null, remembered, ["heart", "life"]).map((l) => l.id).join() === "heart,life",
    "a line the ledger shows ✓ is on the snap even after the hold let it go — from its last confirmed geometry (the first G4 capture drew three of four)",
  );
  ok(heldLinesOn(dropped, null, remembered, ["life"]).map((l) => l.id).join() === "life", "…and only a line the ledger shows ✓: a remembered line the detection does not count is not drawn");
  ok(
    heldLinesOn(dropped, null, { head: snapshot.lines.head! }, ["head", "life"]).map((l) => l.id).join() === "life",
    "…nor one whose remembered state is below CONFIRMED",
  );

  const luma = cropLuma(new Uint8ClampedArray([255, 255, 255, 255, 0, 0, 0, 255, 255, 0, 0, 255, 0, 255, 0, 255]), 2);
  ok(luma[0] === 1 && luma[1] === 0 && Math.abs(luma[2]! - 0.2126) < 1e-6 && Math.abs(luma[3]! - 0.7152) < 1e-6, "the crop's luma is Rec. 709, as the keep-ring and the accumulator read it");
}

/* ------------------------------- 3. the prelabel ------------------------------- */

const landmarks: Landmark3[] = Array.from({ length: 21 }, (_, i) => ({ x: 0.3 + i * 0.01, y: 0.4 + (i % 5) * 0.02, z: 0 }));
function candidate(overrides: Partial<FreezeCandidate> = {}): FreezeCandidate {
  return {
    vol: 142.37,
    atMs: 1000,
    crop: { width: 512, height: 512, data: new Uint8ClampedArray(4), colorSpace: "srgb" } as unknown as ImageData,
    raw: { width: 720, height: 1280, data: new Uint8ClampedArray(4), colorSpace: "srgb" } as unknown as ImageData,
    anchors: [{ x: 300.123, y: 800.456 }, { x: 420, y: 700 }, { x: 350, y: 500 }, { x: 250, y: 520 }],
    convention: 4,
    landmarks,
    handedness: "Right",
    quality: { score: 0.81, ok: true, issues: [], luma: 0.52, clipped: 0.01, jitter: 0.002, sharpness: 180 },
    windingStrength: 0.4,
    trackSettings: { width: 720, height: 1280, facingMode: "environment" },
    ...overrides,
  };
}

{
  const prelabel = prelabelOf([
    { id: "heart", points: [[-4, 10], [64, 64], [130, 20]], segments: [{ from: 0, to: 2, observed: true }] },
    { id: "fate", points: [[64, 120], [64, 40]], segments: [{ from: 0, to: 1, observed: true }] },
  ]);
  ok(prelabel.source === "chamber-held" && prelabel.lines.length === 2, "the prelabel is the held lines, marked as the chamber's");
  ok(
    JSON.stringify(prelabel.lines[0]!.points) === JSON.stringify([[0, 10 / 128], [0.5, 0.5], [1, 20 / 128]].map((p) => p.map((v) => Number(v.toFixed(4))))),
    "0–1 fractions of the crop, clamped inside it (D4, as every label)",
  );
  const set = revealSetFromPrelabel(prelabel);
  ok(set.heart?.length === 1 && set.heart[0] === prelabel.lines[0]!.points && set.fate !== undefined && set.head === undefined, "the dev labeler's CORRECTION mode reads it as its prefill set — one candidate per line, nothing invented");
}

/* ------------------------------ 4. the schema ------------------------------ */

const pair = (prelabel = prelabelOf([{ id: "heart", points: [[10, 20], [60, 30]], segments: [{ from: 0, to: 1, observed: true }] }])): SnapPair => ({
  palm: new Blob(["palm"]),
  raw: new Blob(["raw"]),
  lines: new Blob(["lines"]),
  prelabel,
  vol: 142.37,
  hand: "right",
  capturedAt: "2026-09-30T10:00:00.000Z",
});

{
  ok(GROWTH_SCHEMA_VERSION === SESSION_SCHEMA_VERSION, `the growth document's schema tag is the dev harness's (${SESSION_SCHEMA_VERSION}) — restated, pinned here`);
  ok(GROWTH_CANONICAL_SIZE === CANONICAL_LABEL_SIZE, "…its canonical size the labeler's");
  ok(GROWTH_RAW_PATH === `raw/${rawFileName(0)}` && GROWTH_CROP_PATH === `selected/${cropFileName(0)}`, "…its files where the labeler looks for still 0");

  const still = growthStillOf(candidate());
  ok(still.capturePath === "canvas-fallback" && still.width === 720 && still.height === 1280, "the still records how it was taken (the video, through a canvas) and its size");
  ok(JSON.stringify(still.anchors[0]) === "[300.12,800.46]" && still.quality.sharpness === 180 && still.poseAngle.windingStrength === 0.4, "…its anchors to 2 places, its verdict and its winding — what the dev capture records");
  ok(handOf("Right") === "right" && handOf("Left") === "left", "the hand from the landmarker's label (raw frames: \"Right\" is a right palm, M1)");

  const metadata = growthSessionMetadata("chamber-2026-09-30T10-00-00-000Z", "2026-09-30T10:00:01.000Z", pair(), still);
  ok(isSessionMetadata(metadata), "a chamber growth session passes the DEV harness's strict validator — the labeler opens it as its own");
  ok(metadata.purpose === "growth" && metadata.stills.length === 1 && metadata.stills[0]!.prelabel?.lines[0]?.id === "heart", "purpose growth, one still, the held lines as its prelabel");
  ok(metadata.stills[0]!.stillVol === 142.4 && metadata.stills[0]!.attempts === 1, "the frozen frame's VoL as the still's regrade number");
  const broken = { ...metadata, stills: [{ ...metadata.stills[0]!, prelabel: { source: "chamber-held", lines: [{ id: "palm", points: [[0.1, 0.1], [0.2, 0.2]] }] } }] };
  ok(!isSessionMetadata(broken), "…and a prelabel naming no line the labeler knows is rejected whole");
  const outside = { ...metadata, stills: [{ ...metadata.stills[0]!, prelabel: { source: "chamber-held", lines: [{ id: "heart", points: [[0.1, 0.1], [1.2, 0.2]] }] } }] };
  ok(!isSessionMetadata(outside), "…as is one with a point outside the crop");

  const devTypes = readFileSync("lib/scan/dev/session-types.ts", "utf8");
  const schema = readFileSync("lib/scan/session-schema.ts", "utf8");
  ok(!/^export (const|function)/m.test(schema), "lib/scan/session-schema.ts holds TYPES only — the constants and validators stayed in dev");
  ok(/export type \{[\s\S]*SessionMetadata[\s\S]*\} from "\.\.\/session-schema";/.test(devTypes), "the dev schema re-exports the moved types, so every dev import still works");
}

/* ------------------------------ 5. the store ------------------------------ */

async function storeChecks(): Promise<void> {
  const backend = memorySnapBackend();
  let clock = Date.parse("2026-09-30T10:00:00.000Z");
  const now = (): Date => new Date((clock += 1000));
  const first = new SnapStore(backend, "session-A", now);
  const kept = await first.keepForSession(pair());
  ok((await first.getBlob(kept, "snap/palm.png")) !== null && (await first.getBlob(kept, "snap/lines.png")) !== null, "a completed scan's pair is kept for this session: the palm, the raw frame, the lines");
  ok((await first.listGrowth()).length === 0, "…and it is NOT a growth session: nothing is kept past the session unless asked");

  const growthId = await first.saveGrowth(pair(), growthStillOf(candidate()));
  const listed = await first.listGrowth();
  ok(listed.length === 1 && listed[0]!.sessionId === growthId && isSessionMetadata(listed[0]), "the opt-in saves one growth session, a valid document");
  ok((await first.getBlob(growthId, GROWTH_RAW_PATH)) !== null && (await first.getBlob(growthId, GROWTH_CROP_PATH)) !== null, "…with its raw frame and its crop where the labeler reads them");

  const second = new SnapStore(backend, "session-B", now);
  ok((await second.purgeOtherSessions()) === 1, "the next browsing session purges the last one's pair — session-only");
  ok((await second.getBlob(kept, "snap/palm.png")) === null && (await second.listGrowth()).length === 1, "…and keeps the growth session the reader opted into");

  await second.deleteGrowth(growthId);
  ok((await second.listGrowth()).length === 0 && (await second.getBlob(growthId, GROWTH_RAW_PATH)) === null, "deletable: the toggle off deletes the session and its pictures");
  await second.saveGrowth(pair(), growthStillOf(candidate()));
  await second.saveGrowth(pair(), growthStillOf(candidate()));
  ok((await second.deleteAllGrowth()) === 2 && (await second.listGrowth()).length === 0, "…and the privacy page's control deletes them all");

  const memory = new Map<string, string>();
  const storage = { getItem: (key: string) => memory.get(key) ?? null, setItem: (key: string, value: string) => void memory.set(key, value) };
  const token = sessionToken(storage, () => "minted");
  ok(token === "minted" && memory.get(SNAP_SESSION_TOKEN_KEY) === "minted" && sessionToken(storage, () => "other") === "minted", "the session token lives in sessionStorage: minted once, read back after");
  ok(sessionToken({ getItem: () => { throw new Error("blocked"); }, setItem: () => undefined }, () => "fallback") === "fallback", "blocked storage still yields a token — the pair is then this page's only");
}

/* ------------------------ 6. never uploaded; the boundary ------------------------ */

{
  for (const file of ["lib/scan/snap-store.ts", "lib/scan/freeze-frame.ts", "components/sanctuary/chamber/completion-snaps.ts", "components/sanctuary/privacy/saved-palms.tsx"]) {
    const code = readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
    ok(!/\bfetch\(|XMLHttpRequest|sendBeacon|WebSocket|EventSource/.test(code), `${file}: nothing here reaches the network — never uploaded`);
    ok(!/lib\/scan\/dev|app\/dev/.test(code), `${file}: imports nothing from the dev harness`);
  }
  const label = readFileSync("app/dev/label/label-client.tsx", "utf8");
  ok(/openSnapStore\(\{ purge: false \}\)/.test(label) && /importSession\(metadata/.test(label), "the dev labeler imports the chamber's growth sessions FROM the snap store — the arrow points dev → production");
  ok(/revealSetFromPrelabel\(stored\)/.test(label), "…and corrects the lines the reader was shown, not a fresh prelabel");
  ok(/<SavedPalms \/>/.test(readFileSync("app/privacy/page.tsx", "utf8")), "the privacy page carries the growth snaps' delete control");
}

void storeChecks().then(() => console.log(`FREEZE SNAP ASSERTIONS PASSED (${assertions})`));
