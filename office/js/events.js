/* ============================================================================
   AI 사무실 — office/js/events.js
   이벤트 위임(제출·입력·변경·클릭·키보드)
   · office.html 이 css/style.css → js/state.js … js/boot.js 순서로 불러요.
     모듈끼리 같은 전역 스코프를 써요(함수 이름은 사무실 전체에서 하나).
   · 원래 office.html 한 덩어리 스크립트를 기능별로 나눈 파일이라 동작은 같아요.
   ============================================================================ */
'use strict';

/* ==================================================================
     이벤트
     ================================================================== */
document.addEventListener('submit', function (e) {
    var f = e.target;
    if (!f || !f.id) return;
    if (f.id === 'gateForm') { e.preventDefault(); submitGate(); return; }
    if (f.id === 'gateTotpForm') { e.preventDefault(); submitGateTotp(); return; }
    if (f.id === 'directForm') {
      e.preventDefault();
      pullDraft();
      startDirective({ teamId: S.draft.team, title: S.draft.title, text: S.draft.text, material: S.draft.material });
      return;
    }
});

document.addEventListener('input', function (e) {
    var t = e.target;
    if (!t || !t.id) return;
    if (t.id === 'gateTotp') {
      var digits = String(t.value || '').replace(/\D/g, '').slice(0, 6);
      if (digits !== t.value) t.value = digits;
      if (digits.length === 6 && !S.gateBusy) {
        window.clearTimeout(S.gateAutoT);
        S.gateAutoT = window.setTimeout(function () { submitGateTotp(); }, 120);
      }
      return;
    }
    if (t.id === 'directTeam') S.draft.team = t.value;
    else if (t.id === 'directTitle') S.draft.title = t.value;
    else if (t.id === 'directText') S.draft.text = t.value;
    else if (t.id === 'directMaterial') S.draft.material = t.value;
});

document.addEventListener('change', function (e) {
    var t = e.target;
    if (!t) return;
    if (t.id === 'directTeam') { S.draft.team = t.value; renderPanel(); return; }
    if (t.getAttribute('data-act') !== 'team-pid') return;
    var teamId = t.getAttribute('data-team');
    var sel = document.getElementById('tm_model_' + teamId);
    if (sel) sel.innerHTML = modelChoices(t.value, '');
});

document.addEventListener('toggle', function (e) {
    var t = e.target;
    if (!t || !t.getAttribute || !t.getAttribute('data-key')) return;
    S.details[t.getAttribute('data-key')] = !!t.open;
}, true);

document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' || e.key === 'Esc') {
      if (S.workModal) { closeWorkDetail(); return; }
      if (S.teamModal) { closeTeamModal(); return; }
      closeSettings(); return;
    }
    if (e.target && e.target.id === 'directText' && e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      pullDraft();
      startDirective({ teamId: S.draft.team, title: S.draft.title, text: S.draft.text, material: S.draft.material });
    }
});

