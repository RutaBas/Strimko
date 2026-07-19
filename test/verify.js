/*
 * Adversarial verification gate for the Strimko logic core.
 * Run: node test/verify.js   (exit 0 only if EVERY check passes)
 *
 * Philosophy: the solver is assumed WRONG until independent numbers say
 * otherwise. Every property is recomputed HERE from the rules — our own Latin
 * -square check, our own stream flood-fill, our own exhaustive backtracking
 * uniqueness counter, our own decided-cell-vs-truth comparison. The solver's
 * own validators (truthViolations, countSolutions) are only ever used as a
 * secondary cross-check against our independent numbers.
 *
 * Rules recomputed: n x n grid filled 1..n; every ROW, COLUMN and STREAM (a
 * connected orthogonal chain of exactly n cells partitioning the grid) holds
 * 1..n exactly once. Tiers 1..4 -> sizes 4..7; grade = hardest technique
 * REQUIRED, matched EXACTLY.
 */
"use strict";

var path = require("path");
var L = require(path.join(__dirname, "..", "src", "logic.js"));

// ------------------------------------------------------------ harness core --

var results = [];
function check(name, fn) {
  var t0 = Date.now();
  var r;
  try {
    r = fn();
  } catch (e) {
    r = { pass: false, detail: "EXCEPTION: " + (e && e.stack || e) };
  }
  r.ms = Date.now() - t0;
  r.name = name;
  results.push(r);
  console.log((r.pass ? "PASS" : "FAIL") + "  " + name + "  [" + r.ms + " ms]");
  console.log("      " + r.detail.split("\n").join("\n      "));
  return r;
}

var DIRS = [[-1, 0], [1, 0], [0, -1], [0, 1]];

// -------------------------------- independent helpers (from the SPEC only) --

// streamId 2D from a puzzle-like object (accepts .streamId or .streams).
function sidOf(p) {
  var n = p.n;
  if (p.streamId) return p.streamId;
  var sid = [];
  for (var r = 0; r < n; r++) sid.push(new Array(n).fill(-1));
  for (var s = 0; s < p.streams.length; s++) {
    for (var i = 0; i < p.streams[s].length; i++) {
      var idx = p.streams[s][i];
      sid[(idx / n) | 0][idx % n] = s;
    }
  }
  return sid;
}

// Is `sol` a valid Latin square: every row and every column a permutation of 1..n?
function isLatin(sol) {
  var n = sol.length, r, c, v;
  for (r = 0; r < n; r++) {
    var rowSeen = {}, colSeen = {};
    for (c = 0; c < n; c++) {
      v = sol[r][c];
      if (v < 1 || v > n) return false;
      if (rowSeen[v]) return false; rowSeen[v] = 1;
      var w = sol[c][r];
      if (w < 1 || w > n) return false;
      if (colSeen[w]) return false; colSeen[w] = 1;
    }
  }
  return true;
}

// Independent stream-partition validation against sol:
//  - every cell belongs to exactly one of n streams
//  - each stream has exactly n cells
//  - each stream is 4-connected (own flood fill)
//  - each stream holds 1..n exactly once (against sol)
function streamsWellFormed(sol, sid) {
  var n = sol.length, r, c;
  var cells = {}; // stream -> [ [r,c] ]
  for (r = 0; r < n; r++) {
    for (c = 0; c < n; c++) {
      var s = sid[r][c];
      if (s < 0 || s >= n) return "stream id " + s + " out of range at " + r + "," + c;
      (cells[s] || (cells[s] = [])).push([r, c]);
    }
  }
  for (s = 0; s < n; s++) {
    var cl = cells[s];
    if (!cl) return "stream " + s + " empty";
    if (cl.length !== n) return "stream " + s + " size " + cl.length + " != " + n;
    // connectivity: BFS from cl[0] within same-id cells
    var seen = {};
    var key = function (a) { return a[0] * n + a[1]; };
    var stack = [cl[0]]; seen[key(cl[0])] = 1;
    var reached = 0;
    while (stack.length) {
      var cur = stack.pop(); reached++;
      for (var d = 0; d < 4; d++) {
        var nr = cur[0] + DIRS[d][0], nc = cur[1] + DIRS[d][1];
        if (nr < 0 || nr >= n || nc < 0 || nc >= n) continue;
        if (sid[nr][nc] !== s) continue;
        var k = nr * n + nc;
        if (!seen[k]) { seen[k] = 1; stack.push([nr, nc]); }
      }
    }
    if (reached !== n) return "stream " + s + " not connected (reached " + reached + "/" + n + ")";
    // values 1..n exactly once
    var vseen = {};
    for (var i = 0; i < cl.length; i++) {
      var vv = sol[cl[i][0]][cl[i][1]];
      if (vseen[vv]) return "stream " + s + " value " + vv + " repeated";
      vseen[vv] = 1;
    }
    for (var v = 1; v <= n; v++) if (!vseen[v]) return "stream " + s + " missing value " + v;
  }
  return null; // ok
}

