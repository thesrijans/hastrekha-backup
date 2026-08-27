# Ground truth for the reference frames

Hand-traced creases in **canonical crop fractions** (0–1, the space `rectifyPalm` produces), so a
comparison against the detector is a comparison in the space the detector actually works in.

## How these were made, and what that limits

Traced by eye from the rectified crop rendered at 640px with a contrast stretch. Two honest caveats,
both of which bound how much weight these can carry:

1. **The overlay occludes the evidence.** These frames are screenshots with the scan's own overlay
   burned in, and the orange traces sit *on top of* the creases they were drawn from. Where a trace
   covers a crease, the crease underneath cannot be seen — so the ground truth for exactly the
   stretches the detector found is the least reliable part of it. This is circular in the worst
   direction: it is easiest to "verify" the detector where the detector has painted over the answer.
2. **Positional uncertainty is roughly ±0.02 of the crop** (about 2.5px at 128²), which is comparable
   to a crease's own width. Differences below that are not measurements.

The fix for both is the raw-frame export that already exists in the debug panel — PNG plus the
derived JSON, with no overlay. Everything here should be replaced by traced raw exports as soon as
there are some.

## Fields

- `lines[].id` — the class it should be assigned to
- `lines[].points` — `[x, y]` in 0–1 crop fractions
- `lines[].confidence` — how sure the tracing is: `clear`, `faint`, `occluded`
- `geometryValid` — false when the rectification itself is wrong, so canonical-space comparison is
  meaningless for that frame (see `lines-misplaced-05`)
