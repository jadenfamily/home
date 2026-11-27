/* ============================================================================
   AI 사무실 — office/js/providers.js
   제공자·모델 목록 · 호출 · 한도 · 키 순환
   · office.html 이 css/style.css → js/state.js … js/boot.js 순서로 불러요.
     모듈끼리 같은 전역 스코프를 써요(함수 이름은 사무실 전체에서 하나).
   · 원래 office.html 한 덩어리 스크립트를 기능별로 나눈 파일이라 동작은 같아요.
   ============================================================================ */
'use strict';

/* ===== 제공자·모델·호출·한도 (chat.html에서 승계) ===== */
var PROVIDERS = {
    gemini: {
      id: 'gemini', label: 'Google Gemini', short: 'Gemini', keyField: 'gemini',
      signup: 'https://aistudio.google.com/apikey', keyHint: 'AI Studio에서 무료로 받은 키 (AQ.… / AIza…)',
      models: ['gemini-3.8-flash'],
      call: geminiCall,
      list: geminiModels
    },
    openrouter: {
      id: 'openrouter', label: 'OpenRouter', short: 'OpenRouter', keyField: 'openrouter',
      signup: 'https://openrouter.ai/keys', keyHint: '무료(:free) 모델만 골라 써요 (sk-or-…)',
      models: ['deepseek/deepseek-chat-v3.1:free'],
      call: openaiStyleCall('https://openrouter.ai/api/v1/chat/completions', 'openrouter', { 'HTTP-Referer': 'https://jadenfamily.github.io/home/', 'X-Title': 'jadenfamily AI Assistant' }),
      list: openrouterModels
    },
    groq: {
      id: 'groq', label: 'Groq', short: 'Groq', keyField: 'groq',
      signup: 'https://console.groq.com/keys', keyHint: 'console.groq.com에서 받은 키 (gsk_…)',
      models: ['openai/gpt-oss-120b'],
      call: openaiStyleCall('https://api.groq.com/openai/v1/chat/completions', 'groq', {}),
      list: groqModels
    }
};
var PROVIDER_ORDER = ['gemini', 'openrouter', 'groq'];
/* API마다 제일 괜찮은 모델 하나만 써요. (2026-11-27 대표님 지시: 모델이 너무 많아서 API별 최고 모델 1개로 축소) */
/* 코딩·추론 팀(개발·QC)은 OpenRouter·Groq의 코딩 모델을 먼저 쓰고
   그쪽이 모두 한도·오류일 때만 Gemini를 맨 마지막 폴백으로 써요. (2026-11-27 대표님 지시) */
var CODE_PROVIDER_ORDER = ['openrouter', 'groq', 'gemini'];
var CODE_MODEL_ORDER = {
    openrouter: ['deepseek/deepseek-chat-v3.1:free'],
    groq: ['openai/gpt-oss-120b'],
    gemini: ['gemini-3.8-flash']
};
var CODE_MODELS_PER_PROVIDER = 1;
function isCodeTeam(team) {
    var id = String((team && team.id) || '');
    return id === 'dev' || id === 'qc';
}

function providerKey(pid) {
    var l = (S.ai && S.ai.keys && S.ai.keys[pid]) || [];
    if (l.length) return String(l[activeIndex(pid)] || '');
    return String((S.ai && S.ai[pid]) || '');
}
function hasKey(pid) { return !!providerKey(pid); }

function modelIdOf(pid, model) { return pid + ':' + model; }
function splitModelId(id) {
    var s = String(id || ''), i = s.indexOf(':');
    if (i < 0) return { pid: '', model: '' };
    return { pid: s.slice(0, i), model: s.slice(i + 1) };
}
function cachedModels() {
    var j = null;
    try { j = JSON.parse(lsGet(K_MODELS) || 'null'); } catch (e) { j = null; }
    return (j && j.ids) ? j : null;
}

