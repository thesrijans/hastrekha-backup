/**
 * THE SNAP STORE (scan-complete G4.3): where the completion screen's two snaps are kept — on this device only.
 *
 * ITS OWN DATABASE. IndexedDB `hastrekha-snaps`, never the dev harness's `hastrekha-dev-capture`: production
 * imports nothing from lib/scan/dev or app/dev (test/import-boundary.test.ts). What the two share is the
 * schema's TYPES (lib/scan/session-schema.ts), so a growth session written here is the very document the dev
 * labeler reads; the dev side imports it from this store (app/dev/label), never the reverse.
 *
 * SESSION-ONLY BY DEFAULT. Every completed scan's pair — the palm, the raw frame, the palm with its lines — is
 * kept under this browsing session's token (sessionStorage, so it dies with the tab) and purged the next time
 * a DIFFERENT session opens the store: sessionStorage's lifetime for pictures too large for sessionStorage.
 *
 * GROWTH, OPT-IN. The one toggle — "मेरी हथेली से HastRekha को बेहतर बनाने में मदद करें", off by default —
 * saves the pair as a growth-purpose capture session: metadata with `purpose: "growth"` and one still
 * (raw/still-000.png, selected/crop-000.png at the 512 canonical size) whose `prelabel` is the held lines, so
 * the labeler's CORRECTION mode starts from what the reader was shown and its commits carry
 * `method: "prelabel-corrected"`. Kept until deleted — turning the toggle off deletes it, and so does the
 * privacy page's control.
 *
 * NEVER UPLOADED. Nothing here touches the network; the pictures never leave this browser's storage.
 */
import type { FreezeCandidate } from "./freeze-frame";
import { LM } from "./landmark-index";
import type { CaptureStillRecord, SessionHand, SessionMetadata, StillPrelabel } from "./session-schema";
import type { Handedness } from "./types";

const INDEX_MCP = LM.INDEX_MCP;
const PINKY_MCP = LM.PINKY_MCP;

/* ------------------------------ The schema's values ------------------------------ */

/**
 * The dev harness's values for the documents written here — its SESSION_SCHEMA_VERSION, its canonical label
 * size, its raw/ and selected/ file names for still 0. Only the TYPES moved to lib/ (G4.3); these few values
 * are restated, and test/snap-store.test.ts pins each one to the dev constant so they cannot drift.
 */
export const GROWTH_SCHEMA_VERSION = "0a-1";
export const GROWTH_CANONICAL_SIZE = 512;
export const GROWTH_RAW_PATH = "raw/still-000.png";
export const GROWTH_CROP_PATH = "selected/crop-000.png";

/** The session pair's own blob paths. */
export const SNAP_PALM_PATH = "snap/palm.png";
export const SNAP_RAW_PATH = "snap/raw.png";
export const SNAP_LINES_PATH = "snap/lines.png";

/** This browsing session's token lives here (sessionStorage): a tab that closes takes its snaps with it. */
export const SNAP_SESSION_TOKEN_KEY = "hastrekha:snap-session";

export const SNAP_DB_NAME = "hastrekha-snaps";
const SNAP_DB_VERSION = 1;
const STORE_RECORDS = "records";
const STORE_BLOBS = "blobs";

/* ---------------------------------- Records ---------------------------------- */

/** The completion screen's pair, as pictures and as the lines drawn on them. */
export interface SnapPair {
  /** The rectified 512 canonical crop, PNG. */
  readonly palm: Blob;
  /** The raw camera frame it was rectified from, PNG. */
  readonly raw: Blob;
  /** The crop with the held lines drawn in gold, PNG. */
  readonly lines: Blob;
  /** The held lines on the crop: 0–1 fractions (the labeler's prelabel). */
  readonly prelabel: StillPrelabel;
  /** The frozen frame's VoL (the keep-ring's measure, lib/scan/freeze-frame.ts). */
  readonly vol: number;
  readonly hand: SessionHand;
  /** ISO timestamp of the frozen frame. */
  readonly capturedAt: string;
}

/** Everything a growth still records beyond the pair — the dev capture's still record, less what the store names. */
export type GrowthStill = Omit<CaptureStillRecord, "index" | "rawFile" | "cropFile" | "capturedAt" | "stillVol" | "attempts" | "prelabel" | "duplicateOf">;

interface SnapRecord {
  readonly id: string;
  readonly kind: "session" | "growth";
  /** The browsing session a `session` record belongs to. */
  readonly token: string | null;
  readonly createdAt: string;
  /** The blob paths stored under this record. */
  readonly paths: readonly string[];
  /** `growth` records: the capture session document. */
  readonly metadata?: SessionMetadata;
  /** `session` records: the pair's lines and grade (the pictures are blobs). */
  readonly prelabel?: StillPrelabel;
  readonly vol?: number;
  readonly hand?: SessionHand;
}

