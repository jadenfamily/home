/* ============================================================================
   AI 사무실 — office/js/secretary.js
   1F 비서실(피클) — 배분 계획 → 승인 → 팀 순차 실행 → 취합 보고
   · office.html 이 css/style.css → js/state.js … js/boot.js 순서로 불러요.
     모듈끼리 같은 전역 스코프를 써요(함수 이름은 사무실 전체에서 하나).
   · 원래 office.html 한 덩어리 스크립트를 기능별로 나눈 파일이라 동작은 같아요.
   ============================================================================ */
'use strict';

/* ==================================================================
     비서 직접 지시 — 배분 계획 → 대표님 승인 → 팀 순차 실행 → 취합 보고
     ================================================================== */
function secretaryPlanSystem() {
    var lines = [];
    for (var mk = 0; mk < MODULE_RULES.length; mk++) lines.push(MODULE_RULES[mk]);
    lines.push('');
    lines.push('너는 jadenfamily 가족의 AI 사무실에서 일하는 "비서"다.');
    lines.push('대표님이 비서에게 일을 맡기면, 어떤 팀에게 어떤 순서로 나눠 맡길지 "배분 계획"을 세운다. 아직 일을 실행하지 않는다.');
    lines.push(officeFacts());
    lines.push('');
    lines.push('[팀 — deptId로만 고른다]');
    for (var i = 0; i < S.office.teams.length; i++) {
      var t = S.office.teams[i];
      lines.push('- ' + t.id + ' (' + t.name + '): ' + (t.desc || ''));
    }
    lines.push('');
    lines.push('[규칙]');
    lines.push('- 필요 없는 팀은 넣지 않는다. 2~4개 팀으로 나누고 많아도 5개를 넘기지 않는다.');
    lines.push('- 팀은 적은 순서대로 일한다. 앞 팀의 결과가 다음 팀에 자료로 넘어가니, 뒤 팀의 prompt에는 "앞 팀 결과를 이어받아 무엇을 할지"를 적는다.');
    lines.push('- 화면 코드를 고치는 일은 dev에 맡기고, dev 뒤에는 반드시 qc를 넣어 검수하게 한다. 코드 반영은 대표님 최종 승인 뒤에만 한다.');
    lines.push('- 각 prompt는 그 팀이 바로 일할 수 있는 구체적인 지시문으로 쓴다. 대표님 지시에 없는 일을 만들지 않는다.');
    lines.push('- title은 20자 안팎의 짧은 일 이름으로 쓴다.');
    lines.push('');
    lines.push('[출력 형식 — 마지막에 ```json 블록 하나]');
    lines.push('```json');
    lines.push('{"summary":"어떻게 나눌지 2~3줄","plan":[{"deptId":"plan","title":"짧은 일 이름","prompt":"그 팀에 그대로 전달할 지시문"}],"points":["대표님이 확인할 점"],"recommend":"한 줄"}');
    lines.push('```');
    return lines.join('\n');
}
function buildPlanInput(item, note) {
    var lines = [];
    lines.push('[배분 계획 요청]');
    lines.push('');
    lines.push('[대표님 지시]');
    lines.push(String(item.brief || '').slice(0, 6000));
    var mats = materialText(item);
    if (mats) { lines.push(''); lines.push('[넘겨받은 자료]'); lines.push(mats); }
    if (note) { lines.push(''); lines.push('[대표님 반려 사유 — 이 점을 고쳐 계획을 다시 세워 주세요]'); lines.push(String(note).slice(0, 800)); }
    if (item.planNotes) { lines.push(''); lines.push('[이전 반려 기록]'); lines.push(clip(item.planNotes, 1200)); }
    lines.push('');
    lines.push('위 지시를 어떤 팀에게 어떤 순서로 나눠 맡길지 배분 계획을 세워 ```json으로 답해 주세요. 아직 일을 실행하지 마세요.');
    return lines.join('\n');
}
function normalizePlan(obj) {
    var out = [], raw = obj && obj.plan;
    if (!raw) return out;
    if (!(Object.prototype.toString.call(raw) === '[object Array]')) raw = [raw];
    for (var i = 0; i < raw.length && out.length < 5; i++) {
      var x = raw[i];
      if (!x || typeof x !== 'object') continue;
      var nameOrId = String(x.deptId || x.dept || x.teamId || x.team || '');
      var key = teamById(nameOrId) ? nameOrId : teamKeyFromName(nameOrId);
      if (!key || key === 'sec' || !teamById(key)) continue;
      var title = String(x.title || x.name || '').trim().slice(0, 60);
      var prompt = String(x.prompt || x.brief || x.text || '').trim().slice(0, 1500);
      if (!prompt) continue;
      out.push({ deptId: key, title: title || (teamById(key).name + ' 일'), prompt: prompt });
    }
    return out;
}
function fallbackPlan(item) {
    var text = String((item && item.brief) || '');
    var ids;
    if (/코드|화면|버그|고쳐|수정|개발/i.test(text)) ids = ['plan', 'dev', 'qc'];
    else if (/디자인|색|글자|배치|모양/i.test(text)) ids = ['design'];
    else if (/찾아|조사|알아봐|비교|리서치/i.test(text)) ids = ['research'];
    else if (/접수|요청|불편|문의/i.test(text)) ids = ['cs'];
    else ids = ['plan'];
    var out = [];
    for (var i = 0; i < ids.length; i++) {
      var t = teamById(ids[i]);
      if (!t) continue;
      out.push({ deptId: ids[i], title: t.name + ' 일', prompt: '[대표님 지시]\n' + clip(text, 900) + '\n\n맡은 부분을 정리해 보고해 주세요.' });
    }
    return out;
}
async function buildDelegationPlan(item, note) {
    var res = await officeCall(secretaryTeam(), secretaryPlanSystem(), [{ role: 'user', text: buildPlanInput(item, note) }], {
      maxTokens: 1600,
      onStep: function (t) { pushLog(item, t); if (S.teamModal) renderAll(); }
    });
    var obj = res && res.ok ? findReportObj(res.text) : null;
    var out = { list: normalizePlan(obj), summary: '', points: [], recommend: '', detail: '' };
    if (obj) {
      out.summary = String(obj.summary || '').trim();
      out.detail = String(obj.detail || '').trim();
      if (Object.prototype.toString.call(obj.points) === '[object Array]') {
        for (var i = 0; i < obj.points.length && out.points.length < 5; i++) {
          var p = String(obj.points[i] || '').trim();
          if (p) out.points.push(p);
        }
      }
      out.recommend = String(obj.recommend || '').trim();
    }
    if (!out.list.length) out.list = fallbackPlan(item);
    if (!out.summary) out.summary = '지시를 ' + out.list.length + '개 팀으로 나눠 맡기겠습니다. 승인해 주시면 순서대로 전달하고, 끝나면 결과를 취합해 다시 올릴게요.';
    if (!res || !res.ok) out.summary = 'AI로 계획을 정리하지 못해 기본 순서로 준비했어요. ' + out.summary;
    if (!out.points.length) out.points = ['배분 순서와 범위가 맞는지 확인', '승인하면 팀들이 순서대로 일해요'];
    if (!out.recommend) out.recommend = '승인하면 바로 시작할게요.';
    return out;
}
function planLine(list) {
    var out = [];
    for (var i = 0; i < (list || []).length; i++) {
      var t = teamById(list[i].deptId);
      out.push((i + 1) + '. ' + (t ? t.name : list[i].deptId));
    }
    return out.join(' → ');
}
/* 재시도·반려·재요청으로 다시 시작할 때 직전 실행의 기록·중간 보고·수정안 요약을 함께 넘겨요 */
function runContextText(w) {
    if (!w) return '';
    var log = (w.progressLog && w.progressLog.length) ? w.progressLog : (w.log || []);
    var tail = log.slice(-12);
    var lines = [];
    lines.push('[직전 실행 기록 — 이어서 처리하고, 이미 해 본 시도를 그대로 반복하지 마세요]');
    lines.push('- 상태: ' + workStateLabel(w) + (w.error ? ' · ' + clip(w.error, 200) : '') + (w.tries ? ' · 시도 ' + w.tries + '번' : ''));
    if (tail.length) {
      lines.push('- 진행 기록(최근 ' + tail.length + '줄):');
      for (var i = 0; i < tail.length; i++) lines.push('  · ' + clip(tail[i].text || '', 160));
    }
    var rep = w.report || {};
    if (rep.summary) lines.push('- 중간 보고 요약: ' + clip(rep.summary, 500));
    if (rep.detail) lines.push('- 중간 보고 상세: ' + clip(rep.detail, 1500));
    if (w.secretary && w.secretary.summary) lines.push('- 비서 요약: ' + clip(w.secretary.summary, 400));
    if (w.code) lines.push('- 이미 만든 수정안: ' + w.code.repo + '/' + w.code.path + ' · ' + clip(w.code.patchNote || '', 300) + ' (아직 반영 전)');
    if (w.rejectReason) lines.push('- 대표님 반려 사유: ' + clip(w.rejectReason, 400));
    if (w.autoRetryLog && w.autoRetryLog.length) {
      lines.push('- 지금까지 자동 재처리: ' + w.autoRetryLog.length + '번');
      for (var k = 0; k < w.autoRetryLog.length && k < 4; k++) lines.push('  · ' + clip(w.autoRetryLog[k].reason || '', 160));
    }
    return lines.join('\n');
}
function attachPrior(w, src, why) {
    if (!w || !src) return w;
    var text = runContextText(src);
    if (why) text = '[이번에 다시 맡긴 이유] ' + why + '\n' + text;
    w.priorContext = clip(text, 5000);
    return w;
}

