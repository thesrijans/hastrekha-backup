# Detector audit — current ceiling and what is missing

Written 2026-08-27, against the working tree at that date. No implementation; this is a survey with
numbers attached.

Everything quantitative below was measured by running the shipped modules over the reference frames in
`docs/reference/`. Where I am inferring rather than measuring, it says so.

---

## 0. What I could not do, and why it matters

**Two of the three named reference frames do not exist.** `docs/reference/` contains
`lines-misplaced-05.png` but not `lines-working-04.png` and not `lines-misassigned-06.png`. So the
"good" frame and the "misassigned" frame could not be viewed, and the comparison the brief asks for —
good versus bad, diagnose the difference — could not be made against the intended pair. What follows
substitutes `lines-missing-tilt-03.png` (a good, well-lit, fully-in-frame hand) as the positive case.

**The ground truth is weaker than it should be, and the reason is circular.** The available frames are
screenshots with the scan's own overlay burned into them. The orange traces sit *on top of* the creases
they were drawn from, so the crease under a trace cannot be seen. That means ground truth is least
reliable exactly where the detector found something — the easiest place to "confirm" the detector is
where it has already painted over the answer. Positional uncertainty on my hand-tracing is about
**±0.02 of the crop** (≈2.5px at 128²), comparable to a crease's own width, so any difference below
that is not a measurement.

Both problems have the same fix, and it already exists: the debug panel's **export-frame** button
writes the raw PNG plus derived JSON with no overlay. Until there are labelled raw exports, every
claim in §1 about corridor accuracy is unfalsifiable, and I have marked those claims accordingly.

Ground truth as traced lives in `test/fixtures/ground-truth/`, with its method and limits recorded
alongside it.

---

## 1. Per-frame, per-class results

Pipeline run: `rectifyPalm` → downsample to 128² → homomorphic normalisation → Frangi + black-hat/Gabor
→ `max` → `combineProbabilities(null, …)` → `extractAllTraces` / `completeLines`.

"DETECTED" means some trace **of that class** passes within 0.05 of the crop (6.4px) of the traced
line. "MISASSIGNED" means a trace is that close but carries a different label.

### `lines-missing-tilt-03.png` — good frame: lit, sharp, fully in frame

Crop: mean luma 120, 0.00% blown, 87% skin. Ten strong traces, twenty faint.

| class | traced | completion | vs ground truth | distance (same class) | distance (any trace) | off corridor |
|---|---|---|---|---|---|---|
| heart | clear | ACCEPT | MISSED | 0.128 | 0.052 | **0.077** |
| head | clear | ACCEPT | MISSED | 0.141 | 0.055 | **0.114** |
| life | clear | ACCEPT | MISSED | 0.091 | 0.053 | 0.027 |
| fate | absent | reject `no_seeds` | correctly absent | — | — | — |

Read that table carefully, because it is the central result of this audit. **Completion accepted three
lines, and all three are further from the crease they claim to describe than the acceptance test can
see.** The curve labelled `heart` sits 0.128 of the crop — about 16px at 128² — from the heart line I
traced. Meanwhile *some* trace passes within 0.052 of each ground-truth line, i.e. the detector did
find structure there; it was the naming and fitting that put the label elsewhere.

The `off corridor` column is why. The heart line I traced sits 0.077 from its corridor centreline
against a mid-corridor half-width of 0.055; the head line sits 0.114 against a half-width of 0.060.
**Both real lines lie outside the corridor they are supposed to be fitted inside.** The fit then
converges on whatever evidence *is* inside the corridor, produces a plausible curve, and passes the
energy test.

Caveat, and it is a real one: I cannot separate "the corridor prior is wrong" from "I traced the wrong
crease" using an overlay-burned screenshot. Both would produce this table. What I can say is that the
disagreement is **3–5× my tracing uncertainty**, so something is genuinely wrong; which of the two it
is needs a clean labelled frame. The life line agreeing to 0.027 while heart and head disagree by
0.077–0.114 is weak evidence for the prior being at fault rather than my eye, since a labelling error
would not be expected to spare exactly the line whose corridor is widest.

### `lines-current-02.png` — overexposed

Crop: mean luma 188, 1.20% blown, and **3% skin** by a warm-tone test — the palm is so close to white
that a skin-colour classifier rejects nearly all of it.

| class | traced | completion | vs ground truth | distance (any trace) | off corridor |
|---|---|---|---|---|---|
| heart | faint | ACCEPT | MISSED | 0.057 | 0.026 |
| head | faint | reject `no_seeds` | MISSED | 0.062 | 0.018 |
| life | faint | ACCEPT | MISSED | 0.059 | 0.043 |
| bracelets | absent | — | **FALSE POSITIVE** — 1 trace labelled `bracelets` | | |

Here the corridors agree with the traced lines well (0.018–0.043, inside tolerance), and the failure is
different: everything is just over the 0.05 bar, and `head` gets no seeds at all. This is the
**blown-highlight** failure. A clipped pixel has no recoverable value, so no amount of normalisation
downstream helps — and §3 has nothing that fixes it either. The fix is upstream, at capture, and it is
already built and flag-gated (`cameraControl`, default off).

The `bracelets` false positive is a wrist-region trace given a name. Bracelets have exactly one KB rule
behind them, so the blast radius is small, but it is a wrong claim reaching the user.

### `lines-misplaced-05.png` — the failure the brief names