/* ---------- 더 이상 쓸 수 없는 모델은 목록에서 숨겨요 ---------- */
function loadDead() {
    var j = null;
    try { j = JSON.parse(lsGet(K_DEAD) || '{}'); } catch (e) { j = null; }
    S.dead = (j && typeof j === 'object') ? j : {};
    return S.dead;
}
function saveDead() { lsSet(K_DEAD, JSON.stringify(S.dead || {})); }
function isDeadModel(id) {
    if (!S.dead) loadDead();
    return !!(S.dead && S.dead[id]);
}
function markDeadModel(id, reason) {
    if (!id) return false;
    if (!S.dead) loadDead();
    var first = !S.dead[id];
    S.dead[id] = { at: nowIso(), reason: String(reason || '').slice(0, 160) };
    saveDead();
    return first;
}
function reviveDeadModel(id) {
    if (!S.dead || !S.dead[id]) return;
    delete S.dead[id];
    saveDead();
}
/* 404·단종·지워진 모델 오류인지 */
function isDeadModelError(status, error) {
    var e = String(error || '');
    /* 함수 도구(tools) 미지원 오류는 모델이 없어진 게 아니에요 */
    if (/tool[_ ]?choice|tool[_ ]?calls?|\btools\b/i.test(e) && /support/i.test(e)) return false;
    if (Number(status) === 404) return true;
    /* 약관 동의가 필요하거나 남은 한도가 0인 모델도 고를 수 없는 모델이에요 */
    return /no longer available|not found|does not exist|decommissioned|deprecated|unsupported model|is not supported|지원하지 않는|더 이상 (쓸|사용)|requires?\s+(the\s+)?terms?\s+acceptance|accept\s+the\s+terms?|limit\s*[:=]\s*0(?![\d.])/i.test(e);
}
/* 이 모델이 함수 도구(tools) 자체를 받지 못할 때 */
function isNoToolSupportError(status, error) {
    if (Number(status) !== 400 && Number(status) !== 404 && Number(status) !== 422) return false;
    var e = String(error || '');
    if (!/tool/i.test(e)) return false;
    return /not support|unsupport|does not support|doesn't support|isn't supported|not allowed|not available|unknown field|invalid_request_error|unrecognized/i.test(e);
}
/* 모델별로 “도구를 못 받는 모델”을 기억해 둬요 (매번 400으로 실패하지 않게) */
function loadNoTools() {
    if (S.noTools) return S.noTools;
    var j = null;
    try { j = JSON.parse(lsGet('kidsDashboard.chat.notools.v1') || '{}'); } catch (e) { j = null; }
    S.noTools = (j && typeof j === 'object') ? j : {};
    return S.noTools;
}
function noToolsModel(id) {
    if (!id) return false;
    return !!loadNoTools()[id];
}
function markNoToolsModel(id) {
    if (!id) return;
    var o = loadNoTools();
    if (o[id]) return;
    o[id] = nowIso();
    try { lsSet('kidsDashboard.chat.notools.v1', JSON.stringify(o)); } catch (e) { /* 무시 */ }
}
/* 지금 쓸 수 있는 다음 모델 (같은 제공자 먼저, 그다음 다른 제공자) */
function nextUsableModel(badId) {
    var sp = splitModelId(badId);
    var order = [sp.pid].concat(PROVIDER_ORDER.filter(function (p) { return p !== sp.pid; }));
    for (var i = 0; i < order.length; i++) {
      var pid = order[i];
      if (!pid || !PROVIDERS[pid] || !hasKey(pid)) continue;
      var list = modelList(pid);
      for (var k = 0; k < list.length; k++) {
        var id = modelIdOf(pid, list[k]);
        if (id === badId || isDeadModel(id)) continue;
        return id;
      }
    }
    return '';
}
/* 429(한도)·503(혼잡)일 때: 같은 제공자의 다른 모델 → 다른 제공자 순서로 바로 보낼 수 있는 모델을 찾아요 */
function busyFallbackModel(badId, tried) {
    var sp = splitModelId(badId);
    var order = [sp.pid].concat(PROVIDER_ORDER.filter(function (p) { return p !== sp.pid; }));
    for (var i = 0; i < order.length; i++) {
      var pid = order[i];
      if (!pid || !PROVIDERS[pid] || !hasKey(pid)) continue;
      var list = modelList(pid);
      for (var k = 0; k < list.length; k++) {
        var m = String(list[k] || '');
        if (!m || NON_CHAT_MODEL_RE.test(m)) continue;
        var id = modelIdOf(pid, m);
        if (id === badId || (tried && tried[id]) || isDeadModel(id) || noToolsModel(id)) continue;
        if (limitInfo(id).left > 0) continue;
        return id;
      }
    }
    return '';
}
function modelList(pid) {
    var c = cachedModels();
    var list = (c && Object.prototype.toString.call(c.ids[pid]) === '[object Array]') ? c.ids[pid] : [];
    if (!list.length) list = (PROVIDERS[pid] && PROVIDERS[pid].models) || [];
    var out = [];
    for (var i = 0; i < list.length; i++) {
      if (isDeadModel(modelIdOf(pid, list[i]))) continue;
      out.push(list[i]);
    }
    return out;
}
function allModelIds() {
    var out = [];
    for (var i = 0; i < PROVIDER_ORDER.length; i++) {
      var pid = PROVIDER_ORDER[i], list = modelList(pid);
      for (var k = 0; k < list.length; k++) out.push(modelIdOf(pid, list[k]));
    }
    return out;
}
function defaultModelId() {
    var pref = String(S.pref.model || '');
    var ps = splitModelId(pref);
    if (pref && PROVIDERS[ps.pid] && modelList(ps.pid).indexOf(ps.model) >= 0 && !isDeadModel(pref)) return pref;
    for (var i = 0; i < PROVIDER_ORDER.length; i++) {
      var pid = PROVIDER_ORDER[i];
      if (!hasKey(pid)) continue;
      var list = modelList(pid);
      if (!list.length) continue;
      var want = PREFERRED_MODEL[pid];
      if (want && list.indexOf(want) >= 0) return modelIdOf(pid, want);
      return modelIdOf(pid, list[0]);
    }
    return modelIdOf('gemini', PROVIDERS.gemini.models[0]);
}
/* 한 제공자의 모델을 쓸 순서대로 — 코딩 팀이면 코딩·추론 모델을 앞에 둬요 */
function orderedModelsFor(pid, coding) {
    var list = modelList(pid);
    if (!coding) return list;
    var want = CODE_MODEL_ORDER[pid] || [], out = [];
    for (var i = 0; i < want.length; i++) if (list.indexOf(want[i]) >= 0 && out.indexOf(want[i]) < 0) out.push(want[i]);
    for (var k = 0; k < list.length; k++) if (out.indexOf(list[k]) < 0) out.push(list[k]);
    return out;
}
/* 이번 호출에서 시도할 모델 순서 — startId(지금 쓰는 모델) 다음에 폴백이 이어져요 */
function modelChainFor(team, startId) {
    var coding = isCodeTeam(team);
    var order = coding ? CODE_PROVIDER_ORDER : PROVIDER_ORDER;
    var out = [];
    function add(pid, model) {
      if (!pid || !PROVIDERS[pid] || !hasKey(pid)) return;
      if (!model || NON_CHAT_MODEL_RE.test(String(model))) return;
      if (modelList(pid).indexOf(model) < 0) return;
      var id = modelIdOf(pid, model);
      if (isDeadModel(id) || noToolsModel(id) || out.indexOf(id) >= 0) return;
      out.push(id);
    }
    var sp0 = splitModelId(startId);
    if (startId) add(sp0.pid, sp0.model);
    for (var i = 0; i < order.length; i++) {
      var pid = order[i];
      if (!PROVIDERS[pid] || !hasKey(pid)) continue;
      var seq = orderedModelsFor(pid, coding);
      var limit = (coding && pid !== 'gemini') ? CODE_MODELS_PER_PROVIDER : seq.length;
      for (var k = 0; k < seq.length && k < limit; k++) add(pid, seq[k]);
    }
    return out;
}
function codeDefaultModelId() {
    var chain = modelChainFor({ id: 'dev' }, '');
    return chain.length ? chain[0] : defaultModelId();
}
function currentModel() { return defaultModelId(); }

