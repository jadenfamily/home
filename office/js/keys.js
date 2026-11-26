/* ============================================================================
   AI 사무실 — office/js/keys.js
   AI 키 · AI 설정 · 계정 확인 · 대화 보관함 경로
   · office.html 이 css/style.css → js/state.js … js/boot.js 순서로 불러요.
     모듈끼리 같은 전역 스코프를 써요(함수 이름은 사무실 전체에서 하나).
   · 원래 office.html 한 덩어리 스크립트를 기능별로 나눈 파일이라 동작은 같아요.
   ============================================================================ */
'use strict';

/* ===== AI 키·AI 설정 (chat.html에서 승계) ===== */
function emptyKeys() { return { gemini: [], openrouter: [], groq: [] }; }
function normalizeKeys(list) {
    var out = [];
    for (var i = 0; i < list.length; i++) {
      var v = String(list[i] == null ? '' : list[i]).trim();
      if (v && out.indexOf(v) < 0) out.push(v);
    }
    return out;
}
function keysFromConfig(obj) {
    var keys = emptyKeys(), active = { gemini: 0, openrouter: 0, groq: 0 };
    for (var i = 0; i < PROVIDER_ORDER.length; i++) {
      var pid = PROVIDER_ORDER[i];
      var arr = obj[pid + 'Keys'];
      var list = (Object.prototype.toString.call(arr) === '[object Array]') ? normalizeKeys(arr) : [];
      if (!list.length) {
        var single = String((pid === 'gemini' ? (obj.key || obj.gemini) : obj[pid]) || '').trim();
        if (single) list = [single];
      }
      keys[pid] = list;
    }
    var act = (obj && obj.activeKey) || {};
    for (i = 0; i < PROVIDER_ORDER.length; i++) {
      var p2 = PROVIDER_ORDER[i];
      var n = Number(act[p2]);
      active[p2] = (n >= 0 && n < keys[p2].length) ? n : 0;
    }
    return { keys: keys, active: active };
}
function keyList(pid) {
    if (!S.ai.keys) S.ai.keys = emptyKeys();
    if (!S.ai.keys[pid]) S.ai.keys[pid] = [];
    return S.ai.keys[pid];
}
function activeIndex(pid) {
    var l = keyList(pid);
    var i = Number(S.ai.active && S.ai.active[pid]);
    if (isNaN(i) || i < 0 || i >= l.length) i = 0;
    return i;
}
function setActiveKey(pid, i) {
    if (!S.ai.active) S.ai.active = {};
    S.ai.active[pid] = i;
    saveKeyState();
    renderModelBtn();
}
function maskKey(k) {
    var t = String(k || '');
    if (t.length <= 4) return '····';
    return '····' + t.slice(-4);
}
function keyLimitUntil(pid, i) {
    var m = (S.keyLimit && S.keyLimit[pid]) || {};
    return Number(m[i]) || 0;
}
function clearKeyLimit(pid, i) {
    if (S.keyLimit && S.keyLimit[pid] && S.keyLimit[pid][i]) { delete S.keyLimit[pid][i]; saveKeyState(); }
}
function markKeyLimited(pid, i, res) {
    if (!S.keyLimit) S.keyLimit = {};
    if (!S.keyLimit[pid]) S.keyLimit[pid] = {};
    var h = (res && res.headers) || {};
    var wait = parseDur(h['retry-after']);
    if (wait == null) wait = 60000;
    S.keyLimit[pid][i] = Date.now() + clamp(wait, 1000, 86400000);
    saveKeyState();
}
function loadKeyState() {
    var j = null;
    try { j = JSON.parse(lsGet(K_KEYSTATE) || 'null'); } catch (e) { j = null; }
    S.keyLimit = (j && j.limit && typeof j.limit === 'object') ? j.limit : {};
    if (j && j.active && typeof j.active === 'object' && S.ai && S.ai.active) {
      for (var i = 0; i < PROVIDER_ORDER.length; i++) {
        var pid = PROVIDER_ORDER[i], n = Number(j.active[pid]);
        if (!isNaN(n) && n >= 0 && n < keyList(pid).length) S.ai.active[pid] = n;
      }
    }
}
function saveKeyState() {
    lsSet(K_KEYSTATE, JSON.stringify({ active: (S.ai && S.ai.active) || {}, limit: S.keyLimit || {} }));
}