Crop: mean luma 80, 0.00% blown, **85% skin** (77% even in the bottom band). Thirteen strong traces,
seventeen faint. Completion accepts `life` and `fate`, rejects `heart` (`low_observed`, 26%) and
`head` (`no_seeds`).

I recorded no ground truth for this frame, deliberately. The HUD on the screenshot reads *"Poora haath
frame mein laao"* and the wrist end of the palm is outside the frame — **only three of the four anchor
dots are present in the image at all**; the wrist dot could not be found and the value in the fixture
is estimated from where the cyan skeleton converges. Canonical-space ground truth would require the
canonical space to be right, and it is not. Recording line positions in a broken coordinate system
would have manufactured a comparison that means nothing.

I initially read this crop as "the lower third is background". **That was wrong** — measured skin
fraction is 85%, comparable to the good frame's 87%. The crop contains the palm; what is wrong is
where that palm is *mapped to*. §2 quantifies it.

---

## 2. The frame-clipping effect, measured

Synthetic hand pushed down until the wrist exits the frame, with the off-screen landmarks perturbed to
model MediaPipe extrapolating what it cannot see. "Zone error" is how far canonical crop positions move
in video pixels, after removing the bulk translation — i.e. pure geometric distortion.

| hand pushed by | wrist out? | anchors chosen | crop coverage | mean zone error | worst zone error |
|---|---|---|---|---|---|
| 0.00 | no | 5 | 1.000 | 0.0 px | 0.0 px |
| 0.05 | no | 5 | 1.000 | 0.0 px | 0.0 px |
| 0.10 | no | 5 | 0.971 | 0.0 px | 0.0 px |
| **0.15** | **yes** | 5 | 0.849 | **4.2 px** | **14.9 px** |
| 0.20 | yes | 5 | 0.753 | 8.1 px | 29.5 px |
| 0.25 | yes | 5 | 0.671 | 11.7 px | 42.4 px |
| 0.30 | yes | 5 | 0.594 | 15.3 px | 53.9 px |

Three things follow.

**The degradation is a cliff, not a slope.** Zone error is exactly zero until the wrist crosses the
edge, then jumps immediately to 15px at the worst probe. There is no gentle band to tolerate.

**`palmAnchors` keeps choosing five correspondences the whole way down.** The percussion guard checks
whether the *derived* point landed in frame, not whether the landmarks it was derived from were ever
seen. So the fifth anchor is being fitted from a guess, and the least-squares solve spreads that guess
across the whole crop.

**The existing eligibility floor does not catch it.** `segmentationEligible` requires coverage ≥ 0.60.
At a 0.25 shift, coverage is 0.671 — comfortably passing — while canonical zones have moved by up to
**42 video pixels**. That is several crease widths. A frame like that is segmented, traced, fitted,
classified and drawn.

**Would a geometry-confidence floor have prevented the wrong outputs? Yes, and one now exists.** The
`degraded` check added in the previous step tests the landmarks directly — any landmark outside the
frame marks the scan degraded and refuses to emit line features. On this frame that check fires. What
it does *not* yet do is stop the overlay drawing, or stop the traces being folded into fusion. Raising
`FUSION_MIN_COVERAGE` from 0.60 to ~0.95 would be the cheap complementary guard: from the table, 0.95
sits between "wrist in frame" (0.971) and "wrist just out" (0.849), which is exactly the boundary that
matters.

---

## 3. Where the ceiling actually is

Before ranking techniques, the two measurements that determine which of them are worth anything.

### Recall along real lines

Fraction of each hand-traced line where the detector produces a response, searching ±2px to be
generous about my own tracing error:

| frame | line | combined | black-hat + Gabor | Frangi |
|---|---|---|---|---|
| tilt-03 | heart | 56% | 56% | 13% |
| tilt-03 | **head** | **11%** | 11% | 0% |
| tilt-03 | life | 43% | 36% | 6% |
| current-02 | heart | 93% | 93% | 0% |
| current-02 | head | 48% | 48% | 0% |
| current-02 | life | 56% | 56% | 0% |

**On the best frame available, the detector sees 11% of the head line.** Not 11% of it strongly — 11%
at all. This is the ceiling, and it is a *detection* ceiling, not a fitting one. No amount of better
linking, fitting or classification recovers a line the detector never responded to.

### Frangi is contributing almost nothing

The `combined` column equals the black-hat/Gabor column almost everywhere. Frangi's mean response along
real lines is 0.03–0.19 against the classical chain's 0.26–0.92, and its strong coverage is **0% on
five of the six lines measured**.

I added Frangi two steps ago on the strength of two measurements: it produced fewer, longer fragments
on one crop, and it cost 12ms warm against the Gabor bank's 97ms. Both were true. Neither measured
whether it responds *on the actual lines*, and measured that way it barely does.

I checked whether this is a tuning problem. It is not:

| variant | heart/tilt-03 strong | head/tilt-03 strong | life/tilt-03 strong |
|---|---|---|---|
| on normalised input (shipped) | 13% | 0% | 6% |
| on raw luma | 0% | 0% | 0% |
| coarser scales (2, 3.5, 5.5) | 0% | 0% | 0% |
| finer scales (0.8, 1.2, 1.8) | 20% | 0% | 5% |

Finer scales help slightly and are worth trying, but nothing moves it into the same range as the
classical chain. Frangi as configured is close to dead weight in the merge — and because the merge is
`max`, it is *harmless* dead weight, which is why nothing caught it.

### Precision

Of the pixels the detector calls a line, the fraction lying within 3px of a hand-traced principal line:

| frame | above threshold | on a traced line | elsewhere |
|---|---|---|---|
| tilt-03 | 1600 px | 266 (16.6%) | 1334 (83.4%) |
| current-02 | 1523 px | 514 (33.7%) | 1009 (66.3%) |

"Elsewhere" is not all error — my ground truth records only three principal lines and real minor creases
live in that remainder, which is the whole premise of the twelve-class work. But 83% off-line on the
good frame is high enough that a large part of it is skin texture, and it is what the faint tier is
sifting through.

---

## 4. Missing-technique inventory

Every entry below was measured against the committed reference frames unless marked otherwise. That
matters, because measurement overturned my first ranking on four of these — the two I expected to be
strongest measured near-zero, and one I had dismissed turned out to be nearly free.

### Tier 1 — measured gain, low cost

**1. Expose the larger Hessian eigenvalue that `frangi.ts` already computes and throws away.**

This is the finding that explains §3. `detectVessels` builds `lxx`, `lxy`, `lyy` per scale and calls
`hessianEigenvalues` (frangi.ts:301), which returns both eigenvalues — and the code keeps only the
*ratio* `lo/hi` for the blobness term and discards `hi`. But `hi` **is** the maximum-over-orientation
steered second-derivative response: the Freeman–Adelson G2 closed form
`(Ra+Rc)/2 + hypot((Ra−Rc)/2, Rb)` equals it exactly — verified at **max error 0.00e+0 over all 16384
pixels**, and against a 720-orientation brute-force search at 2.4e-6.

So the oriented-bar response that `gaborBank` spends **37–53 ms/frame** computing at 8 discrete
orientations is already sitting in registers inside the Frangi loop, at zero additional convolution,
at *continuous* orientation rather than 22.5° steps. Frangi does not fail to see the creases; it sees
them and then divides the evidence away.

- *Gain:* measured standalone, a steerable G2 at two scales took the head line's `observedFraction`
  from 0.55 → **1.00** and its traced length from 38 → 79 px; heart 35 → 72 px. On the same frame it
  lost the life line until four scales were used, so the honest claim is "reshuffles which lines
  complete, favourably" until the normalisation is retuned — not a clean recall win yet.
- *Cost:* the zero-convolution variant is **~0 ms and ~20 LOC**. A full standalone replacement of the
  Gabor path costs 6.54 ms at two scales or 15.81 ms at four, against `gaborBank`'s 53.30 ms — i.e.
  finer scales *and* continuous orientation for a third of the price.
- *Risk:* real and specific. The G2 basis is not zero-mean and L2-normalised the way `buildKernels`'
  Gabor kernels are, so the response scale shifts — measured, above-threshold pixel count roughly
  **doubled** (1469 → 2843). Everything keyed to that scale would need re-deriving: `LINE_THRESHOLD`,
  `FAINT_THRESHOLD`, `ACCEPT_ENERGY`, `OBSERVED_ENERGY_FLOOR`. `test/flags-identity.test.ts` pins
  polylines coordinate-by-coordinate and will fail loudly, which is the good outcome. Second risk: G2
  is a pure second-derivative operator with no built-in dark-line polarity, so the sign handling must
  be explicit or knuckle highlights are detected as creases — exactly the failure `frangi.ts`'s own
  header warns about.

**2. Junction-aware tracing — fix what `tracePolylines` does at crossings.**

`tracePolylines` starts only from degree-1 endpoints and, at a junction, "continues into whichever
neighbour best preserves direction", greedily, with a `visited` mask that is never revisited. The
measured consequence is that **fragment endpoints are at the crossings, not at the gaps**: the greedy
walk consumes one branch and strands the others.

The evidence is blunt. On `lines-missing-tilt-03` the thinned skeleton is 633 px with **245 junction
pixels** across 29 components — a branchy web, not separated arcs. When the textbook remote-sensing
fix (endpoint-to-endpoint linking with tangent and energy gates) was prototyped, it produced **zero
valid links at every setting**, because of the 12 closest endpoint pairs the best tangent agreement
was cos = +0.03 and most were strongly negative (−0.99, −1.00). The endpoints point *at each other*,
because they are two arms of the same crossing.

- *Gain:* no direct recall. But it **gates every fragment-linking technique**, all of which are
  otherwise dead ends on this codebase.
- *Cost:* ~1 ms/frame, ~120 LOC. `thin` already costs 3.02 ms and trace+simplify 1.82 ms; this adds
  work only at the ~50–245 branch pixels.
- *Risk:* low. Fragment count falls and mean length rises, so anything tuned to fragment counts moves.

**3. Retire or bypass the oriented Gabor bank.**

Follows from (1). Removing it saves **~37 ms/frame at 128²**, which is what would let
`CLASSICAL_STRIDE` drop from 3 to 1 — classical evidence refreshing three times more often, which
matters on a moving hand where three-frame-stale evidence is what the motion compensation is fighting.
A separate finding: the sparse-Gabor support mask appears not to be delivering its intended saving; if
the bank is kept, restoring it is worth ~25 ms/frame with, by construction, zero accuracy change.

### Tier 2 — real but bounded, or blocked on Tier 1

**4. Orientation field + tensor voting (Medioni).** My first draft rated this "moderate". Measured, it
is weaker and more dangerous than that.

