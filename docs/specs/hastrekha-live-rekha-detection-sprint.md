# HASTREKHA — LIVE REKHA DETECTION ENGINE — SPRINT SPEC v2

**REPO: `C:\Projects\hastrekha` — this is HastRekha, NOT Physenta. If you find yourself in a physiotherapy codebase, STOP — wrong repo.**

Branch `dev`. Remotes `origin` + `backup` (thesrijans/hastrekha), dual push. Work directly on the repo — there are no ZIP files. All existing scan code lives in this repo; inspect it in place.

This sprint costs **zero Anthropic API budget** — it is all local CV. Do not call any LLM API in this sprint.

---

## 0. FREEZE LIFT (read before touching anything)

The scan core is tagged `scan-core-v1-frozen` with a standing rule: *no detector changes without ground-truth + golden update.*

**For this sprint the freeze is deliberately lifted**, under these conditions:

1. Phase 0 (ground truth) MUST be completed before any detector code changes. The ground-truth set is what re-authorizes detector work.
2. Every golden that changes gets re-pinned with a measured `REPIN.md` entry — same pattern as the Dale merge (`0.3.0-dale-merged`). State old value, new value, and why.
3. `KB_RULE_COUNT` in `lib/scan/classify.ts` stays untouched. Still labelled Cheiro-era snapshot. Refreshing it is a separate step, not this sprint.
4. Everything under `/read`, `lib/hastrekha/area-*.ts`, `/api/reading`, and the KB is **out of scope**. This sprint ends at a Rekha Map data structure. The reading layer consumes it later.

---

## 1. THE DIFFERENTIATOR — WHY THIS IS LIVE LIKE NOTHING ELSE

Every competitor does one of two things: (a) photo → LLM → paragraph, or (b) a drawn/animated overlay that ignores the actual creases — designer artwork whose lines do not follow the real creases. (The AstroTalk reference image is withdrawn; there is no aesthetic reference image. `docs/reference/` is reserved for future UI-feedback screenshots.)

Our live mechanism is real, and it is this:

### The canonical-space / projection split

```text
DETECTION lives in canonical palm space (slow, heavy, accurate)
RENDERING lives in screen space (every frame, cheap, instant)
```

- All line geometry is stored in **canonical palm coordinates** (the rectified space the existing homography already produces).
- Every display frame (~30fps), the current MediaPipe landmarks give homography H_t. The stored canonical paths are projected through H_t onto the live video overlay.
- Result: **the detected lines stick to the moving hand like AR.** User rotates the hand → lines rotate with it, instantly — even though heavy detection only runs every 1–3 seconds in the background.

Nobody in this market has this. Everyone else either freezes a photo or fakes an animation. Ours moves with the hand because projection is per-frame and geometry is canonical.

### Confidence-driven rendering (real state, zero fake animation)

Line visual style is a direct function of the evidence store — never a scripted animation:

| State | Trigger | Render |
|---|---|---|
| SEARCHING | no candidate yet | nothing (or region hint only) |
| CANDIDATE | first detection on a composite | solid, 1px, 0.35 opacity |
| TRACKING | same structure on ≥2 consecutive composites | solid; stroke width and opacity scale with confidence |
| CONFIRMED | confidence ≥ threshold | solid, 2px, 1.0 opacity, subtle glow (reduced-motion safe) |
| ABSENT | ≥3 composites, no seeds in constrained region | status chip only, NO stroke: "is angle se [line] nahi dikh rahi" |

**No dashed strokes anywhere.** All rekha strokes are solid; confidence is encoded via opacity + stroke width only.

The user literally watches lines sharpen from faint-thin to full-strength as evidence accumulates. That IS the fusion pipeline made visible. No animation timeline anywhere — if the render changes, the underlying state changed.

Hand leaves frame → lines fade (real state loss). Hand returns → session identity re-acquired (handedness + geometry match) → lines snap back. This alone will feel like magic and costs almost nothing.

### The three honest layers of "live"

