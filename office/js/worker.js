/* ============================================================================
   AI 사무실 — office/js/worker.js
   백그라운드 일꾼 연동 — 자동 중단 · 다시 실행 · 삭제 · 반려 후 삭제
   · office.html 이 css/style.css → js/state.js … js/boot.js 순서로 불러요.
     모듈끼리 같은 전역 스코프를 써요(함수 이름은 사무실 전체에서 하나).
   · 원래 office.html 한 덩어리 스크립트를 기능별로 나눈 파일이라 동작은 같아요.
   ============================================================================ */
'use strict';

/* ==================================================================
     백그라운드 일꾼 — 창을 닫거나 화면을 꺼도 일이 끝까지 돌게 해요
     (비공개 보관함의 GitHub Actions 워크플로우를 불러요)
     ================================================================== */
var BG_POLL_MS = 3000;
var BG_STALE_MS = 180000;
var BG_WATCH_MS = 5000;

function bgBase() {
    return API_BASE + '/repos/' + encodeURIComponent(DEFAULT_OWNER) + '/' + encodeURIComponent(DEFAULT_REPO);
}
async function bgPost(url, body) {
    try {
      var res = await window.fetch(url, {
        method: 'POST',
        headers: Object.assign({ 'Content-Type': 'application/json' }, ghHeaders(null)),
        body: JSON.stringify(body)
      });
      if (res.status === 204 || res.status === 200 || res.status === 201) return { ok: true, status: res.status };
      var txt = '';
      try { txt = await res.text(); } catch (e) { txt = ''; }
      var why = 'HTTP ' + res.status;
      try { var j = JSON.parse(txt); if (j && j.message) why = String(j.message); } catch (e2) { /* 무시 */ }
      return { ok: false, status: res.status, error: why };
    } catch (e3) {
      return { ok: false, status: 0, error: String((e3 && e3.message) || '연결하지 못했어요') };
    }
}
/* 두 길로 불러요 — 화면 열쇠에 Actions 권한이 없어도 보관함 쓰기 권한만 있으면 두 번째 길이 통해요 */
async function dispatchWorker(workId) {
    var branch = (S.conn && S.conn.branch) || 'main';
    var a = await bgPost(bgBase() + '/actions/workflows/ai-office-worker.yml/dispatches',
      { ref: branch, inputs: { job_id: String(workId) } });
    if (a.ok) return { ok: true, via: 'workflow_dispatch' };
    var b = await bgPost(bgBase() + '/dispatches', { event_type: 'ai-office-job', client_payload: { job_id: String(workId) } });
    if (b.ok) return { ok: true, via: 'repository_dispatch' };
    return { ok: false, status: b.status || a.status, error: (b.error || a.error || '알 수 없는 오류') };
}
function isLiveWork(w) {
    if (!w) return false;
    /* 피클이 직접 맡은 일(확인·취합 보고 대기)은 외부 일꾼·자동 중단 대상이 아니에요 */
    if (picoPending(w)) return false;
    if (w.status === 'working' || w.status === 'queued') return true;
    if (w.kind === 'delegation' && w.status === 'approved' && (w.phase === 'run' || w.phase === 'collect')) return true;
    return false;
}
function hasLiveWork() {
    var list = (S.office && S.office.work) || [];
    for (var i = 0; i < list.length; i++) if (isLiveWork(list[i])) return true;
    return false;
}
function lastLogAt(w) {
    var log = (w && (w.progressLog && w.progressLog.length ? w.progressLog : w.log)) || [];
    if (!log.length) return Date.parse((w && (w.startedAt || w.at)) || '') || 0;
    return Date.parse(log[log.length - 1].at || '') || 0;
}
function jobStalled(w) {
    if (!isLiveWork(w)) return false;
    var t = lastLogAt(w);
    return !!t && (Date.now() - t) > BG_STALE_MS;
}
/* 이 화면에서 실행하던 길 — 백그라운드 일꾼을 부르지 못했을 때 안전하게 돌아가요 */
function runLocally(item, mode) {
    if (!item) return;
    if (mode === 'run') { enqueuePipeline(item.id); return; }
    if (mode === 'plan') {
      var note = String(item.planNote || '');
      item.planNote = '';
      enqueuePlan(item.id, note);
      return;
    }
    enqueueRun(item.id);
}
/* 일을 시작해요 — 백그라운드 일꾼에게 맡기고, 안 되면 이 화면에서 실행해요 */
async function kick(item, mode) {
    if (!item || !S.office) return false;
    /* 1F 비서실은 피클이 직접 맡아요 — 피클이 처리할 차례면 외부 일꾼을 부르지 않아요 */
    if (picoPending(item)) { renderAll(); saveOfficeSoon(0); return false; }
    if (S.bg.kick[item.id]) return false;
    S.bg.kick[item.id] = true;
    if (mode === 'run') { item.status = 'approved'; item.phase = 'run'; }
    else if (mode === 'plan') { item.status = 'working'; item.phase = 'plan'; }
    else if (item.status !== 'queued') item.status = 'working';
    item.cancelRequested = false;
    item.bg = { at: nowIso(), via: 'trying' };
    pushLog(item, '백그라운드 일꾼 호출 중');
    renderAll();
    try {
      try { await saveOffice(); } catch (e0) { /* 저장이 늦어도 일꾼은 불러 봐요 */ }
      var r = await dispatchWorker(item.id);
      delete S.bg.kick[item.id];
      if (r.ok) {
        item.bg = { at: nowIso(), via: r.via };
        pushLog(item, '백그라운드에서 실행 중 · 화면을 닫아도 계속돼요');
        S.bg.note = '';
        renderAll(); saveOfficeSoon(0);
        S.bg.liveAt = Date.now();
        startPolling();
        return true;
      }
      item.bg = { at: nowIso(), via: '', error: String(r.error || '') };
      pushLog(item, '백그라운드 연결 실패 · 이 화면에서 실행해요');
      toast('백그라운드 일꾼을 부르지 못해 이 화면에서 실행해요. ' + clip(r.error || '', 60));
    } catch (e) {
      delete S.bg.kick[item.id];
      item.bg = { at: nowIso(), via: '', error: String((e && e.message) || e) };
      pushLog(item, '백그라운드 준비 실패 · 이 화면에서 실행해요');
    }
    renderAll(); saveOfficeSoon(0);
    runLocally(item, mode);
    return false;
}

