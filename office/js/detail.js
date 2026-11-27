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

/* ==================================================================
     📄 리포트 보기 — 데일리·주간 브리핑과 리서치 보고 전문
     ================================================================== */
var RP_BRIEF_DIR = 'ai-office/daily-dba-brief';
var RP_LIST = [];
var RP_NOW = null;

function rpEnsureModal() {
    if (document.getElementById('reportModal')) return;
    var d = document.createElement('div');
    d.id = 'reportModal';
    d.className = 'modal';
    d.hidden = true;
    d.setAttribute('role', 'dialog');
    d.setAttribute('aria-modal', 'true');
    d.innerHTML = '<div class="modal-card team-modal-card">' +
      '<div class="modal-head"><h2>📄 리포트</h2>' +
      '<button class="modal-close" type="button" data-act="reports-close" aria-label="닫기">✕</button></div>' +
      '<div class="modal-body" id="reportList"></div></div>';
    document.body.appendChild(d);
    if (!document.getElementById('rpStyle')) {
      var st = document.createElement('style');
      st.id = 'rpStyle';
      st.textContent = '.rp-text{white-space:pre-wrap;word-break:break-word;max-height:60vh;overflow:auto;' +
        'font-size:13px;line-height:1.6;background:#fbf8f3;border:1px solid #eee3d5;border-radius:10px;padding:10px;margin:8px 0 0}' +
        '.rp-row{display:flex;gap:6px;flex-wrap:wrap;margin:10px 0 0}' +
        '.rp-h{font-weight:900;color:#5d4f96;margin:12px 0 4px}.rp-pick{margin:0 4px 4px 0}';
      document.head.appendChild(st);
    }
}

function rpInjectButton() {
    var bar = document.querySelector('.topbar');
    var set = document.getElementById('settingsBtn');
    if (!bar || !set) return;
    if (document.querySelector('[data-act="reports-open"]')) return;
    var b = document.createElement('button');
    b.className = 'icon-btn';
    b.type = 'button';
    b.setAttribute('data-act', 'reports-open');
    b.setAttribute('aria-label', '리포트 보기');
    b.title = '리포트 보기';
    b.textContent = '📄';
    bar.insertBefore(b, set);
}

async function rpOpen() {
    if (!S.unlocked || !S.office) return;
    rpEnsureModal();
    var m = document.getElementById('reportModal');
    if (!m) return;
    m.hidden = false;
    document.body.style.overflow = 'hidden';
    document.documentElement.style.overflow = 'hidden';
    var body = document.getElementById('reportList');
    if (body) body.innerHTML = '<p class="tm-empty">리포트를 불러오는 중…</p>';
    await rpLoadList();
}

function rpClose() {
    var m = document.getElementById('reportModal');
    if (m) m.hidden = true;
    var wm = document.getElementById('workModal'), tm = document.getElementById('teamModal');
    var sm = document.getElementById('settingsModal');
    if ((!wm || wm.hidden) && (!tm || tm.hidden) && (!sm || sm.hidden)) {
      document.body.style.overflow = '';
      document.documentElement.style.overflow = '';
    }
}