function startSecretaryDirective(d, opts) {
    if (!S.office) return null;
    var text = String(d.text || '').trim();
    if (!text) { toast('비서 피클에게 맡길 일을 적어 주세요.'); return null; }
    var title = String(d.title || '').trim() || clip(firstLines(text, 1), 36) || '새 일';
    var w = newWork('sec', title, text, d.material ? [d.material] : []);
    w.kind = 'delegation';
    w.phase = 'plan';
    w.delegationPlan = [];
    w.childIds = [];
    /* 1F 비서실은 피클이 직접 맡아요 — 외부 AI 일꾼을 부르지 않고, 피클이 확인할 때까지 기다려요 */
    w.secOwner = 'pico';
    w.picoStatus = 'pending';
    w.picoRequestedAt = nowIso();
    w.picoSeenAt = '';
    w.picoSource = String(d.picoSource || (d.sources ? 'inbox' : 'direct'));
    pushLog(w, '대표님 지시');
    pushLog(w, '비서 피클 확인 대기 · 피클이 직접 확인해 배분 계획을 올려요');
    S.draft = { team: 'sec', title: '', text: '', material: '' };
    S.clearDraft = true;
    S.directHint = '';
    var ti = document.getElementById('directTitle'); if (ti) ti.value = '';
    var tx = document.getElementById('directText'); if (tx) tx.value = '';
    var mt = document.getElementById('directMaterial'); if (mt) mt.value = '';
    if (!opts || !opts.keepTab) S.tab = 'office';
    renderAll(); saveOfficeSoon(0);
    startPolling();
    toast('피클에게 넘겼어요. 피클이 확인해 배분 계획을 올리면 결재함에서 승인할 수 있어요.');
    return w;
}
function enqueuePlan(workId, note) {
    S.planQueue = S.planQueue || [];
    S.planQueue.push({ id: workId, note: note || '' });
    pumpPlan();
}
async function pumpPlan() {
    if (S.planRunning) return;
    var job = (S.planQueue || []).shift();
    if (!job) return;
    S.planRunning = true;
    try { await runPlan(job.id, job.note); }
    catch (e) { /* runPlan 안에서 처리해요 */ }
    finally { S.planRunning = false; pumpPlan(); }
}
async function runPlan(workId, note) {
    var item = workById(workId);
    if (!item) return;
    if (isPicoWork(item)) return;   /* 피클 담당은 외부 모델로 계획을 세우지 않아요 */
    item.status = 'working';
    item.phase = 'plan';
    item.updatedAt = nowIso();
    if (!item.startedAt) item.startedAt = nowIso();
    S.busy[item.id] = { at: Date.now() };
    pushLog(item, '업무 파악 중');
    renderAll(); saveOfficeSoon(0);
    try {
      var plan = await buildDelegationPlan(item, note);
      item.delegationPlan = plan.list;
      item.secretary = {
        summary: plan.summary,
        points: plan.points,
        recommend: plan.recommend,
        next: [],
        at: nowIso()
      };
      item.report = { summary: plan.summary, detail: plan.detail || plan.list.map(function (p) {
        var t = teamById(p.deptId) || { name: p.deptId };
        return '[' + t.name + '] ' + p.title + '\n' + p.prompt;
      }).join('\n\n'), next: [], at: nowIso() };
      item.status = 'waiting';
      item.updatedAt = nowIso();
      pushLog(item, '배분 계획 · ' + planLine(plan.list));
      pushLog(item, '비서 배분 계획 → 대표님 결재 대기');
      toast('비서가 배분 계획을 올렸어요. 대표실 결재함에서 승인해 주세요.');
    } catch (e) {
      var pmsg = String(e && e.message ? e.message : e);
      /* 바로 실패 보고를 올리지 않고, 직전 기록을 안고 한 번 더 자동으로 시도해요 */
      if (autoRetry(item, pmsg, 'plan')) return;
      item.status = 'failed';
      item.error = pmsg;
      item.report = item.report || { summary: '배분 계획을 세우지 못했어요.', detail: pmsg, next: [], at: nowIso() };
      pushLog(item, '실패 · ' + clip(pmsg, 120));
      makeNotice(item, '자동 재처리 ' + (Number(item.tries) || 0) + '번까지 했지만 배분 계획을 세우지 못했어요 · ' + clip(pmsg, 120), true);
      toast('배분 계획을 세우지 못했어요: ' + clip(pmsg, 90));
    } finally {
      delete S.busy[item.id];
      item.updatedAt = nowIso();
      renderAll(); saveOfficeSoon(0);
    }
}
function startDelegation(secId) {
    var sec = workById(secId);
    if (!sec) return;
    if (!sec.delegationPlan || !sec.delegationPlan.length) { toast('배분 계획이 비어 있어요.'); return; }
    /* 피클이 계획만 올리고 표시를 바꾸지 않았어도, 계획이 있으면 승인할 수 있게 해요 */
    if (isPicoWork(sec) && sec.picoStatus === 'pending') sec.picoStatus = 'planned';
    sec.status = 'approved';
    sec.approvedAt = nowIso();
    sec.phase = 'run';
    sec.childIds = [];
    pushLog(sec, '대표님 승인 · 팀에 순서대로 전달 시작');
    for (var i = 0; i < sec.delegationPlan.length; i++) {
      var p = sec.delegationPlan[i];
      var t = teamById(p.deptId);
      if (!t) continue;
      var brief = '[대표님 지시]\n' + clip(sec.brief, 3000) +
        '\n\n[비서 배분 계획 ' + (i + 1) + '/' + sec.delegationPlan.length + ']\n' + p.prompt +
        (i > 0 ? '\n\n앞 팀의 결과를 이어받아 진행해 주세요.' : '');
      var w = newWork(p.deptId, p.title || (t.name + ' 일'), brief, [], sec.id);
      w.kind = 'delegation-child';
      w.secId = sec.id;
      w.order = i;
      w.status = 'queued';
      pushLog(w, '비서 배분 계획으로 배정');
      sec.childIds.push(w.id);
    }
    renderAll(); saveOfficeSoon(0);
    toast('배분 계획을 승인했어요. 비서가 팀에 순서대로 전달하고, 끝나면 하나로 취합해 올려요.');
    kick(sec, 'run');
}
function enqueuePipeline(secId) {
    S.pipe = S.pipe || [];
    S.pipe.push(secId);
    pumpPipeline();
}
async function pumpPipeline() {
    if (S.pipeRunning) return;
    var id = (S.pipe || []).shift();
    if (!id) return;
    S.pipeRunning = true;
    try { await runPipeline(id); }
    catch (e) { /* runPipeline 안에서 처리해요 */ }
    finally { S.pipeRunning = false; pumpPipeline(); }
}
function secChildList(sec) {
    var out = [];
    for (var i = 0; i < ((sec && sec.childIds) || []).length; i++) {
      var c = workById(sec.childIds[i]);
      if (c) out.push(c);
    }
    return out;
}
async function runPipeline(secId) {
    var sec = workById(secId);
    if (!sec) return;
    if (picoPending(sec)) return;
    S.busy['pipe_' + secId] = { at: Date.now() };
    try {
      var ids = (sec.childIds || []).slice();
      for (var i = 0; i < ids.length; i++) {
        var child = workById(ids[i]);
        if (!child) continue;
        if (child.status === 'done') continue;
        var prior = [];
        for (var k = 0; k < i; k++) {
          var pc = workById(ids[k]);
          if (pc && pc.report) prior.push(pc.id);
        }
        child.materialIds = prior.slice(-2);
        child.status = 'working';
        child.startedAt = nowIso();
        child.updatedAt = nowIso();
        sec.currentChildId = child.id;
        sec.updatedAt = nowIso();
        S.busy[child.id] = { at: Date.now() };
        var tname = (teamById(child.teamId) || { name: child.teamId }).name;
        pushLog(sec, tname + '에 일을 전달 (' + (i + 1) + '/' + ids.length + ')');
        renderAll(); saveOfficeSoon(0);
        await runChildSafe(child, sec, tname);
        delete S.busy[child.id];
        child.updatedAt = nowIso();
        sec.updatedAt = nowIso();
        renderAll(); saveOfficeSoon(0);
      }
      sec.phase = 'collect';
      pushLog(sec, '비서 취합 보고 작성 중');
      renderAll(); saveOfficeSoon(0);
      /* 하위 개발팀이 만든 수정안을 비서 일에 먼저 붙여요 */
      if (!sec.code) sec.code = pickChildCode(sec);
      /* 코드 수정이 필요한 일인데 수정안이 비어 있으면, 실패로 올리기 전에 개발팀에 한 번 더 자동 요청해요 */
      if (!sec.code && codeIntent(sec) && !sec.codeRedoId) {
        sec.codeWanted = true;
        await autoCodeRedo(sec);
      }
      if (!sec.code && codeIntent(sec)) {
        sec.codeMissing = true;
        pushLog(sec, '코드 수정안이 끝까지 만들어지지 않음 · 결재함에서 다시 요청하거나 반려 후 삭제를 골라 주세요');
      }
      /* 1F 비서실이 맡은 일이면 외부 모델로 취합 보고를 쓰지 않고 피클에게 넘겨요 */
      if (isPicoWork(sec)) {
        sec.status = 'working';
        sec.phase = 'collect';
        sec.picoStatus = 'report';
        sec.picoReportAt = nowIso();
        sec.currentChildId = '';
        pushLog(sec, '팀 결과 도착 · 피클 최종 취합 보고 대기');
        renderAll(); saveOfficeSoon(0);
        startPolling();   /* 피클이 보고를 올리면 화면에 바로 보이게 */
        return;
      }
      var rep = await buildCollectReport(sec);
      sec.report = rep.report;
      sec.secretary = rep.secretary;
      sec.code = rep.code || sec.code || null;
      sec.status = 'waiting';
      sec.phase = 'report';
      sec.updatedAt = nowIso();
      pushLog(sec, '비서 최종 취합 보고 → 대표실 결재 대기');
      toast('비서가 최종 취합 보고를 올렸어요. 대표실 결재함에서 확인해 주세요.');
    } finally {
      delete S.busy['pipe_' + secId];
      if (sec) { sec.updatedAt = nowIso(); sec.currentChildId = ''; }
      renderAll(); saveOfficeSoon(0);
    }
}