/* 다시 열었을 때: 백그라운드에서 실패한 일이 보고 없이 남아 있으면 비서가 정리해 올려요 */
function noticeSweep() {
    if (!S.office) return;
    var list = S.office.work || [];
    var changed = false;
    for (var i = 0; i < list.length; i++) {
      var w = list[i];
      if (!w || w.kind === 'notice' || w.status !== 'failed') continue;
      if (noticeFor(w.id)) continue;
      var t = Date.parse(w.updatedAt || w.at || '') || 0;
      if (!t || Date.now() - t > 6 * 3600 * 1000) continue;
      if (!w.bg && !w.stoppedAt) continue;
      makeNotice(w, w.error || '작업을 마치지 못했어요.', true);
      S.bg.notified[w.id] = 1;
      changed = true;
    }
    if (changed) { renderAll(); saveOfficeSoon(0); }
}

/* 진행 상황 받아오기 — 보고·진행 로그가 화면에 바로 보이게 */
function startPolling() {
    S.bg.liveAt = Date.now();
    if (S.bg.pollTimer) return;
    S.bg.pollTimer = window.setInterval(pollOffice, BG_POLL_MS);
}
function stopPolling() {
    if (!S.bg.pollTimer) return;
    window.clearInterval(S.bg.pollTimer);
    S.bg.pollTimer = null;
}
async function pollOffice() {
    if (!S.unlocked || !S.office || S.officeLocked || !S.chatKey || !S.me) { stopPolling(); return; }
    var live = hasLiveWork();
    var pico = hasPicoPending();
    if (live || pico) S.bg.liveAt = Date.now();
    /* 일이 끝난 뒤에도 3분은 더 지켜봐요 (다른 기기·일꾼의 마무리 기록을 받아오려고) */
    if (!live && !pico && Date.now() - (S.bg.liveAt || 0) > 180000) { stopPolling(); renderAll(); return; }
    /* 아직 올리지 않은 내 변경이 있으면 이번 차례는 건너뛰어요 (덮어쓰지 않게) */
    if (S.saveState === 'saving') return;
    if (JSON.stringify(S.office) !== S.officeState) return;
    var r = await ghGetAt(DEFAULT_REPO, P_OFFICE, null);
    if (!r.ok || r.missing) return;
    if (r.sha && r.sha === S.bg.lastSha) return;
    var env = null;
    try { env = JSON.parse(r.raw); } catch (e) { env = null; }
    if (!env || !env.ct) return;
    var obj = null;
    try { obj = await familyDecrypt(env); } catch (e2) { obj = null; }
    if (!obj) return;
    S.bg.lastSha = r.sha || '';
    S.office = normalizeOffice(obj);
    S.officeState = JSON.stringify(S.office);
    S.bg.at = Date.now();
    renderAll();
}

