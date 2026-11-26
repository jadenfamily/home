/* ============================================================================
   AI 사무실 — office/js/qr.js
   2차 인증 등록용 QR 코드 만들기
   · office.html 이 css/style.css → js/state.js … js/boot.js 순서로 불러요.
     모듈끼리 같은 전역 스코프를 써요(함수 이름은 사무실 전체에서 하나).
   · 원래 office.html 한 덩어리 스크립트를 기능별로 나눈 파일이라 동작은 같아요.
   ============================================================================ */
'use strict';

/* ===== QR 코드 (chat.html에서 승계) ===== */
var QR = (function () {
'use strict';

/* [버전][레벨] = [EC 코드워드/블록, [그룹1 블록수, 그룹1 데이터, 그룹2 블록수, 그룹2 데이터]] */
var B = {
    1: { M: [10, [1, 16, 0, 0]], L: [7, [1, 19, 0, 0]] },
    2: { M: [16, [1, 28, 0, 0]], L: [10, [1, 34, 0, 0]] },
    3: { M: [26, [1, 44, 0, 0]], L: [15, [1, 55, 0, 0]] },
    4: { M: [18, [2, 32, 0, 0]], L: [20, [1, 80, 0, 0]] },
    5: { M: [24, [2, 43, 0, 0]], L: [26, [1, 108, 0, 0]] },
    6: { M: [16, [4, 27, 0, 0]], L: [18, [2, 68, 0, 0]] },
    7: { M: [18, [4, 31, 0, 0]], L: [20, [2, 78, 0, 0]] },
    8: { M: [22, [2, 38, 2, 39]], L: [24, [2, 97, 0, 0]] },
    9: { M: [22, [3, 36, 2, 37]], L: [30, [2, 116, 0, 0]] },
    10: { M: [26, [4, 43, 1, 44]], L: [18, [2, 68, 2, 69]] }
};
var ALIGN = [[], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50]];

function dataCodewords(ver, lv) {
    var t = B[ver][lv];
    return t[1][0] * t[1][1] + t[1][2] * t[1][3];
}

/* ---------- GF(256) · Reed-Solomon ---------- */
function gfMul(a, b) {
    var r = 0;
    for (var i = 7; i >= 0; i--) {
      r = ((r << 1) ^ ((r >>> 7) * 0x11d)) & 0xff;
      r ^= ((b >>> i) & 1) * a;
    }
    return r & 0xff;
}
function rsGen(deg) {
    var g = [1];
    for (var i = 0; i < deg; i++) {
      var ng = new Array(g.length + 1);
      for (var j = 0; j < ng.length; j++) ng[j] = 0;
      for (j = 0; j < g.length; j++) {
        ng[j] ^= g[j];
        ng[j + 1] ^= gfMul(g[j], gfExp(i));
      }
      g = ng;
    }
    return g;
}
var EXP = null;
function gfExp(n) {
    if (!EXP) {
      EXP = new Array(512);
      var x = 1;
      for (var i = 0; i < 255; i++) { EXP[i] = x; x = x << 1; if (x & 0x100) x ^= 0x11d; }
      for (i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
    }
    return EXP[n % 255];
}
function rsEcc(data, deg) {
    var gen = rsGen(deg);
    var res = new Array(deg);
    for (var i = 0; i < deg; i++) res[i] = 0;
    for (i = 0; i < data.length; i++) {
      var factor = data[i] ^ res[0];
      res.shift();
      res.push(0);
      for (var j = 0; j < deg; j++) res[j] ^= gfMul(gen[j + 1], factor);
    }
    return res;
}

/* ---------- 비트 버퍼 ---------- */
function Bits() { this.arr = []; this.len = 0; }
Bits.prototype.put = function (val, n) {
    for (var i = n - 1; i >= 0; i--) {
      var bit = (val >>> i) & 1;
      if (this.len % 8 === 0) this.arr.push(0);
      if (bit) this.arr[this.arr.length - 1] |= (1 << (7 - (this.len % 8)));
      this.len++;
    }
};

function utf8(s) {
    if (window.TextEncoder) return new Uint8Array(new TextEncoder().encode(s));
    var out = [], i, c;
    for (i = 0; i < s.length; i++) {
      c = s.charCodeAt(i);
      if (c < 0x80) out.push(c);
      else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
      else out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    }
    return new Uint8Array(out);
}

function pickVersion(byteLen) {
    var levels = ['M', 'L'];
    for (var li = 0; li < levels.length; li++) {
      var lv = levels[li];
      for (var v = 1; v <= 10; v++) {
        var cap = dataCodewords(v, lv) - 2 - (v >= 10 ? 1 : 0);
        if (byteLen <= cap) return { ver: v, lv: lv };
      }
    }
    return null;
}

/* ---------- 매트릭스 ---------- */
function makeMatrix(ver, lv, bytes) {
    var size = ver * 4 + 17;
    var m = [], fn = [], r, c, i, j;
    for (r = 0; r < size; r++) {
      m.push(new Array(size).fill(false));
      fn.push(new Array(size).fill(false));
    }
    function set(r2, c2, dark) { m[r2][c2] = !!dark; fn[r2][c2] = true; }

    /* 파인더 + 분리 여백 */
    function finder(r0, c0) {
      for (var dr = -1; dr <= 7; dr++) {
        for (var dc = -1; dc <= 7; dc++) {
          var rr = r0 + dr, cc = c0 + dc;
          if (rr < 0 || cc < 0 || rr >= size || cc >= size) continue;
          var on = (dr >= 0 && dr <= 6 && (dc === 0 || dc === 6)) ||
            (dc >= 0 && dc <= 6 && (dr === 0 || dr === 6)) ||
            (dr >= 2 && dr <= 4 && dc >= 2 && dc <= 4);
          set(rr, cc, on);
        }
      }
    }
    finder(0, 0); finder(0, size - 7); finder(size - 7, 0);

    /* 타이밍 */
    for (i = 8; i < size - 8; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); }

    /* 정렬 패턴 */
    var al = ALIGN[ver - 1] || [];
    for (i = 0; i < al.length; i++) {
      for (j = 0; j < al.length; j++) {
        var ar = al[i], ac = al[j];
        if ((ar <= 8 && ac <= 8) || (ar <= 8 && ac >= size - 9) || (ar >= size - 9 && ac <= 8)) continue;
        for (var dr2 = -2; dr2 <= 2; dr2++) {
          for (var dc2 = -2; dc2 <= 2; dc2++) {
            var on2 = Math.max(Math.abs(dr2), Math.abs(dc2)) !== 1;
            set(ar + dr2, ac + dc2, on2);
          }
        }
      }
    }

    /* 포맷 정보 자리 미리 잡기 (2군데) */
    for (i = 0; i < 9; i++) { if (!fn[8][i]) set(8, i, false); if (!fn[i][8]) set(i, 8, false); }
    for (i = 0; i < 8; i++) {
      if (!fn[8][size - 1 - i]) set(8, size - 1 - i, false);
      if (!fn[size - 1 - i][8]) set(size - 1 - i, 8, false);
    }
    set(size - 8, 8, true); /* 검은 모듈 */

    /* 버전 정보 (7 이상) */
    if (ver >= 7) {
      var vbits = verInfo(ver);
      for (i = 0; i < 18; i++) {
        var bit = ((vbits >>> i) & 1) === 1;
        var a1 = Math.floor(i / 3), b1 = i % 3;
        set(a1, size - 11 + b1, bit);
        set(size - 11 + b1, a1, bit);
      }
    }

    /* 데이터 비트 넣기 */
    var codes = buildBits(ver, lv, bytes);
    var bits = [];
    for (var bi = 0; bi < codes.length; bi++) {
      for (var bj = 7; bj >= 0; bj--) bits.push((codes[bi] >>> bj) & 1);
    }
    var idx = 0, up = true;
    for (c = size - 1; c > 0; c -= 2) {
      if (c === 6) c = 5;
      for (var k = 0; k < size; k++) {
        r = up ? size - 1 - k : k;
        for (var d = 0; d < 2; d++) {
          var cc2 = c - d;
          if (fn[r][cc2]) continue;
          var v = idx < bits.length ? bits[idx] !== 0 : false;
          idx++;
          m[r][cc2] = v;
        }
      }
      up = !up;
    }

    /* 마스크 고르기 */
    var best = null, bestScore = 1e9;
    for (var mask = 0; mask < 8; mask++) {
      var trial = applyMask(m, fn, size, mask);
      putFormat(trial, size, lv, mask);
      var sc = penalty(trial, size);
      if (sc < bestScore) { bestScore = sc; best = { m: trial, mask: mask }; }
    }
    return { size: size, modules: best.m, mask: best.mask, ver: ver, lv: lv };
}

function buildBits(ver, lv, bytes) {
    var cap = dataCodewords(ver, lv);
    var bits = new Bits();
    bits.put(4, 4); /* byte 모드 */
    bits.put(bytes.length, ver >= 10 ? 16 : 8);
    for (var i = 0; i < bytes.length; i++) bits.put(bytes[i], 8);
    var maxBits = cap * 8;
    var term = Math.min(4, maxBits - bits.len);
    if (term > 0) bits.put(0, term);
    while (bits.len % 8 !== 0) bits.put(0, 1);
    var data = bits.arr.slice();
    var pad = [0xec, 0x11], p = 0;
    while (data.length < cap) { data.push(pad[p % 2]); p++; }

    /* 블록 나누고 ECC 붙여 끼워 넣기 */
    var t = B[ver][lv], eccLen = t[0], spec = t[1];
    var blocks = [], off = 0, g, n;
    for (g = 0; g < spec[0]; g++) { blocks.push(data.slice(off, off + spec[1])); off += spec[1]; }
    for (g = 0; g < spec[2]; g++) { blocks.push(data.slice(off, off + spec[3])); off += spec[3]; }
    var eccs = [];
    for (g = 0; g < blocks.length; g++) eccs.push(rsEcc(blocks[g], eccLen));
    var out = [], maxData = 0;
    for (g = 0; g < blocks.length; g++) maxData = Math.max(maxData, blocks[g].length);
    for (var i2 = 0; i2 < maxData; i2++) {
      for (g = 0; g < blocks.length; g++) if (i2 < blocks[g].length) out.push(blocks[g][i2]);
    }
    for (i2 = 0; i2 < eccLen; i2++) {
      for (g = 0; g < eccs.length; g++) out.push(eccs[g][i2]);
    }
    return out;
}

function maskFn(mask, i, j) {
    if (mask === 0) return (i + j) % 2 === 0;
    if (mask === 1) return i % 2 === 0;
    if (mask === 2) return j % 3 === 0;
    if (mask === 3) return (i + j) % 3 === 0;
    if (mask === 4) return (Math.floor(i / 2) + Math.floor(j / 3)) % 2 === 0;
    if (mask === 5) return ((i * j) % 2) + ((i * j) % 3) === 0;
    if (mask === 6) return (((i * j) % 2) + ((i * j) % 3)) % 2 === 0;
    return (((i + j) % 2) + ((i * j) % 3)) % 2 === 0;
}

function applyMask(m, fn, size, mask) {
    var out = [];
    for (var r = 0; r < size; r++) {
      var row = [];
      for (var c = 0; c < size; c++) {
        row.push(!fn[r][c] && maskFn(mask, r, c) ? !m[r][c] : m[r][c]);
      }
      out.push(row);
    }
    return out;
}

function bch15(v) {
    var d = v << 10;
    while (bitLen(d) >= 11) d ^= 0x537 << (bitLen(d) - 11);
    return ((v << 10) | d) ^ 0x5412;
}
function bitLen(x) { var n = 0; while (x) { n++; x >>>= 1; } return n; }

function verInfo(ver) {
    var d = ver << 12;
    while (bitLen(d) >= 13) d ^= 0x1f25 << (bitLen(d) - 13);
    return (ver << 12) | d;
}

function putFormat(m, size, lv, mask) {
    var ec = lv === 'L' ? 1 : lv === 'M' ? 0 : lv === 'Q' ? 3 : 2;
    var bits = bch15((ec << 3) | mask);
    function bit(n) { return ((bits >>> n) & 1) === 1; }
    /* 첫 번째 사본 (위쪽 왼쪽) */
    for (var i = 0; i <= 5; i++) m[i][8] = bit(i);
    m[7][8] = bit(6); m[8][8] = bit(7); m[8][7] = bit(8);
    for (i = 9; i <= 14; i++) m[8][14 - i] = bit(i);
    /* 두 번째 사본 (아래·오른쪽) */
    for (i = 0; i <= 7; i++) m[8][size - 1 - i] = bit(i);
    for (i = 8; i <= 14; i++) m[size - 15 + i][8] = bit(i);
    m[size - 8][8] = true;
}

function penalty(m, size) {
    var score = 0, r, c, i;
    /* 1) 같은 색 5개 이상 */
    for (r = 0; r < size; r++) {
      var run = 1;
      for (c = 1; c < size; c++) {
        if (m[r][c] === m[r][c - 1]) run++;
        else { if (run >= 5) score += 3 + (run - 5); run = 1; }
      }
      if (run >= 5) score += 3 + (run - 5);
    }
    for (c = 0; c < size; c++) {
      run = 1;
      for (r = 1; r < size; r++) {
        if (m[r][c] === m[r - 1][c]) run++;
        else { if (run >= 5) score += 3 + (run - 5); run = 1; }
      }
      if (run >= 5) score += 3 + (run - 5);
    }
    /* 2) 2x2 같은 색 */
    for (r = 0; r < size - 1; r++) {
      for (c = 0; c < size - 1; c++) {
        var v = m[r][c];
        if (v === m[r][c + 1] && v === m[r + 1][c] && v === m[r + 1][c + 1]) score += 3;
      }
    }
    /* 3) 1:1:3:1:1 모양 */
    var p1 = [true, false, true, true, true, false, true, false, false, false, false];
    var p2 = [false, false, false, false, true, false, true, true, true, false, true];
    function hit(get, n) {
      for (var s = 0; s + 11 <= n; s++) {
        var ok1 = true, ok2 = true;
        for (i = 0; i < 11; i++) {
          if (get(s + i) !== p1[i]) ok1 = false;
          if (get(s + i) !== p2[i]) ok2 = false;
        }
        if (ok1) score += 40;
        if (ok2) score += 40;
      }
    }
    for (r = 0; r < size; r++) hit((function (rr) { return function (k) { return m[rr][k]; }; })(r), size);
    for (c = 0; c < size; c++) hit((function (cc) { return function (k) { return m[k][cc]; }; })(c), size);
    /* 4) 검은 모듈 비율 */
    var dark = 0;
    for (r = 0; r < size; r++) for (c = 0; c < size; c++) if (m[r][c]) dark++;
    var pct = Math.round(dark * 100 / (size * size));
    score += 10 * Math.floor(Math.abs(pct - 50) / 5);
    return score;
}

/* ---------- 바깥에서 쓰는 함수 ---------- */
function create(text) {
    var bytes = utf8(String(text == null ? '' : text));
    var pick = pickVersion(bytes.length);
    if (!pick) throw new Error('내용이 너무 길어 QR로 만들 수 없어요');
    return makeMatrix(pick.ver, pick.lv, Array.prototype.slice.call(bytes));
}

function svg(text, px, quiet) {
    var q = create(text);
    var quietN = quiet == null ? 4 : quiet;
    var n = q.size + quietN * 2;
    var unit = px ? px / n : 0;
    var rects = '';
    for (var r = 0; r < q.size; r++) {
      for (var c = 0; c < q.size; c++) {
        if (!q.modules[r][c]) continue;
        rects += '<rect x="' + (c + quietN) + '" y="' + (r + quietN) + '" width="1" height="1"/>';
      }
    }
    var w = px || n;
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + n + ' ' + n + '" width="' + w + '" height="' + w +
      '" shape-rendering="crispEdges" role="img" aria-label="2차 인증 등록 QR"><rect width="' + n + '" height="' + n + '" fill="#fff"/>' +
      '<g fill="#141018">' + rects + '</g></svg>';
}

return { create: create, svg: svg, pickVersion: pickVersion };
})();

/* ============ 2차 인증: 구글 인증 앱 · 아이폰 암호 (TOTP 6자리 · RFC 6238) ============ */