/* ---------- 자동 재처리 (중간 오류·타임아웃· code_edit 누락) ---------- */
var AUTO_RETRY_MAX = 2;
/* 바로 실패 보고를 올리지 않고, 직전 실행 기록을 안고 한 번 더 자동으로 시도해요.
     다시 시도해도 안 될 때만 결재함에 원인·시도 내역과 함께 보고해요. */
function autoRetry(item, reason, mode, maxTry) {
    if (!item || isPicoWork(item)) return false;
    var limit = maxTry || AUTO_RETRY_MAX;
    var tries = Number(item.tries) || 0;
    if (tries >= limit) return false;
    item.tries = tries + 1;
    item.autoRetryLog = item.autoRetryLog || [];
    item.autoRetryLog.push({ at: nowIso(), reason: clip(reason, 200), try: item.tries });
    attachPrior(item, item, '자동 재처리 ' + item.tries + '번째 · ' + clip(reason, 160));
    pushLog(item, '자동 재처리 ' + item.tries + '/' + limit + ' · ' + clip(reason, 90));
    item.status = 'working';
    item.error = '';
    renderAll(); saveOfficeSoon(0);
    window.setTimeout(function () {
      var live = workById(item.id);
      if (!live || live.status !== 'working') return;
      kick(live, mode || 'item');
    }, 1200);
    return true;
}
function newCodeRedoWork(sec, why) {
    var t = teamById('dev') || { name: '개발(코딩)팀' };
    var brief = '[실제 코드 수정안 요청]\n' + clip(sec.brief, 2500) +
      '\n\n앞선 작업에서 실제 코드 수정안(code_edit)이 만들어지지 않았어요. 이번에는 반드시 code_edit 도구로 실제 파일을 고치는 수정안을 만들어 주세요.' +
      '\n- 아이 화면(kids-dashboard)은 index.html(17KB 셸) + js/*.js 모듈(ui·events·routines·settings·sync·core·missions·myroom 등) + css/style.css 구조예요. 고칠 기능이 있는 모듈 파일을 찾아 그 파일을 고치세요.' +
      '\n- search_code로 함수·표시 문구를 찾고, read_code_slice로 앞뒤를 확인한 뒤, code_edit의 edits(찾아 바꾸기)로 작게 고칩니다. path에는 실제 파일 이름(예: js/ui.js)을 적으세요.';
    var w = newWork('dev', '코드 수정 다시 · ' + clip(sec.title, 34), brief, [], sec.id);
    w.kind = 'delegation-child';
    w.secId = sec.id;
    w.codeRedoOf = sec.id;
    w.codeWanted = true;
    w.status = 'working';
    attachPrior(w, sec, why || '코드 수정안이 비어 있어 개발팀에 다시 요청');
    sec.codeRedoId = w.id;
    sec.codeRedoAt = nowIso();
    sec.codeWanted = true;
    sec.codeMissing = false;
    pushLog(sec, '개발팀에 실제 코드 수정안 다시 요청');
    pushLog(w, '대표님 지시 · 실제 코드 수정안 만들기');
    return w;
}
async function autoCodeRedo(sec) {
    var w = newCodeRedoWork(sec, '코드 수정안이 비어 있어 자동으로 다시 요청');
    pushLog(sec, '자동 재처리 · 코드 수정안 다시 요청');
    renderAll(); saveOfficeSoon(0);
    await runChildSafe(w, sec, '개발(코딩)팀');
    if (w.code) { sec.code = w.code; sec.codeMissing = false; }
    renderAll(); saveOfficeSoon(0);
    return w.code || null;
}
/* 하위 일 하나를 실행하고, 중간 오류는 직전 기록을 안고 한 번 더 시도해요 */
async function runChildSafe(child, sec, tname) {
    var limit = 2;
    for (var tryNo = 0; tryNo < limit; tryNo++) {
      try {
        child.report = await runTeamAgent(child, teamById(child.teamId) || { id: child.teamId, name: child.teamId, desc: '' });
        child.status = 'done';
        child.doneAt = nowIso();
        pushLog(child, '보고 도착');
        if (sec) pushLog(sec, tname + ' 결과 도착');
        if (child.code) {
          if (sec) pushLog(sec, '수정안 도착 · ' + fileLabel(child.code.repo, child.code.path) + ' (아직 반영 전)');
          linkRedoCode(child);
        }
        return true;
      } catch (e) {
        var msg = String(e && e.message ? e.message : e);
        child.tries = (Number(child.tries) || 0) + 1;
        child.autoRetryLog = child.autoRetryLog || [];
        child.autoRetryLog.push({ at: nowIso(), reason: clip(msg, 200), try: child.tries });
        if (tryNo < limit - 1) {
          attachPrior(child, child, '자동 재처리 · ' + clip(msg, 160));
          pushLog(child, '자동 재처리 ' + child.tries + '/' + (limit - 1) + ' · ' + clip(msg, 90));
          if (sec) pushLog(sec, tname + ' 자동 재처리 · ' + clip(msg, 80));
          renderAll(); saveOfficeSoon(0);
          continue;
        }
        child.status = 'failed';
        child.error = msg;
        child.report = child.report || { summary: '작업을 마치지 못했어요.', detail: msg, next: [], at: nowIso() };
        pushLog(child, '실패 · ' + clip(msg, 120));
        if (sec) pushLog(sec, tname + ' 실패 · ' + clip(msg, 90));
        return false;
      }
    }
    return false;
}
/* 다시 요청한 개발팀 수정안을 원래 비서 일에 붙여요 */
function pickChildCode(sec) {
    var kids = secChildList(sec), code = null;
    for (var i = 0; i < kids.length; i++) if (kids[i] && kids[i].code) code = kids[i].code;
    return code;
}
function linkRedoCode(child) {
    if (!child || !child.codeRedoOf || !child.code) return;
    var parent = workById(child.codeRedoOf);
    if (!parent) return;
    parent.code = child.code;
    parent.codeMissing = false;
    parent.codeWanted = true;
    pushLog(parent, '수정안 도착 · ' + fileLabel(child.code.repo, child.code.path) + ' (아직 반영 전)');
}
async function buildCollectReport(sec) {
    var kids = secChildList(sec);
    var rows = [], code = null;
    for (var i = 0; i < kids.length; i++) {
      var c = kids[i], t = teamById(c.teamId) || { name: c.teamId };
      var rep = c.report || {};
      rows.push('[' + t.name + '] ' + c.title +
        '\n- 상태: ' + (c.status === 'failed' ? ('실패 · ' + clip(c.error || '', 200)) : '완료') +
        '\n- 핵심: ' + clip(rep.summary || '', 600) +
        '\n- 상세: ' + clip(rep.detail || '', 1600) +
        (c.code ? ('\n- 코드 수정안: ' + fileLabel(c.code.repo, c.code.path) + ' (+' + c.code.added + ' −' + c.code.removed + ') · ' + (c.code.checkOk ? '자동 검사 통과' : '자동 검사 문제 있음') + ' · 아직 반영 전') : ''));
      if (c.code) code = c.code;
    }
    var detail = rows.join('\n\n');
    var text = '[취합 보고]\n\n[맡긴 일] ' + sec.title + '\n[대표님 지시] ' + clip(sec.brief, 1500) +
      '\n\n[팀별 결과]\n' + clip(detail, 9000);
    var res = await officeCall(secretaryTeam(), buildSecretarySystem(), [{ role: 'user', text: text }], {
      maxTokens: 1500,
      onStep: function (t) { pushLog(sec, t); if (S.teamModal) renderAll(); }
    });
    var obj = res && res.ok ? findReportObj(res.text) : null;
    var summary = '', points = [], recommend = '';
    if (obj) {
      summary = String(obj.summary || '').trim();
      if (Object.prototype.toString.call(obj.points) === '[object Array]') {
        for (var p = 0; p < obj.points.length && points.length < 5; p++) {
          var s = String(obj.points[p] || '').trim();
          if (s) points.push(s);
        }
      }
      recommend = String(obj.recommend || '').trim();
    }
    if (!summary) {
      var parts = [];
      for (var q = 0; q < kids.length; q++) {
        var kt = teamById(kids[q].teamId) || { name: kids[q].teamId };
        parts.push(kt.name + ': ' + clip((kids[q].report && kids[q].report.summary) || '보고 없음', 160));
      }
      summary = parts.join('\n') || '팀 결과를 모았어요.';
    }
    if (!points.length) {
      if (code) points.push('수정안은 아직 반영 전이에요 — QC 검수 또는 최종 승인하고 반영 중 하나를 골라 주세요.');
      points.push('팀별 결과를 확인해 주세요.');
    }
    if (!recommend) recommend = code ? 'QC 검수를 거친 뒤 최종 승인하면 반영돼요.' : '바로 승인해도 됩니다.';
    return {
      report: { summary: summary, detail: detail, next: [], at: nowIso() },
      secretary: { summary: summary, points: points, recommend: recommend, next: [], collect: true, at: nowIso() },
      code: code
    };
}