1. **30fps:** landmark tracking + projection + frame quality scoring (cheap).
2. **~1–2s cadence:** registration + fusion composite update (Web Worker).
3. **Per composite update:** UNet inference on the fused composite ONLY — never per raw frame. One good inference on a stacked image beats thirty on noisy frames, and the phone doesn't thermal-throttle.

---

## 2. NON-NEGOTIABLES

- **No fake detection.** Every rendered pixel of overlay traces to a real state in the evidence store.
- **No hallucinated Rekhas.** Insufficient signal → ABSENT / "view not clear" state, with guidance. `no_seeds` is a first-class outcome, not an error.
- **No Hough/Canny straight-line shortcuts.** Creases are curved biological structures. Ridge response → constrained path extraction, as the pipeline already does.
- **Fusion must EARN its place.** If the ablation (Section 9) shows fused composite does not beat best-single-full-res frame, fusion does not ship. Report the numbers either way.
- **Surgical edits only.** ADD/UPDATE. Never rewrite the existing MediaPipe / homography / Frangi / UNet / EMA modules wholesale — extend them. Confirm exact file paths in recon before proposing edits.
- Standards: no `any`, AbortController on fetches, isMountedRef cleanup, JSDoc, ARIA on all new UI (labeler included), named constants, kebab-case files, PascalCase exports, no shadcn/clsx, Tailwind v4 `@theme` in globals.css, framer-motion only with `useReducedMotion()` branch. Tests = plain tsx chained in package.json, `node:assert/strict`, banner comments, `console.log("X ASSERTIONS PASSED")`, new suites appended to the chain manually.

---

## PHASE 0 — GROUND TRUTH (blocks everything else)

**You cannot answer "did multi-frame fusion improve detection?" without a labeled set. So the labeled set comes first.**

### 0a. Capture harness (minimal, dev-only)

- Dev route `/dev/capture` (hard-gated: `NODE_ENV !== 'production'` → 404).
- Uses the live preview for framing + landmark check, then captures a **full-resolution still** via `ImageCapture.takePhoto()` (Android Chrome supports it; fallback: max-resolution track constraints + canvas grab). `takePhoto()` can stutter the preview on some devices — capture during a "hold still" beat and verify on the TUF's webcam + one Android phone.
- Saves per session, locally only (File System Access API or IndexedDB → export): full-res original, canonical-warped crop, landmarks JSON, quality scores. Local capture dirs go in `.gitignore`.

### 0b. Labeler (dev route `/dev/label`)

- Loads a captured session, shows the **canonical-warped** palm.
- Draw polylines per line type: heart / head / life / fate. Click to add points, drag to adjust, undo.
- **"Absent" is a valid label** per line (checkbox) — a hand with no visible fate line is data, not a failure.
- Export JSON:

```json
{
  "schemaVersion": "0a-1",
  "sessionId": "…",
  "stillIndex": 0,
  "frame": "selected/crop-000.png",
  "anchors": [[512, 530], [377, 490], [320, 234], [553, 235]],
  "canonicalSize": 512,
  "hand": "left|right",
  "lines": [
    { "id": "heart", "points": [[0.141, 0.25], [0.469, 0.219]], "absent": false },
    { "id": "head",  "points": [], "absent": true },
    { "id": "life",  "points": [[0.313, 0.281], [0.391, 0.469]], "absent": false },
    { "id": "fate",  "points": [], "absent": true }
  ],
  "//": "lines[].id ∈ heart|head|life|fate (mandatory four) ∪ sun|health|marriage|bracelets|girdle (optional minors, 0a-iii)",
  "absent": ["head", "fate"],
  "mode": "blank_slate|correction",
  "labeler": "srijan",
  "capturedAt": "ISO", "labeledAt": "ISO"
}
```

Decision D4: `points` are 0–1 canonical-crop fractions and the `frame`/`anchors`/`lines`
triple matches `GroundTruth` in `test/golden-run.ts`, so a labeler export is directly
consumable as a ground-truth fixture. Schema + validators: `lib/scan/dev/session-types.ts`.