- *Gain:* across 6 (σ, threshold) configurations on both frames, best case **+1 completed line out of
  8 possible**. It does genuinely recover the head line on `lines-current-02` in 4 of 6 settings, and
  on frame 1 took head from 0.55/38 px to 0.79/80 px. But **no single setting wins on both frames**
  without regressing the other. Net across the corpus it moves *which* line is found more than *how
  many*.
- *Cost:* **50 ms (σ=5) to 391 ms (σ=14)** per frame — 6× to 49× the entire 8 ms every-frame budget.
- *Risk — and this is the important part:* if the voted saliency is passed to `completeLines` as the
  field (the natural integration, since `fitLine` uses one field for both seeding and the
  observed/energy accounting), then **18% of the samples `fitLine` labels `observed: true` for the head
  line, and 19% for the life line, sit on original-field values below `LINE_THRESHOLD`** — on skin
  where no crease was detected. `endpointObserved` gates the KB's origin/termination enums on exactly
  that flag. Tensor voting would launder its own smoothness prior into the "observed" label.

  On the honesty question the brief asks directly — which is more honest, tensor voting or the corridor
  fit — the answer is **the corridor fit, as currently designed**. Its prior is declared, is a
  compile-time constant identical for every user, and its inferences are labelled and excluded from
  endpoint claims. Tensor voting's prior is a smoothness assumption buried in a decay function whose
  output is indistinguishable from evidence. That said, §6 shows the corridor fit's honesty mechanism
  is *currently broken* — so this is a comparison of designs, not of shipped behaviour.

**5. Multi-frame sub-pixel super-resolution.** Measured with 8 synthetic observations at ±0.6 px
shifts: with **known** shifts it completed 3 lines (heart 0.47/130 px, head 0.79/160 px, life
0.50/146 px) — a real gain. The catch is that the shifts are not known, and `stabilise.ts`'s 1-euro
filter deliberately *removes* the sub-pixel dither that super-resolution needs. The two features are
in direct tension. High cost, high risk, not next.

**6. B-COSFIRE filters.** The retinal-vessel field's step after Frangi, which is exactly where this
code sits. On DRIVE, ~0.76 sensitivity against Frangi-family baselines around ~0.65 — roughly ten
points. Literature-backed, not measured here. Worth revisiting after Tier 1, since Tier 1 may capture
much of the same gain far more cheaply.

**7. Robust path opening.** The standard pre-thinning stage in crack segmentation; typically cuts
false-positive pixels 2–4× at fixed recall. Given §3's 83% off-line rate, this is aimed at the right
number. Literature-backed.

**8. Persistence-gated cross-pose merge, replacing `mergeMax` in `capture.ts`.** A crease is fixed
anatomy; a wrinkle moves with skin tension. Measured on a synthetic where creases sit at fixed
canonical coordinates and wrinkles are re-randomised per pose *at identical depth* — so intensity alone
cannot separate them — a persistence gate separates them where `max` cannot. `max` is the wrong
operator for this: it is maximally credulous, taking any evidence from any pose.

### Tier 3 — measured, and not worth it

**9. Phase congruency (Kovesi).** Measured **negative as a detector**: on `lines-missing-tilt-03`, PC
alone at threshold 0.30 gave 20 fragments and **1 completed line**, against a baseline of 10 fragments
and 3 lines. Contrast invariance is already handled by homomorphic normalisation plus percentile
response scaling.

**10. Coherence-enhancing diffusion (Weickert).** Measured **zero additional completed lines across 12
configurations on 2 frames**, and −1 at the most aggressive setting. It does reduce junction density
18–35%, which is a genuine benefit — but that benefit is better obtained from item (2) at a twentieth
of the cost. My first draft had this in Tier 2; that was wrong.

**11. Skin-region segmentation.** My first draft put this in Tier 1 on the strength of the 83%
off-line rate. Measured, it is much weaker: a chroma skin mask removes **1 of 10 false fragments and
9.9% of above-threshold pixels on the one frame where it works, and completes 0 additional lines**.
Still worth ~60 LOC as a second input to the degraded check, but not as a detection improvement.

**12. Fingerprint enhancement (Hong-Wan-Jain, STFT, ridge-frequency estimation).** Wrong scale.
Friction ridges are ~0.5 mm and quasi-periodic; palm creases are ~2 mm, aperiodic and sparse.
Ridge-frequency estimation assumes a dominant local frequency creases do not have. The one
transferable piece is orientation-field estimation, which is item (4)'s prerequisite.

---

## 5. The one next implementation, and its acceptance metric

My first draft named **fine-tuning the segmentation model**. Two findings from the audit make that the
wrong *next* step while leaving it the right *strategic* one, and both were things I asserted without
checking:

**The shipped model is not what the code says it is.** `segmenter.ts:9-17` documents the contract as
"milesial-style UNet, n_channels=3, n_classes=1, exported from checkpoint_aug_epoch70.pth". The actual
graph in `public/models/palm-lines.onnx` (13,929,773 bytes, producer `onnx.quantize` 0.1.0) has the
milesial backbone but also an **undocumented GCNet-style Global Context block** between down4 and up1 —
a module named `cfm` with `context_modeling` (Conv → Softmax → Mul), `context_transform1` (Conv → ReLU
→ Conv → Sigmoid) and `context_transform2` feeding an Add. Stock milesial `UNet` has no such attribute,
so `load_state_dict` fails on every `cfm.*` key. The model is also **QDQ int8-quantized**, so the ONNX
weights are not directly trainable. "Fine-tune the UNet" would have failed on day one.

