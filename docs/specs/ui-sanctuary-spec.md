# HastRekha — The Sanctuary
## Complete UI/UX specification for the immersive palmistry experience

**Version:** 1.0 · 6 Sep 2026
**Supersedes:** ui-nadi-pothi.md (folded in below)
**Status:** build-ready. Every section states what ships, what it costs, and
what it must never claim.

---

## 0. The one-sentence product

> Someone walks into an ancient chamber, places their hand into a ceremonial
> scanner, watches their own palm lines illuminate one by one, and then
> receives their reading inside a living manuscript that was found for them.

Not a horoscope site. Not an AI dashboard. Not a fortune-teller casino.
**A luxury digital palmistry sanctuary** whose authority comes from the fact
that everything it shows was actually measured on the user's hand.

---

## 1. References — view before writing any style

All in `docs/reference/`. Load them, then compare after.

| File | Role |
|---|---|
| `ui-nadi-pothi-candlelight-photo.png` | **Tonal anchor for the book.** One candle, wooden covers, a hand on palm leaves. No glow, no particles. If a page ever looks *rendered*, this photo is the correction. |
| `ui-scan-hologram-pedestal-library.png` | **Primary reference for the scanner.** Brass pedestal, zodiac ring, hologram cylinder, library depth behind. The book sits open beside it — sacred and instrument in one frame. |
| `ui-home-hero-hand-explore-wisdom.png` | Home composition, graha-line labels in Devanagari, wax seal, category tiles. |
| `ui-reading-lifeline-explainability-card.png` | Parchment panel, "Why HastRekha says this", Source Wisdom block, provenance rows. |
| `brand-hastrekha-logo-zodiac-wheel.png`, `brand-bhrigu-bodh-logo-concept.png` | Wordmarks, seal motif, sun/zodiac wheel. |
| `font-noah-latin-specimen.png`, `font-noah-devanagari-specimen.png` | Letterform *intent* only. These faces do not ship (see §4). |

**Naming decision required before typography:** the brief says "REKHA", the
logos say "HastRekha" and "Bhrigu Bodh". Pick one wordmark. Recommendation:
**HastRekha** as the product, **Bhrigu Bodh** reserved for the premium tier.

---

## 2. Non-negotiables

These three exist because the product's whole claim is honesty. Violating any
of them makes it another fake-confident astrology app.

### A1 — Additive only
The sanctuary ships as **new routes sharing existing hooks**. `/scan` and
`/read` stay live until parity. **No file in the detection pipeline is edited
for a visual reason.** All nine scan flags keep their defaults;
`flags-identity` and `import-boundary` stay green. The frozen core
(`rectifyPalm`, `fusion`, `stack`, `combineProbabilities`, `WORK_SIZE`)
is untouched.

### A2 — Nothing claimed that was not measured
The scan checklist shows only what was found, with its confidence. Anything
not detected renders as a **Sealed Leaf**. Today that means mounts, most
minor lines and all markings are sealed. This is not a limitation to hide —
it is the feature nobody else has.

### A3 — Two visual languages, cleanly separated
Hologram/ceremonial-technology language belongs **only** to the scanner.
The book is photographic: wood, leaf, one warm light. Rooms and props are
**pre-rendered plates with parallax**; live WebGL never runs while the
camera is scanning (MediaPipe owns the GPU).

---

## 3. Design tokens

```
--stone-900   #0A0806   deepest ground, vignette core
--stone-800   #0D0B09   primary ground (grain texture, never flat)
--stone-700   #16120D   raised panels
--obsidian    #1C1712   nav rail, glass panels over stone

--gold-400    #E8C56A   foil highlight, active state
--gold-500    #C9A24B   primary gold (all linework)
--gold-600    #8A6A2A   engraved shadow
--gold-dust   rgba(201,162,75,0.12)  particle, haze

--parchment   #D9C39A   leaf base
--parch-edge  #B8A075   aged edge burn
--ink         #2A1E12   manuscript body text
--ink-red     #8B1E1E   marginalia, wax seal, citations

--moon        #2B3A52   cold rim light, window, night sky
--flame       #FFB347   candle core
--flame-warm  #E08A2E   candle falloff
```

