/* ============================================================================
   AI 사무실 — office/js/ai.js
   팀 지시문 · AI 호출 · 팀 보고 해석
   · office.html 이 css/style.css → js/state.js … js/boot.js 순서로 불러요.
     모듈끼리 같은 전역 스코프를 써요(함수 이름은 사무실 전체에서 하나).
   · 원래 office.html 한 덩어리 스크립트를 기능별로 나눈 파일이라 동작은 같아요.
   ============================================================================ */
'use strict';

/* ==================================================================
     AI 호출 — 팀별 모델 · 한도 시 자동 전환
     ================================================================== */
function toolsForTeam(teamId) {
    var out = [];
    var allow = { family_data: 1, code_list: 1, search_code: 1, read_code_slice: 1, code_read: 1, code_edit: 1 };
    for (var i = 0; i < ALL_TOOLS.length; i++) {
      var t = ALL_TOOLS[i];
      if (!allow[t.name]) continue;
      if (t.name === 'code_edit' && teamId !== 'dev') continue;
      out.push(t);
    }
    return out;
}
function errShort(res) {
    if (!res) return 'AI에 연결하지 못했어요';
    if (res.status === 429) return '요청 한도에 걸렸어요';
    if (res.status === 401 || res.status === 403) return 'AI 키나 권한을 확인해 주세요';
    if (!res.status) return String(res.error || '인터넷 연결을 확인해 주세요');
    return String(res.error || ('HTTP ' + res.status));
}
async function officeCall(team, system, messages, opts) {
    var id0 = teamModelId(team);
    var chain = modelChainFor(team, id0);
    var onStep = opts && opts.onStep ? opts.onStep : null;
    var maxTokens = (opts && opts.maxTokens) || 2600;
    if (!chain.length) {
      var sp0 = splitModelId(id0);
      var p0 = PROVIDERS[sp0.pid] || PROVIDERS.gemini;
      return { ok: false, status: 0, error: p0.label + ' 키가 아직 없어요. ⚙️ 설정에서 무료 키를 넣어 주세요.' };
    }
    var tools = toolsForTeam(team.id);
    var saved = TOOLS;
    TOOLS = tools;
    try {
      var res = null;
      for (var i = 0; i < chain.length; i++) {
        var id = chain[i], sp = splitModelId(id);
        res = await callWithKeys(sp.pid, sp.model, { system: system, messages: messages }, { maxTokens: maxTokens });
        if (res && res.ok) return res;
        /* 단종·없어진 모델이면 목록에서 숨기고 다음 모델로 */
        if (res && isDeadModelError(res.status, res.error)) {
          markDeadModel(id, res.error);
          if (i + 1 < chain.length && onStep) onStep('모델 전환 · ' + modelShort(chain[i + 1]));
          continue;
        }
        /* 한도·혼잡 → 다음 모델로 */
        if (res && (res.status === 429 || res.status === 503)) {
          if (i + 1 >= chain.length) break;
          toast(modelShort(id) + ' 한도/혼잡 → ' + modelShort(chain[i + 1]) + '(으)로 이어서 보내요.');
          if (onStep) onStep('모델 전환 · ' + modelShort(id) + ' → ' + modelShort(chain[i + 1]) + ' (한도·혼잡)');
          continue;
        }
        break;
      }
      return res;
    } finally {
      TOOLS = saved;
    }
}