/* [작업 중단] · [다시 실행] — 멈춘 일은 비서가 대표실 결재함에 보고해요 */
function noticeFor(srcId) {
    var list = (S.office && S.office.work) || [];
    for (var i = list.length - 1; i >= 0; i--) {
      var n = list[i];
      if (n && n.kind === 'notice' && n.noticeOf === srcId && (n.status === 'waiting' || n.status === 'working')) return n;
    }
    return null;
}
function closeNotice(id, silent) {
    var n = workById(id);
    if (!n) return;
    n.status = 'approved';
    n.nextDone = true;
    n.nextAt = nowIso();
    pushLog(n, '확인하고 닫음');
    renderAll(); saveOfficeSoon(0);
    if (!silent) toast('비서 보고를 확인하고 닫았어요.');
}
/* 1F 비서실 → 대표님 결재함: 왜 멈췄는지 짧게 정리해 올려요 */
function makeNotice(src, reason, auto) {
    if (!S.office || !src) return null;
    var open = noticeFor(src.id);
    var log = (src.progressLog && src.progressLog.length) ? src.progressLog : (src.log || []);
    var lastLine = '', lastAt = '';
    for (var li = log.length - 1; li >= 0; li--) {
      var t0 = String(log[li].text || '');
      /* 방금 붙인 중단 기록 말고, 그 직전에 어디까지 갔는지를 보여 줘요 */
      if (/^(자동 중단|대표님 · )/.test(t0)) continue;
      lastLine = t0;
      lastAt = log[li].at || '';
      break;
    }
    var points = [
      '마지막 기록 · ' + (lastLine ? (lastLine + (lastAt ? ' (' + whenLabel(lastAt) + ')' : '')) : '기록 없음'),
      auto ? '3분 넘게 새 소식이 없어 비서가 자동으로 멈추고 정리했어요.' : '대표님이 직접 멈추셨어요.'
    ];
    if (src.autoRetryLog && src.autoRetryLog.length) {
      points.push('자동 재처리 ' + src.autoRetryLog.length + '번 시도 · ' + clip(src.autoRetryLog[src.autoRetryLog.length - 1].reason || '', 100));
    }
    var tryNote = '';
    if (src.autoRetryLog && src.autoRetryLog.length) {
      var tl = [];
      for (var ti = 0; ti < src.autoRetryLog.length; ti++) tl.push((ti + 1) + ') ' + clip(src.autoRetryLog[ti].reason || '', 160));
      tryNote = '\n\n[자동 재처리 시도]\n' + tl.join('\n');
    }
    if (open) {
      open.secretary = open.secretary || {};
      open.secretary.summary = reason;
      open.secretary.points = points;
      open.updatedAt = nowIso();
      renderAll(); saveOfficeSoon(0);
      return open;
    }
    var who = src.teamId === 'sec' ? '비서' : ((teamById(src.teamId) || {}).name || '팀');
    var title = (auto ? '⚠ ' : '⏹ ') + who + ' 작업이 멈췄어요 · ' + clip(src.title || '', 34);
    var w = newWork('sec', title, '', [], src.id);
    w.kind = 'notice';
    w.noticeOf = src.id;
    w.status = 'waiting';
    w.auto = !!auto;
    w.report = {
      summary: reason,
      detail: '원래 일: ' + (src.title || '') + '\n원인: ' + reason + '\n마지막 기록: ' + (lastLine || '기록 없음') + tryNote,
      next: [], at: nowIso()
    };
    w.secretary = { summary: reason, points: points, recommend: '다시 실행하면 멈춘 자리부터 이어서 해요.', next: [], at: nowIso() };
    pushLog(w, auto ? '자동 중단 보고' : '작업 중단 보고');
    return w;
}
/* 중단 처리를 한 곳에 모아요 (수동·자동 모두) */
function stopWorkCore(w, reason, auto) {
    if (!w) return null;
    w.cancelRequested = true;
    w.status = 'failed';
    w.error = reason;
    w.bg = null;
    w.stoppedAt = nowIso();
    pushLog(w, (auto ? '자동 중단 · ' : '대표님 · ') + reason);
    var kids = w.childIds || [];
    for (var i = 0; i < kids.length; i++) {
      var c = workById(kids[i]);
      if (!c) continue;
      if (c.status === 'working' || c.status === 'queued') {
        c.cancelRequested = true;
        c.status = 'failed';
        c.error = reason;
        pushLog(c, (auto ? '자동 중단 · ' : '대표님 · ') + reason);
      }
    }
    delete S.bg.watch[w.id];
    var n = makeNotice(w, reason, auto);
    if (n) S.bg.notified[w.id] = 1;
    renderAll(); saveOfficeSoon(0);
    return n;
}
function stopWork(id) {
    var w = workById(id);
    if (!w) return;
    if (!isLiveWork(w)) { toast('지금은 멈출 작업이 없어요.'); return; }
    stopWorkCore(w, '대표님이 작업을 중단했어요.', false);
    toast('작업을 멈추고 비서가 정리해 결재함에 올렸어요.');
}
/* 화면이 열려 있는 동안 지켜보기 — 3분 넘게 소식이 없으면 자동으로 멈췄다가 보고해요 */
function watchWork() {
    if (!S.unlocked || !S.office || S.officeLocked) return;
    var list = S.office.work || [];
    for (var i = 0; i < list.length; i++) {
      var w = list[i];
      if (!w || w.kind === 'notice') continue;
      if (isLiveWork(w)) {
        S.bg.watch[w.id] = 1;
        if (jobStalled(w) && !S.bg.stopping[w.id]) {
          S.bg.stopping[w.id] = 1;
          /* 바로 멈추고 보고하지 않고, 한 번은 자동으로 이어서 실행해요 */
          if ((Number(w.stallRetries) || 0) < 1) {
            w.stallRetries = (Number(w.stallRetries) || 0) + 1;
            w.tries = (Number(w.tries) || 0) + 1;
            w.autoRetryLog = w.autoRetryLog || [];
            w.autoRetryLog.push({ at: nowIso(), reason: '응답이 3분 넘게 없었어요 · 자동으로 다시 실행', try: w.tries });
            pushLog(w, '자동 재처리 ' + w.tries + '/' + AUTO_RETRY_MAX + ' · 응답이 3분 넘게 없어 다시 실행');
            renderAll(); saveOfficeSoon(0);
            window.setTimeout(function () {
              var live2 = workById(w.id);
              if (!live2) return;
              if (jobStalled(live2)) rerunWork(w.id);
            }, 2500);
          } else {
            stopWorkCore(w, '응답이 3분 넘게 없어 자동으로 멈췄어요.', true);
            toast('응답이 없어 작업을 자동으로 멈추고, 비서가 보고를 올렸어요.');
          }
          delete S.bg.stopping[w.id];
        }
      } else if (S.bg.watch[w.id]) {
        delete S.bg.watch[w.id];
        if (w.status === 'failed' && !S.bg.notified[w.id]) {
          S.bg.notified[w.id] = 1;
          makeNotice(w, w.error || '작업을 마치지 못했어요.', true);
          renderAll(); saveOfficeSoon(0);
        }
      }
    }
}
function rerunWork(id) {
    var w = workById(id);
    if (!w) return;
    var open = noticeFor(w.id);
    if (open) closeNotice(open.id, true);
    w.cancelRequested = false;
    w.error = '';
    w.autoStalled = 0;
    delete S.bg.notified[w.id];
    attachPrior(w, w, '대표님이 다시 실행');
    if (w.kind === 'delegation') {
      var phase = w.phase || 'plan';
      if (phase === 'plan') {
        w.status = 'working';
        w.phase = 'plan';
        pushLog(w, '다시 실행 · 배분 계획부터');
        renderAll(); saveOfficeSoon(0);
        kick(w, 'plan');
      } else {
        var kids = w.childIds || [];
        for (var i = 0; i < kids.length; i++) {
          var c = workById(kids[i]);
          if (!c) continue;
          c.cancelRequested = false;
          if (c.status === 'failed' || c.status === 'working') { c.status = 'queued'; c.error = ''; }
        }
        w.status = 'approved';
        w.phase = 'run';
        pushLog(w, '다시 실행 · 남은 팀부터 이어서');
        renderAll(); saveOfficeSoon(0);
        kick(w, 'run');
      }
      return;
    }
    w.status = 'working';
    pushLog(w, '다시 실행');
    renderAll(); saveOfficeSoon(0);
    kick(w, 'item');
}

