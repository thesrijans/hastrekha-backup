/**
 * The only module that imports data/kb/hastrekha_upay.json and its index. Server-side. The source pages
 * (hastrekha_upay.source-pages.json) are test data and are imported by nothing.
 */
import upayDocument from "@/data/kb/hastrekha_upay.json";
import upayIndexDocument from "@/data/kb/hastrekha_upay.index.json";
import { parseUpayData, type UpayData } from "./upay-data";

let cached: UpayData | null = null;

/** Parses and validates once per process; throws UpayValidationError if the committed data is malformed. */
export function loadUpay(): UpayData {
  if (cached === null) cached = parseUpayData(upayDocument);
  return cached;
}

/** The embedding index as typed arrays, or null if the export carried none. */
export function loadUpayEmbedding(): { ids: string[]; dim: number; vectors: Int8Array; model: Record<string, unknown> } | null {
  const embedding = (upayIndexDocument as { embedding: null | { ids: string[]; dim: number; vectors: string; model: Record<string, unknown> } }).embedding;
  if (embedding === null) return null;
  const bytes = Buffer.from(embedding.vectors, "base64");
  return { ids: embedding.ids, dim: embedding.dim, vectors: new Int8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength), model: embedding.model };
}