async function rpLoadList() {
    var body = document.getElementById('reportList');
    if (!body) return;
    var r = await ghGetAt(DEFAULT_REPO, RP_BRIEF_DIR, null);
    if (!r.ok) {
      body.innerHTML = '<p class="tm-empty">리포트를 불러오지 못했어요. 잠시 뒤 다시 열어 주세요.</p>';
      return;
    }
    var names = (r.list || []).filter(function (f) { return f && f.type === 'file'; }).map(function (f) { return f.name; });
    var daily = names.filter(function (n) { return /^\d{4}-\d{2}-\d{2}\.json$/.test(n); }).sort().reverse().slice(0, 10);
    var weekly = names.filter(function (n) { return /^weekly-\d{4}-\d{2}-\d{2}\.json$/.test(n); }).sort().reverse().slice(0, 6);
    var picks = [];
    if (names.indexOf('latest.json') >= 0) picks.push({ key: 'latest.json', label: '오늘 (최신)', group: '최신' });
    for (var i = 0; i < daily.length; i++) picks.push({ key: daily[i], label: daily[i].replace('.json', ''), group: '데일리' });
    for (var w = 0; w < weekly.length; w++) picks.push({ key: weekly[w], label: weekly[w].replace('weekly-', '').replace('.json', '') + ' 주간', group: '주간' });
    if (!weekly.length && names.indexOf('latest-weekly.json') >= 0) picks.push({ key: 'latest-weekly.json', label: '최근 주간', group: '주간' });
    var works = (S.office && S.office.work) || [];
    var picked = 0;
    for (var k = works.length - 1; k >= 0 && picked < 5; k--) {
      var it = works[k];
      if (!it || it.teamId !== 'research' || !it.report) continue;
      picks.push({ key: 'work:' + it.id, label: it.title || '리서치 보고', group: '리서치 보고', w: it });
      picked += 1;
    }
    RP_LIST = picks;
    if (!RP_LIST.length) { body.innerHTML = '<p class="tm-empty">아직 리포트가 없어요.</p>'; return; }
    var h = '<p class="hint">읽고 싶은 리포트를 고르면 전문이 열려요.</p>';
    var last = '';
    for (var n = 0; n < RP_LIST.length; n++) {
      if (RP_LIST[n].group !== last) { h += '<p class="rp-h">' + esc(RP_LIST[n].group) + '</p>'; last = RP_LIST[n].group; }
      h += '<button class="btn-s rp-pick" type="button" data-act="reports-pick" data-key="' + esc(RP_LIST[n].key) + '">' + esc(RP_LIST[n].label) + '</button>';
    }
    body.innerHTML = h + '<div id="reportView"></div>';
}

async function rpPick(key) {
    var view = document.getElementById('reportView');
    if (!view) return;
    var found = null;
    for (var i = 0; i < RP_LIST.length; i++) if (RP_LIST[i].key === key) found = RP_LIST[i];
    view.innerHTML = '<p class="tm-empty">불러오는 중…</p>';
    if (key.indexOf('work:') === 0) {
      if (!found || !found.w) { view.innerHTML = '<p class="tm-empty">리포트를 찾지 못했어요.</p>'; return; }
      var w = found.w, rep = w.report || {};
      var text = '# ' + (w.title || '리서치 보고') + '\n\n' + (rep.summary || '') + '\n\n' + (rep.detail || '');
      RP_NOW = { md: text, name: 'office-report-' + w.id + '.md' };
      view.innerHTML = rpViewHtml(text);
      return;
    }
    var r = await ghGetJson(DEFAULT_REPO, RP_BRIEF_DIR + '/' + key, null);
    if (!r || !r.ok || !r.data) { view.innerHTML = '<p class="tm-empty">리포트를 불러오지 못했어요.</p>'; return; }
    var md = rpMarkdown(r.data);
    var base = key.indexOf('weekly-') === 0 ? 'dba-weekly-' : 'dba-brief-';
    RP_NOW = { md: md, name: base + String(r.data.date || 'report') + '.md' };
    view.innerHTML = rpViewHtml(md);
}

function rpViewHtml(md) {
    return '<div class="rp-row"><button class="btn-s" type="button" data-act="reports-md">⬇️ .md로 내려받기</button>' +
      '<button class="btn-s" type="button" data-act="reports-copy">복사</button></div>' +
      '<pre class="rp-text">' + esc(md) + '</pre>';
}