- **TWO MODES, strictly separated:**
  - **Blank-slate mode (EVAL):** detector output is NEVER rendered. Labeler sees only the palm. This is the only mode used to build the eval set. (If the labeler only corrects AI proposals, lines the AI never finds never enter the set and precision inflates.)
  - **Correction mode (GROWTH):** shows detector output, human accepts/corrects/rejects. Builds future training data. Build the toggle now, use it AFTER the eval set is locked. Eval set is never used for training.

### 0b-ii. Labeler internals (built in 0a-ii — durable decisions)

**A6 (addendum, now spec-durable):** Labeler upgrade for Phase 0b: livewire/intelligent-scissors
path snapping — Dijkstra over a ridge-cost image so the labeler clicks endpoints and the polyline
snaps along the crease. Cost image comes from a generic ridge filter, NOT from our detector output
(blank-slate rule holds for the eval set).

**D1 (ruling, now spec-durable):** the livewire cost image is NOT frangi.ts. Cost must be
independent of detector modules: inverted-luma valley response via small LoG (σ ≈ 1.5–3 px at
labeling resolution) on the canonical crop, normalised, with a cost floor. Free-draw override is
always available (assist, not gate). `label-client.tsx` and `livewire.ts` import nothing from
`lib/scan/{segmenter*,ridge,frangi,fusion,stack,completion,lines,quality}` — enforced mechanically
by `test/import-boundary.test.ts`, which also asserts the reverse direction (no production file
imports `lib/scan/dev` or `app/dev`).

Implementation: `lib/scan/dev/valley.ts` (VALLEY_SIGMAS [1.5, 2.2, 3.0] @512, positive
scale-normalised LoG, max-pooled, 99.5th-percentile normalised) · `lib/scan/dev/livewire.ts`
(COST_FLOOR 0.04, 8-connected Dijkstra, ×√2 diagonals, LIVEWIRE_RADIUS_PX 192 fallback window once
a full-grid seed measures over budget) · `lib/scan/dev/enhance.ts` (display-only views).

