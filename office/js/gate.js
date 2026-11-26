/* ============================================================================
   AI 사무실 — office/js/gate.js
   잠금 화면 · 자동 잠금 · 잠그기
   · office.html 이 css/style.css → js/state.js … js/boot.js 순서로 불러요.
     모듈끼리 같은 전역 스코프를 써요(함수 이름은 사무실 전체에서 하나).
   · 원래 office.html 한 덩어리 스크립트를 기능별로 나눈 파일이라 동작은 같아요.
   ============================================================================ */
'use strict';

/* ============ 자동 잠금 (마지막으로 쓴 때 + 설정한 시간) ============ */
function autoLockValid(v) {
    var m = Number(v);
    if (v === '' || v == null || isNaN(m)) return AUTO_LOCK_DEFAULT;
    for (var i = 0; i < AUTO_LOCK_STEPS.length; i++) if (AUTO_LOCK_STEPS[i] === m) return m;
    return AUTO_LOCK_DEFAULT;
}
function autoLockMins() {
    var m = Number((S.pref && S.pref.autoLock != null) ? S.pref.autoLock : AUTO_LOCK_DEFAULT);
    if (isNaN(m)) return AUTO_LOCK_DEFAULT;
    for (var i = 0; i < AUTO_LOCK_STEPS.length; i++) if (AUTO_LOCK_STEPS[i] === m) return m;
    return AUTO_LOCK_DEFAULT;
}
function autoLockLabel(m) { return m ? (m + '분') : '끄기'; }
function touchActivity() { S.lastActivityAt = Date.now(); }
function autoLockLeftMs() {
    var mins = autoLockMins();
    if (!mins) return 0;
    return Math.max(0, (S.lastActivityAt || Date.now()) + mins * 60000 - Date.now());
}
function autoLockIdle() {
    if (!S.unlocked || !S.chatKey) return false;
    var mins = autoLockMins();
    if (!mins) return false;
    /* 답을 만드는 중에는 잠그지 않아요 (만들던 답이 사라지지 않게) */
    for (var k in S.busy) { if (S.busy[k]) return false; }
    if (!S.lastActivityAt) { S.lastActivityAt = Date.now(); return false; }
    if (Date.now() - S.lastActivityAt < mins * 60000) return false;
    lockNow(true, '설정한 ' + mins + '분이 지나 안전하게 잠겼어요. 다시 열려면 비밀번호나 6자리 번호를 넣어 주세요.');
    return true;
}

/* ==================================================================
     잠금 화면
     ================================================================== */