/* ---------- 헤더에서 한도·초기화 시각 읽기 ---------- */
function headerMap(res) {
    var out = {};
    try {
      res.headers.forEach(function (v, k) { out[String(k).toLowerCase()] = String(v); });
    } catch (e) { /* 무시 */ }
    return out;
}
function parseDur(v) {
    if (v == null) return null;
    var s = String(v).trim();
    if (!s) return null;
    if (/^\d+(\.\d+)?$/.test(s)) return parseFloat(s) * 1000;
    var total = 0, matched = false, re = /(\d+(?:\.\d+)?)\s*(ms|h|m|s)/g, x;
    while ((x = re.exec(s))) {
      matched = true;
      var n = parseFloat(x[1]), u = x[2];
      if (u === 'ms') total += n;
      else if (u === 'h') total += n * 3600000;
      else if (u === 'm') total += n * 60000;
      else total += n * 1000;
    }
    return matched ? total : null;
}
function tzOffsetMs(tz, date) {
    try {
      var dtf = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
      var p = {};
      dtf.formatToParts(date).forEach(function (x) { p[x.type] = x.value; });
      var asUTC = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour) % 24, Number(p.minute), Number(p.second));
      return asUTC - date.getTime();
    } catch (e) { return null; }
}
function nextMidnightInZone(tz) {
    var now = new Date();
    var off = tzOffsetMs(tz, now);
    if (off == null) {
      /* 시간대 정보를 못 읽으면 한국 기준 다음 17시(=태평양 자정)로 잡아요 */
      var k = new Date(now.getTime() + 9 * 3600000);
      var next = Date.UTC(k.getUTCFullYear(), k.getUTCMonth(), k.getUTCDate() + (k.getUTCHours() >= 17 ? 1 : 0), 17 - 9, 0, 0);
      return next;
    }
    var local = new Date(now.getTime() + off);
    var base = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() + 1, 0, 0, 0);
    var guess = base - off;
    var off2 = tzOffsetMs(tz, new Date(guess));
    if (off2 != null && off2 !== off) guess = base - off2;
    return guess;
}
function nextMidnightUTC() {
    var now = new Date();
    return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 0);
}

