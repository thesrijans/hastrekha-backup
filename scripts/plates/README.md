# Plates — the pre-rendered layers of the sanctuary

A **plate** is one flat, pre-rendered image that stands in for geometry the browser should never
have to draw. §6.2 of `docs/specs/ui-sanctuary-spec.md` builds the sanctuary out of five stacked
layers and marks three of them as plates:

```
LAYER 4 (far)   library architecture, arched window, moon, shelved bundles   ← plate
LAYER 3 (mid)   the brass pedestal + hologram cylinder                        live
LAYER 3 (mid)   the open manuscript on the right                              live
LAYER 2 (near)  candles, crystals, brass instruments, stacked books          ← plate
LAYER 1 (dust)  drifting gold particles, incense haze                        ← plate
```

Only the pedestal and the book are interactive. Everything else is an image that drifts a few
pixels against pointer and device tilt, which is what buys the depth without buying a scene graph.

---

## The hard fact about Blender

**There is no Blender automation in this project, or in reach of it.**

The spec (§6.2) says the plates are "Blender via the showcase3d toolkit". Measured, 7 Sep 2026,
that toolkit does not exist and never did:

| What was checked | What is actually there |
|---|---|
| `C:/Projects/showcase3d/worker/worker.py` | A queue worker: polls Postgres for jobs, downloads photos/video from Cloudinary, produces a **GLB**, uploads it back. |
| `C:/Projects/showcase3d/worker/box_pipeline.py` | Photogrammetry: `frames → box-quad detection → sharpest-frame selection → ECC alignment + median merge → six-face textured GLB`. |
| `blender` across `showcase3d/worker` and `showcase3d/src` | Zero hits in `worker/`. In `src/` it appears only as a **coordinate-system comment** — `PlayScene.tsx:475` "Blender is Z-up; the glTF exporter maps (x, y, z) → (x, z, -y)" — describing assets someone authored elsewhere and exported by hand. |

showcase3d runs **photos → 3D**. Plates need **3D → image**. It is the opposite direction, and
nothing in it can be pointed at a `.blend` file.

So: **plate authoring is a manual Blender export.** A human opens the scene, renders a layer, saves
a PNG or TIFF. `build-plates.mjs` starts from that file. It does not drive Blender, and it will not
pretend to — a script that silently produced nothing while claiming a render happened is exactly
the kind of confident lie §11 exists to prevent.

If plate authoring is ever automated, the piece to build is a headless `blender -b scene.blend -o …`
wrapper that emits the source render; this script stays as the encode step behind it.

---

## The flow

```
   Blender (by hand)              build-plates.mjs                  ScenePlate
┌────────────────────┐        ┌──────────────────────┐        ┌───────────────────┐
│ render one layer,  │  PNG   │ resize ×1/×2/×3      │ AVIF   │ <picture>         │
│ alpha where the    │ ─────► │ encode AVIF + WebP   │ ─────► │  <source avif>    │
│ layer should be    │  TIFF  │ measure every byte   │ WebP   │  <source webp>    │
│ transparent        │        │ write manifest.json  │ +JSON  │  <img fallback>   │
└────────────────────┘        └──────────────────────┘        └───────────────────┘
     docs/renders/                                              public/plates/<id>/
     (not committed)
```

### 1. Render, by hand

- One layer per render. Do not bake the pedestal into the far plate — it is live.
- Transparent where the layer should not occlude what is behind it (`near` and `dust` especially).
  PNG or TIFF with alpha; the encoders carry it through.
- Render at **at least 3× the intended 1× width**. The script refuses to upscale: a 3× density
  invented out of a 1× render is a blurrier file that costs more bytes than the one it replaced.
- §3 light discipline applies to the render, not just the CSS: **one warm point source per scene**,
  every rim and shadow agreeing with it; a second light only as cold moonlight at ≤25%.
- Keep sources out of `public/`. `docs/renders/` or outside the repo — they are large and they are
  not shipped.

### 2. Encode

```sh
node scripts/plates/build-plates.mjs \
  --in docs/renders/sanctuary-far.png \
  --out public/plates/sanctuary-far \
  --name sanctuary-far \
  --layer far \
  --width 960 \
  --alt "The library wall of the sanctuary, an arched window and the moon behind shelved bundles."
```

