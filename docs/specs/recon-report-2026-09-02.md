# RECON REPORT — Live Rekha Detection Sprint (2026-09-02)

> STEP 1 recon, read-only, against `docs/specs/hastrekha-live-rekha-detection-sprint.md` + addendum
> A1–A7. Saved verbatim per the Phase 0a apply instructions. Note: the AstroTalk reference image was
> withdrawn after this recon ran, and the render rule was overridden to solid-strokes-only — the spec
> now carries both changes.

Repo confirmed: HastRekha palmistry (548-rule KB, palm-scan pipeline) — not a physiotherapy codebase.
All recon read-only; nothing edited. Every number below was either verified directly in source or
independently re-derived by a second pass — the two agree everywhere.

## 1. Core modules — paths, exports, dimensions

| what | file | exports / facts |
|---|---|---|
| HandLandmarker wrapper | `lib/scan/landmarks.ts` | `MEDIAPIPE_WASM_PATH = "/mediapipe/wasm"`, `HAND_LANDMARKER_MODEL_PATH = "/models/hand_landmarker.task"`, `createHandLandmarker()`, `toObservation()`, `MissingScanAssetError`, palm-edge geometry (`derivePalmEdge`, `palmBoundary`). Task options (landmarks.ts:60-68): `numHands: 1`, `runningMode: "VIDEO"`, `delegate` default `"GPU"`, all three confidences 0.6. WASM vendored by `scripts/vendor-mediapipe.mjs` (`npm run vendor:mediapipe`, also `prebuild`) |
| Homography rectification | `lib/scan/rectify.ts` | `PALM_ANCHORS` (WRIST, THUMB_CMC, INDEX_MCP, PINKY_MCP), `CANONICAL_ANCHORS`, `CANONICAL_PERCUSSION`, `canonicalQuad`, `canonicalAnchors`, `solveHomography` (DLT; 5-anchor over-determined via normal equations), `rectifyPalm`. **Canonical dims: `RECTIFIED_SIZE = 256`** (types.ts:72) for the crop, **`MASK_SIZE = 128`** (types.ts:89) for everything downstream (fused field, accumulator, traces). No ECC / phase-correlation / sub-pixel refinement exists anywhere |
| UNet ONNX | contract `lib/scan/segmenter.ts`: `ONNX_MODEL_PATH = "/models/palm-lines.onnx"` (13,929,773 bytes on disk), **input `[1,3,256,256]`** RGB NCHW 0–1, **output `[1,1,256,256]` raw logits** → `sigmoidInPlace`. Loader `lib/scan/segmenter-onnx.ts` `createOnnxSegmenter()` (one-in-flight, drop-never-queue); inference in `lib/scan/segmenter.worker.ts` (webgpu→wasm fallback; missing model degrades to `"ridge-only"`) | |
| Ridge / Frangi | `lib/scan/ridge.ts` `detectRidges` = CLAHE → `blackHatMulti` (radii 2/4/6) → `gaborBank` (8 orient × 2 scales) → normalize; `lib/scan/frangi.ts` `detectVessels` (3-scale Hessian vesselness) + optional `bars` output (steered G2 equivalent) — **deliberately unwired** after measurement (DETECTOR_AUDIT §9). Live worker uses both: Frangi every accepted crop, Gabor ridge every 3rd, merged per-pixel max | |
| Temporal EMA fusion | `lib/scan/fusion.ts` `FusionState{ema, hits, faintHits}` at MASK_SIZE in **canonical crop space**; `DEFAULT_ALPHA = 0.3`, `CONFIDENCE_DECAY = 0.97`, `HAND_LOSS_RESET_MS = 1500`; no frame-to-frame warp (canonical space is the motion compensation), only 4↔5 anchor-convention remap. Second temporal layer: `lib/scan/stack.ts` in-worker ring of 8 illumination-normalised luma crops, composite = **2nd-smallest order statistic**, blended 0.4 | |
| One-Euro filter | **exists** — `lib/scan/stabilise.ts`: `ONE_EURO_MIN_CUTOFF_HZ = 0.8`, `ONE_EURO_BETA = 0.06`, `ONE_EURO_D_CUTOFF_HZ = 1.0`, dt clamp 100 ms, percussion hysteresis 8 frames. Smooths **only the 4–5 rectification anchors** (wired at use-hand-scan.ts:538); traces/landmarks are never One-Euro filtered — the "One-Euro on projection only" rule has no competing usage to remove | |
| /scan page + HUD | `app/scan/page.tsx` (shell) + `app/scan/scan-client.tsx` (logic) + hook `components/scan/use-hand-scan.ts`. Clipped-hand has **two distinct signals**: (a) user-facing `out_of_frame` check (any landmark within `FRAME_MARGIN = 0.02` of the edge) → "Poora haath frame mein laao" pill in `scan-hud.tsx` (aria-live); (b) `degraded` state (use-hand-scan.ts:444, landmark strictly outside 0..1) which **suppresses feature emission** (:841) but surfaces only in the DebugPanel — spec Phase 1's "HUD warns, now it also gates" is already half-true: it gates features, not capture | |

