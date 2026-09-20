/* ============================================================================
 * THE HOLOGRAM'S HAND IS A REAL MESH, AND ITS LICENCE IS ON RECORD
 *
 * Amendment 1 of the U3b brief is blunt about this: the hologram hand and the
 * book's palm illustration use a genuine hand mesh, "never a drawn outline",
 * and any borrowed mesh must carry a verifiable licence. Two things can go
 * wrong quietly and this guards both.
 *
 * THE BUDGETS, because a mesh is the easiest asset in a project to grow. The
 * ceilings are 3,000 triangles and 60 kB, and the file lands at 3,000 and
 * 53.7 kB — close enough that a re-export at a different setting would sail
 * past them unnoticed. A byte count in CI is what catches that.
 *
 * THE PROVENANCE, because a binary in public/ carries no history. The record
 * in docs/reference/LICENSES.md has to keep naming a licence, a source and the
 * SHA-256 of the bytes it was derived from; if someone swaps the mesh and
 * leaves the record, this fails rather than letting the repository claim
 * something about bytes that are no longer there.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO is judge whether the thing looks like a
 * hand. That is scripts/models/check_hand.py, which measures knuckles, the
 * thenar bulge, thumb abduction and finger separation against the landmarks,
 * and scripts/models/preview_hand.py, which renders it to be looked at. A
 * geometry assertion here would be a worse copy of the first and no substitute
 * for the second.
 * ========================================================================== */
import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import path from "node:path";

let assertions = 0;
const ok = (condition: boolean, message: string): void => {
  assert.ok(condition, message);
  assertions += 1;
};

const ROOT = path.resolve(__dirname, "..");

/** Amendment 1's ceilings, and the SHA-256 the licence record is pinned to. */
const MAX_TRIS = 3000;
const MAX_BYTES = 60 * 1024;
const SOURCE_SHA256 = "8e761e6624b8f54536409135d1636da63b32486a90d4897f84e121d144f6fb4c";

/* ============================== 1. The mesh =============================== */

{
  const glb = path.join(ROOT, "public", "models", "hand.glb");
  const size = statSync(glb).size;
  ok(size > 0, "public/models/hand.glb exists");
  ok(size <= MAX_BYTES, `and is within Amendment 1's 60 kB ceiling (${(size / 1024).toFixed(1)} kB)`);

  const bytes = readFileSync(glb);
  ok(bytes.subarray(0, 4).toString("ascii") === "glTF", "and is a binary glTF, not an OBJ or a renamed something-else");

  // glTF 2.0 binary: magic, version, length, then a JSON chunk.
  const version = bytes.readUInt32LE(4);
  ok(version === 2, `at glTF version 2 (found ${version})`);

  const jsonLength = bytes.readUInt32LE(12);
  const json = JSON.parse(bytes.subarray(20, 20 + jsonLength).toString("utf8")) as {
    meshes?: { primitives: { indices?: number }[] }[];
    accessors?: { count: number }[];
  };
  const primitive = json.meshes?.[0]?.primitives?.[0];
  ok(primitive !== undefined, "with one mesh carrying one primitive");

  const indices = primitive?.indices;
  const count = indices === undefined ? 0 : (json.accessors?.[indices]?.count ?? 0);
  ok(count > 0 && count % 3 === 0, `whose index count is whole triangles (${count} indices)`);
  ok(count / 3 <= MAX_TRIS, `and within the 3,000 triangle ceiling (${count / 3} triangles)`);
}

/* ============================ 2. The landmarks ============================ */

{
  const file = path.join(ROOT, "public", "models", "hand.landmarks.json");
  const marks = JSON.parse(readFileSync(file, "utf8")) as {
    wrist: number[];
    fingers: number[][][];
    frame?: string;
    source?: string;
  };

  ok(Array.isArray(marks.wrist) && marks.wrist.length === 3, "the landmarks carry a wrist point");
  ok(marks.fingers.length === 5, "and five fingers");
  ok(
    marks.fingers.every((finger) => finger.length === 4 && finger.every((point) => point.length === 3)),
    "each of four joints in three dimensions — the 21-landmark topology the scan pipeline already speaks",
  );
  ok(
    marks.fingers.flat(2).every((value) => Number.isFinite(value)),
    "with no NaN from a failed transform",
  );
  ok(
    typeof marks.frame === "string" && marks.frame.includes("hand.glb"),
    "and a note that they share the mesh's frame, since a landmark in another frame is worse than none",
  );
}

/* =========================== 3. The licence record ======================== */

{
  const record = readFileSync(path.join(ROOT, "docs", "reference", "LICENSES.md"), "utf8");

  ok(record.includes("hand.glb"), "LICENSES.md records the hand mesh");
  ok(record.includes("CC0 1.0 Universal"), "names the licence in full");
  ok(
    record.includes("makehumancommunity/makehuman"),
    "names the upstream project, so the claim can be checked at its source",
  );
  ok(record.includes(SOURCE_SHA256), "and pins the SHA-256 of the bytes it was derived from");
  ok(
    record.includes("These assets have been released under CC0 1.0 Universal"),
    "quoting the dedication verbatim rather than paraphrasing it",
  );
  ok(
    /scripts[/\\]models[/\\]extract_hand\.py/.test(record),
    "and points at the script that re-derives the mesh, so the record is reproducible rather than a promise",
  );
}

console.log(`HAND MESH ASSERTIONS PASSED (${assertions})`);