/* ---------- 업무 지우기 · 반려 후 삭제 · 코드 다시 요청 ---------- */
function deleteWork(id) {
    if (!S.office || !id) return false;
    var victim = workById(id);
    if (!victim) return false;
    var drop = [id];
    var kids = (victim.childIds || []).slice();
    for (var i = 0; i < kids.length; i++) if (kids[i]) drop.push(kids[i]);
    var list = S.office.work || [], out = [];
    for (var k = 0; k < list.length; k++) {
      var x = list[k];
      if (!x) continue;
      if (drop.indexOf(x.id) >= 0) continue;
      /* 이 업무의 문제 보고·하위 일 보고도 같이 정리해요 */
      if (x.kind === 'notice' && drop.indexOf(x.noticeOf) >= 0) continue;
      if (x.parentId && drop.indexOf(x.parentId) >= 0) continue;
      out.push(x);
    }
    S.office.work = out;
    if (S.workModal === id) closeWorkDetail(true);
    renderAll(); saveOfficeSoon(0);
    return true;
}
function askDeleteWork(id) {
    var w = workById(id);
    if (!w) return;
    if (!window.confirm('이 업무를 목록에서 지울까요?\n지운 업무는 되돌릴 수 없어요.')) return;
    deleteWork(id);
    toast('업무를 목록에서 지웠어요.');
}
function rejectDelete(id) {
    var w = workById(id);
    if (!w) return;
    var reason = String(fieldVal('rej_' + id) || '').trim();
    if (!window.confirm('반려하고 이 업무를 목록에서 지울까요?' + (reason ? '\n반려 사유: ' + reason : ''))) return;
    w.status = 'rejected';
    w.rejectedAt = nowIso();
    w.rejectReason = clip(reason || '대표님이 반려하고 정리했어요.', 600);
    pushLog(w, '대표님 반려 후 삭제' + (reason ? ' · ' + clip(reason, 100) : ''));
    deleteWork(id);
    toast('반려하고 목록에서 지웠어요.');
}
function secCodeRetry(id) {
    var sec = workById(id);
    if (!sec) return;
    if (sec.codeRedoId && workById(sec.codeRedoId) && isLiveWork(workById(sec.codeRedoId))) {
      toast('이미 개발팀에 코드 수정을 다시 요청했어요. 결과를 기다려 주세요.');
      return;
    }
    sec.codeWanted = true;
    sec.codeMissing = false;
    var w = newCodeRedoWork(sec, '대표님이 개발팀에 코드 작성 다시 요청');
    pushLog(sec, '대표님 · [개발팀에 다시 코드 작성 요청]');
    renderAll(); saveOfficeSoon(0);
    kick(w, 'item');
    toast('개발팀에 실제 코드 수정안을 다시 요청했어요.');
}