function showGate(mode) {
    S.gateMode = mode;
    S.gateAlt = false;
    var app = document.getElementById('appRoot');
    var gate = document.getElementById('gateScreen');
    if (app) app.hidden = true;
    if (gate) gate.hidden = false;
    renderGate();
}
function renderGate() {
    var sub = document.getElementById('gateSub');
    var body = document.getElementById('gateBody');
    var msg = document.getElementById('gateMsg');
    if (!sub || !body) return;
    if (msg) { msg.textContent = ''; msg.className = 'gate-msg'; }
    var mode = S.gateMode;
    if (mode === 'noconn') {
      sub.textContent = '이 기기에서 먼저 우리 집 연결이 필요해요.';
      body.innerHTML = '<p class="gate-note">우리 집 화면에서 한 번만 연결해 주세요. 연결은 그대로 이어져요.</p>';
      return;
    }
    if (mode === 'noauth') {
      sub.textContent = '먼저 우리 집에 로그인해 주세요.';
      body.innerHTML = '<p class="gate-note">로그인한 계정으로 바로 이어서 열려요.</p>';
      return;
    }
    if (mode === 'admin') {
      sub.textContent = 'AI 사무실은 관리자만 쓸 수 있어요.';
      body.innerHTML = '<p class="gate-note">관리자 계정으로 로그인하면 열 수 있어요.</p>';
      return;
    }
    var deviceMode = (mode === 'device');
    var totpOn = !!(S.totp && S.totp.enabled && S.totp.cfg);
    var bioTop = bioGateHtml();
    if (totpOn && !S.gateAlt) {
      sub.textContent = deviceMode
        ? '처음 보는 기기예요. 인증 앱의 6자리 번호로 확인하면 이 기기를 등록해요.'
        : '인증 앱(구글 인증 앱·아이폰 암호)의 6자리 번호를 넣어 주세요.';
      body.innerHTML = bioTop +
        '<form class="gate-form" id="gateTotpForm" autocomplete="on">' +
        '<input class="gate-hide-user" type="text" name="username" autocomplete="username" value="' + esc(S.me ? S.me.id : '') + '" readonly tabindex="-1" aria-hidden="true">' +
        (deviceMode ? '<label>이 기기 이름<input id="gateDevName" name="devicename" maxlength="40" value="' + esc(S.deviceName) + '" spellcheck="false" autocomplete="off"></label>' : '') +
        '<label>6자리 인증 번호<input id="gateTotp" name="totp" type="text" inputmode="numeric" autocomplete="one-time-code" maxlength="6" pattern="[0-9]*" placeholder="123456" spellcheck="false" enterkeyhint="done" style="letter-spacing:.32em;font-size:22px;font-weight:900;text-align:center"></label>' +
        '<button class="gate-paste" type="button" data-act="gate-paste">📋 붙여넣기</button>' +
        '<button class="gate-btn" type="submit" id="gateTotpBtn">' + (deviceMode ? '이 기기 등록하고 열기' : '열기') + '</button>' +
        '</form>' +
        '<button class="gate-alt" type="button" data-act="gate-alt">비밀번호로 ' + (deviceMode ? '등록' : '해제') + '</button>' +
        '<p class="gate-note">' + (deviceMode ? '등록된 기기는 설정에서 언제든 해제할 수 있어요.'
          : '번호는 30초마다 새로 바뀌어요. 인증 앱을 열면 바로 나와요.') + '</p>';
      var tEl = document.getElementById('gateTotp');
      if (tEl && !bioTop) { try { tEl.focus(); } catch (e) { /* 무시 */ } }
      return;
    }
    sub.textContent = deviceMode
      ? '처음 보는 기기예요. 관리자 비밀번호를 한 번 더 확인하면 이 기기를 등록해요.'
      : '사무실을 열려면 관리자 비밀번호를 한 번 더 넣어 주세요.';
    var altBtn = totpOn ? '<button class="gate-alt" type="button" data-act="gate-alt">6자리 번호로 ' + (deviceMode ? '등록' : '해제') + '</button>' : '';
    var loadNote = (S.totp && S.totp.ok === false)
      ? '<p class="gate-note" style="color:#b93b57">2차 인증 상태를 확인하지 못했어요. 비밀번호로 열 수 있어요.</p>' : '';
    body.innerHTML = bioTop +
      '<form class="gate-form" id="gateForm" autocomplete="off">' +
      (deviceMode ? '<label>이 기기 이름<input id="gateDevName" maxlength="40" value="' + esc(S.deviceName) + '" spellcheck="false"></label>' : '') +
      '<label>관리자 비밀번호<input id="gatePw" type="password" maxlength="64" autocomplete="current-password" placeholder="비밀번호"></label>' +
      '<button class="gate-btn" type="submit" id="gateBtn">' + (deviceMode ? '이 기기 등록하고 열기' : '열기') + '</button>' +
      '</form>' + altBtn + loadNote +
      '<p class="gate-note">' + (deviceMode ? '등록된 기기는 설정에서 언제든 해제할 수 있어요.'
        : '비밀번호는 기록을 잠그는 열쇠로만 쓰고, 어디에도 저장하지 않아요.') + '</p>';
    var el = document.getElementById('gatePw');
    if (el && !bioTop) { try { el.focus(); } catch (e) { /* 무시 */ } }
}
function gateFail(text, ok) {
    var msg = document.getElementById('gateMsg');
    if (!msg) return;
    msg.textContent = text;
    msg.className = 'gate-msg' + (ok ? ' ok' : '');
}
async function submitGate() {
    var pw = fieldVal('gatePw');
    var name = fieldVal('gateDevName') || S.deviceName;
    var btn = document.getElementById('gateBtn');
    if (!pw) return gateFail('비밀번호를 넣어 주세요.');
    if (btn) { btn.disabled = true; btn.textContent = '확인하는 중…'; }
    try {
      await freshUsers();
      var u = findUser(S.me.id);
      if (!u || !u.salt || !u.hash) return gateFail('계정 정보를 확인하지 못했어요.');
      if (String(u.role) !== 'admin') return gateFail('관리자 계정만 열 수 있어요.');
      var hash = await hashPassword(pw, u.salt);
      if (hash !== u.hash) return gateFail('비밀번호가 맞지 않아요.');
      var envRes = await readThreadsEnvelope();
      if (!envRes.ok) return gateFail(envRes.error || '사무실 열쇠를 확인하지 못했어요.');
      if (envRes.env) {
        S.chatSalt = b64dec(envRes.env.salt);
        S.chatIter = clamp(Number(envRes.env.iter) || CHAT_ITER, 1000, 1000000);
      } else {
        S.chatSalt = window.crypto.getRandomValues(new Uint8Array(16));
        S.chatIter = CHAT_ITER;
      }
      S.chatKey = await chatKeyFrom(pw, S.chatSalt, S.chatIter);
      if (envRes.env) {
        try { await chatDecrypt(envRes.env); }
        catch (e) { S.chatKey = null; return gateFail('이 계정의 기록을 열지 못했어요. 비밀번호를 다시 확인해 주세요.'); }
      }
      S.unlocked = true;
      touchActivity();
      if (S.totp && S.totp.enabled) await rewrapTotpKey();
      await bioRefreshKey();
      if (S.gateMode === 'device') {
        var reg = await registerDevice(name);
        if (!reg.ok) toast('기기 등록을 저장하지 못했어요. 다음에 다시 확인할게요.');
      }
      await enterOffice();
    } catch (e) {
      gateFail('열지 못했어요. ' + (e && e.message ? e.message : ''));
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = (btn.textContent === '확인하는 중…') ? '열기' : btn.textContent; }
    }
}
async function enterOffice() {
    var gate = document.getElementById('gateScreen');
    var app = document.getElementById('appRoot');
    if (gate) gate.hidden = true;
    if (app) app.hidden = false;
    touchActivity();
    S.loaded = true;
    document.body.setAttribute('data-tab', S.tab || 'office');
    renderTop();
    var ai = await loadAiConfig();
    if (ai && ai.locked) toast('AI 설정을 열지 못했어요. 설정에서 키를 다시 저장해 주세요.');
    await loadInbox();
    var off = await loadOffice();
    if (!off.ok) {
      S.office = blankOffice();
      if (off.locked) {
        S.officeLocked = true;
        toast('사무실 기록을 열지 못했어요. 덮어쓰지 않도록 저장을 잠가 둘게요.');
      } else if (off.error) {
        toast(off.error);
      }
    }
    renderAll();
    if (hasLiveWork()) { S.bg.liveAt = Date.now(); startPolling(); }
    noticeSweep();
    if (!cachedModels()) refreshModels().then(function () { renderAll(); }).catch(function () { /* 무시 */ });
}
function enterChat() { return enterOffice(); }

