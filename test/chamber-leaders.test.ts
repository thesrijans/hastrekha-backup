/* ============================================================================
 * THE LINE NAMES, AND WHERE THEY ARE ALLOWED TO SIT
 *
 * §6.3 asks for each detected line's Devanagari name on a thin gold leader,
 * "exactly like the reference", and for a line that was not found never to get
 * a label. Two of those three are checked here; the third — that the leader is
 * thin and gold rather than boxed — is a drawing decision and is pinned in the
 * overlay's own test.
 *
 * The interesting failure is not a label in the wrong place, it is two labels
 * in the SAME place. Four creases whose outer ends are within a few pixels of
 * each other produce four names written on top of one another, which is
 * illegible in a way that still looks deliberate in a screenshot.
 * ========================================================================== */
import assert from "node:assert/strict";
import {
  CHAMBER_LINE_NAMES,
  LEADER_GUTTER_PX,
  LEADER_MIN_GAP_PX,
  chamberLineName,
  placeLeaders,
} from "../lib/sanctuary/chamber-leaders";

let assertions = 0;
const ok = (condition: boolean, message: string): void => {
  assert.ok(condition, message);
  assertions += 1;
};

const BOX = { width: 390, height: 700 };
const line = (id: string, from: [number, number], to: [number, number]) => ({
  id,
  points: [
    { x: from[0], y: from[1] },
    { x: to[0], y: to[1] },
  ],
});

/* --------------------------- 1. The names exist --------------------------- */

{
  for (const [id, name] of Object.entries(CHAMBER_LINE_NAMES)) {
    ok(/^[ऀ-ॿ\s]+$/.test(name), `${id} is named in Devanagari and nothing else — the reference sets these in the reader's own script`);
  }
  ok(chamberLineName("heart") === "हृदय रेखा", "the heart line is हृदय रेखा");
  ok(chamberLineName("fate") === "शनि रेखा", "and the fate line is named for Saturn, the way the tradition names it");
  ok(
    chamberLineName("minor_unclassified") === null,
    "a class the chamber cannot name gets no label rather than a made-up one: an unclassified trace is exactly the thing A2 forbids captioning",
  );
  ok(chamberLineName("") === null && chamberLineName("toString") === null, "and no inherited property can be mistaken for a name");
}

/* ------------------- 2. A line that was not found is not named ------------ */

{
  ok(placeLeaders([], BOX).length === 0, "nothing found, nothing named");
  ok(
    placeLeaders([{ id: "heart", points: [{ x: 40, y: 40 }] }], BOX).length === 0,
    "a single point is not a line, and cannot carry a name — the same two-point floor the hand-off applies one layer up",
  );
  ok(
    placeLeaders([line("minor_unclassified", [40, 200], [300, 220])], BOX).length === 0,
    "and an unnameable class is dropped rather than labelled with its own id",
  );
}

/* ---------------------- 3. Sides, gutters and elbows ---------------------- */

{
  const placed = placeLeaders([line("life", [60, 300], [190, 355])], BOX);
  ok(placed.length === 1, "a found line is named");
  const leader = placed[0];
  ok(leader.side === "left", "a line whose outer end is on the left is named on the left");
  ok(leader.anchor.x === 60 && leader.anchor.y === 300, "the leader touches the OUTER end of the line, away from the crowded middle of the palm");
  ok(leader.label.x === LEADER_GUTTER_PX, "the name is set in the gutter, inside the canvas edge, where a phone cannot clip it");
  ok(leader.elbow.y === leader.anchor.y, "the leader leaves the line horizontally");
  ok(leader.elbow.x === leader.label.x, "and turns once, in the gutter's own column — never twice");

  const right = placeLeaders([line("heart", [340, 240], [200, 340])], BOX)[0];
  ok(right.side === "right" && right.label.x === BOX.width - LEADER_GUTTER_PX, "and a line reaching the right edge is named on the right");
}

/* ------------------ 4. Two names never land on each other ----------------- */

{
  /* Four creases all ending within a few pixels on the left: the crowded case. */
  const crowded = placeLeaders(
    [
      line("heart", [60, 300], [190, 350]),
      line("head", [62, 302], [190, 352]),
      line("life", [58, 304], [190, 354]),
      line("fate", [64, 306], [190, 356]),
    ],
    BOX,
  );
  ok(crowded.length === 4, "all four are still named: crowding is not a reason to drop a line the reader can see illuminated");
  const rows = crowded.map((l) => l.label.y).sort((a, b) => a - b);
  let clear = true;
  for (let i = 1; i < rows.length; i += 1) if (rows[i] - rows[i - 1] < LEADER_MIN_GAP_PX) clear = false;
  ok(clear, `no two names sit closer than ${LEADER_MIN_GAP_PX}px apart, so four creases ending together do not print four names on one another`);
  ok(
    crowded[0].label.y === crowded[0].anchor.y,
    "and the FIRST name found keeps the height of the line it names — a label that jumped whenever a later line arrived would be the busiest thing in a scene whose whole argument is stillness",
  );
  ok(
    crowded.every((l) => l.elbow.y === l.anchor.y),
    "every elbow still leaves at its own line's height, so a name pushed down is still visibly joined to its own crease",
  );
}

/* ----------------- 5. Left and right are separate columns ---------------- */

{
  const both = placeLeaders([line("life", [60, 300], [190, 350]), line("heart", [330, 300], [200, 345])], BOX);
  ok(both.length === 2, "a left name and a right name at the same height are two columns, not a collision");
  ok(both[0].label.y === 300 && both[1].label.y === 300, "so neither is pushed off the height of the line it names");
}

/* ------------------- 6. Nothing is written off the canvas ---------------- */

{
  const placed = placeLeaders(
    [
      line("heart", [60, 600], [190, 360]),
      line("head", [62, 660], [190, 360]),
      line("life", [58, 694], [190, 360]),
    ],
    BOX,
  );
  ok(
    placed.length === 2 && placed.every((l) => l.label.y <= BOX.height - LEADER_GUTTER_PX),
    "the two names that fit are placed and the one past the bottom edge is dropped rather than written off the screen: a name half out of frame is worse than no name",
  );
  ok(
    placeLeaders([line("life", [60, 2], [190, 350])], BOX).length === 0,
    "and the same at the top, where a name pushed off is gone rather than merely awkward",
  );
}

/* ------------- 7. A name touching its line needs no line to it ----------- */

{
  const touching = placeLeaders([line("life", [LEADER_GUTTER_PX + 4, 300], [190, 350])], BOX);
  ok(
    touching.length === 0,
    "a line whose end already sits in the gutter gets no leader: a two-pixel rule between a name and the thing it names is a rendering artefact, not a connection",
  );
}

console.log(`CHAMBER LEADERS ASSERTIONS PASSED (${assertions})`);
