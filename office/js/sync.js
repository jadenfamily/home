/* ============================================================================
   AI 사무실 — office/js/sync.js
   기기 연결 · 로그인 세션 · GitHub Contents API · 파일 캐시
   · office.html 이 css/style.css → js/state.js … js/boot.js 순서로 불러요.
     모듈끼리 같은 전역 스코프를 써요(함수 이름은 사무실 전체에서 하나).
   · 원래 office.html 한 덩어리 스크립트를 기능별로 나눈 파일이라 동작은 같아요.
   ============================================================================ */
'use strict';

/* ============ 기기 연결 정보 / 세션 ============ */
function loadDevice() {
    try {
      var j = JSON.parse(lsGet(K_DEVICE) || 'null');
      if (j && j.owner && j.repo && j.token) return { owner: j.owner, repo: j.repo, token: j.token, branch: j.branch || 'main', at: j.at || 0 };
    } catch (e) { /* 무시 */ }
    return null;
}
function loadUsersCache() { try { return JSON.parse(lsGet(K_USERS) || 'null'); } catch (e) { return null; } }
function saveUsersCache(u) { if (u) lsSet(K_USERS, JSON.stringify(u)); }
function loadShaCache() { try { return JSON.parse(lsGet(K_SHA) || '{}') || {}; } catch (e) { return {}; } }
function loadSession() {
    var raw = lsGet(K_SESSION), store = 'local';
    if (!raw) { raw = ssGet(K_SESSION); store = 'session'; }
    if (!raw) return null;
    var j = null;
    try { j = JSON.parse(raw); } catch (e) { j = null; }
    if (!j || !j.id) return null;
    var exp = Number(j.expiresAt) || 0;
    if (store === 'local' && (!exp || exp <= Date.now())) return null;
    return { id: String(j.id), name: String(j.name || j.id), role: String(j.role || 'viewer'), store: store, expiresAt: exp };
}
function clearSession() { lsDel(K_SESSION); ssDel(K_SESSION); }

function defaultDeviceName() {
    var ua = navigator.userAgent || '';
    var dev = /iPhone/.test(ua) ? '아이폰'
      : /iPad/.test(ua) ? '아이패드'
        : /Android/.test(ua) ? '안드로이드 폰'
          : /Macintosh/.test(ua) ? '맥'
            : /Windows/.test(ua) ? '윈도우 PC'
              : '브라우저';
    var br = /Edg\//.test(ua) ? 'Edge'
      : /Chrome\//.test(ua) ? 'Chrome'
        : /Safari\//.test(ua) ? 'Safari'
          : /Firefox\//.test(ua) ? 'Firefox' : '';
    return br ? dev + ' · ' + br : dev;
}
function ensureDeviceId() {
    var id = String(lsGet(K_DEVID) || '').trim();
    if (!/^[a-f0-9]{16,64}$/.test(id)) { id = randomHex(16); lsSet(K_DEVID, id); }
    S.deviceId = id;
    S.deviceName = defaultDeviceName();
    return id;
}

/* ============ GitHub Contents API ============ */
function ghHeaders(token) {
    return {
      'Authorization': 'Bearer ' + (token || (S.conn && S.conn.token) || ''),
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28'
    };
}
function repoBase(repo) { return API_BASE + '/repos/' + encodeURIComponent(S.conn.owner) + '/' + encodeURIComponent(repo); }
function encPath(path) { return String(path || '').split('/').map(encodeURIComponent).join('/'); }
function shaKey(repo, path) { return repo + '::' + path; }

/* 1MB가 넘는 파일은 contents 응답이 content 없이 sha만 와서 본문을 Git Blob에서 받아요.
     같은 sha를 한 화면에서 두 번 받지 않도록 받은 본문은 잠깐 들고 있어요(내용이 같으면 sha도 같아요). */