/* ---------- 실행 큐 (한 번에 하나씩) ---------- */
function enqueueRun(workId) {
    S.queue.push(workId);
    pump();
}
async function pump() {
    if (S.running) return;
    var id = S.queue.shift();
    if (!id) return;
    S.running = true;
    try { await runItem(id); }
    catch (e) { /* runItem 안에서 처리해요 */ }
    finally { S.running = false; pump(); }
}
async function runItem(workId) {
    var item = workById(workId);
    if (!item) return;
    var team = teamById(item.teamId) || { id: item.teamId, name: item.teamId, desc: '' };
    item.status = 'working';
    item.startedAt = nowIso();
    item.updatedAt = nowIso();
    S.busy[item.id] = { at: Date.now() };
    pushLog(item, team.name + ' 작업 시작');
    renderAll(); saveOfficeSoon(0);
    try {
      item.report = await runTeamAgent(item, team);
      item.updatedAt = nowIso();
      pushLog(item, '팀 보고 도착');
      renderAll(); saveOfficeSoon(0);
      /* 개발팀인데 코드 수정안이 없으면, 실패로 올리기 전에 한 번 더 요청해요 */
      if (team.id === 'dev' && !item.code && codeIntent(item)) {
        markTry(item, 'code_edit 누락 · 실제 수정안이 없어 다시 요청');
        attachPrior(item, item, '설명만 있고 실제 code_edit 수정안이 없어 다시 요청');
        pushLog(item, '자동 재처리 · 수정안이 없어 다시 요청');
        renderAll(); saveOfficeSoon(0);
        var again = await runTeamAgent(item, team);
        if (again) item.report = again;
        if (item.code) pushLog(item, '수정안 도착 · ' + fileLabel(item.code.repo, item.code.path) + ' (아직 반영 전)');
        else pushLog(item, '수정안이 끝까지 만들어지지 않음');
        renderAll(); saveOfficeSoon(0);
      }
      pushLog(item, '비서 정리 보고 작성 중');
      renderAll(); saveOfficeSoon(0);
      var sec = await runSecretary(item);
      item.secretary = sec;
      item.status = 'waiting';
      item.updatedAt = nowIso();
      pushLog(item, '비서 정리 보고 → 대표실 결재 대기');
      if (item.code) linkRedoCode(item);
      toast('비서가 정리 보고를 올렸어요. 대표실 결재함을 봐 주세요.');
    } catch (e) {
      var imsg = String(e && e.message ? e.message : e);
      /* 바로 실패로 끝내지 않고, 직전 진행 기록을 안고 한 번 더 자동으로 시도해요 */
      if (autoRetry(item, imsg, 'item')) return;
      item.status = 'failed';
      item.error = imsg;
      item.report = item.report || { summary: '작업을 마치지 못했어요.', detail: imsg, next: [] };
      pushLog(item, '실패 · ' + clip(imsg, 120));
      makeNotice(item, '자동 재처리 ' + (Number(item.tries) || 0) + '번까지 했지만 작업을 마치지 못했어요 · ' + clip(imsg, 120), true);
      toast('작업을 마치지 못했어요: ' + clip(imsg, 90));
    } finally {
      delete S.busy[item.id];
      item.updatedAt = nowIso();
      renderAll(); saveOfficeSoon(0);
    }
}