**The frame export is not a sufficient labelling substrate.** It writes the raw camera frame plus
`obs.landmarks` — the *unfiltered* landmarks. But the crop the detectors actually see is rectified from
**stabilised** anchors (`stabiliseAnchors`, a 1-euro filter with hysteresis). So offline
`palmAnchors → rectifyPalm` reproduces *a* crop, not *the* crop the model saw, and the difference is
the filter's lag — largest exactly when the hand is moving. Labels drawn on a reconstructed crop would
be systematically misregistered against the inference-time input.

### So the next implementation is:

> **Expose the larger Hessian eigenvalue from the Frangi loop and merge it as the oriented-bar
> response.**

> **Superseded by §9.** This was built and measured in STEP 15 and **failed the acceptance metric
> below** — it is within noise of the Gabor bank when given the same input, better on one frame and
> worse on the other. The reasoning error is worth reading: see §9.1.

~20 LOC, ~0 ms, and it turns a module that §3 measured at ~0% contribution into the detector the Gabor
bank is currently spending 37–53 ms/frame approximating at coarser orientation resolution. It attacks
the 11% head line directly, and it is the only item in §4 whose cost is genuinely zero.

**Acceptance metric**, on the two committed reference frames plus any labelled raw exports available at
the time:

> Mean per-line recall (fraction of hand-traced line length with detector response within 2 px, at the
> strong threshold) **≥ 65%**, averaged over heart/head/life across frames, with **no line below 35%**
> — against the current 51% mean and 11% floor. False-positive area, measured as above-threshold pixels
> more than 3 px from any traced line, **no worse than the current 83%** after the response-scale
> constants are re-derived.

The per-line floor is the load-bearing half. The current 51% mean conceals a line at 11%, and the KB
has 31 rules conditioned on the head line — more than any other class.

**Then, in order:** junction-aware tracing (§4.2, unblocks everything else) → recover the fp32
architecture including the GC block → fix the export to write the stabilised-anchor crop → label →
fine-tune. Steps 3–5 are the strategic path and are multi-day; steps 1–2 are hours.

---

## 6. Structural weak points, independent of detection

Ranked by how likely a user is to hit them. Six of these were found by audit agents and verified here;
three of the six contradict comments I wrote myself.

| # | where | how a wrong claim gets out | severity | guard missing |
|---|---|---|---|---|
| 1 | `completion.ts:640` `pushControl(sLow, lowBin)` | `fitLine` pushes the first control up to 15% of corridor arc **before any evidence**, then tags it with `observed[lowBin]`. **Verified: `endpointObserved(line, "start")` returns `true` for every accepted line on both reference frames** — including a heart line whose `segments[0]` is `{from:0, to:1, observed:true}`, a single synthetic point. The origin enums in `lines.ts` are gated on exactly this flag. **The honesty mechanism does not work at the start end.** | **high** | the synthetic end controls must not inherit a distant bin's observed flag; they are extrapolation by construction |
| 2 | `lines.ts:611+` `depthProxy` | Averages over the **whole fitted poly including bridged gaps**, directly contradicting the comment I wrote at `lines.ts:575-578` claiming depth is measured on observed samples only. So `heart.depth` and `life.texture` are crossed by how much of the line happened to be lit, not by how deep it is. | **high** | restrict `depthProxy` to `segments` where `observed === true` — which is what the comment already promises |
| 3 | `completion.ts` accept gates | A curve fitted inside a corridor the real line lies outside of (§1: 0.077–0.114 off) passes and emits `lines.<id>.*`. | **high** | nothing compares the fit against stronger collinear evidence *outside* the prior |
| 4 | `lines.ts:612` `heart.length_norm` | Reports the arc length of the corridor **fit**, including up to 15% extrapolation at each end, with no `observedFraction` gate. | **high** | compute over observed arc only, or suppress when `observedFraction` is low |
| 5 | `palm-overlay.tsx:367` | **The code contradicts its own comment.** The comment says traces are projected through the *current* frame's landmarks so they stay glued to a moving hand; the code projects through the *frozen stored* anchors, which pegs them to where the hand was. I introduced this in the previous step. | **high** | re-solve from the current frame's stabilised anchors *under the frozen convention* — which is what the comment describes |
| 6 | OTHER_HAND pose | Pose 5 demands the opposite hand, and the gate passes only for it — so `onFeatures` publishes second-hand landmark features into the same session as first-hand line features. | **high** | partition the session by hand, or suppress publishing while `wantsOtherHand` |
| 7 | `use-hand-scan.ts` degraded path | `degraded` refuses features but traces are still fused and drawn. | **high** | the overlay is not told; fusion still accumulates |
| 8 | `quality.ts` `FUSION_MIN_COVERAGE = 0.60` | §2: coverage 0.671 passes while zones are 42 px out. | **high** | the floor is ~0.35 too low |
| 9 | `reading-session.ts` co-observation | Two values never true at the same instant, on the same frame, or even on the same hand sit side by side in one bag, and conjunction rules fire across them. | **high** | nothing marks keys as co-observed |
| 10 | latch cadence | `confirmAfter = 4` against `FEATURE_INTERVAL_MS = 160` and `RULE_EVAL_INTERVAL_MS = 700`: every rule that fires in a single evaluation is confirmed **before the KB is re-run**. The ratchet `latch.ts` documents does not exist. | medium | `confirmAfter` must exceed `ceil(700/160) = 5` with margin, or the latch must be driven by evaluations |
| 11 | `classify.ts` false positives | A wrist crease labelled `bracelets`, observed on `lines-current-02`. | medium | no cap on invented instances of non-exclusive classes |
| 12 | `sanitize.ts` `clamp01` | Every numeric feature clamped to [0,1] server-side. Verified end to end. **`lines.influence.venus_count gte 3` and `signs.bracelets.count gte 3` can never fire.** | medium | counts are not distinguished from probabilities in the schema |

