/*
 * Strimko — logic core (graded sound solver + uniqueness counter + gated
 * generator).
 *
 * Pure logic, zero DOM. Runs in the browser as a plain <script> (exposes
 * root.StrimkoLogic) and under Node (module.exports). Everything lives inside
 * one IIFE so nothing leaks into the shared global scope.
 *
 * Rules: an n×n grid filled 1..n so every ROW, every COLUMN and every STREAM
 * (a connected orthogonal chain of exactly n cells partitioning the grid)
 * contains 1..n exactly once. A cell's candidates are the values not already
 * present in its row, its column OR its stream.
 *
 * Solver technique ladder — every deduction PROVES a value must / cannot go
 * somewhere; the solver never guesses:
 *   T1  Naked single: a cell with exactly one remaining candidate → place it.
 *       (Constraint propagation over row ∪ column ∪ stream.)
 *   T2  Hidden single: within a unit a value fits exactly one cell → place it.
 *       Locked candidates: if a value's remaining cells in a stream all share a
 *       row (or col) it is eliminated from the rest of that row/col, and the
 *       reverse (a value confined within a row/col to one stream is eliminated
 *       from the rest of that stream).
 *   T3  Naked / hidden subsets (pairs & triples) within any unit.
 *   T4  Advanced: X-wing (basic fish over rows/cols) and short bivalue forcing
 *       chains (proof by contradiction via naked-single propagation) — sound.
 *
 * solve() runs cheapest-tier-first to fixpoint and reports the hardest tier it
 * needed. The generator accepts a board only when that grade EXACTLY matches
 * the tier target and an INDEPENDENT exhaustive backtracking counter proves the
 * solution unique. checkAgainstTruth validates every placement against the real
 * solution the moment it is made and records any contradiction.
 */