## 2. Where frames come from

One `getUserMedia` call — use-hand-scan.ts:983-986: `video: { facingMode, width: {ideal: 1280}, height: {ideal: 720} }`, no frameRate constraint. **No ImageCapture / takePhoto / grabFrame anywhere in the repo** (verified twice). Frames are read by `drawImage(<video>)`: full-frame `getImageData` per rectify tick (200 ms), 48×48 luma sample per rAF. Existing buffers: the worker's 8-slot canonical luma `FrameStack`, ≤4 flash-quadrant planes, ≤3 HDR bracket planes, 5-entry span history. **No raw-frame ring buffer exists** — Phase 1's burst logic starts from zero.

Exposure lock (A5 requirement): `applyConstraints` exists only in camera-control.ts:398; `planConstraints` sets `exposureMode: "manual"` + clamped `exposureCompensation` **when the track's capabilities report it** (:125-128), falling back to bias-only. So the code path A5 needs exists but is behind the `cameraControl` flag (default **false**) and is capability-dependent per device — availability is a runtime question per phone, not a repo fact.

## 3. What runs per frame, where

| stage | cadence | thread |
|---|---|---|
| rAF `tick`: `detectForVideo`, 48×48 luma, `gradeFrame`, capture clock | every frame (~30–60fps) | main |
| Overlay `draw` (projection, own rAF loop) | every frame | main |
| Feature derivation + latch | `FEATURE_INTERVAL_MS = 160` | main |
| Full-frame getImageData → anchors → One-Euro → `rectifyPalm` → post to worker | `RECTIFY_INTERVAL_MS = 200` | main |
| Illumination + stack + Frangi (every crop), black-hat/Gabor (stride 3), UNet (stride 6), budget 8 ms self-measured | per accepted crop, one in flight | **worker** |
| `extractLines` + `extractAllTraces` (thin/trace/fit/classify) | `EXTRACT_INTERVAL_MS = 700` | main |
| KB rule eval (548 rules) | `RULE_EVAL_INTERVAL_MS = 700` | main |
| Camera control / HDR bracket | 500 ms / 4000 ms, flag-gated | main |

Worker infra: exactly **one** worker (`segmenter.worker.ts`, module type, transferred ArrayBuffers, working size 128). **No OffscreenCanvas / transferControlToOffscreen / createImageBitmap anywhere.** MediaPipe inference is invoked from the main thread (GPU delegate = WebGL under the hood, but the call blocks the rAF loop).

## 4. Test chain + goldens

`npm test` = **23 suites** `&&`-chained (package.json:10): engine → sanitize → scan → palm-edge → curve → facing → view-transform → ridge → pipeline → frangi → persistence → completion → gate-independence → reading-session → browser-path → flags-identity → placement → traces → area-score → api-areas → area-ui → golden → real-fixtures.

