# Strimko — build spec (step 1)

Strimko (invented by the Grabarchuk family; used in mind-fitness research): a
Latin-square logic puzzle with an extra **stream** constraint. Source of rules:
https://en.wikipedia.org/wiki/Strimko

## Rules

- An **n×n grid**. Fill every cell with a number **1…n**.
- **Latin square:** each **row** contains 1…n exactly once, and each **column**
  contains 1…n exactly once.
- **Streams:** the grid is partitioned into **n streams**, each a *connected
  chain of exactly n cells* (orthogonally connected, snaking anywhere). Each
  stream must also contain **1…n exactly once**.
- Some cells are **given** (pre-filled) as clues.
- A valid puzzle has **exactly one** solution, reachable by pure logic.

The three constraint families (row, column, stream) are what make it Strimko
rather than a Latin square: a number is eliminated from a cell if it already
appears in that cell's row, column, **or** stream.

## Grids & tiers

| Tier | Grid | Cells | Streams | Hardest technique required |
|------|------|-------|---------|----------------------------|
| 1    | 4×4  | 16    | 4       | singles only               |
| 2    | 5×5  | 25    | 5       | + hidden singles / locked candidates |
| 3    | 6×6  | 36    | 6       | + naked/hidden subsets (pairs/triples) |
| 4    | 7×7  | 49    | 7       | + advanced (intersections / chains) |

Grid size is a per-tier constant; **difficulty is graded by the solver
technique required, not by grid size or given-count alone** (a 6×6 that only
needs singles is still a Tier-1-*style* solve — the generator must hit the
target technique tier *exactly*).

## Difficulty = solver technique required

The solver implements **graded, sound deduction tiers**. Every deduction proves
a value must / cannot be placed — never a guess. Exact grading is solver-smith's
job; the intended ladder (candidate = a value not yet eliminated by row/col/
stream):

- **T1 — Naked single.** A cell with exactly one remaining candidate → place it.
  (Pure constraint propagation across row ∪ column ∪ stream.)
- **T2 — Hidden single.** Within a row, column, or stream, a value that can go
  in only one cell → place it there. Also **locked candidates**: if within a
  stream a value's only cells all share a row (or column), that value is
  eliminated from the rest of that row/column, and vice-versa (stream↔line
  intersection).
- **T3 — Naked / hidden subsets.** Two cells in a unit whose candidates are the
  same pair {a,b} → remove a,b from the rest of that unit (and triples); the
  hidden analogue for values confined to k cells.
- **T4 — Advanced.** Multi-unit intersection patterns / short forcing chains
  (X-wing-style over the three unit types) — still fully sound, no guessing.

Tier targets (generator hits the target tier **exactly**, per playbook):
Tier 1 → T1 only. Tier 2 → requires ≥1 T2 deduction, no T3+. Tier 3 → requires
≥1 T3, no T4. Tier 4 → requires ≥1 T4 deduction.

The solver supports **`checkAgainstTruth`**: every placement is validated
against the ground-truth solution the moment it is made; any contradiction is a
hard failure surfaced by the harness.

## Generator (gated)

Seeded PRNG (mulberry32 + avalanche-mixed hash per playbook). Generate a random
**Latin square** (row/col valid), then carve **n connected streams of n cells**
such that the Latin square also satisfies every stream (search / repair until a
valid stream partition exists for that square) → this is the ground-truth
solution. Choose givens (start from many, remove while the solver still solves
uniquely at the target tier). Run the solver; **accept only if** fully solvable
by pure deduction, solution unique (independent backtracking counter == 1), and
the hardest technique needed **exactly** matches the target tier. Rejected
boards are discarded, never shipped.

## Features

- Difficulty-select start screen (required); Continue when a save exists.
- Tap a cell to select; tap a number pad (1…n) to place; tap again / erase to
  clear. Optional pencil-mark (candidate) mode.
- Live conflict highlight (duplicate in row/col/stream) — toggleable.
- Undo, timer, auto-save to `localStorage`.
- Hint button powered by the solver (reveals the next logical deduction + why).
- Stats per difficulty (played, win rate, streak, best/avg time).
- Share summary (emoji grid), win celebration per chosen design.
- PWA: manifest, three iOS meta tags, service worker, icons.

## Tech

Vanilla HTML/CSS/JS, single-page, no backend. `js/logic.js` (solver +
generator; runs in the browser as a plain script AND under Node — mind the
shared-global-scope pitfall), `js/game.js` (DOM only, so the solver can power
hints). Tests in `test/verify.js` run with `node`. Mobile-first at ~390px, tap
targets ≥44px. Deploy: GitHub (RutaBas) + Netlify.

## Design (finalized at the design gate — NOT here)

Concept-anchor idea to explore: **Strimko feels like water braiding through a
garden of smooth stones** — the streams are literal currents. Candidate
difficulty-name ladders (derive from the anchor, Ruta picks one):

- **Trickle · Brook · Current · Rapids** (water flowing faster)
- **Ripple · Stream · Confluence · Torrent**
- **Pebble · Strand · Weave · Tapestry** (beads on interwoven threads)

Visual direction + ladder are Ruta's pick from `design-moodboard.html`, then
`design-screens.html` + `design-sound.html`. The chosen brief is recorded in
`design-brief.md` and is binding for all UI work.