document.addEventListener('click', function (e) {
    var el = (e.target && e.target.closest) ? e.target.closest('[data-act]') : null;
    if (!el) {
      var wm = document.getElementById('workModal');
      if (wm && !wm.hidden && e.target === wm) { closeWorkDetail(); return; }
      var tm = document.getElementById('teamModal');
      if (tm && !tm.hidden && e.target === tm) { closeTeamModal(); return; }
      var sm = document.getElementById('settingsModal');
      if (sm && !sm.hidden && e.target === sm) closeSettings();
      return;
    }
    var act = el.getAttribute('data-act');
    var id = el.getAttribute('data-id');

    if (act === 'tab') { setTab(el.getAttribute('data-tab') || 'office'); return; }
    if (act === 'go-floor') {
      var fl = el.getAttribute('data-floor');
      setTab('office');
      if (fl === 'all') { var ov = document.getElementById('officeView'); if (ov) ov.scrollTo({ top: 0, behavior: 'smooth' }); return; }
      var room = document.getElementById('room-' + fl);
      if (room) room.scrollIntoView({ block: 'start', behavior: 'smooth' });
      return;
    }
    if (act === 'team-click') {
      var tid = el.getAttribute('data-team') || 'cs';
      if (teamActive(tid)) { S.directHint = ''; openTeamModal(tid); return; }
      S.selTeam = tid;
      S.draft.team = tid;
      S.clearDraft = true;
      var tObj = tid === 'sec' ? secretaryTeam() : teamById(tid);
      S.directHint = (tObj ? tObj.name : '이 팀') + '에 바로 지시할 수 있어요. 아래에 내용을 적고 [지시 보내기]를 눌러 주세요.';
      setTab('direct');
      renderAll();
      var dt = document.getElementById('directText');
      if (dt) { try { dt.focus(); } catch (err) { /* 무시 */ } }
      return;
    }
    if (act === 'team-modal-close') { closeTeamModal(); return; }
    if (act === 'open-work-detail') { openWorkDetail(id); return; }
    if (act === 'work-modal-close') { closeWorkDetail(); return; }
    if (act === 'delete-work') { askDeleteWork(id); return; }
    if (act === 'reject-delete') { rejectDelete(id); return; }
    if (act === 'sec-code-retry') { secCodeRetry(id); return; }
    if (act === 'team-modal-go') {
      closeTeamModal();
      setTab('approve');
      renderAll();
      var cardEl = document.querySelector('.ap-card[data-work="' + id + '"]');
      if (cardEl) { try { cardEl.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch (err2) { /* 무시 */ } }
      return;
    }
    if (act === 'team-modal-direct') {
      var tmTeam = el.getAttribute('data-team') || 'sec';
      closeTeamModal();
      S.selTeam = tmTeam;
      S.draft.team = tmTeam;
      S.clearDraft = true;
      S.directHint = '';
      setTab('direct');
      renderAll();
      var dtm = document.getElementById('directText');
      if (dtm) { try { dtm.focus(); } catch (err3) { /* 무시 */ } }
      return;
    }
    if (act === 'sec-qc') {
      var sq = workById(id);
      if (!sq || sq.status !== 'waiting' || !sq.code) return;
      sq.status = 'approved';
      sq.approvedAt = nowIso();
      pushLog(sq, '대표님 · QC 검수 요청');
      qcHandoff(sq);
      return;
    }
    if (act === 'sec-commit') {
      var sc = workById(id);
      if (!sc || sc.status !== 'waiting' || !sc.code) return;
      sc.status = 'approved';
      sc.approvedAt = nowIso();
      pushLog(sc, '대표님 · 최종 승인하고 반영');
      commitCode(sc);
      return;
    }
    if (act === 'fill-team') {
      S.draft.team = el.getAttribute('data-team') || 'dev';
      S.clearDraft = true;
      setTab('direct');
      renderAll();
      return;
    }
    if (act === 'approve') { approveWork(id); return; }
    if (act === 'reject-open') { openReject(id); return; }
    if (act === 'reject-cancel') { cancelReject(id); return; }
    if (act === 'reject') { rejectWork(id); return; }
    if (act === 'handoff') { var it = workById(id); if (it) handoff(it, el.getAttribute('data-team'), ''); return; }
    if (act === 'handoff-pick') {
      var it2 = workById(id);
      if (!it2) return;
      var opts = [];
      for (var i = 0; i < S.office.teams.length; i++) if (S.office.teams[i].id !== it2.teamId) opts.push(S.office.teams[i]);
      var names = opts.map(function (t) { return t.name; }).join(' / ');
      var pick = window.prompt('어느 팀으로 넘길까요?\n' + names);
      if (!pick) return;
      var found = '';
      for (var k = 0; k < opts.length; k++) if (opts[k].name.indexOf(String(pick).trim()) >= 0 || String(pick).trim() === opts[k].id) found = opts[k].id;
      if (!found) { toast('팀 이름을 찾지 못했어요.'); return; }
      handoff(it2, found, '');
      return;
    }
    if (act === 'qc-handoff') { var it3 = workById(id); if (it3) qcHandoff(it3); return; }
    if (act === 'commit-code') { var it4 = workById(id); if (it4) commitCode(it4); return; }
    if (act === 'next-done') { finishNext(id); return; }
    if (act === 'retry') {
      var fw = workById(id);
      if (!fw) return;
      if (fw.kind === 'delegation') {
        fw.status = 'working';
        fw.phase = 'plan';
        fw.delegationPlan = [];
        fw.childIds = [];
        pushLog(fw, '다시 맡김 · 배분 계획부터');
        renderAll(); saveOfficeSoon(0);
        kick(fw, 'plan');
        toast('비서에게 다시 맡겼어요.');
        return;
      }
      fw.status = 'failed';
      var rw = newWork(fw.teamId, fw.title, fw.brief, fw.materialIds, fw.id);
      pushLog(rw, '다시 맡김');
      renderAll(); saveOfficeSoon(0);
      kick(rw, 'item');
      toast('다시 맡겼어요.');
      return;
    }
    if (act === 'stop-work') { stopWork(id); return; }
    if (act === 'rerun-work') { if (id) rerunWork(id); return; }
    if (act === 'close-notice') { closeNotice(id); return; }
    if (act === 'dismiss-fail') {
      var dw = workById(id);
      if (dw) { dw.status = 'dismissed'; pushLog(dw, '치움'); }
      renderAll(); saveOfficeSoon(0);
      return;
    }
    if (act === 'inbox-refresh') {
      toast('접수함을 새로 읽는 중…');
      loadInbox().then(function () { renderAll(); toast('접수함을 새로 읽었어요.'); });
      return;
    }
    if (act === 'inbox-collect') { collectInbox(); return; }
    if (act === 'settings-open') { openSettings(); return; }
    if (act === 'settings-close') { closeSettings(); return; }
    if (act === 'lock') { closeSettings(); lockNow(); return; }
    if (act === 'logout') { logout(); return; }
    if (act === 'gate-alt') { S.gateAlt = !S.gateAlt; renderGate(); return; }
    if (act === 'gate-paste') { pasteGateTotp(); return; }
    if (act === 'gate-bio') { gateBioUnlock(); return; }
    if (act === 'totp-begin') { totpBeginSetup(); return; }
    if (act === 'totp-cancel') { totpCancelSetup(); return; }
    if (act === 'totp-confirm') { totpConfirmSetup(); return; }
    if (act === 'totp-copy') { totpCopySecret(); return; }
    if (act === 'totp-off-open') { S.totpOff = true; S.totpMsg = ''; renderSettings(); return; }
    if (act === 'totp-off-cancel') { S.totpOff = false; S.totpMsg = ''; renderSettings(); return; }
    if (act === 'totp-off-confirm') { totpDisableSubmit(); return; }
    if (act === 'bio-register') { bioRegister(); return; }
    if (act === 'bio-remove') { bioRemove(); return; }
    if (act === 'save-keys') { saveKeys(false); return; }
    if (act === 'clear-keys') {
      if (!window.confirm('가족이 함께 쓰는 AI 키를 모두 지울까요? 냉파·가계부의 AI 추천도 함께 멈춰요.')) return;
      saveKeys(true); return;
    }
    if (act === 'save-code') { saveCodeToken(); return; }
    if (act === 'key-add') { addProviderKey(el.getAttribute('data-pid')); return; }
    if (act === 'key-del') { removeProviderKey(el.getAttribute('data-pid'), Number(el.getAttribute('data-i'))); return; }
    if (act === 'key-use') { useProviderKey(el.getAttribute('data-pid'), Number(el.getAttribute('data-i'))); return; }
    if (act === 'auto-lock-set') { setAutoLock(Number(el.getAttribute('data-min'))); return; }
    if (act === 'device-revoke') { revokeDeviceById(el.getAttribute('data-id')); return; }
    if (act === 'team-model-save') { saveTeamModel(el.getAttribute('data-team')); return; }
    if (act === 'team-add') { addTeam(); return; }
    if (act === 'team-del') { delTeam(el.getAttribute('data-team')); return; }
});

/* 입력 중에는 화면을 다시 그리지 않게, 초안은 이벤트로만 모아요 */
function tick() {
    autoLockIdle();
    /* 멈춘 일 지켜보기 — 5초에 한 번 (3분 넘게 소식이 없으면 자동 중단 + 비서 보고) */
    if (S.unlocked && S.office && !S.officeLocked) {
      var tNow = Date.now();
      if (!S.bg.watchAt || tNow - S.bg.watchAt > BG_WATCH_MS) { S.bg.watchAt = tNow; watchWork(); }
    }
    var nodes = document.querySelectorAll('[data-left]');
    for (var i = 0; i < nodes.length; i++) {
      var at = Number(nodes[i].getAttribute('data-left'));
      var ms = at - Date.now();
      nodes[i].textContent = ms > 0 ? fmtLeft(ms) : '곧 풀려요';
    }
    var gate = document.getElementById('gateScreen');
    if (gate && !gate.hidden) return;
    var els = document.querySelectorAll('#teamModalBody [data-elapsed]');
    for (var j = 0; j < els.length; j++) els[j].textContent = elapsedLabel(els[j].getAttribute('data-elapsed'));
    renderTabs();
    renderTop();
}
