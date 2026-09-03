/* ============================================================================
 * LABELER — schema 0a-2, staging roundtrip, export ordering
 *
 * The label file under test is built by the SAME buildLabelFile the client
 * calls — not a hand-assembled lookalike — so what passes here is what the
 * labeler writes. The store tests run against a minimal in-memory IndexedDB
 * shim plus a fake FileSystemDirectoryHandle that records write ORDER, which
 * is how the labels-before-metadata contract is proven.
 * ========================================================================== */
import assert from "node:assert/strict";
import {
  CANONICAL_LABEL_SIZE,
  SESSION_SCHEMA_VERSION,
  isRekhaLabelFile,
  labelFileName,
  parseRekhaLabelFile,
  type RekhaLabelFile,
  type SessionMetadata,
} from "../lib/scan/dev/session-types";
import { buildLabelFile, emptyLabelerState, isComplete, type LabelerState } from "../lib/scan/dev/labeler-file";
import { openSessionStore } from "../lib/scan/dev/session-store";

let assertions = 0;
const ok = (condition: boolean, message: string): void => {
  assert.ok(condition, message);
  assertions += 1;
};

/* ----------------------- 1. State → file, via the client's own function ----------------------- */

const session: SessionMetadata = {
  schemaVersion: SESSION_SCHEMA_VERSION,
  sessionId: "session-labeler-test",
  hand: "left",
  createdAt: "2026-09-02T00:00:00.000Z",
  canonicalSize: CANONICAL_LABEL_SIZE,
  stills: [
    {
      index: 0,
      rawFile: "still-000.png",
      cropFile: "crop-000.png",
      capturePath: "canvas-fallback",
      width: 1920,
      height: 1080,
      landmarks: Array.from({ length: 21 }, (_, i) => ({ x: i / 21, y: i / 21, z: 0 })),
      anchors: [
        [960, 900],
        [700, 820],
        [640, 400],
        [1100, 410],
      ],
      quality: { score: 0.8, ok: true, issues: [], luma: 0.5, clipped: 0, jitter: 0.001, sharpness: 120 },
      poseAngle: { rollDeg: 3.2, windingStrength: 0.4 },
      trackSettings: { width: 1920 },
      capturedAt: "2026-09-02T00:01:00.000Z",
    },
  ],
};

function completeState(): LabelerState {
  const base = emptyLabelerState("LUMA");
  return {
    ...base,
    lines: {
      heart: { points: [[0.14, 0.25], [0.47, 0.22], [0.84, 0.35]], absent: false, confidence: "clear", method: "livewire", viewAtCommit: "NATURAL", done: true },
      head: { points: [], absent: true, confidence: "clear", method: "manual", viewAtCommit: "NATURAL", done: true },
      life: { points: [[0.31, 0.28], [0.48, 0.81]], absent: false, confidence: "faint", method: "manual", viewAtCommit: "CREASE", done: true },
      fate: { points: [], absent: true, confidence: "clear", method: "manual", viewAtCommit: "NATURAL", done: true },
    },
  };
}

ok(!isComplete(emptyLabelerState()), "an untouched state is not saveable");
ok(isComplete(completeState()), "committed-or-absent on all four lines is saveable");

const file = buildLabelFile(completeState(), session, 0, "srijan", "2026-09-02T00:10:00.000Z");
ok(file.schemaVersion === "0a-2", "built files are schema 0a-2");
ok(parseRekhaLabelFile(JSON.stringify(file)) !== null, "the built file passes the validator through a JSON roundtrip");
ok(file.frame === "selected/crop-000.png" && file.canonicalSize === 512, "frame + canonicalSize are golden-run-consumable");
ok(file.anchors.length === 4, "anchors are the crop's own canonical quad");
assert.deepEqual([...file.absent].sort(), ["fate", "head"], "absent list mirrors the per-line flags");
assertions += 1;
ok(file.labelerId === "srijan" && file.enhancement?.version === "enh-1" && file.enhancement.channel === "LUMA", "0a-2 provenance fields present");
ok(file.lines.every((line) => line.confidence !== undefined && line.method !== undefined && line.viewAtCommit !== undefined), "every line carries confidence/method/viewAtCommit");
assert.throws(() => buildLabelFile(emptyLabelerState(), session, 0, "srijan", "2026-09-02T00:10:00.000Z"), "incomplete state refuses to build");
assertions += 1;

/* ------------------------------ 2. Version split ------------------------------ */