function noteResult(pid, model, status, headers, bodyText) {
    var id = modelIdOf(pid, model);
    var h = headers || {};
    if (status >= 200 && status < 300) {
      S.limits[id] = { state: 'ok', at: Date.now() };
      savePref();
      return;
    }
    if (status !== 429 && status !== 503) return;
    var body = String(bodyText || '');
    var reset = null, kind = 'limited';
    var ra = parseDur(h['retry-after']);
    if (ra != null) reset = Date.now() + ra;
    if (!reset) {
      var rr = parseDur(h['x-ratelimit-reset-requests']);
      if (rr != null) reset = Date.now() + rr;
    }
    if (!reset) {
      var rt = parseDur(h['x-ratelimit-reset-tokens']);
      if (rt != null) reset = Date.now() + rt;
    }
    if (!reset) {
      var xr = h['x-ratelimit-reset'] || h['ratelimit-reset'] || '';
      if (xr) {
        if (/^\d+$/.test(xr)) reset = Number(xr) * 1000;
        else { var dd = Date.parse(xr); if (!isNaN(dd)) reset = dd; }
      }
    }
    if (!reset) {
      var rd = /"retryDelay"\s*:\s*"([^"]+)"/.exec(body);
      if (rd) { var ms = parseDur(rd[1]); if (ms != null) reset = Date.now() + ms; }
    }
    var quotaWord = /quota|per day|daily|exceeded your current quota|free-models-per-day|billing/i.test(body);
    if (quotaWord) kind = 'quota';
    if (kind === 'quota' && !reset) {
      if (pid === 'gemini') reset = nextMidnightInZone('America/Los_Angeles');
      else if (pid === 'openrouter') reset = nextMidnightUTC();
      else reset = Date.now() + 3600000;
    }
    if (kind === 'limited' && !reset) reset = Date.now() + 60000;
    S.limits[id] = { state: kind, resetAt: reset, at: Date.now(), note: body.slice(0, 160) };
    savePref();
}

function limitInfo(id) {
    var l = S.limits[id];
    if (!l) return { cls: 'unknown', text: '상태 확인 전', left: 0 };
    if (l.state === 'ok') return { cls: 'ok', text: '사용 가능', left: 0 };
    var left = (Number(l.resetAt) || 0) - Date.now();
    if (left <= 0) return { cls: 'ok', text: '사용 가능', left: 0 };
    var label = l.state === 'quota' ? '한도 소진' : '일시 제한';
    return { cls: l.state, text: label + ' · ' + fmtClock(l.resetAt) + ' 초기화', left: left, resetAt: l.resetAt };
}

/* ---------- 실제 호출 ---------- */
function textFromErr(status, json, fallback) {
    var msg = '';
    try {
      if (json && json.error) msg = json.error.message || json.error.status || '';
      if (!msg && json && json.message) msg = json.message;
      if (!msg && json && json.detail) msg = json.detail;
    } catch (e) { msg = ''; }
    return msg || fallback || ('HTTP ' + status);
}

