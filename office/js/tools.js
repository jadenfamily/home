/* ============================================================================
   AI 사무실 — office/js/tools.js
   AI가 쓰는 도구 목록 · 가족 데이터 읽기 · 찾아 바꾸기
   · office.html 이 css/style.css → js/state.js … js/boot.js 순서로 불러요.
     모듈끼리 같은 전역 스코프를 써요(함수 이름은 사무실 전체에서 하나).
   · 원래 office.html 한 덩어리 스크립트를 기능별로 나눈 파일이라 동작은 같아요.
   ============================================================================ */
'use strict';

/* ===== 가족 데이터·찾아 바꾸기 (chat.html에서 승계) ===== */
var FAMILY_PREFIX = ['fridge/', 'ledger/', 'data/', 'config/', 'backups/'];

function briefJson(v, max) {
    var s = '';
    try { s = JSON.stringify(v, null, 1); } catch (e) { s = String(v); }
    if (s.length > max) s = s.slice(0, max) + '\n… (길어서 줄였어요. 필요한 부분을 더 물어봐 주세요)';
    return s;
}

async function readFamily(path) {
    var r = await ghGetJson(DEFAULT_REPO, path, null);
    if (!r.ok) return { ok: false, error: r.error || '읽지 못했어요' };
    if (r.missing) return { ok: true, missing: true, data: null };
    return { ok: true, data: r.data, raw: r.raw };
}

