/* ============================================================================
   AI 사무실 — office/js/ui.js
   화면 — 층 안내 · 사무실 · 팀 카드 · 결재함 · 접수함
   · office.html 이 css/style.css → js/state.js … js/boot.js 순서로 불러요.
     모듈끼리 같은 전역 스코프를 써요(함수 이름은 사무실 전체에서 하나).
   · 원래 office.html 한 덩어리 스크립트를 기능별로 나눈 파일이라 동작은 같아요.
   ============================================================================ */
'use strict';

/* 라이브러리가 쓰는 화면 갱신 자리 */
function renderModelBtn() { renderTop(); }
function modelShort(id) {
    var sp = splitModelId(id);
    var m = sp.model || id || '';
    if (m.length > 26) m = m.slice(0, 24) + '…';
    return m;
}

/* ==================================================================
     화면
     ================================================================== */
function setTab(tab) {
    S.tab = tab;
    document.body.setAttribute('data-tab', tab);
    renderTabs();
}
function renderTabs() {
    var tabs = document.getElementById('panelTabs');
    if (tabs) {
      var btns = tabs.querySelectorAll('button[data-tab]');
      for (var i = 0; i < btns.length; i++) {
        var on = btns[i].getAttribute('data-tab') === S.tab;
        btns[i].className = on ? 'on' : '';
        btns[i].setAttribute('aria-current', on ? 'page' : 'false');
      }
    }
    var wn = document.getElementById('tabWaitN'), inn = document.getElementById('tabInboxN');
    var wc = waitingList().length, ic = pendingInbox().length;
    if (wn) { wn.hidden = !wc; wn.textContent = String(wc); }
    if (inn) { inn.hidden = !ic; inn.textContent = String(ic); }
}
function renderTop() {
    var who = document.getElementById('whoLine');
    if (who) who.textContent = (S.me ? (S.me.name || S.me.id) : '-') + '님 · 대표';
    var dot = document.getElementById('connDot'), lab = document.getElementById('connLabel');
    var id = defaultModelId(), sp = splitModelId(id);
    var ok = hasKey(sp.pid);
    if (dot) dot.className = ok ? 'ok' : 'warn';
    if (lab) lab.textContent = ok ? ((PROVIDERS[sp.pid] ? PROVIDERS[sp.pid].short : '') + ' · ' + modelShort(id)) : 'AI 키 없음';
    var counts = document.getElementById('topCounts');
    if (counts) {
      var total = S.office ? S.office.work.length : 0;
      counts.innerHTML = '<span class="c-all">맡긴 일 <b>' + total + '</b></span>' +
        '<span class="c-wait">대표님 결재 대기 <b>' + waitingList().length + '</b></span>' +
        '<span class="c-work">작업 중 <b>' + (workingList().length + (S.queue ? S.queue.length : 0)) + '</b></span>';
    }
    if (lab && !ok) {
      var pill = document.getElementById('connPill');
      if (pill) pill.title = '⚙️ 설정에서 AI 키를 넣어 주세요';
    }
}
function charSvg(team) {
    var c = team && team.color ? team.color : '#cfe3f7';
    return '<svg viewBox="0 0 64 72" aria-hidden="true">' +
      '<ellipse cx="32" cy="67" rx="16" ry="3.2" fill="rgba(80,60,40,.10)"/>' +
      '<path d="M17.5 65c0-10.5 6.4-17 14.5-17s14.5 6.5 14.5 17z" fill="' + c + '"/>' +
      '<circle cx="32" cy="30" r="14.6" fill="#ffe3c9"/>' +
      '<path d="M17.4 28.4c0-9 6.6-14.2 14.6-14.2s14.6 5.2 14.6 14.2c0 2.2-.5 4-1.4 5.6-1.2-6.1-6.4-9.6-13.2-9.6s-12 3.5-13.2 9.6c-.9-1.6-1.4-3.4-1.4-5.6z" fill="#4a3b32"/>' +
      '<circle cx="26.5" cy="30.7" r="1.7" fill="#3b2f2a"/><circle cx="37.5" cy="30.7" r="1.7" fill="#3b2f2a"/>' +
      '<path d="M29.3 35.7c1.8 1.5 3.6 1.5 5.4 0" stroke="#c9765a" stroke-width="1.4" fill="none" stroke-linecap="round"/>' +
      '<circle cx="22.8" cy="34.3" r="2.1" fill="#ffb3b3" opacity=".6"/><circle cx="41.2" cy="34.3" r="2.1" fill="#ffb3b3" opacity=".6"/>' +
      '</svg>';
}
/* 피클 캐릭터 — 1F 비서실 그림 */
function pickleSvg() {
    return '<svg viewBox="0 0 64 72" aria-hidden="true">' +
      '<ellipse cx="32" cy="67" rx="15" ry="3.2" fill="rgba(80,60,40,.10)"/>' +
      '<path d="M32 12.6c9.4 0 15.4 7.3 15.4 17v20.2c0 9.8-6.6 16.2-15.4 16.2s-15.4-6.4-15.4-16.2V29.6c0-9.7 6-17 15.4-17z" fill="#a8d191"/>' +
      '<path d="M24.9 16.6c2.1-2.7 4.6-4 7.1-4s5 1.3 7.1 4c-2.5-.9-4.8-1.3-7.1-1.3s-4.6.4-7.1 1.3z" fill="#93c17c"/>' +
      '<circle cx="23.4" cy="31.4" r="2.4" fill="#95c37e" opacity=".85"/>' +
      '<circle cx="40.6" cy="38.8" r="2.1" fill="#95c37e" opacity=".85"/>' +
      '<circle cx="25.2" cy="47.6" r="2.3" fill="#95c37e" opacity=".85"/>' +
      '<circle cx="39.4" cy="55.2" r="1.9" fill="#95c37e" opacity=".85"/>' +
      '<circle cx="21.8" cy="57.4" r="1.7" fill="#95c37e" opacity=".85"/>' +
      '<path d="M31.4 12.8c-.8-4.6 1.5-8.4 6.6-9.8 1 4.8-1.6 8.8-6.6 9.8z" fill="#5aa14e"/>' +
      '<path d="M31.8 12.9c-1.5-3.5-4.5-5.5-8.8-5.7 1.7 3.9 4.6 5.7 8.8 5.7z" fill="#6fb35f"/>' +
      '<circle cx="27" cy="33.4" r="1.8" fill="#3b4a36"/><circle cx="37.2" cy="33.4" r="1.8" fill="#3b4a36"/>' +
      '<path d="M28.8 38.6c1.9 1.7 4.1 1.7 6 0" stroke="#5f6b45" stroke-width="1.4" fill="none" stroke-linecap="round"/>' +
      '<circle cx="22.6" cy="37" r="2.1" fill="#ffb3a8" opacity=".55"/><circle cx="41.6" cy="37" r="2.1" fill="#ffb3a8" opacity=".55"/>' +
      '</svg>';
}
function isPickleTeam(t) { return !!t && t.id === 'sec'; }
function teamCard(t) {
    var st = teamStatus(t.id);
    var id = teamModelId(t), sp = splitModelId(id);
    var prov = PROVIDERS[sp.pid];
    var work = workFor(t.id), openN = 0, doneN = 0;
    for (var i = 0; i < work.length; i++) {
      if (work[i].status === 'waiting') openN++;
      if (work[i].status === 'approved' || work[i].status === 'done') doneN++;
    }
    var busy = false;
    for (var k = 0; k < work.length; k++) if (S.busy[work[k].id]) busy = true;
    var picoList = isPickleTeam(t) ? picoPendingFor(t.id) : [];
    var picoN = picoList.length, picoRep = false, picoRev = false;
    for (var pi = 0; pi < picoList.length; pi++) {
      if (picoList[pi].picoStatus === 'report') picoRep = true;
      if (picoList[pi].picoStatus === 'step_review') picoRev = true;
    }
    var statusTxt = picoN ? (picoRev ? '피클 검수 대기' : (picoRep ? '피클 보고 대기' : '피클 확인 대기')) : STATUS_LABEL[st];
    var foot = '<span class="tc-foot"><span class="status ' + st + (picoN ? ' pickle' : '') + '"><i></i>' + esc(statusTxt) + '</span>' +
      '<span class="tc-n">' + (picoN ? '피클 확인 <b>' + picoN + '</b>' : (openN ? '결재 <b>' + openN + '</b>' : (doneN ? '완료 ' + doneN : (busy ? '일하는 중' : '')))) + '</span></span>';
    /* 1F 전담 비서 피클 — 모델 뱃지 대신 피클 이름과 역할을 보여 줘요 */
    if (isPickleTeam(t)) {
      return '<button class="team-card pickle" type="button" data-act="team-click" data-team="' + esc(t.id) + '"' +
        ' aria-label="' + esc(t.name) + ' 작업 현황 보기" title="' + esc(t.desc || '') + '">' +
        '<span class="tc-top"><span class="avatar">' + pickleSvg() + '<i class="em">🥒</i></span>' +
        '<span class="tc-name">' + esc(t.name) + '</span></span>' +
        '<span class="tc-model pickle"><i></i><span>피클 · 전담 비서</span></span>' +
        foot +
        '<span class="tc-role">' + esc(t.desc || DEFAULT_SECRETARY.desc) + '</span>' +
        '</button>';
    }
    return '<button class="team-card" type="button" data-act="team-click" data-team="' + esc(t.id) + '" aria-label="' + esc(t.name) + ' 작업 현황 보기">' +
      '<span class="tc-top"><span class="avatar">' + charSvg(t) + '<i class="em">' + esc(t.emoji || '🧩') + '</i></span>' +
      '<span class="tc-name">' + esc(t.name) + '</span></span>' +
      '<span class="tc-model"><i class="' + esc(sp.pid) + '"></i><span>' + esc((prov ? prov.short + ' · ' : '') + modelShort(id)) + '</span></span>' +
      foot +
      '</button>';
}
function apMini(w) {
    if (w.kind === 'notice') {
      return '<div class="ap-mini notice">' +
        '<span class="am-ic">⚠️</span>' +
        '<span class="am-body"><b class="am-title">' + esc(w.title) + '</b>' +
        '<span class="am-sub">' + esc(clip((w.secretary && w.secretary.summary) || '', 60)) + ' · ' + esc(whenLabel(w.updatedAt)) + '</span></span>' +
        '<span class="am-act">' +
        '<button class="btn-s ok" type="button" data-act="rerun-work" data-id="' + esc(w.noticeOf || '') + '">다시 실행</button>' +
        '<button class="btn-s" type="button" data-act="close-notice" data-id="' + esc(w.id) + '">닫기</button>' +
        '</span></div>';
    }
    var team = teamById(w.teamId) || secretaryTeam();
    var sub = w.kind === 'delegation'
      ? ('비서 ' + (w.phase === 'step_review' ? '중간 검수' : (w.phase === 'report' ? '최종 취합 보고' : '배분 계획')) + ' · ' + ((w.delegationPlan || []).length) + '개 팀 · ' + whenLabel(w.updatedAt))
      : (team.name + ' · 비서 정리 보고 · ' + whenLabel(w.updatedAt));
    return '<div class="ap-mini">' +
      '<span class="am-ic">' + esc(team.emoji || '📄') + '</span>' +
      '<span class="am-body"><b class="am-title">' + esc(w.title) + '</b>' +
      '<span class="am-sub">' + esc(sub) + '</span></span>' +
      '<span class="am-act">' +
      '<button class="btn-s ok" type="button" data-act="approve" data-id="' + esc(w.id) + '">' +
      (w.kind === 'delegation' && w.phase === 'plan' ? '계획 승인' : '승인') + '</button>' +
      '<button class="btn-s warn" type="button" data-act="reject-open" data-id="' + esc(w.id) + '">반려</button>' +
      '</span></div>';
}
function renderOffice() {
    var box = document.getElementById('officeView');
    if (!box) return;
    if (!S.office) { box.innerHTML = ''; return; }
    var h = '';
    var working = workingList().length;
    h += '<div class="office-head"><h2>건물 전체 · 1~5층</h2><p>' +
      (working ? working + '팀이 일하고 있어요 · ' : '') + '팀 카드를 누르면 지금 하는 일과 진행 상황을 볼 수 있어요</p></div>';

    /* 5F 대표실 */
    var wait = waitingList();
    h += '<section class="room owner" id="room-5F"><div class="room-head">' +
      '<span class="room-floor">5F</span><span class="room-name">대표실</span><span class="room-sub">결재 · 승인</span>' +
      '<span class="room-wait' + (wait.length ? '' : ' zero') + '">' + (wait.length ? wait.length + '건 기다림' : '기다리는 결재 없음') + '</span></div>';
    if (wait.length) {
      for (var i = 0; i < Math.min(wait.length, 3); i++) h += apMini(wait[i]);
      if (wait.length > 3) h += '<p class="empty">외 ' + (wait.length - 3) + '건은 결재함에서 볼 수 있어요.</p>';
    } else {
      h += '<p class="empty">비서가 올린 정리 보고가 여기에 쌓여요. 아직 결재할 일이 없어요.</p>';
    }
    var revs5 = reviewList();
    if (revs5.length) {
      h += '<p class="empty" style="margin-top:8px">🥒 피클이 검수 중인 일 · ' + revs5.length + '건 (대표님 승인 없이 이어서 진행해요)</p>';
      for (var rv = 0; rv < Math.min(revs5.length, 3); rv++) {
        var rvi = revs5[rv], rsr = rvi.stepReview || {};
        h += '<div class="ap-mini" data-act="open-work-detail" data-id="' + esc(rvi.id) + '"><span class="am-ic">🥒</span>' +
          '<span class="am-body"><b class="am-title">' + esc(rvi.title) + '</b>' +
          '<span class="am-sub">' + esc('피클 중간 검수 · ' + (rsr.stepNo || 1) + '/' + (rsr.totalSteps || ((rvi.childIds || []).length)) + '단계 · 다음 ' + (rsr.nextTeamName || '마감') + ' · ' + whenLabel(rvi.updatedAt)) + '</span></span></div>';
      }
    }
    h += '</section>';

    /* 4F~2F */
    for (var f = 1; f <= 3; f++) {
      var floor = FLOORS[f];
      var teams = [];
      for (var t = 0; t < S.office.teams.length; t++) if (S.office.teams[t].floor === floor.id) teams.push(S.office.teams[t]);
      if (!teams.length) continue;
      var wcount = 0, wa = 0;
      for (var z = 0; z < teams.length; z++) {
        var wl = workFor(teams[z].id);
        for (var y = 0; y < wl.length; y++) if (wl[y].status === 'waiting') wa++;
      }
      h += '<section class="room" id="room-' + floor.id + '"><div class="room-head">' +
        '<span class="room-floor">' + floor.id + '</span><span class="room-name">' + esc(floor.name) + '</span>' +
        '<span class="room-sub">' + esc(floor.sub) + '</span>' +
        (wa ? '<span class="room-wait">' + wa + '건 결재 대기</span>' : '') +
        '</div><div class="team-grid">';
      for (var c = 0; c < teams.length; c++) h += teamCard(teams[c]);
      h += '</div></section>';
    }

    /* 1F 비서실 — 대표님의 전담 비서 피클 자리 */
    var secTeam = secretaryTeam();
    h += '<section class="room lobby" id="room-1F"><div class="room-head">' +
      '<span class="room-floor">1F</span><span class="room-name">로비 · 비서실</span><span class="room-sub">전담 비서 피클 · 요청 접수 · 배분 · 보고</span>' +
      '</div><div class="team-grid">' + teamCard(secTeam) + '</div>' +
      '<p class="lobby-row"><span class="lz">1F 비서실은 외부 AI 모델이 아니라 대표님의 전담 비서 피클이 맡아요 — 가족 화면에서 온 요청을 접수해 브리핑하고, 대표님이 승인하면 4F~2F 팀에 나눠 전달한 뒤 결과를 하나로 모아 보고해요. 카드를 누르면 지금 하는 일과 진행 기록을 볼 수 있고, 대표님 승인 없이는 다음 단계로 넘어가지 않아요.</span></p>' +
      '</section>';
    box.innerHTML = h;
}
function renderRail() {
    var rail = document.getElementById('floorRail');
    if (!rail) return;
    var h = '<div class="rlabel">건물 안내<br>1~5층</div>' +
      '<button type="button" data-act="go-floor" data-floor="all" class="on"><b>전체</b><span>건물</span><i class="rn">' + (S.office ? S.office.teams.length : 0) + '</i></button>';
    for (var i = 0; i < FLOORS.length; i++) {
      var fl = FLOORS[i], n = 0, w = 0;
      if (fl.id === '5F') { n = waitingList().length; w = workingList().length; }
      else if (fl.id === '1F') { n = 1; }
      else {
        for (var t = 0; t < (S.office ? S.office.teams.length : 0); t++) {
          var team = S.office.teams[t];
          if (team.floor !== fl.id) continue;
          n++;
          var st = teamStatus(team.id);
          if (st === 'waiting') w++;
        }
      }
      h += '<button type="button" data-act="go-floor" data-floor="' + fl.id + '"><b>' + fl.id + '</b><span>' + esc(fl.name) + '</span><i class="rn">' + n + (w ? ' · ' + w + '!' : '') + '</i></button>';
    }
    rail.innerHTML = h;
}
function pullDraft() {
    var t = document.getElementById('directTeam');
    if (t) S.draft.team = t.value || S.draft.team;
    var ti = document.getElementById('directTitle');
    if (ti) S.draft.title = ti.value || '';
    var tx = document.getElementById('directText');
    if (tx) S.draft.text = tx.value || '';
    var m = document.getElementById('directMaterial');
    if (m) S.draft.material = m.value || '';
}
function renderPanel() {
    var panel = document.getElementById('panel');
    if (!panel) return;
    if (S.clearDraft) S.clearDraft = false;
    else pullDraft();
    panel.innerHTML = paneDirect() + paneApprove() + paneInbox();
    renderTabs();
}
function teamOptions(sel) {
    var h = '<option value="sec"' + (sel === 'sec' ? ' selected' : '') + '>1F · ' + esc(DEFAULT_SECRETARY.name) + '</option>';
    for (var i = 0; i < S.office.teams.length; i++) {
      var t = S.office.teams[i];
      h += '<option value="' + esc(t.id) + '"' + (t.id === sel ? ' selected' : '') + '>' + esc(t.floor + ' · ' + t.name) + '</option>';
    }
    return h;
}
function materialOptions(sel) {
    var h = '<option value="">없음</option>';
    var list = (S.office && S.office.work) || [];
    for (var i = list.length - 1; i >= 0; i--) {
      var w = list[i];
      if (!w.report && !w.secretary) continue;
      var team = teamById(w.teamId) || { name: w.teamId };
      h += '<option value="' + esc(w.id) + '"' + (w.id === sel ? ' selected' : '') + '>' +
        esc('[' + team.name + '] ' + clip(w.title, 26) + ' · ' + whenLabel(w.updatedAt)) + '</option>';
    }
    return h;
}
function paneDirect() {
    var h = '<section class="pane" data-pane="direct">';
    h += '<div class="pane-head"><h3>📝 지시하기</h3><span class="n">' + (workingList().length) + ' 진행 중</span></div>';
    h += '<div class="pane-body"><form id="directForm" autocomplete="off">';
    if (S.directHint) h += '<p class="hint" style="color:#5d4f96;font-weight:900">' + esc(S.directHint) + '</p>';
    h += '<div class="field"><span class="lbl">부서</span><select id="directTeam">' + teamOptions(S.draft.team) + '</select></div>';
    if (S.draft.team === 'sec') h += '<p class="hint">1F 비서실은 전담 비서 피클이 맡아요. 여기에 적으면 피클이 직접 확인해서 어떤 팀에 어떤 순서로 나눌지 배분 계획을 세우고 결재함에 올려요. 외부 AI 일꾼은 부르지 않아요.</p>';
    h += '<div class="field"><span class="lbl">제목 (선택)</span><input id="directTitle" maxlength="60" placeholder="예: 11월 말 가계부 정리" value="' + esc(S.draft.title) + '"></div>';
    h += '<div class="field"><span class="lbl">지시 내용</span><textarea id="directText" placeholder="예: 이번 주 냉장고 재고로 만들 수 있는 저녁 메뉴 3가지를 정리해 줘.">' + esc(S.draft.text) + '</textarea></div>';
    h += '<div class="field"><span class="lbl">넘길 자료 (선택)</span><select id="directMaterial">' + materialOptions(S.draft.material) + '</select></div>';
    h += '<div class="chiprow"><button class="chip" type="button" data-act="inbox-collect">📥 접수 건 취합 지시</button>' +
      '<button class="chip" type="button" data-act="fill-team" data-team="dev">🧑‍💻 개발팀에 코드 수정</button></div>';
    h += '<button class="btn clay" type="submit" id="directSend">지시 보내기</button>';
    h += '<p class="hint">팀이 일을 마치면 비서가 핵심만 정리해 대표실 결재함으로 올려요. 대표님 승인 없이는 다음 단계로 넘어가지 않아요.</p>';
    h += '</form></div></section>';
    return h;
}
function nextButtons(item) {
    var h = '';
    if (item.code && item.teamId === 'qc') {
      h += '<button class="btn-s ok" type="button" data-act="commit-code" data-id="' + esc(item.id) + '">최종 승인하고 반영</button>';
    } else if (item.code) {
      h += '<button class="btn-s ok" type="button" data-act="qc-handoff" data-id="' + esc(item.id) + '">QC 검수 요청</button>';
      h += '<button class="btn-s warn" type="button" data-act="commit-code" data-id="' + esc(item.id) + '">지금 바로 반영</button>';
    } else {
      var list = (item.secretary && item.secretary.next) || (item.report && item.report.next) || [];
      var shown = 0;
      for (var i = 0; i < list.length && shown < 2; i++) {
        if (!list[i].teamId || list[i].teamId === item.teamId) continue;
        h += '<button class="btn-s ok" type="button" data-act="handoff" data-id="' + esc(item.id) + '" data-team="' + esc(list[i].teamId) + '">' + esc(clip(list[i].label, 18)) + '</button>';
        shown++;
      }
      if (!shown) h += '<button class="btn-s" type="button" data-act="handoff-pick" data-id="' + esc(item.id) + '">다른 팀으로 넘기기</button>';
    }
    h += '<button class="btn-s" type="button" data-act="next-done" data-id="' + esc(item.id) + '">여기서 마무리</button>';
    return h;
}
function apCard(item) {
    if (item.kind === 'notice') return apNoticeCard(item);
    if (item.kind === 'delegation') return apDelegationCard(item);
    var team = teamById(item.teamId) || { name: item.teamId, emoji: '📄' };
    var sec = item.secretary || {};
    var rep = item.report || {};
    var h = '<div class="ap-card' + (item.status === 'approved' ? ' approved' : (item.status === 'rejected' ? ' rejected' : '')) + '" data-work="' + esc(item.id) + '">';
    h += '<div class="ap-h"><span>' + esc(team.emoji || '📄') + ' 비서 최종 정리 보고</span><span class="who">· ' + esc(team.name) + '</span><span class="when">' + esc(whenLabel(item.updatedAt)) + '</span></div>';
    h += '<div class="ap-t">' + esc(item.title) + '</div>';
    h += '<div class="ap-sum">' + esc(sec.summary || rep.summary || '') + '</div>';
    if (sec.points && sec.points.length) {
      h += '<ul class="ap-points">';
      for (var i = 0; i < sec.points.length; i++) h += '<li>' + esc(sec.points[i]) + '</li>';
      h += '</ul>';
    }
    if (sec.recommend) h += '<div class="ap-rec">추천: ' + esc(sec.recommend) + '</div>';
    if (item.code) {
      var c = item.code;
      h += '<div class="codemeta"><span>' + esc(fileLabel(c.repo, c.path)) + '</span><span class="' + (c.checkOk ? 'ok' : 'bad') + '">' + (c.checkOk ? '자동 검사 통과' : '자동 검사 문제') + '</span>' +
        '<span>+' + c.added + ' −' + c.removed + '</span><span>아직 반영 전</span></div>';
    }
    if (rep.detail) {
      var dk = 'd_' + item.id;
      h += '<details class="ap-d" data-key="' + esc(dk) + '"' + (S.details[dk] ? ' open' : '') + '><summary>원문 상세 (팀 보고)</summary><div class="ap-detail">' + esc(rep.detail) + '</div></details>';
    }
    if (item.code && item.code.diffText) {
      var dk2 = 'c_' + item.id;
      h += '<details class="ap-d" data-key="' + esc(dk2) + '"' + (S.details[dk2] ? ' open' : '') + '><summary>코드 수정안 · 변경 내용</summary>' +
        '<div class="diffbox"><pre>' + diffHtmlPlain(item.code.diffText) + '</pre></div>' +
        (item.code.checkErrors && item.code.checkErrors.length ? '<div class="ap-detail">검사: ' + esc(item.code.checkErrors.join('\n')) + '</div>' : '') +
        '</details>';
    }
    if (item.log && item.log.length) {
      var dk3 = 'l_' + item.id;
      h += '<details class="ap-d" data-key="' + esc(dk3) + '"' + (S.details[dk3] ? ' open' : '') + '><summary>작업 기록</summary><div class="ap-detail">' +
        esc(item.log.map(function (x) { return '· ' + x.text; }).join('\n')) + '</div></details>';
    }
    if (item.status === 'waiting') {
      h += '<div class="ap-actions"><button class="btn-s ok" type="button" data-act="approve" data-id="' + esc(item.id) + '">승인</button>' +
        '<button class="btn-s warn" type="button" data-act="reject-open" data-id="' + esc(item.id) + '">반려</button>' +
        '<button class="btn-s danger" type="button" data-act="delete-work" data-id="' + esc(item.id) + '">삭제</button></div>';
      if (S.rejectOpen[item.id]) {
        h += '<div class="rejectbox"><textarea id="rej_' + esc(item.id) + '" placeholder="반려 사유 — 이 내용으로 팀이 다시 일해요"></textarea>' +
          '<div class="btn-line" style="margin-top:6px"><button class="btn warn" type="button" data-act="reject" data-id="' + esc(item.id) + '">반려하고 재작업</button>' +
          '<button class="btn danger" type="button" data-act="reject-delete" data-id="' + esc(item.id) + '">반려 후 삭제</button>' +
          '<button class="btn ghost" type="button" data-act="reject-cancel" data-id="' + esc(item.id) + '">취소</button></div></div>';
      }
    } else if (item.status === 'approved') {
      if (!item.nextDone) h += '<div class="ap-actions">' + nextButtons(item) + '</div>';
      else if (item.commit) {
        h += '<div class="ap-rec">' + (item.commit.ok ? '✅ 코드에 반영했어요 · ' + esc(fileLabel(item.commit.repo, item.commit.path)) : '⚠️ 반영하지 못했어요 · ' + esc(clip(item.commit.error || '', 80))) + '</div>';
      } else {
        h += '<div class="ap-rec">승인 완료 · 마무리했어요</div>';
      }
    } else if (item.status === 'rejected') {
      h += '<div class="ap-rec" style="background:#fff1f2;color:#c14160">반려함 · ' + esc(clip(item.rejectReason || '', 120)) + '</div>' +
        '<div class="ap-actions"><button class="btn-s danger" type="button" data-act="delete-work" data-id="' + esc(item.id) + '">삭제</button></div>';
    }
    h += '</div>';
    return h;
}
function pipelineLine(sec) {
    var n = ((sec && sec.childIds) || []).length;
    var done = 0, idx = 0, curName = '';
    for (var i = 0; i < n; i++) {
      var c = workById(sec.childIds[i]);
      if (!c) continue;
      if (c.status === 'done') done++;
      if ((c.status === 'working' || c.status === 'queued') && !curName) {
        curName = (teamById(c.teamId) || { name: c.teamId }).name;
        idx = i + 1;
      }
    }
    var now = idx ? idx : Math.min(done + 1, n);
    if (sec && sec.phase === 'step_review') {
      return '<p class="tm-note">' + done + '/' + n + '단계 끝남 · 피클이 결과를 보고 다음 팀으로 넘겨요' +
        (curName ? ' (다음 · ' + esc(curName) + ')' : '') + '</p>';
    }
    return '<p class="tm-note">팀에 순서대로 전달 중 · ' + now + '/' + n + '번째' +
      (curName ? ' · ' + esc(curName) + ' 진행 중' : '') + ' · 끝난 팀 ' + done + '</p>';
}
/* ---------- 비서 배분 계획·취합 보고 결재 카드 ---------- */
function childRow(c) {
    var t = teamById(c.teamId) || { name: c.teamId, emoji: '📄' };
    var rep = c.report || {};
    var stateTxt = c.status === 'done' ? '완료' : c.status === 'failed' ? '실패' : (c.status === 'working' ? '작업 중' : (c.status === 'queued' ? '기다림' : '보고 전'));
    var cls = c.status === 'done' ? 'done' : '';
    var body = c.status === 'failed' ? (c.error || '작업을 마치지 못했어요.') : (rep.summary || (c.status === 'queued' ? '앞 팀이 끝나면 시작해요.' : '아직 보고 전이에요.'));
    return '<div class="child-row"><b>' + esc(t.emoji + ' ' + t.name) + ' · ' + esc(c.title) + '</b>' +
      '<span class="r-badge ' + cls + '">' + esc(stateTxt) + '</span>' +
      '<span>' + esc(clip(body, 300)) + '</span>' +
      (c.code ? '<span>' + esc('수정안 · ' + fileLabel(c.code.repo, c.code.path) + ' (+' + c.code.added + ' −' + c.code.removed + ') · 아직 반영 전') + '</span>' : '') +
      '</div>';
}
function apDelegationCard(item) {
    var plan = item.delegationPlan || [];
    var phase = item.phase || 'plan';
    var kids = secChildList(item);
    var sec = item.secretary || {};
    var headTxt = phase === 'report' ? '비서 최종 취합 보고' : (phase === 'step_review' ? '피클 중간 검수' : ((phase === 'run' || phase === 'collect') ? '비서 배분 실행 중' : '비서 배분 계획'));
    var h = '<div class="ap-card delegation' + (item.status === 'approved' ? ' approved' : (item.status === 'rejected' ? ' rejected' : '')) + '" data-work="' + esc(item.id) + '">';
    h += '<div class="ap-h"><span>🗒️ ' + esc(headTxt) + '</span><span class="who">· 비서</span><span class="when">' + esc(whenLabel(item.updatedAt)) + '</span></div>';
    h += '<div class="ap-t">' + esc(item.title) + '</div>';
    if (phase === 'plan') {
      h += '<div class="ap-sum">' + esc(sec.summary || '') + '</div>';
      if (plan.length) {
        h += '<ol class="plan-list">';
        for (var i = 0; i < plan.length; i++) {
          var t = teamById(plan[i].deptId) || { name: plan[i].deptId, emoji: '📄' };
          h += '<li><div class="pl-body"><b>' + esc(t.emoji + ' ' + t.name + ' · ' + plan[i].title) + '</b>' +
            '<span>' + esc(clip(plan[i].prompt, 260)) + '</span></div></li>';
        }
        h += '</ol>';
        h += '<p class="tm-note">승인은 이 한 번만 — 그 뒤에는 피클이 단계마다 검수하며 팀을 끝까지 진행하고, 결과만 결재함에 올려요. (인증·저장 구조처럼 여파가 큰 변경만 자동 반영하지 않고 다시 확인을 받아요.)</p>';
      }
    } else if (phase === 'step_review') {
      var sr = item.stepReview || {};
      h += '<div class="ap-sum">' + esc((sr.failed ? '⚠ ' : '') + (sr.teamName || '팀') + ' 단계가 끝났어요 · ' + (sr.stepNo || 1) + '/' + (sr.totalSteps || (item.childIds || []).length) + '단계') + '</div>';
      if (sr.summary) h += '<div class="ap-sum">' + esc(clip(String(sr.summary), 400)) + '</div>';
      if (sr.hasCode) h += '<div class="codemeta"><span>' + esc('수정안 · ' + fileLabel((sr.code && sr.code.repo) || '', (sr.code && sr.code.path) || '')) + '</span><span class="' + ((sr.code && sr.code.checkOk) ? 'ok' : 'bad') + '">' + ((sr.code && sr.code.checkOk) ? '자동 검사 통과' : '자동 검사 문제') + '</span><span>아직 반영 전</span></div>';
      h += '<p class="tm-note">피클이 이 결과를 검수해 다음 팀(' + esc(sr.nextTeamName || '마감') + ')으로 넘기면 이어서 진행해요. 대표님이 따로 승인하지 않아도 돼요.</p>';
      if (kids.length) {
        h += '<div class="tm-list" style="margin-top:7px">';
        for (var sr2 = 0; sr2 < kids.length; sr2++) h += childRow(kids[sr2]);
        h += '</div>';
      }
    } else if (phase === 'run' || phase === 'collect') {
      h += '<div class="ap-sum">' + esc(sec.summary || '배분 계획대로 팀에 순서대로 전달하고 있어요.') + '</div>';
      h += pipelineLine(item);
      if (kids.length) {
        h += '<div class="tm-list" style="margin-top:7px">';
        for (var r = 0; r < kids.length; r++) h += childRow(kids[r]);
        h += '</div>';
      }
    } else {
      h += '<div class="ap-sum">' + esc(sec.summary || (item.report && item.report.summary) || '') + '</div>';
      if (kids.length) {
        h += '<div class="tm-list" style="margin-top:7px">';
        for (var k = 0; k < kids.length; k++) h += childRow(kids[k]);
        h += '</div>';
      }
      if (item.code) {
        var c = item.code;
        h += '<div class="codemeta"><span>' + esc(fileLabel(c.repo, c.path)) + '</span><span class="' + (c.checkOk ? 'ok' : 'bad') + '">' + (c.checkOk ? '자동 검사 통과' : '자동 검사 문제') + '</span>' +
          '<span>+' + c.added + ' −' + c.removed + '</span><span>아직 반영 전</span></div>';
      }
      if (sec.points && sec.points.length) {
        h += '<ul class="ap-points">';
        for (var p = 0; p < sec.points.length; p++) h += '<li>' + esc(sec.points[p]) + '</li>';
        h += '</ul>';
      }
      if (sec.recommend) h += '<div class="ap-rec">추천: ' + esc(sec.recommend) + '</div>';
      if (item.autoCommit && item.autoCommit.ok) {
        h += '<div class="ap-rec" style="background:#eef9f1;color:#2f6b45;border:1px solid #cfe8d8">✅ QC를 통과해 자동으로 반영했어요 · ' + esc(fileLabel(item.autoCommit.repo || '', item.autoCommit.path || '')) + '</div>';
      } else if (item.highRisk) {
        h += '<div class="ap-rec" style="background:#fff4e5;color:#8a5a00;border:1px solid #f0dcc0">⚠️ 여파가 큰 변경이라 자동으로 반영하지 않았어요 · ' + esc(clip(item.riskReason || '', 200)) + '</div>';
      } else if (item.autoCommit && item.autoCommit.ok === false) {
        h += '<div class="ap-rec" style="background:#fff1f2;color:#c14160">자동 반영하지 못했어요 · ' + esc(clip(item.autoCommit.error || '', 160)) +
          (item.autoCommit.noToken ? ' — 사무실 ⚙️ 설정 → 코드 열쇠를 넣으면 다음부터 자동 반영돼요' : '') + '</div>';
      }
    }
    if (item.report && item.report.detail) {
      var dk = 'd_' + item.id;
      h += '<details class="ap-d" data-key="' + esc(dk) + '"' + (S.details[dk] ? ' open' : '') + '><summary>팀별 결과 원문</summary><div class="ap-detail">' + esc(item.report.detail) + '</div></details>';
    }
    if (item.code && item.code.diffText) {
      var dk2 = 'c_' + item.id;
      h += '<details class="ap-d" data-key="' + esc(dk2) + '"' + (S.details[dk2] ? ' open' : '') + '><summary>코드 수정안 · 변경 내용</summary><div class="diffbox"><pre>' + diffHtmlPlain(item.code.diffText) + '</pre></div>' +
        (item.code.checkErrors && item.code.checkErrors.length ? '<div class="ap-detail">검사: ' + esc(item.code.checkErrors.join('\n')) + '</div>' : '') + '</details>';
    }
    if (item.log && item.log.length) {
      var dk3 = 'l_' + item.id;
      h += '<details class="ap-d" data-key="' + esc(dk3) + '"' + (S.details[dk3] ? ' open' : '') + '><summary>작업 기록</summary><div class="ap-detail">' +
        esc(item.log.map(function (x) { return '· ' + x.text; }).join('\n')) + '</div></details>';
    }
    /* 코드 수정이 필요한 일인데 수정안이 비어 있으면 단순 [승인]으로 완료되지 않게 막아요 */
    var missCode = !item.code && phase !== 'plan' && (item.codeMissing || codeIntent(item));
    if (missCode) {
      h += '<div class="ap-rec" style="background:#fff4e5;color:#8a5a00;border:1px solid #f0dcc0">⚠️ 실제 코드 수정안이 만들어지지 않았어요</div>' +
        '<p class="tm-note">텍스트 보고만으로는 완료 처리하지 않아요. 개발팀에 실제 코드 수정안을 다시 요청하거나, 필요 없는 일이면 반려 후 삭제해 주세요.</p>';
    }
    if (item.status === 'waiting') {
      h += '<div class="ap-actions">';
      if (missCode) {
        h += '<button class="btn-s ok" type="button" data-act="sec-code-retry" data-id="' + esc(item.id) + '">개발팀에 다시 코드 작성 요청</button>' +
          '<button class="btn-s danger" type="button" data-act="reject-delete" data-id="' + esc(item.id) + '">반려 후 삭제</button>';
      } else if (phase === 'plan') {
        h += '<button class="btn-s ok" type="button" data-act="approve" data-id="' + esc(item.id) + '">배분 계획 승인</button>' +
          '<button class="btn-s warn" type="button" data-act="reject-open" data-id="' + esc(item.id) + '">반려</button>' +
          '<button class="btn-s danger" type="button" data-act="delete-work" data-id="' + esc(item.id) + '">삭제</button>';
      } else if (item.code) {
        h += '<button class="btn-s ok" type="button" data-act="sec-qc" data-id="' + esc(item.id) + '">QC 검수 요청</button>' +
          '<button class="btn-s ok" type="button" data-act="sec-commit" data-id="' + esc(item.id) + '">최종 승인하고 반영</button>' +
          '<button class="btn-s warn" type="button" data-act="reject-open" data-id="' + esc(item.id) + '">반려</button>' +
          '<button class="btn-s danger" type="button" data-act="delete-work" data-id="' + esc(item.id) + '">삭제</button>';
      } else {
        h += '<button class="btn-s ok" type="button" data-act="approve" data-id="' + esc(item.id) + '">승인</button>' +
          '<button class="btn-s warn" type="button" data-act="reject-open" data-id="' + esc(item.id) + '">반려</button>' +
          '<button class="btn-s danger" type="button" data-act="delete-work" data-id="' + esc(item.id) + '">삭제</button>';
      }
      h += '</div>';
      if (S.rejectOpen[item.id] && !missCode) {
        h += '<div class="rejectbox"><textarea id="rej_' + esc(item.id) + '" placeholder="반려 사유 — 이 내용으로 비서가 배분 계획을 다시 세워요"></textarea>' +
          '<div class="btn-line" style="margin-top:6px"><button class="btn warn" type="button" data-act="reject" data-id="' + esc(item.id) + '">반려하고 다시 계획</button>' +
          '<button class="btn danger" type="button" data-act="reject-delete" data-id="' + esc(item.id) + '">반려 후 삭제</button>' +
          '<button class="btn ghost" type="button" data-act="reject-cancel" data-id="' + esc(item.id) + '">취소</button></div></div>';
      }
    } else if (item.status === 'done') {
      if (item.commit && item.commit.ok) {
        h += '<div class="ap-rec" style="background:#eef9f1;color:#2f6b45;border:1px solid #cfe8d8">✅ QC 검수를 통과해 코드에 반영했어요 · ' + esc(fileLabel(item.commit.repo || '', item.commit.path || '')) + '</div>';
      } else {
        h += '<div class="ap-rec">마무리된 일이에요 · 최근 마무리에서 볼 수 있어요.</div>';
      }
    } else if (item.status === 'approved') {
      if (item.commit) {
        h += '<div class="ap-rec">' + (item.commit.ok ? '✅ 코드에 반영했어요 · ' + esc(fileLabel(item.commit.repo, item.commit.path)) : '⚠️ 반영하지 못했어요 · ' + esc(clip(item.commit.error || '', 80))) + '</div>';
      } else if (phase === 'run' || phase === 'collect') {
        h += '<div class="ap-rec">배분 계획 승인됨 · 팀에 전달하는 중이에요</div>';
      } else {
        h += '<div class="ap-rec">대표님 최종 승인 완료</div>';
      }
    } else if (item.status === 'rejected') {
      h += '<div class="ap-rec" style="background:#fff1f2;color:#c14160">반려함 · ' + esc(clip(item.rejectReason || '', 120)) + '</div>' +
        '<div class="ap-actions"><button class="btn-s danger" type="button" data-act="delete-work" data-id="' + esc(item.id) + '">삭제</button></div>';
    } else if (item.status === 'failed') {
      h += '<div class="ap-rec" style="background:#fff1f2;color:#c14160">실패 · ' + esc(clip(item.error || '', 140)) + '</div>' +
        '<div class="ap-actions"><button class="btn-s ok" type="button" data-act="rerun-work" data-id="' + esc(item.id) + '">다시 실행</button>' +
        '<button class="btn-s danger" type="button" data-act="delete-work" data-id="' + esc(item.id) + '">삭제</button></div>';
    }
    h += '</div>';
    return h;
}
/* 비서가 올린 '문제 보고' 카드 — 원인 + [다시 실행] / [닫기(확인)] */
function apNoticeCard(item) {
    var sec = item.secretary || {};
    var src = workById(item.noticeOf) || null;
    var who = src ? ((src.teamId === 'sec' ? '비서' : ((teamById(src.teamId) || {}).name || '팀'))) : '팀';
    var h = '<div class="ap-card notice" data-work="' + esc(item.id) + '">';
    h += '<div class="ap-h"><span>⚠ 비서 보고</span><span class="who">· 1F 비서실</span><span class="when">' + esc(whenLabel(item.updatedAt)) + '</span></div>';
    h += '<div class="ap-t">' + esc(item.title) + '</div>';
    h += '<div class="ap-sum">' + esc(sec.summary || '작업이 멈춰 비서가 정리했어요.') + '</div>';
    if (sec.points && sec.points.length) {
      h += '<ul class="ap-points">';
      for (var i = 0; i < sec.points.length; i++) h += '<li>' + esc(sec.points[i]) + '</li>';
      h += '</ul>';
    }
    if (src) h += '<p class="tm-note">원래 일 · ' + esc(clip(src.title || '', 60)) + ' (' + esc(who) + ')</p>';
    if (item.status === 'waiting') {
      h += '<div class="ap-actions">';
      if (src) h += '<button class="btn-s ok" type="button" data-act="rerun-work" data-id="' + esc(src.id) + '">다시 실행</button>';
      h += '<button class="btn-s" type="button" data-act="close-notice" data-id="' + esc(item.id) + '">닫기(확인)</button>';
      h += '</div>';
    } else {
      h += '<div class="ap-rec">확인하고 닫았어요</div>';
    }
    h += '</div>';
    return h;
}
function diffHtmlPlain(text) {
    var lines = String(text || '').split('\n'), out = [];
    for (var i = 0; i < lines.length && i < 400; i++) {
      var ln = lines[i], cls = 'ctx';
      if (ln.charAt(0) === '+') cls = 'add';
      else if (ln.charAt(0) === '-') cls = 'del';
      out.push('<span class="' + cls + '">' + esc(ln) + '</span>');
    }
    return out.join('\n');
}
function paneApprove() {
    var wait = waitingList(), next = nextStepList(), failed = failedList();
    var h = '<section class="pane" data-pane="approve">';
    h += '<div class="pane-head"><h3>✅ 대표님 결재함</h3><span class="n">' + (wait.length ? wait.length + '건 대기' : '대기 없음') + '</span></div><div class="pane-body">';
    if (!wait.length && !next.length && !failed.length) {
      h += '<p class="empty">결재할 일이 없어요. 팀이 일을 마치면 비서가 정리해 여기로 올려요.</p>';
    }
    for (var f2 = 0; f2 < failed.length; f2++) {
      var fw = failed[f2], ft = teamById(fw.teamId) || { name: fw.teamId, emoji: '📄' };
      h += '<div class="ap-card rejected"><div class="ap-h"><span>⚠ 안내</span><span class="who">· ' + esc(ft.name) + '</span><span class="when">' + esc(whenLabel(fw.updatedAt)) + '</span></div>' +
        '<div class="ap-t">' + esc(fw.title) + '</div>' +
        '<div class="ap-sum">' + esc(fw.error || '작업을 마치지 못했어요.') + '</div>' +
        '<div class="ap-actions"><button class="btn-s ok" type="button" data-act="retry" data-id="' + esc(fw.id) + '">다시 맡기기</button>' +
        '<button class="btn-s" type="button" data-act="dismiss-fail" data-id="' + esc(fw.id) + '">치우기</button>' +
        '<button class="btn-s danger" type="button" data-act="delete-work" data-id="' + esc(fw.id) + '">삭제</button></div></div>';
    }
    for (var i = wait.length - 1; i >= 0; i--) h += apCard(wait[i]);
    var revs = reviewList();
    if (revs.length) {
      h += '<div class="gtitle" style="display:flex;font-size:11px;font-weight:900;color:#8d849f;margin:10px 0 6px">🥒 피클이 검수 중 · ' + revs.length + '</div>';
      for (var rv2 = 0; rv2 < revs.length; rv2++) h += apCard(revs[rv2]);
    }
    if (next.length) {
      h += '<div class="gtitle" style="display:flex;font-size:11px;font-weight:900;color:#8d849f;margin:10px 0 6px">승인한 일 · 다음 단계</div>';
      for (var k = 0; k < next.length; k++) h += apCard(next[k]);
    }
    var done = finishedList();
    if (done.length) {      h += '<div class="gtitle" style="display:flex;font-size:11px;font-weight:900;color:#8d849f;margin:10px 0 6px">최근 마무리</div>';
      for (var d = 0; d < done.length; d++) {
        var dd = done[d], dteam = teamById(dd.teamId) || { name: dd.teamId, emoji: '📄' };
        h +=
          '<div class="mrow" data-act="open-work-detail" data-id="' + esc(dd.id) + '" role="button" tabindex="0" title="눌러서 자세히 보기">' +
          '<div class="mi"><b>' + esc(dd.title) + '</b><span>' +
          esc(dteam.name + ' · ' + (dd.commit ? (dd.commit.ok ? '코드 반영 완료' : '반영 실패') : '승인 후 마무리') + ' · ' + whenLabel(dd.nextAt || dd.updatedAt)) +
          '</span></div><span class="badge">' + (dd.commit && dd.commit.ok ? '반영됨' : '완료') + '</span>' +
          '<button class="btn-s danger mini" type="button" data-act="delete-work" data-id="' + esc(dd.id) + '">삭제</button></div>';
      }
    }
    h += '</div></section>';
    return h;
}
function paneInbox() {
    var pend = pendingInbox();
    var h = '<section class="pane" data-pane="inbox">';
    h += '<div class="pane-head"><h3>📥 CS 접수함</h3><span class="n">' + (pend.length ? '미처리 ' + pend.length : '미처리 없음') + '</span></div><div class="pane-body">';
    h += '<p class="hint">아이·냉파·가계부·우리 집 화면의 챗봇 버튼으로 들어온 요구가 여기 모여요. 접수함이 비어 있으면 아직 새 요구가 없다는 뜻이에요. 1F 비서실(피클)이 접수해 브리핑·배분 계획을 올려요.</p>';
    h += '<div class="btn-line"><button class="btn ghost" type="button" data-act="inbox-refresh">새로 고침</button>' +
      '<button class="btn clay" type="button" data-act="inbox-collect"' + (pend.length ? '' : ' disabled') + '>피클에게 취합 지시</button></div>';
    if (S.inbox && S.inbox.error) h += '<p class="hint" style="color:#c14160">' + esc(S.inbox.error) + '</p>';
    if (!pend.length) h += '<p class="empty">새로 접수된 요구가 없어요.</p>';
    for (var i = 0; i < pend.length && i < 20; i++) {
      var it = pend[i];
      h += '<div class="ib-item"><div class="ib-h"><span class="src">' + esc(it.label) + '</span><span>' + esc(it.kind) + (it.name ? ' · ' + esc(it.name) : '') + '</span>' +
        '<span class="when">' + esc(whenLabel(it.at)) + '</span></div>' +
        '<p class="ib-t">' + esc(clip(it.text, 400)) + '</p></div>';
    }
    if (pend.length > 20) h += '<p class="empty">외 ' + (pend.length - 20) + '건 더 있어요.</p>';
    h += '</div></section>';
    return h;
}