/** The growth session document for one completed scan (pure; test/snap-store.test.ts validates it with the dev validator). */
export function growthSessionMetadata(sessionId: string, createdAt: string, pair: SnapPair, still: GrowthStill): SessionMetadata {
  const record: CaptureStillRecord = {
    ...still,
    index: 0,
    rawFile: GROWTH_RAW_PATH.slice("raw/".length),
    cropFile: GROWTH_CROP_PATH.slice("selected/".length),
    capturedAt: pair.capturedAt,
    stillVol: Number(pair.vol.toFixed(1)),
    attempts: 1,
    prelabel: pair.prelabel,
  };
  return {
    schemaVersion: GROWTH_SCHEMA_VERSION,
    sessionId,
    hand: pair.hand,
    createdAt,
    canonicalSize: GROWTH_CANONICAL_SIZE,
    stills: [record],
    purpose: "growth",
  };
}

/** The reader's hand from the landmarker's label: on raw, unmirrored frames MediaPipe names a right palm "Right" (M1, quality.ts). */
export function handOf(handedness: Handedness): SessionHand {
  return handedness === "Left" ? "left" : "right";
}

/**
 * The still record's fields for a frozen frame (G4.3) — what the dev capture records about a still
 * (app/dev/capture), from the numbers the chamber kept with the frame: the canvas path (the chamber reads the
 * video through a canvas), the raw frame's size, its landmarks and anchors, the gate's verdict and stats, the
 * index→little knuckle chord's roll, the facing readout's winding strength, the track's settings.
 */
export function growthStillOf(frozen: FreezeCandidate): GrowthStill {
  const index = frozen.landmarks[INDEX_MCP];
  const pinky = frozen.landmarks[PINKY_MCP];
  const rollDeg = index === undefined || pinky === undefined ? 0 : (Math.atan2(pinky.y - index.y, pinky.x - index.x) * 180) / Math.PI;
  return {
    capturePath: "canvas-fallback",
    width: frozen.raw.width,
    height: frozen.raw.height,
    landmarks: frozen.landmarks,
    anchors: frozen.anchors.map((p) => [Number(p.x.toFixed(2)), Number(p.y.toFixed(2))] as const),
    quality: frozen.quality,
    poseAngle: { rollDeg: Number(rollDeg.toFixed(1)), windingStrength: frozen.windingStrength },
    trackSettings: frozen.trackSettings,
  };
}

/** This browsing session's token: read from `storage`, or minted and written there. */
export function sessionToken(storage: Pick<Storage, "getItem" | "setItem"> | null, mint: () => string = defaultToken): string {
  try {
    const existing = storage?.getItem(SNAP_SESSION_TOKEN_KEY);
    if (typeof existing === "string" && existing.length > 0) return existing;
    const token = mint();
    storage?.setItem(SNAP_SESSION_TOKEN_KEY, token);
    return token;
  } catch {
    return mint();
  }
}