/* ---------- CS 접수함 (2단계: 4개 대시보드 챗봇 버튼이 여기에 쌓아요) ---------- */
function sourceLabel(src) {
    var s = String(src || '').toLowerCase();
    if (/kids|jaden|아이/.test(s)) return "Jaden's Today";
    if (/fridge|냉파|냉장/.test(s)) return '냉장고 파먹기';
    if (/ledger|가계부/.test(s)) return '가계부';
    if (/home|홈/.test(s)) return '우리 집';
    return String(src || '가족 화면');
}
function normInboxItem(x, i) {
    var text = String(x.text || x.message || x.body || x.request || x.content || '').trim();
    return {
      id: String(x.id || ('ib' + i)),
      at: String(x.at || x.createdAt || x.time || ''),
      source: String(x.source || x.from || x.dashboard || ''),
      label: String(x.sourceLabel || sourceLabel(x.source || x.dashboard || '')),
      name: String(x.name || x.user || x.who || ''),
      kind: String(x.kind || x.type || '요청'),
      text: text,
      status: String(x.status || 'new')
    };
}
async function loadInbox() {
    var r = await ghGetJson(DEFAULT_REPO, P_INBOX, null);
    if (!r.ok) { S.inbox = { ok: false, items: [], error: r.error || '접수함을 읽지 못했어요', at: Date.now() }; return S.inbox; }
    var items = [];
    if (!r.missing && r.data) {
      var arr = null;
      if (Object.prototype.toString.call(r.data) === '[object Array]') arr = r.data;
      else if (Object.prototype.toString.call(r.data.items) === '[object Array]') arr = r.data.items;
      else if (Object.prototype.toString.call(r.data.inbox) === '[object Array]') arr = r.data.inbox;
      for (var i = 0; i < (arr || []).length && i < 200; i++) {
        if (!arr[i] || typeof arr[i] !== 'object') continue;
        var it = normInboxItem(arr[i], i);
        if (it.text) items.push(it);
      }
    }
    S.inbox = { ok: true, items: items, error: '', at: Date.now(), missing: !!r.missing };
    return S.inbox;
}
function pendingInbox() {
    var out = [], seen = (S.office && S.office.inboxSeen) || [];
    var list = (S.inbox && S.inbox.items) || [];
    for (var i = 0; i < list.length; i++) {
      var it = list[i];
      if (INBOX_DONE[String(it.status || '').toLowerCase()]) continue;
      if (seen.indexOf(it.id) >= 0) continue;
      out.push(it);
    }
    return out;
}
