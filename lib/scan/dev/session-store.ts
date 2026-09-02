/**
 * Dev-only persistence for capture sessions (sprint Phase 0a, decision D5).
 *
 * Two tiers, with a hard line between them:
 *
 * - **IndexedDB = in-browser staging only.** Stills land here first so a tab reload does not lose
 *   a session mid-capture. It is not the home of the data.
 * - **File System Access API = the real destination.** The user picks a directory — recommended
 *   `C:\Projects\hastrekha-lab\captures\` — and export writes the A4 replay layout there:
 *   `<sessionId>/{metadata.json, raw/, selected/, aligned/, snapshots/, labels/}` with aligned/
 *   and snapshots/ created empty (reserved for Phases 2–3).
 *
 * Raw frames live in the LAB, never in this repo — `.gitignore` carries safety entries anyway.
 * Nothing here ever touches the network, and nothing in the production bundle imports this module
 * (dev routes are NODE_ENV-gated).
 */
import {
  SESSION_DIRS,
  SESSION_DIR_LABELS,
  SESSION_METADATA_FILE,
  SESSION_SCHEMA_VERSION,
  isRekhaLabelFile,
  isSessionMetadata,
  labelFileName,
  type CaptureStillRecord,
  type RekhaLabelFile,
  type SessionHand,
  type SessionMetadata,
} from "./session-types";

/* --------------------------------- IndexedDB -------------------------------- */

const DB_NAME = "hastrekha-dev-capture";
const DB_VERSION = 2;
const STORE_SESSIONS = "sessions";
const STORE_BLOBS = "blobs";
const STORE_HANDLES = "handles";
const STORE_LABELS = "labels";
const HANDLE_KEY_EXPORT_DIR = "exportDir";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_SESSIONS)) db.createObjectStore(STORE_SESSIONS, { keyPath: "sessionId" });
      if (!db.objectStoreNames.contains(STORE_BLOBS)) db.createObjectStore(STORE_BLOBS);
      if (!db.objectStoreNames.contains(STORE_HANDLES)) db.createObjectStore(STORE_HANDLES);
      if (!db.objectStoreNames.contains(STORE_LABELS)) db.createObjectStore(STORE_LABELS);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("indexedDB open failed"));
  });
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("indexedDB request failed"));
  });
}

async function idbPut(db: IDBDatabase, store: string, value: unknown, key?: IDBValidKey): Promise<void> {
  const tx = db.transaction(store, "readwrite");
  await requestToPromise(tx.objectStore(store).put(value, key));
}

async function idbGet<T>(db: IDBDatabase, store: string, key: IDBValidKey): Promise<T | undefined> {
  const tx = db.transaction(store, "readonly");
  return requestToPromise(tx.objectStore(store).get(key) as IDBRequest<T | undefined>);
}

async function idbDelete(db: IDBDatabase, store: string, key: IDBValidKey): Promise<void> {
  const tx = db.transaction(store, "readwrite");
  await requestToPromise(tx.objectStore(store).delete(key));
}

async function idbAllKeys(db: IDBDatabase, store: string): Promise<IDBValidKey[]> {
  const tx = db.transaction(store, "readonly");
  return requestToPromise(tx.objectStore(store).getAllKeys());
}

async function idbAll<T>(db: IDBDatabase, store: string): Promise<T[]> {
  const tx = db.transaction(store, "readonly");
  return requestToPromise(tx.objectStore(store).getAll() as IDBRequest<T[]>);
}

/* ------------------------- File System Access typing ------------------------- */

/** `showDirectoryPicker` + handle permissions are not in the stock TS lib — structural views. */
interface DirectoryPickerOptions {
  readonly id?: string;
  readonly mode?: "read" | "readwrite";
}
type DirectoryPicker = (options?: DirectoryPickerOptions) => Promise<FileSystemDirectoryHandle>;

interface PermissionQueryableHandle {
  queryPermission?(descriptor: { mode: "read" | "readwrite" }): Promise<PermissionState>;
  requestPermission?(descriptor: { mode: "read" | "readwrite" }): Promise<PermissionState>;
}

async function ensureWritePermission(handle: FileSystemDirectoryHandle): Promise<boolean> {
  const capable = handle as FileSystemDirectoryHandle & PermissionQueryableHandle;
  if (capable.queryPermission === undefined || capable.requestPermission === undefined) return true;
  if ((await capable.queryPermission({ mode: "readwrite" })) === "granted") return true;
  return (await capable.requestPermission({ mode: "readwrite" })) === "granted";
}