/* 큰 파일을 통째로 보내지 않도록 줄/구간 단위로 다뤄요 (토큰 절약) */
/* 글자는 같은데 들여쓰기·공백만 다른 줄을 찾아요 (쓸 때는 파일 안에서 딱 한 곳일 때만) */
function findTrimmedBlock(text, oldS) {
    var want = String(oldS == null ? '' : oldS).replace(/\r\n/g, '\n').split('\n');
    for (var a = 0; a < want.length; a++) want[a] = String(want[a]).trim();
    while (want.length && want[0] === '') want.shift();
    while (want.length && want[want.length - 1] === '') want.pop();
    var lines = String(text == null ? '' : text).split('\n');
    if (!want.length) return { hits: [], want: want, lines: lines };
    var hits = [];
    for (var i = 0; i + want.length <= lines.length; i++) {
      var same = true;
      for (var j = 0; j < want.length; j++) {
        if (String(lines[i + j]).trim() !== want[j]) { same = false; break; }
      }
      if (!same) continue;
      hits.push(i);
      if (hits.length > 8) break;
    }
    return { hits: hits, want: want, lines: lines };
}
/* 못 찾았을 때 “가장 비슷한 줄”의 위치와 앞뒤 2줄을 알려 줘요 */
function closestLineHint(text, oldS) {
    var lines = String(text == null ? '' : text).split('\n');
    var raw = String(oldS == null ? '' : oldS).replace(/\r\n/g, '\n').split('\n');
    var cands = [];
    for (var i = 0; i < raw.length; i++) {
      var t = String(raw[i]).trim();
      if (t.length >= 6 && cands.indexOf(t) < 0) cands.push(t);
    }
    cands.sort(function (a, b) { return b.length - a.length; });
    for (var c = 0; c < cands.length; c++) {
      var needle = cands[c].slice(0, 80), best = null;
      for (var k = 0; k < lines.length; k++) {
        var s = String(lines[k]).trim();
        if (!s) continue;
        var score = 0;
        if (s === needle) score = 1000 + s.length;
        else if (needle.length >= 12 && s.indexOf(needle) >= 0) score = 500 + needle.length;
        else {
          var cp = 0;
          while (cp < needle.length && cp < s.length && needle.charAt(cp) === s.charAt(cp)) cp++;
          if (cp >= 8) score = cp;
        }
        if (score > 0 && (!best || score > best.score)) best = { score: score, line: k + 1, text: String(lines[k]).slice(0, 160) };
      }
      if (best) {
        /* 그 줄만 주면 또 틀리니 앞뒤 2줄을 줄 번호와 함께 돌려줘요 */
        var bag = [];
        for (var q = Math.max(1, best.line - 2); q <= Math.min(lines.length, best.line + 2); q++) {
          bag.push((q === best.line ? '>' : ' ') + String(q).padStart(5) + '| ' + String(lines[q - 1]).slice(0, 160));
        }
        best.ctx = bag.join('\n');
        return best;
      }
    }
    return null;
}
function applyEdits(text, edits) {
    var out = String(text == null ? '' : text), applied = [];
    for (var i = 0; i < edits.length && i < 20; i++) {
      var e = edits[i] || {};
      var oldS = String(e.old_string == null ? (e.find == null ? '' : e.find) : e.old_string);
      var newS = String(e.new_string == null ? (e.replace == null ? '' : e.replace) : e.new_string);
      if (!oldS) return { ok: false, error: (i + 1) + '번째 수정에 old_string이 없어요.' };
      if (oldS === newS) return { ok: false, error: (i + 1) + '번째 수정: old_string과 new_string이 같아 바뀌는 내용이 없어요.' };
      var count = out.split(oldS).length - 1;
      if (count) {
        var idx = out.indexOf(oldS);
        if (e.replace_all) {
          out = out.split(oldS).join(newS);
          applied.push({ index: i + 1, count: count, all: true });
        } else {
          out = out.slice(0, idx) + newS + out.slice(idx + oldS.length);
          applied.push({ index: i + 1, count: 1, total: count });
        }
        continue;
      }
      /* 글자는 같은데 들여쓰기·공백만 다를 때: 딱 한 곳이면 그 자리를 바꿔요 */
      var tm = findTrimmedBlock(out, oldS);
      if (tm.hits.length === 1) {
        var st = 0, b;
        for (b = 0; b < tm.hits[0]; b++) st += String(tm.lines[b]).length + 1;
        var en = st;
        for (b = 0; b < tm.want.length; b++) en += String(tm.lines[tm.hits[0] + b]).length + (b < tm.want.length - 1 ? 1 : 0);
        out = out.slice(0, st) + newS + out.slice(en);
        applied.push({ index: i + 1, count: 1, total: 1, trimmed: true });
        continue;
      }
      var msg = (i + 1) + '번째 수정: old_string을 파일에서 찾지 못했어요.';
      if (tm.hits.length > 1) {
        msg += '\n공백만 다른 줄이 ' + tm.hits.length + '곳(더 있을 수 있어요)에 있어 어디를 바꿀지 고를 수 없어요. 앞뒤 줄을 한두 줄 더 넣어 한 곳만 남겨 주세요.';
      }
      var hint = closestLineHint(out, oldS);
      if (hint) msg += '\n가장 비슷한 줄: ' + hint.line + '번째 줄 「' + hint.text.trim() + '」 — 이 들여쓰기·글자를 그대로 old_string에 쓰면 돼요.';
      if (hint && hint.ctx) msg += '\n그 줄 앞뒤 2줄(> 표시가 그 줄):\n' + hint.ctx;
      msg += '\n(찾던 글: ' + oldS.slice(0, 80).replace(/\n/g, '\\n') + ')';
      return { ok: false, error: msg };
    }
    return { ok: true, text: out, applied: applied };
}