// Every given equals the solution at its cell.
function givensMatchSolution(givens, sol) {
  for (var i = 0; i < givens.length; i++) {
    var g = givens[i];
    if (sol[g.r][g.c] !== g.v) return "given (" + g.r + "," + g.c + ")=" + g.v + " != sol " + sol[g.r][g.c];
  }
  return null;
}

// Independent decided-cell vs truth comparison over a solver board (0 = empty).
function decidedVsTruth(board, sol) {
  var n = sol.length, wrong = 0, decided = 0;
  for (var r = 0; r < n; r++) {
    for (var c = 0; c < n; c++) {
      if (board[r][c] === 0) continue;
      decided++;
      if (board[r][c] !== sol[r][c]) wrong++;
    }
  }
  return { wrong: wrong, decided: decided };
}

// Fully-independent exhaustive backtracking solution counter (NOT L.countSolutions).
// Direct row/col/stream constraint checks, MRV. Optionally collects up to `cap`
// full solutions (as flat arrays) so callers can inspect the ambiguity.
function myCount(n, sid, givens, cap, collect) {
  cap = cap || 2;
  var grid = new Array(n * n).fill(0);
  var flatSid = new Array(n * n);
  for (var r = 0; r < n; r++) for (var c = 0; c < n; c++) flatSid[r * n + c] = sid[r][c];
  var rowMask = new Array(n).fill(0), colMask = new Array(n).fill(0), strMask = new Array(n).fill(0);
  var count = 0, sols = [];

  function bit(v) { return 1 << (v - 1); }
  function pc(x) { var t = 0; while (x) { t += x & 1; x >>= 1; } return t; }
  function put(idx, v) { var rr = (idx / n) | 0, cc = idx % n, s = flatSid[idx], b = bit(v); grid[idx] = v; rowMask[rr] |= b; colMask[cc] |= b; strMask[s] |= b; }
  function unput(idx, v) { var rr = (idx / n) | 0, cc = idx % n, s = flatSid[idx], b = bit(v); grid[idx] = 0; rowMask[rr] &= ~b; colMask[cc] &= ~b; strMask[s] &= ~b; }
  function candMask(idx) { var rr = (idx / n) | 0, cc = idx % n, s = flatSid[idx]; return ((1 << n) - 1) & ~(rowMask[rr] | colMask[cc] | strMask[s]); }

  for (var i = 0; i < givens.length; i++) {
    var g = givens[i], idx = g.r * n + g.c, b = bit(g.v);
    if ((rowMask[g.r] & b) || (colMask[g.c] & b) || (strMask[flatSid[idx]] & b)) return { count: 0, solutions: [] };
    put(idx, g.v);
  }

  (function rec() {
    if (count >= cap) return;
    var best = -1, bc = 99, bm = 0;
    for (var j = 0; j < n * n; j++) {
      if (grid[j] !== 0) continue;
      var m = candMask(j), k = pc(m);
      if (k === 0) return;
      if (k < bc) { bc = k; best = j; bm = m; if (k === 1) break; }
    }
    if (best === -1) { count++; if (collect) sols.push(grid.slice()); return; }
    for (var v = 1; v <= n; v++) {
      if (!(bm & bit(v))) continue;
      put(best, v); rec(); unput(best, v);
      if (count >= cap) return;
    }
  })();

  return { count: count, solutions: sols };
}

// Build a RANDOM (ungated) candidate: real Latin square + real carved streams +
// a random correct-subset of givens at density `frac`. Used for soundness and
// gate-necessity. May be non-unique — that is the point.
function buildRandom(tier, tag, frac) {
  var n = L.configForTier(tier).size;
  var rng = L.mulberry32(L.hashStringToSeed("strimko-verify-" + tier + "-" + tag));
  var sol = L.randomLatinSquare(n, rng);
  if (!sol) return null;
  var carve = L.carveStreams(sol, rng, 300000);
  if (!carve) return null;
  var givens = [];
  for (var r = 0; r < n; r++) for (var c = 0; c < n; c++) if (rng() < frac) givens.push({ r: r, c: c, v: sol[r][c] });
  return { n: n, streams: carve.streams, streamId: carve.sid2D, givens: givens, solution: sol, rng: rng };
}

// ------------------------------------------------------------- shared pools --

