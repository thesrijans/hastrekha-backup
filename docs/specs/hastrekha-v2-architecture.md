# HastRekha v2 — Palm Intelligence Architecture

**Status:** proposal, 3 Sep 2026
**Where we stand (measured):** shipped detector F1@6px 0.26, detection 67%, four lines, breaks structurally zero, two reference fixtures. Full-hand framing lifts detection to 100% at the cost of precision. Nothing is wired live yet.

---

## 0. The principle: reliability tiers

A reading is only as good as its weakest input, and today the inputs differ by an order of magnitude in reliability. Hand geometry from 21 landmarks is stable to a few percent frame to frame. Major creases localise to 6 px when the pipeline behaves and 30 px when it doesn't. Minor lines, marks and mounts are not detected at all.

So v2 is organised by tier, each rule in the KB is tagged with the tier of its inputs, and the reading engine composes across tiers with per-rule confidence. The user sees a reading that is strong where the evidence is strong and phrased as tendency where it isn't, and "Why HastRekha says this" shows exactly which is which. No competitor does this; they send a photo to an LLM.

| Tier | Input | Reliability today | Status |
|---|---|---|---|
| A | Hand geometry (chirognomy) from landmarks | High | Not built. Fastest win. |
| B | Major creases (heart, head, life, fate) | Medium, improving | Current sprint |
| C | Minor lines, marks, mounts | None | Needs GT + detection |
| D | Crease depth, both hands, change over time | R&D | Later |

---

## 1. Tier A — Chirognomy engine (`lib/hand/geometry.ts`)

Everything classical palmistry says about hand *shape* is measurable from MediaPipe's 21 landmarks, and the world-coordinate set is metric and wrist-origin, so ratios are scale-free and view-robust.

**Features (all ratios, all unitless):**

- Finger lengths per phalanx and total, from world landmarks; index/ring (2D:4D), middle/palm-length, pinky/ring, thumb/index.
- Palm length (wrist → middle MCP) vs palm width (index MCP → pinky MCP) → shape class: square / oblong / spatulate / conic / psychic per the KB's own taxonomy, with soft membership rather than a hard label.
- Thumb: length relative to index, angle of opening at rest (flexibility), tip-to-index-base distance.
- Finger spacing at rest (openness), ring/index divergence.
- Finger straightness (deviation of PIP/DIP from the MCP–tip axis).
- Per-feature confidence = 1 − (std over the last 30 sharp frames / mean). A trembling or half-curled hand produces low confidence, not a wrong label.

**Why first:** the KB reachability audit (§7) will put a number on it, but Cheiro and Dale key a large fraction of character, career and relationship rules on hand and finger type. These rules can fire today with no detection risk, which means dhan/rishte/swabhav stop being empty while the crease work continues.

**Build:** pure module, worker-free, consumes the observation the client already has, emits `HandGeometryFeatures` with confidence. Tests on synthetic landmark sets with known ratios. One week.

---

## 2. Tier B — Major creases on a reconstruction, not a frame

The current pipeline detects on every frame and averages afterwards. Invert it.

