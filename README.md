# Strimko

A tap-first, installable **Strimko** puzzle — a Latin square with an extra
**stream** twist. Vanilla HTML/CSS/JS, no backend, offline-capable PWA.
Design direction: **Luminous Threads** (glowing beads on interwoven threads).

## What it is

Fill an n×n grid with the numbers **1…n** so that:

- every **row** contains each number exactly once,
- every **column** contains each number exactly once, and
- every **stream** — a connected chain of n beads on one thread — contains each
  number exactly once.

A number is illegal in a cell if it already appears in that cell's row, column,
**or** stream. Every puzzle has exactly one solution, reachable by pure logic —
never guessing.

## How to play

1. Pick a difficulty (the ladder is grid size + required logic technique):

   | Rung | Grid | Feel | Hardest technique needed |
   |------|------|------|--------------------------|
   | **Strand**   | 4×4 | gentle  | naked singles |
   | **Braid**    | 5×5 | classic | hidden singles / locked candidates |
   | **Weave**    | 6×6 | tricky  | naked / hidden subsets |
   | **Tapestry** | 7×7 | expert  | advanced intersections / chains |

2. Tap a bead, then tap a number to place it. Tap the same number again or
   **Erase** to clear. **Marks** toggles pencil candidates.
3. Duplicates in a row/column/stream flash pink — that's a nudge, not a loss
   (Strimko has no fail state). **Undo** steps back; **Hint** reveals the next
   logical deduction and names the technique.
4. Fill the grid correctly to trigger the win — time, streak and best are saved
   per difficulty, and you can share an emoji summary.

### Daily puzzle

The home screen features a **Daily Puzzle** — a 7×7 Tapestry board derived
deterministically from the calendar date, so **everyone gets the same board each
day**. It keeps its own **day-streak** (consecutive days solved) separate from
casual play, saves progress independently, and can be reviewed once solved. The
share summary is date-stamped (`Strimko Daily · YYYY-MM-DD · time`).

## Project structure

```
strimko/
├── index.html              # single-page shell (home / game / win screens)
├── css/style.css           # Luminous Threads styling
├── js/game.js              # DOM / UI controller only (no puzzle logic)
├── src/logic.js            # solver + gated generator (browser + Node, zero DOM)
├── manifest.webmanifest    # PWA manifest (icons, theme/splash)
├── sw.js                   # service worker (offline app shell)
├── icons/                  # app icons (bead-thread mark) + generator
├── test/
│   ├── verify.js           # adversarial correctness gate (run with node)
│   ├── dev-check.js        # quick generation sanity sweep
│   └── static-server.js    # tiny local static server for previewing
├── SPEC.md                 # build spec (rules, tiers, grading)
└── design-brief.md         # the signed-off 8-stage design
```

## How it works (the solver idea)

Logic lives entirely in `src/logic.js` and runs headless under Node — the UI
just renders it. Correctness is **proven by code, never eyeballed**:

- **Solver first.** A graded, *sound* deduction engine: it only ever places a
  value it can prove must go there (naked single → hidden single / locked
  candidate → subsets → advanced), and reports the hardest technique it needed.
  Every step can be validated against ground truth (`checkAgainstTruth`).
- **Generator gated by the solver.** It builds a random Latin square, carves it
  into n connected streams that the square also satisfies, strips givens, then
  **accepts a board only if** the solver fully solves it by pure logic, an
  independent backtracking counter proves the solution unique, and the hardest
  technique required *exactly* matches the target tier. Everything else is
  discarded.
- **Hints reuse the same solver.** The Hint button feeds your current (correct)
  cells back into `solve()` and surfaces its next deduction — so a hint is always
  a real, provable next move.

## Running the tests

```bash
cd games/strimko
node test/verify.js     # the correctness gate — exits 0 only if every check passes
node test/dev-check.js  # quick per-tier generation sweep
```

`verify.js` independently recomputes soundness (thousands of boards, every
decided cell checked against truth), well-formedness (Latin square + connected
stream partition), uniqueness (its own exhaustive counter), that the difficulty
gate is real (tier-(t−1) can't finish tier-t boards), and hand-crafted technique
units.

## Preview locally

```bash
node test/static-server.js   # serves the game at http://localhost:5600
```

Or open `index.html` with any static server.

## Deploy & install on iPhone

1. Deploy the `strimko/` folder to Netlify (drag-and-drop, or connect the repo).
2. On iPhone, open the site in **Safari** → **Share** → **Add to Home Screen**.
   It installs as a standalone app with its own icon and plays offline.
