# Phone scan, 2026-09-29: what the funnel says

**Evidence.** Two screen recordings of the live chamber (`/scan/chamber?cost=1`) on Srijan's phone, back camera, 390×850:

- `fixtures/private/video/phone-scan-2026-09-29-a.mp4`: 51.4 s, **right** hand (thumb on the image's right)
- `fixtures/private/video/phone-scan-2026-09-29-b.mp4`: 25.5 s, **left** hand (thumb on the image's left)

Every frame's readout says: build `70d61f7` (HEAD when recorded), `profile full (HIGH) 720×1280 · extract 700 ms`, camera `back` (not mirrored).

Frames were taken every 2 s (39 in all) with `ffmpeg -ss <t> -frames:v 1`. They are under `fixtures/private/frames/phone-scan-2026-09-29-{a,b}/`, with 3× readout crops in `readout/` and frame-plus-readout views in `composite/`. The folder is gitignored because the frames show the palm. Never commit it.

## Reading the readout

- **The funnel segment is the last CLOSED 10 s window** (`app/scan/chamber/chamber-client.tsx:560`). So it changes about once every 10 s and describes the ten seconds *before* the frame, not the frame itself. Rows that share a window repeat its numbers, and the `window` column names it. Approximate spans in recording time (±1 s, since frames are 2 s apart and the snapshot publishes once a second):
  - A0 and B0: −19…−9 s
  - A1 and B1: −9…+1 s. B1 is mostly the pause while the screen recorder started.
  - A2–A5: 1–11, 11–21, 21–31 and 31–41 s
  - B2–B3: 1–11 and 11–21 s
- **`palm px` is `palmSpan(landmarks) × videoWidth`** (`components/scan/use-hand-scan.ts:748`). That is the whole hand's largest normalised extent (here thumb to little finger) × **720**, the frame's full width. So 720 px means a hand exactly as wide as the frame. It is not the palm's own width.
- **`rejection reasons`** is the first failing gate of each rejected hand frame, in `HINT_ORDER` (`lib/scan/quality.ts:58`). In every window it sums to `hand − gates`.
- **`gates`** counts frames that passed every gate. **`held`** counts extractions after which the accumulator had the line `confirmed`.

## One row per frame

| t (s) | window | captured | hand | palm | gates | extractions | proposed | held | rejection reasons (first failing gate) | palm px median (min–max) | pose | build | on screen |
|---:|:--:|---:|---:|---:|---:|---:|:--|:--|:--|:--|:--|:--|:--|
| 0 | A0 | 173 | 0 | 0 | 0 | 0 | none | none | none | – | none | 70d61f7 | hand over-fills the screen, fingertips above the top; no lines; "Poora haath frame mein laao" |
| 2 | A1 | 119 | 77 | 77 | 0 | 0 | none | none | out_of_frame 76, fingers_curled 1 | 770 (643–912) | FLAT 77 | 70d61f7 | fingers cut off at the top; no lines |
| 4 | A1 | 119 | 77 | 77 | 0 | 0 | none | none | out_of_frame 76, fingers_curled 1 | 770 (643–912) | FLAT 77 | 70d61f7 | same |
| 6 | A1 | 119 | 77 | 77 | 0 | 0 | none | none | out_of_frame 76, fingers_curled 1 | 770 (643–912) | FLAT 77 | 70d61f7 | hand moving (blurred) |
| 8 | A1 | 119 | 77 | 77 | 0 | 0 | none | none | out_of_frame 76, fingers_curled 1 | 770 (643–912) | FLAT 77 | 70d61f7 | hand diagonal, very close |
| 10 | A1 | 119 | 77 | 77 | 0 | 0 | none | none | out_of_frame 76, fingers_curled 1 | 770 (643–912) | FLAT 77 | 70d61f7 | palm fills the screen |
| 12 | A2 | 118 | 115 | 112 | 0 | 0 | none | none | low_confidence 1, out_of_frame 107, not_palm_up 1, fingers_curled 6 | 755 (470–943) | FLAT 115 | 70d61f7 | palm fills the screen; thumb off the right edge |
| 14 | A2 | 118 | 115 | 112 | 0 | 0 | none | none | low_confidence 1, out_of_frame 107, not_palm_up 1, fingers_curled 6 | 755 (470–943) | FLAT 115 | 70d61f7 | hint "Ungliyan khol kar seedhi rakho" |
| 16 | A2 | 118 | 115 | 112 | 0 | 0 | none | none | low_confidence 1, out_of_frame 107, not_palm_up 1, fingers_curled 6 | 755 (470–943) | FLAT 115 | 70d61f7 | hint back to "Poora haath…" |
| 18 | A2 | 118 | 115 | 112 | 0 | 0 | none | none | low_confidence 1, out_of_frame 107, not_palm_up 1, fingers_curled 6 | 755 (470–943) | FLAT 115 | 70d61f7 | palm fills the screen (closest) |
| 20 | A2 | 118 | 115 | 112 | 0 | 0 | none | none | low_confidence 1, out_of_frame 107, not_palm_up 1, fingers_curled 6 | 755 (470–943) | FLAT 115 | 70d61f7 | whole hand; thumb off the right edge, fingertips at the top |
| 22 | A3 | 110 | 110 | 110 | 0 | 0 | none | none | out_of_frame 102, fingers_curled 8 | 718 (641–986) | FLAT 110 | 70d61f7 | same framing |
| 24 | A3 | 110 | 110 | 110 | 0 | 0 | none | none | out_of_frame 102, fingers_curled 8 | 718 (641–986) | FLAT 110 | 70d61f7 | same |
| 26 | A3 | 110 | 110 | 110 | 0 | 0 | none | none | out_of_frame 102, fingers_curled 8 | 718 (641–986) | FLAT 110 | 70d61f7 | thumb cut off at the right edge |
| 28 | A3 | 110 | 110 | 110 | 0 | 0 | none | none | out_of_frame 102, fingers_curled 8 | 718 (641–986) | FLAT 110 | 70d61f7 | same |
| 30 | A3 | 110 | 110 | 110 | 0 | 0 | none | none | out_of_frame 102, fingers_curled 8 | 718 (641–986) | FLAT 110 | 70d61f7 | **first lines**: heart + head drawn; ledger हृदय ✓ मस्तिष्क ✓; litany "पारंपरिक पाठ से मिलान…" |
| 32 | A4 | 100 | 100 | 100 | 0 | 3 | heart 3, head 2, fate 2 | heart 1, head 1 | out_of_frame 99, fingers_curled 1 | 771 (678–842) | FLAT 100 | 70d61f7 | heart, head, fate drawn; heart and head cross |
| 34 | A4 | 100 | 100 | 100 | 0 | 3 | heart 3, head 2, fate 2 | heart 1, head 1 | out_of_frame 99, fingers_curled 1 | 771 (678–842) | FLAT 100 | 70d61f7 | lines drawn |
| 36 | A4 | 100 | 100 | 100 | 0 | 3 | heart 3, head 2, fate 2 | heart 1, head 1 | out_of_frame 99, fingers_curled 1 | 771 (678–842) | FLAT 100 | 70d61f7 | lines drawn |
| 38 | A4 | 100 | 100 | 100 | 0 | 3 | heart 3, head 2, fate 2 | heart 1, head 1 | out_of_frame 99, fingers_curled 1 | 771 (678–842) | FLAT 100 | 70d61f7 | lines drawn |
| 40 | A4 | 100 | 100 | 100 | 0 | 3 | heart 3, head 2, fate 2 | heart 1, head 1 | out_of_frame 99, fingers_curled 1 | 771 (678–842) | FLAT 100 | 70d61f7 | lines drawn |
| 42 | A5 | 107 | 107 | 107 | 0 | 0 | none | none | out_of_frame 105, fingers_curled 2 | 788 (626–871) | FLAT 107 | 70d61f7 | lines drawn (held) |
| 44 | A5 | 107 | 107 | 107 | 0 | 0 | none | none | out_of_frame 105, fingers_curled 2 | 788 (626–871) | FLAT 107 | 70d61f7 | ledger adds शनि ✓; trace 43.1 → 18.1 ms (an extraction after A5 closed) |
| 46 | A5 | 107 | 107 | 107 | 0 | 0 | none | none | out_of_frame 105, fingers_curled 2 | 788 (626–871) | FLAT 107 | 70d61f7 | trace 15.4 ms (another) |
| 48 | A5 | 107 | 107 | 107 | 0 | 0 | none | none | out_of_frame 105, fingers_curled 2 | 788 (626–871) | FLAT 107 | 70d61f7 | lines drawn |
| 50 | A5 | 107 | 107 | 107 | 0 | 0 | none | none | out_of_frame 105, fingers_curled 2 | 788 (626–871) | FLAT 107 | 70d61f7 | hand gone; "Hatheli camera ke saamne laao" |
| 0 | B0 | 108 | 108 | 108 | 0 | 0 | none | none | out_of_frame 108 | 767 (645–857) | FLAT 108 | 70d61f7 | left hand; heart + fate drawn; no `rekha` segment, ledger all — |
| 2 | B1 | 166 | 26 | 26 | 0 | 0 | none | none | out_of_frame 26 | 759 (582–800) | FLAT 26 | 70d61f7 | same; thumb at the left edge |
| 4 | B1 | 166 | 26 | 26 | 0 | 0 | none | none | out_of_frame 26 | 759 (582–800) | FLAT 26 | 70d61f7 | hand a little farther, whole hand on screen |
| 6 | B1 | 166 | 26 | 26 | 0 | 0 | none | none | out_of_frame 26 | 759 (582–800) | FLAT 26 | 70d61f7 | same |
| 8 | B1 | 166 | 26 | 26 | 0 | 0 | none | none | out_of_frame 26 | 759 (582–800) | FLAT 26 | 70d61f7 | same |
| 10 | B1 | 166 | 26 | 26 | 0 | 0 | none | none | out_of_frame 26 | 759 (582–800) | FLAT 26 | 70d61f7 | `rekha` segment back, ledger all — |
| 12 | B2 | 100 | 100 | 100 | 0 | 0 | none | none | out_of_frame 100 | 710 (600–852) | FLAT 100 | 70d61f7 | heart + fate drawn |
| 14 | B2 | 100 | 100 | 100 | 0 | 0 | none | none | out_of_frame 100 | 710 (600–852) | FLAT 100 | 70d61f7 | same |
| 16 | B2 | 100 | 100 | 100 | 0 | 0 | none | none | out_of_frame 100 | 710 (600–852) | FLAT 100 | 70d61f7 | ledger हृदय ✓; heart redrawn as a zig-zag, fate gone; trace 22.7 → 16.5 ms |
| 18 | B2 | 100 | 100 | 100 | 0 | 0 | none | none | out_of_frame 100 | 710 (600–852) | FLAT 100 | 70d61f7 | same |
| 20 | B2 | 100 | 100 | 100 | 0 | 0 | none | none | out_of_frame 100 | 710 (600–852) | FLAT 100 | 70d61f7 | same |
| 22 | B3 | 96 | 96 | 96 | 0 | 2 | heart 1, head 1 | none | out_of_frame 95, fingers_curled 1 | 681 (658–723) | FLAT 96 | 70d61f7 | same |
| 24 | B3 | 96 | 96 | 96 | 0 | 2 | heart 1, head 1 | none | out_of_frame 95, fingers_curled 1 | 681 (658–723) | FLAT 96 | 70d61f7 | hand gone; held heart still drawn at the edge; "Hatheli camera ke saamne laao" |

**Totals over the nine windows with a hand** (A1–A5, B0–B3):

| Stage | Count |
|:--|:--|
| captured | 1,024 |
| hand found | 839 |
| palm-facing | 836 |
| **through the gates** | **0** |
| rectified | 330 |
| extractions | 5 (A4 3, B3 2), where the 700 ms cadence allows about 14 per window |

The first failing gate on those 839 hand frames: `out_of_frame` 818 (97.5 %), `fingers_curled` 19, `low_confidence` 1, `not_palm_up` 1.

## Other readings

- **The hand stages are healthy.** Hand found in ≥ 97 % of captured frames in every window where the reader was scanning (A2–A5, B0, B2, B3). Palm-facing accepted 836/839 on both hands through the back camera. Scan-gate G1's hand ≥ 90 % and palm ≥ 80 % bars are met; the loss is entirely at the gates.
- **The hint.** Every frame with a hand showed "Poora haath frame mein laao" (`out_of_frame`), except A 14 s ("Ungliyan khol kar seedhi rakho"). "Thoda door karo" (`too_close`) never appears, because `out_of_frame` comes before it in `HINT_ORDER`.
- **The pose never advanced.** It is FLAT in every window. The guided sequence only moves on gate-passing frames (`tickCapture(…, verdict.ok, …)`, `use-hand-scan.ts:1455`), so the capture never completed and no reading was built.
- **Lines were drawn anyway, from the ungated extraction path:**
  - 5 extractions ran in the displayed windows. At least 2 more ran in A's last window, which the recording ends before showing: trace 43.1 → 18.1 → 15.4 ms at about 43 s and 45 s.
  - The ledger showed हृदय ✓ मस्तिष्क ✓ from A 30 s, plus शनि ✓ from about 44 s, and हृदय ✓ from B 16 s.
  - B3's `held none` lags the ledger because `observe()` can confirm a line between extractions, while the funnel samples `held` only at extraction time.
  - In A, the heart and head traces are jagged and cross each other in an X across the upper palm, and the fate trace ends in a hook at the wrist. That is not the geometry of real creases.
  - In B, the heart trace lies near the upper transverse crease but zig-zags off it.
  - A 390-px screen recording can't support a pixel-level valley check.
  - The litany moved on to "पारंपरिक पाठ से मिलान…" on those lines while no frame had passed the gate.
- **Tilt** (FLAT has no tilt test): A (right hand) window medians +0.066 to +0.225; B (left hand) −0.247 to −0.293.
- **Cost:**
  - The loop runs at about 10–12 frames/s with a hand (96–119 captured per 10 s) and 17 without one (166–173).
  - The landmarker takes 40–60 ms per frame.
  - Overlay p95 is 0.9–2.3 ms. Worst was 194.4 ms in A's first windows, then 29.3 ms (A) and 20.2 ms (B).

## Root cause

**The phone scan dies at the quality gate, on `out_of_frame`, because the reader's hand is as wide as the portrait frame.** In all nine windows (839 hand frames, right hand and left, back camera), no frame passed the gates. 818 of them (97.5 %) were rejected first by `out_of_frame`, which fails if any of the 21 landmarks lies within 2 % of an edge (`lib/scan/quality.ts:511`). The `palm px` column shows why: it is the hand's largest normalised extent × the frame width (`components/scan/use-hand-scan.ts:748`), and its window medians of 681–788 px put the hand at 0.95–1.09 of a 720-px frame. The frames agree: the thumb runs off the side and the fingertips reach the top. Passing needs an extent ≤ 0.96 to clear the margins, and ≤ 0.86 to clear FLAT's `too_close` (`quality.ts:107`). Six of the nine windows never got below 0.86 (619 px), even at their minimum. The frame is this narrow because the back camera is asked for 1280×720 (`lib/scan/scan-profile.ts:38`), which a phone held upright delivers as 720×1280, so the hand's width has to fit the frame's short side. And because `out_of_frame` comes before `too_close` in `HINT_ORDER` (`quality.ts:61–67`), the reader saw "Poora haath frame mein laao" throughout and never "Thoda door karo", the one instruction that clears both. With no frame through the gate the guided capture cannot advance (`use-hand-scan.ts:1455–1465`): the pose stays FLAT in every window, and there are no features, no capture and no reading. This is not the tilt sign R1 changed: FLAT has no tilt test, and no frame ever reached a tilt pose. Nor do the lines on screen contradict it. Extraction is deliberately outside the gate (`use-hand-scan.ts:938–950`), so the heart, head and fate traces came from 5 extraction runs on these same over-framed, gate-rejected frames, and in A they visibly do not follow the creases.

## Not established by this evidence

- **Why masks so rarely became extractions.** There were 5 runs from 330 rectified crops, where the 700 ms cadence allows about 14 per window. The funnel has no stage between `rectified` and `extractions`. Three places in the code can drop a crop or its mask:
  - crop coverage below 0.6 (`use-hand-scan.ts:974`)
  - the worker still busy with the previous crop (`use-hand-scan.ts:1179`)
  - a mask arriving after an epoch or convention change (`use-hand-scan.ts:1231`, `1242`)

  An epoch reset is ruled out for A5 and B2. The lines stayed on screen with the hand present in every frame, but an other-hand reset clears them (`use-hand-scan.ts:703–707`), and a hand-loss reset needs 1.5 s without a hand.
- **How many frames also failed `too_close`.** The readout prints only the first failing gate. `window.__hrFunnel` carries the per-gate pass/fail table, and the rig reads it.
- **Lens and field of view.** The readout shows no track label or `getSettings()`. On most phones a 16:9 stream is a crop of a 4:3 sensor, which would narrow the upright frame's field of view further. The rig records both.