/* ---------- 팀 지시문 ---------- */
var MODULE_RULES = [
    '[AI 사무실 공통 작업 규칙 — 무엇보다 먼저 지킨다]',
    '1. 승인은 처음 한 번: 대표님 승인은 착수(배분 계획) 승인 1회다. 그 뒤로는 피클이 단계마다 중간 검수하며 끝까지 진행하고, 대표님은 결과 보고만 본다. 다만 인증·로그인·암호화·키 관리, 데이터 저장 구조·스키마, 여러 파일을 크게 고치거나 지우는 일처럼 여파가 큰 변경만 자동 반영하지 않고 다시 승인을 받는다.',
    '2. 작업 전 설명·컨펌: 코드에 바로 적용하지 않는다. 계획·수정안을 먼저 만들고, 실제 반영은 QC 검수를 지난 뒤 사무실이 한다.',
    '3. 시안·요청 1:1 반영: 화면·UI·캐릭터 변경은 확정된 시안과 요청 그대로 실제 화면에 빠짐없이 반영한다. 임의로 바꾸지 않는다.',
    '4. 모듈 분리·추후 수정 가능: 모든 코드는 기능별 모듈(js/*.js, css/*.css)로 분리해 유지하고 한 파일에 몰아넣지 않는다. 새로 추가한 항목·기능도 사용자가 나중에 직접 수정·추가·삭제할 수 있게 만든다.',
    '5. 내부 기술 문구 비노출: 가족이 보는 화면에는 GitHub, localStorage, 저장소 경로 같은 내부 개발·기술 용어를 절대 노출하지 않는다.',
    '6. 완전 완료·재처리: 중간 이슈가 나면 먼저 자동 재처리(재시도·다시 요청)까지 시도하고 그래도 안 될 때만 보고한다. 실제 코드 반영과 검증이 끝났을 때만 완료로 처리한다.'
];
function officeFacts() {
    var d = new Date();
    var lines = [];
    lines.push('오늘은 ' + d.getFullYear() + '년 ' + (d.getMonth() + 1) + '월 ' + d.getDate() + '일 ' +
      ['일', '월', '화', '수', '목', '금', '토'][d.getDay()] + '요일 ' + fmtClock(d.getTime()) + ' (한국 시간).');
    lines.push('대표: ' + ((S.me && (S.me.name || S.me.id)) || '대표'));
    lines.push('');
    lines.push('[우리 집 화면]');
    lines.push('- 우리 집(홈): home — 대문 index.html, AI 사무실 office.html');
    lines.push('- 아이: kids-dashboard — index.html(약 17KB 셸) + js/*.js 모듈(ui·events·routines·settings·sync·core·missions·myroom·pets·shop·stickers·records·avatar·boot) + css/style.css');
    lines.push('- 냉장고 파먹기: fridge-dashboard/index.html · 가계부: ledger-dashboard/index.html');
    lines.push('- 아이 화면은 index.html에 화면 뼈대만 있고, 실제 기능·문구·이벤트는 js/*.js 모듈에 나뉘어 있어요. 고칠 때는 해당 모듈 파일을 찾아 고칩니다.');
    lines.push('- 가족 데이터는 비공개 보관함(kids-dashboard-data)에 있어요. 데이터는 family_data 도구로 읽어요.');
    return lines.join('\n');
}
function buildTeamSystem(team) {
    var lines = [];
    for (var mi = 0; mi < MODULE_RULES.length; mi++) lines.push(MODULE_RULES[mi]);
    lines.push('');
    lines.push('너는 jadenfamily 가족의 AI 사무실에서 일하는 "' + team.name + '" 팀의 직원이다.');
    lines.push('팀 역할: ' + (team.desc || ''));
    lines.push('한국어로 일한다. 실제로 쓸 수 있는 결과를 만들고, 모르는 것은 확인한 뒤에 쓴다.');
    lines.push(officeFacts());
    lines.push('');
    lines.push('[사무실 규칙]');
    lines.push('- 대표님 승인은 처음 착수 승인 1회뿐이다. 그 뒤로는 피클이 단계마다 중간 검수하며 다음 팀으로 넘기고, 대표님은 끝난 결과만 본다.');
    lines.push('- 코드 수정은 code_edit로 "수정안"만 만든다. QC를 통과한 저·중위험 수정안은 사무실이 자동으로 반영하고, 인증·로그인·암호화·키·저장 구조·대규모 변경처럼 여파가 큰 것만 대표님 최종 승인을 받는다.');
    lines.push('- 코드·데이터는 반드시 읽기 도구로 실제 내용을 확인하고 쓴다. 짐작으로 파일 이름·줄·함수를 쓰지 않는다.');
    lines.push('- "찾아볼게요"처럼 말만 하고 끝내지 않는다. 바로 도구를 불러 확인한다. 도구 결과가 오면 같은 도구를 또 부르지 말고 그 결과로 정리한다.');
    lines.push('- 도구를 부르는 중간 턴에는 완료 보고를 쓰지 않는다. 마지막 답변에서만 실제 결과대로 쓴다.');
    lines.push('- 비밀번호·토큰·API 키는 절대 답변이나 보고에 쓰지 않는다.');
    lines.push('- 토큰을 아낀다. 파일을 통째로 다시 쓰지 말고 edits(찾아 바꾸기)로 작게 고친다.');
    lines.push('');
    lines.push('[도구 쓰는 법]');
    lines.push('도구는 함수 호출(도구 이름 + JSON 인자)로 부른다. 함수 호출을 쓸 수 없는 모델이면 아래 ```tool 블록을 출력한다.');
    lines.push('```tool');
    lines.push('{"tool":"도구이름","args":{}}');
    lines.push('```');
    var tools = toolsForTeam(team.id);
    for (var i = 0; i < tools.length; i++) {
      lines.push('- ' + tools[i].name + ': ' + tools[i].desc + ' args: ' + tools[i].argsHint);
    }
    lines.push('');
    if (team.id === 'dev') {
      lines.push('[개발팀으로 일하는 법]');
      lines.push('- 아이 화면(kids-dashboard)은 index.html 셸 + js/*.js 모듈 구조예요. 화면 그리기는 js/ui.js, 이벤트는 js/events.js, 루틴은 js/routines.js, 설정은 js/settings.js, 저장·동기화는 js/sync.js, 공통 상태·도우미는 js/core.js 에 있어요. index.html에는 뼈대만 있으니 path에는 고칠 모듈 파일(예: js/ui.js)을 적습니다.');
      lines.push('- 고칠 곳을 찾을 때: code_list로 파일 이름 확인 → search_code(path 꼭 적기) → read_code_slice로 앞뒤 80~200줄 확인 → code_edit의 edits(찾아 바꾸기)로 작게 수정.');
      lines.push('- "function"·"div" 같은 흔한 낱말로 넓게 찾지 않는다. 고칠 대상의 이름을 그대로 넣어 찾는다.');
      lines.push('- old_string은 파일 글자와 같게 쓴다. 못 찾으면 오류에 "가장 비슷한 줄"과 앞뒤 2줄이 나오니 그대로 다시 쓴다.');
      lines.push('- 아주 큰 모듈은 content로 통째로 쓰지 않는다. edits(찾아 바꾸기)나 range로 필요한 부분만 고친다.');
      lines.push('');
    }
    if (team.id === 'qc') {
      lines.push('[QC팀으로 일하는 법]');
      lines.push('- 넘겨받은 수정안의 변경 구간(찾을 글자 → 바꿀 글자)을 보고, 문법·구조·기존 기능에 미치는 영향을 본다. 필요하면 code_read·read_code_slice로 원본을 직접 확인한다.');
      lines.push('- 판단은 summary 첫 줄에 "검수 통과" 또는 "문제 있음"으로 분명히 적고, 보고 json에 "verdict":"통과" 또는 "문제"를 넣는다.');
      lines.push('- 문제가 있으면 어떤 줄에서 무엇이 문제인지, 어떻게 고쳐야 하는지 적는다. 사소한 표현 차이로 통과를 막지 않는다.');
      lines.push('- 인증·로그인·암호화·키 관리, 데이터 저장 구조·스키마, 여러 파일 대규모 수정처럼 여파가 큰 변경을 발견하면 verdict는 "문제"로 적고 보고에 "여파 큼"이라고 분명히 쓴다.');
      lines.push('');
    }
    if (team.id === 'cs') {
      lines.push('[CS팀으로 일하는 법]');
      lines.push('- 접수된 요구를 같은 것끼리 묶고, 바로 할 수 있는 일 / 결정이 필요한 일 / 나중에 할 일로 나눈다.');
      lines.push('- 가족이 쓴 말을 그대로 인용해 요지를 남긴다. 없는 요구를 만들지 않는다.');
      lines.push('');
    }
    if (team.id === 'plan') {
      lines.push('[기획팀으로 일하는 법]');
      lines.push('- 목표·범위·순서·예상 시간을 나눠 실행 계획을 만든다. 결정이 필요한 것은 질문으로 남긴다.');
      lines.push('');
    }
    if (team.id === 'design') {
      lines.push('[디자인팀으로 일하는 법]');
      lines.push('- 1280px 화면과 390px 휴대폰을 함께 생각한다. 글자 크기·여백·터치 크기·가로 넘침을 본다.');
      lines.push('');
    }
    if (team.id === 'research') {
      lines.push('[리서치팀으로 일하는 법]');
      lines.push('- 확인한 근거(출처·수치·날짜)와 함께 비교해 정리한다. 확인하지 못한 것은 "확인 못 함"으로 적는다.');
      lines.push('');
    }
    lines.push('[보고 형식 — 마지막 답변에 꼭]');
    lines.push('마지막에는 아래 ```json 블록 하나를 낸다. 블록 밖에는 사람이 읽을 두세 줄만 쓴다.');
    lines.push('```json');
    lines.push('{"summary":"핵심 3줄 이내","detail":"확인한 파일·바꾼 내용·근거를 자세히","next":["추천 다음 단계"]}');
    lines.push('```');
    lines.push('summary는 대표님이 3초에 판단할 핵심만, detail은 근거와 실제 작업 내용, next는 다음에 할 일(없으면 빈 배열).');
    if (S.pref.instructions) {
      lines.push('');
      lines.push('[대표님 지침]');
      lines.push(String(S.pref.instructions).slice(0, 2000));
    }
    return lines.join('\n');
}
function materialText(item) {
    var out = [];
    var ids = (item && item.materialIds) || [];
    for (var i = 0; i < ids.length; i++) {
      var src = workById(ids[i]);
      if (!src) continue;
      var who = (teamById(src.teamId) || { name: src.teamId }).name;
      var sec = src.secretary && src.secretary.summary ? src.secretary.summary : (src.report && src.report.summary ? src.report.summary : '');
      var det = src.report && src.report.detail ? clip(src.report.detail, 2400) : '';
      out.push('— [' + who + '] ' + src.title + '\n  핵심: ' + clip(sec, 500) + (det ? '\n  상세: ' + det : ''));
    }
    return out.join('\n\n');
}
/* QC가 실제 변경 내용을 보고 검수하도록 수정안을 그대로 넣어 줘요 */
function codeReviewText(code) {
    if (!code) return '';
    var lines = [];
    lines.push('[검수할 코드 수정안] — 개발팀이 만든 실제 수정안이에요. 이 내용을 보고 검수한다.');
    lines.push('- 저장소: ' + String(code.repo || ''));
    lines.push('- 파일: ' + String(code.path || ''));
    lines.push('- 변경 요약: ' + clip(code.summary || code.patchNote || '(요약 없음)', 800));
    lines.push('- 규모: +' + (code.added || 0) + ' −' + (code.removed || 0) + '줄 · 바뀐 구간 ' + ((code.edits || []).length) + '개');
    lines.push('- 자동 검사: ' + (code.checkOk ? '통과 (문법·구조 검사)' : '문제 있음 · ' + clip((code.checkErrors || []).join(' / '), 600)));
    var edits = Object.prototype.toString.call(code.edits) === '[object Array]' ? code.edits : [];
    for (var i = 0; i < edits.length && i < 8; i++) {
      var e = edits[i] || {};
      lines.push('');
      lines.push('(' + (i + 1) + ') 찾을 글자(old_string)');
      lines.push('```');
      lines.push(clip(String(e.old_string == null ? '' : e.old_string), 1600));
      lines.push('```');
      lines.push('(' + (i + 1) + ') 바꿀 글자(new_string)');
      lines.push('```');
      lines.push(clip(String(e.new_string == null ? '' : e.new_string), 1600));
      lines.push('```');
    }
    if (!edits.length && code.content != null) {
      lines.push('');
      lines.push('[바뀐 파일 전체]');
      lines.push('```');
      lines.push(clip(String(code.content), 5000));
      lines.push('```');
    }
    if (code.diffText) {
      lines.push('');
      lines.push('[줄 비교]');
      lines.push('```diff');
      lines.push(clip(String(code.diffText), 5000));
      lines.push('```');
    }
    lines.push('');
    lines.push('확인할 것: 1) 바꿀 글자가 실제 파일에 그대로 있는지 2) 문법·구조가 깨지지 않는지 3) 기존 기능에 영향이 없는지 4) 여파가 큰 변경(인증·저장 구조·대규모)인지.');
    return lines.join('\n');
}
function buildTeamInput(item, team) {
    var lines = [];
    lines.push('[맡긴 일] ' + item.title);
    lines.push('');
    lines.push('[대표님 지시]');
    lines.push(String(item.brief || '').slice(0, 6000));
    var mats = materialText(item);
    if (mats) {
      lines.push('');
      lines.push('[넘겨받은 자료]');
      lines.push(mats);
    }
    if (team.id === 'qc' && (item.codeUnderReview || item.code)) {
      lines.push('');
      lines.push(codeReviewText(item.codeUnderReview || item.code));
    } else if (item.code) {
      lines.push('');
      lines.push('[이미 만든 수정안]');
      lines.push(item.code.repo + '/' + item.code.path + ' — ' + clip(item.code.patchNote || '', 300));
      if (item.code.diffText) lines.push(clip(item.code.diffText, 4000));
    }
    if (item.priorContext) {
      lines.push('');
      lines.push(String(item.priorContext).slice(0, 5000));
    }
    lines.push('');
    lines.push('이 일을 맡아서 처리하고, 마지막에 보고 형식(```json)으로 답해 주세요.');
    return lines.join('\n');
}