**Light discipline:** one warm point source per scene. Every shadow, rim and
highlight agrees with it. A second light is only allowed as cold moonlight
from a window, at ≤25% intensity.

**Linework:** solid strokes only, never dashed anywhere in the product.
Secondary 1px @ 0.35 opacity; active 2px @ 1.0 + soft outer glow. (This is
the render ladder already pinned in the scan spec — the UI inherits it.)

**Motion:** slow and heavy. 400–800 ms eases (`cubic-bezier(.16,1,.3,1)`).
Candle flicker 2–4 Hz, ±4% opacity, never rhythmic. Nothing bounces, nothing
springs. Camera moves are 1.2–2 s.

**Depth:** every screen has ≥3 parallax layers (far architecture, mid props,
near dust). Foreground dust drifts at 0.02 px/frame.

---

## 4. Typography

| Role | Face | Notes |
|---|---|---|
| Display Latin | **Cinzel** | Wordmarks, chapter titles, "ENTER THE SANCTUARY". Closest shipping face to the Noah specimen. |
| Display Devanagari | **Tiro Devanagari Hindi** | रेखा names, verse headings. |
| Body serif | **Cormorant Garamond** | Manuscript body text on leaves. |
| Body Devanagari | **Tiro Devanagari Hindi** | Hindi/Hinglish reading text. |
| Technical sans | **Inter** | Confidence values, timestamps, settings, debug. |

All via `next/font` with `display: swap` and preloaded subsets. Budget: ≤ 90 KB
total woff2 for the four families' used weights. The Noah specimens in
`docs/reference/` are concept renders, not licensed fonts — do not attempt to
embed them.

**Numerals:** technical figures in Inter tabular; anything on a leaf uses
old-style figures in Cormorant.

---

## 5. Sound

Ambient layer, **off by default**, one-tap toggle persisted, always mutable
from any screen.

| Cue | When | Level |
|---|---|---|
| Low drone (60–120 Hz bed) | Sanctuary idle | −28 dB |
| Fire crackle | Near candles, positional | −30 dB |
| Brass ring / scanner hum | Scan active | −24 dB |
| Single temple bell | Reveal moment, title leaf | −18 dB, once |
| Leaf turn | Each page | −22 dB |
| Soft chime | Sealed leaf appears | −26 dB |

Never loop anything shorter than 8 s. Total audio payload ≤ 400 KB, lazy,
loaded only after the user enables sound.

**Haptics:** light tick on page turn, medium on reveal, none elsewhere.

---

## 6. Screens

### 6.1 Threshold — the cinematic entrance
First visit only (subsequent visits skip to Sanctuary; "replay entrance" in
settings).

```
0.0s   black
0.5s   a single gold point appears, centre, breathing
1.5s   the point resolves into a distant doorway; dust drifts through it
2.5s   HASTREKHA  (Cinzel, letter-spaced, gold, fading up)
3.2s   हस्तरेखा  (Tiro Devanagari)
4.0s   "Ancient wisdom. Modern insight."
5.0s   "Your hands hold a story."
6.0s   a lit path of gold dust leads toward the doorway
6.5s   [ ENTER THE SANCTUARY ]   — never auto-advances
```

On click: camera pushes through the doorway (GSAP, 1.8 s), light blooms,
particles stream past, and the Sanctuary resolves from the bloom. Skippable
with any key or tap; skip is remembered.

Implementation: pre-rendered doorway plate + CSS/canvas particles + GSAP.
**No WebGL** — this must be instant on a cold load.

### 6.2 Sanctuary — home
The room from `ui-scan-hologram-pedestal-library.png`, built as layers:

```
LAYER 4 (far)   library architecture, arched window, moon, shelved bundles
LAYER 3 (mid)   the brass pedestal + hologram cylinder (interactive)
LAYER 3 (mid)   the open manuscript on the right (interactive)
LAYER 2 (near)  candles, crystals, brass instruments, stacked books
LAYER 1 (dust)  drifting gold particles, incense haze
```

Layers 4/2/1 are pre-rendered plates (Blender via the showcase3d toolkit) at
three densities (1×/2×/3×), parallaxing on pointer and device tilt at
±12 px max. Only the pedestal and the book are live.