(function (root) {
  "use strict";

  var DIRS4 = [[-1, 0], [1, 0], [0, -1], [0, 1]];

  // ---------------------------------------------------------------- PRNG --

  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // FNV-1a over the whole string, then a Murmur-style avalanche finalizer so
  // near-identical strings ("...-attempt-1" vs "...-attempt-2") produce wildly
  // different seeds. Never an additive seed+attempt combination.
  function hashStringToSeed(str) {
    var h = 2166136261 >>> 0;
    for (var i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    h ^= h >>> 16;
    h = Math.imul(h, 0x45d9f3b);
    h ^= h >>> 16;
    h = Math.imul(h, 0x45d9f3b);
    h ^= h >>> 16;
    return h >>> 0;
  }

  function randInt(rng, n) { return Math.floor(rng() * n); }

  function shuffle(arr, rng) {
    for (var i = arr.length - 1; i > 0; i--) {
      var j = randInt(rng, i + 1);
      var t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  }

  // --------------------------------------------------------------- tiers --

  // Grid size is a per-tier constant. Difficulty is graded by the hardest
  // solver technique REQUIRED, matched exactly (not by given-count).
  var TIERS = {
    1: { name: "Trickle", size: 4 },
    2: { name: "Brook",   size: 5 },
    3: { name: "Current", size: 6 },
    4: { name: "Rapids",  size: 7 }
  };

  function configForTier(tier) {
    var cfg = TIERS[tier];
    if (!cfg) throw new Error("Unknown tier: " + tier);
    return { tier: tier, name: cfg.name, size: cfg.size };
  }

  // ------------------------------------------------------------- bit utils --

  function bit(v) { return 1 << (v - 1); }

  function popcount(x) {
    x = x - ((x >> 1) & 0x55555555);
    x = (x & 0x33333333) + ((x >> 2) & 0x33333333);
    return (((x + (x >> 4)) & 0x0f0f0f0f) * 0x01010101) >> 24;
  }

  function onlyValue(mask) {
    // mask has exactly one bit — return its value (1-based)
    var v = 1;
    while (!(mask & 1)) { mask >>= 1; v++; }
    return v;
  }

  function combos(arr, k) {
    var res = [];
    (function rec(start, chosen) {
      if (chosen.length === k) { res.push(chosen.slice()); return; }
      for (var i = start; i < arr.length; i++) {
        chosen.push(arr[i]);
        rec(i + 1, chosen);
        chosen.pop();
      }
    })(0, []);
    return res;
  }

  // ---------------------------------------------------- grid / geometry --

  function to2D(flat, n) {
    var g = [];
    for (var r = 0; r < n; r++) {
      var row = [];
      for (var c = 0; c < n; c++) row.push(flat[r * n + c]);
      g.push(row);
    }
    return g;
  }

  function inBounds(n, r, c) { return r >= 0 && r < n && c >= 0 && c < n; }

  // streamId (flat) from either puzzle.streams (list of index arrays) or
  // puzzle.streamId (2D grid).
  function streamIdFlat(puzzle) {
    var n = puzzle.n;
    var sid = new Array(n * n);
    if (puzzle.streams) {
      for (var s = 0; s < puzzle.streams.length; s++) {
        var cells = puzzle.streams[s];
        for (var i = 0; i < cells.length; i++) sid[cells[i]] = s;
      }
    } else if (puzzle.streamId) {
      for (var r = 0; r < n; r++) {
        for (var c = 0; c < n; c++) sid[r * n + c] = puzzle.streamId[r][c];
      }
    } else {
      throw new Error("puzzle has neither streams nor streamId");
    }
    return sid;
  }

  // Build units (rows, cols, streams as index arrays), per-cell unit refs and
  // per-cell peer lists (row ∪ col ∪ stream minus self).
  function buildTopology(n, sid) {
    var rows = [], cols = [], streams = [];
    var i, r, c;
    for (i = 0; i < n; i++) { rows.push([]); cols.push([]); streams.push([]); }
    for (r = 0; r < n; r++) {
      for (c = 0; c < n; c++) {
        var idx = r * n + c;
        rows[r].push(idx);
        cols[c].push(idx);
        streams[sid[idx]].push(idx);
      }
    }
    var peers = [];
    for (idx = 0; idx < n * n; idx++) {
      r = (idx / n) | 0; c = idx % n;
      var seen = {};
      var list = [];
      function add(j) { if (j !== idx && !seen[j]) { seen[j] = 1; list.push(j); } }
      var k;
      for (k = 0; k < n; k++) { add(r * n + k); add(k * n + c); }
      var sc = streams[sid[idx]];
      for (k = 0; k < sc.length; k++) add(sc[k]);
      peers.push(list);
    }
    return { rows: rows, cols: cols, streams: streams, peers: peers, sid: sid };
  }

  // Cell's row/col/stream peer coordinate lists (exported helper for UI/hints).
  function cellPeers(n, streamId2D, r, c) {
    var rowP = [], colP = [], streamP = [];
    var k, rr, cc;
    for (k = 0; k < n; k++) {
      if (k !== c) rowP.push({ r: r, c: k });
      if (k !== r) colP.push({ r: k, c: c });
    }
    var sid = streamId2D[r][c];
    for (rr = 0; rr < n; rr++) {
      for (cc = 0; cc < n; cc++) {
        if ((rr !== r || cc !== c) && streamId2D[rr][cc] === sid) {
          streamP.push({ r: rr, c: cc });
        }
      }
    }
    return { row: rowP, col: colP, stream: streamP };
  }

  // ---------------------------------------------------------- the solver --

  var STOP = { __stop: true };

  function fail(st, reason) {
    if (!st.contradiction) st.contradiction = { reason: reason };
    throw STOP;
  }

  // Assign a proven value. Validates against ground truth (if present), checks
  // for unit conflicts, then propagates the elimination to peers.
  function assign(st, idx, v) {
    if (st.grid[idx] === v) return;
    if (st.grid[idx] !== 0) fail(st, "conflict at " + idx + ": have " + st.grid[idx] + ", deduced " + v);
    if (st.truth) {
      var r = (idx / st.n) | 0, c = idx % st.n;
      if (st.truth[r][c] !== v) {
        st.truthViolations.push({ r: r, c: c, deduced: v, truth: st.truth[r][c] });
        throw STOP; // unsound deduction — hard stop
      }
    }
    var b = bit(v);
    var peers = st.peers[idx];
    var p, j;
    for (j = 0; j < peers.length; j++) {
      p = peers[j];
      if (st.grid[p] === v) fail(st, "value " + v + " duplicated in a unit at " + idx);
    }
    st.grid[idx] = v;
    st.cand[idx] = b;
    for (j = 0; j < peers.length; j++) {
      p = peers[j];
      if (st.grid[p] === 0 && (st.cand[p] & b)) {
        st.cand[p] &= ~b;
        if (st.cand[p] === 0) fail(st, "cell " + p + " left with no candidates");
      }
    }
  }

  // Remove value v from an empty cell's candidates. Returns true if changed.
  function elim(st, idx, v) {
    if (st.grid[idx] !== 0) return false;
    var b = bit(v);
    if (!(st.cand[idx] & b)) return false;
    st.cand[idx] &= ~b;
    if (st.cand[idx] === 0) fail(st, "cell " + idx + " left with no candidates");
    return true;
  }

  function commitStep(st, tier, tech, reason) {
    st.steps.push({ tier: tier, tech: tech, reason: reason });
    st.tierCounts[tier]++;
    if (tier > st.maxTierUsed) st.maxTierUsed = tier;
  }

  function unitHasValue(st, unit, v) {
    for (var i = 0; i < unit.length; i++) if (st.grid[unit[i]] === v) return true;
    return false;
  }

  // ---- T1: naked singles --------------------------------------------------

  function t1step(st) {
    var n = st.n, idx;
    for (idx = 0; idx < n * n; idx++) {
      if (st.grid[idx] !== 0) continue;
      var m = st.cand[idx];
      if (m === 0) fail(st, "cell " + idx + " has no candidates");
      if (popcount(m) === 1) {
        var v = onlyValue(m);
        assign(st, idx, v);
        commitStep(st, 1, "naked-single", "cell " + idx + " = " + v);
        return true;
      }
    }
    return false;
  }

  // ---- T2: hidden singles + locked candidates -----------------------------

  function allUnits(st) {
    return st.rows.concat(st.cols).concat(st.streams);
  }

  function t2step(st) {
    var n = st.n, u, v, i;
    var units = st._allUnits || (st._allUnits = allUnits(st));

    // hidden singles
    for (u = 0; u < units.length; u++) {
      var unit = units[u];
      for (v = 1; v <= n; v++) {
        if (unitHasValue(st, unit, v)) continue;
        var b = bit(v), home = -1, count = 0;
        for (i = 0; i < unit.length; i++) {
          var idx = unit[i];
          if (st.grid[idx] === 0 && (st.cand[idx] & b)) { home = idx; count++; if (count > 1) break; }
        }
        if (count === 0) fail(st, "value " + v + " has nowhere to go in a unit");
        if (count === 1) {
          assign(st, home, v);
          commitStep(st, 2, "hidden-single", "value " + v + " fits only cell " + home + " in its unit");
          return true;
        }
      }
    }

    // locked candidates: stream -> line
    for (u = 0; u < st.streams.length; u++) {
      var sc = st.streams[u];
      for (v = 1; v <= n; v++) {
        if (unitHasValue(st, sc, v)) continue;
        var cells = candCells(st, sc, v);
        if (cells.length < 1) continue;
        var sameRow = allSame(cells, function (x) { return (x / n) | 0; });
        var sameCol = allSame(cells, function (x) { return x % n; });
        if (sameRow >= 0) {
          if (lockedElim(st, st.rows[sameRow], u, v, true)) {
            commitStep(st, 2, "locked-candidate", "value " + v + " in stream " + u + " confined to row " + sameRow);
            return true;
          }
        }
        if (sameCol >= 0) {
          if (lockedElim(st, st.cols[sameCol], u, v, true)) {
            commitStep(st, 2, "locked-candidate", "value " + v + " in stream " + u + " confined to col " + sameCol);
            return true;
          }
        }
      }
    }

    // locked candidates: line -> stream
    var lines = st.rows.concat(st.cols);
    for (u = 0; u < lines.length; u++) {
      var line = lines[u];
      for (v = 1; v <= n; v++) {
        if (unitHasValue(st, line, v)) continue;
        var cs = candCells(st, line, v);
        if (cs.length < 1) continue;
        var s0 = st.sid[cs[0]];
        var same = true;
        for (i = 1; i < cs.length; i++) if (st.sid[cs[i]] !== s0) { same = false; break; }
        if (same) {
          if (lockedElimStream(st, st.streams[s0], line, v)) {
            commitStep(st, 2, "locked-candidate", "value " + v + " in a line confined to stream " + s0);
            return true;
          }
        }
      }
    }
    return false;
  }

  function candCells(st, unit, v) {
    var b = bit(v), out = [];
    for (var i = 0; i < unit.length; i++) {
      var idx = unit[i];
      if (st.grid[idx] === 0 && (st.cand[idx] & b)) out.push(idx);
    }
    return out;
  }

  // returns the shared key value if all cells share it, else -1
  function allSame(cells, keyFn) {
    var k0 = keyFn(cells[0]);
    for (var i = 1; i < cells.length; i++) if (keyFn(cells[i]) !== k0) return -1;
    return k0;
  }

  // eliminate v from all cells of `lineUnit` that are NOT in stream `streamIdx`
  function lockedElim(st, lineUnit, streamIdx, v, fromStream) {
    var changed = false;
    for (var i = 0; i < lineUnit.length; i++) {
      var idx = lineUnit[i];
      if (st.sid[idx] === streamIdx) continue;
      if (elim(st, idx, v)) changed = true;
    }
    return changed;
  }

  // eliminate v from cells of `streamUnit` that are NOT in the given line unit
  function lockedElimStream(st, streamUnit, lineUnit, v) {
    var inLine = {};
    for (var i = 0; i < lineUnit.length; i++) inLine[lineUnit[i]] = 1;
    var changed = false;
    for (i = 0; i < streamUnit.length; i++) {
      var idx = streamUnit[i];
      if (inLine[idx]) continue;
      if (elim(st, idx, v)) changed = true;
    }
    return changed;
  }

  // ---- T3: naked / hidden subsets (pairs & triples) -----------------------

  function t3step(st) {
    var n = st.n;
    var units = st._allUnits || (st._allUnits = allUnits(st));
    for (var u = 0; u < units.length; u++) {
      if (nakedSubset(st, units[u])) return true;
      if (hiddenSubset(st, units[u])) return true;
    }
    return false;
  }

  function nakedSubset(st, unit) {
    var empties = [];
    for (var i = 0; i < unit.length; i++) {
      if (st.grid[unit[i]] === 0) empties.push(unit[i]);
    }
    var m = empties.length;
    var kArr = [2, 3];
    for (var ki = 0; ki < kArr.length; ki++) {
      var k = kArr[ki];
      if (m <= k) continue;
      var cs = combos(empties, k);
      for (var ci = 0; ci < cs.length; ci++) {
        var group = cs[ci];
        var union = 0;
        for (var g = 0; g < group.length; g++) union |= st.cand[group[g]];
        if (popcount(union) !== k) continue;
        // eliminate the k values from the other empties in this unit
        var inGroup = {};
        for (g = 0; g < group.length; g++) inGroup[group[g]] = 1;
        var changed = false;
        for (var e = 0; e < empties.length; e++) {
          var idx = empties[e];
          if (inGroup[idx]) continue;
          var shared = st.cand[idx] & union;
          if (shared) {
            for (var v = 1; v <= st.n; v++) {
              if (shared & bit(v)) { if (elim(st, idx, v)) changed = true; }
            }
          }
        }
        if (changed) {
          commitStep(st, 3, "naked-subset", "naked " + (k === 2 ? "pair" : "triple") + " in a unit");
          return true;
        }
      }
    }
    return false;
  }

  function hiddenSubset(st, unit) {
    var n = st.n;
    var empties = [];
    for (var i = 0; i < unit.length; i++) {
      if (st.grid[unit[i]] === 0) empties.push(unit[i]);
    }
    var m = empties.length;
    // position mask per unplaced value
    var vals = [], posMaskOf = {};
    for (var v = 1; v <= n; v++) {
      if (unitHasValue(st, unit, v)) continue;
      var pm = 0;
      for (var p = 0; p < m; p++) {
        if (st.cand[empties[p]] & bit(v)) pm |= (1 << p);
      }
      if (pm !== 0) { vals.push(v); posMaskOf[v] = pm; }
    }
    var kArr = [2, 3];
    for (var ki = 0; ki < kArr.length; ki++) {
      var k = kArr[ki];
      if (vals.length <= k || m <= k) continue;
      var cs = combos(vals, k);
      for (var ci = 0; ci < cs.length; ci++) {
        var group = cs[ci];
        var union = 0, allowed = 0;
        for (var g = 0; g < group.length; g++) { union |= posMaskOf[group[g]]; allowed |= bit(group[g]); }
        if (popcount(union) !== k) continue;
        // the k values live only in these k cells → strip other candidates there
        var changed = false;
        for (var p2 = 0; p2 < m; p2++) {
          if (!(union & (1 << p2))) continue;
          var idx = empties[p2];
          var extra = st.cand[idx] & ~allowed;
          if (extra) {
            for (var vv = 1; vv <= n; vv++) {
              if (extra & bit(vv)) { if (elim(st, idx, vv)) changed = true; }
            }
          }
        }
        if (changed) {
          commitStep(st, 3, "hidden-subset", "hidden " + (k === 2 ? "pair" : "triple") + " in a unit");
          return true;
        }
      }
    }
    return false;
  }

  // ---- T4: X-wing + bivalue forcing chains --------------------------------

  function t4step(st) {
    if (xwing(st)) return true;
    if (forcingChain(st)) return true;
    return false;
  }

  // Basic fish (size 2) over rows→cols and cols→rows.
  function xwing(st) {
    var n = st.n, v;
    for (v = 1; v <= n; v++) {
      if (fishOnce(st, v, true)) return true;   // rows define, eliminate in cols
      if (fishOnce(st, v, false)) return true;  // cols define, eliminate in rows
    }
    return false;
  }

  function fishOnce(st, v, byRow) {
    var n = st.n;
    var base = byRow ? st.rows : st.cols;
    var lineOf = []; // for each base line: the two cross positions (or null)
    for (var li = 0; li < n; li++) {
      var unit = base[li];
      if (unitHasValue(st, unit, v)) { lineOf.push(null); continue; }
      var pos = [];
      for (var i = 0; i < unit.length; i++) {
        var idx = unit[i];
        if (st.grid[idx] === 0 && (st.cand[idx] & bit(v))) {
          pos.push(byRow ? (idx % n) : ((idx / n) | 0));
        }
      }
      lineOf.push(pos.length === 2 ? pos : null);
    }
    for (var a = 0; a < n; a++) {
      if (!lineOf[a]) continue;
      for (var b = a + 1; b < n; b++) {
        if (!lineOf[b]) continue;
        if (lineOf[a][0] !== lineOf[b][0] || lineOf[a][1] !== lineOf[b][1]) continue;
        var cross = lineOf[a];
        var changed = false;
        for (var other = 0; other < n; other++) {
          if (other === a || other === b) continue;
          for (var ci = 0; ci < 2; ci++) {
            var cp = cross[ci];
            var idx2 = byRow ? (other * n + cp) : (cp * n + other);
            if (elim(st, idx2, v)) changed = true;
          }
        }
        if (changed) {
          commitStep(st, 4, "x-wing", "x-wing on value " + v + (byRow ? " (rows)" : " (cols)"));
          return true;
        }
      }
    }
    return false;
  }

  // Short bivalue forcing chain: for a cell with exactly two candidates, if
  // assuming one value propagates (naked singles only) to a contradiction, that
  // value is impossible — a sound proof-by-contradiction elimination.
  function forcingChain(st) {
    var n = st.n, idx;
    for (idx = 0; idx < n * n; idx++) {
      if (st.grid[idx] !== 0) continue;
      if (popcount(st.cand[idx]) !== 2) continue;
      for (var v = 1; v <= n; v++) {
        if (!(st.cand[idx] & bit(v))) continue;
        if (leadsToContradiction(st, idx, v)) {
          elim(st, idx, v);
          commitStep(st, 4, "forcing-chain", "assuming cell " + idx + " = " + v + " forces a contradiction");
          return true;
        }
      }
    }
    return false;
  }

  // Hypothetical propagation on a private copy: assume grid[start]=v, apply only
  // naked-single propagation, then check for an unsatisfiable unit. Returns true
  // iff a contradiction is provable. Never touches ground-truth (it is a test).
  function leadsToContradiction(st, start, v) {
    var n = st.n;
    var g = st.grid.slice();
    var cd = st.cand.slice();
    var stack = [];
    var contradiction = false;

    function place(i, val) {
      if (g[i] === val) return true;
      if (g[i] !== 0) return false;
      var b = bit(val);
      g[i] = val; cd[i] = b;
      var peers = st.peers[i];
      for (var j = 0; j < peers.length; j++) {
        var p = peers[j];
        if (g[p] === val) return false;
        if (g[p] === 0 && (cd[p] & b)) {
          cd[p] &= ~b;
          if (cd[p] === 0) return false;
          if (popcount(cd[p]) === 1) stack.push(p);
        }
      }
      return true;
    }

    if (!place(start, v)) return true;
    while (stack.length) {
      var i = stack.pop();
      if (g[i] !== 0) continue;
      if (!place(i, onlyValue(cd[i]))) { contradiction = true; break; }
    }
    if (contradiction) return true;

    // any unit missing a value with no home?
    var units = st._allUnits || (st._allUnits = allUnits(st));
    for (var u = 0; u < units.length; u++) {
      var unit = units[u];
      for (var val = 1; val <= n; val++) {
        var b = bit(val), present = false, home = false;
        for (var q = 0; q < unit.length; q++) {
          var idx = unit[q];
          if (g[idx] === val) { present = true; break; }
          if (g[idx] === 0 && (cd[idx] & b)) home = true;
        }
        if (!present && !home) return true;
      }
    }
    return false;
  }

  // ---- solve driver -------------------------------------------------------

  // puzzle: { n, streams | streamId, givens:[{r,c,v}] }
  // opts:   { truth: solutionGrid|null, maxTechniqueTier: 1|2|3|4 }
  //
  // maxTechniqueTier caps the solver so the harness/generator can prove a board
  // is NOT solvable at a lower tier. Default = 4 (all techniques).
  function solve(puzzle, opts) {
    opts = opts || {};
    var n = puzzle.n;
    var sid = streamIdFlat(puzzle);
    var topo = buildTopology(n, sid);
    var st = {
      n: n,
      grid: new Array(n * n),
      cand: new Array(n * n),
      rows: topo.rows, cols: topo.cols, streams: topo.streams,
      peers: topo.peers, sid: sid,
      steps: [],
      tierCounts: { 1: 0, 2: 0, 3: 0, 4: 0 },
      maxTierUsed: 0,
      contradiction: null,
      truth: opts.truth || null,
      truthViolations: [],
      _allUnits: null
    };
    var full = (1 << n) - 1;
    for (var i = 0; i < n * n; i++) { st.grid[i] = 0; st.cand[i] = full; }

    try {
      var givens = puzzle.givens || [];
      for (i = 0; i < givens.length; i++) {
        var gg = givens[i];
        assign(st, gg.r * n + gg.c, gg.v);
      }
      var cap = opts.maxTechniqueTier || 4;
      for (;;) {
        if (t1step(st)) continue;
        if (cap >= 2 && t2step(st)) continue;
        if (cap >= 3 && t3step(st)) continue;
        if (cap >= 4 && t4step(st)) continue;
        break;
      }
    } catch (e) {
      if (e !== STOP) throw e;
    }

    var unknownLeft = 0;
    for (i = 0; i < n * n; i++) if (st.grid[i] === 0) unknownLeft++;

    return {
      solved: !st.contradiction && st.truthViolations.length === 0 && unknownLeft === 0,
      maxTierUsed: st.maxTierUsed,
      tierCounts: st.tierCounts,
      steps: st.steps,
      board: to2D(st.grid, n),
      unknownLeft: unknownLeft,
      contradiction: st.contradiction,
      truthViolations: st.truthViolations
    };
  }

  // ------------------------------------------- uniqueness (independent) --

  // Exhaustive backtracking solution counter, capped. Completely independent of
  // the deductive solver: pure search with MRV, checking row/col/stream
  // constraints directly. Proves "exactly one solution".
  function countSolutions(puzzle, cap) {
    cap = cap || 2;
    var n = puzzle.n;
    var sid = streamIdFlat(puzzle);
    var grid = new Array(n * n);
    var i;
    for (i = 0; i < n * n; i++) grid[i] = 0;
    var rowMask = new Array(n), colMask = new Array(n), streamMask = new Array(n);
    for (i = 0; i < n; i++) { rowMask[i] = 0; colMask[i] = 0; streamMask[i] = 0; }
    var full = (1 << n) - 1;
    var count = 0;
    var bad = false;

    function put(idx, v) {
      var r = (idx / n) | 0, c = idx % n, s = sid[idx], b = bit(v);
      grid[idx] = v; rowMask[r] |= b; colMask[c] |= b; streamMask[s] |= b;
    }
    function unput(idx, v) {
      var r = (idx / n) | 0, c = idx % n, s = sid[idx], b = bit(v);
      grid[idx] = 0; rowMask[r] &= ~b; colMask[c] &= ~b; streamMask[s] &= ~b;
    }

    var givens = puzzle.givens || [];
    for (i = 0; i < givens.length; i++) {
      var gg = givens[i];
      var idx = gg.r * n + gg.c, b = bit(gg.v);
      var r = gg.r, c = gg.c, s = sid[idx];
      if ((rowMask[r] & b) || (colMask[c] & b) || (streamMask[s] & b)) { bad = true; break; }
      put(idx, gg.v);
    }
    if (bad) return 0;

    function candMask(idx) {
      var r = (idx / n) | 0, c = idx % n, s = sid[idx];
      return full & ~(rowMask[r] | colMask[c] | streamMask[s]);
    }

    function rec() {
      if (count >= cap) return;
      // MRV: pick empty cell with fewest candidates
      var best = -1, bestCount = 99, bestMask = 0;
      for (var j = 0; j < n * n; j++) {
        if (grid[j] !== 0) continue;
        var m = candMask(j);
        var pc = popcount(m);
        if (pc === 0) return; // dead end
        if (pc < bestCount) { bestCount = pc; best = j; bestMask = m; if (pc === 1) break; }
      }
      if (best === -1) { count++; return; }
      for (var v = 1; v <= n; v++) {
        if (!(bestMask & bit(v))) continue;
        put(best, v);
        rec();
        unput(best, v);
        if (count >= cap) return;
      }
    }

    rec();
    return count;
  }

  // ------------------------------------------------------------ generator --

  // Randomized Latin square via backtracking (MRV over columns, shuffled value
  // order). Valid on rows and columns by construction.
  function randomLatinSquare(n, rng) {
    var grid = new Array(n * n);
    var i;
    for (i = 0; i < n * n; i++) grid[i] = 0;
    var colMask = new Array(n);
    for (i = 0; i < n; i++) colMask[i] = 0;

    function rec(r, c, rowMask) {
      if (r === n) return true;
      if (c === n) return rec(r + 1, 0, 0);
      var order = shuffle([], rng); // placeholder
      var vals = [];
      for (var v = 1; v <= n; v++) vals.push(v);
      shuffle(vals, rng);
      for (var k = 0; k < n; k++) {
        var v2 = vals[k], b = bit(v2);
        if ((rowMask & b) || (colMask[c] & b)) continue;
        grid[r * n + c] = v2; colMask[c] |= b;
        if (rec(r, c + 1, rowMask | b)) return true;
        grid[r * n + c] = 0; colMask[c] &= ~b;
      }
      return false;
    }
    if (rec(0, 0, 0)) return to2D(grid, n);
    return null;
  }

  // Carve n connected streams of n cells each that also satisfy 1..n distinct
  // per stream against `sol`. Anchored region-growing backtracking search. Each
  // new stream starts at the lowest-index unassigned cell (guarantees coverage).
  // Returns { sid2D, streams:[idxArray] } or null if no partition found within
  // the node budget (caller reseeds → new Latin square).
  function carveStreams(sol, rng, budget) {
    var n = sol.length;
    var valOf = new Array(n * n);
    var r, c;
    for (r = 0; r < n; r++) for (c = 0; c < n; c++) valOf[r * n + c] = sol[r][c];
    var assigned = new Array(n * n);
    var i;
    for (i = 0; i < n * n; i++) assigned[i] = -1;
    var streams = [];
    var nodes = { count: 0 };

    function neighbors(idx) {
      var rr = (idx / n) | 0, cc = idx % n, out = [];
      for (var d = 0; d < 4; d++) {
        var nr = rr + DIRS4[d][0], nc = cc + DIRS4[d][1];
        if (inBounds(n, nr, nc)) out.push(nr * n + nc);
      }
      return out;
    }

    function firstUnassigned() {
      for (var j = 0; j < n * n; j++) if (assigned[j] === -1) return j;
      return -1;
    }

    function recurse(streamIdx) {
      if (streamIdx === n) return true;
      var anchor = firstUnassigned();
      // grow a connected region of size n containing anchor, distinct values
      var region = [anchor];
      var valMask = bit(valOf[anchor]);
      var frontier = [];
      var nb = neighbors(anchor);
      for (var q = 0; q < nb.length; q++) if (assigned[nb[q]] === -1) frontier.push(nb[q]);
      return grow(region, valMask, frontier, {}, streamIdx);
    }

    function grow(region, valMask, frontier, forbidden, streamIdx) {
      if (nodes.count++ > budget) return false;
      if (region.length === n) {
        for (var a = 0; a < n; a++) assigned[region[a]] = streamIdx;
        streams.push(region.slice());
        if (recurse(streamIdx + 1)) return true;
        for (a = 0; a < n; a++) assigned[region[a]] = -1;
        streams.pop();
        return false;
      }
      if (frontier.length === 0) return false;
      // prune: flood-fill every unassigned, non-forbidden cell reachable from
      // the frontier (including the frontier itself). Including a frontier cell
      // EXPANDS the frontier with its neighbors, so the reachable set — not the
      // current frontier length — bounds how large this region can still grow.
      var seen = {};
      var s2;
      for (s2 = 0; s2 < region.length; s2++) seen[region[s2]] = 1;
      var stack = [];
      var reach = 0;
      for (s2 = 0; s2 < frontier.length; s2++) {
        if (!seen[frontier[s2]]) { seen[frontier[s2]] = 1; stack.push(frontier[s2]); reach++; }
      }
      while (stack.length) {
        var cur = stack.pop();
        var cnb = neighbors(cur);
        for (var ci = 0; ci < cnb.length; ci++) {
          var cx = cnb[ci];
          if (!seen[cx] && assigned[cx] === -1 && !forbidden[cx]) {
            seen[cx] = 1; stack.push(cx); reach++;
          }
        }
      }
      if (region.length + reach < n) return false;
      var cell = frontier[0];
      var rest = frontier.slice(1);
      // randomize include/exclude order for dispersion
      var includeFirst = rng() < 0.5;
      var options = includeFirst ? [true, false] : [false, true];
      for (var oi = 0; oi < 2; oi++) {
        var include = options[oi];
        if (include) {
          var v = valOf[cell];
          if (valMask & bit(v)) continue; // value clash — cannot include
          // build new frontier: rest + unassigned neighbors not forbidden/in region/in rest
          var inSet = {};
          var s;
          for (s = 0; s < region.length; s++) inSet[region[s]] = 1;
          for (s = 0; s < rest.length; s++) inSet[rest[s]] = 1;
          inSet[cell] = 1;
          var nf = rest.slice();
          var nb = neighbors(cell);
          for (var q = 0; q < nb.length; q++) {
            var nn = nb[q];
            if (assigned[nn] === -1 && !inSet[nn] && !forbidden[nn]) { nf.push(nn); inSet[nn] = 1; }
          }
          region.push(cell);
          if (grow(region, valMask | bit(v), nf, forbidden, streamIdx)) return true;
          region.pop();
        } else {
          forbidden[cell] = 1;
          if (grow(region, valMask, rest, forbidden, streamIdx)) return true;
          delete forbidden[cell];
        }
      }
      return false;
    }

    if (!recurse(0)) return null;
    var sid2D = [];
    for (r = 0; r < n; r++) {
      var row = [];
      for (c = 0; c < n; c++) row.push(assigned[r * n + c]);
      sid2D.push(row);
    }
    return { sid2D: sid2D, streams: streams };
  }

  // Greedy given selection: start from the full solution, remove cells in a
  // shuffled order while the solver still fully solves the board using only
  // techniques up to the target tier. Returns the surviving givens list.
  function chooseGivens(sol, streams, n, tier, rng) {
    var present = new Array(n * n);
    var i;
    for (i = 0; i < n * n; i++) present[i] = true;

    function currentGivens() {
      var out = [];
      for (var j = 0; j < n * n; j++) {
        if (present[j]) out.push({ r: (j / n) | 0, c: j % n, v: sol[(j / n) | 0][j % n] });
      }
      return out;
    }

    var order = [];
    for (i = 0; i < n * n; i++) order.push(i);
    shuffle(order, rng);

    for (var oi = 0; oi < order.length; oi++) {
      var idx = order[oi];
      present[idx] = false;
      var res = solve({ n: n, streams: streams, givens: currentGivens() },
        { maxTechniqueTier: tier });
      if (!res.solved) present[idx] = true; // revert — removal breaks tier-capped solvability
    }
    return currentGivens();
  }

  // Exact-grade gate: the hardest technique required must equal the tier target.
  function gradeMatches(tier, res) {
    if (!res.solved) return false;
    return res.maxTierUsed === tier;
  }

  var CARVE_BUDGET = 300000;
  var MAX_ATTEMPTS = 4000;

  function buildCandidate(tier, index, k) {
    var cfg = configForTier(tier);
    var n = cfg.size;
    var seed = hashStringToSeed("strimko-" + tier + "-" + index + "-attempt-" + k);
    var rng = mulberry32(seed);
    var sol = randomLatinSquare(n, rng);
    if (!sol) return { seed: seed, failed: "latin" };
    var carve = carveStreams(sol, rng, CARVE_BUDGET);
    if (!carve) return { seed: seed, failed: "carve" };
    var givens = chooseGivens(sol, carve.streams, n, tier, rng);
    return {
      seed: seed, cfg: cfg, n: n, solution: sol,
      streams: carve.streams, streamId: carve.sid2D, givens: givens
    };
  }

  // Generate-and-gate. Deterministic for (tier, index): attempt k uses seed
  // hash("strimko-<tier>-<index>-attempt-<k>"); the first acceptable candidate
  // wins. Gate order: deductive solve (checkAgainstTruth always ON) + exact
  // grade first (cheap), then the independent exhaustive uniqueness proof.
  function generatePuzzle(tier, index) {
    for (var k = 0; k < MAX_ATTEMPTS; k++) {
      var cand = buildCandidate(tier, index, k);
      if (cand.failed) continue;
      var puzzle = { n: cand.n, streams: cand.streams, streamId: cand.streamId, givens: cand.givens };
      var res = solve(puzzle, { truth: cand.solution });
      if (res.truthViolations.length) {
        throw new Error("SOLVER UNSOUND: deduction contradicts ground truth: " +
          JSON.stringify(res.truthViolations));
      }
      if (!res.solved) continue;
      if (!gradeMatches(tier, res)) continue;
      var solutions = countSolutions(puzzle, 2);
      if (solutions !== 1) continue;
      return {
        tier: tier,
        index: index,
        name: cand.cfg.name,
        n: cand.n,
        size: cand.n,
        streamId: cand.streamId,
        streams: cand.streams,
        givens: cand.givens,
        solution: cand.solution,
        seed: cand.seed,
        baseSeed: hashStringToSeed("strimko-" + tier + "-" + index + "-attempt-0"),
        stats: {
          attempts: k + 1,
          givens: cand.givens.length,
          maxTierUsed: res.maxTierUsed,
          tierCounts: res.tierCounts,
          steps: res.steps.length
        }
      };
    }
    throw new Error("generatePuzzle(" + tier + "," + index + "): exhausted " + MAX_ATTEMPTS + " attempts");
  }

  // Empirical acceptance sweep for tuning (used by dev-check).
  function sweepAcceptance(tier, nCandidates) {
    var reasons = { latinFail: 0, carveFail: 0, notSolved: 0, wrongGrade: 0, nonUnique: 0, accepted: 0 };
    var t0 = Date.now();
    for (var k = 0; k < nCandidates; k++) {
      var cand = buildCandidate(tier, "sweep", k);
      if (cand.failed === "latin") { reasons.latinFail++; continue; }
      if (cand.failed === "carve") { reasons.carveFail++; continue; }
      var puzzle = { n: cand.n, streams: cand.streams, streamId: cand.streamId, givens: cand.givens };
      var res = solve(puzzle, { truth: cand.solution });
      if (res.truthViolations.length) {
        throw new Error("SOLVER UNSOUND during sweep: " + JSON.stringify(res.truthViolations));
      }
      if (!res.solved) { reasons.notSolved++; continue; }
      if (!gradeMatches(tier, res)) { reasons.wrongGrade++; continue; }
      if (countSolutions(puzzle, 2) !== 1) { reasons.nonUnique++; continue; }
      reasons.accepted++;
    }
    return {
      tier: tier, tried: nCandidates, reasons: reasons,
      acceptanceRate: reasons.accepted / nCandidates,
      totalMs: Date.now() - t0
    };
  }

  // ----------------------------------------------------------------- API --

  var api = {
    mulberry32: mulberry32,
    hashStringToSeed: hashStringToSeed,
    configForTier: configForTier,
    cellPeers: cellPeers,
    buildTopology: buildTopology,
    streamIdFlat: streamIdFlat,
    solve: solve,
    countSolutions: countSolutions,
    randomLatinSquare: randomLatinSquare,
    carveStreams: carveStreams,
    chooseGivens: chooseGivens,
    gradeMatches: gradeMatches,
    generatePuzzle: generatePuzzle,
    sweepAcceptance: sweepAcceptance
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    root.StrimkoLogic = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