/* ---------- Gemini 함수 도구(functionDeclarations) ---------- */
/* Gemini는 OpenAPI 중 일부 키만 받아요. additionalProperties 같은 미지원 키는 빼고 넘겨요. */
function geminiSchema(s) {
    if (!s || typeof s !== 'object') return null;
    var out = {}, k;
    if (s.type) out.type = String(s.type).toLowerCase();
    if (s.description) out.description = String(s.description);
    if (Object.prototype.toString.call(s.enum) === '[object Array]') out.enum = s.enum.map(function (x) { return String(x); });
    if (Object.prototype.toString.call(s.required) === '[object Array]') out.required = s.required.map(function (x) { return String(x); });
    if (s.properties && typeof s.properties === 'object') {
      var props = {};
      for (k in s.properties) {
        if (!Object.prototype.hasOwnProperty.call(s.properties, k)) continue;
        var ps = geminiSchema(s.properties[k]);
        if (ps) props[k] = ps;
      }
      out.properties = props;
      if (!out.type) out.type = 'object';
    }
    if (s.items) { var it = geminiSchema(s.items); if (it) out.items = it; }
    return out;
}
function geminiToolDef(t) {
    var d = {
      name: String(t.name),
      description: String(t.title || t.name) + ' — ' + String(t.desc || '') + ' 인자 형식: ' + String(t.argsHint || '{}')
    };
    var params = geminiSchema({ type: 'object', properties: TOOL_SCHEMAS[t.name] || {} });
    if (params && params.properties && Object.keys(params.properties).length) d.parameters = params;
    return d;
}
function geminiTools() {
    var list = [];
    for (var i = 0; i < TOOLS.length; i++) list.push(geminiToolDef(TOOLS[i]));
    return [{ functionDeclarations: list }];
}
/* 함수 도구(tools·functionDeclarations)를 못 받는 모델인지 (400) */
function isGeminiToolError(status, err) {
    if (Number(status) !== 400 && Number(status) !== 422) return false;
    var e = String(err || '');
    if (!/tool|function|declaration|schema/i.test(e)) return false;
    if (/api key|api_key|quota|billing|permission|safety/i.test(e)) return false;
    return true;
}