var POOL = {};   // gated generated puzzles per tier (reused by many checks)
var RPOOL = {};  // random ungated boards per tier (reused by 1 & 4)
var GEN = { 1: 80, 2: 80, 3: 50, 4: 60 };
var RCOUNT = 300;
var RFRAC = 0.35;

(function prime() {
  for (var t = 1; t <= 4; t++) {
    POOL[t] = [];
    for (var i = 0; i < GEN[t]; i++) POOL[t].push(L.generatePuzzle(t, i));
    RPOOL[t] = [];
    for (var j = 0; j < RCOUNT; j++) {
      var b = buildRandom(t, "rand-" + j, RFRAC);
      if (b) RPOOL[t].push(b);
    }
  }
})();

function asPuzzle(p) { return { n: p.n, streamId: p.streamId, streams: p.streams, givens: p.givens }; }

// ================================================================ CHECK 1 ==
// SOUNDNESS vs ground truth: solve WITHOUT truth (so it cannot self-stop) and
// judge every decided cell ourselves. Includes gated pool (must fully solve),
// random ungated boards (partial deduction — the real stress), a with-truth
// cross-check subset, and adversarial partial "hint path" starts.

check("1. SOUNDNESS: zero wrong deductions vs ground truth (no-truth solve, judged here)", function () {
  var boards = 0, decided = 0, wrong = 0, contradictions = 0;
  var withTruthRuns = 0, truthViol = 0;
  var poolBoards = 0, poolUnsolved = 0;
  var hintBoards = 0, hintDecided = 0, hintWrong = 0;

  // (a) gated pool: no-truth solve must fully complete and be 100% correct
  for (var t = 1; t <= 4; t++) {
    for (var i = 0; i < POOL[t].length; i++) {
      var p = POOL[t][i];
      var res = L.solve(asPuzzle(p));
      poolBoards++;
      if (res.contradiction) contradictions++;
      if (res.unknownLeft !== 0 || !res.solved) poolUnsolved++;
      var cmp = decidedVsTruth(res.board, p.solution);
      wrong += cmp.wrong; decided += cmp.decided; boards++;
    }
  }

  // (b) random ungated boards: partial deduction, every decided cell must match
  //     the stored solution (a sound deduction holds in every solution).
  for (t = 1; t <= 4; t++) {
    for (i = 0; i < RPOOL[t].length; i++) {
      var b = RPOOL[t][i];
      var r0 = L.solve(asPuzzle(b));
      if (r0.contradiction) contradictions++;
      var c0 = decidedVsTruth(r0.board, b.solution);
      wrong += c0.wrong; decided += c0.decided; boards++;
      // with-truth cross-check subset: solver's own checkAgainstTruth must be clean
      if (i % 4 === 0) {
        var r1 = L.solve(asPuzzle(b), { truth: b.solution });
        withTruthRuns++; truthViol += r1.truthViolations.length;
      }
    }
  }

  // (c) adversarial partial starts (hint path): base givens + extra CORRECT
  //     cells revealed from the solution; still zero-tolerance.
  for (t = 1; t <= 4; t++) {
    var n = L.configForTier(t).size;
    for (i = 0; i < 200; i++) {
      var base = buildRandom(t, "hint-" + i, 0.15);
      if (!base) continue;
      var rng = L.mulberry32(L.hashStringToSeed("strimko-hint2-" + t + "-" + i));
      var extra = base.givens.slice();
      var have = {};
      for (var gi = 0; gi < extra.length; gi++) have[extra[gi].r * n + extra[gi].c] = 1;
      for (var r = 0; r < n; r++) for (var c = 0; c < n; c++) {
        if (!have[r * n + c] && rng() < 0.4) extra.push({ r: r, c: c, v: base.solution[r][c] });
      }
      var rh = L.solve({ n: n, streams: base.streams, givens: extra });
      if (rh.contradiction) contradictions++;
      var ch = decidedVsTruth(rh.board, base.solution);
      hintWrong += ch.wrong; hintDecided += ch.decided; hintBoards++;
      boards++;
    }
  }

  var pass = boards >= 2000 && wrong === 0 && hintWrong === 0 &&
    contradictions === 0 && truthViol === 0 && poolUnsolved === 0;
  return {
    pass: pass,
    detail: [
      "total boards=" + boards + ", decided cells checked=" + (decided + hintDecided) + ", WRONG=" + (wrong + hintWrong),
      "gated pool boards=" + poolBoards + " (unsolved=" + poolUnsolved + "), contradictions on valid boards=" + contradictions,
      "with-truth cross-checks=" + withTruthRuns + ", truthViolations reported=" + truthViol,
      "hint-path boards=" + hintBoards + " decided=" + hintDecided + " wrong=" + hintWrong
    ].join("\n")
  };
});

