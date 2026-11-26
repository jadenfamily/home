/* ============================================================================
   AI 사무실 — office/js/approval.js
   결재 · 다음 단계 · 반려 · 넘기기
   · office.html 이 css/style.css → js/state.js … js/boot.js 순서로 불러요.
     모듈끼리 같은 전역 스코프를 써요(함수 이름은 사무실 전체에서 하나).
   · 원래 office.html 한 덩어리 스크립트를 기능별로 나눈 파일이라 동작은 같아요.
   ============================================================================ */
'use strict';

/* ==================================================================
     결재 · 다음 단계
     ================================================================== */
function startDirective(d, opts) {
    if (!S.office) return null;
    if (d.teamId === 'sec') return startSecretaryDirective(d, opts);
    var team = teamById(d.teamId);
    if (!team) { toast('부서를 골라 주세요.'); return null; }
    var text = String(d.text || '').trim();
    if (!text) { toast('지시 내용을 적어 주세요.'); return null; }
    var id = teamModelId(team), sp = splitModelId(id);
    if (!hasKey(sp.pid)) { toast('⚙️ 설정에서 ' + (PROVIDERS[sp.pid] ? PROVIDERS[sp.pid].label : 'AI') + ' 키를 먼저 넣어 주세요.'); return null; }
    var title = String(d.title || '').trim() || clip(firstLines(text, 1), 36) || '새 일';
    var w = newWork(d.teamId, title, text, d.material ? [d.material] : []);
    pushLog(w, '대표님 지시');
    if (d.sources) pushLog(w, '접수함 확인 중');
    S.directHint = '';
    S.draft = { team: d.teamId, title: '', text: '', material: '' };
    S.clearDraft = true;
    var ti = document.getElementById('directTitle'); if (ti) ti.value = '';
    var tx = document.getElementById('directText'); if (tx) tx.value = '';
    var mt = document.getElementById('directMaterial'); if (mt) mt.value = '';
    if (!opts || !opts.keepTab) S.tab = 'office';
    renderAll(); saveOfficeSoon(0);
    toast(team.name + '에 지시를 보냈어요. 끝나면 비서가 정리해 올려요.');
    kick(w, 'item');
    return w;
}
function approveWork(id) {
    var item = workById(id);
    if (!item || item.status !== 'waiting') return;
    if (item.kind === 'delegation') {
      if (item.phase === 'plan') { startDelegation(id); return; }
      /* 코드 수정이 필요한 일은 실제 수정안 없이 승인으로 끝내지 않아요 */
      if (!item.code && (item.codeMissing || codeIntent(item))) {
        item.codeMissing = true;
        pushLog(item, '승인 보류 · 실제 코드 수정안이 없어 승인할 수 없어요');
        renderAll(); saveOfficeSoon(0);
        toast('⚠️ 실제 코드 수정안이 만들어지지 않았어요. [개발팀에 다시 코드 작성 요청]이나 [반려 후 삭제]를 골라 주세요.');
        return;
      }
      item.status = 'approved';
      item.approvedAt = nowIso();
      item.nextDone = true;
      item.nextAt = nowIso();
      if (isPicoWork(item) && item.picoStatus === 'report') item.picoStatus = 'done';
      pushLog(item, '대표님 최종 승인');
      renderAll(); saveOfficeSoon(0);
      toast(item.code ? '최종 취합 보고를 승인했어요. 코드 수정안은 아직 반영 전이에요 — QC 검수나 바로 반영을 골라 주세요.' : '최종 취합 보고를 승인했어요.');
      return;
    }
    item.status = 'approved';
    item.approvedAt = nowIso();
    item.nextDone = false;
    pushLog(item, '대표님 승인');
    renderAll(); saveOfficeSoon(0);
    if (item.code) toast('승인했어요. 수정안은 아직 반영 전이에요 — QC 검수를 거치거나 바로 반영을 골라 주세요.');
    else toast('승인했어요. 다음 단계를 고를 수 있어요.');
}
function openReject(id) {
    S.rejectOpen[id] = true;
    S.tab = 'approve';
    renderAll();
    var el = document.getElementById('rej_' + id);
    if (el) { try { el.focus(); } catch (e) { /* 무시 */ } }
}
function cancelReject(id) {
    S.rejectOpen[id] = false;
    renderAll();
}
function rejectWork(id) {
    var item = workById(id);
    if (!item || item.status !== 'waiting') return;
    var reason = String(fieldVal('rej_' + id) || '').trim();
    if (!reason) { toast('반려 사유를 적어 주세요. 그 내용으로 팀이 다시 일해요.'); return; }
    if (item.kind === 'delegation') {
      item.rejectReason = clip(reason, 600);
      item.rejectedAt = nowIso();
      item.planNotes = (item.planNotes ? item.planNotes + '\n' : '') + '· ' + clip(reason, 300);
      item.status = 'working';
      item.phase = 'plan';
      item.delegationPlan = [];
      item.childIds = [];
      S.rejectOpen[id] = false;
      pushLog(item, '대표님 반려 · ' + clip(reason, 100));
      if (isPicoWork(item)) {
        /* 1F 비서실은 피클이 사유를 반영해 다시 계획해요 */
        item.picoStatus = 'pending';
        item.picoRequestedAt = nowIso();
        pushLog(item, '비서 피클 확인 대기 · 반려 사유를 반영해 계획을 다시 세워요');
        renderAll(); saveOfficeSoon(0);
        toast('반려했어요. 피클이 사유를 반영해 배분 계획을 다시 세워요.');
        return;
      }
      pushLog(item, '반려 사유를 반영해 배분 계획 다시 세우는 중');
      item.planNote = clip(reason, 600);
      renderAll(); saveOfficeSoon(0);
      kick(item, 'plan');
      toast('반려했어요. 비서가 사유를 반영해 배분 계획을 다시 세워요.');
      return;
    }
    item.status = 'rejected';
    item.rejectReason = clip(reason, 600);
    item.rejectedAt = nowIso();
    pushLog(item, '대표님 반려 · ' + clip(reason, 100));
    S.rejectOpen[id] = false;
    /* QC가 문제를 찾았으면 고칠 사람은 개발팀이에요 */
    var target = item.teamId;
    var briefExtra = '';
    if (item.teamId === 'qc' && item.reviewOf) {
      target = 'dev';
      var parent = workById(item.reviewOf);
      if (parent) {
        parent.status = 'rejected';
        parent.rejectReason = clip(reason, 600);
        pushLog(parent, 'QC 검수에서 문제가 나와 재작업으로 돌아옴');
        briefExtra = '\n\n[QC 검수 의견]\n' + clip(item.report && item.report.detail || '', 2500) +
          (parent.code ? '\n\n[이전 수정안]\n' + parent.code.repo + '/' + parent.code.path + '\n' + clip(parent.code.diffText || '', 2500) : '');
      }
    }
    var re = newWork(target, item.title + ' (재작업)', item.brief + briefExtra + '\n\n[대표님 반려 사유 — 이 점을 고쳐 다시 해 주세요]\n' + reason, item.materialIds, item.id);
    attachPrior(re, item, '대표님 반려 뒤 재작업 · ' + clip(reason, 120));
    pushLog(re, '반려 재작업 시작');
    renderAll(); saveOfficeSoon(0);
    kick(re, 'item');
    toast('반려했어요. ' + ((teamById(target) || {}).name || '팀') + '에 다시 일을 맡겼어요.');
}
function handoff(item, teamId, label) {
    if (!item || !teamId) return;
    var to = teamById(teamId);
    if (!to) { toast('넘길 부서를 찾지 못했어요.'); return; }
    var from = teamById(item.teamId) || { name: item.teamId };
    var sec = item.secretary || {};
    var brief = '[' + from.name + '] "' + item.title + '" 보고를 이어받아 진행해 주세요.\n\n' +
      '[핵심]\n' + (sec.summary || (item.report && item.report.summary) || '') +
      (sec.recommend ? '\n\n[비서 추천]\n' + sec.recommend : '') +
      '\n\n[대표님 지시]\n' + (label || '다음 단계를 이어서 진행해 주세요.') +
      (item.report && item.report.detail ? '\n\n[이전 팀 보고]\n' + clip(item.report.detail, 3000) : '');
    item.nextDone = true;
    item.nextAt = nowIso();
    var w = newWork(teamId, to.name + ' · ' + item.title, brief, [item.id], item.id);
    pushLog(w, from.name + ' 보고를 넘겨받음');
    renderAll(); saveOfficeSoon(0);
    kick(w, 'item');
    toast(to.name + '(으)로 넘겼어요. 끝나면 비서가 다시 정리해 올려요.');
}
function qcHandoff(item) {
    if (!item || !item.code) { toast('넘길 수정안이 없어요.'); return; }
    var c = item.code;
    var brief = '[QC 검수 요청] 개발팀 수정안을 검수해 주세요.\n\n' +
      '[수정안] ' + c.repo + '/' + c.path + '\n' +
      '[변경 요약] ' + (c.summary || '') + '\n' +
      '[자동 검사] ' + (c.checkOk ? '통과' : '문제 있음 · ' + (c.checkErrors || []).join(' / ')) + '\n\n' +
      '[변경 내용]\n' + clip(c.diffText || '', 4000) + '\n\n' +
      '문법·구조·기존 기능에 문제가 없는지 검수하고 "검수 통과" 또는 "문제 있음"으로 보고해 주세요.';
    item.nextDone = true;
    item.nextAt = nowIso();
    var w = newWork('qc', 'QC 검수 · ' + item.title, brief, [item.id], item.id);
    w.codeUnderReview = c;
    w.code = c;            /* 검수 대상 수정안 — QC 승인 뒤 바로 반영할 수 있게 */
    w.reviewOf = item.id;  /* 원래 개발팀 일 */
    pushLog(w, '개발팀 수정안 검수 요청');
    renderAll(); saveOfficeSoon(0);
    kick(w, 'item');
    toast('QC팀에 검수를 맡겼어요.');
}
async function commitCode(item) {
    if (!item || !item.code) { toast('반영할 수정안이 없어요.'); return; }
    var c = item.code;
    if (!S.ai.codeToken) { toast('코드 열쇠가 없어요. ⚙️ 설정에서 넣어 주세요.'); return; }
    var pid = 'commit_' + item.id;
    if (S.busy[pid]) return;
    S.busy[pid] = { at: Date.now() };
    renderAll();
    try {
      var cur = await ghGetAt(c.repo, c.path, S.ai.codeToken);
      if (!cur.ok) throw new Error(cur.error || '파일을 읽지 못했어요');
      var oldText = cur.missing ? '' : String(cur.raw || '');
      var next = null;
      if (Object.prototype.toString.call(c.edits) === '[object Array]' && c.edits.length) {
        var ap = applyEdits(oldText, c.edits);
        if (!ap.ok) throw new Error(ap.error || '찾아 바꾸기를 적용하지 못했어요');
        next = ap.text;
      } else if (c.content != null) {
        next = String(c.content);
      } else if (c.range && c.range.start != null) {
        var arr = oldText.split('\n');
        var st = clamp(Number(c.range.start) || 1, 1, Math.max(1, arr.length));
        var en = clamp(Number(c.range.end) || st, st, Math.max(1, arr.length));
        next = arr.slice(0, st - 1).concat(String(c.range.text || '').split('\n')).concat(arr.slice(en)).join('\n');
      }
      if (next == null) throw new Error('수정 내용이 없어요');
      var check = await checkCodeFile(c.path, next);
      if (!check.ok) {
        var errs = [];
        for (var i = 0; i < (check.steps || []).length; i++) {
          if (!check.steps[i].ok) errs = errs.concat(check.steps[i].errors || []);
        }
        throw new Error('자동 검사에서 문제가 보여 반영하지 않았어요: ' + clip(errs.join(' / '), 200));
      }
      var w = await ghPutAt(c.repo, c.path, next, '🏢 ' + OFFICE_NAME + ': ' + clip(item.title, 60) + ' (대표님 승인)', S.ai.codeToken);
      if (!w.ok) throw new Error(w.error || '저장하지 못했어요');
      item.commit = { ok: true, at: nowIso(), repo: c.repo, path: c.path };
      item.nextDone = true;
      item.nextAt = nowIso();
      if (item.reviewOf) {
        var parent = workById(item.reviewOf);
        if (parent) { parent.commit = item.commit; parent.nextDone = true; parent.nextAt = nowIso(); pushLog(parent, 'QC 승인 뒤 코드 반영 완료'); }
      }
      pushLog(item, '코드 반영 완료 · ' + fileLabel(c.repo, c.path));
      toast('코드에 반영했어요. 화면은 잠시 뒤 새로 고쳐 주세요.');
    } catch (e) {
      item.commit = { ok: false, at: nowIso(), error: String(e && e.message ? e.message : e) };
      pushLog(item, '반영 실패 · ' + clip(item.commit.error, 120));
      toast('반영하지 못했어요: ' + clip(item.commit.error, 110));
    } finally {
      delete S.busy[pid];
      renderAll(); saveOfficeSoon(0);
    }
}
function finishNext(id) {
    var item = workById(id);
    if (!item) return;
    /* 코드 수정안은 실제로 반영(커밋)되기 전에는 마무리로 넘기지 않아요 */
    if ((item.code || item.codeMissing) && !(item.commit && item.commit.ok)) {
      toast('코드 수정안은 아직 반영 전이에요. [QC 검수]나 [지금 바로 반영]을 먼저 골라 주세요.');
      return;
    }
    item.nextDone = true;
    item.nextAt = nowIso();
    renderAll(); saveOfficeSoon(0);
}
function collectInbox() {
    var pend = pendingInbox();
    if (!pend.length) {
      toast('새로 접수된 요구가 없어요.');
      loadInbox().then(renderAll);
      return;
    }
    var lines = [];
    for (var i = 0; i < pend.length && i < 30; i++) {
      var it = pend[i];
      lines.push((i + 1) + ') [' + it.label + (it.name ? ' · ' + it.name : '') + '] ' + clip(it.text, 400));
    }
    var seen = S.office.inboxSeen || [];
    for (var k = 0; k < pend.length; k++) if (seen.indexOf(pend[k].id) < 0) seen.push(pend[k].id);
    S.office.inboxSeen = seen.slice(-300);
    startDirective({
      teamId: 'sec',
      title: '접수함 취합 (' + pend.length + '건)',
      text: '아래 접수 건들을 취합해 주세요. 같은 요구는 묶고, 바로 할 일 / 결정이 필요한 일 / 나중에 할 일로 나눠 정리해 주세요.\n\n' +
        lines.join('\n'),
      material: '',
      sources: true,
      picoSource: 'inbox'
    }, { keepTab: true });
    S.tab = 'office';
    renderAll();
}