**One genuine safety property, worth recording so it is not lost:** classified traces reach only the
overlay, never the feature bag. Features come exclusively from `completion.lines[id]`. A misclassified
*minor* trace cannot emit a wrong feature — the twelve-class work is visual-only. Rows 1–4 are about
the four principal lines, which do emit.

**One dead KB feature:** the heart corridor's arc length is 0.687 of the crop (head 0.594, life 0.707,
fate 0.631), while `PALM-HEART-008/009` condition on `lines.heart.length_norm gte 0.95`. Those rules
are **unreachable from any camera scan**, so `length_norm` is a one-sided feature that can only ever
say "short".

---

## 7. Untested load-bearing constants — and the direction they are blind in

The single most important finding in this section is not any individual constant. It is that **the test
suite is systematically blind in the direction that fabricates claims.**

Verified directly. With three completion gates loosened together —

```
ACCEPT_ENERGY         0.30  →  0.05
MIN_OBSERVED_FRACTION 0.35  →  0.02
CORRIDOR_MIN_INSIDE   0.55  →  0.15
```

— **all 20 test suites pass green.** Reverted after measuring.

Every one of these gates *is* caught when tightened (a tighter gate loses lines, and several tests
assert that lines are found). None is caught when loosened, because **no test asserts a ceiling** —
nothing says a given fixture must *not* produce a particular line, and nothing asserts a minimum
`observedFraction` on an accepted one. For an app that renders these as facts about someone's life,
the asymmetry is exactly backwards.

| constant | where | value | measured behaviour under change | tested |
|---|---|---|---|---|
| `CANONICAL_ANCHORS` | `rectify.ts:37` | 4 points | **Every** corridor, zone and classification threshold is relative to these. The file's own comment calls them "anatomical estimates, not measurements". One of the two candidate explanations for §1. | **untested** |
| `ACCEPT_ENERGY` | `completion.ts:201` | 0.30 | 0.36 caught; **0.24 and 0.05 pass green**. Its justifying comment assumes gap-field ≈0.15; measured gap fields are far lower, so the derivation is stale. | weakly |
| `MIN_OBSERVED_FRACTION` | `completion.ts:203` | 0.35 | **0.42, 0.28 and 0.02 all pass green.** | **untested** |
| `CORRIDOR_MIN_INSIDE` | `completion.ts:148` | 0.55 | 0.66 caught; **0.44 and 0.15 pass with byte-identical output**. | weakly |
| `COS_TANGENT_TOL` | `completion.ts:154` | 0.819 (35°) | 0.983 caught; **0.1 — accepting a fragment 84° off its prior — passes green.** The exact cross-family claim the comment says it prevents. | weakly |
| end-control `observed` flag | `completion.ts:637` | inherits `observed[lowBin]` | See §6 row 1. Verified true for every accepted line. | weakly |
| `MAX_END_EXTRAPOLATION` | `completion.ts:177` | 0.15 | Changing it moves every reported `length_norm` and every claimed endpoint. Nothing fails; the numbers just change. | weakly |
| `FAINT_THRESHOLD` factor | `fusion.ts:82` | 0.55 | **0.55 → 0.30 leaves the suite green** while the fixtures change materially. | weakly |
| `MIN_TRACE_FRACTION` | `lines.ts:30` | 0.12 | **0.12 → 0.24 passes green**; fixture 1 goes 30 → 13 traces and loses `travel 3` entirely. | **untested** |
| inline enum thresholds | `lines.ts:615, 656, 666, 669, 710` | 0.75/0.55, 0.42, 0.07… | Bare ternary literals, no names, no comments. **`depth > 0.95 : > 0.9` passes the whole suite**; so does `excursion > 0.05`, which makes every life line `wide_into_palm`. | **untested** |
| `FUSION_MIN_COVERAGE` | `quality.ts` | 0.60 | §2 shows it ~0.35 too low. | **untested** |
| `WARP_MAX_DISPLACEMENT` | `fusion.ts:62` | 96 | Lowering to 16 makes ordinary motion look like a mis-detection and resets the accumulator. | **untested** |
| `DEFAULT_MOUNT_VALUE` | `palm-geometry.ts:173` | 0.45 | A move to 0.5 instantly fires ~40 mount rules from sliders the user never touched — jupiter, mars_inner, mercury, moon, saturn, sun and venus all have `gte 0.5` rules. | **untested** |
| `SUPERSEDE_MARGIN` | `reading-session.ts:52` | 0.10 | An early wrong value at 0.72 is not displaced by a merged-capture observation at 0.80. Tests pin margin ± ε, so a large change *is* caught. | weakly (best here) |
| `BRACKET_SETTLE_MS` | `use-hand-scan.ts` | 220 | Reasoned, never measured; no device to hand where exposure is settable. Already flagged in the code. | **untested** |

**Comments that are now false**, all mine:

- `lines.ts:575-578` — claims depth is measured on observed samples only. It is not (§6 row 2).
- `palm-overlay.tsx:356-366` — describes projecting through current landmarks; the code freezes them.
- `completion.ts` `ACCEPT_ENERGY` — derivation assumes a gap-field value measurement contradicts.
- `frangi.ts` header — "three full-length traces from eight fragments… far less litter". True as
  stated, and deeply misleading about the module's value: §3 measures it at 0% strong coverage on five
  of six line/frame pairs.

**The cheapest fix for most of this section** is one golden test: run `extractLines` over the two
committed reference PNGs and pin the resulting feature bag — enum values and all. That single fixture
would catch the inline thresholds, the depth banding, the loosening direction on every completion gate,
and the faint-tier constants, none of which anything catches today.

---

## 8. Summary

The detector's ceiling is **recall along real lines: 11–56% on a good, well-lit, fully-in-frame hand**.
Everything downstream works on that half.

The most actionable finding is that **`frangi.ts` already computes the oriented-bar response and
discards it** — the larger Hessian eigenvalue is exactly the steered G2 maximum (verified to 0.00e+0),
while `gaborBank` spends 37–53 ms/frame approximating the same quantity at 22.5° resolution. That is
the next implementation: ~20 LOC, ~0 ms, aimed straight at the 11%.

> **This is wrong, and §9 records why.** STEP 15 implemented it. The mathematics holds; the engineering
> conclusion did not, because §3 measured Frangi on an input the Gabor bank never sees. Given the same
> input the two land within noise of each other, and the head line stays at 11%.

Two things I asserted in the first draft of this audit were wrong and are corrected above: the shipped
ONNX model is **not** stock milesial (it carries an undocumented GCNet block and is int8-quantized, so
`load_state_dict` fails immediately), and the frame export is **not** a sufficient labelling substrate
(it writes raw landmarks while the detectors see a stabilised-anchor crop). Fine-tuning remains the
strategic goal; it has three real prerequisites that were invisible until someone read the graph.

On structure: the endpoint-honesty gate I added two steps ago **does not work** — `endpointObserved`
returns true for every accepted line — and `depthProxy` contradicts its own comment. Both emit KB
features the reading states as fact. *(Both fixed in STEP 15; §9.2 measures what they were emitting.)*

And the test suite is blind in the wrong direction. Three completion gates can be loosened to near-zero
with all 20 suites green, because every test asserts lines are *found* and none asserts a ceiling.
*(Fixed by `golden.test.ts` — though §9.3 shows those particular three constants were slack rather than
load-bearing, so this experiment was not the proof it looked like.)*

---

## 9. Post-STEP-15 — the #1 implemented, measured, and rejected

STEP 15 built §5's recommendation, measured it against its own acceptance metric, and **did not adopt
it**. The three honesty defects §8 named are fixed. This section records what the measurements said,
because the recommendation in §5 was confidently wrong and the reasoning that produced it is a failure
mode worth keeping visible.

### 9.1 The steered G2 response

The claim in §5/§8 was true as *mathematics* and false as *engineering*. The larger Hessian eigenvalue
really is the steered Freeman–Adelson G2 maximum, `gaborBank` really was approximating it at 22.5°
resolution, and exposing it really did cost ~20 LOC. What the audit never checked is whether the
quantity it was steering was *the same quantity the Gabor bank steers*.

It is not — not because of the orientation machinery, but because of what each is fed. The Gabor bank
sees CLAHE + multi-scale black-hat; §3's Frangi column was measured on illumination-normalised gray.
That preprocessing gap, not the orientation sampling, is the entire 0%-vs-56% difference §3 attributed
to the detector:

| steered G2 on… | heart/tilt-03 | head/tilt-03 | life/tilt-03 |
|---|---|---|---|
| illumination-normalised gray (what §3 measured) | 15% | 0% | 8% |
| CLAHE only | 53% | 28% | 28% |
| CLAHE + black-hat (what the Gabor bank sees) | 54% | 11% | 44% |

So §3's "Frangi contributes ~0%" is real, and its implied cause was wrong. Frangi is not a weak
detector; it was reading a weakly-prepared image. Given the bank's own input it lands within noise of
the bank — which is the opposite of the conclusion §5 drew from the same fact.

**At matched precision it does not win.** Recall and litter rise together under every configuration
that looked like a gain, which is the signature of a gain change rather than a better detector.
Sweeping the normalisation percentile to trace out an operating curve and reading off the point where
precision against the hand-traced creases is *identical*:

| frame | Gabor bank | steered G2, matched precision | |
|---|---|---|---|
| current-02 | P 28.1 · R 32.0 | P 28.1 · **R 38.2** | better |
| tilt-03 | P 10.7 · R 12.1 | P 10.7 · **R 7.0** | worse |

Better on the bright frame, worse on the tilted one. End to end it took tilt-03 from three accepted
lines to one (heart fell to E 0.29 against the 0.30 floor), and the configurations that recovered it
raised above-threshold pixels from 1600 to 2257 — i.e. bought the recovery with gain.

**Against §5's acceptance metric — mean per-line recall ≥ 65%, no line below 35%:**

| | mean recall | worst line | verdict |
|---|---|---|---|
| before | 51% | 11% (head/tilt-03) | — |
| steered G2, live path | 52% | 11% (head/tilt-03) | **fails both** |
| STEP 15's own metric (head observedFraction ≥ 0.9) | best observed 56% | | **fails by 34 pp** |

Not a near miss. Nothing in §4 Tier 1 moves the head line, because the head line on tilt-03 is not a
detector-configuration problem — the response is absent, not weak, and no reweighting of an absent
response produces one.

