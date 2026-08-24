# Real frame fixtures

Exported camera frames that keep the palm-edge geometry honest. `test/real-fixtures.test.ts` picks up
**every** `frame-*.json` in this directory automatically, and passes quietly when there are none — a
fresh clone stays green without anyone committing camera frames to keep CI alive.

## Capturing one

1. `npm run dev`, open `/scan`, start the camera.
2. Hold the pose you want to test until the gate passes (the hint reads *"Bilkul sahi — hold karo"*).
3. Open **Debug — pipeline & gate** and press **Export frame**.
4. Two files download together: `frame-<ts>.png` and `frame-<ts>.json`. Drop **both** here.

The PNG is the raw, **unmirrored** camera frame — the same space the landmarks are normalised to, so
the JSON lines up with it pixel for pixel. The mirror is a display concern and is recorded as
`mirroredPreview` rather than baked into the image.

## What the JSON holds

```jsonc
{
  "imageW": 1280, "imageH": 720,
  "mirroredPreview": true,
  "handednessLabel": "Left", "handednessScore": 0.97,
  "landmarks":      [ /* 21 x {x,y,z}, normalised to the frame */ ],
  "worldLandmarks": [ /* 21 x {x,y,z}, metres, wrist at the origin */ ],
  "derived": { "p1": {}, "p2": {}, "percussionTop": {}, "edgeAxis": {}, "outward": {}, "peak": 0, "palmWidth": 0 },
  "anchorsUsed": 5,
  "gateVerdict": { /* the full QualityVerdict, checks and facing readout included */ }
}
```

## What the suite checks

- **Regression** — recomputing `derivePalmEdge` from the stored landmarks must reproduce the stored
  `derived` block. A mismatch means a constant or the construction moved since capture, which is the
  whole point of keeping these.
- **Plausibility** — every derived point lands inside the image and within 1.5 palm spans of the
  little knuckle.
- **Ordering** — the boundary walks the edge monotonically, without doubling back.

## Tuning against them

The debug panel also carries a **PALM_EDGE_PEAK** slider (dev builds only). Drag until the cyan
boundary sits on the fleshy outer edge of a real palm, then copy the printed value into
`lib/scan/landmarks.ts`. Export a frame at that setting so the choice is captured as a test.

Nothing here is uploaded anywhere; these files exist only because you put them here. They *are*
photographs of a hand, so committing them is a deliberate choice.
