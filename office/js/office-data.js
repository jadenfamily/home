/* ============================================================================
   AI 사무실 — office/js/office-data.js
   사무실 데이터 — 팀 · 일 · 보고 · 결재 · 접수함
   · office.html 이 css/style.css → js/state.js … js/boot.js 순서로 불러요.
     모듈끼리 같은 전역 스코프를 써요(함수 이름은 사무실 전체에서 하나).
   · 원래 office.html 한 덩어리 스크립트를 기능별로 나눈 파일이라 동작은 같아요.
   ============================================================================ */
'use strict';

/* ==================================================================
     사무실 데이터 — 팀 · 일 · 보고 · 결재
     ================================================================== */
var ALL_TEAMS = [
    { id: 'cs', floor: '4F', name: 'CS(고객대응)팀', emoji: '🎧', color: '#f2b06a',
      desc: '가족 화면으로 들어온 요청·불편을 모아 정리하고, 답장과 할 일로 바꿔요.' },
    { id: 'plan', floor: '3F', name: '기획팀', emoji: '🗂️', color: '#a9c7f5',
      desc: '하고 싶은 일을 순서·범위·일정으로 나눠 실행 계획을 만들어요.' },
    { id: 'design', floor: '3F', name: '디자인팀', emoji: '🎨', color: '#f6b6c8',
      desc: '화면 배치·색·글자 크기·모바일 사용성을 살펴 개선안을 만들어요.' },
    { id: 'dev', floor: '2F', name: '개발(코딩)팀', emoji: '🧑‍💻', color: '#9fd8c4',
      desc: '실제 코드를 읽고 고치는 수정안을 만들어요. 반영은 대표님 승인 뒤에만 해요.' },
    { id: 'qc', floor: '2F', name: 'QC(품질관리)팀', emoji: '🔬', color: '#c3b7f0',
      desc: '수정안의 문법·구조·기존 기능 영향을 검수하고 통과 여부를 보고해요.' },
    { id: 'research', floor: '2F', name: '리서치팀', emoji: '🔭', color: '#f3cf8e',
      desc: '필요한 정보를 찾아 근거와 함께 비교·정리해요.' }
];
/* 1F 비서실은 외부 AI 모델 자리가 아니라 대표님의 전담 비서 피클 자리예요 */
var DEFAULT_SECRETARY = {
    id: 'sec', name: '전담 비서 피클', emoji: '🥒', color: '#a8d191',
    role: '요청 접수 · 브리핑 · 팀 배분 · 결과 보고',
    desc: '대시보드 요청 접수·브리핑, 대표님 승인 후 팀 배분·결과 보고 담당'
};
var FLOORS = [
    { id: '5F', name: '대표실', sub: '결재 · 승인' },
    { id: '4F', name: '고객대응', sub: 'CS · 접수함' },
    { id: '3F', name: '기획·디자인', sub: '기획 · 디자인' },
    { id: '2F', name: '개발·QC·리서치', sub: '개발 · 품질관리 · 리서치' },
    { id: '1F', name: '로비·비서실', sub: '정리 보고 · 안내' }
];
var STATUS_LABEL = { idle: '대기 중', working: '작업 중', waiting: '결재 기다림', done: '보고 완료' };
var INBOX_DONE = { done: 1, handled: 1, closed: 1, rejected: 1, 완료: 1, 처리됨: 1 };

