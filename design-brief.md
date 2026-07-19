# Strimko — Design Brief (design gate)

Operationalizes `game-design-elements`, worked in order. **Round 1 (directions)
is on disk in `design-moodboard.html`.** The final look, ladder, sound set, and
screens are recorded here once Ruta signs off — decision points below are marked
⏳ PENDING until then.

---

## Stage 1 — Concept anchor

Strimko's signature is the **stream**: chains of connected cells threading
through the grid. Everything visual should read as *something flowing / woven
along a path*, not a generic number grid. Three anchors are offered as
directions (pick one):

- **A · River Stones** — *"Strimko feels like water braiding through a garden of
  smooth stones."* Calm, natural, meditative.
- **B · Luminous Threads** — *"Strimko feels like glowing beads strung on
  interwoven threads."* Nocturnal, precise, premium (nods to the original
  Strimko bead-and-thread look).
- **C · Woven** — *"Strimko feels like colored yarn woven across a linen loom."*
  Warm, tactile, hand-made.

> ⏳ PENDING — Ruta picks A / B / C.

## Stage 2 — Color (2–4 roles, AA ≥ 4.5:1 text)

| Role | A · River Stones | B · Luminous Threads | C · Woven |
|------|------------------|----------------------|-----------|
| Background (neutral) | Stone `#F4F1EA` | Ink navy `#12172A` | Linen `#EDE4D3` |
| Dominant / text | Deep slate `#2F4A4C` | Off-white `#EAF2F5` | Indigo `#3B4C7A` |
| Accent (tap) | River glint `#C8974B` | Aqua glow `#3FE0C5` | Madder red `#B5533B` |
| Secondary (error/hint) | Terracotta `#C56A4E` | Pulse pink `#F06AA6` | Ochre `#D69A3C` |

None use pure white/black. Stream threads are drawn in tinted variants of the
palette so streams stay distinguishable at a glance (also color-blind safe
because streams are *also* physically connected chains, not color-only).
Slate-on-stone, off-white-on-navy, and indigo-on-linen all clear AA.

## Stage 3 — Typography (one heading + one body, Google Fonts)

- **A:** Fraunces (organic humanist serif) 800 headings · Nunito 400/800 body.
- **B:** Space Grotesk 700 headings · Inter body · **JetBrains Mono** numerals
  (mono numerals = the "precision" of the anchor).
- **C:** DM Serif Display headings · Karla 400/800 body.

Never the system-sans default. Board numerals get the heaviest treatment since
they are the content the eye lands on.

## Stage 4 — Spacing & depth

Fixed scale **4 / 8 / 16 / 24 / 32**. Tap targets ≥ **44px** (board cells render
at ~48–60px pitch depending on grid size; the 7×7 stays ≥44px on a 390px
screen). **One material per direction**, applied consistently with a pressed
state:

- A: soft-shadow **pebbles** (rounded, subtle drop shadow on sand).
- B: dark **glass beads** with a soft neon glow ring on select.
- C: flat **woven swatches** (rounded squares, stitched border) on linen.

## Stage 5 — Motion language

- A: **smooth / slow** — ease-out settle, a ripple on select. (calm)
- B: **snappy** — quick pulse on tap, threads light up as a unit completes.
- C: **bouncy** — tactile spring-in on place.

Touchpoints covered in all: tap/select, number place (cell reveal), screen
transition, win. Reduced-motion honored (`prefers-reduced-motion`).

## Stage 6 — Feedback & juice (proportional)

| Moment | Feedback |
|--------|----------|
| Correct place | tiny tick sound + soft accent flash + light haptic (10ms) |
| Unit complete (row/col/stream fully & correctly filled) | that unit's threads/cells glow briefly |
| Mistake (duplicate in row/col/stream) | secondary-color flash on the conflicting cells + short low buzz + short haptic |
| **Win** (reserved full celebration) | particles/threads animation + streams light up in sequence + win sound + celebratory haptic pattern |

Small ticks stay small; the full celebration is **only** for the win so it feels
earned.

## Stage 7 — Screens & layout

- **Start screen** — title, one primary action (Play / Continue), difficulty
  select (the chosen ladder), all above the fold at ~390px, on a **unique
  anchor-derived background** (NOT a flat fill):
  - A: a faint raked-sand / flowing-water contour background.
  - B: a dark constellation of dim beads-on-threads drifting behind the UI.
  - C: a subtle woven-linen weave texture with a few loose threads.
- **In-game HUD** — board dominant; only timer, difficulty label, undo, hint,
  and a 1–n number pad. Chrome recedes.
- **Win screen** — the payoff: final time, streak, per-difficulty best, share
  (emoji-grid summary), replay / next. Most polish.
- **Lose / fail screen** — ⚠️ Strimko has **no lose state** (no timer-death, no
  mistakes-limit by default). So per the playbook, **no lose screen is built.**
  (Mistakes are surfaced inline as gentle conflict highlights, not failure.)

> ⏳ PENDING — round 2 renders home + win on the chosen direction in
> `design-screens.html`; no lose screen.

## Stage 8 — App-store-level extras

- Real app icon (a woven/stream mark in the chosen palette) + `theme_color` /
  `background_color` in the manifest matched to the direction.
- Safe-area insets (notch / home bar) via `env(safe-area-inset-*)`.
- Block accidental pull-to-refresh and text-selection on the board.
- Offline play via service worker (app-shell cache).
- First-launch "how to play" (row + column + **stream** each hold 1–n once) that
  does not block returning players.

---

## Difficulty ladder (pick one)

1. **Trickle · Brook · Current · Rapids** — water flowing faster.
2. **Ripple · Stream · Confluence · Torrent** — water gathering.
3. **Strand · Braid · Weave · Tapestry** — threads interwoven.

Maps to the solver-graded tiers: 4×4 singles → 5×5 hidden-single/locked →
6×6 subsets → 7×7 advanced.

> ⏳ PENDING — Ruta picks 1 / 2 / 3.

## Sound

**Set A · Glass Chime** ✅ — crystalline airy sine bells (Web Audio, no asset
files). Place = 880/1320Hz sine ping; wrong/undo = 300→180Hz soft sine drop;
win = a rising C-major arpeggio (523·659·784·1046·1319) with octave shimmer.
Ships alongside haptics. Full synth params in `design-sound.html`.

---

### Decisions locked after sign-off
- Direction: **B · Luminous Threads** ✅ (Ink navy `#12172A`, aqua glow `#3FE0C5`,
  thread colors `#6C8CFF`/`#F06AA6`/`#FFB24A`/`#9B7BFF`; Space Grotesk + Inter +
  JetBrains Mono numerals; dark glass beads with neon glow; snappy motion.)
- Ladder: **Strand · Braid · Weave · Tapestry** ✅ (4×4 · 5×5 · 6×6 · 7×7)
- Sound set: **Glass Chime** ✅
- Home background confirmed: **constellation of dim beads-on-threads** ✅
- Win screen confirmed: **glowing finished board + aqua sparks + stats/share** ✅
  · Lose screen: **N/A (no lose state)**
