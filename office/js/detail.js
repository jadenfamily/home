/* ============================================================================
   AI 사무실 — office/js/detail.js
   업무 자세히 보기 모달(최근 마무리 클릭)
   · office.html 이 css/style.css → js/state.js … js/boot.js 순서로 불러요.
     모듈끼리 같은 전역 스코프를 써요(함수 이름은 사무실 전체에서 하나).
   · 원래 office.html 한 덩어리 스크립트를 기능별로 나눈 파일이라 동작은 같아요.
   ============================================================================ */
'use strict';

/* ==================================================================
     업무 자세히 보기 (최근 마무리·결재 카드에서 누르면 열려요)
     ================================================================== */
function logHtml(item) {
    var log = (item && item.log && item.log.length) ? item.log : ((item && item.progressLog) || []);
    if (!log.length) return '<p class="tm-empty">작업 기록이 없어요.</p>';
    var h = '<ol class="tm-log">';
    for (var i = 0; i < log.length; i++) {
      h += '<li><span class="t">' + esc(clockLabel(log[i].at)) + '</span><span>' + esc(log[i].text || '') + '</span></li>';
    }
    return h + '</ol>';
}
function renderWorkModal() {
    if (!S.workModal) return;
    var m = document.getElementById('workModal');
    var body = document.getElementById('workModalBody');
    if (!m || !body) return;
    var w = workById(S.workModal);
    if (!w) { body.innerHTML = '<p class="tm-empty">이 업무는 목록에서 지워졌어요.</p>'; return; }
    var keep = body.scrollTop;
    var isSec = w.teamId === 'sec';
    var team = isSec ? secretaryTeam() : (teamById(w.teamId) || { name: w.teamId, emoji: '📄' });
    var rep = w.report || {}, sec = w.secretary || {}, c = w.code || null;
    var h = '';
    h += '<div class="tm-sec"><div class="tm-h"><span>' + esc((team.emoji || '📄') + ' ' + team.name) + '</span><span class="when">' + esc(whenLabel(w.updatedAt || w.at)) + '</span></div>' +
      '<div class="tm-title">' + esc(w.title || '일') + '</div>' +
      '<p class="tm-note"><b>상태</b> ' + esc(workStateLabel(w)) + (w.commit && w.commit.at ? ' · ' + esc(whenLabel(w.commit.at)) : '') +
      (w.at ? ' · 지시 ' + esc(whenLabel(w.at)) : '') + '</p>' +
      '<p class="tm-brief">' + (w.brief ? esc(w.brief) : '지시 원문이 없어요.') + '</p></div>';
    h += '<div class="tm-sec"><div class="tm-h"><span>팀 보고</span></div>' +
      (rep.summary || rep.detail
        ? (rep.summary ? '<p class="tm-brief">' + esc(rep.summary) + '</p>' : '') + (rep.detail ? '<div class="ap-detail">' + esc(rep.detail) + '</div>' : '')
        : '<p class="tm-empty">팀 보고가 아직 없어요.</p>') + '</div>';
    var secPts = (sec.points || []).slice(0, 6);
    h += '<div class="tm-sec"><div class="tm-h"><span>비서 요약</span></div>' +
      (sec.summary || w.secSummary
        ? '<p class="tm-brief">' + esc(sec.summary || w.secSummary) + '</p>' +
          (secPts.length ? '<ul class="ap-points">' + secPts.map(function (p) { return '<li>' + esc(p) + '</li>'; }).join('') + '</ul>' : '') +
          (sec.recommend ? '<div class="ap-rec">추천: ' + esc(sec.recommend) + '</div>' : '')
        : '<p class="tm-empty">비서 요약이 아직 없어요.</p>') + '</div>';
    h += '<div class="tm-sec"><div class="tm-h"><span>코드 수정안</span></div>';
    if (c) {
      h += '<p class="tm-note">' + esc(fileLabel(c.repo, c.path)) + ' · +' + esc(String(c.added || 0)) + ' −' + esc(String(c.removed || 0)) + ' · ' + (c.checkOk ? '자동 검사 통과' : '자동 검사 문제') + ' · ' + (w.commit && w.commit.ok ? '반영됨' : '아직 반영 전') + '</p>';
      if (c.patchNote) h += '<p class="tm-brief">' + esc(c.patchNote) + '</p>';
      if (c.diffText) h += '<div class="diffbox"><pre>' + diffHtmlPlain(c.diffText) + '</pre></div>';
      if (c.checkErrors && c.checkErrors.length) h += '<div class="ap-detail">검사: ' + esc(c.checkErrors.join('\n')) + '</div>';
    } else if ([w.codeMissing, codeIntent(w)].indexOf(true) >= 0) {
      h += '<p class="tm-note" style="background:#fff4e5;color:#8a5a00;border:1px solid #f0dcc0">⚠️ 실제 코드 수정안이 만들어지지 않았어요.</p>';
    } else {
      h += '<p class="tm-empty">코드 수정안이 없는 업무예요.</p>';
    }
    h += '</div>';
    h += '<div class="tm-sec"><div class="tm-h"><span>반영 기록</span></div>' +
      (w.commit
        ? '<p class="tm-note">' + (w.commit.ok ? '✅ 코드에 반영했어요 · ' + esc(fileLabel(w.commit.repo, w.commit.path)) + ' · ' + esc(whenLabel(w.commit.at)) : '⚠️ 반영하지 못했어요 · ' + esc(clip(w.commit.error || '', 200))) + '</p>'
        : '<p class="tm-empty">' + (c ? '아직 반영 전이에요. QC 검수나 최종 승인 뒤에 반영돼요.' : '반영 기록이 없어요.') + '</p>') + '</div>';
    h += '<div class="tm-sec"><div class="tm-h"><span>작업 기록</span><span class="when">' + (((w.log || []).length)) + '줄</span></div>' + logHtml(w) + '</div>';
    h += '<div class="tm-actions">' +
      '<button class="btn-s danger" type="button" data-act="delete-work" data-id="' + esc(w.id) + '">이 업무 삭제</button>' +
      '<button class="btn-s" type="button" data-act="work-modal-close">닫기</button></div>';
    body.innerHTML = h;
    body.scrollTop = keep;
}
function openWorkDetail(id) {
    var w = workById(id);
    if (!w) { toast('그 업무를 찾지 못했어요.'); return; }
    S.workModal = id;
    var m = document.getElementById('workModal');
    if (!m) return;
    m.hidden = false;
    document.body.style.overflow = 'hidden';
    document.documentElement.style.overflow = 'hidden';
    renderWorkModal();
}
function closeWorkDetail(keepScroll) {
    S.workModal = null;
    var m = document.getElementById('workModal');
    if (m) m.hidden = true;
    if (keepScroll) return;
    var tm = document.getElementById('teamModal');
    var sm = document.getElementById('settingsModal');
    if ((!tm || tm.hidden) && (!sm || sm.hidden)) {
      document.body.style.overflow = '';
      document.documentElement.style.overflow = '';
    }
}
