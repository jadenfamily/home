/* ============================================================================
   AI 사무실 — office/js/toolcalls.js
   도구 스키마(OpenAI·Gemini 형식) · 도구 호출 해석
   · office.html 이 css/style.css → js/state.js … js/boot.js 순서로 불러요.
     모듈끼리 같은 전역 스코프를 써요(함수 이름은 사무실 전체에서 하나).
   · 원래 office.html 한 덩어리 스크립트를 기능별로 나눈 파일이라 동작은 같아요.
   ============================================================================ */
'use strict';

/* ===== 도구 스키마·도구 호출 해석 (chat.html에서 승계) ===== */
var TOOL_SCHEMAS = {
    family_data: {
      kind: { type: 'string', enum: ['fridge', 'recipes', 'ledger', 'kids', 'summary', 'files', 'read'], description: '무엇을 읽을지' },
      path: { type: 'string', description: '읽을 파일 경로 (kind=read·files일 때)' }
    },
    family_save: {
      path: { type: 'string', description: '예: fridge/inventory.json' },
      data: { type: 'object', description: '저장할 JSON 전체', additionalProperties: true },
      reason: { type: 'string', description: '왜 바꾸는지' }
    },
    code_list: {
      repo: { type: 'string', enum: ['home', 'kids-dashboard', 'fridge-dashboard', 'ledger-dashboard'] },
      path: { type: 'string', description: '비우면 최상위' }
    },
    search_code: {
      repo: { type: 'string', enum: ['home', 'kids-dashboard', 'fridge-dashboard', 'ledger-dashboard'] },
      path: { type: 'string', description: '꼭 적기. 예: chat.html (비우면 index.html을 뒤져요)' },
      query: { type: 'string' },
      regex: { type: 'boolean' },
      max: { type: 'integer' }
    },
    read_code_slice: {
      repo: { type: 'string', enum: ['home', 'kids-dashboard', 'fridge-dashboard', 'ledger-dashboard'] },
      path: { type: 'string', description: '꼭 적기. 예: chat.html' },
      start: { type: 'integer', description: '시작 줄 (1부터)' },
      lines: { type: 'integer', description: '읽을 줄 수 (기본 120)' }
    },
    code_read: {
      repo: { type: 'string', enum: ['home', 'kids-dashboard', 'fridge-dashboard', 'ledger-dashboard'] },
      path: { type: 'string' }
    },
    code_edit: {
      repo: { type: 'string', enum: ['home', 'kids-dashboard', 'fridge-dashboard', 'ledger-dashboard'] },
      path: { type: 'string', description: '꼭 적기. 예: chat.html' },
      edits: {
        type: 'array',
        description: '찾아 바꿀 목록 (작은 패치)',
        items: {
          type: 'object',
          properties: {
            old_string: { type: 'string' },
            new_string: { type: 'string' },
            replace_all: { type: 'boolean' }
          },
          required: ['old_string', 'new_string']
        }
      },
      content: { type: 'string', description: '작은 파일을 통째로 쓸 때만' },
      range: {
        type: 'object',
        properties: { start: { type: 'integer' }, end: { type: 'integer' }, text: { type: 'string' } }
      },
      summary: { type: 'string', description: '무엇을 왜 바꿨는지 (커밋 메시지)' }
    }
};

function openaiToolDef(t) {
    return {
      type: 'function',
      function: {
        name: t.name,
        description: String(t.title || t.name) + ' — ' + String(t.desc || '') + ' args 예: ' + String(t.argsHint || '{}'),
        parameters: {
          type: 'object',
          properties: TOOL_SCHEMAS[t.name] || {},
          additionalProperties: true
        }
      }
    };
}
function openaiTools() {
    var out = [];
    for (var i = 0; i < TOOLS.length; i++) out.push(openaiToolDef(TOOLS[i]));
    return out;
}

function toolByName(name) {
    for (var i = 0; i < TOOLS.length; i++) if (TOOLS[i].name === name) return TOOLS[i];
    return null;
}