**Optional R3F upgrade (desktop, after idle, behind a capability check):**
the pedestal becomes a real Three.js object with a slowly rotating zodiac
ring and volumetric shaft. Lazy chunk, never on the scan route, never on
low-end devices. Fallback is the plate — visually near-identical.

**Navigation** — carved into a dark stone rail on the left, not a sidebar:
gold engraved glyphs, label revealed on hover, active item lit with a warm
inner glow as though a lamp sits behind the stone.

```
गृह        HOME
हस्त       SCAN PALM
पत्र       MY READING
ग्रह        HOROSCOPE
गुरु        ASK THE GURU
दिशा       DAILY GUIDANCE
लेखा       JOURNAL
यंत्र        SETTINGS
```

Header: "स्वागत, साधक · Welcome, Seeker" with the user's name if known.
Bottom actions (mobile: a floating brass bar): **SCAN · GURU · GUIDANCE ·
READINGS**.

### 6.3 The Chamber — scan
Camera feed, then everything else is **canvas 2D over it** (no WebGL, GPU is
MediaPipe's):

- Vignette to near-black; one warm rim light on the hand's side.
- Landmarks as gold constellation points; connections hairline; palm quad a
  gold frame with engraved corners.
- The zodiac ring from the reference, drawn as canvas arcs, rotating 0.6°/s,
  filling as the tilt choreography completes.
- Gate prompts (`Hatheli camera ke saamne laao`) rendered **as ink on a small
  leaf** sliding in from the bottom, never as toasts.
- Detected lines illuminate **progressively, as they are actually found** —
  each with its Devanagari name on a thin gold leader line, exactly like the
  reference. A line that is not found never gets a label.

**Stage copy** (drives from real pipeline state, not a timer):

```
कक्ष तैयार हो रहा है…      Preparing the chamber
हाथ पहचाना जा रहा है…      Recognising your hand
हथेली का नक्शा…            Mapping the palm
मुख्य रेखाएँ…               Tracing the major lines
सूक्ष्म रेखाएँ…              Reading the minor lines
पारंपरिक पाठ से मिलान…     Comparing traditional patterns
आपका पत्र तैयार…           Preparing your leaf
```

If a stage finds nothing, its line reads **"इस बार नहीं मिला"** and the
corresponding leaf will be sealed. No stage ever shows a green tick it did
not earn (**A2**).

**The reveal beat** — after the last stage:

```
"रेखाएँ खींची जा चुकी हैं."        The lines have been traced.
        ── 1.2 s silence ──
"पैटर्न पढ़े जा चुके हैं."          The patterns have been studied.
        ── 1.6 s silence ──
        screen darkens to black
        ── 0.6 s ──
        the bundle arrives
```

Mystery comes from silence and darkness, never from jump-scares.

### 6.4 The Pothi — reading
**The tonal anchor photo is the target.** A bundle of palm leaves between
wooden covers, tied with red thread, lit by one candle.

1. The bundle rests closed. The thread unties itself (400 ms). The top cover
   lifts and slides back.
2. **Title leaf** — name, hand, date, a wax seal bearing the session id.
3. **Chapters**, one leaf per chapter:

```
I     हाथ का आकार        The Shape of Your Hand
II    हृदय रेखा           The Heart Line
III   मस्तिष्क रेखा        The Head Line
IV    जीवन रेखा           The Life Line
V     शनि रेखा            The Fate Line
VI    सूर्य व बुध रेखा      The Sun and Mercury Lines
VII   पर्वत                Mounts and Influences
VIII  प्रेम व संबंध         Love and Relationships
IX    कर्म व सफलता        Career and Success
X     स्वभाव               Personality and Strengths
XI    जीवन दिशा           Life Direction
XII   आपके प्रश्न          Your Questions
XIII  पूर्ण पाठ            Your Complete Reading
```

**Leaf layout:**
- **Left page** — the user's own palm crop, aged to parchment tone, with that
  chapter's line drawn in gold: the *measured polyline*, nothing invented. A
  small particle travels the line once when the page settles.
- **Right page** — the reading in the user's language, the Sanskrit verse
  from the Source Wisdom table with its translation, and provenance as **red
  marginalia** in the outer margin: `Cheiro, Ch. VII · measured · 91%`.
- **Fold-out flap** — "HastRekha ऐसा क्यों कहती है" opens the full evidence:
  fired rules, tier, confidence, the three provenance groups.
- **Page number** — `पृष्ठ ०७ / ४२`, Devanagari numerals, bottom outer corner.

**The Sealed Leaf** (the honesty mechanic, **A2**):
blank parchment, a red wax seal pressed in the centre, one line of ink:

> **यह पत्ता अभी खुला नहीं।**
> आपकी सूर्य रेखा स्पष्ट नहीं दिखी — खिड़की के पास दोबारा स्कैन करें।
> *[ दोबारा स्कैन करें ]*

The button returns to the Chamber **with that specific instruction**. This
turns every gap in the detector into an invitation, and it is the single
strongest trust signal in the product.

**Page turn:** CSS 3D (`transform-style: preserve-3d`, per-leaf `rotateY`,
one leaf in flight, shadow gradient tracking the fold, back-face shows the
verso). Drag, click, arrow keys, swipe. Target ≥ 55 fps on a mid-range
Android; if a device drops below, degrade to a cross-fade automatically.

### 6.5 The Guru
Not a chat window. A **floating parchment scroll** that unrolls from the
bottom of the sanctuary, ink appearing as it writes.

- The Guru answers **only** from tool outputs: the user's measured features,
  fired rules with citations, kundli computations, prior conversation.
- Every claim carries its tier badge: **मापा गया** (measured) · **गणना**
  (computed) · **आपने बताया** (you told me) · **परंपरा** (tradition).
- When evidence is missing, it says so and offers the capture that would fix
  it — the same sealed-leaf logic in conversation form.
- Pain, medical, financial and legal questions get a fixed, scripted redirect.
  Never improvised.

### 6.6 My Readings — the shelf
Previous readings as physical bundles on a shelf, spines labelled and dated,
tilting slightly on hover with a puff of gold dust. Click pulls one down and
opens it. Two bundles can be placed side by side to compare — the Timeline
diff ("आपकी मस्तिष्क रेखा का विच्छेद अब भर चुका है" — measured, not asserted).

### 6.7 Daily Guidance
A single leaf on a small stand, turning once per day. Today's message, then
energy / career / relationships / focus / reflection. When a kundli exists,
this is driven by real transits against the natal chart, labelled **गणना**.

---

## 7. Micro-interactions

| Action | Response |
|---|---|
| Hover a palm line | Line brightens to 2px/1.0, a particle runs its length, name + confidence tooltip on a small leaf |
| Hover a book/bundle | Tilts 3°, gold dust rises, spine title brightens |
| Open a chapter | Camera eases toward the book, room dims 15% |
| Tap Scan | Pedestal rings spin up, hologram column brightens, room dims |
| Tap Guru | Scroll unrolls from below, ink writes in |
| Tap My Readings | Camera pans to the shelf |
| Sealed leaf appears | Soft chime, seal presses in with a 200 ms squash |
| Any error | The candle gutters once. Never a red toast. |

---

## 8. Camera system

Five named positions, GSAP transitions of 1.2–2.0 s with eased depth-of-field:

```
CAM_SANCTUARY  wide, pedestal centre-left, book right
CAM_SCANNER    pushed in on the pedestal, book out of frame
CAM_BOOK       the manuscript fills frame, room bokeh'd
CAM_GURU       three-quarter, scroll foreground
CAM_LIBRARY    panned right to the shelf
```

On plate-based (non-WebGL) screens these are implemented as coordinated
parallax + scale + crossfade of the same layers, which reads as camera
movement at a fraction of the cost.

---

## 9. Responsive

**Desktop (≥1280):** full sanctuary, nav rail, pedestal and book both visible.
**Tablet:** nav collapses to glyphs; book takes 70% width when open.
**Mobile:** *not a shrunk desktop.*
- Sanctuary becomes a vertical scene: pedestal centred, book peeking from the
  bottom edge as a "pull up" affordance.
- Nav becomes a floating brass bar, 4 primary actions.
- The Chamber is full-bleed camera with the ring at thumb height.
- The Pothi is full-screen, one page at a time, swipe to turn, pinch to zoom
  the palm crop.
- Parallax driven by device tilt, clamped to ±8 px.

---

## 10. Performance budgets — enforced, not aspirational

| Metric | Budget |
|---|---|
| Threshold route JS | ≤ 60 KB gz, no WebGL |
| Sanctuary initial JS | ≤ 140 KB gz (plates are images, not JS) |
| R3F chunk | lazy, desktop only, after idle, ≤ 180 KB gz |
| Chamber added per-frame cost | **≤ 3 ms** over current scan (measured on mid-range Android) |
| Pothi page flip | ≥ 55 fps; auto-degrade to crossfade below |
| First leaf visible | < 1.5 s after route load |
| Plates | AVIF with WebP fallback, 3 densities, `fetchpriority` on the current camera only |
| Audio | ≤ 400 KB, lazy, only after opt-in |
| Battery | scan session battery draw must not regress vs today |

**Capability tiers:** HIGH (R3F + full particles) · MID (plates + parallax +
particles) · LOW (plates, no particles, crossfade transitions) · FLOOR
(static, no motion — also the `prefers-reduced-motion` target).

---

## 11. Trust, and the words we use

Present on the reading, in the Guru, and in settings:

- "पारंपरिक हस्तरेखा व्याख्या · Traditional palmistry interpretation"
- "आपकी हथेली से मापी गई विशेषताओं पर आधारित · Generated from features
  measured in your scan"
- "हस्तरेखा एक पारंपरिक व्याख्यात्मक परंपरा है — मार्गदर्शन के लिए, निश्चितता के
  लिए नहीं."

**Never:** medical, financial or legal advice; guaranteed outcomes; the word
"prediction" as fact; a confidence figure that isn't the real one.

**Always:** the tier badge, the citation, and the sealed leaf where evidence
is absent.

---

## 12. Data the UI needs

Exists today: per-line polylines with confidence and tier; area verdicts with
the INSUFFICIENT band; fired rules with source citations; the three
provenance groups.

Needed for full chapters (build as clean interfaces now, connect later):
Source Wisdom verse table keyed by line/area · wisdom-of-the-day pick ·
reading history + share token · kundli chart, dasha, transits · mount and
mark features (sealed until measured) · scan-to-scan diff for Timeline.

**Rule:** where a field does not exist, render the **Sealed Leaf** — never a
placeholder sentence, never lorem, never an invented reading.

---

## 13. Build phases

Each phase is a separate route behind its own flag; the current pages stay
live until parity is signed off.

| Phase | Deliverable | Done when |
|---|---|---|
| **U0** | Tokens, fonts, plate pipeline (Blender → AVIF ×3), capability tiers, sound scaffold | Tokens applied to one existing page with no visual regressions |
| **U1** | **The Pothi** — page turn, leaf layout, palm crop with measured line, marginalia, fold-out evidence, **Sealed Leaf** | A real reading renders end-to-end; flip ≥ 55 fps; sealed leaves appear for every unmeasured feature |
| **U2** | **The Chamber** — canvas overlays, zodiac ring, progressive line reveal, stage copy, reveal beat | Added frame cost ≤ 3 ms on a mid-range Android; no pipeline file edited |
| **U3** | **The Sanctuary** — plates, parallax, nav rail, camera positions, Threshold entrance | Initial JS ≤ 140 KB gz; entrance skippable and remembered |
| **U4** | **The Guru** — scroll UI, tool-grounded answers, tier badges | Grounding audit: 0 untraceable claims across 50 test conversations |
| **U5** | Shelf, Timeline diff, Daily Guidance, sound + haptics, R3F upgrade for HIGH tier | Budgets hold; parity sign-off; old routes retired |

**U1 first, deliberately.** A working manuscript with honest sealed leaves is
worth more than a beautiful empty room, and it can be built against the
backend that already exists.

---

## 14. What this must never become

- A dashboard with a mystical skin.
- A green-tick checklist that ticks things nobody measured.
- A chatbot that answers from vibes when the tools returned nothing.
- A WebGL showpiece that drops the scan to 12 fps.
- A reproduction of the reference renders. They are inspiration; the product
  is its own thing, and the photograph — one candle, real leaves, a human
  hand — is closer to the truth of it than any hologram.