**Three view modes, display-only, never written back:** NATURAL (passthrough) · CONTRAST (own
CLAHE, 8 tiles / clip 2.5, gamma 0.9) · CREASE (desaturated base at 0.45 + the SAME valley response
tinted antique gold #C9A24B). **Enhancement is continuous tone only — no thresholding, no thinning,
no polylines.** The moment an enhanced view draws a line it is proposing labels, and proposals are
what the blank-slate rule keeps out of the eval set. **HOLD Space flips to NATURAL while held** —
the bias check: a crease that vanishes in the natural view earns `faint` (also the default
confidence when a line is committed from CREASE). The label records `viewAtCommit` per line and the
gray `channel` per file, so any enhancement-induced bias stays measurable afterwards.

**Hotkeys:** 1–4 heart/head/life/fate · 5 sun · 6 health · 7 marriage · 8 bracelets · 9 girdle (minor lines, optional — Save requires the majors only) · click seed/append · S snap toggle · Z undo
segment · Enter commit · Esc cancel · A absent · V view cycle · C channel cycle · Space hold =
natural · L loupe (3×, 120 px) · wheel / + / − zoom 1–8× · Shift+drag pan · Backspace delete
selected vertex.

**Label schema 0a-2** (validators in `lib/scan/dev/session-types.ts`; 0a-1 files remain valid and
carry none of the new fields — never half-upgraded):

```json
{
  "schemaVersion": "0a-2",
  "lines": [ { "id": "heart", "points": [[0.141, 0.25]], "absent": false,
               "confidence": "clear|faint|uncertain",
               "method": "livewire|manual|unet-prelabel-corrected",
               "viewAtCommit": "NATURAL|CONTRAST|CREASE" } ],
  "labelerId": "srijan",
  "enhancement": { "version": "enh-1", "channel": "LUMA|R|G|B" }
}
```

**Confidence is a string enum** (`clear` / `faint` / `uncertain`), not numeric 1–3 — ruling to
match the hand-traced ground truth in `test/fixtures/ground-truth/` (`"confidence": "faint"`), so
one convention exists, not two. **`unet-prelabel-corrected` is RESERVED**: it names the locked
correction-mode flow (growth set, after the eval set freezes) and nothing produces it in 0a — the
correction toggle renders disabled with “locked until eval set is frozen” and no detector output is
wired.

### 0c. Collect + label

- **30–50 palms.** Vary: lighting (daylight/tube-light/dim), skin tone, age, both hands, rings on/off. Family, friends, Dr. Radhika's clinic if convenient.
- Lock ~40 sessions as the **eval set** (read-only from then on). Remainder seeds the growth set.
- This is ~3–4 hours of Srijan's time and is the highest-value work in the sprint. No detector code merges before it exists.

### 0d. Eval harness

- Script (tsx, in the test chain): loads eval set + detector output → computes Section 9 metrics → prints a table. One command, deterministic, becomes the sprint's scoreboard.

---

## PHASE 1 — CAPTURE UPGRADE

**Tracking resolution ≠ detection resolution.** Preview stream stays low-res for 30fps landmarks. Detection frames are full-res stills.

### Frame quality scoring (every preview frame, cheap)

- Sharpness: variance of Laplacian on the palm crop. **(Moved into Phase 0a per decision D6 — `varianceOfLaplacian`/`SHARPNESS_MIN_VARIANCE` in `lib/scan/quality.ts`, measured on palm-bbox luma at full resolution, shown in the capture gate readout; stills auto-select only when it passes.)**
- Motion: mean landmark displacement vs previous frame.
- Exposure: palm-crop luminance percentiles (reject blown/black).
- Coverage: palm bbox area ratio + all-21-landmarks-in-frame check (fixes the current clipped-hand degradation — the HUD already warns; now it also gates).
- Composite 0–100 score. Named constants for every threshold.

### Burst logic

- Rolling ring buffer of recent frames + scores (memory only).
- When score stays above threshold for ~300ms ("stable window"), trigger a full-res still. Collect top-k stills (k = 5–8) per pose.
- Nothing persists automatically. Debug persistence is Phase 0's harness, dev-only.

---

## PHASE 2 — REGISTRATION (the make-or-break step)

A crease in canonical space is ~1–3px wide. **If registration error exceeds crease width, fusion DESTROYS signal instead of improving it.** This is why naive stacking fails.

1. **Coarse:** existing landmark homography → canonical palm rect (confirm canonical dimensions in recon; work at ≥512px on the long side for detection — upsample the canonical target if it's currently smaller, as a named constant, goldens re-pinned).
2. **Fine (MANDATORY, not optional):** sub-pixel refinement of each warped frame against a running reference — ECC alignment or phase correlation on the CLAHE-normalized crop. Landmarks alone jitter 2–4px; that jitter is bigger than the feature we're stacking.
3. **Registration QA:** residual error metric per frame. Residual > threshold (start ~1.5px, named constant) → frame is EXCLUDED from fusion. Log exclusions to the debug screen.

---

## PHASE 3 — FUSION

Palm creases are faint, low-contrast shadow features. **Plain averaging smooths them away.** Order of operations:

1. Per registered frame: CLAHE normalize → ridge response (existing Frangi module — reuse, don't rewrite).
2. Per-pixel fusion across the top-k registered ridge maps: **trimmed mean of top-k responses** (or median-of-max). Faint-but-consistent survives; single-frame noise doesn't.
3. Also produce a fused *intensity* composite (for the debug screen and future ML), same registration, sharpness-weighted.
4. **Ring masking BEFORE ridge/UNet:** detect ring bands (specular + hue anomaly across finger bases in canonical space) → mask out. Otherwise rings produce fake breaks/islands. (Reference photo has two rings — this is not hypothetical.)

Composite updates every 1–2s in a Web Worker (OffscreenCanvas where available). Degrade cadence gracefully if frame times spike — never freeze the projection layer.

---

## PHASE 4 — DETECTION ON THE COMPOSITE

- UNet ONNX runs on the fused composite only. Confirm current UNet input size in recon; if the canonical upsample changes it, document in REPIN.md.
- Path extraction stays landmark-constrained: candidate regions derived from finger bases, thumb base, wrist, palm center (existing geometry — extend, don't replace). Heart searches under the finger bases, life arcs around the thenar, etc. Regions come from measured landmarks, never hardcoded pixel boxes.
- Pre-approved junction-aware tracing audit (§4.2 from the handoff) belongs here if it fits the sprint; otherwise leave a marked TODO — do not half-do it.
- Output per line: canonical path polyline, length, curvature stats, continuity/breaks, branch points, confidence inputs.

### Temporal identity + evidence store

- New composite arrives → match candidates to existing tracked lines (path distance in canonical space + type region). Same structure → same identity, observation appended, geometry updated by EMA **in canonical space** (reuse the existing temporal EMA approach — it moves here from image space).
- Confidence per line = f(visibility strength, continuity, temporal consistency across composites, geometric plausibility). Document the formula in JSDoc; every weight a named constant.
- ABSENT: constrained region searched on ≥3 composites, no seeds → honest absent state (this is the current fate-line reality — keep it honest).

### Rekha Map (sprint's final artifact)

```text
RekhaMap
 ├── sessionId, hand, canonicalSize, capturedAt
 ├── lines: { heart|head|life|fate:
 │     path[], lengthNorm, curvature, continuity,
 │     branches[], breaks[], intersections[],
 │     confidence, state, observations[] (composite ids) }
 ├── quality: { framesUsed, framesRejected, registrationResidualMedian }
 └── provenance: { pipelineVersion, modelVersion }
```

Design it to extend (secondary lines, mounts, markings later) without migration pain. This structure — not a rendered image — is what the reading layer will consume.

---

## PHASE 5 — LIVE PROJECTION LAYER

The user-facing "live like no other" piece. Implements Section 1 exactly:

- Overlay canvas over the video. Every rAF: current landmarks → H_t → project evidence-store paths → draw with state-driven styling (Section 1 table). One-Euro filter on projected points to kill projection jitter (reuse existing One-Euro if present in repo lineage; else implement minimal).
- Status rail (small, scientific, not cartoon): per-line state chips — Searching / Candidate / Tracking / Confirmed / Absent — bound directly to the evidence store. Hinglish microcopy.
- Guidance strings generated from real state only: low sharpness → "haath thoda sthir rakhein", coverage fail → "poora haath frame me laayein", exposure fail → "roshni ki taraf karein", ABSENT persists → "is angle se [line] nahi dikh rahi — agla pose try karein". No random tips.
- Consumer hero art note: the home-hero hand must also include जीवन रेखा (life) and मस्तिष्क रेखा (head) — the current art names only graha-keyed lines. Graha labels map to anatomical ids via a table (शनि → fate, हृदय → heart, सूर्य → sun, बुध → health, चंद्र → intuition, शुक्र → girdle_of_venus), never by renaming the ids.
- Overlay fidelity: draw the **actual extracted polyline**. One-Euro smoothing applies to the projection only; no curve fitting that moves any point more than 1px off the extracted path — a drawn line that drifts off the real crease is a defect. `useReducedMotion()` branch for all fades.

---

## UNet full-hand framing (flag `unetFullHand`)

**Evidence (H2/H2b):** the palm-lines UNet was trained on full-hand canonical warps; on the hard
golden frame the palm-quad crop produced a near-black probability map while full-hand framing drew
continuous crease strokes (6× activated area, max p 0.83→0.92). int8-vs-fp32 divergence also
concentrates on exactly those marginal pixels (IoU 0.62 on the hard frame).

Port facts, proven in H2b and encoded in `lib/scan/models/canonical-fullhand-21.ts` (reference:
`docs/specs/canonical-fullhand-21.json`): **aspect scaling cancels** (canonical × W,H then resize
to 256² ≡ canonical × 256 directly, one pass); **no mirror is applied** — upstream flipped every
input, but an index-pinned anatomical solve absorbs chirality as a reflection (negative
determinant accepted, same rule as `rectifyPalm`); **fixed palmar subset** [0, 1, 2, 5, 9, 13, 17]
instead of upstream's all-21 RANSAC, because upstream kept ~10/21 varying per photo (H2b) and a
temporally stable palm-plane warp is what a crease model needs — `'all'`/RANSAC exists for eval
comparison only.

Runtime path (`lib/scan/fullhand-warp.ts`, all behind `ScanFlags.unetFullHand`, default off, HUD
toggle): client builds the 256² full-hand warp from the RAW 21 landmarks + the palm-quad→full-hand
matrix on accepted crops; the worker infers on it on its UNet-stride frames and pulls the
probability plane straight into the 128 working grid (`remapProbabilitiesInto` — one warp, no
intermediate downsample). Everything from `combineProbabilities` on is byte-for-byte the shipped
path; flags-off identity holds.

0d rungs: `unet-fullhand-fixed` and `unet-fullhand-ransac` (require `--model`); legacy GT runs the
4-anchor approximation and is flagged `approximate` in the report.

**The flag defaults on only after 0d shows a framing delta on ≥ 8 session stills.**

## PHASE 6 — SCREEN-LIGHT PHOTOMETRIC PASS (gated experiment)

The genuinely nobody-has-this idea — **prototype before committing:**

- During capture, sweep a bright panel across the screen (left half → right half → top). Illumination direction shifts → crease shadows shift; flat skin doesn't. Differencing registered frames across illumination states isolates surface relief (shape-from-shading lite).
- Front camera at ~30cm gives only ~5–10° of lighting baseline. **Step 1 is a measurement, not a feature:** capture the sweep on 3–5 real hands, difference the registered frames, and answer: is crease-region response measurably above flat-skin response? Report numbers.
- Signal exists → integrate as an extra fusion channel + it becomes the hero moment of the scan UX (screen visibly "sweeps" the palm and the sweep is REAL sensing). No signal → document why, park it, zero UX built on it.

---

## 7. DEBUG SCREEN — `/dev/scan-debug`

Dev-only (404 in production). Panels:

A. Original full-res frames (with quality scores) · B. Canonical crops · C. Registered stack (flip-through + residuals, exclusions marked) · D. Fused ridge composite · E. Fused intensity composite · F. UNet probability map · G. Extracted paths over composite · H. Live evidence-store dump (states, confidences, observation counts) · I. Eval overlay: prediction vs ground-truth label for eval sessions.

This screen is more important than the pretty UI. It is how we see what the detector actually saw.

---

## 8. STORAGE & PRIVACY (hard lines)

- **Dev:** raw frames + intermediates live ONLY on the local machine (FS Access API / IndexedDB). `.gitignore`d. Never committed, never uploaded, **never in Neon**.
- **Production:** derived data only — landmarks, canonical paths, RekhaMap, quality metadata. No raw palm frames. A palm print is a biometric identifier; raw storage triggers DPDP explicit-consent + retention + breach obligations. Not this sprint's problem to solve — so production simply does not store raw frames. Future opt-in flow (consent copy, retention policy) is a separate, later task; leave a marked TODO, build nothing for it now.
- No schema changes this sprint. If one becomes necessary: raw SQL in Neon SQL Editor → `db pull` → `generate`. Never `prisma migrate dev`.

---

## 9. EVALUATION — DEFINED NOW, NOT AFTER

All metrics computed by the Phase 0d harness on the locked eval set, in canonical space @512.

**Per-line targets:**

| Line | Detection rate | Median path distance | Notes |
|---|---|---|---|
| Heart | ≥90% | ≤6px | |
| Life | ≥90% | ≤6px | |
| Head | ≥75% | ≤8px | known-hard; currently absent on test frames |
| Fate | presence/absence agreement ≥85% | ≤8px when present | absence is a labeled outcome |

**System targets:**
- False extra "major line" detections: ≤5% of eval sessions.
- Temporal stability: under a steady hand, a CONFIRMED line downgrades ≤1× per 10s. No ✓✗✓✗ flicker — ever.
- Confidence calibration: mean confidence of wrong detections must sit clearly below mean confidence of correct ones (report the two numbers).

**Ablation ladder (the sprint's core experiment) — run all rungs, report the table:**

1. Single preview-res frame (current baseline — measure it first so improvement is quantified, and so "why existing detection fails" is answered with numbers).
2. **Best single FULL-RES frame** ← do not skip this rung; expected biggest single jump. If this rung is missing, resolution gains get misattributed to fusion.
3. Fused multi-frame composite.
4. Fused + screen-light channel (only if Phase 6 measurement passed).
5. Multi-angle fusion (5-pose) — **NOT this sprint**; the pose flow from the handoff resumes after single-pose detection passes. Reserved as rung 5 then.

**Shipping gates:** Rung 3 ships only if it beats rung 2 on ≥2 metrics. Rung 2 ships regardless if it beats rung 1 (it will). Honest numbers > impressive pipeline.

---

## 10. OUT OF SCOPE (do not touch)

`/read`, AreaGrid/AreaCard/AreaDetail/CitationDrawer, `lib/hastrekha/area-*.ts`, `/api/reading`, KB files, `KB_RULE_COUNT`, kundli/Sprint 3A, remedies/gemstones (separately parked), Razorpay/P2, share cards, consultant chat, 5-pose capture flow (resumes post-sprint as ablation rung 5).

---

## 11. WORKFLOW

Strict two-step, as always:

- **STEP 1 — RECON (read-only):** inspect, confirm exact identifiers/paths, report findings + proposed plan, STOP. No edits.
- **STEP 2 — APPLY:** only after "confirmed". Pre-written surgical edits, show diff, run `npx tsc --noEmit`, STOP before commit.
- PowerShell commit blocks at every logical checkpoint, two halves (REVIEW: `git status; git add -u; git add .; git --no-pager diff --cached > diff.txt; code diff.txt` → COMMIT: `taskkill /F /IM node.exe; npx tsc --noEmit; npm run build; git commit -m "…"; git push origin dev; git push backup dev`). Selective add by filename when touching near frozen goldens.
- Checkpoint order: (1) capture harness + labeler → (2) eval harness + baseline rung-1 numbers → (3) registration + QA → (4) fusion + debug screen → (5) detection-on-composite + evidence store → (6) live projection layer → (7) ablation table + REPIN.md → (8) screen-light measurement.

---

## 12. PASTE-READY STEP 1 RECON PROMPT

```text
STEP 1 — RECON ONLY. Read-only. No edits, no file creation.

Repo: C:\Projects\hastrekha, branch dev. This is HastRekha (palmistry), not Physenta.

Read the sprint spec at docs\specs\hastrekha-live-rekha-detection-sprint.md
(I will place it there) and inspect the existing scan pipeline. Report:

1. Exact file paths + exported identifiers for: MediaPipe HandLandmarker wrapper,
   homography rectification (and current canonical output dimensions), UNet ONNX
   loader + input size, ridge/Frangi module, temporal EMA fusion, any One-Euro filter,
   the scan page/route, and the HUD warning for clipped hands.
2. Where frames currently come from (preview stream resolution, any still-capture path,
   any ImageCapture usage).
3. Current frame flow: what runs per frame today, at what cadence, main thread or worker.
4. Whether any Web Worker / OffscreenCanvas infrastructure exists.
5. The test chain in package.json (exact script names + order) and which scan goldens
   exist (paths + what they pin).
6. Any existing code that stores frames or crops anywhere (must be none in prod paths —
   confirm).
7. Gaps between the spec's Phase 1–5 and what exists, as a numbered list mapped to
   spec phases.
8. Risks you see (thermal, memory, takePhoto stutter, canonical upsample impact on
   UNet input, golden breakage), each with a one-line mitigation.

Then STOP. Do not propose diffs yet. I will reply "confirmed" with the phase to start
(Phase 0a: capture harness + labeler).
```

---

## 13. DEFINITION OF DONE

1. Locked eval set (≈40 labeled palms) + one-command eval harness.
2. Ablation table rungs 1–3 (4 if measurement passed) with real numbers vs Section 9 targets.
3. Rekha Map produced per session; debug screen shows every pipeline stage.
4. Live projection layer: lines stick to the moving hand at 30fps, opacity/width rising purely from evidence state, honest ABSENT handling, state-derived Hinglish guidance.
5. Goldens re-pinned with REPIN.md; `tsc` + build green; tests appended to chain and passing.
6. A one-paragraph honest answer, with numbers, to: **"Does multi-frame fusion actually improve Rekha detection?"**
