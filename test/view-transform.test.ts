import assert from "node:assert/strict";
import { coverTransform, videoNormToCanvas, videoPxToCanvas, videoToCanvas } from "../lib/scan/view-transform";
import type { Point2 } from "../lib/scan/types";

const close = (a: number, b: number, eps = 1e-9): boolean => Math.abs(a - b) < eps;

/**
 * The invariants that define object-fit: cover, checked for every aspect pairing:
 *  - one axis fits the canvas exactly, the other overflows symmetrically;
 *  - the scale is uniform (cover never stretches);
 *  - the video centre lands on the canvas centre, mirrored or not;
 *  - mirroring reflects x about the canvas midline and leaves y alone.
 */
function checkCoverInvariants(videoW: number, videoH: number, canvasW: number, canvasH: number): void {
  const label = `${videoW}x${videoH} -> ${canvasW}x${canvasH}`;
  const t = coverTransform(videoW, videoH, canvasW, canvasH, false);
  assert.ok(t !== null, `${label}: transform exists`);

  /* Uniform scale: a unit step in video x and a unit step in video y scale identically. */
  const origin = videoPxToCanvas(t, { x: 10, y: 10 });
  const stepX = videoPxToCanvas(t, { x: 11, y: 10 });
  const stepY = videoPxToCanvas(t, { x: 10, y: 11 });
  assert.ok(close(stepX.x - origin.x, t.scale), `${label}: x scales uniformly`);
  assert.ok(close(stepY.y - origin.y, t.scale), `${label}: y scales uniformly`);

  /* Centre → centre. */
  const centre = videoNormToCanvas(t, { x: 0.5, y: 0.5 });
  assert.ok(close(centre.x, canvasW / 2) && close(centre.y, canvasH / 2), `${label}: centre maps to centre`);

  /* Cover: each axis either fits exactly (offset 0) or overflows symmetrically (offset < 0). */
  assert.ok(t.offsetX <= 1e-9 && t.offsetY <= 1e-9, `${label}: cover never letterboxes`);
  assert.ok(close(t.offsetX, 0) || close(t.offsetY, 0), `${label}: at least one axis fits exactly`);
  const topLeft = videoNormToCanvas(t, { x: 0, y: 0 });
  const bottomRight = videoNormToCanvas(t, { x: 1, y: 1 });
  assert.ok(close(topLeft.x, t.offsetX) && close(topLeft.y, t.offsetY), `${label}: (0,0) lands on the offsets`);
  assert.ok(close(bottomRight.x, canvasW - t.offsetX), `${label}: overflow is symmetric in x`);
  assert.ok(close(bottomRight.y, canvasH - t.offsetY), `${label}: overflow is symmetric in y`);

  /* Mirroring: x reflects about the canvas midline, y is untouched, centre stays put. */
  const m = coverTransform(videoW, videoH, canvasW, canvasH, true);
  assert.ok(m !== null);
  const probes: Point2[] = [
    { x: 0, y: 0 },
    { x: 1, y: 1 },
    { x: 0.2, y: 0.7 },
    { x: 0.9, y: 0.1 },
  ];
  for (const p of probes) {
    const plain = videoNormToCanvas(t, p);
    const mirrored = videoNormToCanvas(m, p);
    assert.ok(close(mirrored.x, canvasW - plain.x), `${label}: mirror reflects x for (${p.x},${p.y})`);
    assert.ok(close(mirrored.y, plain.y), `${label}: mirror leaves y alone for (${p.x},${p.y})`);
  }
  const mirroredCentre = videoNormToCanvas(m, { x: 0.5, y: 0.5 });
  assert.ok(close(mirroredCentre.x, canvasW / 2), `${label}: mirrored centre stays centred`);
}

/* All four aspect combinations, mirrored both ways inside the checker. */
checkCoverInvariants(1280, 720, 300, 400); // landscape video into portrait canvas (crops left/right)
checkCoverInvariants(1280, 720, 640, 360); // matching aspect (no crop at all)
checkCoverInvariants(720, 1280, 400, 300); // portrait video into landscape canvas (crops top/bottom)
checkCoverInvariants(500, 500, 250, 250); // square into square

/* Exact numbers for the case the scan page actually hits: 1280x720 camera in a 300x400 box. */
{
  const t = coverTransform(1280, 720, 300, 400, false);
  assert.ok(t !== null);
  assert.ok(close(t.scale, 400 / 720), "scale is the covering ratio (height fits)");
  assert.ok(close(t.offsetY, 0), "no vertical crop");
  assert.ok(close(t.offsetX, (300 - 1280 * (400 / 720)) / 2), "horizontal overflow split evenly");
  assert.ok(t.offsetX < -200, "and it is a large crop — the fill mapping was hiding ~2/3 of the width error");
}

/* The one-shot form matches the precomputed-transform form. */
{
  const oneShot = videoToCanvas({ x: 0.3, y: 0.6 }, 1280, 720, 300, 400, true);
  const t = coverTransform(1280, 720, 300, 400, true);
  assert.ok(oneShot !== null && t !== null);
  const viaTransform = videoNormToCanvas(t, { x: 0.3, y: 0.6 });
  assert.ok(close(oneShot.x, viaTransform.x) && close(oneShot.y, viaTransform.y), "videoToCanvas agrees with the hot-loop path");
}

/* Degenerate dimensions: a video element before loadedmetadata reports 0x0. */
{
  assert.equal(coverTransform(0, 720, 300, 400, false), null, "zero video width is refused");
  assert.equal(coverTransform(1280, 0, 300, 400, false), null, "zero video height is refused");
  assert.equal(coverTransform(1280, 720, 0, 400, false), null, "zero canvas width is refused");
  assert.equal(videoToCanvas({ x: 0.5, y: 0.5 }, 1280, 720, 300, 0, false), null, "one-shot form refuses too");
  assert.equal(coverTransform(Number.NaN, 720, 300, 400, false), null, "NaN dims are refused");
}

console.log("VIEW TRANSFORM ASSERTIONS PASSED");