/* --------------------------------- The store -------------------------------- */

/** Key for a staged blob: `<sessionId>/<relative path inside the session dir>`. */
function blobKey(sessionId: string, relativePath: string): string {
  return `${sessionId}/${relativePath}`;
}

export interface SessionSummary {
  readonly sessionId: string;
  readonly hand: SessionHand;
  readonly createdAt: string;
  readonly stillCount: number;
}

/**
 * Staging + export facade. Construct once per page via {@link openSessionStore}; every method is
 * safe to call concurrently with capture ticks (each opens its own short-lived transaction).
 */
export class SessionStore {
  private constructor(private readonly db: IDBDatabase) {}

  static async open(): Promise<SessionStore> {
    return new SessionStore(await openDb());
  }

  /** Create and stage a fresh session document. */
  async createSession(hand: SessionHand, canonicalSize: number): Promise<SessionMetadata> {
    const now = new Date();
    const metadata: SessionMetadata = {
      schemaVersion: SESSION_SCHEMA_VERSION,
      sessionId: `session-${now.toISOString().replace(/[:.]/g, "-")}`,
      hand,
      createdAt: now.toISOString(),
      canonicalSize,
      stills: [],
    };
    await idbPut(this.db, STORE_SESSIONS, metadata);
    return metadata;
  }

  async getSession(sessionId: string): Promise<SessionMetadata | null> {
    const value = await idbGet<unknown>(this.db, STORE_SESSIONS, sessionId);
    return isSessionMetadata(value) ? value : null;
  }

  async listSessions(): Promise<readonly SessionSummary[]> {
    const all = await idbAll<unknown>(this.db, STORE_SESSIONS);
    return all
      .filter(isSessionMetadata)
      .map((s) => ({ sessionId: s.sessionId, hand: s.hand, createdAt: s.createdAt, stillCount: s.stills.length }))
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  }

  /** Stage one captured still: record into metadata, blobs under raw/ and selected/. */
  async addStill(
    session: SessionMetadata,
    record: CaptureStillRecord,
    rawBlob: Blob,
    cropBlob: Blob,
  ): Promise<SessionMetadata> {
    const updated: SessionMetadata = { ...session, stills: [...session.stills, record] };
    await idbPut(this.db, STORE_BLOBS, rawBlob, blobKey(session.sessionId, `raw/${record.rawFile}`));
    await idbPut(this.db, STORE_BLOBS, cropBlob, blobKey(session.sessionId, `selected/${record.cropFile}`));
    await idbPut(this.db, STORE_SESSIONS, updated);
    return updated;
  }

  /** Staged crop blob for the labeler (0a-ii) and export. */
  async getBlob(sessionId: string, relativePath: string): Promise<Blob | null> {
    const value = await idbGet<Blob>(this.db, STORE_BLOBS, blobKey(sessionId, relativePath));
    return value ?? null;
  }

  /* ------------------------------- Labels (0a-ii) ------------------------------- */

  /** Stage one label, keyed by its file name. Overwrite allowed — relabeling is normal. */
  async addLabel(sessionId: string, stillIndex: number, label: RekhaLabelFile): Promise<void> {
    if (!isRekhaLabelFile(label)) throw new Error("refusing to stage an invalid label file");
    await idbPut(this.db, STORE_LABELS, label, blobKey(sessionId, labelFileName(stillIndex)));
  }

  /** Still indices that have a staged label, ascending — drives the labelled badges. */
  async listLabels(sessionId: string): Promise<number[]> {
    const keys = await idbAllKeys(this.db, STORE_LABELS);
    const prefix = `${sessionId}/label-`;
    const indices: number[] = [];
    for (const key of keys) {
      if (typeof key === "string" && key.startsWith(prefix)) {
        const index = Number.parseInt(key.slice(prefix.length), 10);
        if (Number.isFinite(index)) indices.push(index);
      }
    }
    return indices.sort((a, b) => a - b);
  }

  async getLabel(sessionId: string, stillIndex: number): Promise<RekhaLabelFile | null> {
    const value = await idbGet<unknown>(this.db, STORE_LABELS, blobKey(sessionId, labelFileName(stillIndex)));
    return isRekhaLabelFile(value) ? value : null;
  }