| Flag | Meaning |
|---|---|
| `--in` | Source render. Read only, never written to. Omit with `--placeholder`. |
| `--out` | Output directory. **Must be inside `public/`** — the manifest stores root-relative URLs. |
| `--name` | Plate id, and the file stem: `<name>-1x.avif`, `<name>-2x.webp`, … |
| `--layer` | `far` \| `mid` \| `near` \| `dust`. Drives the parallax depth factor and the z-index. |
| `--width` | The **1× CSS width** in px. 2× and 3× are derived; height comes from the source aspect. |
| `--alt` | Required. A plate with no alt text is a room a screen reader cannot enter. |
| `--placeholder` | Synthesises the source in memory (stone ground, one warm falloff, vignette) instead of reading one. |

It prints the byte size of **every** file it writes, because §10 budgets plates and a number nobody
prints is a number nobody holds.

**Idempotent.** Both encoders are deterministic, so re-running over the same source with the same
flags rewrites byte-identical files and an identical manifest — verified by hashing the directory
before and after a second run. Safe in a loop, safe in CI, and a clean `git status` afterwards is
real information rather than luck.

**It refuses, loudly, when:** the source is missing; the source sits inside `--out` (it would
overwrite itself); `--out` is outside `public/`; `--layer` is not one of the four; the source is
narrower than the requested 3× width.

### 3. Consume

```tsx
import manifestJson from "@/public/plates/sanctuary-far/manifest.json";
import { isPlateManifest } from "@/lib/sanctuary/plate-manifest";
import { ScenePlate } from "@/components/sanctuary/scene-plate";

if (!isPlateManifest(manifestJson)) throw new Error("plate manifest is malformed");

<ScenePlate manifest={manifestJson} capability={capability} priority />;
```

`isPlateManifest` is not ceremony. The manifest is JSON written by a script a human ran by hand
after a manual export; the failure it catches — a missing 3× entry, a duplicated scale, an empty
path — renders blank or blurry on precisely the hardware nobody tested.

`priority` goes on the **current camera only** (§10). It sets `fetchpriority="high"` and eager
loading; every other plate stays lazy. Marking all of them high-priority is the same as marking
none of them.

---

## Encoding choices, and why

| Choice | Reason |
|---|---|
| AVIF first, WebP fallback | §10. AVIF holds smooth dark gradients — which is most of this art direction — at a fraction of WebP's bytes without the banding. |
| `chromaSubsampling: "4:4:4"` on both | The sanctuary is gold linework (`#C9A24B`) on near-black stone (`#0D0B09`). Subsampled chroma smears a 1px gold stroke into mud. Costs bytes; buys the only colour that matters. |
| AVIF q58 / WebP q82, effort 6 | Effort 9 roughly triples encode time for low single-digit percent. These plates are authored by hand, rarely, so the loop stays fast enough to iterate on. |
| `lanczos3`, `fit: "fill"` | The source aspect is already the target aspect (height is derived from it), so `fill` never distorts, and lanczos keeps thin strokes from dissolving on the downscale. |
| Density descriptors, not widths | A plate is a full-bleed backdrop whose CSS size is the stage. The browser's only real question is how many device pixels that stage has. |
| `bytes` records the **AVIF** size | It is the payload a real user downloads; AVIF is the first `<source>` and WebP only serves browsers that cannot decode it. Budgeting the fallback would double-count a transfer that never happens. The WebP size is printed at build time regardless. |

---

## The placeholder

`public/plates/placeholder/` exists so `<ScenePlate>` has something real to render, and
`test/scene-plate.test.ts` has something real to validate, before any Blender scene exists. It was
made by the script itself:

```sh
node scripts/plates/build-plates.mjs \
  --placeholder --out public/plates/placeholder --name placeholder --layer far --width 640 \
  --alt "Sanctuary stone wall in candlelight — a placeholder ground until the Blender plates are rendered."
```

A `#0D0B09` (`--stone-800`) ground, one warm `#E08A2E` (`--flame-warm`) falloff at 34%/62% — §3
allows exactly one warm point source per scene — and a `#0A0806` (`--stone-900`) vignette. 640×360,
1280×720, 1920×1080. 8,344 B of AVIF across all three densities, of which one is ever fetched.

Replace it the moment a real far plate exists. It is a stand-in for a room, not a room.
