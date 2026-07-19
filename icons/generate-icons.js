/*
 * Strimko app-icon generator — renders the "three glowing beads on a thread"
 * brandmark (from design-screens.html #mark) to PNG at 180 / 192 / 512 px.
 *
 * Zero dependencies: a tiny hand-rolled PNG encoder (zlib is built into Node)
 * plus a supersampled software rasteriser for the beads + thread. Run with:
 *     node icons/generate-icons.js
 * Produces icons/icon-180.png, icon-192.png, icon-512.png (dark navy field,
 * aqua / pink / amber glowing beads on a violet thread).
 */
"use strict";
var zlib = require("zlib");
var fs = require("fs");
var path = require("path");

// -- palette (Luminous Threads) ------------------------------------------------
var NAVY = [0x12, 0x17, 0x2a];
var NAVY2 = [0x0a, 0x0d, 0x1c];
var BEAD_FILL = [0x1b, 0x22, 0x38];
var VIOLET = [0x6c, 0x8c, 0xff];
var AQUA = [0x3f, 0xe0, 0xc5];
var PINK = [0xf0, 0x6a, 0xa6];
var AMBER = [0xff, 0xb2, 0x4a];

// -- PNG encoder ---------------------------------------------------------------
function crcTable() {
  var t = [];
  for (var n = 0; n < 256; n++) {
    var c = n;
    for (var k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c >>> 0;
  }
  return t;
}
var CRC = crcTable();
function crc32(buf) {
  var c = 0xffffffff;
  for (var i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  var len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  var t = Buffer.from(type, "ascii");
  var crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0);
  return Buffer.concat([len, t, data, crc]);
}
function encodePNG(w, h, rgba) {
  var sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  var ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  var stride = w * 4;
  var raw = Buffer.alloc((stride + 1) * h);
  for (var y = 0; y < h; y++) {
    raw[y * (stride + 1)] = 0; // no filter
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }
  var idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([sig, chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", Buffer.alloc(0))]);
}

// -- supersampled rasteriser ---------------------------------------------------
function render(size) {
  var SS = 4;                 // supersample factor
  var W = size * SS;
  var buf = new Float32Array(W * W * 3);

  function px(x, y, rgb, a) {
    if (x < 0 || y < 0 || x >= W || y >= W || a <= 0) return;
    var i = (y * W + x) * 3, ia = 1 - a;
    buf[i] = buf[i] * ia + rgb[0] * a;
    buf[i + 1] = buf[i + 1] * ia + rgb[1] * a;
    buf[i + 2] = buf[i + 2] * ia + rgb[2] * a;
  }

  // radial navy gradient background
  var cx0 = W / 2, cy0 = W * 0.42, maxd = W * 0.8;
  for (var y = 0; y < W; y++) for (var x = 0; x < W; x++) {
    var d = Math.hypot(x - cx0, y - cy0) / maxd; if (d > 1) d = 1;
    var i = (y * W + x) * 3;
    buf[i] = NAVY[0] * (1 - d) + NAVY2[0] * d;
    buf[i + 1] = NAVY[1] * (1 - d) + NAVY2[1] * d;
    buf[i + 2] = NAVY[2] * (1 - d) + NAVY2[2] * d;
  }

  // map 0..72 design space -> icon, with margin
  var pad = W * 0.15, scale = (W - 2 * pad) / 72;
  function M(x, y) { return [pad + x * scale, pad + y * scale]; }
  function len(x) { return x * scale; }

  // stroke a poly-line with round caps + optional glow
  function stroke(pts, rgb, width, glow) {
    var hw = width / 2;
    // glow pass
    if (glow) {
      for (var g = 3; g >= 1; g--) {
        var gw = hw + len(g * 2.2), ga = 0.06;
        drawPoly(pts, rgb, gw, ga);
      }
    }
    drawPoly(pts, rgb, hw, 1);
  }
  function drawPoly(pts, rgb, hw, alpha) {
    var minx = W, miny = W, maxx = 0, maxy = 0;
    for (var p = 0; p < pts.length; p++) {
      minx = Math.min(minx, pts[p][0] - hw); maxx = Math.max(maxx, pts[p][0] + hw);
      miny = Math.min(miny, pts[p][1] - hw); maxy = Math.max(maxy, pts[p][1] + hw);
    }
    minx = Math.max(0, minx | 0); miny = Math.max(0, miny | 0);
    maxx = Math.min(W - 1, Math.ceil(maxx)); maxy = Math.min(W - 1, Math.ceil(maxy));
    for (var yy = miny; yy <= maxy; yy++) for (var xx = minx; xx <= maxx; xx++) {
      var best = 1e9;
      for (var s = 0; s < pts.length - 1; s++) {
        best = Math.min(best, distSeg(xx + 0.5, yy + 0.5, pts[s], pts[s + 1]));
      }
      var a = Math.max(0, Math.min(1, hw + 0.5 - best)) * alpha;
      px(xx, yy, rgb, a);
    }
  }
  function distSeg(px_, py_, a, b) {
    var vx = b[0] - a[0], vy = b[1] - a[1];
    var wx = px_ - a[0], wy = py_ - a[1];
    var t = (vx * vx + vy * vy) ? (wx * vx + wy * vy) / (vx * vx + vy * vy) : 0;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(px_ - (a[0] + t * vx), py_ - (a[1] + t * vy));
  }

  // filled disc with alpha
  function disc(cx, cy, r, rgb, alpha) {
    var minx = Math.max(0, (cx - r) | 0), maxx = Math.min(W - 1, Math.ceil(cx + r));
    var miny = Math.max(0, (cy - r) | 0), maxy = Math.min(W - 1, Math.ceil(cy + r));
    for (var yy = miny; yy <= maxy; yy++) for (var xx = minx; xx <= maxx; xx++) {
      var d = Math.hypot(xx + 0.5 - cx, yy + 0.5 - cy);
      var a = Math.max(0, Math.min(1, r + 0.5 - d)) * alpha;
      px(xx, yy, rgb, a);
    }
  }
  // bead = glow ring + navy fill + colored stroke ring
  function bead(dx, dy, dr, rgb) {
    var c = M(dx, dy), r = len(dr);
    disc(c[0], c[1], r + len(6), rgb, 0.14);   // outer glow
    disc(c[0], c[1], r + len(3), rgb, 0.20);
    disc(c[0], c[1], r + len(1.6), rgb, 1);     // ring
    disc(c[0], c[1], r - len(1.4), BEAD_FILL, 1); // inner
  }

  // thread: sample the two quadratic beziers from the design mark
  var thread = [];
  function quad(p0, p1, p2, n) {
    for (var i = 0; i <= n; i++) {
      var t = i / n, mt = 1 - t;
      thread.push(M(
        mt * mt * p0[0] + 2 * mt * t * p1[0] + t * t * p2[0],
        mt * mt * p0[1] + 2 * mt * t * p1[1] + t * t * p2[1]
      ));
    }
  }
  quad([18, 20], [40, 6], [54, 26], 24);
  quad([54, 26], [40, 52], [20, 50], 24);
  stroke(thread, VIOLET, len(5.5), true);

  bead(18, 20, 9, AQUA);
  bead(54, 26, 9, PINK);
  bead(20, 50, 9, AMBER);

  // downsample SS -> size (box filter) into RGBA
  var out = Buffer.alloc(size * size * 4);
  for (var oy = 0; oy < size; oy++) for (var ox = 0; ox < size; ox++) {
    var r = 0, gg = 0, bb = 0;
    for (var sy = 0; sy < SS; sy++) for (var sx = 0; sx < SS; sx++) {
      var si = ((oy * SS + sy) * W + (ox * SS + sx)) * 3;
      r += buf[si]; gg += buf[si + 1]; bb += buf[si + 2];
    }
    var n = SS * SS, oi = (oy * size + ox) * 4;
    out[oi] = Math.round(r / n); out[oi + 1] = Math.round(gg / n);
    out[oi + 2] = Math.round(bb / n); out[oi + 3] = 255;
  }
  return encodePNG(size, size, out);
}

[180, 192, 512].forEach(function (s) {
  var png = render(s);
  var file = path.join(__dirname, "icon-" + s + ".png");
  fs.writeFileSync(file, png);
  console.log("wrote", file, png.length, "bytes");
});