/* ---------- 보고 파싱 ---------- */
function jsonBlocks(text) {
    var out = [], re = /```(?:json)?\s*([\s\S]*?)```/gi, m;
    while ((m = re.exec(String(text || '')))) out.push(m[1].trim());
    return out;
}
function findReportObj(text) {
    var s = String(text || '');
    var blocks = jsonBlocks(s);
    for (var i = 0; i < blocks.length; i++) {
      var j = null;
      try { j = JSON.parse(blocks[i]); } catch (e) { j = null; }
      if (j && typeof j === 'object' && !Object.prototype.toString.call(j) === '[object Array]' && (j.summary || j.detail || j.points)) return j;
    }
    /* 펜스가 없이 덩그러니 JSON만 온 경우: 균형 잡힌 {...}를 훑어요 */
    for (var start = s.indexOf('{'); start >= 0; start = s.indexOf('{', start + 1)) {
      var depth = 0, inStr = false, esc2 = false, end = -1;
      for (var k = start; k < s.length; k++) {
        var ch = s.charAt(k);
        if (inStr) {
          if (esc2) { esc2 = false; continue; }
          if (ch === '\\') { esc2 = true; continue; }
          if (ch === '"') inStr = false;
          continue;
        }
        if (ch === '"') { inStr = true; continue; }
        if (ch === '{') depth++;
        else if (ch === '}') { depth--; if (depth === 0) { end = k; break; } }
      }
      if (end < 0) continue;
      var obj = null;
      try { obj = JSON.parse(s.slice(start, end + 1)); } catch (e) { obj = null; }
      if (obj && typeof obj === 'object' && (obj.summary || obj.detail)) return obj;
    }
    return null;
}
function teamKeyFromName(name) {
    var s = String(name || '');
    if (/cs|고객|문의|접수/i.test(s)) return 'cs';
    if (/기획/.test(s)) return 'plan';
    if (/디자인|design/i.test(s)) return 'design';
    if (/개발|코딩|dev|code/i.test(s)) return 'dev';
    if (/qc|품질|검수/i.test(s)) return 'qc';
    if (/리서치|조사|research/i.test(s)) return 'research';
    return '';
}
function normNext(arr) {
    var out = [];
    if (!arr) return out;
    if (!(Object.prototype.toString.call(arr) === '[object Array]')) arr = [arr];
    for (var i = 0; i < arr.length && out.length < 4; i++) {
      var x = arr[i];
      var label = typeof x === 'string' ? x : String((x && (x.label || x.text || x.title)) || '');
      if (!label) continue;
      var teamId = typeof x === 'object' && x ? teamKeyFromName(x.team || x.to || '') : '';
      if (!teamId) teamId = teamKeyFromName(label);
      out.push({ label: label.slice(0, 80), teamId: teamId });
    }
    return out;
}
function parseTeamReport(text) {
    var raw = String(text || '');
    var obj = findReportObj(raw);
    var withoutJson = raw.replace(/```(?:json)?\s*[\s\S]*?```/gi, '').trim();
    var summary = obj && obj.summary ? String(obj.summary).trim() : '';
    var detail = obj && obj.detail ? String(obj.detail).trim() : '';
    if (!summary) summary = firstLines(withoutJson || raw, 3) || '(보고 내용이 비어 있어요)';
    if (!detail) detail = withoutJson || raw;
    return {
      summary: clip(summary, 1200),
      detail: clip(detail, 12000),
      next: normNext(obj && obj.next),
      verdict: clip(String((obj && (obj.verdict || obj.result)) || ''), 120),
      at: nowIso()
    };
}

