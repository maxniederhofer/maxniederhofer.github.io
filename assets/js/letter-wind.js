/*! letter-wind.js
 *  A background of small monospace characters, each slowly cycling through a short sequence,
 *  lit by gusts of a procedural wind that drifts across the page. Moving the pointer warms the
 *  letters it passes. A click sends a ripple out from the pointer: it pushes the wind, tints the
 *  letters blue and makes them cycle faster.
 *
 *  Canvas 2D, no dependencies, about 27 KB unminified. Written from scratch as a drop-in for a personal site.
 *
 *    <div class="hero" style="position:relative">
 *      <div id="texture" style="position:absolute;inset:0;color:#8c9094;pointer-events:none"></div>
 *      ...your content...
 *    </div>
 *    <script src="letter-wind.js"></script>
 *    <script>const wind = LetterWind.attach(document.getElementById('texture'));</script>
 *
 *  attach(element, options) returns { destroy(), setLook(name), tap(x, y), info }.
 *  The element should be absolutely positioned inside the area you want covered. Pointer events
 *  are read from its parent (or `options.surface`), so the canvas never blocks your links.
 *  `info.fieldMs` and `info.drawMs` report what a frame costs, if you want to tune it.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.LetterWind = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var TAU = Math.PI * 2;

  var DEFAULTS = {
    cell: 6.5,              // column width in CSS px; a row is twice that
    fontPx: 9,              // glyph size in CSS px
    fontFamily: 'ui-monospace, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace',
    looks: {                // the sequences a cell steps through; one is picked per visit
      mixed:    'ab0cDef1ghI2jkLm3noP4qrS5tuV6wxY7z8',
      lettered: 'abcdeRfghijkAlmnopEqrstuSvwxyzKaeiou',
      figured:  '0a1b2c3d4e5f6g7h8i9j0k1m2n3p4q5r6s7t8u9v'
    },
    look: null,             // a key of `looks`; null picks one at random, avoiding the previous visit's
    seed: null,             // integer; null draws a fresh wind every visit
    flick: 1.2,             // character changes per second per cell (each cell runs at 0.6 to 1.4 of this)
    opacity: 0.78,          // alpha of a fully lit character
    threshold: 0.42,        // how strong the wind must blow before letters light up; lower = busier
    ink: null,              // CSS colour of the letters; null reads the element's `color`
    glow: { dark: 'rgb(38, 170, 255)', light: 'rgb(0, 72, 255)' },   // ripple colour per theme
    theme: null,            // 'dark' | 'light'; null reads the element's color-scheme, then the OS
    calm: { x: 0.5, y: 0.45, rx: 250, ry: 80, floor: 0.3 },           // a quiet ellipse behind your content, or an array of them;
                                                                      // { element, padX, padY, floor } follows an element's box instead
    fps: 25,                // frame rate while the wind blows (the wind itself updates at half that)
    rippleFps: 40,          // frame rate while a ripple or a wake is alive
    idleAfter: 180,         // seconds without input before the wind settles and the loop stops
    revealSeconds: 4,       // fade-in
    ripples: true,
    warmth: true,
    surface: null           // the element that receives pointer events; default: the element's parent
  };

  /* ---------- small maths ---------- */

  function mix32(h) {
    h = Math.imul(h ^ (h >>> 16), 0x7feb352d);
    h = Math.imul(h ^ (h >>> 15), 0x846ca68b);
    return (h ^ (h >>> 16)) >>> 0;
  }
  function hash2(x, y, seed) {
    return mix32((Math.imul(x | 0, 0x9E3779B1) ^ Math.imul((y | 0) + 0x632BE5AB, 0x85EBCA77) ^ seed) >>> 0);
  }
  function unit(h) { return h / 4294967296; }
  function rng(seed) {
    var s = seed >>> 0;
    return function () { s = (s + 0x9E3779B9) >>> 0; return unit(mix32(s)); };
  }
  function smooth(e0, e1, x) {
    var t = (x - e0) / (e1 - e0);
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    return t * t * (3 - 2 * t);
  }
  function lerp(a, b, t) { return a + (b - a) * t; }

  // 2D gradient noise, about -1..1 and zero-mean: it crosses zero between lattice points, so no soft blobs.
  var GX = [1, -1, 0, 0, 0.7071, -0.7071, 0.7071, -0.7071];
  var GY = [0, 0, 1, -1, 0.7071, 0.7071, -0.7071, -0.7071];
  function gnoise(x, y, seed) {
    var x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
    var u = fx * fx * fx * (fx * (fx * 6 - 15) + 10), v = fy * fy * fy * (fy * (fy * 6 - 15) + 10);
    var h = hash2(x0, y0, seed) & 7, a = GX[h] * fx + GY[h] * fy;
    h = hash2(x0 + 1, y0, seed) & 7; var b = GX[h] * (fx - 1) + GY[h] * fy;
    h = hash2(x0, y0 + 1, seed) & 7; var c = GX[h] * fx + GY[h] * (fy - 1);
    h = hash2(x0 + 1, y0 + 1, seed) & 7; var d = GX[h] * (fx - 1) + GY[h] * (fy - 1);
    var ab = a + (b - a) * u, cd = c + (d - c) * u;
    return 1.6 * (ab + (cd - ab) * v);
  }

  /* ---------- the wind of one visit ---------- */

  function makeWind(seed) {
    var r = rng(seed ^ 0x77);
    function span(lo, hi) { return lo + (hi - lo) * r(); }
    var a = 0.3 + 0.43 * r();                       // 17 to 42 degrees off the horizontal, downwards
    var heading = r() < 0.5 ? a : Math.PI - a;      // blowing right or left
    return {
      heading: heading, hx: Math.cos(heading), hy: Math.sin(heading),
      speed: span(42, 64),                          // CSS px per second
      gustLength: span(380, 560), gustWidth: span(120, 190)
    };
  }

  function pickLook(o, seed, win) {
    if (o.look && o.looks[o.look]) return o.look;
    var keys = Object.keys(o.looks), last = null;
    try { last = win.localStorage.getItem('letter-wind-look'); } catch (e) {}
    var pool = keys.filter(function (k) { return k !== last; });
    if (!pool.length) pool = keys;
    var key = pool[Math.floor(unit(mix32(seed ^ 0x1007)) * pool.length)];
    try { win.localStorage.setItem('letter-wind-look', key); } catch (e) {}
    return key;
  }

  var INTERACTIVE = 'a,button,input,textarea,select,label,summary,[contenteditable]:not([contenteditable="false"]),' +
    '[tabindex]:not([tabindex="-1"]),[role="button"],[role="link"],[role="tab"],[role="menuitem"],[role="checkbox"],[role="switch"]';
  var TINTS = 6;   // glyph atlases from plain ink (0) to full glow colour (5)

  /* ---------- attach ---------- */

  function attach(el, options) {
    options = options || {};
    var o = {}; for (var k in DEFAULTS) o[k] = options[k] !== undefined ? options[k] : DEFAULTS[k];
    o.calm = (Array.isArray(options.calm) ? options.calm : [options.calm || DEFAULTS.calm])
      .map(function (c) { return Object.assign({}, DEFAULTS.calm, c); });
    if (typeof o.glow !== 'string') o.glow = Object.assign({}, DEFAULTS.glow, options.glow);

    var doc = el.ownerDocument, win = doc.defaultView;
    var surface = o.surface || el.parentElement || el;
    var canvas = doc.createElement('canvas');
    canvas.setAttribute('aria-hidden', 'true');
    canvas.style.cssText = 'position:absolute;left:0;top:0;display:block;pointer-events:none;';
    el.appendChild(canvas);
    var ctx = canvas.getContext('2d', { alpha: true });
    if (!ctx) return { destroy: function () { canvas.remove(); }, setLook: function () {}, tap: function () {}, info: {} };

    var seed = (o.seed == null
      ? (win.crypto && win.crypto.getRandomValues ? win.crypto.getRandomValues(new Uint32Array(1))[0] : Math.random() * 4294967296)
      : o.seed) >>> 0;
    var look = pickLook(o, seed, win);
    var seq = Array.from(o.looks[look]);
    var wind = makeWind(seed);
    var info = { look: look, seed: seed, heading: wind.heading, speed: wind.speed, fieldMs: 0, drawMs: 0 };
    var reduce = win.matchMedia('(prefers-reduced-motion: reduce)');
    var darkQuery = win.matchMedia('(prefers-color-scheme: dark)');

    // grid, in device pixels
    var cssW = 0, cssH = 0, dpr = 1, cols = 0, rows = 0, cw = 0, ch = 0, left = 0, top = 0, W = 0, H = 0, span = 1;
    var fcols = 0, frows = 0, fS, fT, fA, fR, fieldFresh = false;   // field samples: one per two columns, one per row
    var cellBase, cellPace;
    var atlases = null, inkRGB = [128, 128, 128], glowRGB = [0, 128, 255], inkAlpha = 1, colorKey = '';

    // time
    var started = win.performance.now(), tWind = 0, lastFrame = 0, lastInput = 0, resumedAt = -10, frameNo = 0;
    var running = false, settled = false, destroyed = false, timer = 0, raf = 0, fallback = 0, ready = false;
    function clock() { return (win.performance.now() - started) / 1000; }

    // the hand
    var taps = [], wakes = [], lastMove = null, lastWake = null, speedEst = 0;

    /* --- colours and the glyph atlases --- */

    function rgbOf(color) {
      var g = doc.createElement('canvas').getContext('2d', { willReadFrequently: true });
      if (!g) return [128, 128, 128, 1];
      g.fillStyle = color; g.fillRect(0, 0, 1, 1);
      var d = g.getImageData(0, 0, 1, 1).data;
      return [d[0], d[1], d[2], d[3] / 255];
    }
    function readColors() {
      var cs = win.getComputedStyle(el), scheme = o.theme;
      if (!scheme) {
        var c = cs.colorScheme || '';
        scheme = c.indexOf('dark') >= 0 ? 'dark' : c.indexOf('light') >= 0 ? 'light' : darkQuery.matches ? 'dark' : 'light';
      }
      var ink = o.ink || cs.color, glow = typeof o.glow === 'string' ? o.glow : o.glow[scheme];
      var key = ink + '|' + glow;
      if (key === colorKey) return false;
      colorKey = key;
      var a = rgbOf(ink), b = rgbOf(glow);
      inkRGB = a; glowRGB = b; inkAlpha = a[3];
      return true;
    }

    function buildAtlas(rgb) {
      var weight = dpr >= 1.5 ? 300 : 400, px = Math.round(o.fontPx * dpr);
      var a = doc.createElement('canvas');
      a.width = cw * seq.length; a.height = ch;
      var g = a.getContext('2d');
      g.font = weight + ' ' + px + 'px ' + o.fontFamily;
      g.fillStyle = 'rgb(' + rgb[0] + ',' + rgb[1] + ',' + rgb[2] + ')';
      g.textBaseline = 'alphabetic'; g.textAlign = 'left';
      var m = g.measureText('Mg|');
      var asc = m.fontBoundingBoxAscent || m.actualBoundingBoxAscent || px * 0.8;
      var desc = m.fontBoundingBoxDescent || m.actualBoundingBoxDescent || px * 0.2;
      var baseline = Math.round((ch - (asc + desc)) / 2 + asc);
      var dx = Math.floor((cw - g.measureText('0').width) / 2);
      for (var i = 0; i < seq.length; i++) {
        g.save(); g.beginPath(); g.rect(i * cw, 0, cw, ch); g.clip();
        g.fillText(seq[i], i * cw + dx, baseline);
        g.restore();
      }
      return a;
    }
    function buildAtlases() {
      atlases = [];
      for (var q = 0; q < TINTS; q++) {
        var t = q / (TINTS - 1);
        atlases.push(buildAtlas([
          Math.round(lerp(inkRGB[0], glowRGB[0], t)),
          Math.round(lerp(inkRGB[1], glowRGB[1], t)),
          Math.round(lerp(inkRGB[2], glowRGB[2], t))]));
      }
    }

    /* --- layout --- */

    function layout(w, h) {
      cssW = w; cssH = h; dpr = win.devicePixelRatio || 1;
      cw = Math.max(5, Math.round(o.cell * dpr)); ch = cw * 2;
      cols = Math.floor(w * dpr / cw); rows = Math.floor(h * dpr / ch);
      var over = cols * cw * rows * ch / 21e6;      // cap the work on huge screens
      if (over > 1) { cols = Math.floor(cols / Math.sqrt(over)); rows = Math.floor(rows / Math.sqrt(over)); }
      if (cols < 24 || rows < 8) { cols = rows = 0; canvas.style.visibility = 'hidden'; return false; }
      canvas.style.visibility = '';
      W = cols * cw; H = rows * ch;
      left = Math.round((w * dpr - W) / 2); top = Math.round((h * dpr - H) / 2);
      canvas.width = W; canvas.height = H;
      canvas.style.left = (left / dpr) + 'px'; canvas.style.top = (top / dpr) + 'px';
      canvas.style.width = (W / dpr) + 'px'; canvas.style.height = (H / dpr) + 'px';
      fcols = (cols >> 1) + 2; frows = rows;
      var n = fcols * frows;
      fS = new Float32Array(n); fT = new Float32Array(n); fA = new Float32Array(n); fR = new Float32Array(n);
      fieldFresh = false;
      cellBase = new Uint16Array(cols * rows); cellPace = new Float32Array(cols * rows);
      for (var r = 0; r < rows; r++) for (var c = 0; c < cols; c++) {
        var h1 = hash2(c, r, seed), i = r * cols + c;
        cellBase[i] = h1 % seq.length;                        // where in the sequence this cell starts
        cellPace[i] = 0.6 + 0.8 * unit(mix32(h1 ^ 0x5bd1e995)); // and how quickly it steps
      }
      span = 0.58 * (Math.abs(wind.hx) * w + Math.abs(wind.hy) * h);   // one long swell per pane
      readColors(); buildAtlases();
      return true;
    }

    /* --- the field --- */

    function gusts(qx, qy, carried, L, Wd) {
      var gust = 0, weight = 1, power = 0, sx = 0.85 * L, sy = 0.75 * Wd;
      for (var k = 0; k < 3; k++) {       // three sizes travelling nearly together, so the shapes keep changing
        gust += weight * gnoise((qx - carried * (1 + 0.1 * k)) / sx, qy / sy + 11 * k, seed ^ (0x60 + k));
        power += weight * weight; weight *= 0.5; sx *= 0.5; sy *= 0.58;
      }
      var strand = 1 - Math.abs(gnoise((qx - 1.15 * carried) / (0.7 * L), qy / (0.95 * Wd) + 2, seed ^ 0x66));
      var swell = Math.cos((qx - carried) * (TAU / span));   // gusts gather on crests: seldom a full or an empty pane
      return gust / Math.sqrt(power) + 0.25 * (strand * strand * strand - 0.35) + 0.3 * swell;
    }

    // Everything about a tap or a wake that depends only on its age is worked out once per frame here.
    function ageOut(now) {
      var i, age;
      for (i = taps.length - 1; i >= 0; i--) if (now - taps[i].at > 3.6) taps.splice(i, 1);
      for (i = wakes.length - 1; i >= 0; i--) if (now - wakes[i].at > 2.4) wakes.splice(i, 1);
      for (i = 0; i < taps.length; i++) {
        var tp = taps[i]; age = now - tp.at;
        tp.R = 620 * (1 - Math.exp(-age / 1.3));            // how far the front has run
        var width = 85 + 60 * age; tp.w2 = 1 / (width * width);
        tp.aSwell = tp.force * Math.exp(-age / 1.5);
        tp.aTint = tp.force * Math.exp(-age);
        tp.aTrail = 0.7 * tp.force * Math.exp(-age / 1.3);
        tp.aAfter = tp.force * (1 - Math.exp(-age / 0.2)) * Math.exp(-age / 1.2);
      }
      var slack = 48 - wakes.length;
      for (i = 0; i < wakes.length; i++) {
        var w = wakes[i]; age = now - w.at;
        w.s = w.force * Math.min(1, (i + 1 + slack) / 8) * (1 - Math.exp(-age / 0.05)) * Math.exp(-age / 0.65);
        var c = 50 + 40 * age;
        w.k = 1 / (c * c); w.reach = w.half + 3 * c;
      }
    }

    function computeField(t, now, reveal) {
      var n = taps.length, m = wakes.length, any = n + m > 0;
      var hx = wind.hx, hy = wind.hy, L = wind.gustLength, Wd = wind.gustWidth;
      var carried = wind.speed * (t + gnoise(t * 0.09, 3.7, seed ^ 0x58));   // it surges and slackens
      var eddy = 1.15 * Wd, calms = o.calm, nc = calms.length;
      for (q = 0; q < nc; q++) {
        var cz = calms[q];
        if (cz.element) {                        // a calm zone that follows an element wherever the layout puts it
          var base = el.getBoundingClientRect(), box = cz.element.getBoundingClientRect();
          cz.cx = box.left + box.width / 2 - base.left; cz.cy = box.top + box.height / 2 - base.top;
          cz.hw = box.width / 2 + (cz.padX == null ? 60 : cz.padX); cz.hh = box.height / 2 + (cz.padY == null ? 40 : cz.padY);
        } else { cz.cx = cz.x * cssW; cz.cy = cz.y * cssH; cz.hw = cz.rx; cz.hh = cz.ry; }
      }
      var level = o.threshold, band = 0.09, lowEdge = level - band - 0.19;
      var k = 0, i, j, q;
      for (j = 0; j < frows; j++) {
        var py = (top + (j + 0.5) * ch) / dpr;
        for (i = 0; i < fcols; i++, k++) {
          var px = (left + 2 * i * cw) / dpr;
          var pushX = 0, pushY = 0, raise = 0, roused = 0, tint = 0, after = 0, warm = 0;
          if (any) {
            // the hand is read a little off true, so a ripple's outline is never a drawn circle
            var nx = px + 24 * gnoise(px / 95, py / 95 + now * 0.12, seed ^ 0x71);
            var ny = py + 24 * gnoise(px / 95 + 9.1, py / 95 + now * 0.12 + 4, seed ^ 0x72);
            for (q = 0; q < n; q++) {
              var tp = taps[q], ax = nx - tp.x, ay = ny - tp.y, d = Math.sqrt(ax * ax + ay * ay) || 1;
              // a click is a blow: a front runs out and slows, a trough and a weaker crest behind it
              var behind = tp.R - d;
              if (behind <= -16) continue;                  // the front has not arrived here yet
              var front = smooth(-16, 10, behind) * Math.exp(-behind * behind * tp.w2);
              var swell = tp.aSwell * front;
              pushX += ax / d * 44 * swell; pushY += ay / d * 44 * swell;
              raise += 1.9 * swell * (0.25 + 0.75 * Math.cos(behind * (TAU / 130)));
              roused += swell;
              tint += tp.aTint * front;
              if (behind > 0) {
                var trail = smooth(0, 70, behind) * Math.exp(-behind / 260);
                tint += tp.aTrail * trail; after += tp.aAfter * trail;
              }
            }
            if (m) {
              var sum = 0;
              for (q = 0; q < m; q++) {
                var wk = wakes[q]; if (wk.s <= 0) continue;
                var bx = nx - wk.x, by = ny - wk.y;
                if (bx > wk.reach || bx < -wk.reach || by > wk.reach || by < -wk.reach) continue;
                var along = bx * wk.ux + by * wk.uy;
                along = along < -wk.half ? -wk.half : along > wk.half ? wk.half : along;
                bx -= wk.ux * along; by -= wk.uy * along;
                sum += wk.s * Math.exp(-(bx * bx + by * by) * wk.k);
              }
              warm = 1 - Math.exp(-1.5 * sum);     // however hard the air is stirred, it only warms so far
              raise += 0.25 * warm; roused += 0.05 * warm;
            }
          }
          // air that has been pushed shows here what was over there
          var fx = px - pushX, fy = py - pushY;
          var qx = fx * hx + fy * hy, qy = -fx * hy + fy * hx;          // into the wind's own frame
          var rdx = (qx - 0.85 * carried) / eddy, rdy = qy / eddy;
          var ex = gnoise(rdx + 31.7, rdy + t * 0.02, seed ^ 0x59), ey = gnoise(rdx, rdy + 13.1 + t * 0.02, seed ^ 0x5a);
          var pull = 0.585 * Wd * (1 + 0.9 * Math.min(roused, 1.5));   // the air curls, more where it is roused
          var cx2 = qx + pull * ex, cy2 = qy + pull * ey;
          var field = gusts(cx2, cy2, carried, L, Wd) + raise;
          var strength = 0;
          if (field > lowEdge) {
            var lit = smooth(lowEdge, level + band, field);
            var broad = lit * lit * lerp(0.45, 1, Math.min(1, Math.max(0, (field - level) / 0.45))) * (0.82 + 0.18 * ey);
            // within a gust, thin quick streaks, as wind draws on water
            var thread = gnoise((cx2 - carried * 1.6) / 140, cy2 / 30 + t * 0.16, seed ^ 0x57);
            var streaks = 1 - smooth(0, 0.5, Math.abs(thread));
            strength = broad * lerp(1, 0.25 + 0.95 * streaks, 0.4);
          }
          if (warm > 0) {
            var grain = 0.55 * ey + 0.45 * ex;     // the warmed air shows in its own fine grain
            strength = 1 - (1 - strength) * (1 - 0.85 * warm * smooth(-0.5, 0.25, grain));
          }
          var calm = 1;                            // thinner behind the content
          for (q = 0; q < nc; q++) {
            var cz = calms[q], dx = (px - cz.cx) / cz.hw, dy = (py - cz.cy) / cz.hh;
            calm *= 1 - (1 - cz.floor) * Math.exp(-0.9 * (dx * dx + dy * dy));
          }
          var shown = Math.max(reveal, Math.min(1, 2 * roused + warm));         // the hand shows at once
          fS[k] = strength * calm * shown; fT[k] = tint; fA[k] = after * calm * shown; fR[k] = roused;
        }
      }
      fieldFresh = true;
    }

    /* --- drawing --- */

    function draw(t) {
      ctx.clearRect(0, 0, W, H);
      var n = seq.length, flick = o.flick, op = o.opacity * inkAlpha, last = TINTS - 1;
      for (var r = 0; r < rows; r++) {
        var row = r * fcols, y = r * ch;
        for (var c = 0; c < cols; c++) {
          var i = row + (c >> 1), w = (c & 1) ? 0.75 : 0.25;
          var s = fS[i] + (fS[i + 1] - fS[i]) * w, af = fA[i] + (fA[i + 1] - fA[i]) * w;
          if (s < 0.012 && af < 0.03) continue;
          var tint = smooth(0.04, 0.3, fT[i] + (fT[i + 1] - fT[i]) * w);
          var light = s > 1 ? 1 : s;
          var plain = light * op * (1 - tint);              // alpha carried by the ink colour
          var glow = light * op * 3 * tint + 0.3 * af * op; // alpha carried by the glow colour: it comes in whole and bright
          var a = plain + glow;
          if (a < 0.01) continue;
          if (a > 1) a = 1;
          var roused = fR[i] + (fR[i + 1] - fR[i]) * w, idx = r * cols + c;
          // each cell steps through the set at its own pace; a roused cell runs on ahead
          var steps = Math.floor(t * flick * cellPace[idx]) + Math.floor(6 * roused) + cellBase[idx];
          var g = steps % n;
          ctx.globalAlpha = a;
          ctx.drawImage(atlases[Math.round(glow / (plain + glow) * last)], g * cw, 0, cw, ch, c * cw, y, cw, ch);
        }
      }
      ctx.globalAlpha = 1;
    }

    /* --- the loop --- */

    function frame() {
      raf = 0; win.clearTimeout(fallback); fallback = 0;
      if (destroyed || !cols) return;
      var now = clock(), dt = Math.min(0.25, now - lastFrame);
      lastFrame = now; frameNo += 1;
      var energy = (1 - smooth(o.idleAfter, o.idleAfter + 8, now - lastInput)) * smooth(0, 3, now - resumedAt);
      tWind += dt * energy;
      ageOut(now);
      var busy = taps.length > 0 || wakes.length > 0;
      var t0 = win.performance.now();
      if (busy || !fieldFresh || (frameNo & 1) === 0) {    // the wind itself moves slowly: half rate when the hand is away
        computeField(tWind, now, smooth(0, o.revealSeconds, now));
        var t1 = win.performance.now(); info.fieldMs += (t1 - t0 - info.fieldMs) * 0.1; t0 = t1;
      }
      draw(tWind);
      info.drawMs += (win.performance.now() - t0 - info.drawMs) * 0.1;
      if (energy <= 0 && !busy) { settled = true; return; }      // still until the next touch
      schedule(busy ? 1000 / o.rippleFps : 1000 / o.fps);
    }
    function schedule(ms) {
      if (!running || doc.hidden || destroyed) return;
      win.clearTimeout(timer);
      timer = win.setTimeout(function () {
        timer = 0;
        raf = win.requestAnimationFrame(frame);
        // A frame callback that never comes (a throttled or occluded window) must not stall the loop for good.
        win.clearTimeout(fallback);
        fallback = win.setTimeout(function () { fallback = 0; if (raf) { win.cancelAnimationFrame(raf); frame(); } }, 250);
      }, ms);
    }
    function stop() {
      win.clearTimeout(timer); timer = 0;
      win.clearTimeout(fallback); fallback = 0;
      if (raf) win.cancelAnimationFrame(raf); raf = 0;
    }
    function still() {                                            // one frame, fully revealed, for reduced motion
      if (!cols) return;
      taps.length = 0; wakes.length = 0;
      computeField(tWind, clock(), 1); draw(tWind);
    }
    function start() {
      if (!ready || !cols || destroyed) return;
      if (reduce.matches) { running = false; stop(); still(); return; }
      if (!running) { running = true; lastFrame = clock(); schedule(0); }
    }
    function touch() {
      var now = clock();
      if (settled || now - lastInput > o.idleAfter) resumedAt = now;
      lastInput = now;
      if (settled) { settled = false; lastFrame = now; schedule(0); }
      else if (running && !timer && !raf) schedule(0);
    }

    /* --- pointer --- */

    function pointAt(e) {
      var rc = el.getBoundingClientRect();
      return [e.clientX - rc.left, e.clientY - rc.top];
    }
    function onMove(e) {
      if (!o.warmth || !running || e.pointerType !== 'mouse') return;
      var p = pointAt(e), now = clock();
      if (!lastMove || now - lastMove.at > 0.25) {
        lastMove = lastWake = { x: p[0], y: p[1], at: now }; speedEst = 0; touch(); return;
      }
      var dt = Math.max(now - lastMove.at, 1 / 240), dist = Math.hypot(p[0] - lastMove.x, p[1] - lastMove.y);
      speedEst += (dist / dt - speedEst) * Math.min(1, dt / 0.08);
      lastMove = { x: p[0], y: p[1], at: now };
      var l = Math.hypot(p[0] - lastWake.x, p[1] - lastWake.y);
      if (l < 18 || now - lastWake.at < 0.035) return;
      var force = smooth(60, 800, speedEst), prev = lastWake;   // a slow hand barely warms the air
      lastWake = lastMove;
      touch();
      if (force < 0.04) return;
      var ux = (p[0] - prev.x) / l, uy = (p[1] - prev.y) / l;
      wakes.push({ x: (p[0] + prev.x) / 2, y: (p[1] + prev.y) / 2, at: now, force: force * l / (l + 90),
        ux: ux, uy: uy, half: l / 2, s: 0, k: 0, reach: 0 });
      if (wakes.length > 48) wakes.shift();
    }
    function tapAt(x, y) {
      taps.push({ x: x, y: y, at: clock(), force: 1, R: 0, w2: 0, aSwell: 0, aTint: 0, aTrail: 0, aAfter: 0 });
      if (taps.length > 6) taps.shift();
      touch();
    }
    function onDown(e) {
      if (!o.ripples || !running || e.button !== 0) return;
      var t = e.target, hit = t && t.closest ? t.closest(INTERACTIVE) : null;
      if (hit && hit !== surface && surface.contains(hit)) return;    // leave clicks on links and buttons alone
      var p = pointAt(e);
      tapAt(p[0], p[1]);
    }
    function onLeave() { lastMove = null; }

    /* --- observers --- */

    function applyLayout(w, h) {
      if (destroyed || w <= 0 || h <= 0) return;
      if (cols > 0 && w === cssW && h === cssH && dpr === (win.devicePixelRatio || 1)) return;   // nothing changed
      var hadGrid = cols > 0;
      if (layout(w, h)) { if (!hadGrid || !running) start(); else if (settled || reduce.matches) still(); }
      else stop();
    }
    function measured() { var r = el.getBoundingClientRect(); return [r.width, r.height]; }
    var resizeTimer = 0, pending = null;
    var ro = new win.ResizeObserver(function (entries) {
      var box = entries[0] && entries[0].contentRect; if (!box) return;
      pending = [box.width, box.height];
      win.clearTimeout(resizeTimer);
      resizeTimer = win.setTimeout(function () { applyLayout(pending[0], pending[1]); }, cols > 0 ? 150 : 0);
    });
    ro.observe(el);

    function recolor() {
      if (!cols || !readColors()) return;
      buildAtlases();
      if (!running || settled) still();
    }
    var mo = new win.MutationObserver(recolor);
    mo.observe(doc.documentElement, { attributes: true, attributeFilter: ['data-theme', 'class', 'style', 'data-mode'] });
    darkQuery.addEventListener('change', recolor);
    reduce.addEventListener('change', function () { running = false; stop(); start(); });
    function onVisible() {
      if (doc.hidden) { stop(); return; }
      if (running && !settled && !timer && !raf) { lastFrame = clock(); schedule(0); }
    }
    doc.addEventListener('visibilitychange', onVisible);
    win.addEventListener('pageshow', onVisible);
    win.addEventListener('focus', onVisible);
    // A page that loaded while hidden may never get a visibilitychange event, and a resize notification can be
    // withheld too; once a second this measures the element itself and notices either.
    var watchdog = win.setInterval(function () { var m = measured(); applyLayout(m[0], m[1]); onVisible(); }, 1000);

    surface.addEventListener('pointermove', onMove, { passive: true });
    surface.addEventListener('pointerdown', onDown, { passive: true });
    surface.addEventListener('pointerleave', onLeave, { passive: true });

    // The system monospace stack needs no loading, so the texture starts at once. If `fontFamily` names a web
    // font, the glyphs are drawn again when it arrives.
    ready = true;
    var first = measured();
    applyLayout(first[0], first[1]);             // lay out now rather than waiting for the first resize notification
    var fontsReady = doc.fonts && doc.fonts.ready ? doc.fonts.ready : Promise.resolve();
    fontsReady.then(function () {
      if (destroyed || !cols) return;
      buildAtlases();
      if (!running || settled) still();
    });

    return {
      info: info,
      tap: function (x, y) { if (running) tapAt(x, y); },
      setLook: function (name) {
        if (!o.looks[name]) return;
        look = name; seq = Array.from(o.looks[name]); info.look = name;
        if (cols) { layout(cssW, cssH); if (!running || settled) still(); }
      },
      destroy: function () {
        destroyed = true; running = false; stop();
        ro.disconnect(); mo.disconnect();
        darkQuery.removeEventListener('change', recolor);
        doc.removeEventListener('visibilitychange', onVisible);
        win.removeEventListener('pageshow', onVisible);
        win.removeEventListener('focus', onVisible);
        win.clearInterval(watchdog);
        surface.removeEventListener('pointermove', onMove);
        surface.removeEventListener('pointerdown', onDown);
        surface.removeEventListener('pointerleave', onLeave);
        canvas.remove();
      }
    };
  }

  return { attach: attach, defaults: DEFAULTS };
});