function rpMarkdown(d) {
    if (!d || typeof d !== 'object') return '';
    var L = [];
    var weekly = d.schema === 'dba-weekly-brief/1';
    L.push('# ' + (weekly ? '📅 ' + (d.date || '') + ' 금융권 DBA 주간 요약' : '📰 ' + (d.date || '') + ' 금융권 DBA 데일리 브리핑'));
    if (d.status === 'feed-only') L.push('', '> AI 요약 없이 기사 목록만 있어요.');
    if (d.weekStart || d.weekEnd) L.push('', '기간: ' + (d.weekStart || '') + ' ~ ' + (d.weekEnd || ''));
    if (d.model) L.push('모델: ' + d.model);
    var hl = d.headline;
    if (hl && hl.length) {
      L.push('', weekly ? '## 이번 주 핵심' : '## 오늘의 핵심');
      for (var i = 0; i < hl.length; i++) L.push((i + 1) + '. ' + hl[i]);
    }
    var secs = d.sections || [];
    for (var s = 0; s < secs.length; s++) {
      var sec = secs[s] || {}, items = sec.items || [];
      if (!items.length) continue;
      L.push('', '## ' + (sec.title || sec.id || ''));
      for (var j = 0; j < items.length; j++) {
        var it = items[j] || {};
        L.push('- **' + (it.title || '') + '** — ' + (it.summary || '') + (it.url ? ' (' + it.url + ')' : ''));
        if (it.finance) L.push('  - → ' + it.finance);
      }
    }
    var trends = d.trends || [];
    for (var t = 0; t < trends.length; t++) {
      var tr = trends[t] || {}, list = tr.items || [];
      L.push('', '## 주간 트렌드: ' + (tr.title || ''));
      if (tr.summary) L.push(tr.summary);
      for (var u = 0; u < list.length; u++) L.push('- ' + (list[u].title || '') + (list[u].url ? ' (' + list[u].url + ')' : ''));
    }
    function block(arr, head, cols) {
      if (!arr || !arr.length) return;
      L.push('', '## ' + head);
      for (var x = 0; x < arr.length; x++) {
        var o = arr[x] || {}, parts = [];
        for (var c = 0; c < cols.length; c++) if (o[cols[c]]) parts.push(o[cols[c]]);
        if (parts.length) L.push('- ' + parts.join(' — '));
      }
    }
    block(d.actions, '복귀 준비', ['phase', 'todo', 'why']);
    block(d.changes, '핵심 변화', ['area', 'what', 'why']);
    block(d.returnPrep, '복귀 준비 체크', ['phase', 'todo', 'why']);
    var watch = d.watch || [];
    if (watch.length) { L.push('', '## 지켜볼 것'); for (var a = 0; a < watch.length; a++) L.push('- ' + watch[a]); }
    var src = d.sources || [];
    if (src.length) {
      L.push('', '## 출처');
      for (var q = 0; q < src.length && q < 30; q++) {
        var so = src[q] || {};
        L.push('- ' + (so.title || '') + (so.url ? ' — ' + so.url : '') + (so.source ? ' (' + so.source + ')' : ''));
      }
    }
    if (L.length <= 1) return JSON.stringify(d, null, 1);
    return L.join('\n');
}

function rpDownload() {
    if (!RP_NOW || !RP_NOW.md) { toast('내려받을 리포트가 없어요.'); return; }
    try {
      var blob = new Blob([RP_NOW.md], { type: 'text/markdown;charset=utf-8' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = RP_NOW.name || 'report.md';
      document.body.appendChild(a);
      a.click();
      window.setTimeout(function () { URL.revokeObjectURL(url); if (a.parentNode) a.parentNode.removeChild(a); }, 400);
      toast('.md 파일로 내려받았어요.');
    } catch (e) {
      var w = window.open('', '_blank');
      if (w) {
        w.document.title = RP_NOW.name || 'report';
        w.document.write('<pre style="white-space:pre-wrap;font-family:system-ui">' + esc(RP_NOW.md) + '</pre>');
      }
      toast('내려받기를 지원하지 않아 새 창에 열었어요.');
    }
}

function rpCopy() {
    if (!RP_NOW || !RP_NOW.md) return;
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(RP_NOW.md).then(function () { toast('복사했어요.'); }, function () { toast('복사하지 못했어요.'); });
        return;
      }
    } catch (e) { /* 아래 안내로 */ }
    toast('이 기기에서는 복사를 지원하지 않아요.');
}

document.addEventListener('click', function (e) {
    var el = (e.target && e.target.closest) ? e.target.closest('[data-act]') : null;
    if (!el) return;
    var act = el.getAttribute('data-act');
    if (act === 'reports-open') { e.preventDefault(); rpOpen(); return; }
    if (act === 'reports-close') { e.preventDefault(); rpClose(); return; }
    if (act === 'reports-pick') { e.preventDefault(); rpPick(el.getAttribute('data-key') || ''); return; }
    if (act === 'reports-md') { e.preventDefault(); rpDownload(); return; }
    if (act === 'reports-copy') { e.preventDefault(); rpCopy(); return; }
});

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', rpInjectButton);
else rpInjectButton();