- `test/fixtures/golden/{lines-current-02, lines-missing-tilt-03}.json` — pin `{frame, polylines, fragments, completion (accepted/observed/energy per line), features}`; read by golden.test.ts. **Cascade warning:** `lines-missing-tilt-03.json`'s `features` is also the rich-palm scan bag in area-score.test.ts:327 — a detector re-pin can cascade into area-golden re-pins.
- `test/fixtures/ground-truth/` — hand-traced creases (0–1 crop fractions) pointing at `docs/reference/*.png`; input to `test/golden-run.ts`, which regenerates snapshots via sharp → rectify 256 → downsample 128 → 6 fusion ticks → extract. `lines-misplaced-05` is read by nothing.
- `test/fixtures/area-golden/` — 3 area pins; `test/fixtures/real/` — empty (README only), suite self-skips.
- Meta-test (golden.test.ts:131-178): proves `LINE_THRESHOLD = 0.45` **bites** (0.25 changes every frame) and that `CORRIDOR_MIN_INSIDE / ACCEPT_ENERGY / MIN_OBSERVED_FRACTION` are **slack** on these frames.
- Dimension pins that break on a canonical upsize: flags-identity.test.ts:51 (SIZE=256), traces.test.ts:276,283-284, frangi.test.ts:130-131 (sigmasFor 128/256), browser-path.test.ts:31,221-222, and golden-run's baked 256=2×128 assumption. **No test loads the ONNX model** (all pass `unet: null`) — a UNet input change alone breaks zero suites and only fails at worker warmup. No test pins worker cadences.

## 5. Frame persistence — clean, with one caveat

Zero hits repo-wide for localStorage / sessionStorage / IndexedDB / FS-Access / toDataURL / sendBeacon / WebSocket. Every network POST is JSON features only. Pixels can leave a canvas in exactly two places, both explicit-click local Blob downloads: the synthetic share card (no camera pixels), and **`exportFrame`** (use-hand-scan.ts:1092-1138 → debug-panel.tsx:166-171) which saves the raw video frame + landmarks JSON. **Caveat:** DebugPanel renders unconditionally (scan-client.tsx:600) and the export button is *not* env-gated (only the tuning slider is, debug-panel.tsx:643) — so a raw-frame download button ships in production today. Device-local and click-only, so not an upload risk, but it sits against the spirit of spec §8; Phase 0a should gate it while building the real capture harness. *(Done in 0a-i.)*

## 6. Gap list (numbered, mapped to phases)