function lockNow(silent, note) {
    S.unlocked = false;
    S.chatKey = null;
    S.chatSalt = null;
    S.loaded = false;
    S.office = null;
    S.officeLocked = false;
    S.inbox = { ok: false, items: [], error: '', at: 0 };
    S.busy = {};
    S.queue = [];
    S.running = false;
    S.rejectOpen = {};
    S.details = {};
    S.draft = { team: 'cs', title: '', text: '', material: '' };
    S.teamModal = null;
    S.directHint = '';
    S.pipe = [];
    S.pipeRunning = false;
    S.planQueue = [];
    S.planRunning = false;
    stopPolling();
    S.bg.lastSha = '';
    S.bg.kick = {};
    S.bg.watch = {};
    S.bg.stopping = {};
    S.bg.notified = {};
    S.bg.watchAt = 0;
    var tmo = document.getElementById('teamModal');
    if (tmo) tmo.hidden = true;
    document.body.style.overflow = '';
    document.documentElement.style.overflow = '';
    S.lastActivityAt = 0;
    ssDel(K_UNLOCK);
    closeSettings();
    var ov = document.getElementById('officeView');
    if (ov) ov.innerHTML = '';
    var pv = document.getElementById('panel');
    if (pv) pv.innerHTML = '';
    showGate('unlock');
    if (note) gateFail(note, true);
    else if (!silent) toast('잠갔어요. 다시 열려면 비밀번호가 필요해요.');
}
function logout() {
    clearSession();
    ssDel(K_UNLOCK);
    S.me = null;
    S.chatKey = null;
    S.unlocked = false;
    window.location.href = './index.html';
}