async function geminiCall(model, req, opts) {
    var key = (opts && opts.key) || providerKey('gemini');
    if (!key) return { ok: false, status: 0, error: 'Gemini 키가 없어요', headers: {} };
    var mid = modelIdOf('gemini', model);
    var withTools = !(opts && opts.noTools) && !noToolsModel(mid);
    function buildBody(useTools) {
      var contents = [];
      for (var mi = 0; mi < req.messages.length; mi++) {
        var m = req.messages[mi];
        var parts = [{ text: String(m.text || '') }];
        var imgs = m.images || [], pdfs = m.pdfs || [], i;
        for (i = 0; i < imgs.length; i++) parts.push({ inlineData: { mimeType: imgs[i].mime, data: imgs[i].data } });
        for (i = 0; i < pdfs.length; i++) parts.push({ inlineData: { mimeType: 'application/pdf', data: pdfs[i].data } });
        var role = m.role === 'assistant' ? 'model' : 'user';
        var prev = contents[contents.length - 1];
        /* 도구 결과는 사용자 말로 붙어서 같은 역할이 이어져요. 한 칸으로 합쳐야 Gemini가 받아요 */
        if (prev && prev.role === role) prev.parts = prev.parts.concat(parts);
        else contents.push({ role: role, parts: parts });
      }
      var body = {
        systemInstruction: { parts: [{ text: req.system }] },
        contents: contents,
        generationConfig: { temperature: 0.5, maxOutputTokens: (opts && opts.maxTokens) || 2048 }
      };
      /* 말로만 “찾아볼게요” 하지 않고 실제로 도구를 부르도록 함수 도구를 함께 보내요 */
      if (useTools) {
        body.tools = geminiTools();
        body.toolConfig = { functionCallingConfig: { mode: 'AUTO' } };
      }
      return body;
    }
    function send(useTools) {
      return window.fetch('https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(model) + ':generateContent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify(buildBody(useTools)),
        signal: (opts && opts.signal) || undefined
      }).then(function (r) { return r.text().then(function (t) { return { res: r, txt: t, tools: useTools }; }); });
    }
    var got;
    try { got = await send(withTools); }
    catch (e) { return { ok: false, status: 0, error: '네트워크에 연결하지 못했어요', headers: {} }; }
    var headers = headerMap(got.res);
    var json = null;
    try { json = JSON.parse(got.txt); } catch (e) { json = null; }
    noteResult('gemini', model, got.res.status, headers, got.txt);
    var errMsg = got.res.ok ? '' : textFromErr(got.res.status, json, 'HTTP ' + got.res.status);
    /* 이 모델이 함수 도구를 지원하지 않으면 이 모델만 도구 없이 한 번 더 시도해요 */
    if (!got.res.ok && got.tools && (isGeminiToolError(got.res.status, errMsg) || isNoToolSupportError(got.res.status, errMsg))) {
      markNoToolsModel(mid);
      try { got = await send(false); }
      catch (e2) { return { ok: false, status: 0, error: '네트워크에 연결하지 못했어요', headers: {} }; }
      headers = headerMap(got.res);
      json = null;
      try { json = JSON.parse(got.txt); } catch (e3) { json = null; }
      noteResult('gemini', model, got.res.status, headers, got.txt);
      errMsg = got.res.ok ? '' : textFromErr(got.res.status, json, 'HTTP ' + got.res.status);
    }
    if (!got.res.ok) return { ok: false, status: got.res.status, error: errMsg, headers: headers, body: got.txt };
    var parts = (json && json.candidates && json.candidates[0] && json.candidates[0].content && json.candidates[0].content.parts) || [];
    var out = '', calls = [];
    for (var i = 0; i < parts.length; i++) {
      var p = parts[i] || {};
      /* 생각(thought) 조각은 화면에 그대로 보여 주지 않아요 */
      if (p.thought) continue;
      if (p.text) out += p.text;
      var fc = p.functionCall;
      if (fc && fc.name) {
        var args = (fc.args && typeof fc.args === 'object') ? fc.args : {};
        calls.push({ id: 'gem_' + (calls.length + 1), name: String(fc.name), args: args });
      }
    }
    /* 도구를 부른 답변은 본문이 비어 있는 게 정상이에요 */
    if (!String(out).trim() && !calls.length) {
      var block = json && json.promptFeedback && json.promptFeedback.blockReason;
      var fin = json && json.candidates && json.candidates[0] && json.candidates[0].finishReason;
      return {
        ok: false, status: got.res.status, headers: headers, body: got.txt,
        error: block ? ('이 요청은 안전 정책으로 막혔어요 (' + block + ')')
          : (fin && fin !== 'STOP' ? ('답변이 중간에 멈췄어요 (' + fin + ')') : '빈 답변이 왔어요')
      };
    }
    /* 도구 결과는 다음 차례에 [도구 결과 …] 글로 돌아가요.
       (functionCall/functionResponse parts를 되돌려 보내면 사고 서명(thoughtSignature)이 없어 400이 나는 모델이 있어요) */
    return { ok: true, status: got.res.status, text: String(out), toolCalls: calls, headers: headers };
}

