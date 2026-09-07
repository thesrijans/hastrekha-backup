"use client";

/**
 * ============================================================================
 * THE POTHI'S ONE CLIENT ISLAND — where the reading comes from, and the
 * backend gap that makes this necessary.
 * ============================================================================
 *
 * ══ THE BACKEND GAP, STATED PLAINLY BEFORE ANYTHING ELSE ══
 *
 * THERE IS NO GET-READING ENDPOINT. `app/api/reading/route.ts` accepts a POST
 * of a feature bag and answers with a whole `ReadingResponse`; there is no
 * route anywhere that returns a reading by id, and `readingId` — which the
 * response does carry — can therefore be used for feedback and for nothing
 * else. Both existing consumers work around it the same way: /read POSTs the
 * form and holds the answer in component state, /scan POSTs the scanned bag and
 * holds the answer in component state. Neither persists it anywhere a second
 * page could read.
 *
 * So the Pothi, which is a SECOND page, has exactly one honest source: the tab
 * itself. This module defines that hand-off — the same idiom, the same
 * versioned-key discipline and the same strict validator as
 * lib/sanctuary/pothi-geometry.ts, which carries the polylines across the same
 * boundary for the same reason.
 *
 * ══ WHAT IS NOT FIXED HERE, AND WHY NOT ══
 *
 * NOTHING WRITES {@link POTHI_READING_SESSION_KEY} YET. The writer belongs at
 * the two places that hold a fresh response — app/read/read-client.tsx and
 * app/scan/scan-client.tsx — and both are owned elsewhere in this build and are
 * explicitly out of bounds for this pass. That is not papered over: until a
 * writer lands, this route renders <PothiBook> with `reading = null`, which is
 * the sealed bundle naming the real reason and pointing at /scan. An empty
 * Pothi that says why it is empty is the correct behaviour for a missing
 * upstream, and it is the behaviour A2 asks for. The permanent fix is a
 * `GET /api/reading/[id]`; the interim fix is three lines in each of those two
 * clients calling {@link writePothiReading}.
 *
 * ══ WHY THE FIRST FRAME RENDERS NOTHING ══
 *
 * `sessionStorage` cannot be read on the server, so the honest sequence is:
 * render nothing, read the tab, render the book. The tempting alternative —
 * render the book with `reading = null` immediately and swap it for the real one
 * a frame later — would flash "no reading was made" at a reader who has one.
 * That is a confident-looking empty state lasting one frame, which is the A2
 * failure in miniature, so it is not done. One frame of nothing is not a claim
 * about anything.
 *
 * ══ AND WHY THAT IS `useSyncExternalStore` RATHER THAN AN EFFECT ══
 *
 * The obvious shape — read the tab in a `useEffect` and `setState` — is a
 * cascading render by construction: React commits a tree, the effect
 * immediately invalidates it, React commits again. `sessionStorage` IS an
 * external store, so it gets the hook built for external stores. The snapshot is
 * deliberately the RAW STRING and not the parsed object: `getSnapshot` is called
 * on every render and must return something `Object.is`-equal each time, and a
 * fresh `JSON.parse` would hand React a new object every call and spin forever.
 * The string is the change signal; {@link snapshotStorage} turns the pair of
 * strings back into the two validated values, in render, without touching the
 * real store again.
 *
 * `null` from `getServerSnapshot` is what "has not looked yet" means — the one
 * value a client snapshot can never be, since a key the tab does not hold reads
 * as {@link EMPTY_SLOT}. That is the whole of the pending state.
 */
import { useMemo, useSyncExternalStore, type ReactElement } from "react";
import type { ReadingResponse } from "@/app/read/reading-types";
import { PothiBook } from "@/components/sanctuary/pothi/pothi-book";
import { useCapabilityTier } from "@/components/sanctuary/use-capability-tier";
import {
  POTHI_GEOMETRY_SESSION_KEY,
  readPothiGeometry,
  type PothiGeometryStorage,
  type PothiSessionGeometry,
} from "@/lib/sanctuary/pothi-geometry";

/* ================================ THE KEY ================================= */

/**
 * The documented sessionStorage key the reading travels on.
 *
 * Namespaced and versioned IN THE KEY, exactly as
 * `POTHI_GEOMETRY_SESSION_KEY` is, and for the same reason: a version field
 * inside the blob has to be read, understood and migrated by a reader that has
 * no way to know what it is looking at, whereas a version in the key means an
 * old writer and a new reader simply never meet. The new reader finds nothing,
 * the book seals itself with a reason, and the honest fallback that already
 * exists covers the upgrade for free. Bump the suffix whenever
 * {@link isReadingResponse} would start rejecting what the previous writer
 * wrote.
 *
 * SESSION AND NOT LOCAL STORAGE. A reading is a paragraph about somebody's
 * life, assembled from a photograph of their hand. `prisma/schema.prisma` says
 * "no images, ever" and /scan makes the reader the same promise; a reading is
 * one step downstream of that promise and gets the store whose lifetime matches
 * it — dies with the tab, never travels to a server, per-origin.
 */
/*
 * The store moved to lib/sanctuary/pothi-reading-store.ts so the scan client and the
 * hand-off test can reach it without importing this file's React and CSS-module graph
 * (plain `tsx` cannot parse a stylesheet). Re-exported here so every prior import path
 * keeps working and there is still exactly one key and one validator.
 */