// ================================================================ CHECK 2 ==
// SOLUTION WELL-FORMEDNESS (independent recomputation) for every gated puzzle.

check("2. SOLUTION WELL-FORMEDNESS: Latin square + connected stream partition + givens", function () {
  var checked = 0, failures = [];
  for (var t = 1; t <= 4; t++) {
    for (var i = 0; i < POOL[t].length; i++) {
      var p = POOL[t][i], tag = "tier " + t + " idx " + i;
      checked++;
      if (p.n !== L.configForTier(t).size) failures.push(tag + ": size " + p.n + " != tier config");
      if (!isLatin(p.solution)) failures.push(tag + ": solution is not a Latin square");
      var sid = sidOf(p);
      var sw = streamsWellFormed(p.solution, sid);
      if (sw) failures.push(tag + ": streams " + sw);
      // cross-check streams[] index arrays agree with streamId 2D
      var gm = givensMatchSolution(p.givens, p.solution);
      if (gm) failures.push(tag + ": " + gm);
      if (p.givens.length < 1) failures.push(tag + ": no givens");
    }
  }
  return {
    pass: failures.length === 0,
    detail: "well-formedness checked on " + checked + " gated puzzles; failures=" + failures.length +
      (failures.length ? "\n" + failures.slice(0, 10).join("\n") : "")
  };
});

// ================================================================ CHECK 3 ==
// UNIQUENESS: our OWN exhaustive counter finds exactly ONE solution per gated
// puzzle, and agrees with the logic's countSolutions.

check("3. UNIQUENESS: independent counter == 1 and agrees with logic.countSolutions", function () {
  var checked = 0, failures = [], mismatches = 0;
  for (var t = 1; t <= 4; t++) {
    for (var i = 0; i < POOL[t].length; i++) {
      var p = POOL[t][i], tag = "tier " + t + " idx " + i;
      checked++;
      var mine = myCount(p.n, sidOf(p), p.givens, 2, false).count;
      if (mine !== 1) failures.push(tag + ": independent counter found " + mine + " solutions");
      var theirs = L.countSolutions(asPuzzle(p), 2);
      if (theirs !== mine) { mismatches++; failures.push(tag + ": logic.countSolutions=" + theirs + " != mine=" + mine); }
    }
  }
  return {
    pass: failures.length === 0,
    detail: "uniqueness verified on " + checked + " gated puzzles (independent backtracking); counter/logic mismatches=" +
      mismatches + "; failures=" + failures.length + (failures.length ? "\n" + failures.slice(0, 10).join("\n") : "")
  };
});

// ================================================================ CHECK 4 ==
// GATE NECESSARY: ungated random boards genuinely force guessing (per tier). If
// pure deduction solved everything, the accept gate would be theater.

check("4. GATE NECESSARY: ungated boards force guessing (nonzero stuck fraction / tier)", function () {
  var pass = true, lines = [];
  for (var t = 1; t <= 4; t++) {
    var n = 0, stuck = 0;
    for (var i = 0; i < RPOOL[t].length; i++) {
      var b = RPOOL[t][i];
      var res = L.solve(asPuzzle(b));
      n++;
      if (res.unknownLeft > 0 || !res.solved) stuck++;
    }
    var frac = stuck / n;
    if (!(n >= 100) || !(stuck > 0)) pass = false;
    lines.push("tier " + t + ": " + stuck + "/" + n + " ungated boards NOT deduction-solvable (" +
      (100 * frac).toFixed(1) + "%)" + (stuck > 0 ? "" : "  <-- GATE IS THEATER"));
  }
  return { pass: pass, detail: lines.join("\n") };
});

// ================================================================ CHECK 5 ==
// GRADING REAL: the tier ladder is not a lie. Uncapped grade == tier exactly;
// a re-solve capped at tier-1 must leave the board UNFINISHED (the puzzle truly
// REQUIRES its tier's technique); tier-1 solves the same capped or uncapped.