async function loadAiConfig() {
    var r = await ghGetJson(DEFAULT_REPO, PATH_AI, null);
    if (!r.ok) return { ok: false, error: r.error || 'AI 설정을 읽지 못했어요' };
    if (r.missing) {
      S.ai = { gemini: '', openrouter: '', groq: '', codeToken: '', at: 0, present: false, keys: emptyKeys(), active: { gemini: 0, openrouter: 0, groq: 0 } };
      loadKeyState();
      return { ok: true, missing: true };
    }
    var obj = null;
    try { obj = await familyDecrypt(r.data); } catch (e) { obj = null; }
    if (!obj) {
      S.ai = { gemini: '', openrouter: '', groq: '', codeToken: '', at: 0, present: true, error: '설정을 열지 못했어요', keys: emptyKeys(), active: { gemini: 0, openrouter: 0, groq: 0 } };
      return { ok: true, locked: true };
    }
    var kc = keysFromConfig(obj);
    S.ai = {
      gemini: kc.keys.gemini[0] || '',
      openrouter: kc.keys.openrouter[0] || '',
      groq: kc.keys.groq[0] || '',
      codeToken: String(obj.codeToken || ''),
      at: Date.parse(obj.updatedAt || '') || 0,
      present: true,
      keys: kc.keys,
      active: kc.active
    };
    loadKeyState();
    return { ok: true };
}
async function saveAiConfig(next) {
    var keys = next.keys || emptyKeys();
    var first = { gemini: (keys.gemini || [])[0] || '', openrouter: (keys.openrouter || [])[0] || '', groq: (keys.groq || [])[0] || '' };
    var payload = {
      key: first.gemini,
      gemini: first.gemini,
      openrouter: first.openrouter,
      groq: first.groq,
      codeToken: String(next.codeToken || ''),
      updatedAt: nowIso()
    };
    for (var i = 0; i < PROVIDER_ORDER.length; i++) {
      var pid = PROVIDER_ORDER[i];
      payload[pid + 'Keys'] = keys[pid] || [];
    }
    var env = await familyEncrypt(payload);
    var w = await ghPutAt(DEFAULT_REPO, PATH_AI, JSON.stringify(env, null, 2), 'AI 사무실 설정 저장', null);
    if (!w.ok) return { ok: false, error: w.error || '저장하지 못했어요' };
    S.ai = {
      gemini: first.gemini, openrouter: first.openrouter, groq: first.groq,
      codeToken: payload.codeToken, at: Date.now(), present: true,
      keys: { gemini: (keys.gemini || []).slice(), openrouter: (keys.openrouter || []).slice(), groq: (keys.groq || []).slice() },
      active: S.ai.active || { gemini: 0, openrouter: 0, groq: 0 }
    };
    return { ok: true };
}

/* ===== 계정 보관함 봉투 읽기 (chat.html에서 승계) ===== */
function threadsPath() { return PATH_THREADS + String(S.me.id) + '/threads.json'; }

async function readThreadsEnvelope() {
    var r = await ghGetAt(DEFAULT_REPO, threadsPath(), null);
    if (!r.ok) return { ok: false, error: r.error || '대화를 읽지 못했어요' };
    if (r.missing) return { ok: true, missing: true };
    var env = null;
    try { env = JSON.parse(r.raw); } catch (e) { env = null; }
    if (!env || !env.ct) return { ok: false, error: '대화 보관함 형식을 읽지 못했어요' };
    return { ok: true, env: env };
}

/* ===== 계정 확인 (chat.html에서 승계) ===== */
function findUser(id) {
    var users = (S.users && S.users.users) || [];
    var key = String(id || '').toLowerCase();
    for (var i = 0; i < users.length; i++) {
      if (String(users[i].id).toLowerCase() === key) return users[i];
    }
    return null;
}

async function freshUsers() {
    try {
      var r = await ghGetJson(DEFAULT_REPO, 'config/users.json', null);
      if (r.ok && r.data && Object.prototype.toString.call(r.data.users) === '[object Array]') {
        S.users = r.data;
        saveUsersCache(r.data);
      }
    } catch (e) { /* 캐시로 계속 */ }
    return (S.users && S.users.users) || [];
}