/* 도구별로 top-level에 그냥 눌러놓은 인자까지 주워요 ({"tool":"search_code","repo":...}) */
var TOOL_ARG_KEYS = {
    family_data: ['kind', 'path'],
    family_save: ['path', 'data', 'reason'],
    code_list: ['repo', 'path'],
    search_code: ['repo', 'path', 'query', 'regex', 'max'],
    read_code_slice: ['repo', 'path', 'start', 'lines', 'end'],
    code_read: ['repo', 'path'],
    code_edit: ['repo', 'path', 'edits', 'content', 'range', 'summary', 'oldText', 'newText']
};
var FAMILY_KINDS = ['fridge', 'recipes', 'ledger', 'kids', 'summary', 'files', 'read'];

function parseArgsObj(v) {
    if (v == null) return null;
    if (typeof v === 'string') {
      var s = v.trim();
      if (!s) return null;
      try { var j = JSON.parse(s); return (j && typeof j === 'object') ? j : null; } catch (e) { return null; }
    }
    return (typeof v === 'object') ? v : null;
}
function pickArgs(name, j) {
    var keys = TOOL_ARG_KEYS[name] || [], out = {}, any = false;
    for (var i = 0; i < keys.length; i++) {
      if (j[keys[i]] === undefined) continue;
      out[keys[i]] = j[keys[i]];
      any = true;
    }
    return any ? out : {};
}
/* 인자 모양만 보고 도구 이름을 알아내요 (모델이 {"repo":"home","path":"chat.html","query":"settings"}만 쓸 때) */
function inferTool(j) {
    if (!j || typeof j !== 'object' || Object.prototype.toString.call(j) === '[object Array]') return null;
    function has(k) { return j[k] !== undefined && j[k] !== null && j[k] !== ''; }
    var repo = has('repo') ? normRepo(j.repo) : '';
    var inRepos = !!repo && CODE_REPOS.indexOf(repo) >= 0;
    var path = has('path') ? j.path : (has('file') ? j.file : (has('filepath') ? j.filepath : (has('file_path') ? j.file_path : null)));
    var query = has('query') ? j.query : (has('q') ? j.q : (has('keyword') ? j.keyword : (has('search') ? j.search : null)));
    var edits = has('edits') ? j.edits : (has('changes') ? j.changes : (has('patches') ? j.patches : null));
    var oldT = has('oldText') ? j.oldText : (has('old_text') ? j.old_text : (has('old_string') ? j.old_string : (has('find') ? j.find : null)));
    var newT = has('newText') ? j.newText : (has('new_text') ? j.new_text : (has('new_string') ? j.new_string : (has('replace') ? j.replace : null)));

    /* 가족 데이터 저장 */
    if (!has('repo') && has('data') && path != null) {
      return { name: 'family_save', args: { path: path, data: j.data, reason: String(j.reason || '') } };
    }
    if (inRepos) {
      /* 코드 수정 */
      if (edits || (oldT != null && newT != null) || has('content') || j.range) {
        var a = { repo: repo };
        if (path != null) a.path = path;
        if (edits) a.edits = edits;
        else if (oldT != null && newT != null) a.edits = [{ old_string: String(oldT), new_string: String(newT), replace_all: !!j.replace_all }];
        if (has('content')) a.content = j.content;
        if (j.range) a.range = j.range;
        if (has('summary')) a.summary = String(j.summary);
        if (a.edits || a.content || a.range) return { name: 'code_edit', args: a };
      }
      /* 코드 검색 */
      if (query != null) {
        var s = { repo: repo, query: String(query) };
        if (path != null) s.path = path;
        if (j.regex != null) s.regex = !!j.regex;
        if (j.max != null) s.max = j.max;
        return { name: 'search_code', args: s };
      }
      /* 파일 구간 읽기 */
      if (has('start') || has('lines') || has('end')) {
        var st = Number(j.start) || 1, ln = Number(j.lines) || 0;
        if (!ln && has('end')) ln = Math.max(1, (Number(j.end) || st) - st + 1);
        var r = { repo: repo, start: st, lines: ln || 120 };
        if (path != null) r.path = path;
        return { name: 'read_code_slice', args: r };
      }
      /* 파일 전체 읽기 / 목록 */
      if (path != null) return { name: 'code_read', args: { repo: repo, path: path } };
      return { name: 'code_list', args: { repo: repo, path: has('path') ? j.path : '' } };
    }
    /* 가족 데이터 읽기 */
    if (has('kind') && FAMILY_KINDS.indexOf(String(j.kind)) >= 0) {
      var f = { kind: String(j.kind) };
      if (path != null) f.path = path;
      return { name: 'family_data', args: f };
    }
    return null;
}
/* 도구 인자를 도구가 알아듣는 모양으로 다듬어요 */
function normalizeToolArgs(name, args) {
    var a = (args && typeof args === 'object') ? args : {};
    if (name === 'family_data' || name === 'family_save') return a;
    if (a.repo != null) a.repo = normRepo(a.repo);
    var pKey = a.path != null ? 'path' : (a.file != null ? 'file' : (a.filepath != null ? 'filepath' : null));
    if (pKey) {
      var np = normPath(a.repo, a[pKey]);
      if (pKey !== 'path') delete a[pKey];
      a.path = np;
    }
    if (name === 'search_code') {
      if (a.query == null) a.query = (a.q != null ? a.q : (a.keyword != null ? a.keyword : a.search));
      if (a.query != null) a.query = String(a.query);
    }
    if (name === 'code_edit') {
      var oldT = a.oldText != null ? a.oldText : a.old_string;
      var newT = a.newText != null ? a.newText : a.new_string;
      if (!a.edits && oldT != null && newT != null) a.edits = [{ old_string: String(oldT), new_string: String(newT), replace_all: !!a.replace_all }];
      delete a.oldText; delete a.newText; delete a.old_string; delete a.new_string;
      if (a.edits && Object.prototype.toString.call(a.edits) !== '[object Array]') a.edits = [a.edits];
    }
    if (name === 'read_code_slice' && !Number(a.lines) && a.end != null) {
      a.lines = Math.max(1, (Number(a.end) || Number(a.start) || 1) - (Number(a.start) || 1) + 1);
      delete a.end;
    }
    return a;
}