function openaiStyleCall(url, pid, extraHeaders) {
    return async function (model, req, opts) {
      var key = (opts && opts.key) || providerKey(pid);
      if (!key) return { ok: false, status: 0, error: PROVIDERS[pid].label + ' 키가 없어요', headers: {} };
      var msgs = [{ role: 'system', content: req.system }];
      for (var i = 0; i < req.messages.length; i++) {
        var m = req.messages[i];
        var imgs = m.images || [];
        var content = String(m.text || '');
        if (imgs.length) {
          content = [];
          if (m.text) content.push({ type: 'text', text: String(m.text) });
          for (var k = 0; k < imgs.length; k++) {
            content.push({ type: 'image_url', image_url: { url: 'data:' + imgs[k].mime + ';base64,' + imgs[k].data } });
          }
        }
        msgs.push({ role: m.role === 'assistant' ? 'assistant' : 'user', content: content });
      }
      var headers = { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key };
      for (var k in extraHeaders) if (Object.prototype.hasOwnProperty.call(extraHeaders, k)) headers[k] = extraHeaders[k];
      var mid = modelIdOf(pid, model);
      var withTools = !(opts && opts.noTools) && !noToolsModel(mid);
      function send(useTools) {
        var body = { model: model, messages: msgs, temperature: 0.5 };
        if (opts && opts.maxTokens) body.max_tokens = opts.maxTokens;
        /* 말로만 “찾아볼게요” 하지 않고 실제로 도구를 부르도록 함수 도구를 함께 보내요 */
        if (useTools) { body.tools = openaiTools(); body.tool_choice = 'auto'; }
        return window.fetch(url, { method: 'POST', headers: headers, body: JSON.stringify(body), signal: (opts && opts.signal) || undefined })
          .then(function (r) { return r.text().then(function (t) { return { res: r, txt: t, tools: useTools }; }); });
      }
      var got;
      try { got = await send(withTools); }
      catch (e) { return { ok: false, status: 0, error: '네트워크에 연결하지 못했어요', headers: {} }; }
      var hmap = headerMap(got.res);
      var json = null;
      try { json = JSON.parse(got.txt); } catch (e) { json = null; }
      noteResult(pid, model, got.res.status, hmap, got.txt);
      var errMsg = got.res.ok ? '' : textFromErr(got.res.status, json, 'HTTP ' + got.res.status);
      /* 이 모델이 함수 도구를 지원하지 않으면 이 모델만 도구 없이 한 번 더 시도해요 */
      if (!got.res.ok && got.tools && isNoToolSupportError(got.res.status, errMsg)) {
        markNoToolsModel(mid);
        try { got = await send(false); }
        catch (e2) { return { ok: false, status: 0, error: '네트워크에 연결하지 못했어요', headers: {} }; }
        hmap = headerMap(got.res);
        json = null;
        try { json = JSON.parse(got.txt); } catch (e3) { json = null; }
        noteResult(pid, model, got.res.status, hmap, got.txt);
        errMsg = got.res.ok ? '' : textFromErr(got.res.status, json, 'HTTP ' + got.res.status);
      }
      if (!got.res.ok) return { ok: false, status: got.res.status, error: errMsg, headers: hmap, body: got.txt };
      var out = '', calls = [];
      try {
        var c = json.choices[0];
        var msg = (c && c.message) || {};
        out = msg.content || '';
        if (Object.prototype.toString.call(out) === '[object Array]') {
          out = out.map(function (p) { return (p && p.text) || ''; }).join('');
        }
        var tc = msg.tool_calls;
        if (Object.prototype.toString.call(tc) === '[object Array]') {
          for (var n = 0; n < tc.length && n < 4; n++) {
            var fn = (tc[n] && tc[n].function) || {};
            var args = {};
            try { args = JSON.parse(fn.arguments || '{}'); } catch (e4) { args = {}; }
            if (!args || typeof args !== 'object') args = {};
            if (fn.name) calls.push({ id: String((tc[n] && tc[n].id) || ''), name: String(fn.name), args: args });
          }
        }
      } catch (e) { out = ''; }
      /* 도구를 부른 답변은 본문이 비어 있는 게 정상이에요 */
      if (!String(out).trim() && !calls.length) return { ok: false, status: got.res.status, error: '빈 답변이 왔어요', headers: hmap, body: got.txt };
      return { ok: true, status: got.res.status, text: String(out), toolCalls: calls, headers: hmap };
    };
}

