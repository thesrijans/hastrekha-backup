# HastRekha — The Sanctuary
## Complete UI/UX specification for the immersive palmistry experience

**Version:** 1.1 · 7 Sep 2026
**Supersedes:** ui-nadi-pothi.md (folded in below); v1.0 of this file
**Status:** build-ready. Every section states what ships, what it costs, and
what it must never claim.

**v1.1 — amended after the STEP 1 recon measured the codebase.** Six rulings
(R1–R6) are folded into the sections below and marked `[R1]`…`[R6]`. What
changed and why: the font budget and the Threshold JS budget were both written
without measurement and neither was reachable (§4, §10); the left page cannot
show a stored crop because the database refuses images by design (§6.4); two of
the mockup's three provenance groups name books the knowledge base does not
contain (§6.4, §11); route gating belongs to the `app/dev` precedent rather than
the scan flag store (§2); `CapabilityTier` needs its full name because
`ReadingTier` already exists (§10). Chapters were also renumbered: the five life
areas the backend actually scores now have five chapters instead of three.

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
| `ui-scan-hologram-pedestal-library.png` | **Primary reference for the scanner.** Brass pedestal, zodiac ring, hologram cylinder, library depth behind. The book sits open beside it — sacred and instrument in one frame. ⚠️ **THIS FILE DOES NOT EXIST** — not in the working tree and not anywhere in git history (checked 7 Sep 2026). U3 and the pedestal look have no reference to build to; either the image is supplied or the Sanctuary composition is designed from scratch. The zodiac ring alone is recoverable from the wordmark below. |
| `ui-home-hero-hand-explore-wisdom.png` | Home composition, graha-line labels in Devanagari, wax seal, category tiles. |
| `ui-reading-lifeline-explainability-card.png` | Parchment panel, "Why HastRekha says this", Source Wisdom block, provenance rows. |
| `brand-hastrekha-logo-zodiac-wheel.png`, `brand-bhrigu-bodh-logo-concept.png` | Wordmarks, seal motif, sun/zodiac wheel. **The zodiac wheel here is the working reference for `ZodiacRing`** while the scanner plate is missing: outer bead ring, 12 sectors with Devanagari rashi glyphs on radial spokes, inner sun face, ornamental finials at the quarters. |
| `ui-nadi-reading-leaf-bundle.png` | Real palm-leaf manuscript, fanned. Note the binding hole the leaves pivot on, the ~4:1 landscape leaf, the burnished dark edge, and text in 4–5 tight rows. |
| `ui-nadi-stylus-manuscript-01.png` | Stylus, ink pot, leaf on wood. (`-02.png` is a byte-identical duplicate of `-01` — 19 distinct images, not 20.) |
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

**[R5] Route gating uses the `app/dev` precedent, never `lib/scan/flags.ts`.**
A sanctuary route gates itself the way the capture harness does:

```tsx
export default function PothiPage() {
  if (process.env.NODE_ENV !== "development") notFound();
  return <PothiClient />;
}
```

Why not the scan flag store: those nine flags are *detector* flags. They render
as toggle chips in the scan debug HUD, `flags-identity` exists to prove that
turning one on changes the detector's output, and adding a UI route name to
`SCAN_FLAG_NAMES` would put a chip that does nothing to the pipeline into the
detector's own control surface. `flags-identity` never walks `app/`, so routes
added this way cannot affect it.

`import-boundary` **does** walk every new file under `app/` and `components/`.
Two rules bind the sanctuary routes: nothing may import from `lib/scan/dev` or
`app/dev` (dynamic `import()` counts), and the one allowlisted edge —
`components/scan/use-hand-scan.ts -> @/lib/scan/dev/eval-export` — must keep
existing; removing it while refactoring for the Chamber is itself a failure.

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

All via `next/font` with `display: swap` and preloaded subsets. The Noah
specimens in `docs/reference/` are concept renders, not licensed fonts — do not
attempt to embed them.

**[R1] Budget: ≤ 90 KB of NEW preloaded bytes on a Sanctuary route.** v1.0 said
"≤ 90 KB total for the four families", which is not reachable and was written
without measurement. Measured 7 Sep 2026 against live `fonts.gstatic.com` under
next/font's own pinned user agent (it does not send a modern-Chrome UA, and the
difference is large — Tiro's Devanagari is 62.1 KB under next/font's UA and
96.5 KB under Chrome's):

| Family | Subset / cut | woff2 |
|---|---|---:|
| Cinzel | latin, static 600 | **14.9 KB** |
| Cinzel | latin, variable | 25.3 KB |
| Cormorant Garamond | latin, variable normal | **36.9 KB** |
| Tiro Devanagari Hindi | devanagari, 400 | 62.1 KB |
| Tiro Devanagari Hindi | latin + latin-ext | 28.0 KB |
| Inter | latin (already in the root layout) | 47.1 KB |
| Space Grotesk | latin (already in the root layout) | 22.0 KB |

