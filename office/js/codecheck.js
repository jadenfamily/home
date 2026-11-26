/* ============================================================================
   AI 사무실 — office/js/codecheck.js
   수정안 자동 검사(JSON·JS·CSS) · 줄 비교(diff)
   · office.html 이 css/style.css → js/state.js … js/boot.js 순서로 불러요.
     모듈끼리 같은 전역 스코프를 써요(함수 이름은 사무실 전체에서 하나).
   · 원래 office.html 한 덩어리 스크립트를 기능별로 나눈 파일이라 동작은 같아요.
   ============================================================================ */
'use strict';

/* ===== 자동 검사·줄 비교 (chat.html에서 승계) ===== */
function isModuleSyntaxError(e) {
    var m = String((e && e.message) || '');
    return /cannot use import statement|unexpected token 'export'|unexpected reserved word|import\.meta|await is only valid|outside a module/i.test(m);
}
/* import/export를 빼고 다시 컴파일해요 (모듈 파일도 문법 오류를 잡으려고) */
function stripModuleSyntax(code) {
    return String(code == null ? '' : code)
      .replace(/^\s*import\s+[^;\n]*?from\s*['"][^'"]+['"]\s*;?/gm, '')
      .replace(/^\s*import\s*['"][^'"]+['"]\s*;?/gm, '')
      .replace(/^\s*import\s*[\s\S]*?from\s*['"][^'"]+['"]\s*;?/gm, '')
      .replace(/^\s*export\s*\{[^}]*\}\s*(?:from\s*['"][^'"]+['"])?\s*;?/gm, '')
      .replace(/^\s*export\s+(default\s+)?/gm, '');
}
/* 문법 오류가 있으면 그 오류를, 문법이 맞으면 null을 돌려줘요 (컴파일만 하고 실행은 안 해요) */
function jsCompileError(code) {
    var src = String(code == null ? '' : code);
    if (!src.trim()) return null;
    var stripped = stripModuleSyntax(src);
    var attempts = [src, stripped, 'return (async function(){\n' + stripped + '\n});'];
    var first = null;
    for (var i = 0; i < attempts.length; i++) {
      try { new Function(attempts[i]); return null; }
      catch (e) {
        if (!first) first = e;
        if (!isModuleSyntaxError(e)) return e;
      }
    }
    return first;
}

/* HTML은 브라우저 파서(DOMParser)로 읽어요. JS 문자열 안의 “<script>” 글자에 속지 않아요. */
function stepHtml(html) {
    var errs = [], src = String(html == null ? '' : html);
    var doc = null;
    try { doc = new DOMParser().parseFromString(src, 'text/html'); }
    catch (e) { errs.push('HTML을 해석하지 못했어요'); }
    if (!/<html[\s>]/i.test(src)) errs.push('<html> 태그가 없어요');
    if (doc) {
      if (doc.querySelector('parsererror')) errs.push('브라우저가 HTML 구조를 해석하지 못했어요');
      if (!doc.body) errs.push('<body> 태그가 없어요');
      else if (!doc.body.children.length && !String(doc.body.textContent || '').trim()) errs.push('화면에 그릴 내용(<body>)이 비어 있어요');
    }
    /* 파일 끝이 </html>로 닫혀 있는지 (중간에 잘려 저장된 파일 찾기) */
    if (!/<\/html\s*>\s*(?:<!--[\s\S]*?-->\s*)*$/i.test(src.slice(-400))) errs.push('</html> 닫는 태그가 없어요');
    return { ok: !errs.length, errors: errs };
}

/* <script>도 브라우저 파서가 찾아 준 것만 검사해요 (문자열 속 글자는 스크립트가 아니에요) */
function stepScripts(html) {
    var errs = [], src = String(html == null ? '' : html), doc = null;
    try { doc = new DOMParser().parseFromString(src, 'text/html'); }
    catch (e) { return { ok: false, errors: ['HTML을 해석하지 못해 스크립트를 확인하지 못했어요'] }; }
    var list = doc.querySelectorAll('script'), idx = 0;
    for (var i = 0; i < list.length; i++) {
      var el = list[i];
      if (el.getAttribute('src')) continue;                 /* 외부 스크립트는 브라우저가 불러와요 */
      var type = String(el.getAttribute('type') || '').toLowerCase().replace(/;.*$/, '').trim();
      if (type && !/^(text\/javascript|application\/javascript|module|text\/ecmascript)$/.test(type)) continue;
      var code = el.textContent || '';
      if (!code.trim()) continue;
      idx++;
      var err = jsCompileError(code);
      if (err) {
        var line = errLine(code, err);
        errs.push('스크립트 ' + idx + '번째 문법 오류: ' + (err.message || '알 수 없는 오류') + (line ? ' (' + line + '번째 줄 근처)' : ''));
      }
    }
    return { ok: !errs.length, errors: errs };
}
function guessLine(code, e) {
    var m = /line\s+(\d+)/i.exec(String(e && e.message || ''));
    if (m) return m[1];
    var st = String(e && e.stack || '');
    var m2 = /<anonymous>:(\d+):(\d+)/.exec(st);
    return m2 ? m2[1] : '';
}
/* 오류 줄은 코드 범위 안에 있을 때만 알려 줘요 (호출한 쪽 줄 번호를 잘못 집는 것 방지) */
function errLine(code, e) {
    var n = Number(guessLine(code, e)) || 0;
    var max = String(code == null ? '' : code).split('\n').length;
    return (n >= 1 && n <= max) ? n : '';
}