async function listGemini() {
    var key = providerKey('gemini');
    if (!key) return [];
    var res = await window.fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000', { headers: { 'x-goog-api-key': key } });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    var j = await res.json();
    var ids = [], list = (j && j.models) || [];
    for (var i = 0; i < list.length; i++) {
      var m = list[i] || {};
      var id = String(m.name || '').replace(/^models\//, '');
      var methods = m.supportedGenerationMethods || [];
      if (methods.indexOf('generateContent') < 0) continue;
      if (!/^gemini-/.test(id)) continue;
      if (/(image|tts|live|transcribe|embedding|translate|omni|audio|robotics|computer-use|vision-last|nano-banana|imagen|veo|aqa)/i.test(id)) continue;
      /* 단종된 옛 모델(1.x·2.0·2.5)은 목록에 올리지 않아요 */
      if (/^gemini-(1\.|2\.0|2\.5)/i.test(id)) continue;
      ids.push(id);
    }
    var pref = [], rest = [];
    for (var k = 0; k < ids.length; k++) { if (/(flash|hydrogen|pro)/i.test(ids[k])) pref.push(ids[k]); else rest.push(ids[k]); }
    return pref.concat(rest);
}
async function geminiModels() {
    try { return await listGemini(); } catch (e) { return []; }
}
async function openrouterModels() {
    try {
      var res = await window.fetch('https://openrouter.ai/api/v1/models');
      if (!res.ok) throw new Error('HTTP ' + res.status);
      var j = await res.json();
      var out = [], list = (j && j.data) || [];
      for (var i = 0; i < list.length; i++) {
        var id = String(list[i] && list[i].id || '');
        if (!id) continue;
        if (/:free$/.test(id) && !NON_CHAT_MODEL_RE.test(id)) out.push(id);
      }
      out.sort();
      return out;
    } catch (e) { return []; }
}
/* 대화용이 아닌 모델(음성·그림 생성·가드·임베딩)은 목록에서 빼요 */
var NON_CHAT_MODEL_RE = /(orpheus|whisper|tts|playai|guard|safeguard|embed|nano-banana|imagen|veo|dall-e|flux|stable-diffusion|sdxl|moderation|rerank)/i;
async function groqModels() {
    var key = providerKey('groq');
    if (!key) return [];
    try {
      var res = await window.fetch('https://api.groq.com/openai/v1/models', { headers: { 'Authorization': 'Bearer ' + key } });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      var j = await res.json();
      var out = [], list = (j && j.data) || [];
      for (var i = 0; i < list.length; i++) {
        var id = String(list[i] && list[i].id || '');
        if (!id) continue;
        if (NON_CHAT_MODEL_RE.test(id)) continue;
        out.push(id);
      }
      return out;
    } catch (e) { return []; }
}
async function refreshModels() {
    var ids = {};
    for (var i = 0; i < PROVIDER_ORDER.length; i++) {
      var pid = PROVIDER_ORDER[i];
      if (!hasKey(pid)) { ids[pid] = []; continue; }
      var got = [];
      try { got = await PROVIDERS[pid].list(); } catch (e) { got = []; }
      ids[pid] = got && got.length ? got : modelList(pid);
    }
    lsSet(K_MODELS, JSON.stringify({ at: Date.now(), ids: ids }));
    return ids;
}

/* ===== 키 순환·한도 시 이어 보내기 (chat.html에서 승계) ===== */
function keyOrder(pid) {
    var l = keyList(pid);
    if (l.length <= 1) return l.length ? [0] : [];
    var start = activeIndex(pid), out = [];
    for (var k = 0; k < l.length; k++) out.push((start + k) % l.length);
    var now = Date.now();
    out.sort(function (a, b) {
      var la = keyLimitUntil(pid, a), lb = keyLimitUntil(pid, b);
      var ea = la > now ? la : 0, eb = lb > now ? lb : 0;
      return ea - eb;
    });
    return out;
}
async function callWithKeys(pid, model, req, opts) {
    var prov = PROVIDERS[pid];
    var list = keyList(pid);
    if (!list.length || list.length === 1) {
      var single = list.length ? list[0] : '';
      var o0 = {}, k0;
      for (k0 in (opts || {})) o0[k0] = opts[k0];
      if (single) o0.key = single;
      var r0 = await prov.call(model, req, o0);
      if (r0 && r0.ok) clearKeyLimit(pid, 0);
      return r0;
    }
    var order = keyOrder(pid), last = null;
    for (var t = 0; t < order.length; t++) {
      var idx = order[t];
      var o = {}, kk;
      for (kk in (opts || {})) o[kk] = opts[kk];
      o.key = list[idx];
      var res = await prov.call(model, req, o);
      if (res && res.ok) {
        if (activeIndex(pid) !== idx) setActiveKey(pid, idx);
        clearKeyLimit(pid, idx);
        return res;
      }
      last = res;
      if (res && res.status === 429 && t < order.length - 1) {
        markKeyLimited(pid, idx, res);
        var label = PROVIDERS[pid].short || PROVIDERS[pid].label;
        toast(label + ' 키 ' + (idx + 1) + '이(가) 한도에 걸려 키 ' + (order[t + 1] + 1) + '(으)로 이어서 보냈어요.');
        continue;
      }
      if (res && res.status === 429) markKeyLimited(pid, idx, res);
      return res;
    }
    return last;
}