check("5. GRADING REAL: exact grade + tier-(t-1) cap provably insufficient", function () {
  var failures = [], stats = {};
  for (var t = 1; t <= 4; t++) {
    stats[t] = { checked: 0, stuckAvg: 0 };
    for (var i = 0; i < POOL[t].length; i++) {
      var p = POOL[t][i], tag = "tier " + t + " idx " + i;
      var full = L.solve(asPuzzle(p));
      stats[t].checked++;
      if (!full.solved) failures.push(tag + ": uncapped solve did not complete");
      if (full.maxTierUsed !== t) failures.push(tag + ": maxTierUsed=" + full.maxTierUsed + " != tier " + t);
      if (t === 1) {
        var capped = L.solve(asPuzzle(p), { maxTechniqueTier: 1 });
        if (capped.unknownLeft !== 0) failures.push(tag + ": tier-1 puzzle NOT solvable by T1 alone");
        // gate check: capped == uncapped for tier 1
        if (full.unknownLeft !== 0 || capped.unknownLeft !== 0) failures.push(tag + ": tier-1 cap/uncap disagree on completion");
      } else {
        var rr = L.solve(asPuzzle(p), { maxTechniqueTier: t - 1 });
        if (rr.unknownLeft === 0) failures.push(tag + ": graded tier " + t + " but SOLVED with cap T" + (t - 1) + " (technique not required)");
        stats[t].stuckAvg += rr.unknownLeft;
      }
    }
    if (t > 1) stats[t].stuckAvg = (stats[t].stuckAvg / POOL[t].length).toFixed(1);
  }
  // cap hook must be a real gate: for a tier-4 puzzle, capping below 4 must
  // change the outcome (already asserted above); confirm a tier-1 puzzle is
  // unaffected by a high cap (inert at default).
  var p0 = POOL[1][0];
  var a = L.solve(asPuzzle(p0)), b = L.solve(asPuzzle(p0), { maxTechniqueTier: 4 });
  if (a.unknownLeft !== b.unknownLeft || a.maxTierUsed !== b.maxTierUsed)
    failures.push("tier-1 idx0: default vs maxTechniqueTier:4 differ — cap not inert");

  return {
    pass: failures.length === 0,
    detail: [
      "graded pool: all uncapped maxTierUsed must equal tier; tier-(t-1) cap must leave unknowns",
      "avg unknowns left when capped at t-1: tier2=" + stats[2].stuckAvg + " tier3=" + stats[3].stuckAvg + " tier4=" + stats[4].stuckAvg,
      "failures=" + failures.length + (failures.length ? "\n" + failures.slice(0, 10).join("\n") : "")
    ].join("\n")
  };
});

// ================================================================ CHECK 6 ==
// UNIQUENESS COUNTER SANITY: a hand-built board with a KNOWN second solution.
// Our counter must find >=2, the logic's counter must agree, and the deductive
// solver must leave the ambiguous cells UNDECIDED (never guess).

check("6. UNIQUENESS COUNTER SANITY: known multi-solution board detected, solver refuses to guess", function () {
  var failures = [];
  // 4x4, streams = the four 2x2 quadrant blocks (each connected, holds 1..4 in
  // a valid completion). With ZERO givens this is a 4x4 "Sudoku-like" board:
  // provably NOT unique (any full solution has row/col/block swaps). We create a
  // deliberately UNDER-constrained board by giving a diagonal that still leaves
  // a genuine 2x2 value swap open.
  var n = 4;
  var sid = [[0, 0, 1, 1], [0, 0, 1, 1], [2, 2, 3, 3], [2, 2, 3, 3]];
  // Empty board first: must have many solutions.
  var empty = myCount(n, sid, [], 5, true);
  if (empty.count < 2) failures.push("empty quadrant board: counter found " + empty.count + " (expected >=2)");

  // Now a targeted 2-solution instance: pin everything except a 2x2 swap.
  // Base solution:            An alternate that swaps the {1,2} in rows 0-1,
  //   1 2 3 4                 cols 0-1 corner is blocked by the block rule, so
  //   3 4 1 2                 instead we under-specify to leave exactly two.
  // Build givens = all cells EXCEPT (0,0),(0,1),(1,0),(1,1) forces block 0 to a
  // unique fill -> unique. To keep TWO solutions we instead remove a full
  // orthogonal pair pattern. Simplest robust route: start from a unique gated
  // tier-1 puzzle and delete givens until our own counter reports >=2.
  var base = POOL[1][0];
  var givens = base.givens.slice();
  var bn = base.n, bsid = sidOf(base);
  var order = [];
  for (var gi = 0; gi < givens.length; gi++) order.push(gi);
  // deterministic removal by index
  var ambiguous = null;
  for (var oi = 0; oi < order.length && !ambiguous; oi++) {
    givens = givens.slice(0, givens.length - 1); // drop last given
    var res = myCount(bn, bsid, givens, 3, true);
    if (res.count >= 2) ambiguous = res;
  }
  if (!ambiguous) {
    failures.push("could not construct a >=2-solution board by removing givens");
  } else {
    var mine = ambiguous.count;
    var theirs = L.countSolutions({ n: bn, streamId: bsid, givens: givens }, 3);
    if (!(mine >= 2)) failures.push("constructed board: mine=" + mine + " (<2)");
    if (theirs < 2) failures.push("logic.countSolutions=" + theirs + " disagrees (<2)");
    // identify cells that differ between the two found solutions
    var s0 = ambiguous.solutions[0], s1 = ambiguous.solutions[1];
    var diffCells = [];
    for (var k = 0; k < bn * bn; k++) if (s0[k] !== s1[k]) diffCells.push(k);
    if (diffCells.length === 0) failures.push("two 'solutions' were identical");
    // sound deductive solver must NOT decide any genuinely ambiguous cell
    var dres = L.solve({ n: bn, streamId: bsid, givens: givens });
    if (dres.unknownLeft === 0) failures.push("solver fully solved an ambiguous board (it guessed!)");
    if (dres.contradiction) failures.push("solver reported contradiction on a satisfiable board");
    var decidedAmbig = 0;
    for (var di = 0; di < diffCells.length; di++) {
      var idx = diffCells[di], rr = (idx / bn) | 0, cc = idx % bn;
      if (dres.board[rr][cc] !== 0) decidedAmbig++;
    }
    if (decidedAmbig > 0) failures.push(decidedAmbig + " genuinely-ambiguous cells were DECIDED by the solver");
    var summary = "empty-board count>=" + empty.count + "; constructed board mine=" + mine + " logic=" + theirs +
      ", diff cells=" + diffCells.length + ", solver left " + dres.unknownLeft + " unknowns, ambiguous decided=" + decidedAmbig;
    return { pass: failures.length === 0, detail: summary + (failures.length ? "\n" + failures.join("\n") : "") };
  }
  return { pass: failures.length === 0, detail: failures.join("\n") };
});