function parseToolCall(text) {
    if (!text) return null;
    var m = /```[a-zA-Z0-9+#._-]*\s*([\s\S]*?)```/g, x;
    while ((x = m.exec(text))) {
      var call = tryJsonTool(x[1].trim());
      if (call) return call;
    }
    return tryJsonTool(String(text).trim());
}
function tryJsonTool(s) {
    if (!s) return null;
    var j = null;
    try { j = JSON.parse(s); } catch (e) {
      var a = s.indexOf('{'), b = s.lastIndexOf('}');
      if (a >= 0 && b > a) { try { j = JSON.parse(s.slice(a, b + 1)); } catch (e2) { j = null; } }
    }
    if (!j || typeof j !== 'object') return null;
    if (Object.prototype.toString.call(j) === '[object Array]') {
      for (var i = 0; i < j.length && i < 4; i++) { var one = tryJsonObj(j[i]); if (one) return one; }
      return null;
    }
    return tryJsonObj(j);
}
function tryJsonObj(j) {
    if (!j || typeof j !== 'object') return null;
    /* {"function":{"name":…,"arguments":…}} 모양도 받아요 */
    if (j.function && typeof j.function === 'object' && j.function.name) {
      var fa = parseArgsObj(j.function.arguments != null ? j.function.arguments : j.function.args) || {};
      return { name: String(j.function.name), args: normalizeToolArgs(String(j.function.name), fa) };
    }
    var name = String(j.tool || j.name || j.tool_name || j.toolName || '').trim();
    if (name && toolByName(name)) {
      var args = parseArgsObj(j.args != null ? j.args : (j.arguments != null ? j.arguments : (j.input != null ? j.input : j.parameters)));
      if (!args || !Object.keys(args).length) args = pickArgs(name, j);
      return { name: name, args: normalizeToolArgs(name, args) };
    }
    /* 이름이 없거나 낯설면 인자 모양으로 알아내요 (```json 안의 {"repo":…} 같은 경우) */
    var inf = inferTool(j);
    if (!inf) return null;
    return { name: inf.name, args: normalizeToolArgs(inf.name, inf.args) };
}

/* ============ 3단계 자동 검사 ============ */
var smokeWaiters = {};