function defaultToken(): string {
  return `s-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/* ---------------------------------- Backend ---------------------------------- */

/** The two stores the snap store needs. IndexedDB in a browser; a Map in the tests. */
export interface SnapBackend {
  getRecord(id: string): Promise<SnapRecord | undefined>;
  putRecord(record: SnapRecord): Promise<void>;
  deleteRecord(id: string): Promise<void>;
  allRecords(): Promise<readonly SnapRecord[]>;
  getBlob(key: string): Promise<Blob | undefined>;
  putBlob(key: string, blob: Blob): Promise<void>;
  deleteBlob(key: string): Promise<void>;
}

/** A backend in memory — the tests' IndexedDB. */
export function memorySnapBackend(): SnapBackend {
  const records = new Map<string, SnapRecord>();
  const blobs = new Map<string, Blob>();
  return {
    getRecord: async (id) => records.get(id),
    putRecord: async (record) => void records.set(record.id, record),
    deleteRecord: async (id) => void records.delete(id),
    allRecords: async () => [...records.values()],
    getBlob: async (key) => blobs.get(key),
    putBlob: async (key, blob) => void blobs.set(key, blob),
    deleteBlob: async (key) => void blobs.delete(key),
  };
}

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("indexedDB request failed"));
  });
}

/** The IndexedDB backend: `hastrekha-snaps`, a records store and a blobs store. */
function indexedDbBackend(db: IDBDatabase): SnapBackend {
  const store = (name: string, mode: IDBTransactionMode): IDBObjectStore => db.transaction(name, mode).objectStore(name);
  return {
    getRecord: (id) => request(store(STORE_RECORDS, "readonly").get(id) as IDBRequest<SnapRecord | undefined>),
    putRecord: async (record) => void (await request(store(STORE_RECORDS, "readwrite").put(record))),
    deleteRecord: async (id) => void (await request(store(STORE_RECORDS, "readwrite").delete(id))),
    allRecords: () => request(store(STORE_RECORDS, "readonly").getAll() as IDBRequest<SnapRecord[]>),
    getBlob: (key) => request(store(STORE_BLOBS, "readonly").get(key) as IDBRequest<Blob | undefined>),
    putBlob: async (key, blob) => void (await request(store(STORE_BLOBS, "readwrite").put(blob, key))),
    deleteBlob: async (key) => void (await request(store(STORE_BLOBS, "readwrite").delete(key))),
  };
}

/* ----------------------------------- Store ----------------------------------- */

const blobKey = (id: string, path: string): string => `${id}/${path}`;

export class SnapStore {
  constructor(
    private readonly backend: SnapBackend,
    /** This browsing session's token ({@link sessionToken}). */
    readonly token: string,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** Delete every session-only pair another browsing session left behind. Returns how many went. */
  async purgeOtherSessions(): Promise<number> {
    let purged = 0;
    for (const record of await this.backend.allRecords()) {
      if (record.kind !== "session" || record.token === this.token) continue;
      await this.remove(record);
      purged += 1;
    }
    return purged;
  }

  /** Keep a completed scan's pair for this browsing session only. Returns its id. */
  async keepForSession(pair: SnapPair): Promise<string> {
    const createdAt = this.now().toISOString();
    const id = `snap-${createdAt.replace(/[:.]/g, "-")}`;
    const paths = [SNAP_PALM_PATH, SNAP_RAW_PATH, SNAP_LINES_PATH];
    await this.backend.putBlob(blobKey(id, SNAP_PALM_PATH), pair.palm);
    await this.backend.putBlob(blobKey(id, SNAP_RAW_PATH), pair.raw);
    await this.backend.putBlob(blobKey(id, SNAP_LINES_PATH), pair.lines);
    await this.backend.putRecord({ id, kind: "session", token: this.token, createdAt, paths, prelabel: pair.prelabel, vol: pair.vol, hand: pair.hand });
    return id;
  }

  /** The opt-in growth save: the pair as a growth-purpose capture session. Returns its session id. */
  async saveGrowth(pair: SnapPair, still: GrowthStill): Promise<string> {
    const createdAt = this.now().toISOString();
    const sessionId = `chamber-${createdAt.replace(/[:.]/g, "-")}`;
    const metadata = growthSessionMetadata(sessionId, createdAt, pair, still);
    await this.backend.putBlob(blobKey(sessionId, GROWTH_RAW_PATH), pair.raw);
    await this.backend.putBlob(blobKey(sessionId, GROWTH_CROP_PATH), pair.palm);
    await this.backend.putRecord({ id: sessionId, kind: "growth", token: null, createdAt, paths: [GROWTH_RAW_PATH, GROWTH_CROP_PATH], metadata });
    return sessionId;
  }

  /** The growth sessions kept on this device, newest first. */
  async listGrowth(): Promise<readonly SessionMetadata[]> {
    return (await this.backend.allRecords())
      .filter((record) => record.kind === "growth" && record.metadata !== undefined)
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
      .map((record) => record.metadata!);
  }

  /** One of a record's pictures, by its path (e.g. {@link GROWTH_CROP_PATH}). */
  async getBlob(id: string, path: string): Promise<Blob | null> {
    return (await this.backend.getBlob(blobKey(id, path))) ?? null;
  }

  /** Delete one growth session, pictures and all. */
  async deleteGrowth(sessionId: string): Promise<void> {
    const record = await this.backend.getRecord(sessionId);
    if (record !== undefined && record.kind === "growth") await this.remove(record);
  }

  /** Delete every growth session on this device. Returns how many went. */
  async deleteAllGrowth(): Promise<number> {
    let deleted = 0;
    for (const record of await this.backend.allRecords()) {
      if (record.kind !== "growth") continue;
      await this.remove(record);
      deleted += 1;
    }
    return deleted;
  }

  private async remove(record: SnapRecord): Promise<void> {
    for (const path of record.paths) await this.backend.deleteBlob(blobKey(record.id, path));
    await this.backend.deleteRecord(record.id);
  }
}

/**
 * Open the store in a browser, purging other sessions' pairs on the way in. Null where there is no IndexedDB
 * (the server, a locked-down private window): the completion screen then still shows its snaps, from memory.
 * `purge: false` for a reader of the growth sessions only (the dev labeler's import, the privacy page): another
 * tab's chamber may still be showing its session's pair.
 */
export async function openSnapStore(options: { readonly purge?: boolean } = {}): Promise<SnapStore | null> {
  if (typeof indexedDB === "undefined") return null;
  try {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const open = indexedDB.open(SNAP_DB_NAME, SNAP_DB_VERSION);
      open.onupgradeneeded = () => {
        const created = open.result;
        if (!created.objectStoreNames.contains(STORE_RECORDS)) created.createObjectStore(STORE_RECORDS, { keyPath: "id" });
        if (!created.objectStoreNames.contains(STORE_BLOBS)) created.createObjectStore(STORE_BLOBS);
      };
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => reject(open.error ?? new Error("indexedDB open failed"));
    });
    let storage: Storage | null = null;
    try {
      storage = window.sessionStorage;
    } catch {
      storage = null;
    }
    const store = new SnapStore(indexedDbBackend(db), sessionToken(storage));
    if (options.purge !== false) await store.purgeOtherSessions();
    return store;
  } catch {
    return null;
  }
}