/* ===== 도구 목록 (chat.html에서 승계) ===== */
var TOOLS = [
    {
      name: 'family_data',
      emoji: '🏠',
      title: '가족 데이터 읽기',
      desc: '냉장고 재고·레시피·가계부·아이 루틴 같은 가족 데이터를 읽어요.',
      argsHint: '{"kind":"fridge|recipes|ledger|kids|summary|files|read","path":"(선택) 파일 경로"}',
      run: async function (a) {
        var kind = String(a.kind || 'summary');
        if (kind === 'read') {
          var p = String(a.path || '');
          if (!p) return { text: '읽을 파일 경로가 필요해요.', label: '가족 데이터' };
          var okPre = false;
          for (var i = 0; i < FAMILY_PREFIX.length; i++) if (p.indexOf(FAMILY_PREFIX[i]) === 0) okPre = true;
          if (!okPre) return { text: '가족 데이터 폴더(fridge/·ledger/·data/·config/) 안의 파일만 읽을 수 있어요.', label: '가족 데이터' };
          var one = await readFamily(p);
          if (!one.ok) return { text: one.error, label: '가족 데이터' };
          if (one.missing) return { text: p + ' 파일은 아직 없어요.', label: '가족 데이터' };
          return { text: briefJson(one.data, 6000), label: p, quiet: true, info: { kind: 'read', path: p } };
        }
        if (kind === 'files') {
          var dir = String(a.path || '');
          var r = await ghGetAt(DEFAULT_REPO, dir.replace(/\/+$/, ''), null);
          if (!r.ok) return { text: r.error, label: '파일 목록' };
          if (!r.list) return { text: '폴더가 아니에요: ' + dir, label: '파일 목록' };
          var names = r.list.map(function (x) { return (x.type === 'dir' ? '📁 ' : '📄 ') + x.name; });
          return { text: dir + ' 안에는 이렇게 있어요:\n' + names.join('\n'), label: '파일 목록', quiet: true };
        }
        var paths = [];
        if (kind === 'fridge') paths = ['fridge/inventory.json', 'fridge/meals.json', 'fridge/settings.json'];
        else if (kind === 'recipes') paths = ['fridge/recipes.json'];
        else if (kind === 'ledger') paths = ['ledger/transactions.json', 'ledger/settings.json'];
        else if (kind === 'kids') paths = ['config/settings.json', 'config/stickers.json'];
        else paths = ['fridge/inventory.json', 'fridge/meals.json', 'ledger/transactions.json', 'ledger/settings.json', 'config/settings.json'];
        var out = [];
        for (var k = 0; k < paths.length; k++) {
          var got = await readFamily(paths[k]);
          if (!got.ok) out.push(paths[k] + ': ' + got.error);
          else if (got.missing) out.push(paths[k] + ': 아직 없어요');
          else out.push(paths[k] + ':\n' + briefJson(got.data, kind === 'summary' ? 2400 : 5000));
        }
        return { text: out.join('\n\n'), label: '가족 데이터 · ' + kind, quiet: true };
      }
    },
    {
      name: 'family_save',
      emoji: '💾',
      title: '가족 데이터 저장 (확인 후)',
      desc: '가족 데이터 파일을 저장해요. 반드시 도현님이 [저장]을 눌러야 실제로 저장돼요.',
      argsHint: '{"path":"fridge/inventory.json","data":{...},"reason":"왜 바꾸는지"}',
      run: async function (a, ctx) {
        var p = String(a.path || '');
        var okPre = false;
        for (var i = 0; i < FAMILY_PREFIX.length; i++) if (p.indexOf(FAMILY_PREFIX[i]) === 0) okPre = true;
        if (!okPre) return { text: '이 폴더(fridge/·ledger/·data/·config/) 안의 파일만 저장할 수 있어요.', label: '저장' };
        if (a.data == null) return { text: '저장할 내용(data)이 없어요.', label: '저장' };
        var id = uid('w_');
        S.pending[id] = { id: id, path: p, data: a.data, reason: String(a.reason || ''), thread: ctx.threadId, at: nowIso() };
        return {
          text: '저장할 내용을 준비했어요. 아래 카드에서 [저장]을 누르면 실제로 반영돼요.',
          label: '저장 준비 · ' + p,
          card: { kind: 'write', id: id, path: p, reason: String(a.reason || ''), preview: briefJson(a.data, 1600) }
        };
      }
    },
    {
      name: 'code_list',
      emoji: '📁',
      title: '코드 파일 목록',
      desc: '홈·아이·냉파·가계부 저장소의 파일 목록을 봐요.',
      argsHint: '{"repo":"home|kids-dashboard|fridge-dashboard|ledger-dashboard","path":""}',
      run: async function (a) {
        var repo = normRepo(a.repo);
        if (CODE_REPOS.indexOf(repo) < 0) return { text: '이 네 화면만 볼 수 있어요: ' + CODE_REPOS.join(', '), label: '코드' };
        if (!S.ai.codeToken) return { text: '코드 열쇠가 없어요. 설정에서 넣어 주세요.', label: '코드' };
        var dir = normPath(repo, a.path);
        var r = await ghGetAt(repo, dir, S.ai.codeToken);
        if (!r.ok) return { text: r.error, label: '코드 · ' + repo };
        if (!r.list) return { text: '폴더가 아니에요.', label: '코드 · ' + repo };
        var lines = r.list.map(function (x) { return (x.type === 'dir' ? '📁 ' : '📄 ') + x.name + ' (' + (x.size || 0) + 'B)'; });
        return { text: repo + '/' + dir + '\n' + lines.join('\n'), label: '코드 · ' + repo, quiet: true, info: { kind: 'list', path: dir } };
      }
    },
    {
      name: 'search_code',
      emoji: '🔎',
      title: '코드에서 찾기',
      desc: '파일 안에서 단어나 정규식을 찾아 “줄 번호 + 앞뒤 2줄”을 돌려줘요(최대 8군데). 결과 첫 줄에 repo/path가 나오니 엉뚱한 파일을 뒤졌는지 바로 보여요. path는 꼭 적으세요(home의 사무실 화면은 office.html). 들여쓰기까지 그대로 보이니 그걸 보고 code_edit의 old_string을 쓰면 돼요. 먼저 이걸로 위치를 찾으세요.',
      argsHint: '{"repo":"kids-dashboard","path":"index.html","query":"function renderRoutine","regex":false,"max":30}',
      run: async function (a) {
        var repo = normRepo(a.repo);
        if (CODE_REPOS.indexOf(repo) < 0) return { text: '이 네 화면만 볼 수 있어요: ' + CODE_REPOS.join(', '), label: '코드' };
        if (!S.ai.codeToken) return { text: '코드 열쇠가 없어요. 설정에서 넣어 주세요.', label: '코드' };
        var noPath = (a.path == null || String(a.path).trim() === '');
        var p = normPath(repo, a.path || 'index.html');
        var tag = repo + '/' + p;
        var q = String(a.query || '').trim();
        if (!q) return { text: '찾을 단어(query)가 필요해요.', label: '코드 검색' };
        var r = await ghGetAt(repo, p, S.ai.codeToken);
        if (!r.ok) return { text: r.error, label: '코드 검색 · ' + tag };
        if (r.missing) return { text: tag + ' 파일이 없어요. code_list로 파일 이름을 확인해 주세요.', label: '코드 검색 · ' + tag };
        var lines = String(r.raw || '').split('\n');
        var re = null;
        if (a.regex) {
          try { re = new RegExp(q, 'i'); } catch (e) { return { text: '정규식이 올바르지 않아요: ' + (e && e.message), label: '코드 검색 · ' + tag }; }
        }
        var needle = q.toLowerCase();
        var hits = [];
        var max = clamp(Number(a.max) || 30, 1, 60);
        for (var i = 0; i < lines.length; i++) {
          var hit = re ? re.test(lines[i]) : (lines[i].toLowerCase().indexOf(needle) >= 0);
          if (!hit) continue;
          hits.push(i + 1);
          if (hits.length >= max * 4) break;
        }
        var noPathNote = noPath ? '\n(path를 비워서 기본 파일인 ' + tag + '만 뒤졌어요. 다른 파일도 찾으려면 path를 꼭 적어 주세요. 예: {"repo":"' +
          repo + '","path":"chat.html"})' : '';
        if (!hits.length) return {
          text: '“' + q + '”를 찾지 못했어요 — ' + tag + ' (파일 ' + lines.length + '줄). 다른 단어나 다른 파일(path)로 다시 찾아 보세요.' + noPathNote,
          label: '코드 검색 · ' + tag
        };
        /* 맞은 줄 앞뒤 2줄까지 함께 보여 줘요 (들여쓰기를 그대로 보게) · 최대 8군데, 본문은 7KB까지 */
        var use = hits.slice(0, Math.min(hits.length, Math.min(max, 8)));
        var hitSet = {}, ctxSet = {}, k, d, n;
        for (k = 0; k < use.length; k++) {
          hitSet[use[k]] = 1;
          for (d = -2; d <= 2; d++) {
            n = use[k] + d;
            if (n >= 1 && n <= lines.length) ctxSet[n] = 1;
          }
        }
        var out = [], prev = 0, budgetCh = 7000;
        for (n = 1; n <= lines.length; n++) {
          if (!ctxSet[n]) continue;
          if (prev && n > prev + 1) out.push('   …');
          var raw = String(lines[n - 1] == null ? '' : lines[n - 1]);
          if (raw.length > 170) raw = raw.slice(0, 170) + '…';
          out.push(hitSet[n] ? (n + ': ' + raw) : (('     ' + n).slice(-5) + '| ' + raw));
          prev = n;
          budgetCh -= raw.length + 8;
          if (budgetCh <= 0) { out.push('… (토큰을 아끼려고 여기까지만 보여 줘요)'); break; }
        }
        return {
          text: tag + ' · “' + q + '” ' + hits.length + '군데 (파일 ' + lines.length + '줄). “줄번호:”가 맞은 줄이고, 그 앞뒤 2줄을 함께 보여 줘요.\n' + out.join('\n') +
            (hits.length > max ? '\n… 더 있어요 (max를 올리거나 단어를 좁혀 주세요)' : '') + noPathNote,
          label: '코드 검색 · ' + tag,
          quiet: true,
          info: { kind: 'search', path: p, query: q, hits: hits.length }
        };
      }
    },
    {
      name: 'read_code_slice',
      emoji: '📖',
      title: '코드 일부만 읽기',
      desc: '파일에서 원하는 줄 구간만 읽어요. 기본 120줄, 한 번에 200줄까지 읽을 수 있어요. 큰 파일은 통째로 보내지 마세요.',
      argsHint: '{"repo":"kids-dashboard","path":"index.html","start":1200,"lines":120}',
      run: async function (a) {
        var repo = normRepo(a.repo);
        if (CODE_REPOS.indexOf(repo) < 0) return { text: '이 네 화면만 볼 수 있어요: ' + CODE_REPOS.join(', '), label: '코드' };
        if (!S.ai.codeToken) return { text: '코드 열쇠가 없어요. 설정에서 넣어 주세요.', label: '코드' };
        var p = normPath(repo, a.path);
        if (!p) return { text: '파일 경로가 필요해요.', label: '코드' };
        var r = await ghGetAt(repo, p, S.ai.codeToken);
        if (!r.ok) return { text: r.error, label: '코드' };
        if (r.missing) return { text: repo + '/' + p + ' 파일이 없어요. code_list로 파일 이름을 확인해 주세요.', label: '코드 · ' + repo + '/' + p };
        var lines = String(r.raw || '').split('\n');
        var start = clamp(Number(a.start) || 1, 1, Math.max(1, lines.length));
        var count = clamp(Number(a.lines) || 120, 1, 200);
        var end = Math.min(lines.length, start + count - 1);
        var out = [];
        for (var i = start; i <= end; i++) out.push(('      ' + i).slice(-6) + '| ' + lines[i - 1]);
        return {
          text: repo + '/' + p + ' · ' + start + '~' + end + '줄 (전체 ' + lines.length + '줄)\n' + out.join('\n'),
          label: '코드 읽기 · ' + p + ' ' + start + '~' + end,
          quiet: true,
          info: { kind: 'read', path: p, start: start, end: end, total: lines.length }
        };
      }
    },
    {
      name: 'code_read',
      emoji: '🔍',
      title: '코드 읽기 (작은 파일용)',
      desc: '작은 파일 전체를 읽어요. 200줄이 넘으면 앞부분만 돌려주니 search_code·read_code_slice를 쓰세요.',
      argsHint: '{"repo":"home","path":"index.html"}',
      run: async function (a) {
        var repo = normRepo(a.repo);
        if (CODE_REPOS.indexOf(repo) < 0) return { text: '이 네 화면만 볼 수 있어요: ' + CODE_REPOS.join(', '), label: '코드' };
        if (!S.ai.codeToken) return { text: '코드 열쇠가 없어요. 설정에서 넣어 주세요.', label: '코드' };
        var p = normPath(repo, a.path);
        if (!p) return { text: '파일 경로가 필요해요.', label: '코드' };
        var r = await ghGetAt(repo, p, S.ai.codeToken);
        if (!r.ok) return { text: r.error, label: '코드 · ' + repo };
        if (r.missing) return { text: repo + '/' + p + ' 파일이 없어요. code_list로 파일 이름을 확인해 주세요.', label: '코드 · ' + repo };
        var text = String(r.raw || '');
        var lines = text.split('\n');
        if (lines.length > 200 || text.length > 24000) {
          var head = lines.slice(0, 80).map(function (l, i) { return (i + 1) + '| ' + l; }).join('\n');
          return {
            text: '이 파일은 ' + lines.length + '줄(' + Math.round(text.length / 1024) + 'KB)이라 통째로 보내지 않아요. 토큰을 아끼려면 search_code로 위치를 찾고 read_code_slice로 필요한 구간만 읽으세요.\n\n앞 80줄만 보여 줘요:\n' + head,
            label: '코드 · ' + repo + '/' + p + ' (앞부분만)',
            quiet: true,
            info: { kind: 'readAll', path: p, total: lines.length }
          };
        }
        return { text: text, label: '코드 · ' + repo + '/' + p, quiet: true, info: { kind: 'readAll', path: p, total: lines.length } };
      }
    },
    {
      name: 'code_edit',
      emoji: '🛠️',
      title: '코드 수정 제안 (확인 후 반영)',
      desc: '코드를 고쳐서 3단계 검사를 돌리고, 도현님이 [반영하기]를 눌러야만 배포해요. 계획을 보이고 “이대로 진행할까요?”로 승인받은 뒤에만 부른다. 큰 파일은 content로 통째로 쓰지 말고 edits(찾아 바꾸기)로 작게 고치세요.',
      argsHint: '{"repo":"kids-dashboard","path":"index.html","edits":[{"old_string":"정확히 같은 글자","new_string":"새 글자","replace_all":false}],"summary":"무엇을 왜 바꾸는지"} 또는 작은 파일이면 {"content":"파일 전체"} / {"range":{"start":10,"end":20,"text":"새 줄들"}}',
      run: async function (a, ctx) {
        var repo = normRepo(a.repo);
        if (CODE_REPOS.indexOf(repo) < 0) return { text: '이 네 화면만 고칠 수 있어요: ' + CODE_REPOS.join(', '), label: '코드' };
        if (!S.ai.codeToken) return { text: '코드 열쇠가 없어요. 설정에서 넣어 주세요.', label: '코드' };
        var p = normPath(repo, a.path);
        if (!p) return { text: '파일 경로가 필요해요.', label: '코드' };
        var cur = await ghGetAt(repo, p, S.ai.codeToken);
        if (!cur.ok) return { text: cur.error, label: '코드' };
        var oldText = (cur.missing ? '' : String(cur.raw || ''));
        var content = null;
        var patchNote = '';
        if (Object.prototype.toString.call(a.edits) === '[object Array]' && a.edits.length) {
          var res = applyEdits(oldText, a.edits);
          if (!res.ok) return { text: '[' + repo + '/' + p + '] ' + res.error, label: '수정 실패 · ' + repo + '/' + p };
          content = res.text;
          var parts = [];
          for (var i = 0; i < res.applied.length; i++) {
            var ap = res.applied[i];
            parts.push(ap.index + '번째' + (ap.trimmed ? ' (들여쓰기 차이 무시하고 맞춤)' : '') + (ap.all ? ' (모두 ' + ap.count + '군데)' : (ap.total > 1 ? ' (같은 글자 ' + ap.total + '군데 중 첫 번째)' : '')));
          }
          patchNote = '찾아 바꾸기 ' + res.applied.length + '개 적용: ' + parts.join(', ');
        } else if (a.range && a.range.start != null) {
          var arr = oldText.split('\n');
          var st = clamp(Number(a.range.start) || 1, 1, arr.length);
          var en = clamp(Number(a.range.end) || st, st, arr.length);
          var repl = String(a.range.text == null ? '' : a.range.text).split('\n');
          content = arr.slice(0, st - 1).concat(repl).concat(arr.slice(en)).join('\n');
          patchNote = st + '~' + en + '줄을 바꿨어요';
        } else if (a.content != null) {
          content = String(a.content);
          if (oldText.length > 60000 && content.length > 60000) patchNote = '파일 전체를 새로 받았어요 (큰 파일은 다음부터 edits를 쓰면 토큰을 아껴요)';
        }
        if (content == null) return { text: '고칠 내용이 없어요. edits(찾아 바꾸기)나 range, content 중 하나를 주세요.', label: '코드' };
        if (content === oldText) return { text: '바뀐 내용이 없어요. old_string과 new_string을 확인해 주세요.', label: '코드 · ' + p };
        var id = uid('p_');
        var diff = diffLines(oldText, content);
        /* 화면에 보여 줄 변경이 없으면(+0 · -0) 제안 카드를 만들지 않아요 */
        if (!diff.added && !diff.removed) return { text: '바뀐 내용이 없어 old_string과 new_string을 확인해야 해요. 실제로 달라지는 글자로 다시 제안해 주세요.', label: '코드 · ' + p };
        var check = await checkCodeFile(p, content);
        S.proposals[id] = {
          id: id, repo: repo, path: p, content: content, old: oldText,
          summary: String(a.summary || '코드 수정'), patchNote: patchNote, diff: diff, check: check,
          thread: ctx.threadId, at: nowIso(), state: 'pending'
        };
        var bad = !check.ok;
        var stageWord = (check.steps && check.steps.length === 3) ? '3단계 자동 검사' : '자동 검사';
        return {
          text: (patchNote ? patchNote + '. ' : '') + (bad
            ? '자동 검사에서 문제가 보여요. 아래 내용을 보고 고친 뒤 다시 제안해 주세요.'
            : stageWord + '를 통과했어요. 대표님 승인과 QC 검수를 거친 뒤에만 실제로 반영돼요.'),
          label: '수정 제안 · ' + repo + '/' + p,
          card: { kind: 'edit', id: id }
        };
      }
    }
];


/* ---------- 사무실에 맞게 도구 설명을 다듬어요 ---------- */
(function () {
    for (var i = 0; i < TOOLS.length; i++) {
      var t = TOOLS[i];
      if (t.name === 'code_edit') {
        t.title = '코드 수정안 만들기';
        t.desc = '코드를 고쳐 수정안을 만들어요. 실제 반영은 대표님 승인과 QC 검수 뒤에만 일어나요. ' +
          '아이 화면(kids-dashboard)은 index.html 셸 + js/*.js 모듈 구조라 path에는 고칠 모듈 파일(예: js/ui.js)을 적어요. ' +
          '큰 파일은 content로 통째로 쓰지 말고 edits(찾아 바꾸기)로 작게 고치세요.';
        t.argsHint = '{"repo":"kids-dashboard","path":"js/ui.js","edits":[{"old_string":"정확히 같은 글자","new_string":"새 글자"}],"summary":"무엇을 왜 바꾸는지"}';
      }
      if (t.name === 'family_save') { t.desc = '가족 데이터를 저장해요(사무실에서는 쓰지 않고 읽기만 해요).'; }
    }
})();
var ALL_TOOLS = TOOLS.slice();
