/* ============================================================================
   AI 사무실 — office/js/settings.js
   설정 모달 — 키 · 모델 · 팀 · 자동 잠금
   · office.html 이 css/style.css → js/state.js … js/boot.js 순서로 불러요.
     모듈끼리 같은 전역 스코프를 써요(함수 이름은 사무실 전체에서 하나).
   · 원래 office.html 한 덩어리 스크립트를 기능별로 나눈 파일이라 동작은 같아요.
   ============================================================================ */
'use strict';

/* ==================================================================
     설정
     ================================================================== */
function openSettings() {
    var m = document.getElementById('settingsModal');
    if (!m) return;
    renderSettings();
    m.hidden = false;
    document.body.style.overflow = 'hidden';
    document.documentElement.style.overflow = 'hidden';
    loadDevices().then(function (r) { S.devices = r.devices || []; renderSettings(); }).catch(function () { /* 무시 */ });
    loadTotpConfig(S.me.id).then(function (t) {
      if (S.totpSetup) return;
      if (S.totpMsg === '저장하는 중…' || S.totpMsg === '끄는 중…') return;
      S.totp = t;
      var typed = false;
      try {
        var els = document.querySelectorAll('#settingsBody input, #settingsBody textarea');
        for (var i = 0; i < els.length; i++) {
          if (els[i].type === 'color') continue;
          if (String(els[i].value || '').length) { typed = true; break; }
        }
      } catch (e) { typed = false; }
      if (!typed) renderSettings();
    }).catch(function () { /* 무시 */ });
}
function closeSettings() {
    var m = document.getElementById('settingsModal');
    if (m) m.hidden = true;
    if (S.teamModal) return;
    document.body.style.overflow = '';
    document.documentElement.style.overflow = '';
}
function providerChoices(sel) {
    var h = '', any = false;
    for (var i = 0; i < PROVIDER_ORDER.length; i++) {
      var pid = PROVIDER_ORDER[i];
      if (!hasKey(pid) && pid !== sel) continue;
      any = true;
      h += '<option value="' + esc(pid) + '"' + (pid === sel ? ' selected' : '') + '>' + esc(PROVIDERS[pid].short) + '</option>';
    }
    if (!any) h = '<option value="">키를 먼저 넣어 주세요</option>';
    return h;
}
function modelChoices(pid, sel) {
    var h = '<option value="">기본값(자동)</option>';
    var list = pid ? modelList(pid) : [];
    for (var i = 0; i < list.length && i < 200; i++) {
      h += '<option value="' + esc(list[i]) + '"' + (list[i] === sel ? ' selected' : '') + '>' + esc(modelShort(modelIdOf(pid, list[i]))) + '</option>';
    }
    if (sel && list.indexOf(sel) < 0) h += '<option value="' + esc(sel) + '" selected>' + esc(sel) + '</option>';
    return h;
}
function renderSettings() {
    var body = document.getElementById('settingsBody');
    if (!body) return;
    if (!S.office) { body.innerHTML = '<p class="hint">사무실을 연 뒤에 설정을 열 수 있어요.</p>'; return; }
    var h = '';

    /* 팀별 모델 */
    h += '<div class="sec"><h3>🧠 팀별 모델 배정</h3><p class="hint">팀마다 쓰는 제공자와 모델을 따로 고를 수 있어요. 비워 두면 기본 모델을 써요. 한도(429)·혼잡(503)에 걸리면 다른 모델로 자동 전환해요.</p>';
    for (var i = 0; i < S.office.teams.length; i++) {
      var t = S.office.teams[i];
      var eff = teamModelId(t), esp = splitModelId(eff);
      h += '<div class="mrow"><div class="mi" style="flex:1 1 100%">' +
        '<b>' + esc(t.floor + ' · ' + t.emoji + ' ' + t.name) + '</b>' +
        '<span>지금: ' + esc((PROVIDERS[esp.pid] ? PROVIDERS[esp.pid].short + ' · ' : '') + modelShort(eff)) + '</span></div></div>';
      h += '<div class="row2" style="margin:0 0 6px">' +
        '<label class="field" style="margin:0"><span class="lbl">제공자</span><select id="tm_pid_' + esc(t.id) + '" data-team="' + esc(t.id) + '" data-act="team-pid">' + providerChoices(t.pid) + '</select></label>' +
        '<label class="field" style="margin:0"><span class="lbl">모델</span><select id="tm_model_' + esc(t.id) + '">' + modelChoices(t.pid, t.model) + '</select></label>' +
        '</div>' +
        '<div class="row2" style="margin:0 0 10px">' +
        '<label class="field" style="margin:0"><span class="lbl">팀 이름</span><input id="tn_' + esc(t.id) + '" maxlength="24" value="' + esc(t.name) + '"></label>' +
        '<div style="display:flex;align-items:flex-end;gap:5px"><button class="mini" type="button" data-act="team-model-save" data-team="' + esc(t.id) + '">저장</button>' +
        (t.custom ? '<button class="mini danger" type="button" data-act="team-del" data-team="' + esc(t.id) + '">팀 삭제</button>' : '') +
        '</div></div>';
    }
    h += '<div class="gtitle">1F 비서실 · 전담 비서 피클<span class="k">요청 접수 · 브리핑 · 배분 · 보고</span></div>' +
      '<div class="mrow" style="margin:0 0 10px"><div class="mi" style="flex:1 1 100%">' +
      '<b>🥒 ' + esc(DEFAULT_SECRETARY.name) + '</b>' +
      '<span>' + esc(DEFAULT_SECRETARY.desc) + '</span></div></div>' +
      '<p class="hint">1F 비서실은 외부 AI 모델을 고르는 자리가 아니라 대표님의 전담 비서 피클이 맡는 자리예요. 가족 화면에서 온 요청을 접수해 브리핑하고, 대표님 승인 뒤 팀 배분과 결과 보고를 챙겨요. 4F~2F 부서 일은 위에서 고른 모델로 백그라운드에서 돌아가요.</p>';
    h += '<div class="gtitle">팀 추가</div><div class="row2" style="margin:0 0 6px">' +
      '<label class="field" style="margin:0"><span class="lbl">이름</span><input id="ntName" maxlength="20" placeholder="예: 번역팀"></label>' +
      '<label class="field" style="margin:0"><span class="lbl">층</span><select id="ntFloor"><option value="4F">4F</option><option value="3F">3F</option><option value="2F" selected>2F</option></select></label>' +
      '<label class="field" style="margin:0"><span class="lbl">표시</span><input id="ntEmoji" maxlength="4" value="🧩"></label></div>' +
      '<button class="mini" type="button" data-act="team-add">팀 추가</button></div>';

    /* AI 키 */
    h += '<div class="sec"><h3>🔑 AI 키</h3><p class="hint">키는 암호화해서 우리 집 비공개 보관함에만 저장해요. 화면이나 AI 대화에는 절대 보이지 않아요. 제공자마다 키를 여러 개 넣어 두면 한 키가 한도에 걸렸을 때 다음 키로 이어서 보내요.</p>';
    for (var pi = 0; pi < PROVIDER_ORDER.length; pi++) {
      var pid = PROVIDER_ORDER[pi], prov = PROVIDERS[pid], klist = keyList(pid);
      h += '<label class="field">' + esc(prov.label) + (klist.length ? ' 키 추가' : ' API 키') +
        '<input type="password" id="setKey_' + pid + '" placeholder="' + (klist.length ? '새 키를 넣고 [키 추가]를 눌러 주세요' : '아직 없음') + '" autocomplete="off" spellcheck="false">' +
        '<span style="font-size:10.5px;font-weight:700;color:#a79fbb">' + esc(prov.keyHint) + '</span></label>' +
        '<div class="gtitle">' + esc(prov.short) + ' 키<span class="k">' + klist.length + '개</span></div>';
      if (!klist.length) {
        h += '<p class="hint" style="margin:2px 0 8px">아직 키가 없어요. 위에 키를 넣고 아래 버튼을 눌러 주세요.</p>';
      } else {
        for (var ki = 0; ki < klist.length; ki++) {
          var onKey = (ki === activeIndex(pid));
          var limLeft = keyLimitUntil(pid, ki) - Date.now();
          h += '<div class="mrow' + (onKey ? ' on' : '') + '"><div class="mi"><b>키 ' + (ki + 1) + ' · ' + esc(maskKey(klist[ki])) + '</b>' +
            '<span>' + (onKey ? '지금 이 키로 보내요' : '대기 중') + (limLeft > 0 ? ' · 한도에 걸림, ' + fmtLeft(limLeft) + ' 뒤 풀려요' : '') + '</span></div>' +
            (onKey ? '<span class="badge">사용 중</span>' : '<button class="mini" type="button" data-act="key-use" data-pid="' + pid + '" data-i="' + ki + '">이 키로</button>') +
            '<button class="mini danger" type="button" data-act="key-del" data-pid="' + pid + '" data-i="' + ki + '">지우기</button></div>';
        }
      }
      h += '<div style="margin:2px 0 12px"><button class="mini" type="button" data-act="key-add" data-pid="' + pid + '">＋ ' + esc(prov.short) + ' 키 추가</button></div>';
    }
    h += '<div style="display:flex;gap:7px;flex-wrap:wrap"><button class="mini" type="button" data-act="save-keys">AI 키 저장</button>' +
      '<button class="mini danger" type="button" data-act="clear-keys">모든 키 지우기</button></div></div>';

    /* 코드 열쇠 */
    h += '<div class="sec"><h3>🛠️ 코드를 고치는 열쇠</h3><p class="hint">홈·아이·냉파·가계부 네 화면의 코드를 읽고 고치는 열쇠예요. 가족 데이터 열쇠와 따로 보관해요.</p>' +
      '<label class="field">코드 열쇠' +
      '<input type="password" id="setCodeToken" placeholder="' + (S.ai.codeToken ? '설정됨 · 바꾸려면 새 토큰을 넣어 주세요' : '아직 없음') + '" autocomplete="off" spellcheck="false">' +
      '<span style="font-size:10.5px;font-weight:700;color:#a79fbb">네 화면의 코드를 읽고 고칠 수 있는 열쇠예요</span></label>' +
      '<button class="mini" type="button" data-act="save-code">코드 열쇠 저장</button></div>';

    /* 2차 인증 */
    h += '<div class="sec" id="totpSec"><h3>🔐 2차 인증 (구글 인증 앱 · 아이폰 암호)</h3>';
    var totpOn = !!(S.totp && S.totp.enabled);
    if (S.totp && S.totp.ok === false) h += '<p class="hint" style="color:#b93b57">2차 인증 상태를 확인하지 못했어요: ' + esc(S.totp.error || '') + '</p>';
    if (S.totpSetup) {
      h += '<p class="hint">인증 앱으로 아래 QR을 찍거나 열쇠를 직접 넣은 뒤, 앱에 뜬 6자리 번호를 넣어 주세요.</p>' +
        '<div class="totp-qr" id="totpQr">' + QR.svg(S.totpSetup.uri, 208) + '</div>' +
        '<div class="totp-key"><code id="totpSecret">' + esc(String(S.totpSetup.secret).replace(/(.{4})/g, '$1 ').trim()) + '</code>' +
        '<button class="mini" type="button" data-act="totp-copy">복사</button></div>' +
        '<label class="field">인증 앱에 뜬 6자리 번호' +
        '<input id="totpSetupCode" type="text" inputmode="numeric" autocomplete="one-time-code" maxlength="6" pattern="[0-9]*" placeholder="123456" spellcheck="false" class="totp-code"></label>' +
        '<div style="display:flex;gap:7px;flex-wrap:wrap"><button class="mini" type="button" data-act="totp-confirm">번호 확인하고 켜기</button>' +
        '<button class="mini" type="button" data-act="totp-cancel">그만두기</button></div>' +
        '<p class="hint" style="margin-top:8px">구글 인증 앱 · 아이폰 “암호” 앱 · 1Password 등 6자리(TOTP) 앱이면 모두 돼요.</p>';
    } else if (totpOn) {
      h += '<p class="hint">켜져 있어요. 이 계정은 인증 앱의 6자리 번호만으로 사무실을 열 수 있어요.</p>' +
        '<div class="mrow on"><div class="mi"><b>구글 인증 앱 · 아이폰 암호</b><span>' +
        esc('계정 ' + S.me.id + (S.totp.cfg && S.totp.cfg.updatedAt ? ' · ' + fmtWhen(S.totp.cfg.updatedAt) + ' 설정' : '')) + '</span></div><span class="badge">켜짐</span></div>';
      if (S.totpOff) {
        h += '<label class="field">인증 앱의 6자리 번호<input id="totpOffCode" type="text" inputmode="numeric" autocomplete="one-time-code" maxlength="6" pattern="[0-9]*" placeholder="123456" class="totp-code"></label>' +
          '<label class="field">또는 계정 비밀번호<input id="totpOffPw" type="password" maxlength="64" autocomplete="current-password" placeholder="번호를 잊었을 때만"></label>' +
          '<div style="display:flex;gap:7px;flex-wrap:wrap"><button class="mini danger" type="button" data-act="totp-off-confirm">2차 인증 끄기</button>' +
          '<button class="mini" type="button" data-act="totp-off-cancel">그만두기</button></div>';
      } else {
        h += '<div style="display:flex;gap:7px;flex-wrap:wrap"><button class="mini" type="button" data-act="totp-off-open">2차 인증 끄기</button>' +
          '<button class="mini" type="button" data-act="totp-begin">열쇠 새로 만들기</button></div>' +
          '<p class="hint" style="margin-top:8px">끄거나 열쇠를 새로 만들려면 지금 쓰는 6자리 번호(또는 계정 비밀번호)가 필요해요.</p>';
      }
    } else {
      h += '<p class="hint">인증 앱의 6자리 번호 하나로 사무실을 열 수 있어요. 켜 두면 비밀번호를 매번 넣지 않아도 돼요.</p>' +
        '<button class="mini" type="button" data-act="totp-begin">2차 인증 켜기</button>';
    }
    if (S.totpMsg) h += '<p class="hint" style="color:#4a3a86;font-weight:900;margin-top:8px">' + esc(S.totpMsg) + '</p>';
    h += '</div>';

    /* 생체인증 */
    h += '<div class="sec" id="bioSec"><h3>🔓 생체인증 (Face ID · 지문)</h3>';
    if (!hasBiometricSupport()) {
      h += '<p class="hint">이 브라우저에서는 생체인증을 쓸 수 없어요. https 주소이거나 홈 화면에 추가한 앱에서 열면 쓸 수 있어요.</p>';
    } else {
      var brec = getBioRecord();
      if (brec) {
        h += '<p class="hint">이 기기에서는 Face ID(또는 지문) 한 번으로 사무실을 열 수 있어요. 비밀번호와 6자리 번호도 그대로 쓸 수 있어요.</p>' +
          '<div class="mrow on"><div class="mi"><b>이 기기 · ' + esc(brec.label || 'Face ID / 생체인증') + '</b>' +
          '<span>' + esc((brec.createdAt ? fmtWhen(brec.createdAt) + ' 등록' : '등록됨') + ' · 이 기기에만 저장') + '</span></div>' +
          '<span class="badge">등록됨</span></div>' +
          '<button class="mini" type="button" data-act="bio-remove">이 기기 생체인증 해제</button>';
      } else {
        h += '<p class="hint">이 기기의 Face ID(또는 지문)로 사무실을 열 수 있게 해 둬요. 열쇠는 이 기기에만 저장하고 다른 곳에는 보내지 않아요.</p>' +
          '<button class="mini" type="button" data-act="bio-register">🔐 이 기기 Face ID / 생체인증 등록</button>';
      }
      if (S.bioMsg) h += '<p class="hint" style="color:#4a3a86;font-weight:900;margin-top:8px">' + esc(S.bioMsg) + '</p>';
    }
    h += '</div>';

    /* 자동 잠금 */
    var alCur = autoLockMins();
    h += '<div class="sec" id="autoLockSec"><h3>🔐 자동 잠금</h3>' +
      '<p class="hint">이 화면에 들어오거나 새로 고칠 때마다 잠금을 풀어야 해요. 기록은 계정 비밀번호로만 열리고, 잠그면 이 기기 메모리에서도 바로 지워져요.</p>' +
      '<div class="gtitle">자동 잠금 시간<span class="k">지금 ' + esc(alCur ? (alCur + '분') : '끄기') + '</span></div><div class="lock-opts" role="group" aria-label="자동 잠금 시간">';
    for (var ai2 = 0; ai2 < AUTO_LOCK_STEPS.length; ai2++) {
      var am = AUTO_LOCK_STEPS[ai2];
      h += '<button type="button" data-act="auto-lock-set" data-min="' + am + '" aria-pressed="' + (am === alCur ? 'true' : 'false') + '" class="' + (am === alCur ? 'on' : '') + '">' + esc(autoLockLabel(am)) + '</button>';
    }
    h += '</div>';
    if (alCur) {
      h += '<p class="hint" style="margin-top:8px">' + esc(alCur + '분 동안 아무것도 하지 않으면 저절로 잠겨요') +
        (S.unlocked ? ' · 지금부터 ' + esc(fmtLeft(autoLockLeftMs())) + ' 뒤에 잠겨요.' : '') + '</p>';
    }
    h += '<div style="display:flex;gap:7px;flex-wrap:wrap;margin-top:9px"><button class="mini" type="button" data-act="lock">지금 잠그기</button>' +
      '<button class="mini" type="button" data-act="logout">로그아웃</button></div></div>';

    /* 기기 */
    h += '<div class="sec"><h3>📱 등록된 기기</h3><p class="hint">여기 있는 기기에서만 사무실이 열려요. 잃어버린 기기는 바로 해제하세요.</p>';
    if (!S.devices || !S.devices.length) h += '<p class="empty-lock">아직 등록된 기기가 없어요.</p>';
    else {
      for (var k = 0; k < S.devices.length; k++) {
        var d = S.devices[k] || {};
        var mine = String(d.id) === String(S.deviceId);
        h += '<div class="mrow"><div class="mi"><b>' + esc(d.name || '이름 없는 기기') + (mine ? ' · 이 기기' : '') + '</b>' +
          '<span>' + esc(d.userId || '') + ' · ' + esc(fmtWhen(d.at)) + ' 등록</span></div>' +
          '<button class="mini danger" type="button" data-act="device-revoke" data-id="' + esc(d.id) + '">해제</button></div>';
      }
    }
    h += '</div>';

    if (S.settingsMsg) h += '<p class="hint" style="color:#4a3a86;font-weight:900">' + esc(S.settingsMsg) + '</p>';
    body.innerHTML = h;
}