The app already spends **69.1 KB on every route** before a sanctuary face is
added, because Inter and Space Grotesk are declared in the root layout. The four
families' minimum sane preload set is 161.2 KB — 1.8× the old budget.

**What ships:** Cormorant Garamond (latin, variable normal) + Cinzel (latin,
static 600) preloaded on sanctuary routes = **51.8 KB of new bytes ✅**. Tiro
Devanagari Hindi is declared with `preload: false` and streams in the second
wave. **`app/layout.tsx` is not touched** — Inter and Space Grotesk keep their
current declarations and preloads, because editing the root layout to reclaim
preload budget would change what every existing route ships, which A1 forbids.

The consequence to accept honestly: Devanagari swaps in a beat late on first
paint. Chapter titles and रेखा names are the visible cost. If that reads badly
on a real device, the next lever is self-subsetting Tiro through
`next/font/local` against the glyphs the KB actually uses — not preloading it at
the expense of the Latin body face.

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
3. **Chapters**, one leaf per chapter. **Fifteen, not thirteen** — v1.0 gave
   chapters to three of the five life areas the backend scores and dropped
   `dhan` and `sehat` on the floor. Those two are among the most renderable
   things in the product (each has a banded verdict, an evidence list and real
   citations today), so they get leaves XI and XII. The five areas now sit
   contiguously at VIII–XII; VIII–X keep their numbers, and Life Direction,
   Your Questions and the Complete Reading shift to XIII–XV. The Complete
   Reading stays last, which is why the new chapters were not appended.

   The alternative — folding `dhan` into Career and `sehat` into the Life Line —
   was rejected: it would blend an *area verdict* (an aggregate over fired rules)
   into a *measured line* chapter, and those are different provenance classes.
   Keeping them apart is the same discipline A2 asks for everywhere else.

```
I     हाथ का आकार        The Shape of Your Hand
II    हृदय रेखा           The Heart Line
III   मस्तिष्क रेखा        The Head Line
IV    जीवन रेखा           The Life Line
V     शनि रेखा            The Fate Line
VI    सूर्य व बुध रेखा      The Sun and Mercury Lines      ← SEALED at launch
VII   पर्वत                Mounts and Influences           ← SEALED at launch
VIII  प्रेम व संबंध         Love and Relationships          area: rishte  · "Pyaar aur Rishte"
IX    कर्म व सफलता        Career and Success              area: karm    · "Career aur Kaam"
X     स्वभाव               Personality and Strengths       area: swabhav · "Swabhav"
XI    धन व समृद्धि         Wealth and Fortune              area: dhan    · "Paisa aur Samriddhi"
XII   ऊर्जा व स्वास्थ्य      Energy and Health               area: sehat   · "Urja aur Sehat"
XIII  जीवन दिशा           Life Direction
XIV   आपके प्रश्न          Your Questions                  ← SEALED at launch
XV    पूर्ण पाठ            Your Complete Reading
```

**Sealed at launch, and why** (each is a Sealed Leaf, A2, not a gap to hide):

| Chapter | Reason |
|---|---|
| VI Sun and Mercury | `sun` / `health` / `marriage` are RESERVED line ids — declared in the type, absent from `ACTIVE_LINE_IDS`, so no polyline exists for them. The `emitMinorLines` flag does write `lines.sun.present` and `lines.health.form` when on, but the end-of-scan merged-mask extraction bypasses the emitter, so minors arrive only from live frames. The KB is ready and waiting: 22 sun rules, 17 health rules. There is no `lines.mercury` namespace at all — "Mercury line" is `lines.health.*`. |
| VII Mounts | Mounts are never measured. `features.ts` says so in as many words — mount prominence is fleshy relief, which needs shading off the rectified crop — and `/scan` hard-codes an empty mount bag. 130 KB rules idle behind this. |
| XIV Your Questions | `question` is input-only: collected, sanitised, put in the LLM prompt, persisted — and not echoed on the response. No Guru surface exists in code at all. |

**The two backend gaps U1 must seal around** (build the interfaces now, connect
later, per §12): the **Source Wisdom verse table** keyed by line/area, which
does not exist anywhere; and **per-line confidence on the wire** — the number is
measured (`TracedLine.confidence`, the mean field over observed samples) but it
stops in the scan client and never reaches the reading response.