function stepRuntime(html) {
    return new Promise(function (resolve) {
      var token = 'chk' + randomHex(5);
      smokeWaiters[token] = [];
      var got = smokeWaiters[token];
      var iframe = document.createElement('iframe');
      iframe.setAttribute('sandbox', 'allow-scripts');
      iframe.setAttribute('aria-hidden', 'true');
      iframe.setAttribute('tabindex', '-1');
      iframe.style.cssText = 'position:fixed;left:-10000px;top:0;width:390px;height:800px;opacity:0;pointer-events:none;border:0;';
      var prelude = '<script>(function(){var T=' + JSON.stringify(token) + ';function send(o){o.__chk=T;try{parent.postMessage(o,"*")}catch(e){}}' +
        'window.addEventListener("error",function(e){send({k:"err",m:String((e&&e.message)||"스크립트 오류"),where:(e&&e.filename?String(e.filename)+" ":"")+((e&&e.lineno)||"")});},true);' +
        'window.addEventListener("unhandledrejection",function(e){var r=e&&e.reason;send({k:"rej",m:String((r&&(r.message||r))||"처리하지 못한 오류")});});' +
        'window.addEventListener("load",function(){setTimeout(function(){send({k:"done"})},30);});' +
        '})();<\/script>';
      var src = String(html);
      var headEnd = src.search(/<head[^>]*>/i);
      if (headEnd >= 0) {
        var gt = src.indexOf('>', headEnd);
        src = src.slice(0, gt + 1) + prelude + src.slice(gt + 1);
      } else {
        src = prelude + src;
      }
      var done = false;
      function finish() {
        if (done) return;
        done = true;
        window.clearTimeout(timer);
        var errs = [];
        for (var i = 0; i < got.length; i++) {
          if (got[i].k === 'err') errs.push('실행 오류: ' + got[i].m + (got[i].where ? ' (' + got[i].where + ')' : ''));
          else if (got[i].k === 'rej') errs.push('처리하지 못한 오류: ' + got[i].m);
        }
        try { iframe.remove(); } catch (e) { /* 무시 */ }
        delete smokeWaiters[token];
        resolve({ ok: !errs.length, errors: errs });
      }
      var timer = window.setTimeout(finish, 3600);
      iframe.addEventListener('load', function () { window.setTimeout(finish, 900); });
      iframe.srcdoc = src;
      document.body.appendChild(iframe);
      window.setTimeout(function () {
        for (var i = 0; i < got.length; i++) if (got[i].k === 'done') { window.setTimeout(finish, 350); break; }
      }, 600);
    });
}

async function checkHtml(html) {
    var s1 = stepHtml(html);
    var s2 = stepScripts(html);
    var s3 = { ok: true, errors: [], skipped: true };
    if (s1.ok && s2.ok) s3 = await stepRuntime(html);
    var steps = [
      { key: 'html', name: '1단계 · HTML 구조 검사', ok: s1.ok, errors: s1.errors },
      { key: 'js', name: '2단계 · 스크립트 문법 검사', ok: s2.ok, errors: s2.errors },
      { key: 'runtime', name: '3단계 · 숨김 화면 실행 검사', ok: s3.ok, errors: s3.errors, skipped: !!s3.skipped }
    ];
    return { ok: s1.ok && s2.ok && s3.ok, steps: steps };
}