export {
  POTHI_READING_SESSION_KEY,
  readPothiReading,
  writePothiReading,
  type PothiReadingStorage,
} from "@/lib/sanctuary/pothi-reading-store";
import {
  POTHI_READING_SESSION_KEY,
  readPothiReading,
  sessionStorageOrNull,
  type PothiReadingStorage,
} from "@/lib/sanctuary/pothi-reading-store";

/* ============================== THE SNAPSHOT ============================== */

/**
 * What a client snapshot says when the tab holds nothing under a key.
 *
 * The empty string rather than `null`, because `null` is reserved for "the
 * server has not looked yet" and the two must stay distinguishable — that
 * distinction IS the pending state. Nothing is lost by the choice: the writer
 * only ever stores JSON, which is never empty, and an empty slot that somehow
 * reached the parser would fail it and become the same absent answer anyway.
 */
const EMPTY_SLOT = "";

/** The raw text under a key, or {@link EMPTY_SLOT}. Never throws — a blocked store is an absent one. */
function slotOf(key: string): string {
  const storage = sessionStorageOrNull();
  if (storage === null) return EMPTY_SLOT;
  try {
    return storage.getItem(key) ?? EMPTY_SLOT;
  } catch {
    return EMPTY_SLOT;
  }
}

/**
 * Subscribe to changes in the tab's storage.
 *
 * The `storage` event does NOT fire in the document that performed the write,
 * so this is not how the ordinary flow gets its value — the hand-off is written
 * by /read or /scan before this route is ever mounted, and the first snapshot
 * already has it. It is here for the case the spec does define (another
 * same-origin document sharing this tab's session area writing the key) and
 * because `useSyncExternalStore` is only correct with a real subscription.
 */
function subscribeToTabStorage(onStoreChange: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  window.addEventListener("storage", onStoreChange);
  return () => window.removeEventListener("storage", onStoreChange);
}

const readingSlot = (): string => slotOf(POTHI_READING_SESSION_KEY);
const geometrySlot = (): string => slotOf(POTHI_GEOMETRY_SESSION_KEY);

/** The server's answer to both: "not looked yet". See the header — this is the pending state. */
const unreadSlot = (): null => null;

/**
 * The two sampled strings, wearing the `Storage` face both readers already
 * accept.
 *
 * This is the injectable seam `readPothiReading` and `readPothiGeometry` were
 * built with, used for the reason a test uses it: to hand a reader a fixed
 * snapshot instead of a live store. The point is purity — render must not go
 * back to `sessionStorage`, because React may run this memo at a moment the
 * sampled strings no longer describe, and the two would then disagree about
 * what the tab holds. Reusing the readers rather than re-implementing their
 * validators is the other half: there is exactly one definition of a readable
 * reading and one of a drawable hand-off, and neither is copied here.
 *
 * `setItem` is inert because the type asks for it and because a render that
 * wrote to storage would be a bug of a different order than the one this file
 * is preventing.
 */
function snapshotStorage(readingRaw: string, geometryRaw: string): PothiReadingStorage & PothiGeometryStorage {
  return {
    getItem: (key: string): string | null => {
      if (key === POTHI_READING_SESSION_KEY) return readingRaw === EMPTY_SLOT ? null : readingRaw;
      if (key === POTHI_GEOMETRY_SESSION_KEY) return geometryRaw === EMPTY_SLOT ? null : geometryRaw;
      return null;
    },
    setItem: (): void => {},
  };
}

/* =============================== THE ISLAND =============================== */

/** What the tab held when it was last sampled. `pending` is the state before it has been looked at. */
type HandOff =
  | { readonly status: "pending" }
  | {
      readonly status: "settled";
      readonly reading: ReadingResponse | null;
      readonly geometry: PothiSessionGeometry | null;
    };

/** Props of {@link PothiClient}. */
export interface PothiClientProps {
  /** Where a leaf's back arrow goes. The route knows its own parent; this component does not. */
  readonly backHref?: string;
}

/**
 * The Pothi's only client component, and the smallest one that could work.
 *
 * It does three things and holds no opinions: it reads the two hand-offs out of
 * the tab, it measures the device's rendering budget, and it hands both to
 * <PothiBook>. Every decision about what a leaf may say lives in
 * lib/sanctuary/pothi-chapters.ts, and every decision about how a leaf turns
 * lives in the book. Splitting it this way is what keeps <PothiBook> renderable
 * in a plain Node test: storage and `matchMedia` stop at this boundary.
 *
 * @returns the book once the tab has been read; `null` for the one frame before
 */
export function PothiClient({ backHref }: PothiClientProps): ReactElement | null {
  const capabilityTier = useCapabilityTier();
  const readingRaw = useSyncExternalStore(subscribeToTabStorage, readingSlot, unreadSlot);
  const geometryRaw = useSyncExternalStore(subscribeToTabStorage, geometrySlot, unreadSlot);

  /* Both hand-offs are parsed in one pass so a book can never render a reading
     whose geometry arrived a frame later — the plate would pop in beside a
     chapter that had already told the reader it had nothing measured. */
  const handOff = useMemo<HandOff>(() => {
    if (readingRaw === null || geometryRaw === null) return { status: "pending" };
    const snapshot = snapshotStorage(readingRaw, geometryRaw);
    return {
      status: "settled",
      reading: readPothiReading(snapshot),
      geometry: readPothiGeometry(snapshot),
    };
  }, [readingRaw, geometryRaw]);

  if (handOff.status === "pending") return null;

  return (
    <PothiBook
      reading={handOff.reading}
      geometry={handOff.geometry}
      capabilityTier={capabilityTier}
      sessionId={handOff.geometry?.sessionId}
      backHref={backHref}
    />
  );
}
