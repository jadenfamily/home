/* ============================================================================
   AI 사무실 — office/js/totp.js
   2차 인증(구글 인증 앱 6자리) 등록·확인
   · office.html 이 css/style.css → js/state.js … js/boot.js 순서로 불러요.
     모듈끼리 같은 전역 스코프를 써요(함수 이름은 사무실 전체에서 하나).
   · 원래 office.html 한 덩어리 스크립트를 기능별로 나눈 파일이라 동작은 같아요.
   ============================================================================ */
'use strict';

/* ===== 2차 인증(TOTP) (chat.html에서 승계) ===== */
function totpPath(userId) { return 'config/totp-' + String(userId || '').replace(/[^a-zA-Z0-9._-]/g, '') + '.json'; }
function b32encode(bytes) {
    var A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567', out = '', bits = 0, val = 0;
    for (var i = 0; i < bytes.length; i++) {
      val = (val << 8) | bytes[i];
      bits += 8;
      while (bits >= 5) {
        out += A[(val >>> (bits - 5)) & 31];
        bits -= 5;
      }
    }
    if (bits > 0) out += A[(val << (5 - bits)) & 31];
    return out;
}
function b32decode(text) {
    var A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
    var s = String(text || '').toUpperCase().replace(/[^A-Z2-7]/g, '');
    var out = [], bits = 0, val = 0;
    for (var i = 0; i < s.length; i++) {
      var idx = A.indexOf(s.charAt(i));
      if (idx < 0) continue;
      val = (val << 5) | idx;
      bits += 5;
      if (bits >= 8) {
        out.push((val >>> (bits - 8)) & 255);
        bits -= 8;
      }
    }
    return new Uint8Array(out);
}
function randomSecret() {
    var b = new Uint8Array(20);
    if (window.crypto && window.crypto.getRandomValues) window.crypto.getRandomValues(b);
    else for (var i = 0; i < b.length; i++) b[i] = Math.floor(Math.random() * 256);
    return b32encode(b);
}
function totpLabel(userId) { return 'jadenfamily AI:' + String(userId || ''); }
function totpUri(secret, userId) {
    return 'otpauth://totp/' + encodeURIComponent(totpLabel(userId)).replace(/%3A/g, ':') +
      '?secret=' + encodeURIComponent(secret) + '&issuer=' + encodeURIComponent(TOTP_ISSUER) +
      '&algorithm=SHA1&digits=' + TOTP_DIGITS + '&period=' + TOTP_PERIOD;
}
async function totpAt(secret, atMs) {
    var sub = subtle();
    if (!sub) throw new Error('이 브라우저에서는 인증 기능을 쓸 수 없어요');
    var counter = Math.floor((atMs == null ? Date.now() : Number(atMs)) / 1000 / TOTP_PERIOD);
    var msg = new Uint8Array(8);
    var hi = Math.floor(counter / 4294967296), lo = counter >>> 0;
    msg[0] = (hi >>> 24) & 255; msg[1] = (hi >>> 16) & 255; msg[2] = (hi >>> 8) & 255; msg[3] = hi & 255;
    msg[4] = (lo >>> 24) & 255; msg[5] = (lo >>> 16) & 255; msg[6] = (lo >>> 8) & 255; msg[7] = lo & 255;
    var key = await sub.importKey('raw', b32decode(secret), { name: 'HMAC', hash: { name: 'SHA-1' } }, false, ['sign']);
    var mac = new Uint8Array(await sub.sign('HMAC', key, msg));
    var off = mac[mac.length - 1] & 15;
    var num = ((mac[off] & 127) << 24) | (mac[off + 1] << 16) | (mac[off + 2] << 8) | mac[off + 3];
    var code = String(num % Math.pow(10, TOTP_DIGITS));
    while (code.length < TOTP_DIGITS) code = '0' + code;
    return code;
}
async function totpVerify(secret, code, atMs) {
    var c = String(code == null ? '' : code).replace(/\D/g, '');
    if (c.length !== TOTP_DIGITS || !secret) return false;
    var base = atMs == null ? Date.now() : Number(atMs);
    for (var d = -1; d <= 1; d++) {
      try {
        if (await totpAt(secret, base + d * TOTP_PERIOD * 1000) === c) return true;
      } catch (e) { return false; }
    }
    return false;
}
async function totpKek(secret, salt, iter) {
    var sub = subtle();
    if (!sub) throw new Error('이 브라우저에서는 인증 기능을 쓸 수 없어요');
    var raw = new TextEncoder().encode('jadenfamily-totp-v1:' + String(secret || '').toUpperCase());
    var base = await sub.importKey('raw', raw, { name: 'PBKDF2' }, false, ['deriveKey']);
    return sub.deriveKey({
      name: 'PBKDF2', salt: salt, iterations: clamp(Number(iter) || TOTP_ITER, 10000, 1000000), hash: 'SHA-256'
    }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
function totpAad(userId) { return new TextEncoder().encode('totp:' + String(userId)); }
async function wrapChatKey(secret, key, userId, iter) {
    var sub = subtle();
    var raw = new Uint8Array(await sub.exportKey('raw', key));
    var salt = window.crypto.getRandomValues(new Uint8Array(16));
    var iv = window.crypto.getRandomValues(new Uint8Array(12));
    var kek = await totpKek(secret, salt, iter);
    var ct = await sub.encrypt({ name: 'AES-GCM', iv: iv, additionalData: totpAad(userId) }, kek, raw);
    return { kdf: 'PBKDF2-SHA256', kdfIter: clamp(Number(iter) || TOTP_ITER, 10000, 1000000), salt: b64enc(salt), iv: b64enc(iv), wrappedKey: b64enc(ct) };
}
async function unwrapChatKey(cfg) {
    var sub = subtle();
    if (!cfg || !cfg.secret || !cfg.wrappedKey) throw new Error('2차 인증 열쇠가 없어요');
    var kek = await totpKek(cfg.secret, b64dec(cfg.salt), cfg.kdfIter);
    var raw = await sub.decrypt({ name: 'AES-GCM', iv: b64dec(cfg.iv), additionalData: totpAad(cfg.userId) }, kek, b64dec(cfg.wrappedKey));
    return sub.importKey('raw', new Uint8Array(raw), { name: 'AES-GCM' }, true, ['encrypt', 'decrypt']);
}

function totpSeen(userId) {
    var j = null;
    try { j = JSON.parse(lsGet(K_TOTP_SEEN) || '{}'); } catch (e) { j = null; }
    return !!(j && j[userId]);
}
function rememberTotpSeen(userId, on) {
    var j = null;
    try { j = JSON.parse(lsGet(K_TOTP_SEEN) || '{}'); } catch (e) { j = null; }
    if (!j || typeof j !== 'object') j = {};
    j[userId] = !!on;
    lsSet(K_TOTP_SEEN, JSON.stringify(j));
}

async function loadTotpConfig(userId) {
    var r = await ghGetJson(DEFAULT_REPO, totpPath(userId), null);
    if (!r.ok) {
      var seen = totpSeen(userId);
      return { ok: false, present: seen, enabled: seen, cfg: null, error: r.error || '2차 인증 설정을 읽지 못했어요' };
    }
    if (r.missing) { rememberTotpSeen(userId, false); return { ok: true, present: false, enabled: false, cfg: null }; }
    var cfg = r.data || null;
    var on = !!(cfg && cfg.enabled && cfg.secret && cfg.wrappedKey);
    rememberTotpSeen(userId, on);
    return { ok: true, present: !!cfg, enabled: on, cfg: cfg };
}
async function saveTotpConfig(cfg) {
    var w = await ghPutAt(DEFAULT_REPO, totpPath(cfg.userId), JSON.stringify(cfg, null, 2),
      (cfg.enabled ? 'AI 사무실 2차 인증 켜기: ' : 'AI 사무실 2차 인증 끄기: ') + String(cfg.userId || ''));
    return w.ok ? { ok: true } : { ok: false, error: w.error || '2차 인증 설정을 저장하지 못했어요' };
}

/* 켜기: 열쇠 만들기 → QR·열쇠 보여 주기 → 번호 한 번 확인 → 저장 */
function totpBeginSetup() {
    if (!S.me) return;
    var secret = randomSecret();
    S.totpSetup = { secret: secret, uri: totpUri(secret, S.me.id), at: Date.now() };
    S.totpMsg = '';
    S.totpOff = false;
    renderSettings();
}
function totpCancelSetup() {
    S.totpSetup = null;
    S.totpMsg = '';
    renderSettings();
}
async function totpConfirmSetup() {
    var setup = S.totpSetup;
    if (!setup) return;
    var code = String(fieldVal('totpSetupCode')).replace(/\D/g, '');
    if (code.length !== TOTP_DIGITS) { S.totpMsg = '인증 앱에 뜬 6자리 번호를 넣어 주세요.'; renderSettings(); return; }
    if (!S.chatKey) { S.totpMsg = '대화 열쇠가 없어 2차 인증을 켤 수 없어요. 다시 열고 시도해 주세요.'; renderSettings(); return; }
    if (!(await totpVerify(setup.secret, code))) {
      S.totpMsg = '번호가 맞지 않아요. 인증 앱의 최신 번호를 넣어 주세요.';
      renderSettings();
      return;
    }
    S.totpMsg = '저장하는 중…';
    renderSettings();
    try {
      var w = await wrapChatKey(setup.secret, S.chatKey, S.me.id, TOTP_ITER);
      var cfg = {
        version: 1, userId: S.me.id, enabled: true,
        alg: 'SHA1', digits: TOTP_DIGITS, period: TOTP_PERIOD,
        secret: setup.secret, issuer: TOTP_ISSUER, label: totpLabel(S.me.id),
        kdf: w.kdf, kdfIter: w.kdfIter, salt: w.salt, iv: w.iv, wrappedKey: w.wrappedKey,
        chatSalt: S.chatSalt ? b64enc(S.chatSalt) : '', chatIter: S.chatIter,
        createdAt: nowIso(), updatedAt: nowIso()
      };
      var saved = await saveTotpConfig(cfg);
      if (!saved.ok) { S.totpMsg = saved.error; renderSettings(); return; }
      S.totp = { ok: true, present: true, enabled: true, cfg: cfg };
      S.totpSetup = null;
      S.totpMsg = '2차 인증을 켰어요. 다음부터는 6자리 번호만으로 열려요.';
      renderSettings();
      toast('2차 인증을 켰어요.');
    } catch (e) {
      S.totpMsg = '2차 인증을 켜지 못했어요. ' + (e && e.message ? e.message : '');
      renderSettings();
    }
}
async function totpDisableSubmit() {
    if (!S.totp || !S.totp.enabled) return;
    var code = String(fieldVal('totpOffCode')).replace(/\D/g, '');
    var pw = fieldVal('totpOffPw');
    var ok = false;
    if (code.length === TOTP_DIGITS) ok = await totpVerify(S.totp.cfg && S.totp.cfg.secret, code);
    else if (pw) {
      await freshUsers();
      var u = findUser(S.me.id);
      ok = !!(u && u.salt && u.hash && (await hashPassword(pw, u.salt)) === u.hash);
    }
    if (!ok) {
      S.totpMsg = (code || pw) ? '번호나 비밀번호가 맞지 않아요.' : '6자리 번호나 계정 비밀번호를 넣어 주세요.';
      renderSettings();
      return;
    }
    S.totpMsg = '끄는 중…';
    renderSettings();
    var saved = await saveTotpConfig({ version: 1, userId: S.me.id, enabled: false, disabledAt: nowIso(), updatedAt: nowIso() });
    if (!saved.ok) { S.totpMsg = saved.error; renderSettings(); return; }
    S.totp = { ok: true, present: true, enabled: false, cfg: null };
    S.totpOff = false;
    S.totpMsg = '2차 인증을 껐어요. 이제 비밀번호로 열려요.';
    renderSettings();
    toast('2차 인증을 껐어요.');
}
function totpCopySecret() {
    var secret = S.totpSetup ? S.totpSetup.secret : '';
    if (!secret) return;
    function done() { toast('열쇠를 복사했어요.'); }
    function fallback() {
      try {
        var ta = document.createElement('textarea');
        ta.value = secret;
        ta.style.cssText = 'position:fixed;left:-9999px;top:0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        done();
      } catch (e) { toast('복사하지 못했어요. 열쇠를 길게 눌러 직접 복사해 주세요.'); }
    }
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(secret).then(done).catch(fallback);
      } else fallback();
    } catch (e) { fallback(); }
}