/* ============ 파일 종류별 자동 검사 (.json/.js/.css) ============ */
function checkJsonText(text) {
    var errs = [], src = String(text == null ? '' : text);
    try { JSON.parse(src); }
    catch (e) {
      var m = /position\s+(\d+)/i.exec(String((e && e.message) || ''));
      var where = '';
      if (m) {
        var pos = Math.min(Number(m[1]) || 0, src.length);
        where = ' (' + src.slice(0, pos).split('\n').length + '번째 줄 근처)';
      } else {
        var lm = /line\s+(\d+)/i.exec(String((e && e.message) || ''));
        if (lm) where = ' (' + lm[1] + '번째 줄 근처)';
      }
      errs.push('JSON 문법 오류' + where + ': ' + String((e && e.message) || '').slice(0, 140));
    }
    var step = { key: 'json', name: '1단계 · JSON 문법 검사', ok: !errs.length, errors: errs };
    return { ok: step.ok, steps: [step] };
}
function checkJsText(text) {
    var src = String(text == null ? '' : text), errs = [];
    var err = jsCompileError(src);
    if (err) {
      var line = errLine(src, err);
      errs.push('문법 오류: ' + String((err && err.message) || '알 수 없는 오류').slice(0, 140) + (line ? ' (' + line + '번째 줄 근처)' : ''));
    }
    var step = { key: 'js', name: '1단계 · JavaScript 문법 검사', ok: !errs.length, errors: errs };
    return { ok: step.ok, steps: [step] };
}
function checkCssText(text) {
    var src = String(text == null ? '' : text), errs = [];
    /* 주석·문자열 안의 중괄호는 세지 않아요 */
    var depth = 0, line = 1, inComment = false, quote = '', i = 0;
    while (i < src.length) {
      var ch = src.charAt(i), nx = src.charAt(i + 1);
      if (ch === '\n') line++;
      if (inComment) {
        if (ch === '*' && nx === '/') { inComment = false; i += 2; continue; }
        i++; continue;
      }
      if (quote) {
        if (ch === '\\') { i += 2; continue; }
        if (ch === quote) quote = '';
        i++; continue;
      }
      if (ch === '/' && nx === '*') { inComment = true; i += 2; continue; }
      if (ch === '"' || ch === "'") { quote = ch; i++; continue; }
      if (ch === '{') depth++;
      else if (ch === '}') {
        depth--;
        if (depth < 0) { errs.push(line + '번째 줄: 닫는 }가 여는 {보다 많아요'); depth = 0; }
      }
      i++;
    }
    if (inComment) errs.push('주석(/* … */)이 닫히지 않았어요');
    if (quote) errs.push('따옴표가 닫히지 않았어요');
    if (depth > 0) errs.push('여는 {가 ' + depth + '개 더 많아요 (중괄호가 닫히지 않았어요)');
    var step = { key: 'css', name: '1단계 · CSS 중괄호·주석 검사', ok: !errs.length, errors: errs };
    return { ok: step.ok, steps: [step] };
}
/* 파일 확장자에 맞는 검사를 골라요 (모르는 형식은 검사없이 통과) */
function checkCodeFile(p, content) {
    var path = String(p || '');
    if (/\.html?$/i.test(path)) return checkHtml(content);
    if (/\.json$/i.test(path)) return checkJsonText(content);
    if (/\.[cm]?js$/i.test(path)) return checkJsText(content);
    if (/\.css$/i.test(path)) return checkCssText(content);
    return { steps: [], ok: true, skipped: true };
}

/* ============ 줄 비교(diff) ============ */
/* 17,000줄짜리 화면의 뒷부분만 고쳐도 그 수정이 잡히도록,
     앞·뒤에서 똑같은 줄은 비교에서 빼고 실제로 달라진 가운데만 비교해요.
     가운데가 아주 크면 양쪽에 똑같이 있는 줄(기준 줄)에서 한 번씩 나눠 비교하고,
     나눌 줄이 없을 때만 1,600줄 상한을 둬요.
     (예전에는 무조건 1,600줄에서 잘라 버려서 그 뒤쪽 수정이 +0 · -0으로 보였어요) */