/** A 0a-1 file (pre-0a-ii) — none of the new fields. Must still parse. */
const v1: Record<string, unknown> = {
  schemaVersion: "0a-1",
  sessionId: "session-old",
  stillIndex: 0,
  frame: "selected/crop-000.png",
  anchors: [[256, 480], [180, 430], [160, 120], [280, 120]],
  canonicalSize: 512,
  hand: "right",
  lines: [
    { id: "heart", points: [[0.1, 0.2], [0.5, 0.5]], absent: false },
    { id: "head", points: [], absent: true },
    { id: "life", points: [[0.3, 0.3], [0.4, 0.8]], absent: false },
    { id: "fate", points: [], absent: true },
  ],
  absent: ["head", "fate"],
  mode: "blank_slate",
  labeler: "srijan",
  capturedAt: "2026-08-01T00:00:00.000Z",
  labeledAt: "2026-08-01T00:10:00.000Z",
};
ok(isRekhaLabelFile(v1), "a stored 0a-1 file still parses");
ok(!isRekhaLabelFile({ ...v1, labelerId: "x" }), "0a-1 with a stray 0a-2 field is rejected — never half-upgraded");
ok(
  !isRekhaLabelFile({ ...v1, lines: (v1.lines as Record<string, unknown>[]).map((l) => ({ ...l, confidence: "clear" })) }),
  "0a-1 lines with 0a-2 fields are rejected",
);

const asV2 = (mutate: (f: Record<string, unknown>) => void): unknown => {
  const clone = JSON.parse(JSON.stringify(file)) as Record<string, unknown>;
  mutate(clone);
  return clone;
};
ok(!isRekhaLabelFile(asV2((f) => { (f.lines as Record<string, unknown>[])[0].confidence = "sure"; })), "bad confidence rejected");
ok(!isRekhaLabelFile(asV2((f) => { (f.lines as Record<string, unknown>[])[0].method = "guessed"; })), "bad method rejected");
ok(!isRekhaLabelFile(asV2((f) => { (f.lines as Record<string, unknown>[])[0].viewAtCommit = "XRAY"; })), "bad viewAtCommit rejected");
ok(!isRekhaLabelFile(asV2((f) => { delete f.labelerId; })), "0a-2 without labelerId rejected");
ok(!isRekhaLabelFile(asV2((f) => { f.enhancement = { version: "enh-1", channel: "UV" }; })), "bad enhancement channel rejected");
ok(!isRekhaLabelFile(asV2((f) => { (f.lines as Record<string, unknown>[])[1].points = [[0.5, 0.5], [0.6, 0.6]]; })), "absent-with-points still rejected on 0a-2");
ok(!isRekhaLabelFile(asV2((f) => { f.absent = ["head"]; })), "absent-list mismatch still rejected on 0a-2");

/* --------------------- 2b. Minor line ids (sun/health/marriage/bracelets/girdle) --------------------- */

ok(
  isRekhaLabelFile(asV2((f) => {
    (f.lines as Record<string, unknown>[]).push({ id: "sun", points: [[0.6, 0.3], [0.62, 0.6]], absent: false, confidence: "clear", method: "manual", viewAtCommit: "NATURAL" });
  })),
  "a minor-line entry (sun) is accepted alongside the majors",
);
ok(
  !isRekhaLabelFile(asV2((f) => {
    (f.lines as Record<string, unknown>[]).push({ id: "rascette", points: [[0.6, 0.3], [0.62, 0.6]], absent: false, confidence: "clear", method: "manual", viewAtCommit: "NATURAL" });
  })),
  "an unknown line id is still rejected",
);
{
  // A 9-line 0a-2 file roundtrips; the original 4-line `file` remains the still-valid baseline.
  const nine = JSON.parse(JSON.stringify(file)) as Record<string, unknown>;
  const nineLines = nine.lines as Record<string, unknown>[];
  for (const id of ["sun", "health", "marriage", "bracelets", "girdle"]) {
    nineLines.push({ id, points: [], absent: true, confidence: "clear", method: "manual", viewAtCommit: "NATURAL" });
  }
  nine.absent = [...(nine.absent as string[]), "sun", "health", "marriage", "bracelets", "girdle"];
  ok(parseRekhaLabelFile(JSON.stringify(nine)) !== null, "a 9-line file roundtrips");
  ok(parseRekhaLabelFile(JSON.stringify(file)) !== null, "a 4-line file still validates");
}

/* ------------------------- 3. Staging roundtrip (IDB shim) ------------------------- */

