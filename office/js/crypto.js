/* ============================================================================
   AI 사무실 — office/js/crypto.js
   가족 공유 AI 설정 암호화(AES-GCM·PBKDF2) · 대화 잠금 열쇠
   · office.html 이 css/style.css → js/state.js … js/boot.js 순서로 불러요.
     모듈끼리 같은 전역 스코프를 써요(함수 이름은 사무실 전체에서 하나).
   · 원래 office.html 한 덩어리 스크립트를 기능별로 나눈 파일이라 동작은 같아요.
   ============================================================================ */
'use strict';

/* ============ 가족 공유 AI 설정 암호화 (AES-GCM · PBKDF2) ============ */
function subtle() {
    return (window.crypto && window.crypto.subtle) ? window.crypto.subtle : null;
}
function familyPass() {
    var c = S.conn || {};
    return String(c.owner || '').toLowerCase() + '/' + String(c.repo || '').toLowerCase() + '::jadenfamily-ai-v1';
}
async function familyKey(salt, iter) {
    var sub = subtle();
    if (!sub) throw new Error('이 브라우저에서는 암호화를 쓸 수 없어요');
    var raw = new TextEncoder().encode(familyPass());
    if (!salt) {
      var d = await sub.digest('SHA-256', raw);
      return sub.importKey('raw', d, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
    }
    var base = await sub.importKey('raw', raw, { name: 'PBKDF2' }, false, ['deriveKey']);
    return sub.deriveKey({ name: 'PBKDF2', salt: salt, iterations: Math.max(1, Number(iter) || 1), hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
async function familyEncrypt(obj) {
    var sub = subtle();
    if (!sub) throw new Error('이 브라우저에서는 암호화를 쓸 수 없어요');
    var salt = window.crypto.getRandomValues(new Uint8Array(16));
    var iv = window.crypto.getRandomValues(new Uint8Array(12));
    var k = await familyKey(salt, CHAT_ITER);
    var ct = await sub.encrypt({ name: 'AES-GCM', iv: iv }, k, new TextEncoder().encode(JSON.stringify(obj)));
    return { version: 1, alg: 'AES-GCM', kdf: 'PBKDF2-SHA256', iter: CHAT_ITER, salt: b64enc(salt), iv: b64enc(iv), ct: b64enc(ct), updatedAt: nowIso() };
}
async function familyDecrypt(p) {
    if (!p || !p.iv || !p.ct) return null;
    var sub = subtle();
    if (!sub) return null;
    var k = await familyKey(p.salt ? b64dec(p.salt) : null, Number(p.iter) || 1);
    var pt = await sub.decrypt({ name: 'AES-GCM', iv: b64dec(p.iv) }, k, b64dec(p.ct));
    var txt = new TextDecoder('utf-8').decode(new Uint8Array(pt));
    try { return JSON.parse(txt); } catch (e) { return null; }
}

/* ============ 내 대화 잠금 열쇠 (계정 비밀번호 → AES-GCM) ============ */
async function chatKeyFrom(pw, salt, iter) {
    var sub = subtle();
    if (!sub) throw new Error('이 브라우저에서는 암호화를 쓸 수 없어요');
    var raw = new TextEncoder().encode('jadenfamily-chat-v1:' + String(pw));
    var base = await sub.importKey('raw', raw, { name: 'PBKDF2' }, false, ['deriveKey']);
    return sub.deriveKey({ name: 'PBKDF2', salt: salt, iterations: clamp(Number(iter) || CHAT_ITER, 1, 1000000), hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
}
async function chatEncrypt(text) {
    var sub = subtle();
    var iv = window.crypto.getRandomValues(new Uint8Array(12));
    var ct = await sub.encrypt({ name: 'AES-GCM', iv: iv }, S.chatKey, new TextEncoder().encode(String(text)));
    return { version: 1, alg: 'AES-GCM', kdf: 'PBKDF2-SHA256', iter: S.chatIter, salt: b64enc(S.chatSalt), iv: b64enc(iv), ct: b64enc(ct), updatedAt: nowIso(), user: S.me.id };
}
async function chatDecrypt(env) {
    var sub = subtle();
    var pt = await sub.decrypt({ name: 'AES-GCM', iv: b64dec(env.iv) }, S.chatKey, b64dec(env.ct));
    return new TextDecoder('utf-8').decode(new Uint8Array(pt));
}
