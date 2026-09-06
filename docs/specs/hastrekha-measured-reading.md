# HastRekha — The Measured Reading
## Next-generation Palm + Kundli intelligence: product thesis and technical architecture

**Date:** 3 Sep 2026
**Builds on:** sprint 0a–0d (labeler, eval harness, field-contract audit, full-hand UNet path, minor-line emission), the KB (548 rules, Cheiro + Dale), the life-area verdict engine, the rekha-enhance package.

---

## 0. Thesis in one paragraph

Every palm and kundli product in 2026 is a language model looking at a photo or a chart and speaking fluently. They differ in polish, not in kind, and the user cannot tell a grounded claim from an invented one. The product that makes them look primitive is not a better talker. It is the first one where **every claim traces to something measured on the user's actual hand or computed from their actual chart, where the palm is reconstructed from motion rather than read off a frame, where depth and change are measured rather than guessed, and where the system says out loud what it could not see.** Once that exists, the chatbot, the kundli fusion and the timeline become the *interface* to a real object instead of decoration on a guess.

The one technical bet that nobody has shipped: **hardware-free 3D palm reconstruction on a phone**, using the torch as a known light source and the guided hand tilt the scan already performs as the varying geometry. If it works even at coarse resolution, it turns the two biggest gaps in the KB audit — mounts (130 rules) and line depth — from unmeasurable into measured.

---

## 1. "Will I become rich?" — what the honest, satisfying answer looks like

No system can answer this yes/no, and one that does is lying. The answer that is *better* than yes/no, and that only a measured system can give:

> **What your palm shows (measured, both scans):** your fate line is deep and unbroken from the wrist to the head line — 91% confidence, consistent across both captures. In Cheiro's reading that is a stable, self-made path rather than inherited fortune. Your sun line was faint in both scans; I can't say much about recognition or windfall yet.
>
> **What your Kundli shows (computed):** Jupiter in the 2nd house forms a Dhana yoga with the 11th lord. Your Jupiter mahadasha runs March 2028 to March 2044. The chart gives *timing* the palm cannot.
>
> **Where they agree:** both point to earned wealth, mid-life, through sustained work rather than luck. Where they don't: the chart is stronger on accumulation than the palm is on recognition.
>
> **What would sharpen this:** a scan of your left hand (inherited tendencies vs. what you've made of them), and a retake near a window so I can see the sun line. Tilt toward the light and I'll look again.

That answer is personalised, sourced, tiered, admits its limits, and invites the next action. It is more useful to a believer and more honest to a skeptic than anything a photo-to-LLM app can produce, because those apps cannot know what they didn't see.

---

## 2. The Palm Twin

The core object. Everything else reads from it.

```
PalmTwin {
  hand: 'L' | 'R'
  texture:      canonical 512² illumination-normalised luma, super-resolved from N frames
  depth:        canonical relief map (mm-scale, relative), from motion photometric stereo
  coverage:     per-pixel: how many frames, from how many angles, contributed
  quality:      per-region confidence; where the twin is trustworthy and where it isn't
  lines:        full taxonomy, each with polyline, depth profile, evidence, confidence
  marks:        topological + symbolic, with location and confidence
  mounts:       relief + area + texture density per mount, within-hand relative
  geometry:     chirognomy features from landmarks
  captured:     when, device, lighting class, torch on/off, frames used
  version:      engine + model versions, so it can be re-derived
}
```

### 2.1 Capture: the scan becomes a choreography

The current scan already runs a five-step tilt sequence ("3/5 TILT RIGHT"). That choreography is exactly what reconstruction needs; today its frames are thrown away after fusion. Instead:

- Keep the K sharpest frames per pose (VoL-gated, pose-diverse — both guards exist in the harness now).
- Record per frame: landmarks, palm homography, torch state, exposure/ISO if the platform exposes them, timestamp.
- Two capture modes: **ambient** (any light, texture only) and **torch** (dim room, torch on; enables depth). The UI asks for torch mode once lighting is detected as dim, which is when it works best anyway.

### 2.2 Texture: registered multi-frame fusion

Register every frame to canonical space by its homography, refine with the residual translation + affine the evidence accumulator already estimates, and fuse illumination-normalised luma with per-pixel quality weights. Noise falls as √N; a 12-frame fusion is sharper than any single 720p frame. Detection then runs **once, on the twin**, not per frame. Per-frame detection survives only for the live overlay.

This is the step the sprint is already converging on (field contract → evidence accumulator → reconstruction). It is measurable by the existing eval: twin-vs-best-single-frame F1.

### 2.3 Depth: motion photometric stereo, no hardware

The claim, and its physics. With the torch on, the light is a point source co-located with the camera. As the user tilts the hand through the choreography, the palm's surface normal relative to the light changes by a *known* amount per frame — known because the palm homography per frame gives the palm plane's orientation. Under a Lambertian skin model, observed intensity at a canonical pixel across ≥3 poses is `I_k = ρ · (n · l_k)`, with `l_k` known per frame from geometry and `ρ` (albedo) and `n` (normal) unknown per pixel. Three or more poses solve for `n` per pixel; integrating normals gives relative depth. A crease is a groove: a sharp normal discontinuity. A mount is a broad convex region: a slow normal rotation.

What is genuinely uncertain and must be tested before it is promised:

- Skin is not Lambertian; specular highlights and subsurface scattering break the model. Mitigations: chromaticity-based specular removal, use of the diffuse component only, robust (median-based) solving.
- Torch falloff with distance changes intensity independent of normal. Mitigation: the hand-to-camera distance is known from landmark scale; normalise per frame.
- The hand deforms slightly between poses. Mitigation: solve only inside the rigid palm quad; reject pixels with high registration residual.
- Ambient light contaminates. Mitigation: dim-room requirement for torch mode, and a torch-off reference frame to subtract ambient.

**Experiment before any product commitment:** ten hands, five poses each, torch mode, capture harness records everything. Offline solve. Success criterion: recovered depth along a hand-traced crease is measurably lower than 3 px either side in ≥ 80% of samples, and mount regions rank-order correctly against a palpation self-report in ≥ 7/10 hands. If it fails, the twin ships as texture-only and mounts stay a guided self-check. Either way the product is honest.

### 2.4 Detection on the twin

The sprint's detection stack, applied once to a cleaner input: field contract, full-hand UNet, coherence enhancement + oriented ridge with fragment linking, region-gated minor lines, topological marks from evidence, symbolic marks from a patch classifier trained on labeler points. With depth: line depth profiles and mount relief become direct measurements, unlocking the largest KB gaps.

### 2.5 Both hands, and time

Two twins per user, compared: dominant vs non-dominant is a core classical reading that almost no app does with measurement. And twins accumulate: register a new twin to the old one, diff texture and lines, report change with confidence. "Has anything changed in my palm?" gets a measured answer, and a reason to rescan every few months that isn't a push notification.

---

## 3. Kundli engine

Deterministic, not generated. Swiss Ephemeris (or `astronomy-engine`) for planetary positions, Lahiri ayanamsa, lagna from birth time and place, D1 and D9, Vimshottari dasha to three levels, transits against the natal chart. A yoga library starting narrow and cited: dhana yogas, raja yogas, the ones the KB's dhan/karm/rishte areas can use. Provenance to BPHS and Phaladeepika the same way palm rules cite Cheiro and Dale.

The kundli is user-supplied birth data, computed exactly, and labelled as such in provenance. It contributes what the palm structurally cannot: **timing**. "When will my finances improve" is a dasha and transit question, not a palm question, and the system should say so.

**Concordance.** Palm features and chart indications are mapped into the same life areas with the same evidence-mass mechanism the area engine already uses. Where palm and chart agree, confidence rises; where they disagree, the reading names the tension. A reading that says "your palm and your chart disagree here" is more trustworthy than one that never notices.

---

## 4. The reasoning layer

A tool-using agent whose only permitted facts are tool outputs. The grounding contract `narrator.ts` already enforces ("RULES are the only facts you may use") extends to the whole conversation.

**Tools:**

- `get_profile()` — twins, geometry, kundli, tiers, confidences
- `get_fired_rules(area?)` — rules with evidence, source text, confidence
- `get_missing_evidence(area)` — what wasn't seen, why, and what capture would fix it
- `kundli.dasha(range)`, `kundli.transits(date)`, `kundli.yogas()`
- `compare_scans(a, b)` — measured deltas between twins
- `request_capture(mode, hand, instructions)` — triggers the scan UI with a specific ask
- `search_kb(query)` — rule lookup with citations
- `memory.recall(topic)` — prior conversation facts the user stated

**Contract:** every assertion carries its tier (measured / computed / user-stated / tradition) and confidence, in the prose and in the UI. The agent may not assert a palm feature no tool returned. If asked about something unseen, it says what was unseen and offers the capture that would show it. Kundli timing claims cite the dasha period. Disagreements between sources are surfaced, not smoothed.

**Multimodal continuation:** a new hand photo in chat runs the capture pipeline (single-frame twin, lower confidence, labelled as such) and `compare_scans`; birth details create the kundli; a kundli PDF is parsed for birth data and recomputed, never trusted as-is. Every turn updates the profile, and the profile is what the next turn reads.

**Memory:** the profile is the memory. Conversation memory stores user-stated facts ("I run a business," "I'm considering moving") as user-tier evidence, so follow-ups are personal without fabricating.

---

## 5. Retention loops that are honest

- **Transit prompts** from the user's own chart: "Jupiter enters your 10th on the 14th — here's what your palm and chart said about career." Personal, computed, daily.
- **Rescan windows**: every 90 days, the twin diff. Change is the hook, and it's measured.
- **Second hand**: the reading visibly improves when the other hand is added; the app says exactly what it learned.
- **Evidence progress**: a profile completeness view — what's measured, what's computed, what's still unseen — that makes better capture feel like unlocking, not chores.
- **Family and partner** compatibility from two profiles, with the 36-guna match computed and the palms' relationship lines compared.

None of these require a dark pattern. They work because the underlying object gets better with use.

---

## 6. Data, privacy, regulation

- A palmprint is a biometric identifier used for authentication systems worldwide. A palm twin is a biometric template. Treat it as such under DPDP: explicit consent, encryption at rest, deletion on request, twins stored separately from identity, an on-device-only option for the twin with the server holding features only.
- Training-use consent separate from reading consent, as the labeler already enforces.
- Astrology is belief, not advice: no health, legal or financial recommendations, ever, and the reasoning contract forbids them.
- Minors: no readings without verifiable parental consent.

---

## 7. Evaluation, extended

The 0d harness stays the referee and grows three tables: twin-vs-single-frame detection, depth-vs-hand-traced crease (when depth exists), and a **grounding audit** on the reasoning layer — sample conversations, classify every claim as traceable to a tool output or not, report the untraceable rate. Target: zero. The kundli engine gets golden charts against published ephemeris values.

---

## 8. Build order, with gates

| Phase | What | Gate to next |
|---|---|---|
| 1 (now) | Field contract (H9), fresh labels, minor-line emission on, DOB in onboarding | F1@6 on session GT > baseline; emission precision per class measured |
| 2 | Texture twin: keep K frames, register, fuse, detect once | Twin F1 > best single frame on ≥ 8 hands |
| 3 | Kundli engine + concordance + chat v1 (tools + contract, no depth) | Grounding audit untraceable rate = 0 on 50 conversations |
| 4 | Motion photometric stereo experiment (10 hands, offline) | Success criterion in §2.3 met, or mounts stay self-check |
| 5 | Depth twin, mounts and line depth measured, marks classifier, both hands, timeline diff | Per-feature precision floors |
| 6 | Transit loops, partner mode, growth-set model fine-tune, symbolic marks | Retention and grounding metrics |

Phase 1 is the current sprint. Phase 2 is mostly composition of things that now exist. Phase 3 is the first thing a user would call "the new HastRekha," and it can be built in parallel with Phase 4's experiment.

---

## 9. What we will not build

- A yes/no fortune. The structured answer in §1 is the product.
- Any claim the tools did not return. The grounding audit exists to catch it.
- Mount readings from a single frontal photo. They cannot be seen there; pretending otherwise is the industry's current failure.
- Financial, medical or legal advice dressed as palmistry.
- Engagement mechanics that exploit anxiety. The rescan and transit loops are built on the object improving, not on fear.