/* ---------- 팀 작업 실행 ---------- */
var TOOL_STEP = {
    family_data: '가족 기록 확인 중',
    code_list: '화면 목록 보는 중',
    search_code: '관련 화면 찾는 중',
    read_code_slice: '화면 내용 읽는 중',
    code_read: '화면 내용 읽는 중',
    code_edit: '수정안 만드는 중'
};
function toolStepLabel(name) {
    return TOOL_STEP[name] || '도구로 확인 중';
}
async function runTeamAgent(item, team) {
    var msgs = [{ role: 'user', text: buildTeamInput(item, team) }];
    var last = '';
    pushLog(item, '업무 파악 중');
    for (var step = 0; step < 8; step++) {
      var res = await officeCall(team, buildTeamSystem(team), msgs, {
        maxTokens: 2800,
        onStep: function (t) { pushLog(item, t); if (S.teamModal) renderAll(); }
      });
      if (!res.ok) {
        if (step === 0) throw new Error(errShort(res));
        item.error = errShort(res);
        break;
      }
      last = String(res.text || '');
      var calls = (res.toolCalls && res.toolCalls.length) ? res.toolCalls : null;
      if (!calls) {
        var one = parseToolCall(last);
        calls = one ? [one] : null;
      }
      if (!calls) break;
      var allowed = {};
      var tl = toolsForTeam(team.id);
      for (var a = 0; a < tl.length; a++) allowed[tl[a].name] = 1;
      for (var ci = 0; ci < calls.length; ci++) {
        var call = calls[ci] || {};
        var name = String(call.name || '');
        var args = call.args || {};
        var out;
        if (!allowed[name]) {
          out = { text: '이 사무실에서는 그 도구를 쓸 수 없어요. 쓸 수 있는 도구: ' + Object.keys(allowed).join(', '), label: '도구 제한' };
        } else {
          pushLog(item, toolStepLabel(name));
          var tool = toolByName(name);
          try { out = await tool.run(normalizeToolArgs(name, args), { threadId: item.id }); }
          catch (e) { out = { text: '도구를 실행하지 못했어요: ' + (e && e.message ? e.message : ''), label: '오류' }; }
          if (name === 'code_edit' && out && out.card && out.card.kind === 'edit') {
            var prop = S.proposals[out.card.id];
            if (prop) {
              item.code = codeFromProposal(prop, args);
              pushLog(item, '수정안 점검 중 · ' + fileLabel(prop.repo, prop.path) + ' (+' + prop.diff.added + ' −' + prop.diff.removed + ')');
            }
          }
        }
        msgs.push({ role: 'assistant', text: '도구를 부릅니다: ' + name });
        msgs.push({ role: 'user', text: '[도구 결과 ' + name + ']\n' + clip(out.text || '', 5000) });
        pushLog(item, '도구 · ' + name + (out.label ? ' (' + out.label + ')' : ''));
        if (S.teamModal) renderAll();
      }
      if (step === 7) break;
    }
    pushLog(item, '결과 정리 중');
    return parseTeamReport(last);
}
function codeFromProposal(prop, args) {
    var rows = (prop.diff && prop.diff.rows) || [];
    var lines = [], shown = 0;
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i] || {};
      var s = String(r.s == null ? '' : r.s);
      lines.push((r.t === '+' ? '+' : r.t === '-' ? '-' : ' ') + s);
      shown++;
      if (lines.join('\n').length > 8000) { lines.push('… (변경이 많아 앞부분만 보여 줘요)'); break; }
    }
    var errors = [];
    if (prop.check && prop.check.steps) {
      for (var k = 0; k < prop.check.steps.length; k++) {
        var st = prop.check.steps[k];
        if (!st.ok && st.errors) for (var e = 0; e < st.errors.length; e++) errors.push(st.errors[e]);
      }
    }
    return {
      repo: prop.repo, path: prop.path,
      summary: String(prop.summary || args.summary || '').slice(0, 300),
      patchNote: String(prop.patchNote || '').slice(0, 300),
      edits: (args && args.edits) ? args.edits : null,
      content: (args && args.content != null) ? String(args.content) : null,
      range: (args && args.range) ? args.range : null,
      added: (prop.diff && prop.diff.added) || 0,
      removed: (prop.diff && prop.diff.removed) || 0,
      diffText: lines.join('\n'),
      checkOk: !!(prop.check && prop.check.ok),
      checkErrors: errors.slice(0, 6),
      at: nowIso()
    };
}