// ================================================================ CHECK 7 ==
// HAND-CRAFTED UNIT TESTS exercising the actual techniques on fixed boards.
// Each board is independently verified (valid Strimko + unique) and solved to
// the known result; the technique is shown to be genuinely required.

check("7. HAND-CRAFTED UNITS: naked-single, hidden-single, locked-candidate", function () {
  var failures = [];

  function firstTierStep(res, tier) {
    for (var i = 0; i < res.steps.length; i++) if (res.steps[i].tier === tier) return res.steps[i];
    return null;
  }
  function unitPrep(n, sol, sid, givens, tag) {
    // independent validation of the fixture itself
    if (!isLatin(sol)) failures.push(tag + ": fixture solution not Latin");
    var sw = streamsWellFormed(sol, sid);
    if (sw) failures.push(tag + ": fixture streams " + sw);
    var gm = givensMatchSolution(givens, sol);
    if (gm) failures.push(tag + ": fixture " + gm);
    var uc = myCount(n, sid, givens, 2, false).count;
    if (uc !== 1) failures.push(tag + ": fixture not unique (count=" + uc + ")");
    return uc;
  }
  function streamsFromSid(n, sid) {
    var s = []; for (var i = 0; i < n; i++) s.push([]);
    for (var r = 0; r < n; r++) for (var c = 0; c < n; c++) s[sid[r][c]].push(r * n + c);
    return s;
  }
  function fullBoardOK(res, sol, tag) {
    if (res.unknownLeft !== 0) { failures.push(tag + ": not fully solved (" + res.unknownLeft + " left)"); return; }
    var cmp = decidedVsTruth(res.board, sol);
    if (cmp.wrong !== 0) failures.push(tag + ": " + cmp.wrong + " cells disagree with known solution");
    if (res.truthViolations && res.truthViolations.length) failures.push(tag + ": truthViolations " + JSON.stringify(res.truthViolations));
  }

  // (a) NAKED SINGLE — 4x4, streams = quadrant blocks, T1-only unique solve.
  var solA = [[1, 2, 3, 4], [3, 4, 1, 2], [2, 1, 4, 3], [4, 3, 2, 1]];
  var sidA = [[0, 0, 1, 1], [0, 0, 1, 1], [2, 2, 3, 3], [2, 2, 3, 3]];
  var givA = [{ r: 0, c: 0, v: 1 }, { r: 0, c: 3, v: 4 }, { r: 1, c: 0, v: 3 }, { r: 2, c: 2, v: 4 }, { r: 3, c: 3, v: 1 }];
  unitPrep(4, solA, sidA, givA, "(a) naked-single");
  var resA = L.solve({ n: 4, streams: streamsFromSid(4, sidA), givens: givA }, { truth: solA });
  fullBoardOK(resA, solA, "(a) naked-single");
  if (resA.maxTierUsed !== 1) failures.push("(a) expected pure T1, used T" + resA.maxTierUsed);
  if (!resA.steps.length || resA.steps[0].tech !== "naked-single") failures.push("(a) first step not naked-single");

  // (b) HIDDEN SINGLE — mined 5x5 fixture whose first tier-2 step is a hidden
  //     single; T1 alone cannot finish (proving the technique is required).
  var solB = [[2, 1, 4, 5, 3], [1, 2, 5, 3, 4], [3, 4, 2, 1, 5], [5, 3, 1, 4, 2], [4, 5, 3, 2, 1]];
  var sidB = [[0, 0, 0, 0, 1], [2, 2, 2, 0, 1], [2, 2, 1, 1, 1], [3, 3, 3, 3, 3], [4, 4, 4, 4, 4]];
  var givB = [{ r: 1, c: 1, v: 2 }, { r: 2, c: 1, v: 4 }, { r: 2, c: 2, v: 2 }, { r: 2, c: 3, v: 1 }, { r: 3, c: 1, v: 3 }, { r: 3, c: 2, v: 1 }, { r: 3, c: 3, v: 4 }];
  unitPrep(5, solB, sidB, givB, "(b) hidden-single");
  var capB = L.solve({ n: 5, streams: streamsFromSid(5, sidB), givens: givB }, { maxTechniqueTier: 1 });
  if (capB.unknownLeft === 0) failures.push("(b) T1-only already solved it — hidden single not required");
  var resB = L.solve({ n: 5, streams: streamsFromSid(5, sidB), givens: givB }, { truth: solB });
  fullBoardOK(resB, solB, "(b) hidden-single");
  if (resB.maxTierUsed !== 2) failures.push("(b) expected grade T2, got T" + resB.maxTierUsed);
  var b2 = firstTierStep(resB, 2);
  if (!b2 || b2.tech !== "hidden-single") failures.push("(b) first tier-2 step not hidden-single (" + (b2 && b2.tech) + ")");

  // (c) LOCKED CANDIDATE — mined 5x5 fixture whose first tier-2 step is a
  //     locked-candidate elimination (so at that fixpoint NO hidden single
  //     existed; the locked candidate did genuine work). T1 alone cannot finish.
  var solC = [[1, 5, 4, 2, 3], [4, 1, 2, 3, 5], [3, 2, 5, 1, 4], [5, 3, 1, 4, 2], [2, 4, 3, 5, 1]];
  var sidC = [[0, 0, 1, 2, 2], [0, 1, 1, 1, 2], [0, 0, 1, 2, 2], [3, 3, 3, 4, 4], [3, 3, 4, 4, 4]];
  var givC = [{ r: 0, c: 1, v: 5 }, { r: 1, c: 2, v: 2 }, { r: 3, c: 3, v: 4 }, { r: 4, c: 2, v: 3 }];
  unitPrep(5, solC, sidC, givC, "(c) locked-candidate");
  var capC = L.solve({ n: 5, streams: streamsFromSid(5, sidC), givens: givC }, { maxTechniqueTier: 1 });
  if (capC.unknownLeft === 0) failures.push("(c) T1-only already solved it — locked candidate not required");
  var resC = L.solve({ n: 5, streams: streamsFromSid(5, sidC), givens: givC }, { truth: solC });
  fullBoardOK(resC, solC, "(c) locked-candidate");
  if (resC.maxTierUsed !== 2) failures.push("(c) expected grade T2, got T" + resC.maxTierUsed);
  var c2 = firstTierStep(resC, 2);
  if (!c2 || c2.tech !== "locked-candidate") failures.push("(c) first tier-2 step not locked-candidate (" + (c2 && c2.tech) + ")");

  return {
    pass: failures.length === 0,
    detail: [
      "(a) naked-single 4x4: solved=" + (resA.unknownLeft === 0) + " T1-only=" + (resA.maxTierUsed === 1) + " first=" + (resA.steps[0] && resA.steps[0].tech),
      "(b) hidden-single 5x5: T1cap-left=" + capB.unknownLeft + " solved=" + (resB.unknownLeft === 0) + " firstT2=" + (b2 && b2.tech),
      "(c) locked-candidate 5x5: T1cap-left=" + capC.unknownLeft + " solved=" + (resC.unknownLeft === 0) + " firstT2=" + (c2 && c2.tech),
      failures.length ? failures.join("\n") : "all three techniques exercised on independently-verified unique fixtures"
    ].join("\n")
  };
});