var BLOB_CACHE = {};
var BLOB_CACHE_MAX = 4;
async function ghGetBlobText(repo, sha, token) {
    var ck = String(repo) + '::' + String(sha);
    if (Object.prototype.hasOwnProperty.call(BLOB_CACHE, ck)) return { ok: true, raw: BLOB_CACHE[ck] };
    try {
      var res = await window.fetch(repoBase(repo) + '/git/blobs/' + encodeURIComponent(sha),
        { headers: ghHeaders(token), cache: 'no-store' });
      if (res.status === 401) return { ok: false, status: 401, error: '토큰이 올바르지 않아요' };
      if (res.status === 403) return { ok: false, status: 403, error: '권한이 없어요' };
      if (!res.ok) return { ok: false, status: res.status, error: 'HTTP ' + res.status };
      var blob = await res.json();
      var raw = blob && blob.content ? b64decodeUtf8(blob.content) : '';
      if (!raw) return { ok: false, status: res.status, error: '큰 파일의 내용을 받지 못했어요' };
      BLOB_CACHE[ck] = raw;
      var ks = Object.keys(BLOB_CACHE);
      while (ks.length > BLOB_CACHE_MAX) delete BLOB_CACHE[ks.shift()];
      return { ok: true, raw: raw };
    } catch (e) {
      return { ok: false, status: 0, error: '네트워크에 연결하지 못했어요' };
    }
}

async function ghGetAt(repo, path, token) {
    var url = repoBase(repo) + '/contents/' + encPath(path) + '?ref=' + encodeURIComponent((S.conn && S.conn.branch) || 'main') + '&_=' + Date.now();
    try {
      var res = await window.fetch(url, { headers: ghHeaders(token), cache: 'no-store' });
      if (res.status === 404) return { ok: true, missing: true };
      if (res.status === 401) return { ok: false, status: 401, error: '토큰이 올바르지 않아요' };
      if (res.status === 403) return { ok: false, status: 403, error: '권한이 없어요' };
      if (!res.ok) return { ok: false, status: res.status, error: 'HTTP ' + res.status };
      var j = await res.json();
      if (Object.prototype.toString.call(j) === '[object Array]') return { ok: true, list: j };
      var text = j && j.content ? b64decodeUtf8(j.content) : '';
      if (j && j.sha) S.sha[shaKey(repo, path)] = j.sha;
      if (j && j.sha && !text && (j.encoding === 'none' || Number(j.size) > 0)) {
        var big = await ghGetBlobText(repo, j.sha, token);
        if (!big.ok) return { ok: false, status: big.status, error: big.error };
        text = big.raw;
      }
      return { ok: true, raw: text, sha: j && j.sha };
    } catch (e) {
      return { ok: false, status: 0, error: '네트워크에 연결하지 못했어요' };
    }
}

async function ghGetJson(repo, path, token) {
    var r = await ghGetAt(repo, path, token);
    if (!r.ok || r.missing || r.list) return r;
    var data = null;
    try { data = JSON.parse(r.raw); } catch (e) { data = null; }
    r.data = data;
    return r;
}

async function ghPutAt(repo, path, text, message, token) {
    var payload = {
      message: message || ('업데이트: ' + path),
      content: b64encodeUtf8(String(text)),
      branch: (S.conn && S.conn.branch) || 'main'
    };
    var known = S.sha[shaKey(repo, path)];
    if (known) payload.sha = known;
    for (var attempt = 0; attempt < 3; attempt++) {
      try {
        var res = await window.fetch(repoBase(repo) + '/contents/' + encPath(path), {
          method: 'PUT', headers: ghHeaders(token), body: JSON.stringify(payload)
        });
        if (res.ok) {
          var j = await res.json();
          if (j && j.content && j.content.sha) S.sha[shaKey(repo, path)] = j.content.sha;
          return { ok: true };
        }
        if (res.status === 409 || res.status === 422 || res.status === 404) {
          var cur = await ghGetAt(repo, path, token);
          if (!cur.ok) return { ok: false, status: cur.status, error: cur.error };
          if (cur.missing) delete payload.sha;
          else payload.sha = cur.sha;
          continue;
        }
        if (res.status === 401) return { ok: false, status: 401, error: '토큰이 올바르지 않아요' };
        if (res.status === 403) return { ok: false, status: 403, error: '쓰기 권한이 없어요' };
        return { ok: false, status: res.status, error: 'HTTP ' + res.status };
      } catch (e) {
        return { ok: false, status: 0, error: '네트워크에 연결하지 못했어요' };
      }
    }
    return { ok: false, status: 409, error: '다른 기기에서 먼저 저장했어요' };
}