/* ---------- 설정 동작 ---------- */
function keysCopy() {
    return { gemini: keyList('gemini').slice(), openrouter: keyList('openrouter').slice(), groq: keyList('groq').slice() };
}
function fixActiveKeys(keys) {
    for (var i = 0; i < PROVIDER_ORDER.length; i++) {
      var pid = PROVIDER_ORDER[i], n = (keys[pid] || []).length;
      var cur = Number(S.ai.active && S.ai.active[pid]) || 0;
      if (!S.ai.active) S.ai.active = {};
      S.ai.active[pid] = (cur >= 0 && cur < n) ? cur : 0;
    }
    saveKeyState();
}
async function persistKeys(keys, okMsg, codeToken) {
    S.settingsMsg = '저장하는 중…';
    renderSettings();
    var r = await saveAiConfig({ keys: keys, codeToken: codeToken == null ? (S.ai.codeToken || '') : codeToken });
    S.settingsMsg = r.ok ? (okMsg || 'AI 키를 저장했어요.') : ('저장하지 못했어요: ' + (r.error || ''));
    if (r.ok) {
      fixActiveKeys(keys);
      renderSettings(); renderTop();
      refreshModels().then(function () { renderSettings(); renderAll(); }).catch(function () { /* 무시 */ });
    } else {
      renderSettings();
    }
    toast(S.settingsMsg);
    return r;
}
async function saveKeys(clear) {
    var keys = clear ? emptyKeys() : keysCopy();
    if (!clear) {
      for (var i = 0; i < PROVIDER_ORDER.length; i++) {
        var pid = PROVIDER_ORDER[i], v = fieldVal('setKey_' + pid).trim();
        if (v && keys[pid].indexOf(v) < 0) keys[pid].push(v);
      }
    } else {
      S.keyLimit = {};
      if (S.ai.active) S.ai.active = { gemini: 0, openrouter: 0, groq: 0 };
      saveKeyState();
    }
    await persistKeys(keys, clear ? 'AI 키를 모두 지웠어요.' : 'AI 키를 저장했어요.', clear ? '' : null);
}
async function addProviderKey(pid) {
    if (!PROVIDERS[pid]) return;
    var v = fieldVal('setKey_' + pid).trim();
    if (!v) { S.settingsMsg = '넣을 키를 입력해 주세요.'; renderSettings(); return; }
    var keys = keysCopy();
    if (keys[pid].indexOf(v) >= 0) { S.settingsMsg = '이미 넣어 둔 키예요.'; renderSettings(); return; }
    keys[pid].push(v);
    await persistKeys(keys, PROVIDERS[pid].short + ' 키 ' + keys[pid].length + '개를 저장했어요.');
}
async function removeProviderKey(pid, i) {
    var keys = keysCopy();
    if (!keys[pid] || i < 0 || i >= keys[pid].length) return;
    keys[pid].splice(i, 1);
    var act = activeIndex(pid);
    if (act >= keys[pid].length) { S.ai.active[pid] = Math.max(0, keys[pid].length - 1); saveKeyState(); }
    if (S.keyLimit && S.keyLimit[pid]) { S.keyLimit[pid] = {}; saveKeyState(); }
    await persistKeys(keys, '키를 지웠어요.');
}
function useProviderKey(pid, i) {
    if (!keyList(pid)[i]) return;
    setActiveKey(pid, i);
    clearKeyLimit(pid, i);
    S.settingsMsg = PROVIDERS[pid] ? (PROVIDERS[pid].short + ' 키 ' + (i + 1) + '(으)로 보낼게요.') : '';
    renderSettings();
}
async function saveCodeToken() {
    var v = fieldVal('setCodeToken').trim();
    var r = await saveAiConfig({ keys: keysCopy(), codeToken: v || S.ai.codeToken });
    S.settingsMsg = r.ok ? '코드 열쇠를 저장했어요.' : ('저장하지 못했어요: ' + r.error);
    renderSettings();
    toast(S.settingsMsg);
}
async function revokeDeviceById(id) {
    if (!id) return;
    var r = await revokeDevice(id);
    if (!r.ok) { toast('해제하지 못했어요: ' + (r.error || '')); return; }
    S.devices = r.devices || [];
    renderSettings();
    toast('기기를 해제했어요.');
    if (String(id) === String(S.deviceId)) { logout(); }
}
function setAutoLock(mins) {
    var m = autoLockValid(mins);
    S.pref.autoLock = m;
    savePref();
    touchActivity();
    renderSettings();
    toast(m ? ('자동 잠금을 ' + m + '분으로 맞췄어요.') : '자동 잠금을 껐어요.');
}
function saveTeamModel(teamId) {
    if (!S.office) return;
    if (teamId === 'sec') {
      /* 1F는 피클 자리라서 고를 모델이 없어요 (기록은 그대로 둡니다) */
      S.settingsMsg = DEFAULT_SECRETARY.name + ' 자리는 피클이 맡아요. 따로 고를 모델이 없어요.';
    } else {
      var t = teamById(teamId);
      if (!t) return;
      t.pid = fieldVal('tm_pid_' + teamId);
      t.model = fieldVal('tm_model_' + teamId);
      var nm = fieldVal('tn_' + teamId).trim();
      if (nm) t.name = nm.slice(0, 24);
      S.settingsMsg = t.name + ' 모델을 저장했어요.';
    }
    renderSettings(); renderAll(); saveOfficeSoon(0);
    toast(S.settingsMsg);
}
function addTeam() {
    if (!S.office) return;
    var name = fieldVal('ntName').trim();
    if (!name) { S.settingsMsg = '새 팀 이름을 넣어 주세요.'; renderSettings(); return; }
    var id = 'c' + randomHex(3);
    S.office.teams.push({
      id: id, floor: fieldVal('ntFloor') || '2F', name: name.slice(0, 24),
      emoji: (fieldVal('ntEmoji') || '🧩').slice(0, 4), color: '#cfe3f7', desc: '', pid: '', model: '', custom: true
    });
    S.settingsMsg = name + ' 팀을 만들었어요.';
    renderSettings(); renderAll(); saveOfficeSoon(0);
    toast(S.settingsMsg);
}
function delTeam(id) {
    if (!S.office) return;
    var keep = [];
    for (var i = 0; i < S.office.teams.length; i++) {
      var t = S.office.teams[i];
      if (t.id === id && t.custom) continue;
      keep.push(t);
    }
    S.office.teams = keep;
    S.settingsMsg = '팀을 지웠어요.';
    renderSettings(); renderAll(); saveOfficeSoon(0);
}