/* 비밀번호로 열었을 때 2차 인증 열쇠를 지금 열쇠에 맞춰 조용히 다시 감싸요 */
async function rewrapTotpKey() {
    if (!S.totp || !S.totp.enabled || !S.totp.cfg || !S.chatKey) return false;
    var cfg = S.totp.cfg;
    try {
      var cur = await unwrapChatKey(cfg);
      var a = new Uint8Array(await subtle().exportKey('raw', cur));
      var b = new Uint8Array(await subtle().exportKey('raw', S.chatKey));
      var same = a.length === b.length;
      for (var i = 0; same && i < a.length; i++) if (a[i] !== b[i]) same = false;
      if (same) return true;
    } catch (e) { /* 아래에서 새로 감싸요 */ }
    try {
      var w = await wrapChatKey(cfg.secret, S.chatKey, cfg.userId, Number(cfg.kdfIter) || TOTP_ITER);
      cfg.kdf = w.kdf; cfg.kdfIter = w.kdfIter; cfg.salt = w.salt; cfg.iv = w.iv; cfg.wrappedKey = w.wrappedKey;
      if (S.chatSalt) cfg.chatSalt = b64enc(S.chatSalt);
      cfg.chatIter = S.chatIter;
      cfg.updatedAt = nowIso();
      var r = await saveTotpConfig(cfg);
      if (r.ok) S.totp.cfg = cfg;
      return !!r.ok;
    } catch (e) { return false; }
}

