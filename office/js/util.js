/* ============================================================================
   AI 사무실 — office/js/util.js
   저장소 이름·경로 다듬기 · 공통 도구(문자·시간·해시·base64·토스트)
   · office.html 이 css/style.css → js/state.js … js/boot.js 순서로 불러요.
     모듈끼리 같은 전역 스코프를 써요(함수 이름은 사무실 전체에서 하나).
   · 원래 office.html 한 덩어리 스크립트를 기능별로 나눈 파일이라 동작은 같아요.
   ============================================================================ */
'use strict';

/* ===== 저장소 이름·경로 다듬기 (chat.html에서 승계) ===== */
function normRepo(v) {
    var raw = String(v == null ? '' : v).trim();
    if (!raw) return '';
    var s = raw.toLowerCase().replace(/[?#].*$/, '').replace(/\s+/g, '').replace(/\/+$/, '');
    var tokens = s.split(/[\/]+/), i, k, t;
    for (i = tokens.length - 1; i >= 0; i--) {
      t = tokens[i].replace(/\.git$/, '');
      if (!t) continue;
      for (k = 0; k < CODE_REPOS.length; k++) if (t === CODE_REPOS[k]) return CODE_REPOS[k];
    }
    for (i = tokens.length - 1; i >= 0; i--) {
      t = tokens[i].replace(/\.git$/, '');
      if (t && REPO_ALIAS[t]) return REPO_ALIAS[t];
      if (t && t.indexOf('jadenfamily.') >= 0) continue;
    }
    /* github.io 호스트만 준 경우(https://jadenfamily.github.io/)는 홈 저장소예요 */
    if (/^https?:\/\/[^\/]*jadenfamily\.github\.io\/?$/.test(raw.toLowerCase())) return 'home';
    t = (tokens[tokens.length - 1] || '').replace(/\.git$/, '');
    return t;
}
/* jadenfamily/home/chat.html · 전체 주소 · 앞에 붙은 저장소 이름을 걷어 내요 */
function normPath(repo, p) {
    var s = String(p == null ? '' : p).trim();
    if (!s) return '';
    s = s.replace(/^(?:https?:\/\/)?(?:www\.)?github\.com\/[^\/]+\/[^\/]+\/(?:blob|tree|raw)\/[^\/]+\//i, '');
    s = s.replace(/^https?:\/\/[^\/]+\//i, '');
    s = s.replace(/[?#].*$/, '');
    s = s.replace(/^\/+/, '');
    var r = String(repo || '').toLowerCase();
    if (r && s.toLowerCase().indexOf(r + '/') === 0) s = s.slice(r.length + 1);
    return s;
}

/* ===== 공통 도구·기기·세션·GitHub API·암호화·자동 잠금 (chat.html에서 승계) ===== */
function pad2(n) { return (n < 10 ? '0' : '') + n; }
function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      if (c === '&') return '&amp;';
      if (c === '<') return '&lt;';
      if (c === '>') return '&gt;';
      if (c === '"') return '&quot;';
      return '&#39;';
    });
}
function nowIso() { return new Date().toISOString(); }
function lsGet(k) { try { return window.localStorage.getItem(k); } catch (e) { return null; } }
function lsSet(k, v) { try { window.localStorage.setItem(k, v); return true; } catch (e) { return false; } }
function lsDel(k) { try { window.localStorage.removeItem(k); } catch (e) { /* 무시 */ } }
function ssGet(k) { try { return window.sessionStorage.getItem(k); } catch (e) { return null; } }
function ssSet(k, v) { try { window.sessionStorage.setItem(k, v); return true; } catch (e) { return false; } }
function ssDel(k) { try { window.sessionStorage.removeItem(k); } catch (e) { /* 무시 */ } }
function fieldVal(id) { var el = document.getElementById(id); return el ? String(el.value == null ? '' : el.value) : ''; }
function uid(prefix) { return (prefix || '') + randomHex(6); }
function clamp(n, a, b) { return Math.max(a, Math.min(b, n)); }

function randomHex(n) {
    var bytes = new Uint8Array(n);
    if (window.crypto && window.crypto.getRandomValues) window.crypto.getRandomValues(bytes);
    else for (var i = 0; i < n; i++) bytes[i] = Math.floor(Math.random() * 256);
    return bytesToHex(bytes);
}
function bytesToHex(bytes) {
    var s = '';
    for (var i = 0; i < bytes.length; i++) s += ('0' + bytes[i].toString(16)).slice(-2);
    return s;
}
function b64enc(buf) {
    var b = new Uint8Array(buf), s = '', i;
    for (i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
    return window.btoa(s);
}
function b64dec(txt) {
    var bin = window.atob(String(txt || '').replace(/\s/g, '')), i;
    var out = new Uint8Array(bin.length);
    for (i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
}
function b64encodeUtf8(str) {
    var bytes = new TextEncoder().encode(String(str)), bin = '', i;
    for (i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return window.btoa(bin);
}
function b64decodeUtf8(b64) {
    var bin = window.atob(String(b64 || '').replace(/\s/g, ''));
    var bytes = new Uint8Array(bin.length), i;
    for (i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    if (window.TextDecoder) return new TextDecoder('utf-8').decode(bytes);
    return decodeURIComponent(escape(bin));
}
async function sha256Hex(text) {
    if (!(window.crypto && window.crypto.subtle && window.crypto.subtle.digest)) {
      throw new Error('이 브라우저에서는 암호화 기능을 쓸 수 없어요. Safari/Chrome을 최신 버전으로 올려 주세요.');
    }
    var buf = await window.crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(text)));
    return bytesToHex(new Uint8Array(buf));
}
function hashPassword(pw, salt) { return sha256Hex(String(salt) + ':' + String(pw)); }

function fmtWhen(iso) {
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    return (d.getMonth() + 1) + '월 ' + d.getDate() + '일 ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes());
}
function fmtClock(ts) {
    var d = new Date(ts);
    return pad2(d.getHours()) + ':' + pad2(d.getMinutes());
}
function fmtLeft(ms) {
    if (ms <= 0) return '0초';
    var s = Math.ceil(ms / 1000);
    if (s < 60) return s + '초';
    var m = Math.floor(s / 60), r = s % 60;
    if (m < 60) return m + '분' + (r ? ' ' + r + '초' : '');
    var h = Math.floor(m / 60);
    return h + '시간' + (m % 60 ? ' ' + (m % 60) + '분' : '');
}

function toast(text) {
    var el = document.getElementById('toast');
    if (!el) return;
    var msg = String(text == null ? '' : text);
    if (msg.length > 140) msg = msg.slice(0, 137) + '…';
    el.textContent = msg;
    /* 입력창(붙인 파일 칩 포함) 바로 위에 띄워요 — 설정 창이 열려 있으면 창을 가리지 않게 아래쪽에 */
    var modal = null;
    var ids = ['settingsModal', 'modelModal', 'personaModal'];
    for (var k = 0; k < ids.length; k++) {
      var mm = document.getElementById(ids[k]);
      if (mm && !mm.hidden) { modal = mm; break; }
    }
    try {
      if (modal) {
        el.style.bottom = 'calc(18px + env(safe-area-inset-bottom,0px))';
      } else {
        el.style.maxWidth = '';
        var comp = document.querySelector('.composer');
        if (comp) {
          var r = comp.getBoundingClientRect();
          el.style.bottom = Math.max(14, window.innerHeight - r.top + 10) + 'px';
        } else {
          el.style.bottom = '';
        }
      }
    } catch (e2) { /* 무시 */ }
    el.classList.add('show');
    window.clearTimeout(toast.t);
    toast.t = window.setTimeout(function () { el.classList.remove('show'); }, 2600);
}