function copyTeams() {
    var out = [];
    for (var i = 0; i < ALL_TEAMS.length; i++) {
      var t = ALL_TEAMS[i];
      out.push({ id: t.id, floor: t.floor, name: t.name, emoji: t.emoji, color: t.color, desc: t.desc, pid: '', model: '', custom: false });
    }
    return out;
}
function blankOffice() {
    return { version: 1, at: nowIso(), teams: copyTeams(), secretary: { pid: '', model: '' }, work: [], seq: 0, inboxSeen: [] };
}
function normalizeOffice(obj) {
    var o = obj && typeof obj === 'object' ? obj : {};
    if (!Object.prototype.toString.call(o.teams) === '[object Array]') o.teams = copyTeams();
    if (!(Object.prototype.toString.call(o.teams) === '[object Array]') || !o.teams.length) o.teams = copyTeams();
    /* 기본 6개 팀은 늘 있어야 해요 (저장본이 오래됐을 때 메꿔요) */
    for (var i = 0; i < ALL_TEAMS.length; i++) {
      var base = ALL_TEAMS[i], found = null;
      for (var k = 0; k < o.teams.length; k++) if (o.teams[k] && o.teams[k].id === base.id) found = o.teams[k];
      if (!found) o.teams.push({ id: base.id, floor: base.floor, name: base.name, emoji: base.emoji, color: base.color, desc: base.desc, pid: '', model: '', custom: false });
    }
    for (var j = 0; j < o.teams.length; j++) {
      var t = o.teams[j] || {};
      if (!t.id) t.id = 't' + randomHex ? 't' + randomHex(3) : 't' + j;
      if (!t.floor) t.floor = '2F';
      if (!t.name) t.name = '새 팀';
      if (!t.emoji) t.emoji = '🧩';
      if (!t.color) t.color = '#cfe3f7';
      if (!t.desc) t.desc = '';
      t.pid = String(t.pid || '');
      t.model = String(t.model || '');
      o.teams[j] = t;
    }
    if (!o.secretary || typeof o.secretary !== 'object') o.secretary = { pid: '', model: '' };
    if (!(Object.prototype.toString.call(o.work) === '[object Array]')) o.work = [];
    if (o.work.length > 120) o.work = o.work.slice(o.work.length - 120);
    if (!(Object.prototype.toString.call(o.inboxSeen) === '[object Array]')) o.inboxSeen = [];
    o.seq = Number(o.seq) || (o.work.length + 1);
    o.version = 1;
    return o;
}
function teamById(id) {
    if (!S.office) return null;
    for (var i = 0; i < S.office.teams.length; i++) if (S.office.teams[i].id === id) return S.office.teams[i];
    return null;
}
function secretaryTeam() {
    var sec = (S.office && S.office.secretary) || {};
    return {
      id: 'sec', name: DEFAULT_SECRETARY.name, emoji: DEFAULT_SECRETARY.emoji, color: DEFAULT_SECRETARY.color,
      role: DEFAULT_SECRETARY.role, desc: DEFAULT_SECRETARY.desc, pickle: true,
      pid: sec.pid || '', model: sec.model || ''
    };
}
function teamModelId(team) {
    var pid = String((team && team.pid) || ''), model = String((team && team.model) || '');
    if (pid && PROVIDERS[pid] && model && !isDeadModel(modelIdOf(pid, model)) && modelList(pid).indexOf(model) >= 0) return modelIdOf(pid, model);
    /* 개발·QC는 OpenRouter·Groq의 코딩 모델을 먼저, Gemini는 맨 마지막 폴백 */
    if (isCodeTeam(team)) return codeDefaultModelId();
    return defaultModelId();
}
function workById(id) {
    if (!S.office) return null;
    for (var i = 0; i < S.office.work.length; i++) if (S.office.work[i].id === id) return S.office.work[i];
    return null;
}
function workFor(teamId) {
    var out = [], list = (S.office && S.office.work) || [];
    for (var i = 0; i < list.length; i++) if (list[i].teamId === teamId) out.push(list[i]);
    return out;
}
function teamStatus(teamId) {
    var list = workFor(teamId);
    for (var i = 0; i < list.length; i++) {
      var w0 = list[i];
      if ((w0.status === 'working' || w0.status === 'queued') && !underStepReview(w0)) return 'working';
      if (w0.kind === 'delegation' && w0.status === 'approved' && w0.phase === 'run') return 'working';
    }
    for (var j = 0; j < list.length; j++) if (list[j].status === 'waiting') return 'waiting';
    for (var k = list.length - 1; k >= 0; k--) {
      if (list[k].status === 'done') return 'done';
      if (list[k].status === 'approved' && !list[k].nextDone) return 'done';
      if (list[k].status === 'approved') return 'done';
    }
    return 'idle';
}
/* 진행 중이거나 대기열에 있거나 최근 보고가 있으면 현황을 보여 줘요 */
function teamActive(teamId) {
    var list = workFor(teamId);
    for (var i = list.length - 1; i >= 0; i--) {
      var w = list[i];
      if (w.status === 'working' || w.status === 'queued' || w.status === 'waiting') return true;
      if (w.kind === 'delegation' && w.status === 'approved' && (w.phase === 'run' || w.phase === 'collect')) return true;
      var t = Date.parse(w.updatedAt || w.at || '');
      if ((w.status === 'done' || w.status === 'approved' || w.status === 'failed' || w.status === 'rejected') && t && (Date.now() - t) < 30 * 60000) return true;
    }
    var q = S.queue || [];
    for (var k = 0; k < q.length; k++) { var qw = workById(q[k]); if (qw && qw.teamId === teamId) return true; }
    if (teamId === 'sec' && ((S.pipe && S.pipe.length) || (S.planQueue && S.planQueue.length) || S.planRunning || S.pipeRunning)) return true;
    return false;
}
function waitingList() {
    var out = [], list = (S.office && S.office.work) || [];
    for (var i = 0; i < list.length; i++) if (list[i].status === 'waiting') out.push(list[i]);
    return out;
}
/* 단계가 끝나 피클 중간 검수를 기다리는 일 (대표님 승인을 기다리는 건 아니에요) */
function reviewList() {
    var out = [], list = (S.office && S.office.work) || [];
    for (var i = list.length - 1; i >= 0; i--) {
      var w = list[i];
      if (!w) continue;
      if (w.status !== 'working') continue;
      if (w.phase === 'step_review') out.push(w);
    }
    return out;
}
function workingList() {
    var out = [], list = (S.office && S.office.work) || [];
    for (var i = 0; i < list.length; i++) {
      if (list[i].status !== 'working') continue;
      if (picoPending(list[i]) || underStepReview(list[i])) continue;
      out.push(list[i]);
    }
    return out;
}
/* 피클 중간 검수를 기다리는 단계의 자식 일인지 (앞 단계 결과를 피클이 보고 있는 중) */
function underStepReview(w) {
    var pid = String((w && (w.secId || w.parentId)) || '');
    if (!pid) return false;
    var p = workById(pid);
    return !!(p && p.phase === 'step_review');
}
function nextStepList() {
    var out = [], list = (S.office && S.office.work) || [];
    for (var i = list.length - 1; i >= 0 && out.length < 6; i--) {
      if (list[i].status === 'approved' && !list[i].nextDone) out.push(list[i]);
    }
    return out;
}
function finishedList() {
    var out = [], list = (S.office && S.office.work) || [];
    for (var i = list.length - 1; i >= 0 && out.length < 4; i--) {
      var w = list[i];
      /* 자동 반영으로 마무리된 일(done·nextDone)도 '최근 마무리'에 보여요 */
      if (!(w.status === 'approved' || (w.status === 'done' && w.nextDone))) continue;
      if (!w.nextDone) continue;
      /* 코드 수정·실제 결과물이 필요한 일은 실제 반영(커밋)까지 가야 '마무리'예요 */
      if (!delivered(w)) continue;
      out.push(w);
    }
    return out;
}
function failedList() {
    var out = [], list = (S.office && S.office.work) || [];
    for (var i = list.length - 1; i >= 0 && out.length < 3; i--) {
      if (list[i].status !== 'failed') continue;
      /* 비서가 이미 보고 카드를 올린 일은 결재함에서 두 번 보여 주지 않아요 */
      if (typeof noticeFor === 'function' && noticeFor(list[i].id)) continue;
      out.push(list[i]);
    }
    return out;
}