**Leaf layout:**
- **Left page [R3]** — the *measured polyline*, nothing invented, in gold. What
  it is drawn ON depends on whether the crop still exists in this session:

  | Situation | Left page |
  |---|---|
  | Reached from a scan in the same session | The user's own palm crop, aged to parchment tone, carried in `sessionStorage`, with the chapter's measured line over it |
  | A reading opened later, or from the shelf | The same measured polyline on a **neutral palm diagram**, with an ink note in the margin: **मूल चित्र सुरक्षित नहीं रखा जाता** ("the original image is not kept") |

  This is not a workaround. `prisma/schema.prisma` carries the commitment in the
  schema itself — *"sanitised feature bag exactly as evaluated (no images,
  ever)"* — and `/scan` promises the user the same thing in its own copy. **Never
  store an image to make a page prettier.** The neutral-diagram fallback is the
  honest render, and saying why in the margin is a trust signal, not an apology.

  A small particle travels the line once when the page settles, either way.
- **Right page** — the reading in the user's language, the Sanskrit verse
  from the Source Wisdom table with its translation (**the verse table does not
  exist yet — until it does, that block is itself a Sealed Leaf, never a
  placeholder verse**), and provenance as **red marginalia** in the outer
  margin: `Cheiro, Ch. VII · measured · 91%`. The citation comes from the
  structured `sources` on area evidence (`{ text, loc, year }`), not from
  `rules[].source`, which is pre-joined to one string and drops everything after
  the first source.
- **Fold-out flap** — "HastRekha ऐसा क्यों कहती है" opens the full evidence:
  fired rules, tier, confidence, and the provenance groups.

  **[R4] The groups show only what the knowledge base contains.** The KB cites
  exactly three sources — **Cheiro — Palmistry for All (1916)**, 377 rules;
  **Dale — Indian Palmistry (1895)**, 171 rules; **Samudrika tradition**, 1 rule
  (marked in the KB itself as pending a Hindi source pass). The
  `ui-reading-lifeline-explainability-card.png` mockup's "Ancient Texts ( Brihat
  Samhita, Hastarekha Shastra )" row is **struck**: neither book is in the KB,
  and printing them under a heading that means "this is where your reading comes
  from" is exactly the fake-authority move A2 and §11 exist to prevent. If those
  texts are wanted, they get extracted into the KB first and then they may be
  cited.

  **"AI Interpretation" appears only when `narration.engine === "llm"`.** That
  field is on the wire and is honest when true — the narration really is a model
  writing over the fired rules. When the deterministic template produced the
  text, the row is absent; it is not relabelled, it is simply not shown.
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

**[R2] Measured baselines, 7 Sep 2026** — recovered from
`.next/diagnostics/route-bundle-stats.json`, because Next 16 with Turbopack
prints no size column at all. These are the numbers to hold:

| Route | First Load JS (gz) | raw | chunks |
|---|---:|---:|---:|
| `/scan` | **340.3 kB** | 1,251,271 B | 11 |
| `/read` | **190.2 kB** | 639,877 B | 9 |
| shared floor (every route) | **135.5 kB** | 467,041 B | 6 |

The shared floor is react-dom (70.0), the App Router client runtime (44.0) and
four smaller chunks. Every new route inherits it before rendering anything.

| Metric | Budget |
|---|---|
| Threshold route JS | **no new JS beyond the shared 135.5 kB floor**, no WebGL. (v1.0 said "≤ 60 KB gz", which is below the floor and therefore unreachable without changing the shared runtime.) |
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

**[R6] The type is `CapabilityTier`, always spelled in full.** `ReadingTier`
(`free | premium | deep`) already exists, is exported from the KB barrel and is
used throughout the reading route. The Pothi needs both at once — a `premium`
reading rendered at `LOW` capability — so **no component in the sanctuary takes
a bare prop named `tier`**, and no local alias shortens `CapabilityTier`.

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

Exists today, **with the qualifications the recon measured**:

- **Per-line polylines** — yes, for the four active lines, but only inside the
  scan client. They are not on the reading response, and `TracedLine.confidence`
  never leaves the browser tab that measured it.
- **Area verdicts with the INSUFFICIENT band** — yes, fully on the wire, and the
  band already behaves the way a Sealed Leaf needs: `direction` and `strength`
  go null exactly when the band is INSUFFICIENT, while the evidence list stays
  populated, so the page can say "we found these, and it is not enough to call
  it" instead of showing a confident-looking neutral.
- **Fired rules with source citations** — yes. Structured `{ text, loc, year }`
  on area evidence; flattened to one string on `rules[]`.
- **The three provenance groups** — **no.** See [R4]: the KB has three *books*,
  not three interpretive groups, and two of the mockup's three rows name books
  that are not in it.

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