1. **0a capture harness** — nothing exists: no `/dev` routes, no still-capture path, no session persistence. Seeds to reuse: `exportFrame`, `gradeFrame`, the gate/pose machinery.
2. **0b labeler** — nothing exists. No drawing UI, no label schema.
3. **0d eval harness** — nothing exists; the tsx-chain pattern is the template.
4. **Phase 1 quality scoring** — *partial*: exposure (luma/clipped bands), motion (`unsteady` = landmark jitter), coverage (`out_of_frame`), pose checks, composite score all exist in `quality.ts`. **Missing: optical sharpness** — no variance-of-Laplacian anywhere; a perfectly still, badly focused frame passes today. *(Moved into 0a per D6, done.)*
5. **Phase 1 burst logic** — missing entirely (no raw-frame ring, no top-k stills, no stable-window trigger). *(Stable-window trigger built in 0a-i.)*
6. **Phase 2 fine registration** — missing: no ECC/phase-correlation, no per-frame residual metric, no residual exclusion gate. Landmark homography + One-Euro anchors is the whole story.
7. **Phase 2 canonical ≥512** — conflict: detection runs at 128 (crop at 256). Upsample touches the pinned-dimension tests in item 4 and golden-run's 2× assumption. *(D3: labeling/eval at 512 on stills, live pipeline untouched in 0a.)*
8. **Phase 3 fusion of registered ridge maps** — *partial machinery, different algorithm*: EMA (α 0.3) + 8-frame 2nd-smallest intensity stack + per-pose max-merge exist; spec's **trimmed-mean-of-top-k over per-still ridge maps** and the sharpness-weighted fused intensity composite do not.
9. **Phase 3 ring masking** — missing entirely.
10. **Phase 4 UNet-on-composite-only** — *partial*: UNet already runs on the (stacked) live crop at stride 6, not on a final composite at composite cadence.
11. **Phase 4 temporal line identity / evidence store** — missing: `latch.ts` latches *KB rules* (confirmed/captured/provisional/absent, confirmAfter 4), not line identities. No per-line CANDIDATE→TRACKING→CONFIRMED store, no composite observation lists.
12. **Phase 4 RekhaMap** — missing; `LineExtraction`/`TracedLine` + `FittedLine.segments` are the seeds.
13. **Phase 5 projection** — *largely exists*: per-rAF canonical→screen homography from live One-Euro'd anchors, cover transform, convention-mismatch refusal (palm-overlay.tsx:388-411). Missing: state-ladder styling bound to an evidence store (current alpha encodes observed/inferred + gate + age), per-line status rail (ticker shows rule standings, not line states). Solid-stroke override already satisfied — zero `setLineDash` on canvas.
14. **Phase 6 screen-light** — *already implemented behind flags*: 4-quadrant flash sweep + `photometricEvidence` (direction-consistency) + HDR bracket, UI in `deep-scan-flash.tsx`, double-gated (`photometric` flag default false + per-user noFlash). Missing: any automatic sweep, multi-frame-per-quadrant, and the measurement protocol.
15. **A1 detect-all-then-classify** — *architecturally true at trace level, violated at assembly*: the whole field is binarized→thinned→traced line-agnostically, and `classify.ts` runs after. But the four named lines are assembled by per-line **corridors with hard gates** (`CORRIDOR_MIN_INSIDE 0.55`, 35° tangent) — not probabilistic priors; no skeleton→line-graph; **no simian-crease hypothesis** (a single transverse crease would be claimed piecewise by both heart and head corridors).
16. **A2 PRAM** — missing as specified: per-pixel `{ema, hits, faintHits}` exist; **no orientation field anywhere** (Frangi computes Hessian orientations and discards them; gaborBank max-pools its 8 orientations; `bars` unwired). No graph edge scoring.
17. **A3 frame-count ablation** — nothing (blocked on 0d).
18. **A4 session replay** — nothing persists by design; `exportFrame` is a one-frame seed of the layout. *(Layout built in 0a-i: raw/ selected/ aligned/ snapshots/ labels/ + metadata.json.)*
19. **A5 pose-indexed shading** — missing. Closest relative: `photometric.ts` (tilt-*variance* channel across pose commits — un-flag-gated, weight earned from tilt span) regresses nothing against θ, has no pose-angle bucketing. Exposure lock: see item 2 — code path exists, flag-gated, capability-dependent.
20. **A6 livewire labeler** — nothing. Cost-image decision needed: frangi.ts is generic vesselness *recomputed from the raw image* (arguably blank-slate-clean), but it is also literally the detector's module. *(Decided D1: NOT frangi — independent LoG valley response; import boundary enforced.)*
21. **A7** — no research-notes file exists yet; PRETRAIN-FORBIDDEN discipline to be instituted when one is created.

## 7. UNet output vs PRAM/A1 — no conflict