/* ---------- 1F 비서실 = 전담 비서 피클 (외부 AI 일꾼을 부르지 않아요) ---------- */
function isPicoWork(w) { return !!(w && w.secOwner === 'pico'); }
/* 피클이 아직 손대기 전(확인 대기)이거나, 팀 단계 결과를 검수하는 중, 보고를 기다리는 중 */
function picoPending(w) { return isPicoWork(w) && (w.picoStatus === 'pending' || w.picoStatus === 'report' || w.picoStatus === 'collect' || w.picoStatus === 'step_review'); }
function picoLabel(w) {
    if (!isPicoWork(w)) return '';
    if (w.picoStatus === 'pending') return '비서 피클 확인 대기';
    if (w.picoStatus === 'step_review') return '피클 중간 검수 대기';
    if (w.picoStatus === 'report') return '피클 최종 취합 보고 대기';
    if (w.picoStatus === 'working') return '피클 작업 중';
    if (w.picoStatus === 'resumed') return '피클 검수 완료 · 다음 팀 진행';
    if (w.picoStatus === 'planned') return '피클 계획 완료 · 승인 대기';
    if (w.picoStatus === 'done') return '피클 보고 완료';
    return '피클 담당';
}
function hasPicoPending() {
    var list = (S.office && S.office.work) || [];
    for (var i = 0; i < list.length; i++) if (picoPending(list[i])) return true;
    return false;
}
function picoPendingFor(teamId) {
    var list = workFor(teamId), out = [];
    for (var i = 0; i < list.length; i++) if (picoPending(list[i])) out.push(list[i]);
    return out;
}
/* 코드 수정이 필요한 일인지 — 계획에 개발팀이 있거나, 수정안·재요청이 붙었거나, 지시에 코드·화면 이야기가 있을 때 */
var CODE_HINT_RE = /(코드|소스|수정안|js\s*\/|index\.html|style\.css|버튼|화면|기능|배포|커밋)/;
function asksCode(item) {
    if (!item) return false;
    if (item.code) return true;
    if (item.codeWanted || item.codeRedoId) return true;
    var plan = item.delegationPlan || [];
    for (var i = 0; i < plan.length; i++) if (plan[i] && plan[i].deptId === 'dev') return true;
    var kids = item.childIds ? secChildList(item) : [];
    for (var k = 0; k < kids.length; k++) if (kids[k] && (kids[k].teamId === 'dev' || kids[k].code)) return true;
    return false;
}
function codeIntent(item) {
    if (!item) return false;
    if (asksCode(item)) return true;
    return CODE_HINT_RE.test(String(item.title || '') + ' ' + String(item.brief || ''));
}
/* 목표한 결과물이 실제로 끝났는지 — 코드 수정은 실제 반영(commit.ok)까지 가야 완료예요 */
function delivered(w) {
    if (!w) return false;
    if (w.status === 'failed' || w.status === 'rejected' || w.status === 'dismissed') return false;
    if (w.code || asksCode(w)) return !!(w.commit && w.commit.ok === true);
    return true;
}
function workStateLabel(w) {
    if (!w) return '';
    if (w.commit) return w.commit.ok ? '코드 반영됨' : '반영 실패';
    if (isPicoWork(w)) return picoLabel(w);
    if (w.status === 'waiting') return '결재 대기';
    if (w.status === 'rejected') return '반려';
    if (w.status === 'failed') return w.code ? '반영 실패' : '실패';
    if (w.status === 'approved') return w.nextDone ? '완료' : '승인됨 · 다음 단계';
    if (w.status === 'done') return '완료';
    return '진행 중';
}
function newWork(teamId, title, brief, materialIds, parentId) {
    S.office.seq = (Number(S.office.seq) || 0) + 1;
    var w = {
      id: 'w' + S.office.seq,
      teamId: teamId,
      title: String(title || '새 일').slice(0, 80),
      brief: String(brief || ''),
      materialIds: (materialIds || []).slice(0, 3),
      at: nowIso(), updatedAt: nowIso(),
      status: 'working', parentId: parentId || '', log: [],
      report: null, secretary: null, code: null, error: ''
    };
    S.office.work.push(w);
    if (S.office.work.length > 120) S.office.work = S.office.work.slice(S.office.work.length - 120);
    return w;
}
function pushLog(item, text) {
    if (!item) return;
    var at = nowIso();
    var line = String(text).slice(0, 200);
    item.log = item.log || [];
    item.log.push({ at: at, text: line });
    if (item.log.length > 24) item.log = item.log.slice(item.log.length - 24);
    /* 실시간 진행 로그 — 현황 모달이 이 기록을 그대로 보여 줘요 */
    item.progressLog = item.progressLog || [];
    item.progressLog.push({ at: at, text: line });
    if (item.progressLog.length > 80) item.progressLog = item.progressLog.slice(item.progressLog.length - 80);
}
function elapsedLabel(iso) {
    var t = Date.parse(iso || '');
    if (!t) return '';
    var d = Date.now() - t;
    if (d < 0) d = 0;
    var s = Math.floor(d / 1000);
    if (s < 60) return Math.max(1, s) + '초째';
    var m = Math.floor(s / 60);
    if (m < 60) return m + '분 ' + (s % 60) + '초째';
    var h = Math.floor(m / 60);
    if (h < 24) return h + '시간 ' + (m % 60) + '분째';
    return Math.floor(h / 24) + '일째';
}
function clockLabel(iso) {
    var t = Date.parse(iso || '');
    if (!t) return '';
    var d = new Date(t);
    return pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds());
}
function whenLabel(iso) {
    var t = Date.parse(iso || '');
    if (!t) return '';
    var d = Date.now() - t;
    if (d < 60000) return '방금';
    if (d < 3600000) return Math.floor(d / 60000) + '분 전';
    if (d < 86400000) return Math.floor(d / 3600000) + '시간 전';
    return Math.floor(d / 86400000) + '일 전';
}
/* 화면에 보여 줄 때는 저장소·파일 경로 대신 가족이 아는 이름으로 적어요 */
var REPO_LABEL = { 'home': '우리 집 화면', 'kids-dashboard': '아이 화면', 'fridge-dashboard': '냉파 화면', 'ledger-dashboard': '가계부 화면' };
var FILE_LABEL = { 'index.html': '기본 화면', 'office.html': 'AI 사무실 화면', 'chat.html': '옛 챗 화면', 'style.css': '스타일' };
function fileLabel(repo, path) {
    var base = String(path || '').split('/').pop();
    return (REPO_LABEL[String(repo || '')] || '화면') + ' · ' + (FILE_LABEL[base] || base || '코드');
}
function firstLines(text, n) {
    var lines = String(text || '').replace(/\r/g, '').split('\n'), out = [];
    for (var i = 0; i < lines.length && out.length < n; i++) {
      var s = lines[i].replace(/^[#>*\-\s]+/, '').trim();
      if (s) out.push(s);
    }
    return out.join(' ');
}
function clip(s, n) {
    var t = String(s == null ? '' : s);
    return t.length > n ? t.slice(0, n) + '…' : t;
}

/* ---------- 사무실 기록 읽기/쓰기 ---------- */
async function loadOffice() {
    var r = await ghGetAt(DEFAULT_REPO, P_OFFICE, null);
    if (!r.ok) return { ok: false, error: r.error || '사무실 기록을 읽지 못했어요' };
    if (r.missing) { S.office = blankOffice(); return { ok: true, missing: true }; }
    var env = null;
    try { env = JSON.parse(r.raw); } catch (e) { env = null; }
    if (!env || !env.ct) return { ok: false, locked: true, error: '사무실 기록 형식이 달라요' };
    var obj = null;
    try { obj = await familyDecrypt(env); } catch (e) { obj = null; }
    if (!obj) return { ok: false, locked: true, error: '사무실 기록을 열지 못했어요' };
    S.office = normalizeOffice(obj);
    S.officeState = JSON.stringify(S.office);
    return { ok: true };
}
function saveOfficeSoon(delay) {
    window.clearTimeout(S.saveTimer);
    S.saveTimer = window.setTimeout(function () { saveOffice(); }, delay == null ? 900 : delay);
}
function saveOffice() {
    if (!S.office || S.officeLocked || !S.chatKey || !S.me) return Promise.resolve(false);
    var snapshot = JSON.stringify(S.office);
    if (snapshot === S.officeState) return Promise.resolve(true);
    S.saveState = 'saving';
    S.saveChain = S.saveChain.then(async function () {
      try {
        var env = await familyEncrypt(JSON.parse(snapshot));
        var w = await ghPutAt(DEFAULT_REPO, P_OFFICE, JSON.stringify(env, null, 2), '🏢 ' + OFFICE_NAME + ': 사무실 기록 저장', null);
        if (w.ok) { S.officeState = snapshot; S.saveState = 'saved'; }
        else { S.saveState = 'error'; }
        return w.ok;
      } catch (e) { S.saveState = 'error'; return false; }
    });
    return S.saveChain;
}
