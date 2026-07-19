/*
 * dev-check.js — quick generation sanity sweep for the Strimko logic core.
 * Run: node test/dev-check.js
 *
 * NOT the correctness gate (that is test/verify.js, written by the verifier and
 * intentionally adversarial). This is the fast "does the generator still make
 * sane boards across all tiers" check used during logic development.
 */
"use strict";
var L = require("../src/logic.js");

function validLatin(g) {
  var n = g.length;
  for (var i = 0; i < n; i++) {
    var rs = {}, cs = {};
    for (var j = 0; j < n; j++) { rs[g[i][j]] = 1; cs[g[j][i]] = 1; }
    if (Object.keys(rs).length !== n || Object.keys(cs).length !== n) return false;
  }
  return true;
}

function streamsValid(p) {
  var n = p.n, seen = {}, count = 0;
  if (p.streams.length !== n) return false;
  for (var s = 0; s < p.streams.length; s++) {
    var cells = p.streams[s];
    if (cells.length !== n) return false;
    var vs = {};
    for (var k = 0; k < cells.length; k++) {
      var c = cells[k];
      if (seen[c]) return false;            // overlap
      seen[c] = 1; count++;
      vs[p.solution[(c / n) | 0][c % n]] = 1;
    }
    if (Object.keys(vs).length !== n) return false; // stream not 1..n distinct
    // connectivity (orthogonal) within the stream
    var inStream = {}; for (k = 0; k < cells.length; k++) inStream[cells[k]] = 1;
    var stack = [cells[0]], vis = {}; vis[cells[0]] = 1, reached = 1;
    var reached = 1;
    while (stack.length) {
      var cur = stack.pop(), rr = (cur / n) | 0, cc = cur % n;
      var nb = [[rr - 1, cc], [rr + 1, cc], [rr, cc - 1], [rr, cc + 1]];
      for (var d = 0; d < 4; d++) {
        var nr = nb[d][0], nc = nb[d][1];
        if (nr < 0 || nr >= n || nc < 0 || nc >= n) continue;
        var ni = nr * n + nc;
        if (inStream[ni] && !vis[ni]) { vis[ni] = 1; stack.push(ni); reached++; }
      }
    }
    if (reached !== n) return false;         // stream not connected
  }
  return count === n * n;
}

var tiers = [1, 2, 3, 4];
var PER = 25;
var hadFailure = false;

for (var ti = 0; ti < tiers.length; ti++) {
  var tier = tiers[ti];
  var t0 = Date.now(), ok = 0, totAtt = 0, worstAtt = 0, fails = [];
  for (var idx = 0; idx < PER; idx++) {
    try {
      var p = L.generatePuzzle(tier, idx);
      totAtt += p.stats.attempts;
      if (p.stats.attempts > worstAtt) worstAtt = p.stats.attempts;
      if (!validLatin(p.solution)) fails.push(idx + ":latin");
      if (!streamsValid(p)) fails.push(idx + ":streams");
      var res = L.solve({ n: p.n, streams: p.streams, givens: p.givens }, {});
      var match = res.solved;
      if (res.solved) {
        for (var r = 0; r < p.n && match; r++)
          for (var c = 0; c < p.n && match; c++)
            if (res.board[r][c] !== p.solution[r][c]) match = false;
      }
      if (!match) fails.push(idx + ":solveMismatch");
      if (res.maxTierUsed !== tier) fails.push(idx + ":grade" + res.maxTierUsed);
      if (L.countSolutions({ n: p.n, streams: p.streams, givens: p.givens }, 2) !== 1)
        fails.push(idx + ":nonunique");
      if (fails.length === 0 || fails[fails.length - 1].indexOf(idx + ":") !== 0) ok++;
      else if (fails.filter(function (f) { return f.indexOf(idx + ":") === 0; }).length === 0) ok++;
    } catch (e) {
      fails.push(idx + ":EXC(" + String(e.message).slice(0, 40) + ")");
    }
  }
  // recompute ok honestly: PER minus indices that appear in fails
  var badIdx = {};
  fails.forEach(function (f) { badIdx[f.split(":")[0]] = 1; });
  ok = PER - Object.keys(badIdx).length;
  var cfg = L.configForTier(tier);
  console.log(
    "Tier " + tier + " (" + cfg.size + "x" + cfg.size + "): " +
    ok + "/" + PER + " clean  avgAtt=" + (totAtt / PER).toFixed(1) +
    " worstAtt=" + worstAtt + "  " + (Date.now() - t0) + "ms" +
    (fails.length ? "  FAIL: " + fails.join(", ") : "")
  );
  if (fails.length) hadFailure = true;
}

if (hadFailure) { console.error("\ndev-check FAILED"); process.exit(1); }
console.log("\ndev-check OK — all tiers generate valid, uniquely-solvable, exactly-graded boards.");