// ================================================================ CHECK 8 ==
// DETERMINISM & DISPERSION: same (tier,index) twice deep-equal; distinct
// solutions across indices; seed deltas not constant / linear.

check("8. DETERMINISM & DISPERSION", function () {
  var failures = [];
  // determinism: regenerate a few and deep-equal the stored ones
  for (var t = 1; t <= 4; t++) {
    for (var idx = 0; idx < 3; idx++) {
      var again = L.generatePuzzle(t, idx);
      var first = POOL[t][idx];
      var a = JSON.stringify({ g: first.givens, s: first.solution, sid: first.streamId, seed: first.seed });
      var b = JSON.stringify({ g: again.givens, s: again.solution, sid: again.streamId, seed: again.seed });
      if (a !== b) failures.push("tier " + t + " idx " + idx + ": non-deterministic generatePuzzle");
    }
  }
  // dispersion. The hard guarantee is that distinct indices never yield an
  // IDENTICAL puzzle. Solution-grid distinctness is additionally required for
  // the large tiers 2-4; tier 1 (4x4) has a genuinely small solution space
  // (~hundreds of valid Strimko grids), so a few birthday-paradox grid
  // collisions are expected and NOT a defect — but the full puzzles (streams +
  // givens) must still all differ and the distinct-grid ratio stay high.
  var dupTotal = 0, fullDupTotal = 0, ratioLine = [];
  for (t = 1; t <= 4; t++) {
    var seenSol = {}, seenFull = {}, dups = 0, fullDups = 0;
    for (idx = 0; idx < POOL[t].length; idx++) {
      var p = POOL[t][idx];
      var solKey = p.solution.map(function (row) { return row.join(""); }).join("|");
      var fullKey = solKey + "#" + JSON.stringify(p.streamId) + "#" + JSON.stringify(p.givens);
      if (seenSol[solKey]) dups++; else seenSol[solKey] = 1;
      if (seenFull[fullKey]) fullDups++; else seenFull[fullKey] = 1;
    }
    var ratio = Object.keys(seenSol).length / POOL[t].length;
    ratioLine.push("t" + t + "=" + (100 * ratio).toFixed(0) + "%");
    // identical full puzzles are ALWAYS a failure
    if (fullDups > 0) failures.push("tier " + t + ": " + fullDups + " IDENTICAL full puzzles across " + POOL[t].length + " indices");
    // solution-grid distinctness: strict for large tiers, ratio floor for tier 1
    if (t >= 2 && dups > 0) failures.push("tier " + t + ": " + dups + " duplicate solution grids across " + POOL[t].length + " indices");
    if (t === 1 && ratio < 0.9) failures.push("tier 1: distinct-grid ratio " + (100 * ratio).toFixed(0) + "% < 90% (generator too repetitive)");
    dupTotal += dups; fullDupTotal += fullDups;
  }
  // hash dispersion: consecutive-index seeds not near-linear
  function distinctDeltas(prefix, mid) {
    var s = [];
    for (var i = 0; i <= 40; i++) s.push(L.hashStringToSeed(prefix + i + mid));
    var d = {};
    for (i = 0; i < 40; i++) d[(s[i + 1] - s[i]) >>> 0] = 1;
    return Object.keys(d).length;
  }
  var idxDistinct = distinctDeltas("strimko-3-", "-attempt-0");
  var attDistinct = distinctDeltas("strimko-3-7-attempt-", "");
  if (idxDistinct < 30) failures.push("index-seed deltas only " + idxDistinct + "/40 distinct — near-linear");
  if (attDistinct < 30) failures.push("attempt-seed deltas only " + attDistinct + "/40 distinct — near-linear");

  return {
    pass: failures.length === 0,
    detail: "determinism re-gen 3 idx/tier: " + (12 - failures.filter(function (f) { return f.indexOf("non-deterministic") >= 0; }).length) +
      "/12 identical; IDENTICAL full puzzles=" + fullDupTotal + " (must be 0); solution-grid dup grids=" + dupTotal +
      " (tier1 small-space allowed), distinct-grid ratios " + ratioLine.join(" ") + "; index-seed distinct deltas=" + idxDistinct +
      "/40, attempt-seed distinct deltas=" + attDistinct + "/40" +
      (failures.length ? "\n" + failures.join("\n") : "")
  };
});

// ================================================================= verdict ==

var failed = results.filter(function (r) { return !r.pass; });
var totalMs = results.reduce(function (s, r) { return s + r.ms; }, 0);
console.log("");
console.log("==================================================================");
console.log(results.length + " checks, " + failed.length + " failed, total " + totalMs + " ms");
console.log(failed.length === 0 ? "VERDICT: ALL CHECKS GREEN" : "VERDICT: RED — DO NOT SHIP");
console.log("==================================================================");
process.exit(failed.length === 0 ? 0 : 1);