/* 등록된 기기 잠금 해제 · 새 기기 등록: 6자리 번호만으로 */
async function unlockWithTotp(code, deviceName) {
    if (!S.me) return { ok: false, message: '계정을 확인하지 못했어요.' };
    var cfgRes = await loadTotpConfig(S.me.id);
    S.totp = cfgRes;
    if (!cfgRes.ok && !cfgRes.enabled) {
      return { ok: false, message: '2차 인증 설정을 읽지 못했어요. 연결을 확인한 뒤 다시 시도해 주세요.' };
    }
    if (!cfgRes.enabled) {
      return { ok: false, message: '2차 인증이 꺼져 있어요. 비밀번호로 열어 주세요.', needsPassword: true };
    }
    var cfg = cfgRes.cfg;
    if (!(await totpVerify(cfg.secret, code))) {
      return { ok: false, message: '번호가 맞지 않아요. 인증 앱의 최신 6자리를 넣어 주세요.' };
    }
    var key;
    try { key = await unwrapChatKey(cfg); }
    catch (e) { return { ok: false, message: '인증은 확인했지만 대화 열쇠를 풀지 못했어요. 비밀번호로 열어 주세요.', needsPassword: true }; }

    S.chatKey = key;
    S.chatSalt = cfg.chatSalt ? b64dec(cfg.chatSalt) : window.crypto.getRandomValues(new Uint8Array(16));
    S.chatIter = clamp(Number(cfg.chatIter) || CHAT_ITER, 1000, 1000000);

    var envRes = await readThreadsEnvelope();
    if (!envRes.ok) { S.chatKey = null; return { ok: false, message: envRes.error || '대화 보관함을 확인하지 못했어요.' }; }
    if (envRes.env) {
      S.chatSalt = b64dec(envRes.env.salt);
      S.chatIter = clamp(Number(envRes.env.iter) || CHAT_ITER, 1000, 1000000);
      try { await chatDecrypt(envRes.env); }
      catch (e) {
        S.chatKey = null;
        return { ok: false, message: '인증은 확인했지만 대화를 열지 못했어요. 비밀번호로 열고 2차 인증을 다시 켜 주세요.', needsPassword: true };
      }
    }
    S.unlocked = true;
    touchActivity();
    await bioRefreshKey();
    if (S.gateMode === 'device') {
      var reg = await registerDevice(deviceName);
      if (!reg.ok) toast('기기 등록을 저장하지 못했어요. 다음에 다시 확인할게요.');
    }
    return { ok: true };
}