**Canonical reconstruction.** Register N sharp frames into palm-quad canonical space (the evidence accumulator's translation compensation, upgraded to the full homography residual), average the illumination-normalised luma. Noise falls as √N; a 12-frame reconstruction at VoL ≥ 100 is cleaner than any single frame the phone can take. Run detection **once** on the reconstruction. Per-frame detection remains for the live overlay only.

**The stack that gets there** (in order, each gated by the 0d metric):

1. H9: absolute-contrast normalisation of the classical field so "no crease" produces a low field. Unblocks everything downstream, including the enhancer rung and the fused-map thresholds.
2. Full-hand UNet framing on (flag `unetFullHand`), fixed-subset warp, after ≥ 8 session stills confirm the delta.
3. Coherence enhancement + oriented ridge, with fragment linking along the orientation field before the length gate (the measured +0.24 F1 waiting behind a threshold).
4. H5: features from observed evidence only; breaks, islands, forks become real.
5. Classify fix for the head-line misassignment (80 px = wrong crease, not a near miss).
6. Multi-class UNet fine-tuned on the growth set: line id per pixel instead of binary, trained on our own crops and framing.

---

## 3. Tier C — Full taxonomy, region-gated

Twelve TraceClasses already exist in `classify.ts`; four are active. The rest fail not because they are invisible but because they are searched for everywhere.

**Region priors from landmarks.** Every minor line has an anatomical home, and every home is a landmark polygon:

| Line | Region | Orientation prior |
|---|---|---|
| Sun (सूर्य) | below ring MCP, Apollo mount → centre | vertical |
| Mercury / health (बुध) | pinky MCP → Luna base | diagonal |
| Marriage lines | percussion edge between heart line and pinky MCP | horizontal, short |
| Girdle of Venus (शुक्र) | arc above heart line under middle/ring | arc |
| Rascettes | wrist crease zone below palm | horizontal |
| Intuition (चंद्र) | Luna mount arc | curved |
| Mars / sister line (मंगल) | inside life line, Venus mount | parallel to life |
| Travel lines | percussion, Luna | horizontal, short |

Detection = ridge evidence × region prior × orientation-agreement with the prior → per-class candidate → verification against the reconstruction. Precision on minor lines comes almost entirely from refusing to look where a line cannot be.

**Marks.** Two kinds, two methods.

- *Topological* (break, island, chain, fork, tassel): computed from the evidence graph of a detected line once H5 lands. No learning needed.
- *Symbolic* (star, cross, square, triangle, grille): a small patch classifier at junctions and on mounts, trained on labeler-marked points. The labeler gains a point tool with a mark type; the eval harness gains a mark metric.

**Mounts.** Eight regions from landmarks. Prominence from within-hand relative shading and texture density (fine-line count in the region). Within-hand only, never absolute, so skin tone cannot leak into the reading.

**Hero art note:** the home screen names nine graha lines and omits जीवन and मस्तिष्क. The taxonomy above is anatomical; a mapping table renders graha names on top of anatomical ids. Both hands of that table exist before the UI phase.

---

## 4. Tier D — R&D

- **Crease depth from motion shading.** A crease is a groove; its shading changes with tilt. Ask the user to tilt slowly, track per-pixel luma variance along the tilt direction across registered frames, and depth ∝ variance. "Deep vs faint" is a first-class distinction in the KB and no camera app estimates it. Needs an experiment before a promise.
- **Both hands.** Dominant vs non-dominant comparison is a core classical move. Capture both, read the delta.
- **Longitudinal.** Store canonical reconstructions per session; the Timeline tab shows change. The claim that lines change is the KB's; the measurement would be ours.

---

## 5. Reading engine changes

- Every rule fires with `confidence = min(input confidences) × rule weight`. Areas require a minimum evidence mass before rendering a verdict; below it the area shows what *would* be needed ("no sun line detected; retake with side lighting"), which is more honest and more engaging than silence.
- Provenance groups (Ancient Texts / Tradition / AI) already designed; add the tier and the confidence per group.
- Absence is evidence: "no fate line" is a reading, and the labeler already records it.

---

## 6. Data

- Labeler: extend `LABEL_LINE_IDS` to the full taxonomy in stages (sun, mercury, marriage first), add the mark point tool, add mount region confirmation. Same blank-slate discipline for the eval set; correction mode for growth.
- Eval: per-class metrics, mark metrics, geometry feature repeatability across frames.
- Growth set → multi-class UNet fine-tune on our framing. Ablation ladder stays the referee.

---

## 7. Build order and what each step unlocks

1. **KB reachability audit** (read-only, today): rules by required feature, reachable / structurally zero / not produced, per life area. Sets priorities with numbers instead of intuition.
2. **Tier A geometry engine** (one week): first non-empty dhan/rishte/swabhav verdicts, with high confidence.
3. **H9 + full-hand flag + fragment linking** (current sprint, gated by session GT).
4. **H5 evidence features**: breaks and islands real; another KB slice reachable.
5. **Region-gated minor lines**, sun / mercury / marriage first: the wealth and relationship lines the user asked for, detected where they can actually be.
6. **Reconstruction-first detection**.
7. **Marks, mounts, multi-class UNet.**
8. **Tier D experiments.**

Every step lands behind a flag, scored by 0d, on GT that a human traced blind.