function diffLines(a, b) {
    /* 빈 내용은 ‘빈 줄 1개’가 아니라 0줄로 봐요 (새 파일을 만들 때 −1로 보이지 않게) */
    var A = (a === '' || a == null) ? [] : String(a).split('\n');
    var B = (b === '' || b == null) ? [] : String(b).split('\n');
    var n = A.length, m = B.length;
    var LIMIT = 1600, cut = 0, rows = [], restAdded = 0, restRemoved = 0;
    var CTX = 2;   /* 바뀐 줄 앞뒤로 보여 줄 문맥 줄 수 */

    /* 작은 구간은 LCS로 줄 단위 최소 변경을 찾아요 */
    function lcsRows(a0, a1, b0, b1) {
      var na = a1 - a0, nb = b1 - b0, i, j;
      var dp = [];
      for (i = 0; i <= na; i++) { dp.push(new Array(nb + 1).fill(0)); }
      for (i = na - 1; i >= 0; i--) {
        for (j = nb - 1; j >= 0; j--) {
          dp[i][j] = (A[a0 + i] === B[b0 + j]) ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
        }
      }
      var i2 = 0, j2 = 0;
      while (i2 < na && j2 < nb) {
        if (A[a0 + i2] === B[b0 + j2]) { rows.push({ t: ' ', s: A[a0 + i2] }); i2++; j2++; }
        else if (dp[i2 + 1][j2] >= dp[i2][j2 + 1]) { rows.push({ t: '-', s: A[a0 + i2] }); i2++; }
        else { rows.push({ t: '+', s: B[b0 + j2] }); j2++; }
      }
      while (i2 < na) { rows.push({ t: '-', s: A[a0 + i2] }); i2++; }
      while (j2 < nb) { rows.push({ t: '+', s: B[b0 + j2] }); j2++; }
    }

    /* 두 구간에서 한 번씩만 나오는 같은 줄을 가운데 기준으로 하나 찾아요 (없으면 null) */
    function anchor(a0, a1, b0, b1) {
      var idx = {}, j, key;
      for (j = b0; j < b1; j++) {
        key = '#' + B[j];
        if (idx[key] === undefined) idx[key] = j;
        else if (idx[key] !== -1) idx[key] = -1;   /* 두 번 나오는 줄은 기준으로 쓰지 않아요 */
      }
      var mid = Math.floor((a0 + a1) / 2), half = Math.floor((a1 - a0) / 2);
      for (var d = 0; d <= half; d++) {
        for (var side = 0; side < 2; side++) {
          var i = side ? mid + d : mid - d;
          if (i < a0 || i >= a1) continue;
          j = idx['#' + A[i]];
          if (j === undefined || j < 0) continue;
          return { ai: i, bi: j };
        }
      }
      return null;
    }

    /* A의 a0~a1줄과 B의 b0~b1줄을 비교해 rows에 쌓아요 (depth는 너무 깊이 들어가지 않게 하는 안전장치) */
    function align(a0, a1, b0, b1, depth) {
      while (a0 < a1 && b0 < b1 && A[a0] === B[b0]) { rows.push({ t: ' ', s: A[a0] }); a0++; b0++; }
      if (a0 >= a1 || b0 >= b1) {
        while (a0 < a1) { rows.push({ t: '-', s: A[a0] }); a0++; }
        while (b0 < b1) { rows.push({ t: '+', s: B[b0] }); b0++; }
        return;
      }
      /* 뒤에서 똑같은 줄은 미뤄 두고 가운데부터 비교해요 */
      var ea = a1, eb = b1, t;
      while (ea > a0 && eb > b0 && A[ea - 1] === B[eb - 1]) { ea--; eb--; }
      if (ea - a0 <= LIMIT && eb - b0 <= LIMIT) {
        lcsRows(a0, ea, b0, eb);
      } else {
        var at = depth < 30 ? anchor(a0, ea, b0, eb) : null;
        if (at) {
          align(a0, at.ai, b0, at.bi, depth + 1);
          rows.push({ t: ' ', s: A[at.ai] });
          align(at.ai + 1, ea, at.bi + 1, eb, depth + 1);
        } else {
          /* 나눌 기준 줄이 없을 때만 앞에서부터 1,600줄씩 비교하고, 나머지는 바뀐 줄로 세요 */
          var ca = Math.min(ea, a0 + LIMIT), cb = Math.min(eb, b0 + LIMIT);
          lcsRows(a0, ca, b0, cb);
          cut += (ea - ca) + (eb - cb);
          restRemoved += ea - ca;
          restAdded += eb - cb;
          rows.push({ t: '·', s: '… (' + cut + '줄은 비교하지 않았어요)' });
        }
      }
      for (t = ea; t < a1; t++) rows.push({ t: ' ', s: A[t] });
    }

    align(0, n, 0, m, 0);

    /* 바뀐 줄 수는 화면에 몇 줄을 보여 주든 전체에서 정확히 세요 */
    var added = restAdded, removed = restRemoved;
    for (var q = 0; q < rows.length; q++) {
      if (rows[q].t === '+') added++;
      else if (rows[q].t === '-') removed++;
    }
    /* 바뀐 곳 주변만 남기고, 건너뛴 줄은 “N줄 그대로”로 접어요 */
    var keep = [];
    for (var k = 0; k < rows.length; k++) {
      if (rows[k].t === ' ') continue;
      for (var d2 = Math.max(0, k - CTX); d2 <= Math.min(rows.length - 1, k + CTX); d2++) keep[d2] = 1;
    }
    var out = [], skipped = 0, truncated = false;
    for (k = 0; k < rows.length; k++) {
      if (!keep[k]) { skipped++; continue; }
      if (skipped) { out.push({ t: '·', s: '… ' + skipped + '줄 그대로 …' }); skipped = 0; }
      out.push(rows[k]);
      if (out.length > 260) {
        out.push({ t: '·', s: '… (나머지 생략' + (cut ? ' · ' + cut + '줄은 비교하지 않았어요' : '') + ')' });
        skipped = 0; truncated = true; break;
      }
    }
    if (skipped && !truncated && out.length <= 260) out.push({ t: '·', s: '… ' + skipped + '줄 그대로 …' });
    return { rows: out, added: added, removed: removed };
}
