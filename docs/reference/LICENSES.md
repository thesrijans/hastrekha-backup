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
6. Bake it into the three hand plates under `public/plates/hand-hologram/`,
   `public/plates/hand-plate/` and `public/plates/hand-tradition/`
   (`scripts/plates/bake-hand.mjs`, M1.1): the same mesh rendered by the
   room's own Three.js code in headless Chromium, encoded as AVIF + WebP at
   three densities by `scripts/plates/build-plates.mjs`. Each directory's
   `bake.json` records the mesh's SHA-256 and the registration the render was
   warped to. Derived works of the same CC0 source; no new licence attaches.

Measured on the committed files: 3,000 triangles, 53.7 kB, one connected
component, four fingers resolving separately, an opposing thumb 3.8× further
off the palm plane than the index, 40.0° abduction.

---

## `public/atlas/plates/*.png` · `public/atlas/plates/*.json`

**Asset** — the Rekha Atlas plates: 26 figures from two nineteenth- and
early-twentieth-century palmistry books, each a cropped, greyscale reduction of
one printed plate, with a sidecar giving its caption, page and scan location.
`data/atlas/atlas.json` points at them; it is our own derived data (the KB's
rules arranged per line, plus our drawings) and is not a third-party asset.

**Upstream** — two public-domain books, taken from the Internet Archive's
scans. The full record — every file's URL, size and SHA-256 — is rendered by
`atlas/acquire.py` into the lab repo's `atlas/LICENSES.md`.

| | Cheiro, *Palmistry for All* | Mrs. J. B. Dale, *Indian Palmistry* |
|---|---|---|
| Published | G. P. Putnam's Sons, New York and London, May 1916 (the scanned copy is a later impression of that edition) | Theosophical Publishing Society, London, 1895 |
| Record | `https://archive.org/details/palmistryforall00cheigoog` | `https://archive.org/details/indianpalmistry00daleiala` |
| Archive status | `possible-copyright-status: NOT_IN_COPYRIGHT` | `possible-copyright-status: NOT_IN_COPYRIGHT` |
| Files used | `palmistryforall00cheigoog.pdf` (4,905,780 B, SHA-256 `842b5b651a25b9dcaa9d82d03f41eb095ec728ea264fda54a6d3cd65e69c949f`), with page images from the archive's renderer of that PDF | `indianpalmistry00daleiala_jp2.zip` (16,574,457 B, SHA-256 `59f489d78d63fe0d8330211697f7410f666669ef081ee1a105001c56e538beb7`) |
| Retrieved | 21 September 2026 | 21 September 2026 |
| Licence | **Public domain** | **Public domain** |

### Why public domain

- **Cheiro** (William John Warner, 1866–1936). The book was first published in
  the United States in 1916, and US copyright in works published before 1931
  has expired. The author died in 1936, so the work is also out of copyright
  in life+70 countries (since 2007) and in India (life+60, since 1997). The
  scanned copy is a 1978 University Microfilms xerographic facsimile of a
  later impression; a photographic facsimile adds no authorship.
- **Dale.** Published in 1895, so out of US copyright. The author's death date
  is not recorded, but a life+70 term would still be running only if she had
  died after 1955 — sixty years after publishing this book. The same text is
  also distributed as public domain by Project Gutenberg (#52523), and the
  KB's Dale rules cite that edition.

Caption text for the Cheiro plates is taken from Project Gutenberg #20480, a
transcription of the same edition (`https://archive.org/details/palmistryforall20480gut`,
"Public domain in the USA"); only the words are used, not the eBook file.

### What we did to them

`atlas/plates.py` in the lab finds each figure on its scanned page. It blanks
the running text using the OCR's own line boxes, keeps the large ink blobs
that remain, and trims off the printed caption. `atlas/export.py` then reduces
each crop to a 16-level greyscale PNG no larger than 120 kB. Nothing is drawn
on or retouched. Every plate is the printed figure, only cropped and reduced.

---

## Assets already in the tree, recorded for completeness

| Asset | Origin | Licence |
|---|---|---|
| `public/models/hand_landmarker.task` | Google MediaPipe hand landmarker | Apache-2.0 (MediaPipe model bundle) |
| `public/models/hand_landmarker_lite.task` | Rebuilt from Google MediaPipe models by `scripts/models/build-hand-landmarker-lite.py`: the shipped bundle's palm detector, byte-for-byte, and the `mediapipe` wheel's `hand_landmark_lite.tflite` with the shipped landmark model's metadata grafted on | Apache-2.0 (MediaPipe models) |
| `public/models/palm-lines.onnx` | Trained in this project's lab repo | Ours |
| `docs/reference/*.png`, `*.webp` | Art direction references and captures made for this project | Ours, or captures of our own UI |

The MediaPipe entry records what is believed true of a file that predates this
document; anyone changing it should verify against Google's own licence page
rather than trusting this row.
