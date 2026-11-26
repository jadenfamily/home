/* ============================================================================
   AI 사무실 — office/js/team-modal.js
   팀 작업 현황 모달(지금 하는 일 · 진행 로그)
   · office.html 이 css/style.css → js/state.js … js/boot.js 순서로 불러요.
     모듈끼리 같은 전역 스코프를 써요(함수 이름은 사무실 전체에서 하나).
   · 원래 office.html 한 덩어리 스크립트를 기능별로 나눈 파일이라 동작은 같아요.
   ============================================================================ */
'use strict';

/* ==================================================================
     팀 작업 현황 모달 — 지금 하는 일 · 진행 로그 · 최근 보고
     ================================================================== */
function stillRunning(w) {
    return !!w && w.kind === 'delegation' && w.status === 'approved' && (w.phase === 'run' || w.phase === 'collect');
}
function activeWorkFor(teamId) {
    var out = [], list = workFor(teamId);
    for (var i = list.length - 1; i >= 0; i--) {
      var w = list[i];
      if (w.status === 'working' || w.status === 'queued' || w.status === 'waiting') out.push(w);
      else if (stillRunning(w)) out.push(w);
    }
    return out;
}
function currentWorkFor(teamId) {
    var list = activeWorkFor(teamId);
    for (var i = 0; i < list.length; i++) {
      var w = list[i];
      if (w.status === 'working' || w.status === 'queued') return w;
      if (stillRunning(w)) return w;
    }
    return null;
}
function progressLogHtml(item) {
    var log = (item && (item.progressLog && item.progressLog.length ? item.progressLog : item.log)) || [];
    if (!log.length) return '<p class="tm-empty">아직 진행 기록이 없어요. 일이 시작되면 단계마다 여기에 쌓여요.</p>';
    var live = item.status === 'working' || item.status === 'queued';
    var h = '<ol class="tm-log">';
    for (var i = 0; i < log.length; i++) {
      var last = (i === log.length - 1);
      h += '<li' + (last && live ? ' class="now"' : '') + '><span class="t">' + esc(clockLabel(log[i].at)) + '</span><span>' + esc(log[i].text) + '</span></li>';
    }
    return h + '</ol>';
}
function tmRow(w, badge) {
    var team = w.teamId === 'sec' ? secretaryTeam() : (teamById(w.teamId) || { name: w.teamId, emoji: '📄' });
    var sub = team.name + ' · ' + whenLabel(w.updatedAt || w.at);
    if (w.status === 'waiting') sub = team.name + ' · 결재 기다리는 보고 · ' + whenLabel(w.updatedAt || w.at);
    var badgeCls = (w.status === 'done' || w.status === 'approved') ? ' done' : '';
    var badgeTxt = badge || (w.status === 'waiting' ? '결재 대기' : (w.status === 'failed' ? '실패' : '완료'));
    return '<button class="tm-row" type="button" data-act="team-modal-go" data-id="' + esc(w.id) + '">' +
      '<span class="r-main"><b>' + esc((team.emoji ? team.emoji + ' ' : '') + (w.title || '일')) + '</b><span>' + esc(sub) + '</span></span>' +
      '<span class="r-badge' + badgeCls + '">' + esc(badgeTxt) + '</span></button>';
}
function renderTeamModal(reset) {
    if (!S.teamModal) return;
    var m = document.getElementById('teamModal');
    var body = document.getElementById('teamModalBody');
    var title = document.getElementById('teamModalTitle');
    if (!m || !body) return;
    if (!S.office) { body.innerHTML = '<p class="tm-empty">사무실 기록을 여는 중이에요.</p>'; return; }
    var isSec = S.teamModal.teamId === 'sec';
    var team = isSec ? secretaryTeam() : (teamById(S.teamModal.teamId) || { id: S.teamModal.teamId, name: S.teamModal.teamId, emoji: '📄' });
    var st = teamStatus(team.id);
    var mid = teamModelId(team), sp = splitModelId(mid);
    if (title) title.textContent = (team.emoji ? team.emoji + ' ' : '') + team.name + ' 작업 현황';
    var keep = body.scrollTop;
    var h = '';
    h += '<div class="tm-top"><span class="tm-avatar">' + (isSec ? pickleSvg() : charSvg(team)) + '<i class="em">' + esc(team.emoji || '🧩') + '</i></span>' +
      '<span class="tm-who"><b>' + esc(team.name) + '</b><span>' + esc(isSec ? ('피클 · 전담 비서 · ' + (DEFAULT_SECRETARY.role || '')) : ((PROVIDERS[sp.pid] ? PROVIDERS[sp.pid].short + ' · ' : '') + modelShort(mid))) + '</span></span>' +
      '<span class="status ' + st + '"><i></i>' + esc(STATUS_LABEL[st] || '대기 중') + '</span></div>' +
      (isSec ? '<p class="tm-note" style="background:#f2f9ee;color:#4d7a3c;border:1px solid #dcecd2">' + esc(DEFAULT_SECRETARY.desc) + ' · 4F~2F 부서 일은 팀별 모델로 백그라운드에서 돌아가요.</p>' : '');
    var cur = currentWorkFor(team.id);
    if (cur) {
      var startedAt = cur.startedAt || cur.at;
      h += '<div class="tm-sec"><div class="tm-h"><span>지금 진행 중인 일</span><span class="when">' + esc(whenLabel(cur.updatedAt || cur.at)) + '</span></div>' +
        '<div class="tm-title">' + esc(cur.title) + (cur.kind === 'delegation' ? ' <span class="badge">배분·취합</span>' : '') + '</div>' +
        '<div class="tm-h" style="margin-top:7px;color:#8d849f">경과 <span class="tm-elapsed" data-elapsed="' + esc(startedAt) + '">' + esc(elapsedLabel(startedAt)) + '</span></div>' +
        (cur.brief ? '<p class="tm-brief">' + esc(clip(cur.brief, 900)) + '</p>' : '') +
        ((cur.kind === 'delegation' && cur.phase === 'run') ? pipelineLine(cur) : '') + '</div>';
      h += '<div class="tm-sec"><div class="tm-h"><span>실시간 진행 로그</span><span class="when">' + ((cur.progressLog || []).length) + '단계</span></div>' + progressLogHtml(cur);
      if (isPicoWork(cur)) {
        h += '<p class="tm-note" style="background:#f2f9ee;color:#4d7a3c;border:1px solid #dcecd2">' + esc(picoLabel(cur)) + ' · 피클이 직접 확인해 배분 계획을 올려요. 외부 AI 일꾼은 부르지 않아요.</p>';
        h += '<div class="tm-actions">' +
          '<button class="btn-s" type="button" data-act="open-work-detail" data-id="' + esc(cur.id) + '">자세히 보기</button>' +
          '<button class="btn-s danger" type="button" data-act="delete-work" data-id="' + esc(cur.id) + '">업무 삭제</button>' +
          '</div>';
        h += '</div>';
        body.innerHTML = h;
        body.scrollTop = reset ? 0 : keep;
        return;
      }
      if (cur.bg && cur.bg.via) {
        h += '<p class="tm-note">' + (cur.bg.via === 'trying' ? '백그라운드 일꾼을 부르는 중이에요.' : '백그라운드 일꾼이 일하고 있어요 · 창을 닫아도 계속돼요.') + '</p>';
      }
      if (jobStalled(cur)) {
        h += '<p class="tm-note" style="background:#fff4e5;color:#8a5a00;border:1px solid #f0dcc0">응답이 오래 없어요. 다시 실행하거나 중단할 수 있어요.</p>';
      }
      h += '<div class="tm-actions">' +
        '<button class="btn-s warn" type="button" data-act="stop-work" data-id="' + esc(cur.id) + '">작업 중단</button>' +
        '<button class="btn-s ok" type="button" data-act="rerun-work" data-id="' + esc(cur.id) + '">다시 실행</button>' +
        '</div>';
      h += '</div>';
    } else {
      h += '<div class="tm-sec"><div class="tm-h"><span>지금 진행 중인 일</span></div><p class="tm-empty">지금은 진행 중인 일이 없어요. 이 팀에 새 일을 지시하면 진행 상황이 여기에 실시간으로 쌓여요.</p></div>';
      /* 멈춰 버린 일이 있으면 여기서 바로 다시 실행하거나 정리할 수 있게 해요 */
      var stuck = null, allW = workFor(team.id);
      for (var s0 = allW.length - 1; s0 >= 0; s0--) {
        var sw = allW[s0];
        if (sw.status === 'failed' || sw.status === 'stopping') { stuck = sw; break; }
      }
      if (stuck) {
        h += '<div class="tm-sec"><div class="tm-h"><span>멈춰 있는 일</span><span class="when">' + esc(whenLabel(stuck.updatedAt || stuck.at)) + '</span></div>' +
          '<div class="tm-title">' + esc(stuck.title) + '</div>' +
          '<p class="tm-note" style="background:#fff1f2;color:#c14160">' + esc(clip(stuck.error || '작업을 마치지 못했어요.', 160)) + '</p>' +
          progressLogHtml(stuck) +
          '<div class="tm-actions">' +
          '<button class="btn-s ok" type="button" data-act="rerun-work" data-id="' + esc(stuck.id) + '">다시 실행</button>' +
          '<button class="btn-s" type="button" data-act="dismiss-fail" data-id="' + esc(stuck.id) + '">치우기</button>' +
          '</div></div>';
      }
    }
    var waiting = [], recent = [];
    var all = workFor(team.id);
    for (var k = all.length - 1; k >= 0; k--) {
      var x = all[k];
      if (cur && x.id === cur.id) continue;
      if (x.status === 'waiting') waiting.push(x);
      else if (x.status === 'done' || x.status === 'approved' || x.status === 'rejected' || x.status === 'failed') recent.push(x);
    }
    if (waiting.length) {
      h += '<div class="tm-sec"><div class="tm-h"><span>결재 기다리는 보고</span><span class="when">' + waiting.length + '건</span></div><div class="tm-list">';
      for (var a = 0; a < waiting.length && a < 6; a++) h += tmRow(waiting[a], '결재 대기');
      h += '</div></div>';
    }
    if (recent.length) {
      h += '<div class="tm-sec"><div class="tm-h"><span>최근 보고</span><span class="when">' + recent.length + '건</span></div><div class="tm-list">';
      for (var b = 0; b < recent.length && b < 6; b++) h += tmRow(recent[b], '');
      h += '</div></div>';
    }
    var later = [];
    var actList = activeWorkFor(team.id);
    for (var c2 = 0; c2 < actList.length; c2++) {
      var av = actList[c2];
      if (cur && av.id === cur.id) continue;
      if (av.status !== 'working' && av.status !== 'queued') continue;
      later.push(av);
    }
    if (later.length) {
      h += '<div class="tm-sec"><div class="tm-h"><span>기다리는 일</span><span class="when">' + later.length + '건</span></div><div class="tm-list">';
      for (var d2 = 0; d2 < later.length && d2 < 5; d2++) h += tmRow(later[d2], '대기');
      h += '</div></div>';
    }
    h += '<div class="tm-actions"><button class="btn-s ok" type="button" data-act="team-modal-direct" data-team="' + esc(team.id) + '">' + (isSec ? '피클에게 새 일 지시' : '이 팀에 새 일 지시') + '</button>' +
      '<button class="btn-s" type="button" data-act="team-modal-close">닫기</button></div>';
    body.innerHTML = h;
    body.scrollTop = reset ? 0 : keep;
}
function openTeamModal(teamId) {
    S.teamModal = { teamId: teamId || 'cs', at: nowIso() };
    var m = document.getElementById('teamModal');
    if (!m) return;
    m.hidden = false;
    document.body.style.overflow = 'hidden';
    document.documentElement.style.overflow = 'hidden';
    renderTeamModal(true);
}
function closeTeamModal() {
    S.teamModal = null;
    var m = document.getElementById('teamModal');
    if (m) m.hidden = true;
    var sb = document.getElementById('settingsModal');
    if (!sb || sb.hidden) {
      document.body.style.overflow = '';
      document.documentElement.style.overflow = '';
    }
}
function renderAll() {
    if (S.tab) document.body.setAttribute('data-tab', S.tab);
    renderTop();
    renderRail();
    renderOffice();
    renderPanel();
    renderTeamModal();
    renderWorkModal();
    /* 피클이 처리할 일이 남아 있으면 3초 동기화를 켜 둬요 (피클이 계획·보고를 올리면 바로 보이게) */
    if (S.unlocked && S.office && hasPicoPending()) startPolling();
}
