/* ============================================================================
   AI 사무실 — office/js/boot.js
   시작 — 환경 설정 불러오기 · 첫 렌더 · 1초 틱
   · office.html 이 css/style.css → js/state.js … js/boot.js 순서로 불러요.
     모듈끼리 같은 전역 스코프를 써요(함수 이름은 사무실 전체에서 하나).
   · 원래 office.html 한 덩어리 스크립트를 기능별로 나눈 파일이라 동작은 같아요.
   ============================================================================ */
'use strict';

/* ==================================================================
     시작
     ================================================================== */
function loadPref() {
    var j = null;
    try { j = JSON.parse(lsGet(K_PREF) || 'null'); } catch (e) { j = null; }
    if (!j || typeof j !== 'object') j = {};
    S.pref = {
      model: String(j.model || ''),
      instructions: String(j.instructions || ''),
      autoLock: autoLockValid(j.autoLock)
    };
    var lim = null;
    try { lim = JSON.parse(lsGet(K_LIMITS) || 'null'); } catch (e) { lim = null; }
    S.limits = (lim && typeof lim === 'object') ? lim : {};
}
function savePref() {
    lsSet(K_PREF, JSON.stringify(S.pref));
    lsSet(K_LIMITS, JSON.stringify(S.limits));
}

async function init() {
    ensureDeviceId();
    loadDead();
    S.conn = loadDevice();
    S.users = loadUsersCache();
    loadPref();
    if (!S.conn) { showGate('noconn'); return; }
    var sess = loadSession();
    if (!sess) { showGate('noauth'); return; }
    await freshUsers();
    var u = findUser(sess.id);
    if (!u) { showGate('noauth'); return; }
    if (String(u.role) !== 'admin') { showGate('admin'); return; }
    S.me = { id: u.id, name: u.name || u.id, role: 'admin' };
    S.totp = await loadTotpConfig(u.id);
    var devs = await loadDevices();
    S.devices = devs.devices || [];
    var known = devs.ok ? deviceKnown(S.devices, S.deviceId, S.me.id) : null;
    if (!known) { showGate('device'); return; }
    showGate('unlock');
}

window.addEventListener('beforeunload', function () {
    if (S.unlocked && S.office && S.chatKey && !S.officeLocked) {
      try { saveOffice(); } catch (e) { /* 무시 */ }
    }
});

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();
window.setInterval(tick, 1000);