  /** Remove a session and its staged blobs (after a confirmed export, or on user request). */
  async deleteSession(sessionId: string): Promise<void> {
    const keys = await idbAllKeys(this.db, STORE_BLOBS);
    for (const key of keys) {
      if (typeof key === "string" && key.startsWith(`${sessionId}/`)) {
        await idbDelete(this.db, STORE_BLOBS, key);
      }
    }
    const labelKeys = await idbAllKeys(this.db, STORE_LABELS);
    for (const key of labelKeys) {
      if (typeof key === "string" && key.startsWith(`${sessionId}/`)) {
        await idbDelete(this.db, STORE_LABELS, key);
      }
    }
    await idbDelete(this.db, STORE_SESSIONS, sessionId);
  }

  /* ------------------------------ Export (FS API) ------------------------------ */

  /** Pick (and persist) the export directory — point it at the lab's captures/ (D5). */
  async pickExportDirectory(): Promise<FileSystemDirectoryHandle | null> {
    const picker = (window as Window & { showDirectoryPicker?: DirectoryPicker }).showDirectoryPicker;
    if (picker === undefined) return null;
    const handle = await picker({ id: "hastrekha-captures", mode: "readwrite" });
    await idbPut(this.db, STORE_HANDLES, handle, HANDLE_KEY_EXPORT_DIR);
    return handle;
  }

  /** Previously picked directory, if permission still stands (or is re-grantable). */
  async storedExportDirectory(): Promise<FileSystemDirectoryHandle | null> {
    const handle = await idbGet<FileSystemDirectoryHandle>(this.db, STORE_HANDLES, HANDLE_KEY_EXPORT_DIR);
    if (handle === undefined) return null;
    return (await ensureWritePermission(handle)) ? handle : null;
  }

  /**
   * Write one session to the picked directory in the A4 layout. Every directory in
   * {@link SESSION_DIRS} is created (aligned/ and snapshots/ stay empty in 0a); staged blobs are
   * copied file-by-file; metadata.json is written last so a partial export is visibly incomplete.
   */
  async exportSession(sessionId: string, root: FileSystemDirectoryHandle): Promise<number> {
    const session = await this.getSession(sessionId);
    if (session === null) throw new Error(`session ${sessionId} is not staged`);
    if (!(await ensureWritePermission(root))) throw new Error("write permission denied");

    const dir = await root.getDirectoryHandle(session.sessionId, { create: true });
    for (const name of SESSION_DIRS) {
      await dir.getDirectoryHandle(name, { create: true });
    }

    let written = 0;
    for (const still of session.stills) {
      for (const relative of [`raw/${still.rawFile}`, `selected/${still.cropFile}`] as const) {
        const blob = await this.getBlob(sessionId, relative);
        if (blob === null) continue;
        const [dirName, fileName] = relative.split("/");
        const target = await dir.getDirectoryHandle(dirName, { create: true });
        const file = await target.getFileHandle(fileName, { create: true });
        const writable = await file.createWritable();
        await writable.write(blob);
        await writable.close();
        written += 1;
      }
    }

    // Labels BEFORE metadata (0a-ii) — metadata.json stays the last write, so its labelCount can
    // only ever describe files that are already on disk.
    const labelIndices = await this.listLabels(sessionId);
    const labelsDir = await dir.getDirectoryHandle(SESSION_DIR_LABELS, { create: true });
    for (const index of labelIndices) {
      const label = await this.getLabel(sessionId, index);
      if (label === null) continue;
      const file = await labelsDir.getFileHandle(labelFileName(index), { create: true });
      const writable = await file.createWritable();
      await writable.write(new Blob([JSON.stringify(label, null, 2)], { type: "application/json" }));
      await writable.close();
      written += 1;
    }

    const withCount: SessionMetadata = { ...session, labelCount: labelIndices.length };
    const metaFile = await dir.getFileHandle(SESSION_METADATA_FILE, { create: true });
    const writable = await metaFile.createWritable();
    await writable.write(new Blob([JSON.stringify(withCount, null, 2)], { type: "application/json" }));
    await writable.close();
    return written;
  }
}

/** Open the staging store. Throws outside a browser (dev routes never render on the server). */
export function openSessionStore(): Promise<SessionStore> {
  return SessionStore.open();
}