**Disposition.** `detectVessels` now takes an optional `bars` output and fills it (one comparison per
pixel per scale, zero cost when omitted); `detectRidges` still runs the Gabor bank. `gaborBank` is
**not** retired: it is 41.2 ms against 8.4 ms on a 128² crop and worth every one of them on the frame
that is harder to read. The side-by-side lives in its doc comment so the next person does not redo it.

### 9.2 The honesty gates, fixed

| defect | cause | fix |
|---|---|---|
| `endpointObserved` true for every accepted line | `fitLine` pushed its end controls at `sLow`/`sHigh` — up to 15% of arc beyond the outermost evidence — but flagged them from `lowBin`/`highBin`, which are *by construction* the first and last observed bins | the flag now comes from `binAt(s)`, the bin the control actually lands in |
| `depthProxy` averaged across bridged gaps while its comment claimed otherwise | the function had no access to the observed/inferred split | takes `segments` and averages observed samples only; comment rewritten to describe the code |
| `palm-overlay` projected through frozen anchors while its comment said current ones | `projection.anchors` is captured at trace-extraction time, which runs at the classical stride, not per frame | a live per-frame ref supplies the anchors; only the *convention* is carried from extraction, and a mismatch now draws nothing instead of falling back to raw landmarks |

Measured effect on the committed frames — the first two fixes interact, because honest segments are
what the observed-only average needs:

```text
lines-missing-tilt-03   14 features -> 13
  REMOVED  lines.head.origin = "inside_life_line"   claimed from a synthetic control point
  CHANGED  lines.head.quality  0.853 -> 0.902       gap samples no longer drag the depth down
lines-current-02         9 features ->  9  (no change)
```

`head.origin` is the single most rule-dense feature in the KB — 31 Cheiro rules condition on the head
line — and it was being stated as fact from a point the detector never saw. The overlay fix is worth
20.0 px: that is the measured trace lag after a 20 px hand movement, pinned in `placement.test.ts`.

### 9.3 §3 re-measured, and the correction to §7

The detector is unchanged, so §3 is unchanged. Above-threshold pixel counts are byte-identical
(1600 / 1523), which is the check that the refactor was behaviour-neutral:

| frame | line | combined | black-hat + Gabor | Frangi | steered G2 |
|---|---|---|---|---|---|
| tilt-03 | heart | 57% | 57% | 10% | 54% |
| tilt-03 | **head** | **11%** | 11% | 0% | 11% |
| tilt-03 | life | 42% | 36% | 6% | 44% |
| current-02 | heart | 93% | 93% | 0% | 93% |
| current-02 | head | 47% | 47% | 0% | 48% |
| current-02 | life | 56% | 56% | 0% | 60% |

(Small deltas against §3 are densification sampling in the measurement, not the detector; the identical
above-threshold counts settle that.)

**§7's headline experiment does not reproduce, and the reason matters.** §7 loosened `ACCEPT_ENERGY`,
`MIN_OBSERVED_FRACTION` and `CORRIDOR_MIN_INSIDE` to 0.05 / 0.02 / 0.15, found the suite green, and
concluded the suite was blind. The suite *was* blind — `golden.test.ts` now fixes that — but this
experiment was not what proved it. Re-run against the pinned feature bags, those three constants change
**nothing on either frame**:

| constant, loosened | tilt-03 | current-02 |
|---|---|---|
| `CORRIDOR_MIN_INSIDE` 0.55 → 0.15 | unchanged | unchanged |
| `ACCEPT_ENERGY` 0.3 → 0.05 | unchanged | unchanged |
| `MIN_OBSERVED_FRACTION` 0.35 → 0.02 | unchanged | unchanged |
| `MIN_CORRIDOR_SCORE` 0.35 → 0.05 | **changed** | unchanged |
| `COS_TANGENT_TOL` 0.819 → 0.3 | **changed** | unchanged |
| `LINE_THRESHOLD` 0.45 → 0.25 | **changed** (3 → 1 polylines) | **changed** (2 → 3) |

They are *slack*, not load-bearing. Every accepted line here clears the strict bar comfortably, so
lowering it admits nobody new; and the one rejection — `fate: no_seeds` — is not theirs to fix, because
`scoreFragment` gates on four conditions and a fragment let through by `CORRIDOR_MIN_INSIDE` still has
to clear `TANGENT_MIN_AGREE`, `MIN_SEED_LENGTH_FRACTION` and `MIN_CORRIDOR_SCORE`, which it does not.
The genuinely load-bearing constant is `LINE_THRESHOLD`, and it moves both frames in *opposite*
directions — which is precisely the "better, or just looser?" question §7 was reaching for.

`golden.test.ts` pins the full feature bag on both frames and asserts both halves: that loosening
`LINE_THRESHOLD` changes the output, and that the audit's three do not. If either flips, the trap has
stopped working or the detector has changed, and both deserve a human looking at them.

### 9.4 What this leaves

§5's ranking survives its top entry being wrong, because that entry was ranked on cost (~0) rather than
on measured gain — it was the cheapest thing to try, and trying it was correct. The next candidate is
unchanged: **junction-aware tracing (§4.2)**, which unblocks the rest of Tier 1.

The standing caution is the one this section is an instance of. Every wrong claim in §5 and §8 came
from measuring a component in isolation and reasoning about the system — Frangi's response measured on
an input the Gabor bank never sees; three constants loosened without checking they were binding. Both
looked like measurements. Neither was a measurement *of the thing being claimed*.