/** Minimal in-memory IndexedDB — exactly the surface session-store uses, callbacks deferred. */
class FakeRequest<T> {
  onsuccess: ((event: unknown) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  onupgradeneeded: ((event: unknown) => void) | null = null;
  result!: T;
  constructor(execute: () => T, upgrade?: (db: T) => void) {
    queueMicrotask(() => {
      this.result = execute();
      if (upgrade !== undefined) {
        upgrade(this.result);
        this.onupgradeneeded?.({});
      }
      this.onsuccess?.({});
    });
  }
}

class FakeObjectStore {
  constructor(private readonly rows: Map<string, unknown>, private readonly keyPath: string | null) {}
  put(value: unknown, key?: IDBValidKey): FakeRequest<void> {
    const at = key !== undefined ? String(key) : String((value as Record<string, unknown>)[this.keyPath ?? ""]);
    return new FakeRequest(() => {
      this.rows.set(at, value);
    });
  }
  get(key: IDBValidKey): FakeRequest<unknown> {
    return new FakeRequest(() => this.rows.get(String(key)));
  }
  getAll(): FakeRequest<unknown[]> {
    return new FakeRequest(() => [...this.rows.values()]);
  }
  getAllKeys(): FakeRequest<IDBValidKey[]> {
    return new FakeRequest(() => [...this.rows.keys()]);
  }
  delete(key: IDBValidKey): FakeRequest<void> {
    return new FakeRequest(() => {
      this.rows.delete(String(key));
    });
  }
}

class FakeDb {
  private readonly stores = new Map<string, { rows: Map<string, unknown>; keyPath: string | null }>();
  readonly objectStoreNames = {
    contains: (name: string): boolean => this.stores.has(name),
  };
  createObjectStore(name: string, options?: { keyPath?: string }): void {
    this.stores.set(name, { rows: new Map(), keyPath: options?.keyPath ?? null });
  }
  transaction(store: string): { objectStore: (store: string) => FakeObjectStore } {
    return {
      objectStore: (): FakeObjectStore => {
        const entry = this.stores.get(store);
        if (entry === undefined) throw new Error(`no store ${store}`);
        return new FakeObjectStore(entry.rows, entry.keyPath);
      },
    };
  }
}

const fakeDb = new FakeDb();
(globalThis as { indexedDB?: unknown }).indexedDB = {
  open: (): FakeRequest<FakeDb> => new FakeRequest(() => fakeDb, (db) => {
    db.createObjectStore("sessions", { keyPath: "sessionId" });
    db.createObjectStore("blobs");
    db.createObjectStore("handles");
    db.createObjectStore("labels");
  }),
};

/** Fake directory handle recording the ORDER files are closed in. */
const writeOrder: string[] = [];
const writtenText = new Map<string, string>();
function fakeDirectory(prefix: string): FileSystemDirectoryHandle {
  return {
    getDirectoryHandle: (name: string) => Promise.resolve(fakeDirectory(`${prefix}${name}/`)),
    getFileHandle: (name: string) =>
      Promise.resolve({
        createWritable: () =>
          Promise.resolve({
            write: (blob: Blob) =>
              blob.text().then((text) => {
                writtenText.set(`${prefix}${name}`, text);
              }),
            close: () => {
              writeOrder.push(`${prefix}${name}`);
              return Promise.resolve();
            },
          }),
      }),
  } as unknown as FileSystemDirectoryHandle;
}

async function main(): Promise<void> {
const store = await openSessionStore();
const staged = await store.createSession("left", CANONICAL_LABEL_SIZE);
const stagedLabel: RekhaLabelFile = { ...file, sessionId: staged.sessionId };

await store.addLabel(staged.sessionId, 0, stagedLabel);
assert.deepEqual(await store.listLabels(staged.sessionId), [0], "listLabels sees the staged index");
assertions += 1;
const loaded = await store.getLabel(staged.sessionId, 0);
ok(loaded !== null && loaded.labelerId === "srijan", "getLabel roundtrips the staged file");
await store.addLabel(staged.sessionId, 0, { ...stagedLabel, labeler: "again" });
ok((await store.getLabel(staged.sessionId, 0))?.labeler === "again", "re-staging overwrites — relabeling is normal");
await assert.rejects(
  store.addLabel(staged.sessionId, 1, { ...stagedLabel, absent: ["head"] } as RekhaLabelFile),
  "an invalid label refuses to stage",
);
assertions += 1;

/* --------------------------- 4. Export order contract --------------------------- */

const written = await store.exportSession(staged.sessionId, fakeDirectory(""));
ok(written === 1, "one label file written (no stills staged in this session)");
const labelAt = writeOrder.indexOf(`${staged.sessionId}/labels/${labelFileName(0)}`);
const metaAt = writeOrder.indexOf(`${staged.sessionId}/metadata.json`);
ok(labelAt >= 0 && metaAt >= 0, "both the label and metadata were written");
ok(labelAt < metaAt, "labels/ is written BEFORE metadata.json — metadata only ever describes files on disk");
ok(metaAt === writeOrder.length - 1, "metadata.json is the last write of the export");
const exportedMeta = JSON.parse(writtenText.get(`${staged.sessionId}/metadata.json`) ?? "{}") as { labelCount?: number };
ok(exportedMeta.labelCount === 1, "exported metadata carries labelCount");

console.log(`LABELER ASSERTIONS PASSED (${assertions})`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
