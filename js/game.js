/*
 * Strimko — UI / DOM controller (Luminous Threads).
 * All puzzle logic (generator, graded solver, uniqueness, hints) lives in
 * src/logic.js and is consumed through the window.StrimkoLogic global. This
 * file holds ZERO deduction logic — it renders, handles taps, and asks the
 * solver for the next step when Hint is pressed. Design + sounds are the
 * approved brief (design-brief.md / design-screens.html / design-sound.html).
 */
(function () {
  "use strict";

  var L = window.StrimkoLogic;

  // Stream thread palette (index by streamId, wrap for 7x7).
  var SC = ["#3FE0C5", "#6C8CFF", "#F06AA6", "#FFB24A", "#9B7BFF", "#5DD6A0", "#E8C24A"];

  // tier -> display name / label (the chosen "Strand ladder"). The logic core's
  // own tier names differ; the UI uses the design ladder.
  var TIER = {
    1: { name: "Strand",   sub: "4 × 4 · gentle" },
    2: { name: "Braid",    sub: "5 × 5 · classic" },
    3: { name: "Weave",    sub: "6 × 6 · tricky" },
    4: { name: "Tapestry", sub: "7 × 7 · expert" }
  };

  var TECH = {
    "naked-single":     "Naked single",
    "hidden-single":    "Hidden single",
    "locked-candidate": "Locked candidate",
    "naked-subset":     "Naked subset",
    "hidden-subset":    "Hidden subset",
    "x-wing":           "X-wing",
    "forcing-chain":    "Forcing chain"
  };

  function $(id) { return document.getElementById(id); }

  // ------------------------------------------------------------- storage --
  function lsGet(k, fb) {
    try { var v = localStorage.getItem(k); return v ? JSON.parse(v) : fb; }
    catch (e) { return fb; }
  }
  function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  function lsDel(k) { try { localStorage.removeItem(k); } catch (e) {} }

  var settings = Object.assign({ sound: true, haptics: true, conflict: true }, lsGet("st-settings", {}));
  var stats = lsGet("st-stats", {});
  var nextIdx = lsGet("st-next", {});

  function tierStats(t) {
    if (!stats[t]) stats[t] = { played: 0, won: 0, streak: 0, best: 0, best2: 0, sum: 0, cur: 0 };
    var s = stats[t];
    if (s.cur === undefined) s.cur = 0;
    return s;
  }

  // --------------------------------------------------------------- audio --
  // Glass Chime set — exact params from design-sound.html. Synthesised at
  // runtime (no asset files). Context is lazily created on first gesture.
  var actx = null;
  function ac() {
    if (!actx) {
      try { actx = new (window.AudioContext || window.webkitAudioContext)(); }
      catch (e) { return null; }
    }
    if (actx && actx.state === "suspended") actx.resume();
    return actx;
  }
  function tone(t0, f, dur, type, gain, glideTo) {
    if (!settings.sound) return;
    var a = ac(); if (!a) return;
    var o = a.createOscillator(), g = a.createGain();
    o.type = type || "sine"; o.frequency.setValueAtTime(f, t0);
    if (glideTo) o.frequency.exponentialRampToValueAtTime(glideTo, t0 + dur);
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(gain, t0 + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g); g.connect(a.destination); o.start(t0); o.stop(t0 + dur + 0.02);
  }
  function sndPlace() { var a = ac(); if (!a) return; var t = a.currentTime; tone(t, 880, 0.28, "sine", 0.22); tone(t, 1320, 0.34, "sine", 0.10); }
  function sndWrong() { var a = ac(); if (!a) return; var t = a.currentTime; tone(t, 300, 0.30, "sine", 0.20, 180); }
  function sndWin() {
    var a = ac(); if (!a) return; var t = a.currentTime;
    [523, 659, 784, 1046, 1319].forEach(function (f, i) {
      tone(t + i * 0.12, f, 0.5, "sine", 0.20); tone(t + i * 0.12, f * 2, 0.5, "sine", 0.06);
    });
  }
  function buzz(p) {
    if (settings.haptics && navigator.vibrate) { try { navigator.vibrate(p); } catch (e) {} }
  }

  // -------------------------------------------------- constellation bg --
  (function constellation() {
    var cv = $("constellation"), ctx = cv.getContext("2d");
    var pts = [], M = 30, R = { width: 0, height: 0 };
    var cols = SC.slice(0, 5);
    function size() {
      var w = window.innerWidth, h = window.innerHeight;
      cv.width = w * devicePixelRatio; cv.height = h * devicePixelRatio;
      cv.style.width = w + "px"; cv.style.height = h + "px";
      ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
      R.width = w; R.height = h;
    }
    size();
    for (var i = 0; i < M; i++) pts.push({
      x: Math.random() * R.width, y: Math.random() * R.height,
      vx: (Math.random() - 0.5) * 0.12, vy: (Math.random() - 0.5) * 0.12,
      c: cols[i % cols.length], r: 1.6 + Math.random() * 2.2
    });
    window.addEventListener("resize", size);
    var reduce = window.matchMedia("(prefers-reduced-motion:reduce)").matches;
    function frame() {
      ctx.clearRect(0, 0, R.width, R.height);
      for (var a = 0; a < M; a++) for (var b = a + 1; b < M; b++) {
        var p = pts[a], q = pts[b], d = Math.hypot(p.x - q.x, p.y - q.y);
        if (d < 100) { ctx.strokeStyle = p.c; ctx.globalAlpha = 0.10 * (1 - d / 100); ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(q.x, q.y); ctx.stroke(); }
      }
      ctx.globalAlpha = 1;
      for (var k = 0; k < M; k++) {
        var pt = pts[k];
        if (!reduce) { pt.x += pt.vx; pt.y += pt.vy; }
        if (pt.x < 0 || pt.x > R.width) pt.vx *= -1;
        if (pt.y < 0 || pt.y > R.height) pt.vy *= -1;
        ctx.fillStyle = pt.c; ctx.globalAlpha = 0.5; ctx.beginPath(); ctx.arc(pt.x, pt.y, pt.r, 0, 7); ctx.fill();
        ctx.globalAlpha = 0.15; ctx.beginPath(); ctx.arc(pt.x, pt.y, pt.r * 3, 0, 7); ctx.fill();
      }
      ctx.globalAlpha = 1;
      requestAnimationFrame(frame);
    }
    frame();
  })();

  // ------------------------------------------------------ win sparks --
  function sparkBurst() {
    var cv = $("spark"), ctx = cv.getContext("2d");
    var w = window.innerWidth, h = window.innerHeight;
    cv.width = w * devicePixelRatio; cv.height = h * devicePixelRatio;
    cv.style.width = w + "px"; cv.style.height = h + "px";
    ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
    var cols = SC.slice(0, 5).concat(["#EAF2F5"]);
    var ps = [];
    function burst() {
      var cx = w / 2, cy = h * 0.4;
      for (var i = 0; i < 80; i++) {
        var ang = Math.random() * 7, sp = 1 + Math.random() * 4.6;
        ps.push({ x: cx, y: cy, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp - 1.4, life: 1, c: cols[i % cols.length], r: 1.5 + Math.random() * 2.6 });
      }
    }
    var frames = 0, bursts = 0;
    burst(); bursts++;
    function frame() {
      ctx.clearRect(0, 0, w, h);
      ps.forEach(function (p) {
        p.x += p.vx; p.y += p.vy; p.vy += 0.06; p.life -= 0.012;
        ctx.globalAlpha = Math.max(0, p.life); ctx.fillStyle = p.c;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, 7); ctx.fill();
      });
      ctx.globalAlpha = 1; ps = ps.filter(function (p) { return p.life > 0; });
      frames++;
      if (frames % 70 === 0 && bursts < 3) { burst(); bursts++; }
      if (ps.length || bursts < 3) requestAnimationFrame(frame);
      else ctx.clearRect(0, 0, w, h);
    }
    if (!window.matchMedia("(prefers-reduced-motion:reduce)").matches) frame();
  }

  // ----------------------------------------------------- static SVG board --
  // Pure SVG render (threads + beads + numerals) for the win/how-to previews.
  function svgBoard(n, sid, values) {
    var th = "", nd = "";
    function cx(c) { return c + 0.5; }
    function cy(r) { return r + 0.5; }
    for (var r = 0; r < n; r++) for (var c = 0; c < n; c++) {
      var s = sid[r][c];
      if (c + 1 < n && sid[r][c + 1] === s)
        th += '<line x1="' + cx(c) + '" y1="' + cy(r) + '" x2="' + cx(c + 1) + '" y2="' + cy(r) + '" stroke="' + SC[s % SC.length] + '" stroke-width="0.15" stroke-linecap="round"/>';
      if (r + 1 < n && sid[r + 1][c] === s)
        th += '<line x1="' + cx(c) + '" y1="' + cy(r) + '" x2="' + cx(c) + '" y2="' + cy(r + 1) + '" stroke="' + SC[s % SC.length] + '" stroke-width="0.15" stroke-linecap="round"/>';
    }
    for (r = 0; r < n; r++) for (c = 0; c < n; c++) {
      var s2 = sid[r][c];
      nd += '<circle cx="' + cx(c) + '" cy="' + cy(r) + '" r="0.34" fill="#1B2238" stroke="' + SC[s2 % SC.length] + '" stroke-width="0.05"/>';
      if (values && values[r][c])
        nd += '<text x="' + cx(c) + '" y="' + (cy(r) + 0.015) + '" text-anchor="middle" dominant-baseline="central" font-family="JetBrains Mono,monospace" font-weight="700" font-size="0.4" fill="#EAF2F5">' + values[r][c] + '</text>';
    }
    return '<svg viewBox="-0.1 -0.1 ' + (n + 0.2) + ' ' + (n + 0.2) + '" width="100%" xmlns="http://www.w3.org/2000/svg">' +
      '<g>' + th + nd + '</g></svg>';
  }

  // ---------------------------------------------------------- game state --
  var G = {
    screen: "home",
    puzzle: null,     // logic puzzle object
    n: 0,
    grid: null,       // 2D current values (0 = empty), includes givens
    given: null,      // 2D bool
    marks: null,      // 2D array of arrays (pencil marks)
    sid: null,        // streamId 2D
    undo: [],
    sel: null,        // {r,c}
    pencil: false,
    conflicts: null,  // Set of "r,c"
    startMs: 0, elapsedBase: 0, tick: null, won: false,
    hintCell: null,
    daily: false, dailyDate: null, dailyDay: 0
  };

  // build DOM cells + threads for current puzzle
  function buildBoard() {
    var n = G.n, board = $("board");
    board.innerHTML = "";
    board.style.setProperty("--pn", n);

    // threads SVG behind
    var sidObj = G.sid;
    var svg = svgBoardThreads(n, sidObj);
    board.insertAdjacentHTML("beforeend", svg);

    var cells = document.createElement("div");
    cells.className = "cells";
    cells.style.gridTemplateColumns = "repeat(" + n + ",1fr)";
    cells.style.gridTemplateRows = "repeat(" + n + ",1fr)";
    for (var r = 0; r < n; r++) for (var c = 0; c < n; c++) {
      var cell = document.createElement("div");
      cell.className = "cell";
      cell.dataset.r = r; cell.dataset.c = c;
      cell.style.setProperty("--sc", SC[G.sid[r][c] % SC.length]);
      var bead = document.createElement("div"); bead.className = "bead";
      var num = document.createElement("div"); num.className = "num";
      var marks = document.createElement("div"); marks.className = "marks";
      bead.appendChild(num);
      cell.appendChild(bead); cell.appendChild(marks);
      cells.appendChild(cell);
    }
    board.appendChild(cells);
    cells.addEventListener("click", onCellTap);
  }

  // threads-only SVG for the interactive board (beads are DOM)
  function svgBoardThreads(n, sid) {
    var th = "";
    for (var r = 0; r < n; r++) for (var c = 0; c < n; c++) {
      var s = sid[r][c];
      if (c + 1 < n && sid[r][c + 1] === s)
        th += '<line x1="' + (c + 0.5) + '" y1="' + (r + 0.5) + '" x2="' + (c + 1.5) + '" y2="' + (r + 0.5) + '" stroke="' + SC[s % SC.length] + '" stroke-width="0.15" stroke-linecap="round"/>';
      if (r + 1 < n && sid[r + 1][c] === s)
        th += '<line x1="' + (c + 0.5) + '" y1="' + (r + 0.5) + '" x2="' + (c + 0.5) + '" y2="' + (r + 1.5) + '" stroke="' + SC[s % SC.length] + '" stroke-width="0.15" stroke-linecap="round"/>';
    }
    // No SVG filter: iOS WebKit drops thin/vertical filtered <line>s, which made
    // some in-stream connections vanish on device. Plain strokes render reliably.
    return '<svg class="threads" viewBox="0 0 ' + n + ' ' + n + '" xmlns="http://www.w3.org/2000/svg">' +
      '<g>' + th + "</g></svg>";
  }

  function cellEl(r, c) {
    return $("board").querySelector('.cell[data-r="' + r + '"][data-c="' + c + '"]');
  }

  // full re-render of values / marks / states
  function renderBoard() {
    var n = G.n;
    for (var r = 0; r < n; r++) for (var c = 0; c < n; c++) {
      var el = cellEl(r, c);
      var v = G.grid[r][c];
      el.classList.toggle("given", G.given[r][c]);
      el.classList.toggle("user", !G.given[r][c] && v !== 0);
      var num = el.querySelector(".num");
      var marksEl = el.querySelector(".marks");
      if (v !== 0) {
        num.textContent = v; marksEl.innerHTML = "";
      } else {
        num.textContent = "";
        var ms = G.marks[r][c];
        if (ms && ms.length) {
          var cols = Math.ceil(Math.sqrt(n));
          marksEl.style.gridTemplateColumns = "repeat(" + cols + ",1fr)";
          var html = "";
          for (var m = 1; m <= n; m++) html += "<span>" + (ms.indexOf(m) >= 0 ? m : "") + "</span>";
          marksEl.innerHTML = html;
        } else marksEl.innerHTML = "";
      }
    }
    renderSelection();
    renderConflicts();
    renderPad();
  }

  function renderSelection() {
    var n = G.n, sel = G.sel;
    for (var r = 0; r < n; r++) for (var c = 0; c < n; c++) {
      var el = cellEl(r, c);
      el.classList.remove("sel", "peer", "samenum");
      if (!sel) continue;
      if (r === sel.r && c === sel.c) { el.classList.add("sel"); continue; }
      var samestream = G.sid[r][c] === G.sid[sel.r][sel.c];
      if (r === sel.r || c === sel.c || samestream) el.classList.add("peer");
      var sv = G.grid[sel.r][sel.c];
      if (sv !== 0 && G.grid[r][c] === sv) el.classList.add("samenum");
    }
  }

  // ------------------------------------------------------- conflicts --
  function computeConflicts() {
    var n = G.n, set = {};
    function scan(cells) {
      var seen = {};
      for (var i = 0; i < cells.length; i++) {
        var v = G.grid[cells[i].r][cells[i].c];
        if (v === 0) continue;
        (seen[v] = seen[v] || []).push(cells[i]);
      }
      for (var val in seen) if (seen[val].length > 1)
        seen[val].forEach(function (x) { set[x.r + "," + x.c] = 1; });
    }
    // rows, cols
    for (var r = 0; r < n; r++) {
      var row = [], col = [];
      for (var c = 0; c < n; c++) { row.push({ r: r, c: c }); col.push({ r: c, c: r }); }
      scan(row); scan(col);
    }
    // streams
    var streams = {};
    for (r = 0; r < n; r++) for (var c2 = 0; c2 < n; c2++) {
      var s = G.sid[r][c2]; (streams[s] = streams[s] || []).push({ r: r, c: c2 });
    }
    for (var sk in streams) scan(streams[sk]);
    return set;
  }

  function renderConflicts() {
    G.conflicts = computeConflicts();
    var n = G.n;
    for (var r = 0; r < n; r++) for (var c = 0; c < n; c++) {
      var el = cellEl(r, c);
      var on = settings.conflict && G.conflicts[r + "," + c];
      el.classList.toggle("conflict", !!on);
    }
  }

  // count of each value placed (for pad)
  function renderPad() {
    var n = G.n, pad = $("pad");
    if (pad.childElementCount !== n) {
      pad.innerHTML = "";
      pad.style.setProperty("--pn", n);
      for (var v = 1; v <= n; v++) {
        var b = document.createElement("button");
        b.dataset.v = v; b.innerHTML = v + '<span class="cnt"></span>';
        pad.appendChild(b);
      }
    }
    var counts = {};
    for (var r = 0; r < n; r++) for (var c = 0; c < n; c++) {
      var vv = G.grid[r][c]; if (vv) counts[vv] = (counts[vv] || 0) + 1;
    }
    Array.prototype.forEach.call(pad.children, function (btn) {
      var val = +btn.dataset.v, left = n - (counts[val] || 0);
      btn.querySelector(".cnt").textContent = left > 0 ? left : "";
      btn.classList.toggle("done", left <= 0);
    });
  }

  // ------------------------------------------------------- interaction --
  function onCellTap(e) {
    var cell = e.target.closest(".cell"); if (!cell) return;
    var r = +cell.dataset.r, c = +cell.dataset.c;
    clearHint();
    G.sel = { r: r, c: c };
    renderSelection();
    buzz(6);
  }

  function place(v) {
    if (!G.sel) { toast("Tap a bead first"); return; }
    var r = G.sel.r, c = G.sel.c;
    if (G.given[r][c]) { buzz(8); return; }

    if (G.pencil && G.grid[r][c] === 0) {
      pushUndo(r, c);
      var ms = G.marks[r][c];
      var i = ms.indexOf(v);
      if (i >= 0) ms.splice(i, 1); else ms.push(v);
      renderBoard(); afterChange(); return;
    }

    // toggle off if same value
    if (G.grid[r][c] === v) { erase(); return; }

    pushUndo(r, c);
    G.grid[r][c] = v;
    G.marks[r][c] = [];
    renderBoard();

    var el = cellEl(r, c);
    var wasConflict = G.conflicts[r + "," + c];
    if (wasConflict) { sndWrong(); buzz([12, 40, 12]); }
    else {
      sndPlace(); buzz(10);
      if (!window.matchMedia("(prefers-reduced-motion:reduce)").matches) {
        el.classList.remove("place-flash"); void el.offsetWidth; el.classList.add("place-flash");
      }
      glowCompletedUnits(r, c);
    }
    afterChange();
    checkWin();
  }

  function erase() {
    if (!G.sel) return;
    var r = G.sel.r, c = G.sel.c;
    if (G.given[r][c]) return;
    if (G.grid[r][c] === 0 && (!G.marks[r][c] || !G.marks[r][c].length)) return;
    pushUndo(r, c);
    G.grid[r][c] = 0; G.marks[r][c] = [];
    renderBoard(); buzz(8); afterChange();
  }

  // glow any row/col/stream that just became fully & correctly filled
  function glowCompletedUnits(r, c) {
    var n = G.n;
    var units = [];
    var row = [], col = [];
    for (var k = 0; k < n; k++) { row.push({ r: r, c: k }); col.push({ r: k, c: c }); }
    units.push(row); units.push(col);
    var s = G.sid[r][c], stream = [];
    for (var rr = 0; rr < n; rr++) for (var cc = 0; cc < n; cc++) if (G.sid[rr][cc] === s) stream.push({ r: rr, c: cc });
    units.push(stream);
    units.forEach(function (u) {
      var vals = {}, full = true;
      for (var i = 0; i < u.length; i++) {
        var v = G.grid[u[i].r][u[i].c];
        if (v === 0 || vals[v]) { full = false; break; }
        vals[v] = 1;
      }
      if (full) u.forEach(function (x) {
        var el = cellEl(x.r, x.c);
        el.classList.remove("unit-glow"); void el.offsetWidth; el.classList.add("unit-glow");
      });
    });
  }

  function pushUndo(r, c) {
    G.undo.push({ r: r, c: c, v: G.grid[r][c], m: (G.marks[r][c] || []).slice() });
    $("btn-undo").disabled = false;
  }
  function undo() {
    if (!G.undo.length) return;
    var u = G.undo.pop();
    G.grid[u.r][u.c] = u.v; G.marks[u.r][u.c] = u.m.slice();
    G.sel = { r: u.r, c: u.c };
    $("btn-undo").disabled = G.undo.length === 0;
    clearHint(); renderBoard(); buzz(8); sndWrong(); afterChange();
  }

  function afterChange() { saveGame(); }

  // ------------------------------------------------------------- hints --
  // Solver-powered: feed the solver the givens PLUS every correct player entry,
  // then surface the first step that PLACES a value in a still-empty cell.
  function hint() {
    clearHint();
    if (!G.puzzle) return;
    // build givens = original givens + correct user cells (skip wrong ones so
    // the solver reasons from a sound position)
    var givens = [];
    var sol = G.puzzle.solution, n = G.n, wrong = 0;
    for (var r = 0; r < n; r++) for (var c = 0; c < n; c++) {
      var v = G.grid[r][c];
      if (v === 0) continue;
      if (v === sol[r][c]) givens.push({ r: r, c: c, v: v });
      else wrong++;
    }
    if (wrong) { toast("Fix the pink clashes first"); flashConflicts(); buzz([12, 40, 12]); return; }

    var res = L.solve({ n: n, streams: G.puzzle.streams, givens: givens });
    // find first step that fills a currently-empty cell
    var target = null;
    for (var i = 0; i < res.steps.length; i++) {
      var p = parsePlacement(res.steps[i]);
      if (p && G.grid[p.r][p.c] === 0) { target = { step: res.steps[i], cell: p }; break; }
    }
    if (!target) {
      // no direct placement queued (rare) — nudge from ground truth
      toast("You're all set — just keep filling");
      return;
    }
    G.sel = { r: target.cell.r, c: target.cell.c };
    G.hintCell = target.cell;
    renderSelection();
    var el = cellEl(target.cell.r, target.cell.c);
    el.classList.add("hint-target");
    var techName = TECH[target.step.tech] || target.step.tech;
    var line = $("hintline");
    line.hidden = false;
    line.innerHTML = '<b>' + techName + '</b> — this bead must be <b>' + target.cell.v +
      '</b>. Tap ' + target.cell.v + ' to place it.';
    buzz(10);
  }

  // parse the placing cell out of a solver step (logic reason strings are stable)
  function parsePlacement(step) {
    var n = G.n, m;
    if (step.tech === "naked-single") {
      m = /cell (\d+) = (\d+)/.exec(step.reason);
      if (m) { var idx = +m[1]; return { r: (idx / n) | 0, c: idx % n, v: +m[2] }; }
    } else if (step.tech === "hidden-single") {
      var mv = /value (\d+)/.exec(step.reason);
      var mc = /cell (\d+)/.exec(step.reason);
      if (mv && mc) { var id2 = +mc[1]; return { r: (id2 / n) | 0, c: id2 % n, v: +mv[1] }; }
    }
    return null; // elimination-only step, not a placement
  }

  function clearHint() {
    if (G.hintCell) { var el = cellEl(G.hintCell.r, G.hintCell.c); if (el) el.classList.remove("hint-target"); }
    G.hintCell = null;
    $("hintline").hidden = true;
  }

  function flashConflicts() {
    renderConflicts();
  }

  // ---------------------------------------------------------- timer --
  function fmt(ms) {
    var s = Math.floor(ms / 1000), m = Math.floor(s / 60);
    return m + ":" + String(s % 60).padStart(2, "0");
  }
  function curElapsed() { return G.elapsedBase + (G.startMs ? Date.now() - G.startMs : 0); }
  function startTimer() {
    if (G.won) return;
    G.startMs = Date.now();
    if (G.tick) clearInterval(G.tick);
    G.tick = setInterval(function () { $("timer").textContent = fmt(curElapsed()); }, 500);
    $("timer").textContent = fmt(curElapsed());
  }
  function pauseTimer() {
    if (G.startMs) { G.elapsedBase += Date.now() - G.startMs; G.startMs = 0; }
    if (G.tick) { clearInterval(G.tick); G.tick = null; }
  }

  // ---------------------------------------------------------- win --
  function checkWin() {
    var n = G.n;
    for (var r = 0; r < n; r++) for (var c = 0; c < n; c++)
      if (G.grid[r][c] !== G.puzzle.solution[r][c]) return;
    doWin();
  }

  function doWin() {
    if (G.won) return;
    var n = G.n;
    G.won = true;
    pauseTimer();
    var finalMs = curElapsed();
    G.finalMs = finalMs;

    // win-sequence: streams light up one after another
    animateWinBoard();
    sndWin();
    buzz([16, 60, 16, 60, 30]);
    $("winboard").innerHTML = svgBoard(n, G.sid, G.puzzle.solution);

    if (G.daily) {
      winDaily(finalMs);
    } else {
      lsDel("st-save");
      var t = G.puzzle.tier, s = tierStats(t);
      s.won++; s.cur = (s.cur || 0) + 1;
      if (s.cur > (s.best2 || 0)) s.best2 = s.cur; // best streak
      s.sum += finalMs;
      if (!s.best || finalMs < s.best) s.best = finalMs;
      lsSet("st-stats", stats);
      $("winsub").textContent = TIER[t].name + " · solved clean";
      $("win-time").textContent = fmt(finalMs);
      $("win-streak").textContent = s.cur;
      $("win-best").textContent = s.best ? fmt(s.best) : "—";
      setWinLabels("Time", "Streak", "Best");
      casualWinButtons();
    }

    setTimeout(function () { show("win"); sparkBurst(); }, 620);
  }

  function animateWinBoard() {
    if (window.matchMedia("(prefers-reduced-motion:reduce)").matches) return;
    var n = G.n, order = {};
    for (var r = 0; r < n; r++) for (var c = 0; c < n; c++)
      (order[G.sid[r][c]] = order[G.sid[r][c]] || []).push({ r: r, c: c });
    Object.keys(order).forEach(function (s, i) {
      setTimeout(function () {
        order[s].forEach(function (x) {
          var el = cellEl(x.r, x.c);
          if (el) { el.classList.remove("unit-glow"); void el.offsetWidth; el.classList.add("unit-glow"); }
        });
      }, i * 130);
    });
  }

  // ---------------------------------------------------------- share --
  function share() {
    if (!G.puzzle) return;
    var n = G.n, sol = G.puzzle.solution;
    var emoji = ["🟩", "🟦", "🟪", "🟧", "🟨", "🟩", "🟨"];
    var grid = sol.map(function (row, r) {
      return row.map(function (v, c) { return emoji[G.sid[r][c] % emoji.length]; }).join("");
    }).join("\n");
    var head = G.daily
      ? "Strimko Daily · " + G.dailyDate + " · " + fmt(G.finalMs)
      : "Strimko · " + TIER[G.puzzle.tier].name + " · " + fmt(G.finalMs);
    var text = head + "\n" + grid + "\nstrimko";
    function done() { toast("Copied to clipboard"); }
    function fallback() {
      try {
        var ta = document.createElement("textarea"); ta.value = text;
        ta.style.position = "fixed"; ta.style.opacity = "0";
        document.body.appendChild(ta); ta.select(); document.execCommand("copy");
        document.body.removeChild(ta); done();
      } catch (e) { toast("Copy failed"); }
    }
    if (navigator.share) {
      navigator.share({ text: text }).catch(function () {});
    } else if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, fallback);
    } else fallback();
  }

  // ------------------------------------------------------- daily --
  // The daily is always Tapestry (7x7). index = day-number, so everyone gets
  // the SAME board each calendar day. It has its own save + streak, kept
  // entirely separate from casual play/stats.
  var DAILY_TIER = 4;
  function dayNumber(d) {
    d = d || new Date();
    return Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86400000);
  }
  function todayStr(d) {
    d = d || new Date();
    var m = d.getMonth() + 1, day = d.getDate();
    return d.getFullYear() + "-" + (m < 10 ? "0" : "") + m + "-" + (day < 10 ? "0" : "") + day;
  }
  function dailyStreak() { return lsGet("st-daily-streak", { current: 0, best: 0, lastDay: null }); }
  function setWinLabels(a, b, c) {
    $("win-time-k").textContent = a; $("win-streak-k").textContent = b; $("win-best-k").textContent = c;
  }

  function startDaily() {
    var day = dayNumber(), date = todayStr();
    var sv = lsGet("st-daily", null);
    var puzzle = L.generatePuzzle(DAILY_TIER, day);
    puzzle.tier = DAILY_TIER; puzzle.index = day;
    G.daily = true; G.dailyDate = date; G.dailyDay = day;
    if (sv && sv.day === day && sv.solved) { reviewDaily(sv, puzzle); return; }
    if (sv && sv.day === day) { loadPuzzle(puzzle, sv, sv.elapsed || 0); }
    else { lsDel("st-daily"); loadPuzzle(puzzle, null, 0); }
  }

  // Show a already-solved daily on the win screen without re-counting the streak.
  function reviewDaily(sv, puzzle) {
    G.puzzle = puzzle; G.n = puzzle.n; G.sid = puzzle.streamId;
    G.won = true; G.finalMs = sv.solvedMs; G.daily = true; G.dailyDate = sv.date;
    var st = dailyStreak();
    $("winsub").textContent = "Daily · " + sv.date;
    $("win-time").textContent = fmt(sv.solvedMs);
    $("win-streak").textContent = st.current;
    $("win-best").textContent = st.best ? st.best + "d" : "—";
    setWinLabels("Time", "Day streak", "Best");
    dailyWinButtons();
    $("winboard").innerHTML = svgBoard(puzzle.n, puzzle.streamId, puzzle.solution);
    show("win");
  }

  function winDaily(finalMs) {
    var day = G.dailyDay, date = G.dailyDate, st = dailyStreak();
    if (st.lastDay !== day) {                       // count each day only once
      st.current = (st.lastDay === day - 1) ? (st.current + 1) : 1;
      st.lastDay = day;
      if (st.current > (st.best || 0)) st.best = st.current;
      lsSet("st-daily-streak", st);
    }
    lsSet("st-daily", {
      day: day, date: date, index: G.puzzle.index, solved: true, solvedMs: finalMs,
      grid: G.grid, marks: G.marks, undo: G.undo, elapsed: finalMs
    });
    $("winsub").textContent = "Daily · " + date;
    $("win-time").textContent = fmt(finalMs);
    $("win-streak").textContent = st.current;
    $("win-best").textContent = st.best ? st.best + "d" : "—";
    setWinLabels("Time", "Day streak", "Best");
    dailyWinButtons();
  }

  function casualWinButtons() { $("btn-next").innerHTML = "Next puzzle &rarr;"; $("btn-replay").hidden = false; }
  function dailyWinButtons() { $("btn-next").textContent = "Back to home"; $("btn-replay").hidden = false; }

  function renderDailyCard() {
    var day = dayNumber();
    $("daily-date").textContent = todayStr();
    var sv = lsGet("st-daily", null), st = dailyStreak();
    var card = $("btn-daily"), stateEl = $("daily-state");
    card.classList.remove("solved");
    if (sv && sv.day === day && sv.solved) {
      card.classList.add("solved");
      stateEl.innerHTML = "✓ Solved · " + fmt(sv.solvedMs) +
        (st.current ? " · streak " + st.current + "d" : "");
    } else if (sv && sv.day === day && (sv.elapsed || (sv.grid && sv.undo && sv.undo.length))) {
      stateEl.innerHTML = "Resume · " + fmt(sv.elapsed || 0) + " ▸";
    } else {
      stateEl.innerHTML = "Play today’s puzzle ▸";
    }
  }

  // ---------------------------------------------------- new / restore --
  function newPuzzle(tier, index) {
    G.daily = false;
    var idx = index;
    if (idx == null) {
      idx = (nextIdx[tier] || 0);
      nextIdx[tier] = idx + 1;
      lsSet("st-next", nextIdx);
    }
    var puzzle = L.generatePuzzle(tier, idx);
    puzzle.tier = tier; puzzle.index = idx;
    var s = tierStats(tier); s.played = (s.played || 0) + 1; // games started
    lsSet("st-stats", stats);
    lsSet("st-lasttier", tier);
    loadPuzzle(puzzle, null, 0);
  }

  function loadPuzzle(puzzle, savedState, elapsed) {
    G.puzzle = puzzle; G.n = puzzle.n; G.won = false; G.finalMs = 0;
    G.sid = puzzle.streamId;
    G.grid = []; G.given = []; G.marks = []; G.undo = [];
    for (var r = 0; r < G.n; r++) {
      G.grid.push(new Array(G.n).fill(0));
      G.given.push(new Array(G.n).fill(false));
      G.marks.push([]); for (var c = 0; c < G.n; c++) G.marks[r].push([]);
    }
    puzzle.givens.forEach(function (g) { G.grid[g.r][g.c] = g.v; G.given[g.r][g.c] = true; });

    if (savedState) {
      G.grid = savedState.grid;
      if (savedState.marks) G.marks = savedState.marks;
      G.undo = savedState.undo || [];
    }
    G.sel = null; G.pencil = false; G.hintCell = null;
    G.elapsedBase = elapsed || 0; G.startMs = 0;

    $("difflabel").textContent = TIER[puzzle.tier].name;
    $("btn-undo").disabled = G.undo.length === 0;
    $("btn-pencil").classList.remove("on");
    clearHint();
    buildBoard();
    renderBoard();
    show("game");
    startTimer();
    saveGame();
  }

  // ---------------------------------------------------- persistence --
  function saveGame() {
    if (!G.puzzle || G.won) return;
    var payload = {
      tier: G.puzzle.tier, index: G.puzzle.index,
      grid: G.grid, marks: G.marks, undo: G.undo,
      elapsed: curElapsed(), savedAt: Date.now()
    };
    if (G.daily) {
      payload.day = G.dailyDay; payload.date = G.dailyDate; payload.solved = false;
      lsSet("st-daily", payload);
    } else {
      lsSet("st-save", payload);
    }
  }
  function continueGame() {
    var sv = lsGet("st-save", null);
    if (!sv) return;
    G.daily = false;
    var puzzle = L.generatePuzzle(sv.tier, sv.index);
    puzzle.tier = sv.tier; puzzle.index = sv.index;
    loadPuzzle(puzzle, sv, sv.elapsed || 0);
  }

  // ---------------------------------------------------------- screens --
  function show(name) {
    G.screen = name;
    ["home", "game", "win"].forEach(function (s) {
      $("screen-" + s).classList.toggle("active", s === name);
    });
    if (name === "home") renderHome();
  }

  function renderHome() {
    var sv = lsGet("st-save", null);
    var cont = $("btn-continue");
    if (sv) {
      cont.hidden = false;
      $("cont-info").textContent = TIER[sv.tier].name + " · " + fmt(sv.elapsed || 0);
    } else cont.hidden = true;

    renderDailyCard();

    // footer stats
    var played = 0, bestStreak = 0, bestLabel = "";
    var bestMs = 0;
    Object.keys(stats).forEach(function (t) {
      var s = stats[t];
      played += s.won || 0;
      if ((s.best2 || 0) > bestStreak) bestStreak = s.best2 || 0;
      if (s.best && (!bestMs || s.best < bestMs)) { bestMs = s.best; bestLabel = TIER[t].name; }
    });
    var foot = "solved " + played;
    if (bestStreak) foot += " · streak " + bestStreak;
    if (bestMs) foot += " · best " + bestLabel + " " + fmt(bestMs);
    $("home-foot").textContent = foot;
  }

  // -------------------------------------------------------- settings --
  function renderSettings() {
    $("tog-sound").textContent = "Sound: " + (settings.sound ? "On" : "Off");
    $("tog-sound").classList.toggle("off", !settings.sound);
    $("tog-haptics").textContent = "Haptics: " + (settings.haptics ? "On" : "Off");
    $("tog-haptics").classList.toggle("off", !settings.haptics);
    $("tog-conflict").textContent = "Conflict highlight: " + (settings.conflict ? "On" : "Off");
    $("tog-conflict").classList.toggle("off", !settings.conflict);
  }

  function toast(msg, ms) {
    var el = $("toast"); el.textContent = msg; el.classList.add("show");
    if (toast._t) clearTimeout(toast._t);
    toast._t = setTimeout(function () { el.classList.remove("show"); }, ms || 1500);
  }

  // ------------------------------------------------------------- init --
  function brandmarkSVG() {
    return '<svg width="64" height="64" viewBox="0 0 72 72" xmlns="http://www.w3.org/2000/svg">' +
      '<defs><filter id="mg" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="1.6" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>' +
      '<g filter="url(#mg)"><path d="M18 20 Q40 6 54 26 Q40 52 20 50" fill="none" stroke="#6C8CFF" stroke-width="4" stroke-linecap="round"/>' +
      '<circle cx="18" cy="20" r="8" fill="#12172A" stroke="#3FE0C5" stroke-width="3"/>' +
      '<circle cx="52" cy="26" r="8" fill="#12172A" stroke="#F06AA6" stroke-width="3"/>' +
      '<circle cx="22" cy="50" r="8" fill="#12172A" stroke="#FFB24A" stroke-width="3"/></g></svg>';
  }

  function init() {
    $("brandmark").innerHTML = brandmarkSVG();
    renderSettings();
    show("home");

    document.querySelectorAll(".diff").forEach(function (btn) {
      btn.addEventListener("click", function () { newPuzzle(+btn.dataset.tier); });
    });
    $("btn-play").addEventListener("click", function () {
      // Play = jump straight into the last difficulty played (Strand by default).
      newPuzzle(lsGet("st-lasttier", 1));
    });
    $("btn-continue").addEventListener("click", continueGame);
    $("btn-daily").addEventListener("click", startDaily);

    $("btn-back").addEventListener("click", function () { pauseTimer(); saveGame(); show("home"); });
    $("btn-new").addEventListener("click", function () {
      if (G.puzzle) { lsDel("st-save"); newPuzzle(G.puzzle.tier); }
    });

    $("pad").addEventListener("click", function (e) {
      var b = e.target.closest("button"); if (!b) return; place(+b.dataset.v);
    });
    $("btn-undo").addEventListener("click", undo);
    $("btn-hint").addEventListener("click", hint);
    $("btn-erase").addEventListener("click", erase);
    $("btn-pencil").addEventListener("click", function () {
      G.pencil = !G.pencil;
      $("btn-pencil").classList.toggle("on", G.pencil);
      buzz(6);
    });

    // win screen
    $("btn-share").addEventListener("click", share);
    $("btn-replay").addEventListener("click", function () {
      var t = G.puzzle.tier, i = G.puzzle.index;
      var p = L.generatePuzzle(t, i); p.tier = t; p.index = i;
      loadPuzzle(p, null, 0);
    });
    $("btn-next").addEventListener("click", function () {
      if (G.daily) { show("home"); } else { newPuzzle(G.puzzle.tier); }
    });

    // settings modal
    $("btn-settings").addEventListener("click", function () { $("settings").hidden = false; });
    $("settings-close").addEventListener("click", function () { $("settings").hidden = true; });
    $("settings").addEventListener("click", function (e) { if (e.target === $("settings")) $("settings").hidden = true; });
    $("tog-sound").addEventListener("click", function () {
      settings.sound = !settings.sound; lsSet("st-settings", settings); renderSettings();
      if (settings.sound) sndPlace();
    });
    $("tog-haptics").addEventListener("click", function () {
      settings.haptics = !settings.haptics; lsSet("st-settings", settings); renderSettings();
      if (settings.haptics) buzz(12);
    });
    $("tog-conflict").addEventListener("click", function () {
      settings.conflict = !settings.conflict; lsSet("st-settings", settings); renderSettings();
      if (G.puzzle && G.screen === "game") renderConflicts();
    });

    // how-to (first launch only)
    $("howto-close").addEventListener("click", function () {
      $("howto").hidden = true; lsSet("st-seen", 1);
    });
    if (!lsGet("st-seen", 0)) {
      var sample = [[0, 0, 1, 1], [0, 2, 2, 1], [0, 2, 3, 3], [2, 3, 3, 1]];
      // sample uses 4 streams for the diagram; solution values just illustrative
      var sampleSid = [[0, 0, 1, 1], [0, 2, 1, 1], [0, 2, 2, 3], [2, 2, 3, 3]];
      var sampleVals = [[1, 2, 3, 4], [3, 4, 1, 2], [4, 1, 2, 3], [2, 3, 4, 1]];
      $("howboard").innerHTML = svgBoard(4, sampleSid, sampleVals);
      $("howto").hidden = false;
    }

    // lifecycle save
    document.addEventListener("visibilitychange", function () {
      if (document.hidden) { if (G.screen === "game" && !G.won) { pauseTimer(); saveGame(); } }
      else { if (G.screen === "game" && !G.won) startTimer(); }
    });
    window.addEventListener("pagehide", function () {
      if (G.screen === "game" && !G.won) { pauseTimer(); saveGame(); }
    });
  }

  // service worker
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", function () {
      navigator.serviceWorker.register("sw.js").catch(function () {});
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