/* ---------- 비서 ---------- */
function buildSecretarySystem() {
    var lines = [];
    for (var mi = 0; mi < MODULE_RULES.length; mi++) lines.push(MODULE_RULES[mi]);
    lines.push('');
    lines.push('너는 jadenfamily 가족의 AI 사무실에서 일하는 "비서"다.');
    lines.push('각 팀의 보고를 대표님이 3초에 판단할 수 있게 정리해 대표실 결재함으로 올린다.');
    lines.push(officeFacts());
    lines.push('');
    lines.push('[규칙]');
    lines.push('- 팀 보고에 없는 내용을 만들지 않는다. 숫자·파일 이름·결론은 보고에 있는 것만 쓴다.');
    lines.push('- 대표님이 결정할 것(결재 포인트)을 분명히 짚는다. 결정이 없으면 "바로 승인해도 됨"이라고 쓴다.');
    lines.push('- 다음 단계가 자연스러우면 추천한다. 예: 기획→개발, 개발 수정안→QC 검수.');
    lines.push('- 짧고 분명한 한국어. 군더더기 금지.');
    lines.push('');
    lines.push('[출력 형식 — 마지막에 ```json 블록 하나]');
    lines.push('```json');
    lines.push('{"summary":"핵심 3줄","points":["결재 포인트1","결재 포인트2"],"recommend":"추천 다음 단계 한 줄","next":[{"label":"QC팀 검수 요청","team":"QC(품질관리)팀"}]}');
    lines.push('```');
    return lines.join('\n');
}
async function runSecretary(item) {
    var team = teamById(item.teamId) || { name: item.teamId, id: item.teamId };
    var rep = item.report || {};
    var lines = [];
    lines.push('[맡긴 일] ' + item.title);
    lines.push('[지시] ' + clip(item.brief, 1500));
    lines.push('[팀] ' + team.name);
    lines.push('[팀 보고 핵심] ' + clip(rep.summary || '', 800));
    lines.push('[팀 보고 상세] ' + clip(rep.detail || '', 5000));
    if (item.code) {
      lines.push('[코드 수정안] ' + item.code.repo + '/' + item.code.path + ' (+' + item.code.added + ' −' + item.code.removed + ') · ' + (item.code.checkOk ? '자동 검사 통과' : '자동 검사 문제 있음'));
      lines.push(clip(item.code.diffText || '', 2500));
    }
    if (rep.next && rep.next.length) lines.push('[팀이 제안한 다음 단계] ' + rep.next.map(function (x) { return x.label; }).join(' / '));
    var res = await officeCall(secretaryTeam(), buildSecretarySystem(), [{ role: 'user', text: lines.join('\n') }], { maxTokens: 1200 });
    if (!res.ok) {
      item.secretary = {
        summary: rep.summary || '팀 보고가 도착했어요.',
        points: ['팀 보고를 확인하고 승인 여부를 정해 주세요.'],
        recommend: (rep.next && rep.next[0] && rep.next[0].label) || '',
        next: (rep.next || []).slice(0, 3),
        fallback: true, at: nowIso()
      };
      return item.secretary;
    }
    var obj = findReportObj(res.text) || {};
    var summary = String(obj.summary || '').trim() || rep.summary || '';
    var points = [];
    if (Object.prototype.toString.call(obj.points) === '[object Array]') {
      for (var i = 0; i < obj.points.length && points.length < 5; i++) {
        var p = String(obj.points[i] || '').trim();
        if (p) points.push(p);
      }
    }
    var next = normNext(obj.next);
    if (!next.length) next = (rep.next || []).slice(0, 3);
    item.secretary = {
      summary: clip(summary, 1200),
      points: points.length ? points : ['팀 보고 내용을 확인하고 승인 여부를 정해 주세요.'],
      recommend: clip(String(obj.recommend || '').trim(), 300),
      next: next,
      at: nowIso()
    };
    return item.secretary;
}
