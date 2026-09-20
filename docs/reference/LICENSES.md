# Licences for third-party assets

Every asset in this repository that someone else made is recorded here, with
the licence, the exact source, and enough detail to re-derive or re-verify it.
Amendment 1 of the U3b brief requires it for the hand mesh; the file is the
place for any asset that follows.

An entry is only valid if the licence can be checked from a primary source —
the project's own repository or site, not a marketplace listing or a summary.
"Probably CC0" is not a licence.

---

## `public/models/hand.glb` · `public/models/hand.landmarks.json`

**Asset** — the hologram's hand, and the 21 joint centres that go with it.

**Upstream** — the MakeHuman base mesh.

| | |
|---|---|
| Project | MakeHuman (makehumancommunity) |
| Source URL | `https://raw.githubusercontent.com/makehumancommunity/makehuman/master/makehuman/data/3dobjs/base.obj` |
| Retrieved | 21 September 2026 |
| SHA-256 of the bytes used | `8e761e6624b8f54536409135d1636da63b32486a90d4897f84e121d144f6fb4c` |
| Size retrieved | 1,749,303 bytes (19,158 vertices, 18,486 faces) |
| Licence | **CC0 1.0 Universal** (public domain dedication) |
| Licence URL | `https://github.com/makehumancommunity/makehuman/blob/master/LICENSE.ASSETS.md` |

### The licence, verbatim

From the project's `LICENSE.md`, defining what counts as an asset:

> The assets are defined as any data contributing to the graphical output of
> MakeHuman. This includes:
>
> * The base mesh and proxies
> * Targets and modifiers
> * Textures
> * Clothes (any MHCLO-based asset)
> * Poses and expressions

and dedicating them:

> These assets have been released under CC0 1.0 Universal. In summary this
> means that to the fullest extent possible, it is the intention of the
> MakeHuman project that anyone can do whatever they wants with it.

`LICENSE.ASSETS.md` in the same repository carries the full, standard text of
the Creative Commons CC0 1.0 Universal Public Domain Dedication.

The downloaded file repeats the dedication in its own header, which is the
strongest form of the evidence because it travels with the bytes:

> This asset was explicitly released as CC0 in september 2020. The license
> text for CC0 can be found in the root of this repository.
>
> The copyright holders at the point of the release to CC0 were:
>
> Copyright (C) 2020 Data Collection AB, https://www.datacollection.se
> Copyright (C) 2020 Joel Palmius
> Copyright (C) 2020 Jonas Hauquier

CC0 waives copyright to the extent possible and requires no attribution. This
entry exists because the repository should be able to answer where its bytes
came from, not because the licence demands a credit.

### What we did to it

`scripts/models/extract_hand.py` re-derives the committed files from the URL
above; `scripts/models/check_hand.py` scores the result, and
`scripts/models/preview_hand.py` renders it to look at. In order:

1. Cut the right hand from the body at the wrist, along the elbow-to-wrist
   axis, keeping a short cuff.
2. Keep only the connected component holding the hand — the plane alone also
   catches both legs and both feet.
3. Pose the thumb from MakeHuman's resting 27° of abduction to the 40°
   Amendment 1 asks for, soft-bound so the web stretches rather than tears.
4. Decimate to 3,000 triangles, centre, and normalise to unit extent.
5. Export `hand.glb` (54,948 B) and the 21 joint centres as
   `hand.landmarks.json`, in the same frame.

Measured on the committed files: 3,000 triangles, 53.7 kB, one connected
component, four fingers resolving separately, an opposing thumb 3.8× further
off the palm plane than the index, 40.0° abduction.

---

## Assets already in the tree, recorded for completeness

| Asset | Origin | Licence |
|---|---|---|
| `public/models/hand_landmarker.task` | Google MediaPipe hand landmarker | Apache-2.0 (MediaPipe model bundle) |
| `public/models/palm-lines.onnx` | Trained in this project's lab repo | Ours |
| `docs/reference/*.png`, `*.webp` | Art direction references and captures made for this project | Ours, or captures of our own UI |

The MediaPipe entry records what is believed true of a file that predates this
document; anyone changing it should verify against Google's own licence page
rather than trusting this row.