The model is **exactly** what A1 wants: `n_classes = 1`, a single undifferentiated "is this pixel a crease" map (segmenter.ts:12-13) — per-line meaning is assigned only afterwards by geometry. `LineMask.perLine` exists in the type (types.ts:107) but nothing populates it; if a future multi-class model ever fills it, *that* would conflict with A1. The real A1 friction is downstream (item 15's corridor hard gates), not the model.

## 8. Risks

| risk | mitigation |
|---|---|
| Thermal (UNet + stills) | Keep inference per-composite only (stride + one-in-flight drop already exist); degrade cadence via the worker's self-measured budget |
| Memory (full-res stills: 1280×720 RGBA ≈ 3.7 MB each) | Cap ring at k=5–8, store luma-only after scoring, transfer ArrayBuffers, drop originals after canonical warp |
| takePhoto preview stutter | Capture inside the existing `AUTO_CAPTURE_HOLD_MS` "hold still" beat; fallback = max-res track constraints + canvas grab; verify per device before relying on it |
| Canonical upsample vs UNet input | UNet input is hard-pinned `[1,3,256,256]` and **no test loads the model** — detect at 512, tile/downsample to 256 for inference, document in REPIN.md; retraining is out of sprint |
| Golden breakage | Known exact blast radius (item 4 pins list + area cascade via lines-missing-tilt-03); re-pin with REPIN.md per freeze-lift rule 2 |
| Non-rigid deformation under rotation (A5) | Palm ≠ plane, homography residual grows with θ — Phase 2 residual gate excludes rotated frames from *geometry* fusion; pose-bucketed accumulation for the shading channel instead of one global accumulator |
| Landmarker on main thread at 30fps alongside everything else | Leave as-is this sprint (it holds today); OffscreenCanvas migration is a separate step, not folded in |

## 9. NORM_RECT — answered from config

Our code passes **no** ROI / ImageProcessingOptions anywhere; the one detect call is two-arg `landmarker.detectForVideo(video, now)` — use-hand-scan.ts:427, created with GPU delegate at landmarks.ts:60-68. The vendored tasks-vision bundle **unconditionally** injects a full-frame `NormalizedRect` (center .5/.5, w/h 1/1, rotation 0) into the graph's `norm_rect` stream, and the HandLandmarker graph never supplies IMAGE_DIMENSIONS — that combination is the warning's trigger. The exact string lives in the WASM binary (`public/mediapipe/wasm/vision_wasm_internal.wasm`, co-located with GlScalerCalculator strings — attribution by string co-location, the wasm isn't decompilable): *"Using NORM_RECT without IMAGE_DIMENSIONS is only supported for the square ROI. Provide IMAGE_DIMENSIONS or use PROJECTION_MATRIX."*

**Accuracy impact for us: nil.** With a full-frame rect and rotation 0 the square-ROI fallback computes an identity ROI transform; landmarks come back correctly normalized to the 1280×720 frame. It becomes a *real* accuracy bug only if `regionOfInterest` or `rotationDegrees` is ever passed (the bundle's own aspect fixup only runs for rotations ≢ 0 mod 180). Registration is therefore not currently degraded by this.

**Fix (decision D2, applied in 0a-i):** accept and document the log as benign — JSDoc note at the `createHandLandmarker` options + standing rule: never pass regionOfInterest/rotationDegrees into `detectForVideo` without re-validating landmark accuracy. No option changes. (Alternatives rejected: `delegate: "CPU"` avoids the GPU scaler at real inference cost; square letterboxing adds a copy per frame for a cosmetic win. There is no tasks-vision JS API to supply IMAGE_DIMENSIONS.)

## 10. /api/auth/me 401

Expected unauthenticated state, not a scan dependency — scan-client.tsx:118-136 only seeds `user.birth_date` and swallows failure ("the scan works without a birth date"); the header uses the same endpoint for Login/Logout state. Nothing breaks.

## 11. Inferred runs — the bridge is real, and it leaks past rendering

**(a) Definition + producer.** `fitLine` in `completion.ts` (:521+). Inputs: raw skeleton fragments (traced from the whole field) projected into a per-line corridor and binned along it (`CONTROL_BINS = 12`). A bin is **observed** iff ≥ `MIN_BIN_POINTS = 2` skeleton pixels land in it AND their field-weighted mass ≥ `MIN_BIN_WEIGHT = 0.9` (:551). Curve samples are flagged observed only when *both* bounding controls are observed (:676); contiguous same-flag runs become `LineSegment{from, to, observed}` (:685). The overlay dims inferred runs to `INFERRED_ALPHA = 0.4` (palm-overlay.tsx:48).

**(b) Bridging — yes, interpolation, capped at 40% of the corridor.** Interior unobserved bins get lateral offsets **linearly interpolated** between the nearest observed neighbours (:564-571) — interpolation only, never trend extrapolation. A single interior hole longer than **`MAX_INFERRED_RUN = 0.4`** of the corridor arc splits the line instead of bridging (keeps the side with more evidence, :592-621). Ends additionally extend up to **`MAX_END_EXTRAPOLATION = 0.15`** of the arc past the outermost evidence, holding the last observed offset. So: gaps up to 40% of a corridor are drawn across at 0.4 alpha, plus up to 15% held extension per end.

**(c) Not render-only — three leaks into features.** Classification is clean: `classifyAll` consumes raw traces, never fitted geometry (lines.ts:547-548). And the observed-only discipline genuinely holds for depth (`depthProxy` with `segments`), `confidence = observedEnergy`, and endpoint enums (`endpointObserved` gates). But the four named lines' feature polys are the **fitted curves** (`assigned[id] = fitted.points`, lines.ts:586), so:

- `length_norm` sums arc length over the full fitted curve **including bridged and extrapolated spans** (:644);
- `curvature` / `waviness` are measured on the bridged curve;
- **`breaks` is structurally zero.** `breakCount` counts point-to-point jumps > `BREAK_GAP_PX = 6` (:387-393) — on a fitted Catmull-Rom curve whose samples are ~3.5px apart *by construction* (comment at completion.ts:189: "finer than a break"), a >6px jump cannot occur. `lines.heart.breaks`, `lines.life.breaks_count`, and head `quality`'s continuity factor `1/(1+breakCount)` can never report a break on a fitted line. Consistent: neither golden pins any `breaks` key.

**(d) A genuine break end-to-end today.** Detector: the skeleton fragments at the gap → separate raw polys. Assembly: `completeLines` stitches the fragments *across* the break; the break survives only as `observed: false` segments + a lowered `observedFraction` inside `FittedLine`. Overlay: a continuous stroke is drawn across the gap at 0.4 alpha. Features: the bridged poly reports `breaks = 0` and full-length `length_norm`. **Net: a real break is visible to the fit (as inferred segments) but is erased from both the KB features and, at reduced-alpha, visually contradicted on screen.** Under the no-fake-lines rule both halves are defects — and the second half is the sharper one, because the KB has break/island rules (`lines.heart.marks`, `lines.fate.structure` "breaks and depth proxy") that the scan path can structurally never trigger for fitted lines. Reported only; the fix is Phase 4 scope.

---

## Phase 0a file plan (as executed)

```
app/dev/capture/page.tsx              server shell, NODE_ENV gate → notFound()
app/dev/capture/capture-client.tsx    preview + gate readout + still trigger + session save
app/dev/label/page.tsx                server shell, same gate                    (0a-ii)
app/dev/label/label-client.tsx        canonical-crop canvas, polylines, modes    (0a-ii)
lib/scan/dev/still-capture.ts         ImageCapture.takePhoto + fallback + stable window
lib/scan/dev/session-store.ts         IndexedDB staging + FS-Access export (A4 layout)
lib/scan/dev/session-types.ts         session + label JSON schemas (D4)
lib/scan/dev/livewire.ts              A6 Dijkstra snapping, D1 cost image        (0a-ii)
test/capture-session.test.ts          appended to the chain
test/labeler.test.ts                  appended to the chain                      (0a-ii)
.gitignore                            captures/, scan-sessions/, *.session.zip
docs/specs/…sprint.md                 render-rule + fidelity + D4 + D6 edits (doc-only)
```

Plus surgical: debug-panel raw-frame export env-gated (item 5), `createHandLandmarker` D2 note
(item 9). `rectifyPalm`'s D3 size param pre-existed (rectify.ts:366) — no edit.
