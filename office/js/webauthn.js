/* ============================================================================
   AI 사무실 — office/js/webauthn.js
   Face ID · 지문(WebAuthn) · 등록된 기기
   · office.html 이 css/style.css → js/state.js … js/boot.js 순서로 불러요.
     모듈끼리 같은 전역 스코프를 써요(함수 이름은 사무실 전체에서 하나).
   · 원래 office.html 한 덩어리 스크립트를 기능별로 나눈 파일이라 동작은 같아요.
   ============================================================================ */
'use strict';

/* ===== 생체인증(WebAuthn) (chat.html에서 승계) ===== */
function hasBiometricSupport() {
    return !!(window.PublicKeyCredential && navigator.credentials
      && typeof navigator.credentials.create === 'function'
      && typeof navigator.credentials.get === 'function'
      && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1'));
}
function b64urlEnc(buf) {
    return b64enc(buf).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlDec(txt) {
    var s = String(txt || '').replace(/-/g, '+').replace(/_/g, '/');
    while (s.length % 4) s += '=';
    return b64dec(s);
}
function bioUserId() { return String((S.me && S.me.id) || ''); }
function bioStoreKey() { return K_BIO + bioUserId(); }
function bioWrapKeyName() { return K_BIO_WRAP + bioUserId(); }

/* 이 기기에 등록해 둔 생체인증 정보. 없거나 망가졌으면 null */
function getBioRecord() {
    var id = bioUserId();
    if (!id) return null;
    var raw = lsGet(bioStoreKey());
    if (!raw) return null;
    var rec = null;
    try { rec = JSON.parse(raw); } catch (e) { return null; }
    if (!rec || typeof rec !== 'object' || !rec.credIdB64 || !rec.wrappedKey || !rec.iv) return null;
    if (rec.userId && String(rec.userId) !== id) return null;
    return rec;
}
function saveBioRecord(rec) {
    var id = bioUserId();
    if (!id || !rec) return false;
    rec.version = 1;
    rec.userId = id;
    rec.updatedAt = nowIso();
    return lsSet(bioStoreKey(), JSON.stringify(rec));
}
function clearBioRecord() {
    lsDel(bioStoreKey());
    lsDel(bioWrapKeyName());
}
function bioLabel() {
    var ua = String(navigator.userAgent || '');
    if (/iPhone|iPad|iPod/.test(ua)) return 'Face ID · Touch ID';
    if (/Macintosh/.test(ua)) return 'Touch ID';
    if (/Android/.test(ua)) return '지문 · 얼굴';
    if (/Windows/.test(ua)) return 'Windows Hello';
    return 'Face ID / 지문';
}
function bioAad() { return new TextEncoder().encode('bio:' + bioUserId()); }

/* 대화 열쇠를 이 기기에서만 쓰는 열쇠로 감싸 둠 (감싸는 열쇠도 이 기기에만) */
async function bioWrapChatKey(key) {
    var sub = subtle();
    if (!sub) throw new Error('이 브라우저에서는 생체인증을 쓸 수 없어요');
    var raw = new Uint8Array(await sub.exportKey('raw', key));
    var local = window.crypto.getRandomValues(new Uint8Array(32));
    if (!lsSet(bioWrapKeyName(), b64enc(local))) throw new Error('이 기기에 저장하지 못했어요');
    var kek = await sub.importKey('raw', local, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
    var iv = window.crypto.getRandomValues(new Uint8Array(12));
    var ct = await sub.encrypt({ name: 'AES-GCM', iv: iv, additionalData: bioAad() }, kek, raw);
    return { iv: b64enc(iv), wrappedKey: b64enc(ct) };
}
async function bioUnwrapChatKey(rec) {
    var sub = subtle();
    if (!sub) throw new Error('이 브라우저에서는 생체인증을 쓸 수 없어요');
    var localB64 = lsGet(bioWrapKeyName());
    if (!localB64) throw new Error('이 기기에 등록한 열쇠가 없어요');
    var kek = await sub.importKey('raw', b64dec(localB64), { name: 'AES-GCM' }, false, ['decrypt']);
    var raw = await sub.decrypt({ name: 'AES-GCM', iv: b64dec(rec.iv), additionalData: bioAad() }, kek, b64dec(rec.wrappedKey));
    return sub.importKey('raw', new Uint8Array(raw), { name: 'AES-GCM' }, true, ['encrypt', 'decrypt']);
}

/* 비밀번호·6자리 번호로 열었을 때도 이 기기의 생체인증 열쇠를 지금 열쇠에 맞춰 조용히 맞춰 둬요 */
async function bioRefreshKey() {
    try {
      var rec = getBioRecord();
      if (!rec || !S.chatKey || !bioUserId()) return false;
      var w = await bioWrapChatKey(S.chatKey);
      rec.iv = w.iv;
      rec.wrappedKey = w.wrappedKey;
      rec.chatSalt = S.chatSalt ? b64enc(S.chatSalt) : '';
      rec.chatIter = S.chatIter;
      return saveBioRecord(rec);
    } catch (e) { return false; }
}

/* 등록: 지금 이 기기의 얼굴·지문을 한 번 확인하고 대화 열쇠를 이 기기에만 맡겨 둬요 */
async function bioRegister() {
    if (S.bioBusy) return;
    if (!hasBiometricSupport()) {
      S.bioMsg = '이 브라우저에서는 생체인증을 쓸 수 없어요. https 주소이거나 홈 화면에 추가한 앱에서 열어 주세요.';
      renderSettings();
      return;
    }
    if (!S.chatKey || !S.me) {
      S.bioMsg = '대화를 연 뒤에 생체인증을 등록해 주세요.';
      renderSettings();
      return;
    }
    S.bioBusy = true;
    S.bioMsg = '생체인증을 등록하는 중…';
    renderSettings();
    try {
      var cred = await navigator.credentials.create({ publicKey: {
        challenge: window.crypto.getRandomValues(new Uint8Array(32)),
        rp: { name: "Jaden's Home", id: location.hostname || 'localhost' },
        user: {
          id: new TextEncoder().encode(String(S.me.id || 'user')),
          name: String(S.me.id || 'user'),
          displayName: String(S.me.name || S.me.id || 'Jaden')
        },
        pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
        authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'preferred' },
        timeout: 60000
      } });
      if (!cred || !cred.rawId) throw new Error('이 기기가 생체인증을 받아 주지 않았어요');
      var w = await bioWrapChatKey(S.chatKey);
      var rec = {
        credIdB64: b64urlEnc(cred.rawId),
        createdAt: nowIso(),
        label: bioLabel(),
        alg: 'AES-GCM',
        iv: w.iv,
        wrappedKey: w.wrappedKey,
        chatSalt: S.chatSalt ? b64enc(S.chatSalt) : '',
        chatIter: S.chatIter
      };
      if (!saveBioRecord(rec)) throw new Error('이 기기에 저장하지 못했어요. 인터넷 창의 저장 공간이 가득 찼는지 확인해 주세요.');
      S.bioMsg = '';
      toast('Face ID / 생체인증이 등록됐어요!');
    } catch (e) {
      var nm = String((e && e.name) || '');
      S.bioMsg = (nm === 'NotAllowedError' || nm === 'AbortError')
        ? '생체인증 등록이 취소됐어요.'
        : (nm === 'InvalidStateError'
          ? '이 기기에 이미 생체인증이 등록되어 있어요. 기기 설정에서 지운 뒤 다시 해 주세요.'
          : '생체인증을 등록하지 못했어요.' + (e && e.message ? ' ' + e.message : ''));
      toast(S.bioMsg);
    } finally {
      S.bioBusy = false;
      renderSettings();
    }
}

/* 해제: 이 기기에서만 지워요. 다음부터는 비밀번호나 6자리 번호로 열어요. */
function bioRemove() {
    clearBioRecord();
    S.bioMsg = '이 기기에서 생체인증을 해제했어요. 이제 비밀번호나 6자리 번호로 열어요.';
    renderSettings();
    toast('이 기기 생체인증을 해제했어요.');
}

/* 잠금 화면 맨 위의 ‘생체인증으로 열기’ */
function bioGateHtml() {
    if (!hasBiometricSupport() || !getBioRecord()) return '';
    return '<button class="gate-btn" type="button" id="gateBioBtn" data-act="gate-bio" style="margin-bottom:10px">🔐 Face ID / 생체인증으로 열기</button>' +
      '<div class="gate-or">또는 직접 입력</div>';
}

async function gateBioUnlock() {
    if (S.gateBusy) return;
    var rec = getBioRecord();
    if (!rec || !hasBiometricSupport()) {
      gateFail('이 기기에서는 생체인증을 쓸 수 없어요. 아래 번호나 비밀번호로 열어 주세요.');
      return;
    }
    var btn = document.getElementById('gateBioBtn');
    var opened = false;
    S.gateBusy = true;
    if (btn) { btn.disabled = true; btn.textContent = '생체인증 확인 중…'; }
    try {
      var cred = await navigator.credentials.get({ publicKey: {
        challenge: window.crypto.getRandomValues(new Uint8Array(32)),
        allowCredentials: [{ id: b64urlDec(rec.credIdB64), type: 'public-key' }],
        userVerification: 'required',
        timeout: 60000
      } });
      if (!cred) throw new Error('생체인증을 확인하지 못했어요');
      var key = null;
      try { key = await bioUnwrapChatKey(rec); }
      catch (eu) {
        gateFail('생체인증은 확인했지만 대화 열쇠가 바뀌어 있어요. 아래 비밀번호나 번호로 열고 설정에서 생체인증을 다시 등록해 주세요.');
        return;
      }
      S.chatKey = key;
      S.chatSalt = rec.chatSalt ? b64dec(rec.chatSalt) : window.crypto.getRandomValues(new Uint8Array(16));
      S.chatIter = clamp(Number(rec.chatIter) || CHAT_ITER, 1000, 1000000);

      var envRes = await readThreadsEnvelope();
      if (!envRes.ok) { S.chatKey = null; gateFail(envRes.error || '대화 보관함을 확인하지 못했어요.'); return; }
      if (envRes.env) {
        S.chatSalt = b64dec(envRes.env.salt);
        S.chatIter = clamp(Number(envRes.env.iter) || CHAT_ITER, 1000, 1000000);
        try { await chatDecrypt(envRes.env); }
        catch (ed) {
          S.chatKey = null;
          gateFail('대화를 열지 못했어요. 비밀번호나 6자리 번호로 열고 설정에서 생체인증을 다시 등록해 주세요.');
          return;
        }
      }
      S.unlocked = true;
      touchActivity();
      if (S.gateMode === 'device') {
        var reg = await registerDevice(fieldVal('gateDevName') || S.deviceName);
        if (!reg.ok) toast('기기 등록을 저장하지 못했어요. 다음에 다시 확인할게요.');
      }
      await bioRefreshKey();
      opened = true;
      await enterChat();
    } catch (e) {
      if (!opened) S.chatKey = null;
      var nm = String((e && e.name) || '');
      if (nm === 'NotAllowedError' || nm === 'AbortError') gateFail('생체인증이 취소됐어요. 아래 번호나 비밀번호로 열 수 있어요.');
      else gateFail('생체인증으로 열지 못했어요. 아래 번호나 비밀번호로 열 수 있어요.');
    } finally {
      S.gateBusy = false;
      var b2 = document.getElementById('gateBioBtn');
      if (b2) { b2.disabled = false; b2.textContent = '🔐 Face ID / 생체인증으로 열기'; }
    }
}

/* ===== 등록된 기기 (chat.html에서 승계) ===== */
async function loadDevices() {
    var r = await ghGetJson(DEFAULT_REPO, PATH_DEVICES, null);
    if (!r.ok) return { ok: false, error: r.error || '기기 목록을 읽지 못했어요', devices: [] };
    if (r.missing) return { ok: true, missing: true, devices: [] };
    var list = (r.data && Object.prototype.toString.call(r.data.devices) === '[object Array]') ? r.data.devices : [];
    return { ok: true, devices: list, sha: r.sha };
}
function deviceKnown(devices, deviceId, userId) {
    for (var i = 0; i < devices.length; i++) {
      var d = devices[i] || {};
      if (String(d.id) === String(deviceId) && String(d.userId) === String(userId)) return d;
    }
    return null;
}
async function registerDevice(name) {
    var cur = await loadDevices();
    if (!cur.ok) return { ok: false, error: cur.error };
    var list = cur.devices.slice();
    var found = deviceKnown(list, S.deviceId, S.me.id);
    var rec = {
      id: S.deviceId,
      userId: S.me.id,
      name: String(name || S.deviceName || '이 기기').slice(0, 40),
      at: found ? found.at : nowIso(),
      lastSeen: nowIso(),
      ua: String(navigator.userAgent || '').slice(0, 180)
    };
    if (found) {
      for (var i = 0; i < list.length; i++) {
        if (String(list[i].id) === String(S.deviceId) && String(list[i].userId) === String(S.me.id)) { list[i] = rec; break; }
      }
    } else {
      list.push(rec);
    }
    var body = { version: 1, updatedAt: nowIso(), devices: list };
    var w = await ghPutAt(DEFAULT_REPO, PATH_DEVICES, JSON.stringify(body, null, 2), (found ? 'AI 사무실 기기 확인: ' : 'AI 사무실 새 기기 등록: ') + rec.name, null);
    if (!w.ok) return { ok: false, error: w.error || '기기 등록을 저장하지 못했어요' };
    return { ok: true, device: rec };
}
async function revokeDevice(id) {
    var cur = await loadDevices();
    if (!cur.ok) return { ok: false, error: cur.error };
    var list = [];
    for (var i = 0; i < cur.devices.length; i++) if (String(cur.devices[i].id) !== String(id)) list.push(cur.devices[i]);
    var body = { version: 1, updatedAt: nowIso(), devices: list };
    var w = await ghPutAt(DEFAULT_REPO, PATH_DEVICES, JSON.stringify(body, null, 2), 'AI 사무실 기기 해제', null);
    if (!w.ok) return { ok: false, error: w.error };
    return { ok: true, devices: list };
}