async function submitGateTotp() {
    if (S.gateBusy) return;
    var code = String(fieldVal('gateTotp')).replace(/\D/g, '');
    var name = fieldVal('gateDevName') || S.deviceName;
    var btn = document.getElementById('gateTotpBtn');
    if (code.length !== TOTP_DIGITS) return gateFail('인증 앱에 뜬 6자리 번호를 넣어 주세요.');
    S.gateBusy = true;
    if (btn) { btn.disabled = true; btn.textContent = '확인하는 중…'; }
    try {
      var r = await unlockWithTotp(code, name);
      if (!r.ok) {
        gateFail(r.message || '열지 못했어요.');
        if (r.needsPassword) { S.gateAlt = true; renderGate(); gateFail(r.message || ''); }
        return;
      }
      await enterChat();
    } catch (e) {
      gateFail('열지 못했어요. ' + (e && e.message ? e.message : ''));
    } finally {
      S.gateBusy = false;
      var b2 = document.getElementById('gateTotpBtn');
      if (b2) { b2.disabled = false; b2.textContent = S.gateMode === 'device' ? '이 기기 등록하고 열기' : '열기'; }
    }
}

async function pasteGateTotp() {
    var el = document.getElementById('gateTotp');
    if (!el || S.gateBusy) return;
    var txt = '';
    try {
      if (navigator.clipboard && navigator.clipboard.readText) txt = await navigator.clipboard.readText();
    } catch (e) { txt = ''; }
    var digits = String(txt || '').replace(/\D/g, '');
    if (digits.length > 6) digits = digits.slice(0, 6);
    if (digits.length < 6) {
      try { el.focus(); } catch (e2) { /* 무시 */ }
      if (digits) el.value = digits;
      toast('복사한 6자리 번호를 찾지 못했어요. 인증 앱에서 번호를 복사한 뒤 다시 눌러 주세요.');
      return;
    }
    el.value = digits;
    await submitGateTotp();
}
